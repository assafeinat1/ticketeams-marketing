/**
 * Agent Chat Router
 *
 * POST /api/agent-chat — single endpoint for all 7 agent chats.
 * Routes to correct agent prompt, calls Claude API, handles delegation.
 */

require('dotenv').config();
const { AGENT_PROMPTS, AGENT_NAMES_HE } = require('./agent-prompts');
const { processMessage, buildMemoryPrompt } = require('./agent-memory');

// ============================================================
// Agent data fetchers — import existing agent functions
// ============================================================
const { getAllHeatScores, getHeatScoreForEvent, getIntelligenceForDate, triggerManualScan } = require('../agents/intelligence-agent');
const {
  getWeeklyReport, getEventProfitability, getCampaignProfitability,
  getChannelPerformance, getBudgetRecommendation, getAlerts: getFinanceAlerts,
  getCurrentWeekStart,
} = require('../agents/finance-agent');
const { listPendingApprovals } = require('../agents/human-approval');
const { getMatchPricing, scoreDemand, proactiveScan, getStockStatus } = require('../agents/scout-agent');
const { generateBIReport } = require('../agents/cmo-agent');
const { listPublishedCampaigns } = require('../agents/meta-publisher');
const { checkTokenValidity } = require('../agents/token-manager');
const { getOrchestratorStatus, getRecentDecisions } = require('../agents/orchestrator');

// ============================================================
// Rate limiting (simple in-memory)
// ============================================================
const rateLimitMap = new Map();
const RATE_LIMIT = 10; // requests per minute
const RATE_WINDOW = 60000; // 1 minute

function checkRateLimit(ip) {
  const now = Date.now();
  const entry = rateLimitMap.get(ip) || { count: 0, windowStart: now };

  if (now - entry.windowStart > RATE_WINDOW) {
    entry.count = 1;
    entry.windowStart = now;
  } else {
    entry.count++;
  }

  rateLimitMap.set(ip, entry);
  return entry.count <= RATE_LIMIT;
}

// ============================================================
// Delegation — data fetchers per agent
// ============================================================

/**
 * Fetches context data from the target agent's domain.
 * Returns a string of data that can be injected into the prompt.
 */
async function fetchAgentData(agentName, query) {
  try {
    switch (agentName) {
      case 'intelligence': {
        const heatScores = await getAllHeatScores();
        const today = new Date().toISOString().split('T')[0];
        let dailyReport = null;
        try { dailyReport = await getIntelligenceForDate(today); } catch { /* may not exist */ }
        return `ציוני חום נוכחיים:\n${JSON.stringify(heatScores?.slice(0, 10), null, 2)}\n\nדוח יומי:\n${dailyReport ? JSON.stringify(dailyReport.topEvents?.slice(0, 5), null, 2) : 'אין דוח יומי'}`;
      }

      case 'finance': {
        const weekStart = getCurrentWeekStart();
        let weeklyReport = null;
        try { weeklyReport = await getWeeklyReport(weekStart); } catch { /* may not exist */ }
        let channels = null;
        try { channels = await getChannelPerformance(); } catch { /* ignore */ }
        let alerts = null;
        try { alerts = await getFinanceAlerts(); } catch { /* ignore */ }
        return `דוח שבועי:\n${weeklyReport ? JSON.stringify(weeklyReport.executiveSummary, null, 2) : 'אין דוח'}\n\nערוצים:\n${channels ? JSON.stringify(channels.slice(0, 5), null, 2) : 'אין'}\n\nהתראות:\n${alerts ? JSON.stringify(alerts.slice(0, 5), null, 2) : 'אין'}`;
      }

      case 'creative': {
        const approvals = await listPendingApprovals();
        return `מודעות ממתינות:\n${JSON.stringify(approvals?.slice(0, 3), null, 2)}`;
      }

      case 'scout': {
        let scan = null;
        try { scan = await proactiveScan(); } catch { /* ignore */ }
        return `סריקה פרואקטיבית:\n${scan ? JSON.stringify(scan.suggestions?.slice(0, 5), null, 2) : 'אין נתוני סריקה'}`;
      }

      case 'cmo': {
        let biReport = null;
        try { biReport = await generateBIReport(); } catch { /* ignore */ }
        return `דוח BI:\n${biReport ? JSON.stringify({ totalItems: biReport.totalItems, insights: biReport.insights?.slice(0, 3) }, null, 2) : 'אין דוח'}`;
      }

      case 'meta': {
        let campaigns = null;
        try { campaigns = await listPublishedCampaigns(); } catch { /* ignore */ }
        let tokenStatus = null;
        try { tokenStatus = await checkTokenValidity(); } catch { /* ignore */ }
        return `קמפיינים:\n${campaigns ? JSON.stringify(campaigns.slice(0, 5), null, 2) : 'אין'}\n\nטוקן:\n${tokenStatus ? JSON.stringify(tokenStatus, null, 2) : 'לא זמין'}`;
      }

      case 'orchestrator': {
        let status = null;
        try { status = await getOrchestratorStatus(); } catch { /* ignore */ }
        let decisions = null;
        try { decisions = await getRecentDecisions(5); } catch { /* ignore */ }
        return `סטטוס מערכת:\n${status ? JSON.stringify(status, null, 2) : 'לא זמין'}\n\nהחלטות אחרונות:\n${decisions ? JSON.stringify(decisions.slice(0, 3), null, 2) : 'אין'}`;
      }

      default:
        return 'אין מידע זמין';
    }
  } catch (error) {
    console.error(`[agent-chat] Error fetching data from ${agentName}:`, error.message);
    return `שגיאה בשליפת מידע מסוכן ה${AGENT_NAMES_HE[agentName] || agentName}`;
  }
}

