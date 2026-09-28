/* ==========================================================================
   sync.js — синхронізація між пристроями через Firebase (Firestore + вхід Google).

   Як це працює:
   • Локальні дані, як і раніше, живуть у браузері (IndexedDB) — сайт працює
     й без інтернету. Firebase — спільна «хмарна копія».
   • Кожен запис — документ users/{uid}/records/{сховище~id} з полями:
       s  — сховище (tasks, accounts…) або 'settings';   id — id запису / ключ
       j  — запис у JSON;   u — час зміни (updatedAt);   del — видалено назавжди
       _ts — час запису на сервері (для отримання лише нових змін).
   • Локальна зміна → позначка «не надіслано» (переживає перезавантаження) →
     пакетний запис у Firestore. Зміни з інших пристроїв приходять через
     слухача (onSnapshot) лише ті, що новіші за останню отриману (_ts).
   • Конфлікт: перемагає новіша версія (за updatedAt).
   • Вкладені файли НЕ синхронізуються (Firebase Storage потребує платного тарифу).
   • Google Календар: синхронізуються Client ID і вибір календарів; вхід у Google —
     на кожному пристрої свій (ключ доступу діє ~годину й не передається).
   • Вхід Google працює лише з адреси сайту (GitHub Pages, localhost), не з file://.
   ========================================================================== */
window.CRM = window.CRM || {};

