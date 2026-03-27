/**
 * Meta Publisher — Main Ads Pipeline Orchestrator
 *
 * Takes an approved matchKey, pulls creative data, builds campaign structure,
 * creates it in Meta Ads Manager via the Marketing API (all PAUSED),
 * and notifies via Monday.com + email.
 *
 * RedRok Security Standard:
 * - Credentials loaded via dotenv — NEVER printed to console/logs/output.
 * - All error messages are sanitized (no token leakage).
 * - All campaigns created as PAUSED — human activates.
 *
 * Usage:
 *   node src/agents/meta-publisher.js                    # selfTest
 *   node src/agents/meta-publisher.js --publish <key>    # publish a campaign
 */

require('dotenv').config();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const { metaGet, metaPost, sanitizeError, getAdAccountId, getPageId, getCampaignInsights } = require('./meta-api-client');
const { checkTokenValidity } = require('./token-manager');
const { buildFullCampaignStructure, buildAdCreativePayload, buildAdPayload } = require('./campaign-builder');
const { loadPendingApproval } = require('./human-approval');
const { createItemUpdate, createBoardItem, updateItemColumn } = require('../config/monday');
const publishConfig = require('../config/meta-publish-config.json');
const logger = require('../utils/logger');
const { withRetry } = require('../utils/retry');

// ============================================================
// Config
// ============================================================

const CACHE_DIR = path.join(__dirname, '..', 'cache', 'meta-publish');
const PENDING_DIR = path.join(__dirname, '..', 'pending-approvals');

// Ensure cache directory exists
if (!fs.existsSync(CACHE_DIR)) {
  fs.mkdirSync(CACHE_DIR, { recursive: true });
}

// ============================================================
// Image Upload
// ============================================================

/**
 * Upload an image to Meta Ad Account for use in ad creatives.
 * Accepts a URL (downloads first) or a local file path.
 * Returns { imageHash, url }.
 */
async function uploadAdImage(imageUrl) {
  const adAccountId = getAdAccountId();

  let imageBuffer;
  if (imageUrl.startsWith('http://') || imageUrl.startsWith('https://')) {
    console.log(`[META-PUBLISH] Downloading image from URL...`);
    const response = await axios.get(imageUrl, { responseType: 'arraybuffer', timeout: 30000 });
    imageBuffer = Buffer.from(response.data);
  } else {
    // Local file
    const filePath = path.isAbsolute(imageUrl) ? imageUrl : path.join(__dirname, '..', imageUrl);
    if (!fs.existsSync(filePath)) {
      throw new Error(`Image file not found: ${filePath}`);
    }
    imageBuffer = fs.readFileSync(filePath);
  }

  const base64 = imageBuffer.toString('base64');
  console.log(`[META-PUBLISH] Uploading image (${Math.round(imageBuffer.length / 1024)} KB)...`);

  const result = await metaPost(`/${adAccountId}/adimages`, { bytes: base64 });

  // Meta returns: { images: { bytes: { hash, url } } }
  const imageData = result.images?.bytes;
  if (!imageData?.hash) {
    throw new Error('Image upload succeeded but no hash returned');
  }

  console.log(`[META-PUBLISH] Image uploaded: hash=${imageData.hash.slice(0, 10)}...`);
  return { imageHash: imageData.hash, url: imageData.url || null };
}

// ============================================================
// Campaign Publishing
// ============================================================

/**
 * Publish a full campaign from an approved matchKey.
 *
 * Steps:
 *   1. Check token validity
 *   2. Load approved creative
 *   3. Build campaign blueprint
 *   4. Create Campaign (PAUSED)
 *   5. Create Ad Sets (PAUSED) — one per audience
 *   6. Upload image (if available)
 *   7. Try creating Ad Creatives + Ads (may fail without page permissions)
 *   8. Save campaign log
 *   9. Notify Monday.com + email
 *
 * Returns: { success, matchKey, campaignId, campaignName, adSets[], warnings[], metaDashboardUrl }
 */
