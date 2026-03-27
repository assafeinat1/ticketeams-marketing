/**
 * Brand Asset Cache — maps brand overlay names to pre-rendered transparent PNG files.
 * PNGs are generated once by generate-brand-pngs.py and cached in src/assets/canva-cache/.
 * Used by image-composer.js to overlay brand elements as PNG pastes (never code-drawn).
 */

const path = require('path');
const fs = require('fs');

const CACHE_DIR = path.join(__dirname, '..', 'assets', 'canva-cache');

const ASSET_MAP = {
  // Header gradient bars (per format, full-canvas overlays)
  header_bar_story:  'header_bar_story.png',
  header_bar_post:   'header_bar_post.png',
  header_bar_square: 'header_bar_square.png',
  // CTA gradient bars (per format, full-canvas overlays)
  cta_bar_story:     'cta_bar_story.png',
  cta_bar_post:      'cta_bar_post.png',
  cta_bar_square:    'cta_bar_square.png',
  // Gradient frame borders (per format, full-canvas overlays)
  frame_story:       'frame_story.png',
  frame_post:        'frame_post.png',
  frame_square:      'frame_square.png',
  // VS element (standalone, format-independent)
  vs_element:        'vs_element.png',
};

function getCachedAsset(name) {
  const file = ASSET_MAP[name];
  if (!file) return null;
  const fp = path.join(CACHE_DIR, file);
  if (!fs.existsSync(fp)) {
    console.warn(`[brand-cache] Missing asset: ${name} (${fp})`);
    return null;
  }
  return fp;
}

function getHeaderBarPath(format) {
  return getCachedAsset(`header_bar_${format}`);
}

function getCtaBarPath(format) {
  return getCachedAsset(`cta_bar_${format}`);
}

function getFramePath(format) {
  return getCachedAsset(`frame_${format}`);
}

function getVSElementPath() {
  return getCachedAsset('vs_element');
}

function verifyCacheIntegrity() {
  const missing = [];
  for (const [name, file] of Object.entries(ASSET_MAP)) {
    const fp = path.join(CACHE_DIR, file);
    if (!fs.existsSync(fp)) missing.push(name);
  }
  return { ok: missing.length === 0, missing };
}

module.exports = {
  getCachedAsset,
  getHeaderBarPath,
  getCtaBarPath,
  getFramePath,
  getVSElementPath,
  verifyCacheIntegrity,
  CACHE_DIR,
};