(function (CRM) {
  'use strict';

  const { h, ui } = { h: CRM.ui.h, ui: CRM.ui };
  const CFG = CRM.SYNC_CONFIG;
  const STORES = ['tasks', 'accounts', 'transactions', 'categories', 'recurring', 'goals', 'workouts', 'courses'];
  // gcal — лише Client ID і вибір календарів; ключ доступу Google (gcalToken) на кожному пристрої свій
  const SETTINGS = ['profile', 'accent', 'trainingProgram', 'trainingProfile', 'gcal'];
  const LS = 'crm.sync.';
  const BATCH = 400;
  const FLUSH_DELAY = 1200;

  let fb = null;
  let sdkPromise = null;
  let auth = null;
  let db = null;
  let user = null;           // { uid, email, name }
  let authResolved = false;
  let phase = 'idle';        // idle | connecting | syncing | on | error
  let lastError = null;      // { text, code }
  let lastSyncAt = null;
  let unsubscribe = null;
  let flushTimer = null;
  let flushing = null;
  let flushAgain = false;
  let needsReconcile = false;
  let starting = null;

  const pad = (n) => String(n).padStart(2, '0');
  const isFile = () => location.protocol === 'file:';
  const online = () => navigator.onLine !== false;

  // ---------- Службові дані цього пристрою (localStorage) ----------
  function lsGet(k, def) {
    try { const v = localStorage.getItem(LS + k); return v == null ? def : JSON.parse(v); } catch (e) { return def; }
  }
  function lsSet(k, v) {
    try { if (v == null) localStorage.removeItem(LS + k); else localStorage.setItem(LS + k, JSON.stringify(v)); } catch (e) { /* сховище недоступне */ }
  }
  const getMeta = (uid) => lsGet('meta.' + uid, {}) || {};
  const setMeta = (uid, m) => lsSet('meta.' + uid, m);
  const getDirty = (uid) => lsGet('dirty.' + uid, {}) || {};
  const setDirty = (uid, d) => lsSet('dirty.' + uid, Object.keys(d).length ? d : null);
  function markDirty(uid, keys) {
    if (!uid || !keys.length) return;
    const d = getDirty(uid);
    keys.forEach((k) => { d[k] = (d[k] || 0) + 1; });
    setDirty(uid, d);
  }
  const pendingCount = () => (user ? Object.keys(getDirty(user.uid)).length : 0);

  function err(code, text) { const e = new Error(text || code); e.code = code; return e; }
  function changed(detail) { document.dispatchEvent(new CustomEvent('crm:syncchange', { detail: detail || {} })); }

  /** file | off | connecting | syncing | on | offline | error */
  function status() {
    if (isFile()) return 'file';
    if (phase === 'error') return 'error';
    if (!user) return (phase === 'connecting' || (lsGet('enabled', false) && !authResolved)) ? 'connecting' : 'off';
    if (!online()) return 'offline';
    if (phase === 'syncing' || flushing || pendingCount()) return 'syncing';
    return 'on';
  }

  // ---------- Завантаження Firebase ----------
  function loadScript(src, integrity) {
    return new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src;
      s.crossOrigin = 'anonymous';
      if (integrity) s.integrity = integrity;
      s.onload = resolve;
      s.onerror = () => { s.remove(); reject(new Error('load')); };
      document.head.appendChild(s);
    });
  }

  function loadSdk() {
    if (window.firebase && window.firebase.auth && window.firebase.firestore) return Promise.resolve(window.firebase);
    if (sdkPromise) return sdkPromise;
    sdkPromise = (async () => {
      for (const f of CFG.sdkFiles) {
        if (f.name.includes('app-compat') && window.firebase && window.firebase.initializeApp) continue;
        await loadScript(CFG.sdkBase + f.name, f.integrity);
      }
      if (!(window.firebase && window.firebase.auth && window.firebase.firestore)) throw new Error('load');
      return window.firebase;
    })().catch(() => {
      sdkPromise = null;
      throw err('sdk', 'Не вдалося завантажити Firebase. Перевір інтернет або вимкни блокувальник реклами для цього сайту.');
    });
    return sdkPromise;
  }

  async function ensureApp() {
    fb = await loadSdk();
    if (!auth) {
      if (!fb.apps.length) fb.initializeApp(CFG.firebase);
      try { fb.firestore.setLogLevel('silent'); } catch (e) { /* старі версії */ }
      auth = fb.auth();
      db = fb.firestore();
      auth.onAuthStateChanged(onAuth, (e) => handleError(e));
    }
    return fb;
  }

  const recordsCol = (uid) => db.collection('users').doc(uid).collection('records');
  const keyOf = (store, id) => store + '~' + id;
  function splitKey(k) { const i = k.indexOf('~'); return [k.slice(0, i), k.slice(i + 1)]; }
  function tsMax(a, t) {
    if (!t || typeof t.seconds !== 'number') return a;
    if (!a || t.seconds > a[0] || (t.seconds === a[0] && t.nanoseconds > a[1])) return [t.seconds, t.nanoseconds];
    return a;
  }

  // ---------- Вхід / вихід ----------
  function onAuth(u) {
    authResolved = true;
    if (u) {
      const isNew = !user || user.uid !== u.uid;
      user = { uid: u.uid, email: u.email || '', name: u.displayName || '' };
      lsSet('enabled', true);
      lsSet('lastUid', u.uid);
      if (isNew) start();
    } else {
      stopListener();
      user = null;
      if (phase !== 'error') phase = 'idle';
    }
    changed();
  }

  function authErrorText(e) {
    const code = (e && e.code) || '';
    switch (code) {
      case 'auth/popup-blocked': return 'Браузер заблокував вікно входу Google. Натисни «Увійти через Google» ще раз; якщо не допоможе — дозволь спливні вікна для цього сайту (значок праворуч в адресному рядку).';
      case 'auth/popup-closed-by-user':
      case 'auth/cancelled-popup-request':
      case 'auth/user-cancelled': return null;
      case 'auth/unauthorized-domain': return `Адресу ${location.hostname} не додано у Firebase. Відкрий консоль Firebase → Authentication → Settings → Authorized domains → Add domain і впиши ${location.hostname}.`;
      case 'auth/operation-not-allowed': return 'Вхід через Google не ввімкнено у Firebase: Authentication → Sign-in method → Google → Enable.';
      case 'auth/network-request-failed': return 'Немає звʼязку з Google. Перевір інтернет і спробуй ще раз.';
      case 'auth/operation-not-supported-in-this-environment': return 'Вхід не працює, коли сайт відкрито як файл. Відкрий CRM на GitHub Pages або через локальний сервер.';
      default: return 'Не вдалося увійти' + (code ? ` (${code})` : '') + '. Спробуй ще раз.';
    }
  }

  async function signIn() {
    if (isFile()) {
      ui.toast('Синхронізація працює лише на GitHub Pages або через локальний сервер — не при відкритті файлу.', { type: 'error', duration: 7000 });
      return false;
    }
    try {
      phase = 'connecting';
      lastError = null;
      changed();
      await ensureApp();
      const provider = new fb.auth.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      await auth.signInWithPopup(provider);
      return true;
    } catch (e) {
      const text = e.code === 'sdk' ? e.message : authErrorText(e);
      phase = user ? phase : 'idle';
      if (text) { lastError = { text, code: e.code }; ui.toast(text, { type: 'error', duration: 9000 }); }
      changed();
      return false;
    }
  }

  async function signOut() {
    const n = pendingCount();
    const ok = await ui.confirm({
      title: 'Вимкнути синхронізацію на цьому пристрої?',
      message: (n ? `Ще ${n} ${CRM.fmt.plural(n, ['зміну', 'зміни', 'змін'])} не надіслано — спробую надіслати зараз. ` : '') +
        'Дані на цьому пристрої залишаться. Нові зміни не потраплятимуть у хмару, доки не ввійдеш знову (тоді дані обʼєднаються).',
      confirmText: 'Вийти'
    });
    if (!ok) return false;
    try { await Promise.race([flush(), new Promise((r) => setTimeout(r, 4000))]); } catch (e) { /* не критично */ }
    const uid = user && user.uid;
    stopListener();
    if (uid) { const m = getMeta(uid); m.merge = true; setMeta(uid, m); setDirty(uid, {}); }
    lsSet('enabled', false);
    try { if (auth) await auth.signOut(); } catch (e) { /* вже вийшли */ }
    user = null;
    phase = 'idle';
    lastError = null;
    changed();
    ui.toast('Синхронізацію вимкнено на цьому пристрої');
    return true;
  }

  // ---------- Запуск синхронізації ----------
  function start() {
    if (starting) return starting;
    starting = (async () => {
      const uid = user.uid;
      stopListener();
      phase = 'syncing';
      changed();
      try {
        const meta = getMeta(uid);
        if (!meta.init || meta.merge) {
          const ok = await initialSync(uid, meta);
          if (!ok) return;
        }
        if (!user || user.uid !== uid) return;
        listen(uid);
        phase = 'on';
        lastError = null;
        await flush();
      } catch (e) {
        handleError(e);
      } finally {
        starting = null;
        changed();
      }
    })();
    return starting;
  }

  function hasMeaningfulLocal() {
    if (STORES.filter((n) => n !== 'categories').some((n) => CRM.store.list(n).length)) return true;
    const p = CRM.store.getSetting('profile', null);
    if (p && (p.name || p.email || p.phone)) return true;
    return !!(CRM.store.getSetting('trainingProgram', null) || CRM.store.getSetting('trainingProfile', null));
  }

  function localKeys() {
    const keys = [];
    STORES.forEach((n) => CRM.store.list(n, { deleted: 'all' }).forEach((r) => keys.push(keyOf(n, r.id))));
    SETTINGS.forEach((k) => { if (CRM.store.getSetting(k, undefined) !== undefined) keys.push(keyOf('settings', k)); });
    return keys;
  }

  function askMode(count) {
    return new Promise((resolve) => {
      let answered = false;
      const done = (v) => { if (answered) return; answered = true; dlg.close('force'); resolve(v); };
      const dlg = ui.modal({
        title: 'У хмарі вже є дані',
        body: h('div', { class: 'stack', style: { gap: '12px' } },
          h('p', { class: 'modal-text' }, `У хмарі збережено ${CRM.fmt.count(count, ['запис', 'записи', 'записів'])}, і на цьому пристрої теж є дані. Що зробити?`),
          h('ul', { class: 'sync-choice' },
            h('li', null, h('strong', null, 'Взяти з хмари'), ' — дані цього пристрою буде замінено хмарними. Підходить, якщо тут демо-дані або старі записи.'),
            h('li', null, h('strong', null, 'Обʼєднати'), ' — залишаться і хмарні, і локальні записи; однакові — у новішій версії.')),
          h('div', { class: 'callout' }, CRM.icon('info'), h('span', null, 'Якщо сумніваєшся — скасуй і спершу зроби експорт у «Моєму кабінеті».'))),
        footer: h('div', { class: 'btn-row sync-choice-actions' },
          ui.button({ label: 'Скасувати', onClick: () => done(null) }),
          ui.button({ label: 'Обʼєднати', onClick: () => done('merge') }),
          ui.button({ label: 'Взяти з хмари', variant: 'primary', onClick: () => done('replace') })),
        onClose: () => { if (!answered) { answered = true; resolve(null); } }
      });
    });
  }

  /** Перший обмін на пристрої (або після повторного входу). Повертає false, якщо користувач скасував. */
  async function initialSync(uid, meta) {
    const snap = await recordsCol(uid).get();
    let pull = meta.pull || null;
    const remote = [];
    snap.docs.forEach((d) => { const x = d.data(); pull = tsMax(pull, x._ts); remote.push(x); });
    const live = remote.filter((x) => !x.del && (STORES.includes(x.s) || (x.s === 'settings' && SETTINGS.includes(x.id))));

    let mode;
    if (!live.length) mode = 'upload';
    else if (meta.merge) mode = 'merge';
    else if (!hasMeaningfulLocal()) mode = 'replace';
    else {
      phase = 'on';
      changed();
      mode = await askMode(live.length);
      if (!mode) {
        stopListener();
        lsSet('enabled', false);
        try { await auth.signOut(); } catch (e) { /* ігноруємо */ }
        user = null;
        phase = 'idle';
        ui.toast('Вхід скасовано — дані на пристрої не змінено');
        return false;
      }
      phase = 'syncing';
      changed();
    }

    if (mode === 'replace') {
      const byStore = {};
      STORES.forEach((n) => { byStore[n] = []; });
      const kv = {};
      live.forEach((x) => {
        const val = JSON.parse(x.j);
        if (x.s === 'settings') kv[x.id] = val; else byStore[x.s].push(val);
      });
      await CRM.store.replaceSynced(STORES, byStore, SETTINGS, kv);
      setDirty(uid, {});
      ui.toast('Дані отримано з хмари', { type: 'success' });
    } else if (mode === 'merge') {
      const items = [];
      const dirty = [];
      const seen = new Set();
      remote.forEach((x) => {
        const k = keyOf(x.s, x.id);
        seen.add(k);
        if (x.s === 'settings') {
          if (!SETTINGS.includes(x.id) || x.del) return;
          if (CRM.store.getSetting(x.id, undefined) === undefined) items.push({ setting: x.id, value: JSON.parse(x.j) });
          else dirty.push(k);
          return;
        }
        if (!STORES.includes(x.s)) return;
        const local = CRM.store.get(x.s, x.id);
        const lu = (local && local.updatedAt) || '';
        if (x.del) {
          if (local && lu <= (x.u || '')) items.push({ store: x.s, id: x.id, del: true });
          else if (local) dirty.push(k);
          return;
        }
        if (!local || lu < (x.u || '')) items.push({ store: x.s, rec: JSON.parse(x.j) });
        else if (lu > (x.u || '')) dirty.push(k);
      });
      localKeys().forEach((k) => { if (!seen.has(k)) dirty.push(k); });
      await CRM.store.applyRemote(items);
      markDirty(uid, dirty);
    } else {
      markDirty(uid, localKeys());
    }
    meta.init = true;
    meta.merge = false;
    meta.pull = pull;
    setMeta(uid, meta);
    lastSyncAt = new Date();
    return true;
  }

  // ---------- Отримання змін з інших пристроїв ----------
  function remoteItem(x) {
    if (x.s === 'settings') {
      if (!SETTINGS.includes(x.id)) return null;
      const val = x.del ? undefined : JSON.parse(x.j);
      if (JSON.stringify(CRM.store.getSetting(x.id, undefined)) === JSON.stringify(val)) return null;
      if (user && getDirty(user.uid)[keyOf('settings', x.id)]) return null; // локальна зміна ще не надіслана
      return { setting: x.id, value: val };
    }
    if (!STORES.includes(x.s)) return null;
    const local = CRM.store.get(x.s, x.id);
    const lu = (local && local.updatedAt) || '';
    if (x.del) return local && lu <= (x.u || '') ? { store: x.s, id: x.id, del: true } : null;
    if (local && lu >= (x.u || '')) return null;
    return { store: x.s, rec: JSON.parse(x.j) };
  }

  function listen(uid) {
    stopListener();
    const meta = getMeta(uid);
    let q = recordsCol(uid);
    if (meta.pull) q = q.where('_ts', '>', new fb.firestore.Timestamp(meta.pull[0], meta.pull[1]));
    unsubscribe = q.onSnapshot((snap) => {
      const items = [];
      let pull = getMeta(uid).pull || null;
      snap.docChanges().forEach((c) => {
        if (c.type === 'removed') return;
        const d = c.doc;
        if (d.metadata.hasPendingWrites) return;
        const x = d.data();
        if (!x || !x._ts) return;
        pull = tsMax(pull, x._ts);
        try { const it = remoteItem(x); if (it) items.push(it); } catch (e) { /* пошкоджений запис — пропускаємо */ }
      });
      const m = getMeta(uid);
      m.pull = pull;
      setMeta(uid, m);
      lastSyncAt = new Date();
      if (phase === 'error') { phase = 'on'; lastError = null; }
      const apply = items.length ? CRM.store.applyRemote(items) : Promise.resolve();
      apply.then(() => { if (items.length) CRM.notify.runRules(); changed({ quiet: true }); }, (e) => console.error(e));
    }, (e) => handleError(e));
  }

  function stopListener() {
    if (unsubscribe) { try { unsubscribe(); } catch (e) { /* ігноруємо */ } }
    unsubscribe = null;
  }

  // ---------- Надсилання локальних змін ----------
  function docFor(k, now, ts) {
    const [s, id] = splitKey(k);
    if (s === 'settings') {
      const v = CRM.store.getSetting(id, undefined);
      return v === undefined ? { s, id, del: true, u: now, _ts: ts } : { s, id, j: JSON.stringify(v), u: now, del: false, _ts: ts };
    }
    const rec = CRM.store.get(s, id);
    return rec ? { s, id, j: JSON.stringify(rec), u: rec.updatedAt || now, del: false, _ts: ts } : { s, id, del: true, u: now, _ts: ts };
  }

  /** Після імпорту, демо-даних чи очищення: хмара має стати точною копією цього пристрою. */
  async function reconcile(uid) {
    await CRM.store.touchAll(STORES);
    const snap = await recordsCol(uid).get();
    const local = new Set(localKeys());
    const extra = [];
    snap.docs.forEach((d) => { const x = d.data(); if (!x.del && !local.has(d.id)) extra.push(d.id); });
    markDirty(uid, Array.from(local).concat(extra));
  }

  function scheduleFlush(delay) {
    clearTimeout(flushTimer);
    flushTimer = setTimeout(() => { flushTimer = null; flush(); }, delay == null ? FLUSH_DELAY : delay);
  }

  async function flush() {
    if (!user || !db || phase === 'error' || starting && phase === 'syncing' && !getMeta(user.uid).init) return;
    if (flushing) { flushAgain = true; return flushing; }
    const uid = user.uid;
    flushing = (async () => {
      if (needsReconcile) { needsReconcile = false; await reconcile(uid); }
      const snapshot = getDirty(uid);
      const keys = Object.keys(snapshot);
      if (!keys.length) return;
      changed({ quiet: true });
      const col = recordsCol(uid);
      const ts = fb.firestore.FieldValue.serverTimestamp();
      const now = new Date().toISOString();
      for (let i = 0; i < keys.length; i += BATCH) {
        const part = keys.slice(i, i + BATCH);
        const b = db.batch();
        part.forEach((k) => b.set(col.doc(k), docFor(k, now, ts)));
        await b.commit();
        const cur = getDirty(uid);
        part.forEach((k) => { if (cur[k] === snapshot[k]) delete cur[k]; });
        setDirty(uid, cur);
      }
      lastSyncAt = new Date();
    })();
    try {
      await flushing;
    } catch (e) {
      handleError(e);
    } finally {
      flushing = null;
      if (flushAgain) { flushAgain = false; scheduleFlush(300); }
      changed({ quiet: true });
    }
  }

  // ---------- Помилки ----------
  function handleError(e) {
    const code = (e && e.code) || '';
    const msg = String((e && e.message) || '');
    if (code === 'unavailable' || code === 'auth/network-request-failed') {
      changed({ quiet: true }); // без мережі: дані чекають і надішлються пізніше
      return;
    }
    let text;
    if (code === 'permission-denied') text = 'Firebase не дає доступу до даних. Перевір, що у Firestore → Rules вставлено правила з README (розділ «Синхронізація») і натиснуто Publish.';
    else if (code === 'not-found' || code === 'failed-precondition' || /does not exist|not found/i.test(msg)) text = 'Базу даних Firestore ще не створено: консоль Firebase → Firestore Database → Create database.';
    else if (code === 'unauthenticated') text = 'Сеанс входу закінчився — увійди ще раз.';
    else if (code === 'sdk') text = e.message;
    else text = 'Помилка синхронізації' + (code ? ` (${code})` : '') + '. Спробуй «Синхронізувати зараз».';
    phase = 'error';
    lastError = { text, code };
    stopListener();
    changed();
  }

  /** «Синхронізувати зараз»: перезапуск слухача й надсилання змін. */
  async function syncNow() {
    if (!user) return signIn();
    phase = 'syncing';
    lastError = null;
    changed();
    await start();
    if (phase !== 'error') ui.toast('Синхронізовано', { type: 'success' });
  }

  // ---------- Гачок локальних змін ----------
  CRM.store.setSyncHook((ev) => {
    const uid = user ? user.uid : (lsGet('enabled', false) ? lsGet('lastUid', null) : null);
    if (!uid) return;
    if (ev.kind === 'reset') {
      needsReconcile = true;
    } else if (ev.kind === 'setting') {
      if (!SETTINGS.includes(ev.key)) return;
      markDirty(uid, [keyOf('settings', ev.key)]);
    } else if (STORES.includes(ev.store)) {
      const ids = ev.recs ? ev.recs.map((r) => r.id) : ev.ids;
      markDirty(uid, ids.map((id) => keyOf(ev.store, id)));
    } else {
      return;
    }
    if (user) scheduleFlush();
  });

  // ---------- Блок у «Моєму кабінеті» ----------
  function timeLabel(d) { if (!d) return ''; const p = CRM.date.kyivParts(d); return `${pad(p.hh)}:${pad(p.mm)}`; }

  function settingsBlock() {
    const head = h('div', { class: 'setting-row' });
    const body = h('div', { class: 'svc-body' });
    const block = h('div', { class: 'svc-block sync-block', id: 'sync' }, head, body);
    const BADGE = {
      file: ['badge-warning', 'недоступно з файлу'], off: ['', 'вимкнено'], connecting: ['', 'підключення…'],
      syncing: ['badge-accent', 'синхронізація…'], on: ['badge-success', 'синхронізовано'], offline: ['badge-warning', 'без мережі'], error: ['badge-danger', 'помилка']
    };

    function render() {
      const s = status();
      const b = BADGE[s];
      const actions = [];
      if (s === 'off' || s === 'file' || (s === 'error' && !user)) {
        const btn = ui.button({ label: 'Увійти через Google', icon: 'user', variant: 'primary', size: 'sm', disabled: s === 'file', onClick: () => signIn() });
        // Firebase (~200 КБ) вантажимо, щойно видно намір увійти, — щоб вікно входу не заблокувалось
        const preload = () => { if (!isFile()) loadSdk().catch(() => {}); };
        ['pointerenter', 'focus', 'touchstart'].forEach((ev) => btn.addEventListener(ev, preload, { once: true, passive: true }));
        actions.push(btn);
      } else if (s === 'connecting') {
        actions.push(ui.button({ label: 'Підключення…', size: 'sm', disabled: true }));
      } else {
        actions.push(ui.button({ label: 'Синхронізувати зараз', icon: 'refresh', size: 'sm', disabled: s === 'syncing', onClick: () => syncNow() }));
        actions.push(ui.button({ label: 'Вийти', size: 'sm', onClick: () => signOut() }));
      }
      ui.mount(head,
        h('div', { class: 'setting-text' },
          h('div', { class: 'setting-title' }, CRM.icon('refresh', { size: 'sm' }), 'Синхронізація між пристроями', h('span', { class: 'badge ' + b[0], 'data-status': s }, b[1])),
          h('div', { class: 'setting-desc' }, 'Задачі, бюджет, тренування, навчання й профіль — однакові на компʼютері й телефоні. Вхід через Google, дані в Firebase.')),
        h('div', { class: 'setting-actions' }, actions));

      const parts = [];
      if (s === 'file') {
        parts.push(h('div', { class: 'callout callout-warning' }, CRM.icon('alert'),
          h('span', null, h('strong', null, 'Сайт відкрито як файл.'), ' Вхід Google працює лише зі справжньої адреси сайту — відкрий CRM на GitHub Pages або через локальний сервер.')));
      }
      if (user) {
        const n = pendingCount();
        parts.push(h('div', { class: 'svc-info' },
          h('div', null, `Акаунт: ${user.email || user.name || 'Google'}`),
          h('div', null, (lastSyncAt ? `Останній обмін о ${timeLabel(lastSyncAt)}.` : 'Обмін ще не відбувся.') +
            (n ? ` Очікують надсилання: ${n}.` : ' Усі зміни надіслано.'))));
      }
      if (s !== 'file') {
        parts.push(h('div', { class: 'svc-info' },
          h('div', null, 'Дані й далі зберігаються на пристрої, тож CRM працює й без інтернету — зміни надішлються, щойно зʼявиться звʼязок.'),
          h('div', null, 'Вкладені файли не синхронізуються — вони лишаються на пристрої, де їх додали.'),
          h('div', null, 'Налаштування Firebase — у README, розділ «Синхронізація».')));
      }
      if (lastError) parts.push(h('div', { class: 'callout callout-warning svc-error', role: 'alert' }, CRM.icon('alert'), h('span', null, lastError.text)));
      ui.mount(body, parts);
    }
    render();
    const onChange = () => render();
    document.addEventListener('crm:syncchange', onChange);
    block._destroy = () => document.removeEventListener('crm:syncchange', onChange);
    return block;
  }

  // ---------- Запуск ----------
  function init() {
    if (isFile()) return;
    if (lsGet('enabled', false)) {
      phase = 'connecting';
      ensureApp().catch((e) => handleError(e));
    }
    window.addEventListener('online', () => { changed(); if (user && phase !== 'error') { if (!unsubscribe) start(); else flush(); } });
    window.addEventListener('offline', () => changed());
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && user) { clearTimeout(flushTimer); flush(); } });
    document.addEventListener('crm:minute', () => { if (user && phase === 'on' && pendingCount() && !flushing) flush(); });
  }

  CRM.sync = {
    init, status, signIn, signOut, syncNow, flush, settingsBlock,
    STORES, SETTINGS, get user() { return user; }, pendingCount
  };
})(window.CRM);
