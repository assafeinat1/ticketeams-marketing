require('dotenv').config();
const express = require('express');
const cron = require('node-cron');
const { mondayQuery, uploadDailyAdReport } = require('./config/monday');
const { getMatchPricing, buildMatchKey, scoreDemand, proactiveScan, getStockStatus } = require('./agents/scout-agent');
const { generatePricingReport, decideCounterAd, generateBIReport, triggerRimaCampaign } = require('./agents/cmo-agent');
const { generateCreative, generateCreativeV3 } = require('./agents/creative-agent');
const { saveForApproval, loadPendingApproval, listPendingApprovals, approveVersion, sanitizeMatchKey } = require('./agents/human-approval');
const { monitorCompetitorAds, fetchActiveAds, extractMatchInfo, classifyAdFormat, filterAds, COMPETITOR_PAGES } = require('./agents/ad-monitor-agent');
const { runDailyIntelligence, getIntelligenceForDate, getHeatScoreForEvent, getAllHeatScores, triggerManualScan } = require('./agents/intelligence-agent');
const { sendReport } = require('./agents/intelligence-report');
const {
  runWeeklyFinance, getWeeklyReport, getEventProfitability,
  getCampaignProfitability, getChannelPerformance,
  getBudgetRecommendation, getEventBudgetRecommendation,
  getAlerts: getFinanceAlerts, getCurrentWeekStart,
} = require('./agents/finance-agent');
const { sendFinanceReport } = require('./agents/finance-report');
const { publishCampaign, getCampaignStatus, pauseCampaign, listPublishedCampaigns, uploadAdImage } = require('./agents/meta-publisher');
const { tokenHealthCheck, checkTokenValidity, refreshToken } = require('./agents/token-manager');
const { metaGet, getAdAccountId } = require('./agents/meta-api-client');
const {
  runHotEventCheck, runPerformanceCheck, getOrchestratorStatus,
  getRecentDecisions, handleApprovalWebhook, setupApprovalBoard, executeDecision,
} = require('./agents/orchestrator');
const { initScheduler: initOrchestratorScheduler, sendDailySummary } = require('./agents/orchestrator-scheduler');
const orchestratorConfig = require('./config/orchestrator-config.json');
const { handleAgentChat } = require('./chat/agent-chat-router');
const { getAgentMemory, addMemoryEntry, deleteMemoryEntry } = require('./chat/agent-memory');
const { saveStyleFeedback, getStyleMemory, getGallery } = require('./chat/style-memory');
const { generateLandingPage, generateBlogPost, getExistingContent, getSitemapHealth, listCreatedContent } = require('./agents/seo-agent');

const path = require('path');
const logger = require('./utils/logger');

const app = express();
const SERVER_START_TIME = Date.now();
const PORT = process.env.WEBHOOK_PORT || 3000;
const BOARD_ID = process.env.MONDAY_BOARD_ID;

app.use(express.json());

// הגשת קבצי Dashboard כקבצים סטטיים
app.use('/dashboard', express.static(path.join(__dirname, 'dashboard')));

// הגשת תמונות מודעות שנוצרו
app.use('/api/creative/images', express.static(path.join(__dirname, 'generated-ads')));

// ============================================================
// GET /health — בדיקת בריאות מפורטת
// ============================================================
app.get('/health', async (req, res) => {
  const uptimeSec = Math.floor((Date.now() - SERVER_START_TIME) / 1000);
  const hours = Math.floor(uptimeSec / 3600);
  const minutes = Math.floor((uptimeSec % 3600) / 60);

  // Agent module checks
  const agents = {};
  const agentModules = {
    scout: './agents/scout-agent',
    intelligence: './agents/intelligence-agent',
    creative: './agents/creative-agent',
    finance: './agents/finance-agent',
    cmo: './agents/cmo-agent',
    meta_publisher: './agents/meta-publisher',
    orchestrator: './agents/orchestrator',
    seo: './agents/seo-agent',
  };
  for (const [name, mod] of Object.entries(agentModules)) {
    try { require.resolve(mod); agents[name] = 'ok'; } catch { agents[name] = 'missing'; }
  }

  // Meta token check
  let metaToken = 'unknown';
  try {
    const tokenStatus = await checkTokenValidity();
    metaToken = tokenStatus.valid
      ? `valid (${tokenStatus.daysRemaining || '?'} days)`
      : 'expired';
  } catch { metaToken = 'check_failed'; }

  // Last intelligence scan
  let lastScan = null;
  try {
    const today = new Date().toISOString().split('T')[0];
    const report = await getIntelligenceForDate(today);
    if (report?.date) lastScan = report.date;
  } catch { /* ignore */ }

  // Log file status
  const logDates = logger.listLogDates();

  res.json({
    server: 'ok',
    agents,
    meta_token: metaToken,
    crons: 'running',
    last_scan: lastScan,
    uptime: `${hours}h ${minutes}m`,
    uptimeSeconds: uptimeSec,
    logDates: logDates.slice(0, 5),
    timestamp: new Date().toISOString(),
  });
});

