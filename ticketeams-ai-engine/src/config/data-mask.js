/**
 * Ticketeams Data Mask — RedRok PII Protection
 *
 * Ensures zero PII reaches any LLM. Whitelist approach:
 * only explicitly allowed fields pass through.
 *
 * Usage:
 *   node src/config/data-mask.js   # self-test
 */

// ============================================================
// PII Patterns — regex for each type of sensitive data
// ============================================================

const PII_PATTERNS = [
  { name: 'email', regex: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, replacement: '[EMAIL]' },
  { name: 'israeli_phone', regex: /0[2-9]\d[\s-]?\d{3}[\s-]?\d{4}/g, replacement: '[PHONE]' },
  { name: 'intl_phone', regex: /\+\d{1,3}[\s-]?\d{2,4}[\s-]?\d{3,4}[\s-]?\d{3,4}/g, replacement: '[PHONE]' },
  { name: 'credit_card', regex: /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/g, replacement: '[CC]' },
  { name: 'israeli_id', regex: /(ת\.?ז\.?|מספר זהות|id[:\s])\s*\d{9}\b/gi, replacement: '$1 [ID]' },
  { name: 'currency_amount', regex: /[₪$€£]\s?\d[\d,]*\.?\d*/g, replacement: '[AMOUNT]' },
  { name: 'raw_amount', regex: /\b\d{1,3}(,\d{3})+(\.\d{2})?\b/g, replacement: '[AMOUNT]' },
];

// ============================================================
// 1. dataMask — strips PII from any string input
// ============================================================

function dataMask(rawData) {
  if (rawData == null) return '';
  let text = String(rawData);

  for (const pattern of PII_PATTERNS) {
    text = text.replace(pattern.regex, pattern.replacement);
  }

  return text;
}

// ============================================================
// 2. maskObject — whitelist approach: only allowed fields pass
// ============================================================

function maskObject(obj, allowedFields) {
  if (!obj || typeof obj !== 'object') return {};

  const masked = {};
  for (const field of allowedFields) {
    if (obj[field] !== undefined) {
      const val = obj[field];
      if (typeof val === 'string') {
        masked[field] = dataMask(val);
      } else if (typeof val === 'number' || typeof val === 'boolean') {
        masked[field] = val;
      } else if (val === null) {
        masked[field] = null;
      } else {
        masked[field] = dataMask(JSON.stringify(val));
      }
    }
  }

  return masked;
}

// ============================================================
// 3. aggregateForBI — produces pre-aggregated safe numbers
// ============================================================

function aggregateForBI(items, groupByField) {
  if (!Array.isArray(items) || items.length === 0) {
    return { groups: {}, totalItems: 0 };
  }

  const groups = {};

  for (const item of items) {
    const key = item[groupByField] || 'unknown';
    if (!groups[key]) {
      groups[key] = { count: 0 };
    }
    groups[key].count++;
  }

  return { groups, totalItems: items.length };
}

// ============================================================
// Self-Test
// ============================================================

function selfTest() {
  console.log('=== Data Mask — Self Test ===\n');

  let passed = 0;
  let failed = 0;

  function check(name, input, expected) {
    const result = dataMask(input);
    const ok = result === expected;
    console.log(`${ok ? '[PASS]' : '[FAIL]'} ${name}`);
    if (!ok) {
      console.log(`  Input:    "${input}"`);
      console.log(`  Expected: "${expected}"`);
      console.log(`  Got:      "${result}"`);
      failed++;
    } else {
      passed++;
    }
  }

  // Email
  check('Email', 'user@example.com', '[EMAIL]');
  check('Email in text', 'Contact user@test.co.il for info', 'Contact [EMAIL] for info');

  // Israeli phone
  check('Israeli phone', '052-123-4567', '[PHONE]');
  check('Israeli mobile', '054 987 6543', '[PHONE]');

  // International phone
  check('Intl phone', '+972-52-123-4567', '[PHONE]');
  check('Intl phone spaces', '+44 20 7123 4567', '[PHONE]');

  // Credit card
  check('Credit card', '4580-1234-5678-9012', '[CC]');
  check('Credit card spaces', '4580 1234 5678 9012', '[CC]');

  // Israeli ID (requires context like ת.ז. to avoid false positives)
  check('Israeli ID with context', 'ת.ז. 123456789', 'ת.ז. [ID]');
  check('Israeli ID English', 'id: 123456789', 'id: [ID]');
  check('No false positive on bare 9-digits', 'order 123456789 confirmed', 'order 123456789 confirmed');

  // Currency amounts
  check('ILS amount', '₪1,500.00', '[AMOUNT]');
  check('GBP amount', '£350', '[AMOUNT]');
  check('EUR amount', '€250', '[AMOUNT]');
  check('USD amount', '$1,200', '[AMOUNT]');

  // maskObject
  console.log('\n--- maskObject ---');
  const obj = {
    id: '12345',
    name: 'Arsenal vs Chelsea',
    email: 'admin@tickets.com',
    phone: '052-123-4567',
    price: '₪1,500',
    competition: 'Premier League',
  };

  const masked = maskObject(obj, ['id', 'name', 'competition']);
  const maskOk = masked.id === '12345' && masked.name === 'Arsenal vs Chelsea'
    && masked.competition === 'Premier League' && !masked.email && !masked.phone && !masked.price;
  console.log(`${maskOk ? '[PASS]' : '[FAIL]'} maskObject whitelist`);
  if (maskOk) passed++; else failed++;

  // aggregateForBI
  console.log('\n--- aggregateForBI ---');
  const items = [
    { competition: 'PL', name: 'Match 1' },
    { competition: 'PL', name: 'Match 2' },
    { competition: 'La Liga', name: 'Match 3' },
  ];
  const agg = aggregateForBI(items, 'competition');
  const aggOk = agg.totalItems === 3 && agg.groups.PL.count === 2 && agg.groups['La Liga'].count === 1;
  console.log(`${aggOk ? '[PASS]' : '[FAIL]'} aggregateForBI`);
  if (aggOk) passed++; else failed++;

  console.log(`\n--- Results: ${passed} passed, ${failed} failed ---`);
  console.log('=== Data Mask — Ready ===');
}

module.exports = { dataMask, maskObject, aggregateForBI, PII_PATTERNS };

if (require.main === module) {
  selfTest();
}