async function publishCampaign(matchKey, options = {}) {
  const warnings = [];
  console.log(`\n[META-PUBLISH] === Publishing campaign: ${matchKey} ===\n`);

  // 1. Token check
  const tokenInfo = await checkTokenValidity();
  if (!tokenInfo.valid) {
    throw new Error('Meta access token is invalid or expired. Please refresh the token.');
  }
  console.log(`[META-PUBLISH] Token OK (${tokenInfo.daysRemaining} days remaining)`);

  // 2. Load approval
  const approval = loadPendingApproval(matchKey);
  if (!approval) {
    throw new Error(`No approval found for matchKey: ${matchKey}`);
  }
  if (approval.status !== 'אושר') {
    throw new Error(`Approval status is "${approval.status}" — must be "אושר" to publish`);
  }
  if (!approval.selectedAd) {
    throw new Error('No selected ad version in approval');
  }
  console.log(`[META-PUBLISH] Approval loaded: version ${approval.selectedVersion} (${approval.selectedAd.style})`);

  // 2b. Read Finance Agent budget recommendation
  if (!options.dailyBudgetILS && approval.budgetRecommendation?.recommendedDailyBudget) {
    options = { ...options, dailyBudgetILS: approval.budgetRecommendation.recommendedDailyBudget };
    console.log(`[META-PUBLISH] Budget from Finance Agent: ₪${options.dailyBudgetILS}/day`);
  }

  // 3. Build blueprint
  const blueprint = buildFullCampaignStructure(approval, options);
  console.log(`[META-PUBLISH] Blueprint: ${blueprint.adSets.length} ad sets, ~${blueprint.estimatedApiCalls} API calls`);

  const adAccountId = getAdAccountId();
  const pageId = getPageId();

  // 4. Create Campaign (with retry — Meta API can be flaky)
  const timer = logger.time('meta', 'publishCampaign');
  console.log(`[META-PUBLISH] Creating campaign: ${blueprint.campaignPayload.name}`);
  const campaignResult = await withRetry(
    () => metaPost(`/${adAccountId}/campaigns`, blueprint.campaignPayload),
    { retries: 2, delayMs: 5000, label: 'createCampaign', agent: 'meta' }
  );
  const campaignId = campaignResult.id;
  logger.info('meta', 'createCampaign', `Campaign created: ${campaignId}`, { matchKey, campaignId });

  // 5. Create Ad Sets (2 per audience: feed + story)
  const adSetResults = [];
  for (const adSetConfig of blueprint.adSets) {
    const payload = { ...adSetConfig.adSetPayload, campaign_id: campaignId };
    try {
      console.log(`[META-PUBLISH] Creating ad set: ${payload.name} (${adSetConfig.format || 'default'})`);
      const adSetResult = await withRetry(
        () => metaPost(`/${adAccountId}/adsets`, payload),
        { retries: 2, delayMs: 5000, label: 'createAdSet', agent: 'meta' }
      );
      adSetResults.push({
        adSetId: adSetResult.id,
        audienceKey: adSetConfig.audienceKey,
        format: adSetConfig.format || 'feed',
        name: payload.name,
      });
      logger.info('meta', 'createAdSet', `Ad set created: ${adSetResult.id}`, { format: adSetConfig.format });
    } catch (err) {
      logger.error('meta', 'createAdSet', `Ad set failed (${adSetConfig.audienceKey}/${adSetConfig.format}): ${err.message}`, { matchKey });
      warnings.push(`Ad set "${adSetConfig.audienceKey}/${adSetConfig.format}" failed: ${err.message}`);
    }
  }

  // 6. Upload images — one per format (square for feed, story for story ad sets)
  const imageHashes = { feed: null, story: null }; // keyed by format
  const approvedStyle = approval.selectedAd?.style;
  const styleImages = (approval.images || []).filter(img => img.style === approvedStyle);

  if (options.imageUrl) {
    // Explicit image — use for all formats
    try {
      const uploadResult = await uploadAdImage(options.imageUrl);
      imageHashes.feed = uploadResult.imageHash;
      imageHashes.story = uploadResult.imageHash;
    } catch (err) {
      console.error(`[META-PUBLISH] Image upload failed: ${err.message}`);
      warnings.push(`Image upload failed: ${err.message}`);
    }
  } else if (styleImages.length > 0) {
    // Upload format-specific images from approval
    for (const format of ['square', 'story']) {
      const img = styleImages.find(i => i.format === format);
      if (img?.filePath) {
        try {
          console.log(`[META-PUBLISH] Uploading ${format} image: ${img.style}/${img.format}`);
          const uploadResult = await uploadAdImage(img.filePath);
          const hashKey = format === 'square' ? 'feed' : 'story';
          imageHashes[hashKey] = uploadResult.imageHash;
        } catch (err) {
          console.error(`[META-PUBLISH] ${format} image upload failed: ${err.message}`);
          warnings.push(`${format} image upload failed: ${err.message}`);
        }
      }
    }
    // Fallback: if one format missing, use the other
    if (!imageHashes.feed && imageHashes.story) imageHashes.feed = imageHashes.story;
    if (!imageHashes.story && imageHashes.feed) imageHashes.story = imageHashes.feed;
  } else {
    console.log(`[META-PUBLISH] No images available — skipping upload`);
  }

  // 7. Create Ad Creatives + Ads (requires page permissions)
  if (pageId && publishConfig.featureFlags.pagePostPublish) {
    for (const adSetInfo of adSetResults) {
      try {
        const formatImageHash = imageHashes[adSetInfo.format] || imageHashes.feed || imageHashes.story;
        const creativePayload = buildAdCreativePayload(adAccountId, pageId, blueprint.selectedAd, formatImageHash, options);
        const creativeResult = await metaPost(`/${adAccountId}/adcreatives`, creativePayload);

        const adPayload = buildAdPayload(adSetInfo.adSetId, creativeResult.id, blueprint.event, {
          style: blueprint.selectedAd.style,
        });
        const adResult = await metaPost(`/${adAccountId}/ads`, adPayload);

        adSetInfo.creativeId = creativeResult.id;
        adSetInfo.adId = adResult.id;
        console.log(`[META-PUBLISH] Ad created: ${adResult.id} (creative: ${creativeResult.id}, format: ${adSetInfo.format})`);
      } catch (err) {
        console.error(`[META-PUBLISH] Ad creative/ad failed: ${err.message}`);
        warnings.push(`Ad creative failed for "${adSetInfo.audienceKey}/${adSetInfo.format}": ${err.message}`);
      }
    }
  } else {
    const reason = !pageId ? 'META_PAGE_ID not set' : 'pagePostPublish feature flag is off';
    warnings.push(`Ad creative/ad creation skipped — ${reason}. Campaign + Ad Sets created. Enable page permissions to create full ads.`);
    console.log(`[META-PUBLISH] Skipping ad creatives: ${reason}`);
  }

  // Build dashboard URL
  const accountNum = adAccountId.replace('act_', '');
  const metaDashboardUrl = `https://business.facebook.com/adsmanager/manage/campaigns?act=${accountNum}&campaign_ids=${campaignId}`;

  // 8. Build result
  const publishResult = {
    success: true,
    partialSuccess: warnings.length > 0,
    matchKey,
    campaignId,
    campaignName: blueprint.campaignPayload.name,
    adSets: adSetResults,
    imageHashes,
    status: 'PAUSED',
    metaDashboardUrl,
    warnings,
    createdAt: new Date().toISOString(),
  };

  // 9. Save campaign log
  saveCampaignLog(matchKey, publishResult);

  // 10. Update approval file
  updateApprovalWithCampaign(matchKey, publishResult);

  // 11. Notify Monday.com
  if (publishConfig.featureFlags.sendMondayNotification) {
    await notifyMonday(publishResult, approval).catch((err) => {
      console.error(`[META-PUBLISH] Monday notification failed: ${err.message}`);
      warnings.push(`Monday.com notification failed: ${err.message}`);
    });
  }

  // 12. Sync to Marketing Board (create campaign item)
  await syncToMarketingBoard(publishResult, approval).catch((err) => {
    console.error(`[META-PUBLISH] Marketing Board sync failed: ${err.message}`);
    warnings.push(`Marketing Board sync failed: ${err.message}`);
  });

  timer.done(`Campaign published: ${campaignId} (${adSetResults.length} ad sets, ${warnings.length} warnings)`, { matchKey, campaignId, adSets: adSetResults.length });
  return publishResult;
}

