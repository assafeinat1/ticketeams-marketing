/**
 * Ticketeams Heat Scoring Agent
 *
 * Cross-references 6 independent data sources to calculate event "heat scores" (0-100).
 * Each source scores independently and catches its own errors → 0 on failure.
 *
 * Sources:
 *   1. Competitor Ads      → monitorCompetitorAds()
 *   2. Our Sales           → Monday board (sales)
 *   3. League Schedules    → fixture-monitor.js
 *   4. Competitor Websites  → proactiveScan()
 *   5. Our Website         → WooCommerce REST API
 *   6. Seasonality         → Config multiplier table
 *
 * RedRok Security Standard:
 * - Credentials via dotenv — NEVER printed.
 * - sanitizeError() on all errors.
 *
 * Usage:
 *   node src/agents/heat-scoring.js    # selfTest with mock data
 */

require('dotenv').config();
const axios = require('axios');

const config = require('../config/intelligence-config.json');
const venuesConfig = require('../config/venues.json');
const { getBoardGroupItems } = require('../config/monday');
const { monitorCompetitorAds } = require('./ad-monitor-agent');
const { fetchAllUpcomingFixtures } = require('./fixture-monitor');
const { proactiveScan } = require('./scout-agent');

// ============================================================
// Config
// ============================================================

const WEIGHTS = config.heatScore.weights;
const TIERS = config.heatScore.tiers;
const SEASONAL_MULTIPLIERS = config.heatScore.seasonalMultipliers;
const SALES_BOARD = config.mondayBoards.sales;
const WC_BASE = config.woocommerce.baseUrl;
const WC_KEY = process.env.WC_CONSUMER_KEY;
const WC_SECRET = process.env.WC_CONSUMER_SECRET;

// ============================================================
// Helpers
// ============================================================

function sanitizeError(err) {
  const msg = err?.message || String(err);
  return msg
    .replace(/consumer_key=\S+/gi, 'consumer_key=[REDACTED]')
    .replace(/consumer_secret=\S+/gi, 'consumer_secret=[REDACTED]');
}

function getTier(score) {
  for (const [tier, [min, max]] of Object.entries(TIERS)) {
    if (score >= min && score <= max) return tier;
  }
  return 'cold';
}

