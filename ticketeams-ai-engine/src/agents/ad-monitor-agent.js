/**
 * Ticketeams Ad Monitor Agent — Competitor Spy
 *
 * Connects to Meta Ad Library API to fetch competitors' active ads.
 * Feeds into the AI pipeline for creative inspiration + counter-ad decisions.
 *
 * RedRok Security Standard:
 * - Credentials loaded via dotenv — NEVER printed to console/logs/output.
 * - All error messages are sanitized (no token leakage).
 *
 * Usage:
 *   node src/agents/ad-monitor-agent.js                    # selfTest
 *   node src/agents/ad-monitor-agent.js --monitor          # full competitor scan
 *   node src/agents/ad-monitor-agent.js --search "כרטיסים" # search by term
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');

// ============================================================
// Config
// ============================================================

const META_API_VERSION = 'v21.0';
const META_API_BASE = `https://graph.facebook.com/${META_API_VERSION}`;
const CACHE_DIR = path.join(__dirname, '..', 'cache', 'ad-monitor');
const CACHE_TTL_HOURS = 24;
const VENUES_PATH = path.join(__dirname, '..', 'config', 'venues.json');

// In-memory venues cache for extractMatchInfo (avoid disk reads per call)
let _venuesTeamNames = null;
function _getKnownTeamNames() {
  if (_venuesTeamNames) return _venuesTeamNames;
  try {
    const venues = JSON.parse(fs.readFileSync(VENUES_PATH, 'utf-8'));
    _venuesTeamNames = [];
    for (const [key, config] of Object.entries(venues.teams || {})) {
      if (config.name_he) _venuesTeamNames.push(config.name_he);
      if (config.name_en) _venuesTeamNames.push(config.name_en);
      _venuesTeamNames.push(key.replace(/_/g, ' '));
    }
  } catch (err) {
    console.warn('[venues] Failed to load team names:', err.message);
    _venuesTeamNames = [];
  }
  return _venuesTeamNames;
}

// Validate credentials once at startup, not on every API call
let _credentialsValidated = false;

// ============================================================
// Keyword & Political Filters
// ============================================================
// Relevance keywords — ads must contain at least one to pass
const RELEVANCE_KEYWORDS = [
  'כרטיסים', 'כרטיס', 'tickets', 'ticket',
  'football', 'כדורגל', 'soccer',
  'concert', 'הופעה', 'הופעות', 'קונצרט',
  'ספורט', 'sport', 'sports',
  'champions', 'צ\'מפיונס', "צ'מפיונס",
  'stadium', 'אצטדיון',
  'משחק', 'game', 'match',
  'liga', 'ליגה', 'league',
  'אירוע', 'event', 'show',
];

// Political / social-issue signals — ads matching these are discarded
const POLITICAL_SIGNALS = [
  'disclaimer', 'required disclaimer',
  'paid for by', 'מומן על ידי',
  'בחירות', 'election', 'elections',
  'מפלגה', 'מפלגת', 'party',
  'הצביעו', 'הצבעה', 'vote', 'voting',
  'פוליטי', 'political',
  'social issue', 'נושא חברתי',
  'כנסת', 'knesset',
  'coalition', 'קואליציה', 'אופוזיציה',
];

// Negative keywords — municipal / government noise to always exclude
const NEGATIVE_KEYWORDS = [
  'תושבים', 'עירייה', 'עיריית',
  'ביטחון', 'פיקוד', 'אכיפה',
  'מועצה', 'מועצת',
  'ראש העיר', 'סגן ראש העיר',
  'דלת פתוחה', 'מנהל קהילתי',
  'שירות לתושב', 'מוקד עירוני',
];

/**
 * Checks if ad text contains at least one relevance keyword.
 */
function isRelevantAd(ad) {
  const text = `${ad.title || ''} ${ad.body || ''} ${ad.description || ''}`.toLowerCase();
  return RELEVANCE_KEYWORDS.some((kw) => text.includes(kw.toLowerCase()));
}

/**
 * Checks if ad is political / social-issue noise.
 * Detects: political disclaimers, political keywords, "ran without disclaimer" pattern.
 */
