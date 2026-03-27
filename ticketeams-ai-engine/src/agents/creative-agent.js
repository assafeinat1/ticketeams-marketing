/**
 * Ticketeams Creative Agent v3
 *
 * שלב א: Claude API → 3 גרסאות טקסט
 * שלב ב: בחירת FORMAT_TYPE + רקע (חוקי ברזל)
 * שלב ג: הכנת Canva operations (Nano Banana → Canva overlay → Export)
 *
 * חוקי ברזל:
 * 1. לוגו Ticketeams = תמיד asset MAHBGt1xTfc. אסור טקסט.
 * 2. רקע חכם לפי event_type (football→stadium, mundial→FIFA, ucl→trophy, concert→stage)
 * 3. לוגואי קבוצות מ-Canva uploads בלבד.
 * 4. FORMAT_TYPE: Stadium/Human/Urgency לפי event + counter-logic.
 */

require('dotenv').config();
const path = require('path');
const {
  selectFormatType,
  selectBackgroundConfig,
  calcDaysUntilEvent,
  TICKETEAMS_LOGO_ASSET_ID,
} = require('../config/creative-rules');
const { buildAllOperations } = require('./canva-agent');
const { execSync } = require('child_process');

// Creative Free — Canva MCP template (brand kit fonts for sharp Hebrew)
const CREATIVE_FREE_TEMPLATE = {
  designId: 'DAHE-mw2Nao',
  elements: {
    background: 'LBwksjNDm785p0gG',
    ttLogo: 'LBDc6XlyVwKRdV60',
    ctaText: 'LB7WQwxFzN8plPty',
    footerText: 'LBm4S8rWtz9TZZHx',
  },
};

// Gemini Imagen — Nano Banana for AI backgrounds + creative free images
let generateSmartBackground, generateStadiumBackground, generateImage, editImage;
try {
  ({ generateSmartBackground, generateStadiumBackground, generateImage, editImage } = require('./gemini-agent'));
} catch (err) {
  console.warn('gemini-agent לא זמין:', err.message);
  generateSmartBackground = null;
  generateStadiumBackground = null;
  generateImage = null;
  editImage = null;
}

// image-composer ייטען רק אם קיים
let composeAllFormats, saveComposedImages;
try {
  ({ composeAllFormats, saveComposedImages } = require('./image-composer'));
} catch (err) {
  console.warn('image-composer לא זמין (legacy fallback):', err.message);
  composeAllFormats = null;
  saveComposedImages = null;
}

/**
 * Helper — resolves stadium name from venues.json by home team
 */
function resolveStadium(homeTeam) {
  try {
    const venues = require('../config/venues.json');
    const teamKey = homeTeam.toLowerCase().replace(/\s+/g, '_');
    const venueEntry = venues.teams?.[teamKey] || venues[teamKey];
    if (venueEntry?.stadium) return venueEntry.stadium;
  } catch { /* venues.json not available */ }
  return `אצטדיון ${homeTeam}`;
}

// ==================== שלב א: יצירת טקסט ====================

function buildPrompt(pricingReport) {
  const { homeTeam, awayTeam, competition, date, stadium } = pricingReport;

  return `אתה קופירייטר של Ticketeams — חברת כרטיסים לאירועי ספורט בינלאומיים.
הסלוגן שלנו: "הכרטיס שלך לחלום"
הצבעים שלנו: ורוד, כתום, סגול.

צור בדיוק 3 גרסאות טקסט מודעה עבור המשחק הבא:
משחק: ${homeTeam} נגד ${awayTeam}
תחרות: ${competition}
תאריך: ${date}
אצטדיון: ${stadium || 'לא צוין'}

צור בדיוק 3 גרסאות:
גרסה 1 — רגשית:
מדברת ללב, חלום, חוויה בלתי נשכחת. משתמשת ברגש ובדמיון.
גרסה 2 — מידעית:
ישירה ומדויקת. מציגה את העובדות: מי משחק, מתי, איפה.
גרסה 3 — דחיפות:
יוצרת תחושת FOMO. מוגבל, נגמר מהר, הזדמנות אחרונה.
לכל גרסה כתוב בדיוק:
- headline (קצר וחזק — מקסימום 5 מילים! כותרת פאנצ׳ית שתופסת את העין. דוגמאות: "הלילה שלך בברנבאו", "ליגת האלופות מחכה לך", "הדרבי שלא תשכח")
- body (עד 125 תווים — מגבלת Meta Ads)
- cta (קריאה לפעולה — עד 20 תווים)

חוק שפה: עברית בלבד — ללא מילים באנגלית בכלל. שמות קבוצות ואצטדיונים — תרגם לעברית. מילים באנגלית (שמות אנגלים) — תמיד בסוף המשפט או בסוגריים.

חוק מחירים — חובה: אסור בהחלט לציין מחירים, סכומים, או מטבעות בשום צורה. לא "מ-200", לא "החל מ-", לא "£", לא "€", לא "GBP", לא "EUR" — כלום. פרסומת שמכילה מחיר — פסולה.

הפורמט: JSON בלבד — מערך של 3 אובייקטים עם השדות: style, headline, body, cta
אל תוסיף טקסט מחוץ ל-JSON.`;
}

