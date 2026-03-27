/**
 * Retry utility for unreliable operations (Meta API, external services).
 *
 * Usage:
 *   const { withRetry } = require('./utils/retry');
 *   const result = await withRetry(() => metaPost('/campaigns', payload), {
 *     retries: 2,
 *     delayMs: 5000,
 *     label: 'createCampaign',
 *   });
 */

const logger = require('./logger');

/**
 * Execute fn with automatic retries.
 * @param {Function} fn - Async function to execute
 * @param {Object} opts - { retries: 2, delayMs: 5000, label: 'operation', agent: 'meta' }
 */
async function withRetry(fn, opts = {}) {
  const { retries = 2, delayMs = 5000, label = 'operation', agent = 'system' } = opts;
  let lastError;

  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt < retries) {
        logger.warn(agent, label, `Attempt ${attempt + 1} failed: ${err.message} — retrying in ${delayMs}ms`, {
          attempt: attempt + 1,
          maxRetries: retries,
        });
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }

  logger.error(agent, label, `All ${retries + 1} attempts failed: ${lastError.message}`);
  throw lastError;
}

module.exports = { withRetry };