function isPoliticalAd(ad) {
  const text = `${ad.title || ''} ${ad.body || ''} ${ad.description || ''}`.toLowerCase();
  // Pattern: "This ad ran without a required disclaimer" — Meta political flag
  if (text.includes('ran without a required disclaimer')) return true;
  if (text.includes('this ad ran without')) return true;
  return POLITICAL_SIGNALS.some((sig) => text.includes(sig.toLowerCase()));
}

/**
 * Checks if ad matches negative keywords (municipal / government noise).
 */
function isBlacklistedAd(ad) {
  const text = `${ad.title || ''} ${ad.body || ''} ${ad.description || ''}`.toLowerCase();
  return NEGATIVE_KEYWORDS.some((kw) => text.includes(kw.toLowerCase()));
}

// Build a Set of known competitor page_ids + normalized names for fast lookup
const KNOWN_COMPETITOR_IDS = new Set();
const KNOWN_COMPETITOR_NAMES = [];
// Populated after COMPETITOR_PAGES is initialized (see below)

function _initCompetitorLookup() {
  for (const c of COMPETITOR_PAGES) {
    if (c.page_id) KNOWN_COMPETITOR_IDS.add(c.page_id);
    if (c.name) KNOWN_COMPETITOR_NAMES.push(c.name.toLowerCase());
    if (c.name_he) KNOWN_COMPETITOR_NAMES.push(c.name_he.toLowerCase());
  }
}

/**
 * Checks if an ad belongs to a known competitor by page_id or page_name.
 */
function isKnownCompetitorAd(ad) {
  if (ad.page_id && KNOWN_COMPETITOR_IDS.has(String(ad.page_id))) return true;
  if (ad.page_name) {
    const pn = ad.page_name.toLowerCase();
    return KNOWN_COMPETITOR_NAMES.some((cn) => pn.includes(cn) || cn.includes(pn));
  }
  return false;
}

/**
 * Filters an array of ads based on mode:
 *
 * mode='strict' (default) — full pipeline: political + blacklist + keyword whitelist
 *   BUT if the ad's page_id/page_name matches a known competitor → auto-VIP
 *   Used for: search_terms fallback results, user free-text search
 *
 * mode='vip' — only political filter, skip keyword whitelist + blacklist
 *   Used for: ads fetched via verified search_page_ids (trusted competitor IDs)
 *   Rationale: if Meta returned it for our verified page ID, it IS a competitor ad
 *
 * Returns { kept, discarded } with counts for logging.
 */
function filterAds(ads, mode = 'strict') {
  const kept = [];
  let political = 0;
  let blacklisted = 0;
  let irrelevant = 0;
  let vipPromoted = 0;

  for (const ad of ads) {
    // VIP mode OR known competitor ad → bypass ALL filters (trust the source)
    // Meta's "ran without disclaimer" is a censorship flag, not political content
    const isVip = mode === 'vip' || isKnownCompetitorAd(ad);
    if (isVip) {
      if (mode !== 'vip') vipPromoted++;
      kept.push(ad);
      continue;
    }

    // Non-VIP: political filter for search_terms results
    if (isPoliticalAd(ad)) {
      political++;
      continue;
    }

    // Strict mode: full filtering pipeline
    if (isBlacklistedAd(ad)) {
      blacklisted++;
      continue;
    }
    if (!isRelevantAd(ad)) {
      irrelevant++;
      continue;
    }
    kept.push(ad);
  }

  return { kept, discarded: { political, blacklisted, irrelevant, vipPromoted, total: political + blacklisted + irrelevant }, mode };
}

// ============================================================
// Competitor Facebook Page IDs
// ============================================================
// Configure in .env as: COMPETITOR_PAGE_IDS=id1:Name1:HebrewName1,id2:Name2:HebrewName2
// Example: COMPETITOR_PAGE_IDS=148426588511640:IsstaSport:איסתא ספורט
// Hebrew name is used for search_terms fallback when search_page_ids returns 0.
// ============================================================
const COMPETITOR_PAGES = (() => {
  const envVal = process.env.COMPETITOR_PAGE_IDS;
  if (envVal) {
    return envVal.split(',').map((entry) => {
      const parts = entry.trim().split(':');
      const page_id = parts[0]?.trim();
      const name = parts[1]?.trim() || `Page ${page_id}`;
      const name_he = parts[2]?.trim() || null;
      return { page_id, name, name_he };
    }).filter((p) => p.page_id);
  }
  return [];
})();

