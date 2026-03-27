require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const cheerio = require('cheerio');

const VENUES_PATH = path.join(__dirname, '..', 'config', 'venues.json');
const CACHE_DIR = path.join(__dirname, '..', 'cache');
const CACHE_TTL_DAYS = 7;

// ============================================================
// Shared axios instance — keep-alive + defaults
// ============================================================
const httpClient = axios.create({
  timeout: 15000,
  headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TicketeamsScout/1.0)' },
});

// ============================================================
// In-memory venues cache — נטען פעם אחת, מתרענן רק על שינוי
// ============================================================
let _venuesCache = null;
let _venuesMtime = 0;

function getVenues() {
  try {
    const stat = fs.statSync(VENUES_PATH);
    if (_venuesCache && stat.mtimeMs === _venuesMtime) {
      return _venuesCache;
    }
    _venuesCache = JSON.parse(fs.readFileSync(VENUES_PATH, 'utf-8'));
    _venuesMtime = stat.mtimeMs;
    return _venuesCache;
  } catch (error) {
    console.error('שגיאה בטעינת venues.json:', error.message);
    if (_venuesCache) return _venuesCache;
    throw error;
  }
}

// ============================================================
// Retry helper — ניסיון חוזר עם exponential backoff
// ============================================================
async function fetchWithRetry(url, options = {}, maxRetries = 3) {
  let lastError;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await httpClient.get(url, options);
    } catch (error) {
      lastError = error;
      const status = error.response?.status;
      // לא מנסים שוב על 404 או 403
      if (status === 404 || status === 403) throw error;
      if (attempt < maxRetries) {
        const delay = 1000 * Math.pow(2, attempt - 1); // 1s, 2s, 4s
        console.warn(`  ניסיון ${attempt}/${maxRetries} נכשל (${error.message}), ממתין ${delay}ms...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }
  throw lastError;
}

// ============================================================
// מילון מטבעות לפי ליגה — לעולם לא להמיר, לשמור במטבע מקורי
// ============================================================
const LEAGUE_CURRENCY = {
  'premier_league': 'GBP',
  'la_liga': 'EUR',
  'serie_a': 'EUR',
  'bundesliga': 'EUR',
  'ligue_1': 'EUR',
  'champions_league': 'EUR',
};

// מיפוי שם קבוצה → מפתח ב-venues.json
function findTeamKey(homeTeam) {
  const venues = getVenues();
  const normalized = homeTeam.trim().toLowerCase().replace(/\s+/g, '_');

  // חיפוש ישיר לפי key
  if (venues.teams[normalized]) return normalized;

  // חיפוש לפי שם אנגלי נפוץ — מכסה כינויים, קיצורים, ושמות רשמיים
  const nameMap = {
    // Premier League
    'arsenal': 'arsenal',
    'arsenal fc': 'arsenal',
    'the gunners': 'arsenal',
    'gunners': 'arsenal',
    'chelsea': 'chelsea',
    'chelsea fc': 'chelsea',
    'the blues': 'chelsea',
    'liverpool': 'liverpool',
    'liverpool fc': 'liverpool',
    'the reds': 'liverpool',
    'manchester city': 'man_city',
    'man city': 'man_city',
    'man city fc': 'man_city',
    'manchester city fc': 'man_city',
    'city': 'man_city',
    'manchester united': 'man_utd',
    'man utd': 'man_utd',
    'man united': 'man_utd',
    'manchester united fc': 'man_utd',
    'united': 'man_utd',
    'tottenham': 'tottenham',
    'tottenham hotspur': 'tottenham',
    'spurs': 'tottenham',
    'tottenham hotspur fc': 'tottenham',
    // La Liga
    'barcelona': 'barcelona',
    'fc barcelona': 'barcelona',
    'barça': 'barcelona',
    'barca': 'barcelona',
    'fcb': 'barcelona',
    'real madrid': 'real_madrid',
    'real madrid cf': 'real_madrid',
    'atletico madrid': 'atletico',
    'atletico': 'atletico',
    'atlético madrid': 'atletico',
    'atlético de madrid': 'atletico',
    'atletico de madrid': 'atletico',
    'real sociedad': 'real_sociedad',
    'la real': 'real_sociedad',
    'celta vigo': 'celta_vigo',
    'celta de vigo': 'celta_vigo',
    'rc celta': 'celta_vigo',
    // Bundesliga
    'bayern munich': 'bayern',
    'bayern': 'bayern',
    'bayern münchen': 'bayern',
    'fc bayern': 'bayern',
    'fc bayern munich': 'bayern',
    'borussia dortmund': 'dortmund',
    'dortmund': 'dortmund',
    'bvb': 'dortmund',
    'eintracht frankfurt': 'frankfurt',
    'frankfurt': 'frankfurt',
    'sge': 'frankfurt',
    'rb salzburg': 'rb_salzburg',
    'red bull salzburg': 'rb_salzburg',
    'salzburg': 'rb_salzburg',
    'fc salzburg': 'rb_salzburg',
    // Serie A
    'juventus': 'juventus',
    'juventus fc': 'juventus',
    'juve': 'juventus',
    'milan': 'milan',
    'ac milan': 'milan',
    'inter': 'inter',
    'inter milan': 'inter',
    'fc internazionale': 'inter',
    'internazionale': 'inter',
    // Ligue 1
    'psg': 'psg',
    'paris saint-germain': 'psg',
    'paris saint germain': 'psg',
    'paris sg': 'psg',
    // Other / Champions League regulars
    'benfica': 'benfica',
    'sl benfica': 'benfica',
    'sport lisboa e benfica': 'benfica',
    'sporting lisbon': 'benfica',       // Mapped to closest Portuguese venue config
    'sporting cp': 'benfica',
    'sporting': 'benfica',
    'porto': 'benfica',
    'fc porto': 'benfica',
    'ajax': 'dortmund',                 // Mapped to closest European venue config
    'ajax amsterdam': 'dortmund',
    'afc ajax': 'dortmund',
    'psv': 'dortmund',
    'psv eindhoven': 'dortmund',
    'feyenoord': 'dortmund',
    'celtic': 'liverpool',
    'celtic fc': 'liverpool',
    'rangers': 'liverpool',
    'rangers fc': 'liverpool',
    'galatasaray': 'inter',
    'galatasaray sk': 'inter',
    'fenerbahce': 'inter',
    'fenerbahçe': 'inter',
    'club brugge': 'dortmund',
    'club bruges': 'dortmund',
  };

  const lower = homeTeam.trim().toLowerCase();
  // Also try Hebrew name matching from venues config
  if (!nameMap[lower]) {
    const venues = getVenues();
    for (const [key, team] of Object.entries(venues.teams)) {
      if (team.name_he && team.name_he.trim().toLowerCase() === lower) {
        return key;
      }
    }
  }
  return nameMap[lower] || null;
}

// מיפוי קבוצה → מטבע ליגה (מ-cache)
function getLeagueCurrency(homeTeam) {
  try {
    const venues = getVenues();
    const key = findTeamKey(homeTeam);
    const config = key ? venues.teams[key] : null;
    if (!config || !config.competition) {
      console.warn(`לא נמצאה ליגה לקבוצה ${homeTeam} — ברירת מחדל EUR`);
      return 'EUR';
    }
    return LEAGUE_CURRENCY[config.competition] || 'EUR';
  } catch (error) {
    console.error('שגיאה בזיהוי מטבע ליגה:', error.message);
    return 'EUR';
  }
}

// ============================================================
// 1. buildMatchKey — יוצר מפתח זיהוי ייחודי למשחק
// ============================================================
function buildMatchKey(homeTeam, awayTeam, competition, date) {
  try {
    if (!homeTeam || !awayTeam || !competition || !date) {
      throw new Error('חסרים שדות חובה ליצירת מפתח משחק');
    }
    const normalize = (str) => str.trim().toLowerCase().replace(/\s+/g, '_');
    return `${normalize(homeTeam)}__${normalize(awayTeam)}__${normalize(competition)}__${date}`;
  } catch (error) {
    console.error('שגיאה ביצירת מפתח משחק:', error.message);
    throw error;
  }
}

// ============================================================
// 2. checkCache — בודק אם קיימות תוצאות במטמון שבועי
// ============================================================
function checkCache(matchKey) {
  try {
    const cacheFile = path.join(CACHE_DIR, `${matchKey}.json`);

    if (!fs.existsSync(cacheFile)) {
      return null;
    }

    const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
    const ageInDays = (Date.now() - cached.timestamp) / (1000 * 60 * 60 * 24);

    if (ageInDays > CACHE_TTL_DAYS) {
      fs.unlinkSync(cacheFile);
      return null;
    }

    return cached.results;
  } catch (error) {
    console.error('שגיאה בבדיקת מטמון:', error.message);
    return null;
  }
}

// ============================================================
// 3. saveToCache — שומר תוצאות סריקה למטמון
// ============================================================
function saveToCache(matchKey, results) {
  try {
    if (!fs.existsSync(CACHE_DIR)) {
      fs.mkdirSync(CACHE_DIR, { recursive: true });
    }

    const cacheFile = path.join(CACHE_DIR, `${matchKey}.json`);
    const data = {
      matchKey,
      timestamp: Date.now(),
      savedAt: new Date().toISOString(),
      results,
    };

    fs.writeFileSync(cacheFile, JSON.stringify(data, null, 2), 'utf-8');
    return true;
  } catch (error) {
    console.error('שגיאה בשמירה למטמון:', error.message);
    return false;
  }
}

// ============================================================
// 4. validateMatchDate — מוודא שהתאריך מהסריקה תואם למצופה
// ============================================================
function validateMatchDate(scrapedDate, expectedDate) {
  try {
    if (!scrapedDate || !expectedDate) {
      throw new Error('חסר תאריך לבדיקה');
    }

    const scraped = new Date(scrapedDate).toISOString().split('T')[0];
    const expected = new Date(expectedDate).toISOString().split('T')[0];

    if (scraped !== expected) {
      console.warn(`אזהרה: תאריך לא תואם — צפוי ${expected}, נמצא ${scraped}`);
      return false;
    }

    return true;
  } catch (error) {
    console.error('שגיאה בוידוא תאריך:', error.message);
    return false;
  }
}

// ============================================================
// 5. loadVenueConfig — טוען הגדרות אצטדיון מ-venues.json
// ============================================================
function loadVenueConfig(homeTeam) {
  try {
    const venues = getVenues();
    const key = findTeamKey(homeTeam);
    const config = key ? venues.teams[key] : null;

    if (!config) {
      console.warn(`[SCOUT] Unknown team: ${homeTeam} — not in venue config, using defaults`);
      throw new Error(`לא נמצאה הגדרה לקבוצה: ${homeTeam}`);
    }

    return config;
  } catch (error) {
    console.error('שגיאה בטעינת הגדרות אצטדיון:', error.message);
    throw error;
  }
}

// ============================================================
// 7a. parseLiveTickets — פירסור HTML מ-livetickets.co.il
// ============================================================
function parseLiveTickets(html) {
  try {
    const $ = cheerio.load(html);
    const categories = [];
    const currencyMap = { '£': 'GBP', '€': 'EUR', '$': 'USD', '₪': 'ILS' };

    // שם אירוע מ-h1
    const eventName = $('h1').first().text().trim();

    // תאריך — מ-JSON-LD
    let eventDate = null;
    $('script[type="application/ld+json"]').each(function () {
      try {
        const ld = JSON.parse($(this).html());
        if (ld.startDate) eventDate = ld.startDate;
      } catch (parseErr) {
        console.warn('  אזהרה: JSON-LD לא תקין ב-livetickets:', parseErr.message);
      }
    });

    // קטגוריות ומחירים — רשימת כרטיסים לפי class
    $('.list_tickets_item').each(function () {
      const name = $(this).find('.tickets_name_txt').text().trim();
      const currency = $(this).find('.tickets_price_currency').text().trim();
      const priceGroup = $(this).find('.tickets_price_group').text().trim();

      if (!name) return;

      // חילוץ מספר מתוך טקסט המחיר
      const priceMatch = priceGroup.match(/([\d,]+)/);
      if (priceMatch) {
        categories.push({
          name,
          price: parseFloat(priceMatch[1].replace(/,/g, '')),
          currency: currencyMap[currency] || currency || 'ILS',
        });
      }
    });

    return { eventName, eventDate, categories };
  } catch (error) {
    console.error('שגיאה בפירסור livetickets:', error.message);
    return { eventName: null, eventDate: null, categories: [] };
  }
}

// ============================================================
// 7b. parseArenaTickets — פירסור HTML מ-arenatickets.co.il
// ============================================================
function parseArenaTickets(html, officialCurrency) {
  try {
    const $ = cheerio.load(html);
    const categories = [];
    // ArenaTickets מציג מחירים ב-ILS — נסמן את זה בפירוש
    const displayCurrency = 'ILS';

    // שם אירוע
    const eventName = $('h1.product_title, h1.entry-title').first().text().trim()
      || $('h1').first().text().trim();

    // תאריך — מ-JSON-LD
    let eventDate = null;
    $('script[type="application/ld+json"]').each(function () {
      try {
        const ld = JSON.parse($(this).html());
        if (ld.startDate) eventDate = ld.startDate;
      } catch (parseErr) {
        console.warn('  אזהרה: JSON-LD לא תקין ב-arenatickets:', parseErr.message);
      }
    });

    // קטגוריות — WooCommerce variations מתוך data-product_variations
    const variationsAttr = $('form.variations_form').attr('data-product_variations');
    if (variationsAttr) {
      try {
        const variations = JSON.parse(variationsAttr);
        for (const v of variations) {
          const rawName = v.attributes?.attribute_pa_catmatch
            || Object.values(v.attributes || {})[0]
            || 'unknown';
          // פענוח URL encoding ותיקון מקפים
          const name = decodeURIComponent(rawName).replace(/-/g, ' ').trim();
          categories.push({
            name,
            price: parseFloat(v.display_price) || 0,
            currency: displayCurrency,
            officialCurrency,
            inStock: v.is_in_stock !== false,
            maxQty: typeof v.max_qty === 'number' ? v.max_qty : null,
            description: v.variation_description
              ? cheerio.load(v.variation_description).text().trim()
              : '',
          });
        }
      } catch (varErr) {
        console.warn('  אזהרה: שגיאה בפירסור WooCommerce variations:', varErr.message);
      }
    }

    // fallback — אם אין variations, ניסיון לשלוף מחיר בודד
    if (categories.length === 0) {
      const priceText = $('p.price .amount, .woocommerce-Price-amount').first().text().trim();
      const priceMatch = priceText.match(/([\d,]+)/);
      if (priceMatch) {
        categories.push({
          name: 'general',
          price: parseFloat(priceMatch[1].replace(/,/g, '')),
          currency: displayCurrency,
          officialCurrency,
        });
      }
    }

    return { eventName, eventDate, categories };
  } catch (error) {
    console.error('שגיאה בפירסור arenatickets:', error.message);
    return { eventName: null, eventDate: null, categories: [] };
  }
}

// ============================================================
// 7. scrapeMatch — סורק מחירים מכל הלינקים ב-venues.json
// ============================================================
async function scrapeMatch(homeTeam, awayTeam, competition, date) {
  try {
    const venueConfig = loadVenueConfig(homeTeam);
    const matchKey = buildMatchKey(homeTeam, awayTeam, competition, date);
    const officialCurrency = getLeagueCurrency(homeTeam);
    const sources = {};

    // סריקת livetickets
    if (venueConfig.livetickets_url) {
      try {
        const url = venueConfig.livetickets_url;
        console.log(`סורק livetickets עבור ${homeTeam} vs ${awayTeam}...`);

        const response = await fetchWithRetry(url);
        const parsed = parseLiveTickets(response.data);

        // בדיקת תאריך — אם לא תואם, מסמנים אזהרה
        let dateWarning = null;
        if (parsed.eventDate && date) {
          const dateMatch = validateMatchDate(parsed.eventDate, date);
          if (!dateMatch) {
            dateWarning = `תאריך לא תואם — צפוי ${date}, נמצא ${parsed.eventDate}`;
          }
        }

        sources.livetickets = {
          url,
          eventName: parsed.eventName,
          eventDate: parsed.eventDate,
          currency: officialCurrency,
          officialCurrency,
          scrapedAt: new Date().toISOString(),
          status: 'ok',
          dateWarning,
          categories: parsed.categories,
        };

        console.log(`  livetickets: ${parsed.categories.length} קטגוריות נמצאו (${officialCurrency})`);
      } catch (sourceError) {
        console.error(`שגיאה בסריקת livetickets:`, sourceError.message);
        sources.livetickets = {
          url: venueConfig.livetickets_url,
          status: 'error',
          error: sourceError.message,
          categories: [],
        };
      }
    }

    // סריקת arenatickets
    if (venueConfig.arenatickets_url) {
      try {
        const url = venueConfig.arenatickets_url;
        console.log(`סורק arenatickets עבור ${homeTeam} vs ${awayTeam}...`);

        const response = await fetchWithRetry(url);
        const parsed = parseArenaTickets(response.data, officialCurrency);

        let dateWarning = null;
        if (parsed.eventDate && date) {
          const dateMatch = validateMatchDate(parsed.eventDate, date);
          if (!dateMatch) {
            dateWarning = `תאריך לא תואם — צפוי ${date}, נמצא ${parsed.eventDate}`;
          }
        }

        sources.arenatickets = {
          url,
          eventName: parsed.eventName,
          eventDate: parsed.eventDate,
          currency: 'ILS',
          officialCurrency,
          scrapedAt: new Date().toISOString(),
          status: 'ok',
          dateWarning,
          categories: parsed.categories,
        };

        console.log(`  arenatickets: ${parsed.categories.length} קטגוריות נמצאו (ILS)`);
      } catch (sourceError) {
        console.error(`שגיאה בסריקת arenatickets:`, sourceError.message);
        sources.arenatickets = {
          url: venueConfig.arenatickets_url,
          status: 'error',
          error: sourceError.message,
          categories: [],
        };
      }
    }

    return {
      matchKey,
      homeTeam,
      awayTeam,
      competition,
      date,
      currency: officialCurrency,
      stadium: venueConfig.stadium,
      city: venueConfig.city,
      name_he: venueConfig.name_he,
      scrapedAt: new Date().toISOString(),
      sources,
    };
  } catch (error) {
    console.error('שגיאה בסריקת משחק:', error.message);
    throw error;
  }
}

// ============================================================
// 8. getMatchPricing — פונקציה ראשית: cache → scrape → save
// ============================================================
async function getMatchPricing(homeTeam, awayTeam, competition, date) {
  try {
    const matchKey = buildMatchKey(homeTeam, awayTeam, competition, date);

    // בדיקת מטמון
    const cached = checkCache(matchKey);
    if (cached) {
      console.log(`נמצא במטמון: ${matchKey}`);
      return cached;
    }

    // סריקה חדשה
    console.log(`סורק מחירים עבור: ${matchKey}`);
    const results = await scrapeMatch(homeTeam, awayTeam, competition, date);

    // שמירה למטמון
    saveToCache(matchKey, results);

    return results;
  } catch (error) {
    console.error('שגיאה בשליפת מחירים:', error.message);
    throw error;
  }
}

// ============================================================
// PROACTIVE INTELLIGENCE — Constants
// ============================================================

const { getDemandTier } = require('../config/creative-rules');
const { getBoardItems } = require('../config/monday');

const FIXTURES_CACHE_DIR = path.join(__dirname, '..', 'cache', 'fixtures');
const FIXTURES_CACHE_TTL_DAYS = 3;

// High-demand rivalry pairs — trigger +30 demand score
const RIVALRY_PAIRS = [
  ['arsenal', 'tottenham'],        // North London Derby
  ['arsenal', 'chelsea'],          // London Derby
  ['chelsea', 'tottenham'],        // London Derby
  ['liverpool', 'man_utd'],        // Northwest Derby
  ['liverpool', 'man_city'],       // Title Rivals
  ['man_city', 'man_utd'],         // Manchester Derby
  ['barcelona', 'real_madrid'],    // El Clasico
  ['atletico', 'real_madrid'],     // Madrid Derby
  ['atletico', 'barcelona'],       // Spanish Giants
  ['bayern', 'dortmund'],          // Der Klassiker
  ['juventus', 'milan'],           // Derby d'Italia
  ['juventus', 'inter'],           // Derby d'Italia
  ['milan', 'inter'],              // Derby della Madonnina
  ['psg', 'barcelona'],            // CL Rivalry
  ['liverpool', 'barcelona'],      // CL Classic
  ['real_madrid', 'bayern'],       // CL Classic
];

// Competition prestige weight — 0-10
const COMPETITION_WEIGHT = {
  champions_league: 10,
  premier_league: 7,
  la_liga: 6,
  serie_a: 5,
  bundesliga: 5,
  ligue_1: 4,
};

// ============================================================
// 9. scrapeTeamFixtures — scrapes upcoming fixtures from team page
// ============================================================

/**
 * Extract team names from event title.
 * Handles formats:
 *   "Arsenal - Chelsea"
 *   "Arsenal vs Chelsea"
 *   "Champions League: Arsenal - Chelsea"
 *   "Carabao Cup Final: Manchester City - Arsenal"
 */
function parseTeamsFromTitle(title) {
  if (!title) return null;

  // Strip competition prefix (everything before last colon)
  let cleaned = title;
  const colonIdx = cleaned.lastIndexOf(':');
  if (colonIdx > 0 && colonIdx < cleaned.length - 2) {
    cleaned = cleaned.substring(colonIdx + 1).trim();
  }

  const vsMatch = cleaned.match(/(.+?)\s+(?:vs|v\.?s\.?|נגד|-)\s+(.+)/i);
  if (!vsMatch) return null;

  return { home: vsMatch[1].trim(), away: vsMatch[2].trim() };
}

async function scrapeTeamFixtures(teamKey) {
  try {
    const venues = getVenues();
    const config = venues.teams[teamKey];
    if (!config || !config.livetickets_url) {
      return [];
    }

    const teamUrl = config.livetickets_url;
    console.log(`  סורק fixtures עבור ${config.name_he} (${teamKey})...`);

    const response = await fetchWithRetry(teamUrl);

    const $ = cheerio.load(response.data);
    const fixtures = [];

    // Method 1: HTML event listings (multiple selector patterns for LiveTickets)
    $('a[href*="events.aspx"], a[href*="event/"], .events_list_item, .event-item, .product-item').each(function () {
      try {
        const title = $(this).find('h2, h3, .event_title, .product_title').text().trim()
          || $(this).text().trim()
          || $(this).attr('title') || '';
        const link = $(this).attr('href') || $(this).find('a').attr('href') || '';
        const dateText = $(this).find('.event_date, .date, time').text().trim() || '';

        if (!title || title.length > 200) return;

        const teams = parseTeamsFromTitle(title);
        if (!teams) return;

        let eventDate = null;
        if (dateText) {
          const parsed = new Date(dateText);
          if (!isNaN(parsed)) eventDate = parsed.toISOString().split('T')[0];
        }

        fixtures.push({
          homeTeam: teams.home,
          awayTeam: teams.away,
          title,
          url: link.startsWith('http') ? link : `https://www.livetickets.co.il${link}`,
          date: eventDate,
          sourceTeam: teamKey,
          competition: config.competition,
        });
      } catch (itemErr) {
        // skip individual item parse errors
      }
    });

    // Method 2: JSON-LD structured data (SportsEvent / Event)
    $('script[type="application/ld+json"]').each(function () {
      try {
        const raw = $(this).html();
        if (!raw) return;
        const ld = JSON.parse(raw);
        const events = Array.isArray(ld) ? ld : [ld];
        for (const event of events) {
          if (event['@type'] === 'Event' || event['@type'] === 'SportsEvent') {
            const name = event.name || '';
            const date = event.startDate ? new Date(event.startDate).toISOString().split('T')[0] : null;
            const teams = parseTeamsFromTitle(name);
            if (teams) {
              fixtures.push({
                homeTeam: teams.home,
                awayTeam: teams.away,
                title: name,
                url: event.url || '',
                date,
                sourceTeam: teamKey,
                competition: config.competition,
              });
            }
          }
        }
      } catch (ldErr) {
        // skip JSON-LD parse errors
      }
    });

    if (fixtures.length > 0) {
      console.log(`  ${config.name_he}: ${fixtures.length} fixtures נמצאו`);
    }

    return fixtures;
  } catch (error) {
    const status = error.response?.status;
    if (status === 404) {
      console.log(`  ${teamKey}: 404 — performer page not found`);
    } else {
      console.error(`  שגיאה בסריקת fixtures ל-${teamKey}:`, error.message);
    }
    return [];
  }
}

