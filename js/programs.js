/* ==========================================================================
   programs.js — програми тренувань, імпортовані з JSON-файлів
   (вкладка «Тренування → Програми»).

   • Імпорт файлу з перевіркою схеми (schemaVersion 1) і зрозумілими помилками.
   • Картки програм з прогресом («Тиждень X з 24», «Виконано N з M»),
     список тренувань на тиждень з усіх програм (разом із вбудованою «Верх тіла»).
   • Сторінка програми: день (розминка, основна частина, заминка, відео),
     календар усіх тижнів, правила, дата старту, зсув графіка, видалення.
   • «Виконано» відкриває форму журналу з планом дня; запис отримує
     program = { id, week, day, date, planned, repeat? }.
   • «Сьогоднішнє тренування» на Головній і пункти в розкладі.

   Дані: сховище programs, запис = одна програма:
   { id, sourceId, title, kind: 'strength'|'running', durationWeeks, startDate,
     shifts: [{ id, from, days, createdAt }], color, importedAt, fileName,
     plan: { schemaVersion, rules, exercises, warmup, cooldown, sessions } }.
   Дата тренування k (0…) = startDate + k + сума зсувів з from ≤ k. Дні, що
   звільнилися через зсув, — повтор попередніх тренувань (як радять правила).
   Виконане визначається за журналом, нічого окремо не зберігається.
   ========================================================================== */
window.CRM = window.CRM || {};

