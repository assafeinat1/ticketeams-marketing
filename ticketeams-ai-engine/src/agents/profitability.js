/**
 * Ticketeams Profitability Calculator
 *
 * Per-event, per-campaign, and per-channel financial calculations.
 * Data source: Monday.com Sales Board (1725685740) + Marketing Board (5046543095).
 *
 * CRITICAL RULES:
 * - Uses formula2 for profit — NEVER recalculates.
 * - ZERO-DELETION: Read-only Monday.com access.
 * - All financials in ₪ (Shekels).
 *
 * Usage:
 *   node src/agents/profitability.js              # selfTest
 *   node src/agents/profitability.js --fetch      # test data fetch
 *   node src/agents/profitability.js --events     # top events by revenue
 *   node src/agents/profitability.js --campaigns  # campaign ROAS
 *   node src/agents/profitability.js --channels   # channel breakdown
 */

require('dotenv').config();

const config = require('../config/finance-config.json');
const { getAllGroupItems, getBoardGroupItems } = require('../config/monday');

// ============================================================
// Config
// ============================================================

const SALES = config.boards.sales;
const MARKETING = config.boards.marketing;
const COL = config.salesColumns;
const CHANNEL_MAP = config.channelMapping;
const ALERT_THRESHOLDS = config.alerts;

// ============================================================
// Helpers
// ============================================================

function sanitizeError(err) {
  const msg = err?.message || String(err);
  return msg.replace(/Authorization[:\s]*\S+/gi, 'Authorization: [REDACTED]');
}

function safeFloat(val) {
  const n = parseFloat(val);
  return isNaN(n) ? 0 : n;
}

// ============================================================
// Column Parsing
// ============================================================

function parseSalesItem(item) {
  const columns = {};
  for (const col of item.column_values || []) {
    columns[col.id] = col.text;
  }

  return {
    id: item.id,
    name: item.name,
    matchName: columns[COL.matchName] || item.name || '',
    homeTeam: columns[COL.homeTeam] || '',
    gameDate: columns[COL.gameDate] || '',
    dealDate: columns[COL.dealDate] || '',
    channel: columns[COL.channel] || '',
    campaignName: columns[COL.campaignName] || '',
    closer: columns[COL.closer] || '',
    ticketQty: safeFloat(columns[COL.ticketQty]),
    finalPrice: safeFloat(columns[COL.finalPrice]),
    ticketCost: safeFloat(columns[COL.ticketCost]),
    commissions: safeFloat(columns[COL.commissions]),
    totalProfit: safeFloat(columns[COL.totalProfit]),
    grossMarginPct: safeFloat(columns[COL.grossMarginPct]),
    agentCommission: safeFloat(columns[COL.agentCommission]),
    clientType: columns[COL.clientType] || '',
    supplier: columns[COL.supplier] || '',
  };
}

function parseMarketingItem(item) {
  const columns = {};
  for (const col of item.column_values || []) {
    columns[col.id] = col.text;
  }

  return {
    id: item.id,
    name: item.name,
    columns,
  };
}

// ============================================================
// Channel Resolution
// ============================================================

// Build reverse lookup: Hebrew label → channel key
const _channelReverseLookup = new Map();
for (const [channelKey, labels] of Object.entries(CHANNEL_MAP)) {
  for (const label of labels) {
    _channelReverseLookup.set(label.trim().toLowerCase(), channelKey);
  }
}

function resolveChannel(rawLabel) {
  if (!rawLabel || !rawLabel.trim()) return 'other';
  const key = _channelReverseLookup.get(rawLabel.trim().toLowerCase());
  return key || 'other';
}

// ============================================================
// Data Fetching
// ============================================================

async function fetchSalesData() {
  console.log('[FINANCE] Fetching sales data (paginated)...');
  const rawItems = await getAllGroupItems(SALES.boardId, SALES.groupId);
  const parsed = rawItems.map(parseSalesItem);
  console.log(`[FINANCE] Fetched ${parsed.length} sales items`);
  return parsed;
}

async function fetchMarketingData() {
  console.log('[FINANCE] Fetching marketing data...');
  const rawItems = await getBoardGroupItems(MARKETING.boardId, MARKETING.groupId);
  const parsed = rawItems.map(parseMarketingItem);
  console.log(`[FINANCE] Fetched ${parsed.length} marketing items`);
  return parsed;
}

// ============================================================
// Per-Event Profitability
// ============================================================