async function generateAdCopies(pricingReport) {
  try {
    const prompt = buildPrompt(pricingReport);

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': process.env.ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1000,
        messages: [{ role: 'user', content: prompt }],
      }),
    });

    const data = await response.json();

    if (data.type === 'error') {
      throw new Error(`Claude API error: ${data.error?.message || JSON.stringify(data.error)}`);
    }

    const rawText = data.content?.[0]?.text?.trim();
    if (!rawText) throw new Error('Claude לא החזיר תוכן');

    const jsonMatch = rawText.match(/\[[\s\S]*\]/);
    if (!jsonMatch) throw new Error('Claude לא החזיר JSON תקין');

    const adCopies = JSON.parse(jsonMatch[0]);

    if (!Array.isArray(adCopies) || adCopies.length !== 3) {
      throw new Error(`צפוי 3 גרסאות, התקבלו ${adCopies?.length || 0}`);
    }

    // וולידציה: שדות חובה + חוק מחירים
    const pricePattern = /[\d]+\s*(£|€|\$|GBP|EUR|USD|ILS|פאונד|יורו|שקל|שקלים)|מ-\d|החל מ-?\s?\d|starting from|from \d|price|מחיר/i;
    for (const copy of adCopies) {
      if (!copy.headline || !copy.body || !copy.cta) {
        throw new Error('גרסה חסרה שדות: headline, body, או cta');
      }
      const fullText = `${copy.headline} ${copy.body} ${copy.cta}`;
      if (pricePattern.test(fullText)) {
        console.warn(`[${copy.style}] מכיל מחיר — מנקה אוטומטית`);
        copy.body = copy.body.replace(/מ-[\d,]+\s*(£|€|\$|GBP|EUR|USD|פאונד|יורו)?/gi, '').trim();
        copy.headline = copy.headline.replace(/מ-[\d,]+\s*(£|€|\$|GBP|EUR|USD|פאונד|יורו)?/gi, '').trim();
      }
    }

    console.log('=== Creative Agent — 3 גרסאות טקסט נוצרו ===');
    for (const copy of adCopies) {
      console.log(`[${copy.style}] ${copy.headline}`);
    }

    return adCopies;
  } catch (error) {
    console.error('שגיאה ביצירת טקסטים:', error.message);
    throw error;
  }
}

// ==================== פורמט לMeta ====================

function formatForMeta(adCopies) {
  try {
    return adCopies.map((copy) => ({
      style: copy.style,
      facebook: {
        primary_text: copy.body,
        headline: copy.headline,
        description: copy.cta,
      },
      instagram: {
        caption: `${copy.headline}\n\n${copy.body}\n\n${copy.cta}`,
      },
    }));
  } catch (error) {
    console.error('שגיאה בעיצוב ל-Meta:', error.message);
    throw error;
  }
}

// ==================== שלב ב: רקע AI (Nano Banana / Gemini Imagen) ====================

