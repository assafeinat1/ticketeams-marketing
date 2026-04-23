// One-shot diagnostic: discover the Manychat internal API endpoint for label add/remove.
// Reads MANYCHAT_COOKIES + MANYCHAT_CSRF from env.
// Tries several candidate endpoints on a test subscriber and a test label,
// reports which returned 200 vs 404/other.
// Does NOT actually move any label (uses a no-op label id that's safe to test).

const PAGE_ID = process.env.MANYCHAT_PAGE_ID || 'fb4064211';
const COOKIES = process.env.MANYCHAT_COOKIES;
const CSRF = process.env.MANYCHAT_CSRF;

if (!COOKIES || !CSRF) { console.error('missing env'); process.exit(1); }

const headers = {
  'Accept': 'application/json',
  'Content-Type': 'application/json',
  'X-CSRF-TOKEN': CSRF,
  'X-Requested-With': 'XMLHttpRequest',
  'Cookie': COOKIES,
  'User-Agent': 'Mozilla/5.0',
  'Referer': `https://app.manychat.com/${PAGE_ID}/chat`,
};

// Test subscriber — pick one we know exists (Beni Tal from label 2396)
const TEST_UID = '1330976591';
const TEST_LABEL_ID = 15584; // "ליד חם" — real label, exists in our mapping

// Candidate endpoints to probe
const candidates = [
  { method: 'POST', path: `/${PAGE_ID}/subscribers/addLabel`, body: { user_id: TEST_UID, label_id: TEST_LABEL_ID } },
  { method: 'POST', path: `/${PAGE_ID}/subscribers/${TEST_UID}/addLabel`, body: { label_id: TEST_LABEL_ID } },
  { method: 'POST', path: `/${PAGE_ID}/im/addLabel`, body: { user_id: TEST_UID, label_id: TEST_LABEL_ID } },
  { method: 'POST', path: `/${PAGE_ID}/im/threads/addLabel`, body: { user_id: TEST_UID, label_id: TEST_LABEL_ID } },
  { method: 'POST', path: `/${PAGE_ID}/im/assignLabel`, body: { user_id: TEST_UID, label_id: TEST_LABEL_ID } },
  { method: 'POST', path: `/${PAGE_ID}/im/label/add`, body: { user_id: TEST_UID, label_id: TEST_LABEL_ID } },
  { method: 'POST', path: `/${PAGE_ID}/cms/labels/attach`, body: { subscriber_id: TEST_UID, label_id: TEST_LABEL_ID } },
  { method: 'POST', path: `/${PAGE_ID}/im/updateThread`, body: { user_id: TEST_UID, labels: [TEST_LABEL_ID] } },
  { method: 'GET',  path: `/${PAGE_ID}/im/getLabels` },
  { method: 'GET',  path: `/${PAGE_ID}/cms/labels` },
  { method: 'GET',  path: `/${PAGE_ID}/labels` },
  { method: 'GET',  path: `/${PAGE_ID}/settings/labels` },
];

// First: fetch the thread's current labels to understand shape
console.log('=== Probe 0: get current thread info ===');
for (const threadPath of [`/${PAGE_ID}/im/thread/${TEST_UID}`, `/${PAGE_ID}/subscribers/${TEST_UID}`, `/${PAGE_ID}/im/threads/${TEST_UID}`]) {
  try {
    const r = await fetch(`https://app.manychat.com${threadPath}`, { headers });
    const txt = await r.text();
    console.log(`${r.status}  GET ${threadPath}`);
    if (r.ok) {
      console.log('  sample:', txt.slice(0, 500));
    }
  } catch (e) {
    console.log(`  ERR ${threadPath}: ${e.message}`);
  }
}

console.log('\n=== Probe candidates ===');
for (const c of candidates) {
  try {
    const opts = { method: c.method, headers };
    if (c.method === 'POST') opts.body = JSON.stringify(c.body);
    const r = await fetch(`https://app.manychat.com${c.path}`, opts);
    const txt = await r.text();
    console.log(`${r.status}  ${c.method} ${c.path}`);
    if (r.status < 400 || (r.status < 500 && txt.length < 300)) {
      console.log(`  body: ${txt.slice(0, 400)}`);
    }
  } catch (e) {
    console.log(`  ERR ${c.path}: ${e.message}`);
  }
  await new Promise(r => setTimeout(r, 200));
}
