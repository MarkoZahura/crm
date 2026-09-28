/* ==========================================================================
   home.js — Головна: цитата дня, активні задачі, розклад на сьогодні
   (задачі з дедлайном сьогодні, регулярні платежі, дедлайни навчання,
   події Google Календаря), доходи й витрати за сьогодні в гривнях.
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

  // ---------- Цитата дня ----------
  function quoteCard() {
    const q = CRM.quotes.forDate(D.today());
    return h('section', { class: 'card quote-card' },
      h('div', { class: 'quote-mark', 'aria-hidden': 'true' }, CRM.icon('quote')),
      h('figure', { class: 'quote-body' },
        h('blockquote', { class: 'quote-text' }, `«${q.text}»`),
        h('figcaption', { class: 'quote-meta' },
          h('span', { class: 'quote-author' }, '— ' + q.author),
          h('span', { class: 'quote-date' }, 'Цитата дня · ' + fmt.date(D.today())))));
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
    CRM.tasks.activeTasks().filter((t) => t.deadline === T).forEach((t) => {
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
    // Спершу «протягом дня», потім — за часом
    return items.sort((a, b) => {
      if (!a.time && b.time) return -1;
      if (a.time && !b.time) return 1;
      return (a.time || '').localeCompare(b.time || '') || a.title.localeCompare(b.title, 'uk');
    });
  }

  function scheduleRow(it) {
    return h('button', { type: 'button', class: 'sched-row', onClick: it.onClick },
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
      body = ui.empty({ icon: 'calendar', small: true, title: 'На сьогодні нічого не заплановано', text: 'Тут зʼявляться задачі з дедлайном сьогодні, регулярні платежі й події календаря.' });
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
        h('span', { class: 'subtle' }, fmt.dateShort(D.today()))),
      body,
      calNote ? h('div', { class: 'card-foot' }, CRM.icon('calendar', { size: 'sm' }), calNote) : null);
  }

  // ---------- Сторінка ----------
  function render(container) {
    // Події календаря не зберігаються в розділах даних — слухаємо окрему подію
    const onGcal = (e) => { if (!(e.detail && e.detail.busy)) CRM.router.rerender(); };
    document.addEventListener('crm:gcalchange', onGcal);
    ui.mount(container,
      ui.pageHead({ title: greeting(), sub: capitalize(fmt.dateLong(D.today())) }),
      h('div', { class: 'home' },
        quoteCard(),
        h('div', { class: 'home-grid' },
          h('div', { class: 'home-col' }, tasksCard()),
          h('div', { class: 'home-col' }, moneyCard(), scheduleCard()))));
    return () => document.removeEventListener('crm:gcalchange', onGcal);
  }

  function capitalize(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

  CRM.router.register('home', {
    title: 'Головна',
    stores: ['tasks', 'attachments', 'transactions', 'accounts', 'recurring', 'rates', 'courses', 'workouts'],
    render
  });

  CRM.home = { addScheduleSource, scheduleItems };
})(window.CRM);
