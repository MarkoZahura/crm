/* ==========================================================================
   recurring.js — вкладка «Регулярні платежі».
   • Календар місяця (тиждень з понеділка) з перемиканням місяців;
     у клітинці — платежі дня; «+» на даті відкриває форму з цією датою.
   • Під календарем — список платежів місяця за датами.
   • «Позначити сплаченим / отриманим» створює транзакцію (витрату або дохід)
     з вибором рахунку й категорії; статус «сплачено» береться з транзакцій.
   • Нагадування: платіж сьогодні й завтра.
   ========================================================================== */
window.CRM = window.CRM || {};

(function (CRM) {
  'use strict';

  const { h, ui } = { h: CRM.ui.h, ui: CRM.ui };
  const D = CRM.date;
  const fmt = CRM.fmt;
  const F = () => CRM.finance;
  const S = () => CRM.schedule;

  let month = null; // перший день показаного місяця

  // ---------- Статуси ----------
  function createdDay(r) { return r.createdAt ? D.toKyivDate(r.createdAt) : r.startDate; }

  /** Статус платежу на дату: { id, label, cls } */
  function status(r, date) {
    const income = r.kind === 'income';
    const T = D.today();
    if (S().isPaid(r, date)) return { id: 'paid', label: income ? 'Отримано' : 'Сплачено', cls: 'badge-success' };
    if (date === T) return { id: 'today', label: 'Сьогодні', cls: 'badge-warning' };
    if (date > T) return { id: 'future', label: income ? 'Очікується' : 'Заплановано', cls: '' };
    if (date < createdDay(r)) return { id: 'before', label: 'Не відмічено', cls: '' };
    return { id: 'overdue', label: income ? 'Не отримано' : 'Прострочено', cls: 'badge-danger' };
  }

  function amountLabel(r) {
    return r.kind === 'income' ? fmt.money(r.amount, r.currency, { sign: true }) : fmt.money(-r.amount, r.currency);
  }

  /** Усі платежі в межах дат: [{ r, date }] за зростанням. */
  function itemsBetween(from, to) {
    const out = [];
    CRM.store.list('recurring').forEach((r) => {
      S().occurrences(r, from, to).forEach((date) => out.push({ r, date }));
    });
    return out.sort((a, b) => a.date.localeCompare(b.date) || a.r.name.localeCompare(b.r.name, 'uk'));
  }

  // ---------- Календар ----------
  function calendar(items) {
    const T = D.today();
    const first = month;
    const last = D.endOfMonth(first);
    const gridStart = D.startOfWeek(first);
    const gridEnd = D.endOfWeek(last);
    const byDate = CRM.utils.groupBy(items, (x) => x.date);

    const cells = [];
    for (let d = gridStart; d <= gridEnd; d = D.addDays(d, 1)) {
      const date = d;
      const inMonth = date.slice(0, 7) === first.slice(0, 7);
      const list = byDate.get(date) || [];
      const cls = ['cal-cell'];
      if (!inMonth) cls.push('other');
      if (date === T) cls.push('today');
      if (D.weekday(date) >= 5) cls.push('weekend');
      const cell = h('div', {
        class: cls.join(' '), role: 'gridcell', tabIndex: 0, dataset: { date },
        'aria-label': `${fmt.dateLong(date)}: ${list.length ? fmt.count(list.length, ['платіж', 'платежі', 'платежів']) : 'платежів немає'}`,
        onClick: (e) => { if (e.target.closest('.cal-add, .cal-chip')) return; cellClick(cell, date, list); },
        onKeydown: (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === cell) { e.preventDefault(); cellClick(cell, date, list); } }
      },
      h('div', { class: 'cal-top' },
        h('span', { class: 'cal-day num' }, String(D.parse(date).d)),
        h('button', {
          type: 'button', class: 'cal-add', title: 'Додати платіж на ' + fmt.date(date), 'aria-label': 'Додати платіж на ' + fmt.date(date),
          onClick: (e) => { e.stopPropagation(); openForm(null, date); }
        }, CRM.icon('plus', { size: 'sm' }))),
      h('div', { class: 'cal-items' },
        list.slice(0, 3).map((x) => {
          const st = status(x.r, date);
          return h('button', {
            type: 'button', class: `cal-chip st-${st.id}${x.r.kind === 'income' ? ' income' : ''}`,
            title: `${x.r.name} · ${amountLabel(x.r)} · ${st.label}`,
            onClick: (e) => { e.stopPropagation(); openForm(x.r.id); }
          }, h('span', { class: 'cal-chip-name' }, x.r.name), h('span', { class: 'cal-chip-amt num' }, fmt.money(x.r.amount, x.r.currency, { decimals: 0 })));
        }),
        list.length > 3 ? h('span', { class: 'cal-more' }, `+${list.length - 3}`) : null),
      h('div', { class: 'cal-dots', 'aria-hidden': 'true' }, list.slice(0, 4).map((x) => h('span', { class: `cal-dot st-${status(x.r, date).id}${x.r.kind === 'income' ? ' income' : ''}` }))));
      cells.push(cell);
    }
    return h('div', { class: 'cal', role: 'grid', 'aria-label': 'Календар платежів' },
      CRM.WEEKDAYS_SHORT.map((w, i) => h('div', { class: 'cal-wd' + (i >= 5 ? ' weekend' : ''), role: 'columnheader' }, w)),
      cells);
  }

  function cellClick(cell, date, list) {
    if (!list.length) { openForm(null, date); return; }
    const pop = ui.popover(cell, h('div', { class: 'menu cal-pop' },
      h('div', { class: 'cal-pop-title' }, fmt.dateLong(date)),
      list.map((x) => {
        const st = status(x.r, date);
        return h('button', { type: 'button', class: 'menu-item', onClick: () => { pop.close(); openForm(x.r.id); } },
          h('span', { class: 'grow' }, x.r.name), h('span', { class: 'num subtle' }, amountLabel(x.r)),
          st.cls ? h('span', { class: 'badge ' + st.cls }, st.label) : null);
      }),
      h('button', { type: 'button', class: 'menu-item', onClick: () => { pop.close(); openForm(null, date); } }, CRM.icon('plus', { size: 'sm' }), 'Додати платіж')),
    { align: 'start', className: 'menu-pop' });
  }

  // ---------- Список місяця ----------
  function listRow(x) {
    const st = status(x.r, x.date);
    const income = x.r.kind === 'income';
    const txId = S().paidTx(x.r, x.date);
    const tx = txId ? CRM.store.get('transactions', txId) : null;
    const wd = CRM.WEEKDAYS_SHORT[D.weekday(x.date)];
    let action;
    if (st.id === 'paid') {
      action = ui.button({ label: 'Скасувати', size: 'sm', variant: 'ghost', title: 'Скасувати позначку (транзакція піде в Кошик)', onClick: (e) => { e.stopPropagation(); unpay(x.r, x.date); } });
    } else {
      action = ui.button({ label: income ? 'Отримано' : 'Сплатити', icon: 'check', size: 'sm', onClick: (e) => { e.stopPropagation(); openPayForm(x.r, x.date); }, title: income ? 'Позначити отриманим' : 'Позначити сплаченим' });
    }
    return h('div', { class: 'rec-row', role: 'button', tabIndex: 0, dataset: { id: x.r.id, date: x.date },
      onClick: () => openForm(x.r.id),
      onKeydown: (e) => { if (e.key === 'Enter' && e.target.classList.contains('rec-row')) openForm(x.r.id); }
    },
    h('span', { class: 'rec-date' }, h('span', { class: 'rec-day num' }, String(D.parse(x.date).d)), h('span', { class: 'rec-wd' }, wd)),
    h('span', { class: 'rec-main' },
      h('span', { class: 'rec-name' }, x.r.name, income ? h('span', { class: 'badge badge-success rec-kind' }, 'дохід') : null),
      h('span', { class: 'rec-sub' }, [CRM.entities.freqLabel(x.r.freq), tx ? `${income ? 'отримано' : 'сплачено'} ${fmt.dateShort(tx.date)} · ${CRM.entities.accName(tx.accountId)}` : null].filter(Boolean).join(' · '))),
    h('span', { class: 'rec-amount num' + (income ? ' tx-income' : '') }, amountLabel(x.r)),
    h('span', { class: 'badge ' + st.cls }, st.label),
    action);
  }

  function monthSummary(items) {
    let dueExp = 0; let paidExp = 0; let inc = 0; let missing = false;
    items.forEach((x) => {
      const uah = CRM.rates.toUAH(x.r.amount, x.r.currency);
      if (uah == null) { missing = true; return; }
      if (x.r.kind === 'income') inc += uah;
      else if (S().isPaid(x.r, x.date)) paidExp += uah;
      else dueExp += uah;
    });
    return h('div', { class: 'rec-summary' },
      h('span', null, 'Сплачено ', h('strong', { class: 'num' }, fmt.money(paidExp, 'UAH'))),
      h('span', null, 'Ще до сплати ', h('strong', { class: 'num' }, fmt.money(dueExp, 'UAH'))),
      inc ? h('span', null, 'Надходження ', h('strong', { class: 'num' }, fmt.money(inc, 'UAH', { sign: true }))) : null,
      missing ? h('span', { class: 'badge badge-warning' }, 'частина без курсу') : null);
  }

  // ---------- Вкладка ----------
  function render(container, route) {
    const T = D.today();
    if (!month) month = D.startOfMonth(T);

    if (route.params.open) {
      const id = route.params.open;
      CRM.router.consumeParam('open');
      const r = CRM.store.get('recurring', id);
      if (r) {
        const next = S().nextOn(r, T);
        if (next) month = D.startOfMonth(next);
      }
      setTimeout(() => openForm(id), 0);
    }

    const from = month;
    const to = D.endOfMonth(month);
    const items = itemsBetween(D.startOfWeek(from), D.endOfWeek(to));
    const monthItems = items.filter((x) => x.date >= from && x.date <= to);
    const hasAny = CRM.store.list('recurring').length > 0;

    const nav = h('div', { class: 'month-nav' },
      h('button', { type: 'button', class: 'btn btn-icon btn-sm', 'aria-label': 'Попередній місяць', onClick: () => { month = D.addMonths(month, -1); CRM.router.rerender(); } }, CRM.icon('chevronLeft', { size: 'sm' })),
      h('span', { class: 'month-title' }, fmt.month(month)),
      h('button', { type: 'button', class: 'btn btn-icon btn-sm', 'aria-label': 'Наступний місяць', onClick: () => { month = D.addMonths(month, 1); CRM.router.rerender(); } }, CRM.icon('chevronRight', { size: 'sm' })),
      month !== D.startOfMonth(T) ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: () => { month = D.startOfMonth(T); CRM.router.rerender(); } }, 'Сьогодні') : null);

    const toolbar = h('div', { class: 'toolbar' }, nav,
      ui.button({ label: 'Додати платіж', icon: 'plus', onClick: () => openForm(null, month === D.startOfMonth(T) ? T : month) }));

    const listCard = h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', null, `Платежі: ${fmt.month(month).toLowerCase()}`, h('span', { class: 'tab-count' }, String(monthItems.length)))),
      monthItems.length ? monthSummary(monthItems) : null,
      monthItems.length
        ? h('div', { class: 'rec-list' }, monthItems.map(listRow))
        : ui.empty({
          icon: 'repeat', small: true,
          title: hasAny ? 'У цьому місяці платежів немає' : 'Ще немає регулярних платежів',
          text: hasAny ? null : 'Оренда, інтернет, підписки, зарплата — додай їх, і вони зʼявляться в календарі, на Головній і в нагадуваннях.',
          action: hasAny ? null : { label: 'Додати платіж', icon: 'plus', onClick: () => openForm(null, T) }
        }));

    ui.mount(container, toolbar, h('div', { class: 'stack' }, h('section', { class: 'card cal-card' }, calendar(items)), listCard));
  }

  // ---------- Форма платежу ----------
  const PRESETS = [
    { id: 'day', label: 'Щодня', freq: { unit: 'day', every: 1 } },
    { id: 'week', label: 'Щотижня', freq: { unit: 'week', every: 1 } },
    { id: 'month', label: 'Щомісяця', freq: { unit: 'month', every: 1 } },
    { id: 'year', label: 'Щороку', freq: { unit: 'year', every: 1 } },
    { id: 'custom', label: 'Власна' }
  ];

  function presetOf(freq) {
    if (!freq || Number(freq.every) !== 1) return 'custom';
    return freq.unit;
  }

  function openForm(id, date) {
    const existing = id ? CRM.store.get('recurring', id) : null;
    if (id && (!existing || existing.deletedAt)) { ui.toast('Платіж не знайдено', { type: 'error' }); return null; }
    const isNew = !existing;
    const st = existing ? CRM.utils.deepClone(existing) : {
      kind: 'expense', name: '', freq: { unit: 'month', every: 1 }, count: null, amount: null, currency: 'UAH', startDate: date || D.today()
    };
    let preset = presetOf(st.freq);

    const kindSeg = h('div', { class: 'segmented tx-type', role: 'radiogroup', 'aria-label': 'Тип' });
    function renderKind() {
      ui.mount(kindSeg, [['expense', 'Платіж (витрата)'], ['income', 'Надходження (дохід)']].map(([k, l]) => h('button', {
        type: 'button', role: 'radio', class: (st.kind === k ? 'active ' : '') + 'tx-' + k, 'aria-checked': st.kind === k ? 'true' : 'false',
        onClick: () => { st.kind = k; renderKind(); }
      }, l)));
    }
    renderKind();

    const nameIn = ui.input({ value: st.name, maxlength: 60, placeholder: 'Напр., Оренда, Інтернет, Зарплата' });
    const fName = ui.field({ label: 'Назва платежу', input: nameIn, required: true });

    const freqChips = h('div', { class: 'chips', role: 'radiogroup', 'aria-label': 'Періодичність' });
    const everyIn = h('input', { class: 'input input-num', type: 'number', min: 1, max: 365, step: 1, value: st.freq.every || 1, 'aria-label': 'Кожні N' });
    const unitSel = ui.select([{ value: 'day', label: 'днів' }, { value: 'week', label: 'тижнів' }, { value: 'month', label: 'місяців' }],
      { value: st.freq.unit === 'year' ? 'month' : st.freq.unit, 'aria-label': 'Одиниця', class: 'select' });
    const customRow = h('div', { class: 'custom-freq' }, h('span', null, 'Кожні'), everyIn, unitSel);
    function renderFreq() {
      ui.mount(freqChips, PRESETS.map((p) => h('button', {
        type: 'button', role: 'radio', class: 'chip' + (preset === p.id ? ' active' : ''), 'aria-checked': preset === p.id ? 'true' : 'false',
        onClick: () => { preset = p.id; renderFreq(); }
      }, p.label)));
      customRow.hidden = preset !== 'custom';
    }
    renderFreq();
    const fFreq = ui.field({ label: 'Періодичність', input: h('div', { class: 'form-stack', style: { gap: '10px' } }, freqChips, customRow) });

    const countIn = h('input', { class: 'input input-num', type: 'number', min: 1, step: 1, value: st.count || '', placeholder: 'Безстроково', 'aria-label': 'Кількість платежів' });
    const fCount = ui.field({ label: 'Кількість платежів', input: countIn, hint: 'Необовʼязково. Порожньо — безстроково.' });

    const amountIn = h('input', { class: 'input amount-input', type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '0,00', value: st.amount != null ? String(st.amount).replace('.', ',') : '', 'aria-label': 'Сума' });
    const curSeg = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Валюта' });
    function renderCur() {
      ui.mount(curSeg, CRM.dict.currencies.map((c) => h('button', {
        type: 'button', role: 'radio', class: st.currency === c ? 'active' : '', 'aria-checked': st.currency === c ? 'true' : 'false',
        onClick: () => { st.currency = c; renderCur(); }
      }, c)));
    }
    renderCur();
    const fAmount = ui.field({ label: 'Сума', input: h('div', { class: 'amount-row' }, amountIn, curSeg), required: true });

    const dateIn = ui.dateInput({ value: st.startDate, clearable: false, ariaLabel: 'Дата першого платежу' });
    const fDate = ui.field({ label: 'Дата першого платежу', input: dateIn });

    // Статус найближчих дат (лише для існуючого платежу)
    let statusBox = null;
    if (existing) {
      const T = D.today();
      const pending = S().occurrences(existing, D.addDays(T, -60), D.addDays(T, 400))
        .filter((d) => !S().isPaid(existing, d) && (d >= T || d >= createdDay(existing)));
      const overdue = pending.filter((d) => d < T).slice(-3);
      const next = pending.find((d) => d >= T);
      const rows = overdue.concat(next ? [next] : []);
      statusBox = h('div', { class: 'rec-status' },
        rows.length
          ? rows.map((d) => {
            const s = status(existing, d);
            return h('div', { class: 'rec-status-row' },
              h('span', { class: 'grow' }, Math.abs(D.diffDays(T, d)) <= 1 ? `${fmt.relDay(d)}, ${fmt.dateShort(d)}` : fmt.dateShort(d)),
              h('span', { class: 'badge ' + s.cls }, s.label),
              ui.button({ label: existing.kind === 'income' ? 'Позначити отриманим' : 'Позначити сплаченим', icon: 'check', size: 'sm', variant: 'primary', onClick: () => { dlg.close('force'); openPayForm(existing, d); } }));
          })
          : h('div', { class: 'subtle' }, S().lastDate(existing) && S().lastDate(existing) < T ? 'Усі платежі серії минули.' : 'Немає несплачених дат.'));
    }

    async function submit(e) {
      if (e) e.preventDefault();
      let ok = true;
      const name = nameIn.value.trim();
      if (!name) { fName.setError('Вкажи назву платежу'); ok = false; }
      const amount = CRM.utils.parseAmount(amountIn.value);
      if (isNaN(amount) || amount <= 0) { fAmount.setError('Вкажи суму більшу за нуль'); ok = false; }
      let freq = PRESETS.find((p) => p.id === preset).freq;
      if (preset === 'custom') {
        const n = Number(everyIn.value);
        if (!Number.isInteger(n) || n < 1 || n > 365) { fFreq.setError('Вкажи ціле число від 1 до 365'); ok = false; }
        freq = { unit: unitSel.value, every: n };
      }
      let count = null;
      if (countIn.value.trim()) {
        count = Number(countIn.value);
        if (!Number.isInteger(count) || count < 1 || count > 10000) { fCount.setError('Ціле число від 1 або залиш порожнім'); ok = false; }
      }
      if (!ok) return;
      const rec = Object.assign(existing ? CRM.utils.deepClone(existing) : {}, {
        kind: st.kind, name, freq, count, amount: CRM.utils.round2(amount), currency: st.currency, startDate: dateIn.dateValue || D.today()
      });
      delete rec.paid; // застаріле поле: статус оплати береться з транзакцій
      const saved = await CRM.store.save('recurring', rec);
      dlg.close('force');
      CRM.notify.runRules();
      month = D.startOfMonth(saved.startDate > D.today() ? saved.startDate : month || D.today());
      ui.toast(isNew ? `Платіж «${name}» додано` : 'Зміни збережено', { type: 'success' });
    }

    async function remove() {
      const ok = await ui.confirm({
        title: 'Видалити регулярний платіж?',
        message: `«${existing.name}» потрапить у Кошик. Уже створені транзакції оплат залишаться в історії.`,
        confirmText: 'Видалити', danger: true
      });
      if (!ok) return;
      const batch = await CRM.store.softDelete('recurring', existing.id);
      dlg.close('force');
      ui.toast('Платіж перенесено в Кошик', { action: { label: 'Скасувати', onClick: () => CRM.store.restoreBatch(batch) } });
    }

    const form = h('form', { class: 'form-stack', novalidate: true, onSubmit: submit },
      statusBox, kindSeg, fName, fFreq, h('div', { class: 'form-grid' }, fCount, fDate), fAmount,
      h('button', { type: 'submit', hidden: true, tabIndex: -1, 'aria-hidden': 'true' }));

    const dlg = ui.modal({
      title: isNew ? 'Новий регулярний платіж' : existing.name,
      size: 'md', body: form,
      footer: h('div', { class: 'drawer-footer-inner' },
        existing ? ui.button({ label: 'Видалити', icon: 'trash', variant: 'danger-ghost', onClick: remove }) : null,
        h('span', { class: 'grow' }),
        ui.button({ label: 'Скасувати', onClick: () => dlg.close('button') }),
        ui.button({ label: isNew ? 'Додати' : 'Зберегти', variant: 'primary', icon: isNew ? 'plus' : 'check', onClick: () => submit() })),
      initialFocus: isNew ? nameIn : 'container'
    });
    return dlg;
  }

  // ---------- Позначити сплаченим / отриманим ----------
  function openPayForm(r, occDate) {
    if (!F().accounts().length) {
      ui.toast('Спершу додай рахунок у вкладці «Рахунки»', { type: 'error' });
      return null;
    }
    const income = r.kind === 'income';
    const T = D.today();
    const ranked = F().rankedAccounts();
    let accountId = (r.lastAccountId && F().account(r.lastAccountId)) ? r.lastAccountId
      : ((ranked.find((x) => x.account.currency === r.currency && x.account.type !== 'savings') || ranked.find((x) => x.account.type !== 'savings') || ranked[0]).account.id);
    let categoryId = r.lastCategoryId && CRM.store.get('categories', r.lastCategoryId) && !CRM.store.get('categories', r.lastCategoryId).deletedAt ? r.lastCategoryId : null;
    let subcategoryId = categoryId ? r.lastSubcategoryId || null : null;
    let amountTouched = false;

    const accSel = h('select', { class: 'select', 'aria-label': 'Рахунок' });
    ranked.forEach((x) => accSel.appendChild(h('option', { value: x.account.id, selected: x.account.id === accountId }, `${x.account.name} · ${fmt.money(x.balance, x.account.currency)}`)));
    const fAcc = ui.field({ label: income ? 'На рахунок' : 'З рахунку', input: accSel });

    const amountIn = h('input', { class: 'input amount-input', type: 'text', inputmode: 'decimal', autocomplete: 'off', 'aria-label': 'Сума' });
    const cur = h('span', { class: 'amount-cur' });
    const hint = h('div', { class: 'field-hint' });
    const fAmount = ui.field({ label: 'Сума', input: h('div', { class: 'amount-wrap' }, amountIn, cur), required: true });
    fAmount.appendChild(hint);
    amountIn.addEventListener('input', () => { amountTouched = true; fAmount.setError(null); });

    const dateIn = ui.dateInput({ value: occDate <= T ? occDate : T, clearable: false, ariaLabel: 'Дата оплати', onChange: () => fillAmount() });
    const fDate = ui.field({ label: income ? 'Дата надходження' : 'Дата оплати', input: dateIn });

    function fillAmount() {
      const acur = F().currencyOf(accSel.value);
      cur.textContent = CRM.CURRENCIES[acur].symbol;
      if (acur === r.currency) {
        hint.textContent = '';
        if (!amountTouched) amountIn.value = String(r.amount).replace('.', ',');
        return;
      }
      const conv = CRM.rates.convert(r.amount, r.currency, acur, dateIn.dateValue || T);
      hint.textContent = conv == null
        ? `Платіж у ${r.currency}, рахунок у ${acur}: курсу НБУ немає — введи суму вручну.`
        : `${fmt.money(r.amount, r.currency)} ≈ ${fmt.money(conv, acur)} за курсом НБУ. Можна виправити.`;
      if (!amountTouched) amountIn.value = conv == null ? '' : String(CRM.utils.round2(conv)).replace('.', ',');
    }
    accSel.addEventListener('change', () => { amountTouched = false; fillAmount(); });
    fillAmount();

    const catBox = h('div', { class: 'cat-chips' });
    const subBox = h('div', { class: 'cat-chips sub' });
    const fCat = ui.field({ label: 'Категорія', input: h('div', null, catBox, subBox), required: true });
    function renderCats() {
      const cats = F().categories(r.kind);
      ui.mount(catBox, cats.map((c) => h('button', {
        type: 'button', class: 'cat-chip' + (categoryId === c.id ? ' active' : ''),
        onClick: () => { categoryId = c.id; subcategoryId = null; fCat.setError(null); renderCats(); }
      }, h('span', { class: 'cat-dot', style: { background: CRM.dict.categoryColor(c.color) } }), c.name)));
      const c = categoryId && CRM.store.get('categories', categoryId);
      const subs = c ? c.subcategories || [] : [];
      if (!subs.length) { subBox.replaceChildren(); return; }
      ui.mount(subBox, h('span', { class: 'sub-label' }, 'Субкатегорія:'),
        [{ id: null, name: 'Без субкатегорії' }].concat(subs).map((s) => h('button', {
          type: 'button', class: 'cat-chip small' + (subcategoryId === s.id ? ' active' : ''),
          onClick: () => { subcategoryId = s.id; renderCats(); }
        }, s.name)));
    }
    renderCats();

    const commentIn = ui.input({ value: r.name, maxlength: 200 });
    const fComment = ui.field({ label: 'Коментар', input: commentIn });

    async function submit(e) {
      if (e) e.preventDefault();
      let ok = true;
      const amount = CRM.utils.parseAmount(amountIn.value);
      if (isNaN(amount) || amount <= 0) { fAmount.setError('Вкажи суму більшу за нуль'); ok = false; }
      if (!categoryId) { fCat.setError('Оберіть категорію'); ok = false; }
      if (!ok) return;
      if (S().isPaid(r, occDate)) { dlg.close('force'); ui.toast('Цей платіж уже позначено'); return; }
      const tx = await CRM.store.save('transactions', {
        type: r.kind, amount: CRM.utils.round2(amount), accountId: accSel.value, toAccountId: null, toAmount: null,
        categoryId, subcategoryId, date: dateIn.dateValue || T, comment: commentIn.value.trim(),
        recurringId: r.id, recurringDate: occDate
      });
      await CRM.store.patch('recurring', r.id, { lastAccountId: accSel.value, lastCategoryId: categoryId, lastSubcategoryId: subcategoryId });
      F().ensureRatesFor([tx]);
      dlg.close('force');
      ui.toast(income ? 'Надходження позначено отриманим' : 'Платіж позначено сплаченим', {
        type: 'success',
        action: { label: 'Скасувати', onClick: () => CRM.store.removeForever('transactions', tx.id) }
      });
    }

    const form = h('form', { class: 'form-stack', novalidate: true, onSubmit: submit },
      h('div', { class: 'callout' }, CRM.icon('repeat'),
        h('span', null, h('strong', null, r.name), ` · ${fmt.date(occDate)} · ${amountLabel(r)}. Буде створено ${income ? 'дохід' : 'витрату'} на вибраному рахунку.`)),
      h('div', { class: 'form-grid' }, fAcc, fDate), fAmount, fCat, fComment,
      h('button', { type: 'submit', hidden: true, tabIndex: -1, 'aria-hidden': 'true' }));

    const dlg = ui.modal({
      title: income ? 'Позначити отриманим' : 'Позначити сплаченим',
      size: 'md', body: form,
      footer: [
        ui.button({ label: 'Скасувати', onClick: () => dlg.close('button') }),
        ui.button({ label: income ? 'Отримано' : 'Сплачено', icon: 'check', variant: 'primary', onClick: () => submit() })
      ],
      initialFocus: amountIn
    });
    return dlg;
  }

  async function unpay(r, date) {
    const txId = S().paidTx(r, date);
    if (!txId) return;
    const ok = await ui.confirm({
      title: 'Скасувати позначку?',
      message: `Транзакцію оплати «${r.name}» за ${fmt.date(date)} буде перенесено в Кошик, а баланс рахунку перерахується.`,
      confirmText: 'Скасувати позначку', cancelText: 'Не скасовувати', danger: true
    });
    if (!ok) return;
    const batch = await CRM.store.softDelete('transactions', txId);
    ui.toast('Позначку знято', { action: { label: 'Повернути', onClick: () => CRM.store.restoreBatch(batch) } });
  }

  // ---------- Нагадування: платіж сьогодні й завтра ----------
  CRM.notify.addRule(() => {
    const T = D.today();
    const TM = D.addDays(T, 1);
    const out = [];
    CRM.store.list('recurring').forEach((r) => {
      [T, TM].forEach((d) => {
        if (!S().occurrences(r, d, d).length || S().isPaid(r, d)) return;
        const income = r.kind === 'income';
        const today = d === T;
        out.push({
          key: `payment:${today ? 'today' : 'tomorrow'}:${r.id}:${d}`,
          kind: 'payment',
          title: (today ? 'Сьогодні ' : 'Завтра ') + (income ? 'надходження' : 'платіж'),
          text: `${r.name} — ${fmt.money(r.amount, r.currency)}`,
          target: { store: 'recurring', id: r.id }
        });
      });
    });
    return out;
  });

  CRM.budget.registerTab('recurring', { render });
  Object.assign(CRM.budget, { openRecurringForm: openForm, openPayForm, recurringStatus: status });
})(window.CRM);