function calculateEventProfitability(salesData) {
  const eventMap = new Map();

  for (const deal of salesData) {
    const key = deal.matchName.trim();
    if (!key) continue;

    if (!eventMap.has(key)) {
      eventMap.set(key, {
        eventName: key,
        homeTeam: deal.homeTeam,
        gameDate: deal.gameDate,
        dealCount: 0,
        totalTickets: 0,
        totalRevenue: 0,
        totalCost: 0,
        totalCommissions: 0,
        totalAgentCommission: 0,
        totalProfit: 0,
      });
    }

    const e = eventMap.get(key);
    e.dealCount++;
    e.totalTickets += deal.ticketQty;
    e.totalRevenue += deal.finalPrice;
    e.totalCost += deal.ticketCost;
    e.totalCommissions += deal.commissions;
    e.totalAgentCommission += deal.agentCommission;
    e.totalProfit += deal.totalProfit;
  }

  const events = Array.from(eventMap.values()).map((e) => ({
    ...e,
    totalRevenue: Math.round(e.totalRevenue),
    totalCost: Math.round(e.totalCost),
    totalProfit: Math.round(e.totalProfit),
    grossMarginPct: e.totalRevenue > 0
      ? Math.round(((e.totalRevenue - e.totalCost) / e.totalRevenue) * 1000) / 10
      : 0,
    netMarginPct: e.totalRevenue > 0
      ? Math.round((e.totalProfit / e.totalRevenue) * 1000) / 10
      : 0,
    avgProfitPerDeal: e.dealCount > 0
      ? Math.round(e.totalProfit / e.dealCount)
      : 0,
    avgRevenuePerTicket: e.totalTickets > 0
      ? Math.round(e.totalRevenue / e.totalTickets)
      : 0,
  }));

  events.sort((a, b) => b.totalRevenue - a.totalRevenue);
  return events;
}

// ============================================================
// Per-Campaign ROAS
// ============================================================

function calculateCampaignROAS(salesData, marketingData) {
  // Group sales by campaign name
  const campaignSales = new Map();
  let unattributedCount = 0;
  let unattributedRevenue = 0;

  for (const deal of salesData) {
    const campaign = deal.campaignName.trim();
    if (!campaign) {
      unattributedCount++;
      unattributedRevenue += deal.finalPrice;
      continue;
    }

    if (!campaignSales.has(campaign)) {
      campaignSales.set(campaign, {
        campaignName: campaign,
        dealCount: 0,
        totalRevenue: 0,
        totalProfit: 0,
        totalTickets: 0,
      });
    }

    const c = campaignSales.get(campaign);
    c.dealCount++;
    c.totalRevenue += deal.finalPrice;
    c.totalProfit += deal.totalProfit;
    c.totalTickets += deal.ticketQty;
  }

  // Try to match marketing board data to find ad spend
  const adSpendMap = new Map();
  for (const item of marketingData) {
    // Marketing board items: name is campaign name, columns may have spend/revenue data
    // We'll try to find spend columns by searching for common IDs
    const cols = item.columns;
    let spend = 0;
    let revenue = 0;
    let status = '';

    // Scan all columns for spend/revenue values
    for (const [id, text] of Object.entries(cols)) {
      const lower = id.toLowerCase();
      if (lower.includes('spend') || lower.includes('הוצאה') || lower.includes('budget')) {
        spend = safeFloat(text) || spend;
      }
      if (lower.includes('revenue') || lower.includes('הכנסה')) {
        revenue = safeFloat(text) || revenue;
      }
      if (lower.includes('status') || lower.includes('סטטוס')) {
        status = text || status;
      }
    }

    // Also check numeric columns for spend data
    for (const [id, text] of Object.entries(cols)) {
      if (id.startsWith('numbers') || id.startsWith('numeric')) {
        const val = safeFloat(text);
        if (val > 0 && !spend) spend = val;
      }
    }

    adSpendMap.set(item.name.trim().toLowerCase(), { spend, revenue, status });
  }

  // Build campaign results
  const campaigns = Array.from(campaignSales.values()).map((c) => {
    const marketingMatch = adSpendMap.get(c.campaignName.toLowerCase());
    const adSpend = marketingMatch?.spend || 0;
    const roas = adSpend > 0 ? Math.round((c.totalRevenue / adSpend) * 10) / 10 : null;
    const profitAfterAds = Math.round(c.totalProfit - adSpend);
    const cpa = c.dealCount > 0 && adSpend > 0 ? Math.round(adSpend / c.dealCount) : null;

    return {
      campaignName: c.campaignName,
      dealCount: c.dealCount,
      totalTickets: c.totalTickets,
      totalRevenue: Math.round(c.totalRevenue),
      totalProfit: Math.round(c.totalProfit),
      adSpend,
      roas,
      profitAfterAds,
      cpa,
      isPositiveROI: profitAfterAds > 0,
      marketingStatus: marketingMatch?.status || '',
    };
  });

  campaigns.sort((a, b) => b.totalRevenue - a.totalRevenue);

  const totalRevenue = salesData.reduce((s, d) => s + d.finalPrice, 0);

  return {
    campaigns,
    unattributed: {
      dealCount: unattributedCount,
      totalRevenue: Math.round(unattributedRevenue),
      pctOfTotal: totalRevenue > 0
        ? Math.round((unattributedRevenue / totalRevenue) * 1000) / 10
        : 0,
    },
  };
}

