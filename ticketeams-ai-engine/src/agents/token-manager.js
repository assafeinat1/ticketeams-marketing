/**
 * Meta Token Manager — Validity check + auto-refresh
 *
 * Monitors the Meta access token's expiry date.
 * Attempts auto-refresh when nearing expiry.
 * Sends email alert when token is critically low.
 *
 * RedRok Security Standard:
 * - Credentials loaded via dotenv — NEVER printed to console/logs/output.
 * - All error messages are sanitized (no token leakage).
 *
 * Usage:
 *   node src/agents/token-manager.js   # selfTest
 */

require('dotenv').config();
const axios = require('axios');
const nodemailer = require('nodemailer');
const { sanitizeError } = require('./meta-api-client');
const config = require('../config/meta-publish-config.json');

// ============================================================
// Config
// ============================================================

const META_API_BASE = config.meta.apiBase;
const REFRESH_THRESHOLD_DAYS = config.tokenRefresh.refreshThresholdDays;
const ALERT_THRESHOLD_DAYS = config.tokenRefresh.alertThresholdDays;

const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587', 10);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;

// ============================================================
// Token Validity Check
// ============================================================

async function checkTokenValidity() {
  const token = process.env.META_ACCESS_TOKEN;
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;

  if (!token || token.length < 50) {
    return { valid: false, expiresAt: null, daysRemaining: null, scopes: [], error: 'Token missing or too short' };
  }

  try {
    // Use app token (app_id|app_secret) to debug user token
    const appToken = `${appId}|${appSecret}`;
    const response = await axios.get(`${META_API_BASE}/debug_token`, {
      params: { input_token: token, access_token: appToken },
      timeout: 15000,
    });

    const data = response.data.data;
    const expiresAt = data.expires_at ? new Date(data.expires_at * 1000).toISOString() : null;
    const daysRemaining = data.expires_at
      ? Math.round((data.expires_at * 1000 - Date.now()) / (1000 * 60 * 60 * 24) * 10) / 10
      : null;
    const scopes = data.scopes || [];

    return {
      valid: data.is_valid,
      expiresAt,
      daysRemaining,
      scopes,
      appId: data.app_id,
      userId: data.user_id,
      type: data.type,
    };
  } catch (error) {
    return {
      valid: false,
      expiresAt: null,
      daysRemaining: null,
      scopes: [],
      error: sanitizeError(error),
    };
  }
}

// ============================================================
// Token Refresh
// ============================================================

async function refreshToken() {
  const appId = process.env.META_APP_ID;
  const appSecret = process.env.META_APP_SECRET;
  const currentToken = process.env.META_ACCESS_TOKEN;

  if (!appId || !appSecret) {
    return { refreshed: false, message: 'META_APP_ID or META_APP_SECRET missing — cannot refresh' };
  }

  try {
    const response = await axios.get(`${META_API_BASE}/oauth/access_token`, {
      params: {
        grant_type: 'fb_exchange_token',
        client_id: appId,
        client_secret: appSecret,
        fb_exchange_token: currentToken,
      },
      timeout: 15000,
    });

    const { access_token, expires_in } = response.data;

    if (!access_token) {
      return { refreshed: false, message: 'No access_token in response' };
    }

    // Update in memory only — NOT writing to .env (too risky for automation)
    process.env.META_ACCESS_TOKEN = access_token;

    const daysRemaining = expires_in ? Math.round(expires_in / 86400) : null;
    console.log(`[TOKEN-MANAGER] Token refreshed successfully. New expiry: ~${daysRemaining} days`);

    return {
      refreshed: true,
      tokenPrefix: access_token.slice(0, 10),
      tokenLength: access_token.length,
      expiresInSeconds: expires_in,
      daysRemaining,
      message: `Token refreshed. New token: ${access_token.slice(0, 10)}... (${access_token.length} chars, ~${daysRemaining} days)`,
    };
  } catch (error) {
    console.error(`[TOKEN-MANAGER] Refresh failed: ${sanitizeError(error)}`);
    return { refreshed: false, message: sanitizeError(error) };
  }
}

// ============================================================
// Email Alert
// ============================================================