async function generateAIBackground(matchKey, competition, homeTeam) {
  if (!generateSmartBackground) {
    throw new Error('Nano Banana (Gemini) לא זמין — חסר gemini-agent');
  }

  if (!process.env.GEMINI_API_KEY) {
    throw new Error('Nano Banana (Gemini) לא זמין — חסר GEMINI_API_KEY ב-.env');
  }

  // Smart style selection based on event type
  const compLower = (competition || '').toLowerCase();
  const isUCL = /champions|ucl|ליגת.?האלופות/i.test(compLower);
  const isWorldCup = /world cup|mundial|גביע.?העולם/i.test(compLower);
  const isConcert = /concert|הופעה|פסטיבל/i.test(compLower);

  let style = 'epic';
  let eventType = 'football';
  const stadium = resolveStadium(homeTeam);

  if (isUCL) { style = 'dramatic'; eventType = 'ucl'; }
  else if (isWorldCup && /new york|nyc|ניו יורק/i.test(compLower)) { style = 'wc_nyc'; eventType = 'mundial'; }
  else if (isWorldCup && /los angeles|la|לוס אנג/i.test(compLower)) { style = 'wc_la'; eventType = 'mundial'; }
  else if (isWorldCup) { style = 'wc_general'; eventType = 'mundial'; }
  else if (isConcert) { style = 'concert'; eventType = 'concert'; }
  else if (/la liga|laliga|ליגה.?ספרדית/i.test(compLower)) eventType = 'laliga';
  else if (/premier|epl|פרמייר/i.test(compLower)) eventType = 'epl';

  const outputDir = path.join(__dirname, '..', 'generated-ads', matchKey);
  const bgPath = path.join(outputDir, `stadium_bg_${style}.png`);

  console.log(`  [Nano Banana] יוצר רקע חכם (style=${style}, eventType=${eventType})...`);
  const result = await generateSmartBackground({ style, stadium, eventType }, bgPath);
  const sizeKB = Math.round(result.size / 1024);
  console.log(`  [Nano Banana] רקע נוצר — ${result.mimeType}, ${sizeKB} KB → ${result.path}`);

  // Auto-save to backgrounds library (never overwrite)
  try {
    const fs = require('fs');
    const bgLibDir = path.join(__dirname, '..', 'assets', 'backgrounds');
    fs.mkdirSync(bgLibDir, { recursive: true });
    const venue = stadium.replace(/[^a-zA-Z0-9א-ת]/g, '_').toLowerCase().slice(0, 40);
    const today = new Date().toISOString().slice(0, 10);
    const ext = path.extname(result.path) || '.jpg';
    let libName = `${venue}_${style}_${today}${ext}`;
    let libPath = path.join(bgLibDir, libName);
    // Never overwrite — append counter if exists
    let counter = 1;
    while (fs.existsSync(libPath)) {
      libName = `${venue}_${style}_${today}_${counter}${ext}`;
      libPath = path.join(bgLibDir, libName);
      counter++;
    }
    fs.copyFileSync(result.path, libPath);
    console.log(`  [BG Library] Saved → backgrounds/${libName}`);
  } catch (libErr) {
    console.warn(`  [BG Library] Save failed: ${libErr.message}`);
  }

  return result.path;
}

// ==================== שלב ג: יצירת תמונות ====================

async function generateImages(matchData, adCopies, matchKey, backgroundPath) {
  try {
    if (!saveComposedImages) {
      throw new Error('image-composer לא זמין');
    }

    // Pass AI background path to composer
    const enrichedMatchData = { ...matchData };
    if (backgroundPath) {
      enrichedMatchData.backgroundPath = backgroundPath;
    }

    const results = await saveComposedImages(enrichedMatchData, adCopies, matchKey);
    return results;
  } catch (error) {
    console.error('שגיאה ביצירת תמונות:', error.message);
    throw error;
  }
}

// ==================== Test mode — story + square only, single copy ====================

async function generateTestImages(matchData, adCopy, matchKey, backgroundPath) {
  if (!composeAllFormats) {
    throw new Error('image-composer לא זמין');
  }
  const enrichedMatchData = { ...matchData };
  if (backgroundPath) enrichedMatchData.backgroundPath = backgroundPath;

  // Only story + square
  const results = {};
  const { composeImage } = require('./image-composer');
  const outDir = path.join(__dirname, '..', 'generated-ads', matchKey);
  const fs = require('fs');
  fs.mkdirSync(outDir, { recursive: true });

  for (const format of ['story', 'square']) {
    const fn = `${matchKey}_${adCopy.style}_${format}.jpg`;
    const op = path.join(outDir, fn);
    try {
      await composeImage(enrichedMatchData, adCopy, format, op);
      results[format] = op;
      console.log(`  ✓ ${adCopy.style} / ${format}`);
    } catch (e) {
      console.error(`  ✗ ${adCopy.style} / ${format}: ${e.message}`);
      results[format] = null;
    }
  }
  return results;
}

// ==================== Creative Free — Prompt Builder ====================

/**
 * buildCreativeFreePlan — Full Creative Free plan: image tool + text overlay.
 *
 * STEP 1 tool selection:
 *   - OBJECT (UCL/Finals) → generate_stadium_background + edit_image adds trophy
 *   - HUMAN (all others)  → generate_image with sharp foreground person
 *
 * STEP 2 text overlay:
 *   - edit_image adds Hebrew headline + CTA directly on image
 *   - Agent has full creative freedom on headline text
 *   - IRON RULE: Never show prices. Never.
 *
 * @returns {{ tool, prompt?, stadiumStyle?, editPrompt?, textPrompt: string }}
 */
