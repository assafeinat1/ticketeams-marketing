/**
 * Ticketeams Finance Agent — Main Orchestrator
 *
 * Calculates profitability per event/campaign/channel,
 * tracks ROAS, generates budget recommendations, and sends weekly reports.
 *
 * RedRok Security Standard:
 * - Credentials via dotenv — NEVER printed.
 * - sanitizeError() on all errors.
 * - ZERO-DELETION: No DELETE operations on Monday.com.
 *
 * Usage:
 *   node src/agents/finance-agent.js           # selfTest
 *   node src/agents/finance-agent.js --weekly  # full weekly finance run
 *   node src/agents/finance-agent.js --alerts  # current alerts
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const config = require('../config/finance-config.json');
const {
  fetchSalesData,
  fetchMarketingData,
  calculateEventProfitability,
  calculateCampaignROAS,
  calculateChannelPerformance,
  filterByWeek,
  generateAlerts,
} = require('./profitability');
const { recommendBudget, summarizeBudgetRecommendations } = require('./budget-recommender');
const { buildFinanceEmailHtml, sendFinanceReport, logReportToMonday } = require('./finance-report');

// ============================================================
// Config
// ============================================================

const CACHE_DIR = path.join(__dirname, '..', 'cache', 'finance');
const CACHE_TTL_HOURS = 24;

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

function getCachePath(weekStart) {
  return path.join(CACHE_DIR, `report-${weekStart}.json`);
}

function readCachedReport(weekStart) {
  try {
    const filePath = getCachePath(weekStart);
    if (!fs.existsSync(filePath)) return null;

    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const age = (Date.now() - new Date(raw.generatedAt).getTime()) / (1000 * 60 * 60);
    if (age > CACHE_TTL_HOURS) return null;

    return raw;
  } catch {
    return null;
  }
}

function writeCachedReport(weekStart, report) {
  try {
    ensureCacheDir();
    fs.writeFileSync(getCachePath(weekStart), JSON.stringify(report, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[FINANCE] Cache write failed:', sanitizeError(err));
  }
}

/**
 * Returns the most recent Sunday (start of current week).
 */
function getCurrentWeekStart() {
  const now = new Date();
  const day = now.getDay(); // 0=Sunday
  const diff = now.getDate() - day;
  return new Date(now.getFullYear(), now.getMonth(), diff).toISOString().split('T')[0];
}

// ============================================================
// Main Orchestrator
// ============================================================

/**
 * Full weekly finance run:
 * 1. Fetch all sales data (paginated)
 * 2. Fetch marketing data
 * 3. Calculate per-event profitability (all time)
 * 4. Filter to target week for weekly stats
 * 5. Calculate per-campaign ROAS
 * 6. Calculate per-channel performance
 * 7. Generate budget recommendations
 * 8. Generate alerts
 * 9. Build report
 * 10. Cache results
 */