// ============================================================
// 10. scrapeAllFixtures — iterates all teams, deduplicates
// ============================================================

async function scrapeAllFixtures() {
  // Check cache
  if (!fs.existsSync(FIXTURES_CACHE_DIR)) {
    fs.mkdirSync(FIXTURES_CACHE_DIR, { recursive: true });
  }

  const cacheFile = path.join(FIXTURES_CACHE_DIR, 'all_fixtures.json');
  if (fs.existsSync(cacheFile)) {
    try {
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
      const ageInDays = (Date.now() - cached.timestamp) / (1000 * 60 * 60 * 24);
      if (ageInDays <= FIXTURES_CACHE_TTL_DAYS) {
        console.log(`fixtures cache valid (${Math.round(ageInDays * 10) / 10} days old)`);
        return cached.fixtures;
      }
    } catch (cacheErr) {
      console.warn('אזהרה: שגיאה בקריאת fixtures cache:', cacheErr.message);
    }
  }

  const venues = getVenues();
  const allTeamKeys = Object.keys(venues.teams);
  const allFixtures = [];
  const seen = new Set();
  const CONCURRENCY = 3;

  console.log(`\n=== Proactive Scan — ${allTeamKeys.length} teams (${CONCURRENCY} concurrent) ===`);

  // Controlled concurrency — CONCURRENCY teams at a time with rate limiting
  for (let i = 0; i < allTeamKeys.length; i += CONCURRENCY) {
    const batch = allTeamKeys.slice(i, i + CONCURRENCY);
    const results = await Promise.allSettled(batch.map((key) => scrapeTeamFixtures(key)));

    for (let j = 0; j < results.length; j++) {
      if (results[j].status === 'rejected') {
        console.error(`  שגיאה בסריקת ${batch[j]}:`, results[j].reason?.message);
        continue;
      }
      const fixtures = results[j].value;
      for (const fix of fixtures) {
        const homeKey = findTeamKey(fix.homeTeam) || fix.homeTeam.toLowerCase().replace(/\s+/g, '_');
        const awayKey = findTeamKey(fix.awayTeam) || fix.awayTeam.toLowerCase().replace(/\s+/g, '_');
        const dedupeKey = `${homeKey}__${awayKey}__${fix.date || 'nodate'}`;

        if (!seen.has(dedupeKey)) {
          seen.add(dedupeKey);
          fix.homeKey = homeKey;
          fix.awayKey = awayKey;
          allFixtures.push(fix);
        }
      }
    }

    // Rate limiting — 2 seconds between batches
    if (i + CONCURRENCY < allTeamKeys.length) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
  }

  // Save to cache
  fs.writeFileSync(cacheFile, JSON.stringify({
    timestamp: Date.now(),
    savedAt: new Date().toISOString(),
    fixtures: allFixtures,
  }, null, 2), 'utf-8');

  console.log(`=== Scan complete — ${allFixtures.length} unique fixtures ===\n`);
  return allFixtures;
}

