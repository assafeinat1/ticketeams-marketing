/**
 * Ticketeams Orchestrator Scheduler
 *
 * Adds TWO new crons to complement the existing 6 crons in webhook-server.js:
 *   1. Hot Event Check  — 04:15 UTC (07:15 IST) daily, after intelligence at 04:00
 *   2. Performance Check — every 6 hours (00:00, 06:00, 12:00, 18:00 UTC)
 *
 * IMPORTANT: Does NOT duplicate existing crons. Those stay in webhook-server.js.
 *
 * RedRok Security Standard:
 * - sanitizeError() on all errors.
 *
 * Usage:
 *   node src/agents/orchestrator-scheduler.js   # selfTest (validates cron expressions)
 *   Called from webhook-server.js: initScheduler()
 */

const cron = require('node-cron');
const fs = require('fs');
const path = require('path');
const config = require('../config/orchestrator-config.json');
const logger = require('../utils/logger');

// Lazy-load orchestrator to avoid circular dependency at require-time
let orchestratorModule = null;

function getOrchestrator() {
  if (!orchestratorModule) {
    orchestratorModule = require('./orchestrator');
  }
  return orchestratorModule;
}

function sanitizeError(err) {
  const msg = err?.message || String(err);
  return msg.replace(/token[=:]\S+/gi, 'token=[REDACTED]');
}

// ============================================================
// Daily Summary Email
// ============================================================

/**
 * Build and send a daily summary email after hot-check.
 * @param {Object} hotCheckResult - result from runHotEventCheck()
 */
async function sendDailySummary(hotCheckResult) {
  const nodemailer = require('nodemailer');
  const today = new Date();
  const dateStr = today.toISOString().split('T')[0];
  const displayDate = `${today.getDate()}.${today.getMonth() + 1}.${today.getFullYear()}`;

  // Gather data
  let eventsScanned = 0;
  let hotEvents = 0;
  try {
    const { getIntelligenceForDate } = require('./intelligence-agent');
    const report = await getIntelligenceForDate(dateStr);
    eventsScanned = report?.scoredEvents?.length || 0;
    hotEvents = (report?.scoredEvents || []).filter((e) => (e.score || e.heatScore || 0) >= 36).length;
  } catch { /* ignore */ }

  const decisions = hotCheckResult?.decisions?.length || 0;

  // Active campaigns
  let activeCampaigns = 0;
  try {
    const { listPublishedCampaigns } = require('./meta-publisher');
    const campaigns = listPublishedCampaigns();
    activeCampaigns = campaigns.length;
  } catch { /* ignore */ }

  // Token status
  let tokenStatus = 'unknown';
  try {
    const { checkTokenValidity } = require('./token-manager');
    const status = await checkTokenValidity();
    tokenStatus = status.valid ? `${status.daysRemaining || '?'} days remaining` : 'EXPIRED';
  } catch { /* ignore */ }

  const html = `
    <div style="font-family: Arial, sans-serif; direction: rtl; text-align: right; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #e91e63;">Ticketeams Daily Summary — ${displayDate}</h2>
      <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
        <tr style="background: #f5f5f5;">
          <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold;">אירועים שנסרקו</td>
          <td style="padding: 10px; border: 1px solid #ddd;">${eventsScanned}</td>
        </tr>
        <tr>
          <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold;">אירועים חמים (hot+)</td>
          <td style="padding: 10px; border: 1px solid #ddd;">${hotEvents}</td>
        </tr>
        <tr style="background: #f5f5f5;">
          <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold;">החלטות חדשות</td>
          <td style="padding: 10px; border: 1px solid #ddd;">${decisions}</td>
        </tr>
        <tr>
          <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold;">קמפיינים פעילים</td>
          <td style="padding: 10px; border: 1px solid #ddd;">${activeCampaigns}</td>
        </tr>
        <tr style="background: #f5f5f5;">
          <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold;">Meta Token</td>
          <td style="padding: 10px; border: 1px solid #ddd;">${tokenStatus}</td>
        </tr>
      </table>
      <p style="color: #888; font-size: 12px;">Ticketeams AI Engine — סיכום אוטומטי</p>
    </div>
  `;

  const smtpHost = process.env.SMTP_HOST || 'smtp.gmail.com';
  const smtpPort = parseInt(process.env.SMTP_PORT || '587', 10);
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const emailTo = process.env.DAILY_SUMMARY_EMAIL_TO || process.env.INTELLIGENCE_EMAIL_TO;

  if (!smtpUser || !smtpPass || !emailTo) {
    logger.warn('orchestrator', 'dailySummary', `SMTP not configured — summary: ${eventsScanned} scanned, ${hotEvents} hot, ${decisions} decisions, ${activeCampaigns} campaigns, token: ${tokenStatus}`);
    return { sent: false, reason: 'SMTP not configured', summary: { eventsScanned, hotEvents, decisions, activeCampaigns, tokenStatus } };
  }

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465,
    auth: { user: smtpUser, pass: smtpPass },
  });

  await transporter.sendMail({
    from: `"Ticketeams AI" <${smtpUser}>`,
    to: emailTo,
    subject: `Ticketeams Daily Summary — ${displayDate}`,
    html,
  });

  logger.info('orchestrator', 'dailySummary', `Email sent to ${emailTo}`);
  return { sent: true, to: emailTo, summary: { eventsScanned, hotEvents, decisions, activeCampaigns, tokenStatus } };
}

