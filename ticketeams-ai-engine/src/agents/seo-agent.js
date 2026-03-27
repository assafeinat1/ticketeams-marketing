/**
 * Ticketeams SEO Agent — Landing Pages & Blog Posts
 *
 * Creates SEO-optimized landing pages and blog posts on WordPress
 * for hot events detected by the intelligence system.
 *
 * Functions:
 *   generateLandingPage  — Create WP page via REST API (draft)
 *   generateBlogPost     — Create WP blog post via REST API (draft)
 *   getExistingContent   — List existing WP pages + posts (public, no auth)
 *   getSitemapHealth     — Fetch sitemap_index.xml, count URLs
 *   listCreatedContent   — Read local cache of SEO-created content
 *   selfTest             — Validate config + auth
 *
 * RedRok Security Standard:
 * - WP credentials via dotenv (WP_APP_USER, WP_APP_PASSWORD)
 * - Graceful failure when credentials missing
 * - ZERO-DELETION: Never deletes WP content
 *
 * Usage:
 *   node src/agents/seo-agent.js   # selfTest
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const config = require('../config/seo-config.json');

const CACHE_DIR = path.join(__dirname, '..', 'cache', 'seo');
const WP_REST = config.wordpress.restBase;
const WP_BASE = config.wordpress.baseUrl;

// Ensure cache dir exists
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// ============================================================
// Auth
// ============================================================

function getWpAuth() {
  const user = process.env.WP_APP_USER;
  const pass = process.env.WP_APP_PASSWORD;
  if (!user || !pass) return null;
  return { username: user, password: pass };
}

// ============================================================
// Landing Page Generation
// ============================================================

/**
 * Generate an SEO-optimized landing page for a sporting event.
 *
 * @param {Object} eventData - { homeTeam, awayTeam, competition, gameDate, heatScore?, priceRange? }
 * @returns {Object} { success, pageId?, url?, title?, reason? }
 */