// Initialize competitor lookup tables for VIP filtering
_initCompetitorLookup();

// ============================================================
// 1. Credential Validation (RedRok Standard — no leaks)
// ============================================================

function validateCredentials() {
  const token = process.env.META_ACCESS_TOKEN;

  if (!token) {
    throw new Error(
      'META_ACCESS_TOKEN is missing from .env.\n' +
      'Steps to fix:\n' +
      '  1. Go to developers.facebook.com → your app → Tools → Graph API Explorer\n' +
      '  2. Select your app, add "ads_read" permission\n' +
      '  3. Generate token and paste into .env as META_ACCESS_TOKEN=...\n' +
      '  4. Accept Ad Library API terms at: facebook.com/ads/library/api'
    );
  }

  // Sanity check — token format (never log the actual value)
  if (token.length < 50) {
    throw new Error('META_ACCESS_TOKEN appears invalid (too short). Check your .env file.');
  }

  console.log('[credentials] META_ACCESS_TOKEN loaded (length: OK)');
  return true;
}

// ============================================================
// 2. Cache — 24-hour file cache
// ============================================================

function buildMonitorKey(date) {
  if (!date) throw new Error('date is required for monitor key');
  return `ad_monitor__${date}`;
}

function checkCache(monitorKey) {
  try {
    const cacheFile = path.join(CACHE_DIR, `${monitorKey}.json`);
    if (!fs.existsSync(cacheFile)) return null;

    const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
    const ageHours = (Date.now() - cached.timestamp) / (1000 * 60 * 60);

    if (ageHours > CACHE_TTL_HOURS) {
      fs.unlinkSync(cacheFile);
      return null;
    }
    return cached.results;
  } catch (err) {
    console.warn(`[cache] Read failed for ${monitorKey}:`, err.message);
    return null;
  }
}

function saveToCache(monitorKey, results) {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    const cacheFile = path.join(CACHE_DIR, `${monitorKey}.json`);
    fs.writeFileSync(cacheFile, JSON.stringify({
      monitorKey,
      timestamp: Date.now(),
      savedAt: new Date().toISOString(),
      results,
    }, null, 2), 'utf-8');
    return true;
  } catch (err) {
    console.warn(`[cache] Write failed for ${monitorKey}:`, err.message);
    return false;
  }
}

// ============================================================
// 3. fetchActiveAds — Meta Ad Library API request
// ============================================================

/**
 * Fetches active ads from Meta Ad Library.
 *
 * @param {Object} options
 * @param {string} [options.pageId] — Facebook Page ID to spy on
 * @param {string} [options.searchTerms] — Free-text search (alternative to pageId)
 * @param {string} [options.pageName] — Display name for logs
 * @param {number} [options.limit] — Max results (default 25)
 * @returns {Object} { page_id, page_name, ads_count, ads[], status }
 */
/**
 * Internal: single API call to ads_archive
 */
async function _callAdsArchive(params, pageName) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    qs.append(k, String(v));
  }
  const fullUrl = `${META_API_BASE}/ads_archive?${qs.toString()}`;
  const response = await axios.get(fullUrl, { timeout: 15000 });
  return response.data.data || [];
}

/**
 * VIP countries — expanded reach for verified page_id queries
 */
const VIP_COUNTRIES = ['IL', 'GB', 'ES', 'US'];
const FALLBACK_COUNTRIES = ['IL', 'GB', 'ES'];

