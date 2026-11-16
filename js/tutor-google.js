/* ==========================================================================
   tutor-google.js — уроки «Репетиторства» разом із Google Календарем
   (пункт 12, етап 2; версія 2026.11.16-1).

   У Google в Марка стоять свої «Заняття <Імʼя>» (серії або окремі події). Коли того дня
   в CRM є урок цього учня, CRM їх не показує (CRM.tutor.isGoogleDuplicate). Тут — звʼязок
   «урок у CRM ↔ заняття в Google того самого дня»:
   • урок перенесли в CRM (перетягування, форма, «Лише цю») → те саме заняття в Google
     переноситься (лише воно: заняття серії — PATCH власного id заняття);
   • урок скасували («Без оплати», «Пропуск — оплачується») чи видалили → заняття в Google
     скасовується (заняття серії — status: cancelled, окрема подія — DELETE);
   • розклад змінили «з дати», «Прибрати…», «В архів», у формі «Цю й наступні» / «Усі»
     → CRM питає «Змінити й серію «Заняття <Імʼя>» у Google?»: стара серія закінчується
     напередодні (UNTIL), нова — з новим часом (insert); прибрати / в архів — лише закінчити;
   • навпаки: заняття в Google того дня стоїть в інший час → «У Google — 17:00» у вікні уроку
     й у Календарі + «Перенести урок так само».
   Нових подій для уроків у Google CRM не створює: новий учень, «+ Разовий урок», новий день
   розкладу — лише в CRM. Дублювання (js/gmirror.js) уроків не чіпає.
   Зміна в CRM зберігається завжди. Google — через CRM.gcal.run (доступ сплив → «Оновити
   підключення» й повтор); не вийшло → тост «У Google Календарі … не змінено · Повторити».
   Цей пристрій змінює Google лише тоді, коли саме тут змінили урок (зміни, що прийшли
   синхронізацією з іншого пристрою, у Google не надсилаються вдруге).
   ========================================================================== */
window.CRM = window.CRM || {};

