/**
 * Ticketeams Intelligence Agent — Main Orchestrator
 *
 * Cross-references 6 data sources to calculate event heat scores,
 * generates recommendations, and sends daily intelligence email reports.
 *
 * RedRok Security Standard:
 * - Credentials via dotenv — NEVER printed.
 * - sanitizeError() on all errors.
 * - ZERO-DELETION: No DELETE operations on Monday.com.
 *
 * Usage:
 *   node src/agents/intelligence-agent.js           # selfTest
 *   node src/agents/intelligence-agent.js --daily   # full daily intelligence run
 *   node src/agents/intelligence-agent.js --heat    # heat scores only
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');

const config = require('../config/intelligence-config.json');
const { getBoardGroupItems } = require('../config/monday');
const { fetchAllSources, scoreAllEvents } = require('./heat-scoring');
const { buildEmailHtml, sendReport, generateRecommendations } = require('./intelligence-report');

// ============================================================
// Config
// ============================================================

const CACHE_DIR = path.join(__dirname, '..', 'cache', 'intelligence');
const CACHE_TTL_HOURS = 24;
const MARKETING_BOARD = config.mondayBoards.marketing;

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

function getCachePath(date) {
  return path.join(CACHE_DIR, `report-${date}.json`);
}

function readCachedReport(date) {
  try {
    const filePath = getCachePath(date);
    if (!fs.existsSync(filePath)) return null;

    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const age = (Date.now() - new Date(raw.generatedAt).getTime()) / (1000 * 60 * 60);
    if (age > CACHE_TTL_HOURS) return null;

    return raw;
  } catch {
    return null;
  }
}

function writeCachedReport(date, report) {
  try {
    ensureCacheDir();
    fs.writeFileSync(getCachePath(date), JSON.stringify(report, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[INTELLIGENCE] Cache write failed:', sanitizeError(err));
  }
}

// ============================================================
// Main Orchestrator
// ============================================================

/**
 * Full daily intelligence run:
 * 1. Fetch all 6 data sources
 * 2. Score all events
 * 3. Generate recommendations
 * 4. Build email report
 * 5. Cache results
 */
async function runDailyIntelligence(date) {
  const today = date || new Date().toISOString().split('T')[0];
  console.log(`\n[INTELLIGENCE] === Daily Intelligence Run — ${today} ===`);

  const startTime = Date.now();

  // Step 1: Fetch all data sources
  console.log('[INTELLIGENCE] Step 1: Fetching all data sources...');
  const sources = await fetchAllSources(today);
  console.log(`[INTELLIGENCE] Sources ready: ${sources.competitorAds.length} ads, ${sources.salesItems.length} sales, ${sources.fixtures.length} fixtures, ${sources.scanSuggestions.length} scan suggestions`);

  // Step 2: Fetch marketing board for recommendation cross-reference
  let marketingItems = [];
  try {
    marketingItems = await getBoardGroupItems(MARKETING_BOARD.boardId, MARKETING_BOARD.groupId);
    console.log(`[INTELLIGENCE] Marketing board: ${marketingItems.length} active campaigns`);
  } catch (err) {
    console.warn('[INTELLIGENCE] Marketing board fetch failed:', sanitizeError(err));
  }

  // Step 3: Score all events
  console.log('[INTELLIGENCE] Step 2: Scoring all events...');
  const scoredEvents = await scoreAllEvents(sources);
  console.log(`[INTELLIGENCE] Scored ${scoredEvents.length} events`);

  // Step 4: Generate recommendations
  console.log('[INTELLIGENCE] Step 3: Generating recommendations...');
  const recommendations = generateRecommendations(scoredEvents, marketingItems);
  console.log(`[INTELLIGENCE] Generated ${recommendations.length} recommendations`);

  // Step 5: Build report data
  const newCompetitorAds = sources.competitorAds.slice(0, 20);
  const totalAds = sources.adMonitorResult?.totalAds || sources.competitorAds.length;

  const report = {
    date: today,
    generatedAt: new Date().toISOString(),
    durationMs: Date.now() - startTime,
    totalAds,
    scoredEvents,
    newCompetitorAds,
    recommendations,
    sourceSummary: {
      competitorAds: sources.competitorAds.length,
      salesItems: sources.salesItems.length,
      fixtures: sources.fixtures.length,
      scanSuggestions: sources.scanSuggestions.length,
      marketingItems: marketingItems.length,
    },
  };

  // Cache report
  writeCachedReport(today, report);

  console.log(`[INTELLIGENCE] === Complete — ${report.durationMs}ms ===\n`);
  return report;
}

