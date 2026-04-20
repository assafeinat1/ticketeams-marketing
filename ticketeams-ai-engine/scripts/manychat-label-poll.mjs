#!/usr/bin/env node
// Manychat Label → Tag sync — runs as a single-shot from GitHub Actions (cron every 5m).
// Reads Manychat session cookies + CSRF from env vars.
// Polls each label via Manychat internal API, detects new users, fires matching tags via PUBLIC API.
// State stored in state file committed to repo (state/manychat-label-sync-state.json).
//
// Env vars required (set as GitHub Secrets):
//   MANYCHAT_COOKIES          — raw Cookie header value from logged-in session
//   MANYCHAT_CSRF             — CSRF token from window.__INIT__['app.csrf_token']
//   MANYCHAT_PAGE_ID          — Manychat page id (e.g. fb4064211)
//   MANYCHAT_PUBLIC_API_TOKEN — Manychat public API token (Settings → API)

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(__dirname, '..', 'state', 'manychat-label-sync-state.json');
const PULL_LIMIT = 200;

const PAGE_ID = process.env.MANYCHAT_PAGE_ID || 'fb4064211';
const COOKIES = process.env.MANYCHAT_COOKIES;
const CSRF = process.env.MANYCHAT_CSRF;
const PUBLIC_API_TOKEN = process.env.MANYCHAT_PUBLIC_API_TOKEN;

if (!COOKIES || !CSRF || !PUBLIC_API_TOKEN) {
  console.error('Missing required env vars: MANYCHAT_COOKIES, MANYCHAT_CSRF, MANYCHAT_PUBLIC_API_TOKEN');
  process.exit(1);
}

// Manychat inbox label → tag mapping.
// tagName: tag fired on the subscriber in Manychat (visible to sales in Manychat).
// makeTag: value sent directly to Make.com webhook, matching existing Make Router filters
//          (those filters were set up before the cloud poller and expect the old names).
const LABEL_TO_TAG = {
  15584: { labelName: 'ליד חם',              tagName: 'ליד חם',              makeTag: 'ליד חם' },
  14307: { labelName: 'לחזור לליד',          tagName: 'לחזור לליד',          makeTag: 'לחזור לליד' },
  14308: { labelName: 'לקוח סגר',            tagName: 'לקוח סגר',            makeTag: 'לקוח סגר' },
  2396:  { labelName: 'ליד רציני מונדיאל',   tagName: 'ליד רציני מונדיאל',   makeTag: 'ליד חם מונדיאל' },
  15582: { labelName: 'ליד רציני',           tagName: 'ליד רציני',           makeTag: 'מחכים לתשלום' },
  [-2]:  { labelName: 'ליד רציני הפועות',    tagName: 'ליד רציני הופעות',    makeTag: 'ליד חם הופעות' },
};

const MAKE_WEBHOOK_URL = 'https://hook.eu2.make.com/nzj7gzx0ikit78u597mfvja32h5273yn';

const internalHeaders = {
  'Accept': 'application/json',
  'Content-Type': 'application/json',
  'X-CSRF-TOKEN': CSRF,
  'X-Requested-With': 'XMLHttpRequest',
  'Cookie': COOKIES,
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36',
  'Referer': `https://app.manychat.com/${PAGE_ID}/chat`,
};

async function loadThreadsByLabel(labelId) {
  const resp = await fetch(`https://app.manychat.com/${PAGE_ID}/im/loadThreads`, {
    method: 'POST',
    headers: internalHeaders,
    body: JSON.stringify({
      limit: PULL_LIMIT,
      sorting: 'newest',
      filter: {
        operator: 'AND',
        groups: [{ operator: 'AND', items: [{ type: 'label', field: 'label', operator: 'IS', value: Number(labelId) }] }],
      },
    }),
  });
  if (!resp.ok) throw new Error(`loadThreads label=${labelId} status=${resp.status}`);
  const data = await resp.json();
  return data.threads || [];
}