async function generateLandingPage(eventData) {
  const { homeTeam, awayTeam, competition, gameDate, heatScore, priceRange } = eventData;

  // Auth check
  const auth = getWpAuth();
  if (!auth) {
    return { success: false, reason: 'WP_APP_USER/WP_APP_PASSWORD not configured' };
  }

  // Build match key for cache
  const matchKey = `${(homeTeam || '').replace(/\s+/g, '_')}__${(awayTeam || '').replace(/\s+/g, '_')}`;
  const cacheFile = path.join(CACHE_DIR, `landing_${matchKey}.json`);

  // Check if already created
  if (fs.existsSync(cacheFile)) {
    const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
    return { success: true, pageId: cached.wpPageId, url: cached.wpUrl, title: cached.title, cached: true };
  }

  // Build page title
  const title = config.landingPage.titleTemplate
    .replace('{homeTeam}', homeTeam)
    .replace('{awayTeam}', awayTeam)
    .replace('{date}', gameDate || '');

  // Build SEO description
  const eventName = `${homeTeam} נגד ${awayTeam}`;
  const seoDescription = config.landingPage.seoDescriptionTemplate
    .replace('{event}', eventName)
    .replace('{date}', gameDate || '');

  // Build page content (Hebrew SEO structure)
  const priceBlock = priceRange
    ? `<p style="font-size:18px;"><strong>טווח מחירים:</strong> ${priceRange}</p>`
    : '';

  const searchQuery = encodeURIComponent(`${homeTeam} ${awayTeam}`);

  const content = `
<!-- wp:heading {"level":1} -->
<h1>כרטיסים ל${homeTeam} נגד ${awayTeam}</h1>
<!-- /wp:heading -->

<!-- wp:paragraph -->
<p><strong>תחרות:</strong> ${competition || 'כדורגל בינלאומי'}</p>
<!-- /wp:paragraph -->

<!-- wp:paragraph -->
<p><strong>תאריך:</strong> ${gameDate || 'יפורסם בקרוב'}</p>
<!-- /wp:paragraph -->

${priceBlock}

<!-- wp:paragraph -->
<p>הזמינו כרטיסים ל${homeTeam} נגד ${awayTeam} דרך Ticketeams — הסוכן הישראלי המוביל לכרטיסי ספורט בינלאומיים. אנחנו מציעים כרטיסים רשמיים עם משלוח מהיר ותמיכה מלאה בעברית.</p>
<!-- /wp:paragraph -->

<!-- wp:heading {"level":2} -->
<h2>למה לקנות דרך Ticketeams?</h2>
<!-- /wp:heading -->

<!-- wp:list -->
<ul>
<li>כרטיסים רשמיים בלבד — ללא סיכון</li>
<li>תמיכה מלאה בעברית לפני ואחרי הרכישה</li>
<li>משלוח מהיר לכל כתובת</li>
<li>ניסיון של שנים בהפקת כרטיסים לאירועי ספורט בחו"ל</li>
</ul>
<!-- /wp:list -->

<!-- wp:buttons -->
<div class="wp-block-buttons">
<div class="wp-block-button"><a class="wp-block-button__link" href="${WP_BASE}/shop/?s=${searchQuery}">הזמן כרטיסים עכשיו</a></div>
</div>
<!-- /wp:buttons -->

<!-- wp:heading {"level":2} -->
<h2>שאלות נפוצות</h2>
<!-- /wp:heading -->

<!-- wp:heading {"level":3} -->
<h3>האם הכרטיסים רשמיים?</h3>
<!-- /wp:heading -->

<!-- wp:paragraph -->
<p>כן, כל הכרטיסים שלנו הם רשמיים ומגיעים ישירות מהספקים המורשים.</p>
<!-- /wp:paragraph -->

<!-- wp:heading {"level":3} -->
<h3>איך מקבלים את הכרטיסים?</h3>
<!-- /wp:heading -->

<!-- wp:paragraph -->
<p>הכרטיסים נשלחים במייל כ-e-ticket או בדואר מהיר, בהתאם לסוג האירוע.</p>
<!-- /wp:paragraph -->

<!-- wp:html -->
<script type="application/ld+json">
{
  "@context": "https://schema.org",
  "@type": "SportsEvent",
  "name": "${homeTeam} vs ${awayTeam}",
  "startDate": "${gameDate || ''}",
  "location": {
    "@type": "Place",
    "name": "Stadium"
  },
  "homeTeam": {
    "@type": "SportsTeam",
    "name": "${homeTeam}"
  },
  "awayTeam": {
    "@type": "SportsTeam",
    "name": "${awayTeam}"
  },
  "offers": {
    "@type": "Offer",
    "url": "${WP_BASE}/shop/?s=${searchQuery}",
    "availability": "https://schema.org/InStock"
  }
}
</script>
<!-- /wp:html -->`.trim();

  // POST to WordPress
  try {
    const focusKeyword = `כרטיסים ל${homeTeam} נגד ${awayTeam}`;

    const response = await axios.post(`${WP_REST}/pages`, {
      title,
      content,
      status: config.landingPage.defaultStatus,
      meta: {
        rank_math_title: title,
        rank_math_description: seoDescription,
        rank_math_focus_keyword: focusKeyword,
      },
    }, {
      auth,
      timeout: 15000,
    });

    const result = {
      matchKey,
      type: 'landing_page',
      wpPageId: response.data.id,
      wpUrl: response.data.link,
      title,
      createdAt: new Date().toISOString(),
    };

    // Cache locally
    fs.writeFileSync(cacheFile, JSON.stringify(result, null, 2), 'utf-8');

    return { success: true, pageId: result.wpPageId, url: result.wpUrl, title };
  } catch (error) {
    const msg = error.response?.data?.message || error.message;
    return { success: false, reason: msg };
  }
}

// ============================================================
// Blog Post Generation — Claude AI + WordPress
// ============================================================

