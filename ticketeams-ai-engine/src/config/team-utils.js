/**
 * Ticketeams Team & Competition Utilities — Centralized Mapping
 *
 * Single source of truth for:
 * - Team name → key mapping (English + Hebrew + nicknames)
 * - Competition normalization
 * - Logo file path resolution
 *
 * Used by: image-composer, canva-agent, gemini-image-agent, ad-monitor-agent
 * scout-agent has its own findTeamKey that adds venues.json lookup on top.
 */

const fs = require('fs');
const path = require('path');

const ASSETS = path.join(__dirname, '..', 'assets');

// ============================================================
// Team name → key mapping (comprehensive)
// ============================================================

const TEAM_NAME_MAP = {
  // Premier League
  'arsenal': 'arsenal', 'ארסנל': 'arsenal', 'arsenal fc': 'arsenal', 'the gunners': 'arsenal', 'gunners': 'arsenal',
  'chelsea': 'chelsea', "צ'לסי": 'chelsea', 'chelsea fc': 'chelsea', 'the blues': 'chelsea',
  'liverpool': 'liverpool', 'ליברפול': 'liverpool', 'liverpool fc': 'liverpool', 'the reds': 'liverpool',
  'manchester city': 'man_city', "מנצ'סטר סיטי": 'man_city', 'man city': 'man_city', 'city': 'man_city', 'man city fc': 'man_city', 'manchester city fc': 'man_city',
  'manchester united': 'man_utd', "מנצ'סטר יונייטד": 'man_utd', 'man utd': 'man_utd', 'man united': 'man_utd', 'manchester united fc': 'man_utd', 'united': 'man_utd',
  'tottenham': 'tottenham', 'טוטנהאם': 'tottenham', 'tottenham hotspur': 'tottenham', 'spurs': 'tottenham', 'tottenham hotspur fc': 'tottenham',
  // La Liga
  'barcelona': 'barcelona', 'ברצלונה': 'barcelona', 'fc barcelona': 'barcelona', 'barça': 'barcelona', 'barca': 'barcelona', 'fcb': 'barcelona',
  'real madrid': 'real_madrid', 'ריאל מדריד': 'real_madrid', 'real madrid cf': 'real_madrid',
  'atletico': 'atletico', 'אתלטיקו מדריד': 'atletico', 'atletico madrid': 'atletico', 'atlético madrid': 'atletico', 'atlético de madrid': 'atletico', 'atletico de madrid': 'atletico',
  'real sociedad': 'real_sociedad', 'ריאל סוסיאדד': 'real_sociedad', 'la real': 'real_sociedad',
  'celta vigo': 'celta_vigo', 'סלטה ויגו': 'celta_vigo', 'celta de vigo': 'celta_vigo', 'rc celta': 'celta_vigo',
  // Bundesliga
  'bayern': 'bayern', 'באיירן מינכן': 'bayern', 'bayern munich': 'bayern', 'bayern münchen': 'bayern', 'fc bayern': 'bayern', 'fc bayern munich': 'bayern',
  'dortmund': 'dortmund', 'בורוסיה דורטמונד': 'dortmund', 'borussia dortmund': 'dortmund', 'bvb': 'dortmund',
  'frankfurt': 'frankfurt', 'איינטראכט פרנקפורט': 'frankfurt', 'eintracht frankfurt': 'frankfurt', 'sge': 'frankfurt',
  'rb salzburg': 'rb_salzburg', 'רד בול זלצבורג': 'rb_salzburg', 'red bull salzburg': 'rb_salzburg', 'salzburg': 'rb_salzburg', 'fc salzburg': 'rb_salzburg',
  // Serie A
  'juventus': 'juventus', 'יובנטוס': 'juventus', 'juventus fc': 'juventus', 'juve': 'juventus',
  'milan': 'milan', 'מילאן': 'milan', 'ac milan': 'milan',
  'inter': 'inter', 'אינטר מילאן': 'inter', 'inter milan': 'inter', 'fc internazionale': 'inter', 'internazionale': 'inter',
  // Ligue 1
  'psg': 'psg', "פריז סן ז'רמן": 'psg', 'paris saint-germain': 'psg', 'paris saint germain': 'psg', 'paris sg': 'psg',
  // Other
  'benfica': 'benfica', 'בנפיקה': 'benfica', 'sl benfica': 'benfica', 'sport lisboa e benfica': 'benfica',
};

/**
 * Finds team key from any name variant (English, Hebrew, nickname)
 * @param {string} name - Team name in any supported format
 * @returns {string|null} Normalized team key or null
 */
function findTeamKey(name) {
  if (!name) return null;
  const lower = name.trim().toLowerCase();
  return TEAM_NAME_MAP[lower] || TEAM_NAME_MAP[lower.replace(/\s+/g, '_')] || null;
}

// ============================================================
// Competition normalization
// ============================================================

const COMPETITION_MAP = {
  'premier league': 'premier_league', 'פרמייר ליג': 'premier_league',
  'la liga': 'la_liga', 'ליגה הספרדית': 'la_liga',
  'bundesliga': 'bundesliga', 'בונדסליגה': 'bundesliga',
  'serie a': 'serie_a', 'סרייה א': 'serie_a',
  'champions league': 'champions_league', 'uefa champions league': 'champions_league', 'ליגת האלופות': 'champions_league',
  'europa league': 'europa_league', 'ליגה האירופית': 'europa_league',
};

function normalizeCompetition(c) {
  return COMPETITION_MAP[c?.toLowerCase()] || COMPETITION_MAP[c] || 'default';
}

// ============================================================
// Logo path resolvers
// ============================================================

function getTeamLogoPath(teamName) {
  const key = findTeamKey(teamName);
  if (!key) return '';
  const p = path.join(ASSETS, 'logos', `${key}.png`);
  return fs.existsSync(p) ? p : '';
}

function getCompetitionLogoPath(compKey) {
  const fn = compKey ? `competition_${compKey}.png` : '';
  if (!fn) return '';
  const p = path.join(ASSETS, 'logos', fn);
  return fs.existsSync(p) ? p : '';
}

module.exports = {
  TEAM_NAME_MAP,
  COMPETITION_MAP,
  findTeamKey,
  normalizeCompetition,
  getTeamLogoPath,
  getCompetitionLogoPath,
};