(function (CRM) {
  'use strict';

  const { h, ui } = { h: CRM.ui.h, ui: CRM.ui };
  const D = CRM.date;
  const fmt = CRM.fmt;

  const STORE = 'programs';
  const SCHEMA_VERSION = 1;
  const MAX_FILE = 2 * 1024 * 1024;
  const MAX_WEEKS = 104;
  const KINDS = {
    strength: { label: 'Сила', icon: 'dumbbell', workoutType: 'home' },
    running: { label: 'Біг', icon: 'trendUp', workoutType: 'cardio' }
  };
  const PARTS = { warmup: 'розминка', main: 'основна частина', cooldown: 'заминка' };
  const PHASES = {
    adaptation: { name: 'Адаптація', color: 'aqua' },
    main: { name: 'Основна', color: 'blue' },
    base: { name: 'Основа', color: 'blue' },
    deload: { name: 'Розвантаження', color: 'yellow' },
    recovery: { name: 'Відновлення', color: 'yellow' },
    test: { name: 'Тест', color: 'orange' }
  };
  // Кольори програм у тижневому списку (вбудована «Верх тіла» — фіолетова)
  const COLORS = ['orange', 'teal', 'magenta', 'green', 'brown', 'olive', 'red', 'yellow', 'blue', 'aqua'];

  // ---------- Дрібні помічники ----------
  const isObj = (v) => v != null && typeof v === 'object' && !Array.isArray(v);
  const isInt = (v, min, max) => Number.isInteger(v) && v >= min && v <= max;
  const isText = (v, max) => typeof v === 'string' && v.trim().length > 0 && v.length <= (max || 500);
  function show(v) {
    if (v === undefined) return 'нічого';
    let s;
    try { s = JSON.stringify(v); } catch (e) { s = String(v); }
    return s && s.length > 40 ? s.slice(0, 37) + '…' : s;
  }
  function secLabel(sec) {
    const s = Math.round(Number(sec) || 0);
    if (s < 60) return `${s} с`;
    if (s % 60 === 0) return `${s / 60} хв`;
    return `${Math.floor(s / 60)} хв ${s % 60} с`;
  }
  function mmss(sec) { const s = Math.round(Number(sec) || 0); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; }
  function kmText(m) { return fmt.number(m / 1000, m % 100 === 0 ? 1 : 2).replace(/,0+$/, '') + ' км'; }
  function kmShort(m) { return fmt.number(m / 1000, m % 100 === 0 ? 1 : 2).replace(/,0+$/, ''); }
  function inDays(n) {
    if (n === 0) return 'сьогодні';
    if (n === 1) return 'завтра';
    return `через ${fmt.count(n, ['день', 'дні', 'днів'])}`;
  }
  const kindOf = (p) => KINDS[p.kind] || KINDS.strength;
  const phaseOf = (id) => PHASES[id] || { name: id ? id.charAt(0).toUpperCase() + id.slice(1) : 'Фаза', color: 'violet' };
  const colorOf = (p) => CRM.dict.categoryColor(p.color || 'orange');
  /** «Біг на вулиці, 24 тижні» → «Біг на вулиці» (для значків і рядків). */
  function shortTitle(p) {
    const t = String((p && p.title) || 'Програма');
    const cut = t.replace(/,\s*\d+\s*тиж\S*\s*$/i, '').trim();
    return cut.length >= 3 ? cut : t;
  }

  // ---------- Перевірка схеми ----------
  /**
   * Перевірити вміст файлу програми. Повертає { errors: [...], data } —
   * data (нормалізована програма) є лише тоді, коли помилок немає.
   */
  function validate(obj) {
    const errors = [];
    const add = (m) => { if (errors.length < 200) errors.push(m); };
    if (!isObj(obj)) {
      add('Файл має містити один обʼєкт програми у фігурних дужках { … }, а не список чи текст.');
      return { errors };
    }
    // Шапка
    if (!('schemaVersion' in obj)) add('Немає поля schemaVersion (версія схеми). Має бути 1.');
    else if (typeof obj.schemaVersion === 'number' && obj.schemaVersion > SCHEMA_VERSION) add(`Файл має схему версії ${obj.schemaVersion}, а сайт поки знає лише версію ${SCHEMA_VERSION}. Онови сайт або попроси файл у версії ${SCHEMA_VERSION}.`);
    else if (obj.schemaVersion !== SCHEMA_VERSION) add(`schemaVersion має бути ${SCHEMA_VERSION}, а зараз — ${show(obj.schemaVersion)}.`);
    if (!isText(obj.id, 100)) add('Поле id (ідентифікатор програми) має бути непорожнім текстом до 100 символів, напр. "running-24w".');
    if (!isText(obj.title, 150)) add('Поле title (назва програми) має бути непорожнім текстом до 150 символів.');
    const kindOk = Object.prototype.hasOwnProperty.call(KINDS, obj.kind);
    if (!kindOk) add(`Поле kind має бути "strength" (сила) або "running" (біг), а зараз — ${show(obj.kind)}.`);
    const weeksOk = isInt(obj.durationWeeks, 1, MAX_WEEKS);
    if (!weeksOk) add(`Поле durationWeeks (кількість тижнів) має бути цілим числом від 1 до ${MAX_WEEKS}, а зараз — ${show(obj.durationWeeks)}.`);
    const startOk = D.isDate(obj.startDate);
    if (!startOk) add(`Поле startDate має бути датою у форматі РРРР-ММ-ДД, напр. "2026-10-05", а зараз — ${show(obj.startDate)}.`);

    // Правила
    let rules = [];
    if (obj.rules === undefined) rules = [];
    else if (!Array.isArray(obj.rules)) add('Поле rules (правила) має бути списком рядків [ "…", "…" ].');
    else {
      obj.rules.forEach((r, i) => { if (!isText(r, 3000)) add(`Правило ${i + 1} (rules): має бути непорожнім текстом.`); });
      rules = obj.rules.filter((r) => isText(r, 3000)).map((r) => r.trim());
    }

    // Вправи
    const exById = new Map();
    const exercises = [];
    if (!Array.isArray(obj.exercises) || !obj.exercises.length) add('Поле exercises (вправи) має бути непорожнім списком.');
    else {
      obj.exercises.forEach((e, i) => {
        const where = `Вправа ${i + 1}${e && isText(e.id, 100) ? ` ("${e.id}")` : ''}`;
        if (!isObj(e)) { add(`${where}: має бути обʼєктом { id, name, part, … }.`); return; }
        // ok — вправу можна використовувати в днях; extraOk — решта полів (підказки, відео) теж правильні
        let ok = true;
        let extraOk = true;
        if (!isText(e.id, 100)) { add(`${where}: немає id (ідентифікатора вправи).`); ok = false; } else if (exById.has(e.id)) { add(`${where}: id "${e.id}" повторюється — у кожної вправи має бути свій.`); ok = false; }
        if (!isText(e.name, 200)) { add(`${where}: немає назви (name).`); ok = false; }
        if (!Object.prototype.hasOwnProperty.call(PARTS, e.part)) { add(`${where}: part має бути "warmup" (розминка), "main" (основна частина) або "cooldown" (заминка), а зараз — ${show(e.part)}.`); ok = false; }
        let focus = [];
        if (e.focus !== undefined) {
          if (!Array.isArray(e.focus) || e.focus.some((f) => !isText(f, 1000))) { add(`${where}: focus (підказки) має бути списком рядків.`); extraOk = false; } else focus = e.focus.map((f) => f.trim());
        }
        let videoUrl = null;
        if (e.videoUrl !== undefined && e.videoUrl !== null && e.videoUrl !== '') {
          let url = null;
          try { url = typeof e.videoUrl === 'string' ? new URL(e.videoUrl) : null; } catch (err) { url = null; }
          if (!url || url.protocol !== 'https:') { add(`${where}: videoUrl має бути посиланням, що починається з https://, а зараз — ${show(e.videoUrl)}.`); extraOk = false; } else videoUrl = url.href;
        }
        if (e.videoVerified !== undefined && typeof e.videoVerified !== 'boolean') { add(`${where}: videoVerified має бути true або false.`); extraOk = false; }
        if (!ok || !extraOk) {
          // Вправу все одно запамʼятовуємо, щоб не сипати зайвих помилок «вправи немає» в днях
          if (ok) exById.set(e.id, { id: e.id, name: e.name.trim(), part: e.part });
          return;
        }
        const ex = { id: e.id, name: e.name.trim(), part: e.part, focus, videoUrl, videoVerified: e.videoVerified === true };
        exById.set(e.id, ex);
        exercises.push(ex);
      });
    }
    const exName = (id) => (exById.has(id) ? `«${exById.get(id).name}»` : `"${id}"`);
    function refOk(id, part, where) {
      if (!isText(id, 100)) { add(`${where}: немає exerciseId (посилання на вправу).`); return false; }
      const ex = exById.get(id);
      if (!ex) { add(`${where}: вправи "${id}" немає в списку exercises.`); return false; }
      if (ex.part !== part) { add(`${where}: вправа ${exName(id)} позначена як ${PARTS[ex.part]} (part "${ex.part}"), а стоїть у частині «${PARTS[part]}».`); return false; }
      return true;
    }

    // Розминка й заминка
    function partList(key, part, label) {
      const out = [];
      if (obj[key] === undefined) return out;
      if (!Array.isArray(obj[key])) { add(`Поле ${key} (${label}) має бути списком.`); return out; }
      obj[key].forEach((it, i) => {
        const where = `${label.charAt(0).toUpperCase() + label.slice(1)}, пункт ${i + 1}`;
        if (!isObj(it)) { add(`${where}: має бути обʼєктом { exerciseId, reps або durationSec }.`); return; }
        let ok = refOk(it.exerciseId, part, where);
        if (it.reps !== undefined && !isInt(it.reps, 1, 1000)) { add(`${where}: reps (повторення) має бути цілим числом від 1 до 1000.`); ok = false; }
        if (it.durationSec !== undefined && !isInt(it.durationSec, 1, 36000)) { add(`${where}: durationSec (тривалість, с) має бути цілим числом від 1 до 36000.`); ok = false; }
        if (it.reps === undefined && it.durationSec === undefined) { add(`${where}: вкажи reps (повторення) або durationSec (тривалість, с).`); ok = false; }
        if (!ok) return;
        const x = { exerciseId: it.exerciseId };
        if (it.reps !== undefined) x.reps = it.reps;
        if (it.durationSec !== undefined) x.durationSec = it.durationSec;
        out.push(x);
      });
      return out;
    }
    const warmup = partList('warmup', 'warmup', 'розминка');
    const cooldown = partList('cooldown', 'cooldown', 'заминка');

    // Дні (sessions)
    const sessions = [];
    if (!Array.isArray(obj.sessions) || !obj.sessions.length) add('Поле sessions (дні програми) має бути непорожнім списком.');
    else {
      const seen = new Set();
      obj.sessions.forEach((s, i) => {
        if (errors.length >= 200) return;
        const wd = isObj(s) && isInt(s.week, 1, MAX_WEEKS) && isInt(s.day, 1, 7);
        const where = wd ? `Тиждень ${s.week}, день ${s.day}` : `Запис sessions №${i + 1}`;
        if (!isObj(s)) { add(`${where}: має бути обʼєктом { week, day, date, phase, rest, main }.`); return; }
        let ok = true;
        if (!isInt(s.week, 1, weeksOk ? obj.durationWeeks : MAX_WEEKS)) { add(`${where}: week має бути цілим числом від 1 до ${weeksOk ? obj.durationWeeks : MAX_WEEKS}, а зараз — ${show(s.week)}.`); ok = false; }
        if (!isInt(s.day, 1, 7)) { add(`${where}: day має бути цілим числом від 1 до 7, а зараз — ${show(s.day)}.`); ok = false; }
        if (ok) {
          const key = s.week + '-' + s.day;
          if (seen.has(key)) { add(`${where}: цей день записано двічі.`); ok = false; }
          seen.add(key);
        }
        if (!D.isDate(s.date)) { add(`${where}: date має бути датою РРРР-ММ-ДД, а зараз — ${show(s.date)}.`); ok = false; } else if (ok && startOk) {
          const expected = D.addDays(obj.startDate, (s.week - 1) * 7 + s.day - 1);
          if (s.date !== expected) { add(`${where}: дата ${s.date} не збігається з тижнем і днем — від старту ${obj.startDate} це має бути ${expected}.`); ok = false; }
        }
        if (!isText(s.phase, 60)) { add(`${where}: phase (фаза) має бути непорожнім текстом, напр. "adaptation" або "main".`); ok = false; }
        if (typeof s.rest !== 'boolean') { add(`${where}: rest має бути true (відпочинок) або false (тренування).`); ok = false; }
        if (!Array.isArray(s.main)) { add(`${where}: main (вправи дня) має бути списком, для відпочинку — порожнім [].`); return; }
        if (s.rest === true && s.main.length) { add(`${where}: у дні відпочинку (rest: true) не може бути вправ.`); ok = false; }
        if (s.rest === false && !s.main.length) { add(`${where}: немає жодної вправи. Якщо це відпочинок — постав rest: true.`); ok = false; }
        const main = [];
        s.main.forEach((m, j) => {
          const w = `${where}, вправа ${j + 1}`;
          if (!isObj(m)) { add(`${w}: має бути обʼєктом { exerciseId, … }.`); ok = false; return; }
          if (!refOk(m.exerciseId, 'main', w)) { ok = false; return; }
          const x = { exerciseId: m.exerciseId };
          const nm = `${w} ${exName(m.exerciseId)}`;
          if (obj.kind === 'strength') {
            if (!isInt(m.sets, 1, 50)) { add(`${nm}: sets (підходи) має бути цілим числом від 1 до 50.`); ok = false; }
            if (!isInt(m.reps, 1, 1000)) { add(`${nm}: reps (повторення) має бути цілим числом від 1 до 1000.`); ok = false; }
            if (m.restSec !== undefined && !isInt(m.restSec, 0, 3600)) { add(`${nm}: restSec (відпочинок, с) має бути цілим числом від 0 до 3600.`); ok = false; }
            x.sets = m.sets; x.reps = m.reps;
            if (m.restSec !== undefined) x.restSec = m.restSec;
          } else if (obj.kind === 'running') {
            const dist = m.distanceM !== undefined;
            const intervals = m.runSec !== undefined || m.walkSec !== undefined || m.rounds !== undefined;
            if (!dist && !intervals) { add(`${nm}: для бігу потрібна distanceM (дистанція в метрах) або runSec + walkSec + rounds (інтервали).`); ok = false; }
            if (dist && !isInt(m.distanceM, 1, 100000)) { add(`${nm}: distanceM має бути цілим числом метрів від 1 до 100000.`); ok = false; }
            if (intervals) {
              if (!isInt(m.runSec, 1, 3600)) { add(`${nm}: runSec (біг, с) має бути цілим числом від 1 до 3600.`); ok = false; }
              if (!isInt(m.walkSec, 0, 3600)) { add(`${nm}: walkSec (ходьба, с) має бути цілим числом від 0 до 3600.`); ok = false; }
              if (!isInt(m.rounds, 1, 100)) { add(`${nm}: rounds (кількість кіл) має бути цілим числом від 1 до 100.`); ok = false; }
            }
            ['distanceM', 'runSec', 'walkSec', 'rounds'].forEach((k) => { if (m[k] !== undefined) x[k] = m[k]; });
          }
          main.push(x);
        });
        if (ok) sessions.push({ week: s.week, day: s.day, date: s.date, phase: s.phase.trim(), rest: s.rest, main });
      });
      if (weeksOk && errors.length < 200) {
        const need = obj.durationWeeks * 7;
        if (seen.size !== need || obj.sessions.length !== need) {
          const missing = [];
          for (let w = 1; w <= obj.durationWeeks && missing.length < 4; w++) for (let d = 1; d <= 7 && missing.length < 4; d++) if (!seen.has(w + '-' + d)) missing.push(`тиждень ${w}, день ${d}`);
          add(`У sessions має бути ${need} днів (${obj.durationWeeks} тижнів × 7, разом із днями відпочинку), а знайдено ${obj.sessions.length}.` + (missing.length ? ` Бракує: ${missing.join('; ')}${missing.length === 4 ? '…' : ''}.` : ''));
        }
      }
    }
    if (errors.length) return { errors };
    sessions.sort((a, b) => a.week - b.week || a.day - b.day);
    return {
      errors,
      data: {
        sourceId: obj.id.trim(), title: obj.title.trim(), kind: obj.kind, durationWeeks: obj.durationWeeks, startDate: obj.startDate,
        plan: { schemaVersion: SCHEMA_VERSION, rules, exercises, warmup, cooldown, sessions }
      }
    };
  }

  /** Помилка розбору JSON — українською і з місцем помилки. */
  function jsonErrorText(e, text) {
    const msg = String((e && e.message) || '');
    let where = '';
    const lc = /line (\d+) column (\d+)/.exec(msg);
    const pos = /position (\d+)/.exec(msg);
    if (lc) where = `рядок ${lc[1]}, символ ${lc[2]}`;
    else if (pos) {
      const before = text.slice(0, Number(pos[1]));
      const lines = before.split('\n');
      where = `рядок ${lines.length}, символ ${lines[lines.length - 1].length + 1}`;
    }
    return `Файл не є коректним JSON${where ? ` (помилка біля: ${where})` : ''}. Перевір коми, лапки й дужки — найчастіше бракує коми між елементами або є зайва кома в кінці списку.`;
  }

  // ---------- Дані ----------
  function list() {
    return CRM.store.list(STORE).sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  }
  function get(id) { const p = CRM.store.get(STORE, id); return p && !p.deletedAt ? p : null; }
  function exMap(p) {
    const m = new Map();
    ((p.plan && p.plan.exercises) || []).forEach((e) => m.set(e.id, e));
    return m;
  }
  function pickColor() {
    const used = new Set(list().map((p) => p.color));
    return COLORS.find((c) => !used.has(c)) || COLORS[list().length % COLORS.length];
  }

  // ---------- Графік: дати тренувань із зсувами ----------
  const tlCache = new Map();
  /** { offs: [зсув від старту для кожного дня k], slots: [{ type: 'session', k } | { type: 'gap', mirror }], total }. */
  function timeline(p) {
    const ss = p.plan.sessions;
    const key = [p.updatedAt, p.startDate, ss.length, JSON.stringify(p.shifts || [])].join('|');
    const cached = tlCache.get(p.id);
    if (cached && cached.key === key) return cached.tl;
    const add = new Map();
    (p.shifts || []).forEach((s) => { if (s.from >= 0 && s.from < ss.length && s.days > 0) add.set(s.from, (add.get(s.from) || 0) + s.days); });
    const offs = new Array(ss.length);
    let acc = 0;
    for (let k = 0; k < ss.length; k++) { acc += add.get(k) || 0; offs[k] = k + acc; }
    const total = offs[ss.length - 1] + 1;
    const slots = new Array(total).fill(null);
    for (let k = 0; k < ss.length; k++) slots[offs[k]] = { type: 'session', k };
    for (let i = 0; i < total;) {
      if (slots[i]) { i++; continue; }
      const g0 = i;
      while (!slots[i]) i++;
      const nextK = slots[i].k;
      const len = i - g0;
      // Звільнені дні повторюють тренування, що були перед зсувом (біг: +1 день — повтор учорашнього;
      // сила: +14 днів — повтор блоку)
      for (let j = 0; j < len; j++) slots[g0 + j] = { type: 'gap', mirror: nextK - len + j >= 0 ? nextK - len + j : null };
    }
    const tl = { offs, slots, total };
    tlCache.set(p.id, { key, tl });
    return tl;
  }
  function startOf(p) { return p.startDate; }
  function endOf(p) { return D.addDays(p.startDate, timeline(p).total - 1); }
  function dateOfSession(p, k) { return D.addDays(p.startDate, timeline(p).offs[k]); }
  /** Що в програмі на дату: { type: 'before'|'after'|'session'|'gap', k?, mirror?, s (день плану або null), repeat }. */
  function slotAt(p, date) {
    const tl = timeline(p);
    const i = D.diffDays(p.startDate, date);
    if (i < 0) return { type: 'before', s: null, date };
    if (i >= tl.total) return { type: 'after', s: null, date };
    const sl = tl.slots[i];
    const ss = p.plan.sessions;
    if (sl.type === 'session') return { type: 'session', k: sl.k, s: ss[sl.k], repeat: false, date };
    return { type: 'gap', mirror: sl.mirror, k: sl.mirror, s: sl.mirror != null ? ss[sl.mirror] : null, repeat: true, date };
  }
  const doneKey = (slot) => (slot.repeat ? 'r:' + slot.date : 's:' + slot.s.week + '-' + slot.s.day);
  /** Записи журналу, привʼязані до програми: ключ дня → тренування. */
  function doneMap(p) {
    const map = new Map();
    CRM.store.list('workouts').forEach((w) => {
      const l = w.program;
      if (!l || l.id !== p.id || !l.week) return;
      map.set(l.repeat ? 'r:' + l.date : 's:' + l.week + '-' + l.day, w);
    });
    return map;
  }
  function progress(p, done) {
    const ss = p.plan.sessions;
    const map = done || doneMap(p);
    const total = ss.filter((s) => !s.rest).length;
    const count = ss.filter((s) => !s.rest && map.has('s:' + s.week + '-' + s.day)).length;
    return { done: count, total };
  }
  /** Тиждень програми сьогодні (останній день плану, що вже настав). */
  function currentWeek(p, date) {
    const tl = timeline(p);
    const i = Math.min(tl.total - 1, D.diffDays(p.startDate, date || D.today()));
    if (i < 0) return 1;
    for (let x = i; x >= 0; x--) {
      const sl = tl.slots[x];
      const k = sl.type === 'session' ? sl.k : sl.mirror;
      if (k != null) return p.plan.sessions[k].week;
    }
    return 1;
  }
  function statusText(p) {
    const T = D.today();
    if (T < p.startDate) return `старт ${fmt.dateShort(p.startDate)} — ${inDays(D.diffDays(T, p.startDate))}`;
    const end = endOf(p);
    if (T > end) return `завершено ${fmt.dateShort(end)}`;
    return `тиждень ${currentWeek(p, T)} з ${p.durationWeeks}`;
  }
  function capital(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  // ---------- Тексти плану ----------
  function partDose(it) {
    return [it.reps ? `${it.reps} повт.` : null, it.durationSec ? secLabel(it.durationSec) : null].filter(Boolean).join(' · ');
  }
  function mainDose(m) {
    if (m.sets) return `${m.sets}×${m.reps}`;
    if (m.rounds) return `${m.rounds} × (${mmss(m.runSec)} біг + ${mmss(m.walkSec)} ходьба)`;
    if (m.distanceM) return kmText(m.distanceM);
    return '';
  }
  /** «Класичні підтягування (прямий хват) 4×4 · Віджимання на стійках 4×12». */
  function headline(p, s) {
    if (!s) return 'Пауза в графіку';
    if (s.rest) return 'Відпочинок';
    const ex = exMap(p);
    return s.main.map((m) => `${(ex.get(m.exerciseId) || { name: 'Вправа' }).name} ${mainDose(m)}`.trim()).join(' · ');
  }
  /** Орієнтовна тривалість дня, хв (null — для бігу на дистанцію темп невідомий). */
  function estimateMinutes(p, s) {
    if (!s || s.rest) return null;
    const part = (items) => items.reduce((t, it) => t + (it.durationSec || 0) + (it.reps ? it.reps * 3 : 0), 0);
    let sec = part(p.plan.warmup) + part(p.plan.cooldown);
    for (const m of s.main) {
      if (m.sets) sec += m.sets * ((m.reps || 0) * 3 + (m.restSec || 0));
      else if (m.rounds) sec += m.rounds * ((m.runSec || 0) + (m.walkSec || 0));
      else return null;
    }
    return Math.max(1, Math.round(sec / 60));
  }
  function partMinutes(items) {
    const sec = items.reduce((t, it) => t + (it.durationSec || 0) + (it.reps ? it.reps * 3 : 0), 0);
    return Math.max(1, Math.round(sec / 60));
  }
  function cellCode(s) {
    if (!s) return '·';
    if (s.rest) return '—';
    const m = s.main[0];
    if (m.sets) return `${m.sets}×${m.reps}`;
    if (m.rounds) return 'Б/Х';
    if (m.distanceM) return kmShort(m.distanceM);
    return '•';
  }

  // ---------- «Виконано» → запис у журналі ----------
  function plannedSnapshot(p, s) {
    const ex = exMap(p);
    return s.main.map((m) => {
      const x = Object.assign({ name: (ex.get(m.exerciseId) || { name: 'Вправа' }).name }, m);
      delete x.exerciseId;
      return x;
    });
  }
  /** Заготовка для форми журналу з планом дня (факт користувач править перед збереженням). */
  function presetFor(p, slot) {
    const s = slot.s;
    const T = D.today();
    const kind = kindOf(p);
    const planned = plannedSnapshot(p, s);
    const link = { id: p.id, week: s.week, day: s.day, date: slot.date, planned };
    if (slot.repeat) link.repeat = true;
    const preset = {
      type: kind.workoutType, date: slot.date > T ? T : slot.date, title: '', durationMin: estimateMinutes(p, s),
      distanceKm: null, exercises: [], note: '', program: link
    };
    const where = `${shortTitle(p)} · тиждень ${s.week}, день ${s.day}${slot.repeat ? ' (повтор)' : ''}`;
    if (p.kind === 'running') {
      const m = planned[0] || {};
      preset.title = String(m.name || shortTitle(p)).slice(0, 60);
      if (m.distanceM) preset.distanceKm = Math.round(m.distanceM) / 1000;
      preset.hint = `${where}. План: ${planned.map((x) => mainDose(x)).join(' + ')}. Впиши фактичну дистанцію й час — темп порахується сам.`;
    } else {
      preset.title = shortTitle(p).slice(0, 60);
      preset.exercises = planned.map((x) => ({ name: x.name, sets: Array.from({ length: x.sets || 1 }, () => ({ reps: x.reps != null ? x.reps : null, weight: null })) }));
      preset.hint = `${where}. Повторення вже вписано за планом — виправ на фактичні в кожному підході.`;
    }
    return preset;
  }
  function markDone(p, date) {
    const slot = slotAt(p, date);
    if (!slot.s || slot.s.rest) return null;
    const w = doneMap(p).get(doneKey(slot));
    if (w) return CRM.training.openForm(w.id);
    return CRM.training.openForm(null, presetFor(p, slot));
  }
  /** План виконано? true / false / null (не можна оцінити). */
  function planMet(w) {
    const pl = w.program && w.program.planned;
    if (!Array.isArray(pl) || !pl.length) return null;
    let judged = false;
    for (const x of pl) {
      if (x.sets && x.reps) {
        const e = (w.exercises || []).find((ex) => ex.name === x.name);
        if (!e) return false;
        const good = (e.sets || []).filter((st) => Number(st.reps) >= x.reps).length;
        if (good < x.sets) return false;
        judged = true;
      } else if (x.distanceM) {
        if (!w.distanceKm) return null;
        if (w.distanceKm * 1000 + 1 < x.distanceM) return false;
        judged = true;
      }
    }
    return judged ? true : null;
  }
  function factText(w) {
    if (w.type === 'cardio') {
      return [w.distanceKm ? kmText(Math.round(w.distanceKm * 1000)) : null, w.durationMin ? `${w.durationMin} хв` : null, CRM.training.pace(w)].filter(Boolean).join(' · ');
    }
    return (w.exercises || []).map((e) => `${e.name}: ${(e.sets || []).map((s) => s.reps).join('·') || '—'}`).join(' · ');
  }
  function badgeText(w) {
    const l = w.program || {};
    const p = CRM.store.get(STORE, l.id);
    return `${p ? shortTitle(p) : 'Програма'} · тиждень ${l.week}, день ${l.day}${l.repeat ? ' · повтор' : ''}`;
  }

  // ---------- Імпорт ----------
  /** Кнопка «Імпортувати програму» з прихованим полем вибору файлу. */
  function importButton(opts) {
    const o = opts || {};
    const input = h('input', { type: 'file', accept: 'application/json,.json', class: 'sr-only', tabIndex: -1, 'aria-hidden': 'true', dataset: { role: 'program-file' } });
    input.addEventListener('change', () => {
      const f = input.files && input.files[0];
      input.value = '';
      if (f) importFile(f);
    });
    const btn = ui.button({ label: o.label || 'Імпортувати програму', icon: 'upload', variant: o.variant, size: o.size, onClick: () => input.click() });
    return h('span', { class: 'pimport-btn' }, btn, input);
  }

  async function importFile(file) {
    if (file.size > MAX_FILE) { errorDialog(file.name, [`Файл завеликий (${fmt.bytes(file.size)}). Файл програми має бути до 2 МБ.`]); return; }
    let text;
    try { text = await CRM.utils.readFileAsText(file); } catch (e) { errorDialog(file.name, ['Не вдалося прочитати файл.']); return; }
    text = text.replace(/^\uFEFF/, '');
    let obj;
    try { obj = JSON.parse(text); } catch (e) { errorDialog(file.name, [jsonErrorText(e, text)]); return; }
    const res = validate(obj);
    if (res.errors.length) { errorDialog(file.name, res.errors); return; }
    previewDialog(res.data, file.name);
  }

  function errorDialog(fileName, errors) {
    const SHOWN = 10;
    const dlg = ui.modal({
      title: 'Файл не підходить', className: 'pimport-error',
      body: h('div', { class: 'stack', style: { gap: '12px' } },
        h('p', { class: 'modal-text' }, `«${fileName}» не вдалося імпортувати як програму тренувань (схема версії ${SCHEMA_VERSION}). ${errors.length > 1 ? `Знайдено проблем: ${errors.length}.` : ''}`),
        h('ul', { class: 'pimport-errors' }, errors.slice(0, SHOWN).map((e) => h('li', null, e))),
        errors.length > SHOWN ? h('p', { class: 'subtle prog-small' }, `…і ще ${errors.length - SHOWN}. Виправ перші — решта часто зникає разом із ними.`) : null,
        h('p', { class: 'subtle prog-small' }, 'Виправ файл і спробуй ще раз. Опис полів — у README, розділ «Програми тренувань».')),
      footer: ui.button({ label: 'Зрозуміло', variant: 'primary', onClick: () => dlg.close('button') })
    });
    return dlg;
  }

  function previewDialog(data, fileName) {
    const existing = list().find((p) => p.sourceId === data.sourceId) || null;
    const ss = data.plan.sessions;
    const trainings = ss.filter((s) => !s.rest).length;
    const exs = data.plan.exercises;
    const verified = exs.filter((e) => e.videoUrl && e.videoVerified).length;
    const unverified = exs.filter((e) => e.videoUrl && !e.videoVerified).length;
    const dateIn = ui.dateInput({ value: existing ? existing.startDate : data.startDate, clearable: false, ariaLabel: 'Дата старту' });
    const kind = KINDS[data.kind];
    const body = h('div', { class: 'stack', style: { gap: '14px' } },
      h('div', { class: 'pimport-head' },
        h('span', { class: 'list-row-icon ico-danger' }, CRM.icon(kind.icon, { size: 'sm' })),
        h('div', null,
          h('div', { class: 'setting-title' }, data.title),
          h('div', { class: 'setting-desc' }, `${kind.label} · ${fmt.count(data.durationWeeks, ['тиждень', 'тижні', 'тижнів'])}`))),
      h('div', { class: 'prog-facts' },
        h('span', null, fmt.count(trainings, ['тренування', 'тренування', 'тренувань'])),
        h('span', null, fmt.count(ss.length - trainings, ['день відпочинку', 'дні відпочинку', 'днів відпочинку'])),
        h('span', null, fmt.count(exs.length, ['вправа', 'вправи', 'вправ'])),
        verified || unverified ? h('span', null, `відео: ${verified} перевір.${unverified ? `, ${unverified} — пошук` : ''}`) : null,
        data.plan.rules.length ? h('span', null, fmt.count(data.plan.rules.length, ['правило', 'правила', 'правил'])) : null),
      ui.field({ label: 'Дата старту', input: dateIn, hint: `У файлі: ${fmt.date(data.startDate)}. Інша дата зсуне весь розклад.` }),
      existing ? h('div', { class: 'callout callout-warning' }, CRM.icon('alert'),
        h('span', null, `Програма з таким id ("${data.sourceId}") уже є: «${existing.title}». Її план буде замінено, а записи в журналі й зсуви графіка лишаться.`)) : null);
    const dlg = ui.modal({
      title: existing ? 'Оновити програму' : 'Імпорт програми', body,
      footer: h('div', { class: 'btn-row' },
        ui.button({ label: 'Скасувати', onClick: () => dlg.close('button') }),
        ui.button({ label: existing ? 'Замінити план' : 'Імпортувати', icon: existing ? 'refresh' : 'upload', variant: 'primary', onClick: async () => {
          const rec = await saveImport(data, { startDate: dateIn.dateValue || data.startDate, fileName, existing });
          dlg.close('force');
          ui.toast(existing ? `План «${rec.title}» оновлено` : `Програму «${rec.title}» імпортовано`, { type: 'success' });
          openDay(rec.id, null);
        } }))
    });
    return dlg;
  }

  async function saveImport(data, opts) {
    const o = opts || {};
    const base = {
      sourceId: data.sourceId, title: data.title, kind: data.kind, durationWeeks: data.durationWeeks,
      plan: data.plan, importedAt: new Date().toISOString(), fileName: o.fileName || null
    };
    if (o.existing) {
      return CRM.store.save(STORE, Object.assign({}, o.existing, base, { startDate: o.startDate || o.existing.startDate }));
    }
    return CRM.store.save(STORE, Object.assign(base, { startDate: o.startDate || data.startDate, shifts: [], color: pickColor() }));
  }

  /** Імпорт без вікон (для тестів і майбутніх інструментів): кидає помилку з .errors. */
  async function importProgram(obj, opts) {
    const res = validate(obj);
    if (res.errors.length) { const e = new Error(res.errors[0]); e.errors = res.errors; throw e; }
    const o = opts || {};
    const existing = list().find((p) => p.sourceId === res.data.sourceId) || null;
    return saveImport(res.data, { startDate: o.startDate, fileName: o.fileName, existing });
  }

  // ---------- Тренування за датою (усі програми, разом із «Верх тіла») ----------
  /**
   * [{ key, color, icon, progTitle, weekText, title, detail, rest, done, open(), mark() }]
   * — для тижневого списку, Головної й розкладу.
   */
  function entriesOn(date) {
    const out = [];
    const up = CRM.program && CRM.program.dayInfo ? CRM.program.dayInfo(date) : null;
    if (up) {
      out.push({
        key: CRM.program.PROGRAM_ID, color: CRM.dict.categoryColor(CRM.program.COLOR), icon: 'dumbbell',
        progTitle: CRM.program.NAME, weekText: `тиждень ${up.week} з 12`,
        title: up.title, detail: up.rest ? '' : up.items.join(' · '), rest: up.rest, pause: false, repeat: false, done: up.done,
        open: () => CRM.program.openDay(up.d), mark: () => CRM.program.recordDay(up.d)
      });
    }
    list().forEach((p) => {
      const slot = slotAt(p, date);
      if (slot.type === 'before' || slot.type === 'after') return;
      const s = slot.s;
      const done = s && !s.rest ? doneMap(p).get(doneKey(slot)) || null : null;
      out.push({
        key: p.id, color: colorOf(p), icon: kindOf(p).icon, progTitle: shortTitle(p),
        weekText: `тиждень ${s ? s.week : currentWeek(p, date)} з ${p.durationWeeks}`,
        title: !s ? 'Пауза в графіку' : s.rest ? 'Відпочинок' : `Тиждень ${s.week} · день ${s.day}${slot.repeat ? ' · повтор' : ''}`,
        detail: s && !s.rest ? headline(p, s) : '', rest: !s || s.rest, pause: !s, repeat: slot.repeat, done,
        open: () => openDay(p.id, date), mark: () => markDone(p, date)
      });
    });
    return out;
  }

  // ---------- Навігація ----------
  const selected = new Map(); // id програми → вибрана дата
  /** Відкрити сторінку програми (date — вибраний день; null — сьогодні). */
  function openDay(id, date) {
    if (date) selected.set(id, date); else selected.delete(id);
    CRM.router.go('training/program/' + id);
  }
  function backLink() {
    return h('a', { href: '#/training/programs', class: 'btn btn-ghost btn-sm pback' }, CRM.icon('chevronLeft', { size: 'sm' }), 'Усі програми');
  }

  // ---------- Вкладка «Програми» ----------
  let weekAnchor = null;

  function listView() {
    const progs = list();
    const upSummary = CRM.program && CRM.program.summary ? CRM.program.summary() : null;
    const cards = [];
    if (CRM.program) cards.push(upSummary ? builtinCard(upSummary) : CRM.program.offerCard());
    progs.forEach((p) => cards.push(programCard(p)));
    const importCard = h('section', { class: 'card pcard pcard-import' },
      h('span', { class: 'prog-offer-ico' }, CRM.icon('upload')),
      h('div', { class: 'pcard-import-text' },
        h('div', { class: 'setting-title' }, 'Імпорт програми з JSON'),
        h('div', { class: 'setting-desc' }, 'Сила (підходи й повторення) або біг (дистанція чи інтервали). Файл перевіряється перед імпортом.')),
      importButton({ size: 'sm', label: 'Вибрати файл' }));
    return h('div', { class: 'stack' },
      progs.length || upSummary ? weekCard() : null,
      h('div', { class: 'pcards' }, cards, importCard));
  }

  function progressBar(done, total) {
    const pct = total ? Math.round(done / total * 100) : 0;
    return h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(total), 'aria-valuenow': String(done), 'aria-label': `Виконано ${done} з ${total}` },
      h('div', { class: 'progress-bar', style: { width: pct + '%' } }));
  }

  function cardShell(o) {
    const open = (e) => { if (e.target.closest('a, button')) return; o.onOpen(); };
    return h('section', {
      class: 'card pcard', style: { '--pc': o.color }, role: 'link', tabIndex: 0, 'aria-label': `Відкрити програму «${o.title}»`, dataset: { id: o.id },
      onClick: open, onKeydown: (e) => { if (e.key === 'Enter' && e.target.classList.contains('pcard')) o.onOpen(); }
    },
    h('div', { class: 'pcard-head' },
      h('span', { class: 'pcard-ico' }, CRM.icon(o.icon, { size: 'sm' })),
      h('div', { class: 'pcard-titles' },
        h('div', { class: 'pcard-title' }, o.title),
        h('div', { class: 'pcard-sub subtle' }, o.sub)),
      CRM.icon('chevronRight', { size: 'sm', className: 'subtle' })),
    h('div', { class: 'pcard-status' }, h('strong', null, capital(o.status)), h('span', { class: 'subtle num' }, `Виконано ${o.done} з ${o.total}`)),
    progressBar(o.done, o.total),
    o.today ? h('div', { class: 'pcard-today' }, h('span', { class: 'subtle' }, 'Сьогодні: '), o.today.text, o.today.badge ? h('span', { class: 'badge badge-success' }, o.today.badge) : null) : null);
  }

  function todayLine(entry) {
    if (!entry) return null;
    if (entry.rest) return { text: entry.pause ? 'пауза в графіку' : 'відпочинок' };
    return { text: entry.detail, badge: entry.done ? 'Виконано' : null };
  }

  function programCard(p) {
    const pr = progress(p);
    const T = D.today();
    const entry = entriesOn(T).find((e) => e.key === p.id);
    return cardShell({
      id: p.id, color: colorOf(p), icon: kindOf(p).icon, title: p.title,
      sub: `${kindOf(p).label} · ${fmt.count(p.durationWeeks, ['тиждень', 'тижні', 'тижнів'])} · ${fmt.dateShort(p.startDate)} — ${fmt.dateShort(endOf(p))}`,
      status: statusText(p), done: pr.done, total: pr.total, today: todayLine(entry),
      onOpen: () => openDay(p.id, null)
    });
  }

  function builtinCard(sm) {
    const entry = entriesOn(D.today()).find((e) => e.key === CRM.program.PROGRAM_ID);
    return cardShell({
      id: CRM.program.PROGRAM_ID, color: CRM.dict.categoryColor(CRM.program.COLOR), icon: 'dumbbell', title: sm.name,
      sub: `Вбудована · 12 тижнів · ${fmt.dateShort(sm.startDate)} — ${fmt.dateShort(sm.endDate)}`,
      status: sm.status, done: sm.doneCount, total: sm.total, today: todayLine(entry),
      onOpen: () => CRM.program.openDay(null)
    });
  }

  // ---------- Тиждень: усі програми по днях ----------
  function weekCard() {
    const T = D.today();
    if (!weekAnchor) weekAnchor = T;
    const from = D.startOfWeek(weekAnchor);
    const to = D.endOfWeek(weekAnchor);
    const isCurrent = T >= from && T <= to;
    const shift = (n) => { weekAnchor = D.addDays(weekAnchor, 7 * n); CRM.router.rerender(); };
    const pf = D.parse(from);
    const pt = D.parse(to);
    const label = pf.m === pt.m ? `${pf.d} — ${pt.d} ${CRM.MONTHS_GEN[pt.m - 1]}` : `${pf.d} ${CRM.MONTHS_GEN[pf.m - 1]} — ${pt.d} ${CRM.MONTHS_GEN[pt.m - 1]}`;
    const days = [];
    let any = false;
    for (let i = 0; i < 7; i++) {
      const date = D.addDays(from, i);
      const entries = entriesOn(date);
      if (entries.length) any = true;
      const wd = CRM.WEEKDAYS[D.weekday(date)];
      days.push(h('div', { class: 'pweek-day' + (date === T ? ' today' : ''), dataset: { date } },
        h('div', { class: 'pweek-date' },
          h('span', { class: 'pweek-wd' }, wd.charAt(0).toUpperCase() + wd.slice(1)),
          h('span', { class: 'subtle' }, `${D.parse(date).d} ${CRM.MONTHS_GEN[D.parse(date).m - 1]}`),
          date === T ? h('span', { class: 'badge badge-accent' }, 'сьогодні') : null),
        entries.length
          ? h('div', { class: 'pweek-rows' }, entries.map((e) => weekRow(e, date, T)))
          : h('div', { class: 'pweek-none subtle' }, 'Без програм')));
    }
    return h('section', { class: 'card pweek' },
      h('div', { class: 'card-head' },
        h('h2', null, 'Тренування на тиждень'),
        h('div', { class: 'btn-row' },
          !isCurrent ? ui.button({ label: 'Цей тиждень', size: 'sm', variant: 'ghost', onClick: () => { weekAnchor = T; CRM.router.rerender(); } }) : null,
          h('div', { class: 'month-nav' },
            h('button', { type: 'button', class: 'btn btn-icon btn-sm', 'aria-label': 'Попередній тиждень', onClick: () => shift(-1) }, CRM.icon('chevronLeft', { size: 'sm' })),
            h('span', { class: 'month-title' }, label),
            h('button', { type: 'button', class: 'btn btn-icon btn-sm', 'aria-label': 'Наступний тиждень', onClick: () => shift(1) }, CRM.icon('chevronRight', { size: 'sm' }))))),
      h('div', { class: 'card-body pweek-body' }, any ? days : h('p', { class: 'subtle' }, 'На цей тиждень тренувань за програмами немає.')));
  }

  function weekRow(e, date, T) {
    let badge = null;
    if (!e.rest) {
      if (e.done) badge = h('span', { class: 'badge badge-success' }, 'Виконано');
      else if (date < T) badge = h('span', { class: 'badge badge-warning' }, 'Пропущено');
    }
    return h('button', { type: 'button', class: 'pweek-row' + (e.rest ? ' rest' : ''), style: { '--pc': e.color }, onClick: e.open },
      h('span', { class: 'pweek-dot', 'aria-hidden': 'true' }),
      h('span', { class: 'pweek-main' },
        h('span', { class: 'pweek-top' }, h('span', { class: 'pweek-prog' }, e.progTitle), h('span', { class: 'subtle' }, e.rest ? e.title.toLowerCase() : e.title)),
        e.detail ? h('span', { class: 'pweek-detail' }, e.detail) : null),
      badge);
  }

  // ---------- Сторінка програми ----------
  function pageView(id) {
    if (id === (CRM.program && CRM.program.PROGRAM_ID)) {
      return h('div', { class: 'stack' }, backLink(), CRM.program.card());
    }
    const p = get(id);
    if (!p) {
      const inTrash = !!CRM.store.get(STORE, id);
      return h('div', { class: 'stack' }, backLink(), h('section', { class: 'card' }, ui.empty({
        icon: 'dumbbell', title: inTrash ? 'Програма в Кошику' : 'Програму не знайдено',
        text: inTrash ? 'Віднови її в Кошику, щоб відкрити.' : 'Можливо, її видалено на іншому пристрої.',
        action: { label: inTrash ? 'Відкрити Кошик' : 'До програм', onClick: () => CRM.router.go(inTrash ? 'trash' : 'training/programs') }
      })));
    }
    return h('div', { class: 'stack' }, backLink(), programPage(p));
  }

  function programPage(p) {
    const T = D.today();
    const start = startOf(p);
    const end = endOf(p);
    let sel = selected.get(p.id) || (T < start ? start : T > end ? end : T);
    if (sel < start) sel = start;
    if (sel > end) sel = end;
    selected.set(p.id, sel);
    const done = doneMap(p);
    const pr = progress(p, done);
    const menuBtn = h('button', { type: 'button', class: 'btn btn-ghost btn-icon btn-sm', 'aria-label': 'Дії з програмою', title: 'Дії з програмою', 'aria-haspopup': 'menu' }, CRM.icon('more', { size: 'sm' }));
    menuBtn.addEventListener('click', () => openMenu(menuBtn, p));
    return h('section', { class: 'card prog-card ip-card', style: { '--pc': colorOf(p) }, dataset: { id: p.id } },
      h('div', { class: 'card-head' },
        h('div', { class: 'prog-head' },
          h('h2', null, p.title),
          h('span', { class: 'subtle ip-status' }, `${kindOf(p).label} · ${capital(statusText(p))}`)),
        h('div', { class: 'btn-row' },
          h('span', { class: 'prog-count subtle num' }, `Виконано ${pr.done} з ${pr.total}`),
          menuBtn)),
      h('div', { class: 'card-body prog-body' },
        progressBar(pr.done, pr.total),
        (p.shifts || []).length ? h('div', { class: 'prog-profile' }, CRM.icon('calendar', { size: 'sm' }),
          h('span', null, `Графік зсунуто: ${shiftsText(p)}. Кінець — ${fmt.date(end)}.`),
          h('button', { type: 'button', class: 'link-like', onClick: () => shiftDialog(p) }, 'Змінити')) : null,
        h('div', { class: 'prog-layout' }, dayView(p, sel, done), calendarView(p, sel, done))));
  }

  /** Дата, з якої почався зсув (перший звільнений день). */
  function shiftStart(p, s) {
    const from = Math.min(s.from, p.plan.sessions.length - 1);
    const same = (p.shifts || []).filter((x) => Math.min(x.from, p.plan.sessions.length - 1) === from).reduce((t, x) => t + x.days, 0);
    return D.addDays(dateOfSession(p, from), -same);
  }
  function shiftsText(p) {
    return (p.shifts || []).map((s) => `+${fmt.count(s.days, ['день', 'дні', 'днів'])} з ${fmt.dateShort(shiftStart(p, s))}`).join(', ');
  }

  function videoLink(ex) {
    const search = /youtube\.com\/results/i.test(ex.videoUrl);
    const label = ex.videoVerified ? 'Відео техніки' : search ? 'Пошук відео на YouTube' : 'Відео (не перевірене)';
    return h('a', { href: ex.videoUrl, target: '_blank', rel: 'noopener noreferrer', class: 'prog-video' + (ex.videoVerified ? '' : ' unverified'), title: ex.videoVerified ? null : 'Посилання не перевірене — може відкритися пошук' },
      CRM.icon('external', { size: 'sm' }), label);
  }

  function exBlock(ex, dose, meta) {
    const e = ex || { name: 'Вправа', focus: [], videoUrl: null };
    return h('div', { class: 'prog-ex' },
      h('div', { class: 'prog-ex-head' }, h('span', { class: 'prog-ex-name' }, e.name), dose ? h('span', { class: 'prog-ex-sets num' }, dose) : null),
      meta ? h('div', { class: 'prog-ex-meta' }, meta) : null,
      (e.focus && e.focus.length) || e.videoUrl ? h('div', { class: 'ip-ex-extra' },
        e.focus && e.focus.length ? h('details', { class: 'prog-tips' }, h('summary', null, 'На чому зосередитись'), h('ul', null, e.focus.map((f) => h('li', null, f)))) : null,
        e.videoUrl ? videoLink(e) : null) : null);
  }

  function partBlock(p, key, title) {
    const items = p.plan[key] || [];
    if (!items.length) return null;
    const ex = exMap(p);
    return h('details', { class: 'prog-warm ip-part', dataset: { part: key } },
      h('summary', null, `${title} · ${fmt.count(items.length, ['вправа', 'вправи', 'вправ'])} · ≈${partMinutes(items)} хв`),
      h('div', { class: 'prog-ex-list' }, items.map((it) => exBlock(ex.get(it.exerciseId), partDose(it)))));
  }

  function doneView(w) {
    const met = planMet(w);
    return h('div', { class: 'ip-done' },
      h('div', { class: 'prog-done' },
        h('span', { class: 'badge badge-success' }, CRM.icon('check', { size: 'sm' }), 'Виконано'),
        met === true ? h('span', { class: 'badge' }, 'План виконано') : met === false ? h('span', { class: 'badge badge-warning' }, 'Не весь план') : null,
        h('span', { class: 'subtle' }, `${fmt.dateShort(w.date)}${w.durationMin ? ` · ${w.durationMin} хв` : ''}`),
        ui.button({ label: 'Відкрити запис', size: 'sm', variant: 'ghost', onClick: () => CRM.training.openForm(w.id) })),
      h('div', { class: 'ip-fact subtle' }, 'Факт: ', factText(w) || '—'));
  }

  function dayView(p, date, done) {
    const T = D.today();
    const slot = slotAt(p, date);
    const s = slot.s;
    const start = startOf(p);
    const end = endOf(p);
    const go = (n) => { selected.set(p.id, D.addDays(date, n)); CRM.router.rerender(); };
    const wdName = ['понеділок', 'вівторок', 'середа', 'четвер', 'пʼятниця', 'субота', 'неділя'][D.weekday(date)];
    const parts = [
      h('div', { class: 'prog-nav' },
        h('button', { type: 'button', class: 'btn btn-icon btn-sm', 'aria-label': 'Попередній день програми', disabled: date <= start, onClick: () => go(-1) }, CRM.icon('chevronLeft', { size: 'sm' })),
        h('div', { class: 'prog-date' }, h('span', { class: 'prog-date-main' }, `${fmt.date(date).replace(/ \d{4}$/, '')}, ${wdName}`), date === T ? h('span', { class: 'badge badge-accent' }, 'сьогодні') : null),
        h('button', { type: 'button', class: 'btn btn-icon btn-sm', 'aria-label': 'Наступний день програми', disabled: date >= end, onClick: () => go(1) }, CRM.icon('chevronRight', { size: 'sm' })))
    ];
    const ph = s ? phaseOf(s.phase) : null;
    const titleText = !s ? 'Пауза в графіку' : s.rest ? 'Відпочинок' + (slot.repeat ? ' (повтор)' : '') : `Тиждень ${s.week} · день ${s.day}${slot.repeat ? ' · повтор' : ''}`;
    parts.push(h('h3', { class: 'prog-title' }, h('span', { class: 'prog-dot', style: { '--ph': ph ? CRM.dict.categoryColor(ph.color) : null }, hidden: !s || s.rest }), titleText));
    if (s) {
      const est = estimateMinutes(p, s);
      parts.push(h('div', { class: 'prog-facts' },
        h('span', null, `Тиждень ${s.week} з ${p.durationWeeks}`),
        h('span', null, `Фаза: ${ph.name.toLowerCase()}`),
        est ? h('span', null, `≈${est} хв з розминкою й заминкою`) : null));
    }
    if (slot.repeat) {
      parts.push(h('div', { class: 'callout' }, CRM.icon('info'), h('span', null, s
        ? `Графік зсунуто: цей день — повтор ${s.rest ? 'дня відпочинку' : 'тренування'} ${fmt.dateShort(dateOfSession(p, slot.mirror))} (тиждень ${s.week}, день ${s.day}), як радять правила програми.`
        : 'Графік зсунуто на початку програми — цього дня тренування немає.')));
    }
    if (s && !s.rest) {
      const w = done.get(doneKey(slot));
      if (w) parts.push(doneView(w));
      else if (date > T) parts.push(h('div', { class: 'prog-done subtle' }, `Ще попереду — ${inDays(D.diffDays(T, date))}`));
      else {
        parts.push(ui.button({
          label: date === T ? 'Виконано' : 'Виконано (пропущений день)', icon: 'check', variant: date === T ? 'primary' : null,
          className: 'prog-record ip-mark', onClick: () => markDone(p, date)
        }));
      }
      const ex = exMap(p);
      parts.push(partBlock(p, 'warmup', 'Розминка'));
      parts.push(h('section', { class: 'ip-part ip-main', dataset: { part: 'main' } },
        h('h4', { class: 'ip-part-title' }, 'Основна частина'),
        h('div', { class: 'prog-ex-list' }, s.main.map((m) => exBlock(ex.get(m.exerciseId), mainDose(m), m.restSec ? `Відпочинок між підходами ${secLabel(m.restSec)}.` : null)))));
      parts.push(partBlock(p, 'cooldown', 'Заминка'));
    } else {
      const tl = timeline(p);
      const i0 = D.diffDays(start, date);
      let next = null;
      for (let i = i0 + 1; i < tl.total && !next; i++) {
        const sl = slotAt(p, D.addDays(start, i));
        if (sl.s && !sl.s.rest) next = sl;
      }
      parts.push(h('p', { class: 'subtle prog-small' }, next ? `Наступне тренування: ${fmt.dateShort(next.date)} — ${headline(p, next.s)}.` : 'Далі тренувань за цією програмою немає.'));
    }
    return h('div', { class: 'prog-day ip-day' }, parts);
  }

  function calendarView(p, sel, done) {
    const T = D.today();
    const tl = timeline(p);
    const start = startOf(p);
    const rows = Math.ceil(tl.total / 7);
    const cells = [h('div')];
    for (let k = 0; k < 7; k++) cells.push(h('div', { class: 'prog-wd' }, CRM.WEEKDAYS_SHORT[D.weekday(D.addDays(start, k))]));
    const phases = new Map();
    let gaps = false;
    let lastLabel = '';
    for (let r = 0; r < rows; r++) {
      // Підпис рядка — тиждень програми (після зсуву рядки й тижні можуть не збігатися — тоді без повторів)
      let label = '';
      for (let c = 0; c < 7; c++) {
        const i = r * 7 + c;
        if (i < tl.total && tl.slots[i].type === 'session') { label = `Т${p.plan.sessions[tl.slots[i].k].week}`; break; }
      }
      cells.push(h('div', { class: 'prog-wk' }, label === lastLabel ? '' : label));
      if (label) lastLabel = label;
      for (let c = 0; c < 7; c++) {
        const i = r * 7 + c;
        if (i >= tl.total) { cells.push(h('div')); continue; }
        const date = D.addDays(start, i);
        const slot = slotAt(p, date);
        const s = slot.s;
        const rest = !s || s.rest;
        const isDone = !rest && done.has(doneKey(slot));
        const cls = ['prog-cell'];
        if (rest) cls.push('rest');
        if (slot.repeat) { cls.push('gap'); gaps = true; }
        if (isDone) cls.push('done');
        if (date === T) cls.push('today');
        if (date === sel) cls.push('sel');
        if (!rest && date < T && !isDone) cls.push('missed');
        const ph = s ? phaseOf(s.phase) : null;
        if (s && !s.rest) phases.set(s.phase, ph);
        const pd = D.parse(date);
        cells.push(h('button', {
          type: 'button', class: cls.join(' '),
          style: rest ? null : { '--ph': CRM.dict.categoryColor(ph.color) },
          'aria-label': `${fmt.date(date)}: ${headline(p, s)}${slot.repeat ? ' (повтор)' : ''}${isDone ? ', виконано' : ''}`,
          'aria-pressed': date === sel ? 'true' : 'false',
          onClick: () => { selected.set(p.id, date); CRM.router.rerender(); }
        },
        h('span', { class: 'prog-cell-date' }, `${pd.d}.${String(pd.m).padStart(2, '0')}`),
        h('span', { class: 'prog-cell-code' }, slot.repeat && !rest ? '↻' : cellCode(s)),
        isDone ? h('span', { class: 'prog-cell-check' }, CRM.icon('check', { size: 'sm' })) : null));
      }
    }
    const legend = h('div', { class: 'prog-legend' },
      Array.from(phases.values()).map((ph) => h('span', null, h('i', { style: { '--ph': CRM.dict.categoryColor(ph.color) } }), ph.name)),
      h('span', null, h('i', { class: 'rest' }), 'Відпочинок'),
      gaps ? h('span', null, '↻ повтор (зсув графіка)') : null,
      p.kind === 'running' ? h('span', null, 'Б/Х — біг-ходьба; числа — км') : h('span', null, 'Числа — підходи × повторення першої вправи'));
    return h('div', { class: 'prog-cal' }, h('div', { class: 'prog-grid', role: 'group', 'aria-label': `Календар програми, ${fmt.count(rows, ['тиждень', 'тижні', 'тижнів'])}` }, cells), legend);
  }

  // ---------- Меню програми ----------
  function openMenu(anchor, p) {
    const item = (label, fn, danger) => h('button', { type: 'button', role: 'menuitem', class: 'menu-item' + (danger ? ' danger' : ''), onClick: () => { pop.close(); fn(); } }, label);
    const pop = ui.popover(anchor, h('div', { class: 'menu', role: 'menu' },
      item('Правила програми', () => rulesDialog(p)),
      item('Змінити дату старту', () => startDialog(p)),
      item('Зсунути графік', () => shiftDialog(p)),
      item('Видалити програму', () => removeProgram(p), true)),
    { align: 'end' });
  }

  function rulesDialog(p) {
    const rules = p.plan.rules || [];
    const dlg = ui.modal({
      title: 'Правила програми', size: 'lg',
      body: h('div', { class: 'prog-rules' },
        h('section', { class: 'prog-rule' }, h('h3', null, p.title),
          rules.length ? h('ul', null, rules.map((r) => h('li', null, r))) : h('p', null, 'У файлі програми правил немає.'))),
      footer: ui.button({ label: 'Зрозуміло', variant: 'primary', onClick: () => dlg.close('button') })
    });
  }

  function startDialog(p) {
    const dateIn = ui.dateInput({ value: p.startDate, clearable: false, ariaLabel: 'Дата старту' });
    const dlg = ui.modal({
      title: 'Дата старту програми',
      body: h('div', { class: 'stack', style: { gap: '14px' } },
        ui.field({ label: 'Перший день програми', input: dateIn }),
        h('div', { class: 'callout' }, CRM.icon('info'), h('span', null, 'Увесь розклад зсунеться разом зі стартом. Уже записані тренування лишаються привʼязаними до своїх днів програми (тиждень і день).'))),
      footer: h('div', { class: 'btn-row' },
        ui.button({ label: 'Скасувати', onClick: () => dlg.close('button') }),
        ui.button({ label: 'Зберегти', icon: 'check', variant: 'primary', onClick: async () => {
          const start = dateIn.dateValue || p.startDate;
          await CRM.store.save(STORE, Object.assign({}, get(p.id) || p, { startDate: start }));
          selected.delete(p.id);
          dlg.close('force');
          ui.toast(`Дату старту змінено: ${fmt.date(start)}`, { type: 'success' });
        } }))
    });
  }

  /** Зсув: тренування з дати from і всі наступні — на days днів пізніше. */
  async function addShift(p, fromDate, days) {
    const cur = get(p.id) || p;
    const ss = cur.plan.sessions;
    let slot = slotAt(cur, fromDate);
    let from;
    if (slot.type === 'before') from = 0;
    else if (slot.type === 'after') throw new Error('Ця дата вже після кінця програми.');
    else if (slot.type === 'session') from = slot.k;
    else {
      // Пауза чи повтор — зсуваємо найближче наступне тренування
      let i = D.diffDays(cur.startDate, fromDate);
      const tl = timeline(cur);
      while (i < tl.total && tl.slots[i].type !== 'session') i++;
      if (i >= tl.total) throw new Error('Після цієї дати тренувань у програмі немає.');
      from = tl.slots[i].k;
    }
    if (from >= ss.length) throw new Error('Після цієї дати тренувань у програмі немає.');
    const shifts = (cur.shifts || []).concat([{ id: CRM.utils.uid(), from, days, createdAt: new Date().toISOString() }]);
    return CRM.store.save(STORE, Object.assign({}, cur, { shifts }));
  }
  async function removeShift(p, shiftId) {
    const cur = get(p.id) || p;
    return CRM.store.save(STORE, Object.assign({}, cur, { shifts: (cur.shifts || []).filter((s) => s.id !== shiftId) }));
  }

  function shiftDialog(p) {
    const T = D.today();
    const sel = selected.get(p.id) || T;
    const start = startOf(p);
    const end = endOf(p);
    const def = sel < start ? start : sel > end ? T : sel;
    const dateIn = ui.dateInput({ value: def, clearable: false, ariaLabel: 'Починаючи з' });
    const daysIn = h('input', { class: 'input input-num', type: 'number', min: 1, max: 60, step: 1, value: p.kind === 'strength' ? 14 : 1, 'aria-label': 'На скільки днів' });
    const fDays = ui.field({ label: 'На скільки днів', input: daysIn });
    const fDate = ui.field({ label: 'Починаючи з тренування', input: dateIn });
    const listBox = h('div', { class: 'ip-shifts' });
    function renderList() {
      const cur = get(p.id) || p;
      const shifts = cur.shifts || [];
      ui.mount(listBox, shifts.length ? [h('div', { class: 'field-label' }, 'Уже зсунуто'),
        shifts.map((s) => h('div', { class: 'ip-shift' },
          h('span', null, `+${fmt.count(s.days, ['день', 'дні', 'днів'])} з ${fmt.dateShort(shiftStart(cur, s))} (тренування тижня ${cur.plan.sessions[Math.min(s.from, cur.plan.sessions.length - 1)].week}, дня ${cur.plan.sessions[Math.min(s.from, cur.plan.sessions.length - 1)].day} і далі)`),
          h('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'aria-label': 'Скасувати зсув', onClick: async () => { await removeShift(cur, s.id); renderList(); ui.toast('Зсув скасовано'); } }, CRM.icon('x', { size: 'sm' }), 'Скасувати')))] : null);
    }
    renderList();
    const dlg = ui.modal({
      title: 'Зсунути графік',
      body: h('div', { class: 'stack', style: { gap: '14px' } },
        h('p', { class: 'modal-text' }, 'Тренування з обраної дати й усі наступні перенесуться на N днів пізніше. Дні, що звільнилися, показуються як повтор попередніх тренувань — як радять правила програми (біг: +1 день за повтор учорашньої дистанції; підтягування: +14 днів за повтор блоку).'),
        h('div', { class: 'form-grid' }, fDate, fDays),
        listBox),
      footer: h('div', { class: 'btn-row' },
        ui.button({ label: 'Закрити', onClick: () => dlg.close('button') }),
        ui.button({ label: 'Зсунути', icon: 'calendar', variant: 'primary', onClick: async () => {
          const n = Number(daysIn.value);
          if (!Number.isInteger(n) || n < 1 || n > 60) { fDays.setError('Від 1 до 60 днів'); return; }
          try {
            await addShift(p, dateIn.dateValue || def, n);
          } catch (e) { fDate.setError(e.message); return; }
          dlg.close('force');
          ui.toast(`Графік зсунуто на ${fmt.count(n, ['день', 'дні', 'днів'])}`, { type: 'success' });
        } }))
    });
  }

  async function removeProgram(p) {
    const ok = await ui.confirm({
      title: 'Видалити програму?',
      message: `«${p.title}» потрапить у Кошик (відновити можна протягом 30 днів). Записи в журналі тренувань залишаться.`,
      confirmText: 'Видалити', danger: true
    });
    if (!ok) return;
    const batch = await CRM.store.softDelete(STORE, p.id);
    CRM.router.go('training/programs');
    ui.toast('Програму перенесено в Кошик', { action: { label: 'Скасувати', onClick: () => CRM.store.restoreBatch(batch) } });
  }

  // ---------- Головна: «Сьогоднішнє тренування» ----------
  function homeCard() {
    const T = D.today();
    const progs = list();
    const hasBuiltin = !!(CRM.program && CRM.program.cfg && CRM.program.cfg());
    if (!progs.length && !hasBuiltin) return null;
    const entries = entriesOn(T);
    const soon = progs.filter((p) => T < p.startDate && D.diffDays(T, p.startDate) <= 14);
    if (CRM.program && hasBuiltin && T < CRM.program.cfg().startDate) soon.unshift({ title: CRM.program.NAME, startDate: CRM.program.cfg().startDate, builtin: true });
    if (!entries.length && !soon.length) return null;
    const rows = entries.map((e) => h('div', { class: 'ptoday-row' + (e.rest ? ' rest' : ''), style: { '--pc': e.color } },
      h('span', { class: 'pweek-dot', 'aria-hidden': 'true' }),
      h('div', { class: 'ptoday-main' },
        h('div', { class: 'ptoday-prog subtle' }, `${e.progTitle} · ${e.weekText}`),
        h('button', { type: 'button', class: 'link-like ptoday-title', onClick: e.open }, e.rest ? e.title : e.detail)),
      e.rest ? null : e.done
        ? h('span', { class: 'badge badge-success' }, CRM.icon('check', { size: 'sm' }), 'Виконано')
        : ui.button({ label: 'Виконано', icon: 'check', size: 'sm', variant: 'primary', className: 'ptoday-mark', onClick: e.mark })));
    const soonRows = soon.map((p) => h('div', { class: 'ptoday-row soon' },
      h('span', { class: 'pweek-dot', 'aria-hidden': 'true', style: { '--pc': p.builtin ? CRM.dict.categoryColor(CRM.program.COLOR) : colorOf(p) } }),
      h('div', { class: 'ptoday-main' },
        h('div', { class: 'ptoday-prog subtle' }, p.builtin ? p.title : shortTitle(p)),
        h('span', null, `Старт ${fmt.dateShort(p.startDate)} — ${inDays(D.diffDays(T, p.startDate))}`))));
    return h('section', { class: 'card ptoday-card' },
      h('div', { class: 'card-head' },
        h('h2', null, 'Сьогоднішнє тренування'),
        h('a', { href: '#/training/programs', class: 'btn btn-ghost btn-sm' }, 'Програми', CRM.icon('chevronRight', { size: 'sm' }))),
      h('div', { class: 'card-body ptoday' }, rows, soonRows));
  }

  // ---------- Розклад на Головній (вбудована «Верх тіла» додає свій пункт сама) ----------
  CRM.home.addScheduleSource((date) => {
    const out = [];
    list().forEach((p) => {
      const slot = slotAt(p, date);
      if (!slot.s || slot.s.rest) return;
      const w = doneMap(p).get(doneKey(slot));
      out.push({
        time: null, kind: 'training', icon: kindOf(p).icon, cls: 'ico-danger',
        title: (slot.repeat ? 'Повтор: ' : '') + headline(p, slot.s),
        sub: `Програма «${shortTitle(p)}» · тиждень ${slot.s.week} з ${p.durationWeeks}`,
        badge: w ? { text: 'Виконано', cls: 'badge-success' } : null,
        onClick: () => openDay(p.id, date)
      });
    });
    return out;
  });

  CRM.programs = {
    SCHEMA_VERSION, validate, jsonErrorText, importProgram, importFile, importButton,
    list, get, timeline, slotAt, dateOfSession, endOf, doneMap, progress, statusText, currentWeek,
    headline, presetFor, markDone, planMet, addShift, removeShift, entriesOn, openDay, badgeText, shortTitle,
    listView, pageView, homeCard
  };
})(window.CRM);