const BLOG_SYSTEM_PROMPT = `אתה כותב תוכן SEO בעברית עבור Ticketeams, חברת כרטיסי ספורט.
כתוב מאמר מקצועי, אינפורמטיבי, עם מילות מפתח טבעיות.
הטון: מקצועי אבל נגיש. כותב לקהל ישראלי שמחפש כרטיסים לאירועי ספורט באירופה.
המאמר חייב לכלול: H2 על המשחק, H2 על היריבות, H2 איך לקנות כרטיסים (עם לינק לאתר), H2 מידע למטייל.
מקסימום 800 מילים.

פורמט הפלט: JSON בלבד עם השדות הבאים:
{
  "title": "כותרת המאמר בעברית",
  "content": "תוכן HTML עם תגיות h2, p, ul, li. בלי WordPress block comments.",
  "metaDescription": "תיאור SEO עד 160 תווים",
  "focusKeyword": "מילת מפתח ראשית"
}

חשוב:
- אל תציין מחירים ספציפיים.
- השתמש בשם האתר Ticketeams ובלינק ${WP_BASE}/shop/ לרכישה.
- כתוב בעברית תקינה דקדוקית.
- אל תוסיף טקסט מחוץ ל-JSON.`;

/**
 * Generate an SEO blog post using Claude AI + publish to WordPress.
 *
 * @param {Object} params - { topic?, keywords?, eventData? { homeTeam, awayTeam, competition, gameDate } }
 * @returns {Object} { success, postId?, url?, title?, reason? }
 */
async function generateBlogPost(params) {
  const { topic, keywords, eventData } = params;

  const auth = getWpAuth();
  if (!auth) {
    return { success: false, reason: 'WP_APP_USER/WP_APP_PASSWORD not configured' };
  }

  const homeTeam = eventData?.homeTeam || '';
  const awayTeam = eventData?.awayTeam || '';
  const competition = eventData?.competition || '';
  const gameDate = eventData?.gameDate || '';

  // Build topic from event data if not provided
  const blogTopic = topic || (homeTeam && awayTeam
    ? `כרטיסים ל${homeTeam} נגד ${awayTeam} — ${competition || 'כדורגל בינלאומי'}`
    : 'כרטיסים לאירועי ספורט בחו"ל');

  // Cache check
  const topicKey = blogTopic.replace(/\s+/g, '_').replace(/[^a-zA-Z0-9_\u0590-\u05FF]/g, '').slice(0, 60);
  const cacheFile = path.join(CACHE_DIR, `blog_${topicKey}.json`);

  if (fs.existsSync(cacheFile)) {
    const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
    return { success: true, postId: cached.wpPostId, url: cached.wpUrl, title: cached.title, cached: true };
  }

  // Step 1: Generate content with Claude AI
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { success: false, reason: 'ANTHROPIC_API_KEY not configured' };
  }

  const userPrompt = homeTeam && awayTeam
    ? `כתוב מאמר SEO על המשחק: ${homeTeam} נגד ${awayTeam}, תחרות: ${competition || 'לא צוין'}, תאריך: ${gameDate || 'לא צוין'}. מילות מפתח: ${(keywords || []).join(', ') || blogTopic}`
    : `כתוב מאמר SEO על הנושא: ${blogTopic}. מילות מפתח: ${(keywords || []).join(', ') || blogTopic}`;

  let aiContent;
  try {
    console.log(`[SEO] Generating blog post with Claude: ${blogTopic}`);
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 2000,
        system: BLOG_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: userPrompt }],
      }),
    });

    const data = await response.json();
    if (data.type === 'error') {
      throw new Error(`Claude API error: ${data.error?.message || JSON.stringify(data.error)}`);
    }

    const rawText = data.content?.[0]?.text?.trim();
    if (!rawText) throw new Error('Claude did not return content');

    const jsonMatch = rawText.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Claude did not return valid JSON');

    aiContent = JSON.parse(jsonMatch[0]);
    console.log(`[SEO] Claude generated: "${aiContent.title}"`);
  } catch (error) {
    console.error(`[SEO] Claude generation failed: ${error.message}`);
    return { success: false, reason: `AI generation failed: ${error.message}` };
  }

  // Step 2: Wrap in WordPress block format
  const shopLink = homeTeam
    ? `${WP_BASE}/shop/?s=${encodeURIComponent(homeTeam + ' ' + awayTeam)}`
    : `${WP_BASE}/shop/`;

  const wpContent = `<!-- wp:html -->\n${aiContent.content}\n<!-- /wp:html -->\n\n<!-- wp:buttons -->\n<div class="wp-block-buttons">\n<div class="wp-block-button"><a class="wp-block-button__link" href="${shopLink}">הזמן כרטיסים עכשיו</a></div>\n</div>\n<!-- /wp:buttons -->`;

  // Step 3: POST to WordPress
  try {
    const postData = {
      title: aiContent.title || blogTopic,
      content: wpContent,
      status: config.blogPost.defaultStatus,
      meta: {
        rank_math_title: `${aiContent.title || blogTopic} | Ticketeams`,
        rank_math_description: aiContent.metaDescription || `${blogTopic} — מדריך מלא לרכישת כרטיסים.`,
        rank_math_focus_keyword: aiContent.focusKeyword || (keywords || []).join(', ') || blogTopic,
      },
    };

    if (config.blogPost.categoryId) {
      postData.categories = [config.blogPost.categoryId];
    }

    const wpResponse = await axios.post(`${WP_REST}/posts`, postData, {
      auth,
      timeout: 15000,
    });

    const result = {
      matchKey: topicKey,
      type: 'blog_post',
      wpPostId: wpResponse.data.id,
      wpUrl: wpResponse.data.link,
      title: aiContent.title || blogTopic,
      createdAt: new Date().toISOString(),
      aiGenerated: true,
    };

    fs.writeFileSync(cacheFile, JSON.stringify(result, null, 2), 'utf-8');
    console.log(`[SEO] Blog post created: ID ${result.wpPostId} — ${result.title}`);

    return { success: true, postId: result.wpPostId, url: result.wpUrl, title: result.title };
  } catch (error) {
    const msg = error.response?.data?.message || error.message;
    return { success: false, reason: msg };
  }
}

