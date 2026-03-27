/**
 * Ticketeams Structured Logger
 *
 * Structured logging with daily log files.
 * Every action logs: timestamp, agent, action, success/fail, duration.
 *
 * Usage:
 *   const logger = require('./utils/logger');
 *   logger.info('scout', 'proactiveScan', 'Found 83 fixtures');
 *   logger.error('meta', 'createCampaign', 'API error 100', { matchKey });
 *   const entry = logger.time('intelligence', 'dailyScan');
 *   // ... do work ...
 *   entry.done('Scored 81 events');     // auto-logs duration
 *   entry.fail('No fixtures found');    // auto-logs duration + error
 */

const fs = require('fs');
const path = require('path');

const LOG_DIR = path.join(__dirname, '..', 'logs');

// Ensure log directory exists
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

function getLogFilePath(date) {
  const d = date || new Date();
  const dateStr = d.toISOString().split('T')[0]; // YYYY-MM-DD
  return path.join(LOG_DIR, `${dateStr}.log`);
}

function formatEntry(level, agent, action, message, meta) {
  const entry = {
    ts: new Date().toISOString(),
    level,
    agent,
    action,
    message,
  };
  if (meta && Object.keys(meta).length > 0) {
    entry.meta = meta;
  }
  return entry;
}

function writeLog(entry) {
  const line = JSON.stringify(entry) + '\n';

  // Write to daily log file
  try {
    const logFile = getLogFilePath();
    fs.appendFileSync(logFile, line, 'utf-8');
  } catch (err) {
    // Fallback to console if file write fails
    console.error('[LOGGER] Failed to write log file:', err.message);
  }

  // Also print to console with prefix
  const prefix = `[${entry.agent.toUpperCase()}]`;
  const status = entry.level === 'error' ? 'FAIL' : entry.level === 'warn' ? 'WARN' : 'OK';
  const duration = entry.meta?.durationMs ? ` (${entry.meta.durationMs}ms)` : '';
  const msg = `${prefix} ${entry.action}: ${entry.message}${duration}`;

  if (entry.level === 'error') {
    console.error(msg);
  } else if (entry.level === 'warn') {
    console.warn(msg);
  } else {
    console.log(msg);
  }
}

function info(agent, action, message, meta = {}) {
  writeLog(formatEntry('info', agent, action, message, meta));
}

function warn(agent, action, message, meta = {}) {
  writeLog(formatEntry('warn', agent, action, message, meta));
}

function error(agent, action, message, meta = {}) {
  writeLog(formatEntry('error', agent, action, message, meta));
}

/**
 * Start a timed operation. Returns { done(msg), fail(msg) }.
 */
function time(agent, action) {
  const start = Date.now();
  return {
    done(message, meta = {}) {
      const durationMs = Date.now() - start;
      info(agent, action, message, { ...meta, durationMs });
    },
    fail(message, meta = {}) {
      const durationMs = Date.now() - start;
      error(agent, action, message, { ...meta, durationMs });
    },
  };
}

/**
 * Read logs for a given date string (YYYY-MM-DD).
 * Returns array of parsed log entries.
 */
function readLogs(dateStr) {
  const logFile = path.join(LOG_DIR, `${dateStr}.log`);
  if (!fs.existsSync(logFile)) return [];

  const lines = fs.readFileSync(logFile, 'utf-8').split('\n').filter(Boolean);
  return lines.map((line) => {
    try {
      return JSON.parse(line);
    } catch {
      return { ts: null, level: 'raw', message: line };
    }
  });
}

/**
 * List available log dates.
 */
function listLogDates() {
  if (!fs.existsSync(LOG_DIR)) return [];
  return fs.readdirSync(LOG_DIR)
    .filter((f) => f.endsWith('.log'))
    .map((f) => f.replace('.log', ''))
    .sort()
    .reverse();
}

module.exports = { info, warn, error, time, readLogs, listLogDates, LOG_DIR };
