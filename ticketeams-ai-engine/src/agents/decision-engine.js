/**
 * Ticketeams Decision Engine — Pure Logic
 *
 * Receives signals from various agents and returns structured decisions.
 * NO I/O, NO API calls, NO side effects — fully testable with mock data.
 *
 * Decision Types:
 *   CREATE_CAMPAIGN   — Hot event detected, suggest new campaign
 *   BOOST_CAMPAIGN    — Existing campaign for on-fire event, suggest resume + budget increase
 *   PAUSE_CAMPAIGN    — Critical ROAS, recommend pausing
 *   REDUCE_BUDGET     — Low ROAS, recommend budget reduction
 *   INCREASE_BUDGET   — High ROAS, recommend budget increase
 *   ALERT_ONLY        — Informational, no action needed
 *   LOG_ONLY          — Just log, no action
 *
 * RedRok Security Standard:
 * - Pure logic — no credentials needed.
 * - ZERO-DELETION: Never suggests DELETE operations.
 *
 * Usage:
 *   node src/agents/decision-engine.js   # selfTest with mock data
 */

const config = require('../config/orchestrator-config.json');

const THRESHOLDS = config.decisionRules.thresholds;
const AUTO_ACTIONS = config.decisionRules.autoActions;
const BUDGET = config.budgetDefaults;

// ============================================================
// Hot Event Evaluation
// ============================================================

/**
 * Evaluate scored events and return campaign decisions.
 *
 * @param {Array} scoredEvents - From scoreAllEvents() — each: { homeTeam, awayTeam, competition, date, score, tier, breakdown }
 * @param {Array} existingCampaigns - From listPublishedCampaigns() — each: { matchKey, campaignId, status }
 * @returns {Array} Decision objects
 */
function evaluateHotEvents(scoredEvents, existingCampaigns) {
  const decisions = [];

  for (const event of scoredEvents) {
    const { score, tier } = event;

    // Cold events: log only
    if (score < THRESHOLDS.hotEventMinScore) {
      continue;
    }

    // Warm events (36-59): flag in report, no action
    if (score < THRESHOLDS.createCampaignMinScore) {
      decisions.push({
        type: 'FLAG_IN_REPORT',
        requiresApproval: false,
        priority: 'low',
        event,
        suggestedAction: {
          action: 'monitor',
          reasoning: `Heat ${score} (${tier}) — מנטר, אין פעולה נדרשת`,
        },
      });
      continue;
    }

    // Hot/OnFire events (60+): check for existing campaign
    const eventKey = buildEventKey(event);
    const existing = existingCampaigns.find((c) =>
      c.matchKey && eventKey && normalizeKey(c.matchKey).includes(normalizeKey(eventKey))
    );

    if (existing) {
      // Campaign exists — check if it's paused and event is on-fire
      if (existing.status === 'PAUSED' && score >= THRESHOLDS.onFireMinScore) {
        decisions.push({
          type: 'BOOST_CAMPAIGN',
          requiresApproval: true,
          priority: 'high',
          event,
          existingCampaign: existing,
          suggestedAction: {
            action: 'resume_and_boost',
            campaignId: existing.campaignId,
            matchKey: existing.matchKey,
            suggestedBudgetILS: calculateSuggestedBudget(score),
            reasoning: `Heat ${score} (${tier}) — קמפיין קיים מושהה, מומלץ לחדש ולהגדיל תקציב`,
          },
        });
      }
      // Campaign exists and active — just log
      continue;
    }

    // No existing campaign — recommend creation
    const suggestedBudget = calculateSuggestedBudget(score);

    decisions.push({
      type: 'CREATE_CAMPAIGN',
      requiresApproval: true,
      priority: score >= THRESHOLDS.onFireMinScore ? 'high' : 'medium',
      event,
      existingCampaign: null,
      suggestedAction: {
        action: 'create_campaign',
        matchKey: eventKey,
        suggestedBudgetILS: suggestedBudget,
        targeting: selectTargetingTemplate(event),
        reasoning: `Heat ${score} (${tier}) — ${event.activeSources || '?'} מקורות פעילים, אין קמפיין קיים`,
      },
    });
  }

  // Sort by priority: high first
  const priorityOrder = { high: 0, medium: 1, low: 2 };
  decisions.sort((a, b) => (priorityOrder[a.priority] || 9) - (priorityOrder[b.priority] || 9));

  return decisions;
}

