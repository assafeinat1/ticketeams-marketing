/**
 * Ticketeams Orchestrator Agent — Main Pipeline Coordinator
 *
 * Connects all existing agents into a unified automated pipeline:
 *   Intelligence → Decision Engine → Action (or Approval Request)
 *   Finance Alerts → Decision Engine → Action (or Approval Request)
 *   Monday.com Approval Board → Execute approved decisions
 *
 * Operating Mode: HYBRID AUTONOMY
 *   Automatic: data collection, scoring, reports, monitoring, alerts
 *   Human approval: creating campaigns, spending money, pausing, budget changes
 *
 * RedRok Security Standard:
 * - Credentials via dotenv — NEVER printed.
 * - sanitizeError() on all errors.
 * - ZERO-DELETION: No DELETE operations on Monday.com.
 * - All campaigns created as PAUSED — human activates.
 *
 * Usage:
 *   node src/agents/orchestrator.js              # selfTest
 *   node src/agents/orchestrator.js --hot-check  # run hot event check
 *   node src/agents/orchestrator.js --perf-check # run performance check
 *   node src/agents/orchestrator.js --setup      # create Monday.com approval board
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const config = require('../config/orchestrator-config.json');
const { mondayQuery, createBoardItem, updateItemColumn, createItemUpdate } = require('../config/monday');
const {
  evaluateHotEvents,
  evaluatePerformanceAlerts,
  evaluateBudgetChanges,
  classifyDecision,
  buildEventKey,
} = require('./decision-engine');

// Existing agents — imported lazily where needed for heavy ones
const { getIntelligenceForDate, getAllHeatScores } = require('./intelligence-agent');
const { getAlerts: getFinanceAlerts } = require('./finance-agent');
const { calculateCampaignROAS, fetchSalesData, fetchMarketingData } = require('./profitability');
const { publishCampaign, pauseCampaign, listPublishedCampaigns, getCampaignStatus, fetchCampaignPerformance, updateMarketingBoardStatus } = require('./meta-publisher');
const { generateCreative, generateCreativeV3 } = require('./creative-agent');
const { saveForApproval } = require('./human-approval');
const { recommendBudget } = require('./budget-recommender');
const { generateLandingPage } = require('./seo-agent');

// ============================================================
// Config
// ============================================================

const CACHE_DIR = path.join(__dirname, '..', 'cache', config.cache.directory);
const COL = config.mondayApprovalBoard.columns;
const STATUS_LABELS = config.mondayApprovalBoard.statusLabels;

// ============================================================
// Helpers
// ============================================================

function sanitizeError(err) {
  const msg = err?.message || String(err);
  return msg.replace(/token[=:]\S+/gi, 'token=[REDACTED]');
}

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function cacheRunSummary(runType, date, data) {
  try {
    ensureCacheDir();
    const safeDate = String(date).replace(/[:.]/g, '-');
    const filePath = path.join(CACHE_DIR, `${runType}-${safeDate}.json`);
    const summary = { runType, date, timestamp: new Date().toISOString(), ...data };
    fs.writeFileSync(filePath, JSON.stringify(summary, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[ORCHESTRATOR] Cache write failed:', sanitizeError(err));
  }
}

/**
 * Archive decisions older than maxAgeDays.
 * Moves pending-*.json files to an 'archived' subfolder.
 * Run summaries (hot-event-check, performance-check) older than maxAgeDays are also archived.
 */
function archiveOldDecisions(maxAgeDays = 7) {
  ensureCacheDir();
  const archiveDir = path.join(CACHE_DIR, 'archived');
  if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true });

  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  const files = fs.readdirSync(CACHE_DIR).filter((f) => f.endsWith('.json'));
  let archivedCount = 0;

  for (const file of files) {
    const filePath = path.join(CACHE_DIR, file);
    try {
      const stat = fs.statSync(filePath);
      if (stat.mtimeMs < cutoff) {
        fs.renameSync(filePath, path.join(archiveDir, file));
        archivedCount++;
      }
    } catch { /* skip */ }
  }

  if (archivedCount > 0) {
    console.log(`[ORCHESTRATOR] Archived ${archivedCount} decisions older than ${maxAgeDays} days`);
  }
  return archivedCount;
}

function cacheApprovalRequest(decision) {
  try {
    ensureCacheDir();
    const id = `pending-${Date.now()}`;
    const filePath = path.join(CACHE_DIR, `${id}.json`);
    const record = {
      id,
      status: 'pending',
      createdAt: new Date().toISOString(),
      decision,
    };
    fs.writeFileSync(filePath, JSON.stringify(record, null, 2), 'utf-8');
    console.log(`[ORCHESTRATOR] אישור נשמר מקומית: ${id}`);
    return { cachedId: id, filePath };
  } catch (err) {
    console.warn('[ORCHESTRATOR] Cache approval failed:', sanitizeError(err));
    return { cachedId: null, error: sanitizeError(err) };
  }
}

// ============================================================
// Monday.com Approval Board — Setup
// ============================================================

/**
 * Creates the Monday.com approval board with all required columns.
 * Call via: POST /api/orchestrator/setup-board
 */
