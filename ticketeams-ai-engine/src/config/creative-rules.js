/**
 * Ticketeams Creative Rules — 4 חוקי ברזל
 *
 * חוק 1 — לוגו Ticketeams: תמיד asset_id MAHBGt1xTfc. אסור טקסט.
 * חוק 2 — רקע חכם: Nano Banana בוחר לפי event_type.
 * חוק 3 — לוגואי קבוצות: מ-Canva uploads בלבד. אם חסר → טקסט.
 * חוק 4 — FORMAT_TYPE: Stadium/Human/Urgency לפי event + counter-logic.
 */

// ============================================================
// חוק 1 — לוגו Ticketeams
// ============================================================
const TICKETEAMS_LOGO_ASSET_ID = 'MAHBGt1xTfc';

// ============================================================
// חוק 2 — מיפוי event_type → הגדרות רקע
// ============================================================
const BACKGROUND_CONFIG = {
  football: {
    generator: 'generate_stadium_background',
    style: 'epic',
    description: 'אצטדיון כדורגל אפי — אחד בלבד, לא שניים',
  },
  mundial: {
    generator: 'generate_image',
    prompt: `Photorealistic FIFA World Cup trophy on a podium, surrounded by colorful national flags from around the world.
Golden trophy glowing with dramatic stadium lighting.
Confetti and festive atmosphere, pink and orange accent lights.
NO text, NO logos, NO overlays — pure clean background.
Ultra high quality, 8K detail level.`,
    description: 'גביע מונדיאל + דגלים צבעוניים',
  },
  ucl: {
    generator: 'generate_image',
    prompt: `Photorealistic UEFA Champions League trophy (Big Ears) on a dark background with dramatic blue and silver lighting.
Stars scattered around, deep blue and black color scheme with subtle pink and orange accent highlights.
Stadium atmosphere in the background, slightly blurred.
NO text, NO logos, NO overlays — pure clean background.
Ultra high quality, 8K detail level.`,
    description: 'גביע ליגת האלופות + כוכבים כחול/שחור',
  },
  concert: {
    generator: 'generate_image',
    prompt: `Photorealistic concert stage with dramatic lighting effects.
Massive LED screens, laser beams cutting through fog, excited crowd silhouettes.
Pink, orange, and purple lighting creating electric atmosphere.
NO text, NO logos, NO artist faces — pure clean background.
Ultra high quality, 8K detail level.`,
    description: 'במה עם אורות + קהל + אווירת קונצרט',
  },
};

// ============================================================
// חוק 4 — FORMAT_TYPE definitions
// ============================================================
const FORMAT_TYPES = {
  Stadium: {
    name: 'Stadium Epic',
    description: 'אצטדיון מרהיב — לכדורגל רגיל',
    default_for: ['football'],
  },
  Human: {
    name: 'Human/Emotional',
    description: 'שחקנים, אנשים, רגש — למונדיאל והופעות',
    default_for: ['mundial', 'concert'],
  },
  Urgency: {
    name: 'Urgency',
    description: 'דחיפות — פחות מ-48 שעות לאירוע',
    default_for: [],
    trigger: 'days_until_event <= 2',
  },
};

// ============================================================
// פונקציות
// ============================================================

/**
 * בוחר FORMAT_TYPE לפי event_type, ימים לאירוע, פורמט מתחרה, והמלצה היסטורית
 * Priority: Urgency(≤2d) > Counter-logic > Historical > Default
 * Backward compatible — 4th param is optional
 */
function selectFormatType(eventType, daysUntilEvent, competitorFormat, historicalRecommendation = null) {
  // Urgency overrides הכל — פחות מ-48 שעות
  if (daysUntilEvent != null && daysUntilEvent <= 2) {
    return 'Urgency';
  }

  // Counter-logic: אם מתחרה מריץ פורמט X → אנחנו בוחרים Y
  if (competitorFormat === 'Stadium') return 'Human';
  if (competitorFormat === 'Human') return 'Stadium';

  // Historical recommendation from BI analysis
  if (historicalRecommendation && FORMAT_TYPES[historicalRecommendation]) {
    return historicalRecommendation;
  }

  // Default לפי event_type
  if (['mundial', 'concert'].includes(eventType)) return 'Human';
  return 'Stadium';
}

/**
 * מחזיר הגדרות רקע לפי event_type
 */
function selectBackgroundConfig(eventType) {
  return BACKGROUND_CONFIG[eventType] || BACKGROUND_CONFIG.football;
}

/**
 * מחשב ימים עד לאירוע
 */
function calcDaysUntilEvent(eventDate) {
  if (!eventDate) return null;
  const now = new Date();
  const event = new Date(eventDate);
  const diff = (event - now) / (1000 * 60 * 60 * 24);
  return Math.max(0, Math.floor(diff));
}

// ============================================================
// DEMAND_TIERS — for Scout Agent demand scoring
// ============================================================
const DEMAND_TIERS = {
  critical: { min: 80, label: 'קריטי', action: 'auto_trigger_rima' },
  high: { min: 60, label: 'גבוה', action: 'suggest_to_monday' },
  medium: { min: 40, label: 'בינוני', action: 'monitor' },
  low: { min: 0, label: 'נמוך', action: 'ignore' },
};

function getDemandTier(score) {
  if (score >= DEMAND_TIERS.critical.min) return 'critical';
  if (score >= DEMAND_TIERS.high.min) return 'high';
  if (score >= DEMAND_TIERS.medium.min) return 'medium';
  return 'low';
}

module.exports = {
  TICKETEAMS_LOGO_ASSET_ID,
  BACKGROUND_CONFIG,
  FORMAT_TYPES,
  DEMAND_TIERS,
  selectFormatType,
  selectBackgroundConfig,
  calcDaysUntilEvent,
  getDemandTier,
};