// ============================================================
// Performance Alert Evaluation
// ============================================================

/**
 * Evaluate finance alerts and campaign ROAS data for performance decisions.
 *
 * @param {Array} financeAlerts - From getAlerts() — each: { type, severity, message, data }
 * @param {Object} campaignROAS - From calculateCampaignROAS() — { campaigns: [...], unattributed: {...} }
 * @returns {Array} Decision objects
 */
function evaluatePerformanceAlerts(financeAlerts, campaignROAS) {
  const decisions = [];

  if (!campaignROAS || !campaignROAS.campaigns) return decisions;

  for (const campaign of campaignROAS.campaigns) {
    // Skip campaigns with no ROAS data
    if (campaign.roas === null || campaign.roas === undefined) continue;
    // Skip campaigns with too few deals for reliable data
    if (campaign.dealCount < 3) continue;

    // Critical: ROAS below pause threshold
    if (campaign.roas < THRESHOLDS.roasPauseThreshold) {
      decisions.push({
        type: 'PAUSE_CAMPAIGN',
        requiresApproval: true,
        priority: 'critical',
        campaign: {
          name: campaign.campaignName,
          roas: campaign.roas,
          adSpend: campaign.adSpend,
          totalRevenue: campaign.totalRevenue,
          totalProfit: campaign.totalProfit,
          dealCount: campaign.dealCount,
        },
        suggestedAction: {
          action: 'pause',
          reasoning: `ROAS ${campaign.roas}x — הקמפיין מפסיד כסף, מומלץ להשהות מיידית`,
        },
      });
      continue;
    }

    // Warning: ROAS below reduce threshold
    if (campaign.roas < THRESHOLDS.roasReduceThreshold) {
      const reducedBudget = campaign.adSpend
        ? Math.round(campaign.adSpend * THRESHOLDS.budgetReductionFactor)
        : 0;

      decisions.push({
        type: 'REDUCE_BUDGET',
        requiresApproval: true,
        priority: 'medium',
        campaign: {
          name: campaign.campaignName,
          roas: campaign.roas,
          adSpend: campaign.adSpend,
          totalRevenue: campaign.totalRevenue,
          dealCount: campaign.dealCount,
        },
        suggestedAction: {
          action: 'reduce_budget',
          suggestedBudgetILS: reducedBudget,
          reductionFactor: THRESHOLDS.budgetReductionFactor,
          reasoning: `ROAS ${campaign.roas}x — מתחת ליעד, מומלץ להפחית תקציב ב-${Math.round((1 - THRESHOLDS.budgetReductionFactor) * 100)}%`,
        },
      });
      continue;
    }

    // Excellent: ROAS above boost threshold
    if (campaign.roas >= THRESHOLDS.roasBoostThreshold) {
      const increasedBudget = campaign.adSpend
        ? Math.round(campaign.adSpend * THRESHOLDS.budgetIncreaseFactor)
        : 0;

      decisions.push({
        type: 'INCREASE_BUDGET',
        requiresApproval: true,
        priority: 'medium',
        campaign: {
          name: campaign.campaignName,
          roas: campaign.roas,
          adSpend: campaign.adSpend,
          totalRevenue: campaign.totalRevenue,
          dealCount: campaign.dealCount,
        },
        suggestedAction: {
          action: 'increase_budget',
          suggestedBudgetILS: increasedBudget,
          increaseFactor: THRESHOLDS.budgetIncreaseFactor,
          reasoning: `ROAS ${campaign.roas}x — ביצועים מצוינים, מומלץ להגדיל תקציב ב-${Math.round((THRESHOLDS.budgetIncreaseFactor - 1) * 100)}%`,
        },
      });
    }
  }

  // Add alerts for critical finance issues
  for (const alert of financeAlerts || []) {
    if (alert.severity === 'critical') {
      decisions.push({
        type: 'ALERT_ONLY',
        requiresApproval: false,
        priority: 'high',
        alert,
        suggestedAction: {
          action: 'alert',
          reasoning: alert.message,
        },
      });
    }
  }

  // Sort: critical first
  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  decisions.sort((a, b) => (priorityOrder[a.priority] || 9) - (priorityOrder[b.priority] || 9));

  return decisions;
}