async function fetchActiveAds({ pageId, searchTerms, pageName = 'Unknown', limit = 50, countries, vip = false }) {
  try {
    if (!_credentialsValidated) {
      validateCredentials();
      _credentialsValidated = true;
    }

    // VIP path: use expanded countries + ad_active_status=ACTIVE
    // Fallback path: standard countries, no active filter (broader net)
    const effectiveCountries = countries || (vip ? VIP_COUNTRIES : FALLBACK_COUNTRIES);

    const baseParams = {
      access_token: process.env.META_ACCESS_TOKEN,
      ad_reached_countries: JSON.stringify(effectiveCountries),
      ad_type: 'ALL',
      fields: [
        'ad_delivery_start_time',
        'ad_creative_bodies',
        'ad_creative_link_titles',
        'ad_creative_link_descriptions',
        'page_name',
        'page_id',
        'ad_snapshot_url',
      ].join(','),
      limit,
    };

    // NOTE: do NOT add ad_active_status=ACTIVE — it causes "Silent Zero" bug
    // where Meta returns 0 results for search_page_ids. The API returns
    // currently running ads by default. This was the original bug fix.

    if (!pageId && !searchTerms) {
      throw new Error('Either pageId or searchTerms is required');
    }

    console.log(`[fetch] Scanning ${pageName}${vip ? ' [VIP]' : ''}...`);
    let ads = [];
    let method = '';

    if (pageId) {
      method = 'page_id';
      // VIP: ONLY search_page_ids, NEVER combine with search_terms
      console.log(`[fetch]   → search_page_ids=${pageId}${vip ? ' (ACTIVE, countries: ' + effectiveCountries.join('+') + ')' : ''}`);
      ads = await _callAdsArchive({ ...baseParams, search_page_ids: pageId }, pageName);
    } else if (searchTerms) {
      method = 'search_terms';
      console.log(`[fetch]   → search_terms="${searchTerms}"`);
      ads = await _callAdsArchive({ ...baseParams, search_terms: searchTerms }, pageName);
    }

    console.log(`[fetch] ${pageName}: ${ads.length} ads found (via ${method})`);

    return {
      page_id: pageId || null,
      page_name: pageName,
      search_terms: searchTerms || null,
      ads_count: ads.length,
      method,
      vip,
      ads: ads.map((ad) => ({
        delivery_start: ad.ad_delivery_start_time,
        body: (ad.ad_creative_bodies || [])[0] || '',
        title: (ad.ad_creative_link_titles || [])[0] || '',
        description: (ad.ad_creative_link_descriptions || [])[0] || '',
        page_name: ad.page_name,
        page_id: ad.page_id,
        snapshot_url: ad.ad_snapshot_url,
      })),
      scrapedAt: new Date().toISOString(),
      status: 'ok',
    };
  } catch (error) {
    const safeMessage = sanitizeError(error);
    console.error(`[fetch] ${pageName} failed: ${safeMessage}`);

    return {
      page_id: pageId || null,
      page_name: pageName,
      ads_count: 0,
      ads: [],
      status: 'error',
      error: safeMessage,
    };
  }
}

// ============================================================
// 4. extractMatchInfo — Identify event from ad text
// ============================================================

function extractMatchInfo(adData) {
  try {
    const fullText = `${adData.title || ''} ${adData.body || ''} ${adData.description || ''}`;

    // Use cached team names (loaded once, not per call)
    const knownTeams = _getKnownTeamNames();

    // Pattern: teamA vs/נגד teamB
    const vsPattern = /(.{2,30}?)\s+(vs\.?|נגד|against|–|-|מול)\s+(.{2,30})/i;
    const match = fullText.match(vsPattern);

    if (match) {
      return {
        matched: true,
        homeTeam: match[1].trim(),
        awayTeam: match[3].trim().split(/[,.\n!]/)[0].trim(),
        confidence: 'high',
        rawText: fullText.substring(0, 100),
      };
    }

    // Fallback — search for known team names in text
    const foundTeams = knownTeams.filter((team) =>
      fullText.toLowerCase().includes(team.toLowerCase())
    );

    if (foundTeams.length >= 2) {
      return {
        matched: true,
        homeTeam: foundTeams[0],
        awayTeam: foundTeams[1],
        confidence: 'medium',
        rawText: fullText.substring(0, 100),
      };
    }

    return { matched: false, homeTeam: null, awayTeam: null, confidence: 'none', rawText: fullText.substring(0, 100) };
  } catch (err) {
    console.warn('[extractMatchInfo] Error:', err.message);
    return { matched: false, homeTeam: null, awayTeam: null, confidence: 'error' };
  }
}

