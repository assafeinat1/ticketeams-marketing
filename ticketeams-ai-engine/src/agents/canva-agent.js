/**
 * Ticketeams Canva Agent
 * החלפה אוטומטית של טקסטים, לוגואים ורקע בתבנית Canva
 *
 * Architecture: Agent מכין operations, Claude מבצע דרך MCP.
 * הלוגואים חייבים להיות מועלים ל-Canva מראש (upload-asset-from-url).
 * מיפוי שם קבוצה → Canva asset_id נשמר ב-src/config/canva-assets.json.
 *
 * חוקי ברזל:
 * 1. לוגו Ticketeams = תמיד asset MAHBGt1xTfc. אסור טקסט "TICKETEAMS".
 * 2. רקע נוצר ב-Nano Banana ומועלה ל-Canva.
 * 3. לוגואי קבוצות מ-Canva uploads בלבד. חסר → טקסט, לא גנרי.
 */

const fs = require('fs');
const path = require('path');
const { findTeamKey, getTeamLogoPath } = require('../config/team-utils');

const ROOT = path.join(__dirname, '..', '..');
const ASSETS = path.join(ROOT, 'src', 'assets');
const CONFIG_PATH = path.join(ROOT, 'src', 'config', 'canva-assets.json');
const { TICKETEAMS_LOGO_ASSET_ID } = require('../config/creative-rules');

// ==================== Template Config ====================

const TEMPLATE = {
  designId: 'DAG0ibF3Yb8',
  pageIndex: 1,
  texts: {
    headline: 'PB3SgDbfy34S9QBj-LBJfppBJhPGW8svp',
    dates:    'PB3SgDbfy34S9QBj-LBPWpCGM64gXpzGq',
    cta:      'PB3SgDbfy34S9QBj-LBhGGf2D2hW5yTLq',
  },
  images: {
    background:  'PB3SgDbfy34S9QBj-LB1vHCfs99YkqT0C',
    topLeft:     'PB3SgDbfy34S9QBj-LBYyZbFdzL1x2KlR',
    topRight:    'PB3SgDbfy34S9QBj-LBd0pcs2B8MkW0V9',
    bottomLeft:  'PB3SgDbfy34S9QBj-LB3SxVn6WtfmMdsD',
    bottomRight: 'PB3SgDbfy34S9QBj-LBNZgB1vhfG0bfSZ',
  },
};

// ==================== Team Name Mapping (via centralized team-utils) ====================

function normalizeTeam(name) {
  return findTeamKey(name);
}

function getLocalLogoPath(teamName) {
  const p = getTeamLogoPath(teamName);
  return p || null;
}

// ==================== Canva Asset Registry (in-memory cache) ====================

let _registryCache = null;
let _registryMtime = 0;

function loadAssetRegistry() {
  if (!fs.existsSync(CONFIG_PATH)) return {};
  try {
    const stat = fs.statSync(CONFIG_PATH);
    if (_registryCache && stat.mtimeMs === _registryMtime) return _registryCache;
    _registryCache = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
    _registryMtime = stat.mtimeMs;
    return _registryCache;
  } catch (err) {
    console.warn('Failed to load canva-assets.json:', err.message);
    return _registryCache || {};
  }
}

