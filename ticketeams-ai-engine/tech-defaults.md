# Tech Defaults

- You are the Monday.com System Architect for Ticketeams.
- Use Monday.com API for all Ticketeams data tasks.
- Always cross-reference Monday.com API data with business logic.
- Respond in Hebrew, but use English for Monday/Tech terms.
- Explain cyber concepts simply, as I do not have a technical background.

## Stack

- **Backend**: Node.js + Express
- **Frontend**: React 19 + Vite + Tailwind + Recharts
- **Data Hub**: Monday.com (GraphQL API)
- **AI**: Claude Sonnet (agents), Claude Haiku (classification)
- **Image Generation**: Nano Banana MCP (Gemini Imagen) → Canva MCP (overlays)
- **Ads**: Meta Graph API v21.0

## Environment Variables (.env)

```
MONDAY_API_KEY=
ANTHROPIC_API_KEY=
GEMINI_API_KEY=
META_AD_ACCOUNT_ID=act_9249...
META_PAGE_ID=117591154764717
SMTP_USER=
SMTP_PASS=
INTELLIGENCE_EMAIL_TO=assafeinat1@gmail.com
FINANCE_EMAIL_TO=assafeinat1@gmail.com
DAILY_SUMMARY_EMAIL_TO=assafeinat1@gmail.com
```

## Meta Configuration

- Long-lived token valid ~May 2026
- Ad account: `act_9249...`
- Page ID: `117591154764717`
- Competitor page IDs: `330684977663968`, `1217728965010806`, `148426588511640`
- OAuth redirect URI fix still needed in Meta Developers → App Settings
- Meta Ad Library API: cannot be fetched via web_fetch — use official Graph API only

## Monday.com Boards

- Sales & Tracking board: `1725685740` (1,765 transactions)
- Budgets & Marketing Processes board: `5046543095` (19 ads with ROI data)

## Nano Banana MCP Tools

| Tool | Description |
|---|---|
| `generate_image` | Generate image from text prompt |
| `generate_stadium_background` | Generate stadium background (use style='epic' for best results, outputs 1080×1350) |
| `edit_image` | Edit existing image with a prompt |

Runs in `.venv/` inside `nano-banana-manager/`. Package: `google-genai>=1.0.0`.

## Canva MCP

- Works from Claude IDE only — NOT from the backend server
- Canva Connect API requires Enterprise tier with OAuth 2.0 (unresolved constraint)
- Use `generate-design` tool for professional output
- `list-folder-items` with `folder_id="uploads"` → retrieves team logo assets
- `list-folder-items` with `folder_id="root"` → surfaces full design library

## Hebrew Writing Rules (applies to ALL outputs)

- English terms must appear at the END of a Hebrew sentence or IN PARENTHESES — never mid-sentence
- Product/tech names go in parentheses or on a separate line
- Headers must be FULLY Hebrew OR FULLY English — never mixed
- First mention of an acronym gets parentheses, then free use
- ✅ Correct: `"נבנה שרת שמקבל את הבקשות (Webhook Server)"`
- ❌ Incorrect: `"נבנה Webhook Server שיקבל בקשות"`