async function setupApprovalBoard() {
  console.log('[ORCHESTRATOR] יוצר לוח אישורים ב-Monday.com...');

  // Step 1: Create board
  const boardData = await mondayQuery(`
    mutation {
      create_board(board_name: "Orchestrator Approvals — AI Engine", board_kind: public) {
        id
      }
    }
  `);
  const boardId = boardData.create_board.id;
  console.log(`[ORCHESTRATOR] לוח נוצר: ${boardId}`);

  // Step 2: Create group
  await mondayQuery(`
    mutation {
      create_group(board_id: ${boardId}, group_name: "orchestrator_approvals") {
        id
      }
    }
  `);

  // Step 3: Create columns
  const columns = [
    { title: 'סוג החלטה', type: 'text' },
    { title: 'אירוע', type: 'text' },
    { title: 'Heat Score', type: 'numbers' },
    { title: 'תקציב מוצע', type: 'numbers' },
    { title: 'ROAS', type: 'numbers' },
    { title: 'טרגוט', type: 'text' },
    { title: 'מקור', type: 'text' },
    { title: 'סיבה', type: 'long_text' },
    { title: 'נוצר ב-', type: 'date' },
    { title: 'הוחלט ב-', type: 'date' },
    { title: 'JSON החלטה', type: 'long_text' },
  ];

  const createdColumns = [];
  for (const col of columns) {
    const safeTitle = col.title.replace(/"/g, '\\"');
    const result = await mondayQuery(`
      mutation {
        create_column(board_id: ${boardId}, title: "${safeTitle}", column_type: ${col.type}) {
          id
          title
        }
      }
    `);
    createdColumns.push(result.create_column);
  }

  console.log('[ORCHESTRATOR] === לוח אישורים נוצר בהצלחה ===');
  console.log(`Board ID: ${boardId}`);
  console.log('עמודות:', createdColumns.map((c) => `${c.title} (${c.id})`).join(', '));
  console.log('\nעדכן את orchestrator-config.json:');
  console.log(`  "boardId": ${boardId}`);
  console.log('\nוהגדר webhook ב-Monday.com לכתובת:');
  console.log('  POST /webhook (אותו webhook קיים)');

  return {
    boardId,
    columns: createdColumns,
    instructions: `עדכן boardId ל-${boardId} ב-orchestrator-config.json`,
  };
}

// ============================================================
// Approval Request — Create on Monday.com
// ============================================================

/**
 * Creates an approval request item on the Monday.com board.
 * Falls back to local cache if board not configured.
 */
async function createApprovalRequest(decision) {
  const boardId = config.mondayApprovalBoard.boardId;

  if (!boardId) {
    console.warn('[ORCHESTRATOR] לוח אישורים לא מוגדר — שומר מקומית');
    return cacheApprovalRequest(decision);
  }

  try {
    const eventName = decision.event
      ? `${decision.event.homeTeam} vs ${decision.event.awayTeam}`
      : decision.campaign?.name || 'Unknown';

    const columnValues = {};
    columnValues[COL.approvalType] = decision.type;
    columnValues[COL.eventName] = eventName;
    if (decision.event?.score) {
      columnValues[COL.heatScore] = String(decision.event.score);
    }
    if (decision.suggestedAction?.suggestedBudgetILS) {
      columnValues[COL.suggestedBudget] = String(decision.suggestedAction.suggestedBudgetILS);
    }
    if (decision.campaign?.roas) {
      columnValues[COL.roas] = String(decision.campaign.roas);
    }
    if (decision.suggestedAction?.targeting) {
      columnValues[COL.targeting] = decision.suggestedAction.targeting;
    }
    columnValues[COL.agentSource] = 'Orchestrator';
    columnValues[COL.reason] = { text: decision.suggestedAction?.reasoning || '' };
    columnValues[COL.createdAt] = { date: new Date().toISOString().split('T')[0] };
    columnValues[COL.decisionJson] = { text: JSON.stringify(decision, null, 2) };

    const item = await createBoardItem(
      boardId,
      config.mondayApprovalBoard.groupId,
      `[${decision.type}] ${eventName}`,
      columnValues
    );

    console.log(`[ORCHESTRATOR] בקשת אישור נוצרה — Monday item ${item.id}`);

    // Also cache locally as backup
    cacheApprovalRequest({ ...decision, mondayItemId: item.id });

    return { mondayItemId: item.id, decision };
  } catch (error) {
    console.error('[ORCHESTRATOR] שגיאה ביצירת בקשת אישור:', sanitizeError(error));
    return cacheApprovalRequest(decision);
  }
}

// ============================================================
// Execute Decision — Dispatch to Agents
// ============================================================

/**
 * Execute an approved or auto-approved decision.
 */
async function executeDecision(decision) {
  try {
    switch (decision.type) {
      case 'CREATE_CAMPAIGN': {
        const event = decision.event;
        if (!event || !event.homeTeam || !event.awayTeam) {
          return { success: false, reason: 'חסרים פרטי אירוע' };
        }

        console.log(`[ORCHESTRATOR] יוצר קמפיין: ${event.homeTeam} vs ${event.awayTeam}`);

        // Step 1: Generate creative
        const creative = await generateCreativeV3({
          homeTeam: event.homeTeam,
          awayTeam: event.awayTeam,
          competition: event.competition || 'Auto-detected',
          date: event.date || new Date().toISOString().split('T')[0],
          event_type: 'football',
        });

        // Step 2: Save for approval (file-based — required by publishCampaign)
        const matchKey = decision.suggestedAction?.matchKey || buildEventKey(event);
        const pricingReport = {
          homeTeam: event.homeTeam,
          awayTeam: event.awayTeam,
          competition: event.competition,
          date: event.date,
          heatScore: event.score,
          suggestedBudget: decision.suggestedAction?.suggestedBudgetILS,
          source: 'orchestrator',
        };
        saveForApproval(matchKey, creative, pricingReport);

        // Step 3: Publish campaign (PAUSED)
        const publishResult = await publishCampaign(matchKey, {
          dailyBudgetILS: decision.suggestedAction?.suggestedBudgetILS || config.budgetDefaults.baseDailyBudget,
        });

        console.log(`[ORCHESTRATOR] קמפיין נוצר (PAUSED): ${publishResult.campaignId || 'N/A'}`);
        return { success: true, type: 'CREATE_CAMPAIGN', campaignId: publishResult.campaignId, matchKey };
      }

      case 'PAUSE_CAMPAIGN': {
        const campaignId = decision.suggestedAction?.campaignId || decision.campaign?.campaignId;
        if (!campaignId) {
          console.log('[ORCHESTRATOR] אין campaignId — רושם המלצת השהייה בלבד');
          return { success: true, type: 'PAUSE_CAMPAIGN', logged: true, reason: 'אין campaign ID — רושם המלצה' };
        }

        console.log(`[ORCHESTRATOR] משהה קמפיין: ${campaignId}`);
        await pauseCampaign(campaignId);
        return { success: true, type: 'PAUSE_CAMPAIGN', paused: true, campaignId };
      }

      case 'INCREASE_BUDGET':
      case 'REDUCE_BUDGET': {
        // Budget changes are logged as recommendations — manual action in Ads Manager
        const campaignName = decision.campaign?.name || 'Unknown';
        const action = decision.suggestedAction?.action || decision.type;
        console.log(`[ORCHESTRATOR] המלצת תקציב: ${action} עבור ${campaignName}`);
        return {
          success: true,
          type: decision.type,
          logged: true,
          campaignName,
          suggestedBudget: decision.suggestedAction?.suggestedBudgetILS,
          reason: 'שינוי תקציב דורש פעולה ידנית ב-Ads Manager',
        };
      }

      case 'BOOST_CAMPAIGN': {
        const campaignName = decision.existingCampaign?.matchKey || 'Unknown';
        console.log(`[ORCHESTRATOR] המלצת הגדלה: ${campaignName}`);
        return {
          success: true,
          type: 'BOOST_CAMPAIGN',
          logged: true,
          campaignName,
          reason: 'חידוש והגדלת קמפיין דורש פעולה ידנית ב-Ads Manager',
        };
      }

      default:
        return { success: false, reason: `סוג החלטה לא מוכר: ${decision.type}` };
    }
  } catch (error) {
    console.error(`[ORCHESTRATOR] שגיאה בביצוע ${decision.type}:`, sanitizeError(error));
    return { success: false, error: sanitizeError(error) };
  }
}

// ============================================================
// Monday.com Approval Webhook Handler
// ============================================================

/**
 * Handle status change on the approval board.
 * Called from webhook-server.js when approval board webhook fires.
 */
async function handleApprovalWebhook(event) {
  const itemId = event.pulseId;
  const newStatus = event.value?.label?.text || event.value?.value;

  console.log(`[ORCHESTRATOR] Approval webhook — item ${itemId}, status: ${newStatus}`);

  if (newStatus === STATUS_LABELS.approved) {
    // Fetch the item to get the decision JSON
    try {
      const data = await mondayQuery(`query { items(ids: [${itemId}]) { name column_values { id text value } } }`);
      const item = data.items?.[0];

      if (!item) {
        console.error(`[ORCHESTRATOR] פריט ${itemId} לא נמצא`);
        return;
      }

      // Extract decision JSON from the long_text column
      const decisionCol = item.column_values.find((c) => c.id === COL.decisionJson);
      const decisionText = decisionCol?.text || '';

      if (!decisionText) {
        console.error('[ORCHESTRATOR] אין JSON החלטה בפריט');
        await createItemUpdate(itemId, '❌ שגיאה: אין JSON החלטה בפריט');
        return;
      }

      const decision = JSON.parse(decisionText);
      console.log(`[ORCHESTRATOR] מבצע החלטה מאושרת: ${decision.type}`);

      const result = await executeDecision(decision);

      // Update Monday item with execution result
      const boardId = config.mondayApprovalBoard.boardId;
      if (boardId) {
        await updateItemColumn(boardId, itemId, {
          [COL.decidedAt]: { date: new Date().toISOString().split('T')[0] },
        }).catch(() => {});
      }

      const resultSummary = result.success
        ? `בוצע בהצלחה: ${result.type || decision.type}${result.campaignId ? ` (Campaign: ${result.campaignId})` : ''}`
        : `שגיאה: ${result.reason || result.error}`;

      await createItemUpdate(itemId, resultSummary);
      console.log(`[ORCHESTRATOR] תוצאה: ${resultSummary}`);
    } catch (error) {
      console.error('[ORCHESTRATOR] שגיאה בביצוע החלטה מאושרת:', sanitizeError(error));
      await createItemUpdate(itemId, `שגיאה בביצוע: ${sanitizeError(error)}`).catch(() => {});
    }
  } else if (newStatus === STATUS_LABELS.rejected) {
    console.log(`[ORCHESTRATOR] החלטה נדחתה — item ${itemId}`);
    await createItemUpdate(itemId, 'נדחה — לא בוצעה פעולה').catch(() => {});
  }
}

// ============================================================
// Hot Event Check — Daily Orchestration
// ============================================================

/**
 * Runs after intelligence scan. Gets heat scores, runs decision engine,
 * creates approval requests or auto-executes.
 */
async function runHotEventCheck() {
  const today = new Date().toISOString().split('T')[0];
  console.log(`\n[ORCHESTRATOR] === Hot Event Check — ${today} ===`);
  const startTime = Date.now();

  try {
    // 0. Housekeeping — archive old decisions
    archiveOldDecisions(7);

    // 1. Get latest intelligence data
    const heatScores = await getAllHeatScores();

    if (!heatScores || heatScores.length === 0) {
      console.log('[ORCHESTRATOR] אין אירועים מדורגים — מסיים');
      return { date: today, decisions: [], actions: [], durationMs: Date.now() - startTime };
    }

    console.log(`[ORCHESTRATOR] ${heatScores.length} אירועים מדורגים`);

    // 2. Get existing campaigns
    const existingCampaigns = listPublishedCampaigns();
    console.log(`[ORCHESTRATOR] ${existingCampaigns.length} קמפיינים קיימים`);

    // 3. Decision engine
    const decisions = evaluateHotEvents(heatScores, existingCampaigns);
    console.log(`[ORCHESTRATOR] ${decisions.length} החלטות מהמנוע`);

    // 4. Process decisions
    const actions = [];
    for (const decision of decisions) {
      const classification = classifyDecision(decision);
      decision.classification = classification;

      if (classification === 'auto') {
        // Auto-generate creative for hot events with CREATE_CAMPAIGN
        if (decision.type === 'CREATE_CAMPAIGN' && decision.event) {
          const event = decision.event;
          try {
            console.log(`[ORCHESTRATOR] אוטומטי — יוצר קריאייטיב: ${event.homeTeam} vs ${event.awayTeam}`);
            const creative = await generateCreative(
              event.homeTeam,
              event.awayTeam,
              event.competition || 'Auto-detected',
              event.date || today,
            );
            const matchKey = decision.suggestedAction?.matchKey || buildEventKey(event);
            saveForApproval(matchKey, creative, {
              homeTeam: event.homeTeam,
              awayTeam: event.awayTeam,
              competition: event.competition,
              date: event.date,
              heatScore: event.score,
              suggestedBudget: decision.suggestedAction?.suggestedBudgetILS,
              source: 'orchestrator-auto',
            });
            actions.push({ decision, executedAutomatically: true, result: { creativeGenerated: true, matchKey } });
            console.log(`[ORCHESTRATOR] קריאייטיב נוצר ונשמר לאישור: ${matchKey}`);

            // SEO: Auto-create landing page for hot events (non-blocking)
            try {
              const seoResult = await generateLandingPage({
                homeTeam: event.homeTeam,
                awayTeam: event.awayTeam,
                competition: event.competition || '',
                gameDate: event.date || today,
                heatScore: event.score,
              });
              if (seoResult.success) {
                console.log(`[ORCHESTRATOR] SEO דף נחיתה נוצר: ${seoResult.title} (${seoResult.cached ? 'cached' : 'new'})`);
              } else {
                console.log(`[ORCHESTRATOR] SEO דף נחיתה לא נוצר: ${seoResult.reason}`);
              }
            } catch (seoErr) {
              console.warn(`[ORCHESTRATOR] SEO landing page error (non-blocking):`, sanitizeError(seoErr));
            }
          } catch (creativeError) {
            console.error(`[ORCHESTRATOR] שגיאה ביצירת קריאייטיב אוטומטי:`, sanitizeError(creativeError));
            actions.push({ decision, executedAutomatically: true, result: { logged: true, creativeError: sanitizeError(creativeError) } });
          }
        } else {
          actions.push({ decision, executedAutomatically: true, result: { logged: true } });
          console.log(`[ORCHESTRATOR] אוטומטי: ${decision.type} — ${decision.event?.homeTeam || ''} vs ${decision.event?.awayTeam || ''}`);
        }
      } else {
        const approvalItem = await createApprovalRequest(decision);
        actions.push({ decision, approvalItem, executedAutomatically: false });
        console.log(`[ORCHESTRATOR] לאישור: ${decision.type} — ${decision.event?.homeTeam || ''} vs ${decision.event?.awayTeam || ''}`);

        // SEO: Auto-create landing page for approval-required CREATE_CAMPAIGN too (drafts are safe)
        if (decision.type === 'CREATE_CAMPAIGN' && decision.event) {
          try {
            const seoResult = await generateLandingPage({
              homeTeam: decision.event.homeTeam,
              awayTeam: decision.event.awayTeam,
              competition: decision.event.competition || '',
              gameDate: decision.event.date || today,
              heatScore: decision.event.score,
            });
            if (seoResult.success) {
              console.log(`[ORCHESTRATOR] SEO דף נחיתה נוצר: ${seoResult.title} (${seoResult.cached ? 'cached' : 'new'})`);
            }
          } catch (seoErr) {
            console.warn(`[ORCHESTRATOR] SEO landing page error (non-blocking):`, sanitizeError(seoErr));
          }
        }
      }
    }

    const durationMs = Date.now() - startTime;
    cacheRunSummary('hot-event-check', today, { decisionsCount: decisions.length, actions });

    const autoCount = actions.filter((a) => a.executedAutomatically).length;
    console.log(`[ORCHESTRATOR] === Hot Event Check Complete — ${decisions.length} decisions, ${autoCount} auto, ${durationMs}ms ===\n`);

    return { date: today, decisions, actions, durationMs };
  } catch (error) {
    console.error('[ORCHESTRATOR] שגיאה ב-Hot Event Check:', sanitizeError(error));
    return { date: today, decisions: [], actions: [], error: sanitizeError(error), durationMs: Date.now() - startTime };
  }
}

// ============================================================
// Campaign Status Sync — Check Meta and Update Monday.com
// ============================================================

/**
 * Check each published campaign's status via Meta API.
 * If status changed (e.g. PAUSED → ACTIVE), update Monday.com Marketing Board.
 * For ACTIVE campaigns, also fetch performance insights (impressions, clicks, spend).
 *
 * Returns enriched status updates with insights for smart alert evaluation.
 */
async function syncCampaignStatuses() {
  const campaigns = listPublishedCampaigns();
  const statusUpdates = [];

  for (const campaign of campaigns) {
    if (!campaign.campaignId) continue;

    try {
      // Fetch status + insights (insights only for ACTIVE campaigns)
      const perfData = await fetchCampaignPerformance(campaign.campaignId);
      const effectiveStatus = perfData.effective_status || perfData.status;

      // Read cache file for extra data
      const sanitizedKey = (campaign.matchKey || '').replace(/[^a-zA-Z0-9._-]/g, '_');
      const cacheFile = path.join(__dirname, '..', 'cache', 'meta-publish', `${sanitizedKey}.json`);
      let mondayItemId = null;
      let dailyBudget = 100;
      let activatedAt = null;

      if (fs.existsSync(cacheFile)) {
        const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
        mondayItemId = cached.mondayItemId;
        dailyBudget = cached.dailyBudgetILS || 100;
        activatedAt = cached.activatedAt;

        // Update cache with current status + insights
        const statusChanged = effectiveStatus && effectiveStatus !== cached.status;
        if (statusChanged) {
          console.log(`[ORCHESTRATOR] Campaign ${campaign.campaignId}: ${cached.status} → ${effectiveStatus}`);
          cached.status = effectiveStatus;
          // Track when campaign was first activated
          if (effectiveStatus === 'ACTIVE' && !cached.activatedAt) {
            cached.activatedAt = new Date().toISOString();
            activatedAt = cached.activatedAt;
          }
        }
        cached.lastStatusCheck = new Date().toISOString();

        // Save insights if available
        if (perfData.insights) {
          cached.lastInsights = perfData.insights;
          cached.lastInsightsAt = new Date().toISOString();
          console.log(`[ORCHESTRATOR] Insights ${campaign.campaignId}: ${perfData.insights.impressions} imp, ${perfData.insights.clicks} clicks, ₪${perfData.insights.spend.toFixed(0)} spend`);
        }

        fs.writeFileSync(cacheFile, JSON.stringify(cached, null, 2), 'utf-8');
      }

      // Update Monday.com if status changed or insights available
      const statusChanged = effectiveStatus && effectiveStatus !== campaign.status;
      if (mondayItemId && (statusChanged || perfData.insights)) {
        const mondayUpdates = {};
        if (statusChanged) mondayUpdates.status = effectiveStatus;
        if (perfData.insights && perfData.insights.spend > 0 && perfData.insights.leads > 0) {
          // Rough ROAS: avg ₪200/lead assumed
          mondayUpdates.roiMeta = Math.round((perfData.insights.leads * 200) / perfData.insights.spend * 10) / 10;
        }
        await updateMarketingBoardStatus(mondayItemId, mondayUpdates);
      }

      // Calculate hours active
      let hoursActive = 0;
      if (activatedAt) {
        hoursActive = Math.round((Date.now() - new Date(activatedAt).getTime()) / (1000 * 60 * 60));
      }

      statusUpdates.push({
        campaignId: campaign.campaignId,
        campaignName: campaign.campaignName,
        matchKey: campaign.matchKey,
        previousStatus: campaign.status,
        newStatus: effectiveStatus,
        statusChanged: statusChanged || false,
        mondayUpdated: !!mondayItemId,
        insights: perfData.insights || null,
        dailyBudget,
        hoursActive,
        roas: null, // Will be set from finance data if available
      });
    } catch (err) {
      console.warn(`[ORCHESTRATOR] Status check failed for ${campaign.campaignId}: ${sanitizeError(err)}`);
    }
  }

  return statusUpdates;
}

// ============================================================
// Smart Alerts — Campaign Performance Monitoring
// ============================================================

/**
 * Evaluate campaign statuses + insights and generate smart alerts.
 * Called from runPerformanceCheck() after syncCampaignStatuses().
 *
 * Alert rules:
 *   1. Budget burning too fast (80%+ spent before noon UTC)
 *   2. Zero impressions after 6+ hours active
 *   3. ROAS < 1.0 → losing money (if finance data available)
 *   4. ROAS ≥ 5.0 → excellent, suggest budget increase
 */
function evaluateSmartAlerts(campaignStatuses) {
  const alerts = [];
  const now = new Date();
  const currentHourUTC = now.getUTCHours();
  const thresholds = config.decisionRules.thresholds;

  for (const cs of campaignStatuses) {
    // Only evaluate ACTIVE campaigns with insights
    if (cs.newStatus !== 'ACTIVE') continue;

    // Alert 1: Budget burning too fast (80%+ spent before noon UTC)
    if (cs.insights && currentHourUTC < thresholds.budgetBurnBeforeHourUTC) {
      const spendPct = cs.dailyBudget > 0 ? (cs.insights.spend / cs.dailyBudget) * 100 : 0;
      if (spendPct >= thresholds.budgetBurnPctAlert) {
        alerts.push({
          type: 'ALERT_ONLY',
          requiresApproval: false,
          priority: 'high',
          alertCategory: 'budget_burn',
          campaign: { name: cs.campaignName, campaignId: cs.campaignId },
          suggestedAction: {
            action: 'alert',
            reasoning: `תקציב נגמר מהר — ₪${cs.insights.spend.toFixed(0)} מתוך ₪${cs.dailyBudget} (${Math.round(spendPct)}%) לפני הצהריים`,
          },
        });
      }
    }

    // Alert 2: Zero impressions after 6+ hours active
    if (cs.insights && cs.insights.impressions === 0 && cs.hoursActive >= thresholds.zeroImpressionsAfterHours) {
      alerts.push({
        type: 'ALERT_ONLY',
        requiresApproval: false,
        priority: 'critical',
        alertCategory: 'zero_impressions',
        campaign: { name: cs.campaignName, campaignId: cs.campaignId },
        suggestedAction: {
          action: 'alert',
          reasoning: `מודעה לא רצה — 0 חשיפות אחרי ${cs.hoursActive} שעות פעילות`,
        },
      });
    }

    // Alert 3: ROAS below 1.0 → losing money
    if (cs.roas !== null && cs.roas !== undefined && cs.roas < thresholds.roasPauseThreshold) {
      alerts.push({
        type: 'PAUSE_CAMPAIGN',
        requiresApproval: true,
        priority: 'critical',
        alertCategory: 'low_roas',
        campaign: { name: cs.campaignName, roas: cs.roas, adSpend: cs.insights?.spend || 0, campaignId: cs.campaignId },
        suggestedAction: {
          action: 'pause',
          reasoning: `הפסד — שקול השהייה — ROAS ${cs.roas}x`,
        },
      });
    }

    // Alert 4: Excellent ROAS (≥5.0) — suggest budget increase
    if (cs.roas !== null && cs.roas !== undefined && cs.roas >= thresholds.roasBoostThreshold) {
      alerts.push({
        type: 'INCREASE_BUDGET',
        requiresApproval: true,
        priority: 'medium',
        alertCategory: 'excellent_roas',
        campaign: { name: cs.campaignName, roas: cs.roas, adSpend: cs.insights?.spend || 0, campaignId: cs.campaignId },
        suggestedAction: {
          action: 'increase_budget',
          reasoning: `ביצוע מצוין — שקול הגדלה — ROAS ${cs.roas}x`,
        },
      });
    }
  }

  return alerts;
}

// ============================================================
// Performance Check — Every 6 Hours
// ============================================================

/**
 * Check campaign performance via finance alerts and ROAS data.
 * Generates pause/reduce/increase budget decisions.
 */
async function runPerformanceCheck() {
  console.log('\n[ORCHESTRATOR] === Performance Check ===');
  const startTime = Date.now();

  try {
    // 0. Campaign status sync — check Meta for status changes + fetch insights
    const statusUpdates = await syncCampaignStatuses().catch((err) => {
      console.warn('[ORCHESTRATOR] Campaign status sync failed:', sanitizeError(err));
      return [];
    });
    const statusChanges = statusUpdates.filter((u) => u.statusChanged);
    const withInsights = statusUpdates.filter((u) => u.insights);
    if (statusChanges.length > 0) {
      console.log(`[ORCHESTRATOR] ${statusChanges.length} campaign status changes synced`);
    }
    if (withInsights.length > 0) {
      console.log(`[ORCHESTRATOR] ${withInsights.length} campaigns with insights data`);
    }

    // 1. Smart alerts — based on Meta insights (budget burn, zero impressions, etc.)
    const smartAlerts = evaluateSmartAlerts(statusUpdates);
    if (smartAlerts.length > 0) {
      console.log(`[ORCHESTRATOR] ${smartAlerts.length} smart alerts generated`);
    }

    // 2. Send email for critical alerts
    for (const alert of smartAlerts) {
      if (alert.priority === 'critical') {
        try {
          const { sendAlertEmail } = require('./orchestrator-scheduler');
          await sendAlertEmail(alert);
          console.log(`[ORCHESTRATOR] Critical alert email sent: ${alert.alertCategory}`);
        } catch (emailErr) {
          console.warn(`[ORCHESTRATOR] Alert email failed: ${sanitizeError(emailErr)}`);
        }
      }
    }

    // 3. Finance alerts
    const alerts = await getFinanceAlerts().catch((err) => {
      console.warn('[ORCHESTRATOR] Finance alerts failed:', sanitizeError(err));
      return [];
    });

    // 4. Campaign ROAS
    const [salesData, marketingData] = await Promise.all([
      fetchSalesData().catch(() => []),
      fetchMarketingData().catch(() => []),
    ]);

    let campaignROAS = { campaigns: [], unattributed: {} };
    if (salesData.length > 0) {
      campaignROAS = calculateCampaignROAS(salesData, marketingData);
    }

    // 5. Decision engine — performance
    const perfDecisions = evaluatePerformanceAlerts(alerts, campaignROAS);

    // 6. Budget recommendations
    const budgetRecs = recommendBudget(campaignROAS);
    const budgetDecisions = evaluateBudgetChanges(budgetRecs);

    // Deduplicate: if both produce a decision for the same campaign, prefer the performance one
    const seenCampaigns = new Set(perfDecisions.map((d) => d.campaign?.name));
    const uniqueBudgetDecisions = budgetDecisions.filter((d) => !seenCampaigns.has(d.campaign?.name));

    // Merge all decisions: smart alerts + performance + budget
    const allDecisions = [...smartAlerts, ...perfDecisions, ...uniqueBudgetDecisions];
    console.log(`[ORCHESTRATOR] ${allDecisions.length} total decisions (${smartAlerts.length} alerts + ${perfDecisions.length} perf + ${uniqueBudgetDecisions.length} budget)`);

    // 7. Process
    const actions = [];
    for (const decision of allDecisions) {
      const classification = classifyDecision(decision);
      decision.classification = classification;

      if (classification === 'auto') {
        actions.push({ decision, executedAutomatically: true, result: { logged: true } });
      } else {
        const approvalItem = await createApprovalRequest(decision);
        actions.push({ decision, approvalItem, executedAutomatically: false });
        console.log(`[ORCHESTRATOR] לאישור: ${decision.type} — ${decision.campaign?.name || ''} (ROAS ${decision.campaign?.roas || 'N/A'}x)`);
      }
    }

    const durationMs = Date.now() - startTime;
    cacheRunSummary('performance-check', new Date().toISOString(), { decisionsCount: allDecisions.length, actions, smartAlertsCount: smartAlerts.length });

    console.log(`[ORCHESTRATOR] === Performance Check Complete — ${allDecisions.length} decisions, ${statusUpdates.length} status syncs, ${smartAlerts.length} alerts, ${durationMs}ms ===\n`);
    return { decisions: allDecisions, actions, statusUpdates, smartAlerts, durationMs };
  } catch (error) {
    console.error('[ORCHESTRATOR] שגיאה ב-Performance Check:', sanitizeError(error));
    return { decisions: [], actions: [], statusUpdates: [], smartAlerts: [], error: sanitizeError(error), durationMs: Date.now() - startTime };
  }
}

// ============================================================
// Public API — Status & Data
// ============================================================

/**
 * Get orchestrator system status.
 */
function getOrchestratorStatus() {
  ensureCacheDir();

  const files = fs.readdirSync(CACHE_DIR).filter((f) => f.endsWith('.json'));
  const pendingCount = files.filter((f) => f.startsWith('pending-')).length;

  let lastRun = null;
  if (files.length > 0) {
    try {
      const latest = files.sort().reverse()[0];
      const data = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, latest), 'utf-8'));
      lastRun = data.timestamp || data.createdAt || null;
    } catch {}
  }

  return {
    status: 'active',
    approvalBoardConfigured: !!config.mondayApprovalBoard.boardId,
    approvalBoardId: config.mondayApprovalBoard.boardId,
    pendingApprovals: pendingCount,
    cachedDecisions: files.length,
    lastRun,
    scheduling: config.scheduling,
    thresholds: config.decisionRules.thresholds,
  };
}

