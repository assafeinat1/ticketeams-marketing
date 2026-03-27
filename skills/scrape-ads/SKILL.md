---
name: scrape-ads
description: Scrape all competitor ads from Meta Ad Library via Apify. Reads competitors from Airtable, scrapes their active ads, downloads video ads, transcribes with Whisper, classifies angles/formats, and pushes everything to the Ad Research table with previews. Run manually or on a schedule.
---

# Scrape Competitor Ads — Full Pipeline

You are a competitive ad intelligence system. You scrape every active Meta ad from tracked competitors, download videos, transcribe them, classify the angle and format, and push everything to Airtable.

**What you produce:** A complete database of competitor ads with copy, media, transcripts, hooks, and classifications — ready for creative analysis.

---

## Prerequisites

The user needs:
1. **Airtable PAT** — in `.mcp.json` under an `airtable-*` server, or in `.env` as `AIRTABLE_API_KEY`
2. **Apify token** — in `.mcp.json` under an `apify-*` server, or in `.env` as `APIFY_TOKEN`
3. **Competitors table populated** — at least 1 competitor with a `Facebook Page ID` (run `/competitor-research` first)
4. **whisper.cpp installed** (optional) — for video transcription. Skip this step if not available.
5. **ffmpeg installed** (optional) — for audio extraction from video files

If whisper.cpp or ffmpeg is missing, skip the video transcription step and note it in the summary. The scrape + Airtable push still works without it.

---

## Airtable Config

Read these from the project's CLAUDE.md:
- **Base ID** — the Airtable base containing your Competitors table
- **Competitors table ID** — the table created by `/competitor-research`
- **Ad Research table ID** — will be created if it doesn't exist

**Ad Research table schema:**

| Field | Type | Notes |
|-------|------|-------|
| Ad Archive ID | singleLineText | Unique Meta Ad Library ID (primary dedup key) |
| Page Name | singleLineText | Advertiser name |
| Page ID | singleLineText | Facebook Page ID |
| Competitor | multipleRecordLinks | Links to Competitors table |
| Ad Library URL | url | Direct link to ad |
| Start Date | date | When ad started running |
| End Date | date | When ad stopped (null = still active) |
| Is Active | checkbox | Currently spending |
| Platforms | multipleSelects | Facebook, Instagram, Messenger, Audience Network |
| Display Format | singleSelect | Video / Image / Carousel / DCO |
| Body Text | multilineText | Primary ad copy |
| Title | singleLineText | Headline |
| CTA Text | singleLineText | CTA button label |
| CTA Type | singleLineText | CTA enum |
| Link URL | url | Destination URL |
| Video URL | url | Direct video download URL |
| Image URL | url | Direct image URL |
| Video Duration (sec) | number | Video length |
| Video Aspect Ratio | singleSelect | 9:16 / 4:5 / 1:1 / 16:9 |
| Transcript | multilineText | Full whisper transcription |
| Hook (Video) | multilineText | First sentence(s) of speech |
| Word Count | number | Transcript word count |
| Angle Category | singleSelect | Social Proof, Pain-to-Transformation, Tips/Education, etc. |
| Ad Format Type | singleSelect | UGC Testimonial, Talking Head, Motion Graphics, etc. |
| Scrape Date | date | When this ad was captured |
| Scrape Batch ID | singleLineText | Apify dataset ID for this scrape run |
| Preview | multipleAttachments | Thumbnail image |

If the Ad Research table doesn't exist, create it with these fields. Save all field IDs for later use.

---

## Step 1: Load Credentials

Read credentials from the project's config files:

```python
# Airtable key — check .mcp.json first, then .env
# Apify token — check .mcp.json first, then .env
```

---

## Step 2: Read Active Competitors from Airtable

Fetch all records from the Competitors table where `Status = Active`:

```
GET /v0/{baseId}/{competitorsTableId}
  ?filterByFormula={Status}='Active'
  &fields[]=Name&fields[]=Facebook Page ID
```

Each competitor MUST have a `Facebook Page ID`. Skip any that don't.

Print the competitor list before proceeding.

---

## Step 3: Scrape Each Competitor via Apify

For each competitor, run the Apify Facebook Ads Library scraper:

```bash
curl -s -X POST "https://api.apify.com/v2/acts/curious_coder~facebook-ads-library-scraper/runs?token={APIFY_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "urls": [{"url": "https://www.facebook.com/ads/library/?active_status=active&ad_type=all&country=US&is_targeted_country=false&media_type=all&search_type=page&sort_data[direction]=desc&sort_data[mode]=total_impressions&view_all_page_id={PAGE_ID}"}],
    "maxAds": 50
  }'
```

