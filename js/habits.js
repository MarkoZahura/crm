/* ==========================================================================
   habits.js — розділ «Звички»: щоденні галочки або кількість з метою
   («Вода — 8 склянок»), розклад (щодня / у певні дні тижня / N разів на тиждень),
   лічильник «днів поспіль» і найдовша серія, «Пропуск» (серія не обривається),
   карта року для кожної звички й загальна, картка «Звички сьогодні» на Головній,
   нагадування в обраний час (лише коли CRM відкрита), відмітка через ⚡ («вода +2»).
   Дані — лише в браузері й синхронізації (сховище habits), не в коді.

   Звичка: { id, name, kind: 'check'|'count', target (для count), unit, step (кнопка «+»),
             schedule: { type: 'daily'|'days'|'weekly', days: [0–6] (0 — пн), times: 1–6 },
             startDate: 'РРРР-ММ-ДД', remind: 'ГГ:ХХ'|null, color (id палітри), note, order,
             archived, archivedAt, log: { 'РРРР-ММ-ДД': число | 's' (пропуск) } }
   Ключ нагадування: habit:<id>:<дата>
   ========================================================================== */
window.CRM = window.CRM || {};

(function (CRM) {
  'use strict';

  const { h, ui } = { h: CRM.ui.h, ui: CRM.ui };
  const D = CRM.date;
  const U = CRM.utils;
  const fmt = CRM.fmt;

  const SKIP = 's';
  const MAX_VALUE = 100000;
  const SCHEDS = [
    { id: 'daily', label: 'Щодня' },
    { id: 'days', label: 'У певні дні' },
    { id: 'weekly', label: 'N разів на тиждень' }
  ];
  const KINDS = [
    { id: 'check', label: 'Галочка (так/ні)' },
    { id: 'count', label: 'Кількість' }
  ];
  const COLORS = ['aqua', 'blue', 'orange', 'violet', 'magenta', 'yellow', 'teal', 'red', 'green', 'brown', 'olive', 'slate'];
  const MILESTONES = [7, 14, 21, 30, 50, 75, 100, 150, 200, 250, 300, 365, 500, 730, 1000];
  const TEMPLATES = [
    { name: 'Вода', kind: 'count', target: 8, unit: 'склянок', step: 1, color: 'blue' },
    { name: 'Читання', kind: 'count', target: 20, unit: 'сторінок', step: 5, color: 'orange' },
    { name: 'Медитація', kind: 'check', color: 'violet' },
    { name: 'Пробіжка', kind: 'check', schedule: { type: 'days', days: [0, 2, 4] }, color: 'aqua' },
    { name: 'Спортзал', kind: 'check', schedule: { type: 'weekly', times: 3 }, color: 'red' },
    { name: 'Без солодкого', kind: 'check', color: 'magenta' }
  ];

  // ---------- Дані ----------
  const byOrder = (a, b) => (Number(a.order) || 0) - (Number(b.order) || 0) || String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
  /** Усі звички (без видалених), разом з архівними. */
  const all = () => CRM.store.list('habits').slice().sort(byOrder);
  /** Звички, які зараз ведуться (без архівних). */
  const active = () => all().filter((x) => !x.archived);
  const get = (id) => { const x = CRM.store.get('habits', id); return x && !x.deletedAt ? x : null; };
  const colorOf = (hb) => CRM.dict.categoryColor(hb.color || 'aqua');

  function canSave() {
    if (CRM.db.SCHEMA.habits) return true;
    ui.toast('Браузер показує стару версію сайту з кешу — онови сторінку (Ctrl+F5), щоб вести звички.', { type: 'error', duration: 9000 });
    return false;
  }

  // ---------- Розклад і стан дня ----------
  function sched(hb) {
    const s = hb.schedule || {};
    const type = s.type === 'days' || s.type === 'weekly' ? s.type : 'daily';
    let days = [];
    if (type === 'days') {
      days = Array.from(new Set((Array.isArray(s.days) ? s.days : []).map(Number).filter((x) => x >= 0 && x <= 6))).sort((a, b) => a - b);
      if (!days.length) days = [0, 1, 2, 3, 4, 5, 6];
    }
    const times = type === 'weekly' ? Math.max(1, Math.min(7, Math.round(Number(s.times) || 1))) : 0;
    return { type, days, times };
  }
  const isCount = (hb) => hb.kind === 'count';
  const targetOf = (hb) => (isCount(hb) ? Math.max(0.1, Number(hb.target) || 1) : 1);
  const stepOf = (hb) => (isCount(hb) ? Math.max(0.1, Number(hb.step) || 1) : 1);
  const startOf = (hb) => (D.isDate(hb.startDate) ? hb.startDate : hb.createdAt ? D.toKyivDate(hb.createdAt) : D.today());
  const logOf = (hb) => (hb.log && typeof hb.log === 'object' ? hb.log : {});
  /** Значення дня: число (0 — нічого) або 's' — пропуск. */
  function rawOn(hb, d) {
    const v = logOf(hb)[d];
    if (v === SKIP) return SKIP;
    const n = Number(v);
    return n > 0 ? n : 0;
  }
  /** День за розкладом (для «N разів на тиждень» підходить будь-який день). */
  function isPlanned(hb, d) {
    if (d < startOf(hb)) return false;
    const s = sched(hb);
    return s.type !== 'days' || s.days.includes(D.weekday(d));
  }
  /** Стан дня: done | part | skip | todo (сьогодні, ще нічого) | miss (минув, нічого) | off (не за розкладом / до початку) | future. */
  function dayState(hb, d, T) {
    const today = T || D.today();
    if (d > today) return { v: 0, st: 'future', frac: 0 };
    const v = rawOn(hb, d);
    if (v === SKIP) return { v, st: 'skip', frac: 0 };
    const t = targetOf(hb);
    if (v >= t) return { v, st: 'done', frac: 1 };
    if (v > 0) return { v, st: 'part', frac: v / t };
    if (!isPlanned(hb, d)) return { v: 0, st: 'off', frac: 0 };
    return { v: 0, st: d === today ? 'todo' : 'miss', frac: 0 };
  }
  /** Тиждень для «N разів на тиждень»: скільки треба (менше, якщо днів не вистачає через пропуски чи початок), скільки зроблено. */
  function weekInfo(hb, ws, T) {
    const today = T || D.today();
    const s = sched(hb);
    const start = startOf(hb);
    const t = targetOf(hb);
    let avail = 0;
    let done = 0;
    for (let i = 0; i < 7; i++) {
      const d = D.addDays(ws, i);
      if (d < start) continue;
      const v = rawOn(hb, d);
      if (v === SKIP) continue;
      avail += 1;
      if (d <= today && v >= t) done += 1;
    }
    const need = Math.min(s.times || 1, avail);
    const end = D.addDays(ws, 6);
    return { ws, need, done, complete: need > 0 && done >= need, excused: need === 0, current: ws <= today && today <= end };
  }

  // ---------- Серії ----------
  /** Поточна серія: дні (або тижні для «N разів на тиждень») поспіль. Сьогодні, якщо ще не відмічено, серію не обриває; пропуск — теж. */
  function streak(hb, T) {
    const today = T || D.today();
    const start = startOf(hb);
    let n = 0;
    if (sched(hb).type === 'weekly') {
      let ws = D.startOfWeek(today);
      if (weekInfo(hb, ws, today).complete) n += 1;
      ws = D.addDays(ws, -7);
      while (D.addDays(ws, 6) >= start) {
        const w = weekInfo(hb, ws, today);
        if (w.complete) n += 1;
        else if (!w.excused) break;
        ws = D.addDays(ws, -7);
      }
      return n;
    }
    if (isPlanned(hb, today) && dayState(hb, today, today).st === 'done') n += 1;
    for (let d = D.addDays(today, -1); d >= start; d = D.addDays(d, -1)) {
      if (!isPlanned(hb, d)) continue;
      const st = dayState(hb, d, today).st;
      if (st === 'done') n += 1;
      else if (st !== 'skip') break;
    }
    return n;
  }
  /** Найдовша серія за весь час. */
  function bestStreak(hb, T) {
    const today = T || D.today();
    const start = startOf(hb);
    let best = 0;
    let run = 0;
    if (sched(hb).type === 'weekly') {
      for (let ws = D.startOfWeek(start); ws <= today; ws = D.addDays(ws, 7)) {
        const w = weekInfo(hb, ws, today);
        if (w.complete) { run += 1; best = Math.max(best, run); } else if (!w.excused && !w.current) run = 0;
      }
      return best;
    }
    for (let d = start; d <= today; d = D.addDays(d, 1)) {
      if (!isPlanned(hb, d)) continue;
      const st = dayState(hb, d, today).st;
      if (st === 'done') { run += 1; best = Math.max(best, run); } else if (st !== 'skip' && d !== today) run = 0;
    }
    return best;
  }
  function streakUnit(hb, n) {
    const t = sched(hb).type;
    if (t === 'weekly') return fmt.count(n, ['тиждень', 'тижні', 'тижнів']);
    if (t === 'days') return fmt.count(n, ['раз', 'рази', 'разів']);
    return fmt.count(n, ['день', 'дні', 'днів']);
  }
  const streakText = (hb, n) => streakUnit(hb, n) + ' поспіль';

  // ---------- Тексти ----------
  const num = (n) => fmt.number(n, Math.round(n) === n ? 0 : 1);
  function scheduleText(hb) {
    const s = sched(hb);
    if (s.type === 'weekly') return `${s.times} ${fmt.plural(s.times, ['раз', 'рази', 'рази'])} на тиждень`;
    if (s.type === 'days') {
      const k = s.days.join(',');
      if (k === '0,1,2,3,4,5,6') return 'Щодня';
      if (k === '0,1,2,3,4') return 'Щобудня (пн–пт)';
      if (k === '5,6') return 'Вихідні (сб, нд)';
      return s.days.map((x) => CRM.WEEKDAYS_SHORT[x]).join(', ');
    }
    return 'Щодня';
  }
  function goalText(hb) { return isCount(hb) ? `${num(targetOf(hb))} ${hb.unit || ''}`.trim() : ''; }
  function valueText(hb, v) { return `${num(v || 0)} з ${num(targetOf(hb))}${hb.unit ? ' ' + hb.unit : ''}`; }
  function dayShort(d) { return `${CRM.WEEKDAYS_SHORT[D.weekday(d)]}, ${fmt.dateShort(d)}`; }
  function relDay(d) {
    const n = D.diffDays(d, D.today());
    if (n === 0) return 'сьогодні';
    if (n === 1) return 'вчора';
    return dayShort(d);
  }
  function stateText(hb, d, ds) {
    if (ds.st === 'future') return '';
    if (ds.st === 'skip') return 'пропуск';
    if (ds.st === 'done') return isCount(hb) ? valueText(hb, ds.v) : 'виконано';
    if (ds.st === 'part') return valueText(hb, ds.v);
    if (ds.st === 'off') return d < startOf(hb) ? 'до початку' : 'не за розкладом';
    if (ds.st === 'todo') return 'ще не відмічено';
    return 'не виконано';
  }
  const lvl = (f) => (f >= 1 ? 4 : f >= 0.67 ? 3 : f >= 0.34 ? 2 : f > 0 ? 1 : 0);

  /** Що зі звичкою сьогодні: чи вона на сьогодні (due) і підпис. */
  function todayInfo(hb, T) {
    const today = T || D.today();
    const ds = dayState(hb, today, today);
    const start = startOf(hb);
    if (today < start) return { due: false, ds, note: `почнеться ${dayShort(start)}` };
    if (sched(hb).type === 'weekly') {
      const w = weekInfo(hb, D.startOfWeek(today), today);
      const doneBefore = w.done - (ds.st === 'done' ? 1 : 0);
      const due = ds.st === 'done' || ds.st === 'part' || ds.st === 'skip' || doneBefore < w.need;
      return { due, ds, week: w, note: w.complete && ds.st !== 'done' ? `цього тижня виконано: ${w.done} з ${w.need}` : `цього тижня ${w.done} з ${w.need}` };
    }
    const planned = isPlanned(hb, today);
    return { due: planned || ds.v === SKIP || ds.v > 0, ds, note: planned ? '' : 'сьогодні не за розкладом' };
  }
  /** Звички на сьогодні: { due: [...], other: [...], done, total }. */
  function today(T) {
    const t = T || D.today();
    const due = [];
    const other = [];
    active().forEach((hb) => { (todayInfo(hb, t).due ? due : other).push(hb); });
    const counted = due.filter((hb) => dayState(hb, t, t).st !== 'skip');
    return { due, other, total: counted.length, done: counted.filter((hb) => dayState(hb, t, t).st === 'done').length };
  }

  // ---------- Статистика ----------
  function stats(hb, T) {
    const today = T || D.today();
    const start = startOf(hb);
    const s = sched(hb);
    let doneDays = 0;
    let sum = 0;
    Object.keys(logOf(hb)).forEach((d) => {
      if (d > today) return;
      const v = rawOn(hb, d);
      if (v === SKIP || !v) return;
      sum += v;
      if (v >= targetOf(hb)) doneDays += 1;
    });
    let recent;
    if (s.type === 'weekly') {
      let ok = 0;
      let weeks = 0;
      let ws = D.addDays(D.startOfWeek(today), -7);
      for (let i = 0; i < 4 && D.addDays(ws, 6) >= start; i++, ws = D.addDays(ws, -7)) {
        const w = weekInfo(hb, ws, today);
        if (w.excused) continue;
        weeks += 1;
        if (w.complete) ok += 1;
      }
      recent = { text: weeks ? `${ok} з ${fmt.count(weeks, ['тижня', 'тижнів', 'тижнів'])}` : '—', sub: 'останні 4 тижні', pct: weeks ? ok / weeks : null };
    } else {
      let planned = 0;
      let ok = 0;
      for (let i = 0; i < 30; i++) {
        const d = D.addDays(today, -i);
        if (d < start) break;
        if (!isPlanned(hb, d)) continue;
        const st = dayState(hb, d, today).st;
        if (st === 'skip' || st === 'todo' || (st === 'part' && d === today)) continue;
        planned += 1;
        if (st === 'done') ok += 1;
      }
      recent = { text: planned ? Math.round(ok / planned * 100) + '%' : '—', sub: planned ? `${ok} з ${planned} за розкладом` : 'ще немає даних', pct: planned ? ok / planned : null };
    }
    return { streak: streak(hb, today), best: bestStreak(hb, today), doneDays, sum, recent };
  }

  // ---------- Зміна дня ----------
  /**
   * Записати день: value — число (для галочки 1 = виконано), 0/null — очистити, 's' — пропуск.
   * Повертає { before, startBefore, saved } (для «Скасувати») або null.
   */
  async function setDay(id, d, value) {
    const hb = get(id);
    if (!hb || !canSave()) return null;
    const T = D.today();
    if (!D.isDate(d) || d > T) { ui.toast('Майбутні дні відмітити не можна', { type: 'error' }); return null; }
    const log = Object.assign({}, logOf(hb));
    const before = Object.prototype.hasOwnProperty.call(log, d) ? log[d] : null;
    if (value === SKIP) log[d] = SKIP;
    else {
      let v = Math.round((Number(value) || 0) * 10) / 10;
      if (!isCount(hb)) v = v > 0 ? 1 : 0;
      v = Math.max(0, Math.min(MAX_VALUE, v));
      if (v > 0) log[d] = v; else delete log[d];
    }
    const rec = Object.assign({}, hb, { log });
    const startBefore = startOf(hb);
    if (log[d] != null && d < startBefore) rec.startDate = d;
    const prev = streak(hb, T);
    const saved = await CRM.store.save('habits', rec);
    CRM.notify.runRules();
    const n = streak(saved, T);
    if (n > prev && MILESTONES.includes(n)) ui.toast(`${saved.name}: ${streakText(saved, n)}! Так тримати`, { type: 'success', duration: 6000 });
    return { before, startBefore, saved };
  }
  /** Повернути день як було (для «Скасувати»). */
  async function restoreDay(id, d, before, startBefore) {
    const hb = get(id);
    if (!hb) return;
    const log = Object.assign({}, logOf(hb));
    if (before == null) delete log[d]; else log[d] = before;
    await CRM.store.save('habits', Object.assign({}, hb, { log, startDate: startBefore || hb.startDate }));
    CRM.notify.runRules();
  }
  /** Галочка сьогодні / «+крок» для кількості. */
  function tap(id, d) {
    const hb = get(id);
    if (!hb) return null;
    const day = d || D.today();
    const v = rawOn(hb, day);
    if (!isCount(hb)) return setDay(id, day, v === SKIP || !v ? 1 : 0);
    return setDay(id, day, (v === SKIP ? 0 : v) + stepOf(hb));
  }

  // ---------- Елементи ----------
  function dot(hb) { return h('span', { class: 'hb-dot', style: { background: colorOf(hb) }, 'aria-hidden': 'true' }); }

  /** Керування сьогоднішнім днем: галочка або «5 з 8» + «+1». */
  function control(hb, opts) {
    const o = opts || {};
    const d = o.date || D.today();
    const ds = dayState(hb, d);
    const style = { '--hb': colorOf(hb) };
    if (!isCount(hb)) {
      const done = ds.st === 'done';
      return h('button', {
        type: 'button', class: 'hb-check' + (done ? ' checked' : '') + (ds.st === 'skip' ? ' skip' : '') + (o.big ? ' big' : ''), style,
        role: 'checkbox', 'aria-checked': done ? 'true' : 'false', dataset: { habit: hb.id },
        'aria-label': `${hb.name}: ${done ? 'виконано — натисни, щоб зняти' : ds.st === 'skip' ? 'пропуск — натисни, щоб відмітити' : 'відмітити виконаним'}`,
        title: done ? 'Виконано — натисни, щоб зняти' : ds.st === 'skip' ? 'Пропуск — натисни, щоб відмітити виконаним' : 'Відмітити виконаним',
        onClick: (e) => { e.stopPropagation(); tap(hb.id, d); }
      }, ds.st === 'skip' ? h('span', { class: 'hb-skip-mark' }, '—') : CRM.icon('check', { size: 'sm' }));
    }
    const v = ds.v === SKIP ? 0 : ds.v;
    const valBtn = h('button', {
      type: 'button', class: 'hb-val num', dataset: { habit: hb.id }, title: 'Ввести кількість',
      'aria-label': `${hb.name}: ${ds.st === 'skip' ? 'пропуск' : valueText(hb, v)} — змінити`,
      onClick: (e) => { e.stopPropagation(); openDay(hb.id, d, valBtn); }
    }, ds.st === 'skip' ? 'пропуск' : `${num(v)}/${num(targetOf(hb))}`);
    return h('div', { class: 'hb-count' + (ds.st === 'done' ? ' done' : '') + (o.big ? ' big' : ''), style },
      h('span', { class: 'hb-bar', 'aria-hidden': 'true' }, h('span', { style: { width: Math.min(100, Math.round(ds.frac * 100)) + '%' } })),
      valBtn,
      h('button', {
        type: 'button', class: 'hb-plus', dataset: { habit: hb.id }, title: `Додати ${num(stepOf(hb))}`, 'aria-label': `${hb.name}: додати ${num(stepOf(hb))}`,
        onClick: (e) => { e.stopPropagation(); tap(hb.id, d); }
      }, '+' + num(stepOf(hb))));
  }

  /** Смужка останніх 7 днів (клік — відмітити або змінити день). */
  function strip(hb) {
    const T = D.today();
    const box = h('div', { class: 'hb-strip', style: { '--hb': colorOf(hb) }, role: 'group', 'aria-label': `${hb.name}: останні 7 днів` });
    for (let i = 6; i >= 0; i--) {
      const d = D.addDays(T, -i);
      const ds = dayState(hb, d, T);
      const b = h('button', {
        type: 'button', class: `hb-sd ${ds.st} lv${lvl(ds.frac)}` + (d === T ? ' today' : ''), dataset: { date: d },
        title: `${dayShort(d)}: ${stateText(hb, d, ds)}`, 'aria-label': `${dayShort(d)}: ${stateText(hb, d, ds)}`,
        onClick: (e) => { e.stopPropagation(); openDay(hb.id, d, b); }
      }, h('span', { class: 'hb-sd-wd' }, CRM.WEEKDAYS_SHORT[D.weekday(d)]), h('span', { class: 'hb-sd-box' }, ds.st === 'skip' ? '—' : ds.st === 'done' ? CRM.icon('check', { size: 'sm' }) : null));
      box.appendChild(b);
    }
    return box;
  }

  function streakBadge(hb, st) {
    const n = st ? st.streak : streak(hb);
    return h('span', { class: 'hb-streak' + (n ? ' on' : ''), title: `Поточна серія: ${streakText(hb, n)}` + (st ? ` · найдовша: ${streakUnit(hb, st.best)}` : '') },
      CRM.icon('flame', { size: 'sm' }), h('b', { class: 'num' }, String(n)));
  }

  // ---------- Віконце дня ----------
  let dayPop = null;
  /** Відмітити будь-який минулий день: виконано / кількість / пропуск / очистити. */
  function openDay(id, d, anchor) {
    const hb = get(id);
    if (!hb) return null;
    if (dayPop) { dayPop.close(); dayPop = null; }
    const T = D.today();
    if (d > T) { ui.toast('Майбутні дні відмітити не можна', { type: 'error' }); return null; }
    const ds = dayState(hb, d, T);
    let pop = null;
    const apply = async (v) => { pop.close(); await setDay(id, d, v); };
    const actions = [];
    let numIn = null;
    if (isCount(hb)) {
      numIn = h('input', { class: 'input hb-pop-num num', inputmode: 'decimal', value: ds.v === SKIP || !ds.v ? '' : String(ds.v).replace('.', ','), placeholder: '0', 'aria-label': `Кількість${hb.unit ? ', ' + hb.unit : ''}` });
      const read = () => { const x = Number(String(numIn.value).replace(',', '.').replace(/\s/g, '')); return Number.isFinite(x) && x >= 0 ? x : null; };
      const bump = (k) => { const x = read() || 0; numIn.value = String(Math.max(0, Math.round((x + k * stepOf(hb)) * 10) / 10)).replace('.', ','); numIn.focus(); };
      const save = () => { const x = read(); if (x == null || x > MAX_VALUE) { numIn.classList.add('invalid'); numIn.focus(); return; } apply(x); };
      numIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
      numIn.addEventListener('input', () => numIn.classList.remove('invalid'));
      actions.push(h('div', { class: 'hb-pop-count' },
        h('button', { type: 'button', class: 'btn btn-sm btn-icon hb-pop-minus', 'aria-label': 'Менше', onClick: () => bump(-1) }, '−'),
        numIn,
        h('button', { type: 'button', class: 'btn btn-sm btn-icon hb-pop-more', 'aria-label': 'Більше', onClick: () => bump(1) }, '+'),
        h('span', { class: 'subtle' }, `з ${num(targetOf(hb))}${hb.unit ? ' ' + hb.unit : ''}`)));
      actions.push(h('div', { class: 'hb-pop-btns' },
        ui.button({ label: 'Зберегти', variant: 'primary', size: 'sm', className: 'hb-pop-save', onClick: save }),
        ui.button({ label: 'Пропуск', size: 'sm', className: 'hb-pop-skip' + (ds.st === 'skip' ? ' active' : ''), title: 'Поважна причина (хворів, у дорозі) — серія не обірветься', onClick: () => apply(SKIP) }),
        ds.v ? ui.button({ label: 'Очистити', size: 'sm', variant: 'ghost', className: 'hb-pop-clear', onClick: () => apply(0) }) : null));
    } else {
      actions.push(h('div', { class: 'hb-pop-btns' },
        ui.button({ label: 'Виконано', icon: 'check', variant: ds.st === 'done' ? null : 'primary', size: 'sm', className: 'hb-pop-done' + (ds.st === 'done' ? ' active' : ''), onClick: () => apply(1) }),
        ui.button({ label: 'Пропуск', size: 'sm', className: 'hb-pop-skip' + (ds.st === 'skip' ? ' active' : ''), title: 'Поважна причина (хворів, у дорозі) — серія не обірветься', onClick: () => apply(SKIP) }),
        ds.v ? ui.button({ label: 'Очистити', size: 'sm', variant: 'ghost', className: 'hb-pop-clear', onClick: () => apply(0) }) : null));
    }
    const content = h('div', { class: 'hb-pop' },
      h('div', { class: 'hb-pop-title' }, dot(hb), h('span', null, hb.name)),
      h('div', { class: 'hb-pop-day subtle' }, `${CRM.WEEKDAYS[D.weekday(d)]}, ${fmt.date(d)} · ${stateText(hb, d, ds) || '—'}`),
      actions,
      d < startOf(hb) ? h('div', { class: 'hb-pop-hint subtle' }, `Звичка ведеться з ${fmt.date(startOf(hb))} — відмітка перенесе початок на цей день.`) : null);
    pop = ui.popover(anchor, content, { className: 'hb-popover', align: 'start', onClose: () => { if (dayPop === pop) dayPop = null; } });
    dayPop = pop;
    if (numIn) setTimeout(() => { numIn.focus(); numIn.select(); }, 0);
    else { const b = pop.el.querySelector('.hb-pop-done'); if (b) b.focus(); }
    return pop;
  }

  // ---------- Карта року ----------
  /**
   * Сітка року: стовпчики — тижні (з понеділка), рядки — дні тижня.
   * cell(d) → { lvl, cls, title }; onClick(d, el) — для клікабельних днів (до сьогодні включно).
   */
  function yearGrid(year, cell, opts) {
    const o = opts || {};
    const T = D.today();
    const first = D.make(year, 1, 1);
    const last = D.make(year, 12, 31);
    const ws0 = D.startOfWeek(first);
    const weeks = D.diffDays(ws0, D.startOfWeek(last)) / 7 + 1;
    const grid = h('div', { class: 'hb-year' + (o.onClick ? ' clickable' : ''), style: { gridTemplateColumns: `22px repeat(${weeks}, minmax(10px, 1fr))` }, 'aria-label': o.label || `Карта ${year} року` });
    for (let m = 1; m <= 12; m++) {
      const col = D.diffDays(ws0, D.startOfWeek(D.make(year, m, 1))) / 7;
      grid.appendChild(h('span', { class: 'hb-mon', style: { gridColumn: `${col + 2} / span 4`, gridRow: '1' }, 'aria-hidden': 'true' }, CRM.MONTHS_SHORT[m - 1]));
    }
    // Підписи днів тижня (Пн, Ср, Пт) — стовпчик лишається на місці, коли сітку гортають на телефоні
    for (let w = -1; w < 7; w++) grid.appendChild(h('span', { class: 'hb-wd', style: { gridColumn: '1', gridRow: String(w + 2) }, 'aria-hidden': 'true' }, w % 2 === 0 && w < 6 ? CRM.WEEKDAYS_SHORT[w] : ''));
    for (let d = first; d <= last; d = D.addDays(d, 1)) {
      const c = cell(d);
      const click = o.onClick && d <= T;
      grid.appendChild(h(click ? 'button' : 'span', {
        type: click ? 'button' : null, class: `hb-c lv${c.lvl || 0}` + (c.cls ? ' ' + c.cls : '') + (d === T ? ' today' : ''),
        style: { gridColumn: String(Math.floor(D.diffDays(ws0, d) / 7) + 2), gridRow: String(D.weekday(d) + 2) },
        title: c.title || null, 'aria-label': click ? c.title : null, dataset: { date: d }
      }));
    }
    if (o.onClick) grid.addEventListener('click', (e) => { const b = e.target.closest('button.hb-c'); if (b) o.onClick(b.dataset.date, b); });
    const wrap = h('div', { class: 'hb-year-wrap' }, grid);
    // На вузькому екрані сітка прокручується — показуємо поточний місяць
    requestAnimationFrame(() => {
      if (wrap.scrollWidth <= wrap.clientWidth + 1) return;
      const t = grid.querySelector('.today');
      wrap.scrollLeft = t ? Math.max(0, t.offsetLeft - wrap.clientWidth + 48) : (year < Number(T.slice(0, 4)) ? wrap.scrollWidth : 0);
    });
    return wrap;
  }
  function legend(extra) {
    return h('div', { class: 'hb-legend subtle' },
      h('span', null, 'Менше'), [0, 1, 2, 3, 4].map((x) => h('span', { class: 'hb-c lv' + x, 'aria-hidden': 'true' })), h('span', null, 'Більше'),
      extra !== false ? [h('span', { class: 'hb-legend-sep' }), h('span', { class: 'hb-c skip', 'aria-hidden': 'true' }), h('span', null, 'пропуск'),
        h('span', { class: 'hb-c off', 'aria-hidden': 'true' }), h('span', null, 'не за розкладом')] : null);
  }
  function yearSwitch(year, minY, maxY, onChange) {
    return h('div', { class: 'hb-yearsw', role: 'group', 'aria-label': 'Рік' },
      h('button', { type: 'button', class: 'btn btn-ghost btn-icon btn-sm hb-year-prev', 'aria-label': 'Попередній рік', title: 'Попередній рік', disabled: year <= minY, onClick: () => onChange(year - 1) }, CRM.icon('chevronLeft')),
      h('b', { class: 'num hb-year-num' }, String(year)),
      h('button', { type: 'button', class: 'btn btn-ghost btn-icon btn-sm hb-year-next', 'aria-label': 'Наступний рік', title: 'Наступний рік', disabled: year >= maxY, onClick: () => onChange(year + 1) }, CRM.icon('chevronRight')));
  }
  /** Карта однієї звички. */
  function habitCell(hb, T) {
    return (d) => {
      const ds = dayState(hb, d, T);
      const t = stateText(hb, d, ds);
      return { lvl: lvl(ds.frac), cls: ds.st, title: t ? `${dayShort(d)}: ${t}` : dayShort(d) };
    };
  }
  function yearSummary(hb, year, T) {
    const from = D.make(year, 1, 1);
    const to = D.make(year, 12, 31) < T ? D.make(year, 12, 31) : T;
    let done = 0;
    let planned = 0;
    for (let d = from < startOf(hb) ? startOf(hb) : from; d <= to; d = D.addDays(d, 1)) {
      const st = dayState(hb, d, T).st;
      if (st === 'done') done += 1;
      if (isPlanned(hb, d) && st !== 'skip' && !(d === T && st !== 'done')) planned += 1;
    }
    if (sched(hb).type === 'weekly') return `У ${year}: виконано ${fmt.count(done, ['день', 'дні', 'днів'])}`;
    return `У ${year}: виконано ${fmt.count(done, ['день', 'дні', 'днів'])}` + (planned ? ` з ${planned} за розкладом (${Math.round(Math.min(done, planned) / planned * 100)}%)` : '');
  }
  /** Загальна оцінка дня по всіх звичках (частка виконаного). */
  function dayScore(hs, d, T) {
    let n = 0;
    let of = 0;
    let doneAll = 0;
    hs.forEach((hb) => {
      if (d < startOf(hb)) return;
      if (hb.archived && hb.archivedAt && d >= hb.archivedAt) return;
      const ds = dayState(hb, d, T);
      if (ds.st === 'skip' || ds.st === 'future') return;
      if (sched(hb).type === 'weekly' || !isPlanned(hb, d)) {
        if (ds.v > 0) { n += ds.frac; of += 1; if (ds.st === 'done') doneAll += 1; }
        return;
      }
      n += ds.frac;
      of += 1;
      if (ds.st === 'done') doneAll += 1;
    });
    return { frac: of ? n / of : 0, of, done: doneAll };
  }

  // ---------- Сторінка «Звички» ----------
  let overallYear = null;
  const pageYears = new Map();

  function habitRow(hb, T) {
    const st = stats(hb, T);
    const ti = todayInfo(hb, T);
    const sub = [scheduleText(hb), goalText(hb), ti.note, hb.remind ? 'нагадування о ' + hb.remind : null].filter(Boolean).join(' · ');
    return h('div', { class: 'hb-row' + (ti.ds.st === 'done' ? ' done' : ''), dataset: { id: hb.id }, style: { '--hb': colorOf(hb) } },
      h('a', { class: 'hb-row-main', href: CRM.router.href('habits/' + hb.id) },
        dot(hb),
        h('span', { class: 'hb-row-text' },
          h('span', { class: 'hb-row-name' }, hb.name),
          h('span', { class: 'hb-row-sub' }, sub))),
      strip(hb),
      streakBadge(hb, st),
      h('div', { class: 'hb-row-ctrl' }, control(hb)));
  }

  function templateChips() {
    return h('div', { class: 'hb-templates' },
      h('div', { class: 'subtle' }, 'Швидкий старт:'),
      h('div', { class: 'chips' }, TEMPLATES.map((t) => h('button', { type: 'button', class: 'chip hb-tpl', onClick: () => openForm(null, U.deepClone(t)) },
        t.name + (t.kind === 'count' ? ` · ${t.target} ${t.unit}` : t.schedule && t.schedule.type === 'weekly' ? ` · ${t.schedule.times} рази на тиждень` : t.schedule ? ' · пн, ср, пт' : '')))));
  }

  function renderList(container) {
    const T = D.today();
    const habits = all();
    const act = habits.filter((x) => !x.archived);
    const arch = habits.filter((x) => x.archived);
    const head = ui.pageHead({
      title: 'Звички', sub: 'Щоденні галочки, серії «днів поспіль» і карта року.',
      actions: [ui.button({ label: 'Нова звичка', icon: 'plus', variant: 'primary', className: 'hb-add-btn', onClick: () => openForm() })]
    });
    if (!habits.length) {
      ui.mount(container, head, h('section', { class: 'card hb-empty-card' }, ui.empty({
        icon: 'habits', title: 'Ще немає звичок',
        text: 'Додай звичку — галочку («Медитація») або кількість з метою («Вода — 8 склянок»). Можна щодня, у певні дні тижня або кілька разів на тиждень. Тут зʼявиться лічильник «днів поспіль» і карта року, а на Головній — картка «Звички сьогодні».',
        action: { label: 'Додати звичку', icon: 'plus', onClick: () => openForm() }
      }), templateChips()));
      return;
    }
    const td = today(T);
    const progress = td.total ? td.done / td.total : 0;
    const list = h('section', { class: 'card hb-list-card', style: { '--p': progress } },
      h('div', { class: 'card-head' },
        h('h2', null, 'Сьогодні', h('span', { class: 'subtle hb-head-date' }, dayShort(T))),
        td.total ? h('span', { class: 'hb-progress-text' + (td.done === td.total ? ' all' : '') }, td.done === td.total ? `Усе виконано · ${td.done} з ${td.total}` : `${td.done} з ${td.total}`) : null),
      td.total ? h('div', { class: 'hb-progress', 'aria-hidden': 'true' }, h('span', { style: { width: Math.round(progress * 100) + '%' } })) : null,
      act.length ? null : h('div', { class: 'card-body subtle' }, 'Усі звички в архіві.'),
      td.due.length ? h('div', { class: 'hb-rows' }, td.due.map((hb) => habitRow(hb, T))) : (act.length ? h('div', { class: 'card-body subtle' }, 'На сьогодні звичок за розкладом немає.') : null),
      td.other.length ? [h('div', { class: 'hb-group' }, 'Сьогодні не за розкладом'), h('div', { class: 'hb-rows hb-rows-other' }, td.other.map((hb) => habitRow(hb, T)))] : null);

    // Загальна карта року
    const minY = Math.min(Number(T.slice(0, 4)), ...habits.map((x) => Number(startOf(x).slice(0, 4))));
    const maxY = Number(T.slice(0, 4));
    if (overallYear == null || overallYear > maxY || overallYear < minY) overallYear = maxY;
    const year = overallYear;
    let allDays = 0;
    let anyDays = 0;
    const cellAll = (d) => {
      if (d > T) return { lvl: 0, cls: 'future' };
      const s = dayScore(habits, d, T);
      if (!s.of) return { lvl: 0, cls: 'off', title: dayShort(d) };
      if (s.done === s.of) allDays += 1;
      if (s.frac > 0) anyDays += 1;
      return { lvl: lvl(s.frac), cls: '', title: `${dayShort(d)}: виконано ${num(s.done)} з ${s.of}` };
    };
    const grid = yearGrid(year, cellAll, { label: `Усі звички, ${year} рік` });
    const yearCard = h('section', { class: 'card hb-year-card' },
      h('div', { class: 'card-head' }, h('h2', null, CRM.icon('habits', { size: 'sm' }), 'Рік: усі звички'),
        yearSwitch(year, minY, maxY, (y) => { overallYear = y; CRM.router.rerender(); })),
      h('div', { class: 'card-body' }, grid,
        h('div', { class: 'hb-year-foot' }, legend(false),
          h('span', { class: 'subtle hb-year-sum' }, `Днів, коли виконано все: ${allDays} · хоча б щось: ${anyDays}`))));

    const archBox = arch.length ? h('details', { class: 'card hb-arch' },
      h('summary', null, CRM.icon('archive', { size: 'sm' }), `Архів · ${arch.length}`),
      h('div', { class: 'hb-arch-list' }, arch.map((hb) => h('div', { class: 'hb-arch-row' },
        h('a', { class: 'hb-row-main', href: CRM.router.href('habits/' + hb.id) }, dot(hb),
          h('span', { class: 'hb-row-text' }, h('span', { class: 'hb-row-name' }, hb.name),
            h('span', { class: 'hb-row-sub' }, [scheduleText(hb), `найдовша серія: ${streakUnit(hb, bestStreak(hb, T))}`, hb.archivedAt ? 'в архіві з ' + fmt.dateShort(hb.archivedAt) : null].filter(Boolean).join(' · ')))),
        ui.button({ label: 'Повернути', icon: 'restore', size: 'sm', className: 'hb-unarchive', onClick: () => setArchived(hb.id, false) }))))) : null;

    ui.mount(container, head, h('div', { class: 'stack' }, list, yearCard, archBox));
  }

  function renderHabit(container, id) {
    const hb = get(id);
    const back = h('a', { class: 'btn btn-ghost btn-sm hb-back', href: '#/habits' }, CRM.icon('chevronLeft', { size: 'sm' }), 'Звички');
    if (!hb) {
      ui.mount(container, back, ui.pageHead({ title: 'Звичку не знайдено' }), h('section', { class: 'card' }, ui.empty({
        icon: 'habits', title: 'Такої звички немає', text: 'Можливо, її видалено (перевір Кошик).', action: { label: 'До звичок', onClick: () => CRM.router.go('habits') }
      })));
      return;
    }
    const T = D.today();
    const st = stats(hb, T);
    const ti = todayInfo(hb, T);
    const head = ui.pageHead({
      title: hb.name,
      sub: [scheduleText(hb), goalText(hb) ? 'мета — ' + goalText(hb) : null, 'з ' + fmt.date(startOf(hb)), hb.remind ? 'нагадування о ' + hb.remind : null].filter(Boolean).join(' · '),
      actions: [
        hb.archived ? null : h('div', { class: 'hb-head-ctrl' }, h('span', { class: 'subtle' }, ti.ds.st === 'done' ? 'Сьогодні виконано' : ti.note || 'Сьогодні'), control(hb, { big: true })),
        ui.button({ label: 'Змінити', icon: 'pencil', className: 'hb-edit', onClick: () => openForm(hb.id) })
      ]
    });
    head.querySelector('h1').prepend(dot(hb));
    const tile = (label, value, sub, icon) => h('div', { class: 'stat hb-stat' },
      h('div', { class: 'stat-label' }, h('span', { class: 'stat-ico hb-stat-ico' }, CRM.icon(icon, { size: 'sm' })), label),
      h('div', { class: 'stat-value num' }, value), sub ? h('div', { class: 'hb-stat-sub subtle' }, sub) : null);
    const total = isCount(hb) ? `${num(st.sum)}${hb.unit ? ' ' + hb.unit : ''}` : fmt.count(st.doneDays, ['день', 'дні', 'днів']);
    const tiles = h('section', { class: 'card' }, h('div', { class: 'card-body' }, h('div', { class: 'stats hb-stats' },
      tile('Поточна серія', streakUnit(hb, st.streak), 'поспіль', 'flame'),
      tile('Найдовша серія', streakUnit(hb, st.best), 'за весь час', 'trendUp'),
      tile(sched(hb).type === 'weekly' ? 'Тижні з планом' : 'За 30 днів', st.recent.text, st.recent.sub, 'target'),
      tile('Усього', total, isCount(hb) ? `виконано ${fmt.count(st.doneDays, ['день', 'дні', 'днів'])}` : 'виконано', 'checkCircle'))));

    const minY = Math.min(Number(startOf(hb).slice(0, 4)), Number(T.slice(0, 4)));
    const maxY = Number(T.slice(0, 4));
    let year = pageYears.get(hb.id) || maxY;
    if (year > maxY || year < minY) year = maxY;
    const grid = yearGrid(year, habitCell(hb, T), { label: `${hb.name}, ${year} рік`, onClick: (d, el) => openDay(hb.id, d, el) });
    const yearCard = h('section', { class: 'card hb-year-card', style: { '--hb': colorOf(hb) } },
      h('div', { class: 'card-head' }, h('h2', null, 'Карта року'), yearSwitch(year, minY, maxY, (y) => { pageYears.set(hb.id, y); CRM.router.rerender(); })),
      h('div', { class: 'card-body' }, grid,
        h('div', { class: 'hb-year-foot' }, legend(), h('span', { class: 'subtle hb-year-sum' }, yearSummary(hb, year, T))),
        h('p', { class: 'subtle hb-year-hint' }, 'Клік по дню — відмітити, змінити кількість або поставити «Пропуск» (серія не обірветься). Майбутні дні відмітити не можна.')));
    ui.mount(container, back, head,
      h('div', { class: 'stack' },
        hb.archived ? h('div', { class: 'callout' }, CRM.icon('archive'), h('span', null, `Звичка в архіві${hb.archivedAt ? ' з ' + fmt.date(hb.archivedAt) : ''} — її немає на Головній і в нагадуваннях, історія збережена. `),
          ui.button({ label: 'Повернути з архіву', size: 'sm', className: 'hb-unarchive', onClick: () => setArchived(hb.id, false) })) : null,
        tiles,
        h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', null, 'Останні 7 днів')), h('div', { class: 'card-body hb-week-body' }, strip(hb))),
        yearCard,
        hb.note ? h('section', { class: 'card' }, h('div', { class: 'card-head' }, h('h2', null, 'Нотатка')), h('div', { class: 'card-body hb-note' }, hb.note)) : null));
  }

  function render(container, route) {
    const onTheme = () => CRM.router.rerender();
    document.addEventListener('crm:themechange', onTheme);
    if (route && route.sub) renderHabit(container, route.sub);
    else renderList(container);
    const p = route && route.params;
    if (p && p.open) {
      const id = p.open;
      CRM.router.consumeParam('open');
      setTimeout(() => openForm(id), 0);
    }
    return () => { document.removeEventListener('crm:themechange', onTheme); if (dayPop) { dayPop.close(); dayPop = null; } };
  }

  // ---------- Форма звички ----------
  function nextColor() {
    const used = new Set(active().map((x) => x.color));
    return COLORS.find((c) => !used.has(c)) || COLORS[active().length % COLORS.length];
  }
  function openForm(id, preset) {
    const cur = id ? CRM.store.get('habits', id) : null;
    if (id && (!cur || cur.deletedAt)) { ui.toast(cur ? 'Звичка в Кошику — віднови, щоб змінити' : 'Цієї звички більше немає', { type: 'error' }); return null; }
    const isNew = !cur;
    const st = Object.assign({
      name: '', kind: 'check', target: 8, unit: '', step: 1, schedule: { type: 'daily', days: [0, 2, 4], times: 3 },
      remind: null, color: nextColor(), startDate: D.today(), note: ''
    }, cur ? U.deepClone(cur) : {}, preset || {});
    const s0 = sched(st);
    st.schedule = { type: s0.type, days: s0.type === 'days' ? s0.days : (preset && preset.schedule && preset.schedule.days) || [0, 2, 4], times: s0.times || 3 };
    if (!isCount(st)) { st.target = st.target || 8; st.step = st.step || 1; }
    st.startDate = startOf(st);

    const nameIn = ui.input({ value: st.name, maxlength: 60, placeholder: 'Напр., Вода, Читання, Медитація', 'aria-label': 'Назва звички', class: 'input hb-name' });
    const fName = ui.field({ label: 'Назва', input: nameIn, required: true });

    // Тип
    const kindSeg = h('div', { class: 'segmented hb-kinds', role: 'radiogroup', 'aria-label': 'Тип' });
    const targetIn = ui.input({ value: String(st.target).replace('.', ','), inputmode: 'decimal', maxlength: 8, 'aria-label': 'Мета на день', class: 'input hb-target num' });
    const unitIn = ui.input({ value: st.unit || '', maxlength: 20, placeholder: 'склянок, сторінок, хв', 'aria-label': 'Одиниця', class: 'input hb-unit' });
    const stepIn = ui.input({ value: String(st.step).replace('.', ','), inputmode: 'decimal', maxlength: 8, 'aria-label': 'Кнопка «+» додає', class: 'input hb-step num' });
    const fTarget = ui.field({ label: 'Мета на день', input: targetIn });
    const fStep = ui.field({ label: 'Кнопка «+» додає', input: stepIn });
    const countBox = h('div', { class: 'hb-count-box form-grid' }, fTarget, ui.field({ label: 'Одиниця', input: unitIn }), fStep);
    function renderKind() {
      ui.mount(kindSeg, KINDS.map((k) => h('button', {
        type: 'button', role: 'radio', class: st.kind === k.id ? 'active' : '', 'aria-checked': st.kind === k.id ? 'true' : 'false', dataset: { kind: k.id },
        onClick: () => { st.kind = k.id; renderKind(); }
      }, k.label)));
      countBox.hidden = st.kind !== 'count';
    }
    renderKind();

    // Розклад
    const schedSeg = h('div', { class: 'segmented hb-scheds', role: 'radiogroup', 'aria-label': 'Розклад' });
    const daysBox = h('div', { class: 'hb-wdays', role: 'group', 'aria-label': 'Дні тижня' });
    const timesSel = h('select', { class: 'select hb-times', 'aria-label': 'Скільки разів на тиждень' },
      [1, 2, 3, 4, 5, 6].map((n) => h('option', { value: String(n), selected: n === st.schedule.times }, `${n} ${fmt.plural(n, ['раз', 'рази', 'рази'])} на тиждень`)));
    timesSel.addEventListener('change', () => { st.schedule.times = Number(timesSel.value); renderSched(); });
    const schedHint = h('div', { class: 'field-hint hb-sched-hint' });
    function renderDays() {
      ui.mount(daysBox, CRM.WEEKDAYS_SHORT.map((w, i) => {
        const on = st.schedule.days.includes(i);
        return h('button', {
          type: 'button', class: 'hb-wday' + (on ? ' active' : ''), 'aria-pressed': on ? 'true' : 'false', dataset: { day: String(i) }, title: CRM.WEEKDAYS[i],
          onClick: () => {
            if (on && st.schedule.days.length === 1) { ui.toast('Потрібен хоча б один день', { type: 'error' }); return; }
            st.schedule.days = on ? st.schedule.days.filter((x) => x !== i) : st.schedule.days.concat(i).sort((a, b) => a - b);
            renderDays();
            renderSched();
          }
        }, w);
      }));
    }
    function renderSched() {
      const t = st.schedule.type;
      ui.mount(schedSeg, SCHEDS.map((x) => h('button', {
        type: 'button', role: 'radio', class: t === x.id ? 'active' : '', 'aria-checked': t === x.id ? 'true' : 'false', dataset: { sched: x.id },
        onClick: () => { st.schedule.type = x.id; renderSched(); }
      }, x.label)));
      daysBox.hidden = t !== 'days';
      timesSel.hidden = t !== 'weekly';
      schedHint.textContent = t === 'weekly'
        ? 'У будь-які дні тижня (з понеділка по неділю). Серія — тижні поспіль, коли план виконано.'
        : t === 'days' ? `Лише ${scheduleText({ schedule: st.schedule }).toLowerCase()} — інші дні серію не обривають.` : 'Кожен день. Серія — дні поспіль.';
    }
    renderDays();
    renderSched();

    // Нагадування, колір, початок, нотатка
    const remindIn = ui.timeInput({ value: st.remind || '', ariaLabel: 'Нагадування (необовʼязково)', onChange: (v) => { st.remind = v || null; } });
    remindIn.classList.add('hb-remind');
    const sw = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Колір' });
    function renderSw() {
      ui.mount(sw, COLORS.map((c) => {
        const info = CRM.dict.get('categoryColors', c) || {};
        return h('button', {
          type: 'button', role: 'radio', class: 'swatch' + (st.color === c ? ' active' : ''), style: { '--sw': CRM.dict.categoryColor(c) },
          title: info.name || c, 'aria-label': info.name || c, 'aria-checked': st.color === c ? 'true' : 'false', dataset: { color: c },
          onClick: () => { st.color = c; renderSw(); }
        }, st.color === c ? CRM.icon('check') : null);
      }));
    }
    renderSw();
    const startIn = ui.dateInput({ value: st.startDate, clearable: false, ariaLabel: 'Відлік з', onChange: (v) => { if (v) st.startDate = v; } });
    const noteIn = ui.textarea({ value: st.note || '', rows: 2, maxlength: 1000, placeholder: 'Навіщо мені ця звичка, як саме виконувати…', 'aria-label': 'Нотатка', class: 'textarea hb-note-in' });

    const body = h('div', { class: 'form-stack hb-form' },
      fName,
      h('div', { class: 'field' }, h('div', { class: 'field-label' }, 'Тип'), kindSeg,
        h('div', { class: 'field-hint' }, 'Галочка — виконав чи ні («Медитація», «Без солодкого» = втримався). Кількість — з метою на день: день зараховано, коли досягнуто мети.')),
      countBox,
      h('div', { class: 'field' }, h('div', { class: 'field-label' }, 'Розклад'), schedSeg, daysBox, timesSel, schedHint),
      h('div', { class: 'form-grid' },
        ui.field({ label: 'Нагадування о', input: remindIn, hint: 'Необовʼязково. Якщо до цього часу не відмічено — нагадування в дзвіночку (коли CRM відкрита).' }),
        h('div', { class: 'field' }, h('div', { class: 'field-label' }, 'Відлік з'), startIn)),
      ui.field({ label: 'Колір', input: sw }),
      ui.field({ label: 'Нотатка', input: noteIn }));

    function readNum(inp) { const x = Number(String(inp.value).replace(',', '.').replace(/\s/g, '')); return Number.isFinite(x) ? x : NaN; }
    async function submit() {
      let ok = true;
      const name = nameIn.value.trim();
      if (!name) { fName.setError('Вкажи назву'); ok = false; }
      let target = st.target;
      let step = st.step;
      if (st.kind === 'count') {
        target = readNum(targetIn);
        step = readNum(stepIn);
        if (!(target > 0 && target <= MAX_VALUE)) { fTarget.setError('Мета — число більше нуля'); ok = false; }
        if (!(step > 0 && step <= MAX_VALUE)) { fStep.setError('Число більше нуля'); ok = false; }
      }
      if (!ok) { (name ? targetIn : nameIn).focus(); return; }
      if (!canSave()) return;
      const remind = remindIn.parseTime(remindIn.value);
      const rec = Object.assign({}, cur || { id: U.uid(), log: {}, order: Math.max(0, ...all().map((x) => Number(x.order) || 0)) + 1, archived: false, archivedAt: null }, {
        name, kind: st.kind, target: Math.round(target * 10) / 10, unit: unitIn.value.trim(), step: Math.round(step * 10) / 10,
        schedule: { type: st.schedule.type, days: st.schedule.type === 'days' ? st.schedule.days.slice() : [], times: st.schedule.type === 'weekly' ? st.schedule.times : null },
        remind: remind || null, color: st.color, startDate: st.startDate, note: noteIn.value.trim()
      });
      dlg.close('force');
      const saved = await CRM.store.save('habits', rec);
      CRM.notify.runRules();
      ui.toast(isNew ? `Звичку додано: ${saved.name}` : 'Звичку збережено', { type: 'success', action: isNew ? { label: 'Відкрити', onClick: () => openPage(saved.id) } : null });
    }
    async function remove() {
      const ok = await ui.confirm({ title: 'Видалити звичку?', message: `«${cur.name}» разом з історією перейде в Кошик — відновити можна протягом 30 днів. Якщо просто більше не ведеш її — краще «В архів».`, confirmText: 'Видалити', danger: true });
      if (!ok) return;
      dlg.close('force');
      const batch = await CRM.store.softDelete('habits', cur.id);
      if (CRM.router.current && CRM.router.current.name === 'habits' && CRM.router.current.sub === cur.id) CRM.router.go('habits');
      ui.toast(`Звичку «${cur.name}» — у Кошику`, { action: { label: 'Скасувати', onClick: () => CRM.store.restoreBatch(batch) } });
    }
    const footer = isNew
      ? [ui.button({ label: 'Скасувати', onClick: () => dlg.close('button') }), ui.button({ label: 'Додати', variant: 'primary', className: 'hb-save', onClick: submit })]
      : [ui.button({ label: 'Видалити', icon: 'trash', variant: 'danger-ghost', className: 'hb-delete', onClick: remove }),
        ui.button({ label: cur.archived ? 'З архіву' : 'В архів', icon: 'archive', variant: 'ghost', className: 'hb-archive-btn', onClick: () => { dlg.close('force'); setArchived(cur.id, !cur.archived); } }),
        h('span', { class: 'grow' }),
        ui.button({ label: 'Скасувати', onClick: () => dlg.close('button') }), ui.button({ label: 'Зберегти', variant: 'primary', className: 'hb-save', onClick: submit })];
    nameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    const dlg = ui.modal({ title: isNew ? 'Нова звичка' : 'Звичка: ' + cur.name, size: 'md', className: 'hb-form-modal', body, footer });
    setTimeout(() => nameIn.focus(), 0);
    return dlg;
  }

  async function setArchived(id, on) {
    const hb = get(id);
    if (!hb || !canSave()) return;
    const before = { archived: !!hb.archived, archivedAt: hb.archivedAt || null };
    await CRM.store.save('habits', Object.assign({}, hb, { archived: !!on, archivedAt: on ? D.today() : null }));
    CRM.notify.runRules();
    ui.toast(on ? `«${hb.name}» — в архіві. Історія збережена.` : `«${hb.name}» — знову серед звичок`, {
      type: 'success', action: { label: 'Скасувати', onClick: () => { const c = get(id); if (c) CRM.store.save('habits', Object.assign({}, c, before)); } }
    });
  }
  function openPage(id) { CRM.router.go(id ? 'habits/' + id : 'habits'); }

  // ---------- Головна ----------
  function homeCard() {
    const T = D.today();
    const hs = active();
    const head = (extra) => h('div', { class: 'card-head' },
      h('h2', null, 'Звички', extra),
      h('div', { class: 'btn-row' },
        ui.button({ icon: 'plus', iconOnly: true, size: 'sm', variant: 'ghost', title: 'Нова звичка', onClick: () => openForm() }),
        hs.length ? h('a', { href: '#/habits', class: 'btn btn-ghost btn-sm' }, 'Усі звички', CRM.icon('chevronRight', { size: 'sm' })) : null));
    if (!hs.length) {
      return h('section', { class: 'card hb-home' }, head(), ui.empty({
        icon: 'habits', small: true, title: 'Щоденні галочки й серії',
        text: 'Додай звичку — тут щодня зʼявлятимуться галочки на сьогодні й лічильник «днів поспіль».',
        action: { label: 'Додати звичку', icon: 'plus', onClick: () => openForm() }
      }));
    }
    const td = today(T);
    const rows = td.due.map((hb) => {
      const ti = todayInfo(hb, T);
      const n = streak(hb, T);
      const sub = isCount(hb) ? valueText(hb, ti.ds.v === SKIP ? 0 : ti.ds.v) : ti.ds.st === 'skip' ? 'пропуск' : ti.ds.st === 'done' ? 'виконано' : '';
      return h('div', { class: 'hb-hrow' + (ti.ds.st === 'done' ? ' done' : ''), dataset: { id: hb.id }, style: { '--hb': colorOf(hb) } },
        h('a', { class: 'hb-row-main', href: CRM.router.href('habits/' + hb.id) }, dot(hb),
          h('span', { class: 'hb-row-text' }, h('span', { class: 'hb-row-name' }, hb.name),
            h('span', { class: 'hb-row-sub' }, [sub, ti.week ? ti.note : null].filter(Boolean).join(' · ') || scheduleText(hb)))),
        n ? h('span', { class: 'hb-streak on', title: `Поточна серія: ${streakText(hb, n)}` }, CRM.icon('flame', { size: 'sm' }), h('b', { class: 'num' }, String(n))) : null,
        control(hb));
    });
    return h('section', { class: 'card hb-home' },
      head(td.total ? h('span', { class: 'tab-count' + (td.done === td.total ? ' hb-all' : '') }, `${td.done}/${td.total}`) : null),
      rows.length ? h('div', { class: 'hb-hlist' }, rows) : h('div', { class: 'card-body subtle hb-home-none' }, 'Сьогодні звичок за розкладом немає.'),
      td.total && td.done === td.total ? h('div', { class: 'hb-home-all' }, CRM.icon('checkCircle', { size: 'sm' }), 'Усе на сьогодні виконано!') : null);
  }

  // ---------- Швидке введення (⚡): «вода +2», «медитація», «читання 30», «спортзал пропуск», «вода 3 вчора» ----------
  const FILLER = new Set(['+', 'так', 'зроблено', 'виконано', 'виконав', 'виконала', 'готово', 'є', '✓', '✔', '✅', 'done', 'ok', 'ок']);
  const SKIP_WORDS = new Set(['пропуск', 'пропускаю', 'пропустив', 'пропустила', 'skip']);
  const UNIT_RE = /^(склян|стор|с\.$|хв|хвилин|год|раз|км|м$|кроків|крок|шт|мл|л$|г$|гр|грам|літр|порці)/;
  const NUM_RE = /^([+\-−])?(\d+(?:[.,]\d+)?)$/;
  function habitWords(name) {
    return U.normalize(name).split(/\s+/).map((w) => w.replace(/[^a-zа-яіїєґ'ʼ0-9-]/g, '')).filter((w) => /[a-zа-яіїєґ]/.test(w));
  }
  function wordMatch(t, w) {
    if (t === w) return true;
    if (t.length < 3) return false;
    const st = w.length <= 4 ? w : w.slice(0, Math.max(3, w.length - 2));
    return w.startsWith(t) || t.startsWith(st);
  }
  /** Варіант «Звичка» для швидкого введення або null. helpers: { dateFor }. */
  function quickOption(P, helpers) {
    if (!CRM.db.SCHEMA.habits) return null;
    const hs = active();
    if (!hs.length || !P || !P.tokens) return null;
    const names = [];
    let amount = null;
    let sign = null;
    let skip = false;
    let bad = false;
    P.tokens.forEach((t, i) => {
      if (t.tag === 'date' || t.tag === 'time' || t.tag === 'dur') return;
      const n = t.n;
      if (/^[+\-−]$/.test(n) && P.tokens[i + 1] && NUM_RE.test(P.tokens[i + 1].n)) { sign = n === '+' ? '+' : '-'; return; }
      const m = NUM_RE.exec(n);
      if (m) { if (amount == null) { amount = Number(m[2].replace(',', '.')); if (m[1]) sign = m[1] === '+' ? '+' : '-'; } else bad = true; return; }
      if (FILLER.has(n)) return;
      if (SKIP_WORDS.has(n)) { skip = true; return; }
      if (names.length && UNIT_RE.test(n)) return;
      if (amount != null && UNIT_RE.test(n)) return;
      names.push(n);
    });
    if (bad || !names.length) return null;
    let best = null;
    // Назва звички або її частина підряд: «вода», «медитація» для «Ранкова медитація», «без солод»
    hs.forEach((hb) => {
      const hw = habitWords(hb.name);
      for (let k = 0; k + names.length <= hw.length; k++) {
        if (!names.every((t, j) => wordMatch(t, hw[k + j]))) continue;
        const score = names.length / hw.length + (k === 0 ? 0.5 : 0) + (names.every((t, j) => t === hw[k + j]) ? 1 : 0);
        if (!best || score > best.score) best = { hb, score };
      }
    });
    if (!best) return null;
    const hb = best.hb;
    const T = D.today();
    const date = (helpers && helpers.dateFor ? helpers.dateFor(P, 'meal') : null) || T;
    const ds = dayState(hb, date, T);
    let op;
    let value;
    let what;
    let problem = null;
    if (date > T) problem = 'Майбутні дні відмітити не можна.';
    if (skip) { op = 'skip'; value = SKIP; what = 'Пропуск — серія не обірветься'; }
    else if (isCount(hb)) {
      const delta = (amount == null ? stepOf(hb) : amount) * (sign === '-' ? -1 : 1);
      const base = ds.v === SKIP ? 0 : ds.v;
      value = Math.max(0, Math.round((base + delta) * 10) / 10);
      op = 'add';
      what = `${delta >= 0 ? '+' : '−'}${num(Math.abs(delta))} → ${valueText(hb, value)}`;
      if (value > MAX_VALUE) problem = 'Завелике число.';
    } else {
      op = 'done';
      value = 1;
      what = ds.st === 'done' ? 'Уже відмічено' : 'Виконано';
    }
    return {
      kind: 'habit', label: 'Звичка', icon: 'habits', iconClass: 'ico-goal', title: hb.name,
      parts: [what, relDay(date), hb.archived ? 'в архіві' : null], rec: { habitId: hb.id, date, op, value }, habit: hb,
      ok: !problem, problem, strongMatch: true
    };
  }
  /** Застосувати варіант «Звичка» (тост «Змінити · Скасувати»). */
  async function quickApply(o) {
    if (!o || !o.rec) return null;
    const r = o.rec;
    const hb = get(r.habitId);
    if (!hb) return null;
    const res = await setDay(r.habitId, r.date, r.value);
    if (!res) return null;
    const ds = dayState(res.saved, r.date);
    const when = relDay(r.date);
    const text = r.op === 'skip' ? `${hb.name} — пропуск, ${when}` : isCount(hb) ? `${hb.name}: ${valueText(hb, ds.v === SKIP ? 0 : ds.v)} · ${when}` : `${hb.name} — виконано, ${when}`;
    const n = streak(res.saved);
    ui.toast(text + (n ? ` · ${streakText(res.saved, n)}` : ''), {
      type: 'success', duration: 9000,
      actions: [
        { label: 'Змінити', onClick: () => openPage(hb.id) },
        { label: 'Скасувати', onClick: async () => { await restoreDay(hb.id, r.date, res.before, res.startBefore); ui.toast('Скасовано — відмітку прибрано'); } }
      ]
    });
    return res.saved;
  }

  // ---------- Реєстрація ----------
  CRM.router.register('habits', { title: 'Звички', stores: ['habits'], render });

  // Нагадування: якщо до обраного часу звичку не відмічено (для «N разів на тиждень» — коли інакше вже не встигнеш до неділі)
  CRM.notify.addRule(() => {
    const out = [];
    const T = D.today();
    const now = D.nowTime();
    active().forEach((hb) => {
      if (!hb.remind || now < hb.remind) return;
      const ti = todayInfo(hb, T);
      if (!ti.due || ti.ds.st === 'done' || ti.ds.st === 'skip') return;
      let text = isCount(hb) ? `Сьогодні ${valueText(hb, ti.ds.v)}` : 'Сьогодні ще не відмічено';
      if (ti.week) {
        const left = 7 - D.weekday(T);
        const need = ti.week.need - ti.week.done;
        if (need < left) return;
        text = `Цього тижня ${ti.week.done} з ${ti.week.need} — щоб виконати план, потрібно сьогодні`;
      }
      const n = streak(hb, T);
      out.push({ key: `habit:${hb.id}:${T}`, kind: 'habit', title: `Не забудь: ${hb.name}`, text: text + (n ? ` · серія ${streakUnit(hb, n)}` : ''), target: { store: 'habits', id: hb.id } });
    });
    return out;
  });

  CRM.habits = {
    SKIP, SCHEDS, KINDS, TEMPLATES, all, active, get, sched, dayState, weekInfo, streak, bestStreak, streakText, streakUnit, stats, today, todayInfo,
    scheduleText, goalText, valueText, setDay, restoreDay, tap, openDay, openForm, openPage, setArchived, homeCard, quickOption, quickApply, dayScore, isPlanned, startOf
  };
})(window.CRM);