function buildCreativeFreePlan(homeTeam, awayTeam, competition) {
  const compLower = (competition || '').toLowerCase();
  const isUCL = /champions|ucl|ליגת.?האלופות/i.test(compLower);
  const isFinal = /final|גמר/i.test(compLower);
  const isConcert = /concert|הופעה|פסטיבל/i.test(compLower);
  const isWorldCup = /world cup|mundial|מונדיאל/i.test(compLower);
  const isLaLiga = /la liga|laliga|ליגה.?ספרדית/i.test(compLower);
  const isElClasico = /real madrid.*barcelona|barcelona.*real madrid/i.test(`${homeTeam} ${awayTeam}`);
  const isPremierLeague = /premier|epl|פרמיירליג/i.test(compLower);

  const Q = 'Professional portrait photography, Canon EOS R5, 85mm lens, f/2.0, photorealistic, ultra sharp subject, 4K quality, crystal clear details.';
  const NO_TEXT = 'NO text, NO watermarks, NO logos, NO overlays in the image.';

  // --- TEXT OVERLAY PROMPT (Step 2) ---
  // ONLY headline + sub-headline. NO CTA, NO footer — Canva template handles those.
  const TEXT_STYLE = 'Bold white text, clean modern font, slight shadow for readability. Professional advertising design. Keep the photo behind fully intact. Do NOT add any button, CTA, or footer text at the bottom — leave the bottom 25% of the image clean for the Canva template overlay. NEVER add any price or number with currency symbol.';

  // UCL / Finals → OBJECT: stadium + trophy composite
  if (isUCL || isFinal) {
    return {
      tool: 'object',
      stadiumStyle: 'dramatic',
      editPrompt: `Add a gleaming Champions League trophy in the center foreground of this stadium image. The trophy should be large, prominent, and in SHARP FOCUS — engravings, handles, and reflections clearly visible. Keep the stadium background intact. Pink and orange light reflections on the trophy surface. Photorealistic, ultra detailed.`,
      textPrompt: `Add bold Hebrew text overlay on this image. At the top center, large bold white headline: 'ליגת האלופות מגיעה'. Below it, smaller white text: '${homeTeam} נגד ${awayTeam}'. ${TEXT_STYLE}`,
    };
  }

  // World Cup → HUMAN: celebrating fan with national flag
  if (isWorldCup) {
    return {
      tool: 'human',
      prompt: `Football fan celebrating passionately, arms raised in victory, holding a national flag. Wearing national team jersey with visible details. SHARP FOCUS on the person — face, expression, jersey, flag crystal clear. Stadium crowd in soft bokeh behind, pink (#E91E8C) and orange (#FF6B35) stadium lights. Shallow depth of field. ${Q} ${NO_TEXT}`,
      textPrompt: `Add bold Hebrew text overlay on this image. At the top center, large bold white headline: 'המונדיאל מתקרב'. Below it, smaller white text: '${homeTeam} נגד ${awayTeam}'. ${TEXT_STYLE}`,
    };
  }

  // Concert → HUMAN: performer on stage
  if (isConcert) {
    return {
      tool: 'human',
      prompt: `Performer on stage, dramatic silhouette with arms raised holding microphone. SHARP FOCUS on the performer — body, hands, microphone crystal clear. Pink (#E91E8C) and orange (#FF6B35) stage spotlights creating volumetric beams through fog behind. Crowd in soft bokeh below. Shallow depth of field. ${Q} ${NO_TEXT}`,
      textPrompt: `Add bold Hebrew text overlay on this image. At the top center, large bold white headline: 'ההופעה של השנה'. Below it, smaller white text: '${homeTeam}'. ${TEXT_STYLE}`,
    };
  }

  // El Clasico → HUMAN: two rival fans portrait
  if (isElClasico) {
    return {
      tool: 'human',
      prompt: `Two football fans sitting side by side at a Spanish football stadium, rivals match night. Left fan wearing FC Barcelona blue and red jersey, right fan wearing Real Madrid white jersey. Both looking at camera, smiling, faces clearly visible. SHARP FOCUS on both faces and jerseys. Crystal clear portrait, shallow depth of field, stadium lights bokeh behind them. ${Q} ${NO_TEXT}`,
      textPrompt: `Add bold Hebrew text overlay on this image. At the top center, large bold white headline: 'הקלאסיקו הגדול מגיע'. Below it, smaller white text: 'ברצלונה נגד ריאל מדריד'. ${TEXT_STYLE}`,
    };
  }

  // La Liga → HUMAN: two rival fans portrait
  if (isLaLiga) {
    return {
      tool: 'human',
      prompt: `Two passionate Spanish football fans side by side at a La Liga stadium night match. Left fan wearing ${homeTeam} jersey, right fan wearing ${awayTeam} jersey. Both looking at camera with excited expressions. SHARP FOCUS on both faces and jerseys. Crystal clear portrait, shallow depth of field, stadium lights bokeh behind. ${Q} ${NO_TEXT}`,
      textPrompt: `Add bold Hebrew text overlay on this image. At the top center, large bold white headline: 'הליגה הספרדית בוערת'. Below it, smaller white text: '${homeTeam} נגד ${awayTeam}'. ${TEXT_STYLE}`,
    };
  }

  // Premier League → HUMAN: fan in team jersey
  if (isPremierLeague) {
    return {
      tool: 'human',
      prompt: `Passionate English football fan in stadium crowd, wearing ${homeTeam} jersey, scarf around neck, arms raised celebrating. SHARP FOCUS on the person — face, jersey details, expression crystal clear. Packed Premier League stadium in soft bokeh behind, pink (#E91E8C) and orange (#FF6B35) floodlights through English rain mist. Shallow depth of field. ${Q} ${NO_TEXT}`,
      textPrompt: `Add bold Hebrew text overlay on this image. At the top center, large bold white headline: 'הפרמיירליג חוזרת'. Below it, smaller white text: '${homeTeam} נגד ${awayTeam}'. ${TEXT_STYLE}`,
    };
  }

  // Default → HUMAN: fan celebrating in team jersey
  return {
    tool: 'human',
    prompt: `Football fan celebrating in stadium crowd, wearing ${homeTeam} jersey, arms raised in triumph. SHARP FOCUS on the person — face, jersey details, expression crystal clear. Packed stadium in soft bokeh behind, pink (#E91E8C) and orange (#FF6B35) floodlights through light fog. Shallow depth of field. ${Q} ${NO_TEXT}`,
    textPrompt: `Add bold Hebrew text overlay on this image. At the top center, large bold white headline: 'המשחק הגדול מגיע'. Below it, smaller white text: '${homeTeam} נגד ${awayTeam}'. ${TEXT_STYLE}`,
  };
}