// ============================================================
// Per-Channel Performance
// ============================================================

function calculateChannelPerformance(salesData) {
  const channelMap = new Map();

  for (const deal of salesData) {
    const channelKey = resolveChannel(deal.channel);

    if (!channelMap.has(channelKey)) {
      channelMap.set(channelKey, {
        channel: channelKey,
        channelLabel: config.channelLabels[channelKey] || channelKey,
        dealCount: 0,
        totalTickets: 0,
        totalRevenue: 0,
        totalProfit: 0,
      });
    }

    const ch = channelMap.get(channelKey);
    ch.dealCount++;
    ch.totalTickets += deal.ticketQty;
    ch.totalRevenue += deal.finalPrice;
    ch.totalProfit += deal.totalProfit;
  }

  const totalRevenue = salesData.reduce((s, d) => s + d.finalPrice, 0);

  const channels = Array.from(channelMap.values()).map((ch) => ({
    ...ch,
    totalRevenue: Math.round(ch.totalRevenue),
    totalProfit: Math.round(ch.totalProfit),
    avgRevenuePerDeal: ch.dealCount > 0 ? Math.round(ch.totalRevenue / ch.dealCount) : 0,
    avgProfitPerDeal: ch.dealCount > 0 ? Math.round(ch.totalProfit / ch.dealCount) : 0,
    pctOfRevenue: totalRevenue > 0
      ? Math.round((ch.totalRevenue / totalRevenue) * 1000) / 10
      : 0,
  }));

  channels.sort((a, b) => b.totalRevenue - a.totalRevenue);
  return channels;
}

// ============================================================
// Week Filter
// ============================================================

function filterByWeek(salesData, weekStart) {
  const start = new Date(weekStart);
  const end = new Date(start);
  end.setDate(end.getDate() + 7);
  const startStr = start.toISOString().split('T')[0];
  const endStr = end.toISOString().split('T')[0];

  return salesData.filter((deal) => {
    const d = deal.dealDate;
    if (!d) return false;
    return d >= startStr && d < endStr;
  });
}

// ============================================================
// Alert Generation
// ============================================================

function generateAlerts(eventProfitability, campaignROAS, channelPerformance) {
  const alerts = [];
  const T = ALERT_THRESHOLDS;

  // Campaign ROAS alerts
  for (const c of campaignROAS.campaigns) {
    if (c.roas !== null && c.roas < T.roas_critical) {
      alerts.push({
        type: 'roas_critical',
        severity: 'critical',
        message: `קמפיין "${c.campaignName}" מפסיד כסף — ROAS ${c.roas}x`,
        data: { campaign: c.campaignName, roas: c.roas, adSpend: c.adSpend, revenue: c.totalRevenue },
      });
    } else if (c.roas !== null && c.roas < T.roas_minimum) {
      alerts.push({
        type: 'roas_warning',
        severity: 'warning',
        message: `קמפיין "${c.campaignName}" מתחת ליעד — ROAS ${c.roas}x (יעד: ${T.roas_minimum}x)`,
        data: { campaign: c.campaignName, roas: c.roas },
      });
    }
  }

  // Negative profit events
  for (const e of eventProfitability) {
    if (e.totalProfit < 0) {
      alerts.push({
        type: 'negative_profit',
        severity: 'critical',
        message: `אירוע "${e.eventName}" בהפסד — רווח ₪${e.totalProfit.toLocaleString()}`,
        data: { event: e.eventName, profit: e.totalProfit, revenue: e.totalRevenue },
      });
    }
    if (e.grossMarginPct < T.gross_margin_minimum && e.grossMarginPct > 0 && e.dealCount >= 3) {
      alerts.push({
        type: 'low_margin',
        severity: 'warning',
        message: `אירוע "${e.eventName}" — רווח גולמי ${e.grossMarginPct}% (מתחת ל-${T.gross_margin_minimum}%)`,
        data: { event: e.eventName, grossMarginPct: e.grossMarginPct },
      });
    }
  }

  // Underperforming channels
  for (const ch of channelPerformance) {
    if (ch.dealCount >= 10 && ch.avgProfitPerDeal < T.channel_profit_per_deal_min) {
      alerts.push({
        type: 'channel_underperform',
        severity: 'warning',
        message: `ערוץ "${ch.channelLabel}" — רווח ממוצע ₪${ch.avgProfitPerDeal}/עסקה (מתחת ל-₪${T.channel_profit_per_deal_min})`,
        data: { channel: ch.channelLabel, avgProfitPerDeal: ch.avgProfitPerDeal, dealCount: ch.dealCount },
      });
    }
  }

  // Attribution gap
  if (campaignROAS.unattributed.pctOfTotal > 30) {
    alerts.push({
      type: 'attribution_gap',
      severity: 'info',
      message: `${campaignROAS.unattributed.pctOfTotal}% מהעסקאות ללא שיוך לקמפיין (${campaignROAS.unattributed.dealCount} עסקאות, ₪${campaignROAS.unattributed.totalRevenue.toLocaleString()})`,
      data: campaignROAS.unattributed,
    });
  }

  // Sort: critical first, then warning, then info
  const severityOrder = { critical: 0, warning: 1, info: 2 };
  alerts.sort((a, b) => severityOrder[a.severity] - severityOrder[b.severity]);

  return alerts;
}

