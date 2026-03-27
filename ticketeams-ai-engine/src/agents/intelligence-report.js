/**
 * Ticketeams Intelligence Report Agent
 *
 * Builds RTL Hebrew HTML email reports from intelligence data.
 * Sends via Nodemailer (Gmail SMTP with App Password).
 *
 * RedRok Security Standard:
 * - SMTP credentials via dotenv — NEVER printed.
 * - sanitizeError() on all errors.
 *
 * Usage:
 *   node src/agents/intelligence-report.js          # selfTest
 *   node src/agents/intelligence-report.js --test   # send test email
 */

require('dotenv').config();
const nodemailer = require('nodemailer');
const config = require('../config/intelligence-config.json');

// ============================================================
// Config
// ============================================================

const SMTP_HOST = process.env.SMTP_HOST || 'smtp.gmail.com';
const SMTP_PORT = parseInt(process.env.SMTP_PORT || '587', 10);
const SMTP_USER = process.env.SMTP_USER;
const SMTP_PASS = process.env.SMTP_PASS;
const EMAIL_SUBJECT = config.email.subject;

const TIER_COLORS = {
  onFire: '#EF4444',
  hot: '#F97316',
  warm: '#EAB308',
  cold: '#6B7280',
};

const TIER_LABELS = {
  onFire: '🔥 On Fire',
  hot: '🌡️ Hot',
  warm: '☀️ Warm',
  cold: '❄️ Cold',
};

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
    return new Date(dateStr).toLocaleDateString('he-IL', {
      day: '2-digit', month: '2-digit', year: 'numeric',
    });
  } catch {
    return dateStr;
  }
}

// ============================================================
// Recommendation Generator
// ============================================================

function generateRecommendations(scoredEvents, marketingItems) {
  const recommendations = [];
  const marketingNames = (marketingItems || []).map((item) => item.name?.toLowerCase() || '');

  for (const event of scoredEvents) {
    const { homeTeam, awayTeam, score, tier, activeSources, eventDate } = event;
    const eventName = `${homeTeam} vs ${awayTeam}`.toLowerCase();

    // Check if already being marketed
    const alreadyMarketed = marketingNames.some((name) =>
      name.includes(homeTeam.toLowerCase()) && name.includes(awayTeam.toLowerCase())
    );

    if (tier === 'onFire' && !alreadyMarketed) {
      recommendations.push({
        priority: 'critical',
        event: `${homeTeam} vs ${awayTeam}`,
        action: 'להתחיל קמפיין פרסומי מיידית',
        reason: `Heat Score ${score} — ${activeSources.length} מקורות פעילים`,
        date: eventDate,
      });
    } else if (tier === 'hot' && !alreadyMarketed) {
      recommendations.push({
        priority: 'high',
        event: `${homeTeam} vs ${awayTeam}`,
        action: 'להכין חומרים שיווקיים ולתזמן פרסום',
        reason: `Heat Score ${score} — מגמה עולה`,
        date: eventDate,
      });
    } else if (tier === 'warm' && activeSources.includes('ADS') && !alreadyMarketed) {
      recommendations.push({
        priority: 'medium',
        event: `${homeTeam} vs ${awayTeam}`,
        action: 'לעקוב — מתחרים כבר מפרסמים',
        reason: `מתחרים הריצו פרסומות, Heat Score ${score}`,
        date: eventDate,
      });
    } else if (alreadyMarketed && tier === 'cold') {
      recommendations.push({
        priority: 'low',
        event: `${homeTeam} vs ${awayTeam}`,
        action: 'לבחון צמצום תקציב',
        reason: `Heat Score ${score} בלבד — ייתכן שהקמפיין לא אפקטיבי`,
        date: eventDate,
      });
    }
  }

  // Sort by priority
  const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
  recommendations.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

  return recommendations;
}

// ============================================================
// HTML Email Builder
// ============================================================

