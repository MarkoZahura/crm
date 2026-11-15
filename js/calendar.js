/* ==========================================================================
   calendar.js — розділ «Календар».
   • Перегляди: «День», «3 дні», «Тиждень» (годинна сітка) і «Місяць».
   • Власні події (сховище events): швидке додавання кліком по вільному часу,
     форма з усіма полями, перетягування (мишкою; на телефоні — довгим натисканням),
     зміна тривалості за нижній край, крок 15 хв, «Скасувати».
   • Показує також події Google Календаря (лише читання, gcal.js), тренування з
     програм, регулярні платежі й дедлайни задач — кожне вмикається в «Показати».
   • Нагадування про власні події — поки сайт відкритий (як і решта нагадувань).
   • Задачі в плані (етап 2): ті самі задачі з «Задач» із полем planDate. Без часу —
     у «Плані дня» (порядок перетягуванням), з часом (planStart, planDur) — у годинній
     сітці. Галочка — виконати без підтвердження (є «Скасувати»). Невиконані з минулих
     днів — плашка «Перенести на сьогодні» (лише за командою, без автоматики).

   • Повтори (етап 3): серія — один запис із правилом repeat; окремий день серії можна
     перенести чи змінити «лише цей» (overrides) або скасувати (skip). Перетягування
     переносить лише цей день; у формі — «Лише цю / Цю й наступні / Усі події серії».

   • Дрібні доробки: «Дублювати» / «Копіювати на…» у формі й Ctrl+перетягування (копія замість
     переносу); свої категорії (налаштування calCategories — назва, колір, нові, видалення з
     перенесенням подій); події «на кілька днів» (endDate, лише «весь день» і без повторів);
     «Перейти до дати» (клік на назві періоду), номер тижня; фільтр за категоріями в «Показати»
     і «Пошук подій».

   • Шар «Дедлайни навчання» (дрібні доробки, етап 5): дедлайни тем і курсів «Навчання»
     (CRM.learning.calendarItems) — колір курсу, вивчені теми закреслені; галочка — тема
     вивчена (setTopicDone), перетягування на інший день — новий дедлайн (moveDeadline),
     клік — курс із розгорнутою темою.

   • Шар «Проєкти» (пункт 9, етап 2): дедлайни етапів активних проєктів і власний дедлайн проєкту (◆)
     (CRM.projects.calendarItems) — колір проєкту, готові етапи закреслені, прострочені — червоні;
     галочка — етап готовий (setStageDone), перетягування — новий дедлайн (moveStageEnd з питанням
     «Зсунути наступні етапи?» / moveDeadline), клік — проєкт з розгорнутим етапом.

   Подія: { id, title, date: 'РРРР-ММ-ДД', endDate?: 'РРРР-ММ-ДД' (остання дата, якщо на кілька днів) | null,
            allDay, start: 'ГГ:ХХ' | null, dur: хвилини | null,
            cat: id категорії, remind: хвилини до початку | null, note,
            repeat?: { freq: 'day'|'week'|'month'|'year', every: 1–99, days: [0–6] (лише week; 0 — пн),
                       until: 'РРРР-ММ-ДД' | null, count: 1–999 | null } | null,
            skip?: ['РРРР-ММ-ДД' — скасовані дні серії (початкові дати)],
            overrides?: { 'РРРР-ММ-ДД' (початкова дата): { date?, allDay?, start?, dur?, title?, cat?, remind?, note? } } }
   Для серії date — день, від якого рахуються повтори. Щомісячна подія на 29–31 число в коротшому
   місяці — в останній день місяця (як регулярні платежі).
   Подія не виходить за межі доби (найпізніше — до 24:00).
   Адреса: #/calendar?view=day|3days|week|month&date=РРРР-МM-ДД[&open=<id події>[&occ=<початкова дата повтору>]]
   ========================================================================== */
window.CRM = window.CRM || {};