// ============================================================
// Campaign Status
// ============================================================

async function getCampaignStatus(campaignId) {
  return metaGet(`/${campaignId}`, {
    fields: 'name,status,effective_status,daily_budget,lifetime_budget,objective',
  });
}

async function pauseCampaign(campaignId) {
  console.log(`[META-PUBLISH] Pausing campaign: ${campaignId}`);
  return metaPost(`/${campaignId}`, { status: 'PAUSED' });
}

// ============================================================
// Campaign Performance (Insights)
// ============================================================

/**
 * Fetch campaign status + performance insights from Meta API.
 * Only fetches insights for ACTIVE campaigns (no data for PAUSED).
 *
 * @param {string} campaignId - Meta campaign ID
 * @returns {{ name, status, effective_status, insights: { impressions, clicks, ctr, spend, leads } | null }}
 */
async function fetchCampaignPerformance(campaignId) {
  const status = await getCampaignStatus(campaignId);
  let insights = null;

  if (status.effective_status === 'ACTIVE') {
    try {
      const raw = await getCampaignInsights(campaignId);
      if (raw.data && raw.data.length > 0) {
        const d = raw.data[0];
        const leads = (d.actions || []).find(a => a.action_type === 'lead')?.value || 0;
        insights = {
          impressions: parseInt(d.impressions || 0),
          clicks: parseInt(d.clicks || 0),
          ctr: parseFloat(d.ctr || 0),
          spend: parseFloat(d.spend || 0),
          leads: parseInt(leads),
        };
      }
    } catch (err) {
      console.warn(`[META-PUBLISH] Insights fetch failed for ${campaignId}: ${err.message}`);
    }
  }

  return { ...status, insights };
}

