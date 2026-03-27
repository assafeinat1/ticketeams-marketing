/**
 * Creative Style Memory
 *
 * Persists user style preferences for the creative agent.
 * JSON file at src/cache/style-memory.json
 */

const fs = require('fs');
const path = require('path');

const STYLE_FILE = path.join(__dirname, '..', 'cache', 'style-memory.json');
const CACHE_DIR = path.join(__dirname, '..', 'cache');

function ensureCacheDir() {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
}

function loadStyleMemory() {
  ensureCacheDir();
  if (!fs.existsSync(STYLE_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(STYLE_FILE, 'utf-8'));
  } catch {
    return [];
  }
}

function saveStyleFeedback(type, note) {
  const memory = loadStyleMemory();
  memory.push({
    type, // 'positive' | 'negative'
    note,
    timestamp: new Date().toISOString(),
  });
  ensureCacheDir();
  fs.writeFileSync(STYLE_FILE, JSON.stringify(memory, null, 2), 'utf-8');
  return { saved: true, total: memory.length };
}

function getStyleMemory() {
  return loadStyleMemory();
}

function getGallery() {
  ensureCacheDir();
  const files = [];

  // Scan cache directory for approval/creative files
  const approvalDir = path.join(CACHE_DIR);
  if (!fs.existsSync(approvalDir)) return files;

  const entries = fs.readdirSync(approvalDir);
  for (const entry of entries) {
    if (entry.startsWith('approval_') && entry.endsWith('.json')) {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(approvalDir, entry), 'utf-8'));
        files.push({
          matchKey: data.matchKey || entry.replace('approval_', '').replace('.json', ''),
          createdAt: data.createdAt || null,
          status: data.status || 'pending',
          versions: (data.versions || []).map(v => ({
            style: v.style,
            headline: v.headline,
            imageUrl: v.imageUrl || null,
          })),
        });
      } catch { /* skip invalid files */ }
    }
  }

  return files;
}

module.exports = { saveStyleFeedback, getStyleMemory, getGallery };