// ============================================================
// Existing Content (Public — no auth needed)
// ============================================================

/**
 * List existing WordPress pages and posts.
 * Uses public REST API — no authentication required.
 *
 * @returns {Object} { pages, posts, totalPages, totalPosts }
 */
async function getExistingContent() {
  const results = { pages: [], posts: [], totalPages: 0, totalPosts: 0 };

  try {
    const [pagesRes, postsRes] = await Promise.all([
      axios.get(`${WP_REST}/pages`, { params: { per_page: 100 }, timeout: 10000 }).catch(() => ({ data: [] })),
      axios.get(`${WP_REST}/posts`, { params: { per_page: 100 }, timeout: 10000 }).catch(() => ({ data: [] })),
    ]);

    results.pages = (pagesRes.data || []).map(p => ({
      id: p.id,
      title: p.title?.rendered || '',
      slug: p.slug,
      link: p.link,
      status: p.status,
      date: p.date,
    }));

    results.posts = (postsRes.data || []).map(p => ({
      id: p.id,
      title: p.title?.rendered || '',
      slug: p.slug,
      link: p.link,
      status: p.status,
      date: p.date,
    }));

    results.totalPages = results.pages.length;
    results.totalPosts = results.posts.length;
  } catch (error) {
    console.warn('[SEO] getExistingContent error:', error.message);
  }

  return results;
}

// ============================================================
// Sitemap Health
// ============================================================

/**
 * Check sitemap health by fetching sitemap_index.xml.
 *
 * @returns {Object} { totalUrls, sitemaps, robotsTxt }
 */