// ============================================================
// Critical Alert Email
// ============================================================

/**
 * Send an email for a critical campaign alert.
 * Reuses existing SMTP infrastructure from sendDailySummary().
 *
 * @param {Object} alert - Decision/alert object with alertCategory, campaign, suggestedAction
 * @returns {{ sent: boolean, to?: string }}
 */
async function sendAlertEmail(alert) {
  const nodemailer = require('nodemailer');

  const smtpHost = process.env.SMTP_HOST || 'smtp.gmail.com';
  const smtpPort = parseInt(process.env.SMTP_PORT || '587', 10);
  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  const emailTo = process.env.DAILY_SUMMARY_EMAIL_TO || process.env.INTELLIGENCE_EMAIL_TO;

  if (!smtpUser || !smtpPass || !emailTo) {
    logger.warn('orchestrator', 'alertEmail', `SMTP not configured — alert: ${alert.suggestedAction?.reasoning}`);
    return { sent: false, reason: 'SMTP not configured' };
  }

  const alertCategoryLabels = {
    budget_burn: 'תקציב נגמר מהר',
    zero_impressions: 'מודעה לא רצה',
    low_roas: 'הפסד — ROAS נמוך',
    excellent_roas: 'ביצוע מצוין',
  };

  const categoryLabel = alertCategoryLabels[alert.alertCategory] || alert.alertCategory || 'התראה';

  const html = `
    <div style="font-family: Arial, sans-serif; direction: rtl; text-align: right; max-width: 600px; margin: 0 auto;">
      <h2 style="color: #ef4444;">התראה קריטית — Ticketeams</h2>
      <table style="width: 100%; border-collapse: collapse; margin: 20px 0;">
        <tr style="background: #fef2f2;">
          <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold;">קמפיין</td>
          <td style="padding: 10px; border: 1px solid #ddd;">${alert.campaign?.name || 'לא ידוע'}</td>
        </tr>
        <tr>
          <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold;">סוג התראה</td>
          <td style="padding: 10px; border: 1px solid #ddd;">${categoryLabel}</td>
        </tr>
        <tr style="background: #fef2f2;">
          <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold;">פירוט</td>
          <td style="padding: 10px; border: 1px solid #ddd;">${alert.suggestedAction?.reasoning || ''}</td>
        </tr>
        <tr>
          <td style="padding: 10px; border: 1px solid #ddd; font-weight: bold;">פעולה מומלצת</td>
          <td style="padding: 10px; border: 1px solid #ddd;">${alert.suggestedAction?.action || 'בדיקה'}</td>
        </tr>
      </table>
      <p style="color: #888; font-size: 12px;">Ticketeams AI Engine — התראה אוטומטית</p>
    </div>
  `;

  const transporter = nodemailer.createTransport({
    host: smtpHost,
    port: smtpPort,
    secure: smtpPort === 465,
    auth: { user: smtpUser, pass: smtpPass },
  });

  const subjectText = (alert.suggestedAction?.reasoning || categoryLabel).slice(0, 60);

  await transporter.sendMail({
    from: `"Ticketeams AI" <${smtpUser}>`,
    to: emailTo,
    subject: `התראה: ${subjectText}`,
    html,
  });

  logger.info('orchestrator', 'alertEmail', `Alert email sent to ${emailTo}: ${categoryLabel}`);
  return { sent: true, to: emailTo };
}