/**
 * Get recent decisions from cache.
 * Normalizes both pending-approval files and run-summary files into a
 * flat OrchestratorDecision shape the dashboard expects:
 *   { id, type, priority, requiresApproval, event?, campaign?, suggestedAction, status, createdAt }
 */
function getRecentDecisions(limit = 20) {
  ensureCacheDir();

  const thirtyDaysAgo = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const files = fs.readdirSync(CACHE_DIR)
    .filter((f) => {
      if (!f.endsWith('.json')) return false;
      try {
        const stat = fs.statSync(path.join(CACHE_DIR, f));
        return stat.mtimeMs >= thirtyDaysAgo;
      } catch { return true; }
    })
    .sort()
    .reverse();

  const normalized = [];

  for (const f of files) {
    if (normalized.length >= limit) break;

    let raw;
    try {
      raw = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, f), 'utf-8'));
    } catch {
      continue;
    }

    // Case 1: Pending approval file — { id, status, createdAt, decision: { type, event, ... } }
    if (raw.id && raw.decision) {
      const d = raw.decision;
      normalized.push({
        id: raw.id,
        cachedId: raw.id,
        type: d.type || 'UNKNOWN',
        priority: d.priority || 'medium',
        requiresApproval: true,
        event: d.event || null,
        campaign: d.campaign || null,
        suggestedAction: d.suggestedAction || { action: d.type, reasoning: '' },
        status: raw.status || 'pending',
        createdAt: raw.createdAt || raw.timestamp || null,
      });
      continue;
    }

    // Case 2: Run summary file — { runType, actions: [{ decision, executedAutomatically, result }] }
    if (raw.runType && Array.isArray(raw.actions)) {
      for (const action of raw.actions) {
        if (normalized.length >= limit) break;
        const d = action.decision;
        if (!d) continue;
        normalized.push({
          id: `${raw.runType}-${raw.date || raw.timestamp}-${d.type}-${d.event?.homeTeam || d.campaign?.name || ''}`.replace(/\s+/g, '_'),
          type: d.type || 'UNKNOWN',
          priority: d.priority || 'medium',
          requiresApproval: !action.executedAutomatically,
          event: d.event || null,
          campaign: d.campaign || null,
          suggestedAction: d.suggestedAction || { action: d.type, reasoning: '' },
          status: action.executedAutomatically ? 'auto_executed' : (action.approvalItem ? 'pending_approval' : 'logged'),
          createdAt: raw.timestamp || raw.date || null,
        });
      }
      continue;
    }

    // Case 3: Already flat (future-proofing) — pass through if it has type
    if (raw.type && raw.suggestedAction) {
      normalized.push({
        id: raw.id || f.replace('.json', ''),
        type: raw.type,
        priority: raw.priority || 'medium',
        requiresApproval: raw.requiresApproval ?? false,
        event: raw.event || null,
        campaign: raw.campaign || null,
        suggestedAction: raw.suggestedAction,
        status: raw.status || 'unknown',
        createdAt: raw.createdAt || raw.timestamp || null,
      });
    }
  }

  return normalized;
}

