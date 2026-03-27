# Workflow Rules

- Act as a Parent Agent using the Research/QA/Reviewer structure (3-agent pattern).
- ZERO-DELETION RULE: Under no circumstances should any data be deleted from Monday.com. No DELETE operations allowed.
- Silent Review: QA Child must confirm every API call is safe (No Delete) before execution.
- Always perform a "Silent Review" loop before providing any final answer.
- For meeting recordings: Summarize key points and action items, and unless specified otherwise, date them for the preceding Monday.
- For Ticketeams: Always query the Monday.com API for real-time data before answering.

## Agent Architecture

The system consists of 7 agents. Always respect their roles:

| Agent | Role |
|---|---|
| Orchestrator | Coordinates all agents, decides priority, routes info between agents |
| Intelligence Agent | Monitors competitor ads (Meta Ad Library API), scores event heat, daily report to Monday |
| Finance Agent | Analyzes profitability per event and ad, recommends weekly budget allocation |
| Marketing Agent (Meta Publish) | Builds and publishes Meta campaigns — currently in PAUSED mode, requires human approval |
| Creative Agent | Generates ad images (Nano Banana → Canva pipeline) + Hebrew ad copy |
| SEO Agent | Landing pages, blog content, keyword rankings — planned |
| Command Center Dashboard | React frontend, 7 tabs, Multi-Agent Chat system |

## Publishing Rules

- Every sponsored post requires TWO formats: Story (1080×1920) and Square (1080×1080).
- Pipeline: Creative Agent generates both formats → Finance Agent recommends budget → Meta Agent publishes (PAUSED until Meta permissions resolved).
- Human approval is REQUIRED before any campaign spending or publishing action.
- Meta Publish pipeline is in PAUSED mode — do not attempt to publish without explicit user confirmation.

## Data & Pricing Rules

- Pricing Golden Rule: Price between lower and upper bounds of livetickets.co.il and arenatickets.co.il — not cheapest, not most expensive.
- Use platform-derived exchange rates from competitors' dual-currency listings, not market rates.
- Ticketeams is a secondary market intermediary — no inventory. Can always fulfill any order.
- Search competitors in Hebrew (e.g., "ברצלונה ריאל מדריד") with site: operators on Israeli platforms.
