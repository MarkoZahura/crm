/* ==========================================================================
   transactions.js — вкладка «Транзакції».
   Період (дата, діапазон, «Сьогодні», «Цього тижня», «Цього місяця»,
   «Минулого місяця», «За весь час»), фільтри (тип, категорія, рахунок,
   валюта), пошук за коментарем і сумою, сортування за датою,
   групування по днях із підсумком дня.
   ========================================================================== */
window.CRM = window.CRM || {};

(function (CRM) {
  'use strict';

  const { h, ui } = { h: CRM.ui.h, ui: CRM.ui };
  const D = CRM.date;
  const fmt = CRM.fmt;
  const F = () => CRM.finance;
  const PAGE = 150;

  const DEFAULTS = { period: 'month', from: null, to: null, type: 'all', categoryId: '', accountId: '', currency: '', q: '', order: 'desc' };
  const f = Object.assign({}, DEFAULTS);
  let limit = PAGE;

  const PERIODS = [
    ['today', 'Сьогодні'], ['week', 'Цього тижня'], ['month', 'Цього місяця'],
    ['prevMonth', 'Минулого місяця'], ['all', 'За весь час'], ['custom', 'Дата або діапазон…']
  ];

  function range() {
    const T = D.today();
    switch (f.period) {
      case 'today': return [T, T];
      case 'week': return [D.startOfWeek(T), D.endOfWeek(T)];
      case 'month': return [D.startOfMonth(T), D.endOfMonth(T)];
      case 'prevMonth': { const p = D.addMonths(D.startOfMonth(T), -1); return [p, D.endOfMonth(p)]; }
      case 'custom': {
        const from = f.from || T;
        const to = f.to && f.to >= from ? f.to : from;
        return [from, to];
      }
      default: return [null, null];
    }
  }

  function rangeLabel() {
    const [from, to] = range();
    if (!from) return 'за весь час';
    if (from === to) return fmt.date(from);
    return `${fmt.date(from)} — ${fmt.date(to)}`;
  }

  function isFiltered() {
    return f.type !== 'all' || f.categoryId || f.accountId || f.currency || f.q.trim() || f.period !== 'month';
  }

  function matches(t) {
    if (f.type !== 'all' && t.type !== f.type) return false;
    if (f.categoryId && t.categoryId !== f.categoryId) return false;
    if (f.accountId && t.accountId !== f.accountId && t.toAccountId !== f.accountId) return false;
    if (f.currency) {
      const c1 = F().currencyOf(t.accountId);
      const c2 = t.toAccountId ? F().currencyOf(t.toAccountId) : null;
      if (c1 !== f.currency && c2 !== f.currency) return false;
    }
    const q = f.q.trim();
    if (q) {
      const numeric = /^[\d\s .,]+$/.test(q) && /\d/.test(q) ? q.replace(/[\s ]/g, '').replace(',', '.') : null;
      const inComment = CRM.utils.normalize(t.comment).includes(CRM.utils.normalize(q));
      const inAmount = numeric != null && [t.amount, t.toAmount].some((a) => typeof a === 'number' && (a.toFixed(2).startsWith(numeric) || String(a).startsWith(numeric)));
      if (!inComment && !inAmount) return false;
    }
    return true;
  }

  function filtered() {
    const [from, to] = range();
    const list = F().txInRange(from, to).filter(matches);
    return list.sort((a, b) => {
      const c = a.date.localeCompare(b.date) || (a.createdAt || '').localeCompare(b.createdAt || '');
      return f.order === 'asc' ? c : -c;
    });
  }

  // ---------- Рядок операції ----------
  function txRow(t) {
    const cur = F().txCurrency(t);
    let icon;
    let title;
    let sub;
    if (t.type === 'transfer') {
      icon = h('span', { class: 'list-row-icon tx-ico transfer' }, CRM.icon('arrows', { size: 'sm' }));
      title = 'Переказ';
      sub = `${CRM.entities.accName(t.accountId)} → ${CRM.entities.accName(t.toAccountId)}`;
    } else {
      icon = h('span', { class: 'list-row-icon tx-ico', style: { '--cat': F().categoryColor(t.categoryId) } }, h('span', { class: 'cat-dot big' }));
      title = F().categoryName(t.categoryId, t.subcategoryId);
      sub = CRM.entities.accName(t.accountId);
    }
    const uah = cur !== 'UAH' ? F().txUAH(t) : null;
    const toCur = t.type === 'transfer' && t.toAccountId ? F().currencyOf(t.toAccountId) : null;
    return h('button', { type: 'button', class: 'tx-row', onClick: () => CRM.budget.openTxForm({ id: t.id }), dataset: { id: t.id } },
      icon,
      h('span', { class: 'tx-main' },
        h('span', { class: 'tx-title' }, title, t.recurringId ? h('span', { class: 'tx-tag', title: 'Регулярний платіж' }, CRM.icon('repeat', { size: 'sm' })) : null),
        h('span', { class: 'tx-sub' }, [t.comment, sub].filter(Boolean).join(' · '))),
      h('span', { class: 'tx-amounts' },
        h('span', { class: 'tx-amount num tx-' + t.type }, F().txAmountLabel(t)),
        toCur && toCur !== cur ? h('span', { class: 'tx-uah num' }, '→ ' + fmt.money(t.toAmount, toCur)) : null,
        uah != null && t.type !== 'transfer' ? h('span', { class: 'tx-uah num' }, '≈ ' + fmt.money(uah, 'UAH')) : null));
  }

  function dayHeader(date, list) {
    const tot = F().totals(list);
    const diff = D.diffDays(D.today(), date);
    const label = diff === 0 ? 'Сьогодні' : diff === -1 ? 'Вчора' : null;
    const long = fmt.dateLong(date);
    return h('div', { class: 'day-head' },
      h('span', { class: 'day-name' }, label ? `${label}, ${long.split(', ')[1]}` : long.charAt(0).toUpperCase() + long.slice(1)),
      (tot.income || tot.expense)
        ? h('span', { class: 'day-total num' + (tot.result < 0 ? ' neg' : '') }, fmt.money(tot.result, 'UAH', { sign: true }))
        : null);
  }

  // ---------- Панель фільтрів ----------
  function filtersBar() {
    const periodSel = ui.select(PERIODS.map(([v, l]) => ({ value: v, label: l })), { value: f.period, 'aria-label': 'Період', class: 'select select-sm' });
    periodSel.addEventListener('change', () => { f.period = periodSel.value; if (f.period === 'custom' && !f.from) { f.from = D.today(); f.to = null; } limit = PAGE; CRM.router.rerender(); });

    let custom = null;
    if (f.period === 'custom') {
      const fromIn = ui.dateInput({ value: f.from, clearable: false, ariaLabel: 'Від', onChange: (v) => { f.from = v; if (f.to && f.to < v) f.to = null; CRM.router.rerender(); } });
      const toIn = ui.dateInput({ value: f.to, placeholder: 'та сама дата', ariaLabel: 'До', onChange: (v) => { f.to = v; CRM.router.rerender(); } });
      custom = h('div', { class: 'range-inputs' }, h('span', { class: 'subtle' }, 'від'), fromIn, h('span', { class: 'subtle' }, 'до'), toIn);
    }

    const types = h('div', { class: 'chips', role: 'group', 'aria-label': 'Тип' },
      [['all', 'Усі'], ['expense', 'Витрати'], ['income', 'Доходи'], ['transfer', 'Перекази']].map(([v, l]) => h('button', {
        type: 'button', class: 'chip' + (f.type === v ? ' active' : ''), 'aria-pressed': f.type === v ? 'true' : 'false',
        onClick: () => { f.type = v; if (v === 'transfer') f.categoryId = ''; limit = PAGE; CRM.router.rerender(); }
      }, l)));

    const catSel = h('select', { class: 'select select-sm', 'aria-label': 'Категорія', disabled: f.type === 'transfer' });
    catSel.appendChild(h('option', { value: '' }, 'Усі категорії'));
    [['expense', 'Витрати'], ['income', 'Доходи']].forEach(([kind, label]) => {
      if (f.type !== 'all' && f.type !== kind) return;
      const g = h('optgroup', { label });
      F().categories(kind).forEach((c) => g.appendChild(h('option', { value: c.id, selected: f.categoryId === c.id }, c.name)));
      catSel.appendChild(g);
    });
    catSel.addEventListener('change', () => { f.categoryId = catSel.value; limit = PAGE; CRM.router.rerender(); });

    const accSel = ui.select([{ value: '', label: 'Усі рахунки' }].concat(F().rankedAccounts().map((x) => ({ value: x.account.id, label: x.account.name }))),
      { value: f.accountId, 'aria-label': 'Рахунок', class: 'select select-sm' });
    accSel.addEventListener('change', () => { f.accountId = accSel.value; limit = PAGE; CRM.router.rerender(); });

    const curSel = ui.select([{ value: '', label: 'Усі валюти' }].concat(CRM.dict.currencies.map((c) => ({ value: c, label: c }))),
      { value: f.currency, 'aria-label': 'Валюта', class: 'select select-sm' });
    curSel.addEventListener('change', () => { f.currency = curSel.value; limit = PAGE; CRM.router.rerender(); });

    const qIn = h('input', { class: 'input input-sm', type: 'text', placeholder: 'Пошук: коментар або сума', value: f.q, 'aria-label': 'Пошук за коментарем або сумою' });
    const applyQ = CRM.utils.debounce(() => {
      f.q = qIn.value;
      limit = PAGE;
      const pos = qIn.selectionStart;
      CRM.router.rerender();
      const again = document.querySelector('.tx-search input');
      if (again) { again.focus(); try { again.setSelectionRange(pos, pos); } catch (e) { /* ігноруємо */ } }
    }, 250);
    qIn.addEventListener('input', applyQ);

    const orderBtn = h('button', {
      type: 'button', class: 'btn btn-sm', title: 'Сортування за датою',
      onClick: () => { f.order = f.order === 'desc' ? 'asc' : 'desc'; CRM.router.rerender(); }
    }, CRM.icon('sort', { size: 'sm' }), f.order === 'desc' ? 'Спочатку нові' : 'Спочатку старі');

    return h('div', { class: 'tx-filters card' },
      h('div', { class: 'tx-filters-row' }, periodSel, custom, h('span', { class: 'grow' }), orderBtn),
      h('div', { class: 'tx-filters-row' }, types, catSel, accSel, curSel,
        h('label', { class: 'tx-search' }, CRM.icon('search', { size: 'sm' }), qIn),
        isFiltered() ? h('button', {
          type: 'button', class: 'btn btn-ghost btn-sm',
          onClick: () => { Object.assign(f, DEFAULTS); limit = PAGE; CRM.router.rerender(); }
        }, 'Скинути') : null));
  }

  // ---------- Вкладка ----------
  function render(container, route) {
    // Параметри з адреси (напр., «Показати операції» з рахунку)
    if (route.params.account) { Object.assign(f, DEFAULTS, { accountId: route.params.account, period: 'all' }); CRM.router.consumeParam('account'); }
    if (route.params.category) { Object.assign(f, DEFAULTS, { categoryId: route.params.category, period: 'all' }); CRM.router.consumeParam('category'); }

    const hasAny = CRM.store.list('transactions').length > 0;
    const list = filtered();
    F().ensureRatesFor(list);
    const tot = F().totals(list);

    const summary = h('div', { class: 'tx-summary' },
      h('span', null, `${fmt.count(list.length, ['операція', 'операції', 'операцій'])} ${rangeLabel()}`),
      h('span', { class: 'tx-sum-item' }, 'Доходи ', h('strong', { class: 'num' }, fmt.money(tot.income, 'UAH', { sign: true }))),
      h('span', { class: 'tx-sum-item' }, 'Витрати ', h('strong', { class: 'num' }, fmt.money(-tot.expense, 'UAH'))),
      h('span', { class: 'tx-sum-item' }, 'Результат ', h('strong', { class: 'num' }, fmt.money(tot.result, 'UAH', { sign: true }))),
      tot.missing ? h('span', { class: 'badge badge-warning' }, `${tot.missing} без курсу`) : null);

    let body;
    if (!hasAny) {
      body = h('div', { class: 'card' }, ui.empty({
        icon: 'receipt', title: 'Ще немає транзакцій — додай першу',
        text: 'Витрати, доходи й перекази між рахунками. Баланс рахунку перераховується автоматично.',
        action: { label: 'Додати транзакцію', icon: 'plus', onClick: () => CRM.budget.openTxForm() }
      }));
    } else if (!list.length) {
      body = h('div', { class: 'card' }, ui.empty({
        icon: 'search', small: true, title: 'Нічого не знайдено', text: 'Спробуй інший період або скинь фільтри.',
        action: { label: 'Скинути фільтри', variant: 'secondary', onClick: () => { Object.assign(f, DEFAULTS); CRM.router.rerender(); } }
      }));
    } else {
      const shown = list.slice(0, limit);
      const groups = CRM.utils.groupBy(shown, (t) => t.date);
      const nodes = [];
      groups.forEach((items, date) => {
        // Підсумок дня — за всіма операціями дня у відфільтрованому списку
        nodes.push(h('div', { class: 'day-group' }, dayHeader(date, list.filter((t) => t.date === date)), items.map(txRow)));
      });
      body = h('div', { class: 'card tx-list' }, nodes,
        list.length > limit ? h('button', {
          type: 'button', class: 'more-link btn-link', onClick: () => { limit += PAGE; CRM.router.rerender(); }
        }, `Показати ще (${list.length - limit})`) : null);
    }

    ui.mount(container, hasAny ? filtersBar() : null, hasAny ? summary : null, body);

    if (route.params.open) {
      const id = route.params.open;
      CRM.router.consumeParam('open');
      setTimeout(() => CRM.budget.openTxForm({ id }), 0);
    }
  }

  CRM.budget.registerTab('transactions', { render });
})(window.CRM);
