// Paste this into the Manychat browser tab's DevTools Console.
// The daemon injects it automatically.
// State persists in localStorage.
(() => {
  if (window.__LABEL_SYNC_INTERVAL__) clearInterval(window.__LABEL_SYNC_INTERVAL__);

  const PAGE_ID = 'fb4064211';
  const POLL_MS = 10_000;
  // Each poll pulls up to this many threads per label. Raise if labels have more simultaneous contacts.
  const PULL_LIMIT = 200;
  const MAKE_WEBHOOK_URL = 'https://hook.eu2.make.com/nzj7gzx0ikit78u597mfvja32h5273yn';
  // makeTag: the value Make.com filters expect (matches Manychat Flow last_tag values)
  const LABEL_TO_TAG = {
    15584: { label: 'ליד חם',              tagId: 84327054, tagName: 'ליד חם',              makeTag: 'ליד חם' },
    14307: { label: 'לחזור לליד',          tagId: 84327084, tagName: 'לחזור לליד',          makeTag: 'לחזור לליד' },
    14308: { label: 'לקוח סגר',            tagId: 84327142, tagName: 'לקוח סגר',            makeTag: 'לקוח סגר' },
    2396:  { label: 'ליד רציני מונדיאל',   tagId: 84327069, tagName: 'ליד רציני מונדיאל',   makeTag: 'ליד חם מונדיאל' },
    15582: { label: 'ליד רציני',           tagId: 84327116, tagName: 'ליד רציני',            makeTag: 'מחכים לתשלום' },
    [-2]:  { label: 'ליד רציני הפועות',    tagId: 84327078, tagName: 'ליד רציני הופעות',     makeTag: 'ליד חם הופעות' },
  };

  const csrf = () => window.__INIT__['app.csrf_token'];
  const mcFetch = (path, opts = {}) => fetch(`/${PAGE_ID}${path}`, {
    method: opts.method || 'GET', credentials: 'include',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest', 'X-CSRF-TOKEN': csrf() },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const loadThreads = (labelId) => mcFetch('/im/loadThreads', {
    method: 'POST',
    body: { limit: PULL_LIMIT, sorting: 'newest', filter: { operator: 'AND', groups: [{ operator: 'AND', items: [{ type: 'label', field: 'label', operator: 'IS', value: Number(labelId) }] }] } }
  }).then(r => r.json()).then(d => d.threads || []);
  const removeTag = (u, t) => mcFetch('/subscribers/removeTag', { method: 'POST', body: { user_id: String(u), tag_id: t } });
  const addTag = (u, t) => mcFetch('/subscribers/addTag', { method: 'POST', body: { user_id: String(u), tag_id: t } });
  const forceFire = async (u, t) => { await removeTag(u, t); await new Promise(r => setTimeout(r, 250)); return addTag(u, t); };

  // State model: for each label, a Set of user_ids currently carrying that label.
  // On each poll, compute the current Set; any user_id in current-but-not-previous was JUST labelled → fire tag.
  const STATE_KEY = '__MC_LABEL_SYNC_STATE_V2__';
  const loadState = () => {
    try {
      const s = JSON.parse(localStorage.getItem(STATE_KEY)) || { userIdsByLabel: {}, seeded: false };
      // Migrate old shape if present
      if (!s.userIdsByLabel) s.userIdsByLabel = {};
      return s;
    } catch { return { userIdsByLabel: {}, seeded: false }; }
  };
  const saveState = (s) => localStorage.setItem(STATE_KEY, JSON.stringify(s));

  window.__LABEL_SYNC_LOG__ = window.__LABEL_SYNC_LOG__ || [];
  const log = (msg) => {
    const t = new Date().toISOString().slice(11, 19);
    window.__LABEL_SYNC_LOG__.push(`[${t}] ${msg}`);
    console.log('%c[LabelSync]', 'color: #ff5ac4', msg);
    if (window.__LABEL_SYNC_LOG__.length > 500) window.__LABEL_SYNC_LOG__.shift();
  };

  const pollOnce = async () => {
    const state = loadState();
    let fired = 0;
    for (const [labelIdStr, meta] of Object.entries(LABEL_TO_TAG)) {
      const labelId = Number(labelIdStr);
      try {
        const threads = await loadThreads(labelId);
        const currentIds = threads.map(t => String(t.user_id));
        const prevIds = new Set(state.userIdsByLabel[labelId] || []);
        const nameByUid = {};
        for (const t of threads) nameByUid[String(t.user_id)] = t.user?.name || String(t.user_id);

        if (state.seeded) {
          const newlyLabelled = currentIds.filter(uid => !prevIds.has(uid));
          for (const uid of newlyLabelled) {
            log(`Label "${meta.label}" on ${nameByUid[uid]} → firing Tag ${meta.tagName}`);
            try {
              await forceFire(uid, meta.tagId);
              // Get subscriber phone and send webhook directly to Make (bypass Manychat Flows)
              try {
                const sub = await mcFetch(`/subscribers/${uid}`, { method: 'GET' }).then(r => r.json());
                const phone = sub.user?.wa_id || sub.user?.phone || '';
                if (phone) {
                  const phoneNorm = phone.startsWith('+') ? phone : (phone.startsWith('0') ? '+972' + phone.slice(1) : '+' + phone);
                  await fetch(MAKE_WEBHOOK_URL, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ phone: phoneNorm, tag: meta.makeTag })
                  });
                  log(`  → webhook sent to Make (phone=${phoneNorm}, tag=${meta.makeTag})`);
                } else {
                  log(`  → no phone for ${nameByUid[uid]}, skipping webhook`);
                }
              } catch (we) {
                log(`  → webhook failed: ${we.message}`);
              }
              fired++;
            } catch (e) {
              log(`  tag fire failed for ${uid}: ${e.message}`);
            }
          }
        }
        state.userIdsByLabel[labelId] = currentIds;
      } catch (e) {
        log(`Poll error label ${labelId}: ${e.message}`);
      }
    }
    if (!state.seeded) {
      state.seeded = true;
      log(`Seed complete. Tracking ${Object.values(state.userIdsByLabel).reduce((a, b) => a + b.length, 0)} label-contacts across ${Object.keys(LABEL_TO_TAG).length} labels. NEW labels applied from now on will sync.`);
    }
    saveState(state);
    return fired;
  };

  log('Polling every 10s. Keep this tab open for the sync to run.');
  pollOnce().then(n => n > 0 && log(`↳ ${n} fire${n === 1 ? '' : 's'}`));
  window.__LABEL_SYNC_INTERVAL__ = setInterval(async () => {
    const n = await pollOnce();
    if (n > 0) log(`↳ ${n} fire${n === 1 ? '' : 's'}`);
  }, POLL_MS);
})();