// ============================================================
// 11. scoreDemand — calculates demand score 0-100
// ============================================================

function scoreDemand(fixture) {
  let score = 0;
  const factors = [];

  const homeKey = fixture.homeKey || findTeamKey(fixture.homeTeam) || '';
  const awayKey = fixture.awayKey || findTeamKey(fixture.awayTeam) || '';
  const competition = fixture.competition || '';

  // Rivalry check (+30)
  const isRivalry = RIVALRY_PAIRS.some(
    ([a, b]) => (homeKey === a && awayKey === b) || (homeKey === b && awayKey === a)
  );
  if (isRivalry) {
    score += 30;
    factors.push('rivalry (+30)');
  }

  // Champions League (+25)
  if (competition === 'champions_league') {
    score += 25;
    factors.push('champions_league (+25)');
  }

  // CL knockout detection (+10) — look for keywords in title
  const title = (fixture.title || '').toLowerCase();
  if (competition === 'champions_league' && /knockout|quarter|semi|final|round of 16|שמינית|רבע|חצי|גמר/.test(title)) {
    score += 10;
    factors.push('cl_knockout (+10)');
  }

  // Competition prestige (+0-10)
  const prestigeScore = COMPETITION_WEIGHT[competition] || 0;
  if (prestigeScore > 0) {
    score += prestigeScore;
    factors.push(`prestige_${competition} (+${prestigeScore})`);
  }

  // Temporal proximity (+0-15, closer = higher, max within 60 days)
  if (fixture.date) {
    const daysUntil = Math.max(0, (new Date(fixture.date) - new Date()) / (1000 * 60 * 60 * 24));
    if (daysUntil <= 7) {
      score += 15;
      factors.push('within_7d (+15)');
    } else if (daysUntil <= 14) {
      score += 12;
      factors.push('within_14d (+12)');
    } else if (daysUntil <= 30) {
      score += 8;
      factors.push('within_30d (+8)');
    } else if (daysUntil <= 60) {
      score += 4;
      factors.push('within_60d (+4)');
    }
  }

  // Cap at 100
  score = Math.min(100, score);
  const tier = getDemandTier(score);

  return { score, factors, tier };
}

