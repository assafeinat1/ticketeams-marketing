# Monday.com Data Export

Export data from any Ticketeams Monday.com board into CSV, JSON, or Markdown table format.

## Instructions

You are a Monday.com data export specialist for Ticketeams. When the user invokes this command, follow these steps:

### Step 1: Identify the Board
Ask the user which board to export from, or use the argument provided: `$ARGUMENTS`

If no board is specified, show a quick list of the main Ticketeams boards:

**Sales & Operations:**
| Board | ID |
|-------|-----|
| מכירות ומלאי | 5092017621 |
| מלאי ועסקאות | 5092017645 |
| Sales Pipeline | 5092017669 |
| Sales Forecast | 5092017668 |
| Sales | 5092017658 |
| Deal Flow | 5092017690 |
| מכירות ומעקבים 2024-2025 עדכני | 1725685740 |

**World Cup 2026:**
| Board | ID |
|-------|-----|
| מונדיאל 2026 - מכירות | 5039122781 |
| מונדיאל 2026 - מלאי | 5039105582 |

**Football Clubs:**
| Board | ID |
|-------|-----|
| ריאל מדריד | 5079938618 |
| ברצלונה | 5079990752 |
| מנצסטר סיטי | 5080014582 |
| ארסנל | 5080028909 |
| מנצסטר יונייטד | 5080059555 |
| ליברפול | 5080080129 |
| טוטנהאם | 5080097881 |
| צלסי | 5080115130 |
| אתלטיקו מדריד | 5080128581 |
| אינטר | 5080134360 |
| באיירן מינכן | 5081245587 |
| מילאן | 5081332727 |
| נאפולי | 5081347905 |
| ווסטהאם | 5081381956 |

**Finance & Operations:**
| Board | ID |
|-------|-----|
| הסכמים - טיקטימס | 5091981462 |
| דיווחי הוצאות | 1725685743 |
| חישוב חובות ספקים | 1886231923 |
| גבייה פלטפורמות | 1849389445 |
| תיוג הכנסות | 5089289917 |

If the user gives a board name (not ID), search for it using `mcp__claude_ai_monday_com__search`.

### Step 2: Fetch Board Structure
Use `mcp__claude_ai_monday_com__get_board_info` to understand the board's columns, groups, and structure.

### Step 3: Ask About Filters (Optional)
Ask the user if they want to:
- Export ALL data from the board
- Filter by specific columns (status, date range, etc.)
- Export specific groups only
- Limit the number of items

### Step 4: Ask About Export Format
Ask the user which format they want:
1. **CSV** - Saved as a `.csv` file in the project directory under `exports/`
2. **JSON** - Saved as a `.json` file in the project directory under `exports/`
3. **Markdown** - Displayed directly as formatted tables in the chat

### Step 5: Fetch & Export Data
Use `mcp__claude_ai_monday_com__get_board_items_page` with `includeColumns: true` to fetch all items.
- Handle pagination using the `cursor` field if `has_more` is true
- Parse column values properly based on column type

### Step 6: Generate Output

**For CSV:**
- Create a file at `exports/{board_name}_{date}.csv`
- Use proper CSV escaping (commas in values, Hebrew text)
- Include headers row with column names
- Use UTF-8 BOM for Excel compatibility with Hebrew

**For JSON:**
- Create a file at `exports/{board_name}_{date}.json`
- Structure: `{ "board": "name", "exported_at": "date", "items": [...] }`
- Each item should have: `id`, `name`, `group`, and all column values as key-value pairs

**For Markdown:**
- Display clean tables with bold headers
- Include a שורה תחתונה (bottom line) summary
- Bold key figures (totals, counts)

### Step 7: Summary
After export, provide a summary:
- Board name
- Number of items exported
- Number of columns included
- File path (if CSV/JSON)
- Any items that were filtered out

## Safety Rules
- NEVER delete any data from Monday.com
- Read-only operations only
- Always verify the board ID before fetching data

## Language
- Converse in Hebrew
- Keep technical terms (API, CSV, JSON, board, column) in English
