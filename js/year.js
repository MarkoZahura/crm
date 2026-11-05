/* ==========================================================================
   year.js — «Мій рік» (05.11.2026, пункт 8, етап 1): підсумок року з даних CRM.
   Картки за групами (Здоровʼя · Гроші · Справи й навчання · Книги й люди), рекорди року,
   цілі на наступний рік і «вдалося?» для цілей цього року, порівняння з минулим роком
   (лише коли за нього є дані; для неповного року — з тим самим часом минулого).
   Перегляд: історії на весь екран (телефон — дотики й свайпи, ПК — вікно у формі телефона,
   ← → / пробіл, Esc) + сторінка «Усе разом» (#/year, #/year?y=2025, ?story=1 — одразу історії).
   Картка «Мій рік» на Головній — з 1 грудня до 31 січня (× — сховати до наступного року).
   Етап 2 (05.11): картинки «Поділитися» — js/year-share.js (CRM.yearShare); тут — дані карток для картинки
   (bars, records, goals, money) і cardsFor(y, { hideMoney }) — гроші лише відсотками.
   Налаштування myYear { goals: { 'РРРР': [{ id, text, done: true|false|null }] }, hidden: ['РРРР'] }
   синхронізується; дані — лише в браузері й синхронізації, не в коді.
   ========================================================================== */
window.CRM = window.CRM || {};

