/* ==========================================================================
   analytics.js — вкладка «Аналітика».
   Перемикач «Витрати / Доходи», вибір місяця й валюти відображення.
   • 4 картки (сума й різниця з минулим місяцем; найбільша категорія /
     джерело; середні витрати на день / баланс періоду; прогноз витрат /
     витрачено від доходів).
   • Статистика категорій і кільцева діаграма із сумою в центрі.
   • Стовпчики за останні 12 місяців.
   Суми в іншій валюті перераховуються за курсом НБУ на дату операції.
   ========================================================================== */
window.CRM = window.CRM || {};

(function (CRM) {
  'use strict';

  const { h, ui } = { h: CRM.ui.h, ui: CRM.ui };
  const D = CRM.date;
  const fmt = CRM.fmt;
  const F = () => CRM.finance;
  const MAX_SLICES = 6;

  let mode = 'expense';
  let month = null;
  let cur = 'UAH';

  const monthName = (m) => CRM.MONTHS_NOM[D.parse(m).m - 1].toLowerCase();
  const inRange = (m) => F().txInRange(m, D.endOfMonth(m));

  function diffNote(now, prev, prevMonth) {
    if (!prev) return h('span', { class: 'kpi-note' }, `У ${monthLoc(prevMonth)} даних немає`);
    const diff = now - prev;
    const p = diff / prev * 100;
    const up = diff > 0;
    // Для витрат зростання — погано, для доходів — добре
    const good = mode === 'expense' ? !up : up;
    return h('span', { class: 'kpi-note delta ' + (Math.abs(diff) < 0.005 ? '' : good ? 'up' : 'down') },
      Math.abs(diff) < 0.005 ? null : CRM.icon(up ? 'trendUp' : 'trendDown', { size: 'sm' }),
      `${fmt.money(diff, cur, { sign: true })} · ${p > 0 ? '+' : ''}${fmt.percent(p)} до ${monthLoc(prevMonth)}`);
  }

  // «у вересні» → для порівняння коротко: «серпня»
  function monthLoc(m) { return CRM.MONTHS_GEN[D.parse(m).m - 1]; }

  /** Прогноз витрат до кінця поточного місяця (у валюті відображення). */
  function forecast(list) {
    const T = D.today();
    const end = D.endOfMonth(T);
    const day = D.parse(T).d;
    const dim = D.daysInMonth(D.parse(T).y, D.parse(T).m);
    let spent = 0;
    let base = 0; // без регулярних платежів — для середнього
    list.forEach((t) => {
      if (t.type !== 'expense') return;
      const v = F().txIn(t, cur);
      if (v == null) return;
      spent += v;
      if (!t.recurringId && t.date <= T) base += v;
    });
    let planned = 0;
    CRM.store.list('recurring').forEach((r) => {
      if (r.kind !== 'expense') return;
      CRM.schedule.occurrences(r, T, end).forEach((d) => {
        if (CRM.schedule.isPaid(r, d)) return;
        const v = CRM.rates.convert(r.amount, r.currency, cur);
        if (v != null) planned += v;
      });
    });
    const avg = base / day;
    return { total: spent + avg * (dim - day) + planned, spent, avg, planned, daysLeft: dim - day };
  }

  function kpi(label, value, note) {
    return h('div', { class: 'kpi' }, h('div', { class: 'kpi-label' }, label), h('div', { class: 'kpi-value num' }, value), note);
  }

  function render(container) {
    const T = D.today();
    const thisMonth = D.startOfMonth(T);
    if (!month || month > thisMonth) month = thisMonth;
    const start = F().historyStart();
    const firstMonth = start ? D.startOfMonth(start) : thisMonth;
    if (month < firstMonth) month = firstMonth;

    const prevMonth = D.addMonths(month, -1);
    const list = inRange(month);
    const prevList = inRange(prevMonth);
    // Курси: для гривні — лише на дати валютних операцій; для $/€ — на всі дні місяця
    if (cur === 'UAH') F().ensureRatesFor(list.concat(prevList));
    else {
      const dates = [];
      for (let d = prevMonth; d <= D.endOfMonth(month) && d <= T; d = D.addDays(d, 1)) dates.push(d);
      CRM.rates.ensureDates(dates).catch(() => {});
    }

    const tot = F().totalsIn(list, cur);
    const prevTot = F().totalsIn(prevList, cur);
    const cats = F().byCategoryIn(list, mode, cur);
    const total = mode === 'expense' ? tot.expense : tot.income;
    const prevTotal = mode === 'expense' ? prevTot.expense : prevTot.income;
    const isCurrent = month === thisMonth;
    const mName = monthName(month);

    // --- Панель керування ---
    const modeSeg = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Режим' },
      [['expense', 'Витрати'], ['income', 'Доходи']].map(([id, l]) => h('button', {
        type: 'button', role: 'radio', class: mode === id ? 'active' : '', 'aria-checked': mode === id ? 'true' : 'false',
        onClick: () => { mode = id; CRM.router.rerender(); }
      }, l)));
    const nav = h('div', { class: 'month-nav' },
      h('button', { type: 'button', class: 'btn btn-icon btn-sm', 'aria-label': 'Попередній місяць', disabled: month <= firstMonth, onClick: () => { month = D.addMonths(month, -1); CRM.router.rerender(); } }, CRM.icon('chevronLeft', { size: 'sm' })),
      h('span', { class: 'month-title' }, fmt.month(month)),
      h('button', { type: 'button', class: 'btn btn-icon btn-sm', 'aria-label': 'Наступний місяць', disabled: isCurrent, onClick: () => { month = D.addMonths(month, 1); CRM.router.rerender(); } }, CRM.icon('chevronRight', { size: 'sm' })));
    const curSeg = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Валюта відображення' },
      CRM.dict.currencies.map((c) => h('button', {
        type: 'button', role: 'radio', class: cur === c ? 'active' : '', 'aria-checked': cur === c ? 'true' : 'false',
        onClick: () => { cur = c; CRM.router.rerender(); }
      }, c)));
    const controls = h('div', { class: 'toolbar analytics-controls' }, modeSeg, nav, curSeg);

    // --- 4 картки ---
    const top = cats[0];
    const topName = top ? (top.category ? top.category.name : 'Без категорії') : '—';
    let cards;
    if (mode === 'expense') {
      const days = isCurrent ? D.parse(T).d : D.daysInMonth(D.parse(month).y, D.parse(month).m);
      const fc = isCurrent ? forecast(list) : null;
      cards = [
        kpi(`Витрати за ${mName}`, fmt.money(-tot.expense, cur), diffNote(tot.expense, prevTot.expense, prevMonth)),
        kpi('Найбільша категорія', topName, h('span', { class: 'kpi-note' }, top ? `${fmt.money(top.amount, cur)} · ${fmt.percent(total ? top.amount / total * 100 : 0)} витрат` : 'Витрат немає')),
        kpi('Середні витрати на день', fmt.money(total / days, cur), h('span', { class: 'kpi-note' }, isCurrent ? `за ${fmt.count(days, ['день', 'дні', 'днів'])} місяця` : `за ${fmt.count(days, ['день', 'дні', 'днів'])}`)),
        isCurrent
          ? kpi('Прогноз витрат до кінця місяця', fmt.money(fc.total, cur), h('span', { class: 'kpi-note' }, `≈ ${fmt.money(fc.avg, cur)}/день ще ${fmt.count(fc.daysLeft, ['день', 'дні', 'днів'])}${fc.planned ? ` + регулярні ${fmt.money(fc.planned, cur)}` : ''}`))
          : kpi('Прогноз витрат до кінця місяця', fmt.money(tot.expense, cur), h('span', { class: 'kpi-note' }, 'Місяць завершено — фактична сума'))
      ];
    } else {
      const spentShare = tot.income ? tot.expense / tot.income * 100 : null;
      cards = [
        kpi(`Доходи за ${mName}`, fmt.money(tot.income, cur, { sign: true }), diffNote(tot.income, prevTot.income, prevMonth)),
        kpi('Найбільше джерело', topName, h('span', { class: 'kpi-note' }, top ? `${fmt.money(top.amount, cur)} · ${fmt.percent(total ? top.amount / total * 100 : 0)} доходів` : 'Доходів немає')),
        kpi('Баланс періоду', fmt.money(tot.result, cur, { sign: true }), h('span', { class: 'kpi-note' }, 'доходи − витрати')),
        kpi('Витрачено від доходів', spentShare == null ? '—' : fmt.percent(spentShare), h('span', { class: 'kpi-note' }, spentShare == null ? 'Доходів немає' : `${fmt.money(tot.expense, cur)} з ${fmt.money(tot.income, cur)}`))
      ];
    }

    // --- Категорії + кільцева діаграма ---
    const noun = mode === 'expense' ? 'витрат' : 'доходів';
    let middle;
    if (!cats.length) {
      middle = h('div', { class: 'card' }, ui.empty({ icon: 'receipt', small: true, title: `За ${mName} ${noun} немає`, text: 'Обери інший місяць або додай операції.' }));
    } else {
      const statRows = cats.map((c) => {
        const share = total ? c.amount / total * 100 : 0;
        const color = F().categoryColor(c.categoryId);
        return h('div', { class: 'cstat-row' + (c.categoryId ? ' clickable' : ''), title: c.categoryId ? 'Показати операції' : null,
          onClick: c.categoryId ? () => CRM.router.go('budget/transactions', { category: c.categoryId }) : null },
        h('div', { class: 'cstat-top' },
          h('span', { class: 'cstat-name' }, h('span', { class: 'legend-key', style: { background: color } }), c.category ? c.category.name : 'Без категорії'),
          h('span', { class: 'num cstat-sum' }, fmt.money(c.amount, cur))),
        h('div', { class: 'cstat-bottom' },
          h('div', { class: 'meter' }, h('div', { class: 'meter-fill', style: { width: share + '%', background: color } })),
          h('span', { class: 'num subtle cstat-meta' }, `${fmt.percent(share)} · ${fmt.count(c.count, ['операція', 'операції', 'операцій'])}`)));
      });

      const topC = cats.slice(0, MAX_SLICES);
      const rest = cats.slice(MAX_SLICES);
      const slices = topC.map((c) => ({ label: c.category ? c.category.name : 'Без категорії', value: c.amount, color: F().categoryColor(c.categoryId) }));
      if (rest.length) slices.push({ label: `Інші (${rest.length})`, value: CRM.utils.round2(rest.reduce((s, c) => s + c.amount, 0)), color: CRM.dict.categoryColor('slate') });
      const donut = CRM.charts.pie({
        doughnut: true, size: 230,
        labels: slices.map((s) => s.label), values: slices.map((s) => s.value), colors: slices.map((s) => s.color),
        format: (v) => fmt.money(v, cur), ariaLabel: `Розподіл ${noun} за ${mName}`,
        center: h('div', null, h('div', { class: 'donut-total num' }, fmt.money(total, cur)), h('div', { class: 'donut-cap' }, mode === 'expense' ? 'усього витрат' : 'усього доходів'))
      });
      const legend = h('table', { class: 'legend-table donut-legend' },
        h('tbody', null, slices.map((s) => h('tr', null,
          h('td', null, h('span', { class: 'legend-key', style: { background: s.color } }), s.label),
          h('td', { class: 'num' }, fmt.money(s.value, cur)),
          h('td', { class: 'num subtle' }, fmt.percent(total ? s.value / total * 100 : 0))))));

      middle = h('div', { class: 'an-grid' },
        h('section', { class: 'card' },
          h('div', { class: 'card-head' }, h('h2', null, `Категорії за ${mName}`), h('span', { class: 'subtle' }, fmt.count(cats.length, ['категорія', 'категорії', 'категорій']))),
          h('div', { class: 'cstat-list' }, statRows)),
        h('section', { class: 'card' },
          h('div', { class: 'card-head' }, h('h2', null, mode === 'expense' ? 'Розподіл витрат' : 'Розподіл доходів')),
          h('div', { class: 'donut-layout' }, donut, legend)));
    }

    // --- 12 місяців ---
    const months = [];
    for (let i = 11; i >= 0; i--) months.push(D.addMonths(month, -i));
    if (cur !== 'UAH') CRM.rates.ensureDates(months.map((m) => (D.endOfMonth(m) < T ? D.endOfMonth(m) : T))).catch(() => {});
    const values = months.map((m) => {
      const t = F().totalsIn(inRange(m), cur);
      return CRM.utils.round2(mode === 'expense' ? t.expense : t.income);
    });
    const hasBars = values.some((v) => v > 0);
    const bars = h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', null, `Порівняння за місяцями · ${mode === 'expense' ? 'витрати' : 'доходи'}`), h('span', { class: 'subtle' }, '12 місяців')),
      h('div', { class: 'card-body' },
        hasBars
          ? CRM.charts.bar({
            labels: months.map((m) => `${CRM.MONTHS_SHORT[D.parse(m).m - 1]} ${String(D.parse(m).y).slice(2)}`),
            titles: months.map((m) => fmt.month(m)),
            values, highlight: 11, height: 250,
            format: (v) => fmt.money(v, cur),
            yFormat: (v) => CRM.charts.compact(v),
            ariaLabel: `${mode === 'expense' ? 'Витрати' : 'Доходи'} за останні 12 місяців`,
            onClick: (i) => { if (months[i] <= thisMonth && months[i] >= firstMonth) { month = months[i]; CRM.router.rerender(); } }
          })
          : ui.empty({ icon: 'trendUp', small: true, title: 'Даних за останні 12 місяців ще немає' }),
        h('div', { class: 'card-note' }, CRM.icon('info', { size: 'sm' }), 'Клацни стовпчик, щоб переглянути місяць. Суми в іншій валюті — за курсом НБУ на дату операції.')));

    ui.mount(container, controls, h('div', { class: 'stack' },
      tot.missing ? h('div', { class: 'callout callout-warning' }, CRM.icon('alert'), h('span', null, `${tot.missing} ${fmt.plural(tot.missing, ['операцію', 'операції', 'операцій'])} не перераховано — немає курсу НБУ.`)) : null,
      h('div', { class: 'kpi-row an-kpis' }, cards), middle, bars));
  }

  CRM.budget.registerTab('analytics', { render });
})(window.CRM);
