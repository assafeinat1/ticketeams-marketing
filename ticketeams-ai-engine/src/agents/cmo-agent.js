require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { getMatchPricing, getLeagueCurrency } = require('./scout-agent');
const { getBoardItems } = require('../config/monday');
const { dataMask, maskObject, aggregateForBI } = require('../config/data-mask');
const { selectFormatType } = require('../config/creative-rules');

// ============================================================
// Golden Rule: ArenaPrice < TicketeamsPrice < LivePrice
// המחיר של Ticketeams תמיד באמצע — לא הכי זול, לא הכי יקר
// ============================================================

// ============================================================
// 1. calculateRecommendedPrice — תמיד 90% מ-LiveTickets
//    ArenaTickets (ILS) משמש לאימות קטגוריות בלבד, לא לחישוב
// ============================================================
function calculateRecommendedPrice(livePrice, liveCurrency) {
  try {
    if (livePrice == null) {
      return null;
    }

    const raw = livePrice * 0.90;
    return {
      price: Math.ceil(raw / 5) * 5,
      currency: liveCurrency,
    };
  } catch (error) {
    console.error('שגיאה בחישוב מחיר מומלץ:', error.message);
    return null;
  }
}

// ============================================================
// 2. mapCategories — מתאים קטגוריות בין האתרים לפי מחיר
// ============================================================
function mapCategories(scoutResults) {
  try {
    const arenaData = scoutResults.sources?.arenatickets;
    const liveData = scoutResults.sources?.livetickets;

    // מיון לפי מחיר — מהזול ליקר
    const arenaSorted = (arenaData?.categories || [])
      .filter((c) => c.price > 0)
      .sort((a, b) => a.price - b.price);

    const liveSorted = (liveData?.categories || [])
      .filter((c) => c.price > 0)
      .sort((a, b) => a.price - b.price);

    const maxLen = Math.max(arenaSorted.length, liveSorted.length);
    const mapped = [];

    for (let i = 0; i < maxLen; i++) {
      const arena = arenaSorted[i] || null;
      const live = liveSorted[i] || null;

      mapped.push({
        index: i,
        arena: arena ? { name: arena.name, price: arena.price, currency: arena.currency } : null,
        live: live ? { name: live.name, price: live.price, currency: live.currency } : null,
      });
    }

    return mapped;
  } catch (error) {
    console.error('שגיאה במיפוי קטגוריות:', error.message);
    return [];
  }
}

// ============================================================
// 3. generatePricingReport — דוח תמחור מלא עם המלצות
// ============================================================
async function generatePricingReport(homeTeam, awayTeam, competition, date) {
  try {
    // שליפת מחירים מ-scout-agent (with fallback for unknown teams)
    let scoutResults;
    try {
      scoutResults = await getMatchPricing(homeTeam, awayTeam, competition, date);
    } catch (scoutErr) {
      console.warn(`[CMO] Scout pricing failed for ${homeTeam} vs ${awayTeam}: ${scoutErr.message}`);
      console.warn(`[CMO] Using empty pricing fallback — team not in venue config`);
      scoutResults = {
        matchKey: `${homeTeam}__${awayTeam}`.toLowerCase().replace(/\s+/g, '_'),
        homeTeam, awayTeam, competition, date,
        stadium: 'לא ידוע',
        currency: competition?.includes('Premier') ? 'GBP' : 'EUR',
        sources: { livetickets: { categories: [] }, arenatickets: { categories: [] } },
      };
    }
    const officialCurrency = scoutResults.currency;

    // מיפוי קטגוריות לפי מחיר
    const mapped = mapCategories(scoutResults);

    const recommendations = [];

    for (const pair of mapped) {
      const livePrice = pair.live?.price || null;
      const liveCurrency = pair.live?.currency || null;
      const arenaPrice = pair.arena?.price || null;
      const arenaCurrency = pair.arena?.currency || null;

      const result = calculateRecommendedPrice(livePrice, liveCurrency);

      recommendations.push({
        category: pair.live?.name || pair.arena?.name || `קטגוריה ${pair.index + 1}`,
        live: {
          name: pair.live?.name || null,
          price: livePrice,
          currency: liveCurrency,
        },
        recommended: {
          price: result?.price || null,
          currency: result?.currency || officialCurrency,
          formula: livePrice != null ? `${livePrice} × 0.90 = ${result?.price}` : null,
        },
        arena: {
          name: pair.arena?.name || null,
          price: arenaPrice,
          currency: arenaCurrency,
          role: 'אימות קטגוריות בלבד — לא לחישוב מחיר',
        },
      });
    }

    const report = {
      matchKey: scoutResults.matchKey,
      homeTeam,
      awayTeam,
      competition,
      date,
      stadium: scoutResults.stadium,
      currency: officialCurrency,
      generatedAt: new Date().toISOString(),
      recommendations,
    };

    // הדפסת דוח
    console.log('\n=== דוח תמחור CMO ===');
    console.log(`${homeTeam} vs ${awayTeam} | ${competition} | ${date}`);
    console.log(`מטבע ליגה: ${officialCurrency}`);
    console.log('---');
    for (const rec of recommendations) {
      const liveStr = rec.live.price != null ? `${rec.live.price} ${rec.live.currency}` : 'חסר';
      const recStr = rec.recommended.price != null ? `${rec.recommended.price} ${rec.recommended.currency}` : 'לא ניתן';
      const arenaStr = rec.arena.price != null ? `${rec.arena.price} ${rec.arena.currency}` : 'חסר';

      console.log(`${rec.category}:`);
      console.log(`  Live: ${liveStr} → Ticketeams: ${recStr} (90%)`);
      console.log(`  Arena: ${arenaStr} (לעיון בלבד)`);
    }
    console.log('======================\n');

    return report;
  } catch (error) {
    console.error('שגיאה ביצירת דוח תמחור:', error.message);
    throw error;
  }
}