// ============================================================
// Delegation detection & resolution
// ============================================================

const DELEGATE_REGEX = /\[DELEGATE:(\w+):(.*?)\]/g;

async function resolveDelegations(text) {
  const delegations = [];
  let match;

  while ((match = DELEGATE_REGEX.exec(text)) !== null) {
    delegations.push({ agent: match[1], query: match[2] });
  }

  if (delegations.length === 0) return { resolvedText: text, sources: [] };

  const sources = [];
  let resolvedText = text;

  // Max 1 level of delegation — fetch data only, don't recurse
  for (const d of delegations) {
    if (!AGENT_PROMPTS[d.agent]) continue;

    const data = await fetchAgentData(d.agent, d.query);
    sources.push({
      agent: d.agent,
      description: `מידע מסוכן ה${AGENT_NAMES_HE[d.agent]}`,
    });

    // Remove the delegation marker from text
    resolvedText = resolvedText.replace(`[DELEGATE:${d.agent}:${d.query}]`, '');
  }

  return { resolvedText: resolvedText.trim(), sources, delegationData: delegations.map(d => ({ agent: d.agent, query: d.query })) };
}

// ============================================================
// Claude API call
// ============================================================

async function callClaude(systemPrompt, messages, maxTokens = 2048) {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-20250514',
      max_tokens: maxTokens,
      system: systemPrompt,
      messages,
    }),
  });

  const data = await response.json();

  if (data.type === 'error') {
    throw new Error(`Claude API error: ${data.error?.message || JSON.stringify(data.error)}`);
  }

  const text = data.content?.[0]?.text?.trim();
  if (!text) throw new Error('Claude לא החזיר תוכן');

  return text;
}

// ============================================================
// Main handler
// ============================================================

async function handleAgentChat(req, res) {
  const ip = req.ip || req.connection?.remoteAddress || 'unknown';

  if (!checkRateLimit(ip)) {
    return res.status(429).json({ error: 'יותר מדי בקשות. נסה שוב בעוד דקה.' });
  }

  const { agent, message, conversationHistory = [], context = {} } = req.body;

  if (!agent || !message) {
    return res.status(400).json({ error: 'חובה לשלוח agent ו-message' });
  }

  if (!AGENT_PROMPTS[agent]) {
    return res.status(400).json({ error: `סוכן לא מוכר: ${agent}` });
  }

  try {
    // Detect and save correction patterns from user message
    const memoryResult = processMessage(agent, message);
    if (memoryResult.saved) {
      console.log(`[agent-chat] Memory saved for ${agent}: ${memoryResult.entries} entries`);
    }

    // Build system prompt with memory injection
    const memoryPrompt = buildMemoryPrompt(agent);
    const systemPrompt = AGENT_PROMPTS[agent] + memoryPrompt;

    // Build conversation messages (trim to last 20)
    const trimmedHistory = conversationHistory.slice(-20).map(m => ({
      role: m.role,
      content: m.content,
    }));

    const messages = [
      ...trimmedHistory,
      { role: 'user', content: message },
    ];

    // Add context if available
    if (Object.keys(context).length > 0) {
      const contextStr = Object.entries(context)
        .map(([k, v]) => `${k}: ${v}`)
        .join('\n');
      messages[messages.length - 1].content = `[הקשר נוכחי: ${contextStr}]\n\n${message}`;
    }

    // First Claude call
    let reply = await callClaude(systemPrompt, messages);

    // Check for delegation markers
    const { resolvedText, sources, delegationData } = await resolveDelegations(reply);

    // If delegation happened, make a second call with the fetched data
    if (delegationData && delegationData.length > 0) {
      const delegatedDataParts = [];
      for (const d of delegationData) {
        const data = await fetchAgentData(d.agent, d.query);
        delegatedDataParts.push(`=== מידע מסוכן ה${AGENT_NAMES_HE[d.agent]} ===\n${data}`);
      }

      const enrichedMessages = [
        ...trimmedHistory,
        { role: 'user', content: message },
        { role: 'assistant', content: resolvedText || 'פניתי לסוכנים אחרים לקבלת מידע.' },
        {
          role: 'user',
          content: `הנה המידע שהתקבל מהסוכנים האחרים:\n\n${delegatedDataParts.join('\n\n')}\n\nעכשיו ענה על השאלה המקורית של המשתמש בעברית, וציין מאיפה הגיע המידע.`,
        },
      ];

      reply = await callClaude(systemPrompt, enrichedMessages);
    } else {
      reply = resolvedText;
    }

    res.json({
      reply,
      sources,
      actions: [],
    });
  } catch (error) {
    console.error('[agent-chat] Error:', error.message);
    res.status(500).json({
      error: 'אירעה שגיאה, נסה שוב',
      reply: 'מצטער, אירעה שגיאה בעיבוד הבקשה. נסה שוב.',
      sources: [],
      actions: [],
    });
  }
}

module.exports = { handleAgentChat, processMessage, buildMemoryPrompt };