**This is async.** The response returns a `defaultDatasetId`. Poll for completion:

```bash
# Check run status
GET https://api.apify.com/v2/actor-runs/{runId}?token={APIFY_TOKEN}

# Once status = "SUCCEEDED", fetch results:
GET https://api.apify.com/v2/datasets/{datasetId}/items?token={APIFY_TOKEN}
```

**Run competitors in sequence** (not parallel) to avoid Apify rate limits. Each scrape takes 30-90 seconds.

---

## Step 4: Dedup Against Existing Records

Before inserting, check which ads already exist:

```
GET /v0/{baseId}/{adResearchTableId}
  ?fields[]=Ad Archive ID
```

Build a set of existing `Ad Archive ID` values. Only insert new ads.

**Status tracking for re-scrapes:**
- Ads in Airtable NOT in new scrape → mark `Is Active` = false, set `End Date` to today
- Ads in new scrape already in Airtable → skip
- Ads in new scrape NOT in Airtable → insert as new

---

## Step 5: Transform and Insert New Ads

Transform Apify data into Airtable records:

```python
# Start date — Apify returns unix timestamps
start_date = datetime.utcfromtimestamp(int(start_raw)).date()

# Platforms
platform_map = {
    "facebook": "Facebook", "instagram": "Instagram",
    "messenger": "Messenger", "audience_network": "Audience Network"
}

# Display format
format_map = {"VIDEO": "Video", "IMAGE": "Image", "CAROUSEL": "Carousel", "DCO": "DCO"}

# Video URL — HD first, fallback to SD
# Image URL — original first, fallback to resized
# Preview thumbnail — video_preview_image_url for video, image_url for images
```

Insert in batches of 10 (Airtable limit).

---

## Step 6: Download and Transcribe Video Ads

For each new video ad with a Video URL:

```bash
# 1. Download video
curl -s -L -o /tmp/ad_videos/{safe_name}.mp4 "{video_url}"

# 2. Get metadata via ffprobe (duration, aspect ratio)
# 3. Extract audio: ffmpeg → 16kHz mono WAV
# 4. Transcribe with whisper.cpp
# 5. Extract hook (first 1-2 complete sentences)
```

**Aspect ratio detection:**
- 9:16 (vertical), 4:5, 1:1 (square), 16:9 (landscape)

Update records with: Video Duration, Video Aspect Ratio, Transcript, Hook (Video), Word Count.

Clean up downloaded files after processing.

---

## Step 7: Classify Angle and Format

For every new ad, classify based on content:

### Angle Category

| Angle | Signals |
|-------|---------|
| Social Proof | Testimonials, revenue numbers, case studies, "since we signed up" |
| Pain-to-Transformation | Fees, losing money, switching pain, "save you thousands" |
| Tips/Education | How-to, listicles, "reason number", "watch this" |
| Growth Problem | More orders, scaling, "drive sales", growth language |
| Profit Problem | Costs, margins, wasted spend, "paying too much" |
| Authority | Platform features, "only platform", expert positioning |
| Scarcity/Urgency | Limited time, spots filling, deadline language |
| Behind-the-Scenes | Day-in-the-life, process reveal, "how we" |

### Ad Format Type

| Format | Detection |
|--------|-----------|
| UGC Testimonial | Video with first-person experience story |
| UGC Talking Head | Video with presenter explaining features/benefits |
| Interview/Case Study | Video with Q&A pattern, multiple speakers |
| Motion Graphics | Video with no speech |
| Static Image | Image with real copy |
| Screenshot/UI Demo | Image showing product interface |

Update all records with classifications in batches of 10.

---

## Step 8: Print Summary

```
=== Ad Scrape Complete ===

Competitors scraped: X
Total ads found: X
  New ads added: X
  Already existed: X
  Marked inactive: X

By competitor:
  [Name]: X ads (XV video, XI image, XD DCO)
  ...

Videos transcribed: X
Estimated Apify cost: ~$X.XX
```

---

## Key Lessons

1. **Apify actor `curious_coder~facebook-ads-library-scraper`** is the one that works.
2. **Start dates are unix timestamps** — convert with `datetime.utcfromtimestamp(int(ts))`.
3. **DCO ads have no media URLs.** Body text = `{{product.name}}` means Meta assembles dynamically.
4. **Hook extraction:** Split on sentence boundaries, take first 1-2 complete sentences.
5. **Airtable batch limit is 10 records per request.**
6. **Dedup on Ad Archive ID.** Same ad can appear in multiple scrapes.
7. **Facebook Page ID vs Profile ID:** Use the Ad Library page ID, NOT the profile ID.
