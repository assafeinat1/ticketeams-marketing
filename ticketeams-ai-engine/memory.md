# זיכרון הפרויקט — Ticketeams AI Engine

## החלטות שקיבלנו
- סריקת מתחרים — מטמון שבועי (7 ימים) לחסכון בטוקנים
- זיהוי משחק = קבוצת בית + קבוצת חוץ + תחרות + תאריך
- סריקה רק לפי לינקים מ-venues.json — לא חיפוש עצמאי
- 16 קבוצות פעילות ב-5 ליגות
- Board 1725685740 = קריאה בלבד (מכירות ומעקבים)
- אישור מודעות = באפליקציה נפרדת (לא במנדי)
- מודעות ממתינות נשמרות ב-src/pending-approvals/

## מה עובד
- חיבור למנדי — תקין
- venues.json — 16 קבוצות מוגדרות
- scout-agent.js — פירסור HTML מלא (livetickets + arenatickets) ✅
- webhook-server.js מחובר לסוכן הסריקה ✅
- זרימה מלאה: מנדי → webhook → scout → מטמון ✅
- חוקי מטבע לפי ליגה ✅
- cmo-agent.js עובד ✅
- Golden Rule: LiveTickets × 0.90 = מחיר Ticketeams
- ArenaTickets = לעיון ואימות קטגוריות בלבד
- זרימה מלאה: מנדי → webhook → scout → cmo ✅
- זרימה מלאה מקצה לקצה ✅
  מנדי → webhook → scout → cmo → לוג
- creative-agent.js מוכן ✅ (ממתין לבדיקה חיה עם Gemini)
- human-approval.js ✅ — שומר JSON לאישור באפליקציה
- זרימה מלאה מקצה לקצה ✅
  מנדי → webhook → scout → cmo → creative → saveForApproval → JSON

## הצעד הבא
- בניית אפליקציית Command Center
- מציגה מודעות ממתינות לאישור
- לחיצת כפתור = אישור ופרסום למטא

## מבנה הפרויקט
ticketeams-ai-engine/
├── CLAUDE.md
├── memory.md
├── workflow.md
├── design-rules.md
├── tech-defaults.md
└── src/
    ├── webhook-server.js ← מחובר ל-scout + cmo + creative + approval
    ├── agents/scout-agent.js
    ├── agents/cmo-agent.js
    ├── agents/creative-agent.js
    ├── agents/human-approval.js
    ├── config/venues.json, monday.js
    ├── pending-approvals/ ← קבצי JSON ממתינים לאישור
    └── index.js
