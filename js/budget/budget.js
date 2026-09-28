/* ==========================================================================
   budget.js — розділ «Бюджет»: заголовок із курсом НБУ, горизонтальні
   вкладки, кнопка «+ Транзакція» на всіх вкладках і форма транзакції.
   Вкладки реєструються окремими файлами через CRM.budget.registerTab().
   ========================================================================== */
window.CRM = window.CRM || {};

(function (CRM) {
  'use strict';

  const { h, ui } = { h: CRM.ui.h, ui: CRM.ui };
  const D = CRM.date;
  const fmt = CRM.fmt;
  const F = () => CRM.finance;

  const TAB_ORDER = [
    ['dashboard', 'Дашборд'], ['accounts', 'Рахунки'], ['transactions', 'Транзакції'], ['categories', 'Категорії'],
    ['capital', 'Капітал'], ['recurring', 'Регулярні платежі'], ['goals', 'Фінансові цілі'], ['analytics', 'Аналітика']
  ];
  const tabs = new Map();

  /** Зареєструвати вкладку: registerTab('accounts', { render(container, route) → [cleanup] }) */
  function registerTab(id, def) { tabs.set(id, def); }

  // ---------- Рядок курсу НБУ ----------
  function rateLine() {
    const r = CRM.rates.current();
    const fresh = CRM.rates.isFresh();
    const refresh = h('button', {
      type: 'button', class: 'btn btn-ghost btn-sm', title: 'Завантажити курс НБУ на сьогодні',
      onClick: async () => {
        refresh.disabled = true;
        try {
          await CRM.rates.fetchDate(D.today());
          ui.toast('Курс НБУ оновлено', { type: 'success' });
        } catch (e) {
          ui.toast('Не вдалося оновити курс: ' + (e.message || 'немає звʼязку з НБУ') + '. Використовую останній збережений.', { type: 'error', duration: 7000 });
        } finally { refresh.disabled = false; }
      }
    }, CRM.icon('restore', { size: 'sm' }), 'Оновити');
    if (!r) {
      return h('div', { class: 'rate-line warn' }, CRM.icon('alert', { size: 'sm' }),
        h('span', null, 'Курс НБУ ще не завантажено — суми в доларах і євро поки не перераховуються в гривню.'), refresh);
    }
    return h('div', { class: 'rate-line' + (fresh ? '' : ' warn') },
      CRM.icon(fresh ? 'bank' : 'alert', { size: 'sm' }),
      h('span', null, CRM.rates.describe()),
      fresh ? null : h('span', { class: 'badge badge-warning' }, 'не оновлено сьогодні'),
      fresh ? null : refresh);
  }

  // ---------- Сторінка ----------
  function render(container, route) {
    const tabId = tabs.has(route.sub) ? route.sub : 'dashboard';
    const tab = tabs.get(tabId);
    const nav = h('nav', { class: 'tabs tabs-scroll', 'aria-label': 'Вкладки бюджету' },
      TAB_ORDER.map(([id, label]) => h('a', {
        href: '#/budget/' + id, class: 'tab' + (id === tabId ? ' active' : ''),
        'aria-current': id === tabId ? 'page' : null
      }, label)));
    const content = h('div', { class: 'budget-tab' });

    ui.mount(container,
      ui.pageHead({
        title: 'Бюджет',
        sub: rateLine(),
        actions: ui.button({ label: 'Транзакція', icon: 'plus', variant: 'primary', onClick: () => openTxForm() })
      }),
      nav, content);

    // Активна вкладка — у полі зору (на телефоні вкладки прокручуються)
    const activeTab = nav.querySelector('.tab.active');
    if (activeTab && nav.scrollWidth > nav.clientWidth) nav.scrollLeft = activeTab.offsetLeft - 16;

    let tabCleanup = null;
    if (tab) {
      try { tabCleanup = tab.render(content, route); } catch (e) {
        console.error(e);
        ui.mount(content, ui.empty({ icon: 'alert', title: 'Не вдалося показати вкладку', text: 'Спробуй оновити сторінку (F5).' }));
      }
    } else {
      const label = (TAB_ORDER.find((t) => t[0] === tabId) || [])[1];
      ui.mount(content, h('div', { class: 'card placeholder-card' }, ui.empty({ icon: 'wallet', title: `«${label}» зʼявиться на етапі 4` })));
    }

    // Курс на сьогодні — раз на добу (якщо ще немає)
    if (!CRM.rates.isFresh()) CRM.rates.ensureToday();

    return () => {
      if (typeof tabCleanup === 'function') tabCleanup();
    };
  }

  CRM.router.register('budget', {
    title: 'Бюджет',
    stores: ['accounts', 'transactions', 'categories', 'recurring', 'goals', 'rates'],
    render
  });

  // ---------- Форма транзакції ----------
  function accountOptions(selectedId, excludeId) {
    const bal = F().balances();
    return F().rankedAccounts()
      .filter((x) => x.account.id !== excludeId)
      .map((x) => ({ value: x.account.id, label: `${x.account.name} · ${fmt.money(bal.get(x.account.id) || 0, x.account.currency)}`, selected: x.account.id === selectedId }));
  }

  function fillSelect(sel, options, placeholder) {
    sel.replaceChildren();
    if (placeholder) sel.appendChild(h('option', { value: '' }, placeholder));
    options.forEach((o) => sel.appendChild(h('option', { value: o.value, selected: o.selected }, o.label)));
  }

  /** Рахунок за замовчуванням: перший гривневий неощадний, інакше найбільший. */
  function defaultAccount() {
    const ranked = F().rankedAccounts();
    const pick = ranked.find((x) => x.account.currency === 'UAH' && x.account.type !== 'savings') || ranked[0];
    return pick.account.id;
  }

  function lastAccount(type) {
    const m = CRM.store.getSetting('budget.lastAccount', {}) || {};
    const id = m[type] || m.any;
    return id && CRM.finance.account(id) ? id : null;
  }
  function rememberAccount(type, id) {
    const m = Object.assign({}, CRM.store.getSetting('budget.lastAccount', {}) || {});
    m[type] = id;
    m.any = id;
    CRM.store.setSetting('budget.lastAccount', m);
  }

  /**
   * Відкрити форму транзакції.
   * opts: { id } — редагування; або { type, accountId, categoryId, date, amount, comment } — нова.
   */
  function openTxForm(opts) {
    const o = opts || {};
    const existing = o.id ? CRM.store.get('transactions', o.id) : null;
    if (o.id && (!existing || existing.deletedAt)) { ui.toast('Транзакцію не знайдено', { type: 'error' }); return null; }
    const isNew = !existing;

    if (!F().accounts().length) {
      const dlg = ui.modal({
        title: 'Нова транзакція', size: 'sm', center: true,
        body: ui.empty({
          icon: 'bank', small: true, title: 'Спершу додай рахунок',
          text: 'Транзакція завжди привʼязана до рахунку: картки, готівки чи гаманця.',
          action: { label: 'Додати рахунок', icon: 'plus', onClick: () => { dlg.close('force'); CRM.router.go('budget/accounts'); setTimeout(() => CRM.budget.openAccountForm && CRM.budget.openAccountForm(), 50); } }
        })
      });
      return dlg;
    }

    const st = existing ? CRM.utils.deepClone(existing) : {
      type: o.type || 'expense', amount: o.amount || null, accountId: o.accountId || lastAccount(o.type || 'expense') || defaultAccount(),
      toAccountId: null, toAmount: null, categoryId: o.categoryId || null, subcategoryId: null,
      date: o.date || D.today(), comment: o.comment || ''
    };
    let toTouched = !isNew && st.type === 'transfer' && st.toAmount != null && st.toAmount !== st.amount;

    // --- Тип ---
    const typeSeg = h('div', { class: 'segmented tx-type', role: 'radiogroup', 'aria-label': 'Тип операції' });
    function renderType() {
      ui.mount(typeSeg, CRM.dict.txTypes.map((t) => h('button', {
        type: 'button', role: 'radio', class: (st.type === t.id ? 'active ' : '') + 'tx-' + t.id,
        'aria-checked': st.type === t.id ? 'true' : 'false',
        onClick: () => {
          if (st.type === t.id) return;
          st.type = t.id;
          if (t.id !== 'transfer') { const c = st.categoryId && CRM.store.get('categories', st.categoryId); if (!c || c.kind !== t.id) { st.categoryId = null; st.subcategoryId = null; } }
          renderType(); renderAccounts(); renderCats(); renderTo();
        }
      }, t.label)));
    }

    // --- Сума ---
    const amountIn = h('input', {
      class: 'input amount-input', type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '0,00',
      value: st.amount != null ? String(st.amount).replace('.', ',') : '', 'aria-label': 'Сума'
    });
    const curBadge = h('span', { class: 'amount-cur' });
    const fAmount = ui.field({ label: 'Сума', input: h('div', { class: 'amount-wrap' }, amountIn, curBadge), required: true, className: 'span-2' });
    amountIn.addEventListener('input', () => { fAmount.setError(null); if (!toTouched) autoTo(); });

    // --- Рахунки ---
    const accSel = h('select', { class: 'select', 'aria-label': 'Рахунок' });
    const toSel = h('select', { class: 'select', 'aria-label': 'На рахунок' });
    const fAcc = ui.field({ label: 'Рахунок', input: accSel, required: true });
    const fTo = ui.field({ label: 'На рахунок', input: toSel, required: true });
    accSel.addEventListener('change', () => { st.accountId = accSel.value; fAcc.setError(null); renderAccounts(); renderTo(); });
    toSel.addEventListener('change', () => { st.toAccountId = toSel.value || null; fTo.setError(null); renderTo(); });
    function renderAccounts() {
      // «Рахунок» — на всю ширину, або навпіл із «На рахунок» для переказу
      fAcc.classList.toggle('span-2', st.type !== 'transfer');
      fAcc.querySelector('.field-label').firstChild.textContent = st.type === 'transfer' ? 'З рахунку' : 'Рахунок';
      fillSelect(accSel, accountOptions(st.accountId));
      if (!accSel.value && accSel.options.length) st.accountId = accSel.value = accSel.options[0].value;
      curBadge.textContent = CRM.CURRENCIES[F().currencyOf(st.accountId)].symbol;
      fTo.hidden = st.type !== 'transfer';
      if (st.type === 'transfer') {
        if (st.toAccountId === st.accountId) st.toAccountId = null;
        fillSelect(toSel, accountOptions(st.toAccountId, st.accountId), 'Оберіть рахунок');
      }
    }

    // --- Сума зарахування (переказ між різними валютами) ---
    const toAmountIn = h('input', { class: 'input amount-input', type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '0,00', 'aria-label': 'Сума зарахування' });
    const toCur = h('span', { class: 'amount-cur' });
    const toHint = h('div', { class: 'field-hint' });
    const fToAmount = ui.field({ label: 'Сума зарахування', input: h('div', { class: 'amount-wrap' }, toAmountIn, toCur), required: true, className: 'span-2' });
    fToAmount.appendChild(toHint);
    toAmountIn.addEventListener('input', () => { toTouched = true; fToAmount.setError(null); });
    function differentCurrencies() {
      return st.type === 'transfer' && st.toAccountId && F().currencyOf(st.accountId) !== F().currencyOf(st.toAccountId);
    }
    function autoTo() {
      if (!differentCurrencies()) return;
      const amt = CRM.utils.parseAmount(amountIn.value);
      const conv = isNaN(amt) ? null : CRM.rates.convert(amt, F().currencyOf(st.accountId), F().currencyOf(st.toAccountId), dateIn.dateValue || D.today());
      toAmountIn.value = conv == null ? '' : String(CRM.utils.round2(conv)).replace('.', ',');
    }
    function renderTo() {
      const show = differentCurrencies();
      fToAmount.hidden = !show;
      if (!show) return;
      const from = F().currencyOf(st.accountId);
      const to = F().currencyOf(st.toAccountId);
      toCur.textContent = CRM.CURRENCIES[to].symbol;
      fToAmount.querySelector('.field-label').firstChild.textContent = `Сума зарахування, ${to}`;
      const rateOne = CRM.rates.convert(1, from, to, dateIn.dateValue || D.today());
      ui.mount(toHint,
        rateOne == null
          ? 'Курсу НБУ немає — введи суму вручну.'
          : [rateOne >= 1 ? `За курсом НБУ: 1 ${from} ≈ ${fmt.number(rateOne, 4)} ${to}. ` : `За курсом НБУ: 1 ${to} ≈ ${fmt.number(1 / rateOne, 4)} ${from}. `,
            h('button', { type: 'button', class: 'link-like', onClick: () => { toTouched = false; autoTo(); } }, 'Перерахувати')]);
      if (!toTouched) autoTo();
    }

    // --- Категорія й субкатегорія ---
    const catBox = h('div', { class: 'cat-chips' });
    const subBox = h('div', { class: 'cat-chips sub' });
    const fCat = ui.field({ label: 'Категорія', input: h('div', null, catBox, subBox), required: true });
    function renderCats() {
      fCat.hidden = st.type === 'transfer';
      if (st.type === 'transfer') return;
      const cats = F().categories(st.type);
      if (!cats.length) {
        ui.mount(catBox, h('span', { class: 'field-hint' }, 'Немає категорій. Додай їх на вкладці «Категорії».'));
        subBox.replaceChildren();
        return;
      }
      ui.mount(catBox, cats.map((c) => h('button', {
        type: 'button', class: 'cat-chip' + (st.categoryId === c.id ? ' active' : ''), 'aria-pressed': st.categoryId === c.id ? 'true' : 'false',
        onClick: () => { st.categoryId = c.id; st.subcategoryId = null; fCat.setError(null); renderCats(); }
      }, h('span', { class: 'cat-dot', style: { background: CRM.dict.categoryColor(c.color) } }), c.name)));
      const cur = st.categoryId && CRM.store.get('categories', st.categoryId);
      const subs = cur ? cur.subcategories || [] : [];
      if (!subs.length) { subBox.replaceChildren(); return; }
      ui.mount(subBox,
        h('span', { class: 'sub-label' }, 'Субкатегорія:'),
        [{ id: null, name: 'Без субкатегорії' }].concat(subs).map((s) => h('button', {
          type: 'button', class: 'cat-chip small' + (st.subcategoryId === s.id ? ' active' : ''),
          onClick: () => { st.subcategoryId = s.id; renderCats(); }
        }, s.name)));
    }

    // --- Дата й коментар ---
    const dateIn = ui.dateInput({ value: st.date, clearable: false, ariaLabel: 'Дата операції', onChange: () => renderTo() });
    const fDate = ui.field({ label: 'Дата', input: dateIn });
    const commentIn = ui.input({ value: st.comment || '', maxlength: 200, placeholder: 'Напр., продукти на тиждень' });
    const fComment = ui.field({ label: 'Коментар', input: commentIn });

    // --- Збереження ---
    async function submit(e) {
      if (e) e.preventDefault();
      let ok = true;
      const amount = CRM.utils.parseAmount(amountIn.value);
      if (isNaN(amount) || amount <= 0) { fAmount.setError('Вкажи суму більшу за нуль, напр., 250 або 1 200,50'); ok = false; }
      else if (amount > 1e12) { fAmount.setError('Занадто велика сума'); ok = false; }
      if (!st.accountId) { fAcc.setError('Оберіть рахунок'); ok = false; }
      let toAmount = null;
      if (st.type === 'transfer') {
        if (!st.toAccountId) { fTo.setError('Оберіть рахунок зарахування'); ok = false; }
        else if (st.toAccountId === st.accountId) { fTo.setError('Рахунки мають бути різними'); ok = false; }
        if (differentCurrencies()) {
          toAmount = CRM.utils.parseAmount(toAmountIn.value);
          if (isNaN(toAmount) || toAmount <= 0) { fToAmount.setError('Вкажи суму, що надійде на рахунок'); ok = false; }
        }
      } else if (!st.categoryId) { fCat.setError('Оберіть категорію'); ok = false; }
      if (!ok) { const bad = form.querySelector('.has-error input, .has-error select, .has-error button'); if (bad) bad.focus(); return; }

      const rec = Object.assign(existing ? CRM.utils.deepClone(existing) : {}, {
        type: st.type,
        amount: CRM.utils.round2(amount),
        accountId: st.accountId,
        toAccountId: st.type === 'transfer' ? st.toAccountId : null,
        toAmount: st.type === 'transfer' ? CRM.utils.round2(differentCurrencies() ? toAmount : amount) : null,
        categoryId: st.type === 'transfer' ? null : st.categoryId,
        subcategoryId: st.type === 'transfer' ? null : st.subcategoryId,
        date: dateIn.dateValue || D.today(),
        comment: commentIn.value.trim()
      });
      if (!existing) { rec.recurringId = rec.recurringId || null; rec.recurringDate = rec.recurringDate || null; }
      const saved = await CRM.store.save('transactions', rec);
      rememberAccount(st.type, st.accountId);
      dlg.close('force');
      F().ensureRatesFor([saved]);
      ui.toast(isNew ? 'Транзакцію додано' : 'Зміни збережено', {
        type: 'success',
        action: isNew ? { label: 'Відкрити', onClick: () => openTxForm({ id: saved.id }) } : null
      });
      if (o.onSaved) o.onSaved(saved);
    }

    async function remove() {
      const ok = await ui.confirm({
        title: 'Видалити транзакцію?',
        message: 'Вона потрапить у Кошик, а баланс рахунку перерахується. Відновити можна протягом 30 днів.',
        confirmText: 'Видалити', danger: true
      });
      if (!ok) return;
      const batch = await CRM.store.softDelete('transactions', existing.id);
      dlg.close('force');
      ui.toast('Транзакцію перенесено в Кошик', { action: { label: 'Скасувати', onClick: () => CRM.store.restoreBatch(batch) } });
    }

    const form = h('form', { class: 'form-stack tx-form', novalidate: true, onSubmit: submit },
      typeSeg,
      h('div', { class: 'form-grid' },
        fAmount, fAcc, fTo, fToAmount),
      fCat,
      h('div', { class: 'form-grid' }, fDate, fComment),
      h('button', { type: 'submit', hidden: true, tabIndex: -1, 'aria-hidden': 'true' }));

    renderType();
    renderAccounts();
    renderCats();
    renderTo();

    const footer = [
      existing ? ui.button({ label: 'Видалити', icon: 'trash', variant: 'danger-ghost', onClick: remove }) : null,
      h('span', { class: 'grow' }),
      ui.button({ label: 'Скасувати', onClick: () => dlg.close('button') }),
      ui.button({ label: isNew ? 'Додати' : 'Зберегти', variant: 'primary', icon: isNew ? 'plus' : 'check', onClick: () => submit() })
    ];

    const dlg = ui.modal({
      title: isNew ? 'Нова транзакція' : 'Транзакція',
      size: 'md', className: 'tx-modal',
      body: form,
      footer: h('div', { class: 'drawer-footer-inner' }, footer),
      initialFocus: amountIn
    });
    if (existing && existing.recurringId) {
      const r = CRM.store.get('recurring', existing.recurringId);
      if (r) form.prepend(h('div', { class: 'callout' }, CRM.icon('repeat'), h('span', null, 'Оплата регулярного платежу ', h('strong', null, r.name), ` за ${fmt.date(existing.recurringDate)}. Якщо видалити транзакцію, платіж знову стане «до сплати».`)));
    }
    return dlg;
  }

  CRM.budget = { registerTab, openTxForm, rateLine, TAB_ORDER };
})(window.CRM);
