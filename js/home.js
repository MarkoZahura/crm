/* ==========================================================================
   home.js — Головна: привітання й цитата дня, «Цифри дня» з тижнем (29.10.2026), активні задачі, харчування сьогодні,
   розклад на сьогодні (задачі з дедлайном сьогодні, регулярні платежі,
   дедлайни навчання, власні події з «Календаря», події Google Календаря), доходи й витрати за сьогодні в гривнях,
   «Сьогоднішнє тренування» за програмами (programs.js), «Звички» сьогодні (habits.js), «Люди» (people.js).
   «Налаштувати Головну»: які блоки показувати, у якому порядку (ПК — ліва/права колонка, телефон — один список),
   згортання блоків — налаштування homeLayout { pc, phone } (синхронізується).
   ========================================================================== */
window.CRM = window.CRM || {};

(function (CRM) {
  'use strict';

  const { h, ui } = { h: CRM.ui.h, ui: CRM.ui };
  const D = CRM.date;
  const fmt = CRM.fmt;
  const MAX_TASKS = 8;

  /** Джерела розкладу. Інші розділи (календар, навчання) додають свої через CRM.home.addScheduleSource. */
  const scheduleSources = [];
  function addScheduleSource(fn) { scheduleSources.push(fn); }

  function greeting() {
    const hh = D.kyivParts().hh;
    const profile = CRM.store.getSetting('profile', {}) || {};
    const first = (profile.name || '').trim().split(/\s+/)[0];
    const word = hh >= 5 && hh < 12 ? 'Доброго ранку' : hh >= 12 && hh < 18 ? 'Добрий день' : hh >= 18 && hh < 23 ? 'Добрий вечір' : 'Доброї ночі';
    return first ? `${word}, ${first}` : word;
  }

  // ---------- Цитата дня (праворуч від привітання) ----------
  function quoteFigure() {
    const q = CRM.quotes.forDate(D.today());
    // Своя цитата з книги (books.js) — підпис веде на книгу
    const author = q.own && q.bookId
      ? h('a', { class: 'quote-author quote-own', href: CRM.router.href('books/' + q.bookId, q.quoteId ? { quote: q.quoteId } : null), title: 'Моя цитата — відкрити книгу' }, '— ' + q.author)
      : h('span', { class: 'quote-author' }, '— ' + q.author);
    return h('figure', { class: 'home-quote' + (q.own ? ' is-own' : '') },
      h('blockquote', { class: 'quote-text' }, q.text),
      h('figcaption', { class: 'quote-meta' },
        author,
        h('span', { class: 'quote-date' }, q.own ? ' · моя цитата дня' : ' · цитата дня')));
  }

  // ---------- Цифри дня ----------
  function overdueTask(t, T) { return (t.deadline && t.deadline < T) || (!t.deadline && t.planDate && t.planDate < T); }

  /** Найближчий пункт з часом: сьогодні (ще не минув) або в наступні 6 днів. */
  function nextItem() {
    const T = D.today();
    const now = D.nowTime();
    const today = scheduleItems().filter((i) => i.time && !i.done && i.time >= now)[0];
    if (today) return { day: T, time: today.time, title: today.title, today: true };
    if (!CRM.calendar || !CRM.calendar.collect) return null;
    const data = CRM.calendar.collect(D.addDays(T, 1), D.addDays(T, 6));
    for (const [d, b] of data) {
      const t = b.timed.filter((x) => !x.done).sort((x, y) => x.startMin - y.startMin)[0];
      if (t) return { day: d, time: CRM.calendar.fromMin(t.startMin), title: t.title, today: false };
    }
    return null;
  }

  let nextAt = null; // час «Далі» — коли мине, Головна перемальовується
  function todayBlock() {
    const T = D.today();
    const mine = CRM.store.list('tasks').filter((t) => t.deadline === T || t.planDate === T);
    const open = mine.filter((t) => !t.done).length;
    const over = CRM.tasks.activeTasks().filter((t) => overdueTask(t, T)).length;
    const squares = mine.slice(0, 10).map((t) => h('i', { class: t.done ? 'on' : '' }))
      .concat(Array.from({ length: Math.min(over, 4) }, () => h('i', { class: 'hot' })));
    const num = (cls, href, label, value, sub, title) => h('a', { class: 'ht-num ' + cls, href, title },
      h('span', { class: 'ht-label' }, label), h('span', { class: 'ht-value num' }, value), h('span', { class: 'ht-sub' }, sub));

    const tasksNum = num('ht-tasks', '#/tasks', 'Задачі на сьогодні', String(open), [
      squares.length ? h('span', { class: 'ht-sq', 'aria-hidden': 'true' }, squares) : null,
      over ? h('span', { class: 'hot' }, `+${over} ${fmt.plural(over, ['прострочена', 'прострочені', 'прострочених'])}`)
        : h('span', null, mine.length ? (open ? 'усе вчасно' : 'усе зроблено') : 'на сьогодні задач немає')
    ], 'Відкрити задачі');

    const nx = nextItem();
    nextAt = nx && nx.today ? nx.time : null;
    let nextNum;
    if (!nx) nextNum = num('ht-next', CRM.router.href('calendar', { view: 'day', date: T }), 'Далі', '—', h('span', null, 'на тиждень нічого не заплановано'), 'Відкрити календар');
    else {
      const diff = D.diffDays(T, nx.day);
      const when = nx.today ? nx.time : [diff === 1 ? 'Завтра' : CRM.WEEKDAYS_SHORT[D.weekday(nx.day)], h('small', null, nx.time)];
      nextNum = num('ht-next', CRM.router.href('calendar', { view: 'day', date: nx.day }), 'Далі', when,
        h('span', null, nx.title + (nx.today ? '' : ' · сьогодні вже все')), 'Відкрити день у календарі');
    }

    const exp = [];
    for (let k = 6; k >= 0; k--) {
      const d = D.addDays(T, -k);
      exp.push(Math.abs(CRM.finance.totals(CRM.finance.txInRange(d, d).filter((t) => t.type !== 'transfer')).expense || 0));
    }
    const max = Math.max(1, ...exp);
    const moneyNum = num('ht-money', '#/budget/transactions', 'Витрати сьогодні', fmt.money(exp[6] ? -exp[6] : 0, 'UAH'), [
      h('span', { class: 'ht-bars', 'aria-hidden': 'true' }, exp.map((v, i) => h('i', { class: i === 6 ? 'today' : '', style: { height: Math.max(3, Math.round(18 * Math.sqrt(v / max))) + 'px' } }))),
      h('span', null, 'за 7 днів')
    ], 'Відкрити операції');

    let habitsNum;
    if (CRM.habits) {
      const hb = CRM.habits.today();
      habitsNum = num('ht-habits', '#/habits', 'Звички', hb.total ? [String(hb.done), h('small', null, `з ${hb.total}`)] : '—', hb.total ? [
        h('span', { class: 'ht-seg', 'aria-hidden': 'true' }, Array.from({ length: Math.min(hb.total, 8) }, (_, i) => h('i', { class: i < hb.done ? 'on' : '' }))),
        h('span', null, hb.done >= hb.total ? 'усе відмічено' : `ще ${hb.total - hb.done}`)
      ] : h('span', null, 'на сьогодні звичок немає'), 'Відкрити звички');
    }

    return h('section', { class: 'home-today', dataset: { block: 'today' }, 'aria-label': 'Цифри дня' },
      h('div', { class: 'ht-nums' + (habitsNum ? '' : ' ht-three') }, tasksNum, nextNum, moneyNum, habitsNum || null),
      weekStrip());
  }

  const WEEK_KIND = { own: 'own', gcal: 'own', task: 'dl', deadline: 'dl', learning: 'dl', people: 'bday', training: 'train', payment: 'pay' };
  const WEEK_LEGEND = [['own', 'події'], ['dl', 'дедлайни'], ['bday', 'дні народження'], ['train', 'тренування'], ['pay', 'платежі']];
  function weekStrip() {
    if (!CRM.calendar || !CRM.calendar.collect) return null;
    const T = D.today();
    const to = D.addDays(T, 6);
    const data = CRM.calendar.collect(T, to);
    const days = [];
    for (let d = T; d <= to; d = D.addDays(d, 1)) {
      const b = data.get(d) || { allDay: [], timed: [] };
      const items = b.allDay.concat(b.timed);
      const kinds = [];
      items.forEach((it) => { const k = WEEK_KIND[it.kind] || 'own'; if (!kinds.includes(k)) kinds.push(k); });
      const n = items.length;
      const p = D.parse(d);
      const wd = CRM.WEEKDAYS_SHORT[D.weekday(d)];
      days.push(h('a', {
        class: 'ht-day' + (d === T ? ' today' : '') + (n >= 5 ? ' busy' : n === 0 ? ' free' : ''), href: CRM.router.href('calendar', { view: 'day', date: d }),
        title: `${fmt.dateLong(d)}: ${n ? n + ' ' + fmt.plural(n, ['пункт', 'пункти', 'пунктів']) : 'вільно'}`, dataset: { date: d }
      },
      h('span', { class: 'ht-day-top' }, h('span', { class: 'ht-day-n num' }, String(p.d)), h('span', { class: 'ht-day-w' }, wd), d === T ? h('span', { class: 'ht-day-t' }, 'сьогодні') : null),
      h('span', { class: 'ht-dots', 'aria-hidden': 'true' }, kinds.map((k) => h('i', { class: 'k-' + k }))),
      h('span', { class: 'ht-day-note' }, n === 0 ? 'вільно' : n >= 5 ? 'щільно' : `${n} ${fmt.plural(n, ['пункт', 'пункти', 'пунктів'])}`)));
    }
    return [h('div', { class: 'ht-week' }, days),
      h('div', { class: 'ht-legend', 'aria-hidden': 'true' }, WEEK_LEGEND.map(([k, l]) => h('span', null, h('i', { class: 'k-' + k }), l)))];
  }

  // ---------- Активні задачі ----------
  function tasksCard() {
    const all = CRM.tasks.sortTasks(CRM.tasks.activeTasks(), 'deadline');
    const shown = all.slice(0, MAX_TASKS);
    const head = h('div', { class: 'card-head' },
      h('h2', null, 'Активні задачі', all.length ? h('span', { class: 'tab-count' }, String(all.length)) : null),
      h('div', { class: 'btn-row' },
        ui.button({ icon: 'plus', iconOnly: true, size: 'sm', variant: 'ghost', title: 'Нова задача', onClick: () => CRM.tasks.openNew() }),
        all.length ? h('a', { href: '#/tasks', class: 'btn btn-ghost btn-sm' }, 'Усі задачі', CRM.icon('chevronRight', { size: 'sm' })) : null));
    const body = all.length
      ? h('div', { class: 'task-list' }, shown.map((t) => CRM.tasks.taskRow(t, { compact: true })),
        all.length > MAX_TASKS ? h('a', { href: '#/tasks', class: 'more-link' }, `Ще ${all.length - MAX_TASKS} — відкрити всі задачі`) : null)
      : ui.empty({
        icon: 'tasks', small: true, title: 'Ще немає задач — додай першу',
        action: { label: 'Додати задачу', icon: 'plus', onClick: () => CRM.tasks.openNew() }
      });
    return h('section', { class: 'card' }, head, body);
  }

  // ---------- Доходи й витрати за сьогодні ----------
  function moneyCard() {
    const T = D.today();
    const txs = CRM.finance.txInRange(T, T).filter((t) => t.type !== 'transfer');
    const tot = CRM.finance.totals(txs);
    const income = tot.income;
    const expense = tot.expense;
    const result = tot.result;
    const missing = tot.missing;
    const foreign = txs.filter((t) => CRM.finance.txCurrency(t) !== 'UAH').length;

    const tile = (label, value, icon, cls, sign) => h('div', { class: 'stat' },
      h('div', { class: 'stat-label' }, h('span', { class: 'stat-ico ' + cls }, CRM.icon(icon, { size: 'sm' })), label),
      h('div', { class: 'stat-value num' }, fmt.money(value, 'UAH', { sign })));

    let note = null;
    if (missing) note = h('div', { class: 'card-note' }, CRM.icon('alert', { size: 'sm' }), `${missing} ${fmt.plural(missing, ['операцію', 'операції', 'операцій'])} у валюті не враховано — немає курсу НБУ.`);
    else if (foreign) note = h('div', { class: 'card-note' }, CRM.icon('info', { size: 'sm' }), CRM.rates.describe());

    return h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', null, 'Гроші сьогодні'),
        h('a', { href: '#/budget', class: 'btn btn-ghost btn-sm' }, 'Бюджет', CRM.icon('chevronRight', { size: 'sm' }))),
      h('div', { class: 'card-body' },
        h('div', { class: 'stats' },
          tile('Доходи', income, 'trendUp', 'up', true),
          tile('Витрати', -expense, 'trendDown', 'down'),
          tile('Результат', result, 'scale', 'neutral', true)),
        !txs.length ? h('div', { class: 'card-note' }, 'Сьогодні ще не було операцій.') : note));
  }

  // ---------- Розклад на сьогодні ----------
  function scheduleItems() {
    const T = D.today();
    const items = [];
    // Задачі, заплановані на сьогодні, показує «Календар» (зі своїм рядком) — тут без дубля
    CRM.tasks.activeTasks().filter((t) => t.deadline === T && !(CRM.calendar && t.planDate === T)).forEach((t) => {
      items.push({
        time: t.deadlineTime || null, kind: 'task', icon: 'tasks', cls: 'ico-task',
        title: t.title,
        sub: 'Дедлайн задачі · ' + CRM.dict.label('priorities', t.priority).toLowerCase() + ' пріоритет',
        onClick: () => CRM.tasks.openTask(t.id)
      });
    });
    CRM.store.list('recurring').forEach((r) => {
      if (!CRM.schedule.occurrences(r, T, T).length) return;
      const paid = CRM.schedule.isPaid(r, T);
      const income = r.kind === 'income';
      items.push({
        time: null, kind: 'payment', icon: 'repeat', cls: income ? 'ico-goal' : 'ico-payment',
        title: r.name,
        sub: `${income ? 'Надходження' : 'Платіж'} · ${income ? fmt.money(r.amount, r.currency, { sign: true }) : fmt.money(-r.amount, r.currency)}`,
        badge: paid ? { text: income ? 'Отримано' : 'Сплачено', cls: 'badge-success' } : { text: income ? 'Очікується' : 'До сплати', cls: 'badge-warning' },
        onClick: () => CRM.entities.open('recurring', r.id)
      });
    });
    scheduleSources.forEach((fn) => {
      try { (fn(T) || []).forEach((it) => items.push(it)); } catch (e) { console.error(e); }
    });
    // Спершу «протягом дня» (задачі з «Плану дня» — першими, у своєму порядку), потім — за часом
    const ord = (x) => (x.order == null ? 1 : 0);
    return items.sort((a, b) => {
      if (!a.time && b.time) return -1;
      if (a.time && !b.time) return 1;
      if (!a.time && (ord(a) - ord(b) || (a.order || 0) - (b.order || 0))) return ord(a) - ord(b) || (a.order || 0) - (b.order || 0);
      return (a.time || '').localeCompare(b.time || '') || a.title.localeCompare(b.title, 'uk');
    });
  }

  function scheduleRow(it) {
    return h('button', { type: 'button', class: 'sched-row' + (it.done ? ' done' : ''), onClick: it.onClick },
      h('span', { class: 'sched-time num' + (it.time ? '' : ' allday') }, it.time || 'день'),
      h('span', { class: 'list-row-icon ' + it.cls }, CRM.icon(it.icon, { size: 'sm' })),
      h('span', { class: 'sched-main' },
        h('span', { class: 'sched-title' }, it.title),
        h('span', { class: 'sched-sub' }, it.sub)),
      it.badge ? h('span', { class: 'badge ' + it.badge.cls }, it.badge.text) : null);
  }

  function scheduleCard() {
    const items = scheduleItems();
    const allDay = items.filter((i) => !i.time);
    const timed = items.filter((i) => i.time);
    const now = D.nowTime();
    let body;
    if (!items.length) {
      body = ui.empty({ icon: 'calendar', small: true, title: 'На сьогодні нічого не заплановано', text: 'Тут зʼявляться задачі на сьогодні (з дедлайном або в плані дня), регулярні платежі й події календаря.',
        action: CRM.calendar ? { label: 'Додати подію', icon: 'plus', onClick: () => CRM.calendar.openNew() } : null });
    } else {
      body = h('div', { class: 'sched' },
        allDay.length ? h('div', { class: 'sched-group' }, 'Протягом дня') : null,
        allDay.map(scheduleRow),
        timed.length ? h('div', { class: 'sched-group' }, 'За часом') : null,
        timed.map((it) => {
          const row = scheduleRow(it);
          if (it.time < now) row.classList.add('past');
          return row;
        }));
    }
    const calNote = CRM.gcal ? CRM.gcal.statusNote() : null;
    return h('section', { class: 'card' },
      h('div', { class: 'card-head' },
        h('h2', null, 'Розклад на сьогодні'),
        CRM.calendar
          ? h('a', { href: CRM.router.href('calendar', { view: 'day', date: D.today() }), class: 'btn btn-ghost btn-sm', title: fmt.date(D.today()) }, 'Відкрити календар', CRM.icon('chevronRight', { size: 'sm' }))
          : h('span', { class: 'subtle' }, fmt.dateShort(D.today()))),
      body,
      calNote ? h('div', { class: 'card-foot' }, CRM.icon('calendar', { size: 'sm' }), calNote) : null);
  }

  // ---------- Блоки й «Налаштувати Головну» ----------
  const BLOCKS = {
    today: { name: 'Цифри дня', sub: 'задачі, що далі, витрати, звички й тиждень' },
    quote: { name: 'Цитата дня', sub: 'поруч із привітанням' },
    tasks: { name: 'Активні задачі', sub: 'найближчі за дедлайном', render: () => tasksCard() },
    people: { name: 'Люди', sub: 'дні народження й «час написати»', has: () => !!CRM.people, render: () => CRM.people.homeCard() },
    food: { name: 'Харчування сьогодні', sub: 'калорії й БЖВ', has: () => !!CRM.nutrition, render: () => CRM.nutrition.homeCard() },
    money: { name: 'Гроші сьогодні', sub: 'доходи, витрати, результат', render: () => moneyCard() },
    habits: { name: 'Звички', sub: 'відмітки на сьогодні', has: () => !!CRM.habits, render: () => CRM.habits.homeCard() },
    books: { name: 'Читаю зараз', sub: 'книги й прогрес у сторінках', has: () => !!CRM.books, render: () => CRM.books.homeCard() },
    training: { name: 'Сьогоднішнє тренування', sub: 'коли за програмою є тренування', has: () => !!CRM.programs, render: () => CRM.programs.homeCard() },
    schedule: { name: 'Розклад на сьогодні', sub: 'події, план дня, платежі', render: () => scheduleCard() }
  };
  const TOP = { pc: ['today', 'quote'], phone: ['quote'] };
  const DEFAULTS = {
    pc: { left: ['tasks', 'people', 'food', 'books'], right: ['money', 'habits', 'training', 'schedule'], off: [], folded: [] },
    phone: { list: ['today', 'tasks', 'schedule', 'habits', 'books', 'money', 'people', 'food', 'training'], off: [], folded: [] }
  };
  const has = (id) => !!BLOCKS[id] && (!BLOCKS[id].has || BLOCKS[id].has());
  const narrowMq = window.matchMedia ? window.matchMedia('(max-width: 860px)') : null;
  /** Яке налаштування діє: «телефон» — вузький екран (до 860 px), інакше «компʼютер». */
  function deviceKind() { return narrowMq && narrowMq.matches ? 'phone' : 'pc'; }

  /** Налаштування Головної для pc | phone: зайве відкидається, нові блоки додаються на своє місце. */
  function layoutOf(kind) {
    const raw = (CRM.store.getSetting('homeLayout', null) || {})[kind] || {};
    const def = DEFAULTS[kind];
    const arr = (v) => (Array.isArray(v) ? v.filter((id) => typeof id === 'string' && BLOCKS[id]) : []);
    const out = { off: [...new Set(arr(raw.off))], folded: [...new Set(arr(raw.folded))] };
    const seen = new Set(TOP[kind]);
    const lists = kind === 'pc' ? ['left', 'right'] : ['list'];
    lists.forEach((k) => { out[k] = arr(raw[k]).filter((id) => !seen.has(id) && (seen.add(id), true)); });
    lists.forEach((k) => {
      def[k].forEach((id, i) => {
        if (seen.has(id)) return;
        seen.add(id);
        // Новий блок (ще не був у налаштуванні) — після свого сусіда з типового порядку
        const prev = def[k].slice(0, i).reverse().find((x) => out[k].includes(x));
        const at = prev ? out[k].indexOf(prev) + 1 : 0;
        out[k].splice(at, 0, id);
      });
    });
    return out;
  }
  async function saveLayout(kind, L) {
    const all = Object.assign({}, CRM.store.getSetting('homeLayout', null) || {});
    all[kind] = L;
    await CRM.store.setSetting('homeLayout', all);
  }
  const isOn = (L, id) => has(id) && !L.off.includes(id);

  /** Блок-картка з кнопкою «Згорнути» в шапці. */
  function blockEl(kind, L, id) {
    if (id === 'today') return todayBlock();
    let el = null;
    try { el = BLOCKS[id].render(); } catch (e) { console.error(e); }
    if (!el) return null;
    el.dataset.block = id;
    const head = el.querySelector(':scope > .card-head');
    if (head) {
      const folded = L.folded.includes(id);
      el.classList.toggle('is-folded', folded);
      const btn = h('button', {
        type: 'button', class: 'btn btn-ghost btn-icon btn-sm home-fold', 'aria-expanded': folded ? 'false' : 'true',
        title: folded ? 'Розгорнути' : 'Згорнути', 'aria-label': (folded ? 'Розгорнути: ' : 'Згорнути: ') + BLOCKS[id].name,
        onClick: (e) => { e.preventDefault(); e.stopPropagation(); toggleFold(kind, id); }
      }, CRM.icon('chevronDown', { size: 'sm' }));
      let row = head.querySelector(':scope > .btn-row');
      if (!row) {
        // Шапка без групи кнопок: усе праворуч від назви — в одну групу разом зі стрілкою
        row = h('div', { class: 'btn-row' });
        Array.from(head.children).slice(1).forEach((x) => row.appendChild(x));
        head.appendChild(row);
      }
      row.appendChild(btn);
    }
    return el;
  }
  async function toggleFold(kind, id) {
    const L = layoutOf(kind);
    L.folded = L.folded.includes(id) ? L.folded.filter((x) => x !== id) : L.folded.concat(id);
    await saveLayout(kind, L);
  }

  /** Вікно «Налаштувати Головну». */
  function openSettings() {
    let kind = deviceKind();
    const body = h('div', { class: 'hs' });
    const tabs = h('div', { class: 'segmented hs-tabs', role: 'radiogroup', 'aria-label': 'Для якого пристрою' });
    function sw(id, L) {
      const on = !L.off.includes(id);
      return h('button', {
        type: 'button', class: 'hs-switch', role: 'switch', 'aria-checked': on ? 'true' : 'false', 'aria-label': (on ? 'Вимкнути: ' : 'Увімкнути: ') + BLOCKS[id].name,
        onClick: async () => {
          const cur = layoutOf(kind);
          cur.off = cur.off.includes(id) ? cur.off.filter((x) => x !== id) : cur.off.concat(id);
          await saveLayout(kind, cur);
          draw();
        }
      });
    }
    function row(id, L, movable) {
      const off = L.off.includes(id);
      return h('div', { class: 'hs-row' + (off ? ' off' : ''), dataset: { id } },
        movable ? h('button', { type: 'button', class: 'hs-grip', 'aria-label': `Перемістити «${BLOCKS[id].name}» (стрілки)`, title: 'Перетягни, щоб змінити порядок' }, CRM.icon('grip', { size: 'sm' })) : h('span', { class: 'hs-grip-space' }),
        h('div', { class: 'hs-text' }, h('div', { class: 'hs-name' }, BLOCKS[id].name), h('div', { class: 'hs-sub' }, BLOCKS[id].sub)),
        sw(id, L));
    }
    function list(key, ids, L, title) {
      return h('div', { class: 'hs-col' }, title ? h('div', { class: 'hs-title' }, title) : null,
        h('div', { class: 'hs-list', dataset: { list: key } }, ids.filter(has).map((id) => row(id, L, true))));
    }
    function draw() {
      const L = layoutOf(kind);
      ui.mount(tabs, [['pc', 'Компʼютер'], ['phone', 'Телефон']].map(([k, label]) => h('button', {
        type: 'button', role: 'radio', class: k === kind ? 'active' : '', 'aria-checked': k === kind ? 'true' : 'false', dataset: { kind: k },
        onClick: () => { kind = k; draw(); }
      }, label + (k === deviceKind() ? ' · цей' : ''))));
      const top = TOP[kind].filter(has);
      ui.mount(body,
        h('div', { class: 'hs-title' }, kind === 'pc' ? 'Угорі, на всю ширину' : 'Угорі'),
        h('div', { class: 'hs-list hs-top' }, top.map((id) => row(id, L, false))),
        kind === 'pc'
          ? h('div', { class: 'hs-cols' }, list('left', L.left, L, 'Ліва колонка'), list('right', L.right, L, 'Права колонка'))
          : list('list', L.list, L, 'Блоки по порядку'));
      body.querySelectorAll('.hs-grip').forEach(attachDrag);
    }
    /** Порядок зі списків у вікні → налаштування. */
    async function commitOrder() {
      const L = layoutOf(kind);
      body.querySelectorAll('.hs-list[data-list]').forEach((ul) => { L[ul.dataset.list] = Array.from(ul.querySelectorAll('.hs-row')).map((r) => r.dataset.id); });
      // Недоступні зараз блоки (модуль не завантажився) лишаються в кінці свого списку
      const lists = kind === 'pc' ? ['left', 'right'] : ['list'];
      const old = layoutOf(kind);
      lists.forEach((k) => old[k].filter((id) => !has(id)).forEach((id) => L[k].push(id)));
      await saveLayout(kind, L);
    }
    function attachDrag(grip) {
      const rowEl = grip.closest('.hs-row');
      grip.addEventListener('keydown', async (e) => {
        const ul = rowEl.parentElement;
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          e.preventDefault();
          const sib = e.key === 'ArrowUp' ? rowEl.previousElementSibling : rowEl.nextElementSibling;
          if (!sib) return;
          if (e.key === 'ArrowUp') ul.insertBefore(rowEl, sib); else ul.insertBefore(sib, rowEl);
        } else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && kind === 'pc') {
          e.preventDefault();
          const to = body.querySelector(`.hs-list[data-list="${e.key === 'ArrowLeft' ? 'left' : 'right'}"]`);
          if (!to || to === ul) return;
          to.appendChild(rowEl);
        } else return;
        const id = rowEl.dataset.id;
        await commitOrder();
        draw();
        const g = body.querySelector(`.hs-row[data-id="${id}"] .hs-grip`);
        if (g) g.focus();
      });
      grip.addEventListener('pointerdown', (e) => {
        if (e.button !== 0) return;
        e.preventDefault();
        rowEl.classList.add('dragging');
        let moved = false;
        // Слухаємо весь документ: рядок переставляється в DOM, і «захоплення» вказівника на ⋮⋮ при цьому губиться
        const onMove = (ev) => {
          if (ev.pointerId !== e.pointerId) return;
          ev.preventDefault();
          moved = true;
          const lists = Array.from(body.querySelectorAll('.hs-list[data-list]'));
          // Список під пальцем / мишкою (за горизонталлю — для двох колонок)
          const target = lists.find((ul) => { const r = ul.getBoundingClientRect(); return ev.clientX >= r.left && ev.clientX <= r.right; }) || rowEl.parentElement;
          const rows = Array.from(target.querySelectorAll('.hs-row')).filter((r) => r !== rowEl);
          const before = rows.find((r) => { const b = r.getBoundingClientRect(); return ev.clientY < b.top + b.height / 2; });
          if (before) { if (rowEl.nextElementSibling !== before || rowEl.parentElement !== target) target.insertBefore(rowEl, before); } else if (target.lastElementChild !== rowEl) target.appendChild(rowEl);
        };
        const onUp = async (ev) => {
          if (ev.pointerId !== e.pointerId) return;
          document.removeEventListener('pointermove', onMove);
          document.removeEventListener('pointerup', onUp);
          document.removeEventListener('pointercancel', onUp);
          rowEl.classList.remove('dragging');
          if (moved && body.isConnected) { await commitOrder(); draw(); }
        };
        document.addEventListener('pointermove', onMove, { passive: false });
        document.addEventListener('pointerup', onUp);
        document.addEventListener('pointercancel', onUp);
      });
    }
    draw();
    const dlg = ui.modal({
      title: 'Налаштувати Головну',
      size: 'lg',
      className: 'hs-modal',
      body: [
        h('p', { class: 'modal-text hs-lead' }, 'Увімкни потрібні блоки й перетягни їх у зручному порядку. Для компʼютера й телефона — окремо, обидва зберігаються в синхронізації.'),
        tabs, body,
        h('p', { class: 'hs-note' }, 'Привітання завжди вгорі. Порядок можна змінити й з клавіатури: Tab до ⋮⋮, потім стрілки (на компʼютері ← → — між колонками). Кожен блок на Головній ще й згортається стрілкою біля назви.')
      ],
      footer: [
        ui.button({
          label: 'Як було спочатку', className: 'hs-reset', onClick: async () => {
            const before = CRM.store.getSetting('homeLayout', null);
            await saveLayout(kind, JSON.parse(JSON.stringify(DEFAULTS[kind])));
            draw();
            ui.toast(`Головна (${kind === 'pc' ? 'компʼютер' : 'телефон'}) — як було спочатку`, {
              action: { label: 'Скасувати', onClick: async () => { await CRM.store.setSetting('homeLayout', before); draw(); } }
            });
          }
        }),
        ui.button({ label: 'Готово', variant: 'primary', className: 'hs-done', onClick: () => dlg.close('button') })
      ]
    });
    return dlg;
  }

  // ---------- Сторінка ----------
  function render(container) {
    const kind = deviceKind();
    const L = layoutOf(kind);
    const config = h('button', { type: 'button', class: 'home-config', onClick: () => openSettings() }, CRM.icon('sort', { size: 'sm' }), 'Налаштувати Головну');
    const hero = h('div', { class: 'home-hero' + (isOn(L, 'quote') ? '' : ' no-quote') },
      h('div', { class: 'home-hero-main' }, ui.pageHead({ title: greeting(), sub: capitalize(fmt.dateLong(D.today())) }), config),
      isOn(L, 'quote') ? quoteFigure() : null);
    let main;
    if (kind === 'pc') {
      const left = L.left.filter((id) => isOn(L, id)).map((id) => blockEl(kind, L, id)).filter(Boolean);
      const right = L.right.filter((id) => isOn(L, id)).map((id) => blockEl(kind, L, id)).filter(Boolean);
      const cols = [left, right].filter((c) => c.length);
      main = [isOn(L, 'today') ? todayBlock() : null,
        cols.length ? h('div', { class: 'home-grid' + (cols.length === 1 ? ' home-grid-one' : '') }, cols.map((c) => h('div', { class: 'home-col' }, c))) : null];
    } else {
      main = h('div', { class: 'home-col home-list' }, L.list.filter((id) => isOn(L, id)).map((id) => blockEl(kind, L, id)).filter(Boolean));
    }
    const anyBlock = (Array.isArray(main) ? main : [main]).some((x) => x && (x.childElementCount === undefined || x.childElementCount > 0 || x.classList.contains('home-today')));
    ui.mount(container,
      h('div', { class: 'home' }, hero, main,
        anyBlock ? null : h('section', { class: 'card' }, ui.empty({
          icon: 'sort', small: true, title: 'Усі блоки Головної вимкнено',
          action: { label: 'Налаштувати Головну', onClick: () => openSettings() }
        }))));

    // Події календаря не зберігаються в розділах даних — слухаємо окрему подію
    const onGcal = (e) => { if (!(e.detail && e.detail.busy)) CRM.router.rerender(); };
    // «Далі» минуло — оновити цифри дня
    const onMinute = () => { if (nextAt && D.nowTime() > nextAt) CRM.router.rerender(); };
    // Налаштування Головної змінилося (вікно, згортання, інший пристрій) — перемалювати
    let raw = CRM.store.getSetting('homeLayout', null);
    const offSet = CRM.store.on(['settings'], () => {
      const now = CRM.store.getSetting('homeLayout', null);
      if (now === raw) return;
      raw = now;
      CRM.router.rerender();
    });
    // ПК ↔ телефон (вузьке вікно) — інше налаштування
    const onMq = () => CRM.router.rerender();
    if (narrowMq && narrowMq.addEventListener) narrowMq.addEventListener('change', onMq);
    document.addEventListener('crm:gcalchange', onGcal);
    document.addEventListener('crm:minute', onMinute);
    return () => {
      document.removeEventListener('crm:gcalchange', onGcal);
      document.removeEventListener('crm:minute', onMinute);
      if (narrowMq && narrowMq.removeEventListener) narrowMq.removeEventListener('change', onMq);
      offSet();
    };
  }

  function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  CRM.router.register('home', {
    title: 'Головна',
    stores: ['tasks', 'events', 'people', 'habits', 'books', 'attachments', 'transactions', 'accounts', 'recurring', 'rates', 'courses', 'workouts', 'programs', 'meals', 'foods'],
    render
  });

  CRM.home = { addScheduleSource, scheduleItems, openSettings, layoutOf, deviceKind, BLOCKS, DEFAULTS };
})(window.CRM);