// ============================================================
// 4. decideCounterAd — החלטה על פרסומת נגדית
//    Human/Urgency → ליצור Stadium (להתבלט בפיד)
//    Stadium → לא ליצור (כבר דומה)
// ============================================================
function decideCounterAd(competitorAd, matchInfo) {
  try {
    const formatType = competitorAd.classification?.format_type || 'Unknown';

    const decision = {
      create_counter_ad: false,
      recommended_format: null,
      reasoning: '',
      homeTeam: matchInfo.homeTeam || null,
      awayTeam: matchInfo.awayTeam || null,
      trigger_creative: false,
    };

    if (formatType === 'Human') {
      decision.create_counter_ad = true;
      decision.recommended_format = 'Stadium';
      decision.reasoning = 'מתחרה משתמש בפורמט Human — נייצר פורמט Stadium כדי להתבלט בפיד';
      decision.trigger_creative = true;
    } else if (formatType === 'Urgency') {
      decision.create_counter_ad = true;
      decision.recommended_format = 'Human';
      decision.reasoning = 'מתחרה משתמש בדחיפות — נייצר פורמט Human רגשי כניגוד';
      decision.trigger_creative = true;
    } else if (formatType === 'Stadium') {
      decision.create_counter_ad = true;
      decision.recommended_format = 'Human';
      decision.reasoning = 'מתחרה משתמש בפורמט Stadium — נייצר פורמט Human כדי להתבלט בפיד';
      decision.trigger_creative = true;
    } else {
      decision.reasoning = `פורמט לא מזוהה (${formatType}) — לא ניתן להחליט`;
    }

    console.log(`\n=== CMO Decision ===`);
    console.log(`  מתחרה: ${formatType}`);
    console.log(`  החלטה: ${decision.create_counter_ad ? 'ליצור נגדית' : 'לא ליצור'}`);
    console.log(`  פורמט מומלץ: ${decision.recommended_format || 'אין'}`);
    console.log(`  נימוק: ${decision.reasoning}`);
    console.log('===================\n');

    return decision;
  } catch (error) {
    console.error('שגיאה בהחלטת CMO:', error.message);
    return {
      create_counter_ad: false,
      recommended_format: null,
      reasoning: `שגיאה: ${error.message}`,
      trigger_creative: false,
    };
  }
}

// ============================================================
// BI INTELLIGENCE — Constants
// ============================================================

const BI_CACHE_DIR = path.join(__dirname, '..', 'cache', 'bi');
const BI_CACHE_TTL_DAYS = 1;

// Whitelist: only these fields pass through maskObject
const BI_ALLOWED_FIELDS = ['id', 'name', 'competition', 'date', 'home_team', 'away_team', 'status', 'talking_agent'];

// ============================================================
// 5. fetchHistoricalData — masked Monday.com board items
// ============================================================

