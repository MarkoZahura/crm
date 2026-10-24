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

   Подія: { id, title, date: 'РРРР-ММ-ДД', allDay, start: 'ГГ:ХХ' | null, dur: хвилини | null,
            cat: id категорії, remind: хвилини до початку | null, note }
   Подія не виходить за межі доби (найпізніше — до 24:00).
   Адреса: #/calendar?view=day|3days|week|month&date=РРРР-МM-ДД[&open=<id події>]
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

  const CATEGORIES = [
    { id: 'personal', label: 'Особисте', color: 'blue' },
    { id: 'work', label: 'Робота', color: 'orange' },
    { id: 'study', label: 'Навчання', color: 'violet' },
    { id: 'health', label: 'Спорт і здоровʼя', color: 'green' },
    { id: 'meeting', label: 'Зустрічі', color: 'magenta' },
    { id: 'other', label: 'Інше', color: 'slate' }
  ];

  const REMINDERS = [
    { v: null, label: 'Без нагадування' },
    { v: 0, label: 'У момент початку' },
    { v: 5, label: 'За 5 хв' },
    { v: 10, label: 'За 10 хв' },
    { v: 15, label: 'За 15 хв' },
    { v: 30, label: 'За 30 хв' },
    { v: 60, label: 'За 1 год' },
    { v: 1440, label: 'За 1 день' }
  ];

  const LAYERS = [
    { id: 'own', label: 'Мої події' },
    { id: 'tasks', label: 'Задачі в плані' },
    { id: 'gcal', label: 'Google Календар' },
    { id: 'training', label: 'Тренування з програм' },
    { id: 'payments', label: 'Регулярні платежі' },
    { id: 'deadlines', label: 'Дедлайни задач' }
  ];
  const KIND_ORDER = { own: 0, task: 1, gcal: 2, training: 3, payment: 4, deadline: 5 };

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
    return CATEGORIES.some((x) => x.id === c) ? c : 'personal';
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

  // ---------- Події ----------
  function categoryOf(id) { return CATEGORIES.find((c) => c.id === id) || CATEGORIES[0]; }
  function categoryName(id) { return categoryOf(id).label; }
  function catColor(id) { return CRM.dict.categoryColor(categoryOf(id).color); }
  function evStart(ev) { return toMin(ev.start) || 0; }
  function evEnd(ev) { return Math.min(DAY_MIN, evStart(ev) + (Number(ev.dur) > 0 ? Number(ev.dur) : 60)); }
  /** «весь день» або «10:00–11:30». */
  function whenText(ev) {
    if (!ev || ev.allDay || !ev.start) return 'весь день';
    return `${ev.start}–${fromMin(evEnd(ev))}`;
  }

  /** Власні події, що припадають на [from, to]: [{ ev, date }]. */
  function occurrences(from, to) {
    return CRM.store.list('events')
      .filter((e) => D.isDate(e.date) && e.date >= from && e.date <= to)
      .map((e) => ({ ev: e, date: e.date }));
  }

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
      occurrences(from, to).forEach(({ ev, date }) => {
        const it = {
          key: 'own:' + ev.id + ':' + date, kind: 'own', title: ev.title || 'Без назви', color: catColor(ev.cat),
          icon: 'calendar', ev, date, editable: true
        };
        if (ev.allDay || !ev.start) {
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

    if (L.gcal && CRM.gcal && CRM.gcal.eventsBetween) {
      const gColor = CRM.dict.categoryColor('teal');
      CRM.gcal.eventsBetween(from, to).forEach((g) => {
        days.forEach((d) => {
          if (!CRM.gcal.occursOn(g, d)) return;
          const it = {
            key: 'g:' + g.cal + ':' + g.id + ':' + d, kind: 'gcal', title: g.title, color: gColor, icon: 'calendar',
            gev: g, date: d, tentative: !!g.tentative
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

    byDay.forEach((b) => {
      b.allDay.sort((a, c) => (KIND_ORDER[a.kind] - KIND_ORDER[c.kind]) || ((a.order || 0) - (c.order || 0)) ||
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
    const cur = CRM.store.get('events', ev.id);
    if (!cur) return;
    const before = { date: cur.date, start: cur.start, dur: cur.dur, allDay: cur.allDay };
    const saved = await CRM.store.patch('events', ev.id, changes);
    const text = kind === 'resize'
      ? `«${saved.title}»: ${whenText(saved)} (${durText(saved.dur)})`
      : `«${saved.title}» перенесено: ${dayShort(saved.date)}${saved.allDay ? '' : ', ' + whenText(saved)}`;
    ui.toast(text, {
      type: 'success',
      action: { label: 'Скасувати', onClick: () => CRM.store.patch('events', ev.id, before) }
    });
  }

  async function removeEvent(ev) {
    const batch = await CRM.store.softDelete('events', ev.id);
    ui.toast(`Подію «${ev.title}» видалено`, {
      action: { label: 'Скасувати', onClick: () => CRM.store.restoreBatch(batch) }
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
        s.move(m.clientX, m.clientY);
      };
      const up = (u) => {
        stop();
        if (s) { suppressUntil = Date.now() + 400; s.end(u.type === 'pointerup'); }
      };
      const key = (k) => {
        if (k.key !== 'Escape' || !s) return;
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
    block.classList.add('kal-dragging');
    block.setAttribute('aria-grabbed', 'true');

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
      move(x, y) { st.x = x; st.y = y; apply(); },
      end(commit) {
        cancelAnimationFrame(raf);
        block.classList.remove('kal-dragging', 'kal-out');
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
    return {
      move(x, y) {
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
      end(commit) {
        clone.remove();
        chip.classList.remove('kal-lifted');
        if (over) over.classList.remove('kal-drop');
        const d = over && over.dataset.dropDate;
        if (commit && d && d !== it.date) moveEvent(it.ev, { date: d }, 'move');
      }
    };
  }

  // ---------- Відкрити пункт ----------
  function openItem(it) {
    if (it.kind === 'own') openEditor(it.ev.id);
    else if (it.kind === 'task') CRM.tasks.openTask(it.task.id);
    else if (it.kind === 'gcal') showGoogle(it.gev);
    else if (it.onOpen) it.onOpen();
  }

  function showGoogle(g) {
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
        h('div', { class: 'callout' }, CRM.icon('info'), h('span', null, 'Подія з Google Календаря: тут її видно, а змінити чи видалити можна лише в самому Google Календарі.'))),
      footer: [
        ui.button({ label: 'Закрити', onClick: () => dlg.close('button') }),
        g.link ? ui.button({ label: 'Відкрити в Google', icon: 'external', variant: 'primary', onClick: () => { CRM.gcal.openEvent(g); dlg.close('button'); } }) : null
      ]
    });
  }

  // ---------- Вибір категорії ----------
  function catPicker(current, onPick, compact) {
    const wrap = h('div', { class: 'kal-cats' + (compact ? ' compact' : ''), role: 'radiogroup', 'aria-label': 'Категорія' });
    const draw = (val) => ui.mount(wrap, CATEGORIES.map((c) => h('button', {
      type: 'button', role: 'radio', class: 'kal-cat' + (val === c.id ? ' active' : ''), 'aria-checked': val === c.id ? 'true' : 'false',
      title: c.label, 'aria-label': c.label, dataset: { cat: c.id }, style: { '--c': CRM.dict.categoryColor(c.color) },
      onClick: () => { draw(c.id); onPick(c.id); }
    }, h('span', { class: 'kal-cat-dot' }), compact ? null : h('span', null, c.label))));
    draw(current);
    return wrap;
  }

  // ---------- Швидке додавання ----------
  /** preset: { date, allDay, start, dur } */
  function quickAdd(anchor, preset, onClose) {
    closeQuick();
    let cat = lastCat();
    let kind = CRM.tasks && CRM.tasks.create ? lastKind() : 'event';
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
      openEditor(null, v.error ? Object.assign({}, preset, { title: titleIn.value.trim(), cat }) : v);
    }
    titleIn.addEventListener('input', () => { errEl.textContent = ''; });
    titleIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    if (timeIn) timeIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); timeIn.dispatchEvent(new Event('change')); add(); } });

    const content = h('div', { class: 'kal-quick' },
      CRM.tasks && CRM.tasks.create ? kindSeg : null,
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

  /** Відкрити форму: id — наявна подія; preset — значення нової. */
  function openEditor(id, preset) {
    const cur = id ? CRM.store.get('events', id) : null;
    if (id && !cur) { ui.toast('Цієї події більше немає', { type: 'error' }); return null; }
    if (cur && cur.deletedAt) { ui.toast('Подія в Кошику — віднови її, щоб відкрити'); return null; }
    closeQuick();
    const ev = cur ? CRM.utils.deepClone(cur) : Object.assign({
      title: '', date: D.today(), allDay: false, start: '09:00', dur: 60, cat: lastCat(), remind: 15, note: ''
    }, preset || {});
    if (!ev.allDay && !ev.start) ev.allDay = true;
    let allDay = !!ev.allDay;
    let cat = ev.cat || 'personal';
    const s0 = ev.allDay ? 9 * 60 : evStart(ev);
    let span = ev.allDay ? 60 : evEnd(ev) - s0;

    const titleIn = ui.input({ value: ev.title, maxlength: 200, placeholder: 'Наприклад, Заняття з англійської', 'aria-label': 'Назва' });
    const fTitle = ui.field({ label: 'Назва', required: true, input: titleIn });
    const dateIn = ui.dateInput({ value: ev.date, clearable: false, ariaLabel: 'Дата' });
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
    const remindSel = ui.select(REMINDERS.map((r) => ({ value: r.v == null ? '' : String(r.v), label: r.label })),
      { value: ev.remind == null ? '' : String(ev.remind), 'aria-label': 'Нагадування' });
    const fRemind = ui.field({ label: 'Нагадування', input: remindSel, hint: 'Приходить, лише коли CRM відкрита (вкладка може бути у фоні).' });
    const allDayBox = check('Весь день', allDay, (on) => {
      allDay = on;
      fTimes.hidden = on;
      fRemind.hidden = on;
    });
    fTimes.hidden = allDay;
    fRemind.hidden = allDay;
    const noteIn = ui.textarea({ value: ev.note || '', rows: 3, maxlength: 2000, placeholder: 'Необовʼязково: що підготувати, посилання, адреса…', 'aria-label': 'Нотатки' });

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
      if (!canSave()) return;
      const rv = remindSel.value;
      const rec = Object.assign({}, cur || {}, {
        title, date: dateIn.dateValue || ev.date, allDay, start, dur, cat,
        remind: allDay || rv === '' ? null : Number(rv), note: noteIn.value.trim()
      });
      lsSet('crm.cal.cat', cat);
      dlg.close('saved');
      await CRM.store.save('events', rec);
      ui.toast(cur ? 'Подію збережено' : `Подію додано: ${dayShort(rec.date)}${allDay ? '' : ', ' + whenText(rec)}`, { type: 'success' });
    }
    titleIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });

    const body = h('div', { class: 'form-stack kal-editor' },
      fTitle,
      h('div', { class: 'kal-when-row' }, ui.field({ label: 'Дата', input: dateIn }), allDayBox),
      fTimes,
      ui.field({ label: 'Категорія', input: catPicker(cat, (v) => { cat = v; }) }),
      fRemind,
      ui.field({ label: 'Нотатки', input: noteIn }));
    const footer = [
      cur ? ui.button({ label: 'Видалити', icon: 'trash', variant: 'danger-ghost', className: 'kal-del', onClick: async () => {
        const ok = await ui.confirm({
          title: 'Видалити подію?', message: `«${cur.title}» перейде в Кошик — її можна відновити протягом 30 днів.`,
          confirmText: 'Видалити', danger: true
        });
        if (!ok) return;
        dlg.close('delete');
        await removeEvent(cur);
      } }) : null,
      ui.button({ label: 'Скасувати', onClick: () => dlg.close('button') }),
      ui.button({ label: cur ? 'Зберегти' : 'Додати', variant: 'primary', onClick: save })
    ];
    const dlg = ui.modal({ title: cur ? 'Подія' : 'Нова подія', size: 'md', className: 'kal-editor-modal', body, footer, initialFocus: titleIn });
    return dlg;
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

  function chip(it, opts) {
    const o = opts || {};
    const cls = ['kal-chip', 'k-' + it.kind];
    if (it.done) cls.push('done');
    if (it.overdue) cls.push('overdue');
    if (it.tentative) cls.push('tentative');
    const label = (it.time ? it.time + ' ' : '') + it.title;
    if (it.kind === 'task') return taskChip(it, cls, label, o);
    const el = h('button', {
      type: 'button', class: cls.join(' '), style: { '--c': it.color },
      title: [label, it.sub].filter(Boolean).join(' · '), dataset: { key: it.key },
      onClick: (e) => { e.stopPropagation(); if (clicksBlocked()) return; openItem(it); }
    },
    it.kind === 'own' ? null : CRM.icon(it.done ? 'check' : it.icon, { size: 'sm' }),
    o.time ? h('span', { class: 'kal-chip-time num' }, o.time) : null,
    h('span', { class: 'kal-chip-title' }, label),
    o.withSub && it.sub ? h('span', { class: 'kal-chip-sub' }, it.sub) : null);
    if (it.kind === 'own') attachDrag(el, (sx, sy) => daySession(el, it, sx, sy));
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
    if (short) cls.push('short');
    if (it.past) cls.push('past');
    if (it.tentative) cls.push('tentative');
    if (it.done) cls.push('done');
    if (it.overdue) cls.push('overdue');
    const w = 100 / (it.ncols || 1);
    const el = h('div', {
      class: cls.join(' '), role: 'button', tabIndex: 0, dataset: { key: it.key },
      'aria-label': `${it.title}, ${it.sub}`,
      title: `${it.title}\n${it.sub}${it.kind === 'gcal' ? '\nGoogle Календар' : it.kind === 'task' ? '\nЗадача' : ''}`,
      style: {
        '--c': it.color, top: px(it.startMin), height: px(Math.max(it.endMin - it.startMin, MIN_VIS * 0.8), true),
        left: `calc(${(it.col || 0) * w}% + 1px)`, width: `calc(${w}% - 3px)`
      }
    },
    it.kind === 'task' ? taskCheck(it.task) : null,
    h('span', { class: 'kal-ev-title' }, it.title),
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
    const grid = h('div', { class: 'kal-mgrid' },
      CRM.WEEKDAYS_SHORT.map((w, i) => h('div', { class: 'kal-mwd' + (i >= 5 ? ' weekend' : '') }, w)),
      cells);
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
    const btn = ui.button({ label: off ? `Показати · ${LAYERS.length - off} з ${LAYERS.length}` : 'Показати', icon: 'eye', size: 'sm', className: 'kal-layers-btn' });
    btn.setAttribute('aria-haspopup', 'dialog');
    btn.addEventListener('click', () => {
      const cur = layers();
      const pop = ui.popover(btn, h('div', { class: 'menu kal-layers', role: 'group', 'aria-label': 'Що показувати' },
        LAYERS.map((l) => check(l.label, cur[l.id], (on) => { setLayer(l.id, on); CRM.router.rerender(); }))),
      { align: 'end' });
      return pop;
    });
    return btn;
  }

  function viewSwitch(view, anchor) {
    return h('div', { class: 'segmented kal-views', role: 'radiogroup', 'aria-label': 'Перегляд' },
      VIEWS.map((v) => h('button', {
        type: 'button', role: 'radio', class: v.id === view ? 'active' : '', 'aria-checked': v.id === view ? 'true' : 'false',
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
        ui.button({ icon: 'chevronLeft', iconOnly: true, size: 'sm', title: 'Назад', ariaLabel: 'Попередній період', onClick: () => go(view, stepDate(view, anchor, -1)) }),
        ui.button({ label: 'Сьогодні', size: 'sm', disabled: isToday && (view === 'week' || anchor === T), onClick: () => go(view, T) }),
        ui.button({ icon: 'chevronRight', iconOnly: true, size: 'sm', title: 'Вперед', ariaLabel: 'Наступний період', onClick: () => go(view, stepDate(view, anchor, 1)) }),
        h('span', { class: 'kal-range' }, sub)),
      h('div', { class: 'kal-tools' }, viewSwitch(view, anchor), layersButton()));

    let main = view === 'month' ? monthView(r, data, anchor) : gridView(r, data, { noUntimedTasks: withPanel });
    if (withPanel) {
      const grid = main;
      main = h('div', { class: 'kal-dayview' }, dayPanel(anchor), grid);
      main._afterMount = grid._afterMount;
    }
    const hint = h('div', { class: 'kal-hint' },
      h('span', { class: 'kal-hint-mouse' }, view === 'month'
        ? 'Клікни на день, щоб додати подію чи задачу; перетягни пункт на інший день, щоб перенести.'
        : 'Клікни на вільний час, щоб додати подію чи задачу (або протягни мишкою для свого проміжку). Перетягни пункт, щоб перенести; потягни за нижній край — щоб змінити тривалість.' +
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
      CRM.router.consumeParam('open');
      setTimeout(() => openEditor(id), 0);
    }

    // Події Google не зберігаються в розділах даних — слухаємо окрему подію; тема — кольори
    const onGcal = (e) => {
      if (e.detail && e.detail.busy) return;
      // Людина саме вписує назву нової події — не заважаємо, перемалюємо після
      if (quick && quick.isOpen) { rerenderLater = true; return; }
      CRM.router.rerender();
    };
    const onTheme = () => CRM.router.rerender();
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
      if (teardown) { const t = teardown; teardown = null; try { t(); } catch (e) { console.error(e); } }
      if (location.hash !== quickRoute) closeQuick();
    };
  }

  CRM.router.register('calendar', {
    title: 'Календар',
    stores: ['events', 'tasks', 'recurring', 'transactions', 'programs', 'workouts'],
    render
  });

  // ---------- Розклад на Головній ----------
  CRM.home.addScheduleSource((date) => occurrences(date, date).map(({ ev }) => ({
    time: ev.allDay || !ev.start ? null : ev.start, kind: 'calendar', icon: 'calendar', cls: 'ico-event',
    title: ev.title || 'Без назви',
    sub: ['Календар', whenText(ev), categoryName(ev.cat)].join(' · '),
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
        target: { route: 'calendar', params: { view: 'day', date } }
      });
    });
    return out;
  });

  CRM.calendar = {
    CATEGORIES, VIEWS, LAYERS, REMINDERS, HOUR, TASK_DUR,
    whenText, categoryName, occurrences, collect, layoutTimed, rangeOf, openEditor, openNew, kyivMs, toMin, fromMin, go,
    plannedTasks, untimedOn, overdueTasks, planTask, rollOver
  };
})(window.CRM);