(function (CRM) {
  'use strict';

  const { h, ui } = { h: CRM.ui.h, ui: CRM.ui };
  const D = CRM.date;
  const fmt = CRM.fmt;
  const pad = D.pad;

  const HOUR = 48;          // висота години в сітці, px
  const SNAP = 15;          // крок часу, хв
  const DAY_MIN = 1440;
  const MIN_VIS = 20;       // найменша «видима» тривалість для розкладки, хв
  const LONG_PRESS = 380;   // мс — довге натискання на телефоні
  const MAX_CHIPS = 3;      // скільки пунктів «на весь день» показувати в клітинці
  const TASK_DUR = 30;      // тривалість задачі в сітці, якщо не змінювали, хв
  const TASK_COLOR = 'var(--accent)';

  const VIEWS = [
    { id: 'day', label: 'День', days: 1 },
    { id: '3days', label: '3 дні', days: 3 },
    { id: 'week', label: 'Тиждень', days: 7 },
    { id: 'month', label: 'Місяць' }
  ];

  // Стартові категорії. Свої (назва, колір, нові, видалені) — у налаштуванні calCategories (синхронізується).
  const DEFAULT_CATEGORIES = [
    { id: 'personal', label: 'Особисте', color: 'blue' },
    { id: 'work', label: 'Робота', color: 'orange' },
    { id: 'study', label: 'Навчання', color: 'violet' },
    { id: 'health', label: 'Спорт і здоровʼя', color: 'green' },
    { id: 'meeting', label: 'Зустрічі', color: 'magenta' },
    { id: 'other', label: 'Інше', color: 'slate' }
  ];
  const OTHER = 'other';      // «Інше» видалити не можна — сюди потрапляють події з невідомою категорією
  const CAT_MAX = 30;         // довжина назви категорії
  const CATS_MAX = 30;        // скільки категорій можна мати
  const MAX_SPAN = 366;       // найдовша подія «на кілька днів», днів

  const REMINDERS = [
    { v: null, label: 'Без нагадування' },
    { v: 0, label: 'У момент початку' },
    { v: 5, label: 'За 5 хв' },
    { v: 10, label: 'За 10 хв' },
    { v: 15, label: 'За 15 хв' },
    { v: 30, label: 'За 30 хв' },
    { v: 60, label: 'За 1 год' },
    { v: 120, label: 'За 2 год' },
    { v: 1440, label: 'За 1 день' }
  ];

  const LAYERS = [
    { id: 'own', label: 'Мої події' },
    { id: 'tasks', label: 'Задачі в плані' },
    { id: 'people', label: 'Дні народження й дати' },
    { id: 'gcal', label: 'Google Календар' },
    { id: 'training', label: 'Тренування з програм' },
    { id: 'payments', label: 'Регулярні платежі' },
    { id: 'deadlines', label: 'Дедлайни задач' },
    { id: 'learning', label: 'Дедлайни навчання' },
    { id: 'projects', label: 'Проєкти' }
  ];
  const KIND_ORDER = { own: 0, people: 1, task: 2, gcal: 3, training: 4, payment: 5, deadline: 6, learning: 7, project: 8 };

  // ---------- Налаштування вигляду (лише в цьому браузері) ----------
  function lsGet(key, def) { try { const v = localStorage.getItem(key); return v == null ? def : v; } catch (e) { return def; } }
  function lsSet(key, v) { try { localStorage.setItem(key, v); } catch (e) { /* не критично */ } }

  function isNarrow() { return !!(window.matchMedia && window.matchMedia('(max-width: 700px)').matches); }
  function defaultView() {
    const v = lsGet('crm.cal.view', '');
    if (VIEWS.some((x) => x.id === v)) return v;
    return isNarrow() ? 'day' : 'week';
  }
  function layers() {
    let saved = {};
    try { saved = JSON.parse(lsGet('crm.cal.layers', '{}')) || {}; } catch (e) { saved = {}; }
    const out = {};
    LAYERS.forEach((l) => { out[l.id] = saved[l.id] !== false; });
    return out;
  }
  function setLayer(id, on) {
    const cur = layers();
    cur[id] = on;
    lsSet('crm.cal.layers', JSON.stringify(cur));
  }
  function lastCat() {
    const c = lsGet('crm.cal.cat', 'personal');
    const list = categories();
    return list.some((x) => x.id === c) ? c : list[0].id;
  }
  /** Категорії, приховані фільтром у «Показати» (лише в цьому браузері). */
  function hiddenCats() {
    try { const v = JSON.parse(lsGet('crm.cal.hiddenCats', '[]')); return new Set(Array.isArray(v) ? v.filter((x) => typeof x === 'string') : []); } catch (e) { return new Set(); }
  }
  function setHiddenCat(id, hidden) {
    const s = hiddenCats();
    if (hidden) s.add(id); else s.delete(id);
    lsSet('crm.cal.hiddenCats', JSON.stringify(Array.from(s)));
  }
  /** Що додає швидке вікно: 'event' чи 'task' (запамʼятовується). */
  function lastKind() { return lsGet('crm.cal.kind', 'event') === 'task' ? 'task' : 'event'; }

  // ---------- Час ----------
  function toMin(s) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(s || '').trim());
    if (!m) return null;
    const v = Number(m[1]) * 60 + Number(m[2]);
    return Number(m[2]) < 60 && v <= DAY_MIN ? v : null;
  }
  function fromMin(v) { return pad(Math.floor(v / 60)) + ':' + pad(v % 60); }
  const snap = (v) => Math.round(v / SNAP) * SNAP;
  const clamp = CRM.utils.clamp;
  const px = (min, block) => Math.max(block ? 16 : 0, min / 60 * HOUR - (block ? 2 : 0)) + 'px';
  function nowMin() { const p = D.kyivParts(); return p.hh * 60 + p.mm; }
  function minuteOf(iso) { const p = D.kyivParts(new Date(iso)); return p.hh * 60 + p.mm; }

  /** Момент (мс) для дати й хвилин доби за Києвом. */
  function kyivMs(date, min) {
    const p0 = D.parse(date);
    const target = Date.UTC(p0.y, p0.m - 1, p0.d, Math.floor(min / 60), min % 60);
    let t = target;
    for (let i = 0; i < 2; i++) {
      const p = D.kyivParts(new Date(t));
      t += target - Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss);
    }
    return t;
  }

  function durText(min) {
    const hh = Math.floor(min / 60);
    const mm = min % 60;
    if (!hh) return `${mm} хв`;
    return mm ? `${hh} год ${mm} хв` : `${hh} год`;
  }
  function dayShort(d) { return `${CRM.WEEKDAYS_SHORT[D.weekday(d)]}, ${fmt.dateShort(d)}`; }
  function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  // ---------- Категорії ----------
  let catsCache = { raw: undefined, list: null };
  const GCOLOR_RE = /^(?:[1-9]|1[01])$/;   // кольори подій Google: id 1–11
  /** Чинний список категорій: [{ id, label, color, gcolor }]; «Інше» є завжди. gcolor — колір копій у Google (id 1–11) або null («Авто»). */
  function categories() {
    const raw = CRM.store.getSetting('calCategories', null);
    if (catsCache.list && catsCache.raw === raw) return catsCache.list;
    const seen = new Set();
    let list = (Array.isArray(raw) ? raw : []).filter((c) => c && typeof c.id === 'string' && c.id && !seen.has(c.id) && seen.add(c.id))
      .map((c) => ({
        id: c.id,
        label: String(c.label || '').replace(/\s+/g, ' ').trim().slice(0, CAT_MAX) || 'Без назви',
        color: CRM.dict.get('categoryColors', c.color) ? c.color : 'slate',
        gcolor: GCOLOR_RE.test(String(c.gcolor || '')) ? String(c.gcolor) : null
      }));
    if (!list.length) list = DEFAULT_CATEGORIES.map((c) => Object.assign({}, c));
    if (!list.some((c) => c.id === OTHER)) list.push(Object.assign({}, DEFAULT_CATEGORIES[DEFAULT_CATEGORIES.length - 1]));
    catsCache = { raw, list };
    return list;
  }
  function categoryOf(id) {
    const list = categories();
    return list.find((c) => c.id === id) || list.find((c) => c.id === OTHER);
  }
  function categoryName(id) { return categoryOf(id).label; }
  function catColor(id) { return CRM.dict.categoryColor(categoryOf(id).color); }
  async function saveCategories(list) {
    await CRM.store.setSetting('calCategories', list.map((c) => {
      const o = { id: c.id, label: c.label, color: c.color };
      if (c.gcolor && GCOLOR_RE.test(String(c.gcolor))) o.gcolor = String(c.gcolor);
      return o;
    }));
  }

  // ---------- Події ----------
  function evStart(ev) { return toMin(ev.start) || 0; }
  function evEnd(ev) { return Math.min(DAY_MIN, evStart(ev) + (Number(ev.dur) > 0 ? Number(ev.dur) : 60)); }
  /** Остання дата події «на кілька днів» (лише «весь день» і без повторів) або null. */
  function spanEnd(ev) {
    if (!ev || !ev.allDay || ev.repeat || !D.isDate(ev.date) || !D.isDate(ev.endDate) || ev.endDate <= ev.date) return null;
    return D.diffDays(ev.date, ev.endDate) < MAX_SPAN ? ev.endDate : D.addDays(ev.date, MAX_SPAN - 1);
  }
  /** «3–10 листопада» — проміжок дат події на кілька днів. */
  function spanText(a, b) {
    const pa = D.parse(a);
    const pb = D.parse(b);
    if (pa.y === pb.y && pa.m === pb.m) return `${pa.d}–${pb.d} ${CRM.MONTHS_GEN[pb.m - 1]}`;
    if (pa.y === pb.y) return `${pa.d} ${CRM.MONTHS_GEN[pa.m - 1]} – ${pb.d} ${CRM.MONTHS_GEN[pb.m - 1]}`;
    return `${fmt.date(a)} – ${fmt.date(b)}`;
  }
  function daysWord(n) { return fmt.count(n, ['день', 'дні', 'днів']); }
  /** «весь день», «10:00–11:30» або «3–10 листопада (8 днів)». */
  function whenText(ev) {
    const end = spanEnd(ev);
    if (end) return `${spanText(ev.date, end)} (${daysWord(D.diffDays(ev.date, end) + 1)})`;
    if (!ev || ev.allDay || !ev.start) return 'весь день';
    return `${ev.start}–${fromMin(evEnd(ev))}`;
  }

  // ---------- Повтори ----------
  const FREQS = ['day', 'week', 'month', 'year'];
  const WEEKDAYS_ACC = ['понеділок', 'вівторок', 'середу', 'четвер', 'пʼятницю', 'суботу', 'неділю'];
  const UNIT_FORMS = {
    day: ['день', 'дні', 'днів'], week: ['тиждень', 'тижні', 'тижнів'],
    month: ['місяць', 'місяці', 'місяців'], year: ['рік', 'роки', 'років']
  };
  const MAX_EVERY = 99;
  const MAX_COUNT = 999;
  const FAR = '9999-12-31';
  const TIME_F = ['allDay', 'start', 'dur'];
  const TEXT_F = ['title', 'cat', 'remind', 'note'];
  const plural = (n, forms) => fmt.plural(n, forms);

  function isSeries(ev) { return !!(ev && ev.repeat && FREQS.includes(ev.repeat.freq) && D.isDate(ev.date)); }

  /** Правило повтору в чистому вигляді (однаковий порядок полів — щоб порівнювати рядком) або null. */
  function normRule(r, date) {
    if (!r || !FREQS.includes(r.freq)) return null;
    const out = { freq: r.freq, every: clamp(Math.round(Number(r.every) || 1), 1, MAX_EVERY), days: null, until: null, count: null };
    if (r.freq === 'week') {
      const days = Array.from(new Set((Array.isArray(r.days) ? r.days : []).map(Number)))
        .filter((d) => Number.isInteger(d) && d >= 0 && d <= 6).sort((a, b) => a - b);
      out.days = days.length ? days : [D.isDate(date) ? D.weekday(date) : 0];
    }
    if (D.isDate(r.until)) out.until = r.until;
    else if (Number(r.count) > 0) out.count = clamp(Math.round(Number(r.count)), 1, MAX_COUNT);
    return out;
  }
  function ruleOf(ev) { return isSeries(ev) ? normRule(ev.repeat, ev.date) : null; }
  const sameRule = (a, b) => JSON.stringify(a || null) === JSON.stringify(b || null);
  function shiftDays(days, delta) {
    return Array.from(new Set(days.map((d) => (((d + delta) % 7) + 7) % 7))).sort((a, b) => a - b);
  }

  /** Дати за правилом, починаючи від start, що потрапляють у [from, to]; limit — не більше стількох. */
  function ruleDates(start, rule, from, to, limit) {
    const out = [];
    const max = limit || Infinity;
    if (from < start) from = start;
    if (from > to) return out;
    const N = rule.every;
    let guard = 0;
    const push = (d) => { if (d >= from && d <= to) out.push(d); return out.length >= max; };
    if (rule.freq === 'day') {
      for (let k = Math.max(0, Math.ceil(D.diffDays(start, from) / N)); guard++ < 50000; k++) {
        const d = D.addDays(start, k * N);
        if (d > to || push(d)) break;
      }
      return out;
    }
    if (rule.freq === 'week') {
      const w0 = D.startOfWeek(start);
      let i = Math.floor(D.diffDays(w0, D.startOfWeek(from)) / 7);
      i -= i % N;
      for (; guard++ < 20000; i += N) {
        const ws = D.addDays(w0, i * 7);
        if (ws > to) break;
        for (const wd of rule.days) {
          const d = D.addDays(ws, wd);
          if (d < start) continue;
          if (d > to) return out;
          if (push(d)) return out;
        }
      }
      return out;
    }
    // Щомісяця / щороку: те саме число (у коротшому місяці — останній день)
    const ps = D.parse(start);
    const pf = D.parse(from);
    const step = rule.freq === 'year' ? 12 * N : N;
    const diffM = (pf.y * 12 + pf.m) - (ps.y * 12 + ps.m);
    for (let k = Math.max(0, Math.floor(diffM / step) - 1); guard++ < 20000; k++) {
      const d = D.addMonths(start, k * step, ps.d);
      if (d > to || push(d)) break;
    }
    return out;
  }

  // Останній день серії «після N разів» рахується від початку — запамʼятовуємо
  const countCache = new Map();
  function lastByCount(ev, rule) {
    const key = [ev.id, ev.updatedAt, ev.date, JSON.stringify(rule)].join('|');
    if (countCache.has(key)) return countCache.get(key);
    const list = ruleDates(ev.date, rule, ev.date, FAR, rule.count);
    const last = list.length ? list[list.length - 1] : null;
    if (countCache.size > 300) countCache.clear();
    countCache.set(key, last);
    return last;
  }
  /** Початкові дати повторів серії в [from, to] (скасовані й перенесені — теж). */
  function seriesDates(ev, from, to) {
    const rule = ruleOf(ev);
    if (!rule) return [];
    let end = to;
    if (rule.until && rule.until < end) end = rule.until;
    if (rule.count) {
      const last = lastByCount(ev, rule);
      if (!last) return [];
      if (last < end) end = last;
    }
    return ruleDates(ev.date, rule, from, end);
  }
  function isOccurrence(ev, d) { return D.isDate(d) && seriesDates(ev, d, d).length === 1; }
  /** Перший день серії за правилом (дата серії може не збігатися з днем тижня з правила). */
  function seriesFirst(ev) {
    const rule = ruleOf(ev);
    return rule ? ruleDates(ev.date, rule, ev.date, FAR, 1)[0] || null : null;
  }
  function skipped(ev, d) { return Array.isArray(ev.skip) && ev.skip.includes(d); }

  /** Як виглядає повтор серії, що за правилом припадає на день orig (з урахуванням змін «лише цього»). */
  function instanceOf(ev, orig) {
    const o = (ev.overrides && ev.overrides[orig]) || {};
    const inst = Object.assign({}, ev);
    TIME_F.concat(TEXT_F).forEach((f) => { if (o[f] !== undefined) inst[f] = o[f]; });
    inst.date = D.isDate(o.date) ? o.date : orig;
    inst.occ = orig;
    delete inst.overrides;
    delete inst.skip;
    return inst;
  }

  /** Повтори однієї серії, що показуються в [from, to]: [{ ev: повтор, date, series }]. */
  function seriesInstances(e, from, to) {
    const out = [];
    const ov = e.overrides || {};
    seriesDates(e, from, to).forEach((d) => {
      if (skipped(e, d)) return;
      const o = ov[d];
      if (o && D.isDate(o.date) && o.date !== d) return; // перенесено на інший день — нижче
      out.push({ ev: instanceOf(e, d), date: d, series: e });
    });
    Object.keys(ov).forEach((orig) => {
      const o = ov[orig];
      if (!o || !D.isDate(o.date) || o.date === orig || o.date < from || o.date > to) return;
      if (skipped(e, orig) || !isOccurrence(e, orig)) return;
      out.push({ ev: instanceOf(e, orig), date: o.date, series: e });
    });
    return out;
  }

  /**
   * Власні події (і повтори серій), що припадають на [from, to]: [{ ev, date, series?, span? }].
   * Подія на кілька днів — окремий пункт на кожен день: span = { first, last, day: 1…, days }.
   */
  function occurrences(from, to) {
    const out = [];
    CRM.store.list('events').forEach((e) => {
      if (!D.isDate(e.date)) return;
      if (isSeries(e)) { seriesInstances(e, from, to).forEach((x) => out.push(x)); return; }
      const end = spanEnd(e);
      if (end) {
        if (end < from || e.date > to) return;
        const days = D.diffDays(e.date, end) + 1;
        for (let d = e.date < from ? from : e.date; d <= end && d <= to; d = D.addDays(d, 1)) {
          out.push({ ev: e, date: d, span: { first: e.date, last: end, day: D.diffDays(e.date, d) + 1, days } });
        }
        return;
      }
      if (e.date >= from && e.date <= to) out.push({ ev: e, date: e.date });
    });
    return out;
  }

  const byWhen = (a, b) => a.date.localeCompare(b.date) || (a.ev.allDay ? -1 : 0) - (b.ev.allDay ? -1 : 0) ||
    String(a.ev.start || '').localeCompare(String(b.ev.start || ''));
  /** Найближчий повтор не раніше за from (або останній, якщо серія вже скінчилась): { date, occ } | null. */
  function nextOccurrence(ev, from) {
    if (!isSeries(ev)) return null;
    const f = from || D.today();
    const next = seriesInstances(ev, f, D.addDays(f, 800)).sort(byWhen)[0];
    if (next) return { date: next.date, occ: next.ev.occ };
    const past = seriesInstances(ev, ev.date, D.addDays(f, -1)).sort(byWhen);
    const last = past[past.length - 1];
    return last ? { date: last.date, occ: last.ev.occ } : null;
  }
  /** Повтор серії, що показується в день date (або null). */
  function occOn(ev, date) {
    const x = D.isDate(date) ? seriesInstances(ev, date, date).sort(byWhen)[0] : null;
    return x ? x.ev.occ : null;
  }

  /** «щотижня у середу, до 20 грудня 2026» — опис правила (з малої літери). */
  function ruleText(rule, base) {
    if (!rule) return '';
    const N = rule.every;
    const every = (unit) => `кожні ${N} ${plural(N, UNIT_FORMS[unit])}`;
    let s;
    if (rule.freq === 'day') s = N === 1 ? 'щодня' : every('day');
    else if (rule.freq === 'week') {
      const k = rule.days.join(',');
      const names = rule.days.map((d) => CRM.WEEKDAYS_SHORT[d].toLowerCase()).join(', ');
      if (N === 1 && k === '0,1,2,3,4') s = 'щобудня (пн–пт)';
      else if (N === 1 && rule.days.length === 7) s = 'щодня';
      else if (rule.days.length === 1) s = (N === 1 ? 'щотижня' : every('week')) + ' у ' + WEEKDAYS_ACC[rule.days[0]];
      else s = (N === 1 ? 'щотижня' : every('week')) + ': ' + names;
    } else {
      const p = D.parse(base);
      if (rule.freq === 'month') s = (N === 1 ? 'щомісяця' : every('month')) + `, ${p.d} числа`;
      else s = (N === 1 ? 'щороку' : every('year')) + `, ${p.d} ${CRM.MONTHS_GEN[p.m - 1]}`;
    }
    if (rule.until) s += `, до ${fmt.date(rule.until)}`;
    else if (rule.count) s += `, ${rule.count} ${plural(rule.count, ['раз', 'рази', 'разів'])}`;
    return s;
  }
  /** «Щотижня у середу» — для пошуку, Кошика, підказок; '' — не повторюється. */
  function repeatText(ev) { return isSeries(ev) ? capitalize(ruleText(ruleOf(ev), ev.date)) : ''; }

  // ---------- Задачі в плані ----------
  /** Час задачі в сітці (хв від 00:00) або null — задача «без часу». */
  function taskStart(t) {
    const s = toMin(t.planStart);
    return s == null ? null : Math.min(s, DAY_MIN - SNAP);
  }
  function taskDur(t) { return Number(t.planDur) > 0 ? Number(t.planDur) : TASK_DUR; }
  function taskEnd(t) { return Math.min(DAY_MIN, taskStart(t) + taskDur(t)); }
  function byPlanOrder(a, b) {
    const oa = typeof a.planOrder === 'number' ? a.planOrder : Infinity;
    const ob = typeof b.planOrder === 'number' ? b.planOrder : Infinity;
    return (oa - ob) || (a.createdAt || '').localeCompare(b.createdAt || '');
  }
  /** Задачі в плані: шар увімкнено й tasks.js свіжий (при неповному оновленні сайту — без них). */
  function tasksOn(L) { return !!(L.tasks && CRM.tasks && CRM.tasks.create); }
  /** Задачі (і виконані теж), заплановані на дні [from, to]. */
  function plannedTasks(from, to) {
    return CRM.store.list('tasks').filter((t) => D.isDate(t.planDate) && t.planDate >= from && t.planDate <= to);
  }
  /** Задачі без часу на день — у порядку «Плану дня». */
  function untimedOn(date) {
    return plannedTasks(date, date).filter((t) => taskStart(t) == null).sort(byPlanOrder);
  }
  /** Невиконані задачі, заплановані на минулі дні. */
  function overdueTasks() {
    const T = D.today();
    return CRM.store.list('tasks').filter((t) => !t.done && D.isDate(t.planDate) && t.planDate < T)
      .sort((a, b) => a.planDate.localeCompare(b.planDate) || byPlanOrder(a, b));
  }
  function deadlineNote(t, date) {
    if (!t.deadline || t.deadline !== date) return '';
    return 'дедлайн' + (t.deadlineTime ? ' о ' + t.deadlineTime : ' цього дня');
  }

  // ---------- Проміжок для перегляду ----------
  function rangeOf(view, anchor) {
    if (view === 'month') {
      const ms = D.startOfMonth(anchor);
      const start = D.startOfWeek(ms);
      const p = D.parse(ms);
      const rows = Math.ceil((D.weekday(ms) + D.daysInMonth(p.y, p.m)) / 7);
      const days = [];
      for (let i = 0; i < rows * 7; i++) days.push(D.addDays(start, i));
      return { from: start, to: days[days.length - 1], days, monthStart: ms };
    }
    const from = view === 'week' ? D.startOfWeek(anchor) : anchor;
    const n = (VIEWS.find((v) => v.id === view) || VIEWS[0]).days;
    const days = [];
    for (let i = 0; i < n; i++) days.push(D.addDays(from, i));
    return { from, to: days[days.length - 1], days };
  }
  function stepDate(view, anchor, dir) {
    if (view === 'month') return D.addMonths(anchor, dir);
    if (view === 'week') return D.addDays(anchor, 7 * dir);
    if (view === '3days') return D.addDays(anchor, 3 * dir);
    return D.addDays(anchor, dir);
  }
  function rangeText(a, b) {
    const pa = D.parse(a);
    const pb = D.parse(b);
    if (a === b) return capitalize(fmt.dateLong(a));
    if (pa.y === pb.y && pa.m === pb.m) return `${pa.d}–${pb.d} ${CRM.MONTHS_GEN[pb.m - 1]} ${pb.y}`;
    if (pa.y === pb.y) return `${pa.d} ${CRM.MONTHS_GEN[pa.m - 1]} – ${pb.d} ${CRM.MONTHS_GEN[pb.m - 1]} ${pb.y}`;
    return `${fmt.date(a)} – ${fmt.date(b)}`;
  }
  function go(view, date, extra) {
    CRM.router.go('calendar', Object.assign({ view, date }, extra || {}));
  }

  // ---------- Збір усього, що показуємо ----------
  /** { 'РРРР-ММ-ДД': { allDay: [пункти], timed: [пункти] } } */
  function collect(from, to) {
    const L = layers();
    const days = [];
    for (let d = from; d <= to; d = D.addDays(d, 1)) days.push(d);
    const byDay = new Map(days.map((d) => [d, { allDay: [], timed: [] }]));
    const put = (d, kind, it) => { const b = byDay.get(d); if (b) b[kind].push(it); };
    const T = D.today();
    const nm = nowMin();

    if (L.own) {
      const hidden = hiddenCats();
      occurrences(from, to).forEach(({ ev, date, series, span }) => {
        if (hidden.size && hidden.has(categoryOf(ev.cat).id)) return;
        const it = {
          key: 'own:' + ev.id + ':' + (ev.occ || date), kind: 'own', title: ev.title || 'Без назви',
          color: (ev.studentId && CRM.tutor && CRM.tutor.colorOfEvent(ev)) || catColor(ev.cat), lesson: !!(ev.studentId && CRM.tutor && CRM.tutor.get(ev.studentId)),
          icon: 'calendar', ev, date, editable: true, series: !!series, rep: series ? repeatText(series) : ''
        };
        if (span) {
          it.span = span;
          it.sub = `день ${span.day} з ${span.days} · ${categoryName(ev.cat)}`;
          it.rep = spanText(span.first, span.last);
          put(date, 'allDay', it);
        } else if (ev.allDay || !ev.start) {
          put(date, 'allDay', Object.assign(it, { sub: categoryName(ev.cat) }));
        } else {
          it.startMin = evStart(ev);
          it.endMin = evEnd(ev);
          it.sub = whenText(ev);
          it.past = date < T || (date === T && it.endMin <= nm);
          put(date, 'timed', it);
        }
      });
    }

    if (tasksOn(L)) {
      plannedTasks(from, to).sort(byPlanOrder).forEach((t, i) => {
        const d = t.planDate;
        const dl = deadlineNote(t, d);
        const it = {
          key: 'task:' + t.id, kind: 'task', title: t.title || 'Без назви', color: TASK_COLOR, icon: 'tasks',
          task: t, date: d, done: !!t.done, overdue: !t.done && d < T, editable: true, order: i
        };
        const s = taskStart(t);
        if (s == null) {
          it.sub = ['Задача', dl].filter(Boolean).join(' · ');
          put(d, 'allDay', it);
        } else {
          it.startMin = s;
          it.endMin = taskEnd(t);
          it.sub = [`${fromMin(it.startMin)}–${fromMin(it.endMin)}`, dl].filter(Boolean).join(' · ');
          it.past = d < T || (d === T && it.endMin <= nm);
          put(d, 'timed', it);
        }
      });
    }

    // Дні народження й важливі дати людей (js/people.js) — щороку, на весь день
    if (L.people && CRM.people && CRM.people.datesBetween) {
      const pColor = CRM.dict.categoryColor('magenta');
      let ppl = [];
      try { ppl = CRM.people.datesBetween(from, to); } catch (e) { console.error(e); }
      ppl.forEach((x) => {
        put(x.date, 'allDay', {
          key: 'ppl:' + x.key, kind: 'people', title: x.kind === 'birthday' ? x.person.name : `${x.person.name} — ${x.ann.title}`,
          sub: [x.kind === 'birthday' ? 'День народження' : x.ann.title, x.yearsText].filter(Boolean).join(' · '),
          color: pColor, icon: x.kind === 'birthday' ? 'cake' : 'users', date: x.date, onOpen: () => CRM.people.openPerson(x.personId)
        });
      });
    }

    if (L.gcal && CRM.gcal && CRM.gcal.eventsBetween) {
      // Колір — як у Google: свій колір події або колір календаря (з 2026.11.15-5)
      // «Заняття Макс» з Google, коли того дня є урок Макса в CRM, — не показуємо (без дублів; tutor.js)
      const dupIdx = CRM.tutor && CRM.tutor.dupIndex ? CRM.tutor.dupIndex(from, to) : null;
      CRM.gcal.eventsBetween(from, to).forEach((g) => {
        // Змінювати з CRM можна події з календарів, де є право запису (пункт 12)
        const drag = CRM.gcal.editInfo ? CRM.gcal.editInfo(g).drag : false;
        days.forEach((d) => {
          if (!CRM.gcal.occursOn(g, d)) return;
          if (dupIdx && dupIdx.size && CRM.tutor.isGoogleDuplicate(g, d, dupIdx)) return;
          const it = {
            key: 'g:' + g.cal + ':' + g.id + ':' + d, kind: 'gcal', title: g.title, color: CRM.gcal.colorOf ? CRM.gcal.colorOf(g) : CRM.dict.categoryColor('teal'), icon: 'calendar',
            gev: g, date: d, tentative: !!g.tentative, editable: drag, series: !!g.rid
          };
          if (g.allDay) { put(d, 'allDay', Object.assign(it, { sub: 'Google Календар' })); return; }
          const sDay = D.toKyivDate(g.start);
          const eDay = D.toKyivDate(g.end);
          it.startMin = sDay === d ? minuteOf(g.start) : 0;
          it.endMin = eDay === d ? minuteOf(g.end) : DAY_MIN;
          if (it.endMin < it.startMin) it.endMin = it.startMin;
          it.sub = `${CRM.gcal.hhmm(g.start)}–${CRM.gcal.hhmm(g.end)}`;
          it.past = Date.parse(g.end) <= Date.now();
          put(d, 'timed', it);
        });
      });
    }

    if (L.training && CRM.programs && CRM.programs.entriesOn) {
      days.forEach((d) => {
        let list = [];
        try { list = CRM.programs.entriesOn(d); } catch (e) { console.error(e); }
        list.forEach((e) => {
          if (e.rest) return;
          put(d, 'allDay', {
            key: 'tr:' + e.key + ':' + d, kind: 'training', title: e.progTitle, sub: e.detail || e.title,
            color: e.color, icon: 'dumbbell', done: !!e.done, date: d, onOpen: () => e.open()
          });
        });
      });
    }

    if (L.payments) {
      CRM.store.list('recurring').forEach((r) => {
        CRM.schedule.occurrences(r, from, to).forEach((d) => {
          const paid = CRM.schedule.isPaid(r, d);
          const income = r.kind === 'income';
          put(d, 'allDay', {
            key: 'pay:' + r.id + ':' + d, kind: 'payment', title: r.name,
            sub: (income ? fmt.money(r.amount, r.currency, { sign: true }) : fmt.money(-r.amount, r.currency)) +
              (paid ? (income ? ' · отримано' : ' · сплачено') : ''),
            color: CRM.dict.categoryColor(income ? 'green' : 'yellow'), icon: 'repeat', done: paid, date: d,
            onOpen: () => CRM.entities.open('recurring', r.id)
          });
        });
      });
    }

    if (L.deadlines && CRM.tasks) {
      CRM.tasks.activeTasks().forEach((t) => {
        if (!t.deadline || t.deadline < from || t.deadline > to) return;
        // Задача й так стоїть у плані цього дня (з позначкою «дедлайн») — без дубля
        if (tasksOn(L) && t.planDate === t.deadline) return;
        put(t.deadline, 'allDay', {
          key: 'dl:' + t.id, kind: 'deadline', title: t.title || 'Без назви', time: t.deadlineTime || null,
          sub: 'Дедлайн задачі' + (t.deadlineTime ? ' о ' + t.deadlineTime : ''),
          color: CRM.dict.categoryColor('red'), icon: 'flag', date: t.deadline, overdue: t.deadline < T,
          onOpen: () => CRM.tasks.openTask(t.id)
        });
      });
    }

    // Дедлайни тем і курсів «Навчання» (js/learning.js): колір курсу, вивчені — закреслені
    if (L.learning && CRM.learning && CRM.learning.calendarItems) {
      let list = [];
      try { list = CRM.learning.calendarItems(from, to); } catch (e) { console.error(e); }
      list.forEach((x) => {
        const topicId = x.topic ? x.topic.id : null;
        put(x.date, 'allDay', {
          key: 'learn:' + x.key, kind: 'learning', title: x.topic ? x.topic.title : x.course.title,
          sub: x.topic ? `${x.course.title} · дедлайн теми` : 'Дедлайн курсу',
          color: x.color, icon: 'graduation', date: x.date, done: !!x.done, overdue: !!x.overdue,
          learn: { courseId: x.course.id, topicId },
          onOpen: () => CRM.learning.openCourse(x.course.id, { topic: topicId })
        });
      });
    }

    // Дедлайни етапів і проєктів (js/projects.js): колір проєкту, готові — закреслені, ◆ — дедлайн проєкту
    if (L.projects && CRM.projects && CRM.projects.calendarItems) {
      let list = [];
      try { list = CRM.projects.calendarItems(from, to); } catch (e) { console.error(e); }
      list.forEach((x) => {
        put(x.date, 'allDay', {
          key: 'pj:' + x.key, kind: 'project', title: x.title, sub: x.sub,
          color: x.color, icon: 'projects', date: x.date, done: !!x.done, overdue: !!x.overdue,
          pj: { projectId: x.projectId, stageId: x.stageId, diamond: !!x.diamond },
          onOpen: () => CRM.projects.openProject(x.projectId, x.stageId ? { stage: x.stageId } : null)
        });
      });
    }

    // Події на кілька днів — першими й в однаковому порядку щодня, щоб смуги йшли рівно
    const spanKey = (it) => (it.span ? '0' + it.span.first + (99999 - it.span.days) + it.ev.id : '1');
    byDay.forEach((b) => {
      b.allDay.sort((a, c) => (KIND_ORDER[a.kind] - KIND_ORDER[c.kind]) || spanKey(a).localeCompare(spanKey(c)) || ((a.order || 0) - (c.order || 0)) ||
        (a.time || '').localeCompare(c.time || '') || a.title.localeCompare(c.title, 'uk'));
      b.timed.sort((a, c) => (a.startMin - c.startMin) || ((c.endMin - c.startMin) - (a.endMin - a.startMin)));
    });
    return byDay;
  }

  /** Розкладка подій, що перетинаються: колонки всередині групи. */
  function layoutTimed(items) {
    const out = items.slice().sort((a, b) => (a.startMin - b.startMin) || ((b.endMin - b.startMin) - (a.endMin - a.startMin)));
    let group = [];
    let groupEnd = -1;
    const flush = () => {
      const cols = [];
      group.forEach((it) => {
        const vEnd = Math.max(it.endMin, it.startMin + MIN_VIS);
        let c = cols.findIndex((end) => end <= it.startMin);
        if (c === -1) { c = cols.length; cols.push(vEnd); } else cols[c] = vEnd;
        it.col = c;
      });
      group.forEach((it) => { it.ncols = cols.length; });
      group = [];
      groupEnd = -1;
    };
    out.forEach((it) => {
      if (group.length && it.startMin >= groupEnd) flush();
      group.push(it);
      groupEnd = Math.max(groupEnd, Math.max(it.endMin, it.startMin + MIN_VIS));
    });
    if (group.length) flush();
    return out;
  }

  // ---------- Стан сторінки ----------
  let gridScroll = null;     // прокрутка годинної сітки (зберігається між перемальовуваннями)
  let suppressUntil = 0;     // після перетягування браузер надсилає «клік» — ігноруємо його
  let lastPointer = 'mouse';
  let teardown = null;       // перервати активне перетягування (при перемальовуванні)
  let quick = null;          // відкрите вікно швидкого додавання
  let quickRoute = '';       // адреса сторінки, на якій його відкрили

  let rerenderLater = false; // перемалювати, щойно закриється вікно швидкого додавання
  function closeQuick() { if (quick && quick.isOpen) quick.close('force'); quick = null; }
  /** Віконце закрилося: якщо поки воно було відкрите, прийшли зміни з Google — перемалювати. */
  function popClosed(pop) {
    if (quick === pop) quick = null;
    if (rerenderLater) { rerenderLater = false; setTimeout(() => CRM.router.rerender(), 0); }
  }
  function clicksBlocked() { return Date.now() < suppressUntil; }

  // ---------- Збереження ----------
  /** Браузер узяв старий db.js з кешу (без сховища подій) — зберігати нікуди. */
  function canSave() {
    if (CRM.db.SCHEMA.events) return true;
    ui.toast('Браузер показує стару версію сайту з кешу — онови сторінку (Ctrl+F5), щоб додавати події.', { type: 'error', duration: 9000 });
    return false;
  }

  async function moveEvent(ev, changes, kind) {
    if (ev.occ) { await moveOccurrence(ev, changes, kind); return; }
    const cur = CRM.store.get('events', ev.id);
    if (!cur) return;
    const before = { date: cur.date, start: cur.start, dur: cur.dur, allDay: cur.allDay, endDate: cur.endDate || null };
    const saved = await CRM.store.patch('events', ev.id, changes);
    const end = spanEnd(saved);
    const text = kind === 'resize'
      ? `«${saved.title}»: ${whenText(saved)} (${durText(saved.dur)})`
      : end ? `«${saved.title}» перенесено: ${spanText(saved.date, end)}`
        : `«${saved.title}» перенесено: ${dayShort(saved.date)}${saved.allDay ? '' : ', ' + whenText(saved)}`;
    ui.toast(text, {
      type: 'success',
      action: { label: 'Скасувати', onClick: () => CRM.store.patch('events', ev.id, before) }
    });
  }

  // ---------- Копії ----------
  const COPY_F = ['title', 'date', 'allDay', 'start', 'dur', 'cat', 'remind', 'note', 'studentId'];
  /** Поля події для копії: повтор серії стає звичайною подією (без правила), «на кілька днів» — зберігається. */
  function copyFields(ev) {
    const out = {};
    COPY_F.forEach((f) => { if (ev[f] !== undefined) out[f] = CRM.utils.deepClone(ev[f]); });
    const end = spanEnd(ev);
    if (end) out.endDate = end;
    return out;
  }
  /** Скопіювати подію: changes = { date, start? } — куди. Тривалість і «на кілька днів» — як в оригіналу. */
  async function copyEvent(ev, changes) {
    if (!canSave()) return null;
    const rec = Object.assign(copyFields(ev), changes || {});
    const end = spanEnd(ev);
    if (end && changes && changes.date && changes.endDate === undefined) rec.endDate = D.addDays(rec.date, D.diffDays(ev.date, end));
    if (rec.start && !rec.allDay && toMin(rec.start) + (Number(rec.dur) || 60) > DAY_MIN) rec.dur = Math.max(SNAP, DAY_MIN - toMin(rec.start));
    const saved = await CRM.store.save('events', rec);
    const se = spanEnd(saved);
    ui.toast(`«${saved.title}» скопійовано: ${se ? spanText(saved.date, se) : dayShort(saved.date) + (saved.allDay ? '' : ', ' + whenText(saved))}`, {
      type: 'success', duration: 8000,
      action: { label: 'Скасувати', onClick: async () => { if (CRM.store.get('events', saved.id)) await CRM.store.removeForever('events', saved.id); } }
    });
    return saved;
  }

  /** Віконце «Копіювати на…»: дата (і час — для події з часом). onDone — після копіювання. */
  function copyTo(anchor, src, onDone, doCopy) {
    const dIn = ui.dateInput({ value: D.addDays(src.date, 1), clearable: false, ariaLabel: 'На яку дату' });
    const tIn = src.allDay || !src.start ? null : ui.timeInput({ value: src.start, ariaLabel: 'Час початку копії' });
    const err = h('div', { class: 'kal-quick-err', role: 'alert' });
    async function run() {
      const date = dIn.dateValue;
      if (!date) { err.textContent = 'Вибери дату'; return; }
      const changes = { date };
      if (tIn) {
        const t = tIn.parseTime(tIn.value);
        if (!t) { err.textContent = 'Час — у форматі ГГ:ХХ, напр., 09:30'; tIn.focus(); return; }
        changes.start = t;
      }
      pop.close('copied');
      if (onDone) onDone();
      if (doCopy) await doCopy(changes);
      else await copyEvent(src, changes);
    }
    if (tIn) tIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); tIn.dispatchEvent(new Event('change')); run(); } });
    const pop = ui.popover(anchor, h('div', { class: 'kal-copy' },
      h('div', { class: 'kal-pick-head' }, 'Копіювати подію на…'),
      h('div', { class: 'kal-copy-row' }, h('span', { class: 'kal-copy-lbl' }, 'Дата'), dIn),
      tIn ? h('div', { class: 'kal-copy-row' }, h('span', { class: 'kal-copy-lbl' }, 'Початок'), tIn) : null,
      err,
      h('div', { class: 'kal-quick-actions' },
        ui.button({ label: 'Скасувати', size: 'sm', variant: 'ghost', onClick: () => pop.close('cancel') }),
        ui.button({ label: 'Копіювати', size: 'sm', variant: 'primary', className: 'kal-copy-ok', onClick: run }))),
    { align: 'start', className: 'kal-copy-pop' });
    dIn.focus({ preventScroll: true });
    return pop;
  }

  async function removeEvent(ev) {
    const batch = await CRM.store.softDelete('events', ev.id);
    ui.toast(`${isSeries(ev) ? 'Серію подій' : 'Подію'} «${ev.title}» видалено`, {
      action: { label: 'Скасувати', onClick: () => CRM.store.restoreBatch(batch) }
    });
  }

  // ---------- Повтори: зміни ----------
  const normF = (f, v) => {
    if (f === 'note') return v || '';
    if (f === 'allDay') return !!v;
    if (f === 'remind' || f === 'dur') return v == null || v === '' ? null : Number(v);
    return v == null ? null : v;
  };
  /** Лишити в зміні «лише цього» тільки те, що справді відрізняється від серії. */
  function cleanOverride(series, occ, o) {
    const n = {};
    if (D.isDate(o.date) && o.date !== occ) n.date = o.date;
    if (o.allDay !== undefined && normF('allDay', o.allDay) !== normF('allDay', series.allDay)) {
      n.allDay = !!o.allDay;
      n.start = o.allDay ? null : (o.start || null);
      n.dur = o.allDay ? null : normF('dur', o.dur);
    } else {
      ['start', 'dur'].forEach((f) => { if (o[f] !== undefined && normF(f, o[f]) !== normF(f, series[f])) n[f] = o[f]; });
    }
    TEXT_F.forEach((f) => { if (o[f] !== undefined && normF(f, o[f]) !== normF(f, series[f])) n[f] = o[f]; });
    return Object.keys(n).length ? n : null;
  }
  /** Прибрати з зміни «лише цього» поля, які щойно змінили для багатьох повторів. */
  function stripOverride(o, ch) {
    if (!o) return null;
    const n = Object.assign({}, o);
    Object.keys(ch).forEach((f) => { delete n[f]; });
    if (TIME_F.some((f) => f in ch)) TIME_F.forEach((f) => { delete n[f]; });
    return Object.keys(n).length ? n : null;
  }
  function withOverride(series, occ, o) {
    const ov = Object.assign({}, series.overrides || {});
    const clean = o ? cleanOverride(series, occ, o) : null;
    if (clean) ov[occ] = clean; else delete ov[occ];
    return ov;
  }
  /** Знімок полів серії для «Скасувати». */
  function seriesSnap(s) {
    return { repeat: s.repeat || null, skip: s.skip || [], overrides: s.overrides || {} };
  }

  /** Перетягування повтору: переноситься лише цей день серії. */
  async function moveOccurrence(inst, changes, kind) {
    const cur = CRM.store.get('events', inst.id);
    if (!cur) return;
    const snap = seriesSnap(cur);
    const o = Object.assign({}, (cur.overrides || {})[inst.occ] || {}, changes);
    if (changes.date === undefined && !o.date) o.date = inst.date;
    const saved = await CRM.store.patch('events', cur.id, { overrides: withOverride(cur, inst.occ, o) });
    const shown = instanceOf(saved, inst.occ);
    const text = kind === 'resize'
      ? `«${shown.title}» (лише цього разу): ${whenText(shown)} (${durText(shown.dur)})`
      : `«${shown.title}» перенесено лише цього разу: ${dayShort(shown.date)}${shown.allDay ? '' : ', ' + whenText(shown)}`;
    ui.toast(text, {
      type: 'success',
      action: { label: 'Скасувати', onClick: () => CRM.store.patch('events', cur.id, snap) }
    });
  }

  /** Що людина змінила у формі порівняно з показаним повтором. */
  function changedFields(inst, V) {
    const ch = {};
    if (V.date !== inst.date) ch.date = V.date;
    if (TIME_F.some((f) => normF(f, V[f]) !== normF(f, inst[f]))) TIME_F.forEach((f) => { ch[f] = V[f]; });
    TEXT_F.forEach((f) => { if (normF(f, V[f]) !== normF(f, inst[f])) ch[f] = V[f]; });
    return ch;
  }
  /** Чи є в серії повтори раніше за цей (не скасовані). */
  function hasEarlier(series, occ) {
    return seriesDates(series, series.date, D.addDays(occ, -1)).some((d) => !skipped(series, d));
  }
  function pickKeys(obj, test) {
    const out = {};
    Object.keys(obj || {}).forEach((k) => { if (test(k)) out[k] = obj[k]; });
    return out;
  }
  function freshCopy(rec) {
    const c = CRM.utils.deepClone(rec);
    // gsync — де копія в Google (gmirror.js): у нової події своя копія
    ['id', 'createdAt', 'updatedAt', 'deletedAt', 'deleteBatch', 'deleteHead', 'gsync'].forEach((f) => { delete c[f]; });
    return c;
  }

  /**
   * Зберегти зміни повтору з форми. scope: 'one' | 'following' | 'all'.
   * inst — показаний повтор, V — значення форми, rule — правило з форми (null — «Не повторюється»).
   * Повертає функцію «Скасувати».
   */
  async function saveScoped(series, inst, V, rule, scope) {
    const occ = inst.occ;
    const ch = changedFields(inst, V);
    const old = ruleOf(series);
    const same = sameRule(rule, old);
    const before = CRM.utils.deepClone(series);
    const undoSeries = () => CRM.store.save('events', before);

    if (scope === 'one') {
      const o = Object.assign({}, (series.overrides || {})[occ] || {}, ch);
      await CRM.store.patch('events', series.id, { overrides: withOverride(series, occ, o) });
      return undoSeries;
    }
    if (scope === 'following' && !hasEarlier(series, occ)) scope = 'all';
    const shift = ch.date ? D.diffDays(occ, ch.date) : 0;

    if (!rule) {
      // «Не повторюється»: цей повтор стає звичайною подією
      const single = Object.assign(freshCopy(series), V, { repeat: null, skip: [], overrides: {} });
      if (scope === 'all') {
        // та сама подія (той самий id) — і та сама копія в Google (gmirror.js перетворить її на окрему подію)
        await CRM.store.save('events', Object.assign({}, single, { id: series.id, createdAt: series.createdAt }, series.gsync ? { gsync: series.gsync } : {}));
        return undoSeries;
      }
      const a = Object.assign({}, series, { repeat: Object.assign({}, old, { until: D.addDays(occ, -1), count: null }),
        skip: (series.skip || []).filter((d) => d < occ), overrides: pickKeys(series.overrides, (k) => k < occ) });
      await CRM.store.save('events', a);
      const b = await CRM.store.save('events', single);
      return async () => { await CRM.store.removeForever('events', b.id); await undoSeries(); };
    }

    const nextRule = (base) => {
      let r = rule;
      if (same) {
        r = Object.assign({}, old);
        if (base && old.count) r.count = Math.max(1, old.count - seriesDates(series, series.date, D.addDays(occ, -1)).length);
        if (shift && r.freq === 'week') r.days = shiftDays(r.days, shift);
      }
      return r;
    };
    const carry = same && !shift;   // правило й дні ті самі — окремі зміни окремих днів лишаються

    if (scope === 'all') {
      const s = CRM.utils.deepClone(series);
      Object.keys(ch).forEach((f) => { if (f !== 'date') s[f] = ch[f]; });
      if (shift) s.date = D.addDays(series.date, shift);
      s.repeat = nextRule(false);
      if (carry) {
        const ov = Object.assign({}, s.overrides || {});
        const mine = stripOverride(ov[occ], ch);
        if (mine) ov[occ] = mine; else delete ov[occ];
        s.overrides = ov;
      } else { s.overrides = {}; s.skip = []; }
      await CRM.store.save('events', s);
      return undoSeries;
    }

    // «Цю й наступні»: стара серія закінчується напередодні, з цього дня — нова
    const a = Object.assign({}, series, {
      repeat: Object.assign({}, old, { until: D.addDays(occ, -1), count: null }),
      skip: (series.skip || []).filter((d) => d < occ),
      overrides: pickKeys(series.overrides, (k) => k < occ)
    });
    const b = freshCopy(series);
    Object.keys(ch).forEach((f) => { if (f !== 'date') b[f] = ch[f]; });
    b.date = D.addDays(occ, shift);
    b.repeat = nextRule(true);
    if (carry) {
      b.skip = (series.skip || []).filter((d) => d > occ);
      b.overrides = pickKeys(series.overrides, (k) => k > occ);
      const mine = stripOverride((series.overrides || {})[occ], ch);
      if (mine) b.overrides[occ] = mine;
    } else { b.skip = []; b.overrides = {}; }
    await CRM.store.save('events', a);
    const saved = await CRM.store.save('events', b);
    return async () => { await CRM.store.removeForever('events', saved.id); await undoSeries(); };
  }

  /** Видалити повтор: лише цей (skip), цей і наступні (серія закінчується) або всю серію (Кошик). */
  async function deleteScoped(series, inst, scope) {
    const occ = inst.occ;
    const title = series.title || 'Без назви';
    if (scope === 'following' && !hasEarlier(series, occ)) scope = 'all';
    if (scope === 'all') { await removeEvent(series); return; }
    const snap = seriesSnap(series);
    const undo = { label: 'Скасувати', onClick: () => CRM.store.patch('events', series.id, snap) };
    if (scope === 'one') {
      const ov = Object.assign({}, series.overrides || {});
      delete ov[occ];
      await CRM.store.patch('events', series.id, { skip: (series.skip || []).filter((d) => d !== occ).concat(occ).sort(), overrides: ov });
      ui.toast(`«${title}»: ${dayShort(inst.date)} — скасовано`, { action: undo });
      return;
    }
    await CRM.store.patch('events', series.id, {
      repeat: Object.assign({}, ruleOf(series), { until: D.addDays(occ, -1), count: null }),
      skip: (series.skip || []).filter((d) => d < occ),
      overrides: pickKeys(series.overrides, (k) => k < occ)
    });
    ui.toast(`«${title}»: повтори з ${dayShort(inst.date)} видалено`, { action: undo });
  }

  /** Вікно «Лише цю / Цю й наступні / Усі події серії». Повертає Promise<scope | null>. */
  function chooseScope(o) {
    return new Promise((resolve) => {
      const del = o.mode === 'delete';
      const day = dayShort(o.inst.date);
      const opts = [
        o.allowOne ? { id: 'one', label: 'Лише цю', sub: del ? `${day} — інші дні серії лишаються` : day } : null,
        o.noFollowing ? null : { id: 'following', label: 'Цю й наступні', sub: `${day} і всі наступні` },
        { id: 'all', label: 'Усі події серії', sub: del ? (o.google ? 'Уся серія зникне з Google Календаря («Скасувати» — одразу після видалення)' : 'Уся серія перейде в Кошик (можна відновити протягом 30 днів)')
          : o.reset && !o.google ? 'Окремі зміни окремих днів буде скинуто' : 'Від першого дня серії' }
      ].filter(Boolean);
      let value = opts[0].id;
      let result = null;
      const list = h('div', { class: 'kal-scope', role: 'radiogroup', 'aria-label': del ? 'Що видалити' : 'Що змінити' });
      const draw = (focusIt) => {
        ui.mount(list, opts.map((x) => h('button', {
          type: 'button', role: 'radio', class: 'kal-scope-opt' + (x.id === value ? ' active' : ''),
          'aria-checked': x.id === value ? 'true' : 'false', tabIndex: x.id === value ? 0 : -1, dataset: { scope: x.id },
          onClick: () => { value = x.id; draw(true); },
          onDblclick: () => { value = x.id; result = value; dlg.close('confirm'); }
        },
        h('span', { class: 'kal-scope-dot', 'aria-hidden': 'true' }),
        h('span', { class: 'kal-scope-main' },
          h('span', { class: 'kal-scope-label' }, x.label),
          h('span', { class: 'kal-scope-sub' }, x.sub)))));
        if (focusIt) { const a = list.querySelector('.kal-scope-opt.active'); if (a) a.focus({ preventScroll: true }); }
      };
      list.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
        e.preventDefault();
        const i = opts.findIndex((x) => x.id === value);
        value = opts[clamp(i + (e.key === 'ArrowDown' ? 1 : -1), 0, opts.length - 1)].id;
        draw(true);
      });
      draw(false);
      const okBtn = ui.button({
        label: del ? 'Видалити' : 'Зберегти', variant: del ? 'danger' : 'primary',
        onClick: () => { result = value; dlg.close('confirm'); }
      });
      const dlg = ui.modal({
        title: del ? 'Видалити повторювану подію' : 'Змінити повторювану подію', size: 'sm', center: true, className: 'kal-scope-modal',
        body: list,
        footer: [ui.button({ label: 'Скасувати', onClick: () => dlg.close('cancel') }), okBtn],
        initialFocus: list.querySelector('.kal-scope-opt.active'),
        onClose: () => resolve(result)
      });
    });
  }

  // ---------- Задачі: план ----------
  const PLAN_FIELDS = ['planDate', 'planStart', 'planDur', 'planOrder'];
  function planSnapshot(list) {
    return list.map((t) => {
      const s = { id: t.id };
      PLAN_FIELDS.forEach((f) => { s[f] = t[f] === undefined ? null : t[f]; });
      return s;
    });
  }
  /** «Скасувати»: повернути поля плану задач, як були. */
  async function restorePlans(snap) {
    const recs = snap.map((s) => {
      const cur = CRM.store.get('tasks', s.id);
      return cur ? Object.assign({}, cur, s) : null;
    }).filter(Boolean);
    if (recs.length) await CRM.store.saveMany('tasks', recs);
  }
  function planText(date, start) { return dayShort(date) + (start ? ', ' + start : ''); }

  /**
   * Запланувати задачу: to = { date, start: 'ГГ:ХХ' | null, index: місце в «Плані дня» }.
   * Без часу — задача стає в список дня (порядок решти перенумеровується).
   */
  async function planTask(id, to) {
    const cur = CRM.store.get('tasks', id);
    if (!cur || !D.isDate(to.date)) { CRM.router.rerender(); return; }
    const start = to.start || null;
    const changes = { planDate: to.date, planStart: start };
    const others = [];
    if (!start) {
      const list = untimedOn(to.date).filter((t) => t.id !== id);
      const at = to.index == null ? list.length : clamp(to.index, 0, list.length);
      list.splice(at, 0, cur);
      list.forEach((t, i) => {
        if (t.id === id) changes.planOrder = i;
        else if (t.planOrder !== i) others.push(Object.assign({}, t, { planOrder: i }));
      });
    }
    const wasStart = cur.planStart || null;
    const same = cur.planDate === to.date && wasStart === start && (start || changes.planOrder === cur.planOrder);
    if (same && !others.length) { CRM.router.rerender(); return; }
    const snap = planSnapshot([cur].concat(others.map((o) => CRM.store.get('tasks', o.id))));
    await CRM.store.saveMany('tasks', [Object.assign({}, cur, changes)].concat(others));
    // Просто змінили порядок у списку того самого дня — без повідомлення
    if (cur.planDate === to.date && !wasStart && !start) return;
    ui.toast(`«${cur.title}» — у плані: ${planText(to.date, start)}`, {
      type: 'success', action: { label: 'Скасувати', onClick: () => restorePlans(snap) }
    });
  }

  async function resizeTask(id, dur) {
    const cur = CRM.store.get('tasks', id);
    if (!cur) return;
    const snap = planSnapshot([cur]);
    const saved = await CRM.store.patch('tasks', id, { planDur: dur });
    ui.toast(`«${saved.title}»: ${saved.planStart}–${fromMin(taskEnd(saved))} (${durText(dur)})`, {
      type: 'success', action: { label: 'Скасувати', onClick: () => restorePlans(snap) }
    });
  }

  /** Галочка: виконати (без вікна підтвердження, з «Скасувати») або повернути в активні. */
  async function toggleTask(id) {
    const t = CRM.store.get('tasks', id);
    if (!t) return;
    if (t.done) await CRM.tasks.reopen(id);
    else await CRM.tasks.complete(id, { confirm: false });
  }

  /** «Перенести на сьогодні»: невиконані з минулих днів — у кінець сьогоднішнього списку. */
  async function rollOver() {
    const list = overdueTasks();
    if (!list.length) return;
    const T = D.today();
    const snap = planSnapshot(list);
    let order = untimedOn(T).length;
    await CRM.store.saveMany('tasks', list.map((t) => Object.assign({}, t, { planDate: T, planStart: null, planOrder: order++ })));
    ui.toast(`Перенесено на сьогодні: ${fmt.count(list.length, ['задача', 'задачі', 'задач'])}`, {
      type: 'success', action: { label: 'Скасувати', onClick: () => restorePlans(snap) }
    });
  }

  /** Нова задача прямо з календаря. plan = { date, start, dur }. */
  async function addTask(title, plan, opts) {
    if (!layers().tasks) setLayer('tasks', true);
    const rec = await CRM.tasks.create({
      title, planDate: plan.date, planStart: plan.start || null, planDur: plan.start && plan.dur ? plan.dur : null,
      planOrder: plan.start ? null : CRM.tasks.nextPlanOrder(plan.date)
    });
    if (opts && opts.quiet) return rec;
    ui.toast(`Задачу додано в план: ${planText(plan.date, plan.start)}`, {
      type: 'success', action: { label: 'Відкрити', onClick: () => CRM.tasks.openTask(rec.id) }
    });
    return rec;
  }

  // ---------- Перетягування: мишка й довге натискання ----------
  /**
   * begin(x, y, target) → { move(x, y), end(commit) } | null — сесія перетягування.
   * Мишка: починається після зсуву на 5 px. Телефон: після довгого натискання; доти
   * сторінка прокручується як завжди.
   */
  function attachDrag(el, begin) {
    el.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'touch' || e.button !== 0) return;
      e.preventDefault();
      const sx = e.clientX;
      const sy = e.clientY;
      const target = e.target;
      let s = null;
      const stop = () => {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', up);
        window.removeEventListener('keydown', key, true);
        window.removeEventListener('keyup', key, true);
        teardown = null;
      };
      const move = (m) => {
        if (!s) {
          if (Math.abs(m.clientX - sx) + Math.abs(m.clientY - sy) < 5) return;
          closeQuick();
          s = begin(sx, sy, target);
          if (!s) { stop(); return; }
        }
        m.preventDefault();
        s.move(m.clientX, m.clientY, m);
      };
      const up = (u) => {
        stop();
        if (s) { suppressUntil = Date.now() + 400; s.end(u.type === 'pointerup', u); }
      };
      const key = (k) => {
        if (s && s.mod && (k.key === 'Control' || k.key === 'Meta')) { s.mod(k); return; }
        if (k.type !== 'keydown' || k.key !== 'Escape' || !s) return;
        k.preventDefault();
        k.stopPropagation();
        stop();
        suppressUntil = Date.now() + 400;
        s.end(false);
      };
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
      window.addEventListener('keydown', key, true);
      window.addEventListener('keyup', key, true);
      teardown = () => { stop(); if (s) s.end(false); };
    });

    // Телефон: обробники touchmove/touchend висять постійно й «пасивно» нічого не роблять, доки
    // не спрацює довге натискання, — інакше браузер не дасть зупинити прокрутку.
    let ts = null;
    const finishTouch = () => {
      if (ts) clearTimeout(ts.timer);
      ts = null;
      teardown = null;
    };
    el.addEventListener('touchstart', (e) => {
      if (e.touches.length !== 1) { finishTouch(); return; }
      const t0 = e.touches[0];
      const cur = { sx: t0.clientX, sy: t0.clientY, target: e.target, s: null, timer: 0 };
      cur.timer = setTimeout(() => {
        if (ts !== cur) return;
        closeQuick();
        cur.s = begin(cur.sx, cur.sy, cur.target);
        if (!cur.s) { finishTouch(); return; }
        if (navigator.vibrate) { try { navigator.vibrate(12); } catch (x) { /* не критично */ } }
      }, LONG_PRESS);
      ts = cur;
      teardown = () => { const was = cur.s; finishTouch(); if (was) was.end(false); };
    }, { passive: true });
    el.addEventListener('touchmove', (m) => {
      if (!ts) return;
      const p = m.touches[0];
      if (!ts.s) {
        if (Math.abs(p.clientX - ts.sx) + Math.abs(p.clientY - ts.sy) > 10) finishTouch();
        return;
      }
      if (m.cancelable) m.preventDefault();
      ts.s.move(p.clientX, p.clientY);
    }, { passive: false });
    const touchEnd = (x) => {
      if (!ts) return;
      const was = ts.s;
      finishTouch();
      if (!was) return;
      if (x.cancelable) x.preventDefault();
      suppressUntil = Date.now() + 400;
      was.end(x.type === 'touchend');
    };
    el.addEventListener('touchend', touchEnd);
    el.addEventListener('touchcancel', touchEnd);

    // Довге натискання на телефоні не повинно відкривати контекстне меню
    el.addEventListener('contextmenu', (e) => { if (lastPointer !== 'mouse') e.preventDefault(); });
  }

  /** Геометрія годинної сітки. */
  function gridCtx(scrollEl, stickyEl, cols) {
    return {
      scrollEl,
      colAt(x) {
        let best = cols[0];
        let bd = Infinity;
        for (const c of cols) {
          const r = c.getBoundingClientRect();
          if (x >= r.left && x < r.right) return c;
          const dist = Math.min(Math.abs(x - r.left), Math.abs(x - r.right));
          if (dist < bd) { bd = dist; best = c; }
        }
        return best;
      },
      minuteAt(col, y) { return (y - col.getBoundingClientRect().top) / HOUR * 60; },
      edge(y) {
        const top = stickyEl.getBoundingClientRect().bottom;
        const bottom = scrollEl.getBoundingClientRect().bottom;
        if (y < top + 24) return -Math.min(16, 6 + (top + 24 - y) / 3);
        if (y > bottom - 24) return Math.min(16, 6 + (y - bottom + 24) / 3);
        return 0;
      }
    };
  }

  // ---------- Куди можна покласти задачу поза сіткою ----------
  /** Список «План дня» або клітинка дня («весь день», місяць) під пальцем/мишкою. */
  function dropAt(x, y) {
    const el = document.elementFromPoint(x, y);
    if (!el || !el.closest) return null;
    const list = el.closest('[data-task-list]');
    if (list) return { kind: 'list', el: list, date: list.dataset.taskList };
    const col = el.closest('.kal-col');
    if (col) return { kind: 'col', el: col, date: col.dataset.date };
    const day = el.closest('[data-drop-date]');
    if (day) return { kind: 'day', el: day, date: day.dataset.dropDate };
    return null;
  }
  /** Місце вставки в списку: перед рядком index (або в кінці) — з позначкою-лінією. */
  function listSlot(list, y, skip) {
    const rows = Array.from(list.querySelectorAll('.kal-drow')).filter((r) => r !== skip);
    let index = rows.length;
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i].getBoundingClientRect();
      if (y < r.top + r.height / 2) { index = i; break; }
    }
    clearSlots();
    if (rows.length) rows[Math.min(index, rows.length - 1)].classList.add(index < rows.length ? 'kal-ins-before' : 'kal-ins-after');
    return index;
  }
  function clearSlots() {
    document.querySelectorAll('.kal-ins-before, .kal-ins-after').forEach((r) => r.classList.remove('kal-ins-before', 'kal-ins-after'));
  }

  /** Перетягування події в годинній сітці: перенести (move) або змінити тривалість (resize). */
  function gridSession(block, it, ctx, sx, sy, target) {
    const mode = target && target.closest && target.closest('.kal-resize') ? 'resize' : 'move';
    const isTask = it.kind === 'task';
    const col0 = block.parentElement;
    const dur = it.endMin - it.startMin;
    const grab = ctx.minuteAt(col0, sy) - it.startMin;
    const st = { date: it.date, start: it.startMin, end: it.endMin, x: sx, y: sy };
    const timeEl = block.querySelector('.kal-ev-time');
    let out = null;   // задачу несуть із сітки: у «План дня» або на «весь день»
    let copy = false; // Ctrl (на Mac — Cmd) під час перетягування: копіювати, а не переносити
    block.classList.add('kal-dragging');
    block.setAttribute('aria-grabbed', 'true');
    function setCopy(e) {
      copy = !!(e && (e.ctrlKey || e.metaKey)) && (it.kind === 'own' || it.kind === 'gcal') && mode === 'move';
      block.classList.toggle('kal-copying', copy);
    }

    function setOut(o) {
      if (out && (!o || o.el !== out.el)) out.el.classList.remove('kal-drop');
      if (!o || o.kind !== 'list') clearSlots();
      out = o;
      block.classList.toggle('kal-out', !!o);
      if (!o) return;
      o.el.classList.add('kal-drop');
      if (o.kind === 'list') o.index = listSlot(o.el, st.y, null);
    }

    function apply() {
      if (isTask && mode === 'move') {
        const o = dropAt(st.x, st.y);
        setOut(o && o.kind !== 'col' ? o : null);
        if (out) return;
      }
      if (mode === 'move') {
        const col = ctx.colAt(st.x);
        const s = clamp(snap(ctx.minuteAt(col, st.y) - grab), 0, DAY_MIN - dur);
        st.date = col.dataset.date;
        st.start = s;
        st.end = s + dur;
        block.style.top = px(s);
        block.style.transform = `translateX(${col.getBoundingClientRect().left - col0.getBoundingClientRect().left}px)`;
      } else {
        st.end = clamp(snap(ctx.minuteAt(col0, st.y)), st.start + SNAP, DAY_MIN);
        block.style.height = px(st.end - st.start, true);
      }
      if (timeEl) timeEl.textContent = `${fromMin(st.start)}–${fromMin(st.end)}`;
    }
    let raf = 0;
    const tick = () => {
      const dy = ctx.edge(st.y);
      if (dy) {
        const before = ctx.scrollEl.scrollTop;
        ctx.scrollEl.scrollTop += dy;
        if (ctx.scrollEl.scrollTop !== before) apply();
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    return {
      move(x, y, e) { st.x = x; st.y = y; if (e) setCopy(e); apply(); },
      mod: setCopy,
      end(commit, e) {
        cancelAnimationFrame(raf);
        if (e) setCopy(e);
        block.classList.remove('kal-dragging', 'kal-out', 'kal-copying');
        block.removeAttribute('aria-grabbed');
        const o = out;
        setOut(null);
        if (commit && o) { planTask(it.task.id, { date: o.date, start: null, index: o.index }); return; }
        const changed = st.date !== it.date || st.start !== it.startMin || st.end !== it.endMin;
        if (!commit || !changed) { CRM.router.rerender(); return; }
        if (isTask) {
          if (mode === 'move') planTask(it.task.id, { date: st.date, start: fromMin(st.start) });
          else resizeTask(it.task.id, st.end - st.start);
          return;
        }
        // Подія Google — зміна йде в сам Google Календар (пункт 12)
        if (it.kind === 'gcal') {
          if (mode === 'move' && copy) { CRM.router.rerender(); copyGoogle(it.gev, { date: st.date, start: fromMin(st.start) }); return; }
          if (mode === 'move') moveGoogle(it, { date: st.date, start: fromMin(st.start) }, 'move');
          else moveGoogle(it, { dur: st.end - st.start }, 'resize');
          return;
        }
        if (mode === 'move' && copy) { copyEvent(it.ev, { date: st.date, start: fromMin(st.start) }); CRM.router.rerender(); return; }
        if (mode === 'move') moveEvent(it.ev, { date: st.date, start: fromMin(st.start) }, 'move');
        else moveEvent(it.ev, { dur: st.end - st.start }, 'resize');
      }
    };
  }

  /**
   * Перетягування задачі без часу (рядок «Плану дня», пункт «весь день» чи місяця):
   * у список — змінити порядок; у годинну сітку — дати час; на інший день — перенести.
   */
  function taskSession(el, it, sx, sy) {
    const t = it.task;
    const dur = taskDur(t);
    const r = el.getBoundingClientRect();
    const w = Math.min(r.width, 300);
    const clone = el.cloneNode(true);
    clone.classList.add('kal-floating');
    clone.classList.remove('kal-ins-before', 'kal-ins-after');
    clone.style.width = w + 'px';
    document.body.appendChild(clone);
    el.classList.add('kal-lifted');
    const offX = clamp(sx - r.left, 0, w - 12);
    const offY = sy - r.top;
    const scrollEl = document.querySelector('.kal-scroll');
    const sticky = scrollEl ? scrollEl.querySelector('.kal-sticky') : null;
    let x = sx;
    let y = sy;
    let tgt = null;
    let ghost = null;

    function clearTarget() {
      if (tgt && tgt.el && tgt.kind !== 'col') tgt.el.classList.remove('kal-drop');
      clearSlots();
      tgt = null;
    }
    function update() {
      clone.style.left = (x - offX) + 'px';
      clone.style.top = (y - offY) + 'px';
      const o = dropAt(x, y);
      if (!o || !tgt || o.el !== tgt.el) clearTarget();
      tgt = o;
      if (o && o.kind === 'col') {
        const m = clamp(snap((y - o.el.getBoundingClientRect().top) / HOUR * 60 - dur / 2), 0, DAY_MIN - dur);
        o.min = m;
        if (!ghost) ghost = h('div', { class: 'kal-ghost kal-ghost-task' }, h('span', { class: 'kal-ghost-time num' }));
        if (ghost.parentElement !== o.el) o.el.appendChild(ghost);
        ghost.style.top = px(m);
        ghost.style.height = px(dur, true);
        ghost.firstChild.textContent = `${fromMin(m)}–${fromMin(m + dur)} · ${t.title}`;
        clone.style.visibility = 'hidden';
        return;
      }
      if (ghost) { ghost.remove(); ghost = null; }
      clone.style.visibility = '';
      if (!o) return;
      o.el.classList.add('kal-drop');
      if (o.kind === 'list') o.index = listSlot(o.el, y, el);
    }

    // Біля країв: прокручуємо годинну сітку й сторінку (на телефоні список — над сіткою).
    // Сітку — лише коли задача вже побувала всередині неї: інакше, щойно її заносять згори,
    // сітка «тікає» з-під курсора.
    let raf = 0;
    let armed = false;
    const tick = () => {
      let moved = false;
      if (scrollEl) {
        const sr = scrollEl.getBoundingClientRect();
        const top = sticky ? sticky.getBoundingClientRect().bottom : sr.top;
        let dy = 0;
        if (x >= sr.left && x <= sr.right) {
          if (y >= top + 28 && y <= sr.bottom - 28) armed = true;
          else if (!armed) dy = 0;
          else if (y > top && y < top + 28) dy = -Math.min(16, 6 + (top + 28 - y) / 3);
          else if (y > sr.bottom - 28 && y < sr.bottom + 6) dy = Math.min(16, 6 + (y - sr.bottom + 28) / 3);
        }
        if (dy) { const b = scrollEl.scrollTop; scrollEl.scrollTop += dy; moved = scrollEl.scrollTop !== b; }
      }
      const vh = window.innerHeight;
      const wy = y < 40 ? -Math.min(18, 6 + (40 - y) / 2) : y > vh - 40 ? Math.min(18, 6 + (y - vh + 40) / 2) : 0;
      if (wy) { const b = window.scrollY; window.scrollBy(0, wy); moved = moved || window.scrollY !== b; }
      if (moved) update();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    update();

    return {
      move(nx, ny) { x = nx; y = ny; update(); },
      end(commit) {
        cancelAnimationFrame(raf);
        const o = tgt;
        clearTarget();
        if (ghost) ghost.remove();
        clone.remove();
        el.classList.remove('kal-lifted');
        if (!commit || !o) return;
        if (o.kind === 'list') planTask(t.id, { date: o.date, start: null, index: o.index });
        else if (o.kind === 'col') planTask(t.id, { date: o.date, start: fromMin(o.min) });
        else if (o.date !== t.planDate) planTask(t.id, { date: o.date, start: t.planStart || null });
      }
    };
  }

  /** Перетягування пункту між днями (місяць, рядок «весь день»): змінюється лише дата. */
  function daySession(chip, it, sx, sy) {
    const r = chip.getBoundingClientRect();
    const clone = chip.cloneNode(true);
    clone.classList.add('kal-floating');
    clone.style.width = r.width + 'px';
    clone.style.left = r.left + 'px';
    clone.style.top = r.top + 'px';
    document.body.appendChild(clone);
    chip.classList.add('kal-lifted');
    const offX = sx - r.left;
    const offY = sy - r.top;
    let over = null;
    let copy = false;
    const setCopy = (e) => { copy = (it.kind === 'own' || it.kind === 'gcal') && !!(e && (e.ctrlKey || e.metaKey)); clone.classList.toggle('kal-copying', copy); };
    return {
      mod: setCopy,
      move(x, y, e) {
        if (e) setCopy(e);
        clone.style.left = (x - offX) + 'px';
        clone.style.top = (y - offY) + 'px';
        const el = document.elementFromPoint(x, y);
        const cell = el && el.closest ? el.closest('[data-drop-date]') : null;
        if (cell !== over) {
          if (over) over.classList.remove('kal-drop');
          over = cell;
          if (over) over.classList.add('kal-drop');
        }
      },
      end(commit, e) {
        if (e) setCopy(e);
        clone.remove();
        chip.classList.remove('kal-lifted');
        if (over) over.classList.remove('kal-drop');
        const d = over && over.dataset.dropDate;
        if (!commit || !d) return;
        // Дедлайн теми чи курсу «Навчання» — на інший день
        if (it.kind === 'learning') {
          if (d !== it.date) CRM.learning.moveDeadline(it.learn.courseId, it.learn.topicId, d);
          return;
        }
        // Дедлайн етапу (з питанням «Зсунути наступні етапи?») чи проєкту — на інший день
        if (it.kind === 'project') {
          if (d === it.date) return;
          if (it.pj.stageId) CRM.projects.moveStageEnd(it.pj.projectId, it.pj.stageId, d);
          else CRM.projects.moveDeadline(it.pj.projectId, d);
          return;
        }
        // Подія Google — на інший день цілком (час той самий); з Ctrl — копія
        if (it.kind === 'gcal') {
          const gs = D.diffDays(it.date, d);
          if (copy) { copyGoogle(it.gev, { shift: gs }); return; }
          if (gs) moveGoogle(it, { shift: gs }, 'move');
          return;
        }
        // Подія на кілька днів зсувається цілком (за день, за який її взяли)
        const shift = D.diffDays(it.date, d);
        const changes = it.span ? { date: D.addDays(it.span.first, shift), endDate: D.addDays(it.span.last, shift) } : { date: d };
        if (copy) { copyEvent(it.ev, changes); return; }
        if (d !== it.date) moveEvent(it.ev, changes, 'move');
      }
    };
  }

  // ---------- Події Google: зміна з CRM (пункт 12) ----------
  // Нові події: «Моя CRM» або «Google Календар» — вибір памʼятається в цьому браузері (crm.cal.target, crm.cal.gcal)
  function gTargets() { return CRM.gcal && CRM.gcal.writableCalendars ? CRM.gcal.writableCalendars() : []; }
  // Дублювання ввімкнено (gmirror.js): усі нові події — у CRM (копія сама йде в Google), перемикача «Де зберегти» немає
  function mirrorOn() { return !!(CRM.gmirror && CRM.gmirror.on()); }
  function newTargets() { return mirrorOn() ? [] : gTargets(); }
  function targetPref() { return !mirrorOn() && lsGet('crm.cal.target', 'crm') === 'google' && gTargets().length ? 'google' : 'crm'; }
  function defaultGCal() {
    const list = gTargets();
    const last = lsGet('crm.cal.gcal', '');
    const c = list.find((x) => x.id === last) || list.find((x) => x.primary) || list[0];
    return c ? c.id : null;
  }
  /** Для ⚡: куди піде нова подія — { cal, label } (Google) або null (CRM). */
  function googleTarget() {
    if (targetPref() !== 'google') return null;
    const cal = defaultGCal();
    return cal ? { cal, label: CRM.gcal.calLabel(cal) } : null;
  }
  const GREMIND = [
    { v: 'default', label: 'Як у календарі Google' }, { v: 'none', label: 'Без нагадування' },
    { v: 0, label: 'У момент початку' }, { v: 5, label: 'За 5 хв' }, { v: 10, label: 'За 10 хв' }, { v: 15, label: 'За 15 хв' },
    { v: 30, label: 'За 30 хв' }, { v: 60, label: 'За 1 год' }, { v: 120, label: 'За 2 год' }, { v: 1440, label: 'За 1 день' }
  ];
  const gWhere = (cal) => (CRM.gcal.calLabel(cal) === 'основний' ? 'Google Календар' : `Google Календар («${CRM.gcal.calLabel(cal)}»)`);

  /** Час події Google, як він був (для «Скасувати»). Поле іншого виду — null, щоб PATCH не змішав. */
  function gStartEnd(g) {
    if (g.allDay) return { start: { date: g.start, dateTime: null, timeZone: null }, end: { date: g.end, dateTime: null, timeZone: null } };
    const tz = g.tz || CRM.gcal.calendarTz(g.cal);
    return { start: { dateTime: g.start, timeZone: tz, date: null }, end: { dateTime: g.end, timeZone: tz, date: null } };
  }
  const remindOrig = (g) => (g.rem === undefined || g.rem === 'default' ? { useDefault: true } : { useDefault: false, overrides: g.rem });
  /** start/end без порожніх полів — для нової події. */
  function cleanTimes(t) {
    const out = {};
    ['start', 'end'].forEach((k) => {
      out[k] = {};
      Object.keys(t[k]).forEach((f) => { if (t[k][f] != null) out[k][f] = t[k][f]; });
    });
    return out;
  }
  function untilOfLine(line) {
    const m = /UNTIL=([0-9TZ]+)/i.exec(line || '');
    return m ? CRM.gcal.untilDate(m[1]) : null;
  }
  /** Поля події з Google для копії / відновлення після видалення. */
  function gCopy(full, keepRule) {
    const out = {};
    ['summary', 'description', 'location', 'colorId', 'transparency', 'visibility', 'reminders', 'guestsCanModify'].forEach((f) => {
      if (full[f] !== undefined) out[f] = CRM.utils.deepClone(full[f]);
    });
    if (Array.isArray(full.attendees) && full.attendees.length) {
      out.attendees = full.attendees.filter((a) => a && a.email).map((a) => {
        const x = { email: a.email };
        if (a.displayName) x.displayName = a.displayName;
        if (a.optional) x.optional = true;
        if (a.responseStatus) x.responseStatus = a.responseStatus;
        return x;
      });
    }
    if (full.start) out.start = CRM.utils.deepClone(full.start);
    if (full.end) out.end = CRM.utils.deepClone(full.end);
    if (keepRule && Array.isArray(full.recurrence)) out.recurrence = full.recurrence.slice();
    return out;
  }
  const masterDay = (master) => (master.start && master.start.date && !master.start.dateTime ? master.start.date : D.toKyivDate(master.start.dateTime));
  const masterAllDay = (master) => !!(master.start && master.start.date && !master.start.dateTime);
  /** Початкова дата заняття в серії (originalStartTime) за Києвом. */
  const occDay = (g, m) => (g.ost ? (/T/.test(g.ost) ? D.toKyivDate(g.ost) : g.ost) : m.date);

  /** Що змінилось у формі (V) порівняно з показаною подією (m): тіло зміни, тіло для «Скасувати», чи змінено час. */
  function gDiff(g, m, V) {
    const body = {};
    const back = {};
    if (V.title !== undefined && (V.title || '') !== (m.title || '')) { body.summary = V.title; back.summary = m.title; }
    if (V.location !== undefined && (V.location || '') !== (m.location || '')) { body.location = V.location; back.location = g.location || ''; }
    if (V.note !== undefined && (V.note || '') !== (m.note || '')) { body.description = V.note; back.description = g.desc || ''; }
    if (V.gremind !== undefined && V.gremind !== 'custom' && String(V.gremind) !== String(m.gremind)) {
      body.reminders = CRM.gcal.remindBody(V.gremind);
      back.reminders = remindOrig(g);
    }
    // Колір (2026.11.15-5): '' — як у календаря (null у PATCH стирає свій колір)
    if (V.gcolor !== undefined && (V.gcolor || '') !== (m.gcolor || '')) { body.colorId = V.gcolor || null; back.colorId = m.gcolor || null; }
    const timeCh = V.date !== m.date || !!V.allDay !== !!m.allDay || (V.endDate || null) !== (m.endDate || null) ||
      (!V.allDay && (V.start !== m.start || Number(V.dur) !== Number(m.dur)));
    return { body, back, timeCh };
  }

  /** Є гості й організатор — я: «Надіслати гостям лист?» → 'all' | 'none'; без гостей — ''; передумав — null. */
  function askGuests(g, del) {
    if (!g || !g.guests || g.notMine) return Promise.resolve('');
    return new Promise((resolve) => {
      let res = null;
      const dlg = ui.modal({
        title: del ? 'Повідомити гостей про видалення?' : 'Повідомити гостей про зміну?',
        size: 'sm', center: true,
        body: h('p', { class: 'modal-text' }, `У події «${g.title}» є інші учасники (${g.guests}). Google може надіслати їм лист${del ? ' про скасування' : ' з новими даними'}.`),
        footer: [
          ui.button({ label: 'Скасувати', onClick: () => dlg.close('cancel') }),
          ui.button({ label: 'Не надсилати', className: 'kal-guests-none', onClick: () => { res = 'none'; dlg.close('none'); } }),
          ui.button({ label: 'Надіслати', variant: 'primary', className: 'kal-guests-all', onClick: () => { res = 'all'; dlg.close('all'); } })
        ],
        onClose: () => resolve(res)
      });
    });
  }

  /** «Цю й наступні» для серії з COUNT — скільки занять було до цього (правило має бути простим). */
  function countBefore(rule, first, occ) {
    return ruleDates(first, normRule(rule, first), first, D.addDays(occ, -1)).length;
  }

  /** Уся серія: змінити головну подію (час переноситься на стільки ж днів, що й показане заняття). Повертає «Скасувати». */
  async function gSeriesAll(g, m, V, o, master, d) {
    const cal = g.cal;
    const b = Object.assign({}, d.body);
    const u = Object.assign({}, d.back);
    const first = masterDay(master);
    const mAll = masterAllDay(master);
    const rec = Array.isArray(master.recurrence) ? master.recurrence : [];
    const parsed = CRM.gcal.parseRecurrence(rec, first);
    const shift = D.diffDays(m.date, V.date);
    if (d.timeCh) {
      const V2 = { allDay: !!V.allDay, date: D.addDays(first, shift), start: V.start, dur: V.dur, endDate: null };
      if (V.allDay && V.endDate) V2.endDate = D.addDays(V2.date, D.diffDays(V.date, V.endDate));
      Object.assign(b, CRM.gcal.timesBody(V2, (master.start && master.start.timeZone) || CRM.gcal.calendarTz(cal)));
      u.start = Object.assign({ date: null, dateTime: null, timeZone: null }, master.start);
      u.end = Object.assign({ date: null, dateTime: null, timeZone: null }, master.end);
    }
    let line = null;
    if (o.ruleChanged && o.rule) line = CRM.gcal.buildRRule(o.rule, !!V.allDay);
    else if (parsed.rrule && ((shift % 7 && parsed.parts.BYDAY) || (d.timeCh && !!V.allDay !== mAll && parsed.parts.UNTIL))) {
      line = shift ? CRM.gcal.rruleShift(parsed.rrule, shift) : parsed.rrule;
      const until = untilOfLine(line);
      if (until && !!V.allDay !== mAll) line = CRM.gcal.rruleUntil(line, until, !!V.allDay);
    }
    if (line) { b.recurrence = [line].concat(parsed.extra); u.recurrence = rec; }
    if (!Object.keys(b).length) return null;
    await CRM.gcal.patchEvent(cal, g.rid, b, o.send || null);
    return () => CRM.gcal.run(() => CRM.gcal.patchEvent(cal, g.rid, u, o.send || null));
  }

  /** «Цю й наступні»: стара серія закінчується напередодні, з цього заняття — нова. Повертає «Скасувати». */
  async function gSeriesFollowing(g, m, V, o, master, d) {
    const cal = g.cal;
    const first = masterDay(master);
    const occ = occDay(g, m);
    if (occ <= first) return gSeriesAll(g, m, V, o, master, d);
    const mAll = masterAllDay(master);
    const rec = Array.isArray(master.recurrence) ? master.recurrence : [];
    const parsed = CRM.gcal.parseRecurrence(rec, first);
    if (!parsed.rrule) return gSeriesAll(g, m, V, o, master, d);
    let line;
    if (o.ruleChanged && o.rule) line = CRM.gcal.buildRRule(o.rule, !!V.allDay);
    else {
      line = parsed.rrule;
      if (parsed.parts.COUNT) {
        if (!parsed.rule) throw Object.assign(new Error('Правило повтору цієї серії складне — «Цю й наступні» зроби в самому Google Календарі.'), { code: 'complex' });
        line = CRM.gcal.rruleCount(line, parsed.rule.count - countBefore(parsed.rule, first, occ));
      }
      const shift = D.diffDays(m.date, V.date);
      if (shift % 7 && parsed.parts.BYDAY) line = CRM.gcal.rruleShift(line, shift);
      const until = untilOfLine(line);
      if (until && !!V.allDay !== mAll) line = CRM.gcal.rruleUntil(line, until, !!V.allDay);
    }
    const nb = gCopy(master, false);
    Object.assign(nb, d.body);
    Object.assign(nb, cleanTimes(CRM.gcal.timesBody(V, (master.start && master.start.timeZone) || CRM.gcal.calendarTz(cal))));
    nb.recurrence = [line];
    const cut = [CRM.gcal.rruleUntil(parsed.rrule, D.addDays(occ, -1), mAll)].concat(parsed.extra);
    await CRM.gcal.patchEvent(cal, g.rid, { recurrence: cut }, o.send || null);
    let created;
    try {
      created = await CRM.gcal.insertEvent(cal, nb, o.send || null);
    } catch (e) {
      // Нову серію не створено — повернути стару як була
      try { await CRM.gcal.patchEvent(cal, g.rid, { recurrence: rec }); } catch (x) { /* покаже перевірка */ }
      throw e;
    }
    return () => CRM.gcal.run(async () => {
      await CRM.gcal.deleteEvent(cal, created.id, o.send || null);
      await CRM.gcal.patchEvent(cal, g.rid, { recurrence: rec }, o.send || null);
    });
  }

  /**
   * Зберегти зміну події Google. g — подія з кешу, m — її поля (toModel), V — нові поля.
   * o: { scope: 'one' | 'following' | 'all', rule, ruleChanged, send, master }.
   * → { ok, undo, nothing } або { ok: false } (подія лишається як була).
   */
  async function saveGoogle(g, m, V, o) {
    const cal = g.cal;
    const d = gDiff(g, m, V);
    if (!g.rid || o.scope === 'one') {
      const b = Object.assign({}, d.body);
      const u = Object.assign({}, d.back);
      if (d.timeCh) { Object.assign(b, CRM.gcal.timesBody(V, g.tz || CRM.gcal.calendarTz(cal))); Object.assign(u, gStartEnd(g)); }
      if (!Object.keys(b).length) return { ok: true, nothing: true };
      const r = await CRM.gcal.run(() => CRM.gcal.patchEvent(cal, g.id, b, o.send || null));
      if (!r.ok) return r;
      return { ok: true, undo: () => CRM.gcal.run(() => CRM.gcal.patchEvent(cal, g.id, u, o.send || null)) };
    }
    if (!d.timeCh && !Object.keys(d.body).length && !o.ruleChanged) return { ok: true, nothing: true };
    const r = await CRM.gcal.run(async () => {
      const master = o.master || await CRM.gcal.getEvent(cal, g.rid);
      return o.scope === 'all' ? gSeriesAll(g, m, V, o, master, d) : gSeriesFollowing(g, m, V, o, master, d);
    });
    if (!r.ok) return r;
    return r.value ? { ok: true, undo: r.value } : { ok: true, nothing: true };
  }

  function gWhen(V) {
    if (V.allDay) return V.endDate ? spanText(V.date, V.endDate) : `${dayShort(V.date)}, весь день`;
    return `${dayShort(V.date)}, ${whenText(V)}`;
  }

  /** Перетягування події Google: інший час (сітка), тривалість (нижній край) або інший день (місяць, «весь день»). */
  async function moveGoogle(it, ch, kind) {
    const g = it.gev;
    const m = CRM.gcal.toModel(g);
    const V = Object.assign({}, m);
    if (ch.shift != null) {
      V.date = D.addDays(m.date, ch.shift);
      if (m.endDate) V.endDate = D.addDays(m.endDate, ch.shift);
    }
    if (ch.date) V.date = ch.date;
    if (ch.start) V.start = ch.start;
    if (ch.dur) V.dur = ch.dur;
    let scope = 'one';
    if (g.rid) {
      scope = await chooseScope({ mode: 'edit', allowOne: true, inst: { date: it.date }, google: true });
      if (!scope) { CRM.router.rerender(); return; }
    }
    const send = await askGuests(g);
    if (send === null) { CRM.router.rerender(); return; }
    const res = await saveGoogle(g, m, V, { scope, send });
    if (!res.ok || res.nothing) { CRM.router.rerender(); return; }
    const title = m.title || 'Без назви';
    let text;
    if (scope === 'all') text = `«${title}» — змінено всі заняття серії`;
    else if (scope === 'following') text = `«${title}» — змінено з ${dayShort(occDay(g, m))} і далі`;
    else if (kind === 'resize') text = `«${title}»${g.rid ? ' (лише цього разу)' : ''}: ${whenText(V)} (${durText(V.dur)})`;
    else text = `«${title}» перенесено${g.rid ? ' лише цього разу' : ''}: ${gWhen(V)}`;
    ui.toast(text + ' · Google Календар', { type: 'success', action: { label: 'Скасувати', onClick: () => res.undo() } });
  }

  /** Нова подія в Google. V — поля форми, rule — повтор (або null). Повертає подію з Google (або null). */
  async function createGoogle(V, rule, calId, opts) {
    const o = opts || {};
    const cal = calId || defaultGCal();
    if (!cal) { ui.toast('Немає календаря Google, у який можна додати подію.', { type: 'error' }); return null; }
    const body = Object.assign({ summary: V.title || '' }, cleanTimes(CRM.gcal.timesBody(V, CRM.gcal.calendarTz(cal))));
    if (V.note) body.description = V.note;
    if (V.location) body.location = V.location;
    if (V.gremind !== undefined && V.gremind !== 'default' && V.gremind !== 'custom' && !V.allDay) body.reminders = CRM.gcal.remindBody(V.gremind);
    if (V.gcolor) body.colorId = V.gcolor;
    if (rule) body.recurrence = [CRM.gcal.buildRRule(rule, !!V.allDay)];
    const r = await CRM.gcal.run(() => CRM.gcal.insertEvent(cal, body));
    if (!r.ok) { if (o.onCancel && r.cancelled) o.onCancel(); return null; }
    lsSet('crm.cal.gcal', cal);
    const created = r.value;
    if (!o.quiet) {
      const se = V.allDay && V.endDate ? spanText(V.date, V.endDate) : gWhen(V);
      ui.toast(`Подію додано в ${gWhere(cal)}: ${se}${rule ? ' · ' + ruleText(rule, V.date) : ''}`, {
        type: 'success', action: { label: 'Скасувати', onClick: () => CRM.gcal.run(() => CRM.gcal.deleteEvent(cal, created.id)) }
      });
    }
    return created;
  }

  /** Копія події Google у тому самому календарі. ch: { date, start } або { shift } (днів). */
  async function copyGoogle(g, ch) {
    const m = CRM.gcal.toModel(g);
    const V = Object.assign({}, m);
    if (ch && ch.shift != null) { V.date = D.addDays(m.date, ch.shift); if (m.endDate) V.endDate = D.addDays(m.endDate, ch.shift); }
    if (ch && ch.date) { if (m.endDate) V.endDate = D.addDays(m.endDate, D.diffDays(m.date, ch.date)); V.date = ch.date; }
    if (ch && ch.start) V.start = ch.start;
    if (!V.allDay && toMin(V.start) + (Number(V.dur) || 60) > DAY_MIN) V.dur = Math.max(SNAP, DAY_MIN - toMin(V.start));
    const body = Object.assign({ summary: m.title || '' }, cleanTimes(CRM.gcal.timesBody(V, g.tz || CRM.gcal.calendarTz(g.cal))));
    if (g.desc) body.description = g.desc;
    if (g.location) body.location = g.location;
    if (g.rem !== undefined && g.rem !== 'default') body.reminders = remindOrig(g);
    if (g.color) body.colorId = g.color;
    const r = await CRM.gcal.run(() => CRM.gcal.insertEvent(g.cal, body));
    if (!r.ok) { CRM.router.rerender(); return null; }
    const created = r.value;
    ui.toast(`«${m.title || 'Без назви'}» скопійовано: ${gWhen(V)} · Google Календар`, {
      type: 'success', duration: 8000,
      action: { label: 'Скасувати', onClick: () => CRM.gcal.run(() => CRM.gcal.deleteEvent(g.cal, created.id)) }
    });
    return created;
  }
  /** Подія Google з кешу за id (після створення — щоб одразу відкрити). */
  function gFind(cal, id) {
    const c = CRM.store.getSetting('gcalCache', null);
    return c && Array.isArray(c.events) ? c.events.find((e) => e.cal === cal && e.id === id) || null : null;
  }

  /** Видалити подію Google (для заняття серії — «Лише цю / Цю й наступні / Усі»). Повертає true, якщо видалено. */
  async function deleteGoogle(g, dlg) {
    const cal = g.cal;
    const m = CRM.gcal.toModel(g);
    const title = m.title || 'Без назви';
    const day = dayShort(m.date);
    if (g.rid) {
      const scope = await chooseScope({ mode: 'delete', allowOne: true, inst: { date: m.date }, google: true });
      if (!scope) return false;
      const send = await askGuests(g, true);
      if (send === null) return false;
      if (dlg) dlg.close('delete');
      if (scope === 'one') {
        const r = await CRM.gcal.run(() => CRM.gcal.patchEvent(cal, g.id, { status: 'cancelled' }, send || null));
        if (!r.ok) return false;
        ui.toast(`«${title}»: ${day} — скасовано в Google Календарі`, {
          action: { label: 'Скасувати', onClick: () => CRM.gcal.run(() => CRM.gcal.patchEvent(cal, g.id, { status: 'confirmed' }, send || null)) }
        });
        return true;
      }
      const r = await CRM.gcal.run(async () => {
        const master = await CRM.gcal.getEvent(cal, g.rid);
        const first = masterDay(master);
        const occ = occDay(g, m);
        const rec = Array.isArray(master.recurrence) ? master.recurrence : [];
        const parsed = CRM.gcal.parseRecurrence(rec, first);
        if (scope === 'following' && occ > first && parsed.rrule) {
          const cut = [CRM.gcal.rruleUntil(parsed.rrule, D.addDays(occ, -1), masterAllDay(master))].concat(parsed.extra);
          await CRM.gcal.patchEvent(cal, g.rid, { recurrence: cut }, send || null);
          return { text: `«${title}»: заняття з ${dayShort(occ)} видалено з Google Календаря`, undo: () => CRM.gcal.run(() => CRM.gcal.patchEvent(cal, g.rid, { recurrence: rec }, send || null)) };
        }
        await CRM.gcal.deleteEvent(cal, g.rid, send || null);
        return { text: `Серію «${title}» видалено з Google Календаря`, undo: () => CRM.gcal.run(() => CRM.gcal.insertEvent(cal, gCopy(master, true), 'none')) };
      });
      if (!r.ok) return false;
      ui.toast(r.value.text, { action: { label: 'Скасувати', onClick: () => r.value.undo() } });
      return true;
    }
    const ok = await ui.confirm({
      title: 'Видалити подію з Google Календаря?',
      message: `«${title}» зникне з Google Календаря (і на телефоні). У Кошик CRM вона не потрапляє — «Скасувати» в повідомленні одразу після видалення поверне її.`,
      confirmText: 'Видалити', danger: true
    });
    if (!ok) return false;
    const send = await askGuests(g, true);
    if (send === null) return false;
    if (dlg) dlg.close('delete');
    const r = await CRM.gcal.run(async () => {
      const full = await CRM.gcal.getEvent(cal, g.id);
      await CRM.gcal.deleteEvent(cal, g.id, send || null);
      return full;
    });
    if (!r.ok) return false;
    ui.toast(`«${title}» видалено з Google Календаря`, {
      action: { label: 'Скасувати', onClick: () => CRM.gcal.run(() => CRM.gcal.insertEvent(cal, gCopy(r.value, true), 'none')) }
    });
    return true;
  }

  /** Відкрити подію Google: форма CRM, якщо змінювати можна, інакше — віконце з поясненням. */
  function openGoogle(g, date) {
    if (!g) return null;
    const info = CRM.gcal.editInfo ? CRM.gcal.editInfo(g) : { ok: false };
    if (!info.ok) return showGoogle(g, info.why);
    return openEditor(null, null, date || null, { gev: g });
  }

  // ---------- Відкрити пункт ----------
  function openItem(it) {
    // Урок з «Репетиторства» — вікно уроку (план, звіт); змінити подію — звідти
    if (it.kind === 'own' && it.lesson && CRM.tutor) CRM.tutor.openLessonOn(it.ev.studentId, it.date);
    else if (it.kind === 'own') openEditor(it.ev.id, null, it.ev.occ || null);
    else if (it.kind === 'task') CRM.tasks.openTask(it.task.id);
    else if (it.kind === 'gcal') openGoogle(it.gev, it.date);
    else if (it.onOpen) it.onOpen();
  }

  /** Подія Google, яку змінити з CRM не можна (why — чому): лише перегляд і «Відкрити в Google». */
  function showGoogle(g, why) {
    const calName = CRM.gcal.calendarName(g.cal);
    let when;
    if (g.allDay) {
      const last = D.addDays(g.end, -1);
      when = last > g.start ? `${fmt.date(g.start)} – ${fmt.date(last)}, весь день` : `${capitalize(fmt.dateLong(g.start))}, весь день`;
    } else {
      const sd = D.toKyivDate(g.start);
      const ed = D.toKyivDate(new Date(Math.max(Date.parse(g.end) - 1, Date.parse(g.start))));
      when = sd === ed
        ? `${capitalize(fmt.dateLong(sd))}, ${CRM.gcal.hhmm(g.start)}–${CRM.gcal.hhmm(g.end)}`
        : `${fmt.dateTime(g.start)} – ${fmt.dateTime(g.end)}`;
    }
    const rows = [
      h('div', { class: 'kal-gd-row' }, CRM.icon('clock', { size: 'sm' }), h('span', null, when)),
      g.location ? h('div', { class: 'kal-gd-row' }, CRM.icon('flag', { size: 'sm' }), h('span', null, g.location)) : null,
      h('div', { class: 'kal-gd-row' }, CRM.icon('calendar', { size: 'sm' }), h('span', null, calName ? `Google Календар · ${calName}` : 'Google Календар · основний')),
      g.tentative ? h('div', { class: 'kal-gd-row' }, CRM.icon('info', { size: 'sm' }), h('span', null, 'Участь під питанням')) : null
    ];
    const dlg = ui.modal({
      title: g.title, size: 'sm', center: true, className: 'kal-gdetail',
      body: h('div', { class: 'stack', style: { gap: '12px' } },
        h('div', { class: 'kal-gd' }, rows),
        h('div', { class: 'callout' }, CRM.icon('info'), h('span', null, why || 'Подія з Google Календаря: тут її видно, а змінити чи видалити можна лише в самому Google Календарі.'))),
      footer: [
        ui.button({ label: 'Закрити', onClick: () => dlg.close('button') }),
        g.link ? ui.button({ label: 'Відкрити в Google', icon: 'external', variant: 'primary', onClick: () => { CRM.gcal.openEvent(g); dlg.close('button'); } }) : null
      ]
    });
  }

  // ---------- Вибір категорії ----------
  /** Кнопки категорій; allowNew — ще й «+ Нова» (створити категорію просто з форми). */
  function catPicker(current, onPick, compact, allowNew) {
    const wrap = h('div', { class: 'kal-cats' + (compact ? ' compact' : ''), role: 'radiogroup', 'aria-label': 'Категорія' });
    let val = current;
    const pick = (id) => { val = id; draw(); onPick(id); };
    function draw() {
      const list = categories();
      ui.mount(wrap, list.map((c) => h('button', {
        type: 'button', role: 'radio', class: 'kal-cat' + (val === c.id ? ' active' : ''), 'aria-checked': val === c.id ? 'true' : 'false',
        title: c.label, 'aria-label': c.label, dataset: { cat: c.id }, style: { '--c': CRM.dict.categoryColor(c.color) },
        onClick: () => pick(c.id)
      }, h('span', { class: 'kal-cat-dot' }), compact ? null : h('span', null, c.label))),
      allowNew && list.length < CATS_MAX ? h('button', {
        type: 'button', class: 'kal-cat kal-cat-new', title: 'Нова категорія', 'aria-label': 'Нова категорія',
        onClick: (e) => newCategory(e.currentTarget, pick)
      }, CRM.icon('plus', { size: 'sm' }), h('span', null, 'Нова')) : null);
    }
    draw();
    return wrap;
  }

  // ---------- Свої категорії ----------
  const cleanCat = (s) => String(s || '').replace(/\s+/g, ' ').trim().slice(0, CAT_MAX);
  const sameName = (a, b) => CRM.utils.normalize(a) === CRM.utils.normalize(b);
  function nameTaken(label, exceptId) { return categories().some((c) => c.id !== exceptId && sameName(c.label, label)); }

  function swatches(value, onPick) {
    const wrap = h('div', { class: 'swatches kal-cat-swatches', role: 'radiogroup', 'aria-label': 'Колір' });
    const draw = () => ui.mount(wrap, CRM.dict.categoryColors.map((c) => h('button', {
      type: 'button', role: 'radio', class: 'swatch' + (c.id === value ? ' active' : ''), 'aria-checked': c.id === value ? 'true' : 'false',
      style: { '--sw': CRM.dict.categoryColor(c.id) }, title: c.name, 'aria-label': c.name, dataset: { color: c.id },
      onClick: () => { value = c.id; draw(); onPick(c.id); }
    })));
    draw();
    return wrap;
  }

  /** Віконце «Нова категорія»: назва й колір. onDone(id) — після збереження. */
  function newCategory(anchor, onDone) {
    const used = new Set(categories().map((c) => c.color));
    let color = (CRM.dict.categoryColors.find((c) => !used.has(c.id)) || CRM.dict.categoryColors[0]).id;
    const nameIn = ui.input({ placeholder: 'Наприклад, Подорожі', maxlength: CAT_MAX, 'aria-label': 'Назва нової категорії', class: 'input kal-newcat-name' });
    const err = h('div', { class: 'kal-quick-err', role: 'alert' });
    async function add() {
      const label = cleanCat(nameIn.value);
      if (!label) { err.textContent = 'Вкажи назву категорії'; nameIn.focus(); return; }
      if (nameTaken(label)) { err.textContent = 'Така категорія вже є'; nameIn.focus(); return; }
      if (categories().length >= CATS_MAX) { err.textContent = `Можна мати до ${CATS_MAX} категорій`; return; }
      const list = categories().slice();
      const id = 'c-' + CRM.utils.uid();
      const at = list.findIndex((c) => c.id === OTHER);   // нові — перед «Інше»
      list.splice(at < 0 ? list.length : at, 0, { id, label, color });
      pop.close('saved');
      await saveCategories(list);
      ui.toast(`Категорію «${label}» додано`, { type: 'success' });
      if (onDone) onDone(id);
    }
    nameIn.addEventListener('input', () => { err.textContent = ''; });
    nameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    const pop = ui.popover(anchor, h('div', { class: 'kal-newcat' },
      h('div', { class: 'kal-pick-head' }, 'Нова категорія'),
      nameIn,
      swatches(color, (v) => { color = v; }),
      err,
      h('div', { class: 'kal-quick-actions' },
        ui.button({ label: 'Скасувати', size: 'sm', variant: 'ghost', onClick: () => pop.close('cancel') }),
        ui.button({ label: 'Додати', size: 'sm', variant: 'primary', className: 'kal-newcat-add', onClick: add }))),
    { align: 'start', className: 'kal-newcat-pop' });
    nameIn.focus({ preventScroll: true });
    return pop;
  }

  async function renameCategory(id, value) {
    const label = cleanCat(value);
    const c = categories().find((x) => x.id === id);
    if (!c || !label || label === c.label) return false;
    if (nameTaken(label, id)) { ui.toast('Така категорія вже є', { type: 'error' }); return false; }
    await saveCategories(categories().map((x) => (x.id === id ? Object.assign({}, x, { label }) : x)));
    ui.toast(`Категорію перейменовано: «${label}»`, { type: 'success' });
    return true;
  }
  async function setCategoryColor(id, color) {
    await saveCategories(categories().map((x) => (x.id === id ? Object.assign({}, x, { color }) : x)));
  }
  /** Колір копій цієї категорії в Google: id 1–11 або null — «Авто» (найближчий до кольору категорії). */
  async function setCategoryGColor(id, gcolor) {
    const v = GCOLOR_RE.test(String(gcolor || '')) ? String(gcolor) : null;
    await saveCategories(categories().map((x) => (x.id === id ? Object.assign({}, x, { gcolor: v }) : x)));
  }
  /** Колір Google для категорії: { id, name, hex, auto } (для дублювання в Google; null — кольорів Google немає). */
  function categoryGColor(id) {
    const G = CRM.gcal;
    if (!G || !G.GCOLORS) return null;
    const c = categoryOf(id);
    const def = CRM.dict.get('categoryColors', c.color);
    const gid = c.gcolor || (def ? G.nearestColor(def.light) : null);
    const g = G.GCOLORS.find((x) => x.id === gid);
    return g ? { id: g.id, name: g.name, hex: g.hex, auto: !c.gcolor } : null;
  }
  /** Події, у яких є ця категорія (сама подія або окремий день серії). */
  function eventsWithCat(id) {
    return CRM.store.list('events').filter((e) => categoryOf(e.cat).id === id ||
      Object.keys(e.overrides || {}).some((k) => e.overrides[k] && e.overrides[k].cat !== undefined && categoryOf(e.overrides[k].cat).id === id));
  }
  /** Вікно «Куди перенести події?» → id категорії або null (передумали). */
  function askTarget(c, n) {
    return new Promise((resolve) => {
      let result = null;
      const opts = categories().filter((x) => x.id !== c.id);
      const sel = ui.select(opts.map((x) => ({ value: x.id, label: x.label })), { value: OTHER, 'aria-label': 'Куди перенести події', class: 'select kcat-target' });
      const dlg = ui.modal({
        title: `Видалити категорію «${c.label}»?`, size: 'sm', center: true, className: 'kcat-del-modal',
        body: h('div', { class: 'form-stack' },
          h('p', null, `У ній ${fmt.count(n, ['подія', 'події', 'подій'])}. Події лишаться — вибери, у яку категорію їх перенести.`),
          ui.field({ label: 'Перенести в', input: sel })),
        footer: [
          ui.button({ label: 'Скасувати', onClick: () => dlg.close('cancel') }),
          ui.button({ label: 'Видалити категорію', variant: 'danger', className: 'kcat-del-ok', onClick: () => { result = sel.value; dlg.close('confirm'); } })
        ],
        onClose: () => resolve(result)
      });
    });
  }
  /** Видалити категорію; її події переходять в іншу (з «Скасувати»). */
  async function deleteCategory(id) {
    const c = categories().find((x) => x.id === id);
    if (!c || id === OTHER) return false;
    const evs = eventsWithCat(id);
    let target = OTHER;
    if (evs.length) {
      target = await askTarget(c, evs.length);
      if (!target) return false;
    } else {
      const ok = await ui.confirm({ title: `Видалити категорію «${c.label}»?`, message: 'Подій у ній немає.', confirmText: 'Видалити', danger: true });
      if (!ok) return false;
    }
    const beforeList = categories().map((x) => Object.assign({}, x));
    const snap = evs.map((e) => ({ id: e.id, cat: e.cat, overrides: e.overrides ? CRM.utils.deepClone(e.overrides) : undefined }));
    const changed = evs.map((e) => {
      const x = CRM.utils.deepClone(e);
      if (categoryOf(x.cat).id === id) x.cat = target;
      Object.keys(x.overrides || {}).forEach((k) => {
        const o = x.overrides[k];
        if (o && o.cat !== undefined && categoryOf(o.cat).id === id) o.cat = target;
      });
      return x;
    });
    if (changed.length) await CRM.store.saveMany('events', changed);
    await saveCategories(beforeList.filter((x) => x.id !== id));
    const wasHidden = hiddenCats().has(id);
    if (wasHidden) setHiddenCat(id, false);
    if (lsGet('crm.cal.cat', '') === id) lsSet('crm.cal.cat', target);
    ui.toast(`Категорію «${c.label}» видалено${changed.length ? ` · події — в «${categoryName(target)}»` : ''}`, {
      type: 'success', duration: 8000,
      action: {
        label: 'Скасувати',
        onClick: async () => {
          const back = snap.map((s) => {
            const cur = CRM.store.get('events', s.id);
            if (!cur) return null;
            const x = Object.assign({}, cur, { cat: s.cat });
            if (s.overrides !== undefined) x.overrides = s.overrides;
            return x;
          }).filter(Boolean);
          if (back.length) await CRM.store.saveMany('events', back);
          await saveCategories(beforeList);
          if (wasHidden) setHiddenCat(id, true);
          ui.toast('Категорію повернуто');
        }
      }
    });
    return true;
  }

  /** Вікно «Категорії подій»: назва, колір, нова, видалити. */
  function openCategories() {
    closeQuick();
    const body = h('div', { class: 'lbl-manage kcat-manage' });
    function counts() {
      const m = new Map();
      CRM.store.list('events').forEach((e) => { const id = categoryOf(e.cat).id; m.set(id, (m.get(id) || 0) + 1); });
      return m;
    }
    function colorMenu(anchor, c) {
      const pop = ui.popover(anchor, h('div', { class: 'lbl-colors' },
        swatches(c.color, async (v) => { pop.close(); await setCategoryColor(c.id, v); })),
      { align: 'start', className: 'lbl-colors-pop' });
    }
    // Колір копій у Google (коли ввімкнено дублювання): «Авто» або один з 11 кольорів Google
    const mirrorOn = () => !!(CRM.gmirror && CRM.gmirror.on && CRM.gmirror.on() && CRM.gcal && CRM.gcal.GCOLORS);
    function gColorMenu(anchor, c) {
      const G = CRM.gcal;
      const def = CRM.dict.get('categoryColors', c.color);
      const near = G.GCOLORS.find((x) => x.id === (def ? G.nearestColor(def.light) : null));
      const btn = (v, label, color, withText) => h('button', {
        type: 'button', role: 'radio', class: 'kal-gcolor' + (withText ? ' kal-gcolor-cal' : '') + ((c.gcolor || '') === v ? ' active' : ''),
        'aria-checked': (c.gcolor || '') === v ? 'true' : 'false', 'aria-label': label, title: label, dataset: { gcolor: v }, style: { '--c': color },
        onClick: async () => { pop.close(); await setCategoryGColor(c.id, v || null); }
      }, h('span', { class: 'kal-cat-dot' }), withText ? h('span', null, label) : null);
      const pop = ui.popover(anchor, h('div', { class: 'lbl-colors kcat-gcolors' },
        h('div', { class: 'kal-pick-head' }, `Колір у Google — «${c.label}»`),
        h('div', { class: 'kal-gcolors', role: 'radiogroup', 'aria-label': 'Колір у Google' },
          btn('', near ? `Авто: ${near.name}` : 'Авто', near ? G.readable(near.hex) : 'var(--text-3)', true),
          G.GCOLORS.map((x) => btn(x.id, x.name, G.readable(x.hex), false))),
        h('div', { class: 'subtle kcat-ghint' }, 'Таким кольором будуть копії подій цієї категорії в Google Календарі. «Авто» — найближчий до кольору категорії в CRM.')),
      { align: 'start', className: 'lbl-colors-pop kcat-gcolors-pop' });
    }
    function render() {
      const list = categories();
      const cnt = counts();
      const addBtn = list.length < CATS_MAX ? ui.button({ label: 'Нова категорія', icon: 'plus', size: 'sm', variant: 'ghost', className: 'kcat-add' }) : null;
      if (addBtn) addBtn.addEventListener('click', () => newCategory(addBtn, null));
      ui.mount(body,
        h('p', { class: 'subtle lbl-hint' }, 'Назва й колір змінюються одразу для всіх подій цієї категорії. «Інше» видалити не можна — туди потрапляють події без категорії.' +
          (mirrorOn() ? ' Кружечок з «G» — колір копій цієї категорії в Google Календарі.' : '')),
        list.map((c) => {
          const sw = h('button', {
            type: 'button', class: 'lbl-swatch', style: { '--lbl': CRM.dict.categoryColor(c.color) },
            title: 'Колір категорії', 'aria-label': `Колір категорії «${c.label}»`, onClick: () => colorMenu(sw, c)
          });
          const nameIn = h('input', { class: 'input input-sm lbl-name', value: c.label, maxlength: CAT_MAX, 'aria-label': `Назва категорії «${c.label}»` });
          nameIn.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); nameIn.blur(); }
            if (e.key === 'Escape') nameIn.value = c.label;
          });
          nameIn.addEventListener('change', async () => {
            const v = cleanCat(nameIn.value);
            if (!v || !(await renameCategory(c.id, v))) nameIn.value = c.label;
          });
          let gsw = null;
          if (mirrorOn()) {
            const gc = categoryGColor(c.id);
            const gl = gc ? `${gc.name}${gc.auto ? ' (авто)' : ''}` : 'Авто';
            gsw = h('button', {
              type: 'button', class: 'kcat-gsw' + (gc && !gc.auto ? ' chosen' : ''), style: { '--c': gc ? CRM.gcal.readable(gc.hex) : 'var(--text-3)' },
              title: `Колір у Google: ${gl}`, 'aria-label': `Колір у Google для «${c.label}»: ${gl}`, dataset: { gcolor: gc ? gc.id : '' },
              onClick: () => gColorMenu(gsw, c)
            }, 'G');
          }
          return h('div', { class: 'lbl-row kcat-row', dataset: { cat: c.id } },
            sw, nameIn, gsw,
            h('span', { class: 'lbl-count subtle' }, fmt.count(cnt.get(c.id) || 0, ['подія', 'події', 'подій'])),
            c.id === OTHER
              ? h('span', { class: 'kcat-lock', title: '«Інше» видалити не можна' }, CRM.icon('shield', { size: 'sm' }))
              : ui.button({ icon: 'trash', iconOnly: true, size: 'sm', variant: 'ghost', title: 'Видалити категорію', className: 'lbl-del', onClick: () => deleteCategory(c.id) }));
        }),
        addBtn);
    }
    render();
    const off = CRM.store.on(['events', 'settings'], () => {
      const a = document.activeElement;
      if (a && body.contains(a) && a.classList.contains('lbl-name')) return;
      render();
    });
    const dlg = ui.modal({
      title: 'Категорії подій', size: 'sm', className: 'lbl-modal kcat-modal', body,
      footer: [ui.button({ label: 'Готово', variant: 'primary', onClick: () => dlg.close('button') })],
      onClose: () => off()
    });
    return dlg;
  }

  // ---------- Швидке додавання ----------
  /** preset: { date, allDay, start, dur } */
  function quickAdd(anchor, preset, onClose) {
    closeQuick();
    let cat = lastCat();
    let kind = CRM.tasks && CRM.tasks.create ? lastKind() : 'event';
    // Подія — у «Мою CRM» чи в Google Календар (пункт 12; вибір памʼятається)
    const gList = newTargets();
    let target = gList.length ? targetPref() : 'crm';
    const targetSeg = gList.length ? h('div', { class: 'segmented kal-target kal-target-quick', role: 'radiogroup', 'aria-label': 'Куди додати подію' }) : null;
    function drawTarget() {
      if (!targetSeg) return;
      ui.mount(targetSeg, [['crm', 'Моя CRM'], ['google', 'Google']].map(([v, l]) => h('button', {
        type: 'button', role: 'radio', class: v === target ? 'active' : '', 'aria-checked': v === target ? 'true' : 'false', dataset: { target: v },
        title: v === 'google' ? `Додати в ${gWhere(defaultGCal())}` : 'Додати в CRM',
        onClick: () => { target = v; lsSet('crm.cal.target', v); drawTarget(); titleIn.focus({ preventScroll: true }); }
      }, l)));
      targetSeg.hidden = kind === 'task';
      cats.hidden = kind === 'task' || target === 'google';
    }
    const titleIn = ui.input({ placeholder: 'Назва події', maxlength: 200, 'aria-label': 'Назва події' });
    const timeIn = preset.allDay ? ui.timeInput({ ariaLabel: 'Час початку (необовʼязково)' }) : null;
    const errEl = h('div', { class: 'kal-quick-err', role: 'alert' });
    const whenText0 = preset.allDay
      ? `${dayShort(preset.date)} · весь день`
      : `${dayShort(preset.date)} · ${preset.start}–${fromMin(Math.min(DAY_MIN, toMin(preset.start) + preset.dur))}`;
    const whenEl = h('span', null, whenText0);
    const cats = catPicker(cat, (v) => { cat = v; }, true);
    const kindSeg = h('div', { class: 'segmented kal-kind', role: 'radiogroup', 'aria-label': 'Що додати' });
    function setKind(k) {
      kind = k;
      lsSet('crm.cal.kind', k);
      ui.mount(kindSeg, [['event', 'Подія'], ['task', 'Задача']].map(([id, label]) => h('button', {
        type: 'button', role: 'radio', class: id === k ? 'active' : '', 'aria-checked': id === k ? 'true' : 'false',
        onClick: () => { setKind(id); titleIn.focus({ preventScroll: true }); }
      }, label)));
      const isTask = k === 'task';
      titleIn.placeholder = isTask ? 'Назва задачі' : 'Назва події';
      titleIn.setAttribute('aria-label', isTask ? 'Назва задачі' : 'Назва події');
      cats.hidden = isTask;
      whenEl.textContent = isTask && preset.allDay ? `${dayShort(preset.date)} · у «План дня»` : whenText0;
      errEl.textContent = '';
      if (targetSeg) drawTarget();
    }
    setKind(kind);

    function values() {
      const title = titleIn.value.trim();
      const out = { title, date: preset.date, allDay: !!preset.allDay, start: preset.start || null, dur: preset.dur || null, cat };
      if (timeIn) {
        const t = timeIn.parseTime(timeIn.value);
        if (t === null) return { error: 'Час — у форматі ГГ:ХХ, напр., 09:30' };
        if (t) { out.allDay = false; out.start = t; out.dur = Math.min(60, DAY_MIN - toMin(t)) || SNAP; }
      }
      if (out.allDay) { out.start = null; out.dur = null; }
      out.remind = out.allDay ? null : 15;
      return out;
    }
    async function add() {
      const v = values();
      if (v.error) { errEl.textContent = v.error; return; }
      if (!v.title) { errEl.textContent = kind === 'task' ? 'Вкажи назву задачі' : 'Вкажи назву події'; titleIn.focus(); return; }
      if (kind === 'task') {
        pop.close('saved');
        await addTask(v.title, { date: v.date, start: v.allDay ? null : v.start, dur: preset.allDay ? null : v.dur });
        return;
      }
      if (target === 'google') {
        pop.close('saved');
        await createGoogle(Object.assign(v, { note: '', gremind: 'default' }), null, defaultGCal());
        return;
      }
      if (!canSave()) return;
      lsSet('crm.cal.cat', v.cat);
      pop.close('saved');
      await CRM.store.save('events', Object.assign(v, { note: '' }));
    }
    function more() {
      const v = values();
      pop.close('more');
      if (kind === 'task') {
        const start = v.error || v.allDay ? null : v.start;
        CRM.tasks.openNew({
          title: titleIn.value.trim(), planDate: preset.date, planStart: start, planDur: start && !preset.allDay ? v.dur : null,
          planOrder: start ? null : CRM.tasks.nextPlanOrder(preset.date)
        });
        return;
      }
      openEditor(null, Object.assign(v.error ? Object.assign({}, preset, { title: titleIn.value.trim(), cat }) : v, { target }));
    }
    titleIn.addEventListener('input', () => { errEl.textContent = ''; });
    titleIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    if (timeIn) timeIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); timeIn.dispatchEvent(new Event('change')); add(); } });

    const content = h('div', { class: 'kal-quick' },
      CRM.tasks && CRM.tasks.create ? kindSeg : null,
      targetSeg,
      h('div', { class: 'kal-quick-when' }, CRM.icon('clock', { size: 'sm' }), whenEl),
      titleIn,
      timeIn ? h('label', { class: 'kal-quick-time' }, h('span', null, 'Час'), timeIn, h('span', { class: 'subtle' }, 'необовʼязково')) : null,
      cats,
      errEl,
      h('div', { class: 'kal-quick-actions' },
        ui.button({ label: 'Детальніше', size: 'sm', variant: 'ghost', onClick: more }),
        ui.button({ label: 'Додати', size: 'sm', variant: 'primary', onClick: add })));
    const pop = ui.popover(anchor, content, {
      align: 'start', className: 'kal-quick-pop',
      onClose: () => {
        if (onClose) onClose();
        popClosed(pop);
      }
    });
    quick = pop;
    quickRoute = location.hash;
    titleIn.focus({ preventScroll: true });
    return pop;
  }

  // ---------- Форма події ----------
  function check(label, on, onToggle) {
    const box = h('span', { class: 'task-check small' + (on ? ' checked' : '') }, CRM.icon('check', { size: 'sm' }));
    const btn = h('button', { type: 'button', class: 'kal-check', role: 'checkbox', 'aria-checked': on ? 'true' : 'false' }, box, h('span', null, label));
    btn.addEventListener('click', () => {
      on = !on;
      box.classList.toggle('checked', on);
      btn.setAttribute('aria-checked', on ? 'true' : 'false');
      onToggle(on);
    });
    return btn;
  }

  /**
   * Відкрити форму: id — наявна подія; preset — значення нової;
   * occ — для серії: початкова дата повтору, який відкрили (інакше — найближчий).
   */
  function openEditor(id, preset, occ, gx) {
    // Подія Google (пункт 12): та сама форма, а зміни йдуть у Google Календар
    const G = gx && gx.gev ? gx.gev : null;
    const gm = G ? CRM.gcal.toModel(G) : null;
    if (G) id = null;
    const cur = id ? CRM.store.get('events', id) : null;
    if (id && !cur) { ui.toast('Цієї події більше немає', { type: 'error' }); return null; }
    if (cur && cur.deletedAt) { ui.toast('Подія в Кошику — віднови її, щоб відкрити'); return null; }
    closeQuick();
    const series0 = cur && isSeries(cur) ? cur : null;
    let inst = null;   // повтор серії, який редагуємо
    if (series0) {
      let o = occ && isOccurrence(series0, occ) && !skipped(series0, occ) ? occ : null;
      if (!o) { const n = nextOccurrence(series0, D.today()); o = n ? n.occ : null; }
      inst = o ? instanceOf(series0, o) : null;
    }
    const ev = gm ? Object.assign({ cat: lastCat(), remind: 15 }, CRM.utils.deepClone(gm)) : inst ? CRM.utils.deepClone(inst) : cur ? CRM.utils.deepClone(cur) : Object.assign({
      title: '', date: D.today(), allDay: false, start: '09:00', dur: 60, cat: lastCat(), remind: 15, note: ''
    }, preset || {});
    if (!ev.allDay && !ev.start) ev.allDay = true;
    if (ev.gremind === undefined) ev.gremind = 'default';
    if (ev.location === undefined) ev.location = '';
    // Де зберегти нову подію: «Моя CRM» або «Google Календар» (вибір памʼятається)
    const gList = G || cur ? [] : newTargets();
    let target = G ? 'google' : (preset && (preset.target === 'google' || preset.target === 'crm') ? preset.target : targetPref());
    if (!G && !gList.length) target = 'crm';
    let gcalId = G ? G.cal : (preset && preset.gcal && gList.some((c) => c.id === preset.gcal) ? preset.gcal : defaultGCal());
    const isG = () => target === 'google';
    // Подія Google з часом через північ: дату й час тут не змінюємо
    const lockTime = !!(G && CRM.gcal.crossesMidnight(G));
    let allDay = !!ev.allDay;
    // Категорію могли видалити (напр., на іншому пристрої) — тоді «Інше»
    let cat = ev.cat && categories().some((c) => c.id === ev.cat) ? ev.cat : ev.cat ? OTHER : lastCat();
    const s0 = ev.allDay ? 9 * 60 : evStart(ev);
    let span = ev.allDay ? 60 : evEnd(ev) - s0;

    const titleIn = ui.input({ value: ev.title, maxlength: 200, placeholder: 'Наприклад, Заняття з англійської', 'aria-label': 'Назва' });
    const fTitle = ui.field({ label: 'Назва', required: true, input: titleIn });
    let prevDate = ev.date;
    const dateIn = ui.dateInput({ value: ev.date, clearable: false, ariaLabel: 'Дата', onChange: () => { shiftEnd(); repDateChanged(); } });
    // «По» — остання дата події на кілька днів (лише «весь день» і без повторів)
    const endDateIn = ui.dateInput({
      value: spanEnd(ev), clearable: true, placeholder: 'Один день', ariaLabel: 'По яку дату (для події на кілька днів)',
      onChange: () => { fEnd.setError(null); showSpan(); }
    });
    const spanEl = h('span', { class: 'subtle kal-span-len' });
    const fEnd = ui.field({ label: 'По', input: h('div', { class: 'kal-end-row' }, endDateIn, spanEl) });
    fEnd.classList.add('kal-end-field');
    function showSpan() {
      const a = dateIn.dateValue;
      const b = endDateIn.dateValue;
      spanEl.textContent = a && b && b > a ? daysWord(D.diffDays(a, b) + 1) : '';
    }
    /** Змінили дату початку — «по» зсувається на стільки ж (тривалість та сама). */
    function shiftEnd() {
      const d = dateIn.dateValue;
      if (endDateIn.dateValue && D.isDate(prevDate) && D.isDate(d)) endDateIn.dateValue = D.addDays(endDateIn.dateValue, D.diffDays(prevDate, d));
      prevDate = d;
      showSpan();
    }
    function refreshEnd() { fEnd.hidden = !allDay || !!rp.mode; }
    const startIn = ui.timeInput({ value: fromMin(s0), ariaLabel: 'Початок' });
    const endIn = ui.timeInput({ value: fromMin(Math.min(DAY_MIN, s0 + span)), ariaLabel: 'Кінець' });
    const durEl = h('span', { class: 'kal-dur subtle' });
    const showDur = () => {
      const s = toMin(startIn.value);
      const e = toMin(endIn.value);
      durEl.textContent = s != null && e != null && e > s ? durText(e - s) : '';
    };
    startIn.addEventListener('change', () => {
      const s = toMin(startIn.value);
      if (s == null) return;
      endIn.value = fromMin(Math.min(DAY_MIN, s + span));
      showDur();
    });
    endIn.addEventListener('change', () => {
      const s = toMin(startIn.value);
      const e = toMin(endIn.value);
      if (s != null && e != null && e > s) span = e - s;
      fTimes.setError(null);
      showDur();
    });
    showDur();
    const timesRow = h('div', { class: 'kal-times-row' }, startIn, h('span', { class: 'subtle' }, '–'), endIn, durEl);
    const fTimes = ui.field({ label: 'Час', input: timesRow });
    const remindOpts = REMINDERS.slice();
    if (ev.remind != null && ev.remind !== '' && !remindOpts.some((r) => r.v === Number(ev.remind))) remindOpts.push({ v: Number(ev.remind), label: `За ${ev.remind} хв` });
    const remindSel = ui.select(remindOpts.map((r) => ({ value: r.v == null ? '' : String(r.v), label: r.label })),
      { value: ev.remind == null ? '' : String(ev.remind), 'aria-label': 'Нагадування' });
    // Дублювання в Google ввімкнено (gmirror.js) — про подію з копією нагадує Google
    const mirrored = !G && mirrorOn() && !(cur && cur.studentId);
    const fRemind = ui.field({
      label: 'Нагадування', input: remindSel,
      hint: mirrored ? 'Подія дублюється в Google Календар — нагадування надішле Google (на телефон), а CRM покаже його в дзвіночку.' : 'Приходить, лише коли CRM відкрита (вкладка може бути у фоні).'
    });
    const allDayBox = check('Весь день', allDay, (on) => {
      allDay = on;
      fTimes.hidden = on || lockTime;
      applyTarget();
      refreshEnd();
    });
    fTimes.hidden = allDay || lockTime;
    const noteIn = ui.textarea({ value: ev.note || '', rows: 3, maxlength: G ? 8000 : 2000, placeholder: 'Необовʼязково: що підготувати, посилання, адреса…', 'aria-label': 'Нотатки' });
    // Лише для Google: місце й нагадування Google (приходять від Google на телефон)
    const locIn = ui.input({ value: ev.location || '', maxlength: 200, placeholder: 'Необовʼязково: адреса чи посилання на зустріч', 'aria-label': 'Місце' });
    const fLoc = ui.field({ label: 'Місце', input: locIn });
    const gRemOpts = GREMIND.slice();
    if (typeof ev.gremind === 'number' && !gRemOpts.some((r) => r.v === ev.gremind)) gRemOpts.push({ v: ev.gremind, label: `За ${ev.gremind} хв` });
    if (ev.gremind === 'custom') gRemOpts.push({ v: 'custom', label: 'Свої нагадування Google (без змін)' });
    const gRemSel = ui.select(gRemOpts.map((r) => ({ value: String(r.v), label: r.label })), { value: String(ev.gremind), 'aria-label': 'Нагадування Google' });
    const fGRemind = ui.field({ label: 'Нагадування', input: gRemSel, hint: 'Нагадування надсилає сам Google (на телефоні — застосунок Google Календар).' });
    const gRemOf = (v) => (v === 'default' || v === 'none' || v === 'custom' ? v : Number(v));
    // Колір події Google (2026.11.15-5): «Як у календаря» або один з кольорів Google
    let gcolor = ev.gcolor || '';
    const gColorWrap = h('div', { class: 'kal-gcolors', role: 'radiogroup', 'aria-label': 'Колір' });
    function drawGColors() {
      if (!CRM.gcal.GCOLORS) return;
      const pick = (v) => { gcolor = v; drawGColors(); };
      const btn = (v, label, color, withText) => h('button', {
        type: 'button', role: 'radio', class: 'kal-gcolor' + (withText ? ' kal-gcolor-cal' : '') + (gcolor === v ? ' active' : ''),
        'aria-checked': gcolor === v ? 'true' : 'false', 'aria-label': label, title: label, dataset: { gcolor: v }, style: { '--c': color },
        onClick: () => pick(v)
      }, h('span', { class: 'kal-cat-dot' }), withText ? h('span', null, label) : null);
      ui.mount(gColorWrap, [btn('', 'Як у календаря', CRM.gcal.calColor(G ? G.cal : gcalId), true)]
        .concat(CRM.gcal.GCOLORS.map((c) => btn(c.id, c.name, CRM.gcal.readable(c.hex), false))));
    }
    drawGColors();
    const fGColor = ui.field({ label: 'Колір', input: gColorWrap });

    // --- Повторення ---
    let rule0 = series0 ? ruleOf(series0) : null;
    // Серія Google: правило береться з головної події серії (завантажується, поки форма відкрита)
    let gFirst = null;
    let gMaster = null;
    let gRuleState = G && G.rid ? 'loading' : null;   // loading | simple | complex | error
    // Для наявної серії підписи й дні тижня рахуються від її першого дня, а не від показаного повтору
    const repBase = () => (series0 ? series0.date : gFirst || (dateIn.dateValue || ev.date));
    const rp = {
      mode: presetOf(rule0, repBase()),
      every: rule0 ? rule0.every : 1,
      unit: rule0 ? rule0.freq : 'week',
      days: rule0 && rule0.days ? rule0.days.slice() : [D.weekday(repBase())],
      daysTouched: !!rule0,
      end: rule0 ? (rule0.until ? 'until' : rule0.count ? 'count' : 'never') : 'never',
      until: rule0 && rule0.until ? rule0.until : null,
      count: rule0 && rule0.count ? rule0.count : 10
    };
    const repSel = ui.select([], { 'aria-label': 'Повторення' });
    const everyIn = ui.input({ value: String(rp.every), inputmode: 'numeric', maxlength: 2, 'aria-label': 'Інтервал повтору', class: 'input kal-rep-num' });
    const unitSel = ui.select([], { 'aria-label': 'Одиниця повтору' });
    const wdays = h('div', { class: 'kal-wdays', role: 'group', 'aria-label': 'Дні тижня' });
    const endSel = ui.select([{ value: 'never', label: 'Ніколи' }, { value: 'until', label: 'До дати' }, { value: 'count', label: 'Після кількох разів' }],
      { value: rp.end, 'aria-label': 'Закінчення повтору' });
    const untilIn = ui.dateInput({
      value: rp.until || D.addMonths(ev.date, 3), clearable: false, ariaLabel: 'Повторювати до',
      onChange: (v) => { rp.until = v; fRepeat.setError(null); repSummary(); }
    });
    if (!rp.until) rp.until = untilIn.dateValue;
    const countIn = ui.input({ value: String(rp.count), inputmode: 'numeric', maxlength: 3, 'aria-label': 'Скільки разів', class: 'input kal-rep-num' });
    const countWord = h('span', { class: 'subtle' });
    const customBox = h('div', { class: 'kal-rep-custom' },
      h('div', { class: 'kal-rep-row' }, h('span', { class: 'kal-rep-lbl' }, 'Кожні'), everyIn, unitSel),
      wdays);
    const countBox = h('span', { class: 'kal-rep-row' }, countIn, countWord);
    const endBox = h('div', { class: 'kal-rep-row kal-rep-end' }, h('span', { class: 'kal-rep-lbl' }, 'Закінчення'), endSel, untilIn, countBox);
    const repSum = h('div', { class: 'kal-rep-sum' });
    const fRepeat = ui.field({ label: 'Повторення', input: repSel });
    const repErrEl = fRepeat.querySelector('.field-error');
    [customBox, endBox, repSum].forEach((x) => fRepeat.insertBefore(x, repErrEl));

    function fillRepOptions() {
      if (gRuleState && gRuleState !== 'simple') {
        ui.mount(repSel, h('option', { value: '' }, gRuleState === 'loading' ? 'Завантажую правило повтору…'
          : gRuleState === 'complex' ? 'Повторюється за правилом Google (змінити — у Google Календарі)' : 'Повторювана подія Google (правило — у Google Календарі)'));
        repSel.value = '';
        repSel.disabled = true;
        return;
      }
      repSel.disabled = false;
      const b = repBase();
      const p = D.parse(b);
      ui.mount(repSel, [
        ['', 'Не повторюється'], ['day', 'Щодня'], ['weekdays', 'Щобудня (пн–пт)'],
        ['week', `Щотижня (у ${WEEKDAYS_ACC[D.weekday(b)]})`], ['month', `Щомісяця (${p.d} числа)`],
        ['year', `Щороку (${p.d} ${CRM.MONTHS_GEN[p.m - 1]})`], ['custom', 'Свій варіант…']
      ].map(([v, l]) => h('option', { value: v }, l)));
      repSel.value = rp.mode;
    }
    function fillUnits() {
      ui.mount(unitSel, FREQS.map((f) => h('option', { value: f }, plural(rp.every, UNIT_FORMS[f]))));
      unitSel.value = rp.unit;
    }
    function drawWdays() {
      ui.mount(wdays, CRM.WEEKDAYS_SHORT.map((w, i) => h('button', {
        type: 'button', class: 'kal-wday' + (rp.days.includes(i) ? ' active' : ''), 'aria-pressed': rp.days.includes(i) ? 'true' : 'false',
        'aria-label': capitalize(CRM.WEEKDAYS[i]), title: capitalize(CRM.WEEKDAYS[i]), dataset: { wd: String(i) },
        onClick: () => {
          const on = rp.days.includes(i);
          if (on && rp.days.length === 1) return;   // хоч один день лишається
          rp.days = on ? rp.days.filter((d) => d !== i) : rp.days.concat(i).sort((a, b) => a - b);
          rp.daysTouched = true;
          fRepeat.setError(null);
          drawWdays();
          repSummary();
        }
      }, w)));
    }
    /** Правило з форми (null — не повторюється). */
    function formRule() {
      const b = repBase();
      let r;
      if (!rp.mode) return null;
      if (rp.mode === 'day') r = { freq: 'day', every: 1 };
      else if (rp.mode === 'weekdays') r = { freq: 'week', every: 1, days: [0, 1, 2, 3, 4] };
      else if (rp.mode === 'week') r = { freq: 'week', every: 1, days: [D.weekday(b)] };
      else if (rp.mode === 'month' || rp.mode === 'year') r = { freq: rp.mode, every: 1 };
      else r = { freq: rp.unit, every: rp.every, days: rp.unit === 'week' ? rp.days : null };
      if (rp.end === 'until') r.until = rp.until;
      else if (rp.end === 'count') r.count = rp.count;
      return normRule(r, b);
    }
    function repSummary() {
      countWord.textContent = plural(rp.count, ['раз', 'рази', 'разів']);
      const r = formRule();
      let s = r ? capitalize(ruleText(r, repBase())) : '';
      if (r && rule0 && (series0 || gFirst)) {
        const fb = series0 ? series0.date : gFirst;
        const first = ruleDates(fb, rule0, fb, FAR, 1)[0];
        if (first) s += ` · серія з ${fmt.date(first)}`;
      }
      repSum.textContent = s;
    }
    function repRefresh() {
      customBox.hidden = rp.mode !== 'custom';
      wdays.hidden = rp.unit !== 'week';
      endBox.hidden = !rp.mode;
      repSum.hidden = !rp.mode;
      untilIn.hidden = rp.end !== 'until';
      countBox.hidden = rp.end !== 'count';
      fillUnits();
      drawWdays();
      repSummary();
      refreshEnd();
    }
    /** Змінили дату у формі: для нової серії підписи (і день тижня, якщо дні не вибирали) — від нової дати. */
    function repDateChanged() {
      if (series0 || (G && G.rid)) return;
      if (!rp.daysTouched) rp.days = [D.weekday(repBase())];
      fillRepOptions();
      repRefresh();
    }
    /** Помилка в «Повторенні» або null. date — не раніше якої дати має бути «До дати» (null — не перевіряти). */
    function repError(date) {
      if (!rp.mode) return null;
      if (rp.mode === 'custom') {
        const n = Number(everyIn.value.trim());
        if (!Number.isInteger(n) || n < 1 || n > MAX_EVERY) return `Інтервал — ціле число від 1 до ${MAX_EVERY}`;
      }
      if (rp.end === 'until' && (!D.isDate(rp.until) || (date && rp.until < date))) return 'Дата закінчення — не раніше за дату події';
      if (rp.end === 'count') {
        const n = Number(countIn.value.trim());
        if (!Number.isInteger(n) || n < 1 || n > MAX_COUNT) return `Кількість разів — від 1 до ${MAX_COUNT}`;
      }
      return null;
    }
    repSel.addEventListener('change', () => {
      const prev = formRule();
      rp.mode = repSel.value;
      // «Свій варіант…» починається з того, що було вибрано
      if (rp.mode === 'custom' && prev) {
        rp.unit = prev.freq;
        rp.every = prev.every;
        if (prev.days) { rp.days = prev.days.slice(); rp.daysTouched = true; }
        everyIn.value = String(rp.every);
      }
      fRepeat.setError(null);
      repRefresh();
    });
    everyIn.addEventListener('input', () => {
      const n = parseInt(everyIn.value, 10);
      if (n > 0) { rp.every = Math.min(n, MAX_EVERY); fillUnits(); repSummary(); }
      fRepeat.setError(null);
    });
    unitSel.addEventListener('change', () => { rp.unit = unitSel.value; repRefresh(); });
    endSel.addEventListener('change', () => { rp.end = endSel.value; fRepeat.setError(null); repRefresh(); });
    countIn.addEventListener('input', () => {
      const n = parseInt(countIn.value, 10);
      if (n > 0) rp.count = Math.min(n, MAX_COUNT);
      fRepeat.setError(null);
      repSummary();
    });
    fillRepOptions();
    repRefresh();

    async function save() {
      const title = titleIn.value.trim();
      if (!title) { fTitle.setError('Вкажи назву події'); titleIn.focus(); return; }
      let start = null;
      let dur = null;
      if (!allDay) {
        const s = toMin(startIn.value);
        let e = toMin(endIn.value);
        if (s == null || s >= DAY_MIN) { fTimes.setError('Вкажи час початку, напр., 09:30'); startIn.focus(); return; }
        if (e == null) e = Math.min(DAY_MIN, s + 60);
        if (e <= s) { fTimes.setError('Кінець має бути пізніше за початок (подія — у межах одного дня, до 24:00).'); endIn.focus(); return; }
        start = fromMin(s);
        dur = e - s;
      }
      const rv = remindSel.value;
      const V = {
        title, date: dateIn.dateValue || ev.date, allDay, start, dur, cat,
        remind: allDay || rv === '' ? null : Number(rv), note: noteIn.value.trim()
      };
      // Правило серії не змінювали (напр., переносять останній повтор на день пізніше) — дату закінчення не перевіряємо
      const rErr = repError(((series0 && inst) || (G && G.rid)) && sameRule(formRule(), rule0) ? null : V.date);
      if (rErr) { fRepeat.setError(rErr); return; }
      const rule = formRule();
      // Подія на кілька днів: лише «весь день» і без повторів
      V.endDate = null;
      if (allDay && !rule && endDateIn.dateValue && endDateIn.dateValue !== V.date) {
        const e = endDateIn.dateValue;
        if (e < V.date) { fEnd.setError('Не раніше за дату початку'); return; }
        if (D.diffDays(V.date, e) >= MAX_SPAN) { fEnd.setError(`Подія — не довше за ${MAX_SPAN} днів`); return; }
        V.endDate = e;
      }
      // Подія Google — у Google Календар
      if (isG()) { await saveG(V, rule); return; }
      if (!canSave()) return;
      lsSet('crm.cal.cat', cat);

      // Повтор серії: що саме змінити — лише цей день, цей і наступні чи всю серію
      if (series0 && inst) {
        const ruleChanged = !sameRule(rule, rule0);
        const ch = changedFields(inst, V);
        if (!ruleChanged && !Object.keys(ch).length) { dlg.close('saved'); return; }
        const scope = await chooseScope({ mode: 'edit', allowOne: !ruleChanged, inst, reset: ruleChanged || !!ch.date });
        if (!scope) return;
        dlg.close('saved');
        const undo = await saveScoped(series0, inst, V, rule, scope);
        const day = dayShort(inst.date);
        const text = !rule
          ? (scope === 'all' || !hasEarlier(series0, inst.occ) ? `«${title}» більше не повторюється` : `«${title}»: повтори з ${day} прибрано`)
          : scope === 'one' ? `«${title}» — змінено лише ${dayShort(V.date)}`
            : scope === 'following' && hasEarlier(series0, inst.occ) ? `«${title}» — змінено з ${day} і далі` : `«${title}» — змінено всі події серії`;
        ui.toast(text, { type: 'success', action: { label: 'Скасувати', onClick: undo } });
        return;
      }

      const rec = Object.assign({}, cur || {}, V);
      if (rule) rec.repeat = rule;
      else if (cur && cur.repeat) { rec.repeat = null; rec.skip = []; rec.overrides = {}; }
      dlg.close('saved');
      const saved = await CRM.store.save('events', rec);
      if (cur) { ui.toast(rule && !rule0 ? `Подію збережено: ${ruleText(rule, saved.date)}` : 'Подію збережено', { type: 'success' }); return; }
      const se = spanEnd(saved);
      ui.toast(`Подію додано: ${se ? whenText(saved) : dayShort(saved.date) + (allDay ? '' : ', ' + whenText(saved))}${rule ? ' · ' + ruleText(rule, saved.date) : ''}`, { type: 'success' });
    }
    /** Зберегти в Google: нова подія, окрема подія чи заняття серії (з вибором «Лише цю / Цю й наступні / Усі»). */
    async function saveG(V, rule) {
      V.location = locIn.value.trim();
      V.gcolor = gcolor;
      V.gremind = allDay ? ev.gremind : gRemOf(gRemSel.value);
      if (lockTime) Object.assign(V, { date: gm.date, allDay: false, start: gm.start, dur: gm.dur, endDate: null });
      if (!G) {
        dlg.close('saved');
        lsSet('crm.cal.target', 'google');
        await createGoogle(V, rule, gcalId);
        return;
      }
      if (G.rid && gRuleState === 'simple' && !rule) {
        fRepeat.setError('Щоб серія більше не повторювалась, видали наступні заняття: «Видалити» → «Цю й наступні».');
        return;
      }
      const ruleChanged = !!(G.rid && gRuleState === 'simple' && !sameRule(rule, rule0));
      const d = gDiff(G, gm, V);
      if (!d.timeCh && !Object.keys(d.body).length && !ruleChanged) { dlg.close('saved'); return; }
      let scope = 'one';
      if (G.rid) {
        const counted = !!(gMaster && (gMaster.recurrence || []).some((l) => /COUNT=/i.test(l)));
        scope = await chooseScope({ mode: 'edit', allowOne: !ruleChanged, inst: { date: gm.date }, reset: ruleChanged, google: true, noFollowing: gRuleState === 'complex' && counted });
        if (!scope) return;
      }
      const send = await askGuests(G);
      if (send === null) return;
      dlg.close('saved');
      const res = await saveGoogle(G, gm, V, { scope, rule, ruleChanged, send, master: gMaster });
      if (!res.ok || res.nothing) return;
      const t = V.title || 'Без назви';
      const text = !G.rid ? `Збережено в Google Календарі: «${t}»`
        : scope === 'one' ? `«${t}» — змінено лише ${dayShort(V.date)} · Google Календар`
          : scope === 'following' ? `«${t}» — змінено з ${dayShort(occDay(G, gm))} і далі · Google Календар` : `«${t}» — змінено всі заняття серії · Google Календар`;
      ui.toast(text, { type: 'success', action: { label: 'Скасувати', onClick: () => res.undo() } });
    }
    titleIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });

    refreshEnd();
    showSpan();

    // «Дублювати» / «Копіювати на…» — для наявної події (повтор серії копіюється як звичайна подія)
    const src = inst || cur || gm;
    let copyRow = null;
    if (src) {
      const dupBtn = ui.button({ label: 'Дублювати', icon: 'copy', size: 'sm', variant: 'ghost', className: 'kal-dup', title: 'Копія на той самий день — одразу відкриється, щоб змінити' });
      dupBtn.addEventListener('click', async () => {
        dlg.close('dup');
        if (G) {
          // Копія події Google — у тому самому календарі Google
          const c = await copyGoogle(G, {});
          const ne = c ? gFind(G.cal, c.id) : null;
          if (ne) openGoogle(ne);
          return;
        }
        const saved = await copyEvent(src, {});
        if (saved) openEditor(saved.id);
      });
      const copyBtn = ui.button({ label: 'Копіювати на…', icon: 'calendar', size: 'sm', variant: 'ghost', className: 'kal-copyto' });
      copyBtn.setAttribute('aria-haspopup', 'dialog');
      copyBtn.addEventListener('click', () => copyTo(copyBtn, src, () => dlg.close('copied'), G ? (ch) => copyGoogle(G, ch) : null));
      copyRow = h('div', { class: 'kal-ed-actions' }, dupBtn, copyBtn);
    }

    // Урок з «Репетиторства»: підказка й перехід до вікна уроку
    const stu = cur && cur.studentId && CRM.tutor ? CRM.tutor.get(cur.studentId) : null;
    const lessonNote = stu ? h('div', { class: 'kal-lesson-note' }, CRM.icon('board', { size: 'sm' }),
      h('span', null, `Урок учня «${stu.name}» (Репетиторство)`),
      h('button', { type: 'button', class: 'link-like kal-lesson-open', onClick: () => { dlg.close('lesson'); CRM.tutor.openLessonOn(stu.id, ev.date); } }, 'Відкрити урок')) : null;
    // Подія Google: звідки вона й «Відкрити в Google»; нова подія — «Де зберегти»
    const gInfo = G ? h('div', { class: 'kal-gsrc' }, CRM.icon('calendar', { size: 'sm' }),
      h('span', null, gWhere(G.cal) + (G.rid ? ' · повторювана подія' : '')),
      G.link ? h('button', { type: 'button', class: 'link-like kal-gsrc-open', onClick: () => CRM.gcal.openEvent(G) }, 'Відкрити в Google') : null) : null;
    const lockNote = lockTime ? h('div', { class: 'callout kal-gsrc-lock' }, CRM.icon('info'),
      h('span', null, `Подія триває через північ (${fmt.dateTime(G.start)} – ${fmt.dateTime(G.end)}) — дату й час змінюй у самому Google Календарі; тут можна змінити назву, місце, опис і нагадування.`)) : null;
    let targetRow = null;
    let gCalWrap = null;
    if (gList.length) {
      const seg = h('div', { class: 'segmented kal-target', role: 'radiogroup', 'aria-label': 'Де зберегти подію' });
      const drawSeg = () => ui.mount(seg, [['crm', 'Моя CRM'], ['google', 'Google Календар']].map(([v, l]) => h('button', {
        type: 'button', role: 'radio', class: v === target ? 'active' : '', 'aria-checked': v === target ? 'true' : 'false', dataset: { target: v },
        onClick: () => { target = v; lsSet('crm.cal.target', v); drawSeg(); applyTarget(); }
      }, l)));
      drawSeg();
      if (gList.length > 1) {
        const calSel = ui.select(gList.map((c) => ({ value: c.id, label: c.primary ? `${c.summary} (основний)` : c.summary })), { value: gcalId, 'aria-label': 'Календар Google' });
        calSel.addEventListener('change', () => { gcalId = calSel.value; lsSet('crm.cal.gcal', gcalId); drawGColors(); });
        gCalWrap = h('span', { class: 'kal-target-cal' }, calSel);
      }
      targetRow = ui.field({ label: 'Де зберегти', input: h('div', { class: 'kal-target-row' }, seg, gCalWrap) });
    }
    // Своя подія при ввімкненому дублюванні: стан копії в Google (gmirror.js)
    let mirrorNote = null;
    if (mirrored) {
      const st = cur ? CRM.gmirror.statusOf(cur) : 'new';
      const text = st === 'synced' ? 'Копія — у Google Календарі' : st === 'pending' ? 'Копію буде надіслано в Google Календар, щойно буде доступ до Google'
        : st === 'gone' ? 'Копію цієї події видалили в Google Календарі — ' : st === 'new' ? 'Подія зʼявиться й у Google Календарі' : null;
      if (text) {
        mirrorNote = h('div', { class: 'kal-mirror-note', dataset: { mirror: st } }, CRM.icon('copy', { size: 'sm' }), h('span', null, text,
          st === 'gone' ? h('button', { type: 'button', class: 'link-like', onClick: () => { dlg.close('gone'); CRM.gmirror.openGone(); } }, 'вирішити') : null));
      }
    }
    const whenRow = h('div', { class: 'kal-when-row' }, ui.field({ label: 'Дата', input: dateIn }), fEnd, allDayBox);
    whenRow.hidden = lockTime;
    const fCat = ui.field({ label: 'Категорія', input: catPicker(cat, (v) => { cat = v; }, false, true) });
    const fNote = ui.field({ label: 'Нотатки', input: noteIn });
    const noteLabel = fNote.querySelector('.field-label');
    /** Показати поля для CRM чи для Google. */
    function applyTarget() {
      const g = isG();
      fCat.hidden = g;
      fGColor.hidden = !g;
      if (mirrorNote) mirrorNote.hidden = g;
      fLoc.hidden = !g;
      fRemind.hidden = g || allDay;
      fGRemind.hidden = !g || allDay || lockTime;
      if (noteLabel) noteLabel.textContent = g ? 'Опис' : 'Нотатки';
      if (gCalWrap) gCalWrap.hidden = !g;
      // окрему подію Google серією тут не робимо (лише в самому Google)
      fRepeat.hidden = !!(G && !G.rid) || lockTime;
    }
    const body = h('div', { class: 'form-stack kal-editor' },
      lessonNote,
      gInfo,
      mirrorNote,
      targetRow,
      fTitle,
      copyRow,
      lockNote,
      whenRow,
      fTimes,
      fRepeat,
      fCat,
      fGColor,
      fLoc,
      fRemind,
      fGRemind,
      fNote);
    applyTarget();
    const footer = [
      cur || G ? ui.button({ label: 'Видалити', icon: 'trash', variant: 'danger-ghost', className: 'kal-del', onClick: async () => {
        if (G) { await deleteGoogle(G, dlg); return; }
        if (series0 && inst) {
          const scope = await chooseScope({ mode: 'delete', allowOne: true, inst });
          if (!scope) return;
          dlg.close('delete');
          await deleteScoped(series0, inst, scope);
          return;
        }
        const ok = await ui.confirm({
          title: series0 ? 'Видалити серію подій?' : 'Видалити подію?',
          message: `«${cur.title}» ${series0 ? '(усі повтори) ' : ''}перейде в Кошик — її можна відновити протягом 30 днів.`,
          confirmText: 'Видалити', danger: true
        });
        if (!ok) return;
        dlg.close('delete');
        await removeEvent(cur);
      } }) : null,
      ui.button({ label: 'Скасувати', onClick: () => dlg.close('button') }),
      ui.button({ label: cur || G ? 'Зберегти' : 'Додати', variant: 'primary', onClick: save })
    ];
    const dlg = ui.modal({
      title: G ? (G.rid ? 'Повторювана подія Google' : 'Подія Google') : cur ? (series0 ? 'Повторювана подія' : 'Подія') : 'Нова подія',
      size: 'md', className: 'kal-editor-modal' + (G ? ' kal-editor-google' : ''), body, footer, initialFocus: titleIn
    });

    // Серія Google: правило з головної події серії (без доступу — лише підпис)
    if (G && G.rid) {
      const fail = () => { gRuleState = 'error'; fillRepOptions(); repRefresh(); };
      if (CRM.gcal.status() !== 'connected') fail();
      else {
        CRM.gcal.getEvent(G.cal, G.rid).then((master) => {
          gMaster = master;
          gFirst = masterDay(master);
          const parsed = CRM.gcal.parseRecurrence(master.recurrence, gFirst);
          if (parsed.rule) {
            rule0 = normRule(parsed.rule, gFirst);
            gRuleState = 'simple';
            rp.mode = presetOf(rule0, gFirst);
            rp.every = rule0.every;
            rp.unit = rule0.freq;
            rp.days = rule0.days ? rule0.days.slice() : [D.weekday(gFirst)];
            rp.daysTouched = true;
            rp.end = rule0.until ? 'until' : rule0.count ? 'count' : 'never';
            if (rule0.until) { rp.until = rule0.until; untilIn.dateValue = rule0.until; }
            if (rule0.count) rp.count = rule0.count;
            everyIn.value = String(rp.every);
            countIn.value = String(rp.count);
            endSel.value = rp.end;
          } else gRuleState = 'complex';
          fillRepOptions();
          repRefresh();
        }, fail);
      }
    }
    return dlg;
  }

  /** Який пункт «Повторення» відповідає правилу. */
  function presetOf(rule, base) {
    if (!rule) return '';
    if (rule.every !== 1) return 'custom';
    if (rule.freq === 'day') return 'day';
    if (rule.freq === 'week') {
      const k = rule.days.join(',');
      if (k === '0,1,2,3,4') return 'weekdays';
      if (k === String(D.weekday(base))) return 'week';
      return 'custom';
    }
    return rule.freq;   // month / year — число береться з першого дня серії
  }

  /** «+ Подія»: на сьогодні (наступна година), якщо сьогодні видно, інакше — на перший день. */
  function openNew(r) {
    const T = D.today();
    const inView = r && T >= r.from && T <= r.to;
    const date = r ? (inView ? T : (r.monthStart || r.from)) : T;
    let start = 9 * 60;
    if (date === T) start = Math.min(23 * 60, (D.kyivParts().hh + 1) * 60);
    openEditor(null, { date, start: fromMin(start), dur: 60 });
  }

  // ---------- Пункти (чіпи) ----------
  /** Галочка задачі в календарі. */
  function taskCheck(t) {
    return h('button', {
      type: 'button', class: 'task-check kal-tcheck' + (t.done ? ' checked' : ''), role: 'checkbox',
      'aria-checked': t.done ? 'true' : 'false',
      'aria-label': t.done ? `Повернути «${t.title}» в активні` : `Позначити «${t.title}» виконаною`,
      title: t.done ? 'Виконано — натисни, щоб повернути' : 'Позначити виконаною',
      onClick: (e) => { e.stopPropagation(); if (clicksBlocked()) return; toggleTask(t.id); }
    }, CRM.icon('check', { size: 'sm' }));
  }

  /** Задача «без часу» в рядку «весь день» чи в місяці: галочка + назва, перетягується. */
  function taskChip(it, cls, label, o) {
    const el = h('div', {
      class: cls.join(' '), role: 'button', tabIndex: 0, style: { '--c': it.color },
      title: [label, it.sub].filter(Boolean).join(' · '), dataset: { key: it.key },
      onClick: (e) => { e.stopPropagation(); if (clicksBlocked()) return; openItem(it); },
      onKeydown: (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === el) { e.preventDefault(); openItem(it); } }
    },
    taskCheck(it.task),
    o.time ? h('span', { class: 'kal-chip-time num' }, o.time) : null,
    h('span', { class: 'kal-chip-title' }, label),
    o.withSub && it.sub ? h('span', { class: 'kal-chip-sub' }, it.sub) : null);
    attachDrag(el, (sx, sy) => taskSession(el, it, sx, sy));
    return el;
  }

  /** Галочка «вивчено» для дедлайну теми «Навчання». */
  function learnCheck(it) {
    const done = !!it.done;
    return h('button', {
      type: 'button', class: 'task-check kal-tcheck' + (done ? ' checked' : ''), role: 'checkbox',
      'aria-checked': done ? 'true' : 'false',
      'aria-label': done ? `Зняти позначку «вивчено» з «${it.title}»` : `Позначити тему «${it.title}» вивченою`,
      title: done ? 'Вивчено — натисни, щоб зняти позначку' : 'Позначити тему вивченою',
      onClick: (e) => { e.stopPropagation(); if (clicksBlocked()) return; CRM.learning.setTopicDone(it.learn.courseId, it.learn.topicId, !done); }
    }, CRM.icon('check', { size: 'sm' }));
  }

  /** Дедлайн «Навчання»: тема — з галочкою, курс — зі значком; перетягується на інший день. */
  function learnChip(it, cls, label, o) {
    const el = h('div', {
      class: cls.join(' '), role: 'button', tabIndex: 0, style: { '--c': it.color },
      title: [label, it.sub].filter(Boolean).join(' · '), dataset: { key: it.key },
      onClick: (e) => { e.stopPropagation(); if (clicksBlocked()) return; openItem(it); },
      onKeydown: (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === el) { e.preventDefault(); openItem(it); } }
    },
    it.learn.topicId ? learnCheck(it) : CRM.icon('graduation', { size: 'sm' }),
    h('span', { class: 'kal-chip-title' }, label),
    o.withSub && it.sub ? h('span', { class: 'kal-chip-sub' }, it.sub) : null);
    attachDrag(el, (sx, sy) => daySession(el, it, sx, sy));
    return el;
  }

  /** Дедлайн «Проєктів»: етап — з галочкою «готово», дедлайн проєкту — ◆; перетягується на інший день. */
  function projectChip(it, cls, label, o) {
    const done = !!it.done;
    const stage = !!it.pj.stageId;
    const check = stage ? h('button', {
      type: 'button', class: 'task-check kal-tcheck' + (done ? ' checked' : ''), role: 'checkbox',
      'aria-checked': done ? 'true' : 'false',
      'aria-label': done ? `Етап «${it.title}» знову в роботу` : `Позначити етап «${it.title}» готовим`,
      title: done ? 'Етап готовий — натисни, щоб повернути в роботу' : 'Позначити етап готовим',
      onClick: (e) => { e.stopPropagation(); if (clicksBlocked()) return; CRM.projects.setStageDone(it.pj.projectId, it.pj.stageId, !done); }
    }, CRM.icon('check', { size: 'sm' })) : null;
    const el = h('div', {
      class: cls.join(' '), role: 'button', tabIndex: 0, style: { '--c': it.color },
      title: [label, it.sub].filter(Boolean).join(' · '), dataset: { key: it.key },
      onClick: (e) => { e.stopPropagation(); if (clicksBlocked()) return; openItem(it); },
      onKeydown: (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === el) { e.preventDefault(); openItem(it); } }
    },
    check,
    it.pj.diamond ? h('span', { class: 'kal-pj-dl', 'aria-hidden': 'true', title: 'Дедлайн проєкту' }, '◆') : null,
    h('span', { class: 'kal-chip-title' }, label),
    o.withSub && it.sub ? h('span', { class: 'kal-chip-sub' }, it.sub) : null);
    attachDrag(el, (sx, sy) => daySession(el, it, sx, sy));
    return el;
  }

  function chip(it, opts) {
    const o = opts || {};
    const cls = ['kal-chip', 'k-' + it.kind];
    if (it.lesson) cls.push('k-lesson');
    if (it.done) cls.push('done');
    if (it.overdue) cls.push('overdue');
    if (it.tentative) cls.push('tentative');
    const label = (it.time ? it.time + ' ' : '') + it.title;
    if (it.span) {
      cls.push('kal-span');
      if (it.date === it.span.first) cls.push('kal-span-first');
      if (it.date === it.span.last) cls.push('kal-span-last');
      if (D.weekday(it.date) === 6) cls.push('kal-span-sun');   // кінець рядка в «Місяці»
    }
    if (it.kind === 'task') return taskChip(it, cls, label, o);
    if (it.kind === 'learning' && CRM.learning) return learnChip(it, cls, label, o);
    if (it.kind === 'project' && CRM.projects) return projectChip(it, cls, label, o);
    const el = h('button', {
      type: 'button', class: cls.join(' '), style: { '--c': it.color },
      title: [label, it.sub, it.rep].filter(Boolean).join(' · '), dataset: { key: it.key },
      onClick: (e) => { e.stopPropagation(); if (clicksBlocked()) return; openItem(it); }
    },
    it.kind === 'own' ? (it.series ? CRM.icon('repeat', { size: 'sm', className: 'kal-rep-ico' }) : null) : CRM.icon(it.done ? 'check' : it.icon, { size: 'sm' }),
    o.time ? h('span', { class: 'kal-chip-time num' }, o.time) : null,
    h('span', { class: 'kal-chip-title' }, label),
    o.withSub && it.sub ? h('span', { class: 'kal-chip-sub' }, it.sub) : null);
    if (it.kind === 'own' || (it.kind === 'gcal' && it.editable)) attachDrag(el, (sx, sy) => daySession(el, it, sx, sy));
    return el;
  }

  // ---------- Годинна сітка (день, 3 дні, тиждень) ----------
  function gridView(r, data, opts) {
    const o = opts || {};
    const T = D.today();
    const nm = nowMin();
    const n = r.days.length;
    const style = { '--days': String(n) };
    const single = n === 1;

    const headRow = h('div', { class: 'kal-row kal-headrow', style },
      h('div', { class: 'kal-gutter' }),
      r.days.map((d) => {
        const p = D.parse(d);
        const cls = ['kal-dh'];
        if (d === T) cls.push('today');
        if (D.weekday(d) >= 5) cls.push('weekend');
        return h('button', {
          type: 'button', class: cls.join(' '), title: single ? null : 'Відкрити день', 'aria-label': capitalize(fmt.dateLong(d)),
          onClick: () => { if (!single) go('day', d); }
        },
        h('span', { class: 'kal-dh-wd' }, single ? capitalize(CRM.WEEKDAYS[D.weekday(d)]) : CRM.WEEKDAYS_SHORT[D.weekday(d)]),
        h('span', { class: 'kal-dh-num num' }, String(p.d)));
      }));

    const allRow = h('div', { class: 'kal-row kal-allrow', style },
      h('div', { class: 'kal-gutter kal-gutter-label' }, 'весь день'),
      r.days.map((d) => {
        // У «Дні» задачі без часу стоять у «Плані дня» праворуч — тут без дубля
        const items = o.noUntimedTasks ? data.get(d).allDay.filter((it) => it.kind !== 'task') : data.get(d).allDay;
        const limit = single ? Infinity : MAX_CHIPS;
        const cell = h('div', { class: 'kal-ad' + (D.weekday(d) >= 5 ? ' weekend' : ''), dataset: { date: d, dropDate: d } },
          items.slice(0, limit).map((it) => chip(it, { withSub: single })),
          items.length > limit ? h('button', {
            type: 'button', class: 'kal-more', onClick: (e) => { e.stopPropagation(); go('day', d); }
          }, `ще ${items.length - limit}`) : null);
        cell.addEventListener('click', (e) => {
          if (clicksBlocked() || e.target.closest('.kal-chip, .kal-more')) return;
          quickAdd(cell, { date: d, allDay: true });
        });
        return cell;
      }));

    const sticky = h('div', { class: 'kal-sticky' }, headRow, allRow);
    const times = h('div', { class: 'kal-times', 'aria-hidden': 'true' },
      Array.from({ length: 23 }, (_, i) => h('span', { class: 'kal-hour num', style: { top: ((i + 1) * HOUR) + 'px' } }, pad(i + 1) + ':00')));

    const cols = r.days.map((d) => {
      const cls = ['kal-col'];
      if (d === T) cls.push('today');
      if (D.weekday(d) >= 5) cls.push('weekend');
      return h('div', { class: cls.join(' '), dataset: { date: d }, role: 'group', 'aria-label': capitalize(fmt.dateLong(d)) });
    });
    const body = h('div', { class: 'kal-row kal-body', style: Object.assign({ height: (24 * HOUR) + 'px' }, style) }, times, cols);
    const scroll = h('div', { class: 'kal-scroll' + (single ? ' single' : '') }, sticky, body);
    const ctx = gridCtx(scroll, sticky, cols);

    cols.forEach((col) => {
      const d = col.dataset.date;
      layoutTimed(data.get(d).timed).forEach((it) => col.appendChild(eventBlock(it, ctx)));
      if (d === T) col.appendChild(h('div', { class: 'kal-now', style: { top: px(nm) }, 'aria-hidden': 'true' }));
      col.addEventListener('pointerdown', (e) => {
        if (e.pointerType === 'touch' || e.button !== 0 || e.target !== col) return;
        slotSelect(col, e, ctx);
      });
      col.addEventListener('click', (e) => {
        if (lastPointer === 'mouse' || clicksBlocked() || e.target !== col) return;
        const m = clamp(ctx.minuteAt(col, e.clientY), 0, DAY_MIN - 1);
        const s = Math.min(Math.floor(m / 30) * 30, DAY_MIN - 60);
        openSlot(col, s, s + 60);
      });
    });
    scroll.addEventListener('pointerdown', (e) => { lastPointer = e.pointerType || 'mouse'; }, true);
    scroll.addEventListener('scroll', () => { gridScroll = scroll.scrollTop; }, { passive: true });

    const card = h('section', { class: 'card kal-card' }, scroll);
    // Прокрутка: як була; уперше — до поточної години (якщо сьогодні видно) або до 07:00
    card._afterMount = () => {
      const inView = T >= r.from && T <= r.to;
      scroll.scrollTop = gridScroll != null ? gridScroll : Math.max(0, (inView ? Math.floor(nm / 60) - 1 : 7) * HOUR);
      gridScroll = scroll.scrollTop;
    };
    return card;
  }

  function openSlot(col, s, e) {
    const ghost = h('div', { class: 'kal-ghost', style: { top: px(s), height: px(e - s, true) } },
      h('span', { class: 'kal-ghost-time num' }, `${fromMin(s)}–${fromMin(e)}`));
    col.appendChild(ghost);
    quickAdd(ghost, { date: col.dataset.date, allDay: false, start: fromMin(s), dur: e - s }, () => ghost.remove());
  }

  /** Мишкою по вільному місцю: клік — година, протягнути — свій проміжок. */
  function slotSelect(col, e, ctx) {
    e.preventDefault();
    closeQuick();
    const m0 = clamp(ctx.minuteAt(col, e.clientY), 0, DAY_MIN - 1);
    let ghost = null;
    let range = null;
    let moved = false;
    const show = (s, en) => {
      range = [s, en];
      if (!ghost) {
        ghost = h('div', { class: 'kal-ghost' }, h('span', { class: 'kal-ghost-time num' }));
        col.appendChild(ghost);
      }
      ghost.style.top = px(s);
      ghost.style.height = px(en - s, true);
      ghost.firstChild.textContent = `${fromMin(s)}–${fromMin(en)}`;
    };
    const stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', key, true);
      teardown = null;
    };
    const move = (m) => {
      const cur = clamp(ctx.minuteAt(col, m.clientY), 0, DAY_MIN);
      if (!moved && Math.abs(cur - m0) < 8) return;
      moved = true;
      const a = Math.floor(Math.min(m0, cur) / SNAP) * SNAP;
      const b = Math.max(a + SNAP, Math.ceil(Math.max(m0, cur) / SNAP) * SNAP);
      show(a, Math.min(DAY_MIN, b));
    };
    const up = () => {
      stop();
      suppressUntil = Date.now() + 400;
      if (!moved) {
        const s = Math.min(Math.floor(m0 / 30) * 30, DAY_MIN - 60);
        show(s, s + 60);
      }
      const g = ghost;
      quickAdd(g, { date: col.dataset.date, allDay: false, start: fromMin(range[0]), dur: range[1] - range[0] }, () => g.remove());
    };
    const cancel = () => { stop(); if (ghost) ghost.remove(); };
    const key = (k) => { if (k.key === 'Escape') { k.preventDefault(); k.stopPropagation(); cancel(); } };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', key, true);
    teardown = cancel;
  }

  function eventBlock(it, ctx) {
    const height = (Math.max(it.endMin, it.startMin + MIN_VIS) - it.startMin) / 60 * HOUR;
    const short = height < 38;
    const cls = ['kal-ev', 'k-' + it.kind];
    if (it.lesson) cls.push('k-lesson');
    if (short) cls.push('short');
    if (it.past) cls.push('past');
    if (it.tentative) cls.push('tentative');
    if (it.done) cls.push('done');
    if (it.overdue) cls.push('overdue');
    const w = 100 / (it.ncols || 1);
    const el = h('div', {
      class: cls.join(' '), role: 'button', tabIndex: 0, dataset: { key: it.key },
      'aria-label': `${it.title}, ${it.sub}`,
      title: `${it.title}\n${it.sub}${it.kind === 'gcal' ? '\nGoogle Календар' : it.kind === 'task' ? '\nЗадача' : it.rep ? '\n' + it.rep : ''}`,
      style: {
        '--c': it.color, top: px(it.startMin), height: px(Math.max(it.endMin - it.startMin, MIN_VIS * 0.8), true),
        left: `calc(${(it.col || 0) * w}% + 1px)`, width: `calc(${w}% - 3px)`
      }
    },
    it.kind === 'task' ? taskCheck(it.task) : null,
    h('span', { class: 'kal-ev-title' }, it.series ? CRM.icon('repeat', { size: 'sm', className: 'kal-rep-ico' }) : null, it.title),
    h('span', { class: 'kal-ev-time num' }, it.sub),
    it.editable ? h('span', { class: 'kal-resize', 'aria-hidden': 'true', title: 'Потягни, щоб змінити тривалість' }) : null);
    el.addEventListener('click', () => { if (!clicksBlocked()) openItem(it); });
    el.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === el) { e.preventDefault(); openItem(it); } });
    if (it.editable) attachDrag(el, (sx, sy, target) => gridSession(el, it, ctx, sx, sy, target));
    return el;
  }

  // ---------- «План дня» (перегляд «День») ----------
  let panelDraft = { date: '', text: '' };  // недописана назва нової задачі (переживає перемальовування)
  let refocusTask = null;                    // після зміни порядку з клавіатури — фокус назад на рядок

  function planRow(t, i, n, date) {
    const it = { kind: 'task', task: t, key: 'task:' + t.id, date };
    const dl = deadlineNote(t, date);
    const checklist = t.checklist || [];
    const meta = [];
    const pj = CRM.tasks.projectChip ? CRM.tasks.projectChip(t) : null;
    if (pj) meta.push(pj);
    if (CRM.tasks.labelsOf && CRM.tasks.labelsOf(t).length) meta.push(h('span', { class: 'task-labels' }, CRM.tasks.labelsOf(t).map(CRM.tasks.labelChip)));
    if (t.priority === 'high' && !t.done) meta.push(h('span', { class: 'kal-dmeta kal-dmeta-prio' }, h('span', { class: 'prio-dot prio-high' }), 'високий пріоритет'));
    if (dl) meta.push(h('span', { class: 'kal-dmeta' + (t.done ? '' : ' kal-dmeta-dl') }, CRM.icon('flag', { size: 'sm' }), dl));
    if (checklist.length) meta.push(h('span', { class: 'kal-dmeta' }, CRM.icon('listChecks', { size: 'sm' }), `${checklist.filter((c) => c.done).length}/${checklist.length}`));
    const row = h('div', {
      class: 'kal-drow' + (t.done ? ' done' : ''), role: 'listitem', tabIndex: 0, dataset: { id: t.id },
      'aria-label': `${t.title}${t.done ? ', виконано' : ''}. Enter — відкрити, Alt+стрілки — змінити порядок`,
      title: 'Перетягни, щоб змінити порядок або дати задачі час у сітці'
    },
    h('span', { class: 'kal-grip', 'aria-hidden': 'true' }, CRM.icon('grip', { size: 'sm' })),
    taskCheck(t),
    h('span', { class: 'kal-drow-main' },
      h('span', { class: 'kal-drow-title' }, t.title || 'Без назви'),
      meta.length ? h('span', { class: 'kal-drow-meta' }, meta) : null));
    row.addEventListener('click', (e) => {
      if (clicksBlocked() || e.target.closest('.kal-tcheck')) return;
      CRM.tasks.openTask(t.id);
    });
    row.addEventListener('keydown', (e) => {
      if (e.target !== row) return;
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); CRM.tasks.openTask(t.id); return; }
      if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault();
        const to = i + (e.key === 'ArrowUp' ? -1 : 1);
        if (to < 0 || to >= n) return;
        refocusTask = t.id;
        planTask(t.id, { date, start: null, index: to });
      }
    });
    attachDrag(row, (sx, sy) => taskSession(row, it, sx, sy));
    return row;
  }

  function dayPanel(date) {
    const all = plannedTasks(date, date).sort(byPlanOrder);
    const untimed = all.filter((t) => taskStart(t) == null);
    const timed = all.filter((t) => taskStart(t) != null).sort((a, b) => taskStart(a) - taskStart(b));
    const done = all.filter((t) => t.done).length;

    const list = h('div', { class: 'kal-dlist', role: 'list', 'aria-label': 'Задачі без часу', dataset: { taskList: date } },
      untimed.map((t, i) => planRow(t, i, untimed.length, date)),
      untimed.length ? null : h('div', { class: 'kal-dempty' }, all.length
        ? 'Задач без часу немає. Перетягни сюди задачу із сітки, щоб прибрати їй час.'
        : 'На цей день задач ще немає — допиши нову нижче або вибери з наявних.'));

    const timedBox = timed.length ? h('div', { class: 'kal-dtimed' },
      h('div', { class: 'kal-dsub' }, 'За часом — у сітці'),
      timed.map((t) => h('button', {
        type: 'button', class: 'kal-dtimed-row' + (t.done ? ' done' : ''), onClick: () => CRM.tasks.openTask(t.id)
      },
      h('span', { class: 'num' }, t.planStart),
      h('span', { class: 'kal-dtimed-title' }, t.title || 'Без назви')))) : null;

    const addIn = ui.input({ placeholder: 'Нова задача на цей день…', maxlength: 200, 'aria-label': 'Нова задача на цей день', class: 'input kal-newtask-in' });
    addIn.value = panelDraft.date === date ? panelDraft.text : '';
    async function addFromInput() {
      const title = addIn.value.trim();
      if (!title) { addIn.focus(); return; }
      addIn.value = '';
      panelDraft = { date, text: '' };
      await addTask(title, { date }, { quiet: true });
    }
    addIn.addEventListener('input', () => { panelDraft = { date, text: addIn.value }; });
    addIn.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); addFromInput(); } });
    const pickBtn = ui.button({ label: 'Вибрати з задач', icon: 'tasks', size: 'sm', variant: 'ghost', className: 'kal-pick-btn' });
    pickBtn.setAttribute('aria-haspopup', 'dialog');
    pickBtn.addEventListener('click', () => pickTasks(pickBtn, date));

    return h('section', { class: 'card kal-day-panel', 'aria-label': 'План дня' },
      h('div', { class: 'kal-dhead' },
        h('h2', null, 'План дня'),
        all.length ? h('span', { class: 'subtle num' }, `${done} з ${all.length} виконано`) : null),
      h('div', { class: 'kal-dbody' }, list, timedBox),
      h('div', { class: 'kal-dadd' },
        h('div', { class: 'kal-dadd-row' }, addIn,
          ui.button({ icon: 'plus', iconOnly: true, size: 'sm', title: 'Додати задачу', onClick: addFromInput })),
        pickBtn));
  }

  /** Вибрати наявну задачу й поставити її в план дня. */
  function pickTasks(anchor, date) {
    closeQuick();
    const list = CRM.tasks.sortTasks(CRM.tasks.activeTasks().filter((t) => t.planDate !== date), 'deadline')
      .sort((a, b) => (a.planDate ? 1 : 0) - (b.planDate ? 1 : 0));
    const content = h('div', { class: 'kal-pick' },
      h('div', { class: 'kal-pick-head' }, 'Додати в план: ' + dayShort(date)),
      list.length
        ? h('div', { class: 'kal-pick-list', role: 'menu' }, list.map((t) => {
          const dl = CRM.tasks.deadlineInfo(t);
          const meta = [t.planDate ? 'у плані: ' + CRM.tasks.planLabel(t) : 'без плану', dl ? 'дедлайн: ' + dl.label.toLowerCase() : null].filter(Boolean).join(' · ');
          return h('button', {
            type: 'button', role: 'menuitem', class: 'kal-pick-row',
            onClick: () => { pop.close('picked'); planTask(t.id, { date, start: null }); }
          }, h('span', { class: 'kal-pick-title' }, t.title || 'Без назви'), h('span', { class: 'kal-pick-meta' }, meta));
        }))
        : h('div', { class: 'kal-pick-empty' }, 'Усі активні задачі вже в плані цього дня.'));
    const pop = ui.popover(anchor, content, {
      align: 'start', className: 'kal-pick-pop',
      onClose: () => popClosed(pop)
    });
    quick = pop;
    quickRoute = location.hash;
    const first = pop.el.querySelector('.kal-pick-row');
    if (first) first.focus({ preventScroll: true });
  }

  /** Плашка: невиконані задачі з минулих днів. Нічого не переносить сама — лише за кнопкою. */
  function rollBanner() {
    const list = overdueTasks();
    if (!list.length) return null;
    const whichBtn = ui.button({ label: 'Які?', size: 'sm', variant: 'ghost' });
    whichBtn.setAttribute('aria-haspopup', 'dialog');
    whichBtn.addEventListener('click', () => {
      closeQuick();
      const pop = ui.popover(whichBtn, h('div', { class: 'kal-pick' },
        h('div', { class: 'kal-pick-head' }, 'Не виконано з минулих днів'),
        h('div', { class: 'kal-pick-list' }, list.map((t) => h('div', { class: 'kal-roll-row' },
          h('button', { type: 'button', class: 'kal-pick-row', onClick: () => { pop.close('open'); CRM.tasks.openTask(t.id); } },
            h('span', { class: 'kal-pick-title' }, t.title || 'Без назви'),
            h('span', { class: 'kal-pick-meta' }, 'було в плані: ' + dayShort(t.planDate) + (t.planStart ? ', ' + t.planStart : ''))),
          ui.button({
            label: 'На сьогодні', size: 'sm',
            onClick: () => { pop.close('moved'); planTask(t.id, { date: D.today(), start: null }); }
          }))))),
      { align: 'start', className: 'kal-pick-pop', onClose: () => popClosed(pop) });
      quick = pop;
      quickRoute = location.hash;
    });
    return h('div', { class: 'callout callout-warning kal-roll', role: 'status' },
      CRM.icon('alert'),
      h('span', { class: 'kal-roll-text' }, 'Не виконано з минулих днів: ', h('strong', { class: 'num' }, String(list.length))),
      h('span', { class: 'kal-roll-actions' },
        whichBtn,
        ui.button({ label: 'Перенести на сьогодні', size: 'sm', onClick: rollOver })));
  }

  // ---------- Місяць ----------
  function monthView(r, data, anchor) {
    const T = D.today();
    const month = r.monthStart.slice(0, 7);
    const cells = r.days.map((d) => {
      const b = data.get(d);
      const timed = b.timed.filter((it) => it.kind !== 'gcal' || it.startMin > 0 || D.toKyivDate(it.gev.start) === d);
      const items = b.allDay.concat(timed.map((it) => Object.assign({}, it, { time: fromMin(it.startMin) })));
      const cls = ['kal-mcell'];
      if (d.slice(0, 7) !== month) cls.push('other');
      if (d === T) cls.push('today');
      if (d === anchor) cls.push('selected');
      if (D.weekday(d) >= 5) cls.push('weekend');
      const cell = h('div', { class: cls.join(' '), dataset: { date: d, dropDate: d } },
        h('div', { class: 'kal-mtop' },
          h('button', {
            type: 'button', class: 'kal-mday num', 'aria-label': `${capitalize(fmt.dateLong(d))} — відкрити день`, title: 'Відкрити день',
            onClick: (e) => { e.stopPropagation(); if (isNarrow()) go('month', d); else go('day', d); }
          }, String(D.parse(d).d))),
        h('div', { class: 'kal-mitems' },
          items.slice(0, MAX_CHIPS).map((it) => chip(it)),
          items.length > MAX_CHIPS ? h('button', {
            type: 'button', class: 'kal-more', onClick: (e) => { e.stopPropagation(); go('day', d); }
          }, `ще ${items.length - MAX_CHIPS}`) : null),
        items.length ? h('div', { class: 'kal-mdots', 'aria-hidden': 'true' },
          items.slice(0, 4).map((it) => h('span', { class: 'kal-mdot', style: { '--c': it.color } }))) : null);
      cell.addEventListener('click', (e) => {
        if (clicksBlocked() || e.target.closest('.kal-chip, .kal-more, .kal-mday')) return;
        if (isNarrow()) { go('month', d); return; }
        quickAdd(cell, { date: d, allDay: true });
      });
      return cell;
    });
    // Зліва — номер тижня (клік — відкрити цей тиждень)
    const rows = [];
    for (let i = 0; i < cells.length; i += 7) {
      const mon = r.days[i];
      const n = isoWeek(mon);
      rows.push(h('button', {
        type: 'button', class: 'kal-mwk num', title: `Тиждень ${n} — відкрити`, 'aria-label': `Тиждень ${n}: відкрити тиждень`,
        onClick: (e) => { e.stopPropagation(); go('week', mon); }
      }, String(n)));
      rows.push(...cells.slice(i, i + 7));
    }
    const grid = h('div', { class: 'kal-mgrid' },
      h('div', { class: 'kal-mwd kal-mwk-h', title: 'Номер тижня' }, '№'),
      CRM.WEEKDAYS_SHORT.map((w, i) => h('div', { class: 'kal-mwd' + (i >= 5 ? ' weekend' : '') }, w)),
      rows);
    grid.addEventListener('pointerdown', (e) => { lastPointer = e.pointerType || 'mouse'; }, true);
    return h('div', { class: 'stack' },
      h('section', { class: 'card kal-card kal-month' }, grid),
      agenda(anchor, data.get(anchor) || null));
  }

  /** Список подій вибраного дня (на телефоні — під місяцем). */
  function agenda(d, b) {
    const items = b ? b.allDay.concat(b.timed) : [];
    return h('section', { class: 'card kal-agenda' },
      h('div', { class: 'card-head' },
        h('h2', null, capitalize(fmt.dateLong(d))),
        ui.button({ label: 'Подія', icon: 'plus', size: 'sm', onClick: () => openEditor(null, { date: d, start: '09:00', dur: 60 }) })),
      items.length
        ? h('div', { class: 'kal-alist' }, items.map((it) => h('button', {
          type: 'button', class: 'kal-arow' + (it.done ? ' done' : ''), style: { '--c': it.color }, onClick: () => openItem(it)
        },
        h('span', { class: 'kal-arow-time num' }, it.startMin != null ? fromMin(it.startMin) : (it.time || 'день')),
        h('span', { class: 'kal-arow-bar' }),
        h('span', { class: 'kal-arow-main' },
          h('span', { class: 'kal-arow-title' }, it.title),
          h('span', { class: 'kal-arow-sub' }, it.kind === 'gcal' ? `${it.sub} · Google Календар` : it.sub)))))
        : ui.empty({ icon: 'calendar', small: true, title: 'На цей день нічого немає' }));
  }

  // ---------- «Показати» ----------
  function layersButton() {
    const L = layers();
    const off = LAYERS.filter((l) => !L[l.id]).length;
    const hidden = hiddenCats();
    const filtered = categories().some((c) => hidden.has(c.id));
    const label = ['Показати', off ? `${LAYERS.length - off} з ${LAYERS.length}` : null, filtered ? 'фільтр' : null].filter(Boolean).join(' · ');
    const btn = ui.button({ label, icon: 'eye', size: 'sm', className: 'kal-layers-btn' + (off || filtered ? ' kal-filtered' : '') });
    btn.setAttribute('aria-haspopup', 'dialog');
    btn.addEventListener('click', () => {
      const cur = layers();
      const hid = hiddenCats();
      const catRows = categories().map((c) => {
        const b = check(c.label, !hid.has(c.id), (on) => { setHiddenCat(c.id, !on); CRM.router.rerender(); });
        b.classList.add('kal-lcat');
        b.dataset.cat = c.id;
        b.insertBefore(h('span', { class: 'kal-lcat-dot', style: { '--c': CRM.dict.categoryColor(c.color) }, 'aria-hidden': 'true' }), b.lastChild);
        return b;
      });
      const manage = h('button', { type: 'button', class: 'kal-lcat-manage', onClick: () => { pop.close('manage'); openCategories(); } },
        CRM.icon('palette', { size: 'sm' }), h('span', null, 'Категорії…'));
      const pop = ui.popover(btn, h('div', { class: 'kal-show' },
        h('div', { class: 'menu kal-layers', role: 'group', 'aria-label': 'Що показувати' },
          LAYERS.map((l) => check(l.label, cur[l.id], (on) => { setLayer(l.id, on); CRM.router.rerender(); }))),
        h('div', { class: 'kal-lcats', role: 'group', 'aria-label': 'Мої події за категоріями' },
          h('div', { class: 'kal-lcats-head' }, 'Мої події за категоріями'),
          catRows,
          manage)),
      { align: 'end', className: 'kal-show-pop' });
      return pop;
    });
    return btn;
  }

  /** Номер тижня за ISO (тиждень з понеділка; перший — той, де 4 січня). */
  function isoWeek(d) {
    const th = D.addDays(D.startOfWeek(d), 3);
    return Math.floor(D.diffDays(D.make(D.parse(th).y, 1, 1), th) / 7) + 1;
  }

  // ---------- Пошук подій ----------
  /** Найближчий день, на який припадає подія (для серії — наступний повтор), і чи він уже минув. */
  function whenOf(e, T) {
    if (isSeries(e)) {
      const n = nextOccurrence(e, T);
      return n ? { date: n.date, occ: n.occ, past: n.date < T } : null;
    }
    const end = spanEnd(e) || e.date;
    return { date: e.date, occ: null, past: end < T };
  }
  function openSearch() {
    closeQuick();
    const T = D.today();
    const q0 = lsGet('crm.cal.searchCat', '');
    const input = ui.input({ placeholder: 'Назва або нотатки…', maxlength: 100, 'aria-label': 'Що шукати', class: 'input kal-search-in', type: 'search' });
    const catSel = ui.select([{ value: '', label: 'Усі категорії' }].concat(categories().map((c) => ({ value: c.id, label: c.label }))),
      { value: categories().some((c) => c.id === q0) ? q0 : '', 'aria-label': 'Категорія', class: 'select kal-search-cat' });
    const out = h('div', { class: 'kal-search-out', 'aria-live': 'polite' });
    const LIMIT = 50;
    function row(x) {
      const e = x.e;
      const se = spanEnd(e);
      const when = x.w ? (se ? spanText(e.date, se) : `${dayShort(x.w.date)}${e.allDay || !e.start ? '' : ', ' + whenText(e)}`) : '';
      return h('button', {
        type: 'button', class: 'kal-sres' + (x.w && x.w.past ? ' past' : ''), style: { '--c': catColor(e.cat) }, dataset: { id: e.id },
        onClick: () => { dlg.close('open'); go('day', x.w ? x.w.date : e.date, Object.assign({ open: e.id }, x.w && x.w.occ ? { occ: x.w.occ } : {})); }
      },
      h('span', { class: 'kal-sres-bar', 'aria-hidden': 'true' }),
      h('span', { class: 'kal-sres-main' },
        h('span', { class: 'kal-sres-title' }, isSeries(e) ? CRM.icon('repeat', { size: 'sm', className: 'kal-rep-ico' }) : null, e.title || 'Без назви'),
        h('span', { class: 'kal-sres-sub' }, [when, isSeries(e) ? repeatText(e) : null, categoryName(e.cat)].filter(Boolean).join(' · '))));
    }
    function run() {
      const q = CRM.utils.normalize(input.value).trim();
      const cat = catSel.value;
      lsSet('crm.cal.searchCat', cat);
      const words = q ? q.split(/\s+/) : [];
      const list = CRM.store.list('events').filter((e) => {
        if (!D.isDate(e.date)) return false;
        if (cat && categoryOf(e.cat).id !== cat) return false;
        if (!words.length) return !!cat;
        const hay = CRM.utils.normalize(`${e.title || ''} ${e.note || ''}`);
        return words.every((w) => hay.includes(w));
      }).map((e) => ({ e, w: whenOf(e, T) }));
      if (!q && !cat) {
        ui.mount(out, h('div', { class: 'kal-search-empty subtle' }, 'Почни писати назву події або вибери категорію — покажу найближчі й минулі.'));
        return;
      }
      const up = list.filter((x) => x.w && !x.w.past).sort((a, b) => a.w.date.localeCompare(b.w.date) || String(a.e.start || '').localeCompare(String(b.e.start || '')));
      const past = list.filter((x) => !x.w || x.w.past).sort((a, b) => (b.w ? b.w.date : '').localeCompare(a.w ? a.w.date : ''));
      if (!up.length && !past.length) {
        ui.mount(out, ui.empty({ icon: 'search', small: true, title: 'Нічого не знайдено', text: cat && q ? 'Спробуй інше слово або «Усі категорії».' : 'Спробуй інше слово.' }));
        return;
      }
      ui.mount(out,
        up.length ? h('div', { class: 'kal-sgroup' }, h('div', { class: 'kal-sgroup-head' }, `Найближчі · ${up.length}`), up.slice(0, LIMIT).map(row)) : null,
        past.length ? h('div', { class: 'kal-sgroup' }, h('div', { class: 'kal-sgroup-head' }, `Минулі · ${past.length}`), past.slice(0, LIMIT).map(row)) : null);
    }
    let timer = 0;
    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(run, 120); });
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); const first = out.querySelector('.kal-sres'); if (first) first.click(); }
    });
    catSel.addEventListener('change', run);
    run();
    const dlg = ui.modal({
      title: 'Пошук подій', size: 'md', className: 'kal-search-modal',
      body: h('div', { class: 'kal-search' }, h('div', { class: 'kal-search-bar' }, input, catSel), out),
      footer: [ui.button({ label: 'Закрити', onClick: () => dlg.close('button') })],
      initialFocus: input
    });
    return dlg;
  }

  function viewSwitch(view, anchor) {
    return h('div', { class: 'segmented kal-views', role: 'radiogroup', 'aria-label': 'Перегляд' },
      VIEWS.map((v) => h('button', {
        type: 'button', role: 'radio', class: v.id === view ? 'active' : '', 'aria-checked': v.id === view ? 'true' : 'false',
        dataset: { hk: 'view-' + v.id },
        onClick: () => { lsSet('crm.cal.view', v.id); go(v.id, anchor); }
      }, v.label)));
  }

  /** Підпис про Google Календар під панеллю. */
  function gcalNote(r) {
    if (!CRM.gcal || !layers().gcal) return null;
    const parts = [];
    const st = CRM.gcal.statusNote();
    if (st) parts.push(st);
    const lr = CRM.gcal.loadedRange();
    if (lr && CRM.gcal.status() !== 'connected' && (r.from < lr.from || r.to > lr.to)) {
      parts.push(h('span', null, ` · Події Google завантажено з ${fmt.dateShort(lr.from)} по ${fmt.dateShort(lr.to)}.`));
    }
    return parts.length ? h('div', { class: 'kal-gnote' }, CRM.icon('calendar', { size: 'sm' }), h('span', null, parts)) : null;
  }

  // ---------- Сторінка ----------
  function render(container, route) {
    const p = route.params || {};
    const view = VIEWS.some((v) => v.id === p.view) ? p.view : defaultView();
    const anchor = D.isDate(p.date) ? p.date : D.today();
    if (p.view && VIEWS.some((v) => v.id === p.view)) lsSet('crm.cal.view', view);
    // Перемальовування (напр., прийшли зміни з іншого пристрою) не закриває віконце, де людина пише назву
    if (location.hash !== quickRoute) closeQuick();
    const r = rangeOf(view, anchor);
    const L = layers();
    if (CRM.gcal && CRM.gcal.ensureRange && L.gcal) CRM.gcal.ensureRange(r.from, r.to);
    const data = collect(r.from, r.to);
    const T = D.today();
    const isToday = T >= r.from && T <= r.to && (view !== 'month' || T.slice(0, 7) === r.monthStart.slice(0, 7));
    const withPanel = view === 'day' && tasksOn(L);
    // Людина саме вписує нову задачу в «План дня» — після перемальовування поле знову в фокусі
    const ae = document.activeElement;
    const typing = !!(ae && ae.classList && ae.classList.contains('kal-newtask-in') && container.contains(ae));

    const sub = view === 'month' ? fmt.month(r.monthStart) : rangeText(r.from, r.to);
    const toolbar = h('div', { class: 'kal-toolbar' },
      h('div', { class: 'kal-nav' },
        ui.button({ icon: 'chevronLeft', iconOnly: true, size: 'sm', title: 'Назад', ariaLabel: 'Попередній період', dataset: { hk: 'prev' }, onClick: () => go(view, stepDate(view, anchor, -1)) }),
        ui.button({ label: 'Сьогодні', size: 'sm', disabled: isToday && (view === 'week' || anchor === T), dataset: { hk: 'today' }, onClick: () => go(view, T) }),
        ui.button({ icon: 'chevronRight', iconOnly: true, size: 'sm', title: 'Вперед', ariaLabel: 'Наступний період', dataset: { hk: 'next' }, onClick: () => go(view, stepDate(view, anchor, 1)) }),
        // Назва періоду — кнопка «Перейти до дати»
        ui.dateInput({
          value: anchor, clearable: false, className: 'kal-range', text: sub, title: 'Перейти до дати', ariaLabel: `${sub}. Перейти до дати`,
          onChange: (v) => { if (D.isDate(v)) go(view, v); }
        }),
        view !== 'month' ? h('span', { class: 'kal-weekno num', title: 'Номер тижня' },
          h('span', { class: 'kal-weekno-long' }, 'Тиждень '), h('span', { class: 'kal-weekno-short' }, 'тиж. '), String(isoWeek(r.from))) : null),
      h('div', { class: 'kal-tools' }, viewSwitch(view, anchor),
        ui.button({ icon: 'search', iconOnly: true, size: 'sm', title: 'Пошук подій', ariaLabel: 'Пошук подій', className: 'kal-search-btn', onClick: openSearch }),
        layersButton()));

    let main = view === 'month' ? monthView(r, data, anchor) : gridView(r, data, { noUntimedTasks: withPanel });
    if (withPanel) {
      const grid = main;
      main = h('div', { class: 'kal-dayview' }, dayPanel(anchor), grid);
      main._afterMount = grid._afterMount;
    }
    const hint = h('div', { class: 'kal-hint' },
      h('span', { class: 'kal-hint-mouse' }, view === 'month'
        ? 'Клікни на день, щоб додати подію чи задачу; перетягни пункт на інший день, щоб перенести (з затиснутим Ctrl — скопіювати).'
        : 'Клікни на вільний час, щоб додати подію чи задачу (або протягни мишкою для свого проміжку). Перетягни пункт, щоб перенести (з затиснутим Ctrl — скопіювати); потягни за нижній край — щоб змінити тривалість.' +
          (withPanel ? ' Задачу з «Плану дня» можна перетягнути в сітку (зʼявиться час) і назад.' : '')),
      h('span', { class: 'kal-hint-touch' }, view === 'month'
        ? 'Торкнися дня, щоб побачити його події. Утримуй пункт, щоб перетягнути його на інший день.'
        : 'Торкнися вільного часу, щоб додати подію чи задачу. Утримуй пункт, щоб перетягнути його; утримуй нижній край — щоб змінити тривалість.' +
          (withPanel ? ' Утримуй задачу в «Плані дня», щоб змінити порядок або перетягнути її в сітку.' : '')));

    ui.mount(container,
      ui.pageHead({
        title: 'Календар',
        actions: ui.button({ label: 'Подія', icon: 'plus', variant: 'primary', onClick: () => openNew(r) })
      }),
      h('div', { class: 'kal stack' }, toolbar, gcalNote(r), tasksOn(L) && isToday ? rollBanner() : null, main, hint));
    if (main._afterMount) main._afterMount();
    if (typing) {
      const inp = container.querySelector('.kal-newtask-in');
      if (inp) inp.focus({ preventScroll: true });
    }
    if (refocusTask) {
      const row = container.querySelector(`.kal-drow[data-id="${CSS.escape(refocusTask)}"]`);
      refocusTask = null;
      if (row) row.focus({ preventScroll: true });
    }

    // Відкрити подію з адреси (пошук, сповіщення)
    if (p.open) {
      const id = p.open;
      const ser = CRM.store.get('events', id);
      // Для серії — повтор з адреси (occ) або той, що показується в цей день
      const occ = D.isDate(p.occ) ? p.occ : ser && isSeries(ser) ? occOn(ser, anchor) : null;
      CRM.router.consumeParam('open');
      CRM.router.consumeParam('occ');
      setTimeout(() => openEditor(id, null, occ), 0);
    }

    // Події Google не зберігаються в розділах даних — слухаємо окрему подію; тема — кольори
    const onGcal = (e) => {
      if (e.detail && e.detail.busy) return;
      // Людина саме вписує назву нової події — не заважаємо, перемалюємо після
      if (quick && quick.isOpen) { rerenderLater = true; return; }
      CRM.router.rerender();
    };
    const onTheme = () => CRM.router.rerender();
    // Свої категорії змінили (тут, в іншій вкладці чи на іншому пристрої) — перемалювати
    let catRaw = CRM.store.getSetting('calCategories', null);
    const offCats = CRM.store.on(['settings'], () => {
      const now = CRM.store.getSetting('calCategories', null);
      if (now === catRaw) return;
      catRaw = now;
      if (quick && quick.isOpen) { rerenderLater = true; return; }
      CRM.router.rerender();
    });
    const onMinute = () => {
      const now = container.querySelector('.kal-now');
      if (now) now.style.top = px(nowMin());
    };
    document.addEventListener('crm:gcalchange', onGcal);
    document.addEventListener('crm:themechange', onTheme);
    document.addEventListener('crm:minute', onMinute);
    return () => {
      document.removeEventListener('crm:gcalchange', onGcal);
      document.removeEventListener('crm:themechange', onTheme);
      document.removeEventListener('crm:minute', onMinute);
      offCats();
      if (teardown) { const t = teardown; teardown = null; try { t(); } catch (e) { console.error(e); } }
      if (location.hash !== quickRoute) closeQuick();
    };
  }

  CRM.router.register('calendar', {
    title: 'Календар',
    stores: ['events', 'tasks', 'projects', 'people', 'recurring', 'transactions', 'programs', 'workouts', 'courses'],
    render
  });

  // ---------- Розклад на Головній ----------
  // (уроки з «Репетиторства» показує tutor.js — зі своїм вікном уроку)
  CRM.home.addScheduleSource((date) => occurrences(date, date).filter(({ ev }) => !(ev.studentId && CRM.tutor && CRM.tutor.get(ev.studentId))).map(({ ev, span }) => ({
    time: ev.allDay || !ev.start ? null : ev.start, kind: 'calendar', icon: 'calendar', cls: 'ico-event',
    title: ev.title || 'Без назви',
    sub: ['Календар', span ? `день ${span.day} з ${span.days} (${spanText(span.first, span.last)})` : whenText(ev), categoryName(ev.cat)].join(' · '),
    onClick: () => go('day', date)
  })));
  // Задачі, заплановані на день, — у порядку «Плану дня» (виконані — з позначкою)
  CRM.home.addScheduleSource((date) => plannedTasks(date, date).sort(byPlanOrder).map((t, i) => {
    const s = taskStart(t);
    return {
      time: s == null ? null : fromMin(s), order: i, kind: 'task', icon: 'tasks', cls: 'ico-task',
      title: t.title || 'Без назви',
      sub: ['План дня', s == null ? null : `${fromMin(s)}–${fromMin(taskEnd(t))}`, deadlineNote(t, date)].filter(Boolean).join(' · '),
      badge: t.done ? { text: 'Виконано', cls: 'badge-success' } : null,
      done: !!t.done,
      onClick: () => CRM.tasks.openTask(t.id)
    };
  }));

  // ---------- Нагадування ----------
  CRM.notify.addRule(() => {
    const T = D.today();
    const now = Date.now();
    const out = [];
    occurrences(T, D.addDays(T, 1)).forEach(({ ev, date }) => {
      if (ev.allDay || !ev.start || ev.remind == null || ev.remind === '') return;
      const lead = Number(ev.remind);
      const left = kyivMs(date, evStart(ev)) - now;
      const due = lead === 0 ? left <= 0 && left > -5 * 60000 : left > 0 && left <= lead * 60000;
      if (!due) return;
      let title;
      if (lead === 0) title = `Починається: ${ev.title}`;
      else if (left < 60 * 60000) title = `Через ${Math.max(1, Math.round(left / 60000))} хв: ${ev.title}`;
      else title = `${date === T ? 'Сьогодні' : 'Завтра'} о ${ev.start}: ${ev.title}`;
      out.push({
        key: `calevent:${ev.id}:${date}T${ev.start}`, kind: 'event', title,
        text: `Календар · ${whenText(ev)} · ${categoryName(ev.cat)}`,
        target: { route: 'calendar', params: { view: 'day', date } },
        // Копія вже в Google — нагадує Google (телефон), тут лише дзвіночок (без системного сповіщення)
        quiet: !!(CRM.gmirror && CRM.gmirror.googleReminds(ev.id))
      });
    });
    return out;
  });

  CRM.calendar = {
    get CATEGORIES() { return categories(); },
    DEFAULT_CATEGORIES, VIEWS, LAYERS, REMINDERS, HOUR, TASK_DUR, MAX_SPAN,
    whenText, categoryName, categories, categoryOf, occurrences, collect, layoutTimed, rangeOf, openEditor, openNew, kyivMs, toMin, fromMin, go,
    plannedTasks, untimedOn, overdueTasks, planTask, rollOver,
    FREQS, isSeries, repeatText, nextOccurrence, seriesDates, instanceOf, occOn, ruleOf, seriesFirst, isOccurrence,
    spanEnd, spanText, isoWeek, copyEvent, copyFields, openCategories, openSearch, renameCategory, deleteCategory, setCategoryColor, setCategoryGColor, categoryGColor, hiddenCats,
    // Події Google (пункт 12)
    openGoogle, createGoogle, copyGoogle, deleteGoogle, googleTarget, gFind, gTargets
  };
})(window.CRM);