// ==================== Creative Free — Catbox Upload Helper ====================

function uploadToCatbox(filePath) {
  try {
    const result = execSync(
      `curl -s -F "reqtype=fileupload" -F "fileToUpload=@${filePath}" https://catbox.moe/user/api.php`,
      { timeout: 30000, encoding: 'utf-8' }
    );
    const url = result.trim();
    if (!url.startsWith('http')) throw new Error(`catbox returned: ${url}`);
    console.log(`  [Upload] catbox.moe → ${url}`);
    return url;
  } catch (err) {
    console.warn(`  [Upload] catbox failed: ${err.message}, trying uguu.se...`);
    const result = execSync(
      `curl -s -F "files[]=@${filePath}" https://uguu.se/upload`,
      { timeout: 30000, encoding: 'utf-8' }
    );
    const parsed = JSON.parse(result);
    const url = parsed.files?.[0]?.url;
    if (!url) throw new Error(`uguu returned: ${result}`);
    console.log(`  [Upload] uguu.se → ${url}`);
    return url;
  }
}

// ==================== Creative Free — Canva MCP Pipeline ====================

/**
 * generateCreativeFreeCanva — Generates background + builds Canva MCP plan.
 * Architecture: Agent prepares operations, Claude executes via MCP.
 *
 * @param {Object} matchData - { homeTeam, awayTeam, competition, date }
 * @param {Object[]} adCopies - Array of ad copy objects
 * @param {string} matchKey - e.g. "Real-Madrid_Arsenal_2026-04-18"
 * @returns {Object} { backgroundPath, publicUrl, canvaPlan, outputDir }
 */
/**
 * generateCreativeFreeImages — Full automated Creative Free pipeline.
 *
 * STEP 1: Generate sharp image (tool depends on event type)
 * STEP 2: Add creative Hebrew text via edit_image
 * STEP 3: Upload → Canva MCP plan (logo + export)
 * STEP 4: Save to generated-ads/{matchKey}/creative_free_story.jpg
 *
 * @returns {{ composedImages, canvaPlan }}
 */
