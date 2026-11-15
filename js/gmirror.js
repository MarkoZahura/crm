/* ==========================================================================
   gmirror.js — дублювання подій CRM у Google Календар (пункт 12, доробка; 2026.11.15-5).

   CRM — головний календар. Кожна своя подія CRM (крім уроків «Репетиторства» — їх
   звʼяже з «Заняття …» у Google етап 2) має копію в основному календарі Google.
   • Увімкнення — «Мій кабінет» → «Google Календар» → «Дублювати мої події в Google».
     Налаштування gcal.mirror { on, cal, since, sinceTs } (синхронізується разом із gcal):
     копіюються події, що ще не минули на момент увімкнення (серії, що тривають, — цілком),
     і все, що створено після нього. Подія з копією дублюється й далі, хоч куди її перенести.
   • Запис події має службове поле gsync { cal, id, h, mh, rec, ov, at, n, del?, gone?, goneDates? }:
     де копія, відбиток надісланого (h — уся подія, mh — головна подія серії), чи це серія (rec),
     відбитки окремо змінених днів серії (ov), коли надіслано (at), лічильник надсилань (n). Подія змінилась — відбиток
     інший → PATCH копії; видалена (Кошик) — DELETE; повернули з Кошика — копія повертається.
     gsync зберігається з updatedAt + 1 мс (store.saveKeep) — щоб не перекрити справжню зміну
     з іншого пристрою, але дійти до них синхронізацією.
   • id копії — з id події CRM: «crm» + hex (base32hex, як вимагає Google) — два пристрої не
     створять двох копій; копія ще й позначена extendedProperties.private.crmId і в CRM не
     показується (gcal.js isCopy).
   • Серія → одна подія Google з RRULE (щомісяця на 29–31 — BYMONTHDAY=28..N;BYSETPOS=-1, як
     у CRM: у коротшому місяці — останній день); скасовані дні (skip) — EXDATE; змінені окремо
     дні (overrides) — PATCH відповідного заняття (events.instances з originalStart).
   • Надсилає сама сторінка (сервера немає): потрібен доступ Google (≈1 год). Без нього зміни
     чекають — «Чекають надсилання в Google: N · Надіслати» — і йдуть, щойно доступ є.
   • Зміни копії в самому Google (час, дата, назва, опис) CRM бере собі після оновлення подій
     Google (≈10 хв); копію видалили в Google — CRM питає: «Видалити в CRM» / «Повернути в Google».
   • Нагадування: копія несе нагадування CRM (popup) — нагадує Google (телефон), CRM показує
     таке нагадування лише в дзвіночку, без системного сповіщення (calendar.js, quiet).
   ========================================================================== */
window.CRM = window.CRM || {};

