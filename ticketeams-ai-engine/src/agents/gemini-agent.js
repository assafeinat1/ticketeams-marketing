/**
 * Ticketeams Gemini Agent — Nano Banana Edition
 *
 * Two capabilities:
 *   1. Logic & Strategy  — Gemini text model (Rima persona)
 *   2. Creative Generation — Nano Banana skill (nano-banana-pro-preview model)
 *      via Python subprocess bridge. Produces dramatically better stadium
 *      backgrounds with brand-correct pink/orange lighting.
 *
 * Usage:
 *   node src/agents/gemini-agent.js                     # self-test
 *   node src/agents/gemini-agent.js --strategy "input"  # Rima strategy
 *   node src/agents/gemini-agent.js --image "prompt"    # generate image
 */

require('dotenv').config();
const { GoogleGenAI } = require('@google/genai');
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ============================================================
// Config
// ============================================================

const TEXT_MODEL = 'gemini-2.5-flash';
const IMAGE_MODEL = 'nano-banana-pro-preview';
const OUTPUT_DIR = path.join(__dirname, '..', 'generated-ads');
const MAX_RETRIES = 3;

// Nano Banana bridge paths
const BRIDGE_SCRIPT = path.join(__dirname, '..', 'utils', 'nano-banana-bridge.py');
const SKILL_DIR = path.resolve(__dirname, '..', '..', '..', 'skills', 'nano-banana-manager');
const SKILL_PYTHON = path.join(SKILL_DIR, '.venv', 'bin', 'python');

// ============================================================
// 1. Credential Validation
// ============================================================

function validateCredentials() {
  const key = process.env.GEMINI_API_KEY;
  if (!key) {
    throw new Error(
      'GEMINI_API_KEY is missing from .env.\n' +
      '  1. Go to https://aistudio.google.com/apikey\n' +
      '  2. Create an API key\n' +
      '  3. Add to .env: GEMINI_API_KEY=your_key_here'
    );
  }
  if (key.length < 20) {
    throw new Error('GEMINI_API_KEY appears invalid (too short).');
  }
  return true;
}

// ============================================================
// 2. Gemini Text Client (for Rima strategy only)
// ============================================================

let _ai = null;

function getClient() {
  if (!_ai) {
    validateCredentials();
    _ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }
  return _ai;
}

// ============================================================
// 3. Rima Persona — Marketing Strategy Agent
// ============================================================

const RIMA_SYSTEM_PROMPT = `אתה "רימה" — ראש אסטרטגיית שיווק של Ticketeams, חברת כרטיסים ישראלית לאירועי ספורט בינלאומיים.

הרקע שלך:
- Ticketeams מוכרת כרטיסים למשחקי כדורגל באירופה (Premier League, La Liga, Champions League, וכו')
- הסלוגן: "הכרטיס שלך לחלום"
- צבעי המותג: ורוד (#E91E8C), כתום (#FF6B35), סגול (#7C3AED)
- קהל יעד: ישראלים שרוצים לנסוע לראות משחקים בחו"ל

הכללים שלך:
1. אסור בהחלט לציין מחירים, סכומים, או מטבעות — אף פעם.
2. תמיד עברית, שמות באנגלית בסוגריים או בסוף המשפט.
3. אסטרטגיה מבוססת על נתונים: מתחרים, FORMAT_TYPE (Stadium/Human/Urgency), ותזמון.
4. תשובות מובנות: Bottom Line קודם, אחר כך פירוט.

כשמבקשים ממך אסטרטגיה — תחזיר:
- Bottom Line (משפט אחד)
- המלצת FORMAT_TYPE (Stadium/Human/Urgency)
- 3 כיוונים קריאטיביים (רגשי, מידעי, דחיפות)
- תזמון מומלץ (מתי להעלות את הקמפיין)
- הערות תחרותיות (מה המתחרים עושים ואיך להיות שונים)`;