// ============================================================
// 12. detectHighDemandMatches — filter by score threshold
// ============================================================

function detectHighDemandMatches(fixtures, minScore = 50) {
  const scored = fixtures.map((fix) => ({
    ...fix,
    demand: scoreDemand(fix),
  }));

  return scored
    .filter((fix) => fix.demand.score >= minScore)
    .sort((a, b) => b.demand.score - a.demand.score);
}

// ============================================================
// 13. suggestMatchesToMonday — diff against existing board
// ============================================================

async function suggestMatchesToMonday(highDemandMatches, existingBoardItems) {
  // Build set of existing match keys from board
  const existingKeys = new Set();
  for (const item of existingBoardItems || []) {
    const cols = {};
    for (const col of item.column_values || []) {
      cols[col.id] = col.text;
    }
    const home = cols.home_team || cols.homeTeam || '';
    const away = cols.away_team || cols.awayTeam || '';
    const comp = cols.competition || cols.league || '';
    const date = cols.date || cols.event_date || '';

    if (home && away) {
      const key = buildMatchKey(home, away, comp || 'unknown', date || 'nodate');
      existingKeys.add(key);
    }
  }

  const suggestions = [];

  for (const match of highDemandMatches) {
    const matchKey = buildMatchKey(
      match.homeTeam, match.awayTeam,
      match.competition || 'unknown',
      match.date || 'nodate'
    );

    if (!existingKeys.has(matchKey)) {
      // Build Hebrew reason
      const reasons = [];
      if (match.demand.tier === 'critical') reasons.push('ביקוש קריטי');
      else if (match.demand.tier === 'high') reasons.push('ביקוש גבוה');
      for (const f of match.demand.factors) {
        if (f.includes('rivalry')) reasons.push('דרבי');
        if (f.includes('champions_league')) reasons.push('ליגת אלופות');
        if (f.includes('cl_knockout')) reasons.push('שלב נוקאאוט');
      }

      suggestions.push({
        matchKey,
        homeTeam: match.homeTeam,
        awayTeam: match.awayTeam,
        competition: match.competition,
        date: match.date,
        demandScore: match.demand.score,
        demandTier: match.demand.tier,
        reason: reasons.join(' | ') || 'ציון ביקוש גבוה',
        url: match.url,
      });
    }
  }

  return suggestions;
}

