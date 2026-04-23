#!/usr/bin/env node
// Monday → Manychat reverse sync.
// Polls Monday activity_logs for status column changes, filters out our own
// (Manychat → Monday) updates to prevent loops, and mirrors the new status
// as a tag on the corresponding Manychat subscriber (public API).
//
// Runs every ~5 min from GHA. State file tracks the last-seen activity id
// so we don't re-process events on each run.
//
// Env:
//   MONDAY_API_KEY            — Monday personal token (same as forward sync)
//   MANYCHAT_PUBLIC_API_TOKEN — Manychat public API token (reads phone, writes tags)
//
// Loop prevention:
//   - Skip activity entries whose user_id === MONDAY_SYNC_USER_ID. These are
//     changes made by the forward sync (Make updates using Assaf's API key).
//   - Before adding the tag, check the subscriber's current tags. If the target
//     tag is already present, skip (avoids no-op "Tag applied" Flow triggers).

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const STATE_FILE = path.join(__dirname, '..', 'state', 'monday-to-manychat-state.json');

const MONDAY_API_KEY = process.env.MONDAY_API_KEY;
const PUBLIC_API_TOKEN = process.env.MANYCHAT_PUBLIC_API_TOKEN;

if (!MONDAY_API_KEY || !PUBLIC_API_TOKEN) {
  console.error('Missing env: MONDAY_API_KEY or MANYCHAT_PUBLIC_API_TOKEN');
  process.exit(1);
}

const BOARD = 5091215233;
const STATUS_COL = 'color_mm1xncpj';
const PHONE_COL = 'phone_mm08vpf3';
const TEXT_PHONE_COL = 'text_mm2dzfwc';
const MONDAY_SYNC_USER_ID = '68369015'; // Assaf — the identity used by the forward sync's API key

// Monday status label → Manychat tag name.
// These tags must exist in Manychat (created by Assaf or by tag-applied Flows).
// The set of tags we "manage" — when updating, we remove any of these before adding the new one,
// so a lead only has ONE status tag at a time.
const STATUS_TAGS = [
  'ליד חם',
  'לחזור לליד',
  'לקוח סגר',
  'ליד רציני מונדיאל',
  'ליד רציני',
  'ליד רציני הופעות',
];
const STATUS_LABEL_TO_TAG = {
  'ליד חם': 'ליד חם',
  'לחזור לליד': 'לחזור לליד',
  'לקוח סגר': 'לקוח סגר',
  'ליד רציני מונדיאל': 'ליד רציני מונדיאל',
  'ליד רציני': 'ליד רציני',
  'ליד רציני הופעות': 'ליד רציני הופעות',
};

async function monday(query, variables = {}) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const r = await fetch('https://api.monday.com/v2', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': MONDAY_API_KEY, 'API-Version': '2024-01' },
      body: JSON.stringify({ query, variables }),
    });
    const j = await r.json();
    if (j.errors) {
      if (/complex|rate|limit/i.test(JSON.stringify(j.errors)) && attempt < 3) {
        await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
        continue;
      }
      throw new Error(JSON.stringify(j.errors));
    }
    return j.data;
  }
}

async function mcPublic(pathname, body) {
  const opts = {
    method: body ? 'POST' : 'GET',
    headers: { 'Authorization': `Bearer ${PUBLIC_API_TOKEN}` },
  };
  if (body) {
    opts.headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(body);
  }
  const r = await fetch(`https://api.manychat.com${pathname}`, opts);
  return r.json();
}

async function findSubscriberByPhone(phone) {
  const u = `/fb/subscriber/findBySystemField?phone=${encodeURIComponent(phone)}`;
  const resp = await mcPublic(u);
  if (resp.status !== 'success') return null;
  const data = resp.data;
  return Array.isArray(data) ? data[0] : data;
}

async function getTags(subscriberId) {
  const resp = await mcPublic(`/fb/subscriber/getInfo?subscriber_id=${subscriberId}`);
  return (resp?.data?.tags || []).map(t => t.name);
}

async function addTag(subscriberId, tagName) {
  return mcPublic('/fb/subscriber/addTagByName', { subscriber_id: Number(subscriberId), tag_name: tagName });
}

async function removeTag(subscriberId, tagName) {
  return mcPublic('/fb/subscriber/removeTagByName', { subscriber_id: Number(subscriberId), tag_name: tagName });
}

