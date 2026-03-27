# Ticketeams AI Engine

## מה המערכת עושה
מנוע שיווק אוטומטי. Monday.com → Scout → CMO → Creative → אישור אנושי → Meta.

## מבנה src/agents/
- scout-agent.js — סריקת מחירים (livetickets + arenatickets)
- cmo-agent.js — Golden Rule תמחור
- creative-agent.js — טקסט + פייפליין קריאייטיב (v3)
- gemini-agent.js — Nano Banana רקע אצטדיון
- canva-agent.js — Canva overlay (Claude IDE בלבד)
- image-composer.js — Python PIL (fallback בלבד)
- human-approval.js — שמירה ל-pending-approvals/
- intelligence-agent.js — מעקב מתחרים
- finance-agent.js — רווחיות + תקציב
- meta-publisher.js — פרסום Meta (PAUSED)
- orchestrator.js — מתכלל

## צבעי מותג
ורוד `#E91E8C` | כתום `#FF6B35` | סגול `#7C3AED` | רקע `#0d0d0d`

## חוקי ברזל
1. לוגו Ticketeams — תמיד למעלה מרכז, asset MAHBGt1xTfc. לעולם לא טקסט.
2. לוגואי קבוצות — רק מ-Canva uploads folder FAHDjj15s8A. לעולם לא פלייסהולדר.
3. רקע — Nano Banana מייצר אצטדיון אחד בלבד. לעולם לא שניים.
4. מחירים — אסור לציין מחירים, סכומים, מטבעות בשום פרסומת.
5. שפה — עברית בלבד. אנגלית רק בסוף משפט או בסוגריים.
6. פורמטים — כל קמפיין: Story (1080×1920) + Square (1080×1080).

## פייפליין Creative Agent (v3)
Monday → Scout+CMO → Claude Haiku (3 גרסאות טקסט) → Nano Banana (רקע) → Canva (overlay) → Export → pending-approvals/

### Smart Background
- football/UCL/finals → style='epic'
- concert → style='dramatic'
- UCL כללי → גביע UCL
- מונדיאל → גביע FIFA

## Canva Assets
| Asset | ID |
|---|---|
| לוגו Ticketeams | MAHBGt1xTfc |
| Brand Kit | kAGCrnUW4vo |
| תיקיית לוגואים | FAHDjj15s8A |
| פס גרדיאנט 1 | MAHESyXRa4o |
| פס גרדיאנט 2 | MAHES1eQI4I |
| מסגרת 1 | MAHETAmL2FA |
| מסגרת 2 | MAHETHw_JiI |
| דוגמת story | MAHES4U8oT4 |
| דוגמת post | MAHESzRtA3A |

### לוגואים שהועלו
Newcastle=MAG4qtbbKJ4, Brighton=MAG4qlbbIRk, Crystal Palace=MAG4qpcZiog,
Nottingham Forest=MAG4qmqBbFQ, Aston Villa=MAG4qi8_OPQ, Napoli=MAG7qU1uZj4,
FC Copenhagen=MAG7qQGLHdQ, AS Monaco=MAG7qcM3Jf8

טרם הועלו: Real Madrid, Arsenal, Barcelona, Liverpool, Chelsea, Man City, Man Utd, Inter, Bayern, PSG

### תבניות
London matches=DAGxvuw2e4A (square) | UCL Spain=DAG0ibF3Yb8 (story) | Tickets=DAG9jtkkyBo (post)
**Creative Free base=DAHE-mw2Nao (story 1080x1920)**

### Creative Free Template Elements (DAHE-mw2Nao)
| Element | ID | Purpose |
|---|---|---|
| Background | LBwksjNDm785p0gG | Full bleed, replace per campaign |
| TT Logo | LBDc6XlyVwKRdV60 | Top center, editable |
| CTA text | LB7WQwxFzN8plPty | "קנה כרטיסים עכשיו", Aran-800 |
| Footer text | LBm4S8rWtz9TZZHx | "כרטיסים בלבד, ללא חבילות" |

### Creative Free Pipeline
1. `generate_image` (Imagen 4, 9:16) → cinematic background
2. Upload → temp hosting → `upload-asset-from-url`
3. `resize-design(DAHE-mw2Nao)` → fresh copy
4. `update_fill(LBwksjNDm785p0gG)` → replace background
5. `export-design` → PNG 1080x1920

## Monday.com
מכירות: board 1725685740 | תקציבים: board 5046543095

## .env
MONDAY_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY,
META_AD_ACCOUNT_ID=act_9249..., META_PAGE_ID=117591154764717,
SMTP_USER, SMTP_PASS, INTELLIGENCE_EMAIL_TO=assafeinat1@gmail.com

## סטטוס סוכנים
✅ Scout, CMO, Creative, Human Approval
🟡 Finance, Intelligence, Orchestrator
⏸️ Meta Publisher (ממתין להרשאות)
⚠️ Canva Agent (Claude IDE בלבד)

## גרסה
v3.0 | מרץ 2026

## ⚠️ IRON RULE — Image Generation (never override)

Every image in this project MUST be generated using one of these
3 Nano Banana MCP skills only:

- nano-banana-manager:generate_image() — for any cinematic/creative image
- nano-banana-manager:generate_stadium_background() — for stadium backgrounds only
- nano-banana-manager:edit_image() — for editing existing images

NEVER use:
- gemini-agent.js direct API calls for images
- nano-banana-bridge.py
- Python PIL for image generation
- Any other image generation method

These skills use nano-banana-pro-preview (Imagen) — the highest quality model.
No exceptions. Ever.

## ⚠️ IRON RULE — Logo Selection (applies to ALL creative modes)

Ticketeams has TWO logos in the Canva Brand Kit:
- "לוגו בהיר" (Light Logo) — use on DARK backgrounds
- "לוגו כהה" (Dark Logo) — use on LIGHT backgrounds

The agent MUST analyze the background before placing the logo:
- Stadium at night / dark cinematic image / dark background → use "לוגו בהיר"
- Bright / light / white background → use "לוגו כהה"
- When in doubt → use "לוגו בהיר" (most backgrounds are dark)

This rule applies to:
- Template Mode
- Creative Free Mode
- Any future creative mode

Never place a dark logo on a dark background or a light logo on a light background.
Always retrieve the correct logo from the Canva Brand Kit by name.
