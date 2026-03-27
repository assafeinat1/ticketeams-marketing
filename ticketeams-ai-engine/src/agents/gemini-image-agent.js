/**
 * Ticketeams Gemini Image Agent
 * יצירת תמונות פרסומת באמצעות Gemini 2.0 Flash
 */

require('dotenv').config();
const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');
const { normalizeCompetition, getTeamLogoPath, getCompetitionLogoPath } = require('../config/team-utils');
const { sanitizeError } = require('./gemini-agent');

const ROOT = path.join(__dirname, '..', '..');
const ASSETS = path.join(ROOT, 'src', 'assets');
const OUTPUT_DIR = path.join(ROOT, 'src', 'generated-ads');
const MAX_RETRIES = 3;

// ==================== טעינת תמונות כ-base64 ====================

function loadImageAsBase64(imgPath) {
  if (!imgPath || !fs.existsSync(imgPath)) return null;
  const data = fs.readFileSync(imgPath);
  const ext = path.extname(imgPath).toLowerCase();
  const mimeMap = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp' };
  return {
    inlineData: {
      data: data.toString('base64'),
      mimeType: mimeMap[ext] || 'image/png',
    },
  };
}

// ==================== בניית Prompt ====================

const FORMAT_SIZES = {
  story:  { w: 1080, h: 1920, label: 'Story (1080×1920, 9:16)' },
  post:   { w: 1080, h: 1350, label: 'Post (1080×1350, 4:5)' },
  square: { w: 1080, h: 1080, label: 'Square (1080×1080, 1:1)' },
};

function buildGeminiPrompt(matchData, adCopy, format) {
  const { homeTeam, awayTeam, competition, date } = matchData;
  const size = FORMAT_SIZES[format] || FORMAT_SIZES.story;

  return `I'm providing a REFERENCE IMAGE showing the exact design style I want you to follow. Create a new image in this same style but with the new content below.

REFERENCE IMAGE ANALYSIS — follow this layout precisely:
- Dark blue stadium background with subtle floodlight glow
- Thin pink/magenta rounded border around the entire image
- Ticketeams logo centered at the top with slogan "הכרטיס שלך לחלום" below it
- Pink-to-orange gradient headline bar (rounded corners) with main text
- Large semi-transparent light box in the center containing the team logos with "Vs" between them
- Pink date badge (pill shape) below the logos
- Body text inside the light box
- Pink-to-orange gradient CTA bar near the bottom
- Competition logo at the very bottom

DIMENSIONS: ${size.label} — output exactly ${size.w}×${size.h} pixels.

NEW CONTENT FOR THIS IMAGE:
- Home team: ${homeTeam} (use the provided home team logo)
- Away team: ${awayTeam} (use the provided away team logo)
- Competition: ${competition}
- Date: ${date}
- Headline (Hebrew, RTL): ${adCopy.headline}
- Body (Hebrew, RTL): ${adCopy.body}
- CTA button text (Hebrew, RTL): ${adCopy.cta}

BRAND RULES:
- Brand: Ticketeams — colors: Pink #E91E8C, Orange #FF6B35, Purple #7B2D8B
- Gradient bars go from pink to orange (left to right)
- All Hebrew text MUST be right-to-left
- DO NOT include any prices, amounts, or currency symbols — this is an absolute rule
- Use the provided team logos exactly as given (do not redraw or modify them)
- Include the Ticketeams logo at the top

CRITICAL — DATES AND NUMBERS:
- Do NOT generate, invent, or hallucinate any numbers or dates.
- Use ONLY the exact date provided: ${date}
- Copy the date string character-by-character. Do not rearrange, reformat, or add digits.

AD STYLE: ${adCopy.style === 'רגשית' ? 'Emotional — dreamy, aspirational, warm lighting' :
            adCopy.style === 'מידעית' ? 'Informational — clean, factual, structured' :
            adCopy.style === 'דחיפות' ? 'Urgency — bold, high contrast, FOMO' : 'Professional sports ad'}

Generate the image now, matching the reference style exactly.`;
}

// ==================== Gemini API ====================

// מודלים שתומכים בייצור תמונות (מהחדש לישן)
const IMAGE_MODELS = [
  'gemini-2.5-flash-image',
  'gemini-3.1-flash-image-preview',
  'gemini-3-pro-image-preview',
];

