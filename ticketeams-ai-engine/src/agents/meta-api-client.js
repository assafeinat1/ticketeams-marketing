/**
 * Meta Marketing API Client — Low-level wrapper
 *
 * All Meta Marketing API calls go through this module.
 * Handles: token injection, rate limiting, retries, error sanitization.
 *
 * RedRok Security Standard:
 * - Credentials loaded via dotenv — NEVER printed to console/logs/output.
 * - All error messages are sanitized (no token leakage).
 *
 * Usage:
 *   node src/agents/meta-api-client.js   # selfTest
 */

require('dotenv').config();
const axios = require('axios');
const config = require('../config/meta-publish-config.json');

// ============================================================
// Config
// ============================================================

const META_API_VERSION = config.meta.apiVersion;
const META_API_BASE = config.meta.apiBase;
const RATE_LIMIT = config.meta.rateLimitPerHour;
const RETRY_ATTEMPTS = config.meta.retryAttempts;
const RETRY_DELAY_MS = config.meta.retryDelayMs;

// In-memory rate limiter
let _callLog = [];

// ============================================================
// Helpers
// ============================================================

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getToken() {
  return process.env.META_ACCESS_TOKEN;
}

function getAdAccountId() {
  const id = process.env.META_AD_ACCOUNT_ID;
  if (!id) throw new Error('META_AD_ACCOUNT_ID not configured');
  if (!id.startsWith('act_')) throw new Error(`META_AD_ACCOUNT_ID must start with act_ (got: ${id.slice(0, 8)}...)`);
  return id;
}

function getPageId() {
  return process.env.META_PAGE_ID || null;
}

// ============================================================
// Rate Limiter
// ============================================================

function checkRateLimit() {
  const oneHourAgo = Date.now() - 60 * 60 * 1000;
  _callLog = _callLog.filter((ts) => ts > oneHourAgo);
  if (_callLog.length >= RATE_LIMIT) {
    const oldestInWindow = Math.min(..._callLog);
    const waitMs = oldestInWindow + 60 * 60 * 1000 - Date.now() + 100;
    return { ok: false, waitMs, callsInLastHour: _callLog.length };
  }
  return { ok: true, waitMs: 0, callsInLastHour: _callLog.length };
}

async function waitForRateLimit() {
  const rl = checkRateLimit();
  if (!rl.ok) {
    console.log(`[META-API] Rate limit reached (${rl.callsInLastHour}/${RATE_LIMIT}). Waiting ${Math.round(rl.waitMs / 1000)}s...`);
    await sleep(rl.waitMs);
  }
  _callLog.push(Date.now());
}

// ============================================================
// Error Sanitizer — RedRok Standard
// ============================================================

function sanitizeError(error) {
  // Extract Meta API error if available
  const metaError = error.response?.data?.error;
  if (metaError) {
    if (metaError.code === 190) {
      return 'Access token expired or invalid. Generate a new token at developers.facebook.com → Graph API Explorer.';
    }
    if (metaError.code === 4 || metaError.code === 17) {
      return 'Rate limit reached. Wait a few minutes and retry.';
    }
    if (metaError.code === 100) {
      // Strip token from message if present
      const msg = (metaError.message || '').replace(/access_token=[^\s&]+/gi, 'access_token=[REDACTED]');
      return `Meta API error (code 100): ${msg}`;
    }
    if (metaError.error_subcode === 2332002) {
      return 'App lacks required permission. Check App Review settings.';
    }
    const msg = (metaError.message || '').replace(/access_token=[^\s&]+/gi, 'access_token=[REDACTED]');
    return `Meta API error (code ${metaError.code}): ${msg}`;
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
// Retry logic
// ============================================================

function isRetryable(error) {
  const status = error.response?.status;
  if ([500, 502, 503, 429].includes(status)) return true;
  const code = error.response?.data?.error?.code;
  if ([4, 17].includes(code)) return true; // rate limit
  return false;
}

// ============================================================
// Core API methods
// ============================================================

async function metaGet(endpoint, params = {}) {
  await waitForRateLimit();

  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      const response = await axios.get(`${META_API_BASE}${endpoint}`, {
        params: { ...params, access_token: getToken() },
        timeout: 15000,
      });
      return response.data;
    } catch (error) {
      if (attempt < RETRY_ATTEMPTS && isRetryable(error)) {
        const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1);
        console.log(`[META-API] GET ${endpoint} failed (attempt ${attempt}/${RETRY_ATTEMPTS}). Retrying in ${delay}ms...`);
        await sleep(delay);
        continue;
      }
      throw new Error(sanitizeError(error));
    }
  }
}