// ============================================================
// Budget Change Evaluation
// ============================================================

/**
 * Evaluate budget recommendations from the budget recommender.
 *
 * @param {Array} budgetRecs - From recommendBudget() — each: { recommendation, campaignName, roas, suggestedSpend, ... }
 * @returns {Array} Decision objects
 */
function evaluateBudgetChanges(budgetRecs) {
  const decisions = [];

  for (const rec of budgetRecs || []) {
    // Skip non-actionable recommendations
    if (rec.recommendation === 'maintain' || rec.recommendation === 'insufficient_data' || rec.recommendation === 'no_spend_data') {
      continue;
    }

    if (rec.recommendation === 'increase') {
      decisions.push({
        type: 'INCREASE_BUDGET',
        requiresApproval: true,
        priority: 'medium',
        campaign: {
          name: rec.campaignName,
          roas: rec.roas,
          adSpend: rec.adSpend,
          dealCount: rec.dealCount,
        },
        suggestedAction: {
          action: 'increase_budget',
          suggestedBudgetILS: rec.suggestedSpend || 0,
          reasoning: rec.reason,
        },
      });
    } else if (rec.recommendation === 'reduce') {
      decisions.push({
        type: 'REDUCE_BUDGET',
        requiresApproval: true,
        priority: 'medium',
        campaign: {
          name: rec.campaignName,
          roas: rec.roas,
          adSpend: rec.adSpend,
          dealCount: rec.dealCount,
        },
        suggestedAction: {
          action: 'reduce_budget',
          suggestedBudgetILS: rec.suggestedSpend || 0,
          reasoning: rec.reason,
        },
      });
    } else if (rec.recommendation === 'pause') {
      decisions.push({
        type: 'PAUSE_CAMPAIGN',
        requiresApproval: true,
        priority: 'critical',
        campaign: {
          name: rec.campaignName,
          roas: rec.roas,
          adSpend: rec.adSpend,
          dealCount: rec.dealCount,
        },
        suggestedAction: {
          action: 'pause',
          reasoning: rec.reason,
        },
      });
    }
  }

  return decisions;
}

// ============================================================
// Decision Classification
// ============================================================

/**
 * Classify a decision as auto-executable or requiring approval.
 *
 * @param {Object} decision - A decision object
 * @returns {'auto' | 'approval_required'}
 */
function classifyDecision(decision) {
  // These action types are always automatic (no money involved)
  if (AUTO_ACTIONS.includes(decision.type)) {
    return 'auto';
  }

  // Everything that involves money or campaign changes requires approval
  return 'approval_required';
}

// ============================================================
// Helpers
// ============================================================

/**
 * Calculate suggested daily budget based on heat score.
 */
function calculateSuggestedBudget(heatScore) {
  if (heatScore >= THRESHOLDS.onFireMinScore) {
    return Math.round(BUDGET.baseDailyBudget * BUDGET.onFireMultiplier);
  }
  if (heatScore >= THRESHOLDS.createCampaignMinScore) {
    return Math.round(BUDGET.baseDailyBudget * BUDGET.hotEventMultiplier);
  }
  return BUDGET.baseDailyBudget;
}

/**
 * Select targeting template based on event data.
 */
function selectTargetingTemplate(event) {
  // If we have significant sales history → remarketing
  if (event.ticketeamsSalesCount > 5) return 'remarketing';
  // Default → broad prospecting
  return 'broad_prospecting';
}

/**
 * Build a normalized event key from event data.
 */