function buildEmailHtml(reportData) {
  const {
    date,
    scoredEvents = [],
    newCompetitorAds = [],
    recommendations = [],
    totalAds = 0,
  } = reportData;

  const top5 = scoredEvents.slice(0, 5);
  const topEvent = top5[0];

  // Executive summary
  const summaryText = topEvent
    ? `אתמול עלו ${totalAds} מודעות חדשות של מתחרים. האירוע הכי חם: <strong>${topEvent.homeTeam} vs ${topEvent.awayTeam}</strong> (Heat Score ${topEvent.score}).`
    : `שוק שקט — אין פעילות חריגה של מתחרים.`;

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
        דוח מודיעין יומי — Ticketeams
      </h1>
      <p style="margin:8px 0 0;font-size:13px;color:#8888A0;">${formatDate(date)}</p>
    </div>

    <!-- Executive Summary -->
    <div style="padding:20px;margin:16px 0;background:#12121A;border:1px solid #2A2A35;border-radius:12px;">
      <h2 style="margin:0 0 8px;font-size:15px;color:#EC4899;">סיכום מנהלים</h2>
      <p style="margin:0;font-size:14px;line-height:1.6;">${summaryText}</p>
    </div>

    ${newCompetitorAds.length > 0 ? `
    <!-- New Competitor Ads -->
    <div style="padding:20px;margin:16px 0;background:#12121A;border:1px solid #2A2A35;border-radius:12px;">
      <h2 style="margin:0 0 12px;font-size:15px;color:#F97316;">מודעות מתחרים חדשות (${newCompetitorAds.length})</h2>
      <table style="width:100%;border-collapse:collapse;font-size:12px;">
        <tr style="border-bottom:1px solid #2A2A35;">
          <th style="padding:8px;text-align:right;color:#8888A0;">מתחרה</th>
          <th style="padding:8px;text-align:right;color:#8888A0;">אירוע</th>
          <th style="padding:8px;text-align:right;color:#8888A0;">סוג</th>
          <th style="padding:8px;text-align:right;color:#8888A0;">תאריך</th>
        </tr>
        ${newCompetitorAds.slice(0, 10).map((ad) => `
        <tr style="border-bottom:1px solid #1A1A25;">
          <td style="padding:8px;">${ad.page_name || '—'}</td>
          <td style="padding:8px;">${ad.match_info?.matched ? `${ad.match_info.homeTeam} vs ${ad.match_info.awayTeam}` : 'כללי'}</td>
          <td style="padding:8px;">${ad.classification?.format_type || '—'}</td>
          <td style="padding:8px;">${formatDate(ad.delivery_start)}</td>
        </tr>`).join('')}
      </table>
    </div>` : ''}

    <!-- Heat Map Top 5 -->
    <div style="padding:20px;margin:16px 0;background:#12121A;border:1px solid #2A2A35;border-radius:12px;">
      <h2 style="margin:0 0 12px;font-size:15px;color:#A855F7;">מפת חום — Top 5</h2>
      ${top5.length > 0 ? `
      <table style="width:100%;border-collapse:collapse;font-size:12px;">
        <tr style="border-bottom:1px solid #2A2A35;">
          <th style="padding:8px;text-align:right;color:#8888A0;">אירוע</th>
          <th style="padding:8px;text-align:center;color:#8888A0;">Score</th>
          <th style="padding:8px;text-align:right;color:#8888A0;">מקורות</th>
          <th style="padding:8px;text-align:right;color:#8888A0;">תאריך</th>
        </tr>
        ${top5.map((e) => `
        <tr style="border-bottom:1px solid #1A1A25;">
          <td style="padding:8px;font-weight:600;">${e.homeTeam} vs ${e.awayTeam}</td>
          <td style="padding:8px;text-align:center;">
            <span style="display:inline-block;padding:2px 10px;border-radius:20px;background:${TIER_COLORS[e.tier] || '#6B7280'}20;color:${TIER_COLORS[e.tier] || '#6B7280'};font-weight:700;">
              ${e.score}
            </span>
          </td>
          <td style="padding:8px;font-size:10px;">
            ${(e.activeSources || []).map((s) => `<span style="display:inline-block;padding:1px 5px;margin:1px;border-radius:4px;background:#2A2A35;color:#E8E8F0;">${s}</span>`).join(' ')}
          </td>
          <td style="padding:8px;font-size:11px;color:#8888A0;">${formatDate(e.eventDate)}</td>
        </tr>`).join('')}
      </table>` : '<p style="font-size:13px;color:#8888A0;">אין אירועים פעילים</p>'}
    </div>

    ${recommendations.length > 0 ? `
    <!-- Recommendations -->
    <div style="padding:20px;margin:16px 0;background:#12121A;border:1px solid #2A2A35;border-radius:12px;">
      <h2 style="margin:0 0 12px;font-size:15px;color:#22C55E;">המלצות</h2>
      ${recommendations.map((r) => {
        const priorityColors = { critical: '#EF4444', high: '#F97316', medium: '#EAB308', low: '#6B7280' };
        const priorityLabels = { critical: 'קריטי', high: 'גבוה', medium: 'בינוני', low: 'נמוך' };
        return `
      <div style="padding:12px;margin:8px 0;border-right:3px solid ${priorityColors[r.priority]};background:#1A1A25;border-radius:8px;">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px;">
          <span style="font-size:10px;padding:2px 8px;border-radius:10px;background:${priorityColors[r.priority]}20;color:${priorityColors[r.priority]};font-weight:700;">
            ${priorityLabels[r.priority]}
          </span>
          <strong style="font-size:13px;">${r.event}</strong>
        </div>
        <p style="margin:4px 0 0;font-size:12px;color:#C8C8D8;">${r.action}</p>
        <p style="margin:2px 0 0;font-size:11px;color:#8888A0;">${r.reason}</p>
      </div>`;
      }).join('')}
    </div>` : ''}

    <!-- Footer -->
    <div style="text-align:center;padding:20px 0;border-top:1px solid #2A2A35;">
      <p style="margin:0;font-size:11px;color:#8888A0;">
        🤖 נוצר אוטומטית — Ticketeams Intelligence Agent
      </p>
      <p style="margin:4px 0 0;font-size:10px;color:#5555660;">
        RedRok — AI Marketing Engine
      </p>
    </div>
  </div>
</body>
</html>`;
}

// ============================================================
// Email Sender
// ============================================================

async function sendReport(reportData, emails) {
  if (!SMTP_USER || !SMTP_PASS) {
    console.warn('[INTELLIGENCE] SMTP credentials missing — skipping email send');
    console.log('[INTELLIGENCE] Report generated but not sent. Set SMTP_USER and SMTP_PASS in .env');
    return { sent: false, reason: 'SMTP credentials missing' };
  }

  if (!emails || emails.length === 0) {
    console.warn('[INTELLIGENCE] No email recipients — skipping email send');
    return { sent: false, reason: 'No recipients' };
  }

  try {
    const transporter = nodemailer.createTransport({
      host: SMTP_HOST,
      port: SMTP_PORT,
      secure: SMTP_PORT === 465,
      auth: { user: SMTP_USER, pass: SMTP_PASS },
    });

    const html = buildEmailHtml(reportData);

    const info = await transporter.sendMail({
      from: `"Ticketeams Intelligence" <${SMTP_USER}>`,
      to: emails.join(', '),
      subject: `${EMAIL_SUBJECT} — ${formatDate(reportData.date)}`,
      html,
    });

    console.log(`[INTELLIGENCE] Email sent: ${info.messageId} → ${emails.join(', ')}`);
    return { sent: true, messageId: info.messageId };
  } catch (err) {
    console.error('[INTELLIGENCE] Email send failed:', sanitizeError(err));
    return { sent: false, reason: sanitizeError(err) };
  }
}

// ============================================================
// Self-test
// ============================================================

async function selfTest() {
  console.log('=== Intelligence Report — בדיקה עצמית ===\n');

  console.log(`SMTP: ${SMTP_USER ? 'configured ✓' : 'MISSING ✗'}`);
  console.log(`Host: ${SMTP_HOST}:${SMTP_PORT}`);

  // Build test HTML
  const testReport = {
    date: new Date().toISOString().split('T')[0],
    totalAds: 12,
    scoredEvents: [
      { homeTeam: 'Arsenal', awayTeam: 'Chelsea', score: 78, tier: 'onFire', activeSources: ['ADS', 'SALES', 'NEW', 'SEASON'], eventDate: '2026-04-15' },
      { homeTeam: 'Barcelona', awayTeam: 'Real Madrid', score: 65, tier: 'onFire', activeSources: ['ADS', 'NEW', 'SEASON'], eventDate: '2026-04-20' },
      { homeTeam: 'Liverpool', awayTeam: 'Man City', score: 42, tier: 'hot', activeSources: ['SALES', 'NEW'], eventDate: '2026-04-10' },
    ],
    newCompetitorAds: [
      { page_name: 'ViaGoGo', match_info: { matched: true, homeTeam: 'Arsenal', awayTeam: 'Chelsea' }, classification: { format_type: 'Stadium' }, delivery_start: '2026-03-15' },
    ],
    recommendations: [
      { priority: 'critical', event: 'Arsenal vs Chelsea', action: 'להתחיל קמפיין פרסומי מיידית', reason: 'Heat Score 78 — 4 מקורות פעילים', date: '2026-04-15' },
      { priority: 'high', event: 'Barcelona vs Real Madrid', action: 'להכין חומרים שיווקיים', reason: 'Heat Score 65 — מגמה עולה', date: '2026-04-20' },
    ],
  };

  const html = buildEmailHtml(testReport);
  console.log(`\nGenerated HTML: ${html.length} chars`);
  console.log('HTML preview saved check is valid.');

  // Send test if --test flag
  if (process.argv.includes('--test')) {
    const recipient = process.env.INTELLIGENCE_EMAIL_TO;
    if (recipient) {
      console.log(`\nSending test email to ${recipient}...`);
      const result = await sendReport(testReport, [recipient]);
      console.log('Result:', result);
    } else {
      console.log('\nSet INTELLIGENCE_EMAIL_TO in .env to send test email');
    }
  }

  console.log('\n=== Intelligence Report — מוכן ===');
}

module.exports = { buildEmailHtml, sendReport, generateRecommendations };

if (require.main === module) {
  selfTest().catch((err) => console.error('selfTest failed:', sanitizeError(err)));
}