async function fetchHistoricalData() {
  // Check cache
  if (!fs.existsSync(BI_CACHE_DIR)) {
    fs.mkdirSync(BI_CACHE_DIR, { recursive: true });
  }

  const cacheFile = path.join(BI_CACHE_DIR, 'historical_data.json');
  if (fs.existsSync(cacheFile)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
      const ageInDays = (Date.now() - cached.timestamp) / (1000 * 60 * 60 * 24);
      if (ageInDays <= BI_CACHE_TTL_DAYS) {
        console.log(`BI cache valid (${Math.round(ageInDays * 24)} hours old)`);
        return cached.items;
      }
    } catch (err) {
      console.warn('BI cache read failed, fetching fresh:', err.message);
    }
  }

  // Fetch from Monday.com
  const rawItems = await getBoardItems();

  // Mask each item — whitelist approach
  const maskedItems = rawItems.map((item) => {
    const cols = {};
    for (const col of item.column_values || []) {
      cols[col.id] = col.text;
    }

    return maskObject(
      { id: item.id, name: item.name, ...cols },
      BI_ALLOWED_FIELDS
    );
  });

  // Save to cache
  fs.writeFileSync(cacheFile, JSON.stringify({
    timestamp: Date.now(),
    savedAt: new Date().toISOString(),
    items: maskedItems,
  }, null, 2), 'utf-8');

  console.log(`BI: ${maskedItems.length} items fetched and masked`);
  return maskedItems;
}

// ============================================================
// 6. analyzeByCompetition — group items by competition
// ============================================================

function analyzeByCompetition(maskedItems) {
  const byComp = {};

  for (const item of maskedItems) {
    const comp = item.competition || 'unknown';
    if (!byComp[comp]) {
      byComp[comp] = { count: 0, items: [] };
    }
    byComp[comp].count++;
    byComp[comp].items.push(item);
  }

  // Calculate avg lead time per competition
  const analysis = {};
  for (const [comp, data] of Object.entries(byComp)) {
    const leadTimes = data.items
      .filter((i) => i.date)
      .map((i) => {
        const eventDate = new Date(i.date);
        const now = new Date();
        return Math.round((eventDate - now) / (1000 * 60 * 60 * 24));
      })
      .filter((d) => !isNaN(d));

    const avgLeadTime = leadTimes.length > 0
      ? Math.round(leadTimes.reduce((a, b) => a + b, 0) / leadTimes.length)
      : null;

    analysis[comp] = {
      count: data.count,
      avgLeadTimeDays: avgLeadTime,
    };
  }

  return analysis;
}

// ============================================================
// 7. analyzeLeadTimePatterns — lead time distribution
// ============================================================

function analyzeLeadTimePatterns(maskedItems) {
  const patterns = {
    byRange: {
      '0-7d': 0,
      '8-14d': 0,
      '15-30d': 0,
      '31-60d': 0,
      '61-90d': 0,
      '90d+': 0,
    },
    byCompetition: {},
    optimal: null,
  };

  const allLeadTimes = [];

  for (const item of maskedItems) {
    if (!item.date) continue;
    const eventDate = new Date(item.date);
    const now = new Date();
    const days = Math.round((eventDate - now) / (1000 * 60 * 60 * 24));
    if (isNaN(days)) continue;

    allLeadTimes.push(days);

    if (days <= 7) patterns.byRange['0-7d']++;
    else if (days <= 14) patterns.byRange['8-14d']++;
    else if (days <= 30) patterns.byRange['15-30d']++;
    else if (days <= 60) patterns.byRange['31-60d']++;
    else if (days <= 90) patterns.byRange['61-90d']++;
    else patterns.byRange['90d+']++;

    const comp = item.competition || 'unknown';
    if (!patterns.byCompetition[comp]) patterns.byCompetition[comp] = [];
    patterns.byCompetition[comp].push(days);
  }

  // Find optimal lead time range (most items)
  const sorted = Object.entries(patterns.byRange).sort((a, b) => b[1] - a[1]);
  if (sorted.length > 0 && sorted[0][1] > 0) {
    patterns.optimal = { range: sorted[0][0], count: sorted[0][1] };
  }

  // Avg per competition
  for (const [comp, days] of Object.entries(patterns.byCompetition)) {
    const avg = Math.round(days.reduce((a, b) => a + b, 0) / days.length);
    patterns.byCompetition[comp] = { avgDays: avg, count: days.length };
  }

  return patterns;
}

// ============================================================
// 8. analyzeSeasonalTrends — group by event month
// ============================================================

