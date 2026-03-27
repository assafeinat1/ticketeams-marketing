# /ad-brief

## What It Does

This skill generates a comprehensive Ad Intelligence Brief from the competitor ads you've scraped. It reads your Ad Research table in Airtable, analyzes every ad by longevity, angle, format, and copy — then produces an 8-section report with an executive summary, niche-tiered breakdowns, per-competitor analysis, and a strategic playbook with priority ads to create.

The core thesis: **longevity = profitability**. Ads running 90+ days are almost certainly profitable. This skill finds those ads and reverse-engineers what makes them work.

---

## When to Use It

- After `/scrape-ads` has populated your Ad Research table
- Before scripting new ads — know what's already winning
- During client strategy sessions to present competitive intelligence
- Monthly refresh to track competitive shifts

---

## How to Run It

```
/ad-brief
```

Claude handles everything automatically:

1. Reads your CLAUDE.md for niche tier definitions (Direct / Adjacent / Aspirational)
2. Pulls competitor records and ad data from Airtable
3. Enriches records with longevity tiers (90d+ proven, 30d+ testing, <30d new)
4. Generates 8 sections: executive summary, landscape overview, per-tier breakdowns, per-competitor micro briefs, strategic playbook, methodology
5. Saves to `research/briefs/`

---

## Example Output

```
# Ad Intelligence Brief — Sports Training (Dallas, TX)
## Generated: March 5, 2026

### Executive Summary
Analyzed 142 ads across 12 competitors. 23 ads running 90+ days
(proven profitable). Dominant winning pattern: UGC testimonial
with transformation angle. Biggest gap: no competitor using
AI-powered targeting messaging.

### Longevity Analysis
| Tier | Count | % | Insight |
|------|-------|---|---------|
| 90+ days (Proven) | 23 | 16% | Study these first |
| 30-89 days (Testing) | 45 | 32% | Worth monitoring |
| < 30 days (New) | 74 | 52% | Experimental |

### Top Performing Ads (90+ days)
1. D1 Training — "My son went from benchwarmer to starter"
   - Angle: Transformation | Format: UGC Testimonial
   - Running: 147 days | Hook: Parent testimony
   - Why it works: Emotional proof, specific result

2. EXOS — "What 3 months of speed training looks like"
   - Angle: Transformation | Format: B-Roll Montage
   - Running: 112 days | Hook: Time-lapse result
   - Why it works: Visual proof, aspirational

### Strategic Playbook
Priority ads to create (ranked):
1. Parent testimonial UGC (proven format, no local competitor doing it well)
2. Before/after training montage (high-performing across all tiers)
3. Free trial session offer (urgency + value stack, tested by 3 competitors)
```

---

## The Longevity Framework

| Tier | Days Running | What It Means |
|------|-------------|--------------|
| **Proven** | 90+ days | Almost certainly profitable — study hard |
| **Testing** | 30-89 days | Showing promise, worth monitoring |
| **New** | < 30 days | Too early to tell — don't copy blindly |

---

## Requirements

- **Claude Code** — installed and running
- **Airtable MCP** — for reading Ad Research data (included in Premium toolkit)

---

## Configure Your CLAUDE.md

```markdown
## Niche Tiers
- Direct: [competitors in your exact space]
- Adjacent: [competitors in related spaces]
- Aspirational: [industry leaders to learn from]
```

---

## Download

This skill is included in the Premium toolkit. After running the installer, the file lives at:

```
~/.claude/skills/ad-brief/SKILL.md
```

If you haven't downloaded the toolkit yet, head to **#Start Here** and complete the **Download ALL Resources** lesson.

---

## Part of the Ad System

```
/competitor-research → /scrape-ads → /ad-brief → /script-ads → /launch-ads
```

- **`/scrape-ads`** — collects the raw ad data
- **`/ad-brief`** — analyzes it into actionable intelligence
- **`/script-ads`** — writes scripts based on the brief's recommendations

---

## Troubleshooting

**"No ads found in Ad Research table"**
Run `/scrape-ads` first to populate the table.

**"Longevity data seems wrong"**
Longevity is calculated from the ad's `delivery_start_time` field. If Apify didn't capture this, the skill estimates based on first-seen date.

---

## Changelog

- **v1.0** — 8-section intelligence brief, longevity-based analysis, niche tier breakdowns, per-competitor micro briefs, strategic playbook with priority rankings.
