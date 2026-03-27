require('dotenv').config();
const axios = require('axios');

const MONDAY_API_URL = 'https://api.monday.com/v2';
const API_KEY = process.env.MONDAY_API_KEY;
const BOARD_ID = process.env.MONDAY_BOARD_ID;

/**
 * שולח שאילתת GraphQL ל-Monday.com API
 */
async function mondayQuery(query, variables = {}) {
  try {
    const response = await axios.post(
      MONDAY_API_URL,
      { query, variables },
      {
        headers: {
          Authorization: API_KEY,
          'Content-Type': 'application/json',
        },
      }
    );

    if (response.data.errors) {
      throw new Error(response.data.errors.map((e) => e.message).join(', '));
    }

    return response.data.data;
  } catch (error) {
    if (error.response) {
      throw new Error(`Monday API error (${error.response.status}): ${error.response.data}`);
    }
    throw error;
  }
}

/**
 * שולף את כל הפריטים מהלוח
 */
async function getBoardItems() {
  try {
    const query = `
      query {
        boards(ids: [${BOARD_ID}]) {
          name
          items_page(limit: 500) {
            items {
              id
              name
              column_values {
                id
                text
                value
              }
            }
          }
        }
      }
    `;

    const data = await mondayQuery(query);
    return data.boards[0].items_page.items;
  } catch (error) {
    console.error('שגיאה בשליפת פריטים מהלוח:', error.message);
    throw error;
  }
}

/**
 * יוצר עדכון (update) על פריט נתון
 */
async function createItemUpdate(itemId, body) {
  try {
    const query = `
      mutation {
        create_update(item_id: ${itemId}, body: "${body.replace(/"/g, '\\"')}") {
          id
        }
      }
    `;

    const data = await mondayQuery(query);
    return data.create_update;
  } catch (error) {
    console.error(`שגיאה ביצירת עדכון לפריט ${itemId}:`, error.message);
    throw error;
  }
}

/**
 * בדיקת חיבור ל-Monday.com
 */
async function testConnection() {
  try {
    const query = `query { me { name } }`;
    await mondayQuery(query);
    console.log('חיבור ל-Monday — תקין');
  } catch (error) {
    console.error('חיבור ל-Monday — נכשל:', error.message);
  }
}

/**
 * מעלה דוח ניטור יומי ל-Monday.com כעדכון על פריט בלוח
 */
async function uploadDailyAdReport(monitorResults, itemId) {
  try {
    const { date, totalAds, summary, competitors, counterAdCandidates } = monitorResults;

    const competitorLines = (competitors || [])
      .map((c) => `• ${c.page_name}: ${c.ads_count} פרסומות (${c.status})`)
      .join('\n');

    const candidateLines = (counterAdCandidates || []).length > 0
      ? (counterAdCandidates || [])
          .map((c) => `• ${c.competitor}: ${c.homeTeam} vs ${c.awayTeam} (${c.format_type})`)
          .join('\n')
      : 'אין';

    const reportText = [
      `📊 דוח ניטור פרסומות מתחרים — ${date}`,
      '',
      `סה"כ פרסומות: ${totalAds}`,
      `Stadium: ${summary.stadium} | Human: ${summary.human} | Urgency: ${summary.urgency}`,
      '',
      'ממצאים לפי מתחרה:',
      competitorLines,
      '',
      'מועמדים לפרסומת נגדית:',
      candidateLines,
      '',
      '🤖 נוצר אוטומטית — Ad Monitor Agent',
    ].join('\n');

    if (itemId) {
      const result = await createItemUpdate(itemId, reportText);
      console.log(`דוח ניטור הועלה ל-Monday — Item ${itemId}`);
      return result;
    }

    // fallback — כתיבה לקונסול אם לא סופק itemId
    console.log('\n=== דוח ניטור (Monday) ===');
    console.log(reportText);
    console.log('==========================\n');
    return { status: 'printed', text: reportText };
  } catch (error) {
    console.error('שגיאה בהעלאת דוח ניטור ל-Monday:', error.message);
    throw error;
  }
}