function analyzeSeasonalTrends(maskedItems) {
  const byMonth = {};
  const monthNames = ['ינואר', 'פברואר', 'מרץ', 'אפריל', 'מאי', 'יוני', 'יולי', 'אוגוסט', 'ספטמבר', 'אוקטובר', 'נובמבר', 'דצמבר'];

  for (const item of maskedItems) {
    if (!item.date) continue;
    const d = new Date(item.date);
    if (isNaN(d)) continue;
    const month = d.getMonth(); // 0-11
    const key = `${month + 1}-${monthNames[month]}`;

    if (!byMonth[key]) byMonth[key] = 0;
    byMonth[key]++;
  }

  const counts = Object.values(byMonth);
  const avg = counts.length > 0 ? counts.reduce((a, b) => a + b, 0) / counts.length : 0;

  const peakMonths = [];
  const lowMonths = [];

  for (const [month, count] of Object.entries(byMonth)) {
    if (count > avg * 1.2) peakMonths.push({ month, count });
    else if (count < avg * 0.8) lowMonths.push({ month, count });
  }

  return { byMonth, peakMonths, lowMonths, avgPerMonth: Math.round(avg * 10) / 10 };
}

// ============================================================
// 9. recommendFormatFromHistory — bridge BI to creative-rules
// ============================================================

function recommendFormatFromHistory(competition, daysUntilEvent, historicalAnalysis) {
  if (!historicalAnalysis) return null;

  const compData = historicalAnalysis.byCompetition?.[competition];
  if (!compData) return null;

  // If competition typically sells in the 30-60d range and we're in that range → Stadium
  // If we're close (≤14d) and competition is PL → Urgency pressure via Human
  if (daysUntilEvent != null && daysUntilEvent <= 14 && competition === 'premier_league') {
    return 'Human';
  }

  if (competition === 'champions_league') {
    return 'Stadium'; // CL = always epic visuals
  }

  return null; // Fall through to default logic
}

// ============================================================
// 10. generateBIReport — orchestrates all BI analysis
// ============================================================

async function generateBIReport() {
  // Check cache
  if (!fs.existsSync(BI_CACHE_DIR)) {
    fs.mkdirSync(BI_CACHE_DIR, { recursive: true });
  }

  const cacheFile = path.join(BI_CACHE_DIR, 'bi_report.json');
  if (fs.existsSync(cacheFile)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
      const ageInDays = (Date.now() - cached.timestamp) / (1000 * 60 * 60 * 24);
      if (ageInDays <= BI_CACHE_TTL_DAYS) {
        console.log('BI report from cache');
        return cached.report;
      }
    } catch (err) {
      console.warn('BI report cache read failed, regenerating:', err.message);
    }
  }

  console.log('\n=== Generating BI Report ===');

  const maskedItems = await fetchHistoricalData();
  const competitionAnalysis = analyzeByCompetition(maskedItems);
  const leadTimePatterns = analyzeLeadTimePatterns(maskedItems);
  const seasonalTrends = analyzeSeasonalTrends(maskedItems);

  const report = {
    generatedAt: new Date().toISOString(),
    totalItems: maskedItems.length,
    byCompetition: competitionAnalysis,
    leadTime: leadTimePatterns,
    seasonal: seasonalTrends,
    insights: [],
  };

  // Auto-generate insights
  if (seasonalTrends.peakMonths.length > 0) {
    report.insights.push(`חודשי שיא: ${seasonalTrends.peakMonths.map((m) => m.month).join(', ')}`);
  }
  if (seasonalTrends.lowMonths.length > 0) {
    report.insights.push(`חודשים שקטים: ${seasonalTrends.lowMonths.map((m) => m.month).join(', ')}`);
  }
  if (leadTimePatterns.optimal) {
    report.insights.push(`טווח מכירה עיקרי: ${leadTimePatterns.optimal.range} (${leadTimePatterns.optimal.count} פריטים)`);
  }

  // Print report
  console.log(`\nTotal items: ${report.totalItems}`);
  console.log('\nBy Competition:');
  for (const [comp, data] of Object.entries(competitionAnalysis)) {
    console.log(`  ${comp}: ${data.count} events (avg lead time: ${data.avgLeadTimeDays ?? '?'} days)`);
  }
  console.log('\nLead Time Distribution:');
  for (const [range, count] of Object.entries(leadTimePatterns.byRange)) {
    console.log(`  ${range}: ${count}`);
  }
  if (report.insights.length > 0) {
    console.log('\nInsights:');
    report.insights.forEach((i) => console.log(`  • ${i}`));
  }
  console.log('\n=== BI Report Complete ===\n');

  // Save to cache
  fs.writeFileSync(cacheFile, JSON.stringify({
    timestamp: Date.now(),
    report,
  }, null, 2), 'utf-8');

  return report;
}

