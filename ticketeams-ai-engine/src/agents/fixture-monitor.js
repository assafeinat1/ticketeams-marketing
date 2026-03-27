/**
 * Ticketeams Fixture Monitor Agent
 *
 * Fetches upcoming fixtures from Football-Data.org API.
 * Provides league schedule data for the Intelligence Agent heat scoring.
 *
 * RedRok Security Standard:
 * - API key loaded via dotenv — NEVER printed to console/logs.
 * - All errors sanitized (no credential leakage).
 *
 * Usage:
 *   node src/agents/fixture-monitor.js           # selfTest
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');

const config = require('../config/intelligence-config.json');

// ============================================================
// Config
// ============================================================

const API_KEY = process.env.FOOTBALL_DATA_API_KEY;
const BASE_URL = config.footballData.baseUrl;
const COMPETITIONS = config.footballData.competitions;
const CACHE_TTL_HOURS = config.footballData.cacheTtlHours;
const CACHE_DIR = path.join(__dirname, '..', 'cache', 'fixtures-api');

// Rate limit: free tier = 10 req/min → 6s between requests
const REQUEST_DELAY_MS = 6500;

// ============================================================
// Helpers
// ============================================================

function sanitizeError(err) {
  const msg = err?.message || String(err);
  return msg.replace(/X-Auth-Token[:\s]*\S+/gi, 'X-Auth-Token: [REDACTED]');
}

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function getCachePath(competitionCode) {
  return path.join(CACHE_DIR, `${competitionCode}.json`);
}

function readCache(competitionCode) {
  try {
    const filePath = getCachePath(competitionCode);
    if (!fs.existsSync(filePath)) return null;

    const raw = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    const age = (Date.now() - new Date(raw.cachedAt).getTime()) / (1000 * 60 * 60);
    if (age > CACHE_TTL_HOURS) return null;

    return raw.matches;
  } catch {
    return null;
  }
}

function writeCache(competitionCode, matches) {
  try {
    ensureCacheDir();
    const filePath = getCachePath(competitionCode);
    fs.writeFileSync(filePath, JSON.stringify({
      competitionCode,
      cachedAt: new Date().toISOString(),
      count: matches.length,
      matches,
    }, null, 2), 'utf-8');
  } catch (err) {
    console.warn(`[FIXTURE] Cache write failed for ${competitionCode}:`, sanitizeError(err));
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ============================================================
// API Fetching
// ============================================================

/**
 * Fetches scheduled matches for a single competition.
 * Returns normalized fixture objects.
 */
async function fetchCompetitionFixtures(code, competitionId) {
  // Check cache first
  const cached = readCache(code);
  if (cached) {
    console.log(`[FIXTURE] ${code}: ${cached.length} matches (from cache)`);
    return cached;
  }

  if (!API_KEY) {
    console.warn(`[FIXTURE] ${code}: No API key — skipping`);
    return [];
  }

  try {
    const today = new Date().toISOString().split('T')[0];
    const futureDate = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];

    const response = await axios.get(
      `${BASE_URL}/competitions/${competitionId}/matches`,
      {
        params: {
          status: 'SCHEDULED',
          dateFrom: today,
          dateTo: futureDate,
        },
        headers: { 'X-Auth-Token': API_KEY },
        timeout: 15000,
      }
    );

    const matches = (response.data.matches || []).map((m) => ({
      homeTeam: m.homeTeam?.name || 'Unknown',
      awayTeam: m.awayTeam?.name || 'Unknown',
      competition: m.competition?.name || code,
      competitionCode: code,
      date: m.utcDate ? m.utcDate.split('T')[0] : null,
      matchday: m.matchday,
      status: m.status,
    }));

    writeCache(code, matches);
    console.log(`[FIXTURE] ${code}: ${matches.length} matches (from API)`);
    return matches;
  } catch (err) {
    console.error(`[FIXTURE] ${code}: API error — ${sanitizeError(err)}`);
    return [];
  }
}

// ============================================================
// Public API
// ============================================================

/**
 * Fetches all upcoming fixtures across all configured competitions.
 * Rate-limited: 6.5s delay between API requests.
 */
async function fetchAllUpcomingFixtures() {
  console.log('[FIXTURE] Fetching fixtures for all competitions...');
  const allMatches = [];
  const codes = Object.keys(COMPETITIONS);

  for (let i = 0; i < codes.length; i++) {
    const code = codes[i];
    const matches = await fetchCompetitionFixtures(code, COMPETITIONS[code]);
    allMatches.push(...matches);

    // Rate limit — don't delay after last request or cached results
    if (i < codes.length - 1 && API_KEY) {
      const cached = readCache(code);
      if (!cached) await sleep(REQUEST_DELAY_MS);
    }
  }

  console.log(`[FIXTURE] Total: ${allMatches.length} scheduled matches across ${codes.length} competitions`);
  return allMatches;
}

/**
 * Returns fixtures within a date window.
 */
async function getFixturesInWindow(startDate, endDate) {
  const all = await fetchAllUpcomingFixtures();
  return all.filter((m) => {
    if (!m.date) return false;
    return m.date >= startDate && m.date <= endDate;
  });
}

/**
 * Returns fixtures for a specific team (fuzzy name match).
 */
async function getFixturesForTeam(teamName) {
  const all = await fetchAllUpcomingFixtures();
  const lower = teamName.toLowerCase();
  return all.filter(
    (m) =>
      m.homeTeam.toLowerCase().includes(lower) ||
      m.awayTeam.toLowerCase().includes(lower)
  );
}

// ============================================================
// Self-test
// ============================================================

async function selfTest() {
  console.log('=== Fixture Monitor — בדיקה עצמית ===\n');

  console.log(`API Key: ${API_KEY ? 'configured ✓' : 'MISSING ✗'}`);
  console.log(`Competitions: ${Object.keys(COMPETITIONS).join(', ')}`);
  console.log(`Cache Dir: ${CACHE_DIR}`);
  console.log(`Cache TTL: ${CACHE_TTL_HOURS}h\n`);

  const fixtures = await fetchAllUpcomingFixtures();

  if (fixtures.length > 0) {
    console.log('\n--- Sample Fixtures ---');
    for (const f of fixtures.slice(0, 5)) {
      console.log(`  ${f.homeTeam} vs ${f.awayTeam} | ${f.competition} | ${f.date}`);
    }
  } else {
    console.log('No fixtures found (API key missing or no scheduled matches)');
  }

  console.log('\n=== Fixture Monitor — מוכן ===');
}

module.exports = { fetchAllUpcomingFixtures, getFixturesInWindow, getFixturesForTeam };

if (require.main === module) {
  selfTest().catch((err) => console.error('selfTest failed:', sanitizeError(err)));
}