// ============================================================
// Campaign Log
// ============================================================

function saveCampaignLog(matchKey, publishResult) {
  const sanitizedKey = matchKey.replace(/[^a-zA-Z0-9._-]/g, '_');
  const filePath = path.join(CACHE_DIR, `${sanitizedKey}.json`);
  fs.writeFileSync(filePath, JSON.stringify(publishResult, null, 2), 'utf-8');
  console.log(`[META-PUBLISH] Campaign log saved: ${filePath}`);
}

function listPublishedCampaigns() {
  if (!fs.existsSync(CACHE_DIR)) return [];

  return fs.readdirSync(CACHE_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((file) => {
      try {
        const raw = fs.readFileSync(path.join(CACHE_DIR, file), 'utf-8');
        const data = JSON.parse(raw);
        return {
          matchKey: data.matchKey,
          campaignId: data.campaignId,
          campaignName: data.campaignName,
          status: data.status,
          adSets: data.adSets?.length || 0,
          warnings: data.warnings?.length || 0,
          createdAt: data.createdAt,
          metaDashboardUrl: data.metaDashboardUrl,
        };
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

// ============================================================
// Approval File Update
// ============================================================

function updateApprovalWithCampaign(matchKey, publishResult) {
  const sanitizedKey = matchKey.replace(/[^a-zA-Z0-9._-]/g, '_');
  const filePath = path.join(PENDING_DIR, `${sanitizedKey}.json`);

  if (!fs.existsSync(filePath)) return;

  try {
    const approval = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
    approval.publishedAt = publishResult.createdAt;
    approval.campaignId = publishResult.campaignId;
    approval.metaDashboardUrl = publishResult.metaDashboardUrl;
    approval.status = 'פורסם';
    fs.writeFileSync(filePath, JSON.stringify(approval, null, 2), 'utf-8');
    console.log(`[META-PUBLISH] Approval updated: ${matchKey} → פורסם`);
  } catch (err) {
    console.error(`[META-PUBLISH] Failed to update approval file: ${err.message}`);
  }
}

// ============================================================
// Monday.com — Marketing Board Sync
// ============================================================

const MARKETING_BOARD_ID = 5046543095;
const MARKETING_GROUP_ID = 'group_mkwsvmvh'; // משימות שיווק

// Monday.com status label mapping (Hebrew labels from the board)
const STATUS_MAP = {
  PAUSED: 'מחכה לעלות',
  ACTIVE: 'באוויר',
  ARCHIVED: 'נגמרה',
  DELETED: 'נגמרה',
};

/**
 * Create/update a campaign item on the Marketing Board in Monday.com.
 * Board: "תקציבים + תהליכי שיווק" (5046543095)
 * Group: "משימות שיווק"
 */
async function syncToMarketingBoard(publishResult, approvalData) {
  try {
    const dailyBudget = approvalData?.budgetRecommendation?.recommendedDailyBudget || 100;
    const creationDate = new Date().toISOString().split('T')[0];
    const statusLabel = STATUS_MAP[publishResult.status] || STATUS_MAP.PAUSED;

    const columnValues = {
      status: { label: statusLabel },
      date4: { date: creationDate },
      text_mm11mdg3: `Campaign ID: ${publishResult.campaignId}\n${publishResult.metaDashboardUrl}`,
      text_mkz51pxh: `₪${dailyBudget}/day`,
    };

    const itemName = publishResult.campaignName || publishResult.matchKey;
    const item = await createBoardItem(MARKETING_BOARD_ID, MARKETING_GROUP_ID, itemName, columnValues);

    logger.info('meta', 'syncMonday', `Marketing Board item created: ${item.id} — ${itemName}`);

    // Save Monday item ID in campaign cache for future status updates
    const sanitizedKey = publishResult.matchKey.replace(/[^a-zA-Z0-9._-]/g, '_');
    const cacheFile = path.join(CACHE_DIR, `${sanitizedKey}.json`);
    if (fs.existsSync(cacheFile)) {
      const cached = JSON.parse(fs.readFileSync(cacheFile, 'utf-8'));
      cached.mondayItemId = item.id;
      cached.mondayBoardId = MARKETING_BOARD_ID;
      fs.writeFileSync(cacheFile, JSON.stringify(cached, null, 2), 'utf-8');
    }

    return { success: true, mondayItemId: item.id };
  } catch (err) {
    logger.warn('meta', 'syncMonday', `Marketing Board sync failed: ${err.message}`);
    return { success: false, error: err.message };
  }
}

/**
 * Update an existing Marketing Board item with campaign status/performance data.
 */
async function updateMarketingBoardStatus(mondayItemId, updates) {
  try {
    const columnValues = {};
    if (updates.status) columnValues.status = { label: STATUS_MAP[updates.status] || updates.status };
    if (updates.offAirDate) columnValues.date_mkwstm5q = { date: updates.offAirDate };
    if (updates.roiMeta) columnValues.numeric_mkz5ynne = String(updates.roiMeta);
    if (updates.revenue) columnValues.numeric_mkws5s91 = String(updates.revenue);

    await updateItemColumn(MARKETING_BOARD_ID, mondayItemId, columnValues);
    logger.info('meta', 'updateMonday', `Marketing Board item ${mondayItemId} updated`);
    return { success: true };
  } catch (err) {
    logger.warn('meta', 'updateMonday', `Marketing Board update failed: ${err.message}`);
    return { success: false, error: err.message };
  }
}

// ============================================================
// Monday.com Notification
// ============================================================

async function notifyMonday(publishResult, approvalData) {
  const boardId = process.env.MONDAY_BOARD_ID;
  if (!boardId) {
    console.warn('[META-PUBLISH] MONDAY_BOARD_ID not set — skipping Monday notification');
    return;
  }

  const body = [
    `🎯 קמפיין Meta Ads נוצר בהצלחה!`,
    ``,
    `📋 שם: ${publishResult.campaignName}`,
    `📊 סטטוס: PAUSED (ממתין להפעלה ידנית)`,
    `📦 Ad Sets: ${publishResult.adSets.length}`,
    (publishResult.imageHashes?.feed || publishResult.imageHashes?.story) ? `🖼️ תמונות: הועלו` : `🖼️ תמונות: לא הועלו`,
    ``,
    `🔗 Meta Ads Manager:`,
    publishResult.metaDashboardUrl,
    ``,
    publishResult.warnings.length > 0 ? `⚠️ ${publishResult.warnings.length} אזהרות:\n${publishResult.warnings.join('\n')}` : '✅ ללא אזהרות',
  ].join('\n');

  try {
    // Find the item by matchKey or create an update on the board
    // Using createItemUpdate which posts to the board's updates
    await createItemUpdate(boardId, body);
    console.log(`[META-PUBLISH] Monday.com notification sent`);
  } catch (err) {
    console.error(`[META-PUBLISH] Monday notification error: ${err.message}`);
  }
}

// ============================================================
// Self-test
// ============================================================

async function selfTest() {
  console.log('=== Meta Publisher — Self Test ===\n');

  // 1. Import checks
  console.log('[PASS] All imports loaded');

  // 2. Token
  try {
    const token = await checkTokenValidity();
    console.log(`[${token.valid ? 'PASS' : 'FAIL'}] Token: ${token.valid ? 'valid' : 'INVALID'} (${token.daysRemaining} days)`);
  } catch (err) {
    console.log(`[FAIL] Token check: ${err.message}`);
  }

  // 3. Ad account
  try {
    const accountId = getAdAccountId();
    console.log(`[PASS] Ad Account: ${accountId.slice(0, 8)}...`);
  } catch (err) {
    console.log(`[FAIL] Ad Account: ${err.message}`);
  }

  // 4. Page ID
  const pageId = getPageId();
  console.log(`[${pageId ? 'PASS' : 'WARN'}] Page ID: ${pageId ? pageId.slice(0, 5) + '...' : '(not set)'}`);

  // 5. Feature flags
  console.log('\nFeature Flags:');
  for (const [flag, value] of Object.entries(publishConfig.featureFlags)) {
    console.log(`  ${flag}: ${value ? 'ON' : 'OFF'}`);
  }

  // 6. Blueprint build (no API)
  const mockApproval = {
    matchKey: 'test__selftest__meta_publisher',
    status: 'אושר',
    selectedAd: {
      style: 'רגשית',
      headline: 'test headline',
      body: 'test body',
      cta: 'test CTA',
      meta: { facebook: { headline: 'test', primary_text: 'test', description: 'test' } },
    },
    pricingReport: { homeTeam: 'Arsenal', awayTeam: 'Chelsea', competition: 'Premier League', date: '2026-04-05' },
  };

  const blueprint = buildFullCampaignStructure(mockApproval);
  console.log(`\n[PASS] Blueprint: ${blueprint.adSets.length} ad sets, ~${blueprint.estimatedApiCalls} API calls`);
  console.log(`[${blueprint.campaignPayload.status === 'PAUSED' ? 'PASS' : 'FAIL'}] All PAUSED`);

  // 7. Cache directory
  console.log(`\n[PASS] Campaign log dir: ${CACHE_DIR}`);
  const published = listPublishedCampaigns();
  console.log(`[PASS] Published campaigns: ${published.length}`);

  // 8. Pending approvals
  const pendingDir = PENDING_DIR;
  const pendingCount = fs.existsSync(pendingDir)
    ? fs.readdirSync(pendingDir).filter((f) => f.endsWith('.json')).length
    : 0;
  console.log(`[PASS] Pending approvals: ${pendingCount}`);

  console.log('\n=== Meta Publisher — Complete ===\n');
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  publishCampaign,
  uploadAdImage,
  getCampaignStatus,
  fetchCampaignPerformance,
  pauseCampaign,
  listPublishedCampaigns,
  syncToMarketingBoard,
  updateMarketingBoardStatus,
};

if (require.main === module) {
  if (process.argv.includes('--publish') && process.argv[3]) {
    publishCampaign(process.argv[3])
      .then((result) => console.log('Result:', JSON.stringify(result, null, 2)))
      .catch((err) => console.error('Error:', err.message));
  } else {
    selfTest();
  }
}