function buildEventKey(event) {
  const home = (event.homeTeam || '').replace(/\s+/g, '_');
  const away = (event.awayTeam || '').replace(/\s+/g, '_');
  const comp = (event.competition || 'unknown').replace(/\s+/g, '_');
  const date = event.date || '';
  if (!home || !away) return null;
  return `${home}__${away}__${comp}__${date}`;
}

/**
 * Normalize a key for comparison (lowercase, strip special chars).
 */
function normalizeKey(key) {
  return (key || '').toLowerCase().replace(/[^a-z0-9_]/g, '');
}

// ============================================================
// Self-test
// ============================================================

function selfTest() {
  console.log('=== Decision Engine — בדיקה עצמית ===\n');

  // Mock scored events
  const mockEvents = [
    { homeTeam: 'Arsenal', awayTeam: 'Chelsea', competition: 'Premier League', date: '2026-04-15', score: 78, tier: 'onFire', activeSources: 5 },
    { homeTeam: 'Barcelona', awayTeam: 'Bayern', competition: 'Champions League', date: '2026-04-22', score: 55, tier: 'hot', activeSources: 3 },
    { homeTeam: 'Milan', awayTeam: 'Napoli', competition: 'Serie A', date: '2026-05-01', score: 25, tier: 'warm', activeSources: 2 },
    { homeTeam: 'Real Madrid', awayTeam: 'PSG', competition: 'Champions League', date: '2026-04-18', score: 85, tier: 'onFire', activeSources: 6 },
  ];

  const mockCampaigns = [
    { matchKey: 'Arsenal__Chelsea__Premier_League__2026-04-15', campaignId: '123', status: 'PAUSED' },
  ];

  // Test hot event evaluation
  const hotDecisions = evaluateHotEvents(mockEvents, mockCampaigns);
  console.log(`Hot Event Decisions: ${hotDecisions.length}`);
  for (const d of hotDecisions) {
    console.log(`  [${d.priority}] ${d.type}: ${d.event.homeTeam} vs ${d.event.awayTeam} — ${d.suggestedAction.reasoning}`);
  }

  // Mock campaign ROAS
  const mockROAS = {
    campaigns: [
      { campaignName: 'מונדיאל 2026', roas: 8.5, adSpend: 5000, totalRevenue: 42500, totalProfit: 12000, dealCount: 15 },
      { campaignName: 'ליגת אלופות', roas: 0.7, adSpend: 3000, totalRevenue: 2100, totalProfit: -900, dealCount: 8 },
      { campaignName: 'פרמיירליג', roas: 1.3, adSpend: 2000, totalRevenue: 2600, totalProfit: 600, dealCount: 5 },
    ],
    unattributed: { dealCount: 100, totalRevenue: 500000, pctOfTotal: 57 },
  };

  // Test performance evaluation
  const perfDecisions = evaluatePerformanceAlerts([], mockROAS);
  console.log(`\nPerformance Decisions: ${perfDecisions.length}`);
  for (const d of perfDecisions) {
    console.log(`  [${d.priority}] ${d.type}: ${d.campaign.name} (ROAS ${d.campaign.roas}x) — ${d.suggestedAction.reasoning}`);
  }

  // Test classification
  console.log('\nClassification:');
  for (const d of [...hotDecisions, ...perfDecisions]) {
    console.log(`  ${d.type} → ${classifyDecision(d)}`);
  }

  // Test budget calculation
  console.log('\nBudget Suggestions:');
  console.log(`  Score 85 → ₪${calculateSuggestedBudget(85)} (onFire)`);
  console.log(`  Score 65 → ₪${calculateSuggestedBudget(65)} (hot)`);
  console.log(`  Score 40 → ₪${calculateSuggestedBudget(40)} (warm)`);

  console.log('\n=== Decision Engine — מוכן ===');
}

module.exports = {
  evaluateHotEvents,
  evaluatePerformanceAlerts,
  evaluateBudgetChanges,
  classifyDecision,
  calculateSuggestedBudget,
  selectTargetingTemplate,
  buildEventKey,
};

if (require.main === module) {
  selfTest();
}