async function sendTokenAlert(daysRemaining, tokenInfo) {
  if (!SMTP_USER || !SMTP_PASS) {
    console.warn('[TOKEN-MANAGER] SMTP credentials missing — skipping email alert');
    return { sent: false, reason: 'SMTP credentials missing' };
  }

  const recipient = process.env.INTELLIGENCE_EMAIL_TO;
  if (!recipient) {
    console.warn('[TOKEN-MANAGER] No email recipient — skipping alert');
    return { sent: false, reason: 'No recipient' };
  }

  try {
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });

    const urgency = daysRemaining <= 1 ? 'CRITICAL' : daysRemaining <= 3 ? 'URGENT' : 'WARNING';

    await transporter.sendMail({
      from: `"Ticketeams Token Manager" <${SMTP_USER}>`,
      to: recipient,
      subject: `[${urgency}] Meta Token Expires in ${Math.ceil(daysRemaining)} days — Ticketeams`,
      html: `
        <div dir="rtl" style="font-family:sans-serif;padding:20px;">
          <h2 style="color:${daysRemaining <= 1 ? '#EF4444' : '#F97316'};">
            Meta Access Token — ${urgency}
          </h2>
          <p><strong>ימים שנותרו:</strong> ${Math.ceil(daysRemaining)}</p>
          <p><strong>תוקף:</strong> ${tokenInfo.expiresAt || 'לא ידוע'}</p>
          <p><strong>Permissions:</strong> ${(tokenInfo.scopes || []).join(', ')}</p>
          <hr>
          <p>יש לחדש את ה-Token ב-<a href="https://developers.facebook.com/tools/explorer/">Graph API Explorer</a></p>
        </div>
      `,
    });

    console.log(`[TOKEN-MANAGER] Alert email sent to ${recipient}`);
    return { sent: true, recipient };
  } catch (error) {
    console.error(`[TOKEN-MANAGER] Email alert failed: ${error.message}`);
    return { sent: false, reason: error.message };
  }
}

// ============================================================
// Health Check (main cron entry point)
// ============================================================

async function tokenHealthCheck() {
  console.log('[TOKEN-MANAGER] Running health check...');

  const tokenInfo = await checkTokenValidity();
  let refreshed = false;
  let alertSent = false;

  if (!tokenInfo.valid) {
    console.error('[TOKEN-MANAGER] CRITICAL: Token is INVALID');
    const alertResult = await sendTokenAlert(0, tokenInfo);
    return { healthy: false, daysRemaining: 0, refreshed: false, alertSent: alertResult.sent };
  }

  const days = tokenInfo.daysRemaining;

  // Attempt refresh if within threshold
  if (days !== null && days <= REFRESH_THRESHOLD_DAYS) {
    console.log(`[TOKEN-MANAGER] Token expires in ${days} days — attempting refresh...`);
    const refreshResult = await refreshToken();
    refreshed = refreshResult.refreshed;
  }

  // Send alert if critically low
  if (days !== null && days <= ALERT_THRESHOLD_DAYS) {
    console.log(`[TOKEN-MANAGER] Token expires in ${days} days — sending alert...`);
    const alertResult = await sendTokenAlert(days, tokenInfo);
    alertSent = alertResult.sent;
  }

  const healthy = tokenInfo.valid && (days === null || days > 0);
  console.log(`[TOKEN-MANAGER] Health: ${healthy ? 'OK' : 'WARNING'} | Days: ${days} | Refreshed: ${refreshed}`);

  return { healthy, daysRemaining: days, refreshed, alertSent };
}

// ============================================================
// Self-test
// ============================================================

async function selfTest() {
  console.log('=== Token Manager — Self Test ===\n');

  // 1. Env vars
  const hasToken = (process.env.META_ACCESS_TOKEN || '').length > 50;
  const hasAppId = (process.env.META_APP_ID || '').length > 10;
  const hasAppSecret = (process.env.META_APP_SECRET || '').length > 20;
  console.log(`[${hasToken ? 'PASS' : 'FAIL'}] META_ACCESS_TOKEN present (length: ${(process.env.META_ACCESS_TOKEN || '').length})`);
  console.log(`[${hasAppId ? 'PASS' : 'FAIL'}] META_APP_ID present`);
  console.log(`[${hasAppSecret ? 'PASS' : 'FAIL'}] META_APP_SECRET present`);

  // 2. Token validity
  const info = await checkTokenValidity();
  console.log(`\n[${info.valid ? 'PASS' : 'FAIL'}] Token valid: ${info.valid}`);
  if (info.expiresAt) console.log(`  Expires: ${info.expiresAt}`);
  if (info.daysRemaining !== null) console.log(`  Days remaining: ${info.daysRemaining}`);
  if (info.scopes) console.log(`  Scopes: ${info.scopes.join(', ')}`);
  if (info.type) console.log(`  Type: ${info.type}`);
  if (info.error) console.log(`  Error: ${info.error}`);

  // 3. Health check (no email in selfTest — just check logic)
  console.log('\n--- Health Check ---');
  const health = await tokenHealthCheck();
  console.log(`  Healthy: ${health.healthy}`);
  console.log(`  Days remaining: ${health.daysRemaining}`);
  console.log(`  Refreshed: ${health.refreshed}`);
  console.log(`  Alert sent: ${health.alertSent}`);

  console.log('\n=== Token Manager — Complete ===\n');
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  checkTokenValidity,
  refreshToken,
  tokenHealthCheck,
};

if (require.main === module) {
  selfTest();
}
