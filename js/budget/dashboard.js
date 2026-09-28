/* ==========================================================================
   dashboard.js — вкладка «Дашборд»: доходи й витрати за поточний місяць,
   фінансовий результат, відкладені кошти, загальний капітал, кругова
   діаграма витрат за категоріями (з легендою: назва, сума, %),
   найближчі платежі на 14 днів і останні операції.
   ========================================================================== */
window.CRM = window.CRM || {};

(function (CRM) {
  'use strict';

  const { h, ui } = { h: CRM.ui.h, ui: CRM.ui };
  const D = CRM.date;
  const fmt = CRM.fmt;
  const F = () => CRM.finance;
  const MAX_SLICES = 6; // більше сегментів кругова діаграма не читається — решта йде в «Інші»

  function kpi(label, value, opts) {
    const o = opts || {};
    return h('div', { class: 'kpi' },
      h('div', { class: 'kpi-label' }, o.icon ? h('span', { class: 'stat-ico ' + (o.tone || 'neutral') }, CRM.icon(o.icon, { size: 'sm' })) : null, label),
      h('div', { class: 'kpi-value num' }, value),
      o.note ? h('div', { class: 'kpi-note' }, o.note) : null);
  }

  // ---------- Кругова діаграма витрат ----------
  function expensePie(list, monthName) {
    const cats = F().byCategory(list, 'expense');
    const total = cats.reduce((s, c) => s + c.amount, 0);
    const head = h('div', { class: 'card-head' },
      h('h2', null, `Витрати за ${monthName} за категоріями`),
      h('a', { class: 'btn btn-ghost btn-sm', href: '#/budget/analytics' }, 'Аналітика', CRM.icon('chevronRight', { size: 'sm' })));
    if (!cats.length) {
      return h('section', { class: 'card' }, head, ui.empty({
        icon: 'receipt', small: true, title: 'Цього місяця ще немає витрат',
        action: { label: 'Додати витрату', icon: 'plus', onClick: () => CRM.budget.openTxForm({ type: 'expense' }) }
      }));
    }
    const top = cats.slice(0, MAX_SLICES);
    const rest = cats.slice(MAX_SLICES);
    const restSum = rest.reduce((s, c) => s + c.amount, 0);
    const otherColor = CRM.dict.categoryColor('slate');
    const slices = top.map((c) => ({ label: c.category ? c.category.name : 'Без категорії', value: c.amount, color: F().categoryColor(c.categoryId), id: c.categoryId }));
    if (rest.length) slices.push({ label: `Інші (${rest.length})`, value: CRM.utils.round2(restSum), color: otherColor, other: true });

    const chart = CRM.charts.pie({
      labels: slices.map((s) => s.label), values: slices.map((s) => s.value), colors: slices.map((s) => s.color),
      format: (v) => fmt.money(v, 'UAH'), size: 220, ariaLabel: `Кругова діаграма витрат за ${monthName}`
    });

    const pct = (v) => fmt.percent(total ? v / total * 100 : 0);
    const legendRow = (s, cls) => h('tr', { class: cls || '' },
      h('td', null, h('span', { class: 'legend-key', style: { background: s.color } }), h('span', { class: 'legend-name' }, s.label)),
      h('td', { class: 'num' }, fmt.money(s.value, 'UAH')),
      h('td', { class: 'num subtle' }, pct(s.value)));
    const rows = slices.filter((s) => !s.other).map((s) => {
      const tr = legendRow(s);
      if (s.id) { tr.classList.add('clickable'); tr.addEventListener('click', () => CRM.router.go('budget/transactions', { category: s.id })); tr.title = 'Показати операції категорії'; }
      return tr;
    });
    if (rest.length) {
      rows.push(legendRow(slices[slices.length - 1], 'legend-other'));
      rest.forEach((c) => rows.push(h('tr', { class: 'legend-sub' },
        h('td', null, h('span', { class: 'legend-name' }, c.category ? c.category.name : 'Без категорії')),
        h('td', { class: 'num' }, fmt.money(c.amount, 'UAH')),
        h('td', { class: 'num subtle' }, pct(c.amount)))));
    }
    const legend = h('table', { class: 'legend-table' },
      h('thead', null, h('tr', null, h('th', null, 'Категорія'), h('th', { class: 'num' }, 'Сума'), h('th', { class: 'num' }, '%'))),
      h('tbody', null, rows),
      h('tfoot', null, h('tr', null, h('td', null, 'Разом'), h('td', { class: 'num' }, fmt.money(total, 'UAH')), h('td', { class: 'num subtle' }, '100 %'))));

    return h('section', { class: 'card' }, head, h('div', { class: 'pie-layout' }, chart, legend));
  }

  // ---------- Найближчі платежі ----------
  function upcomingItems(days) {
    const T = D.today();
    const until = D.addDays(T, days);
    const items = [];
    CRM.store.list('recurring').forEach((r) => {
      // Прострочені (за останні 30 днів, не сплачені) + наступні 14 днів
      CRM.schedule.occurrences(r, D.addDays(T, -30), until).forEach((date) => {
        if (CRM.schedule.isPaid(r, date)) return;
        if (date < T && date < (r.createdAt ? D.toKyivDate(r.createdAt) : r.startDate)) return;
        items.push({ r, date, overdue: date < T });
      });
    });
    return items.sort((a, b) => a.date.localeCompare(b.date) || a.r.name.localeCompare(b.r.name, 'uk'));
  }

  function upcomingCard() {
    const items = upcomingItems(14);
    const head = [h('div', { class: 'card-head' },
      h('h2', null, 'Найближчі платежі'),
      h('a', { class: 'btn btn-ghost btn-sm', href: '#/budget/recurring' }, 'Календар', CRM.icon('chevronRight', { size: 'sm' }))),
    h('div', { class: 'card-caption' }, `На 14 днів, до ${fmt.dateShort(D.addDays(D.today(), 14))}, і прострочені`)];
    if (!items.length) {
      return h('section', { class: 'card' }, head, ui.empty({ icon: 'repeat', small: true, title: 'Найближчим часом платежів немає', text: 'Регулярні платежі (оренда, підписки, зарплата) додаються на вкладці «Регулярні платежі».' }));
    }
    return h('section', { class: 'card' }, head, h('div', { class: 'upc-list' }, items.slice(0, 10).map((it) => {
      const income = it.r.kind === 'income';
      return h('button', { type: 'button', class: 'upc-row', onClick: () => CRM.router.go('budget/recurring', { open: it.r.id }) },
        h('span', { class: 'upc-date' + (it.overdue ? ' overdue' : '') }, it.overdue ? 'Прострочено' : fmt.relDay(it.date), it.overdue ? h('span', { class: 'subtle' }, fmt.dateShort(it.date)) : null),
        h('span', { class: 'upc-name' }, it.r.name),
        h('span', { class: 'upc-amount num' + (income ? ' tx-income' : '') }, income ? fmt.money(it.r.amount, it.r.currency, { sign: true }) : fmt.money(-it.r.amount, it.r.currency)));
    }), items.length > 10 ? h('a', { class: 'more-link', href: '#/budget/recurring' }, `Ще ${items.length - 10}`) : null));
  }

  // ---------- Останні операції ----------
  function recentCard() {
    const list = CRM.store.list('transactions').sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || '').localeCompare(a.createdAt || '')).slice(0, 6);
    const head = h('div', { class: 'card-head' },
      h('h2', null, 'Останні операції'),
      h('a', { class: 'btn btn-ghost btn-sm', href: '#/budget/transactions' }, 'Усі', CRM.icon('chevronRight', { size: 'sm' })));
    if (!list.length) return h('section', { class: 'card' }, head, ui.empty({ icon: 'receipt', small: true, title: 'Операцій ще немає' }));
    return h('section', { class: 'card' }, head, h('div', { class: 'recent-list' }, list.map((t) => h('button', {
      type: 'button', class: 'recent-row', onClick: () => CRM.budget.openTxForm({ id: t.id })
    },
    t.type === 'transfer'
      ? h('span', { class: 'cat-dot', style: { background: 'var(--text-3)' } })
      : h('span', { class: 'cat-dot', style: { background: F().categoryColor(t.categoryId) } }),
    h('span', { class: 'recent-main' },
      h('span', { class: 'recent-title' }, t.type === 'transfer' ? 'Переказ' : F().categoryName(t.categoryId)),
      h('span', { class: 'recent-sub' }, [fmt.relDay(t.date), t.comment].filter(Boolean).join(' · '))),
    h('span', { class: 'num tx-amount tx-' + t.type }, F().txAmountLabel(t))))));
  }

  // ---------- Вкладка ----------
  function render(container) {
    if (!F().accounts().length) {
      ui.mount(container, h('div', { class: 'card' }, ui.empty({
        icon: 'wallet', title: 'Почнімо з рахунків',
        text: 'Додай картку, готівку чи ощадний рахунок — і дашборд покаже доходи, витрати й капітал. Або заповни застосунок демо-даними в «Моєму кабінеті».',
        action: { label: 'Додати рахунок', icon: 'plus', onClick: () => { CRM.router.go('budget/accounts'); setTimeout(() => CRM.budget.openAccountForm(), 50); } }
      })));
      return;
    }
    const T = D.today();
    const [from, to] = F().monthRange(T);
    const monthIdx = D.parse(T).m - 1;
    const monthName = CRM.MONTHS_NOM[monthIdx].toLowerCase();
    const list = F().txInRange(from, to);
    F().ensureRatesFor(list);
    const tot = F().totals(list);
    const sav = F().savings();
    const cap = F().capital();

    const kpis = h('div', { class: 'kpi-row' },
      kpi(`Доходи · ${monthName}`, fmt.money(tot.income, 'UAH', { sign: true }), { icon: 'trendUp', tone: 'up' }),
      kpi(`Витрати · ${monthName}`, fmt.money(-tot.expense, 'UAH'), { icon: 'trendDown', tone: 'down' }),
      kpi('Фінансовий результат', fmt.money(tot.result, 'UAH', { sign: true }), { icon: 'scale', note: 'доходи − витрати' }),
      kpi('Відкладено', fmt.money(sav.total, 'UAH'), { icon: 'piggy', note: sav.count ? fmt.count(sav.count, ['ощадний рахунок', 'ощадні рахунки', 'ощадних рахунків']) : 'немає ощадних рахунків' }),
      kpi('Загальний капітал', fmt.money(cap.total, 'UAH'), { icon: 'coins', note: 'усі рахунки в гривнях' }));

    const warn = tot.missing || cap.missing
      ? h('div', { class: 'callout callout-warning' }, CRM.icon('alert'), h('span', null, 'Для частини сум у валюті немає курсу НБУ — вони поки не враховані. Натисни «Оновити» біля курсу вгорі.'))
      : null;

    ui.mount(container,
      h('div', { class: 'stack' },
        warn,
        kpis,
        h('div', { class: 'dash-grid' },
          expensePie(list, monthName),
          h('div', { class: 'stack' }, upcomingCard(), recentCard()))));
  }

  CRM.budget.registerTab('dashboard', { render });
  CRM.budget.upcomingItems = upcomingItems;
})(window.CRM);