async function callGeminiAPI(parts) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error('GEMINI_API_KEY לא מוגדר ב-.env');

  const modelName = process.env.GEMINI_IMAGE_MODEL || IMAGE_MODELS[0];

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({
    model: modelName,
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
    },
  });

  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await model.generateContent(parts);
      return result.response;
    } catch (err) {
      lastError = err;
      const isRetryable = err.message?.includes('429') || err.message?.includes('503') || err.message?.includes('RESOURCE_EXHAUSTED');
      if (!isRetryable || attempt >= MAX_RETRIES) {
        if (err.message?.includes('429') || err.message?.includes('quota')) {
          throw new Error(
            `Gemini quota exceeded (model: ${modelName}). ` +
            'יצירת תמונות דורשת חשבון Google AI בתשלום. ' +
            'ראה: https://ai.google.dev/gemini-api/docs/rate-limits'
          );
        }
        throw err;
      }
      const delay = 3000 * Math.pow(2, attempt - 1);
      console.warn(`[Gemini Image] Attempt ${attempt} failed (${sanitizeError(err)}), retrying in ${delay}ms...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
}

// ==================== חילוץ תמונה מתגובה ====================

function extractImageFromResponse(response) {
  const candidates = response.candidates;
  if (!candidates || candidates.length === 0) {
    throw new Error('Gemini לא החזיר תוצאות');
  }

  const parts = candidates[0].content?.parts;
  if (!parts) throw new Error('Gemini לא החזיר parts');

  for (const part of parts) {
    if (part.inlineData && part.inlineData.mimeType?.startsWith('image/')) {
      return {
        buffer: Buffer.from(part.inlineData.data, 'base64'),
        mimeType: part.inlineData.mimeType,
      };
    }
  }

  throw new Error('Gemini לא החזיר תמונה בתגובה');
}

// ==================== יצירת תמונה בודדת ====================

async function generateGeminiImage(matchData, adCopy, format, outputPath) {
  const compKey = normalizeCompetition(matchData.competition);

  // בניית parts עם תיוג ברור לכל תמונה
  const parts = [];

  // 1. תמונת דוגמה כהשראה
  const samplePath = path.join(ASSETS, 'templates', 'square_sample.jpg');
  const sampleImage = loadImageAsBase64(samplePath);
  if (sampleImage) {
    parts.push({ text: 'REFERENCE IMAGE — this is the design style to follow:' });
    parts.push(sampleImage);
  }

  // 2. לוגו קבוצת בית — עם תיוג ברור
  const homeLogo = loadImageAsBase64(getTeamLogoPath(matchData.homeTeam));
  if (homeLogo) {
    parts.push({ text: `HOME TEAM LOGO — this is the logo for ${matchData.homeTeam}. Place it on the RIGHT side of the "Vs" text:` });
    parts.push(homeLogo);
  }

  // 3. לוגו קבוצת חוץ — עם תיוג ברור
  const awayLogo = loadImageAsBase64(getTeamLogoPath(matchData.awayTeam));
  if (awayLogo) {
    parts.push({ text: `AWAY TEAM LOGO — this is the logo for ${matchData.awayTeam}. Place it on the LEFT side of the "Vs" text. This is a DIFFERENT logo from the home team:` });
    parts.push(awayLogo);
  }

  // 4. לוגו Ticketeams
  const ttLogo = loadImageAsBase64(path.join(ASSETS, 'logos', 'ticketeams.png'));
  if (ttLogo) {
    parts.push({ text: 'TICKETEAMS BRAND LOGO — place this centered at the top of the image:' });
    parts.push(ttLogo);
  }

  // 5. לוגו תחרות
  const compLogo = loadImageAsBase64(getCompetitionLogoPath(compKey));
  if (compLogo) {
    parts.push({ text: `COMPETITION LOGO (${matchData.competition}) — place this at the bottom of the image:` });
    parts.push(compLogo);
  }

  // 6. ה-prompt הראשי
  const prompt = buildGeminiPrompt(matchData, adCopy, format);
  parts.push({ text: prompt });

  // קריאה ל-API
  const response = await callGeminiAPI(parts);

  // חילוץ ושמירה
  const { buffer, mimeType } = extractImageFromResponse(response);

  fs.mkdirSync(path.dirname(outputPath), { recursive: true });

  // שמירה — jpg או png לפי mimeType
  const ext = mimeType === 'image/png' ? '.png' : '.jpg';
  const finalPath = outputPath.replace(/\.(jpg|png)$/, ext);
  fs.writeFileSync(finalPath, buffer);

  console.log(`  Gemini: ${adCopy.style} / ${format} → ${path.basename(finalPath)}`);
  return finalPath;
}

// ==================== יצירת כל התמונות ====================

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function generateAllGeminiImages(matchData, adCopies, matchKey) {
  console.log(`\nGemini Image Agent — ${matchKey}`);

  const outDir = path.join(OUTPUT_DIR, matchKey);
  fs.mkdirSync(outDir, { recursive: true });

  const all = {};
  const formats = ['story', 'post', 'square'];
  let count = 0;
  let total = adCopies.length * formats.length;

  for (const copy of adCopies) {
    all[copy.style] = {};

    for (const format of formats) {
      const fn = `${matchKey}_${copy.style}_${format}_gemini.jpg`;
      const outputPath = path.join(outDir, fn);

      try {
        const result = await generateGeminiImage(matchData, copy, format, outputPath);
        all[copy.style][format] = result;
        count++;
      } catch (err) {
        console.error(`  Gemini error: ${copy.style} / ${format}: ${err.message}`);
        all[copy.style][format] = null;
      }

      // rate limit — המתנה בין קריאות
      if (count < total) {
        await delay(2000);
      }
    }
  }

  console.log(`\nGemini: ${count}/${total} תמונות נוצרו`);
  return all;
}

module.exports = { generateGeminiImage, generateAllGeminiImages };