async function getSitemapHealth() {
  const health = { totalUrls: 0, sitemaps: [], robotsTxt: 'unknown' };

  // Check robots.txt
  try {
    const robotsRes = await axios.get(`${WP_BASE}/robots.txt`, { timeout: 5000 });
    health.robotsTxt = robotsRes.status === 200 ? 'ok' : 'missing';
  } catch {
    health.robotsTxt = 'missing';
  }

  // Fetch sitemap index
  try {
    const sitemapRes = await axios.get(`${WP_BASE}/sitemap_index.xml`, { timeout: 10000 });
    const xml = sitemapRes.data || '';

    // Extract sub-sitemap URLs
    const sitemapMatches = xml.match(/<loc>([^<]+)<\/loc>/g) || [];
    const sitemapUrls = sitemapMatches.map(m => m.replace(/<\/?loc>/g, ''));

    // Fetch each sub-sitemap and count URLs (limit to first 10)
    const subPromises = sitemapUrls.slice(0, 10).map(async (url) => {
      try {
        const subRes = await axios.get(url, { timeout: 8000 });
        const subXml = subRes.data || '';
        const urlCount = (subXml.match(/<url>/g) || []).length;

        // Extract name from URL
        const name = url.split('/').pop() || url;

        // Find lastmod
        const lastmodMatch = subXml.match(/<lastmod>([^<]+)<\/lastmod>/);

        return { name, url, count: urlCount, lastmod: lastmodMatch?.[1] || null };
      } catch {
        const name = url.split('/').pop() || url;
        return { name, url, count: 0, lastmod: null, error: 'fetch failed' };
      }
    });

    health.sitemaps = await Promise.all(subPromises);
    health.totalUrls = health.sitemaps.reduce((sum, s) => sum + s.count, 0);
  } catch (error) {
    console.warn('[SEO] getSitemapHealth error:', error.message);
  }

  return health;
}

// ============================================================
// Local Cache — Created Content
// ============================================================

/**
 * List all SEO content created by this agent (from local cache).
 *
 * @returns {Array} [{ matchKey, type, wpPageId|wpPostId, wpUrl, title, createdAt }]
 */
function listCreatedContent() {
  if (!fs.existsSync(CACHE_DIR)) return [];

  const files = fs.readdirSync(CACHE_DIR).filter(f => f.endsWith('.json'));
  const content = [];

  for (const file of files) {
    try {
      const data = JSON.parse(fs.readFileSync(path.join(CACHE_DIR, file), 'utf-8'));
      content.push(data);
    } catch {
      // skip corrupted files
    }
  }

  // Sort by creation date (newest first)
  content.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));

  return content;
}

// ============================================================
// Self-test
// ============================================================

async function selfTest() {
  console.log('=== SEO Agent — בדיקה עצמית ===\n');

  // 1. Config
  console.log(`[PASS] Config loaded: WP base = ${WP_BASE}`);
  console.log(`[PASS] REST API base = ${WP_REST}`);
  console.log(`[PASS] Cache dir = ${CACHE_DIR}`);

  // 2. WP Auth
  const auth = getWpAuth();
  console.log(`[${auth ? 'PASS' : 'WARN'}] WP Auth: ${auth ? 'configured' : 'NOT configured — page creation will fail gracefully'}`);

  // 3. Sitemap health
  try {
    const health = await getSitemapHealth();
    console.log(`[PASS] Sitemap: ${health.totalUrls} URLs across ${health.sitemaps.length} sitemaps`);
    console.log(`[${health.robotsTxt === 'ok' ? 'PASS' : 'WARN'}] robots.txt: ${health.robotsTxt}`);
  } catch (err) {
    console.log(`[FAIL] Sitemap check: ${err.message}`);
  }

  // 4. Existing content
  try {
    const wp = await getExistingContent();
    console.log(`[PASS] WP Content: ${wp.totalPages} pages, ${wp.totalPosts} posts`);
  } catch (err) {
    console.log(`[FAIL] WP Content check: ${err.message}`);
  }

  // 5. Local cache
  const cached = listCreatedContent();
  console.log(`[PASS] Local cache: ${cached.length} items created by SEO agent`);

  // 6. Landing page test (without auth — should fail gracefully)
  if (!auth) {
    const testResult = await generateLandingPage({
      homeTeam: 'Test FC', awayTeam: 'Demo United',
      competition: 'Test League', gameDate: '2026-05-01',
    });
    console.log(`[PASS] Landing page graceful fail: ${testResult.reason}`);
  }

  console.log('\n=== SEO Agent — מוכן ===');
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  generateLandingPage,
  generateBlogPost,
  getExistingContent,
  getSitemapHealth,
  listCreatedContent,
  selfTest,
};

if (require.main === module) {
  selfTest();
}