async function generateCreativeFreeImages(matchData, adCopies, matchKey) {
  if (!generateImage && !generateStadiumBackground) {
    throw new Error('nano-banana agents לא זמינים — חסר gemini-agent');
  }

  const fs = require('fs');
  const { homeTeam, awayTeam, competition } = matchData;
  const outputDir = path.join(__dirname, '..', 'generated-ads', matchKey);
  fs.mkdirSync(outputDir, { recursive: true });

  const plan = buildCreativeFreePlan(homeTeam, awayTeam, competition);
  console.log(`  [Creative Free] Tool: ${plan.tool} | ${homeTeam} vs ${awayTeam} (${competition})`);

  // ── STEP 1: Generate sharp base image ──
  let basePath;

  if (plan.tool === 'object') {
    // Stadium base → edit_image adds object (trophy, etc.)
    console.log(`  [STEP 1] OBJECT mode → stadium(${plan.stadiumStyle}) + edit_image`);
    const stadiumPath = path.join(outputDir, 'creative_free_stadium_base.jpg');
    const stadium = await generateStadiumBackground(plan.stadiumStyle, stadiumPath);
    console.log(`  [STEP 1] Stadium base: ${Math.round(stadium.size / 1024)} KB`);
    const compositedPath = path.join(outputDir, 'creative_free_composited.jpg');
    console.log('  [STEP 1] Adding object via edit_image...');
    const composited = await editImage(stadium.path, plan.editPrompt, compositedPath);
    console.log(`  [STEP 1] Composited: ${Math.round(composited.size / 1024)} KB`);
    basePath = composited.path;

  } else {
    // Human subject → generate_image (always sharp)
    console.log('  [STEP 1] HUMAN mode → generate_image');
    const rawPath = path.join(outputDir, 'creative_free_base_story.jpg');
    const result = await generateImage(plan.prompt, rawPath, { width: 1080, height: 1920 });
    console.log(`  [STEP 1] Raw: ${Math.round(result.size / 1024)} KB`);
    basePath = result.path;
  }

  // ── STEP 2: Add creative text via edit_image ──
  console.log('  [STEP 2] Adding Hebrew text via edit_image...');
  const textPath = path.join(outputDir, 'creative_free_with_text.jpg');
  const withText = await editImage(basePath, plan.textPrompt, textPath);
  console.log(`  [STEP 2] With text: ${Math.round(withText.size / 1024)} KB`);

  // Save final image locally
  const finalStoryPath = path.join(outputDir, 'creative_free_story.jpg');
  fs.copyFileSync(withText.path, finalStoryPath);
  console.log(`  [STEP 2] Saved: ${finalStoryPath}`);

  // ── STEP 3: Upload → Canva MCP plan (logo + export) ──
  console.log('  [STEP 3] Uploading to catbox.moe...');
  const publicUrl = uploadToCatbox(withText.path);

  const canvaPlan = {
    templateDesignId: CREATIVE_FREE_TEMPLATE.designId,
    elements: CREATIVE_FREE_TEMPLATE.elements,
    backgroundUrl: publicUrl,
    outputPath: path.join(outputDir, 'creative_free_canva_story.png'),
    steps: [
      { tool: 'resize-design', params: { design_id: CREATIVE_FREE_TEMPLATE.designId, width: 1080, height: 1920 }, note: 'Duplicate template → returns copy_design_id' },
      { tool: 'upload-asset-from-url', params: { url: publicUrl, name: `cf_bg_${matchKey}` }, note: 'Upload background → returns bg_asset_id' },
      { tool: 'start-editing-transaction', params: { design_id: '{{copy_design_id}}' }, note: 'Open editing session' },
      { tool: 'perform-editing-operations', params: { operations: [{ type: 'update_fill', target: { element_id: CREATIVE_FREE_TEMPLATE.elements.background }, fill: { type: 'image', asset_id: '{{bg_asset_id}}' } }] }, note: 'Replace background' },
      { tool: 'commit-editing-transaction', params: { transaction_id: '{{transaction_id}}' }, note: 'Save changes' },
      { tool: 'export-design', params: { design_id: '{{copy_design_id}}', format: { type: 'png', width: 1080, height: 1920 } }, note: 'Export final PNG' },
    ],
  };

  console.log('  [STEP 3] Canva MCP plan ready — 6 steps for Claude execution');
  console.log('  ✓ Creative Free pipeline complete');

  return {
    composedImages: { story: finalStoryPath },
    canvaPlan,
  };
}

// ==================== הפונקציה הראשית ====================