async function metaPost(endpoint, data = {}) {
  await waitForRateLimit();

  for (let attempt = 1; attempt <= RETRY_ATTEMPTS; attempt++) {
    try {
      const response = await axios.post(`${META_API_BASE}${endpoint}`, data, {
        params: { access_token: getToken() },
        timeout: 30000,
      });
      return response.data;
    } catch (error) {
      // Log full error details for debugging (stays in server logs only)
      const errData = error.response?.data;
      if (errData) {
        console.error(`[META-API] POST ${endpoint} error response:`, JSON.stringify(errData, null, 2));
      }
      if (attempt < RETRY_ATTEMPTS && isRetryable(error)) {
        const delay = RETRY_DELAY_MS * Math.pow(2, attempt - 1);
        console.log(`[META-API] POST ${endpoint} failed (attempt ${attempt}/${RETRY_ATTEMPTS}). Retrying in ${delay}ms...`);
        await sleep(delay);
        continue;
      }
      throw new Error(sanitizeError(error));
    }
  }
}

// ============================================================
// Self-test
// ============================================================

async function selfTest() {
  console.log('=== Meta API Client — Self Test ===\n');

  // 1. Env vars
  const token = process.env.META_ACCESS_TOKEN;
  console.log(`[${token && token.length > 50 ? 'PASS' : 'FAIL'}] META_ACCESS_TOKEN loaded (length: ${token?.length || 0})`);

  try {
    const adAccount = getAdAccountId();
    console.log(`[PASS] META_AD_ACCOUNT_ID: ${adAccount.slice(0, 8)}...`);
  } catch (err) {
    console.log(`[FAIL] META_AD_ACCOUNT_ID: ${err.message}`);
  }

  const pageId = getPageId();
  console.log(`[${pageId ? 'PASS' : 'WARN'}] META_PAGE_ID: ${pageId ? pageId.slice(0, 5) + '...' : '(not set)'}`);

  // 2. Rate limiter
  const rl = checkRateLimit();
  console.log(`[PASS] Rate limiter: ${rl.callsInLastHour}/${RATE_LIMIT} calls in last hour`);

  // 3. Live API — GET /me
  try {
    const me = await metaGet('/me', { fields: 'id,name' });
    console.log(`[PASS] Meta API connected: ${me.name} (ID: ${me.id.slice(0, 5)}...)`);
  } catch (err) {
    console.log(`[FAIL] Meta API /me: ${err.message}`);
  }

  // 4. Ad account
  try {
    const adAccount = getAdAccountId();
    const account = await metaGet(`/${adAccount}`, { fields: 'name,currency,account_status,timezone_name' });
    const statusMap = { 1: 'ACTIVE', 2: 'DISABLED', 3: 'UNSETTLED', 7: 'PENDING_RISK_REVIEW', 101: 'CLOSED' };
    console.log(`[PASS] Ad Account: "${account.name}" | ${account.currency} | ${statusMap[account.account_status] || account.account_status} | ${account.timezone_name}`);
  } catch (err) {
    console.log(`[FAIL] Ad Account: ${err.message}`);
  }

  // 5. Custom audiences
  try {
    const adAccount = getAdAccountId();
    const audiences = await metaGet(`/${adAccount}/customaudiences`, { fields: 'id,name,subtype', limit: 20 });
    console.log(`\nCustom Audiences (${(audiences.data || []).length}):`);
    for (const a of audiences.data || []) {
      console.log(`  ${a.id}: ${a.name} (${a.subtype})`);
    }
  } catch (err) {
    console.log(`[WARN] Custom audiences: ${err.message}`);
  }

  // 6. Permissions
  try {
    const perms = await metaGet('/me/permissions');
    const granted = (perms.data || []).filter((p) => p.status === 'granted').map((p) => p.permission);
    console.log(`\nPermissions (${granted.length}): ${granted.join(', ')}`);
  } catch (err) {
    console.log(`[WARN] Permissions: ${err.message}`);
  }

  console.log('\n=== Meta API Client — Complete ===\n');
}

// ============================================================
// Campaign Insights
// ============================================================

/**
 * Fetch campaign performance insights from Meta Marketing API.
 * Only returns data for campaigns that have had delivery (impressions > 0).
 *
 * @param {string} campaignId - Meta campaign ID
 * @param {string} datePreset - 'last_7d', 'last_30d', 'today', etc.
 * @returns {Object} Meta insights response: { data: [{ impressions, clicks, ctr, spend, actions }] }
 */
async function getCampaignInsights(campaignId, datePreset = 'last_7d') {
  return metaGet(`/${campaignId}/insights`, {
    fields: 'impressions,clicks,ctr,spend,actions,cost_per_action_type',
    date_preset: datePreset,
    level: 'campaign',
  });
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  metaGet,
  metaPost,
  checkRateLimit,
  sanitizeError,
  getAdAccountId,
  getPageId,
  getCampaignInsights,
  META_API_BASE,
  META_API_VERSION,
};

if (require.main === module) {
  selfTest();
}