(function (CRM) {
  'use strict';

  const { h, ui } = { h: CRM.ui.h, ui: CRM.ui };
  const D = CRM.date;
  const fmt = CRM.fmt;

  const pad = (n) => String(n).padStart(2, '0');
  const minOf = (t) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
  const hhmm = (v) => pad(Math.floor(v / 60)) + ':' + pad(v % 60);
  const G = () => CRM.gcal;
  const TU = () => CRM.tutor;
  const X = () => (CRM.calendar && CRM.calendar.gx) || null;
  function gMin(iso) { const p = D.kyivParts(new Date(iso)); return p.hh * 60 + p.mm; }
  function gDur(g) { return Math.max(1, Math.round((Date.parse(g.end) - Date.parse(g.start)) / 60000)); }
  const gDay = (g) => D.toKyivDate(g.start);
  /** Початковий день заняття серії (originalStartTime) — за ним серія «на понеділках». */
  const origDay = (g) => (g.ost ? (/T/.test(g.ost) ? D.toKyivDate(g.ost) : g.ost) : gDay(g));
  function dayShort(d) { return `${CRM.WEEKDAYS_SHORT[D.weekday(d)]}, ${fmt.dateShort(d)}`; }
  const daysText = (days) => days.slice().sort((a, b) => a - b).map((d) => CRM.WEEKDAYS_SHORT[d].toLowerCase()).join(', ');
  const timeText = (start, dur) => { const a = minOf(start); return a == null ? '' : `${start}–${hhmm(Math.min(1440, a + (Number(dur) || 60)))}`; };
  const sameSet = (a, b) => JSON.stringify((a || []).slice().sort()) === JSON.stringify((b || []).slice().sort());

  /** Є все потрібне: Google Календар (з кешем подій), «Репетиторство» й помічники Календаря. */
  function ready() {
    const g = G();
    const t = TU();
    return !!(g && g.eventsBetween && g.run && g.patchEvent && g.editInfo && t && t.studentOfTitle && t.LESSON_WORD && X());
  }
  /** Є хоч один учень (інакше й шукати нічого). */
  const anyStudents = () => TU().active().length > 0;
  function whoOf(g) { const s = TU().studentOfTitle(g.title); return s ? s.id : null; }
  /** { startMin, endMin } з { start, dur } або з уроку (lessonsBetween). */
  function spanOf(x) {
    if (!x) return null;
    if (x.startMin != null) return { startMin: x.startMin, endMin: x.endMin != null ? x.endMin : x.startMin + 60 };
    const a = minOf(x.start);
    return a == null ? null : { startMin: a, endMin: Math.min(1440, a + (Number(x.dur) || 60)) };
  }
  function eventsOf(from, to) {
    try { return G().eventsBetween(from, to); } catch (e) { return []; }
  }

  // ---------- Заняття в Google того самого дня ----------
  /** Події Google учня sid, що починаються в день date (кеш Google Календаря). */
  function candidates(sid, date, list) {
    return (list || eventsOf(date, date)).filter((g) => !g.allDay && gDay(g) === date && whoOf(g) === sid);
  }
  /** З кандидатів — заняття (у назві «Заняття»/«Урок»… або час перетинається з уроком), найближче за часом. */
  function pick(cands, L) {
    if (!cands.length) return null;
    const sp = spanOf(L);
    const LW = TU().LESSON_WORD;
    const ok = cands.filter((g) => LW.test(g.title) || (sp && gMin(g.start) < sp.endMin && gMin(g.start) + gDur(g) > sp.startMin));
    if (!ok.length) return null;
    if (!sp) return ok[0];
    return ok.slice().sort((a, b) => Math.abs(gMin(a.start) - sp.startMin) - Math.abs(gMin(b.start) - sp.startMin))[0];
  }
  /** Заняття учня в Google того дня для уроку L ({ start, dur } чи { startMin, endMin }) або null. */
  function twinOf(sid, date, L) {
    if (!ready() || !sid || !D.isDate(date) || !anyStudents()) return null;
    return pick(candidates(sid, date), L);
  }
  /** Події Google з іменами учнів за проміжок: «дата|учень» → [події] (для позначок у Календарі). */
  function index(from, to) {
    const m = new Map();
    if (!ready() || !anyStudents()) return m;
    eventsOf(from, to).forEach((g) => {
      if (g.allDay) return;
      const sid = whoOf(g);
      if (!sid) return;
      const k = gDay(g) + '|' + sid;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(g);
    });
    return m;
  }
  /**
   * Заняття в Google того дня стоїть в інший час, ніж урок L (з lessonsBetween):
   * { g, start, end, dur, text } або null. idx — з index(from, to) (необовʼязково).
   */
  function diffOf(L, idx) {
    if (!L || L.startMin == null || !ready() || !anyStudents()) return null;
    const g = pick(idx ? idx.get(L.date + '|' + L.sid) || [] : candidates(L.sid, L.date), L);
    if (!g) return null;
    const s = gMin(g.start);
    const d = gDur(g);
    if (s === L.startMin && d === Number(L.dur)) return null;
    const end = hhmm(Math.min(1440, s + d));
    return { g, start: hhmm(s), end, dur: d, text: `${hhmm(s)}–${end}` };
  }

  // ---------- Тости ----------
  function crmToast(o, extra, type, gUndo) {
    const actions = [];
    if (o.retry) actions.push({ label: 'Повторити', onClick: o.retry });
    if (o.undo || gUndo) {
      actions.push({ label: 'Скасувати', onClick: async () => {
        if (o.undo) await o.undo();
        if (gUndo) await G().run(gUndo);
      } });
    }
    const text = extra ? `${o.text}. ${extra}` : o.text;
    ui.toast(text, { type: type || o.type || 'success', duration: extra ? (o.retry ? 14000 : 9000) : undefined, actions: actions.length ? actions : undefined });
  }
  function failNote(r) {
    if (r && r.e && r.e.code === 'network') return ' (немає звʼязку з Google)';
    if (r && r.e && r.e.code === 'gone') return ' (у Google його вже немає)';
    if (r && r.e && r.e.message && !r.cancelled) return ` (${r.e.message})`;
    return '';
  }
  async function askGuests(g, del) {
    const x = X();
    return x && x.askGuests ? x.askGuests(g, del) : '';
  }

  // ---------- Один урок: перенесли / скасували ----------
  /** Як було в Google — для «Скасувати». */
  function startEndOf(g) {
    const tz = g.tz || G().calendarTz(g.cal);
    return { start: { dateTime: g.start, timeZone: tz, date: null }, end: { dateTime: g.end, timeZone: tz, date: null } };
  }
  /** Перенести заняття g на after { date, start, dur } → функція «Скасувати». */
  function moveOp(g, after) {
    return async (send) => {
      const body = G().timesBody({ date: after.date, allDay: false, start: after.start, dur: Number(after.dur) || 60 }, g.tz || G().calendarTz(g.cal));
      const back = startEndOf(g);
      await G().patchEvent(g.cal, g.id, body, send);
      return () => G().patchEvent(g.cal, g.id, back, send);
    };
  }
  /** Скасувати заняття g: заняття серії — status: cancelled; окрема подія — видалити (з копією для «Скасувати»). */
  function cancelOp(g) {
    return async (send) => {
      if (g.rid) {
        await G().patchEvent(g.cal, g.id, { status: 'cancelled' }, send);
        return () => G().patchEvent(g.cal, g.id, { status: 'confirmed' }, send);
      }
      const full = await G().getEvent(g.cal, g.id);
      await G().deleteEvent(g.cal, g.id, send);
      return () => G().insertEvent(g.cal, X().gCopy(full, true), 'none');
    };
  }
  /**
   * Урок перенесли чи скасували в CRM → те саме із заняттям у Google того дня.
   * o: { sid, before: { date, start, dur }, after: { date, start, dur } | null (скасовано),
   *      text — повідомлення CRM, undo — «Скасувати» в CRM (async) або null, type }.
   * Заняття в Google немає (чи воно вже там, де треба) — звичайне повідомлення CRM.
   */
  async function follow(o) {
    if (!o || !ready() || !o.before || !D.isDate(o.before.date)) { if (o) crmToast(o); return { state: 'none' }; }
    const g = twinOf(o.sid, o.before.date, o.before);
    if (!g) { crmToast(o); return { state: 'none' }; }
    if (o.after && gDay(g) === o.after.date && gMin(g.start) === minOf(o.after.start) && gDur(g) === (Number(o.after.dur) || 60)) {
      crmToast(o);
      return { state: 'same' };
    }
    const info = G().editInfo(g);
    if (!info.ok) {
      crmToast(o, `«${g.title}» у Google Календарі не ${o.after ? 'перенесено' : 'скасовано'}: ${info.why}`, 'info');
      return { state: 'readonly', g };
    }
    return runOne(o, g, o.after ? moveOp(g, o.after) : cancelOp(g));
  }
  async function runOne(o, g, op) {
    const verb = o.after ? 'перенесено' : 'скасовано';
    const send = await askGuests(g, !o.after);
    const r = send === null ? { ok: false, cancelled: true } : await G().run(() => op(send || null), { quiet: true });
    if (!r.ok) {
      crmToast(Object.assign({}, o, { retry: () => runOne(Object.assign({}, o, { text: o.retryText || o.text }), g, op) }),
        `У Google Календарі «${g.title}» не ${verb}${failNote(r)}.`, 'warning');
      return { state: r.cancelled ? 'cancelled' : 'failed', g };
    }
    crmToast(o, `Також ${verb} в Google Календарі («${g.title}»).`, null, r.value);
    return { state: 'done', g, undo: r.value };
  }

  // ---------- Розклад: серії «Заняття <Імʼя>» у Google ----------
  /**
   * Серії учня в Google, що відповідають рядку розкладу CRM slot { days, start, dur }:
   * [{ cal, rid, g (приклад заняття), n }] — шукати ДО зміни в CRM (учень у архіві вже не впізнається).
   * «В архів» — усі дні тижня без часу: усі серії зі словом «Заняття» / «Урок»… в назві.
   */
  function seriesFor(sid, slot) {
    if (!ready() || !slot || !Array.isArray(slot.days) || !slot.days.length || !anyStudents()) return [];
    const T = D.today();
    const sp = spanOf(slot);
    const LW = TU().LESSON_WORD;
    const by = new Map();
    eventsOf(D.addDays(T, -7), D.addDays(T, 62)).forEach((g) => {
      if (g.allDay || !g.rid || whoOf(g) !== sid) return;
      if (!slot.days.includes(D.weekday(origDay(g)))) return;
      const s = gMin(g.start);
      if (!LW.test(g.title) && !(sp && s < sp.endMin && s + gDur(g) > sp.startMin)) return;
      const k = g.cal + '|' + g.rid;
      if (!by.has(k)) by.set(k, { cal: g.cal, rid: g.rid, g, n: 0 });
      by.get(k).n++;
    });
    return Array.from(by.values()).sort((a, b) => b.n - a.n);
  }
  /** Рядок розкладу з події-серії уроку: { days, start, dur }. */
  function slotOf(ev) {
    if (!ev) return null;
    const r = ev.repeat || {};
    const days = r.freq === 'week' && Array.isArray(r.days) && r.days.length ? r.days.slice() : (D.isDate(ev.date) ? [D.weekday(ev.date)] : []);
    return { days, start: ev.start, dur: ev.dur };
  }
  function firstOn(days, from) {
    for (let k = 0; k < 7; k++) { const d = D.addDays(from, k); if (days.includes(D.weekday(d))) return d; }
    return from;
  }
  function seriesDesc(t) { return `${CRM.WEEKDAYS_SHORT[D.weekday(origDay(t.g))].toLowerCase()} ${G().hhmm(t.g.start)}–${G().hhmm(t.g.end)}`; }

  /**
   * Змінити одну серію Google (t) з дати o.from: o.after { days|null (лишити дні серії), start, dur, until } або
   * null — закінчити (заняття з from зникають). Повертає «Скасувати» або null (нічого не треба).
   */
  async function applySeries(t, o, days, send) {
    const g = G();
    const x = X();
    const master = await g.getEvent(t.cal, t.rid);
    if (!master || master.status === 'cancelled' || !master.start || !master.start.dateTime) return null;
    const first = x.masterDay(master);
    const rec = Array.isArray(master.recurrence) ? master.recurrence : [];
    const parsed = g.parseRecurrence(rec, first);
    if (!parsed.rrule) return null;
    const untilG = parsed.parts && parsed.parts.UNTIL ? g.untilDate(parsed.parts.UNTIL) : null;
    if (untilG && untilG < o.from) return null;   // серія в Google скінчилась раніше
    const whole = first >= o.from;
    if (!o.after) {
      if (whole) {
        await g.deleteEvent(t.cal, t.rid, send);
        return () => g.insertEvent(t.cal, x.gCopy(master, true), 'none');
      }
      await g.patchEvent(t.cal, t.rid, { recurrence: [g.rruleUntil(parsed.rrule, D.addDays(o.from, -1), false)].concat(parsed.extra) }, send);
      return () => g.patchEvent(t.cal, t.rid, { recurrence: rec }, send);
    }
    // Новий час (і, можливо, дні): правило — щотижня в ці дні, до дати з CRM (або як було в Google)
    const gDays = parsed.rule && parsed.rule.freq === 'week' && parsed.rule.days ? parsed.rule.days : [D.weekday(first)];
    const nd = days || gDays;
    const until = o.after.until || untilG || null;
    let line;
    if (!days && !parsed.rule) {
      if (!whole && parsed.parts && parsed.parts.COUNT) throw Object.assign(new Error('правило повтору цієї серії складне — зміни її в самому Google Календарі'), { code: 'complex' });
      line = o.after.until ? g.rruleUntil(parsed.rrule, o.after.until, false) : parsed.rrule;
    } else {
      if (!whole && parsed.parts && parsed.parts.COUNT && !until) throw Object.assign(new Error('серія в Google має кількість повторів — зміни її в самому Google Календарі'), { code: 'complex' });
      line = g.buildRRule({ freq: 'week', every: days ? 1 : (parsed.rule ? parsed.rule.every : 1), days: nd, until, count: null }, false);
    }
    const tz = master.start.timeZone || g.calendarTz(t.cal);
    const date = firstOn(nd, whole ? first : o.from);
    const times = g.timesBody({ date, allDay: false, start: o.after.start, dur: Number(o.after.dur) || 60 }, tz);
    if (whole) {
      const body = Object.assign({}, times, { recurrence: [line].concat(parsed.extra) });
      const back = {
        start: Object.assign({ date: null, dateTime: null, timeZone: null }, master.start),
        end: Object.assign({ date: null, dateTime: null, timeZone: null }, master.end),
        recurrence: rec
      };
      await g.patchEvent(t.cal, t.rid, body, send);
      return () => g.patchEvent(t.cal, t.rid, back, send);
    }
    const nb = x.gCopy(master, false);
    Object.assign(nb, x.cleanTimes(times));
    nb.recurrence = [line];
    await g.patchEvent(t.cal, t.rid, { recurrence: [g.rruleUntil(parsed.rrule, D.addDays(o.from, -1), false)].concat(parsed.extra) }, send);
    let created;
    try {
      created = await g.insertEvent(t.cal, nb, send);
    } catch (e) {
      // Нову серію не створено — повернути стару як була
      try { await g.patchEvent(t.cal, t.rid, { recurrence: rec }); } catch (z) { /* покаже наступне оновлення */ }
      throw e;
    }
    return async () => {
      await g.deleteEvent(t.cal, created.id, send);
      await g.patchEvent(t.cal, t.rid, { recurrence: rec }, send);
    };
  }

  /**
   * Розклад уроків змінили в CRM з дати from → (з питанням) те саме із серіями «Заняття» в Google.
   * o: { sid, targets (з seriesFor, знайдені ДО зміни), oldDays, from, after: { days, start, dur, until } | null (закінчити),
   *      text, undo, type }. Серій у Google немає — звичайне повідомлення CRM.
   */
  async function followSeries(o) {
    const list = ready() && o && Array.isArray(o.targets) ? o.targets : [];
    if (!list.length || !o || !D.isDate(o.from)) { if (o) crmToast(o); return { state: 'none' }; }
    const name = list[0].g.title;
    const ro = list.map((t) => G().editInfo(t.g)).find((i) => !i.ok);
    if (ro) { crmToast(o, `Серію «${name}» у Google Календарі не змінено: ${ro.why}`, 'info'); return { state: 'readonly' }; }
    let days = null;   // null — у кожної серії Google лишаються свої дні
    if (o.after && !sameSet(o.oldDays, o.after.days)) {
      if (list.length > 1) {
        crmToast(o, `У Google Календарі «${name}» — кілька серій, а дні уроків змінилися: зміни їх у самому Google Календарі.`, 'info');
        return { state: 'ambiguous' };
      }
      days = o.after.days.slice();
    }
    const was = list.map(seriesDesc).join('; ');
    const msg = o.after
      ? `У Google Календарі є ${list.length > 1 ? 'серії' : 'серія'} «${name}» (${was}). Змінити ${list.length > 1 ? 'їх' : 'її'} так само з ${dayShort(o.from)}: ${days ? daysText(days) + ' ' : ''}${timeText(o.after.start, o.after.dur)}? Стара серія закінчиться напередодні, минулі заняття лишаться.`
      : `У Google Календарі є ${list.length > 1 ? 'серії' : 'серія'} «${name}» (${was}). Прибрати й там заняття з ${dayShort(o.from)}? Минулі заняття лишаться.`;
    const ok = await ui.confirm({
      title: o.after ? 'Змінити й серію в Google?' : 'Прибрати й заняття в Google?',
      message: msg, confirmText: o.after ? 'Змінити й у Google' : 'Прибрати й у Google', cancelText: 'Лише в CRM'
    });
    if (!ok) { crmToast(o); return { state: 'declined' }; }
    const send = await askGuests(list[0].g, !o.after);
    const r = send === null ? { ok: false, cancelled: true } : await G().run(async () => {
      const undos = [];
      try {
        for (const t of list) { const u = await applySeries(t, o, days, send || null); if (u) undos.push(u); }
      } catch (e) {
        // Частину вже змінено — повернути, щоб у Google не лишилось половини
        for (const u of undos.reverse()) { try { await u(); } catch (z) { /* далі */ } }
        throw e;
      }
      return undos;
    }, { quiet: true });
    const what = o.after ? `Серію «${name}» у Google Календарі` : `Заняття «${name}» у Google Календарі з ${dayShort(o.from)}`;
    if (!r.ok) {
      crmToast(Object.assign({}, o, { retry: () => followSeriesRetry(o, days, send) }), `${what} не ${o.after ? 'змінено' : 'прибрано'}${failNote(r)}.`, 'warning');
      return { state: r.cancelled ? 'cancelled' : 'failed' };
    }
    const undos = r.value || [];
    const gUndo = undos.length ? async () => { for (const u of undos.slice().reverse()) await u(); } : null;
    crmToast(o, undos.length ? `${what} теж ${o.after ? 'змінено' : 'прибрано'}.` : '', null, gUndo);
    return { state: 'done', undo: gUndo };
  }
  /** «Повторити» після невдачі: без повторного питання. */
  async function followSeriesRetry(o, days, send) {
    const r = await G().run(async () => {
      const undos = [];
      for (const t of o.targets) { const u = await applySeries(t, o, days, send || null); if (u) undos.push(u); }
      return undos;
    }, { quiet: true });
    const what = o.after ? `Серію «${o.targets[0].g.title}» у Google Календарі` : `Заняття «${o.targets[0].g.title}» у Google Календарі`;
    if (!r.ok) {
      ui.toast(`${what} не ${o.after ? 'змінено' : 'прибрано'}${failNote(r)}.`, { type: 'warning', duration: 12000, action: { label: 'Повторити', onClick: () => followSeriesRetry(o, days, send) } });
      return;
    }
    const undos = r.value || [];
    ui.toast(`${what} ${o.after ? 'змінено' : 'прибрано'}.`, {
      type: 'success', action: undos.length ? { label: 'Скасувати', onClick: () => G().run(async () => { for (const u of undos.slice().reverse()) await u(); }) } : undefined
    });
  }

  // ---------- Навпаки: у Google — інший час ----------
  /** «Перенести урок так само»: урок того дня — на час заняття в Google. */
  async function alignToGoogle(sid, date) {
    const L = TU().lessonOn(sid, date);
    const d = L ? diffOf(L) : null;
    if (!L || !d) { ui.toast('У Google Календарі цього заняття вже немає або час однаковий', { type: 'info' }); return false; }
    if (!CRM.calendar || !CRM.calendar.moveEvent) return false;
    await CRM.calendar.moveEvent(L.ev, { start: d.start, dur: d.dur }, 'align');
    return true;
  }
  /** Рядок у вікні уроку: «У Google — 17:00–18:00 · Перенести урок так само» (або null). */
  function lessonNote(L) {
    const d = diffOf(L);
    if (!d) return null;
    return h('div', { class: 'tu-gdiff' }, CRM.icon('calendar', { size: 'sm' }),
      h('span', { class: 'tu-gdiff-text' }, `У Google — ${d.text}`, h('span', { class: 'subtle' }, ` («${d.g.title}»)`)),
      h('button', { type: 'button', class: 'link-like tu-gdiff-align', onClick: () => alignToGoogle(L.sid, L.date) }, 'Перенести урок так само'));
  }

  CRM.tutorGoogle = {
    ready, twinOf, index, diffOf, follow, seriesFor, slotOf, followSeries, alignToGoogle, lessonNote
  };
})(window.CRM);
