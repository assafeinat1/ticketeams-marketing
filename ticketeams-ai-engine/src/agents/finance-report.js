/**
 * Ticketeams Finance Report Builder
 *
 * Builds RTL Hebrew HTML email reports for weekly financial data.
 * Sends via Nodemailer (Gmail SMTP).
 * Optionally logs summary to Monday.com.
 *
 * RedRok Security Standard:
 * - SMTP credentials via dotenv — NEVER printed.
 * - sanitizeError() on all errors.
 *
 * Usage:
 *   node src/agents/finance-report.js          # selfTest
 *   node src/agents/finance-report.js --test   # send test email
 */

require('dotenv').config();
const nodemailer = require('nodemailer');
const config = require('../config/finance-config.json');
const { createItemUpdate } = require('../config/monday');

// ============================================================
// Config
// ============================================================

const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587', 10);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const EMAIL_SUBJECT = config.email.subject;

// ============================================================
// Helpers
// ============================================================

function sanitizeError(err) {
  const msg = err?.message || String(err);
  return msg
    .replace(/pass(word)?[=:]\S+/gi, 'pass=[REDACTED]')
    .replace(/user[=:]\S+/gi, 'user=[REDACTED]');
}

function formatDate(dateStr) {
  if (!dateStr) return '—';
  try {
    return new Date(dateStr).toLocaleDateString('he-IL', { day: '2-digit', month: '2-digit', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

function formatCurrency(amount) {
  if (amount == null || isNaN(amount)) return '—';
  return `₪${Math.round(amount).toLocaleString('he-IL')}`;
}

function formatPct(value) {
  if (value == null || isNaN(value)) return '—';
  return `${value}%`;
}

// ============================================================
// HTML Email Builder
// ============================================================

function buildFinanceEmailHtml(reportData) {
  const {
    weekStart,
    weekEnd,
    executiveSummary = {},
    campaignPerformance = [],
    topEvents = [],
    channelPerformance = [],
    budgetRecommendations = [],
    alerts = [],
  } = reportData;

  const recBadgeColors = {
    increase: '#22C55E',
    maintain: '#EAB308',
    reduce: '#F97316',
    pause: '#EF4444',
    insufficient_data: '#6B7280',
    no_spend_data: '#6B7280',
  };

  const recBadgeLabels = {
    increase: 'להגדיל',
    maintain: 'לשמור',
    reduce: 'להפחית',
    pause: 'להשהות',
    insufficient_data: 'חסר מידע',
    no_spend_data: 'חסר הוצאה',
  };

  const severityColors = { critical: '#EF4444', warning: '#F97316', info: '#3B82F6' };
  const severityLabels = { critical: 'קריטי', warning: 'אזהרה', info: 'מידע' };

  return `<!DOCTYPE html>
<html dir="rtl" lang="he">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${EMAIL_SUBJECT}</title>
</head>
<body style="margin:0;padding:0;background:#0A0A0F;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#E8E8F0;direction:rtl;">
  <div style="max-width:640px;margin:0 auto;padding:24px 16px;">

    <!-- Header -->
    <div style="text-align:center;padding:24px 0;border-bottom:1px solid #2A2A35;">
      <h1 style="margin:0;font-size:22px;background:linear-gradient(135deg,#EC4899,#F97316,#A855F7);-webkit-background-clip:text;-webkit-text-fill-color:transparent;">
        ${EMAIL_SUBJECT}
      </h1>
      <p style="margin:8px 0 0;font-size:13px;color:#8888A0;">${formatDate(weekStart)} — ${formatDate(weekEnd)}</p>
    </div>

    <!-- Section 1: Executive Summary -->
    <div style="padding:20px;margin:16px 0;background:#12121A;border:1px solid #2A2A35;border-radius:12px;">
      <h2 style="margin:0 0 12px;font-size:15px;color:#EC4899;">סיכום מנהלים</h2>
      <div style="display:flex;flex-wrap:wrap;gap:12px;">
        ${_statBox('הכנסות', formatCurrency(executiveSummary.totalRevenue), '#A855F7')}
        ${_statBox('רווח', formatCurrency(executiveSummary.totalProfit), '#22C55E')}
        ${_statBox('מרווח', formatPct(executiveSummary.netMarginPct), '#EAB308')}
        ${_statBox('עסקאות', executiveSummary.dealCount || '—', '#EC4899')}
      </div>
      ${executiveSummary.summaryText ? `<p style="margin:12px 0 0;font-size:13px;line-height:1.6;">${executiveSummary.summaryText}</p>` : ''}
    </div>

    ${campaignPerformance.length > 0 ? `
    <!-- Section 2: Campaign Performance -->
    <div style="padding:20px;margin:16px 0;background:#12121A;border:1px solid #2A2A35;border-radius:12px;">
      <h2 style="margin:0 0 12px;font-size:15px;color:#F97316;">ביצועי קמפיינים</h2>
      <table style="width:100%;border-collapse:collapse;font-size:11px;">
        <tr style="border-bottom:1px solid #2A2A35;">
          <th style="padding:6px;text-align:right;color:#8888A0;">קמפיין</th>
          <th style="padding:6px;text-align:center;color:#8888A0;">עסקאות</th>
          <th style="padding:6px;text-align:center;color:#8888A0;">הכנסות</th>
          <th style="padding:6px;text-align:center;color:#8888A0;">הוצאה</th>
          <th style="padding:6px;text-align:center;color:#8888A0;">ROAS</th>
          <th style="padding:6px;text-align:center;color:#8888A0;">רווח</th>
        </tr>
        ${campaignPerformance.slice(0, 10).map((c) => `
        <tr style="border-bottom:1px solid #1A1A25;">
          <td style="padding:6px;font-weight:600;max-width:150px;overflow:hidden;text-overflow:ellipsis;">${c.campaignName}</td>
          <td style="padding:6px;text-align:center;">${c.dealCount}</td>
          <td style="padding:6px;text-align:center;">${formatCurrency(c.totalRevenue)}</td>
          <td style="padding:6px;text-align:center;">${c.adSpend > 0 ? formatCurrency(c.adSpend) : '—'}</td>
          <td style="padding:6px;text-align:center;">
            ${c.roas !== null ? `<span style="color:${c.roas >= 2 ? '#22C55E' : c.roas >= 1 ? '#EAB308' : '#EF4444'};font-weight:700;">${c.roas}x</span>` : '—'}
          </td>
          <td style="padding:6px;text-align:center;color:${c.totalProfit >= 0 ? '#22C55E' : '#EF4444'};">${formatCurrency(c.totalProfit)}</td>
        </tr>`).join('')}
      </table>
    </div>` : ''}

    ${topEvents.length > 0 ? `
    <!-- Section 3: Top Events -->
    <div style="padding:20px;margin:16px 0;background:#12121A;border:1px solid #2A2A35;border-radius:12px;">
      <h2 style="margin:0 0 12px;font-size:15px;color:#A855F7;">Top 5 אירועים לפי רווחיות</h2>
      <table style="width:100%;border-collapse:collapse;font-size:11px;">
        <tr style="border-bottom:1px solid #2A2A35;">
          <th style="padding:6px;text-align:right;color:#8888A0;">אירוע</th>
          <th style="padding:6px;text-align:center;color:#8888A0;">עסקאות</th>
          <th style="padding:6px;text-align:center;color:#8888A0;">הכנסות</th>
          <th style="padding:6px;text-align:center;color:#8888A0;">רווח</th>
          <th style="padding:6px;text-align:center;color:#8888A0;">מרווח</th>
        </tr>
        ${topEvents.slice(0, 5).map((e) => `
        <tr style="border-bottom:1px solid #1A1A25;">
          <td style="padding:6px;font-weight:600;">${e.eventName}</td>
          <td style="padding:6px;text-align:center;">${e.dealCount}</td>
          <td style="padding:6px;text-align:center;">${formatCurrency(e.totalRevenue)}</td>
          <td style="padding:6px;text-align:center;color:${e.totalProfit >= 0 ? '#22C55E' : '#EF4444'};">${formatCurrency(e.totalProfit)}</td>
          <td style="padding:6px;text-align:center;">${formatPct(e.grossMarginPct)}</td>
        </tr>`).join('')}
      </table>
    </div>` : ''}

    ${channelPerformance.length > 0 ? `
    <!-- Section 4: Channel Performance -->
    <div style="padding:20px;margin:16px 0;background:#12121A;border:1px solid #2A2A35;border-radius:12px;">
      <h2 style="margin:0 0 12px;font-size:15px;color:#22C55E;">ביצועי ערוצים</h2>
      <table style="width:100%;border-collapse:collapse;font-size:11px;">
        <tr style="border-bottom:1px solid #2A2A35;">
          <th style="padding:6px;text-align:right;color:#8888A0;">ערוץ</th>
          <th style="padding:6px;text-align:center;color:#8888A0;">עסקאות</th>
          <th style="padding:6px;text-align:center;color:#8888A0;">הכנסות</th>
          <th style="padding:6px;text-align:center;color:#8888A0;">רווח</th>
          <th style="padding:6px;text-align:center;color:#8888A0;">₪/עסקה</th>
        </tr>
        ${channelPerformance.slice(0, 8).map((ch) => `
        <tr style="border-bottom:1px solid #1A1A25;">
          <td style="padding:6px;font-weight:600;">${ch.channelLabel}</td>
          <td style="padding:6px;text-align:center;">${ch.dealCount}</td>
          <td style="padding:6px;text-align:center;">${formatCurrency(ch.totalRevenue)}</td>
          <td style="padding:6px;text-align:center;color:${ch.totalProfit >= 0 ? '#22C55E' : '#EF4444'};">${formatCurrency(ch.totalProfit)}</td>
          <td style="padding:6px;text-align:center;">${formatCurrency(ch.avgProfitPerDeal)}</td>
        </tr>`).join('')}
      </table>
    </div>` : ''}

    ${budgetRecommendations.length > 0 ? `
    <!-- Section 5: Budget Recommendations -->
    <div style="padding:20px;margin:16px 0;background:#12121A;border:1px solid #2A2A35;border-radius:12px;">
      <h2 style="margin:0 0 12px;font-size:15px;color:#3B82F6;">המלצות תקציב</h2>
      ${budgetRecommendations.filter((r) => r.roas !== null).slice(0, 6).map((r) => `
      <div style="padding:10px;margin:6px 0;border-right:3px solid ${recBadgeColors[r.recommendation]};background:#1A1A25;border-radius:8px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
          <span style="font-size:10px;padding:2px 8px;border-radius:10px;background:${recBadgeColors[r.recommendation]}20;color:${recBadgeColors[r.recommendation]};font-weight:700;">
            ${recBadgeLabels[r.recommendation]}
          </span>
          <strong style="font-size:12px;">${r.campaignName}</strong>
          <span style="font-size:11px;color:#8888A0;margin-right:auto;">ROAS ${r.roas}x</span>
        </div>
        <p style="margin:2px 0 0;font-size:11px;color:#C8C8D8;">${r.suggestedAction}</p>
      </div>`).join('')}
    </div>` : ''}

    ${alerts.length > 0 ? `
    <!-- Section 6: Alerts -->
    <div style="padding:20px;margin:16px 0;background:#12121A;border:1px solid #2A2A35;border-radius:12px;">
      <h2 style="margin:0 0 12px;font-size:15px;color:#EF4444;">התראות (${alerts.length})</h2>
      ${alerts.slice(0, 6).map((a) => `
      <div style="padding:10px;margin:6px 0;border-right:3px solid ${severityColors[a.severity]};background:#1A1A25;border-radius:8px;">
        <div style="display:flex;align-items:center;gap:8px;">
          <span style="font-size:10px;padding:2px 8px;border-radius:10px;background:${severityColors[a.severity]}20;color:${severityColors[a.severity]};font-weight:700;">
            ${severityLabels[a.severity]}
          </span>
          <span style="font-size:12px;">${a.message}</span>
        </div>
      </div>`).join('')}
    </div>` : ''}

    <!-- Footer -->
    <div style="text-align:center;padding:20px 0;border-top:1px solid #2A2A35;">
      <p style="margin:0;font-size:11px;color:#8888A0;">
        🤖 נוצר אוטומטית — Ticketeams Finance Agent
      </p>
      <p style="margin:4px 0 0;font-size:10px;color:#555566;">
        RedRok — AI Marketing Engine
      </p>
    </div>
  </div>
</body>
</html>`;
}

// Stat box helper for executive summary
function _statBox(label, value, color) {
  return `<div style="flex:1;min-width:120px;padding:12px;background:#1A1A25;border-radius:8px;text-align:center;">
    <p style="margin:0;font-size:11px;color:#8888A0;">${label}</p>
    <p style="margin:4px 0 0;font-size:18px;font-weight:700;color:${color};">${value}</p>
  </div>`;
}

// ============================================================
// Email Sender
// ============================================================

async function sendFinanceReport(reportData, emails) {
  if (!SMTP_USER || !SMTP_PASS) {
    console.warn('[FINANCE] SMTP credentials missing — skipping email send');
    return { sent: false, reason: 'SMTP credentials missing' };
  }

  if (!emails || emails.length === 0) {
    console.warn('[FINANCE] No email recipients — skipping email send');
    return { sent: false, reason: 'No recipients' };
  }

  try {
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });

    const html = buildFinanceEmailHtml(reportData);

    const info = await transporter.sendMail({
      from: `"Ticketeams Finance" <${SMTP_USER}>`,
      to: emails.join(', '),
      subject: `${EMAIL_SUBJECT} — ${formatDate(reportData.weekStart)}`,
      html,
    });

    console.log(`[FINANCE] Email sent: ${info.messageId} → ${emails.join(', ')}`);
    return { sent: true, messageId: info.messageId };
  } catch (err) {
    console.error('[FINANCE] Email send failed:', sanitizeError(err));
    return { sent: false, reason: sanitizeError(err) };
  }
}

// ============================================================
// Monday.com Logger
// ============================================================

async function logReportToMonday(reportData) {
  const itemId = process.env.FINANCE_MONDAY_LOG_ITEM_ID;
  if (!itemId) {
    return { logged: false, reason: 'FINANCE_MONDAY_LOG_ITEM_ID not set' };
  }

  try {
    const { executiveSummary, alerts } = reportData;
    const body = [
      `📊 דוח פיננסי שבועי — ${formatDate(reportData.weekStart)}`,
      '',
      `הכנסות: ${formatCurrency(executiveSummary?.totalRevenue)}`,
      `רווח: ${formatCurrency(executiveSummary?.totalProfit)}`,
      `מרווח: ${formatPct(executiveSummary?.netMarginPct)}`,
      `עסקאות: ${executiveSummary?.dealCount || 0}`,
      '',
      alerts?.length > 0 ? `התראות: ${alerts.length}` : 'אין התראות',
      '',
      '🤖 נוצר אוטומטית — Finance Agent',
    ].join('\n');

    const result = await createItemUpdate(parseInt(itemId), body);
    console.log(`[FINANCE] Report logged to Monday — Item ${itemId}`);
    return { logged: true, itemId };
  } catch (err) {
    console.error('[FINANCE] Monday log failed:', sanitizeError(err));
    return { logged: false, reason: sanitizeError(err) };
  }
}

// ============================================================
// Self-test
// ============================================================

async function selfTest() {
  console.log('=== Finance Report — בדיקה עצמית ===\n');

  console.log(`SMTP: ${SMTP_USER ? 'configured ✓' : 'MISSING ✗'}`);

  const testReport = {
    weekStart: '2026-03-08',
    weekEnd: '2026-03-14',
    executiveSummary: {
      totalRevenue: 85000,
      totalProfit: 31000,
      netMarginPct: 36.5,
      dealCount: 28,
      summaryText: 'השבוע נסגרו 28 עסקאות בהכנסה של ₪85K ורווח נטו של ₪31K. ROAS הכולל: 7.2x.',
    },
    campaignPerformance: [
      { campaignName: 'מונדיאל 2026', dealCount: 8, totalRevenue: 45000, totalProfit: 32000, adSpend: 1200, roas: 37.5 },
      { campaignName: 'שלבי הכרעה אלופות', dealCount: 2, totalRevenue: 3000, totalProfit: -2000, adSpend: 800, roas: 0.47 },
    ],
    topEvents: [
      { eventName: 'ריאל נגד ארסנל', dealCount: 4, totalRevenue: 37000, totalProfit: 12000, grossMarginPct: 31.6 },
    ],
    channelPerformance: [
      { channelLabel: 'פרסומת Meta', dealCount: 12, totalRevenue: 55000, totalProfit: 10700, avgProfitPerDeal: 893 },
      { channelLabel: 'משפיענים', dealCount: 3, totalRevenue: 9000, totalProfit: 567, avgProfitPerDeal: 189 },
    ],
    budgetRecommendations: [
      { campaignName: 'מונדיאל 2026', roas: 37.5, recommendation: 'increase', suggestedAction: 'להגדיל תקציב +30%' },
      { campaignName: 'שלבי הכרעה אלופות', roas: 0.47, recommendation: 'pause', suggestedAction: 'להשהות מיידית' },
    ],
    alerts: [
      { severity: 'critical', message: 'קמפיין "שלבי הכרעה אלופות" מפסיד כסף — ROAS 0.47x' },
      { severity: 'warning', message: 'ערוץ "משפיענים" — רווח ממוצע ₪189/עסקה' },
    ],
  };

  const html = buildFinanceEmailHtml(testReport);
  console.log(`Generated HTML: ${html.length} chars`);

  if (process.argv.includes('--test')) {
    const recipient = process.env.FINANCE_EMAIL_TO || process.env.INTELLIGENCE_EMAIL_TO;
    if (recipient) {
      console.log(`\nSending test email to ${recipient}...`);
      const result = await sendFinanceReport(testReport, [recipient]);
      console.log('Result:', result);
    } else {
      console.log('\nSet FINANCE_EMAIL_TO in .env to send test email');
    }
  }

  console.log('\n=== Finance Report — מוכן ===');
}

module.exports = { buildFinanceEmailHtml, sendFinanceReport, logReportToMonday };

if (require.main === module) {
  selfTest().catch((err) => console.error('selfTest failed:', sanitizeError(err)));
}
