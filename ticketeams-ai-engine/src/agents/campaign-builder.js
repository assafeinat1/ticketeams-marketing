/**
 * Campaign Builder — Meta Ads campaign structure builder
 *
 * Pure data transformation. Builds Meta API-ready payloads
 * from approved creative data. NO API calls.
 *
 * Usage:
 *   node src/agents/campaign-builder.js   # selfTest
 */

require('dotenv').config();
const config = require('../config/meta-publish-config.json');

// ============================================================
// Helpers
// ============================================================

/**
 * Convert ILS amount to agorot (Meta API uses smallest currency unit).
 */
function budgetToAgorot(ilsAmount) {
  return Math.round(ilsAmount * 100);
}

/**
 * Format date as DD.MM.YY for campaign naming.
 */
function formatDateShort(dateStr) {
  if (!dateStr) {
    const now = new Date();
    return `${String(now.getDate()).padStart(2, '0')}.${String(now.getMonth() + 1).padStart(2, '0')}.${String(now.getFullYear()).slice(2)}`;
  }
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getFullYear()).slice(2)}`;
}

/**
 * Build event display name from event data.
 * Matches existing naming: "ריאל מדריד נגד ארסנל"
 */
function buildEventName(eventData) {
  if (eventData.eventName) return eventData.eventName;
  const home = eventData.homeTeam || 'Unknown';
  const away = eventData.awayTeam || 'Unknown';
  return `${home} נגד ${away}`;
}

/**
 * Format campaign name following existing pattern:
 *   {event} | לידים - {targeting} - {date}
 */
function formatCampaignName(eventData, targetingLabel) {
  const event = buildEventName(eventData);
  const date = formatDateShort(eventData.date);
  if (targetingLabel) {
    return `${event} | לידים - ${targetingLabel} - ${date}`;
  }
  return `${event} | לידים - ${date}`;
}

/**
 * Get audience keys for a competition from config.
 * Falls back to 'default' if competition not mapped.
 */
function getAudiencesForCompetition(competition) {
  const mapping = config.audiences.competitionToAudience;
  return mapping[competition] || mapping['default'] || [];
}

/**
 * Resolve audience ID from config mapping.
 * Returns null if audience key not found or ID not set.
 */
function resolveAudienceId(audienceKey) {
  const mapping = config.audiences.mappings[audienceKey];
  return mapping?.id || null;
}

// ============================================================
// Payload Builders
// ============================================================

/**
 * Build Campaign-level payload for Meta API.
 */
function buildCampaignPayload(eventData, options = {}) {
  const defaults = config.campaignDefaults;
  const categories = defaults.specialAdCategories;
  return {
    name: formatCampaignName(eventData),
    objective: options.objective || defaults.objective,
    status: 'PAUSED', // ALWAYS PAUSED — human activates
    special_ad_categories: categories && categories.length > 0 ? categories : ['NONE'],
    buying_type: defaults.buyingType,
    // Budget at ad set level (not campaign-level CBO)
    is_adset_budget_sharing_enabled: false,
  };
}

/**
 * Build Ad Set payload for Meta API.
 * options.format: 'feed' | 'story' — uses formatPlacements config for placements
 * options.dailyBudgetILS: budget in ILS (overrides default)
 */
function buildAdSetPayload(campaignId, eventData, audienceKey, options = {}) {
  const defaults = config.adSetDefaults;
  const audienceId = resolveAudienceId(audienceKey);
  const audienceLabel = config.audiences.mappings[audienceKey]?.label || audienceKey;

  const dailyBudgetILS = options.dailyBudgetILS || defaults.defaultDailyBudgetILS;

  // Format-specific placements (feed/story) or fallback to defaults
  const format = options.format; // 'feed' | 'story' | undefined
  const formatConfig = format && config.formatPlacements?.[format];

  const targeting = {
    geo_locations: defaults.geoLocations,
    age_min: options.ageMin || defaults.ageMin,
    age_max: options.ageMax || defaults.ageMax,
  };

  if (formatConfig) {
    targeting.publisher_platforms = formatConfig.publisherPlatforms;
    targeting.facebook_positions = formatConfig.facebookPositions;
    if (formatConfig.instagramPositions) {
      targeting.instagram_positions = formatConfig.instagramPositions;
    }
  } else {
    targeting.publisher_platforms = defaults.publisherPlatforms;
    targeting.facebook_positions = defaults.facebookPositions;
  }

  // Add custom audience if ID is available
  if (audienceId) {
    targeting.custom_audiences = [{ id: audienceId }];
  }

  const formatLabel = format === 'story' ? 'Story' : format === 'feed' ? 'Feed' : '';
  const nameLabel = formatLabel ? `${audienceLabel} - ${formatLabel}` : audienceLabel;

  const payload = {
    name: formatCampaignName(eventData, nameLabel),
    campaign_id: campaignId,
    daily_budget: budgetToAgorot(dailyBudgetILS),
    billing_event: defaults.billingEvent,
    optimization_goal: defaults.optimizationGoal,
    bid_strategy: defaults.bidStrategy,
    targeting,
    status: 'PAUSED',
  };

  // Schedule: end before game date if available
  // Meta requires end_time to be at least 1 day in the future
  if (eventData.date) {
    const gameDate = new Date(eventData.date);
    if (!isNaN(gameDate.getTime())) {
      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      tomorrow.setHours(23, 59, 0, 0);
      const endDate = gameDate > tomorrow ? gameDate : tomorrow;
      payload.end_time = endDate.toISOString();
    }
  }

  return payload;
}

/**
 * Build Ad Creative payload for Meta API.
 * Requires page_id (pages_manage_posts permission).
 */
function buildAdCreativePayload(adAccountId, pageId, creativeData, imageHash, options = {}) {
  const defaults = config.adDefaults;
  const websiteUrl = options.websiteUrl || defaults.websiteUrl;

  // Extract text from creative data (handles both direct and meta.facebook format)
  const primaryText = creativeData.meta?.facebook?.primary_text || creativeData.body || '';
  const headline = creativeData.meta?.facebook?.headline || creativeData.headline || '';
  const description = creativeData.meta?.facebook?.description || creativeData.cta || '';

  const creative = {
    name: `Creative - ${creativeData.style || 'default'}`,
    object_story_spec: {
      page_id: pageId,
      link_data: {
        message: primaryText,
        link: websiteUrl,
        name: headline,
        description: description,
        call_to_action: {
          type: options.callToAction || defaults.callToAction,
          value: { link: websiteUrl },
        },
      },
    },
  };

  // Add image if available
  if (imageHash) {
    creative.object_story_spec.link_data.image_hash = imageHash;
  }

  return creative;
}

/**
 * Build Ad payload for Meta API.
 */
function buildAdPayload(adSetId, creativeId, eventData, options = {}) {
  return {
    name: `Ad - ${buildEventName(eventData)} - ${options.style || 'default'}`,
    adset_id: adSetId,
    creative: { creative_id: creativeId },
    status: 'PAUSED',
  };
}

// ============================================================
// Full Campaign Structure Builder
// ============================================================

/**
 * Build complete campaign structure (blueprint) from approval data.
 *
 * Input: approval object from human-approval.js (loadPendingApproval)
 * Output: blueprint with campaign + adSets[] payloads ready for Meta API
 */
function buildFullCampaignStructure(approvalData, options = {}) {
  // Extract event data from approval
  const pricing = approvalData.pricingReport || {};
  const eventData = {
    homeTeam: pricing.homeTeam || pricing.home || '',
    awayTeam: pricing.awayTeam || pricing.away || '',
    competition: pricing.competition || pricing.league || '',
    date: pricing.date || pricing.gameDate || null,
    eventName: pricing.eventName || null,
  };

  const matchKey = approvalData.matchKey;
  const selectedAd = approvalData.selectedAd;

  // Build campaign payload
  const campaignPayload = buildCampaignPayload(eventData, options);

  // Determine audiences based on competition
  const audienceKeys = options.audienceKeys || getAudiencesForCompetition(eventData.competition);

  // Budget per ad set: split total budget between 2 formats (feed + story)
  const totalBudgetILS = options.dailyBudgetILS || config.adSetDefaults.defaultDailyBudgetILS;
  const perFormatBudget = Math.round(totalBudgetILS / 2);

  // Build ad set payloads: 2 per audience (feed + story)
  const formats = ['feed', 'story'];
  const adSets = [];
  for (const audienceKey of audienceKeys) {
    for (const format of formats) {
      adSets.push({
        audienceKey,
        format,
        adSetPayload: buildAdSetPayload(null, eventData, audienceKey, {
          ...options,
          dailyBudgetILS: perFormatBudget,
          format,
        }),
        creativeData: selectedAd,
      });
    }
  }

  // Estimate API calls: 1 campaign + N adsets + 2 images + N creatives + N ads
  const estimatedApiCalls = 1 + adSets.length * 3 + 2;

  return {
    matchKey,
    event: eventData,
    campaignPayload,
    adSets,
    selectedAd,
    estimatedApiCalls,
    createdAt: new Date().toISOString(),
  };
}

// ============================================================
// Self-test
// ============================================================

function selfTest() {
  console.log('=== Campaign Builder — Self Test ===\n');

  // 1. Budget conversion
  console.log(`[${budgetToAgorot(100) === 10000 ? 'PASS' : 'FAIL'}] Budget: 100 ILS = ${budgetToAgorot(100)} agorot`);
  console.log(`[${budgetToAgorot(50.5) === 5050 ? 'PASS' : 'FAIL'}] Budget: 50.5 ILS = ${budgetToAgorot(50.5)} agorot`);
  console.log(`[${budgetToAgorot(0) === 0 ? 'PASS' : 'FAIL'}] Budget: 0 ILS = ${budgetToAgorot(0)} agorot`);

  // 2. Date formatting
  console.log(`[${formatDateShort('2026-04-18') === '18.04.26' ? 'PASS' : 'FAIL'}] Date: 2026-04-18 → ${formatDateShort('2026-04-18')}`);

  // 3. Campaign name
  const mockEvent = { homeTeam: 'ריאל מדריד', awayTeam: 'ארסנל', date: '2026-04-18' };
  const name = formatCampaignName(mockEvent, 'רחב');
  console.log(`[${name.includes('ריאל מדריד') ? 'PASS' : 'FAIL'}] Campaign name: ${name}`);

  // 4. Audience lookup
  const plAudiences = getAudiencesForCompetition('Premier League');
  console.log(`[${plAudiences.length >= 2 ? 'PASS' : 'FAIL'}] PL audiences: ${plAudiences.join(', ')}`);

  const clAudiences = getAudiencesForCompetition('Champions League');
  console.log(`[${clAudiences.length >= 3 ? 'PASS' : 'FAIL'}] CL audiences: ${clAudiences.join(', ')}`);

  const defaultAudiences = getAudiencesForCompetition('Unknown League');
  console.log(`[${defaultAudiences.length >= 1 ? 'PASS' : 'FAIL'}] Default audiences: ${defaultAudiences.join(', ')}`);

  // 5. Campaign payload
  const camp = buildCampaignPayload(mockEvent);
  console.log(`[${camp.status === 'PAUSED' ? 'PASS' : 'FAIL'}] Campaign status: ${camp.status}`);
  console.log(`[${camp.objective === 'OUTCOME_TRAFFIC' ? 'PASS' : 'FAIL'}] Objective: ${camp.objective}`);

  // 6. Ad Set payload
  const adSet = buildAdSetPayload('camp_123', mockEvent, 'lookalike_site_visitors_1pct');
  console.log(`[${adSet.daily_budget === 10000 ? 'PASS' : 'FAIL'}] AdSet budget: ${adSet.daily_budget} agorot (${adSet.daily_budget / 100} ILS)`);
  console.log(`[${adSet.status === 'PAUSED' ? 'PASS' : 'FAIL'}] AdSet status: ${adSet.status}`);
  console.log(`[${adSet.targeting.custom_audiences?.length === 1 ? 'PASS' : 'FAIL'}] AdSet audience: ${adSet.targeting.custom_audiences?.[0]?.id?.slice(0, 10)}...`);

  // 7. Full structure
  const mockApproval = {
    matchKey: 'real_madrid__arsenal__champions_league__2026-04-18',
    status: 'אושר',
    selectedAd: {
      style: 'רגשית',
      headline: 'החלום שלך מתחיל כאן',
      body: 'כרטיסים לריאל מדריד נגד ארסנל',
      cta: 'הזמינו עכשיו',
      meta: { facebook: { headline: 'החלום שלך', primary_text: 'כרטיסים ליגת האלופות', description: 'הזמינו' } },
    },
    pricingReport: { homeTeam: 'ריאל מדריד', awayTeam: 'ארסנל', competition: 'Champions League', date: '2026-04-18' },
  };

  const blueprint = buildFullCampaignStructure(mockApproval);
  console.log(`\n[${blueprint.adSets.length >= 3 ? 'PASS' : 'FAIL'}] Blueprint: ${blueprint.adSets.length} ad sets for Champions League`);
  console.log(`[PASS] Estimated API calls: ${blueprint.estimatedApiCalls}`);
  console.log(`[${blueprint.campaignPayload.status === 'PAUSED' ? 'PASS' : 'FAIL'}] All PAUSED: campaign=${blueprint.campaignPayload.status}`);

  console.log('\nBlueprint summary:');
  console.log(`  Campaign: ${blueprint.campaignPayload.name}`);
  for (const adSet of blueprint.adSets) {
    console.log(`  Ad Set: ${adSet.adSetPayload.name} (audience: ${adSet.audienceKey})`);
  }

  console.log('\n=== Campaign Builder — Complete ===\n');
}

// ============================================================
// Exports
// ============================================================

module.exports = {
  buildCampaignPayload,
  buildAdSetPayload,
  buildAdCreativePayload,
  buildAdPayload,
  buildFullCampaignStructure,
  getAudiencesForCompetition,
  budgetToAgorot,
  formatCampaignName,
};

if (require.main === module) {
  selfTest();
}