// ============================================================
// 11. triggerRimaCampaign — compose masked input → Rima (Gemini)
// ============================================================

async function triggerRimaCampaign(biReport, demandData) {
  // Only trigger if there's actionable data
  if (!biReport || biReport.totalItems === 0) {
    return { triggered: false, reason: 'אין נתונים היסטוריים' };
  }

  // Check for actionable patterns
  const hasInsights = (biReport.insights || []).length > 0;
  const hasCriticalDemand = (demandData?.suggestions || []).some((s) => s.demandTier === 'critical');

  if (!hasInsights && !hasCriticalDemand) {
    return { triggered: false, reason: 'אין דפוס שמצדיק קמפיין' };
  }

  // Compose masked input — aggregated numbers only, zero PII
  const lines = [
    `דוח BI — ${biReport.generatedAt}`,
    `סך הכל אירועים בלוח: ${biReport.totalItems}`,
    '',
    'התפלגות לפי תחרות:',
  ];

  for (const [comp, data] of Object.entries(biReport.byCompetition || {})) {
    lines.push(`  ${comp}: ${data.count} אירועים (lead time ממוצע: ${data.avgLeadTimeDays ?? '?'} ימים)`);
  }

  if (biReport.insights?.length > 0) {
    lines.push('', 'תובנות:');
    biReport.insights.forEach((i) => lines.push(`  • ${i}`));
  }

  if (demandData?.suggestions?.length > 0) {
    lines.push('', 'הצעות ביקוש גבוה:');
    for (const s of demandData.suggestions.slice(0, 5)) {
      lines.push(`  [${s.demandScore}] ${dataMask(s.homeTeam)} vs ${dataMask(s.awayTeam)} — ${s.reason}`);
    }
  }

  lines.push('', 'מה האסטרטגיה המומלצת לשבוע הקרוב?');

  const maskedInput = lines.join('\n');

  // Call Rima via Gemini
  try {
    const { generateStrategy } = require('./gemini-agent');
    const result = await generateStrategy(maskedInput);

    console.log('\n=== Rima Campaign Strategy ===');
    console.log(result.strategy.substring(0, 1000));
    console.log('==============================\n');

    return {
      triggered: true,
      strategy: result.strategy,
      reason: hasCriticalDemand ? 'ביקוש קריטי זוהה' : 'תובנות BI פעילות',
      model: result.model,
      generatedAt: result.generatedAt,
    };
  } catch (error) {
    console.error('שגיאה בהפעלת Rima:', error.message);
    return {
      triggered: false,
      reason: `שגיאת Gemini: ${error.message}`,
    };
  }
}

// ============================================================
// בדיקה עצמית
// ============================================================
async function selfTest() {
  console.log('=== CMO Agent — בדיקה עצמית ===\n');

  // חישוב 90% מ-Live
  const t1 = calculateRecommendedPrice(350, 'GBP');
  console.log(`350 GBP × 0.90 = ${t1.price} ${t1.currency}`);

  const t2 = calculateRecommendedPrice(465, 'GBP');
  console.log(`465 GBP × 0.90 = ${t2.price} ${t2.currency}`);

  const t3 = calculateRecommendedPrice(null, null);
  console.log(`חסר Live → ${t3}`);

  // דוח תמחור חי
  console.log('\n--- דוח תמחור חי ---');
  try {
    await generatePricingReport('Arsenal', 'Everton', 'Premier League', '2026-03-14');
  } catch (err) {
    console.error('דוח תמחור — נכשל:', err.message);
  }

  console.log('=== CMO Agent — מוכן ===');
}

module.exports = {
  calculateRecommendedPrice,
  mapCategories,
  generatePricingReport,
  decideCounterAd,
  // BI functions
  fetchHistoricalData,
  analyzeByCompetition,
  analyzeLeadTimePatterns,
  analyzeSeasonalTrends,
  recommendFormatFromHistory,
  generateBIReport,
  triggerRimaCampaign,
};

if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.includes('--bi')) {
    generateBIReport().catch(console.error);
  } else if (args.includes('--rima')) {
    (async () => {
      const biReport = await generateBIReport();
      const result = await triggerRimaCampaign(biReport);
      console.log(`Triggered: ${result.triggered} | Reason: ${result.reason}`);
    })().catch(console.error);
  } else {
    selfTest();
  }
}
