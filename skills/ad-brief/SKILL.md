---
name: ad-brief
description: Generate an Ad Intelligence Brief from scraped competitor ads in Airtable. Produces executive summary, niche-tiered sub-briefs, per-competitor breakdowns, and a strategic playbook with priority ads to create. Requires populated Ad Research table (from /scrape-ads).
---

# Ad Intelligence Brief

You are a creative strategist producing a multi-layered competitive intelligence report from Meta Ad Library data stored in Airtable. Your core thesis: **longevity = profitability** — ads running 30+ days are validated winners because advertisers keep spending on what converts.

**What you produce:** A comprehensive 8-section brief with executive summary, niche-tiered analysis, per-competitor breakdowns, and a priority-ordered strategic playbook — all backed by specific data points and exact hook quotes.

---

## Prerequisites

1. **Airtable PAT** — in project `.mcp.json` under an `airtable-*` server, or in `.env` as `AIRTABLE_API_KEY`
2. **Ad Research table populated** — run `/scrape-ads` first to fill the table with competitor ads
3. **Competitors table** — with linked records, each competitor having a `Category` field
4. **Project CLAUDE.md** — must contain an `Ad Research Config` section (see below)

### Required CLAUDE.md Config

The project's CLAUDE.md must include this block. Read it before doing anything:

```
## Ad Research Config
Brand: [Your Brand Name]

### Niche Tiers
Direct: [competitors that sell the same thing to the same audience]
Adjacent: [competitors in overlapping markets or adjacent audiences]
Aspirational: [large advertisers whose creative playbook is worth studying]
```

If the config block is missing, ask the user to add it before proceeding.

---

## Airtable Schema

Read table IDs and base ID from the project's CLAUDE.md. The Ad Research table was created by `/scrape-ads` with these fields:

| Field | Use In Brief |
|-------|-------------|
| Ad Archive ID | Dedup key |
| Page Name | Competitor name display |
| Competitor | Link to Competitors table |
| Ad Library URL | Reference link |
| Start Date | Longevity calculation |
| Is Active | Active vs killed |
| Display Format | V/I/D breakdown |
| Body Text | Copy analysis, A/B detection, DCO filter |
| Title | Hook quoting (image ads) |
| CTA Text | CTA patterns |
| CTA Type | CTA patterns |
| Hook (Video) | Video hook quoting |
| Word Count | Copy length analysis |
| Video Duration (sec) | Duration analysis |
| Video Aspect Ratio | Format recommendations |
| Angle Category | Angle analysis |
| Ad Format Type | Format analysis |
| Platforms | Platform distribution |

**Skip these fields** (too large for context): Transcript, Video URL, Image URL, Preview

---

## Step 1: Pull Data from Airtable

### 1a. Read project config

Read the project's CLAUDE.md to get:
- Base ID
- Ad Research table ID
- Competitors table ID
- Brand name
- Niche tier groupings (Direct / Adjacent / Aspirational)

### 1b. Fetch all competitor records

```
GET /v0/{baseId}/{competitorsTableId}
  ?fields[]=Name&fields[]=Category&fields[]=Status
  &filterByFormula={Status}='Active'
```

Build a lookup: `record_id -> {name, category}`. Then map each competitor to its niche tier using the CLAUDE.md config.

### 1c. Find the most recent scrape batch

Before pulling all ads, identify the latest scrape to avoid pulling stale data:

```
GET /v0/{baseId}/{adResearchTableId}
  ?pageSize=1
  &fields[]=Scrape Date
  &sort[0][field]=Scrape Date&sort[0][direction]=desc
```

### 1d. Fetch ad records (paginated)

```
GET /v0/{baseId}/{adResearchTableId}
  ?pageSize=100
  &fields[]=Ad Archive ID&fields[]=Page Name&fields[]=Competitor
  &fields[]=Ad Library URL&fields[]=Start Date&fields[]=Is Active
  &fields[]=Display Format&fields[]=Body Text&fields[]=Title
  &fields[]=CTA Text&fields[]=CTA Type&fields[]=Hook (Video)
  &fields[]=Word Count&fields[]=Video Duration (sec)
  &fields[]=Video Aspect Ratio&fields[]=Angle Category
  &fields[]=Ad Format Type&fields[]=Platforms
```