// ============================================================
// Self-test
// ============================================================

async function selfTest() {
  console.log('=== Orchestrator Agent — בדיקה עצמית ===\n');

  console.log('Config:');
  console.log(`  Approval Board: ${config.mondayApprovalBoard.boardId || 'NOT SET (יש להריץ --setup)'}`);
  console.log(`  Hot Event Min Score: ${config.decisionRules.thresholds.createCampaignMinScore}`);
  console.log(`  ROAS Pause Threshold: ${config.decisionRules.thresholds.roasPauseThreshold}x`);
  console.log(`  ROAS Boost Threshold: ${config.decisionRules.thresholds.roasBoostThreshold}x`);
  console.log(`  Base Daily Budget: ₪${config.budgetDefaults.baseDailyBudget}`);
  console.log(`  Cache Dir: ${CACHE_DIR}`);

  console.log('\nScheduling:');
  console.log(`  Hot Event Check: ${config.scheduling.hotEventCheck} (04:15 UTC / 07:15 IST)`);
  console.log(`  Performance Monitor: ${config.scheduling.performanceMonitor} (every 6 hours)`);

  console.log('\nModule imports:');
  console.log('  decision-engine: ✓');
  console.log('  intelligence-agent: ✓');
  console.log('  finance-agent: ✓');
  console.log('  profitability: ✓');
  console.log('  meta-publisher: ✓');
  console.log('  creative-agent: ✓');
  console.log('  human-approval: ✓');
  console.log('  budget-recommender: ✓');
  console.log('  monday (createBoardItem + updateItemColumn): ✓');

  const status = getOrchestratorStatus();
  console.log(`\nStatus: ${status.cachedDecisions} cached decisions, ${status.pendingApprovals} pending approvals`);

  console.log('\n=== Orchestrator Agent — מוכן ===');
}

module.exports = {
  runHotEventCheck,
  runPerformanceCheck,
  executeDecision,
  handleApprovalWebhook,
  createApprovalRequest,
  getOrchestratorStatus,
  getRecentDecisions,
  setupApprovalBoard,
  archiveOldDecisions,
  syncCampaignStatuses,
  evaluateSmartAlerts,
};

if (require.main === module) {
  const arg = process.argv[2];

  if (arg === '--hot-check') {
    runHotEventCheck()
      .then((r) => console.log(`Decisions: ${r.decisions.length}, Duration: ${r.durationMs}ms`))
      .catch((e) => console.error('Hot check failed:', sanitizeError(e)));
  } else if (arg === '--perf-check') {
    runPerformanceCheck()
      .then((r) => console.log(`Decisions: ${r.decisions.length}, Duration: ${r.durationMs}ms`))
      .catch((e) => console.error('Perf check failed:', sanitizeError(e)));
  } else if (arg === '--setup') {
    setupApprovalBoard()
      .then((r) => console.log('Board created:', JSON.stringify(r, null, 2)))
      .catch((e) => console.error('Setup failed:', sanitizeError(e)));
  } else {
    selfTest().catch((e) => console.error('selfTest failed:', sanitizeError(e)));
  }
}
