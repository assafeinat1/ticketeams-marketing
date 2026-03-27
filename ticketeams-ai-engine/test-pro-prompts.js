/**
 * Test pro prompt inspiration + background generation with new curated templates.
 * Generates 3 backgrounds: EPL sunset, UCL night, La Liga golden hour.
 */
require('dotenv').config();
const path = require('path');
const fs = require('fs');
const { getProPromptInspiration, generateSmartBackground } = require('./src/agents/gemini-agent');

const OUTPUT_DIR = path.join(__dirname, 'src', 'output', 'pro-prompt-test');
if (!fs.existsSync(OUTPUT_DIR)) fs.mkdirSync(OUTPUT_DIR, { recursive: true });

async function testInspiration() {
  console.log('=== Test 1: getProPromptInspiration() ===\n');

  const cases = [
    { eventType: 'epl', style: 'epic' },
    { eventType: 'ucl', style: 'night' },
    { eventType: 'laliga', style: 'golden-hour' },
    { eventType: 'mundial', style: 'premium' },
    { eventType: 'concert', style: 'epic' },
    { eventType: 'celebration', style: 'epic' },
  ];

  for (const { eventType, style } of cases) {
    const results = getProPromptInspiration(eventType, style);
    console.log(`\n  ${eventType} / ${style}:`);
    console.log(`    Matches: ${results.length}`);
    for (const r of results) {
      console.log(`    - ${r.id} (${r.source}) — ${r.prompt.slice(0, 80)}...`);
    }
  }
}

async function testGeneration() {
  console.log('\n\n=== Test 2: Generate 3 Pro Prompt Backgrounds ===\n');

  const tests = [
    { label: 'EPL Sunset (Arsenal Emirates)', style: 'epic', eventType: 'epl', stadium: 'Emirates Stadium', file: 'epl_sunset.jpg' },
    { label: 'UCL Night (Camp Nou)', style: 'night', eventType: 'ucl', stadium: 'Camp Nou', file: 'ucl_night.jpg' },
    { label: 'La Liga Golden Hour (Santiago Bernabeu)', style: 'dramatic', eventType: 'laliga', stadium: 'Santiago Bernabéu Stadium', file: 'laliga_golden.jpg' },
  ];

  for (const t of tests) {
    console.log(`\n--- ${t.label} ---`);
    const outputPath = path.join(OUTPUT_DIR, t.file);
    try {
      const result = await generateSmartBackground(
        { style: t.style, stadium: t.stadium, formatType: 'Stadium', eventType: t.eventType },
        outputPath,
      );
      if (result && result.saved) {
        const filePath = result.path;
        const exists = fs.existsSync(filePath);
        const size = exists ? (fs.statSync(filePath).size / 1024).toFixed(0) + 'KB' : 'N/A';
        console.log(`  SAVED: ${filePath}`);
        console.log(`  Size: ${size} | Format: ${result.mimeType}`);
      } else if (result) {
        console.log(`  Generated but not saved (${result.size} bytes)`);
      } else {
        console.log(`  Result: null (generation may have failed)`);
      }
    } catch (err) {
      console.error(`  Error: ${err.message}`);
    }
  }
}

(async () => {
  await testInspiration();
  await testGeneration();
  console.log('\n=== Pro Prompt Tests Complete ===');
})();