// ============================================================
// 5. classifyAdFormat — Claude Haiku FORMAT_TYPE classification
// ============================================================

async function classifyAdFormat(adData) {
  try {
    const anthropicKey = process.env.ANTHROPIC_API_KEY;
    if (!anthropicKey) {
      return { format_type: 'Unknown', reasoning: 'ANTHROPIC_API_KEY missing' };
    }

    const prompt = `סווג את הפרסומת הבאה לאחת מ-3 קטגוריות בלבד:

FORMAT_TYPE_1 = "Stadium" — תמונה של אצטדיון, מגרש, חוויה כללית
FORMAT_TYPE_2 = "Human" — שחקנים, אנשים, דיוקנים, כוכבים
FORMAT_TYPE_3 = "Urgency" — דחיפות: "נגמר מהר", "אחרון", "מוגבל", "מהרו"

טקסט הפרסומת:
כותרת: ${adData.title || 'אין'}
גוף: ${adData.body || 'אין'}
תיאור: ${adData.description || 'אין'}

החזר JSON בלבד: {"format_type": "Stadium" או "Human" או "Urgency", "reasoning": "הסבר קצר"}`;

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const data = await response.json();
    if (data.type === 'error') throw new Error(data.error?.message);

    const rawText = data.content?.[0]?.text?.trim();
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON in response');

    const classification = JSON.parse(jsonMatch[0]);
    return {
      format_type: classification.format_type,
      reasoning: classification.reasoning,
      classified_at: new Date().toISOString(),
    };
  } catch (error) {
    return { format_type: 'Unknown', reasoning: `Classification error: ${error.message}` };
  }
}

// ============================================================
// 6. monitorCompetitorAds — Main entry point: scan all competitors
// ============================================================