async function runWeeklyFinance(weekStart) {
  const targetWeek = weekStart || getCurrentWeekStart();
  const weekEnd = new Date(new Date(targetWeek).getTime() + 6 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

  console.log(`\n[FINANCE] === Weekly Finance Run — ${targetWeek} to ${weekEnd} ===`);
  const startTime = Date.now();

  // Step 1-2: Fetch data
  console.log('[FINANCE] Step 1: Fetching data sources...');
  const [allSalesData, marketingData] = await Promise.all([
    fetchSalesData().catch((err) => {
      console.error('[FINANCE] Sales data fetch failed:', sanitizeError(err));
      return [];
    }),
    fetchMarketingData().catch((err) => {
      console.error('[FINANCE] Marketing data fetch failed:', sanitizeError(err));
      return [];
    }),
  ]);

  if (allSalesData.length === 0) {
    console.warn('[FINANCE] No sales data — cannot generate report');
    return { weekStart: targetWeek, weekEnd, generatedAt: new Date().toISOString(), error: 'No sales data' };
  }

  // Step 3: Per-event profitability (all time)
  console.log('[FINANCE] Step 2: Calculating profitability...');
  const eventProfitability = calculateEventProfitability(allSalesData);

  // Step 4: Weekly filter
  const weekSales = filterByWeek(allSalesData, targetWeek);
  const weekEvents = calculateEventProfitability(weekSales);

  // Step 5: Campaign ROAS
  const campaignROAS = calculateCampaignROAS(allSalesData, marketingData);
  const weekCampaignROAS = calculateCampaignROAS(weekSales, marketingData);

  // Step 6: Channel performance
  const channelPerformance = calculateChannelPerformance(allSalesData);
  const weekChannels = calculateChannelPerformance(weekSales);

  // Step 7: Budget recommendations
  console.log('[FINANCE] Step 3: Generating recommendations...');
  const budgetRecs = recommendBudget(campaignROAS);
  const budgetSummary = summarizeBudgetRecommendations(budgetRecs);

  // Step 8: Alerts
  const alerts = generateAlerts(eventProfitability, campaignROAS, channelPerformance);

  // Step 9: Build executive summary
  const totalRevenue = allSalesData.reduce((s, d) => s + d.finalPrice, 0);
  const totalProfit = allSalesData.reduce((s, d) => s + d.totalProfit, 0);
  const weekRevenue = weekSales.reduce((s, d) => s + d.finalPrice, 0);
  const weekProfit = weekSales.reduce((s, d) => s + d.totalProfit, 0);

  const executiveSummary = {
    totalRevenue: Math.round(weekRevenue),
    totalProfit: Math.round(weekProfit),
    netMarginPct: weekRevenue > 0 ? Math.round((weekProfit / weekRevenue) * 1000) / 10 : 0,
    dealCount: weekSales.length,
    allTimeTotalRevenue: Math.round(totalRevenue),
    allTimeTotalProfit: Math.round(totalProfit),
    allTimeDealCount: allSalesData.length,
    summaryText: weekSales.length > 0
      ? `השבוע נסגרו ${weekSales.length} עסקאות בהכנסה של ₪${Math.round(weekRevenue).toLocaleString()} ורווח נטו של ₪${Math.round(weekProfit).toLocaleString()}. ${budgetSummary.summaryText}`
      : `לא נסגרו עסקאות בשבוע זה. ${budgetSummary.summaryText}`,
  };

  // Step 10: Build final report
  const report = {
    weekStart: targetWeek,
    weekEnd,
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - startTime,
    executiveSummary,
    campaignPerformance: campaignROAS.campaigns,
    weekCampaignPerformance: weekCampaignROAS.campaigns,
    topEvents: eventProfitability.slice(0, 10),
    weekTopEvents: weekEvents.slice(0, 10),
    channelPerformance,
    weekChannelPerformance: weekChannels,
    budgetRecommendations: budgetRecs,
    budgetSummary,
    alerts,
    dataQuality: {
      totalDeals: allSalesData.length,
      weekDeals: weekSales.length,
      unattributedDeals: campaignROAS.unattributed.dealCount,
      unattributedPct: campaignROAS.unattributed.pctOfTotal,
      unattributedRevenue: campaignROAS.unattributed.totalRevenue,
    },
  };

  writeCachedReport(targetWeek, report);

  console.log(`[FINANCE] === Complete — ${report.durationMs}ms | ${allSalesData.length} total deals, ${weekSales.length} this week ===\n`);
  return report;
}

// ============================================================
// Public API
// ============================================================

async function getWeeklyReport(weekStart) {
  const cached = readCachedReport(weekStart);
  if (cached) {
    console.log(`[FINANCE] Returning cached report for ${weekStart}`);
    return cached;
  }
  return runWeeklyFinance(weekStart);
}

async function getEventProfitability(eventName) {
  const salesData = await fetchSalesData();
  const allEvents = calculateEventProfitability(salesData);

  const lower = eventName.toLowerCase();
  const match = allEvents.find((e) => e.eventName.toLowerCase().includes(lower));
  if (!match) return { error: 'אירוע לא נמצא', eventName };
  return match;
}

async function getCampaignProfitability(campaignName) {
  const [salesData, marketingData] = await Promise.all([fetchSalesData(), fetchMarketingData()]);
  const roasResult = calculateCampaignROAS(salesData, marketingData);

  const lower = campaignName.toLowerCase();
  const match = roasResult.campaigns.find((c) => c.campaignName.toLowerCase().includes(lower));
  if (!match) return { error: 'קמפיין לא נמצא', campaignName };
  return match;
}

async function getChannelPerformance() {
  const salesData = await fetchSalesData();
  return calculateChannelPerformance(salesData);
}

async function getBudgetRecommendation() {
  const [salesData, marketingData] = await Promise.all([fetchSalesData(), fetchMarketingData()]);
  const roasResult = calculateCampaignROAS(salesData, marketingData);
  const recs = recommendBudget(roasResult);
  const summary = summarizeBudgetRecommendations(recs);
  return { recommendations: recs, summary, unattributed: roasResult.unattributed };
}

async function getAlerts() {
  const [salesData, marketingData] = await Promise.all([fetchSalesData(), fetchMarketingData()]);
  const events = calculateEventProfitability(salesData);
  const roasResult = calculateCampaignROAS(salesData, marketingData);
  const channels = calculateChannelPerformance(salesData);
  return generateAlerts(events, roasResult, channels);
}

// ============================================================
// המלצת תקציב לאירוע בודד — לפי heatScore ומועד המשחק
// ============================================================
function getEventBudgetRecommendation(eventName, heatScore, gameDate) {
  // 1. תקציב יומי לפי heatScore
  let recommendedDailyBudget;
  if (heatScore >= 80) recommendedDailyBudget = 300;
  else if (heatScore >= 60) recommendedDailyBudget = 225;
  else if (heatScore >= 36) recommendedDailyBudget = 150;
  else recommendedDailyBudget = 100;

  // 2. משך קמפיין לפי ימים עד המשחק
  const now = new Date();
  const game = gameDate ? new Date(gameDate) : null;
  const daysUntilGame = game && !isNaN(game.getTime())
    ? Math.max(0, Math.ceil((game - now) / (1000 * 60 * 60 * 24)))
    : null;

  let recommendedDuration;
  if (daysUntilGame === null) recommendedDuration = 14;
  else if (daysUntilGame > 30) recommendedDuration = 21;
  else if (daysUntilGame >= 14) recommendedDuration = 14;
  else if (daysUntilGame >= 7) recommendedDuration = 7;
  else recommendedDuration = Math.max(1, daysUntilGame);

  // 3. טירגוט — heatScore גבוה = קהל רחב (כולל ביקוש), אחרת lookalike
  let recommendedTargeting;
  if (heatScore >= 60) recommendedTargeting = 'broad_prospecting';
  else recommendedTargeting = 'purchase_lookalike';

  // 4. ROAS צפוי — null עד שיצטבר מידע מקמפיינים קודמים
  const expectedROAS = null;

  return {
    eventName: eventName || 'unknown',
    heatScore: heatScore || 0,
    recommendedDailyBudget,
    expectedROAS,
    recommendedDuration,
    recommendedTargeting,
    totalEstimatedBudget: recommendedDailyBudget * recommendedDuration,
    daysUntilGame,
  };
}

// ============================================================
// Self-test
// ============================================================

async function selfTest() {
  console.log('=== Finance Agent — בדיקה עצמית ===\n');

  console.log('Config:');
  console.log(`  Sales Board: ${config.boards.sales.boardId} (group: ${config.boards.sales.groupId})`);
  console.log(`  Marketing Board: ${config.boards.marketing.boardId}`);
  console.log(`  Cache Dir: ${CACHE_DIR}`);
  console.log(`  Email: ${process.env.FINANCE_EMAIL_TO || 'NOT SET'}`);
  console.log(`  Channel Mapping: ${Object.keys(config.channelMapping).length} channels`);

  console.log('\nModule imports:');
  console.log('  profitability: ✓');
  console.log('  budget-recommender: ✓');
  console.log('  finance-report: ✓');

  console.log('\n=== Finance Agent — מוכן ===');
}

module.exports = {
  runWeeklyFinance,
  getWeeklyReport,
  getEventProfitability,
  getCampaignProfitability,
  getChannelPerformance,
  getBudgetRecommendation,
  getEventBudgetRecommendation,
  getAlerts,
  getCurrentWeekStart,
};

if (require.main === module) {
  const arg = process.argv[2];

  if (arg === '--weekly') {
    runWeeklyFinance()
      .then((report) => {
        console.log('\n--- Report Summary ---');
        console.log(`Week: ${report.weekStart} — ${report.weekEnd}`);
        console.log(`All-time deals: ${report.dataQuality?.totalDeals}`);
        console.log(`This week: ${report.dataQuality?.weekDeals} deals`);
        console.log(`Revenue: ₪${report.executiveSummary?.totalRevenue?.toLocaleString()}`);
        console.log(`Profit: ₪${report.executiveSummary?.totalProfit?.toLocaleString()}`);
        console.log(`Alerts: ${report.alerts?.length}`);
        console.log(`Unattributed: ${report.dataQuality?.unattributedPct}%`);
        console.log(`Duration: ${report.durationMs}ms`);

        // Send email if configured
        const emailTo = process.env.FINANCE_EMAIL_TO;
        if (emailTo) {
          return sendFinanceReport(report, [emailTo]);
        }
      })
      .catch((err) => console.error('Weekly run failed:', sanitizeError(err)));
  } else if (arg === '--alerts') {
    getAlerts()
      .then((alerts) => {
        console.log(`\n--- Alerts (${alerts.length}) ---`);
        for (const a of alerts) {
          console.log(`  [${a.severity}] ${a.message}`);
        }
      })
      .catch((err) => console.error('Alerts failed:', sanitizeError(err)));
  } else {
    selfTest().catch((err) => console.error('selfTest failed:', sanitizeError(err)));
  }
}