// ============================================================
// Self-test
// ============================================================

async function selfTest() {
  console.log('=== Profitability Calculator — בדיקה עצמית ===\n');

  // Fetch data
  const salesData = await fetchSalesData();
  const marketingData = await fetchMarketingData();

  // Event profitability
  const events = calculateEventProfitability(salesData);
  console.log(`\n--- Top 5 Events by Revenue ---`);
  for (const e of events.slice(0, 5)) {
    console.log(`  ${e.eventName}: ₪${e.totalRevenue.toLocaleString()} revenue, ₪${e.totalProfit.toLocaleString()} profit (${e.grossMarginPct}% margin, ${e.dealCount} deals)`);
  }

  // Campaign ROAS
  const roasResult = calculateCampaignROAS(salesData, marketingData);
  console.log(`\n--- Campaign ROAS ---`);
  for (const c of roasResult.campaigns.slice(0, 5)) {
    const roasStr = c.roas !== null ? `${c.roas}x` : 'N/A';
    console.log(`  ${c.campaignName}: ${c.dealCount} deals, ₪${c.totalRevenue.toLocaleString()} rev, ROAS ${roasStr}`);
  }
  console.log(`  Unattributed: ${roasResult.unattributed.dealCount} deals (${roasResult.unattributed.pctOfTotal}%)`);

  // Channel performance
  const channels = calculateChannelPerformance(salesData);
  console.log(`\n--- Channel Performance ---`);
  for (const ch of channels.slice(0, 5)) {
    console.log(`  ${ch.channelLabel}: ${ch.dealCount} deals, ₪${ch.totalRevenue.toLocaleString()} rev, ₪${ch.avgProfitPerDeal}/deal`);
  }

  // Alerts
  const alerts = generateAlerts(events, roasResult, channels);
  console.log(`\n--- Alerts (${alerts.length}) ---`);
  for (const a of alerts.slice(0, 5)) {
    console.log(`  [${a.severity}] ${a.message}`);
  }

  console.log('\n=== Profitability Calculator — מוכן ===');
}

module.exports = {
  fetchSalesData,
  fetchMarketingData,
  parseSalesItem,
  parseMarketingItem,
  resolveChannel,
  calculateEventProfitability,
  calculateCampaignROAS,
  calculateChannelPerformance,
  filterByWeek,
  generateAlerts,
};

if (require.main === module) {
  const arg = process.argv[2];
  if (arg === '--fetch') {
    fetchSalesData().then((d) => console.log(`Fetched ${d.length} items`)).catch((e) => console.error(sanitizeError(e)));
  } else if (arg === '--events') {
    selfTest().catch((e) => console.error(sanitizeError(e)));
  } else if (arg === '--campaigns') {
    selfTest().catch((e) => console.error(sanitizeError(e)));
  } else if (arg === '--channels') {
    selfTest().catch((e) => console.error(sanitizeError(e)));
  } else {
    selfTest().catch((e) => console.error(sanitizeError(e)));
  }
}