// ============================================================
// GET /api/logs/:date — צפייה בלוגים יומיים
// ============================================================
app.get('/api/logs/:date', (req, res) => {
  try {
    const { date } = req.params;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'פורמט תאריך לא תקין. השתמש ב-YYYY-MM-DD' });
    }
    const entries = logger.readLogs(date);
    res.json({ date, count: entries.length, entries });
  } catch (error) {
    console.error('[LOGS] שגיאה בקריאת לוגים:', error.message);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// GET /api/logs — רשימת תאריכים זמינים
app.get('/api/logs', (req, res) => {
  try {
    const dates = logger.listLogDates();
    res.json({ dates });
  } catch (error) {
    console.error('[LOGS] שגיאה בשליפת תאריכי לוגים:', error.message);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// ============================================================
// שליפת פרטי אירוע ממנדי לפי Item ID
// ============================================================
async function fetchItemDetails(itemId) {
  try {
    const query = `
      query {
        items(ids: [${itemId}]) {
          name
          column_values {
            id
            text
            value
          }
        }
      }
    `;
    const data = await mondayQuery(query);
    const item = data.items[0];
    if (!item) throw new Error(`פריט ${itemId} לא נמצא`);

    const columns = {};
    for (const col of item.column_values) {
      columns[col.id] = col.text;
    }

    return {
      name: item.name,
      homeTeam: columns.home_team || columns.homeTeam || null,
      awayTeam: columns.away_team || columns.awayTeam || null,
      competition: columns.competition || columns.league || null,
      date: columns.date || columns.event_date || null,
      allColumns: columns,
    };
  } catch (error) {
    console.error('שגיאה בשליפת פרטי פריט:', error.message);
    throw error;
  }
}

// ============================================================
// POST /webhook — מאזין לבקשות מ-Monday.com
// ============================================================
app.post('/webhook', async (req, res) => {
  try {
    const body = req.body;

    // טיפול בחיבור ראשוני — Monday שולח challenge לאימות
    if (body.challenge) {
      console.log('Monday challenge התקבל — מאמת חיבור');
      return res.status(200).json({ challenge: body.challenge });
    }

    // חילוץ פרטי האירוע
    const event = body.event;

    if (!event) {
      console.log('בקשה ללא event — מתעלם');
      return res.status(200).send('OK');
    }

    // Orchestrator approval board — status change handler
    const columnId = event.columnId;
    const columnValue = event.value?.label?.text || event.value?.value;
    const approvalBoardId = orchestratorConfig.mondayApprovalBoard.boardId;

    if (approvalBoardId && String(event.boardId) === String(approvalBoardId) && columnId === 'status') {
      console.log(`[ORCHESTRATOR] Approval board webhook — item ${event.pulseId}`);
      handleApprovalWebhook(event).catch((err) => {
        console.error('[ORCHESTRATOR] Approval webhook error:', err.message);
      });
      return res.status(200).json({ status: 'received', type: 'orchestrator_approval' });
    }

    // סינון — מגיב רק כשהעמודה talking_agent שווה "פרסומת"
    if (columnId !== 'talking_agent' || columnValue !== 'פרסומת') {
      console.log(`עמודה ${columnId} עם ערך "${columnValue}" — לא רלוונטי, מתעלם`);
      return res.status(200).send('OK');
    }

    const itemId = event.pulseId;
    const boardId = event.boardId;

    console.log('=== טריגר תקין התקבל ===');
    console.log(`Board: ${boardId} | Item: ${itemId}`);
    console.log(`זמן: ${new Date().toISOString()}`);

    // שליפת פרטי האירוע ממנדי
    const details = await fetchItemDetails(itemId);

    const { homeTeam, awayTeam, competition, date } = details;

    // בדיקת שדות חובה
    if (!homeTeam || !awayTeam || !competition || !date) {
      const missing = [];
      if (!homeTeam) missing.push('home_team');
      if (!awayTeam) missing.push('away_team');
      if (!competition) missing.push('competition');
      if (!date) missing.push('date');

      console.error(`חסרים שדות בפריט ${itemId}: ${missing.join(', ')}`);
      console.log('עמודות שנמצאו:', JSON.stringify(details.allColumns, null, 2));
      return res.status(200).json({
        status: 'error',
        error: `חסרים שדות: ${missing.join(', ')}`,
        itemId,
      });
    }

    console.log(`מפעיל סריקה: ${homeTeam} vs ${awayTeam} | ${competition} | ${date}`);

    // מחזיר תשובה למנדי מיד — הסריקה רצה ברקע
    const matchKey = buildMatchKey(homeTeam, awayTeam, competition, date);
    res.status(200).json({ status: 'received', matchKey });

    // שלב 3 — סריקת מחירים ברקע
    let scoutResults = null;
    try {
      scoutResults = await getMatchPricing(homeTeam, awayTeam, competition, date);

      console.log('=== תוצאות סריקה ===');
      console.log(`matchKey: ${scoutResults.matchKey}`);
      console.log(`מטבע רשמי: ${scoutResults.currency}`);
      for (const [source, data] of Object.entries(scoutResults.sources)) {
        console.log(`${source}: ${data.categories.length} קטגוריות (${data.currency})`);
        data.categories.forEach((c) =>
          console.log(`  ${c.name}: ${c.price} ${c.currency}`)
        );
      }
      console.log('=====================');
    } catch (scrapeError) {
      console.error('שגיאה בסריקה:', scrapeError.message);
      return; // אם הסריקה נכשלה — אין טעם להמשיך ל-CMO
    }

    // שלב 4 — המלצת מחיר מ-CMO
    let cmoReport = null;
    try {
      cmoReport = await generatePricingReport(homeTeam, awayTeam, competition, date);

      console.log('=== המלצות מחיר CMO ===');
      for (const rec of cmoReport.recommendations) {
        const liveStr = rec.live.price != null ? `${rec.live.price} ${rec.live.currency}` : 'חסר';
        const recStr = rec.recommended.price != null ? `${rec.recommended.price} ${rec.recommended.currency}` : 'לא ניתן';
        console.log(`${rec.category}: Live ${liveStr} → Ticketeams ${recStr}`);
      }
      console.log('========================');
    } catch (cmoError) {
      console.error('שגיאה ב-CMO:', cmoError.message);
      return; // אם CMO נכשל — אין טעם להמשיך ל-Creative
    }

    // שלב 5 — יצירת מודעות מ-Creative Agent
    let creative = null;
    try {
      creative = await generateCreative(homeTeam, awayTeam, competition, date);

      console.log('=== מודעות Creative Agent ===');
      for (const ad of creative.metaAds) {
        console.log(`\n[${ad.style}]`);
        console.log(`  כותרת: ${ad.facebook.headline}`);
        console.log(`  טקסט: ${ad.facebook.primary_text}`);
        console.log(`  CTA: ${ad.facebook.description}`);
      }
      console.log(`\nstatus: ${creative.status}`);
      console.log('=============================');
    } catch (creativeError) {
      console.error('שגיאה ב-Creative Agent:', creativeError.message);
      return; // אם Creative נכשל — אין טעם להמשיך לאישור
    }

    // שלב 6 — שמירה לאישור אנושי
    try {
      const approvalResult = saveForApproval(matchKey, creative, cmoReport);

      console.log('=== Human Approval ===');
      console.log(`סטטוס: ${approvalResult.status}`);
      console.log(`קובץ: ${approvalResult.filePath}`);
      console.log('======================');
    } catch (approvalError) {
      console.error('שגיאה בשמירה לאישור:', approvalError.message);
    }
  } catch (error) {
    console.error('שגיאה בטיפול ב-webhook:', error.message);
    if (!res.headersSent) {
      return res.status(500).json({ status: 'error', error: 'שגיאת שרת' });
    }
  }
});

// ============================================================
// GET /api/pending-approvals — מחזיר את כל המודעות הממתינות
// ============================================================
app.get('/api/pending-approvals', (req, res) => {
  try {
    const fs = require('fs');
    const pendingDir = path.join(__dirname, 'pending-approvals');

    if (!fs.existsSync(pendingDir)) {
      return res.json([]);
    }

    const files = fs.readdirSync(pendingDir).filter((f) => f.endsWith('.json'));

    const generatedAdsDir = path.join(__dirname, 'generated-ads');
    const approvals = files.map((file) => {
      const raw = fs.readFileSync(path.join(pendingDir, file), 'utf-8');
      const approval = JSON.parse(raw);

      // Inject imageUrl into each version by matching style from images array
      if (approval.images && Array.isArray(approval.images) && approval.versions) {
        approval.versions = approval.versions.map((version) => {
          // Find the best image for this version's style (prefer "post" format)
          const styleImages = approval.images.filter((img) => img.style === version.style);
          const bestImage = styleImages.find((img) => img.format === 'post')
            || styleImages.find((img) => img.format === 'square')
            || styleImages[0];

          if (bestImage && bestImage.filePath) {
            // Convert absolute filePath to relative URL: /api/creative/images/{folder}/{filename}
            const relPath = path.relative(generatedAdsDir, bestImage.filePath);
            version.imageUrl = `/api/creative/images/${relPath}`;
          }
          return version;
        });
      }

      return approval;
    });

    res.json(approvals);
  } catch (error) {
    console.error('שגיאה בשליפת מודעות ממתינות:', error.message);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// ============================================================
// POST /api/approve/:matchKey — מאשר גרסה + pipeline אוטומטי
// ============================================================
app.post('/api/approve/:matchKey', async (req, res) => {
  try {
    const fs = require('fs');
    const { matchKey } = req.params;
    const { selectedVersion, selectedImageIndex } = req.body;

    if (!selectedVersion) {
      return res.status(400).json({ error: 'חסר selectedVersion' });
    }

    // Step 1: Approve version
    const result = approveVersion(matchKey, selectedVersion, selectedImageIndex);
    console.log(`[APPROVE-PIPELINE] גרסה ${selectedVersion} אושרה — ${matchKey}`);

    // Pipeline: post-approval steps (each in try/catch — never crash the approval)
    const pipeline = { formats: null, finance: null, meta: null };

    // Step 2: Verify/discover image formats for approved style
    try {
      const approval = loadPendingApproval(matchKey);
      const approvedStyle = approval?.selectedAd?.style;
      if (approval?.images?.length && approvedStyle) {
        const styleImages = approval.images.filter(img => img.style === approvedStyle);
        pipeline.formats = {
          story: styleImages.some(img => img.format === 'story'),
          square: styleImages.some(img => img.format === 'square'),
          post: styleImages.some(img => img.format === 'post'),
          count: styleImages.length,
        };
        console.log(`[APPROVE-PIPELINE] פורמטים: ${pipeline.formats.count} תמונות לסגנון ${approvedStyle}`);
      } else {
        pipeline.formats = { count: 0 };
      }
    } catch (e) {
      pipeline.formats = { error: e.message };
    }

    // Step 3: Finance — generate full pricing report if missing
    try {
      const approval = loadPendingApproval(matchKey);
      const pr = approval?.pricingReport;
      if (pr?.homeTeam && pr?.awayTeam && (!pr.recommendations || pr.recommendations.length === 0)) {
        console.log(`[APPROVE-PIPELINE] מבקש דוח תקציב מ-CMO...`);
        const fullReport = await generatePricingReport(pr.homeTeam, pr.awayTeam, pr.competition || 'unknown', pr.date);
        if (fullReport?.recommendations) {
          approval.pricingReport = { ...pr, ...fullReport };
          const safeMK = sanitizeMatchKey(matchKey);
          const fp = path.join(__dirname, 'pending-approvals', `${safeMK}.json`);
          fs.writeFileSync(fp, JSON.stringify(approval, null, 2), 'utf-8');
          pipeline.finance = { status: 'ok', recommendations: fullReport.recommendations.length };
          console.log(`[APPROVE-PIPELINE] תקציב: ${fullReport.recommendations.length} המלצות`);
        }
      } else if (pr?.recommendations?.length) {
        pipeline.finance = { status: 'ok', recommendations: pr.recommendations.length, cached: true };
      }
    } catch (e) {
      console.warn('[APPROVE-PIPELINE] Finance failed:', e.message);
      pipeline.finance = { error: e.message };
    }

    // Step 3b: Finance — event budget recommendation
    try {
      const approval = loadPendingApproval(matchKey);
      const pr = approval?.pricingReport;
      const budgetRec = getEventBudgetRecommendation(
        pr?.eventName || `${pr?.homeTeam || ''} vs ${pr?.awayTeam || ''}`,
        pr?.heatScore || 0,
        pr?.date
      );
      pipeline.finance = {
        ...(pipeline.finance || {}),
        budgetRecommendation: budgetRec,
      };
      // Save to approval JSON for frontend polling
      approval.budgetRecommendation = budgetRec;
      const safeMK = sanitizeMatchKey(matchKey);
      const fp = path.join(__dirname, 'pending-approvals', `${safeMK}.json`);
      fs.writeFileSync(fp, JSON.stringify(approval, null, 2), 'utf-8');
      console.log(`[APPROVE-PIPELINE] תקציב: ₪${budgetRec.recommendedDailyBudget}/יום × ${budgetRec.recommendedDuration} ימים (${budgetRec.recommendedTargeting})`);
    } catch (e) {
      console.warn('[APPROVE-PIPELINE] Budget rec failed:', e.message);
      pipeline.finance = { ...(pipeline.finance || {}), budgetRecommendation: null };
    }

    // Step 4: Meta — create PAUSED campaign
    try {
      console.log(`[APPROVE-PIPELINE] יוצר קמפיין Meta (PAUSED)...`);
      const metaResult = await publishCampaign(matchKey);
      pipeline.meta = {
        status: 'ok',
        campaignId: metaResult.campaignId || null,
        dashboardUrl: metaResult.metaDashboardUrl || null,
      };
      console.log(`[APPROVE-PIPELINE] Meta: campaignId=${metaResult.campaignId}`);
    } catch (e) {
      console.warn('[APPROVE-PIPELINE] Meta failed:', e.message);
      pipeline.meta = { error: e.message };
    }

    res.json({ ...result, pipeline });
  } catch (error) {
    console.error('שגיאה באישור גרסה:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// POST /trigger-ad-monitor — ריצה ידנית של ניטור מתחרים
// ============================================================
app.post('/trigger-ad-monitor', async (req, res) => {
  try {
    const date = req.body.date || new Date().toISOString().split('T')[0];

    console.log(`=== טריגר ידני — Ad Monitor (${date}) ===`);
    res.status(200).json({ status: 'received', date });

    // ריצה ברקע
    const results = await monitorCompetitorAds(date);

    // דוח ל-Monday.com
    await uploadDailyAdReport(results, req.body.itemId);

    // בדיקת מועמדים לפרסומת נגדית
    for (const candidate of results.counterAdCandidates || []) {
      const mockAd = { classification: { format_type: candidate.format_type } };
      const decision = decideCounterAd(mockAd, candidate);

      if (decision.trigger_creative && decision.homeTeam && decision.awayTeam) {
        console.log(`מייצר פרסומת נגדית: ${decision.homeTeam} vs ${decision.awayTeam}`);
        try {
          await generateCreative(decision.homeTeam, decision.awayTeam, 'Auto-detected', date);
        } catch (creativeErr) {
          console.error('שגיאה ביצירת פרסומת נגדית:', creativeErr.message);
        }
      }
    }

    console.log('=== Ad Monitor Completed ===');
  } catch (error) {
    console.error('שגיאה ב-Ad Monitor Trigger:', error.message);
    if (!res.headersSent) {
      return res.status(500).json({ status: 'error', error: error.message });
    }
  }
});

// ============================================================
// GET /api/ad-monitor/:date — דוח ניטור ליום מסוים
// ============================================================
app.get('/api/ad-monitor/:date', async (req, res) => {
  try {
    const { date } = req.params;
    const results = await monitorCompetitorAds(date);
    res.json(results);
  } catch (error) {
    console.error('שגיאה בשליפת דוח ניטור:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// POST /trigger-proactive-scan — ריצה ידנית של סריקה פרואקטיבית
// ============================================================
app.post('/trigger-proactive-scan', async (req, res) => {
  try {
    console.log('=== טריגר ידני — Proactive Scan ===');
    res.status(200).json({ status: 'received', message: 'סריקה פרואקטיבית התחילה' });

    const results = await proactiveScan();

    // Auto-trigger Rima for critical demand
    const criticalSuggestions = (results.suggestions || []).filter((s) => s.demandTier === 'critical');
    if (criticalSuggestions.length > 0) {
      console.log(`${criticalSuggestions.length} הצעות קריטיות — מפעיל Rima`);
      try {
        const biReport = await generateBIReport();
        await triggerRimaCampaign(biReport, results);
      } catch (rimaErr) {
        console.error('שגיאה ב-Rima:', rimaErr.message);
      }
    }

    console.log('=== Proactive Scan Complete ===');
  } catch (error) {
    console.error('שגיאה ב-Proactive Scan:', error.message);
    if (!res.headersSent) {
      return res.status(500).json({ status: 'error', error: error.message });
    }
  }
});

// ============================================================
// GET /api/proactive-scan — תוצאות סריקה אחרונות
// ============================================================
app.get('/api/proactive-scan', async (req, res) => {
  try {
    const results = await proactiveScan();
    res.json(results);
  } catch (error) {
    console.error('שגיאה בסריקה פרואקטיבית:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// GET /api/demand/:home/:away — ציון ביקוש מהיר
// ============================================================
app.get('/api/demand/:home/:away', (req, res) => {
  try {
    const { home, away } = req.params;
    const fixture = {
      homeTeam: home,
      awayTeam: away,
      competition: req.query.competition || 'premier_league',
      date: req.query.date || new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0],
      title: `${home} vs ${away}`,
    };
    const demand = scoreDemand(fixture);
    res.json({ homeTeam: home, awayTeam: away, ...demand });
  } catch (error) {
    console.error('שגיאה בחישוב ביקוש:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// GET /api/bi-report — דוח BI מלא
// ============================================================
app.get('/api/bi-report', async (req, res) => {
  try {
    const report = await generateBIReport();
    res.json(report);
  } catch (error) {
    console.error('שגיאה ביצירת דוח BI:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// POST /trigger-rima-campaign — הפעלת Rima מ-BI
// ============================================================
app.post('/trigger-rima-campaign', async (req, res) => {
  try {
    console.log('=== טריגר ידני — Rima Campaign ===');
    res.status(200).json({ status: 'received', message: 'Rima Campaign התחיל' });

    const biReport = await generateBIReport();
    const result = await triggerRimaCampaign(biReport);

    console.log(`Rima: triggered=${result.triggered}, reason=${result.reason}`);
    console.log('=== Rima Campaign Complete ===');
  } catch (error) {
    console.error('שגיאה ב-Rima Campaign:', error.message);
    if (!res.headersSent) {
      return res.status(500).json({ status: 'error', error: error.message });
    }
  }
});

// ============================================================
// POST /api/scout/push-to-monday — דחיפת משחק ללוח Monday.com
// ============================================================
app.post('/api/scout/push-to-monday', async (req, res) => {
  try {
    const { matchKey, homeTeam, awayTeam, competition, date } = req.body;

    if (!homeTeam || !awayTeam) {
      return res.status(400).json({ error: 'חסרים homeTeam ו-awayTeam' });
    }

    const columnValues = JSON.stringify({
      home_team: homeTeam,
      away_team: awayTeam,
      competition: competition || '',
      date: date ? { date } : null,
    }).replace(/"/g, '\\"');

    const mutation = `
      mutation {
        create_item(
          board_id: ${BOARD_ID},
          item_name: "${homeTeam} vs ${awayTeam}",
          column_values: "${columnValues}"
        ) {
          id
        }
      }
    `;

    const data = await mondayQuery(mutation);
    const mondayItemId = data.create_item?.id;

    console.log(`Push to Monday: ${homeTeam} vs ${awayTeam} → item ${mondayItemId}`);
    res.json({ success: true, mondayItemId });
  } catch (error) {
    console.error('שגיאה ב-Push to Monday:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

// ============================================================
// GET /api/cmo/stock/:matchKey — מצב מלאי WooCommerce (read-only)
// ============================================================
app.get('/api/cmo/stock/:matchKey', async (req, res) => {
  try {
    const { matchKey } = req.params;
    const stock = await getStockStatus(matchKey);
    res.json(stock);
  } catch (error) {
    console.error('שגיאה בשליפת מלאי:', error.message);
    res.status(500).json({
      matchKey: req.params.matchKey,
      status: 'unavailable',
      totalCategories: 0,
      inStockCategories: 0,
      categories: [],
      lastChecked: new Date().toISOString(),
    });
  }
});

// ============================================================
// GET /api/cmo/stock-overview — מצב מלאי לכל המשחקים במטמון
// ============================================================
app.get('/api/cmo/stock-overview', async (req, res) => {
  try {
    const fs = require('fs');
    const cacheDir = path.join(__dirname, 'cache');
    if (!fs.existsSync(cacheDir)) return res.json([]);

    const files = fs.readdirSync(cacheDir).filter((f) => f.endsWith('.json') && f.includes('__'));
    const results = [];

    for (const file of files.slice(0, 10)) {
      const matchKey = file.replace('.json', '');
      try {
        const stock = await getStockStatus(matchKey);
        results.push(stock);
      } catch {
        // skip
      }
    }

    res.json(results);
  } catch (error) {
    console.error('שגיאה ב-stock overview:', error.message);
    res.json([]);
  }
});

// ============================================================
// PATCH /api/creative/:matchKey/versions/:index — עדכון טקסט מודעה
// ============================================================
app.patch('/api/creative/:matchKey/versions/:index', (req, res) => {
  try {
    const fs = require('fs');
    const { matchKey, index } = req.params;
    const versionIndex = parseInt(index, 10);
    const updates = req.body;

    const filePath = path.join(__dirname, 'pending-approvals', `${matchKey}.json`);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'מודעה לא נמצאה' });
    }

    const approval = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const version = approval.versions?.find((v) => v.index === versionIndex);
    if (!version) {
      return res.status(404).json({ error: 'גרסה לא נמצאה' });
    }

    if (updates.headline) version.headline = updates.headline;
    if (updates.body) version.body = updates.body;
    if (updates.cta) version.cta = updates.cta;

    // Update meta fields too
    if (updates.headline && version.meta?.facebook) {
      version.meta.facebook.headline = updates.headline;
    }
    if (updates.body && version.meta?.facebook) {
      version.meta.facebook.primary_text = updates.body;
    }
    if (updates.cta && version.meta?.facebook) {
      version.meta.facebook.description = updates.cta;
    }

    fs.writeFileSync(filePath, JSON.stringify(approval, null, 2), 'utf-8');
    console.log(`Updated version ${versionIndex} for ${matchKey}`);
    res.json(version);
  } catch (error) {
    console.error('שגיאה בעדכון גרסה:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// POST /api/creative/regenerate — יצירת גרסה חדשה
// ============================================================
app.post('/api/creative/regenerate', async (req, res) => {
  try {
    const fs = require('fs');
    const { matchKey, versionIndex } = req.body;

    const filePath = path.join(__dirname, 'pending-approvals', `${matchKey}.json`);
    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: 'מודעה לא נמצאה' });
    }

    const approval = JSON.parse(fs.readFileSync(filePath, 'utf-8'));

    // Extract match details from matchKey (format: homeTeam__awayTeam__competition__date)
    const parts = matchKey.split('__');
    const homeTeam = (parts[0] || '').replace(/_/g, ' ');
    const awayTeam = (parts[1] || '').replace(/_/g, ' ');
    const competition = (parts[2] || '').replace(/_/g, ' ');
    const date = parts[3] || new Date().toISOString().split('T')[0];

    const creative = await generateCreative(homeTeam, awayTeam, competition, date);

    // Replace only the requested version
    const newVersion = creative.metaAds[versionIndex - 1];
    if (newVersion) {
      const version = approval.versions.find((v) => v.index === versionIndex);
      if (version) {
        version.headline = newVersion.facebook?.headline || version.headline;
        version.body = newVersion.facebook?.primary_text || version.body;
        version.cta = newVersion.facebook?.description || version.cta;
        version.meta = {
          style: newVersion.style,
          facebook: newVersion.facebook,
          instagram: newVersion.instagram,
        };
      }
    }

    fs.writeFileSync(filePath, JSON.stringify(approval, null, 2), 'utf-8');
    console.log(`Regenerated version ${versionIndex} for ${matchKey}`);
    res.json(approval.versions.find((v) => v.index === versionIndex));
  } catch (error) {
    console.error('שגיאה ב-Regenerate:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// GET /api/meta/competitors — סריקת מתחרים בלבד (Page IDs)
// ============================================================
// Competitors-only mode — NO keyword fallback
// Config: COMPETITOR_PAGE_IDS in .env
// ============================================================
app.get('/api/meta/competitors', async (req, res) => {
  try {
    const limit = Math.min(parseInt(req.query.limit) || 25, 50);
    const userSearch = (req.query.q || '').trim();

    // ── Search Priority: if user typed a search term, use ONLY that ──
    if (userSearch) {
      console.log(`\n=== Ad Library Search: "${userSearch}" ===`);

      // Arena strict mode: expand countries for known ticket competitors
      const arenaKeywords = ['arena tickets', 'arena ticket', 'arenatickets', 'ארנה טיקטס'];
      const isArenaSearch = arenaKeywords.some((kw) => userSearch.toLowerCase().includes(kw));
      const countries = isArenaSearch ? ['IL', 'GB', 'ES'] : ['IL'];

      if (isArenaSearch) {
        console.log(`[search] Arena strict mode: searching IL + GB + ES`);
      }

      const result = await fetchActiveAds({
        searchTerms: userSearch,
        pageName: `Search: "${userSearch}"`,
        limit,
        countries,
      });

      const rawAds = result.ads.map((ad) => {
        ad.match_info = extractMatchInfo(ad);
        return ad;
      });

      const { kept: allAds, discarded } = filterAds(rawAds);
      if (discarded.total > 0) {
        console.log(`[filter] Discarded ${discarded.total} (political: ${discarded.political}, blacklisted: ${discarded.blacklisted}, irrelevant: ${discarded.irrelevant})`);
      }

      // Classify
      const toClassify = allAds.slice(0, 20);
      const classifications = await Promise.allSettled(
        toClassify.map((ad) => classifyAdFormat(ad))
      );
      for (let i = 0; i < toClassify.length; i++) {
        toClassify[i].classification = classifications[i].status === 'fulfilled'
          ? classifications[i].value
          : { format_type: 'Unknown', reasoning: 'classification failed' };
      }
      for (let i = 20; i < allAds.length; i++) {
        allAds[i].classification = { format_type: 'Unknown', reasoning: 'not classified (batch limit)' };
      }

      console.log(`[search] "${userSearch}": ${allAds.length} ads (from ${rawAds.length} raw)`);
      console.log('=== Search Complete ===\n');

      return res.json({
        totalAds: allAds.length,
        totalRaw: rawAds.length,
        filtered: { political: discarded.political, blacklisted: discarded.blacklisted, irrelevant: discarded.irrelevant },
        searchTerms: [userSearch],
        searchMode: 'user_search',
        countries,
        competitorPages: [],
        sources: [{ label: userSearch, count: allAds.length, status: result.status, error: result.error || null }],
        ads: allAds,
        scannedAt: new Date().toISOString(),
      });
    }

    // ── Default: scan all competitor pages ──
    console.log('\n=== Competitor Ad Library Scan ===');

    if (COMPETITOR_PAGES.length === 0) {
      console.log('[competitors] ERROR: No competitor Page IDs configured in .env');
      return res.json({
        totalAds: 0,
        searchTerms: [],
        competitorPages: [],
        sources: [{ label: 'Config', count: 0, status: 'error', error: 'COMPETITOR_PAGE_IDS not set in .env' }],
        ads: [],
        scannedAt: new Date().toISOString(),
      });
    }

    console.log(`[competitors] Scanning ${COMPETITOR_PAGES.length} competitor pages:`);
    COMPETITOR_PAGES.forEach((p) => console.log(`  - ${p.name} (ID: ${p.page_id})`));

    // ── ABSOLUTE IMMUNITY architecture: VIP first, fallback second ──
    // Step 1: VIP requests — page_id ONLY, ACTIVE, expanded countries (IL+GB+ES+US)
    const vipPromises = COMPETITOR_PAGES.map((page) =>
      fetchActiveAds({ pageId: page.page_id, pageName: page.name, limit, vip: true })
    );
    const vipResults = await Promise.allSettled(vipPromises);

    // Step 2: For any competitor with 0 VIP results, try fallback with search_terms
    const fallbackPromises = COMPETITOR_PAGES.map((page, i) => {
      const vipResult = vipResults[i];
      const vipCount = vipResult.status === 'fulfilled' ? vipResult.value.ads_count : 0;
      if (vipCount > 0) return Promise.resolve(null); // VIP found ads, skip fallback
      const searchTerms = page.name_he || page.name;
      if (!searchTerms) return Promise.resolve(null);
      return fetchActiveAds({ searchTerms, pageName: page.name, limit, vip: false });
    });
    const fallbackResults = await Promise.allSettled(fallbackPromises);

    // Build sources + collect ads
    const sources = [];
    const allAds = [];
    const rawAds = [];
    const discarded = { political: 0, blacklisted: 0, irrelevant: 0, total: 0 };
    let vipImmuneCount = 0;

    for (let i = 0; i < COMPETITOR_PAGES.length; i++) {
      const page = COMPETITOR_PAGES[i];
      const vipResult = vipResults[i];
      const fallbackResult = fallbackResults[i];

      // ── VIP ads: ABSOLUTE IMMUNITY — zero filtering ──
      if (vipResult.status === 'fulfilled' && vipResult.value.ads_count > 0) {
        const r = vipResult.value;
        sources.push({ label: page.name, count: r.ads_count, status: r.status, error: null, mode: 'VIP_IMMUNE' });
        console.log(`[IMMUNITY] ${page.name}: ${r.ads_count} ads via page_id → ABSOLUTE IMMUNITY (no filters)`);
        vipImmuneCount += r.ads_count;
        for (const ad of r.ads) {
          ad.match_info = extractMatchInfo(ad);
          rawAds.push(ad);
          allAds.push(ad); // straight to dashboard, no filters
        }
        continue;
      }

      // ── Fallback: strict filter pipeline ──
      if (fallbackResult?.status === 'fulfilled' && fallbackResult.value) {
        const r = fallbackResult.value;
        if (r.ads_count > 0) {
          for (const ad of r.ads) {
            ad.match_info = extractMatchInfo(ad);
            rawAds.push(ad);
          }
          const filtered = filterAds(r.ads, 'strict');
          allAds.push(...filtered.kept);
          discarded.political += filtered.discarded.political;
          discarded.blacklisted += filtered.discarded.blacklisted;
          discarded.irrelevant += filtered.discarded.irrelevant;
          discarded.total += filtered.discarded.total;
          if (filtered.discarded.total > 0) {
            console.log(`[filter] ${page.name} (strict fallback): kept ${filtered.kept.length}/${r.ads.length} (political: ${filtered.discarded.political}, blacklisted: ${filtered.discarded.blacklisted}, irrelevant: ${filtered.discarded.irrelevant})`);
          }
          sources.push({ label: page.name, count: filtered.kept.length, status: r.status, error: r.error || null, mode: 'strict_fallback' });
          if (filtered.kept.length > 0) {
            console.log(`[competitors] ${page.name}: ${filtered.kept.length} ads (fallback, filtered)`);
          }
        } else {
          sources.push({ label: page.name, count: 0, status: r.status, error: r.error || null, mode: 'fallback_empty' });
          console.log(`[competitors] ${page.name}: 0 ads (no active campaigns)`);
        }
      } else if (vipResult.status === 'rejected') {
        const errMsg = vipResult.reason?.message || 'Unknown error';
        sources.push({ label: page.name, count: 0, status: 'rejected', error: errMsg });
        console.log(`[competitors] ${page.name}: REJECTED — ${errMsg}`);
      } else {
        sources.push({ label: page.name, count: 0, status: 'ok', error: null, mode: 'no_results' });
        console.log(`[competitors] ${page.name}: 0 ads (no active campaigns)`);
      }
    }

    console.log(`[competitors] VIP Immune: ${vipImmuneCount} ads bypassed all filters`);

    // ── Detect API-blind competitors: VIP returned 0 AND fallback returned 0 real ads ──
    const apiBlindCompetitors = [];
    for (let i = 0; i < COMPETITOR_PAGES.length; i++) {
      const page = COMPETITOR_PAGES[i];
      const vipResult = vipResults[i];
      const vipCount = vipResult.status === 'fulfilled' ? vipResult.value.ads_count : 0;
      const fallbackKept = sources.find((s) => s.label === page.name)?.count || 0;

      if (vipCount === 0 && fallbackKept === 0) {
        apiBlindCompetitors.push({
          name: page.name,
          name_he: page.name_he || page.name,
          page_id: page.page_id,
          adLibraryUrl: `https://www.facebook.com/ads/library/?active_status=all&ad_type=all&country=IL&view_all_page_id=${page.page_id}`,
        });
        console.log(`[API-BLIND] ${page.name} (${page.page_id}): 0 ads from API — marked as API-blind`);
      }
    }

    // Classify ads in batches (limit to 20 to avoid rate limits)
    const toClassify = allAds.slice(0, 20);
    const classifications = await Promise.allSettled(
      toClassify.map((ad) => classifyAdFormat(ad))
    );
    for (let i = 0; i < toClassify.length; i++) {
      toClassify[i].classification = classifications[i].status === 'fulfilled'
        ? classifications[i].value
        : { format_type: 'Unknown', reasoning: 'classification failed' };
    }
    for (let i = 20; i < allAds.length; i++) {
      allAds[i].classification = { format_type: 'Unknown', reasoning: 'not classified (batch limit)' };
    }

    console.log(`[competitors] Total ads found: ${allAds.length}`);
    console.log('=== Scan Complete ===\n');

    res.json({
      totalAds: allAds.length,
      totalRaw: rawAds.length,
      filtered: { political: discarded.political, blacklisted: discarded.blacklisted, irrelevant: discarded.irrelevant },
      searchTerms: [],
      searchMode: 'competitors',
      competitorPages: COMPETITOR_PAGES.map((p) => ({ name: p.name, page_id: p.page_id })),
      sources,
      ads: allAds,
      apiBlindCompetitors,
      scannedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.error('שגיאה בסריקת מתחרים:', error.message);
    res.status(500).json({ totalAds: 0, ads: [], sources: [], error: 'שגיאת שרת' });
  }
});

// ============================================================
// GET /api/intelligence/daily/:date — דוח מודיעין יומי
// ============================================================
app.get('/api/intelligence/daily/:date', async (req, res) => {
  try {
    const { date } = req.params;
    const report = await getIntelligenceForDate(date);
    res.json(report);
  } catch (error) {
    console.error('שגיאה בשליפת דוח מודיעין:', error.message);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// ============================================================
// GET /api/intelligence/heat — כל ציוני החום
// ============================================================
app.get('/api/intelligence/heat', async (req, res) => {
  try {
    const scores = await getAllHeatScores();
    res.json(scores);
  } catch (error) {
    console.error('שגיאה בשליפת heat scores:', error.message);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// ============================================================
// GET /api/intelligence/heat/:eventKey — ציון חום לאירוע בודד
// ============================================================
app.get('/api/intelligence/heat/:eventKey', async (req, res) => {
  try {
    const { eventKey } = req.params;
    const score = await getHeatScoreForEvent(eventKey);
    res.json(score);
  } catch (error) {
    console.error('שגיאה בחישוב heat score:', error.message);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// ============================================================
// POST /api/intelligence/scan — טריגר סריקת מודיעין ידנית
// ============================================================
app.post('/api/intelligence/scan', async (req, res) => {
  try {
    console.log('=== טריגר ידני — Intelligence Scan ===');
    res.status(200).json({ status: 'received', message: 'סריקת מודיעין התחילה' });

    const report = await triggerManualScan();
    console.log(`[INTELLIGENCE] Manual scan complete — ${report.scoredEvents.length} events scored`);
  } catch (error) {
    console.error('שגיאה בסריקת מודיעין:', error.message);
    if (!res.headersSent) {
      res.status(500).json({ status: 'error', error: 'שגיאת שרת' });
    }
  }
});

// ============================================================
// POST /api/intelligence/send-report — שליחת דוח מודיעין במייל
// ============================================================
app.post('/api/intelligence/send-report', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const report = await getIntelligenceForDate(today);
    const emails = [process.env.INTELLIGENCE_EMAIL_TO].filter(Boolean);
    const result = await sendReport(report, emails);
    res.json(result);
  } catch (error) {
    console.error('שגיאה בשליחת דוח מודיעין:', error.message);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// ============================================================
// Finance Agent Endpoints
// ============================================================

// GET /api/finance/weekly/:weekStart — דוח פיננסי שבועי
app.get('/api/finance/weekly/:weekStart', async (req, res) => {
  try {
    const { weekStart } = req.params;
    const report = await getWeeklyReport(weekStart);
    res.json(report);
  } catch (error) {
    console.error('שגיאה בשליפת דוח פיננסי:', error.message);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// GET /api/finance/event/:eventName — רווחיות לפי אירוע
app.get('/api/finance/event/:eventName', async (req, res) => {
  try {
    const eventName = decodeURIComponent(req.params.eventName);
    const result = await getEventProfitability(eventName);
    res.json(result);
  } catch (error) {
    console.error('שגיאה בשליפת רווחיות אירוע:', error.message);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// GET /api/finance/campaign/:campaignName — ביצועי קמפיין
app.get('/api/finance/campaign/:campaignName', async (req, res) => {
  try {
    const campaignName = decodeURIComponent(req.params.campaignName);
    const result = await getCampaignProfitability(campaignName);
    res.json(result);
  } catch (error) {
    console.error('שגיאה בשליפת ביצועי קמפיין:', error.message);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// GET /api/finance/channels — ביצועי ערוצים
app.get('/api/finance/channels', async (req, res) => {
  try {
    const result = await getChannelPerformance();
    res.json(result);
  } catch (error) {
    console.error('שגיאה בשליפת ביצועי ערוצים:', error.message);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// GET /api/finance/budget-recommendation — המלצות תקציב
app.get('/api/finance/budget-recommendation', async (req, res) => {
  try {
    const result = await getBudgetRecommendation();
    res.json(result);
  } catch (error) {
    console.error('שגיאה בשליפת המלצות תקציב:', error.message);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// POST /api/finance/send-report — שליחת דוח פיננסי במייל
app.post('/api/finance/send-report', async (req, res) => {
  try {
    const weekStart = req.body.weekStart || getCurrentWeekStart();
    console.log(`=== Finance Report Send — ${weekStart} ===`);
    res.status(200).json({ status: 'received', weekStart });

    const report = await getWeeklyReport(weekStart);
    const emails = [process.env.FINANCE_EMAIL_TO].filter(Boolean);
    const result = await sendFinanceReport(report, emails);
    console.log(`[FINANCE] Email result: sent=${result.sent}`);
  } catch (error) {
    console.error('שגיאה בשליחת דוח פיננסי:', error.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'שגיאת שרת' });
    }
  }
});

// GET /api/finance/alerts — התראות פיננסיות
app.get('/api/finance/alerts', async (req, res) => {
  try {
    const alerts = await getFinanceAlerts();
    res.json(alerts);
  } catch (error) {
    console.error('שגיאה בשליפת התראות פיננסיות:', error.message);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// ============================================================
// Orchestrator API Endpoints
// ============================================================

// GET /api/orchestrator/status — סטטוס מערכת
app.get('/api/orchestrator/status', (_req, res) => {
  try {
    const status = getOrchestratorStatus();
    res.json(status);
  } catch (error) {
    console.error('[ORCHESTRATOR] שגיאה בשליפת סטטוס:', error.message);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// GET /api/orchestrator/decisions — החלטות אחרונות
app.get('/api/orchestrator/decisions', (_req, res) => {
  try {
    const limit = Math.min(parseInt(_req.query.limit) || 20, 100);
    const decisions = getRecentDecisions(limit);
    res.json(decisions);
  } catch (error) {
    console.error('[ORCHESTRATOR] שגיאה בשליפת החלטות:', error.message);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// POST /api/orchestrator/hot-check — טריגר ידני לבדיקת אירועים חמים
app.post('/api/orchestrator/hot-check', async (_req, res) => {
  try {
    console.log('=== טריגר ידני — Orchestrator Hot Event Check ===');
    res.status(202).json({ status: 'received', message: 'בדיקת אירועים חמים התחילה' });

    const result = await runHotEventCheck();
    console.log(`[ORCHESTRATOR] Manual hot check — ${result.decisions.length} decisions, ${result.durationMs}ms`);
  } catch (error) {
    console.error('[ORCHESTRATOR] שגיאה ב-Hot Event Check:', error.message);
  }
});

// POST /api/orchestrator/perf-check — טריגר ידני לבדיקת ביצועים
app.post('/api/orchestrator/perf-check', async (_req, res) => {
  try {
    console.log('=== טריגר ידני — Orchestrator Performance Check ===');
    res.status(202).json({ status: 'received', message: 'בדיקת ביצועים התחילה' });

    const result = await runPerformanceCheck();
    console.log(`[ORCHESTRATOR] Manual perf check — ${result.decisions.length} decisions, ${result.durationMs}ms`);
  } catch (error) {
    console.error('[ORCHESTRATOR] שגיאה ב-Performance Check:', error.message);
  }
});

// POST /api/orchestrator/execute/:decisionId — ביצוע ידני של החלטה ממתינה
app.post('/api/orchestrator/execute/:decisionId', async (req, res) => {
  try {
    const { decisionId } = req.params;
    const decisions = getRecentDecisions(100);
    const match = decisions.find((d) => d.id === decisionId || d.cachedId === decisionId);

    if (!match) {
      return res.status(404).json({ error: 'החלטה לא נמצאה' });
    }

    console.log(`[ORCHESTRATOR] ביצוע ידני: ${match.decision?.type || match.type}`);
    const result = await executeDecision(match.decision || match);
    res.json(result);
  } catch (error) {
    console.error('[ORCHESTRATOR] שגיאה בביצוע החלטה:', error.message);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// POST /api/orchestrator/setup-board — יצירת לוח אישורים ב-Monday.com
app.post('/api/orchestrator/setup-board', async (_req, res) => {
  try {
    console.log('=== Orchestrator Board Setup ===');
    const result = await setupApprovalBoard();
    res.json(result);
  } catch (error) {
    console.error('[ORCHESTRATOR] שגיאה ביצירת לוח אישורים:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// GET /api/orchestrator/config — תצוגת הגדרות (ללא מידע רגיש)
app.get('/api/orchestrator/config', (_req, res) => {
  try {
    res.json({
      version: orchestratorConfig.version,
      scheduling: orchestratorConfig.scheduling,
      decisionRules: orchestratorConfig.decisionRules,
      budgetDefaults: orchestratorConfig.budgetDefaults,
      approvalBoardConfigured: !!orchestratorConfig.mondayApprovalBoard.boardId,
    });
  } catch (error) {
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// POST /api/orchestrator/daily-summary — טריגר ידני לסיכום יומי
app.post('/api/orchestrator/daily-summary', async (_req, res) => {
  try {
    console.log('=== טריגר ידני — Daily Summary ===');
    const result = await sendDailySummary(null);
    res.json(result);
  } catch (error) {
    console.error('[ORCHESTRATOR] שגיאה בסיכום יומי:', error.message);
    res.status(500).json({ error: error.message });
  }
});

// POST /api/orchestrator/full-pipeline — Pipeline מלא לאירוע ספציפי
app.post('/api/orchestrator/full-pipeline', async (req, res) => {
  try {
    const { homeTeam, awayTeam, competition, gameDate } = req.body;
    if (!homeTeam || !awayTeam) {
      return res.status(400).json({ error: 'חסר homeTeam ו/או awayTeam' });
    }

    const date = gameDate || new Date().toISOString().split('T')[0];
    const matchKey = `${homeTeam.replace(/\s+/g, '_')}__${awayTeam.replace(/\s+/g, '_')}__${(competition || 'unknown').replace(/\s+/g, '_')}__${date}`;

    console.log(`[ORCHESTRATOR] Full pipeline: ${homeTeam} vs ${awayTeam}`);
    res.status(202).json({ status: 'received', matchKey, message: 'Pipeline מלא התחיל' });

    // Run in background — each step in try/catch for error recovery
    const pipelineTimer = logger.time('orchestrator', 'fullPipeline');
    const pipelineResult = { matchKey, steps: {} };

    // Step 1: Heat score
    let heatResult = { score: 30, tier: 'warm' }; // fallback defaults
    try {
      const { fetchAllSources, calculateHeatScore } = require('./agents/heat-scoring');
      const sources = await fetchAllSources();
      heatResult = await calculateHeatScore(homeTeam, awayTeam, date, sources);
      pipelineResult.steps.heat = { status: 'ok', score: heatResult.score, tier: heatResult.tier };
      logger.info('orchestrator', 'heatScore', `${homeTeam} vs ${awayTeam}: ${heatResult.score} (${heatResult.tier})`);
    } catch (heatErr) {
      pipelineResult.steps.heat = { status: 'error', error: heatErr.message, fallback: heatResult };
      logger.warn('orchestrator', 'heatScore', `Failed — using default ${heatResult.score}: ${heatErr.message}`);
    }

    // Step 2: Creative generation
    let creative = null;
    try {
      creative = await generateCreativeV3({
        homeTeam, awayTeam,
        competition: competition || 'Auto-detected',
        date,
        event_type: 'football',
      });
      pipelineResult.steps.creative = { status: 'ok', versions: creative?.versions?.length || 0 };
      logger.info('orchestrator', 'creative', `Generated ${creative?.versions?.length || 0} versions for ${matchKey}`);
    } catch (creativeErr) {
      pipelineResult.steps.creative = { status: 'error', error: creativeErr.message };
      logger.error('orchestrator', 'creative', `Failed for ${matchKey}: ${creativeErr.message}`);
    }

    // Step 3: Save for approval (only if creative succeeded)
    if (creative) {
      try {
        const { saveForApproval: saveApproval } = require('./agents/human-approval');
        saveApproval(matchKey, creative, {
          homeTeam, awayTeam, competition, date,
          heatScore: heatResult.score,
          tier: heatResult.tier,
          source: 'orchestrator-full-pipeline',
        });
        pipelineResult.steps.approval = { status: 'ok' };
        logger.info('orchestrator', 'saveApproval', `Saved for approval: ${matchKey}`);
      } catch (saveErr) {
        pipelineResult.steps.approval = { status: 'error', error: saveErr.message };
        logger.error('orchestrator', 'saveApproval', `Failed to save ${matchKey}: ${saveErr.message}`);
      }
    } else {
      pipelineResult.steps.approval = { status: 'skipped', reason: 'creative generation failed' };
    }

    pipelineTimer.done(`Pipeline complete: ${matchKey} (heat: ${heatResult.score})`, pipelineResult);
  } catch (error) {
    console.error('[ORCHESTRATOR] שגיאה ב-Full Pipeline:', error.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'שגיאת שרת' });
    }
  }
});

// ============================================================
// SEO Agent Endpoints
// ============================================================

// POST /api/seo/landing-page — create landing page for event
app.post('/api/seo/landing-page', async (req, res) => {
  try {
    const { homeTeam, awayTeam, competition, gameDate, priceRange } = req.body;
    if (!homeTeam || !awayTeam) {
      return res.status(400).json({ error: 'homeTeam and awayTeam required' });
    }
    const result = await generateLandingPage({ homeTeam, awayTeam, competition, gameDate, priceRange });
    res.json(result);
  } catch (error) {
    console.error('[SEO] Landing page error:', error.message);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// POST /api/seo/blog-post — create blog post
app.post('/api/seo/blog-post', async (req, res) => {
  try {
    const { topic, keywords, eventData } = req.body;
    if (!topic) {
      return res.status(400).json({ error: 'topic required' });
    }
    const result = await generateBlogPost({ topic, keywords, eventData });
    res.json(result);
  } catch (error) {
    console.error('[SEO] Blog post error:', error.message);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// GET /api/seo/content — list all SEO-created content
app.get('/api/seo/content', async (req, res) => {
  try {
    const created = listCreatedContent();
    const wp = await getExistingContent();
    res.json({ created, wordpress: wp });
  } catch (error) {
    console.error('[SEO] Content list error:', error.message);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// GET /api/seo/health — sitemap status + content stats
app.get('/api/seo/health', async (req, res) => {
  try {
    const health = await getSitemapHealth();
    const created = listCreatedContent();
    res.json({ ...health, createdByAgent: created.length });
  } catch (error) {
    console.error('[SEO] Health check error:', error.message);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// ============================================================
// POST /api/creative/from-intelligence — Orchestrator entry point
// Intelligence → Creative pipeline trigger
// ============================================================
app.post('/api/creative/from-intelligence', async (req, res) => {
  try {
    const { homeTeam, awayTeam, competition, gameDate, heatScore, suggestedBudget, eventName } = req.body;

    if (!homeTeam || !awayTeam) {
      return res.status(400).json({ error: 'חסר homeTeam ו/או awayTeam' });
    }

    const date = gameDate || new Date().toISOString().split('T')[0];
    const matchKey = `${homeTeam.replace(/\s+/g, '_')}__${awayTeam.replace(/\s+/g, '_')}__${(competition || 'unknown').replace(/\s+/g, '_')}__${date}`;

    console.log(`\n[CREATIVE-FROM-INTEL] ${homeTeam} vs ${awayTeam} | heat=${heatScore || 'N/A'} | budget=${suggestedBudget || 'N/A'}`);
    res.status(202).json({ status: 'received', matchKey, message: 'יצירת מודעה בתהליך' });

    // Run in background
    try {
      const creative = await generateCreative(homeTeam, awayTeam, competition || 'Auto-detected', date);

      // Save for approval with intelligence metadata
      const pricingReport = creative.pricingReport || { homeTeam, awayTeam, competition, date };
      if (heatScore) pricingReport.heatScore = heatScore;
      if (suggestedBudget) pricingReport.suggestedBudget = suggestedBudget;
      if (eventName) pricingReport.eventName = eventName;

      const approvalResult = saveForApproval(matchKey, creative, pricingReport);
      console.log(`[CREATIVE-FROM-INTEL] Saved for approval: ${approvalResult.status} — ${matchKey}`);
    } catch (err) {
      console.error(`[CREATIVE-FROM-INTEL] Failed: ${err.message}`);
    }
  } catch (error) {
    console.error('[CREATIVE-FROM-INTEL] Error:', error.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'שגיאה ביצירת מודעה' });
    }
  }
});

// ============================================================
// POST /api/creative/v3 — Creative Agent V3 with Iron Rules
// ============================================================
app.post('/api/creative/v3', async (req, res) => {
  try {
    const { homeTeam, awayTeam, competition, gameDate, eventName, event_type, competitor_format, backgroundAssetId } = req.body;

    if (!homeTeam || !awayTeam) {
      return res.status(400).json({ error: 'חסר homeTeam ו/או awayTeam' });
    }

    const date = gameDate || new Date().toISOString().split('T')[0];
    const matchKey = `${homeTeam.replace(/\s+/g, '_')}__${awayTeam.replace(/\s+/g, '_')}__${(competition || 'unknown').replace(/\s+/g, '_')}__${date}`;

    console.log(`\n[CREATIVE-V3] ${homeTeam} vs ${awayTeam} | ${competition || 'unknown'}`);
    res.status(202).json({ status: 'received', matchKey, message: 'יצירת מודעה V3 בתהליך' });

    // Run in background
    try {
      const result = await generateCreativeV3({
        homeTeam, awayTeam,
        competition: competition || 'Auto-detected',
        date,
        event_type: event_type || 'football',
        competitor_format: competitor_format || null,
        backgroundAssetId: backgroundAssetId || null,
      });

      // Save for approval
      const pricingReport = { homeTeam, awayTeam, competition, date, eventName };
      const approvalResult = saveForApproval(matchKey, result, pricingReport);
      console.log(`[CREATIVE-V3] Saved for approval: ${approvalResult.status} — ${matchKey}`);
    } catch (err) {
      console.error(`[CREATIVE-V3] Failed: ${err.message}`);
    }
  } catch (error) {
    console.error('[CREATIVE-V3] Error:', error.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'שגיאה ביצירת מודעה V3' });
    }
  }
});

// ============================================================
// Meta Ads Publish Pipeline
// ============================================================

// POST /api/meta/publish — פרסום קמפיין מאושר ל-Meta Ads Manager (PAUSED)
app.post('/api/meta/publish', async (req, res) => {
  try {
    const { matchKey, dailyBudgetILS, websiteUrl, imageUrl } = req.body;
    if (!matchKey) {
      return res.status(400).json({ error: 'חסר matchKey' });
    }

    console.log(`[META-PUBLISH] Publishing campaign for: ${matchKey}`);
    res.status(202).json({ status: 'received', matchKey, message: 'קמפיין בתהליך יצירה' });

    // Run in background
    publishCampaign(matchKey, { dailyBudgetILS, websiteUrl, imageUrl })
      .then((result) => console.log(`[META-PUBLISH] Campaign created: ${result.campaignId} (${result.status})`))
      .catch((err) => console.error(`[META-PUBLISH] Publish failed: ${err.message}`));
  } catch (error) {
    console.error('[META-PUBLISH] Publish error:', error.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'שגיאה ביצירת קמפיין' });
    }
  }
});

// GET /api/meta/campaigns — רשימת קמפיינים שפורסמו
app.get('/api/meta/campaigns', async (req, res) => {
  try {
    const campaigns = listPublishedCampaigns();
    res.json(campaigns);
  } catch (error) {
    console.error('[META-PUBLISH] List failed:', error.message);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// GET /api/meta/campaigns/:campaignId — סטטוס קמפיין מ-Meta
app.get('/api/meta/campaigns/:campaignId', async (req, res) => {
  try {
    const status = await getCampaignStatus(req.params.campaignId);
    res.json(status);
  } catch (error) {
    console.error('[META-PUBLISH] Status check failed:', error.message);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// POST /api/meta/campaigns/:campaignId/pause — השהיית קמפיין
app.post('/api/meta/campaigns/:campaignId/pause', async (req, res) => {
  try {
    const result = await pauseCampaign(req.params.campaignId);
    res.json(result);
  } catch (error) {
    console.error('[META-PUBLISH] Pause failed:', error.message);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// GET /api/meta/token-status — בדיקת תוקף Token
app.get('/api/meta/token-status', async (req, res) => {
  try {
    const status = await checkTokenValidity();
    res.json(status);
  } catch (error) {
    console.error('[META-PUBLISH] Token check failed:', error.message);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// POST /api/meta/token-refresh — חידוש Token ידני
app.post('/api/meta/token-refresh', async (req, res) => {
  try {
    const result = await refreshToken();
    res.json(result);
  } catch (error) {
    console.error('[META-PUBLISH] Token refresh failed:', error.message);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// POST /api/meta/upload-image — העלאת תמונה ל-Meta
app.post('/api/meta/upload-image', async (req, res) => {
  try {
    const { imageUrl } = req.body;
    if (!imageUrl) {
      return res.status(400).json({ error: 'חסר imageUrl' });
    }
    const result = await uploadAdImage(imageUrl);
    res.json(result);
  } catch (error) {
    console.error('[META-PUBLISH] Image upload failed:', error.message);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// GET /api/meta/audiences — רשימת קהלים מותאמים
app.get('/api/meta/audiences', async (req, res) => {
  try {
    const accountId = getAdAccountId();
    const result = await metaGet(`/${accountId}/customaudiences`, {
      fields: 'id,name,subtype',
      limit: 50,
    });
    res.json(result.data || []);
  } catch (error) {
    console.error('[META-PUBLISH] Audience list failed:', error.message);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// ============================================================
// Agent Chat — צ'אט AI לכל טאב בדאשבורד
// ============================================================
app.post('/api/agent-chat', handleAgentChat);

// ============================================================
// Agent Memory — persistent correction & preference memory
// ============================================================

// GET /api/agent-memory/:agent — get memory for a specific agent
app.get('/api/agent-memory/:agent', (req, res) => {
  try {
    const { agent } = req.params;
    const validAgents = ['intelligence', 'finance', 'creative', 'scout', 'cmo', 'meta', 'orchestrator', 'seo'];
    if (!validAgents.includes(agent)) {
      return res.status(400).json({ error: `סוכן לא מוכר: ${agent}` });
    }
    const memory = getAgentMemory(agent);
    res.json(memory);
  } catch (error) {
    console.error('[AGENT-MEMORY] Get failed:', error.message);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// POST /api/agent-memory/:agent — add manual memory entry
app.post('/api/agent-memory/:agent', (req, res) => {
  try {
    const { agent } = req.params;
    const { category, detail, preference } = req.body;
    const validAgents = ['intelligence', 'finance', 'creative', 'scout', 'cmo', 'meta', 'orchestrator', 'seo'];
    if (!validAgents.includes(agent)) {
      return res.status(400).json({ error: `סוכן לא מוכר: ${agent}` });
    }
    if (!category || !detail) {
      return res.status(400).json({ error: 'חובה לשלוח category ו-detail' });
    }
    const entry = addMemoryEntry(agent, { category, detail, preference });
    res.json(entry);
  } catch (error) {
    console.error('[AGENT-MEMORY] Add failed:', error.message);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// DELETE /api/agent-memory/:agent/:index — delete a specific memory entry
app.delete('/api/agent-memory/:agent/:index', (req, res) => {
  try {
    const { agent, index } = req.params;
    const validAgents = ['intelligence', 'finance', 'creative', 'scout', 'cmo', 'meta', 'orchestrator', 'seo'];
    if (!validAgents.includes(agent)) {
      return res.status(400).json({ error: `סוכן לא מוכר: ${agent}` });
    }
    const result = deleteMemoryEntry(agent, parseInt(index, 10));
    if (!result.deleted) {
      return res.status(404).json({ error: result.error });
    }
    res.json(result);
  } catch (error) {
    console.error('[AGENT-MEMORY] Delete failed:', error.message);
    res.status(500).json({ error: 'שגיאת שרת' });
  }
});

// ============================================================
// Creative Style Memory + Gallery
// ============================================================
app.post('/api/creative/style-feedback', async (req, res) => {
  try {
    const { type, note } = req.body;
    if (!type || !note) return res.status(400).json({ error: 'חובה לשלוח type ו-note' });
    const result = saveStyleFeedback(type, note);
    res.json(result);
  } catch (error) {
    console.error('[STYLE-MEMORY] Save failed:', error.message);
    res.status(500).json({ error: 'שגיאה בשמירת העדפה' });
  }
});

app.get('/api/creative/style-memory', async (req, res) => {
  try {
    const memory = getStyleMemory();
    res.json(memory);
  } catch (error) {
    console.error('[STYLE-MEMORY] Load failed:', error.message);
    res.status(500).json({ error: 'שגיאה בטעינת זיכרון סגנון' });
  }
});

app.get('/api/creative/gallery', async (req, res) => {
  try {
    const gallery = getGallery();
    res.json(gallery);
  } catch (error) {
    console.error('[GALLERY] Load failed:', error.message);
    res.status(500).json({ error: 'שגיאה בטעינת גלריה' });
  }
});

// ============================================================
// Cron — ניטור יומי בשעה 09:00
// ============================================================
cron.schedule('0 9 * * *', async () => {
  console.log('\n=== Scheduled Ad Monitor Run ===');
  try {
    const today = new Date().toISOString().split('T')[0];
    const results = await monitorCompetitorAds(today);
    await uploadDailyAdReport(results);

    for (const candidate of results.counterAdCandidates || []) {
      const mockAd = { classification: { format_type: candidate.format_type } };
      const decision = decideCounterAd(mockAd, candidate);

      if (decision.trigger_creative && decision.homeTeam && decision.awayTeam) {
        try {
          await generateCreative(decision.homeTeam, decision.awayTeam, 'Auto-detected', today);
        } catch (creativeErr) {
          console.error('שגיאה ביצירת פרסומת נגדית (cron):', creativeErr.message);
        }
      }
    }

    console.log('=== Scheduled Ad Monitor Completed ===\n');
  } catch (error) {
    console.error('שגיאה בריצת ניטור מתוזמן:', error.message);
  }
});

// ============================================================
// Cron — סריקה פרואקטיבית שבועית — שני 06:00
// ============================================================
cron.schedule('0 6 * * 1', async () => {
  console.log('\n=== Scheduled Proactive Scan (Mon 06:00) ===');
  try {
    const results = await proactiveScan();

    // Auto-trigger Rima for critical demand
    const criticalSuggestions = (results.suggestions || []).filter((s) => s.demandTier === 'critical');
    if (criticalSuggestions.length > 0) {
      console.log(`${criticalSuggestions.length} הצעות קריטיות — מפעיל Rima`);
      try {
        const biReport = await generateBIReport();
        await triggerRimaCampaign(biReport, results);
      } catch (rimaErr) {
        console.error('שגיאה ב-Rima (cron):', rimaErr.message);
      }
    }

    console.log('=== Scheduled Proactive Scan Complete ===\n');
  } catch (error) {
    console.error('שגיאה בסריקה פרואקטיבית מתוזמנת:', error.message);
  }
});

// ============================================================
// Cron — Intelligence Agent יומי — 04:00 UTC (07:00 IST)
// ============================================================
cron.schedule('0 4 * * *', async () => {
  console.log('\n=== Scheduled Intelligence Run (Daily 07:00 IST) ===');
  try {
    const today = new Date().toISOString().split('T')[0];
    const report = await runDailyIntelligence(today);

    // Send email
    const emailTo = process.env.INTELLIGENCE_EMAIL_TO;
    if (emailTo) {
      await sendReport(report, [emailTo]);
    }

    console.log(`[INTELLIGENCE] Cron complete — ${report.scoredEvents.length} events, ${report.recommendations.length} recommendations`);
    console.log('=== Scheduled Intelligence Complete ===\n');
  } catch (error) {
    console.error('שגיאה בריצת מודיעין מתוזמנת:', error.message);
  }
});

// ============================================================
// Cron — Finance Agent שבועי — ראשון 05:00 UTC (08:00 IST)
// ============================================================
cron.schedule('0 5 * * 0', async () => {
  console.log('\n=== Scheduled Finance Report (Sunday 08:00 IST) ===');
  try {
    const weekStart = getCurrentWeekStart();
    const report = await runWeeklyFinance(weekStart);

    const emailTo = process.env.FINANCE_EMAIL_TO;
    if (emailTo) {
      await sendFinanceReport(report, [emailTo]);
    }

    console.log(`[FINANCE] Cron complete — ${report.dataQuality?.totalDeals || 0} deals analyzed`);
    console.log('=== Scheduled Finance Report Complete ===\n');
  } catch (error) {
    console.error('שגיאה בריצת דוח פיננסי מתוזמן:', error.message);
  }
});

// ============================================================
// Cron — BI refresh יומי + בדיקת Rima — 02:00
// ============================================================
cron.schedule('0 2 * * *', async () => {
  console.log('\n=== Scheduled BI Refresh (Daily 02:00) ===');
  try {
    const biReport = await generateBIReport();

    // Check if patterns warrant Rima campaign
    if ((biReport.insights || []).length > 0) {
      console.log('תובנות BI זוהו — בודק אם לגרום ל-Rima');
      const result = await triggerRimaCampaign(biReport);
      console.log(`Rima: triggered=${result.triggered}, reason=${result.reason}`);
    }

    console.log('=== Scheduled BI Refresh Complete ===\n');
  } catch (error) {
    console.error('שגיאה ב-BI refresh מתוזמן:', error.message);
  }
});

// ============================================================
// Cron — Meta Token Health Check — 03:00 UTC (06:00 IST) יומי
// ============================================================
cron.schedule('0 3 * * *', async () => {
  console.log('\n=== Scheduled Token Health Check (Daily 06:00 IST) ===');
  try {
    const health = await tokenHealthCheck();
    console.log(`[TOKEN] Healthy: ${health.healthy}, Days remaining: ${health.daysRemaining}, Refreshed: ${health.refreshed}`);
    if (!health.healthy) {
      console.error('[TOKEN] CRITICAL: Meta token is invalid or expired!');
    }
    console.log('=== Token Health Check Complete ===\n');
  } catch (error) {
    console.error('שגיאה בבדיקת טוקן:', error.message);
  }
});

// ============================================================
// הפעלת השרת
// ============================================================
app.listen(PORT, () => {
  console.log(`Webhook Server — מאזין בפורט ${PORT}`);
  console.log(`בדיקת בריאות: http://localhost:${PORT}/health`);
  console.log(`Webhook URL: http://localhost:${PORT}/webhook`);
  console.log(`Ad Monitor: POST http://localhost:${PORT}/trigger-ad-monitor`);
  console.log(`Ad Monitor Report: GET http://localhost:${PORT}/api/ad-monitor/:date`);
  console.log(`Proactive Scan: POST http://localhost:${PORT}/trigger-proactive-scan`);
  console.log(`Demand Score: GET http://localhost:${PORT}/api/demand/:home/:away`);
  console.log(`BI Report: GET http://localhost:${PORT}/api/bi-report`);
  console.log(`Rima Campaign: POST http://localhost:${PORT}/trigger-rima-campaign`);
  console.log(`Dashboard: http://localhost:${PORT}/dashboard`);
  console.log(`Intelligence: GET http://localhost:${PORT}/api/intelligence/daily/:date`);
  console.log(`Heat Scores: GET http://localhost:${PORT}/api/intelligence/heat`);
  console.log(`Intelligence Scan: POST http://localhost:${PORT}/api/intelligence/scan`);
  console.log(`Send Report: POST http://localhost:${PORT}/api/intelligence/send-report`);
  console.log(`Finance Weekly: GET http://localhost:${PORT}/api/finance/weekly/:weekStart`);
  console.log(`Finance Event: GET http://localhost:${PORT}/api/finance/event/:eventName`);
  console.log(`Finance Campaign: GET http://localhost:${PORT}/api/finance/campaign/:campaignName`);
  console.log(`Finance Channels: GET http://localhost:${PORT}/api/finance/channels`);
  console.log(`Finance Budget: GET http://localhost:${PORT}/api/finance/budget-recommendation`);
  console.log(`Finance Alerts: GET http://localhost:${PORT}/api/finance/alerts`);
  console.log(`Finance Send: POST http://localhost:${PORT}/api/finance/send-report`);
  console.log(`Creative from Intel: POST http://localhost:${PORT}/api/creative/from-intelligence`);
  console.log(`Creative V3: POST http://localhost:${PORT}/api/creative/v3`);
  console.log(`Meta Publish: POST http://localhost:${PORT}/api/meta/publish`);
  console.log(`Meta Campaigns: GET http://localhost:${PORT}/api/meta/campaigns`);
  console.log(`Meta Campaign Status: GET http://localhost:${PORT}/api/meta/campaigns/:id`);
  console.log(`Meta Token Status: GET http://localhost:${PORT}/api/meta/token-status`);
  console.log(`Meta Token Refresh: POST http://localhost:${PORT}/api/meta/token-refresh`);
  console.log(`Meta Upload Image: POST http://localhost:${PORT}/api/meta/upload-image`);
  console.log(`Meta Audiences: GET http://localhost:${PORT}/api/meta/audiences`);
  console.log(`Orchestrator Status: GET http://localhost:${PORT}/api/orchestrator/status`);
  console.log(`Orchestrator Decisions: GET http://localhost:${PORT}/api/orchestrator/decisions`);
  console.log(`Orchestrator Hot Check: POST http://localhost:${PORT}/api/orchestrator/hot-check`);
  console.log(`Orchestrator Perf Check: POST http://localhost:${PORT}/api/orchestrator/perf-check`);
  console.log(`Orchestrator Execute: POST http://localhost:${PORT}/api/orchestrator/execute/:id`);
  console.log(`Orchestrator Setup Board: POST http://localhost:${PORT}/api/orchestrator/setup-board`);
  console.log(`Orchestrator Config: GET http://localhost:${PORT}/api/orchestrator/config`);
  console.log(`Orchestrator Pipeline: POST http://localhost:${PORT}/api/orchestrator/full-pipeline`);
  console.log(`Agent Chat: POST http://localhost:${PORT}/api/agent-chat`);
  console.log(`Style Memory: GET http://localhost:${PORT}/api/creative/style-memory`);
  console.log(`Style Feedback: POST http://localhost:${PORT}/api/creative/style-feedback`);
  console.log(`Gallery: GET http://localhost:${PORT}/api/creative/gallery`);
  console.log(`SEO Landing: POST http://localhost:${PORT}/api/seo/landing-page`);
  console.log(`SEO Blog: POST http://localhost:${PORT}/api/seo/blog-post`);
  console.log(`SEO Content: GET http://localhost:${PORT}/api/seo/content`);
  console.log(`SEO Health: GET http://localhost:${PORT}/api/seo/health`);
  initOrchestratorScheduler();
  console.log(`Cron: ניטור 09:00 | Intel 07:00 | Finance Sun 08:00 | BI 02:00 | Proactive Mon 06:00 | Token 06:00 | Hot Check 07:15 | Perf */6h`);
});