// ============================================================
// 14. proactiveScan — main orchestrator
// ============================================================

async function proactiveScan() {
  console.log('\n=== Proactive Intelligence Scan ===');
  console.log(`Time: ${new Date().toISOString()}\n`);

  // Step 1: Scrape all fixtures
  const allFixtures = await scrapeAllFixtures();

  // Step 2: Score and filter
  const highDemand = detectHighDemandMatches(allFixtures, 50);

  // Step 3: Compare against Monday.com board
  let boardItems = [];
  try {
    boardItems = await getBoardItems();
  } catch (err) {
    console.warn('לא ניתן לשלוף פריטים מ-Monday.com:', err.message);
  }

  const suggestions = await suggestMatchesToMonday(highDemand, boardItems);

  // Report
  console.log(`\n--- Results ---`);
  console.log(`Total fixtures found: ${allFixtures.length}`);
  console.log(`High demand (score ≥ 50): ${highDemand.length}`);
  console.log(`New suggestions (not on board): ${suggestions.length}`);

  if (suggestions.length > 0) {
    console.log('\n--- Suggestions ---');
    for (const s of suggestions) {
      console.log(`  [${s.demandScore}] ${s.homeTeam} vs ${s.awayTeam} | ${s.competition} | ${s.date || '?'}`);
      console.log(`    Tier: ${s.demandTier} | ${s.reason}`);
    }
  }

  console.log('\n=== Proactive Scan Complete ===\n');

  // Filter raw fixtures to those with at least one known team
  const knownFixtures = allFixtures.filter((f) => {
    const hk = f.homeKey || findTeamKey(f.homeTeam);
    const ak = f.awayKey || findTeamKey(f.awayTeam);
    return hk || ak;
  });

  return {
    totalFixtures: allFixtures.length,
    highDemand: highDemand.length,
    suggestions,
    fixtures: knownFixtures,
    scannedAt: new Date().toISOString(),
  };
}