async function addTagByName(subscriberId, tagName) {
  const resp = await fetch('https://api.manychat.com/fb/subscriber/addTagByName', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${PUBLIC_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ subscriber_id: Number(subscriberId), tag_name: tagName }),
  });
  const result = await resp.json();
  if (result.status !== 'success') throw new Error(`addTagByName failed: ${JSON.stringify(result)}`);
  return result;
}

async function removeTagByName(subscriberId, tagName) {
  const resp = await fetch('https://api.manychat.com/fb/subscriber/removeTagByName', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${PUBLIC_API_TOKEN}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ subscriber_id: Number(subscriberId), tag_name: tagName }),
  });
  return resp.json();
}

async function getSubscriberPhone(subscriberId) {
  const u = new URL('https://api.manychat.com/fb/subscriber/getInfo');
  u.searchParams.set('subscriber_id', String(subscriberId));
  const resp = await fetch(u, { headers: { 'Authorization': `Bearer ${PUBLIC_API_TOKEN}` } });
  const d = await resp.json();
  return d?.data?.phone || '';
}

function normalizePhone(raw) {
  if (!raw) return '';
  const t = raw.trim();
  if (t.startsWith('+')) return t;
  if (t.startsWith('0')) return '+972' + t.slice(1);
  return '+' + t;
}

async function sendMakeWebhook(phone, makeTag) {
  await fetch(MAKE_WEBHOOK_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone, tag: makeTag }),
  });
}

// Force-fire: remove then re-add so the "Tag applied" flow trigger fires even if the tag already exists.
async function forceFireTag(subscriberId, tagName) {
  try { await removeTagByName(subscriberId, tagName); } catch {}
  await new Promise((r) => setTimeout(r, 250));
  return addTagByName(subscriberId, tagName);
}

function loadState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8'));
  } catch {
    return { userIdsByLabel: {}, seeded: false };
  }
}

function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

async function pollOnce() {
  const state = loadState();
  const firedThisRun = [];

  for (const [labelIdStr, meta] of Object.entries(LABEL_TO_TAG)) {
    const labelId = Number(labelIdStr);
    try {
      const threads = await loadThreadsByLabel(labelId);
      const currentIds = threads.map((t) => String(t.user_id));
      const previousIds = new Set(state.userIdsByLabel[labelId] || []);
      const names = Object.fromEntries(threads.map((t) => [String(t.user_id), t.user?.name || String(t.user_id)]));

      if (state.seeded) {
        const newlyLabelled = currentIds.filter((uid) => !previousIds.has(uid));
        for (const uid of newlyLabelled) {
          try {
            await forceFireTag(uid, meta.tagName);
            firedThisRun.push({ uid, name: names[uid], label: meta.labelName, tag: meta.tagName });
            console.log(`[fired] ${names[uid]} (${uid}) label="${meta.labelName}" → tag="${meta.tagName}"`);
            // Send webhook directly to Make so Monday updates even if Manychat Flow doesn't forward.
            try {
              const phone = normalizePhone(await getSubscriberPhone(uid));
              if (phone) {
                await sendMakeWebhook(phone, meta.makeTag);
                console.log(`  → Make webhook sent (phone=${phone}, makeTag="${meta.makeTag}")`);
              } else {
                console.log(`  → skipped webhook: no phone for ${names[uid]}`);
              }
            } catch (we) {
              console.error(`  → webhook failed for ${uid}: ${we.message}`);
            }
          } catch (e) {
            console.error(`[fire-failed] ${names[uid]} (${uid}): ${e.message}`);
          }
        }
      }
      state.userIdsByLabel[labelId] = currentIds;
    } catch (e) {
      console.error(`[poll-failed] label=${labelId} ${e.message}`);
    }
  }

  if (!state.seeded) {
    state.seeded = true;
    const total = Object.values(state.userIdsByLabel).reduce((a, b) => a + b.length, 0);
    console.log(`[seed] Tracking ${total} label-contacts across ${Object.keys(LABEL_TO_TAG).length} labels. New labels from here on will sync.`);
  }

  saveState(state);
  return firedThisRun;
}

try {
  const fired = await pollOnce();
  console.log(`Done. Fired ${fired.length} tag(s).`);
} catch (e) {
  console.error('Fatal:', e);
  process.exit(1);
}