// ============================================================
// Public API
// ============================================================

/**
 * Get intelligence report for a specific date (cached or fresh).
 */
async function getIntelligenceForDate(date) {
  const cached = readCachedReport(date);
  if (cached) {
    console.log(`[INTELLIGENCE] Returning cached report for ${date}`);
    return cached;
  }
  return runDailyIntelligence(date);
}

/**
 * Get heat score for a single event.
 */
async function getHeatScoreForEvent(eventKey) {
  // Parse eventKey format: homeTeam__awayTeam__competition__date
  const parts = eventKey.split('__');
  const homeTeam = (parts[0] || '').replace(/_/g, ' ');
  const awayTeam = (parts[1] || '').replace(/_/g, ' ');
  const eventDate = parts[3] || null;

  const sources = await fetchAllSources();
  const { calculateHeatScore } = require('./heat-scoring');
  return calculateHeatScore(homeTeam, awayTeam, eventDate, sources);
}

/**
 * Get all heat scores (from cached report or fresh run).
 */
async function getAllHeatScores() {
  const today = new Date().toISOString().split('T')[0];
  const report = await getIntelligenceForDate(today);
  return (report.scoredEvents || []).map((e) => ({
    homeTeam: e.homeTeam,
    awayTeam: e.awayTeam,
    score: e.score,
    tier: e.tier,
    activeSources: e.activeSources,
    eventDate: e.eventDate,
  }));
}

/**
 * Trigger a manual scan (returns immediately, runs in background).
 */
async function triggerManualScan() {
  const today = new Date().toISOString().split('T')[0];
  // Clear cache to force fresh run
  try {
    const cachePath = getCachePath(today);
    if (fs.existsSync(cachePath)) fs.unlinkSync(cachePath);
  } catch { /* ignore */ }
  return runDailyIntelligence(today);
}

// ============================================================
// Self-test
// ============================================================

async function selfTest() {
  console.log('=== Intelligence Agent — בדיקה עצמית ===\n');

  console.log('Config:');
  console.log(`  Weights: ${JSON.stringify(config.heatScore.weights)}`);
  console.log(`  Sales Board: ${MARKETING_BOARD.boardId}`);
  console.log(`  Cache Dir: ${CACHE_DIR}`);
  console.log(`  Email: ${process.env.INTELLIGENCE_EMAIL_TO || 'NOT SET'}`);

  // Quick check — just verify imports work
  console.log('\nModule imports:');
  console.log('  heat-scoring: ✓');
  console.log('  intelligence-report: ✓');
  console.log('  monday (getBoardGroupItems): ✓');

  console.log('\n=== Intelligence Agent — מוכן ===');
}

module.exports = {
  runDailyIntelligence,
  getIntelligenceForDate,
  getHeatScoreForEvent,
  getAllHeatScores,
  triggerManualScan,
};

if (require.main === module) {
  const arg = process.argv[2];

  if (arg === '--daily') {
    runDailyIntelligence()
      .then((report) => {
        console.log('\n--- Report Summary ---');
        console.log(`Date: ${report.date}`);
        console.log(`Events scored: ${report.scoredEvents.length}`);
        console.log(`Recommendations: ${report.recommendations.length}`);
        console.log(`Duration: ${report.durationMs}ms`);

        if (report.scoredEvents.length > 0) {
          console.log('\n--- Top Events ---');
          for (const e of report.scoredEvents.slice(0, 5)) {
            console.log(`  [${e.score}] ${e.homeTeam} vs ${e.awayTeam} (${e.tier}) [${e.activeSources.join('|')}]`);
          }
        }

        // Send email if configured
        const emailTo = process.env.INTELLIGENCE_EMAIL_TO;
        if (emailTo) {
          return sendReport(report, [emailTo]);
        }
      })
      .catch((err) => console.error('Daily run failed:', sanitizeError(err)));
  } else if (arg === '--heat') {
    getAllHeatScores()
      .then((scores) => {
        console.log('\n--- All Heat Scores ---');
        for (const s of scores) {
          console.log(`  [${s.score}] ${s.homeTeam} vs ${s.awayTeam} (${s.tier}) [${s.activeSources.join('|')}]`);
        }
      })
      .catch((err) => console.error('Heat scores failed:', sanitizeError(err)));
  } else {
    selfTest().catch((err) => console.error('selfTest failed:', sanitizeError(err)));
  }
}
