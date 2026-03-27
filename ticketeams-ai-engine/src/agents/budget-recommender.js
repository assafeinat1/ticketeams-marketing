/**
 * Ticketeams Budget Recommender
 *
 * Ranks campaigns by ROAS and recommends budget actions:
 *   increase (≥5x), maintain (≥2x), reduce (≥1x), pause (<1x)
 *
 * Usage:
 *   node src/agents/budget-recommender.js    # selfTest with mock data
 */

const config = require('../config/finance-config.json');

const THRESHOLDS = config.budgetRecommendation;
const MIN_DEALS = config.alerts?.cpa_maximum ? 3 : 3; // minimum deals for reliable stats

// ============================================================
// Budget Recommendation
// ============================================================

/**
 * Ranks campaigns by ROAS and recommends budget action.
 * @param {Object} campaignROAS - Output from calculateCampaignROAS()
 * @returns {Array} Recommendations sorted by priority
 */
function recommendBudget(campaignROAS) {
  const recommendations = [];

  for (const c of campaignROAS.campaigns) {
    // Skip campaigns with no ad spend data
    if (c.roas === null) {
      recommendations.push({
        campaignName: c.campaignName,
        dealCount: c.dealCount,
        totalRevenue: c.totalRevenue,
        totalProfit: c.totalProfit,
        adSpend: 0,
        roas: null,
        recommendation: 'no_spend_data',
        reason: 'אין נתוני הוצאה — לא ניתן לחשב ROAS',
        suggestedAction: 'לעדכן הוצאה בלוח שיווק',
      });
      continue;
    }

    // Not enough data
    if (c.dealCount < MIN_DEALS) {
      recommendations.push({
        campaignName: c.campaignName,
        dealCount: c.dealCount,
        totalRevenue: c.totalRevenue,
        totalProfit: c.totalProfit,
        adSpend: c.adSpend,
        roas: c.roas,
        recommendation: 'insufficient_data',
        reason: `רק ${c.dealCount} עסקאות — צריך לפחות ${MIN_DEALS} למדד אמין`,
        suggestedAction: 'להמשיך לאסוף נתונים',
      });
      continue;
    }

    // Increase: ROAS >= 5x
    if (c.roas >= THRESHOLDS.increaseThreshold) {
      const increase = Math.round(c.adSpend * THRESHOLDS.increaseMultiplier);
      recommendations.push({
        campaignName: c.campaignName,
        dealCount: c.dealCount,
        totalRevenue: c.totalRevenue,
        totalProfit: c.totalProfit,
        adSpend: c.adSpend,
        roas: c.roas,
        recommendation: 'increase',
        reason: `ROAS ${c.roas}x — ביצועים מצוינים`,
        suggestedAction: `להגדיל תקציב ל-₪${increase.toLocaleString()} (+${Math.round((THRESHOLDS.increaseMultiplier - 1) * 100)}%)`,
        suggestedSpend: increase,
      });
    }
    // Maintain: ROAS >= 2x
    else if (c.roas >= THRESHOLDS.maintainThreshold) {
      recommendations.push({
        campaignName: c.campaignName,
        dealCount: c.dealCount,
        totalRevenue: c.totalRevenue,
        totalProfit: c.totalProfit,
        adSpend: c.adSpend,
        roas: c.roas,
        recommendation: 'maintain',
        reason: `ROAS ${c.roas}x — ביצועים תקינים`,
        suggestedAction: 'לשמור על תקציב נוכחי',
      });
    }
    // Reduce: ROAS >= 1x
    else if (c.roas >= THRESHOLDS.reduceThreshold) {
      const reduced = Math.round(c.adSpend * THRESHOLDS.reduceMultiplier);
      recommendations.push({
        campaignName: c.campaignName,
        dealCount: c.dealCount,
        totalRevenue: c.totalRevenue,
        totalProfit: c.totalProfit,
        adSpend: c.adSpend,
        roas: c.roas,
        recommendation: 'reduce',
        reason: `ROAS ${c.roas}x — מתחת ליעד`,
        suggestedAction: `להפחית תקציב ל-₪${reduced.toLocaleString()} (-${Math.round((1 - THRESHOLDS.reduceMultiplier) * 100)}%)`,
        suggestedSpend: reduced,
      });
    }
    // Pause: ROAS < 1x
    else {
      recommendations.push({
        campaignName: c.campaignName,
        dealCount: c.dealCount,
        totalRevenue: c.totalRevenue,
        totalProfit: c.totalProfit,
        adSpend: c.adSpend,
        roas: c.roas,
        recommendation: 'pause',
        reason: `ROAS ${c.roas}x — מפסיד כסף`,
        suggestedAction: 'להשהות מיידית ולבחון מחדש',
        suggestedSpend: 0,
      });
    }
  }

  // Sort: increase first, then maintain, reduce, pause, data issues last
  const order = { increase: 0, maintain: 1, reduce: 2, pause: 3, insufficient_data: 4, no_spend_data: 5 };
  recommendations.sort((a, b) => order[a.recommendation] - order[b.recommendation]);

  return recommendations;
}