// ============================================================
// בדיקה עצמית
// ============================================================
async function selfTest() {
  console.log('=== Scout Agent — בדיקה עצמית ===\n');

  // בדיקת venues.json
  try {
    const config = loadVenueConfig('Barcelona');
    console.log(`venues.json — תקין (${config.name_he}, ${config.stadium})`);
  } catch {
    console.error('venues.json — נכשל');
  }

  // בדיקת buildMatchKey
  const key = buildMatchKey('Barcelona', 'Real Madrid', 'La Liga', '2026-03-15');
  console.log(`buildMatchKey — ${key}`);

  // בדיקת cache
  saveToCache('test__key', [{ test: true }]);
  const fromCache = checkCache('test__key');
  console.log(`cache — ${fromCache ? 'תקין' : 'נכשל'}`);

  // בדיקת validateMatchDate
  const dateValid = validateMatchDate('2026-03-15', '2026-03-15');
  console.log(`validateMatchDate — ${dateValid ? 'תקין' : 'נכשל'}`);

  // בדיקת getLeagueCurrency
  const gbp = getLeagueCurrency('Arsenal');
  const eur = getLeagueCurrency('Barcelona');
  console.log(`getLeagueCurrency — Arsenal: ${gbp}, Barcelona: ${eur}`);

  // בדיקת סריקה אמיתית — Arsenal מ-livetickets ו-arenatickets
  console.log('\n--- בדיקת סריקה חיה ---');
  try {
    const result = await scrapeMatch('Arsenal', 'Everton', 'Premier League', '2026-03-14');
    console.log(`מטבע רשמי: ${result.currency}`);
    for (const [source, data] of Object.entries(result.sources)) {
      console.log(`${source}: ${data.status} — ${data.categories.length} קטגוריות (${data.currency})`);
      if (data.categories.length > 0) {
        data.categories.forEach((c) =>
          console.log(`  ${c.name}: ${c.price} ${c.currency}`)
        );
      }
    }
  } catch (err) {
    console.error('סריקה חיה — נכשלה:', err.message);
  }

  console.log('\n=== Scout Agent — מוכן ===');
}

