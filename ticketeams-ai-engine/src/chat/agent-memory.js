/**
 * Agent Memory — Persistent correction & preference memory per agent
 *
 * Detects correction patterns in user messages and stores them.
 * Memory is injected into agent system prompts so agents learn from feedback.
 */

const fs = require('fs');
const path = require('path');

const MEMORY_PATH = path.join(__dirname, '..', 'config', 'agent-memory.json');
const MAX_ENTRIES_PER_AGENT = 50;

// ============================================================
// Load / Save
// ============================================================

function loadMemory() {
  try {
    const raw = fs.readFileSync(MEMORY_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function saveMemory(memory) {
  fs.writeFileSync(MEMORY_PATH, JSON.stringify(memory, null, 2), 'utf-8');
}

// ============================================================
// Pattern Detection
// ============================================================

const PATTERNS = [
  // Shorter text requests
  { regex: /תקצר|קצר יותר|תמציתי|יותר קצר|תקצר את/, category: 'text_length', preference: 'shorter' },
  // Longer text requests
  { regex: /פרט יותר|יותר ארוך|תרחיב|הרחב/, category: 'text_length', preference: 'longer' },
  // Corrections
  { regex: /לא נכון|טעות|שגוי|טעית|לא מדויק/, category: 'correction' },
  // Positive feedback
  { regex: /אני אוהב|מעולה|בדיוק|מצוין|נהדר|אהבתי/, category: 'positive' },
  // Negative feedback
  { regex: /לא אהבתי|גרוע|שנה|לא טוב|רע/, category: 'negative' },
  // Persistent rules
  { regex: /תזכור ש|תמיד |אף פעם |לעולם לא/, category: 'rule' },
];

/**
 * Detect feedback patterns in a user message.
 * Returns array of detected entries, or empty array if none.
 */
function detectPatterns(message) {
  const detected = [];
  for (const pattern of PATTERNS) {
    if (pattern.regex.test(message)) {
      const entry = {
        category: pattern.category,
        detail: message.slice(0, 200),
        timestamp: new Date().toISOString(),
      };
      if (pattern.preference) {
        entry.preference = pattern.preference;
      }
      detected.push(entry);
    }
  }
  return detected;
}

// ============================================================
// Memory Operations
// ============================================================

/**
 * Process a user message for an agent — detect and save patterns.
 * Returns { saved: boolean, entries: number }
 */
function processMessage(agentName, message) {
  const detected = detectPatterns(message);
  if (detected.length === 0) return { saved: false, entries: 0 };

  const memory = loadMemory();
  if (!memory[agentName]) {
    memory[agentName] = { corrections: [], preferences: [], lastUpdated: null };
  }

  for (const entry of detected) {
    if (entry.category === 'text_length' || entry.category === 'rule') {
      memory[agentName].preferences.push(entry);
    } else {
      memory[agentName].corrections.push(entry);
    }
  }

  // Trim to max entries
  memory[agentName].corrections = memory[agentName].corrections.slice(-MAX_ENTRIES_PER_AGENT);
  memory[agentName].preferences = memory[agentName].preferences.slice(-MAX_ENTRIES_PER_AGENT);
  memory[agentName].lastUpdated = new Date().toISOString();

  saveMemory(memory);
  return { saved: true, entries: detected.length };
}

/**
 * Get memory for a specific agent.
 */
function getAgentMemory(agentName) {
  const memory = loadMemory();
  return memory[agentName] || { corrections: [], preferences: [], lastUpdated: null };
}

/**
 * Add a manual entry to agent memory.
 */
function addMemoryEntry(agentName, entry) {
  const memory = loadMemory();
  if (!memory[agentName]) {
    memory[agentName] = { corrections: [], preferences: [], lastUpdated: null };
  }

  const fullEntry = {
    ...entry,
    timestamp: new Date().toISOString(),
  };

  if (entry.category === 'text_length' || entry.category === 'rule') {
    memory[agentName].preferences.push(fullEntry);
    memory[agentName].preferences = memory[agentName].preferences.slice(-MAX_ENTRIES_PER_AGENT);
  } else {
    memory[agentName].corrections.push(fullEntry);
    memory[agentName].corrections = memory[agentName].corrections.slice(-MAX_ENTRIES_PER_AGENT);
  }

  memory[agentName].lastUpdated = new Date().toISOString();
  saveMemory(memory);
  return fullEntry;
}

/**
 * Delete a specific entry by index from corrections or preferences.
 */
function deleteMemoryEntry(agentName, index) {
  const memory = loadMemory();
  if (!memory[agentName]) return { deleted: false, error: 'agent not found' };

  // Try corrections first, then preferences
  const allEntries = [
    ...memory[agentName].corrections.map((e, i) => ({ ...e, _list: 'corrections', _idx: i })),
    ...memory[agentName].preferences.map((e, i) => ({ ...e, _list: 'preferences', _idx: i })),
  ];

  if (index < 0 || index >= allEntries.length) {
    return { deleted: false, error: 'index out of range' };
  }

  const target = allEntries[index];
  memory[agentName][target._list].splice(target._idx, 1);
  memory[agentName].lastUpdated = new Date().toISOString();
  saveMemory(memory);

  return { deleted: true, entry: { category: target.category, detail: target.detail } };
}

/**
 * Build a memory summary string for injection into system prompt.
 * Returns empty string if no memory exists.
 */
function buildMemoryPrompt(agentName) {
  const agentMem = getAgentMemory(agentName);
  const items = [];

  // Recent preferences (last 5)
  for (const p of agentMem.preferences.slice(-5)) {
    if (p.preference) {
      items.push(`- העדפה: ${p.preference === 'shorter' ? 'טקסט קצר יותר' : p.preference === 'longer' ? 'טקסט מפורט יותר' : p.detail}`);
    } else {
      items.push(`- כלל: ${p.detail}`);
    }
  }

  // Recent corrections (last 5)
  for (const c of agentMem.corrections.slice(-5)) {
    if (c.category === 'positive') {
      items.push(`- חיובי: ${c.detail}`);
    } else if (c.category === 'negative') {
      items.push(`- שלילי: ${c.detail}`);
    } else {
      items.push(`- תיקון: ${c.detail}`);
    }
  }

  if (items.length === 0) return '';

  return `\n\nהעדפות משתמש מתיקונים קודמים:\n${items.join('\n')}`;
}

module.exports = {
  processMessage,
  getAgentMemory,
  addMemoryEntry,
  deleteMemoryEntry,
  buildMemoryPrompt,
  detectPatterns,
};