(function (CRM) {
  'use strict';

  const { h, ui } = { h: CRM.ui.h, ui: CRM.ui };
  const D = CRM.date;
  const fmt = CRM.fmt;
  const U = CRM.utils;
  const S = () => CRM.store;

  const KEY = 'myYear';
  const MAX_GOALS = 5;
  const GROUPS = {
    cover: 'Мій рік', health: 'Здоровʼя', money: 'Гроші', work: 'Справи й навчання',
    books: 'Книги й люди', records: 'Рекорди', goals: 'Цілі'
  };
  const reduceMq = window.matchMedia ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
  const narrowMq = window.matchMedia ? window.matchMedia('(max-width: 860px)') : null;

  // ---------- Налаштування (цілі, закрита картка на Головній) ----------
  function cfg() {
    const v = S().getSetting(KEY, null);
    return v && typeof v === 'object' ? v : {};
  }
  async function setCfg(changes) {
    await S().setSetting(KEY, Object.assign({}, cfg(), changes));
  }
  function goalsOf(y) {
    const g = (cfg().goals || {})[String(y)];
    return Array.isArray(g) ? g.filter((x) => x && typeof x.text === 'string' && x.text.trim()) : [];
  }
  async function saveGoals(y, list) {
    const goals = Object.assign({}, cfg().goals || {});
    const clean = (list || []).map((g) => ({ id: g.id || U.uid(), text: String(g.text || '').trim().slice(0, 200), done: g.done === true ? true : g.done === false ? false : null }))
      .filter((g) => g.text).slice(0, MAX_GOALS);
    if (clean.length) goals[String(y)] = clean; else delete goals[String(y)];
    await setCfg({ goals });
  }
  async function setGoalDone(y, id, done) {
    const list = goalsOf(y).map((g) => (g.id === id ? Object.assign({}, g, { done }) : g));
    await saveGoals(y, list);
  }
  const hiddenYears = () => (Array.isArray(cfg().hidden) ? cfg().hidden.map(String) : []);

  // ---------- Період ----------
  const thisYear = () => Number(D.today().slice(0, 4));
  /** Межі року: від 1 січня до сьогодні (поточний рік) або до 31 грудня. */
  function bounds(y) {
    const T = D.today();
    const from = `${y}-01-01`;
    const end = `${y}-12-31`;
    const to = end < T ? end : T;
    return { y, from, end, to, partial: to < end };
  }
  /** Той самий час минулого року (для неповного поточного) або весь минулий рік. */
  function prevBounds(b) {
    const y = b.y - 1;
    const from = `${y}-01-01`;
    const end = `${y}-12-31`;
    if (!b.partial) return { y, from, end, to: end, partial: false };
    let md = b.to.slice(5);
    if (md === '02-29') md = '02-28';
    return { y, from, end, to: `${y}-${md}`, partial: true };
  }
  /** Який рік відкривати: у січні — минулий (повний), з лютого — поточний. */
  function defaultYear() {
    const T = D.today();
    const y = Number(T.slice(0, 4));
    if (T.slice(5, 7) === '01' && hasData(y - 1)) return y - 1;
    return y;
  }
  /** Рік для картки на Головній: грудень — поточний, січень — минулий; інакше — немає. */
  function homeYear() {
    const T = D.today();
    const y = Number(T.slice(0, 4));
    const m = T.slice(5, 7);
    if (m === '12') return y;
    if (m === '01') return y - 1;
    return null;
  }

  // ---------- Розрахунки ----------
  const cache = new Map();
  let cacheDay = null;
  function cached(key, fn) {
    const T = D.today();
    if (cacheDay !== T) { cache.clear(); cacheDay = T; }
    if (!cache.has(key)) cache.set(key, fn());
    return cache.get(key);
  }
  S().on(null, () => cache.clear());

  const sum = (arr, f) => arr.reduce((s, x) => s + (Number(f(x)) || 0), 0);
  const kyiv = (iso) => (iso ? D.toKyivDate(iso) : null);
  function topOf(map) {
    let best = null;
    map.forEach((n, k) => { if (!best || n > best.n) best = { key: k, n }; });
    return best;
  }
  const monthOf = (d) => Number(d.slice(5, 7));
  function nowMin() { const t = D.nowTime(); return Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5)); }

  function habitWords(hb) {
    const t = CRM.habits.sched(hb).type;
    if (t === 'weekly') return ['тиждень', 'тижні', 'тижнів'];
    if (t === 'days') return ['раз', 'рази', 'разів'];
    return ['день', 'дні', 'днів'];
  }

  /** Усі цифри за період b. */
  function compute(b) {
    const inR = (d) => typeof d === 'string' && d >= b.from && d <= b.to;
    let first = null;
    const mark = (d) => { if (inR(d) && (!first || d < first)) first = d; };
    const T = D.today();
    const out = { b };

    // Тренування
    const ws = S().list('workouts').filter((w) => inR(w.date));
    ws.forEach((w) => mark(w.date));
    if (ws.length) {
      const types = new Map();
      const months = new Map();
      ws.forEach((w) => {
        types.set(w.type || 'other', (types.get(w.type || 'other') || 0) + 1);
        months.set(monthOf(w.date), (months.get(monthOf(w.date)) || 0) + 1);
      });
      const runs = ws.filter((w) => Number(w.distanceKm) > 0);
      const run = runs.slice().sort((x, y) => Number(y.distanceKm) - Number(x.distanceKm) || x.date.localeCompare(y.date))[0] || null;
      const tt = topOf(types);
      const tm = topOf(months);
      out.training = {
        n: ws.length,
        min: Math.round(sum(ws, (w) => w.durationMin)),
        km: U.round2(sum(runs, (w) => w.distanceKm)),
        runs: runs.length,
        type: tt ? { id: tt.key, label: CRM.dict.label ? CRM.dict.label('workoutTypes', tt.key) : tt.key, n: tt.n } : null,
        month: tm && ws.length > 1 ? { m: tm.key, n: tm.n } : null,
        run: run ? { km: Number(run.distanceKm), date: run.date } : null
      };
    }

    // Звички
    if (CRM.habits) {
      let done = 0;
      let total = 0;
      let marks = 0;
      let best = null;
      CRM.habits.all().forEach((hb) => {
        Object.keys(hb.log || {}).forEach((d) => {
          const v = hb.log[d];
          if (inR(d) && typeof v === 'number' && v > 0) { marks += 1; mark(d); }
        });
        const start = CRM.habits.startOf(hb);
        const lo = start > b.from ? start : b.from;
        let hi = b.to;
        if (hb.archived && hb.archivedAt) { const a = kyiv(hb.archivedAt); if (a && a < hi) hi = a; }
        if (!D.isDate(lo) || lo > hi) return;
        let run = 0;
        let bestRun = 0;
        if (CRM.habits.sched(hb).type === 'weekly') {
          for (let w0 = D.startOfWeek(lo); w0 <= hi; w0 = D.addDays(w0, 7)) {
            const w = CRM.habits.weekInfo(hb, w0, T);
            if (w.complete) { done += 1; total += 1; run += 1; bestRun = Math.max(bestRun, run); } else if (!w.excused && !w.current) { total += 1; run = 0; }
          }
        } else {
          for (let d = lo; d <= hi; d = D.addDays(d, 1)) {
            if (!CRM.habits.isPlanned(hb, d)) continue;
            const st = CRM.habits.dayState(hb, d, T).st;
            if (st === 'done') { done += 1; total += 1; run += 1; bestRun = Math.max(bestRun, run); } else if (st === 'skip' || st === 'todo' || st === 'future') { /* не обриває серію */ } else { total += 1; run = 0; }
          }
        }
        if (bestRun > 0 && (!best || bestRun > best.n)) best = { n: bestRun, name: hb.name || 'Звичка', words: habitWords(hb) };
      });
      if (marks > 0 || done > 0) out.habits = { best, pct: total ? Math.round(done / total * 100) : null, marks, done, total };
    }

    // Харчування
    if (CRM.nutrition) {
      const meals = S().list('meals').filter((e) => inR(e.date));
      if (meals.length) {
        const byDay = new Map();
        const names = new Map();
        meals.forEach((e) => {
          mark(e.date);
          byDay.set(e.date, (byDay.get(e.date) || 0) + (Number(CRM.nutrition.entryTotals(e).kcal) || 0));
          const nm = String(e.name || '').trim();
          if (nm) names.set(nm, (names.get(nm) || 0) + 1);
        });
        const days = byDay.size;
        const tg = CRM.nutrition.target();
        const top = topOf(names);
        out.food = {
          days,
          avg: Math.round(sum(Array.from(byDay.values()), (x) => x) / days),
          target: tg ? Math.round(Number(tg.kcal)) : null,
          top: top && top.n > 1 ? { name: top.key, n: top.n } : null
        };
      }
    }

    // Гроші
    if (CRM.finance) {
      const F = CRM.finance;
      const txs = F.txInRange(b.from, b.to);
      txs.forEach((t) => mark(t.date));
      try { F.ensureRatesFor(txs); } catch (e) { /* курс підтягнеться пізніше */ }
      const t = F.totals(txs);
      if (t.income || t.expense) {
        let tutor = 0;
        const months = new Map();
        let biggest = null;
        txs.forEach((x) => {
          const uah = F.txUAH(x);
          if (uah == null) return;
          if (x.type === 'income' && x.tutor && x.tutor.studentId) tutor += uah;
          if (x.type === 'expense') {
            months.set(monthOf(x.date), (months.get(monthOf(x.date)) || 0) + uah);
            if (!biggest || uah > biggest.amount) biggest = { amount: U.round2(uah), date: x.date, title: (x.comment || '').trim() || F.txTitle(x), id: x.id };
          }
        });
        const cats = t.expense ? F.byCategory(txs, 'expense').slice(0, 3).map((c) => ({
          id: c.categoryId, name: c.category ? c.category.name : 'Без категорії', amount: Math.round(c.amount),
          pct: Math.round(c.amount / t.expense * 100), color: c.categoryId ? F.categoryColor(c.categoryId) : null
        })) : [];
        let limits = null;
        if (CRM.limits && CRM.limits.hasAny()) {
          let ok = 0;
          let total = 0;
          for (let m = 1; m <= monthOf(b.to); m++) {
            const ms = `${b.y}-${D.pad(m)}-01`;
            const sp = CRM.limits.spentIn(ms);
            if (!sp.total) continue;
            const items = CRM.limits.items(ms, sp);
            if (!items.length) continue;
            total += 1;
            if (items.every((i) => i.level !== 'over')) ok += 1;
          }
          if (total) limits = { ok, total };
        }
        const tm = topOf(months);
        out.money = {
          spent: Math.round(t.expense), income: Math.round(t.income), result: Math.round(t.result), tutor: Math.round(tutor),
          missing: t.missing, cats, biggest, limits, month: tm && months.size > 1 ? { m: tm.key, amount: Math.round(tm.n) } : null
        };
      }
    }

    // Задачі й події
    const doneTasks = S().list('tasks').filter((x) => x.done && x.completedAt && inR(kyiv(x.completedAt)));
    S().list('tasks').forEach((x) => mark(kyiv(x.createdAt)));
    if (doneTasks.length) {
      const months = new Map();
      const days = new Map();
      const wds = new Map();
      doneTasks.forEach((x) => {
        const d = kyiv(x.completedAt);
        mark(d);
        months.set(monthOf(d), (months.get(monthOf(d)) || 0) + 1);
        days.set(d, (days.get(d) || 0) + 1);
        wds.set(D.weekday(d), (wds.get(D.weekday(d)) || 0) + 1);
      });
      const tm = topOf(months);
      const td = topOf(days);
      const tw = topOf(wds);
      out.tasks = {
        done: doneTasks.length,
        month: tm && months.size > 1 ? { m: tm.key, n: tm.n } : null,
        day: td && td.n > 1 ? { date: td.key, n: td.n } : null,
        weekday: tw && doneTasks.length >= 5 ? tw.key : null
      };
    }
    if (CRM.calendar && CRM.calendar.occurrences) {
      const evs = CRM.calendar.occurrences(b.from, b.to).filter((o) => !o.ev.studentId && (!o.span || o.span.day === 1));
      if (evs.length) out.events = evs.length;
    }

    // Навчання
    {
      let topics = 0;
      let courses = 0;
      const active = [];
      S().list('courses').forEach((c) => {
        (c.topics || []).forEach((t) => {
          if (!t.done) return;
          const d = t.doneAt || null;
          if (inR(d) || (!d && inR(t.deadline))) { topics += 1; if (d) mark(d); }
        });
        const st = c.status || 'active';
        if (st === 'done' && (inR(c.doneAt) || (!c.doneAt && inR(kyiv(c.updatedAt))))) courses += 1;
        if (st === 'active' && (c.topics || []).some((t) => t.done)) active.push(c.title || 'Курс');
      });
      if (topics || courses) out.learning = { topics, courses, active: active.slice(0, 2) };
    }

    // Репетиторство
    if (CRM.tutor && CRM.tutor.lessonsBetween) {
      const nm = nowMin();
      const L = CRM.tutor.lessonsBetween(b.from, b.to).filter((x) => x.date < T || (x.date === T && (x.startMin == null || nm >= x.startMin)));
      if (L.length) {
        const by = new Map();
        L.forEach((x) => by.set(x.sid, (by.get(x.sid) || 0) + 1));
        const top = topOf(by);
        const st = top ? CRM.tutor.get(top.key) : null;
        out.tutor = { lessons: L.length, min: Math.round(sum(L, (x) => x.dur)), students: by.size, top: st && by.size > 1 ? { name: st.name, n: top.n } : null };
      }
    }

    // Книги
    if (CRM.books) {
      const books = CRM.books.all();
      const read = books.filter((x) => CRM.books.shelfOf(x) === 'done' && inR(x.endDate));
      const pagesDay = new Map();
      books.forEach((x) => (Array.isArray(x.log) ? x.log : []).forEach((e) => {
        if (!e || !inR(e.date) || !(Number(e.pages) > 0)) return;
        mark(e.date);
        pagesDay.set(e.date, (pagesDay.get(e.date) || 0) + Number(e.pages));
      }));
      read.forEach((x) => mark(x.endDate));
      const pages = CRM.books.pagesBetween(b.from, b.to, books);
      if (read.length || pages) {
        const best = read.filter((x) => Number(x.rating) > 0).sort((x, y) => Number(y.rating) - Number(x.rating) || String(y.endDate).localeCompare(String(x.endDate)))[0] || null;
        const pd = topOf(pagesDay);
        out.books = {
          read: read.length, pages,
          titles: read.slice().sort((x, y) => String(x.endDate).localeCompare(String(y.endDate))).map((x) => x.title || 'Без назви'),
          best: best ? { title: best.title || 'Без назви', rating: Number(best.rating) } : null,
          day: pd && pd.n > 0 ? { date: pd.key, n: Math.round(pd.n) } : null
        };
      }
      // Цитата року: з прочитаних цього року (вища оцінка), інакше — додана цього року
      const readIds = new Set(read.map((x) => x.id));
      const qs = CRM.books.allQuotes().filter(({ q, book }) => readIds.has(book.id) || inR(kyiv(q.at)));
      if (qs.length) {
        qs.sort((x, y) => (readIds.has(y.book.id) ? 1 : 0) - (readIds.has(x.book.id) ? 1 : 0) ||
          (Number(y.book.rating) || 0) - (Number(x.book.rating) || 0) || String(y.q.at || '').localeCompare(String(x.q.at || '')));
        const { q, book } = qs[0];
        out.quote = { text: q.text, source: CRM.books.quoteSource ? CRM.books.quoteSource(book, q) : (book.title || ''), bookId: book.id };
      }
    }

    // Люди
    if (CRM.people) {
      const people = S().list('people');
      const greeted = people.filter((p) => p.greeted && inR(p.greeted[String(b.y)])).length;
      people.forEach((p) => { if (p.greeted) mark(p.greeted[String(b.y)]); });
      const bdays = CRM.people.datesBetween(b.from, b.to).filter((e) => e.kind === 'birthday').length;
      if (greeted || bdays) out.people = { greeted, birthdays: bdays, total: people.length };
    }

    out.first = first;
    // Дні народження є в будь-якому році — «дані року» лише якщо когось привітав
    out.any = !!(out.training || out.habits || out.food || out.money || out.tasks || out.events || out.learning || out.tutor || out.books || (out.people && out.people.greeted));
    return out;
  }
  function stats(y) { const b = bounds(y); return cached('y' + b.from + b.to, () => compute(b)); }
  function prevStats(y) { const b = prevBounds(bounds(y)); return cached('p' + b.from + b.to, () => compute(b)); }
  function hasData(y) { return y > 1999 && y <= thisYear() && stats(y).any; }

  /** Роки, за які є дані (і поточний). */
  function years() {
    const cy = thisYear();
    let min = cy;
    const see = (d) => { if (typeof d === 'string' && /^\d{4}-/.test(d)) { const y = Number(d.slice(0, 4)); if (y >= 2000 && y < min) min = y; } };
    S().list('workouts').forEach((w) => see(w.date));
    S().list('transactions').forEach((t) => see(t.date));
    S().list('meals').forEach((e) => see(e.date));
    S().list('tasks').forEach((t) => see(kyiv(t.completedAt)));
    if (CRM.books) CRM.books.all().forEach((x) => { see(x.endDate); (x.log || []).forEach((e) => see(e && e.date)); });
    if (CRM.habits) CRM.habits.all().forEach((hb) => Object.keys(hb.log || {}).forEach(see));
    const out = [];
    for (let y = min; y <= cy; y++) out.push(y);
    return out;
  }

  // ---------- Форматування ----------
  const int = (n) => fmt.number(n, 0);
  const money = (n) => fmt.money(n, 'UAH', { decimals: 0 });
  const monthName = (m) => (CRM.MONTHS_NOM[m - 1] || '').toLowerCase();
  const monthIn = (m) => {
    const loc = ['січні', 'лютому', 'березні', 'квітні', 'травні', 'червні', 'липні', 'серпні', 'вересні', 'жовтні', 'листопаді', 'грудні'];
    return loc[m - 1] || '';
  };
  function durText(min) {
    const m = Math.round(Number(min) || 0);
    if (m < 60) return `${m} хв`;
    const hh = Math.floor(m / 60);
    const mm = m % 60;
    return `${int(hh)} год` + (mm ? ` ${mm} хв` : '');
  }
  const km = (v) => fmt.number(v, 1).replace(/,0$/, '') + ' км';
  const WD_NOM = ['понеділок', 'вівторок', 'середа', 'четвер', 'пʼятниця', 'субота', 'неділя'];

  /** Порівняння з минулим роком: «+12 до 2025» (лише якщо там є дані). */
  function cmp(cur, prev, y, b, opts) {
    const o = opts || {};
    if (prev == null || cur == null) return null;
    const delta = cur - prev;
    const title = b.partial
      ? `Порівняння з тим самим часом ${y - 1} року (1 січня — ${fmt.dateShort(prevBounds(b).to).replace(/ \d{4}$/, '')}): ${o.money ? money(prev) : int(prev)}`
      : `У ${y - 1}: ${o.money ? money(prev) : int(prev)}`;
    if (o.money) {
      if (!prev) return null;
      const pct = Math.round(delta / prev * 100);
      if (!pct) return { text: `як у ${y - 1}`, dir: 'same', title };
      return { text: `${pct > 0 ? '+' : '−'}${Math.abs(pct)} % до ${y - 1}`, dir: pct > 0 ? 'up' : 'down', title };
    }
    if (!delta) return { text: `як у ${y - 1}`, dir: 'same', title };
    return { text: `${delta > 0 ? '+' : '−'}${int(Math.abs(delta))} до ${y - 1}`, dir: delta > 0 ? 'up' : 'down', title };
  }

  // ---------- Картки ----------
  /**
   * Картка: { id, group, icon, kicker, value, num ('int'|'money'), big (текст замість числа), unit, cmp,
   *           lines: [текст], extra: (mode) => вузол, actions: (mode, y) => вузол,
   *           для картинки: bars [{ name, pct, text }], records [{ icon, label, value, sub }], goals { list, ask },
   *           money (є суми — вимикач «Сховати суми»), shareable (false — нічим ділитися) }
   * opts.hideMoney — суми замінено відсотками (лише для картинок).
   */
  function cardsFor(y, opts) {
    const hide = !!(opts && opts.hideMoney);
    const b = bounds(y);
    const st = stats(y);
    const pv = y > 2000 ? prevStats(y) : null;
    const P = (k) => (pv && pv[k] ? pv[k] : null);
    const out = [];

    if (st.training) {
      const t = st.training;
      const lines = [`${durText(t.min)} разом`];
      if (t.km > 0) lines.push(`${km(t.km)} — біг і кардіо`);
      if (t.type && st.training.n > 1) lines.push(`Найчастіше — «${t.type.label}» (${int(t.type.n)})`);
      if (t.month) lines.push(`Найактивніший місяць — ${monthName(t.month.m)} (${int(t.month.n)})`);
      out.push({ id: 'training', group: 'health', icon: 'dumbbell', kicker: 'Тренування', value: t.n, num: 'int',
        unit: fmt.plural(t.n, ['тренування', 'тренування', 'тренувань']), cmp: cmp(t.n, P('training') && P('training').n, y, b), lines });
    }
    if (st.habits && (st.habits.best || st.habits.pct != null)) {
      const hb = st.habits;
      const lines = [];
      if (hb.best) lines.push(`«${hb.best.name}» — найдовша серія року`);
      if (hb.pct != null) lines.push(`Виконано ${hb.pct} % запланованого`);
      if (hb.marks) lines.push(`${int(hb.marks)} ${fmt.plural(hb.marks, ['відмітка', 'відмітки', 'відміток'])} за рік`);
      out.push(hb.best
        ? { id: 'habits', group: 'health', icon: 'flame', kicker: 'Звички', value: hb.best.n, num: 'int', unit: fmt.plural(hb.best.n, hb.best.words) + ' поспіль', lines }
        : { id: 'habits', group: 'health', icon: 'flame', kicker: 'Звички', value: hb.pct, num: 'pct', unit: 'запланованого виконано', lines: lines.filter((l) => !/^Виконано/.test(l)) });
    }
    if (st.food) {
      const f = st.food;
      const lines = [`У середньому ${int(f.avg)} ккал на день` + (f.target ? ` (норма ${int(f.target)})` : '')];
      if (f.top) lines.push(`Найчастіше — ${f.top.name} (${int(f.top.n)} ${fmt.plural(f.top.n, ['раз', 'рази', 'разів'])})`);
      out.push({ id: 'food', group: 'health', icon: 'apple', kicker: 'Харчування', value: f.days, num: 'int',
        unit: fmt.plural(f.days, ['день', 'дні', 'днів']) + ' у щоденнику', cmp: cmp(f.days, P('food') && P('food').days, y, b), lines });
    }
    if (st.money) {
      const m = st.money;
      const mcmp = cmp(m.spent, P('money') && P('money').spent, y, b, { money: true });
      const missing = m.missing ? `${m.missing} ${fmt.plural(m.missing, ['операція', 'операції', 'операцій'])} ще без курсу НБУ — не враховано` : null;
      if (!hide) {
        const lines = [`Отримано — ${money(m.income)}`];
        if (m.income || m.spent) lines.push(m.result >= 0 ? `Лишилось — ${money(m.result)}` : `Витрачено більше, ніж отримано, на ${money(-m.result)}`);
        if (m.tutor) lines.push(`З уроків — ${money(m.tutor)}`);
        if (missing) lines.push(missing);
        out.push({ id: 'money', group: 'money', icon: 'wallet', kicker: 'Гроші', value: m.spent, num: 'money', unit: 'витрачено', cmp: mcmp, lines, money: true });
      } else {
        // Без сум: яку частку отриманого витрачено, частка уроків у доходах
        const pct = m.income > 0 ? Math.round(m.spent / m.income * 100) : null;
        const lines = [];
        if (pct != null) lines.push(m.result >= 0 ? `Лишилось — ${Math.max(0, 100 - pct)} % отриманого` : 'Витрачено більше, ніж отримано');
        if (m.tutor && m.income > 0) lines.push(`З уроків — ${Math.round(m.tutor / m.income * 100)} % усіх доходів`);
        if (missing) lines.push(missing);
        out.push(pct != null
          ? { id: 'money', group: 'money', icon: 'wallet', kicker: 'Гроші', value: pct, num: 'pct', unit: 'отриманого витрачено', cmp: mcmp, lines, money: true }
          : { id: 'money', group: 'money', icon: 'wallet', kicker: 'Гроші', big: 'Витрати за рік', cmp: mcmp, lines, money: true });
      }
      if (m.cats.length) {
        const c0 = m.cats[0];
        const lines2 = [];
        if (m.biggest) lines2.push(hide ? `Найбільша покупка — ${m.biggest.title} (${fmt.dateShort(m.biggest.date)})` : `Найбільша покупка — ${m.biggest.title}, ${money(m.biggest.amount)} (${fmt.dateShort(m.biggest.date)})`);
        if (m.limits) lines2.push(`Уклався в ліміти ${m.limits.ok} з ${m.limits.total} ${fmt.plural(m.limits.total, ['місяця', 'місяців', 'місяців'])}`);
        out.push({ id: 'spend', group: 'money', icon: 'receipt', kicker: 'На що пішло', value: c0.pct, num: 'pct',
          unit: `— на «${c0.name}»`, lines: lines2, money: true,
          bars: m.cats.length > 1 ? m.cats.map((c) => ({ name: c.name, pct: c.pct, text: hide ? `${c.pct} %` : `${c.pct} % · ${money(c.amount)}` })) : null,
          extra: m.cats.length > 1 ? () => h('ol', { class: 'yr-bars-list' }, m.cats.map((c) => h('li', null,
            h('span', { class: 'yr-cat-name' }, c.name),
            h('span', { class: 'yr-cat-val' }, `${c.pct} % · ${money(c.amount)}`),
            h('span', { class: 'yr-cat-bar', 'aria-hidden': 'true' }, h('i', { style: { '--w': Math.max(4, c.pct) + '%' } }))))) : null });
      }
    }
    if (st.tasks || st.events) {
      const t = st.tasks;
      const lines = [];
      if (t && t.month) lines.push(`Найбільше — у ${monthIn(t.month.m)} (${int(t.month.n)})`);
      if (t && t.weekday != null) lines.push(`Найпродуктивніший день — ${WD_NOM[t.weekday]}`);
      if (st.events) lines.push(`${int(st.events)} ${fmt.plural(st.events, ['подія', 'події', 'подій'])} у Календарі`);
      out.push(t
        ? { id: 'tasks', group: 'work', icon: 'tasks', kicker: 'Задачі', value: t.done, num: 'int', unit: fmt.plural(t.done, ['задачу виконано', 'задачі виконано', 'задач виконано']),
          cmp: cmp(t.done, P('tasks') && P('tasks').done, y, b), lines }
        : { id: 'tasks', group: 'work', icon: 'calendar', kicker: 'Календар', value: st.events, num: 'int', unit: fmt.plural(st.events, ['подія', 'події', 'подій']), lines: [] });
    }
    if (st.learning) {
      const l = st.learning;
      const lines = [];
      if (l.courses) lines.push(`Завершено ${fmt.count(l.courses, ['курс', 'курси', 'курсів'])}`);
      if (l.active.length) lines.push(`Зараз вчиш — ${l.active.map((x) => `«${x}»`).join(', ')}`);
      out.push(l.topics
        ? { id: 'learning', group: 'work', icon: 'graduation', kicker: 'Навчання', value: l.topics, num: 'int', unit: fmt.plural(l.topics, ['тему вивчено', 'теми вивчено', 'тем вивчено']),
          cmp: cmp(l.topics, P('learning') && P('learning').topics, y, b), lines }
        : { id: 'learning', group: 'work', icon: 'graduation', kicker: 'Навчання', value: l.courses, num: 'int', unit: fmt.plural(l.courses, ['курс завершено', 'курси завершено', 'курсів завершено']), lines: lines.filter((x) => !/^Завершено/.test(x)) });
    }
    if (st.tutor) {
      const t = st.tutor;
      const lines = [`${durText(t.min)} разом`, `${int(t.students)} ${fmt.plural(t.students, ['учень', 'учні', 'учнів'])}`];
      if (t.top) lines.push(`Найбільше уроків — ${t.top.name} (${int(t.top.n)})`);
      out.push({ id: 'tutor', group: 'work', icon: 'board', kicker: 'Репетиторство', value: t.lessons, num: 'int', unit: fmt.plural(t.lessons, ['урок', 'уроки', 'уроків']),
        cmp: cmp(t.lessons, P('tutor') && P('tutor').lessons, y, b), lines });
    }
    if (st.books) {
      const bk = st.books;
      const lines = [];
      if (bk.read && bk.pages) lines.push(`${int(bk.pages)} ${fmt.plural(bk.pages, ['сторінка', 'сторінки', 'сторінок'])} за рік`);
      if (bk.best) lines.push(`Найвища оцінка — «${bk.best.title}» ${'★'.repeat(bk.best.rating)}`);
      if (bk.titles.length > 1 || (bk.titles.length && !bk.best)) {
        const shown = bk.titles.slice(-3).map((x) => `«${x}»`);
        lines.push(shown.join(', ') + (bk.titles.length > 3 ? ` і ще ${bk.titles.length - 3}` : ''));
      }
      out.push(bk.read
        ? { id: 'books', group: 'books', icon: 'library', kicker: 'Книги', value: bk.read, num: 'int', unit: fmt.plural(bk.read, ['книгу прочитано', 'книги прочитано', 'книг прочитано']),
          cmp: cmp(bk.read, P('books') && P('books').read, y, b), lines }
        : { id: 'books', group: 'books', icon: 'library', kicker: 'Книги', value: bk.pages, num: 'int', unit: fmt.plural(bk.pages, ['сторінка', 'сторінки', 'сторінок']) + ' прочитано', lines });
    }
    if (st.quote) {
      out.push({ id: 'quote', group: 'books', icon: 'quote', kicker: 'Цитата року', quote: st.quote, lines: [] });
    }
    if (st.people) {
      const p = st.people;
      const lines = [];
      if (p.birthdays) lines.push(`${int(p.birthdays)} ${fmt.plural(p.birthdays, ['день народження', 'дні народження', 'днів народження'])} за рік`);
      if (p.total) lines.push(`${int(p.total)} ${fmt.plural(p.total, ['людина', 'людини', 'людей'])} в CRM`);
      const pp = P('people') && P('people').greeted ? P('people').greeted : null;
      out.push(p.greeted
        ? { id: 'people', group: 'books', icon: 'cake', kicker: 'Люди', value: p.greeted, num: 'int',
          unit: fmt.plural(p.greeted, ['привітання', 'привітання', 'привітань']) + ' з днем народження', cmp: cmp(p.greeted, pp, y, b), lines }
        : { id: 'people', group: 'books', icon: 'cake', kicker: 'Люди', value: p.birthdays, num: 'int',
          unit: fmt.plural(p.birthdays, ['день народження', 'дні народження', 'днів народження']) + ' за рік', lines: lines.filter((l) => !/народжен/.test(l)) });
    }

    // Рекорди
    const rec = [];
    if (st.training && st.training.run) rec.push({ icon: 'trendUp', label: 'Найдовший біг', value: km(st.training.run.km), sub: fmt.dateShort(st.training.run.date) });
    if (st.training && st.training.month) rec.push({ icon: 'dumbbell', label: 'Найактивніший місяць тренувань', value: CRM.MONTHS_NOM[st.training.month.m - 1], sub: fmt.count(st.training.month.n, ['тренування', 'тренування', 'тренувань']) });
    if (st.books && st.books.day) rec.push({ icon: 'library', label: 'Найбільше сторінок за день', value: `${int(st.books.day.n)} стор.`, sub: fmt.dateShort(st.books.day.date) });
    if (st.tasks && st.tasks.day) rec.push({ icon: 'checkCircle', label: 'Найбільше задач за день', value: fmt.count(st.tasks.day.n, ['задача', 'задачі', 'задач']), sub: fmt.dateShort(st.tasks.day.date) });
    if (st.money && st.money.month) rec.push({ icon: 'coins', label: 'Найдорожчий місяць', value: CRM.MONTHS_NOM[st.money.month.m - 1], sub: hide ? 'найбільше витрат' : money(st.money.month.amount), money: true });
    if (rec.length) {
      out.push({ id: 'records', group: 'records', icon: 'star', kicker: 'Рекорди року', big: rec.length > 1 ? 'Твої рекорди' : 'Твій рекорд', lines: [],
        records: rec, money: rec.some((r) => r.money),
        extra: () => h('ul', { class: 'yr-records' }, rec.map((r) => h('li', null,
          h('span', { class: 'yr-rec-ico', 'aria-hidden': 'true' }, CRM.icon(r.icon, { size: 'sm' })),
          h('span', { class: 'yr-rec-text' }, h('span', { class: 'yr-rec-label' }, r.label), h('span', { class: 'yr-rec-sub' }, r.sub)),
          h('span', { class: 'yr-rec-val' }, r.value)))) });
    }

    // Цілі цього року — «вдалося?»
    const mine = goalsOf(y);
    if (mine.length) {
      const ok = mine.filter((g) => g.done === true).length;
      out.push({ id: 'goals-past', group: 'goals', icon: 'target', kicker: `Цілі на ${y}`, big: `${ok} з ${mine.length}`, unit: 'вдалося', lines: [],
        goals: { list: mine, ask: true }, extra: () => goalList(y, mine, true) });
    }
    // Цілі на наступний рік
    const ny = y + 1;
    if (ny >= thisYear() || goalsOf(ny).length) {
      const next = goalsOf(ny);
      out.push({ id: 'goals', group: 'goals', icon: 'flag', kicker: `Цілі на ${ny}`, big: next.length ? `Що далі в ${ny}` : `Що хочеш у ${ny}?`,
        lines: next.length ? [] : [`Запиши 2–5 цілей — у грудні ${ny} «Мій рік» покаже їх і спитає, що вдалося.`],
        goals: next.length ? { list: next, ask: false } : null, shareable: next.length > 0,
        extra: next.length ? () => goalList(ny, next, false) : null,
        actions: () => (ny >= thisYear() ? h('button', { type: 'button', class: 'yr-btn', onClick: (e) => { e.stopPropagation(); openGoals(ny); } },
          CRM.icon(next.length ? 'pencil' : 'plus', { size: 'sm' }), next.length ? 'Змінити цілі' : 'Записати цілі') : null) });
    }
    return out;
  }

  /** Список цілей; ask — кнопки «Вдалося» / «Ні». */
  function goalList(y, list, ask) {
    return h('ol', { class: 'yr-goals' + (ask ? ' is-ask' : '') }, list.map((g) => h('li', { class: g.done === true ? 'is-done' : g.done === false ? 'is-miss' : '' },
      h('span', { class: 'yr-goal-text' }, g.text),
      ask ? h('span', { class: 'yr-goal-ask', role: 'group', 'aria-label': 'Вдалося?' },
        h('button', { type: 'button', class: 'yr-ask yr-ask-yes' + (g.done === true ? ' on' : ''), 'aria-pressed': g.done === true ? 'true' : 'false', title: 'Вдалося', 'aria-label': `«${g.text}» — вдалося`,
          onClick: (e) => { e.stopPropagation(); setGoalDone(y, g.id, g.done === true ? null : true); } }, CRM.icon('check', { size: 'sm' })),
        h('button', { type: 'button', class: 'yr-ask yr-ask-no' + (g.done === false ? ' on' : ''), 'aria-pressed': g.done === false ? 'true' : 'false', title: 'Ні', 'aria-label': `«${g.text}» — не вдалося`,
          onClick: (e) => { e.stopPropagation(); setGoalDone(y, g.id, g.done === false ? null : false); } }, CRM.icon('x', { size: 'sm' }))) : null)));
  }

  /** Вікно «Цілі на РРРР»: 2–5 рядків. */
  function openGoals(y) {
    const rows = goalsOf(y).map((g) => Object.assign({}, g));
    while (rows.length < 2) rows.push({ id: U.uid(), text: '', done: null });
    const list = h('div', { class: 'yr-goal-edit' });
    const addBtn = ui.button({ label: 'Ще ціль', icon: 'plus', variant: 'ghost', size: 'sm', onClick: () => { rows.push({ id: U.uid(), text: '', done: null }); draw(rows.length - 1); } });
    function draw(focusAt) {
      ui.mount(list, rows.map((r, i) => {
        const inp = ui.input({ value: r.text, maxlength: 200, placeholder: i === 0 ? 'Напр., пробігти напівмарафон' : i === 1 ? 'Прочитати 12 книг' : 'Ще одна ціль', 'aria-label': `Ціль ${i + 1}` });
        inp.addEventListener('input', () => { r.text = inp.value; });
        inp.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.ctrlKey && !e.metaKey) { e.preventDefault(); if (i === rows.length - 1 && rows.length < MAX_GOALS) { rows.push({ id: U.uid(), text: '', done: null }); draw(rows.length - 1); } else { const n = list.querySelectorAll('input')[i + 1]; if (n) n.focus(); } } });
        return h('div', { class: 'yr-goal-row' },
          h('span', { class: 'yr-goal-n' }, String(i + 1)),
          inp,
          h('button', { type: 'button', class: 'btn btn-ghost btn-icon btn-sm', title: 'Прибрати', 'aria-label': `Прибрати ціль ${i + 1}`,
            onClick: () => { rows.splice(i, 1); if (!rows.length) rows.push({ id: U.uid(), text: '', done: null }); draw(Math.min(i, rows.length - 1)); } }, CRM.icon('x', { size: 'sm' })));
      }));
      addBtn.hidden = rows.length >= MAX_GOALS;
      if (focusAt != null) { const n = list.querySelectorAll('input')[focusAt]; if (n) n.focus(); }
    }
    draw();
    const dlg = ui.modal({
      title: `Цілі на ${y}`, size: 'sm', className: 'yr-goals-modal',
      body: [h('p', { class: 'modal-text' }, `2–5 цілей. У грудні ${y} «Мій рік» покаже їх і спитає, що вдалося.`), list, addBtn],
      footer: [ui.button({ label: 'Скасувати', onClick: () => dlg.close('button') }),
        ui.button({ label: 'Зберегти', variant: 'primary', onClick: async () => {
          await saveGoals(y, rows);
          dlg.close('saved');
          const n = goalsOf(y).length;
          ui.toast(n ? `Цілі на ${y} збережено (${n})` : `Цілей на ${y} немає`, { type: n ? 'success' : undefined });
        } })]
    });
  }

  // ---------- Обкладинка ----------
  function sinceText(st) {
    const b = st.b;
    if (!st.first) return '';
    return st.first > b.from ? `з ${fmt.dateShort(st.first)}` : 'увесь рік';
  }
  function headline(st) {
    const out = [];
    if (st.training) out.push(fmt.count(st.training.n, ['тренування', 'тренування', 'тренувань']));
    if (st.books && st.books.read) out.push(fmt.count(st.books.read, ['книга', 'книги', 'книг']));
    if (st.tasks) out.push(fmt.count(st.tasks.done, ['задача', 'задачі', 'задач']));
    if (st.tutor) out.push(fmt.count(st.tutor.lessons, ['урок', 'уроки', 'уроків']));
    if (st.habits && st.habits.best) out.push(`${st.habits.best.n} ${fmt.plural(st.habits.best.n, st.habits.best.words)} поспіль`);
    return out.slice(0, 3);
  }
  function partialText(b) { return b.partial ? `поки що — до ${fmt.dateShort(b.to)}` : ''; }
  /** Обкладинка для картинки: назва, «з …», «поки що — до …», чипи. */
  function coverInfo(y) {
    const st = stats(y);
    return { y, title: `Мій ${y}`, since: sinceText(st), partial: partialText(st.b), chips: st.any ? headline(st) : [], any: !!st.any };
  }
  /** Кнопка «Поділитися» (лише якщо підключено js/year-share.js). */
  const canShare = () => !!(CRM.yearShare && CRM.yearShare.open);
  function coverCard(y) {
    const st = stats(y);
    return { id: 'cover', group: 'cover', cover: true, kicker: 'Моя CRM', big: `Мій ${y}`, st };
  }
  function endCard(y) {
    const b = bounds(y);
    return { id: 'end', group: 'cover', end: true, kicker: `Мій ${y}`, big: b.partial ? `Це твій ${y} — поки що` : `Ось такий він — твій ${y}`, lines: [b.partial ? 'До кінця року ще є час — у грудні тут буде повний підсумок.' : 'Дякую, що вів його в CRM.'] };
  }

  // ---------- Вигляд картки (історія або «Усе разом») ----------
  function numText(v, kind) {
    if (kind === 'money') return money(v);
    if (kind === 'pct') return int(v) + ' %';
    return int(v);
  }
  function slideEl(card, mode, y, nav) {
    const story = mode === 'story';
    const kids = [];
    kids.push(h('div', { class: 'yr-kicker' },
      card.icon ? h('span', { class: 'yr-kicker-ico', 'aria-hidden': 'true' }, CRM.icon(card.icon, { size: 'sm' })) : null,
      h('span', null, card.kicker),
      !story && canShare() && card.shareable !== false && !card.cover && !card.end ? h('button', {
        type: 'button', class: 'yr-share-btn', title: 'Поділитися картинкою', 'aria-label': `Поділитися картинкою: ${card.kicker}`,
        onClick: (e) => { e.stopPropagation(); CRM.yearShare.open(y, card.id); }
      }, CRM.icon('share', { size: 'sm' })) : null));
    if (card.cover) {
      const st = card.st;
      const since = sinceText(st);
      const part = partialText(st.b);
      kids.push(h('div', { class: 'yr-main' },
        h('div', { class: 'yr-title yr-title-cover' }, card.big),
        since || part ? h('div', { class: 'yr-since' }, [since, part].filter(Boolean).join(' · ')) : null,
        st.any ? h('div', { class: 'yr-chips' }, headline(st).map((t) => h('span', { class: 'yr-chip' }, t))) : h('div', { class: 'yr-since' }, 'Даних за цей рік ще немає')));
      if (story) kids.push(h('div', { class: 'yr-hint' }, narrowMq && narrowMq.matches ? 'Торкнись праворуч — далі' : '→ далі · Esc — закрити'));
    } else if (card.quote) {
      kids.push(h('figure', { class: 'yr-quote' },
        h('blockquote', null, '«' + card.quote.text.replace(/^[«"„]+|[»"“]+$/g, '') + '»'),
        h('figcaption', null, '— ' + card.quote.source)));
    } else {
      const main = [];
      if (card.value != null && !card.big) {
        const txt = numText(card.value, card.num);
        const len = txt.replace(/\s/g, '').length;
        main.push(h('div', { class: 'yr-big' + (len >= 7 ? ' is-long' : len >= 5 ? ' is-mid' : '') }, h('span', { class: 'yr-num', dataset: { to: String(card.value), fmt: card.num || 'int' } }, txt)));
      } else if (card.big) {
        main.push(h('div', { class: 'yr-title' }, card.big));
      }
      if (card.unit) main.push(h('div', { class: 'yr-unit' }, card.unit));
      if (card.cmp) main.push(h('span', { class: 'yr-cmp yr-cmp-' + card.cmp.dir, title: card.cmp.title }, card.cmp.text));
      kids.push(h('div', { class: 'yr-main' }, main));
    }
    if (card.lines && card.lines.length) kids.push(h('ul', { class: 'yr-lines' }, card.lines.map((l) => h('li', null, l))));
    if (card.extra) { const x = card.extra(mode); if (x) kids.push(h('div', { class: 'yr-extra' }, x)); }
    if (card.actions) { const a = card.actions(mode, y); if (a) kids.push(h('div', { class: 'yr-actions' }, a)); }
    if (card.end && nav) {
      kids.push(h('div', { class: 'yr-actions' },
        h('button', { type: 'button', class: 'yr-btn yr-btn-solid', onClick: (e) => { e.stopPropagation(); nav.all(); } }, CRM.icon('apps', { size: 'sm' }), 'Усе разом'),
        h('button', { type: 'button', class: 'yr-btn', onClick: (e) => { e.stopPropagation(); nav.restart(); } }, CRM.icon('refresh', { size: 'sm' }), 'Ще раз')));
    }
    if (story) kids.push(h('div', { class: 'yr-foot' }, `Моя CRM · ${y}`));
    return h(story ? 'section' : 'article', {
      class: (story ? 'yr-slide' : 'yr-card') + (card.cover ? ' is-cover' : '') + (card.quote ? ' is-quote' : ''),
      dataset: { group: card.group, card: card.id }
    }, h('div', { class: 'yr-deco', 'aria-hidden': 'true' }), kids);
  }

  /** Цифри «набігають» від нуля. */
  function countUp(root) {
    if (reduceMq && reduceMq.matches) return;
    root.querySelectorAll('.yr-num[data-to]').forEach((el) => {
      const to = Number(el.dataset.to);
      if (!Number.isFinite(to) || to <= 0) return;
      const kind = el.dataset.fmt;
      const t0 = performance.now();
      const dur = 900;
      const step = (t) => {
        if (!el.isConnected) return;
        const k = Math.min(1, (t - t0) / dur);
        const e = 1 - Math.pow(1 - k, 3);
        el.textContent = numText(k >= 1 ? to : Math.round(to * e), kind);
        if (k < 1) requestAnimationFrame(step);
      };
      el.textContent = numText(0, kind);
      requestAnimationFrame(step);
    });
  }

  // ---------- Історії ----------
  let story = null;
  function storyList(y) { return [coverCard(y)].concat(cardsFor(y)).concat([endCard(y)]); }

  function openStories(y, startId) {
    closeStories();
    let list = storyList(y);
    let i = Math.max(0, list.findIndex((c) => c.id === startId));
    const bars = h('div', { class: 'yr-bars', 'aria-hidden': 'true' });
    const stage = h('div', { class: 'yr-stage', 'aria-live': 'polite' });
    const counter = h('span', { class: 'yr-count' });
    const closeBtn = h('button', { type: 'button', class: 'yr-close', title: 'Закрити (Esc)', 'aria-label': 'Закрити', onClick: (e) => { e.stopPropagation(); closeStories(); } }, CRM.icon('x'));
    // «Поділитися»: картка — своя картинка, обкладинка й кінець — загальна
    const shareBtn = canShare() ? h('button', { type: 'button', class: 'yr-story-share', title: 'Поділитися картинкою', 'aria-label': 'Поділитися картинкою',
      onClick: (e) => { e.stopPropagation(); const c = list[i]; CRM.yearShare.open(y, c.cover || c.end ? null : c.id); } }, CRM.icon('share')) : null;
    const frame = h('div', { class: 'yr-frame', tabIndex: -1 }, bars, h('div', { class: 'yr-top' }, h('span', { class: 'yr-top-title' }, `Мій ${y}`), counter, shareBtn, closeBtn), stage);
    const prevBtn = h('button', { type: 'button', class: 'yr-nav yr-nav-prev', title: 'Назад (←)', 'aria-label': 'Назад', onClick: () => go(i - 1) }, CRM.icon('chevronLeft'));
    const nextBtn = h('button', { type: 'button', class: 'yr-nav yr-nav-next', title: 'Далі (→)', 'aria-label': 'Далі', onClick: () => go(i + 1) }, CRM.icon('chevronRight'));
    const backdrop = h('div', { class: 'yr-backdrop' });
    const root = h('div', { class: 'yr-stories', role: 'dialog', 'aria-modal': 'true', 'aria-label': `Мій ${y} — історії` }, backdrop, prevBtn, frame, nextBtn);
    backdrop.addEventListener('click', () => closeStories());

    const nav = {
      all: () => { closeStories(); scrollToAll(); },
      restart: () => go(0)
    };
    function drawBars() {
      ui.mount(bars, list.map((c, k) => h('span', { class: 'yr-bar' + (k < i ? ' done' : k === i ? ' active' : '') }, h('i'))));
      counter.textContent = `${i + 1} / ${list.length}`;
    }
    function show(dir) {
      const card = list[i];
      frame.dataset.group = card.group;
      const el = slideEl(card, 'story', y, nav);
      if (dir) el.classList.add(dir > 0 ? 'in-next' : 'in-prev');
      ui.mount(stage, el);
      drawBars();
      prevBtn.disabled = i === 0;
      nextBtn.disabled = i === list.length - 1;
      if (shareBtn) {
        const whole = card.cover || card.end;
        shareBtn.hidden = card.shareable === false || (whole && !stats(y).any);
        shareBtn.title = whole ? 'Поділитися підсумком року (картинка)' : 'Поділитися картинкою';
        shareBtn.setAttribute('aria-label', shareBtn.title);
      }
      countUp(el);
    }
    function go(n) {
      if (n < 0 || n >= list.length || n === i) return;
      const dir = n > i ? 1 : -1;
      i = n;
      show(dir);
    }
    // Дотики й мишка: торкнувся ліворуч — назад, праворуч — далі; свайп униз — закрити, вліво/вправо — далі/назад.
    // Усе — за pointerup (без click: після свайпу браузер буває не надсилає click для наступного дотику)
    let start = null;
    const interactive = (t) => t && t.closest && t.closest('button, a, input, textarea, select, label');
    frame.addEventListener('pointerdown', (e) => {
      start = interactive(e.target) || (e.pointerType === 'mouse' && e.button !== 0) ? null : { x: e.clientX, y: e.clientY, id: e.pointerId };
    });
    frame.addEventListener('pointercancel', () => { start = null; });
    frame.addEventListener('pointerup', (e) => {
      if (!start || e.pointerId !== start.id) return;
      const dx = e.clientX - start.x;
      const dy = e.clientY - start.y;
      start = null;
      if (dy > 80 && Math.abs(dy) > Math.abs(dx) * 1.3) { closeStories(); return; }
      if (Math.abs(dx) > 50 && Math.abs(dx) > Math.abs(dy)) { go(dx < 0 ? i + 1 : i - 1); return; }
      if (Math.abs(dx) > 12 || Math.abs(dy) > 12) return;
      const r = frame.getBoundingClientRect();
      if (e.clientX - r.left < r.width * 0.3) go(i - 1); else go(i + 1);
    });
    function onKey(e) {
      if (!story || story.root !== root) return;
      if (document.querySelector('.overlay')) return; // відкрите вікно (цілі) поверх історій
      const t = e.target;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      let n = null;
      if (e.key === 'ArrowRight' || e.key === 'PageDown' || (e.key === ' ' && !interactive(t))) n = i + 1;
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') n = i - 1;
      else if (e.key === 'Home') n = 0;
      else if (e.key === 'End') n = list.length - 1;
      if (n == null) return;
      e.preventDefault();
      go(n);
    }
    document.addEventListener('keydown', onKey);
    const onHash = () => { const name = (location.hash.replace(/^#\/?/, '').split(/[/?]/)[0] || 'home'); if (name !== 'year') closeStories(); };
    window.addEventListener('hashchange', onHash);
    // Змінились цілі (вікно «Цілі», інший пристрій) — перемалювати поточну картку
    let lastCfg = JSON.stringify(cfg());
    const off = S().on(['settings'], () => {
      const now = JSON.stringify(cfg());
      if (now === lastCfg) return;
      lastCfg = now;
      const id = list[i] && list[i].id;
      list = storyList(y);
      const k = list.findIndex((c) => c.id === id);
      i = k >= 0 ? k : Math.min(i, list.length - 1);
      show(0);
    });
    document.body.appendChild(root);
    const unregister = ui.registerLayer({ el: root, lock: true, close: () => closeStories() });
    const prevFocus = document.activeElement;
    story = {
      root, y,
      close() {
        document.removeEventListener('keydown', onKey);
        window.removeEventListener('hashchange', onHash);
        off();
        unregister();
        root.remove();
        if (prevFocus && typeof prevFocus.focus === 'function' && document.contains(prevFocus)) { try { prevFocus.focus({ preventScroll: true }); } catch (e) { /* не критично */ } }
      },
      get index() { return i; },
      go
    };
    show(0);
    try { frame.focus({ preventScroll: true }); } catch (e) { /* не критично */ }
  }
  function closeStories() {
    if (!story) return;
    const s = story;
    story = null;
    s.close();
  }
  function scrollToAll() {
    const el = document.querySelector('#page .yr-all');
    if (el) el.scrollIntoView({ behavior: reduceMq && reduceMq.matches ? 'auto' : 'smooth', block: 'start' });
  }

  // ---------- Сторінка ----------
  function render(container, route) {
    const ys = years();
    let y = Number(route.params.y);
    if (!ys.includes(y)) y = defaultYear();
    if (!ys.includes(y)) y = ys[ys.length - 1];
    const b = bounds(y);
    const st = stats(y);
    const list = cardsFor(y);
    const k = ys.indexOf(y);

    const sw = h('div', { class: 'yr-switch', role: 'group', 'aria-label': 'Рік' },
      h('button', { type: 'button', class: 'btn btn-ghost btn-icon btn-sm', disabled: k <= 0, title: k > 0 ? String(ys[k - 1]) : 'Раніших років немає', 'aria-label': 'Попередній рік',
        onClick: () => CRM.router.go('year', { y: ys[k - 1] }) }, CRM.icon('chevronLeft', { size: 'sm' })),
      h('span', { class: 'yr-switch-label' }, String(y)),
      h('button', { type: 'button', class: 'btn btn-ghost btn-icon btn-sm', disabled: k >= ys.length - 1, title: k < ys.length - 1 ? String(ys[k + 1]) : 'Це останній рік', 'aria-label': 'Наступний рік',
        onClick: () => CRM.router.go('year', { y: ys[k + 1] }) }, CRM.icon('chevronRight', { size: 'sm' })));

    const since = sinceText(st);
    const hero = h('section', { class: 'yr-hero', dataset: { group: 'cover' } },
      h('div', { class: 'yr-deco', 'aria-hidden': 'true' }),
      h('div', { class: 'yr-kicker' }, h('span', { class: 'yr-kicker-ico', 'aria-hidden': 'true' }, CRM.icon('sparkles', { size: 'sm' })), h('span', null, 'Моя CRM')),
      h('div', { class: 'yr-title yr-title-cover' }, `Мій ${y}`),
      since || b.partial ? h('div', { class: 'yr-since' }, [since, partialText(b)].filter(Boolean).join(' · ')) : null,
      st.any ? h('div', { class: 'yr-chips' }, headline(st).map((t) => h('span', { class: 'yr-chip' }, t))) : null,
      h('div', { class: 'yr-actions' },
        h('button', { type: 'button', class: 'yr-btn yr-btn-solid yr-play', onClick: () => openStories(y) }, CRM.icon('sparkles', { size: 'sm' }), 'Дивитися історії')));

    const dataCards = list.filter((c) => c.group !== 'goals');
    const grid = h('div', { class: 'yr-grid' }, list.map((c) => {
      const el = slideEl(c, 'grid', y);
      el.setAttribute('role', 'button');
      el.tabIndex = 0;
      el.setAttribute('aria-label', `${c.kicker} — відкрити в історіях`);
      el.addEventListener('click', (e) => { if (e.target.closest('button, a')) return; openStories(y, c.id); });
      el.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === el) { e.preventDefault(); openStories(y, c.id); } });
      return el;
    }));

    ui.mount(container, h('div', { class: 'yr-page' },
      ui.pageHead({ title: 'Мій рік', sub: 'Підсумок року з твоїх даних у CRM', actions: sw }),
      hero,
      h('section', { class: 'yr-all' },
        h('div', { class: 'yr-all-head' }, h('h2', null, 'Усе разом'),
          dataCards.length ? h('span', { class: 'subtle' }, 'Натисни на картку — відкриється в історіях') : null,
          dataCards.length && canShare() ? ui.button({ label: 'Загальна картинка', icon: 'share', size: 'sm', className: 'yr-all-share',
            title: `Одна картинка з головними цифрами ${y} року`, onClick: () => CRM.yearShare.open(y, null) }) : null),
        dataCards.length ? null : h('section', { class: 'card' }, ui.empty({
          icon: 'sparkles', small: true, title: `Даних за ${y} ще немає`,
          text: 'Додавай тренування, витрати, книги, задачі — і тут зʼявиться підсумок року. Те, що було раніше, можна внести заднім числом: книга — «Прочитано» з датою «Дочитав», тренування — з будь-якою датою, гроші — «Імпорт виписки».'
        })),
        grid)));

    if (route.params.story) {
      const card = route.params.card || null;
      CRM.router.consumeParam('story');
      CRM.router.consumeParam('card');
      setTimeout(() => openStories(y, card), 0);
    }
    return null;
  }

  CRM.router.register('year', {
    title: 'Мій рік',
    stores: ['tasks', 'events', 'people', 'habits', 'books', 'students', 'transactions', 'accounts', 'categories', 'rates', 'courses', 'workouts', 'meals', 'settings'],
    render
  });

  // ---------- Головна: картка з 1 грудня до 31 січня ----------
  function homeShown() {
    const y = homeYear();
    if (!y || hiddenYears().includes(String(y))) return false;
    return hasData(y);
  }
  function homeCard() {
    const y = homeYear();
    if (!y) return null;
    const st = stats(y);
    const b = bounds(y);
    const hide = h('button', {
      type: 'button', class: 'btn btn-ghost btn-icon btn-sm yr-home-hide', title: 'Сховати до наступного року', 'aria-label': 'Сховати картку «Мій рік»',
      onClick: async (e) => {
        e.stopPropagation();
        await setCfg({ hidden: hiddenYears().filter((x) => x !== String(y)).concat(String(y)) });
        // Головна не перемальовується від кожного налаштування — оновлюємо самі
        if (CRM.router.current && CRM.router.current.name === 'home') CRM.router.rerender();
        ui.toast(`Картку сховано. «Мій ${y}» — у меню, розділ «Інше».`, {
          action: { label: 'Скасувати', onClick: async () => {
            await setCfg({ hidden: hiddenYears().filter((x) => x !== String(y)) });
            if (CRM.router.current && CRM.router.current.name === 'home') CRM.router.rerender();
          } }
        });
      }
    }, CRM.icon('x', { size: 'sm' }));
    return h('section', { class: 'card yr-home', dataset: { group: 'cover' } },
      h('div', { class: 'card-head' }, h('h2', null, 'Мій рік'), h('div', { class: 'btn-row' }, hide)),
      h('div', { class: 'yr-deco', 'aria-hidden': 'true' }),
      h('div', { class: 'yr-home-body' },
        h('div', { class: 'yr-home-title' }, b.partial ? `Твій ${y} — поки що` : `Твій ${y} готовий`),
        h('div', { class: 'yr-chips' }, headline(st).map((t) => h('span', { class: 'yr-chip' }, t))),
        h('button', { type: 'button', class: 'yr-btn yr-btn-solid', onClick: () => CRM.router.go('year', { y, story: 1 }) }, CRM.icon('sparkles', { size: 'sm' }), 'Подивитися')));
  }

  CRM.year = {
    KEY, MAX_GOALS, GROUPS, cfg, goalsOf, saveGoals, setGoalDone, bounds, prevBounds, defaultYear, homeYear, compute, stats, prevStats, hasData, years,
    cardsFor, coverInfo, storyList, openStories, closeStories, openGoals, homeShown, homeCard,
    get storyOpen() { return story ? { y: story.y, index: story.index } : null; }
  };
})(window.CRM);