// ============================================================
// getStockStatus — שליפת מצב מלאי מ-WooCommerce (ArenaTickets)
// ============================================================
async function getStockStatus(matchKey) {
  try {
    // Try cache first
    const cached = checkCache(matchKey);
    const arenaData = cached?.sources?.arenatickets;

    let categories = [];

    if (arenaData && arenaData.status === 'ok' && arenaData.categories?.length > 0) {
      categories = arenaData.categories;
    } else {
      // Parse matchKey to get team details (format: home__away__comp__date)
      const parts = matchKey.split('__');
      const homeTeam = (parts[0] || '').replace(/_/g, ' ');

      const venueConfig = loadVenueConfig(homeTeam);
      if (!venueConfig?.arenatickets_url) {
        return {
          matchKey,
          status: 'unavailable',
          totalCategories: 0,
          inStockCategories: 0,
          categories: [],
          lastChecked: new Date().toISOString(),
        };
      }

      // Read-only scrape from ArenaTickets
      const response = await axios.get(venueConfig.arenatickets_url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; TicketeamsScout/1.0)' },
        timeout: 15000,
      });

      const officialCurrency = getLeagueCurrency(homeTeam);
      const parsed = parseArenaTickets(response.data, officialCurrency);
      categories = parsed.categories;
    }

    // Aggregate stock
    const totalCategories = categories.length;
    const inStockCategories = categories.filter((c) => c.inStock !== false).length;
    const totalMaxQty = categories.reduce((sum, c) => sum + (c.maxQty || 0), 0);

    // Determine status based on thresholds
    let status = 'unavailable';
    if (totalCategories === 0) {
      status = 'unavailable';
    } else if (inStockCategories === 0) {
      status = 'out_of_stock';
    } else if (totalMaxQty > 0 && totalMaxQty < 10) {
      status = 'critical_stock';
    } else if (totalMaxQty > 0 && totalMaxQty < 50) {
      status = 'low_stock';
    } else {
      status = 'in_stock';
    }

    return {
      matchKey,
      status,
      totalCategories,
      inStockCategories,
      quantity: totalMaxQty || null,
      categories: categories.map((c) => ({
        name: c.name,
        price: c.price,
        currency: c.currency,
        inStock: c.inStock !== false,
        maxQty: c.maxQty || null,
      })),
      lastChecked: new Date().toISOString(),
    };
  } catch (error) {
    console.error('שגיאה בשליפת מלאי:', error.message);
    return {
      matchKey,
      status: 'unavailable',
      totalCategories: 0,
      inStockCategories: 0,
      categories: [],
      lastChecked: new Date().toISOString(),
    };
  }
}