function saveAssetRegistry(registry) {
  fs.mkdirSync(path.dirname(CONFIG_PATH), { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(registry, null, 2), 'utf-8');
  _registryCache = registry;
  _registryMtime = fs.statSync(CONFIG_PATH).mtimeMs;
}

function getCanvaAssetId(teamName) {
  const key = normalizeTeam(teamName);
  if (!key) return null;
  const registry = loadAssetRegistry();
  return registry[key] || null;
}

function registerCanvaAsset(teamKey, assetId) {
  const registry = loadAssetRegistry();
  registry[teamKey] = assetId;
  saveAssetRegistry(registry);
}

// ==================== Iron Rule Operations ====================

/**
 * חוק ברזל 1 — לוגו Ticketeams (תמיד asset MAHBGt1xTfc)
 * אסור בהחלט להשתמש בטקסט "TICKETEAMS".
 */
function buildTicketeamsLogoOperation() {
  const registry = loadAssetRegistry();
  const assetId = registry.ticketeams || TICKETEAMS_LOGO_ASSET_ID;

  if (!assetId) {
    throw new Error('חוק ברזל 1: Ticketeams logo asset חסר ב-canva-assets.json');
  }

  // הלוגואים הנעולים בתבנית כבר מכילים את הלוגו — לא צריך operation
  // אם תהיה תבנית שצריכה injection, נוסיף כאן
  return {
    assetId,
    note: 'לוגו Ticketeams קבוע בתבנית (locked elements). asset_id לשימוש בתבניות חדשות.',
  };
}

/**
 * חוק ברזל 2 — החלפת רקע (Nano Banana → Canva)
 * מקבל asset_id של רקע שכבר הועלה ל-Canva
 */
function buildBackgroundOperation(backgroundAssetId) {
  if (!backgroundAssetId) return null;

  return {
    type: 'update_fill',
    element_id: TEMPLATE.images.background,
    asset_type: 'image',
    asset_id: backgroundAssetId,
    alt_text: 'AI-generated stadium background',
  };
}

// ==================== Operation Builders ====================

function buildTextOperations({ headline, dates, cta }) {
  const ops = [];

  if (headline) {
    ops.push({
      type: 'replace_text',
      element_id: TEMPLATE.texts.headline,
      text: headline,
    });
  }

  if (dates) {
    ops.push({
      type: 'replace_text',
      element_id: TEMPLATE.texts.dates,
      text: dates,
    });
  }

  if (cta) {
    ops.push({
      type: 'replace_text',
      element_id: TEMPLATE.texts.cta,
      text: cta,
    });
  }

  return ops;
}

function buildImageOperations(teams) {
  const ops = [];
  const missing = [];
  const slots = ['topLeft', 'topRight', 'bottomLeft', 'bottomRight'];

  for (const slot of slots) {
    const teamName = teams[slot];
    if (!teamName) continue;

    const assetId = getCanvaAssetId(teamName);

    if (assetId) {
      ops.push({
        type: 'update_fill',
        element_id: TEMPLATE.images[slot],
        asset_type: 'image',
        asset_id: assetId,
        alt_text: `${teamName} logo`,
      });
    } else {
      missing.push({
        slot,
        teamName,
        teamKey: normalizeTeam(teamName),
        localPath: getLocalLogoPath(teamName),
      });
    }
  }

  return { ops, missing };
}

function buildAllOperations(matchData, backgroundAssetId) {
  const { headline, dates, cta, teams } = matchData;

  // חוק ברזל 2 — רקע (אם סופק)
  const bgOp = buildBackgroundOperation(backgroundAssetId);

  // חוק ברזל 1 — לוגו Ticketeams (verify it exists)
  const logoInfo = buildTicketeamsLogoOperation();

  // טקסטים + לוגואי קבוצות
  const textOps = buildTextOperations({ headline, dates, cta });
  const { ops: imageOps, missing } = buildImageOperations(teams || {});

  const allOps = [];
  if (bgOp) allOps.push(bgOp);
  allOps.push(...textOps, ...imageOps);

  return {
    designId: TEMPLATE.designId,
    pageIndex: TEMPLATE.pageIndex,
    operations: allOps,
    missingLogos: missing,
    ticketeamsLogo: logoInfo,
    summary: {
      backgroundReplaced: !!bgOp,
      textReplacements: textOps.length,
      imageReplacements: imageOps.length,
      missingLogos: missing.length,
    },
  };
}

// ==================== Main Entry Point ====================

function generateFromCanva(matchData) {
  const result = buildAllOperations(matchData);

  console.log(`\nCanva Agent — תבנית ${TEMPLATE.designId}`);
  console.log(`  טקסטים להחלפה: ${result.summary.textReplacements}`);
  console.log(`  לוגואים להחלפה: ${result.summary.imageReplacements}`);

  if (result.missingLogos.length > 0) {
    console.log(`  לוגואים חסרים ב-Canva (צריך upload): ${result.missingLogos.length}`);
    for (const m of result.missingLogos) {
      console.log(`    - ${m.teamName} (${m.teamKey}) → ${m.localPath || 'NO LOCAL FILE'}`);
    }
  }

  console.log(`\n  MCP Flow:`);
  console.log(`  1. start-editing-transaction → designId: ${result.designId}`);
  console.log(`  2. perform-editing-operations → ${result.operations.length} operations`);
  console.log(`  3. commit-editing-transaction`);
  console.log(`  4. export-design → PNG`);

  return result;
}

module.exports = {
  TEMPLATE,
  generateFromCanva,
  buildTextOperations,
  buildImageOperations,
  buildBackgroundOperation,
  buildTicketeamsLogoOperation,
  buildAllOperations,
  getCanvaAssetId,
  registerCanvaAsset,
  normalizeTeam,
  getLocalLogoPath,
  loadAssetRegistry,
  saveAssetRegistry,
};