// ============================================================
// Executive Summary
// ============================================================

function summarizeBudgetRecommendations(recommendations) {
  const byAction = { increase: 0, maintain: 0, reduce: 0, pause: 0, insufficient_data: 0, no_spend_data: 0 };
  for (const r of recommendations) {
    byAction[r.recommendation] = (byAction[r.recommendation] || 0) + 1;
  }

  const withRoas = recommendations.filter((r) => r.roas !== null);
  const topPerformer = withRoas.length > 0
    ? withRoas.reduce((best, r) => (r.roas > best.roas ? r : best))
    : null;
  const worstPerformer = withRoas.length > 0
    ? withRoas.reduce((worst, r) => (r.roas < worst.roas ? r : worst))
    : null;

  const parts = [];
  if (byAction.increase > 0) parts.push(`${byAction.increase} קמפיינים להגדלה`);
  if (byAction.maintain > 0) parts.push(`${byAction.maintain} לשימור`);
  if (byAction.reduce > 0) parts.push(`${byAction.reduce} להפחתה`);
  if (byAction.pause > 0) parts.push(`${byAction.pause} להשהייה`);

  const summaryText = parts.length > 0
    ? `המלצת תקציב: ${parts.join(', ')}.`
    : 'אין מספיק נתונים להמלצת תקציב.';

  return {
    totalCampaigns: recommendations.length,
    byAction,
    topPerformer: topPerformer ? { name: topPerformer.campaignName, roas: topPerformer.roas } : null,
    worstPerformer: worstPerformer ? { name: worstPerformer.campaignName, roas: worstPerformer.roas } : null,
    summaryText,
  };
}

// ============================================================
// Self-test
// ============================================================

function selfTest() {
  console.log('=== Budget Recommender — בדיקה עצמית ===\n');

  const mockCampaignROAS = {
    campaigns: [
      { campaignName: 'מונדיאל 2026', dealCount: 22, totalRevenue: 154000, totalProfit: 20000, adSpend: 4900, roas: 31.4, cpa: 223 },
      { campaignName: 'צמדים ליגת אלופות', dealCount: 28, totalRevenue: 116000, totalProfit: 14000, adSpend: 2300, roas: 50.4, cpa: 82 },
      { campaignName: 'שלבי הכרעה אלופות', dealCount: 6, totalRevenue: 32000, totalProfit: 6000, adSpend: 3200, roas: 0.47, cpa: 533 },
      { campaignName: 'ליגה אנגלית אתר', dealCount: 2, totalRevenue: 5000, totalProfit: 1000, adSpend: 1500, roas: 3.3, cpa: 750 },
    ],
    unattributed: { dealCount: 1003, totalRevenue: 4469312, pctOfTotal: 57 },
  };

  const recs = recommendBudget(mockCampaignROAS);
  const summary = summarizeBudgetRecommendations(recs);

  console.log('Recommendations:');
  for (const r of recs) {
    console.log(`  [${r.recommendation}] ${r.campaignName}: ROAS ${r.roas}x — ${r.reason}`);
  }

  console.log(`\nSummary: ${summary.summaryText}`);
  if (summary.topPerformer) console.log(`Top: ${summary.topPerformer.name} (${summary.topPerformer.roas}x)`);
  if (summary.worstPerformer) console.log(`Worst: ${summary.worstPerformer.name} (${summary.worstPerformer.roas}x)`);

  console.log('\n=== Budget Recommender — מוכן ===');
}

module.exports = { recommendBudget, summarizeBudgetRecommendations };

if (require.main === module) {
  selfTest();
}