module.exports = {
  buildMatchKey,
  checkCache,
  saveToCache,
  validateMatchDate,
  loadVenueConfig,
  getLeagueCurrency,
  findTeamKey,
  parseLiveTickets,
  parseArenaTickets,
  scrapeMatch,
  getMatchPricing,
  getStockStatus,
  // Proactive functions
  scrapeTeamFixtures,
  scrapeAllFixtures,
  scoreDemand,
  detectHighDemandMatches,
  suggestMatchesToMonday,
  proactiveScan,
  // Constants
  RIVALRY_PAIRS,
  COMPETITION_WEIGHT,
};

if (require.main === module) {
  const args = process.argv.slice(2);

  if (args.includes('--proactive')) {
    proactiveScan().catch(console.error);
  } else if (args.includes('--demand')) {
    const idx = args.indexOf('--demand');
    const home = args[idx + 1] || 'Arsenal';
    const away = args[idx + 2] || 'Chelsea';
    const homeKey = findTeamKey(home) || home.toLowerCase();
    // Detect competition from venues.json
    let competition = 'premier_league';
    try {
      const config = loadVenueConfig(home);
      competition = config.competition || 'premier_league';
    } catch {}
    const fixture = {
      homeTeam: home,
      awayTeam: away,
      homeKey,
      awayKey: findTeamKey(away) || away.toLowerCase(),
      competition,
      date: new Date(Date.now() + 14 * 86400000).toISOString().split('T')[0],
      title: `${home} vs ${away}`,
    };
    const demand = scoreDemand(fixture);
    console.log(`\n${home} vs ${away}`);
    console.log(`  Score: ${demand.score}/100`);
    console.log(`  Tier: ${demand.tier}`);
    console.log(`  Factors: ${demand.factors.join(', ')}`);
  } else {
    selfTest();
  }
}