function loadState() {
  try { return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')); }
  catch { return { lastProcessedMs: 0 }; }
}
function saveState(state) {
  fs.mkdirSync(path.dirname(STATE_FILE), { recursive: true });
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

async function main() {
  const state = loadState();
  // First run: start from "now - 30min" so we don't flood on cold start.
  // Subsequent runs: start from state.lastProcessedMs.
  const nowMs = Date.now();
  const fromMs = state.lastProcessedMs || (nowMs - 30 * 60 * 1000);
  const fromIso = new Date(fromMs).toISOString();
  console.log(`Scanning Monday activity since ${fromIso}`);

  // Fetch activity logs for the status column since fromMs.
  const logs = [];
  let page = 1;
  while (true) {
    const d = await monday(
      `query { boards(ids: [${BOARD}]) { activity_logs(from: "${fromIso}", limit: 500, page: ${page}, column_ids: ["${STATUS_COL}"]) { id user_id created_at data } } }`
    );
    const batch = d.boards[0].activity_logs || [];
    if (!batch.length) break;
    logs.push(...batch);
    if (batch.length < 500) break;
    page++;
  }
  console.log(`Fetched ${logs.length} activity rows`);

  // Parse + sort chronologically
  const events = [];
  for (const l of logs) {
    let data = {}; try { data = JSON.parse(l.data); } catch { continue; }
    const ms = Math.floor(Number(l.created_at) / 10000);
    if (ms <= fromMs) continue; // strictly newer than fromMs
    events.push({
      id: l.id,
      ms,
      iso: new Date(ms).toISOString(),
      user: String(l.user_id),
      pulseId: data.pulse_id,
      pulseName: data.pulse_name,
      prev: data.previous_value?.label?.text ?? null,
      next: data.value?.label?.text ?? null,
    });
  }
  events.sort((a, b) => a.ms - b.ms);
  console.log(`New events (after ${fromIso}): ${events.length}`);

  // Coalesce per pulse — only need the LATEST status per pulse in this window
  const latestPerPulse = new Map();
  for (const e of events) latestPerPulse.set(e.pulseId, e);

  let applied = 0, skippedSync = 0, skippedNoChange = 0, skippedNoPhone = 0, skippedNoSub = 0, errors = 0;

  for (const [pulseId, e] of latestPerPulse) {
    // Loop prevention: changes made by the forward sync (user=68369015) are skipped.
    if (e.user === MONDAY_SYNC_USER_ID) {
      skippedSync++;
      continue;
    }

    // Get phone from the item
    let phone = null;
    try {
      const d = await monday(`query { items(ids: [${pulseId}]) { column_values(ids: ["${PHONE_COL}","${TEXT_PHONE_COL}"]) { id text } } }`);
      const cols = d.items?.[0]?.column_values || [];
      phone = cols.find(c => c.id === PHONE_COL)?.text || cols.find(c => c.id === TEXT_PHONE_COL)?.text || null;
    } catch (err) {
      console.error(`[err] pulse=${pulseId} monday-fetch: ${err.message}`);
      errors++; continue;
    }
    if (!phone) { skippedNoPhone++; console.log(`[skip-no-phone] ${e.pulseName} (${pulseId})`); continue; }
    if (phone.startsWith('0')) phone = '+972' + phone.slice(1);
    if (!phone.startsWith('+')) phone = '+' + phone;

    // Find Manychat subscriber
    let sub;
    try { sub = await findSubscriberByPhone(phone); } catch (err) { errors++; console.error(`[err] findBySystemField ${phone}: ${err.message}`); continue; }
    if (!sub?.id) {
      skippedNoSub++;
      console.log(`[skip-no-sub] ${e.pulseName} phone=${phone} not in Manychat`);
      continue;
    }

    // Target tag from new Monday status
    const targetTag = e.next ? STATUS_LABEL_TO_TAG[e.next] : null;

    // Get current tags
    const currentTags = await getTags(sub.id);
    const currentStatusTags = currentTags.filter(t => STATUS_TAGS.includes(t));

    // If Monday cleared the status (next=null/empty) → remove ALL status tags
    if (!targetTag) {
      if (currentStatusTags.length === 0) { skippedNoChange++; continue; }
      for (const t of currentStatusTags) {
        await removeTag(sub.id, t);
        console.log(`[removed] ${e.pulseName} (${sub.id}) tag="${t}"  (Monday cleared status)`);
      }
      applied++;
      await new Promise(r => setTimeout(r, 200));
      continue;
    }

    // If target tag already present and no OTHER status tags — skip (idempotent)
    if (currentStatusTags.length === 1 && currentStatusTags[0] === targetTag) {
      skippedNoChange++;
      continue;
    }

    // Remove any OTHER status tags first
    for (const t of currentStatusTags) {
      if (t !== targetTag) {
        await removeTag(sub.id, t);
        console.log(`[removed-old] ${e.pulseName} (${sub.id}) tag="${t}"`);
      }
    }
    // Add the new tag (if not already there)
    if (!currentStatusTags.includes(targetTag)) {
      const r = await addTag(sub.id, targetTag);
      if (r.status === 'success') {
        applied++;
        console.log(`[applied] ${e.pulseName} (${sub.id}) Monday "${e.next}" → Manychat tag "${targetTag}"  (by user ${e.user})`);
      } else {
        errors++;
        console.error(`[err] addTag ${e.pulseName}: ${JSON.stringify(r)}`);
      }
    }
    await new Promise(r => setTimeout(r, 250));
  }

  // Advance state — use the latest event ms we saw, or nowMs if no events
  const latestMs = events.length ? events[events.length - 1].ms : nowMs;
  saveState({ lastProcessedMs: latestMs });

  console.log(`\nDone. applied=${applied} skipped-sync=${skippedSync} skipped-no-change=${skippedNoChange} skipped-no-phone=${skippedNoPhone} skipped-no-sub=${skippedNoSub} errors=${errors}`);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