async function monitorCompetitorAds(date) {
  if (!date) date = new Date().toISOString().split('T')[0];

  const monitorKey = buildMonitorKey(date);

  // Check cache
  const cached = checkCache(monitorKey);
  if (cached) {
    console.log(`[cache] Found cached report: ${monitorKey}`);
    return cached;
  }

  console.log(`\n=== Ad Monitor — Competitor Spy — ${date} ===\n`);

  const results = {
    monitorKey,
    date,
    competitors: [],
    totalAds: 0,
    summary: { stadium: 0, human: 0, urgency: 0, unknown: 0 },
    counterAdCandidates: [],
    generatedAt: new Date().toISOString(),
  };

  let totalDiscarded = { political: 0, blacklisted: 0, irrelevant: 0 };
  let totalVipImmune = 0;

  for (const comp of COMPETITOR_PAGES) {
    // ── Step 1: VIP request — page_id ONLY, ACTIVE, expanded countries ──
    const vipResult = await fetchActiveAds({
      pageId: comp.page_id,
      pageName: comp.name,
      vip: true,       // triggers ad_active_status=ACTIVE + VIP_COUNTRIES
    });

    // ── Step 2: If VIP returned 0, try fallback with search_terms ONLY ──
    let fallbackResult = null;
    if (vipResult.ads_count === 0 && (comp.name_he || comp.name)) {
      fallbackResult = await fetchActiveAds({
        searchTerms: comp.name_he || comp.name,
        pageName: comp.name,
        vip: false,      // standard countries, no ad_active_status
      });
    }

    // ── Step 3: ABSOLUTE IMMUNITY — VIP ads bypass ALL filters ──
    const vipAds = vipResult.ads;  // zero filtering, straight to dashboard
    if (vipAds.length > 0) {
      totalVipImmune += vipAds.length;
      console.log(`[IMMUNITY] ${comp.name}: ${vipAds.length} ads via page_id → ABSOLUTE IMMUNITY (no filters)`);
    }

    // ── Step 4: Strict filter ONLY on fallback search_terms results ──
    let fallbackAds = [];
    if (fallbackResult && fallbackResult.ads_count > 0) {
      const { kept, discarded } = filterAds(fallbackResult.ads, 'strict');
      totalDiscarded.political += discarded.political;
      totalDiscarded.blacklisted += discarded.blacklisted;
      totalDiscarded.irrelevant += discarded.irrelevant;
      if (discarded.total > 0) {
        console.log(`[filter] ${comp.name} (strict fallback): kept ${kept.length}/${fallbackResult.ads.length} (political: ${discarded.political}, blacklisted: ${discarded.blacklisted}, irrelevant: ${discarded.irrelevant})`);
      }
      fallbackAds = kept;
    }

    // ── Merge: VIP first, then any surviving fallback ads ──
    const allAds = [...vipAds, ...fallbackAds];
    const adsData = vipAds.length > 0 ? vipResult : (fallbackResult || vipResult);
    adsData.ads = allAds;
    adsData.ads_count = allAds.length;

    // Classify each ad + extract match info
    for (const ad of adsData.ads) {
      ad.match_info = extractMatchInfo(ad);
      ad.classification = await classifyAdFormat(ad);

      const type = (ad.classification.format_type || '').toLowerCase();
      if (type.includes('stadium')) results.summary.stadium++;
      else if (type.includes('human')) results.summary.human++;
      else if (type.includes('urgency')) results.summary.urgency++;
      else results.summary.unknown++;

      // Flag counter-ad candidates
      if (ad.match_info.matched && (type.includes('human') || type.includes('urgency'))) {
        results.counterAdCandidates.push({
          competitor: comp.name,
          format_type: ad.classification.format_type,
          homeTeam: ad.match_info.homeTeam,
          awayTeam: ad.match_info.awayTeam,
        });
      }
    }

    results.competitors.push(adsData);
    results.totalAds += adsData.ads_count;
  }

  // Cache results
  saveToCache(monitorKey, results);

  // Print summary
  console.log(`\n=== Monitor Summary — ${date} ===`);
  console.log(`Total ads: ${results.totalAds}`);
  console.log(`  VIP Immune (page_id, no filters): ${totalVipImmune}`);
  console.log(`  Discarded from fallback: ${totalDiscarded.political} political, ${totalDiscarded.blacklisted || 0} blacklisted, ${totalDiscarded.irrelevant} irrelevant`);
  console.log(`  Stadium: ${results.summary.stadium}`);
  console.log(`  Human:   ${results.summary.human}`);
  console.log(`  Urgency: ${results.summary.urgency}`);
  console.log(`  Unknown: ${results.summary.unknown}`);
  if (results.counterAdCandidates.length > 0) {
    console.log(`\nCounter-ad candidates: ${results.counterAdCandidates.length}`);
    for (const c of results.counterAdCandidates) {
      console.log(`  - ${c.competitor}: ${c.homeTeam} vs ${c.awayTeam} (${c.format_type})`);
    }
  }
  console.log('================================\n');

  return results;
}

// ============================================================
// 7. searchAdsByTerm — Free-text search in Ad Library
// ============================================================

async function searchAdsByTerm(term, limit = 10) {
  console.log(`\n=== Ad Library Search: "${term}" ===\n`);

  const result = await fetchActiveAds({
    searchTerms: term,
    pageName: `Search: "${term}"`,
    limit,
  });

  if (result.ads_count > 0) {
    console.log(`\nResults for "${term}":`);
    for (const ad of result.ads) {
      console.log(`  [${ad.page_name || 'Unknown'}] ${ad.title || ad.body?.substring(0, 60) || 'No text'}`);
      if (ad.snapshot_url) console.log(`    → ${ad.snapshot_url}`);
    }
  }
  console.log('');

  return result;
}

// ============================================================
// Error sanitizer — RedRok Standard
// ============================================================