function normalizeTeamName(name) {
  return (name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

// Build bidirectional team name lookup: any name variant → canonical key
const _teamNameMap = new Map();
for (const [key, team] of Object.entries(venuesConfig.teams)) {
  _teamNameMap.set(key, key);
  const englishName = key.replace(/_/g, ' ');
  _teamNameMap.set(englishName, key);
  if (team.name_he) {
    _teamNameMap.set(normalizeTeamName(team.name_he), key);
  }
}

function resolveTeamKey(name) {
  const normalized = normalizeTeamName(name);
  return _teamNameMap.get(normalized) || null;
}

function teamsMatch(a, b) {
  const na = normalizeTeamName(a);
  const nb = normalizeTeamName(b);
  if (!na || !nb) return false;
  if (na === nb || na.includes(nb) || nb.includes(na)) return true;
  // Cross-language resolution via venues registry (English ↔ Hebrew)
  const keyA = resolveTeamKey(a);
  const keyB = resolveTeamKey(b);
  if (keyA && keyB && keyA === keyB) return true;
  return false;
}

// ============================================================
// Source 1: Competitor Ads
// ============================================================

function scoreCompetitorAds(competitorAds, homeTeam, awayTeam) {
  try {
    const relevantAds = (competitorAds || []).filter((ad) => {
      if (!ad.match_info?.matched) return false;
      return (
        (teamsMatch(ad.match_info.homeTeam, homeTeam) || teamsMatch(ad.match_info.awayTeam, homeTeam)) &&
        (teamsMatch(ad.match_info.homeTeam, awayTeam) || teamsMatch(ad.match_info.awayTeam, awayTeam))
      );
    });

    const count = relevantAds.length;
    if (count === 0) return { score: 0, detail: '0 competitor ads' };
    if (count <= 2) return { score: 30, detail: `${count} competitor ads` };
    if (count <= 5) return { score: 60, detail: `${count} competitor ads` };
    return { score: 100, detail: `${count} competitor ads (heavy competition)` };
  } catch (err) {
    console.warn('[HEAT] Source 1 (competitorAds) failed:', sanitizeError(err));
    return { score: 0, detail: 'source error' };
  }
}

// ============================================================
// Source 2: Our Sales (Monday.com)
// ============================================================

function scoreOurSales(salesItems, homeTeam, awayTeam) {
  try {
    const matchingItems = (salesItems || []).filter((item) => {
      const name = normalizeTeamName(item.name);
      return name.includes(normalizeTeamName(homeTeam)) && name.includes(normalizeTeamName(awayTeam));
    });

    const count = matchingItems.length;
    if (count === 0) return { score: 0, detail: '0 orders' };
    if (count <= 5) return { score: 20, detail: `${count} orders` };
    if (count <= 15) return { score: 50, detail: `${count} orders` };
    if (count <= 30) return { score: 75, detail: `${count} orders` };
    return { score: 100, detail: `${count} orders (high volume)` };
  } catch (err) {
    console.warn('[HEAT] Source 2 (ourSales) failed:', sanitizeError(err));
    return { score: 0, detail: 'source error' };
  }
}

// ============================================================
// Source 3: League Schedules
// ============================================================

function scoreLeagueSchedule(fixtures, homeTeam, awayTeam) {
  try {
    const match = (fixtures || []).find((f) =>
      teamsMatch(f.homeTeam, homeTeam) && teamsMatch(f.awayTeam, awayTeam)
    );

    if (!match) return { score: 0, detail: 'not in schedule' };

    let score = 60; // confirmed in schedule
    let detail = 'confirmed fixture';

    // Bonus: within 4-6 week ad window
    if (match.date) {
      const daysUntil = (new Date(match.date) - Date.now()) / (1000 * 60 * 60 * 24);
      if (daysUntil >= 28 && daysUntil <= 42) {
        score += 20;
        detail += ' + in 4-6wk ad window';
      }
    }

    // Rivalry bonus — top derbies (uses canonical keys for cross-language matching)
    const rivalries = [
      ['arsenal', 'tottenham'], ['liverpool', 'man_utd'], ['barcelona', 'real_madrid'],
      ['inter', 'milan'], ['bayern', 'dortmund'], ['psg', 'marseille'],
      ['man_city', 'man_utd'], ['chelsea', 'arsenal'], ['roma', 'lazio'],
    ];
    const hKey = resolveTeamKey(homeTeam) || normalizeTeamName(homeTeam);
    const aKey = resolveTeamKey(awayTeam) || normalizeTeamName(awayTeam);
    const isRivalry = rivalries.some(([r1, r2]) =>
      (hKey === r1 && aKey === r2) || (hKey === r2 && aKey === r1) ||
      (hKey.includes(r1) && aKey.includes(r2)) || (hKey.includes(r2) && aKey.includes(r1))
    );
    if (isRivalry) {
      score += 20;
      detail += ' + derby/rivalry';
    }

    return { score: Math.min(100, score), detail };
  } catch (err) {
    console.warn('[HEAT] Source 3 (leagueSchedule) failed:', sanitizeError(err));
    return { score: 0, detail: 'source error' };
  }
}

// ============================================================
// Source 4: Competitor Websites (proactiveScan results)
// ============================================================

function scoreCompetitorWebsites(scanSuggestions, homeTeam, awayTeam) {
  try {
    const relevantSuggestions = (scanSuggestions || []).filter((s) =>
      teamsMatch(s.homeTeam, homeTeam) && teamsMatch(s.awayTeam, awayTeam)
    );

    const count = relevantSuggestions.length;
    if (count === 0) return { score: 0, detail: '0 competitor sites' };
    if (count === 1) return { score: 40, detail: '1 competitor site selling' };
    return { score: 80, detail: `${count} competitor sites selling` };
  } catch (err) {
    console.warn('[HEAT] Source 4 (competitorWebsites) failed:', sanitizeError(err));
    return { score: 0, detail: 'source error' };
  }
}

// ============================================================
// Source 5: Our Website (WooCommerce)
// ============================================================

async function scoreOurWebsite(homeTeam, awayTeam) {
  try {
    if (!WC_KEY || !WC_SECRET) {
      return { score: 0, detail: 'WooCommerce credentials missing' };
    }

    // Resolve to Hebrew names for WooCommerce search (products are in Hebrew)
    const homeKey = resolveTeamKey(homeTeam);
    const awayKey = resolveTeamKey(awayTeam);
    const heHome = homeKey ? (venuesConfig.teams[homeKey]?.name_he || homeTeam) : homeTeam;
    const heAway = awayKey ? (venuesConfig.teams[awayKey]?.name_he || awayTeam) : awayTeam;
    const searchTerm = `${heHome} ${heAway}`.substring(0, 50);

    const response = await axios.get(`${WC_BASE}/products`, {
      params: {
        consumer_key: WC_KEY,
        consumer_secret: WC_SECRET,
        search: searchTerm,
        per_page: 10,
        status: 'publish',
      },
      timeout: 10000,
    });

    const products = response.data || [];
    if (products.length === 0) return { score: 0, detail: 'not listed on site' };

    // Check stock status
    const hasInStock = products.some((p) => p.stock_status === 'instock');
    const hasLowStock = products.some((p) =>
      p.stock_status === 'instock' && p.stock_quantity !== null && p.stock_quantity < 10
    );

    if (hasLowStock) return { score: 60, detail: 'listed + low stock' };
    if (hasInStock) return { score: 100, detail: 'listed + in stock' };
    return { score: 30, detail: 'listed but out of stock' };
  } catch (err) {
    console.warn('[HEAT] Source 5 (ourWebsite) failed:', sanitizeError(err));
    return { score: 0, detail: 'source error' };
  }
}

// ============================================================
// Source 6: Seasonality
// ============================================================

function scoreSeasonality(eventDate) {
  try {
    const month = eventDate
      ? new Date(eventDate).getMonth() + 1
      : new Date().getMonth() + 1;

    const multiplier = SEASONAL_MULTIPLIERS[String(month)] || 1.0;

    // Normalize: max multiplier is 1.8 → score 100
    const score = Math.round(Math.min(100, (multiplier / 1.8) * 100));
    const monthNames = ['', 'ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];
    return { score, detail: `${monthNames[month]} (×${multiplier})` };
  } catch (err) {
    console.warn('[HEAT] Source 6 (seasonality) failed:', sanitizeError(err));
    return { score: 0, detail: 'source error' };
  }
}

// ============================================================
// Heat Score Calculator
// ============================================================

/**
 * Calculates heat score for a single event using all 6 sources.
 * Each source is pre-fetched and passed in via context.
 */
async function calculateHeatScore(homeTeam, awayTeam, eventDate, context) {
  const {
    competitorAds = [],
    salesItems = [],
    fixtures = [],
    scanSuggestions = [],
  } = context || {};

  // Score each source
  const s1 = scoreCompetitorAds(competitorAds, homeTeam, awayTeam);
  const s2 = scoreOurSales(salesItems, homeTeam, awayTeam);
  const s3 = scoreLeagueSchedule(fixtures, homeTeam, awayTeam);
  const s4 = scoreCompetitorWebsites(scanSuggestions, homeTeam, awayTeam);
  const s5 = await scoreOurWebsite(homeTeam, awayTeam);
  const s6 = scoreSeasonality(eventDate);

  // Weighted sum
  const rawScore =
    (s1.score * WEIGHTS.competitorAds +
     s2.score * WEIGHTS.ourSales +
     s3.score * WEIGHTS.leagueSchedules +
     s4.score * WEIGHTS.competitorWebsites +
     s5.score * WEIGHTS.ourWebsite +
     s6.score * WEIGHTS.seasonality) / 100;

  // Apply seasonal multiplier
  const month = eventDate
    ? new Date(eventDate).getMonth() + 1
    : new Date().getMonth() + 1;
  const seasonalMultiplier = SEASONAL_MULTIPLIERS[String(month)] || 1.0;
  const finalScore = Math.min(100, Math.round(rawScore * seasonalMultiplier));

  const breakdown = {
    competitorAds: s1,
    ourSales: s2,
    leagueSchedules: s3,
    competitorWebsites: s4,
    ourWebsite: s5,
    seasonality: s6,
  };

  // Source indicators for report
  const activeSources = [];
  if (s1.score > 0) activeSources.push('ADS');
  if (s2.score > 0) activeSources.push('SALES');
  if (s3.score > 0) activeSources.push('NEW');
  if (s4.score > 0) activeSources.push('SITES');
  if (s5.score > 0) activeSources.push('SITE');
  if (s6.score > 50) activeSources.push('SEASON');

  return {
    homeTeam,
    awayTeam,
    eventDate,
    score: finalScore,
    tier: getTier(finalScore),
    breakdown,
    activeSources,
    rawScore: Math.round(rawScore),
    seasonalMultiplier,
  };
}

// ============================================================
// Batch Scoring — score all events from context
// ============================================================

/**
 * Builds a unified event list from all sources and scores each.
 * Returns events sorted by score descending.
 */
async function scoreAllEvents(context) {
  const { competitorAds = [], fixtures = [], scanSuggestions = [] } = context;

  // Build unique event set from all sources
  const eventMap = new Map();

  function addEvent(home, away, date, source) {
    if (!home || !away) return;
    const key = `${normalizeTeamName(home)}|${normalizeTeamName(away)}`;
    if (!eventMap.has(key)) {
      eventMap.set(key, { homeTeam: home, awayTeam: away, date, sources: [source] });
    } else {
      const e = eventMap.get(key);
      if (!e.sources.includes(source)) e.sources.push(source);
      if (!e.date && date) e.date = date;
    }
  }

  // From competitor ads
  for (const ad of competitorAds) {
    if (ad.match_info?.matched) {
      addEvent(ad.match_info.homeTeam, ad.match_info.awayTeam, null, 'competitor_ads');
    }
  }

  // From fixtures
  for (const f of fixtures) {
    addEvent(f.homeTeam, f.awayTeam, f.date, 'league_schedule');
  }

  // From scout scan suggestions
  for (const s of scanSuggestions) {
    addEvent(s.homeTeam, s.awayTeam, s.date, 'competitor_websites');
  }

  // Score each event
  const scored = [];
  for (const event of eventMap.values()) {
    const result = await calculateHeatScore(
      event.homeTeam,
      event.awayTeam,
      event.date,
      context
    );
    scored.push(result);
  }

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);
  return scored;
}

// ============================================================
// Fetch data sources (used by intelligence-agent)
// ============================================================

async function fetchAllSources(date) {
  const today = date || new Date().toISOString().split('T')[0];

  // Fetch all 6 sources — each catches its own errors
  const [adMonitor, salesItems, fixtures, scanResult] = await Promise.all([
    monitorCompetitorAds(today).catch((err) => {
      console.warn('[HEAT] Failed to fetch competitor ads:', sanitizeError(err));
      return { competitors: [], totalAds: 0 };
    }),
    getBoardGroupItems(SALES_BOARD.boardId, SALES_BOARD.groupId).catch((err) => {
      console.warn('[HEAT] Failed to fetch sales data:', sanitizeError(err));
      return [];
    }),
    fetchAllUpcomingFixtures().catch((err) => {
      console.warn('[HEAT] Failed to fetch fixtures:', sanitizeError(err));
      return [];
    }),
    proactiveScan().catch((err) => {
      console.warn('[HEAT] Failed to run proactive scan:', sanitizeError(err));
      return { suggestions: [] };
    }),
  ]);

  // Flatten competitor ads from all competitors
  const competitorAds = [];
  for (const comp of adMonitor.competitors || []) {
    for (const ad of comp.ads || []) {
      competitorAds.push(ad);
    }
  }

  // Merge scout fixtures when API fixtures are empty/sparse
  // Scout fixtures come from competitor sites (LiveTickets) — no API key needed
  let mergedFixtures = [...fixtures];
  const scoutFixtures = scanResult.fixtures || [];
  if (scoutFixtures.length > 0) {
    const existingKeys = new Set(
      fixtures.map((f) => `${normalizeTeamName(f.homeTeam)}|${normalizeTeamName(f.awayTeam)}`)
    );
    let added = 0;
    for (const sf of scoutFixtures) {
      const key = `${normalizeTeamName(sf.homeTeam)}|${normalizeTeamName(sf.awayTeam)}`;
      if (!existingKeys.has(key)) {
        existingKeys.add(key);
        added++;
        mergedFixtures.push({
          homeTeam: sf.homeTeam,
          awayTeam: sf.awayTeam,
          date: sf.date || null,
          competition: sf.competition || 'unknown',
          competitionCode: sf.competition || 'unknown',
          status: 'SCHEDULED',
          source: 'scout',
        });
      }
    }
    if (added > 0) {
      console.log(`[HEAT] Merged fixtures: ${fixtures.length} API + ${added} scout = ${mergedFixtures.length} total`);
    }
  }

  return {
    competitorAds,
    salesItems,
    fixtures: mergedFixtures,
    scanSuggestions: scanResult.suggestions || [],
    adMonitorResult: adMonitor,
    scanResult,
  };
}

// ============================================================
// Self-test
// ============================================================

async function selfTest() {
  console.log('=== Heat Scoring Agent — בדיקה עצמית ===\n');

  // Test with mock data
  const mockContext = {
    competitorAds: [
      {
        match_info: { matched: true, homeTeam: 'Arsenal', awayTeam: 'Chelsea' },
        classification: { format_type: 'Stadium' },
      },
      {
        match_info: { matched: true, homeTeam: 'Arsenal', awayTeam: 'Chelsea' },
        classification: { format_type: 'Human' },
      },
    ],
    salesItems: [
      { id: '1', name: 'Arsenal vs Chelsea', column_values: [] },
      { id: '2', name: 'Arsenal vs Chelsea', column_values: [] },
      { id: '3', name: 'Arsenal vs Chelsea', column_values: [] },
    ],
    fixtures: [
      { homeTeam: 'Arsenal', awayTeam: 'Chelsea', date: '2026-04-15', competition: 'Premier League' },
    ],
    scanSuggestions: [
      { homeTeam: 'Arsenal', awayTeam: 'Chelsea', demandScore: 80 },
    ],
  };

  const result = await calculateHeatScore('Arsenal', 'Chelsea', '2026-04-15', mockContext);

  console.log(`Event: Arsenal vs Chelsea`);
  console.log(`Score: ${result.score} (${result.tier})`);
  console.log(`Active Sources: [${result.activeSources.join('] [')}]`);
  console.log('\nBreakdown:');
  for (const [source, data] of Object.entries(result.breakdown)) {
    console.log(`  ${source}: ${data.score}/100 — ${data.detail}`);
  }

  console.log('\n=== Heat Scoring Agent — מוכן ===');
}

module.exports = {
  calculateHeatScore,
  scoreAllEvents,
  fetchAllSources,
  getTier,
  scoreCompetitorAds,
  scoreOurSales,
  scoreLeagueSchedule,
  scoreCompetitorWebsites,
  scoreOurWebsite,
  scoreSeasonality,
};

if (require.main === module) {
  selfTest().catch((err) => console.error('selfTest failed:', sanitizeError(err)));
}