async function generateStrategy(input) {
  const ai = getClient();
  let lastError;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await ai.models.generateContent({
        model: TEXT_MODEL,
        contents: input,
        config: {
          systemInstruction: RIMA_SYSTEM_PROMPT,
          maxOutputTokens: 2000,
          temperature: 0.7,
        },
      });

      const text = response.text;
      if (!text) throw new Error('Gemini returned empty response');

      return {
        strategy: text,
        model: TEXT_MODEL,
        generatedAt: new Date().toISOString(),
      };
    } catch (error) {
      lastError = error;
      const isRetryable = error.message?.includes('429') || error.message?.includes('503') || error.message?.includes('RESOURCE_EXHAUSTED');
      if (!isRetryable || attempt >= MAX_RETRIES) throw error;
      const delay = 2000 * Math.pow(2, attempt - 1);
      console.warn(`[Gemini] Strategy attempt ${attempt} failed (${error.message}), retrying in ${delay}ms...`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
  throw lastError;
}

// ============================================================
// 4. Nano Banana Bridge — Image Generation via Skill Subprocess
// ============================================================

/**
 * callNanoBanana — Spawn the Python bridge to call skill functions.
 * Returns parsed JSON result from the bridge.
 */
function callNanoBanana(args) {
  // Resolve Python: prefer skill venv, fall back to system python3
  const python = fs.existsSync(SKILL_PYTHON) ? SKILL_PYTHON : 'python3';

  console.log(`  [Nano Banana] Calling bridge: ${args.join(' ')}`);
  const stdout = execFileSync(python, [BRIDGE_SCRIPT, ...args], {
    encoding: 'utf-8',
    timeout: 120_000,
    env: { ...process.env, PYTHONDONTWRITEBYTECODE: '1' },
  });

  // Bridge outputs JSON on the last line of stdout
  const lines = stdout.trim().split('\n');
  const jsonLine = lines[lines.length - 1];
  const result = JSON.parse(jsonLine);

  if (!result.ok) {
    throw new Error(result.error || 'Nano Banana bridge returned error');
  }

  return result;
}

/**
 * generateImage — Creates a visual asset via Nano Banana skill.
 */
async function generateImage(prompt, outputPath, opts = {}) {
  const outputDir = outputPath ? path.dirname(outputPath) : path.join(OUTPUT_DIR, 'test');
  const filename = outputPath ? path.basename(outputPath).replace(/\.(jpg|png)$/, '') : `nb_${Date.now()}`;
  const width = String(opts.width || 1080);
  const height = String(opts.height || 1350);

  fs.mkdirSync(outputDir, { recursive: true });

  const result = callNanoBanana([
    '--action', 'image',
    '--prompt', prompt,
    '--width', width,
    '--height', height,
    '--output-dir', outputDir,
    '--filename', filename,
  ]);

  return {
    saved: true,
    path: result.path,
    mimeType: 'image/jpeg',
    size: Math.round((result.size_kb || 0) * 1024),
    model: result.model,
  };
}

/**
 * editImage — Enhances/upscales an existing image via Nano Banana edit_image skill.
 */
async function editImage(imagePath, prompt, outputPath) {
  const outputDir = outputPath ? path.dirname(outputPath) : path.join(OUTPUT_DIR, 'test');
  const filename = outputPath ? path.basename(outputPath).replace(/\.(jpg|png)$/, '') : `nb_edit_${Date.now()}`;

  fs.mkdirSync(outputDir, { recursive: true });

  const result = callNanoBanana([
    '--action', 'edit',
    '--image-path', imagePath,
    '--prompt', prompt,
    '--output-dir', outputDir,
    '--filename', filename,
  ]);

  return {
    saved: true,
    path: result.path,
    mimeType: 'image/jpeg',
    size: Math.round((result.size_kb || 0) * 1024),
    model: result.model,
  };
}

// ============================================================
// 5. Smart Background Generation — Nano Banana Powered
// ============================================================

/**
 * Style mapping: competition/event → Nano Banana style parameter.
 * The skill's generate_stadium_background handles prompt construction
 * with brand-correct pink/orange colors and composition hints.
 */
const STYLE_MAP = {
  epic:       'epic',
  dramatic:   'dramatic',
  night:      'dramatic',
  concert:    'cinematic',
  ucl_trophy: 'dramatic',
  wc_nyc:     'epic',
  wc_la:      'warm',
  wc_general: 'epic',
};

/**
 * Format → dimensions for Nano Banana.
 * Story is tall, post is portrait, square is square.
 */
const FORMAT_DIMS = {
  story:  { width: 1080, height: 1920 },
  post:   { width: 1080, height: 1350 },
  square: { width: 1080, height: 1080 },
};

/**
 * generateSmartBackground — Context-aware background via Nano Banana skill.
 *
 * Always uses:
 *   - Model: nano-banana-pro-preview (dedicated image generation)
 *   - Colors: "pink and orange" (Ticketeams brand)
 *   - Composition: center area darkened for text overlay
 *
 * @param {Object} opts
 * @param {string} opts.style — 'epic'|'dramatic'|'night'|'concert'|etc.
 * @param {string} [opts.stadium] — Stadium name (unused by skill, kept for API compat)
 * @param {string} [opts.formatType] — 'Stadium'|'Human'|'Urgency'
 * @param {string} [opts.eventType] — 'football'|'ucl'|'laliga'|'epl'|'mundial'|'concert'
 * @param {string} [outputPath]
 */
async function generateSmartBackground(opts = {}, outputPath) {
  const { style = 'epic', eventType } = opts;

  const nbStyle = STYLE_MAP[style] || 'epic';
  const outputDir = outputPath ? path.dirname(outputPath) : path.join(OUTPUT_DIR, 'test');
  const filename = outputPath ? path.basename(outputPath).replace(/\.(jpg|png)$/, '') : `stadium_bg_${nbStyle}`;

  // Default to post dimensions; creative-agent picks per format
  const dims = FORMAT_DIMS.post;

  fs.mkdirSync(outputDir, { recursive: true });

  console.log(`  [Nano Banana] Generating background (style=${nbStyle}, model=${IMAGE_MODEL})`);

  const result = callNanoBanana([
    '--action', 'stadium',
    '--style', nbStyle,
    '--colors', 'pink and orange',
    '--width', String(dims.width),
    '--height', String(dims.height),
    '--output-dir', outputDir,
    '--filename', filename,
  ]);

  const sizeKB = Math.round(result.size_kb || 0);
  console.log(`  [Nano Banana] Background ready — ${sizeKB} KB, model: ${result.model}`);
  console.log(`  [Nano Banana] Path: ${result.path}`);

  return {
    saved: true,
    path: result.path,
    mimeType: 'image/jpeg',
    size: sizeKB * 1024,
    model: result.model,
  };
}

// Backwards-compatible wrapper
async function generateStadiumBackground(style = 'epic', outputPath) {
  return generateSmartBackground({ style }, outputPath);
}

// ============================================================
// 6. Error Sanitizer
// ============================================================

function sanitizeError(error) {
  const msg = error.message || 'Unknown error';
  const key = process.env.GEMINI_API_KEY;
  if (key && msg.includes(key)) {
    return 'API request failed (credentials redacted).';
  }
  if (msg.includes('API_KEY_INVALID')) {
    return 'GEMINI_API_KEY is invalid. Generate a new one at https://aistudio.google.com/apikey';
  }
  if (msg.includes('429') || msg.includes('quota') || msg.includes('RESOURCE_EXHAUSTED')) {
    return 'Gemini quota exceeded. Check limits at https://ai.google.dev/gemini-api/docs/rate-limits';
  }
  return msg;
}

// ============================================================
// 7. Self-Test
// ============================================================

async function selfTest() {
  console.log('=== Gemini Agent — Self Test (Nano Banana Edition) ===\n');

  try {
    validateCredentials();
    console.log('[PASS] GEMINI_API_KEY loaded');
  } catch (err) {
    console.error(`[FAIL] Credentials: ${err.message}`);
    return;
  }

  // Check bridge availability
  const bridgeExists = fs.existsSync(BRIDGE_SCRIPT);
  const venvExists = fs.existsSync(SKILL_PYTHON);
  console.log(`[${bridgeExists ? 'PASS' : 'FAIL'}] Bridge script: ${BRIDGE_SCRIPT}`);
  console.log(`[${venvExists ? 'PASS' : 'WARN'}] Skill venv: ${SKILL_PYTHON}`);

  console.log('\n--- Test 1: Rima Strategy (Text) ---');
  try {
    const result = await generateStrategy(
      'ברצלונה נגד ריאל מדריד, ליגת האלופות, 15 באפריל 2026. מה האסטרטגיה?'
    );
    console.log(`[PASS] Text generation — model: ${result.model}`);
    console.log(`\nRima says:\n${result.strategy.substring(0, 500)}${result.strategy.length > 500 ? '...' : ''}`);
  } catch (err) {
    console.error(`[FAIL] Text generation: ${sanitizeError(err)}`);
  }

  console.log('\n--- Test 2: Stadium Background (Nano Banana) ---');
  try {
    const outputPath = path.join(OUTPUT_DIR, 'test', 'nb_selftest.png');
    const result = await generateSmartBackground({ style: 'epic' }, outputPath);
    if (result.saved) {
      const sizeKB = Math.round(result.size / 1024);
      console.log(`[PASS] Image generation — model: ${result.model}, ${sizeKB} KB`);
      console.log(`  Saved: ${result.path}`);
    }
  } catch (err) {
    console.error(`[FAIL] Image generation: ${sanitizeError(err)}`);
  }

  console.log('\n=== Self Test Complete ===\n');
}

// ============================================================
// Exports + CLI
// ============================================================

module.exports = {
  getClient,
  generateStrategy,
  generateImage,
  editImage,
  generateStadiumBackground,
  generateSmartBackground,
  sanitizeError,
  RIMA_SYSTEM_PROMPT,
  TEXT_MODEL,
  IMAGE_MODEL,
};

if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.includes('--strategy')) {
    const idx = args.indexOf('--strategy') + 1;
    const input = args[idx] || 'ברצלונה נגד ריאל מדריד, ליגת האלופות. מה האסטרטגיה?';
    generateStrategy(input)
      .then((r) => console.log(r.strategy))
      .catch((e) => console.error(sanitizeError(e)));
  } else if (args.includes('--image')) {
    const idx = args.indexOf('--image') + 1;
    const prompt = args[idx] || 'Epic football stadium at night, pink and orange lights. 8K. NO text.';
    const out = path.join(OUTPUT_DIR, 'test', 'nb_cli.png');
    generateImage(prompt, out)
      .then((r) => console.log(`Saved: ${r.path} (${Math.round(r.size / 1024)} KB)`))
      .catch((e) => console.error(sanitizeError(e)));
  } else {
    selfTest().catch(console.error);
  }
}