function sanitizeError(error) {
  // Extract Meta API error if available
  const metaError = error.response?.data?.error;
  if (metaError) {
    // Map known error codes to actionable messages
    if (metaError.error_subcode === 2332002) {
      return 'App lacks Ad Library API permission. Fix: go to facebook.com/ads/library/api and accept terms, then add "ads_read" permission in App Review.';
    }
    if (metaError.code === 190) {
      return 'Access token expired or invalid. Generate a new token at developers.facebook.com → Graph API Explorer.';
    }
    if (metaError.code === 4) {
      return 'Rate limit reached. Wait a few minutes and retry.';
    }
    // Return Meta's message without the token
    return `Meta API error (code ${metaError.code}): ${metaError.message}`;
  }

  // Generic error — strip any accidental token leaks
  const msg = error.message || 'Unknown error';
  const token = process.env.META_ACCESS_TOKEN;
  if (token && msg.includes(token)) {
    return 'API request failed (credentials redacted).';
  }
  return msg;
}

// ============================================================
// Self-test
// ============================================================

async function selfTest() {
  console.log('=== Ad Monitor Agent — Self Test ===\n');

  // 1. Credential check
  try {
    validateCredentials();
    console.log('[PASS] Credentials loaded securely');
  } catch (err) {
    console.error('[FAIL] Credentials:', err.message);
    return;
  }

  // 2. Cache check
  saveToCache('test__selftest', { ok: true });
  const fromCache = checkCache('test__selftest');
  console.log(`[${fromCache ? 'PASS' : 'FAIL'}] Cache read/write`);

  // 3. extractMatchInfo
  const info1 = extractMatchInfo({ title: 'Arsenal vs Chelsea — כרטיסים!' });
  console.log(`[${info1.matched ? 'PASS' : 'FAIL'}] extractMatchInfo (vs): ${info1.homeTeam} vs ${info1.awayTeam}`);

  const info2 = extractMatchInfo({ body: 'ברצלונה נגד ריאל מדריד — אל תפספסו!' });
  console.log(`[${info2.matched ? 'PASS' : 'FAIL'}] extractMatchInfo (נגד): ${info2.homeTeam} vs ${info2.awayTeam}`);

  // 4. Meta API connection test
  console.log('\n--- Meta Ad Library API Connection ---');
  const testResult = await fetchActiveAds({
    pageId: COMPETITOR_PAGES[0].page_id,
    pageName: COMPETITOR_PAGES[0].name,
    limit: 3,
  });

  if (testResult.status === 'ok') {
    console.log(`[PASS] Meta API connected — ${testResult.ads_count} ads fetched`);
    if (testResult.ads.length > 0) {
      const sample = testResult.ads[0];
      console.log(`  Sample: "${sample.title || sample.body?.substring(0, 50) || 'no text'}"`);
    }
  } else {
    console.log(`[FAIL] Meta API: ${testResult.error}`);
  }

  // 5. Claude classification
  console.log('\n--- Claude FORMAT_TYPE Classification ---');
  const cls = await classifyAdFormat({
    title: 'כרטיסים לצ׳לסי',
    body: 'חוויה באצטדיון סטמפורד ברידג׳ — מגרש מרהיב!',
    description: 'הזמינו עכשיו',
  });
  console.log(`[${cls.format_type !== 'Unknown' ? 'PASS' : 'FAIL'}] Classification: ${cls.format_type} (${cls.reasoning})`);

  console.log('\n=== Self Test Complete ===\n');
}

// ============================================================
// CLI
// ============================================================

module.exports = {
  buildMonitorKey,
  checkCache,
  saveToCache,
  fetchActiveAds,
  extractMatchInfo,
  classifyAdFormat,
  monitorCompetitorAds,
  searchAdsByTerm,
  filterAds,
  isRelevantAd,
  isPoliticalAd,
  isBlacklistedAd,
  isKnownCompetitorAd,
  COMPETITOR_PAGES,
};

if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.includes('--monitor')) {
    monitorCompetitorAds().catch(console.error);
  } else if (args.includes('--search')) {
    const termIndex = args.indexOf('--search') + 1;
    const term = args[termIndex] || 'כרטיסים כדורגל';
    searchAdsByTerm(term).catch(console.error);
  } else {
    selfTest().catch(console.error);
  }
}
