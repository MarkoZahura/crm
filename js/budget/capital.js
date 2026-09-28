/* ==========================================================================
   capital.js — вкладка «Капітал».
   Капітал — сума коштів на всіх рахунках у гривнях (валюта — за курсом НБУ).
   Верхній ряд: загальний капітал і зміна від початку місяця; зміна за рік;
   де найбільше коштів; валютна структура. Нижче — графік зміни капіталу
   з перемикачем 3 міс / 6 міс / рік / увесь час.
   ========================================================================== */
window.CRM = window.CRM || {};

(function (CRM) {
  'use strict';

  const { h, ui } = { h: CRM.ui.h, ui: CRM.ui };
  const D = CRM.date;
  const fmt = CRM.fmt;
  const F = () => CRM.finance;

  let period = '6m';
  const PERIODS = [['3m', '3 міс'], ['6m', '6 міс'], ['1y', 'Рік'], ['all', 'Увесь час']];
  const CURRENCY_SLOTS = { UAH: 'blue', USD: 'orange', EUR: 'aqua' };

  function delta(now, before) {
    const diff = CRM.utils.round2(now - before);
    const pct = before ? diff / Math.abs(before) * 100 : null;
    return { diff, pct };
  }

  function deltaLine(d, suffix) {
    if (d.pct == null) return h('span', { class: 'delta' }, 'немає даних для порівняння');
    const up = d.diff > 0;
    const zero = Math.abs(d.diff) < 0.005;
    return h('span', { class: 'delta ' + (zero ? '' : up ? 'up' : 'down') },
      zero ? null : CRM.icon(up ? 'trendUp' : 'trendDown', { size: 'sm' }),
      `${fmt.money(d.diff, 'UAH', { sign: true })} · ${d.pct > 0 ? '+' : ''}${fmt.percent(d.pct)}`,
      suffix ? h('span', { class: 'subtle' }, ' ' + suffix) : null);
  }

  // Точки графіка: щотижня (або щомісяця, якщо історія довша за 2 роки) + сьогодні
  function points(from, to) {
    const out = [];
    const spanDays = D.diffDays(from, to);
    if (spanDays > 730) {
      let m = D.endOfMonth(from);
      while (m < to) { out.push(m); m = D.endOfMonth(D.addMonths(D.startOfMonth(m), 1)); }
    } else {
      for (let d = from; d < to; d = D.addDays(d, 7)) out.push(d);
    }
    out.push(to);
    return out;
  }

  function label(date, long) {
    const p = D.parse(date);
    return long ? `${CRM.MONTHS_SHORT[p.m - 1]} ${String(p.y).slice(2)}` : `${p.d} ${CRM.MONTHS_SHORT[p.m - 1]}`;
  }

  function render(container) {
    const accounts = F().accounts();
    if (!accounts.length) {
      ui.mount(container, h('div', { class: 'card' }, ui.empty({
        icon: 'coins', title: 'Капітал зʼявиться, коли додаш рахунки',
        text: 'Усі рахунки й операції враховуються автоматично — від витрат до переказів.',
        action: { label: 'Додати рахунок', icon: 'plus', onClick: () => { CRM.router.go('budget/accounts'); setTimeout(() => CRM.budget.openAccountForm(), 50); } }
      })));
      return;
    }
    const T = D.today();
    const start = F().historyStart() || T;
    const cap = F().capital();
    const now = cap.total;

    // Зміна від початку місяця (порівнюємо з кінцем попереднього дня)
    const monthRef = D.addDays(D.startOfMonth(T), -1);
    const atMonth = monthRef >= start ? F().capitalAt(monthRef) : null;
    const dMonth = atMonth && atMonth.active ? delta(now, atMonth.total) : { diff: 0, pct: null };

    // Зміна за рік (або з початку історії, якщо вона коротша)
    const yearAgo = D.addYears(T, -1);
    const yearRef = yearAgo >= start ? yearAgo : start;
    const atYear = yearRef < T ? F().capitalAt(yearRef) : null;
    const dYear = atYear && atYear.active ? delta(now, atYear.total) : { diff: 0, pct: null };
    const yearLabel = yearRef === yearAgo ? 'за рік' : `з ${fmt.date(yearRef)}`;

    // Де найбільше коштів
    const top = cap.accounts.find((x) => x.uah != null);
    const topShare = top && now ? top.uah / now * 100 : 0;

    // Валютна структура
    const structure = CRM.dict.currencies.map((c) => ({
      c, amount: cap.byCurrency[c] ? cap.byCurrency[c].amount : 0, uah: cap.byCurrency[c] ? cap.byCurrency[c].uah : 0
    }));
    const structTotal = structure.reduce((s, x) => s + Math.max(0, x.uah), 0);

    const cards = h('div', { class: 'cap-cards' },
      h('div', { class: 'kpi' },
        h('div', { class: 'kpi-label' }, 'Загальний капітал'),
        h('div', { class: 'kpi-value hero num' }, fmt.money(now, 'UAH')),
        h('div', { class: 'kpi-note' }, deltaLine(dMonth, 'від початку місяця'))),
      h('div', { class: 'kpi' },
        h('div', { class: 'kpi-label' }, 'Зміна ' + yearLabel),
        h('div', { class: 'kpi-value num' }, dYear.pct == null ? '—' : fmt.money(dYear.diff, 'UAH', { sign: true })),
        h('div', { class: 'kpi-note' }, dYear.pct == null ? 'Ще замало історії' : deltaLine(dYear))),
      h('div', { class: 'kpi' },
        h('div', { class: 'kpi-label' }, 'Де найбільше коштів'),
        top ? h('div', { class: 'kpi-value kpi-value-sm' }, top.account.name) : h('div', { class: 'kpi-value' }, '—'),
        top ? h('div', { class: 'kpi-note' }, `${fmt.money(top.balance, top.account.currency)} · ${fmt.percent(topShare)} капіталу`) : null),
      h('div', { class: 'kpi kpi-wide' },
        h('div', { class: 'kpi-label' }, 'Валютна структура'),
        h('div', { class: 'cur-bar', role: 'img', 'aria-label': 'Частки валют у капіталі' },
          structure.filter((x) => x.uah > 0).map((x) => h('span', {
            class: 'cur-seg', title: `${x.c}: ${fmt.percent(structTotal ? x.uah / structTotal * 100 : 0)}`,
            style: { width: (structTotal ? x.uah / structTotal * 100 : 0) + '%', background: CRM.charts.seriesColor(CURRENCY_SLOTS[x.c]) }
          }))),
        h('table', { class: 'cur-table' }, h('tbody', null, structure.map((x) => h('tr', null,
          h('td', null, h('span', { class: 'legend-key', style: { background: CRM.charts.seriesColor(CURRENCY_SLOTS[x.c]) } }), x.c),
          h('td', { class: 'num' }, fmt.money(x.amount, x.c)),
          h('td', { class: 'num subtle' }, x.c === 'UAH' ? '' : '≈ ' + fmt.money(x.uah, 'UAH')),
          h('td', { class: 'num' }, fmt.percent(structTotal ? Math.max(0, x.uah) / structTotal * 100 : 0))))))));

    // Графік
    const from = period === 'all' ? start
      : D.addMonths(T, period === '3m' ? -3 : period === '6m' ? -6 : -12);
    const effFrom = from < start ? start : from;
    const dates = points(effFrom, T);
    const series = F().capitalSeries(dates);
    if (cap.accounts.some((x) => x.account.currency !== 'UAH')) CRM.rates.ensureDates(dates).catch(() => {});
    const long = D.diffDays(effFrom, T) > 200;

    const seg = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Період графіка' },
      PERIODS.map(([id, l]) => h('button', {
        type: 'button', role: 'radio', class: period === id ? 'active' : '', 'aria-checked': period === id ? 'true' : 'false',
        onClick: () => { period = id; CRM.router.rerender(); }
      }, l)));

    const chartCard = h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', null, 'Зміна капіталу'), seg),
      h('div', { class: 'card-body' },
        dates.length < 2
          ? ui.empty({ icon: 'trendUp', small: true, title: 'Графік зʼявиться, щойно накопичиться історія', text: `Облік почато ${fmt.date(start)}.` })
          : CRM.charts.line({
            labels: dates.map((d) => label(d, long)),
            titles: dates.map((d) => fmt.date(d)),
            values: series.map((p) => p.total),
            format: (v) => fmt.money(v, 'UAH'),
            height: 280,
            ariaLabel: `Графік капіталу з ${fmt.date(effFrom)} до ${fmt.date(T)}`
          }),
        h('div', { class: 'card-note' }, CRM.icon('info', { size: 'sm' }),
          `Баланси — на кінець дня, суми в доларах і євро — за курсом НБУ на кожну дату. Облік почато ${fmt.date(start)}.`)));

    ui.mount(container, h('div', { class: 'stack' },
      cap.missing ? h('div', { class: 'callout callout-warning' }, CRM.icon('alert'), h('span', null, 'Для частини рахунків немає курсу НБУ — вони не враховані в капіталі.')) : null,
      cards, chartCard));
  }

  CRM.budget.registerTab('capital', { render });
})(window.CRM);