async function generateCreative(homeTeam, awayTeam, competition, date, opts = {}) {
  const isTest = opts.test === true;
  try {
    console.log(`\nCreative Agent — ${homeTeam} נגד ${awayTeam} | ${competition}${isTest ? ' [TEST MODE]' : ''}`);

    // שלב א: Scout + CMO
    let pricingReport;
    try {
      const { generatePricingReport } = require('./cmo-agent');
      pricingReport = await generatePricingReport(homeTeam, awayTeam, competition, date);
    } catch (err) {
      console.warn('CMO pricing unavailable, using fallback:', err.message);
      const stadium = resolveStadium(homeTeam);
      pricingReport = { homeTeam, awayTeam, competition, date, stadium };
    }

    // שלב ב: Claude — יצירת 3 גרסאות טקסט
    const adCopies = await generateAdCopies(pricingReport);

    // Test mode: only first copy (רגשית)
    const copiesToUse = isTest ? [adCopies[0]] : adCopies;

    // שלב ג: Nano Banana — רקע אצטדיון AI
    const matchKey = `${homeTeam.replace(/\s+/g, '-')}_${awayTeam.replace(/\s+/g, '-')}_${date}`;
    let backgroundPath = null;
    try {
      backgroundPath = await generateAIBackground(matchKey, competition, homeTeam);
    } catch (bgError) {
      console.error(`  [Nano Banana] שגיאה: ${bgError.message}`);
      console.warn('  ממשיך עם רקע סטטי...');
    }

    // שלב ד: MODE 1 — Template
    const matchData = { homeTeam, awayTeam, competition, date };

    let templateImages = null;
    try {
      console.log(`\n=== MODE 1: Template${isTest ? ' [TEST — story+square only]' : ''} ===`);
      if (isTest) {
        // Test mode: only story + square for first copy
        templateImages = await generateTestImages(matchData, copiesToUse[0], matchKey, backgroundPath);
      } else {
        templateImages = await generateImages(matchData, adCopies, matchKey, backgroundPath);
      }
    } catch (imgError) {
      console.error('שגיאה בתמונות template:', imgError.message);
    }

    // שלב ה: MODE 2 — Creative Free (always runs — both modes for every campaign)
    let creativeFreeData = null;
    try {
      console.log(`\n=== MODE 2: Creative Free (story + square) ===`);
      creativeFreeData = await generateCreativeFreeImages(matchData, copiesToUse, matchKey);
    } catch (cfError) {
      console.error('שגיאה ב-creative free:', cfError.message);
    }

    // שלב ו: פורמט לMeta
    const metaAds = formatForMeta(adCopies);

    // סיכום
    const templateCount = templateImages ? Object.values(templateImages).reduce((n, fmt) => {
      if (typeof fmt === 'string') return n + 1; // flat format (test mode)
      return n + Object.keys(fmt).filter(k => fmt[k]).length;
    }, 0) : 0;
    const freeCount = creativeFreeData?.composedImages ? Object.values(creativeFreeData.composedImages).filter(Boolean).length : 0;
    console.log(`\n=== Dual Mode Summary ===`);
    console.log(`  Template: ${templateCount} images`);
    console.log(`  Creative Free: ${freeCount} images`);
    console.log(`  Total: ${templateCount + freeCount} images`);
    console.log(`========================\n`);

    return {
      matchKey,
      homeTeam,
      awayTeam,
      competition,
      date,
      pricingReport,
      adCopies,
      metaAds,
      templateImages,
      creativeFreeImages: creativeFreeData?.composedImages || null,
      creativeFreeCanvaPlan: creativeFreeData?.canvaPlan || null,
      backgroundSource: backgroundPath ? 'nano-banana-gemini' : 'static-fallback',
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    console.error('Creative Agent נכשל:', error.message);
    throw error;
  }
}

// ==================== Pipeline V3: Nano Banana → Canva ====================

/**
 * generateCreativeV3 — Pipeline חדש עם חוקי ברזל
 *
 * @param {Object} eventData
 * @param {string} eventData.homeTeam
 * @param {string} eventData.awayTeam
 * @param {string} eventData.competition
 * @param {string} eventData.date
 * @param {string} [eventData.stadium]
 * @param {string} [eventData.event_type] — football/mundial/ucl/concert
 * @param {string} [eventData.competitor_format] — Stadium/Human/Urgency (from ad-monitor)
 * @param {string} [eventData.backgroundAssetId] — Canva asset ID of uploaded background
 *
 * @returns {Object} Pipeline result with instructions for Claude MCP orchestration
 */
async function generateCreativeV3(eventData) {
  try {
    const {
      homeTeam, awayTeam, competition, date,
      event_type = 'football',
      competitor_format = null,
      backgroundAssetId = null,
    } = eventData;

    console.log(`\nCreative Agent v3 — ${homeTeam} נגד ${awayTeam} | ${competition}`);

    // שלב 1 — בחירת FORMAT_TYPE (חוק ברזל 4)
    const daysUntil = calcDaysUntilEvent(date);
    const formatType = selectFormatType(event_type, daysUntil, competitor_format);
    console.log(`  FORMAT_TYPE: ${formatType} (event=${event_type}, days=${daysUntil}, competitor=${competitor_format || 'none'})`);

    // שלב 2 — הגדרות רקע (חוק ברזל 2)
    const bgConfig = selectBackgroundConfig(event_type);
    console.log(`  רקע: ${bgConfig.description}`);

    // שלב 3 — יצירת 3 גרסאות טקסט (Claude Haiku)
    const stadium = eventData.stadium || resolveStadium(homeTeam);

    const pricingReport = { homeTeam, awayTeam, competition, date, stadium };
    const adCopies = await generateAdCopies(pricingReport);

    // שלב 4 — הכנת Canva operations
    const canvaData = {
      headline: `${homeTeam} נגד ${awayTeam}`,
      dates: `${competition} | ${date}`,
      cta: adCopies[0].cta,
      teams: {
        topLeft: homeTeam,
        topRight: awayTeam,
      },
    };
    const canvaResult = buildAllOperations(canvaData, backgroundAssetId);

    // שלב 5 — פורמט ל-Meta
    const metaAds = formatForMeta(adCopies);

    const matchKey = `${homeTeam.replace(/\s+/g, '-')}_${awayTeam.replace(/\s+/g, '-')}_${date}`;

    // שלב 6 — יצירת רקע AI (Nano Banana) — ביצוע בפועל
    let backgroundImagePath = null;
    try {
      backgroundImagePath = await generateAIBackground(matchKey, competition, homeTeam);
      console.log(`  [v3] רקע נוצר: ${backgroundImagePath}`);
    } catch (bgErr) {
      console.warn(`  [v3] רקע AI נכשל, ימשיך בלי רקע: ${bgErr.message}`);
    }

    // שלב 7 — יצירת תמונות מורכבות (image-composer)
    let composedImages = null;
    if (backgroundImagePath) {
      try {
        const matchData = {
          homeTeam, awayTeam, competition, date, stadium,
          backgroundPath: backgroundImagePath,
        };
        composedImages = await generateImages(matchData, adCopies, matchKey, backgroundImagePath);
        const imgCount = composedImages ? Object.values(composedImages).reduce((n, fmt) => n + Object.keys(fmt).length, 0) : 0;
        console.log(`  [v3] תמונות נוצרו: ${imgCount} תמונות`);
      } catch (imgErr) {
        console.warn(`  [v3] יצירת תמונות נכשלה: ${imgErr.message}`);
      }
    }

    const result = {
      // מטא-דאטה
      homeTeam, awayTeam, competition, date,
      event_type, formatType, matchKey,
      timestamp: new Date().toISOString(),

      // חוקי ברזל
      ironRules: {
        ticketeamsLogoAssetId: TICKETEAMS_LOGO_ASSET_ID,
        formatType,
        backgroundConfig: bgConfig,
      },

      // תוצרים
      adCopies,
      metaAds,
      canva: canvaResult,
      backgroundImagePath,
      composedImages,

      // הנחיות ל-Claude MCP orchestration (reference)
      pipeline: [
        bgConfig.generator === 'generate_stadium_background'
          ? `1. Nano Banana: generate_stadium_background(style='${bgConfig.style}') ✅`
          : `1. Nano Banana: generate_image(prompt='${bgConfig.prompt?.substring(0, 60)}...') ✅`,
        '2. image-composer: compose all formats ✅',
        '3. Canva MCP: upload-asset-from-url → backgroundAssetId',
        `4. Canva MCP: start-editing-transaction(designId=${canvaResult.designId})`,
        `5. Canva MCP: perform-editing-operations(${canvaResult.operations.length} ops)`,
        '6. Canva MCP: commit-editing-transaction',
        '7. Canva MCP: export-design → PNG',
      ],
    };

    // הדפסת סיכום
    console.log(`\n=== Creative Agent v3 — סיכום ===`);
    console.log(`  FORMAT_TYPE: ${formatType}`);
    console.log(`  טקסטים: ${adCopies.length} גרסאות`);
    console.log(`  רקע: ${backgroundImagePath || 'לא נוצר'}`);
    const totalImages = composedImages ? Object.values(composedImages).reduce((n, fmt) => n + Object.keys(fmt).length, 0) : 0;
    console.log(`  תמונות: ${totalImages} תמונות`);
    console.log(`  Canva operations: ${canvaResult.operations.length}`);
    console.log(`  Missing logos: ${canvaResult.missingLogos?.length || 0}`);
    console.log('================================\n');

    return result;
  } catch (error) {
    console.error('Creative Agent v3 נכשל:', error.message);
    throw error;
  }
}

module.exports = {
  generateCreative,
  generateCreativeV3,
  generateCreativeFreeImages,
  generateAdCopies,
  formatForMeta,
  buildPrompt,
  buildCreativeFreePlan,
  CREATIVE_FREE_TEMPLATE,
};
