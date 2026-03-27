# /scrape-ads

## What It Does

This skill scrapes every active competitor ad from Meta Ad Library using Apify. It reads your competitors from Airtable, scrapes their ads, downloads video creatives, transcribes them with Whisper, classifies each ad by angle and format, and pushes everything to an Ad Research table in Airtable.

You end up with a complete database of competitor ads — copy, media, hooks, transcripts, video previews, and classifications — all searchable and sortable in Airtable.

---

## When to Use It

- After `/competitor-research` has built your competitor database
- Weekly or bi-weekly to catch new competitor ads
- Before running `/ad-brief` to generate an intelligence report
- When a competitor launches a new campaign and you want to study it

---

## How to Run It

```
/scrape-ads
```

Claude handles everything automatically:

1. Loads credentials (Airtable, Apify)
2. Reads active competitors from your Airtable Competitors table
3. Scrapes each competitor's ads via Apify Facebook Ads Library Scraper
4. Deduplicates against existing Ad Research records
5. Transforms and inserts new ads into Airtable
6. Downloads video ads and transcribes with Whisper
7. Classifies each ad by angle and format
8. Prints summary with counts per competitor

---

## Example Output

```
Ad Scrape Complete

| Competitor | Ads Found | New | Videos | Transcribed |
|-----------|----------|-----|--------|-------------|
| D1 Training | 24 | 18 | 12 | 12 |
| EXOS | 31 | 31 | 8 | 8 |
| Athlete's Arena | 8 | 8 | 5 | 5 |

Total: 63 ads scraped, 57 new (6 duplicates skipped)
Videos: 25 downloaded, 25 transcribed
Classifications: 57 angle + format tags applied

All saved to Airtable "Ad Research" table.
```

---

## Ad Classification System

Every ad gets tagged with an angle and format:

**Angles:**
| Angle | Description |
|-------|-------------|
| Social Proof | Testimonials, reviews, results |
| Pain Point | Highlighting the problem |
| Transformation | Before/after results |
| Authority | Expert positioning |
| Urgency | Limited time, scarcity |
| Value Stack | Listing everything you get |

**Formats:**
| Format | Description |
|--------|-------------|
| UGC Talking Head | Person speaking to camera |
| B-Roll Montage | Lifestyle/action footage |
| Screen Recording | Software/app demo |
| Static Image | Single image ad |
| Carousel | Multiple images/slides |
| Text Overlay | Heavy text-based creative |

---

## Requirements

- **Claude Code** — installed and running
- **Apify MCP** — for Facebook Ads Library Scraper (included in Premium toolkit)
- **Airtable MCP** — for reading competitors and storing ads (included in Premium toolkit)
- **Whisper** — for video transcription (`pip install openai-whisper`)

---

## Configure Your CLAUDE.md

```markdown
## Ad Research
Airtable base: appXXXXXXXXXXXX
Competitors table: tblXXXXXXXXXXXX
Ad Research table: tblXXXXXXXXXXXX
```

---

## Download

This skill is included in the Premium toolkit. After running the installer, the file lives at:

```
~/.claude/skills/scrape-ads/SKILL.md
```

If you haven't downloaded the toolkit yet, head to **#Start Here** and complete the **Download ALL Resources** lesson.

---

## Part of the Ad System

```
/competitor-research → /scrape-ads → /ad-brief → /script-ads → /launch-ads
```

- **`/competitor-research`** — builds competitor database
- **`/scrape-ads`** — scrapes all their active ads
- **`/ad-brief`** — generates intelligence report from scraped ads

---

## Troubleshooting

**"No competitors found in Airtable"**
Run `/competitor-research` first to populate the Competitors table.

**"Apify scraper returned 0 ads"**
The competitor might not have active ads, or the Ad Library ID might be wrong. Check the Ad Library URL manually.

**"Video download failed"**
Some Meta ad videos are protected. The skill logs failures and continues with the rest.

**"Whisper transcription errors"**
Usually caused by very short ads (< 5 seconds) or ads with no speech. These get skipped automatically.

---

## Changelog

- **v1.0** — Full Apify scraping pipeline, deduplication, video download + Whisper transcription, angle/format classification, Airtable integration.