/**
 * שולף פריטים מקבוצה ספציפית בלוח
 */
async function getBoardGroupItems(boardId, groupId, limit = 500) {
  try {
    const query = `
      query {
        boards(ids: [${boardId}]) {
          groups(ids: ["${groupId}"]) {
            items_page(limit: ${limit}) {
              items {
                id
                name
                column_values {
                  id
                  text
                  value
                }
              }
            }
          }
        }
      }
    `;

    const data = await mondayQuery(query);
    const groups = data.boards[0]?.groups;
    if (!groups || groups.length === 0) return [];
    return groups[0].items_page.items;
  } catch (error) {
    console.error(`שגיאה בשליפת פריטים מקבוצה ${groupId} בלוח ${boardId}:`, error.message);
    throw error;
  }
}

/**
 * שולף את כל הפריטים מקבוצה בלוח — עם pagination מלא (cursor-based).
 * Monday.com מגביל ל-500 פריטים לקריאה. פונקציה זו עוברת על כל הדפים.
 */
async function getAllGroupItems(boardId, groupId) {
  const allItems = [];
  let cursor = undefined;

  try {
    do {
      const cursorClause = cursor ? `, cursor: "${cursor}"` : '';
      const query = `
        query {
          boards(ids: [${boardId}]) {
            groups(ids: ["${groupId}"]) {
              items_page(limit: 500${cursorClause}) {
                cursor
                items {
                  id
                  name
                  column_values {
                    id
                    text
                    value
                  }
                }
              }
            }
          }
        }
      `;

      const data = await mondayQuery(query);
      const page = data.boards[0]?.groups?.[0]?.items_page;
      if (!page) break;

      allItems.push(...page.items);
      cursor = page.cursor;
    } while (cursor);

    return allItems;
  } catch (error) {
    console.error(`שגיאה בשליפת כל הפריטים מקבוצה ${groupId} בלוח ${boardId}:`, error.message);
    throw error;
  }
}

/**
 * יוצר פריט חדש בלוח Monday.com
 * @param {number} boardId - מזהה הלוח
 * @param {string} groupId - מזהה הקבוצה
 * @param {string} itemName - שם הפריט
 * @param {Object} columnValues - ערכי עמודות (key-value)
 * @returns {Object} { id, name }
 */
async function createBoardItem(boardId, groupId, itemName, columnValues = {}) {
  try {
    const colValStr = JSON.stringify(JSON.stringify(columnValues));
    const safeName = itemName.replace(/"/g, '\\"');

    const query = `
      mutation {
        create_item(
          board_id: ${boardId},
          group_id: "${groupId}",
          item_name: "${safeName}",
          column_values: ${colValStr}
        ) {
          id
          name
        }
      }
    `;

    const data = await mondayQuery(query);
    return data.create_item;
  } catch (error) {
    console.error(`שגיאה ביצירת פריט בלוח ${boardId}:`, error.message);
    throw error;
  }
}

/**
 * מעדכן עמודות בפריט קיים בלוח Monday.com
 * @param {number} boardId - מזהה הלוח
 * @param {number|string} itemId - מזהה הפריט
 * @param {Object} columnValues - ערכי עמודות לעדכון
 * @returns {Object} { id }
 */
async function updateItemColumn(boardId, itemId, columnValues = {}) {
  try {
    const colValStr = JSON.stringify(JSON.stringify(columnValues));

    const query = `
      mutation {
        change_multiple_column_values(
          board_id: ${boardId},
          item_id: ${itemId},
          column_values: ${colValStr}
        ) {
          id
        }
      }
    `;

    const data = await mondayQuery(query);
    return data.change_multiple_column_values;
  } catch (error) {
    console.error(`שגיאה בעדכון פריט ${itemId} בלוח ${boardId}:`, error.message);
    throw error;
  }
}

module.exports = { mondayQuery, getBoardItems, getBoardGroupItems, getAllGroupItems, createItemUpdate, createBoardItem, updateItemColumn, testConnection, uploadDailyAdReport };

if (require.main === module) {
  testConnection();
}