// ============================================================
// Scheduler Init
// ============================================================

/**
 * Initialize orchestrator cron jobs.
 * Call once from webhook-server.js inside app.listen().
 */
function initScheduler() {
  console.log('[ORCHESTRATOR-SCHEDULER] מאתחל cron jobs...');

  // Cron 1: Hot Event Check — 04:15 UTC (07:15 IST) daily
  // Runs 15 minutes AFTER intelligence scan (04:00 UTC) to ensure fresh data
  cron.schedule(config.scheduling.hotEventCheck, async () => {
    console.log('\n=== [ORCHESTRATOR] Scheduled Hot Event Check (07:15 IST) ===');
    let hotCheckResult = null;
    try {
      hotCheckResult = await getOrchestrator().runHotEventCheck();
      console.log(`[ORCHESTRATOR] Hot Event Check — ${hotCheckResult.decisions.length} decisions, ${hotCheckResult.durationMs}ms`);
    } catch (error) {
      console.error('[ORCHESTRATOR] שגיאה ב-Hot Event Check מתוזמן:', sanitizeError(error));
    }
    // Send daily summary email
    try {
      const summaryResult = await sendDailySummary(hotCheckResult);
      console.log(`[ORCHESTRATOR] Daily summary: sent=${summaryResult.sent}`);
    } catch (summaryErr) {
      console.error('[ORCHESTRATOR] Daily summary email failed:', sanitizeError(summaryErr));
    }
    console.log('=== [ORCHESTRATOR] Hot Event Check Complete ===\n');
  });

  // Cron 2: Performance Monitor — every 6 hours
  cron.schedule(config.scheduling.performanceMonitor, async () => {
    console.log('\n=== [ORCHESTRATOR] Scheduled Performance Check ===');
    try {
      const result = await getOrchestrator().runPerformanceCheck();
      console.log(`[ORCHESTRATOR] Performance Check — ${result.decisions.length} decisions, ${result.durationMs}ms`);
    } catch (error) {
      console.error('[ORCHESTRATOR] שגיאה ב-Performance Check מתוזמן:', sanitizeError(error));
    }
    console.log('=== [ORCHESTRATOR] Performance Check Complete ===\n');
  });

  console.log('[ORCHESTRATOR-SCHEDULER] Crons registered:');
  console.log(`  Hot Event Check: ${config.scheduling.hotEventCheck} (04:15 UTC / 07:15 IST daily)`);
  console.log(`  Performance Monitor: ${config.scheduling.performanceMonitor} (every 6 hours)`);
}

// ============================================================
// Self-test
// ============================================================

function selfTest() {
  console.log('=== Orchestrator Scheduler — בדיקה עצמית ===\n');

  console.log('Cron Expressions:');
  console.log(`  Hot Event Check: ${config.scheduling.hotEventCheck}`);
  console.log(`  Performance Monitor: ${config.scheduling.performanceMonitor}`);

  const valid1 = cron.validate(config.scheduling.hotEventCheck);
  const valid2 = cron.validate(config.scheduling.performanceMonitor);
  console.log(`\nValidation:`);
  console.log(`  hotEventCheck: ${valid1 ? '✓ תקין' : '✗ לא תקין'}`);
  console.log(`  performanceMonitor: ${valid2 ? '✓ תקין' : '✗ לא תקין'}`);

  console.log('\nExisting crons (not managed by scheduler):');
  console.log('  02:00 UTC — BI Refresh + Rima');
  console.log('  03:00 UTC — Token Health Check');
  console.log('  04:00 UTC — Intelligence Daily');
  console.log('  05:00 UTC Sun — Finance Weekly');
  console.log('  06:00 UTC Mon — Proactive Scan');
  console.log('  09:00 UTC — Ad Monitor');

  console.log('\nOrchestrator crons (managed by this scheduler):');
  console.log('  04:15 UTC — Hot Event Check (15min after intelligence)');
  console.log('  */6h UTC  — Performance Monitor');

  console.log('\n=== Orchestrator Scheduler — מוכן ===');
}

module.exports = { initScheduler, selfTest, sendDailySummary, sendAlertEmail };

if (require.main === module) {
  selfTest();
}