Paginate with cursor until no offset is returned.

### Token budget guide

Body Text is the #1 token consumer (~50K tokens for 500 ads). To stay under budget:
- **Under 500 ads:** Pull all fields as-is
- **500-1000 ads:** Truncate Body Text to first 100 chars
- **1000+ ads:** Filter to most recent scrape batch AND truncate Body Text

### 1e. Enrich each ad record

For every ad:

```python
today = date.today()
days_active = (today - start_date).days

# Longevity tier
if days_active >= 90: tier = "Long-Runner"
elif days_active >= 30: tier = "Performer"
else: tier = "Test"

# DCO filter — exclude dynamic template ads
is_dco = "{{product" in (body_text or "")
```

### 1f. Print data summary before analysis

```
Data loaded:
  Total ads: {N}
  Real creative (non-DCO): {N}
  Competitors: {N}
  Date range: {earliest} to {today}
```

---

## Step 2: Generate the Brief

Write ALL 8 sections. Every claim must reference specific data. Every hook must be an exact quote from the data.

---

### Section 1: Executive Summary

6 numbered findings, each a bold claim backed by data:
1. **Winning format** — which format type + aspect ratio has the most Long-Runners
2. **Winning angle** — highest median longevity; which scales best at 90d+
3. **Copy length** — median longevity of short vs long body text
4. **Video duration** — which bracket has highest Long-Runner rate
5. **Testing patterns** — who's running the most variants and how
6. **Market gaps** — low-adoption angles/formats that signal opportunity

### Section 2: Big Niche — Full Competitive Landscape

- **Who's Spending the Most** — ranked by total ads with V/I/D breakdown
- **Angle x Longevity table** — angle, real ads, median days, 90d+ count, competitors using
- **Format x Longevity table** — format, real ads, median days, 90d+ count
- **The A/B Testing Playbook** — evidence of hook-testing per competitor

### Section 3: Niche Tier — Direct Competitors

- Intro, total ads, **The Story** (blue ocean vs red ocean)
- **What They're Running** — per-competitor with [Angle] [Format] "Hook"
- **Takeaway for [Brand]**

### Section 4: Niche Tier — Adjacent Competitors

- Same as Section 3 plus **What's Working** (top 10 by longevity)
- **Deep Dives** for 2-3 most sophisticated competitors
- **Takeaway for [Brand]**

### Section 5: Niche Tier — Aspirational Competitors

- Same as Section 4 plus full breakdown of largest advertiser
- Top 5 hooks by longevity with exact quotes
- **Takeaway for [Brand]**

### Section 6: Micro Briefs — Per-Competitor Breakdown

For every competitor: total ads, V/I/D, primary angle, primary format, longest-running ad with exact hook quote, what to steal.

### Section 7: Strategic Playbook

- **What to Create First** — 4-5 priority ad briefs with data backing each
- **What to Avoid** — patterns with zero long-runners
- **Meta Ads Testing Framework** — week-by-week cadence

### Section 8: Methodology

Definitions: longevity tiers, kill rate, DCO exclusion, A/B detection, data source.

---

## Niche-Agnostic Design Rules

1. **Read niche tiers from project CLAUDE.md** — map competitors to tiers from config
2. **Discover vocabularies dynamically** — angles, formats, CTAs from the data, never hardcoded
3. **Never hardcode base IDs or table IDs** — always from CLAUDE.md
4. **Brand name** — replace `[Brand]` from config
5. **Handle missing data gracefully** — skip analyses when data is insufficient

---

## After Analysis: Save Report

Save the completed brief to:
```
{project}/research/briefs/ad-brief-{YYYY-MM-DD}.md
```

---

## Output Quality Rules

1. **Every claim needs a number.** Not "Social Proof works" but "Social Proof has median 45d longevity across 141 ads from 6 competitors."
2. **Every hook must be an exact quote** from Airtable data. Never fabricate.
3. **Strategic recommendations must reference data** — specific longevity, competitor counts, gap analysis.
4. **Sort tables by insight metric** (median days, 90d+ count), not alphabetically.
5. **The brief should be immediately actionable** — a creative team should be able to start producing ads from Section 7 today.