(function (CRM) {
  'use strict';

  const { h, ui } = { h: CRM.ui.h, ui: CRM.ui };
  const D = CRM.date;
  const TZ = 'Europe/Kiev';
  const BATCH = 10;
  const BYDAY = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];   // 0 — понеділок, як у CRM
  const FREQ_TO = { day: 'DAILY', week: 'WEEKLY', month: 'MONTHLY', year: 'YEARLY' };
  const STOP = ['expired', 'scope', 'network', 'rate', 'api-disabled'];

  const G = () => CRM.gcal;
  const C = () => CRM.calendar;

  let running = null;
  let again = false;
  let timer = null;
  let pullP = null;     // звірка, що йде зараз
  let lastPull = '';
  let idMap = null;
  const state = { total: 0, done: 0, error: null, failed: {}, progress: null };
  let known = null;   // id події → { cal, id } її живої копії (щоб помітити копії, на які вже ніщо не вказує)
  const lastN = new Map();    // id події → найбільший лічильник надсилань gsync.n, який бачили
  const force = new Set();    // події, gsync яких «повернувся в минуле» («Скасувати» відновило старий запис) — надіслати знову

  // ---------- Копії, на які більше не вказує жодна подія (видалено назавжди, «Скасувати» після розділення серії…) ----------
  const LS_ORPHANS = 'crm.gmirror.orphans';
  const LS_DELETED = 'crm.gmirror.deleted';
  function lsList(key) { try { const v = JSON.parse(localStorage.getItem(key) || '[]'); return Array.isArray(v) ? v : []; } catch (e) { return []; } }
  function lsPut(key, list) { try { localStorage.setItem(key, JSON.stringify(list.slice(-500))); } catch (e) { /* не критично */ } }
  function addOrphan(v) {
    if (!v || !v.id || lsList(LS_DELETED).includes(v.id)) return;
    const list = lsList(LS_ORPHANS);
    if (!list.some((x) => x.id === v.id)) { list.push({ cal: v.cal, id: v.id }); lsPut(LS_ORPHANS, list); }
  }
  /** Ця копія видалена звідси (не людиною в Google) — «немає в Google» тоді не питаємо. */
  function markDeleted(id) { const l = lsList(LS_DELETED); if (!l.includes(id)) { l.push(id); lsPut(LS_DELETED, l); } }
  const deletedByUs = (id) => lsList(LS_DELETED).includes(id);
  function liveCopies() {
    const m = new Map();
    CRM.store.list('events', { deleted: 'all' }).forEach((ev) => { const g = ev.gsync; if (g && g.id && !g.del) m.set(ev.id, { cal: g.cal, id: g.id }); });
    return m;
  }
  /** «Скасувати» в Календарі відновлює старий запис разом зі старим gsync — тоді CRM не знала б, що в Google інше. */
  /** Наступний лічильник надсилань (більший за все, що бачили для цієї події). */
  const nextN = (id, g) => Math.max((g && g.n) || 0, lastN.get(id) || 0) + 1;
  function trackRollbacks(seed) {
    CRM.store.list('events', { deleted: 'all' }).forEach((ev) => {
      const n = ev.gsync && ev.gsync.n;
      if (!n) return;
      const prev = lastN.get(ev.id);
      if (!seed && prev && n < prev) force.add(ev.id);
      if (!prev || n > prev) lastN.set(ev.id, n);
    });
  }
  function trackCopies() {
    trackRollbacks(false);
    const now = liveCopies();
    if (known && on()) {
      known.forEach((v, evId) => {
        const rec = CRM.store.get('events', evId);
        const g = rec && rec.gsync;
        if (!rec) { addOrphan(v); return; }                          // подію видалено назавжди
        if (g && g.id === v.id) return;                              // та сама копія (жива чи видалена нами)
        if (g && g.id && g.id !== v.id && !g.del) addOrphan(v);     // тепер у події інша копія
      });
    }
    known = now;
  }
  async function dropOrphans() {
    const list = lsList(LS_ORPHANS);
    if (!list.length) return;
    const live = new Set(Array.from(liveCopies().values()).map((v) => v.id));
    const left = [];
    for (const v of list) {
      if (live.has(v.id)) continue;   // на цю копію знову вказує подія (напр., «Скасувати») — не чіпаємо
      try { await del(v.cal, v.id); } catch (e) { if (STOP.includes(e.code)) { left.push(v); continue; } }
    }
    lsPut(LS_ORPHANS, left);
  }

  // ---------- Налаштування ----------
  function mcfg() {
    const g = CRM.store.getSetting('gcal', null) || {};
    return g.mirror && typeof g.mirror === 'object' ? g.mirror : null;
  }
  /** Дублювання ввімкнено й Google підключено (на цьому пристрої може бути без доступу — тоді зміни чекають). */
  function on() {
    const m = mcfg();
    return !!(m && m.on && G() && !G().isFile() && G().cfg().wanted && C());
  }
  function changed() { document.dispatchEvent(new CustomEvent('crm:gcalchange', { detail: { mirror: true } })); }

  // ---------- id копії ----------
  function hexOf(s) { return Array.from(new TextEncoder().encode(String(s))).map((b) => b.toString(16).padStart(2, '0')).join(''); }
  /** id копії в Google: «crm» + id події без дефісів (UUID — уже hex) або hex байтів. Лише a–v і 0–9 (base32hex). */
  function copyId(id) {
    const s = String(id || '').toLowerCase();
    const core = /^[0-9a-f-]+$/.test(s) && s.replace(/-/g, '').length >= 4 ? s.replace(/-/g, '') : hexOf(id);
    return 'crm' + core;
  }
  /** Новий id (коли старий зайнятий видаленою копією чи серію перетворили на окрему подію). */
  function freshId(id) { return copyId(id) + 'v' + Date.now().toString(32); }

  /** id події CRM за id копії в Google (для занять серії, у яких може не бути crmId). */
  function crmIdOf(cal, gid) {
    if (!gid || !/^crm/.test(gid)) return null;
    if (!idMap) {
      idMap = new Map();
      CRM.store.list('events', { deleted: 'all' }).forEach((ev) => { if (ev.gsync && ev.gsync.id) idMap.set(ev.gsync.id, ev.id); });
    }
    return idMap.get(gid) || null;
  }

  // ---------- Яка подія дублюється ----------
  const isAllDay = (v) => !!v.allDay || !v.start;
  const toMin = (hm) => { const m = /^(\d{1,2}):(\d{2})$/.exec(hm || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : 0; };
  /** Тривалість у межах доби (як показує CRM — подія не виходить за 24:00). */
  function durOf(v) {
    const d = Number(v.dur) > 0 ? Number(v.dur) : 60;
    return Math.max(1, Math.min(d, 1440 - toMin(v.start)));
  }
  function lastDate(ev) {
    if (C().isSeries(ev)) {
      const r = C().ruleOf(ev);
      if (!r) return ev.date;
      if (r.until) return r.until;
      if (r.count) { const list = C().seriesDates(ev, ev.date, '9999-12-31'); return list.length ? list[list.length - 1] : ev.date; }
      return '9999-12-31';
    }
    return C().spanEnd(ev) || ev.date;
  }
  /** Чи має ця подія копію в Google: не урок, і або ще не минула на момент увімкнення, або створена після нього, або копія вже є. */
  function eligible(ev, m) {
    if (!ev || ev.studentId || !D.isDate(ev.date)) return false;
    const g = ev.gsync;
    if (g && g.id && !g.del) return true;
    const mm = m || mcfg();
    if (!mm || !mm.on) return false;
    if (mm.sinceTs && ev.createdAt && ev.createdAt >= mm.sinceTs) return true;
    return lastDate(ev) >= (mm.since || D.today());
  }

  // ---------- Як копія має виглядати ----------
  /** Колір копії: свій колір Google категорії («Категорії подій» → «G») або найближчий до кольору категорії. */
  function colorFor(cat) {
    const c = C().categoryOf(cat);
    if (c && c.gcolor) return c.gcolor;
    const def = c && CRM.dict.get('categoryColors', c.color);
    return def ? G().nearestColor(def.light) : null;
  }
  function remBody(v) {
    if (isAllDay(v) || v.remind == null || v.remind === '' || !Number.isFinite(Number(v.remind))) return { useDefault: false, overrides: [] };
    return { useDefault: false, overrides: [{ method: 'popup', minutes: Math.max(0, Math.min(40320, Math.round(Number(v.remind)))) }] };
  }
  function times(v, date, endDate) {
    return G().timesBody({ allDay: isAllDay(v), date, endDate: endDate || null, start: v.start, dur: durOf(v) }, TZ);
  }
  function fields(v) {
    return { summary: v.title || '', description: v.note || '', colorId: colorFor(v.cat), reminders: remBody(v) };
  }
  const utcBasic = (iso) => iso.replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');

  /** Правило CRM → RRULE (щомісяця/щороку на 29–31 — останній день у коротшому місяці, як у CRM). */
  function rruleLine(rule, first, allDay) {
    const p = ['FREQ=' + FREQ_TO[rule.freq]];
    if (rule.every > 1) p.push('INTERVAL=' + rule.every);
    if (rule.freq === 'week') {
      p.push('BYDAY=' + rule.days.map((i) => BYDAY[i]).join(','));
      if (rule.every > 1) p.push('WKST=MO');
    }
    const fd = D.parse(first);
    if ((rule.freq === 'month' || rule.freq === 'year') && fd.d >= 29) {
      if (rule.freq === 'year') p.push('BYMONTH=' + fd.m);
      const days = [];
      for (let k = 28; k <= fd.d; k++) days.push(k);
      p.push('BYMONTHDAY=' + days.join(','), 'BYSETPOS=-1');
    }
    if (rule.until) p.push('UNTIL=' + G().untilValue(rule.until, allDay));
    else if (rule.count) p.push('COUNT=' + rule.count);
    return 'RRULE:' + p.join(';');
  }

  function fnv(s) {
    let x = 0x811c9dc5;
    for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 0x01000193) >>> 0; }
    return x.toString(16).padStart(8, '0');
  }
  const hashOf = (o) => fnv(JSON.stringify(o));

  function skipped(ev, d) { return Array.isArray(ev.skip) && ev.skip.includes(d); }
  /** Тіло для заняття серії, яке в CRM не змінювали окремо (щоб повернути заняття до вигляду серії). */
  function instBody(ev, d) {
    const inst = C().instanceOf(Object.assign({}, ev, { overrides: {} }), d);
    return Object.assign(fields(inst), times(inst, inst.date, null));
  }

  /** Як має виглядати копія: { rec, body, ov: { дата: { body, h } }, mh, h }. */
  function desired(ev) {
    const ext = { extendedProperties: { private: { crmId: ev.id } } };
    if (!C().isSeries(ev)) {
      const body = Object.assign(fields(ev), times(ev, ev.date, C().spanEnd(ev)), ext);
      const mh = hashOf(body);
      return { rec: false, body, ov: {}, mh, h: hashOf({ mh }) };
    }
    const rule = C().ruleOf(ev);
    const first = C().seriesFirst(ev) || ev.date;
    const allDay = isAllDay(ev);
    const rec = [rruleLine(rule, first, allDay)];
    const sk = (ev.skip || []).filter((d) => D.isDate(d) && C().isOccurrence(ev, d)).sort();
    if (sk.length) {
      rec.push(allDay
        ? 'EXDATE;VALUE=DATE:' + sk.map((d) => d.replace(/-/g, '')).join(',')
        : 'EXDATE:' + sk.map((d) => utcBasic(G().kyivISO(d, toMin(ev.start)))).join(','));
    }
    const body = Object.assign(fields(ev), times(ev, first, null), { recurrence: rec }, ext);
    const ov = {};
    Object.keys(ev.overrides || {}).sort().forEach((d) => {
      if (!D.isDate(d) || skipped(ev, d) || !C().isOccurrence(ev, d)) return;
      const inst = C().instanceOf(ev, d);
      const b = Object.assign(fields(inst), times(inst, inst.date, null));
      ov[d] = { body: b, h: hashOf(b) };
    });
    const mh = hashOf(body);
    const ovh = {};
    Object.keys(ov).forEach((d) => { ovh[d] = ov[d].h; });
    return { rec: true, body, ov, mh, h: hashOf({ mh, ovh }) };
  }

  /** Чи треба щось надіслати в Google для цієї події. */
  function needsPush(ev, m) {
    const g = ev.gsync || null;
    if (ev.deletedAt || !eligible(ev, m)) return !!(g && g.id && !g.del);
    if (g && g.gone) return false;   // чекає рішення людини
    if (!g || !g.id || g.del || force.has(ev.id)) return true;
    return g.h !== desired(ev).h;
  }

  // ---------- Запити ----------
  const path = (cal, id) => G().evPath(cal, id);
  /** Прибрати null (для нового запису). */
  function clean(o) {
    if (Array.isArray(o)) return o.map(clean);
    if (!o || typeof o !== 'object') return o;
    const out = {};
    Object.keys(o).forEach((k) => { if (o[k] !== null && o[k] !== undefined) out[k] = clean(o[k]); });
    return out;
  }
  async function del(cal, id) {
    try { await G().api('DELETE', path(cal, id)); } catch (e) { if (e.code !== 'gone') throw e; }
    markDeleted(id);
  }
  /** Створити копію з цим id; id зайнятий (копію вже створив інший пристрій чи вона видалена) — оновити й повернути. */
  async function insertOrAdopt(cal, id, body, evId) {
    try {
      return await G().api('POST', path(cal), null, clean(Object.assign({ id }, body)));
    } catch (e) {
      if (e.code !== 'conflict') throw e;
    }
    try {
      const r = await G().api('PATCH', path(cal, id), null, Object.assign({}, body, { status: 'confirmed' }));
      if (r && r.status !== 'cancelled') return r;
    } catch (e) {
      if (STOP.includes(e.code)) throw e;
    }
    return G().api('POST', path(cal), null, clean(Object.assign({ id: freshId(evId) }, body)));
  }
  const ostDay = (x) => {
    const o = (x && x.originalStartTime) || {};
    return o.date || (o.dateTime ? D.toKyivDate(o.dateTime) : null);
  };
  /** Заняття серії за початковою датою (разом зі скасованими). */
  async function findInstance(cal, mid, d, ev) {
    const base = path(cal, mid) + '/instances';
    const p1 = { originalStart: isAllDay(ev) ? d : G().kyivISO(d, toMin(ev.start)), showDeleted: 'true', maxResults: '5' };
    let j;
    try { j = await G().api('GET', base, p1); } catch (e) { if (e.code === 'gone') return null; throw e; }
    let it = ((j && j.items) || []).find((x) => ostDay(x) === d);
    if (!it) {
      const p2 = { timeMin: G().kyivStartISO(D.addDays(d, -1)), timeMax: G().kyivStartISO(D.addDays(d, 2)), showDeleted: 'true', maxResults: '50' };
      const j2 = await G().api('GET', base, p2);
      it = ((j2 && j2.items) || []).find((x) => ostDay(x) === d);
    }
    return it || null;
  }

  /** Надіслати одну подію. Повертає новий gsync (або null — нічого не змінилось). */
  async function pushOne(ev, m) {
    const g = ev.gsync || {};
    const now = new Date().toISOString();
    const live = !ev.deletedAt && eligible(ev, m);
    if (!live) {
      if (g.id && !g.del) {
        await del(g.cal, g.id);
        return Object.assign({}, g, { del: true, gone: false, goneDates: null, at: now, n: nextN(ev.id, g) });
      }
      return null;
    }
    const want = desired(ev);
    const cal = g.cal || (m && m.cal) || 'primary';
    let id = g.id && !g.del ? g.id : null;
    let fresh = false;
    let newSeries = false;
    // Окрема подія стала серією (чи навпаки) — стара копія видаляється, нова — з іншим id
    if (id && !!g.rec !== want.rec) { await del(cal, id); id = null; newSeries = true; }
    const forced = force.has(ev.id);
    if (id) {
      if (g.mh !== want.mh || forced) {
        let r;
        let missing = false;
        try { r = await G().api('PATCH', path(cal, id), null, want.body); } catch (e) {
          if (e.code !== 'gone') throw e;
          missing = true;
        }
        if (r && r.status === 'cancelled') missing = true;
        if (missing) {
          // Копію видалили в самому Google — не повертаємо мовчки, питаємо людину.
          // Видалили ми самі (напр., «Скасувати» повернуло стару серію) — просто створюємо знову.
          if (!deletedByUs(id)) return Object.assign({}, g, { gone: true, at: now });
          id = null;
        } else fresh = true;
      }
    }
    if (!id) {
      const r = await insertOrAdopt(cal, newSeries ? freshId(ev.id) : copyId(ev.id), want.body, ev.id);
      id = String(r.id);
      fresh = true;
    }
    const ov = {};
    if (want.rec) {
      const old = (g.id === id && g.ov) || {};
      for (const d of Object.keys(want.ov)) {
        if (!fresh && !forced && old[d] === want.ov[d].h) { ov[d] = old[d]; continue; }
        const inst = await findInstance(cal, id, d, ev);
        if (!inst || inst.status === 'cancelled') continue;
        await G().api('PATCH', path(cal, inst.id), null, want.ov[d].body);
        ov[d] = want.ov[d].h;
      }
      // День, який більше не змінено окремо (і не скасовано), — назад до вигляду серії
      for (const d of Object.keys(old)) {
        if (want.ov[d] || skipped(ev, d) || !C().isOccurrence(ev, d)) continue;
        const inst = await findInstance(cal, id, d, ev);
        if (inst && inst.status !== 'cancelled') await G().api('PATCH', path(cal, inst.id), null, instBody(ev, d));
      }
    }
    force.delete(ev.id);
    // n — лічильник надсилань: «Скасувати» з меншим n означає, що в Google уже інше
    const out = { cal, id, h: want.h, mh: want.mh, rec: want.rec, ov, at: now, n: nextN(ev.id, g) };
    if (g.goneDates && g.goneDates.length && g.id === id) out.goneDates = g.goneDates.slice();
    return out;
  }

  // ---------- Запис gsync (без нового updatedAt) ----------
  const bump = (iso) => { const t = Date.parse(iso || ''); return new Date((Number.isFinite(t) ? t : Date.now()) + 1).toISOString(); };
  async function flush(updates) {
    if (!updates.length) return;
    const recs = [];
    updates.splice(0).forEach(([id, gs]) => {
      const cur = CRM.store.get('events', id);
      if (cur) recs.push(Object.assign({}, cur, { gsync: gs, updatedAt: bump(cur.updatedAt) }));
    });
    if (recs.length) await CRM.store.saveKeep('events', recs);
  }
  async function setGsync(id, gs) { await flush([[id, gs]]); }

  // ---------- Надсилання ----------
  function errOf(code) { const e = new Error(code); e.code = code; return e; }
  /**
   * Надіслати все, що чекає. opts.interactive — помилку доступу кинути (для CRM.gcal.run з «Оновити підключення»);
   * opts.retry — повторити й те, що раніше не вдалося.
   */
  function pushAll(opts) {
    const o = opts || {};
    if (running) { again = true; return running; }
    running = (async () => {
      // спершу дати присвоїти running (інакше ранній вихід скинув би його раніше, ніж присвоєно)
      await null;
      let sent = 0;
      try {
        if (!on()) return { ok: true, sent: 0 };
        const m = mcfg();
        const need = G().writeNeed();
        if (need) {
          state.error = need;
          if (o.interactive) throw errOf(need);
          return { ok: false, sent: 0 };
        }
        if (o.retry) state.failed = {};
        state.error = null;
        await dropOrphans();
        const list = CRM.store.list('events', { deleted: 'all' }).filter((ev) => needsPush(ev, m) && !state.failed[ev.id]);
        state.total = list.length;
        state.done = 0;
        if (state.progress) state.progress(0, state.total);
        const updates = [];
        for (const ev0 of list) {
          const ev = CRM.store.get('events', ev0.id) || ev0;
          try {
            const gs = await pushOne(ev, m);
            if (gs) updates.push([ev.id, gs]);
            sent++;
          } catch (e) {
            if (STOP.includes(e.code)) {
              state.error = e.code;
              await flush(updates);
              if (o.interactive && (e.code === 'expired' || e.code === 'scope')) throw e;
              break;
            }
            state.failed[ev.id] = e.message || 'помилка';
            console.error(e);
          }
          state.done++;
          if (state.progress) state.progress(state.done, state.total);
          if (updates.length >= BATCH) await flush(updates);
        }
        await flush(updates);
        if (sent) G().refreshSoon();
        return { ok: !state.error, sent };
      } finally {
        running = null;
        changed();
        if (again) { again = false; schedule(); }
      }
    })();
    return running;
  }

  function schedule(ms) {
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (!on()) return;
      pushAll().catch((e) => console.error(e)).then(() => pull().catch((e) => console.error(e)));
    }, ms == null ? 1500 : ms);
  }

  // ---------- Зміни копій у самому Google → у CRM ----------
  function viewEv(v, date, endDate) {
    const allDay = isAllDay(v);
    const t = times(v, date, endDate);
    return {
      title: String(v.title || '').trim(), allDay,
      s: allDay ? t.start.date : Date.parse(t.start.dateTime), e: allDay ? t.end.date : Date.parse(t.end.dateTime),
      note: String(v.note || '').trim()
    };
  }
  function viewG(e) {
    return {
      title: e.title === '(без назви)' ? '' : String(e.title || '').trim(), allDay: !!e.allDay,
      s: e.allDay ? e.start : Date.parse(e.start), e: e.allDay ? e.end : Date.parse(e.end),
      note: G().textOf(e.desc || '').trim()
    };
  }
  const sameView = (a, b) => a.title === b.title && a.allDay === b.allDay && a.s === b.s && a.e === b.e && a.note === b.note;
  /** Поля події CRM з копії в Google (подія не виходить за 24:00). */
  function fromGoogle(e) {
    const mo = G().toModel(e);
    const out = { title: mo.title, date: mo.date, endDate: mo.endDate || null, allDay: !!mo.allDay, start: mo.allDay ? null : mo.start, dur: mo.allDay ? null : mo.dur, note: String(mo.note || '').slice(0, 2000) };
    if (!out.allDay) out.dur = Math.max(1, Math.min(Number(out.dur) || 60, 1440 - toMin(out.start)));
    return out;
  }
  const ostOf = (e) => (e.ost ? (/T/.test(e.ost) ? D.toKyivDate(e.ost) : e.ost) : null);

  function rrView(lines, first) {
    const r = (lines || []).find((l) => /^RRULE:/i.test(l));
    if (!r) return '';
    const p = {};
    r.replace(/^RRULE:/i, '').split(';').forEach((kv) => { const i = kv.indexOf('='); if (i > 0) p[kv.slice(0, i).toUpperCase()] = kv.slice(i + 1).toUpperCase(); });
    if (p.UNTIL) p.UNTIL = G().untilDate(p.UNTIL) || p.UNTIL;
    if (!p.INTERVAL) p.INTERVAL = '1';
    if (p.BYDAY) p.BYDAY = p.BYDAY.split(',').sort().join(',');
    if (p.FREQ === 'WEEKLY' && !p.BYDAY && D.isDate(first)) p.BYDAY = BYDAY[D.weekday(first)];
    delete p.WKST;
    return Object.keys(p).sort().map((k) => k + '=' + p[k]).join(';');
  }
  function masterView(b) {
    const allDay = !!(b.start && b.start.date && !b.start.dateTime);
    const first = allDay ? b.start.date : D.toKyivDate(b.start.dateTime);
    return {
      title: String(b.summary || '').trim(), note: G().textOf(b.description || '').trim(), allDay,
      s: allDay ? b.start.date : Date.parse(b.start.dateTime), e: allDay ? b.end.date : Date.parse(b.end.dateTime),
      rr: rrView(b.recurrence, first), first
    };
  }

  async function getFull(cal, id) {
    try { return await G().api('GET', path(cal, id)); } catch (e) { if (e.code === 'gone') return { status: 'cancelled' }; throw e; }
  }

  /** Окрема подія: { gone } | { changes } | null. */
  async function pullSingle(ev, c, e) {
    const g = ev.gsync;
    const end = C().spanEnd(ev) || ev.date;
    if (!e) {
      if (end < c.from || ev.date > c.to) return null;
      const full = await getFull(g.cal, g.id);
      if (!full || full.status === 'cancelled') return { gone: true };
      e = G().normalize(full, g.cal);
      if (!e) return null;
    }
    if (sameView(viewEv(ev, ev.date, C().spanEnd(ev)), viewG(e))) return null;
    return { changes: fromGoogle(e) };
  }

  /** Зміни заняття серії в Google → зміна «лише цього дня» в CRM (відносно серії base). */
  function overrideFrom(base, d, e, prev) {
    const f = fromGoogle(e);
    const b = C().instanceOf(Object.assign({}, base, { overrides: {} }), d);
    const o = {};
    if (f.date !== d) o.date = f.date;
    if (f.allDay !== isAllDay(b)) o.allDay = f.allDay;
    if (!f.allDay && (f.start !== b.start || f.allDay !== isAllDay(b))) o.start = f.start;
    if (!f.allDay && f.dur !== durOf(b)) o.dur = f.dur;
    if (f.title !== String(b.title || '')) o.title = f.title;
    if (f.note.trim() !== String(b.note || '').trim()) o.note = f.note;
    ['cat', 'remind'].forEach((k) => { if (prev && prev[k] !== undefined) o[k] = prev[k]; });
    return o;
  }

  /** Серія: { gone } | { ev2, goneDates } | null. */
  async function pullSeries(ev, c, insts) {
    const g = ev.gsync;
    const known = new Set(g.goneDates || []);
    const lo = c.from > ev.date ? c.from : ev.date;
    const exp = C().seriesDates(ev, lo, c.to).filter((d) => !skipped(ev, d));
    const byOst = new Map();
    insts.forEach((e) => { const d = ostOf(e); if (d) byOst.set(d, e); });
    let dirty = false;
    const missing = [];
    exp.forEach((d) => {
      const inst = C().instanceOf(ev, d);
      if (inst.date < c.from || inst.date > c.to || known.has(d)) return;
      const e = byOst.get(d);
      if (!e) { missing.push(d); dirty = true; return; }
      if (!sameView(viewEv(inst, inst.date, null), viewG(e))) dirty = true;
    });
    const expSet = new Set(exp);
    if (insts.some((e) => { const d = ostOf(e); return d && !expSet.has(d) && !skipped(ev, d) && !known.has(d); })) dirty = true;
    if (!dirty) return null;

    const full = await getFull(g.cal, g.id);
    if (!full || full.status === 'cancelled') return { gone: true };
    let ev2 = Object.assign({}, ev);
    let changedAny = false;
    // Уся серія (головна подія) змінена в Google
    const got = masterView(full);
    const want = masterView(desired(ev).body);
    if (got.title !== want.title || got.note !== want.note || got.allDay !== want.allDay || got.s !== want.s || got.e !== want.e || got.rr !== want.rr) {
      const f = fromGoogle(G().normalize(Object.assign({}, full, { status: 'confirmed' }), g.cal) || {});
      const ch = { title: f.title, note: f.note, allDay: f.allDay, start: f.start, dur: f.dur };
      if (got.first !== (C().seriesFirst(ev) || ev.date)) ch.date = got.first;
      if (got.rr !== want.rr) {
        const pr = G().parseRecurrence(full.recurrence, got.first);
        if (pr.simple && pr.rule) ch.repeat = pr.rule;
      }
      ev2 = Object.assign(ev2, ch);
      changedAny = true;
    }
    // Окремі заняття, змінені в Google
    const ovs = Object.assign({}, ev2.overrides || {});
    const applyInst = (d, e) => {
      if (skipped(ev2, d) || !C().isOccurrence(ev2, d)) return;
      const cur = C().instanceOf(Object.assign({}, ev2, { overrides: ovs }), d);
      if (sameView(viewEv(cur, cur.date, null), viewG(e))) return;
      const o = overrideFrom(ev2, d, e, ovs[d]);
      const hasTime = ['date', 'allDay', 'start', 'dur', 'title', 'note'].some((k) => o[k] !== undefined);
      if (hasTime) ovs[d] = o; else delete ovs[d];
      changedAny = true;
    };
    insts.forEach((e) => { const d = ostOf(e); if (d) applyInst(d, e); });
    const goneDates = Array.from(known);
    for (const d of missing) {
      const it = await findInstance(g.cal, g.id, d, ev2);
      if (!it || it.status === 'cancelled') { if (!goneDates.includes(d)) goneDates.push(d); continue; }
      const e = G().normalize(it, g.cal);
      if (e) applyInst(d, e);
    }
    ev2.overrides = ovs;
    return { ev2: changedAny ? ev2 : null, goneDates };
  }

  /** Звірити копії з тим, що зараз у Google (після оновлення подій Google). Повертає проміс звірки. */
  function pull() {
    if (pullP) return pullP;
    if (running || !on()) return Promise.resolve();
    pullP = doPull().finally(() => { pullP = null; });
    return pullP;
  }
  async function doPull() {
    const c = G().cache();
    const m = mcfg();
    if (!c || !c.started || c.at === lastPull || G().status() !== 'connected') return;
    // Копії лежать в основному календарі — якщо його не показують, звіряти нема з чим
    if (!(c.calendars || []).some((x) => x.id === m.cal) || G().selectedCalendars().indexOf(m.cal) === -1) return;
    lastPull = c.at;
    const applied = [];
    const gone = [];
    try {
      const singles = new Map();
      const series = new Map();
      c.events.forEach((e) => {
        if (e.cal !== m.cal) return;
        if (e.rid) { if (!series.has(e.rid)) series.set(e.rid, []); series.get(e.rid).push(e); } else singles.set(e.id, e);
      });
      const list = CRM.store.list('events').filter((ev) => {
        const g = ev.gsync;
        return g && g.id && !g.del && !g.gone && g.cal === m.cal && g.at && g.at < c.started && eligible(ev, m);
      });
      for (const ev0 of list) {
        const ev = CRM.store.get('events', ev0.id);
        if (!ev || ev.deletedAt || !ev.gsync || desired(ev).h !== ev.gsync.h) continue;   // у CRM є ще не надіслане — CRM головна
        const g = ev.gsync;
        let r;
        try {
          r = C().isSeries(ev) ? await pullSeries(ev, c, series.get(g.id) || []) : await pullSingle(ev, c, singles.get(g.id));
        } catch (e) {
          if (STOP.includes(e.code)) break;
          console.error(e);
          continue;
        }
        if (!r) continue;
        const now = new Date().toISOString();
        if (r.gone) {
          await setGsync(ev.id, Object.assign({}, g, { gone: true, at: now }));
          gone.push(ev.title || 'Без назви');
          continue;
        }
        if (r.changes || r.ev2) {
          const ev2 = r.ev2 || Object.assign({}, ev, r.changes);
          const w = desired(ev2);
          const ovh = {};
          Object.keys(w.ov).forEach((d) => { ovh[d] = w.ov[d].h; });
          ev2.gsync = Object.assign({}, g, { h: w.h, mh: w.mh, ov: ovh, at: now, n: nextN(ev.id, g) });
          if (r.goneDates && r.goneDates.length) ev2.gsync.goneDates = r.goneDates; else delete ev2.gsync.goneDates;
          await CRM.store.save('events', ev2);
          applied.push(ev2.title || 'Без назви');
        }
        const newGone = (r.goneDates || []).filter((d) => !(g.goneDates || []).includes(d));
        if (!r.ev2 && !r.changes && r.goneDates && newGone.length) {
          await setGsync(ev.id, Object.assign({}, g, { goneDates: r.goneDates, at: now }));
        }
        if (newGone.length) gone.push((ev.title || 'Без назви') + ', ' + newGone.map((d) => CRM.fmt.dateShort(d)).join(', '));
      }
    } catch (e) {
      console.error(e);
    }
    if (applied.length) {
      ui.toast(applied.length === 1 ? `Зміну з Google Календаря перенесено в CRM: «${applied[0]}»` : `Зміни з Google Календаря перенесено в CRM: ${CRM.fmt.count(applied.length, ['подія', 'події', 'подій'])}`, { type: 'success', duration: 6000 });
    }
    if (gone.length) {
      ui.toast(gone.length === 1 ? `У Google Календарі видалено «${gone[0]}». Що зробити в CRM?` : `У Google Календарі видалено ${CRM.fmt.count(gone.length, ['подію', 'події', 'подій'])}. Що зробити в CRM?`,
        { type: 'error', duration: 12000, action: { label: 'Вирішити', onClick: () => openGone() } });
    }
    if (applied.length || gone.length) changed();
  }

  // ---------- Видалено в Google: що робити ----------
  function goneItems() {
    const out = [];
    CRM.store.list('events').forEach((ev) => {
      const g = ev.gsync;
      if (!g || g.del) return;
      if (g.gone) out.push({ ev, date: null });
      else (g.goneDates || []).forEach((d) => out.push({ ev, date: d }));
    });
    return out;
  }
  function itemText(x) {
    const ev = x.ev;
    const when = x.date ? CRM.fmt.date(x.date) + (C().isSeries(ev) ? ' (один день серії)' : '')
      : C().isSeries(ev) ? 'уся серія · ' + C().repeatText(ev) : C().whenText(ev) === 'весь день' ? CRM.fmt.date(ev.date) : CRM.fmt.date(ev.date) + ', ' + C().whenText(ev);
    return { title: ev.title || 'Без назви', when };
  }
  async function removeInCrm(x) {
    const ev = CRM.store.get('events', x.ev.id);
    if (!ev) return;
    if (!x.date) {
      await CRM.store.softDelete('events', ev.id);
      ui.toast(`«${ev.title || 'Без назви'}» видалено й у CRM (є в Кошику)`);
      return;
    }
    const skip = Array.from(new Set((ev.skip || []).concat(x.date))).sort();
    const overrides = Object.assign({}, ev.overrides || {});
    delete overrides[x.date];
    const gs = Object.assign({}, ev.gsync, { goneDates: (ev.gsync.goneDates || []).filter((d) => d !== x.date) });
    await CRM.store.save('events', Object.assign({}, ev, { skip, overrides, gsync: gs }));
    ui.toast(`«${ev.title || 'Без назви'}» ${CRM.fmt.dateShort(x.date)} скасовано й у CRM`);
  }
  async function restoreInGoogle(x) {
    const ev = CRM.store.get('events', x.ev.id);
    if (!ev || !ev.gsync) return false;
    const g = ev.gsync;
    if (!x.date) {
      // Копії вже немає: «del» — створити знову (той самий id копії, якщо Google дозволить)
      await setGsync(ev.id, Object.assign({}, g, { del: true, gone: false, goneDates: null }));
      const r = await G().run(() => pushAll({ interactive: true }));
      return !!(r && r.ok);
    }
    const r = await G().run(async () => {
      const inst = await findInstance(g.cal, g.id, x.date, ev);
      if (inst) {
        const want = desired(ev);
        const body = want.ov[x.date] ? want.ov[x.date].body : instBody(ev, x.date);
        await G().api('PATCH', path(g.cal, inst.id), null, Object.assign({}, body, { status: 'confirmed' }));
      }
      return true;
    });
    if (!r.ok) return false;
    const cur = CRM.store.get('events', ev.id);
    if (cur && cur.gsync) await setGsync(ev.id, Object.assign({}, cur.gsync, { goneDates: (cur.gsync.goneDates || []).filter((d) => d !== x.date) }));
    G().refreshSoon();
    return true;
  }
  function openGone() {
    const list = h('div', { class: 'gm-gone-list' });
    let dlg = null;
    function draw() {
      const items = goneItems();
      if (!items.length) { if (dlg) dlg.close('done'); return; }
      ui.mount(list, items.map((x) => {
        const t = itemText(x);
        return h('div', { class: 'gm-gone-row' },
          h('div', { class: 'gm-gone-text' }, h('div', { class: 'gm-gone-title' }, t.title), h('div', { class: 'subtle' }, t.when)),
          h('div', { class: 'gm-gone-actions' },
            ui.button({ label: 'Видалити в CRM', size: 'sm', variant: 'danger-ghost', className: 'gm-gone-del', onClick: async () => { await removeInCrm(x); draw(); } }),
            ui.button({ label: 'Повернути в Google', size: 'sm', className: 'gm-gone-back', onClick: async () => { if (await restoreInGoogle(x)) { ui.toast(`«${t.title}» повернуто в Google Календар`, { type: 'success' }); } draw(); } })));
      }));
    }
    draw();
    if (!goneItems().length) return null;
    dlg = ui.modal({
      title: 'Видалено в Google Календарі', size: 'md', className: 'gm-gone-modal',
      body: h('div', { class: 'form-stack' },
        h('p', { class: 'modal-text' }, 'Ці події (чи дні серій) видалили в самому Google Календарі, а в CRM вони є. Вибери для кожної: видалити й у CRM чи повернути копію в Google.'),
        list),
      footer: [ui.button({ label: 'Пізніше', onClick: () => dlg.close('later') })],
      onClose: () => changed()
    });
    return dlg;
  }

  // ---------- Стан для підписів і кабінету ----------
  function pendingCount() {
    if (!on()) return 0;
    const m = mcfg();
    return CRM.store.list('events', { deleted: 'all' }).filter((ev) => needsPush(ev, m)).length;
  }
  function copiesCount() { return CRM.store.list('events').filter((ev) => ev.gsync && ev.gsync.id && !ev.gsync.del).length; }
  function goneCount() { return goneItems().length; }
  /** Нагадування про цю подію надсилає Google (копія вже там) — CRM показує його лише в дзвіночку. */
  function googleReminds(id) {
    if (!on()) return false;
    const ev = CRM.store.get('events', id);
    const g = ev && ev.gsync;
    return !!(g && g.id && !g.del && !g.gone && !needsPush(ev, mcfg()));
  }
  /** Стан копії для форми події: 'synced' | 'pending' | 'gone' | null. */
  function statusOf(ev) {
    if (!on() || !ev || ev.studentId) return null;
    if (!eligible(ev, mcfg())) return null;
    const g = ev.gsync;
    if (g && g.gone) return 'gone';
    return needsPush(ev, mcfg()) ? 'pending' : 'synced';
  }

  async function sendNow() {
    const r = await G().run(() => pushAll({ interactive: true, retry: true }));
    if (r.ok && r.value && r.value.sent) ui.toast(`Надіслано в Google Календар: ${CRM.fmt.count(r.value.sent, ['подія', 'події', 'подій'])}`, { type: 'success' });
    else if (r.ok && r.value && !r.value.ok && state.error === 'network') ui.toast('Немає звʼязку з Google — спробую пізніше.', { type: 'error' });
    return r;
  }

  const link = (text, onClick, cls) => h('button', { type: 'button', class: 'link-like' + (cls ? ' ' + cls : ''), onClick }, text);
  /** Підпис над Календарем і під розкладом на Головній. */
  function noteParts() {
    if (!on()) return null;
    const parts = [];
    if (running && state.total) parts.push(h('span', { class: 'gm-note' }, ` · Надсилаю в Google: ${state.done} з ${state.total}`));
    else {
      const n = pendingCount();
      if (n) parts.push(h('span', { class: 'gm-note gm-pending' }, ` · Чекають надсилання в Google: ${n} · `, link('Надіслати', () => sendNow(), 'gm-send')));
    }
    const gn = goneCount();
    if (gn) parts.push(h('span', { class: 'gm-note gm-gone' }, ` · Видалено в Google: ${gn} · `, link('Вирішити', () => openGone(), 'gm-resolve')));
    return parts.length ? parts : null;
  }

  // ---------- Увімкнути / вимкнути ----------
  function progressModal(title) {
    const bar = h('div', { class: 'progress-bar', style: { width: '0%' } });
    const text = h('div', { class: 'subtle gm-progress-text' }, 'Готую…');
    const dlg = ui.modal({
      title, size: 'sm', center: true, className: 'gm-progress-modal',
      body: h('div', { class: 'form-stack' }, h('div', { class: 'progress' }, bar), text,
        h('p', { class: 'subtle' }, 'Можна закрити це вікно — надсилання продовжиться, поки CRM відкрита.')),
      footer: [ui.button({ label: 'Сховати', onClick: () => dlg.close('hide') })]
    });
    state.progress = (d, t) => {
      bar.style.width = t ? Math.round((d / t) * 100) + '%' : '100%';
      text.textContent = t ? `${d} з ${t}` : 'Немає подій для копіювання';
    };
    return { close: () => { state.progress = null; try { dlg.close('done'); } catch (e) { /* уже закрите */ } } };
  }

  async function enable() {
    if (G().status() === 'file') return;
    const since = D.today();
    const sinceTs = new Date().toISOString();
    const draft = { on: true, cal: G().primaryCalendar(), since, sinceTs };
    const n = CRM.store.list('events').filter((ev) => eligible(ev, draft) && !(ev.gsync && ev.gsync.id && !ev.gsync.del)).length;
    const ok = await ui.confirm({
      title: 'Дублювати події CRM у Google Календар?',
      message: `CRM лишається головним календарем, а кожна твоя подія (крім уроків «Репетиторства») матиме копію в основному календарі Google. ` +
        `Зараз ${n ? 'буде скопійовано ' + CRM.fmt.count(n, ['подію', 'події', 'подій']) + ' — майбутні й серії, що ще тривають' : 'копіювати нічого — нові події зʼявлятимуться там самі'}; ` +
        'далі нові, змінені й видалені події — самі. Нагадувати про них буде Google (на телефоні), CRM показуватиме їх лише в дзвіночку. ' +
        'Копії надсилаються, коли CRM відкрита й доступ до Google активний; змінене в Google CRM теж бере собі.',
      confirmText: 'Увімкнути'
    });
    if (!ok) return false;
    await G().setCfg({ mirror: draft });
    idMap = null;
    changed();
    let pm = null;
    const r = await G().run(async () => {
      if (!pm) pm = progressModal('Копіюю події в Google Календар');
      return pushAll({ interactive: true, retry: true });
    });
    if (pm) pm.close();
    if (r.ok && r.value) {
      const sent = r.value.sent;
      const failed = Object.keys(state.failed).length;
      ui.toast(failed ? `Скопійовано в Google: ${sent}; не вдалося: ${failed} (спробую ще)` : sent ? `Дублювання ввімкнено: скопійовано ${CRM.fmt.count(sent, ['подію', 'події', 'подій'])}` : 'Дублювання ввімкнено',
        { type: failed ? 'error' : 'success' });
    } else {
      ui.toast('Дублювання ввімкнено. Копії надішлю, щойно буде доступ до Google («Оновити підключення»).');
    }
    return true;
  }

  async function disable() {
    const live = CRM.store.list('events', { deleted: 'all' }).filter((ev) => ev.gsync && ev.gsync.id && !ev.gsync.del);
    const choice = await new Promise((resolve) => {
      let res = null;
      const dlg = ui.modal({
        title: 'Вимкнути дублювання?', size: 'sm', center: true, className: 'gm-off-modal',
        body: h('p', { class: 'modal-text' }, live.length
          ? `У Google Календарі є копії твоїх подій CRM (${live.length}). Їх можна видалити з Google або лишити — тоді вони більше не оновлюватимуться.`
          : 'Нові й змінені події CRM більше не копіюватимуться в Google Календар.'),
        footer: [
          ui.button({ label: 'Скасувати', onClick: () => dlg.close('cancel') }),
          live.length ? ui.button({ label: 'Лишити копії', className: 'gm-off-keep', onClick: () => { res = 'keep'; dlg.close('keep'); } }) : null,
          ui.button({ label: live.length ? 'Видалити копії' : 'Вимкнути', variant: live.length ? 'danger' : 'primary', className: 'gm-off-del', onClick: () => { res = live.length ? 'delete' : 'keep'; dlg.close('ok'); } })
        ].filter(Boolean),
        onClose: () => resolve(res)
      });
    });
    if (!choice) return false;
    const m = mcfg();
    await G().setCfg({ mirror: Object.assign({}, m, { on: false }) });
    changed();
    if (choice === 'delete') {
      let pm = null;
      const r = await G().run(async () => {
        if (!pm) pm = progressModal('Видаляю копії з Google Календаря');
        const updates = [];
        let done = 0;
        const todo = CRM.store.list('events', { deleted: 'all' }).filter((ev) => ev.gsync && ev.gsync.id && !ev.gsync.del);
        if (state.progress) state.progress(0, todo.length);
        for (const ev of todo) {
          await del(ev.gsync.cal, ev.gsync.id);
          updates.push([ev.id, Object.assign({}, ev.gsync, { del: true, gone: false, goneDates: null, at: new Date().toISOString() })]);
          done++;
          if (state.progress) state.progress(done, todo.length);
          if (updates.length >= BATCH) await flush(updates);
        }
        await flush(updates);
        G().refreshSoon();
        return done;
      });
      if (pm) pm.close();
      ui.toast(r.ok ? `Дублювання вимкнено, копії видалено з Google (${r.value})` : 'Дублювання вимкнено. Частину копій не видалено — їх можна видалити в Google Календарі.', { type: r.ok ? 'success' : 'error' });
    } else {
      ui.toast('Дублювання вимкнено');
    }
    return true;
  }

  /** Частина блоку «Google Календар» у кабінеті. */
  function settingsPart() {
    const isOn = !!(mcfg() && mcfg().on);
    const lines = [];
    if (isOn) {
      const n = pendingCount();
      const gn = goneCount();
      lines.push(h('div', null, `Копії — в основному календарі Google. Подій з копією: ${copiesCount()}.`));
      if (C() && C().openCategories) lines.push(h('div', { class: 'gm-colors' }, 'Колір копій — свій для кожної категорії: ', link('Кольори категорій у Google', () => C().openCategories(), 'gm-cats')));
      if (running && state.total) lines.push(h('div', null, `Надсилаю: ${state.done} з ${state.total}…`));
      else if (n) lines.push(h('div', { class: 'gm-pending' }, `Чекають надсилання: ${n} · `, link('Надіслати зараз', () => sendNow(), 'gm-send')));
      if (gn) lines.push(h('div', { class: 'gm-gone' }, `Видалено в Google: ${gn} · `, link('Вирішити', () => openGone(), 'gm-resolve')));
      const failed = Object.keys(state.failed).length;
      if (failed) lines.push(h('div', null, `Не вдалося надіслати: ${failed} — `, link('спробувати ще', () => sendNow())));
    }
    return h('div', { class: 'gm-block', id: 'gcal-mirror' },
      h('div', { class: 'setting-row gm-row' },
        h('div', { class: 'setting-text' },
          h('div', { class: 'setting-title' }, CRM.icon('copy', { size: 'sm' }), 'Дублювати мої події в Google',
            h('span', { class: 'badge' + (isOn ? ' badge-success' : ''), 'data-mirror': isOn ? 'on' : 'off' }, isOn ? 'увімкнено' : 'вимкнено')),
          h('div', { class: 'setting-desc' }, 'CRM — головний календар, а кожна твоя подія (крім уроків «Репетиторства») має копію в Google Календарі: створив, змінив чи видалив у CRM — те саме з копією. Змінене в Google CRM бере собі. Нагадує Google.')),
        h('div', { class: 'setting-actions' },
          isOn ? ui.button({ label: 'Вимкнути', size: 'sm', className: 'gm-toggle', onClick: () => disable() })
            : ui.button({ label: 'Увімкнути', size: 'sm', variant: 'primary', className: 'gm-toggle', onClick: () => enable() }))),
      lines.length ? h('div', { class: 'gcal-info gm-info' }, lines) : null);
  }

  // ---------- Запуск ----------
  function init() {
    known = liveCopies();
    trackRollbacks(true);   // запамʼятати лічильники, що вже є
    CRM.store.on(['events'], () => { idMap = null; trackCopies(); if (on()) schedule(); });
    CRM.store.on(['settings'], () => { if (on()) schedule(); });
    document.addEventListener('crm:googletoken', () => schedule(300));
    document.addEventListener('crm:gcalchange', (e) => {
      if (e.detail && (e.detail.mirror || e.detail.busy)) return;
      if (!on()) return;
      const c = G().cache();
      if (c && c.at !== lastPull) setTimeout(() => { if (!running) pull().catch((x) => console.error(x)); }, 50);
    });
    document.addEventListener('crm:minute', () => {
      if (!on() || running || G().status() !== 'connected') return;
      if (new Date().getMinutes() % 5 === 0 && pendingCount()) pushAll().catch((e) => console.error(e));
    });
    if (on()) schedule(2000);
  }

  CRM.gmirror = {
    init, on, copyId, crmIdOf, eligible, desired, needsPush, pushAll, pull, sendNow, enable, disable, openGone,
    pendingCount, goneCount, copiesCount, googleReminds, statusOf, noteParts, settingsPart, rruleLine,
    get state() { return state; }
  };
})(window.CRM);
