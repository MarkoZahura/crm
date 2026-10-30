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
    ['dashboard', 'Дашборд'], ['accounts', 'Рахунки'], ['transactions', 'Транзакції'], ['categories', 'Категорії'], ['limits', 'Ліміти'],
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
      // Лише вкладки, чиї файли завантажено (неповне оновлення сайту — без «порожньої» вкладки)
      TAB_ORDER.filter(([id]) => tabs.has(id)).map(([id, label]) => h('a', {
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
   * opts: { id } — редагування; або { type, accountId, categoryId, subcategoryId, date, amount, comment } — нова.
   * tutorStudentId — для доходу одразу вибрати учня в полі «Оплата за уроки» (js/tutor-money.js).
   * Витрату чи дохід можна розділити на кілька категорій (поле splits, див. CRM.finance.txParts).
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
      toAccountId: o.toAccountId || null, toAmount: null, categoryId: o.categoryId || null, subcategoryId: (o.categoryId && o.subcategoryId) || null,
      date: o.date || D.today(), comment: o.comment || ''
    };
    let toTouched = !isNew && st.type === 'transfer' && st.toAmount != null && st.toAmount !== st.amount;
    // Розділення на кілька категорій: рядки { catKey: 'id|subId', amount: 'текст' }
    let splitMode = F().isSplit(st);
    let splitRows = splitMode ? st.splits.map((p) => ({ catKey: p.categoryId + '|' + (p.subcategoryId || ''), amount: String(p.amount).replace('.', ',') })) : [];

    // --- Тип ---
    const typeSeg = h('div', { class: 'segmented tx-type', role: 'radiogroup', 'aria-label': 'Тип операції' });
    function renderType() {
      ui.mount(typeSeg, CRM.dict.txTypes.map((t) => h('button', {
        type: 'button', role: 'radio', class: (st.type === t.id ? 'active ' : '') + 'tx-' + t.id,
        'aria-checked': st.type === t.id ? 'true' : 'false',
        onClick: () => {
          if (st.type === t.id) return;
          st.type = t.id;
          if (t.id !== 'transfer') {
            const c = st.categoryId && CRM.store.get('categories', st.categoryId);
            if (!c || c.kind !== t.id) { st.categoryId = null; st.subcategoryId = null; splitMode = false; splitRows = []; }
          }
          renderType(); renderAccounts(); renderCats(); renderTo();
          if (tutorBox) tutorBox.show(st.type);
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
    amountIn.addEventListener('input', () => { fAmount.setError(null); if (!toTouched) autoTo(); if (splitMode) splitStatus(); renderLimitLater(); });
    let limitTimer = null;
    const renderLimitLater = () => { clearTimeout(limitTimer); limitTimer = setTimeout(() => renderLimit(), 120); };

    // --- Рахунки ---
    const accSel = h('select', { class: 'select', 'aria-label': 'Рахунок' });
    const toSel = h('select', { class: 'select', 'aria-label': 'На рахунок' });
    const fAcc = ui.field({ label: 'Рахунок', input: accSel, required: true });
    const fTo = ui.field({ label: 'На рахунок', input: toSel, required: true });
    accSel.addEventListener('change', () => { st.accountId = accSel.value; fAcc.setError(null); renderAccounts(); renderTo(); renderLimit(); });
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
    const splitBox = h('div', { class: 'tx-split' });
    const splitToggle = h('button', {
      type: 'button', class: 'link-like tx-split-toggle',
      onClick: () => startSplit()
    }, CRM.icon('listChecks', { size: 'sm' }), 'Розділити на кілька категорій');
    // Підказка про ліміт (js/budget/limits.js): «Ліміт «Кафе»: лишилось 585 ₴ з 2 000 ₴ → після цієї витрати…»
    const limitBox = h('div', { class: 'tx-limit-box' });
    const fCat = ui.field({ label: 'Категорія', input: h('div', null, catBox, subBox, splitBox, splitToggle, limitBox), required: true });
    function renderLimit() {
      if (!CRM.limits) return;
      if (st.type !== 'expense' || splitMode) { limitBox.replaceChildren(); return; }
      const amt = CRM.utils.parseAmount(amountIn.value);
      let el = null;
      try {
        el = CRM.limits.formHint({
          categoryId: st.categoryId, amount: isNaN(amt) ? null : amt, accountId: st.accountId,
          date: dateIn.dateValue || D.today(), excludeId: existing ? existing.id : null
        });
      } catch (e) { console.error(e); }
      ui.mount(limitBox, el);
    }
    function renderCats() {
      fCat.hidden = st.type === 'transfer';
      renderLimit();
      if (st.type === 'transfer') return;
      fCat.querySelector('.field-label').firstChild.textContent = splitMode ? 'Категорії' : 'Категорія';
      const cats = F().categories(st.type);
      splitToggle.hidden = splitMode || !cats.length;
      if (splitMode) {
        catBox.replaceChildren();
        subBox.replaceChildren();
        renderSplit();
        return;
      }
      splitBox.replaceChildren();
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

    // --- Розділення на кілька категорій (чек із супермаркету) ---
    const MAX_PARTS = 10;
    function catChoices() {
      const out = [];
      F().categories(st.type).forEach((c) => {
        out.push({ value: c.id + '|', label: c.name });
        (c.subcategories || []).forEach((x) => out.push({ value: c.id + '|' + x.id, label: `${c.name} › ${x.name}` }));
      });
      return out;
    }
    function startSplit() {
      splitMode = true;
      splitRows = [{ catKey: st.categoryId ? st.categoryId + '|' + (st.subcategoryId || '') : '', amount: '' }, { catKey: '', amount: '' }];
      fCat.setError(null);
      renderCats();
      const first = splitBox.querySelector(splitRows[0].catKey ? '.tx-split-amt' : '.tx-split-cat');
      if (first) first.focus();
    }
    function stopSplit() {
      const firstCat = splitRows.find((r) => r.catKey);
      if (firstCat) { const [c, sub] = firstCat.catKey.split('|'); st.categoryId = c; st.subcategoryId = sub || null; }
      splitMode = false;
      splitRows = [];
      fCat.setError(null);
      renderCats();
    }
    const splitTotal = () => CRM.utils.parseAmount(amountIn.value);
    const rowAmount = (r) => { const v = CRM.utils.parseAmount(r.amount); return isNaN(v) ? 0 : v; };
    function splitLeft() {
      const total = splitTotal();
      if (isNaN(total)) return null;
      return CRM.utils.round2(total - splitRows.reduce((sum, r) => sum + rowAmount(r), 0));
    }
    let splitStatusEl = null;
    function splitStatus() {
      if (!splitStatusEl) return;
      const left = splitLeft();
      const cur = CRM.CURRENCIES[F().currencyOf(st.accountId)] ? F().currencyOf(st.accountId) : 'UAH';
      splitStatusEl.className = 'tx-split-left';
      if (left == null) ui.mount(splitStatusEl, 'Спершу вкажи суму операції вгорі.');
      else if (left > 0.004) ui.mount(splitStatusEl, 'Залишилось розподілити: ', h('strong', { class: 'num' }, fmt.money(left, cur)));
      else if (left < -0.004) { splitStatusEl.classList.add('over'); ui.mount(splitStatusEl, 'Частини більші за суму на ', h('strong', { class: 'num' }, fmt.money(-left, cur))); }
      else { splitStatusEl.classList.add('done'); ui.mount(splitStatusEl, CRM.icon('check', { size: 'sm' }), 'Усе розподілено'); }
      splitBox.querySelectorAll('.tx-split-rest').forEach((b) => { b.hidden = !(left > 0.004); });
    }
    function renderSplit() {
      const choices = catChoices();
      const rows = splitRows.map((r, i) => {
        const sel = h('select', { class: 'select select-sm tx-split-cat', 'aria-label': `Категорія частини ${i + 1}` },
          h('option', { value: '' }, 'Оберіть категорію'),
          choices.map((c) => h('option', { value: c.value, selected: c.value === r.catKey }, c.label)));
        sel.addEventListener('change', () => { r.catKey = sel.value; fCat.setError(null); });
        const amt = h('input', {
          class: 'input input-sm amount-input tx-split-amt', type: 'text', inputmode: 'decimal', autocomplete: 'off',
          placeholder: '0,00', value: r.amount, 'aria-label': `Сума частини ${i + 1}`
        });
        amt.addEventListener('input', () => { r.amount = amt.value; fCat.setError(null); splitStatus(); });
        const rest = h('button', {
          type: 'button', class: 'btn btn-ghost btn-sm tx-split-rest', title: 'Дописати сюди все, що залишилось',
          onClick: () => {
            const left = splitLeft();
            if (!(left > 0)) return;
            r.amount = String(CRM.utils.round2(rowAmount(r) + left)).replace('.', ',');
            amt.value = r.amount;
            fCat.setError(null);
            splitStatus();
          }
        }, '+ решта');
        const del = h('button', {
          type: 'button', class: 'btn btn-ghost btn-icon btn-sm tx-split-del', 'aria-label': 'Прибрати частину', title: 'Прибрати частину',
          disabled: splitRows.length <= 2,
          onClick: () => { splitRows.splice(i, 1); renderSplit(); }
        }, CRM.icon('x', { size: 'sm' }));
        return h('div', { class: 'tx-split-row', dataset: { i: String(i) } }, sel, h('div', { class: 'amount-wrap tx-split-amt-wrap' }, amt), rest, del);
      });
      splitStatusEl = h('div', { class: 'tx-split-left' });
      ui.mount(splitBox,
        h('div', { class: 'tx-split-rows' }, rows),
        h('div', { class: 'tx-split-foot' },
          h('button', {
            type: 'button', class: 'btn btn-sm tx-split-add', disabled: splitRows.length >= MAX_PARTS,
            onClick: () => { splitRows.push({ catKey: '', amount: '' }); renderSplit(); const s = splitBox.querySelectorAll('.tx-split-cat'); s[s.length - 1].focus(); }
          }, CRM.icon('plus', { size: 'sm' }), 'Частина'),
          splitStatusEl,
          h('span', { class: 'grow' }),
          h('button', { type: 'button', class: 'link-like tx-split-off', onClick: stopSplit }, 'Не розділяти')));
      splitStatus();
    }
    /** Перевірити частини перед збереженням: { splits } або { error }. */
    function collectSplits(amount) {
      const used = splitRows.filter((r) => r.catKey || String(r.amount).trim());
      if (used.some((r) => !r.catKey)) return { error: 'Обери категорію для кожної частини' };
      const empty = used.filter((r) => !String(r.amount).trim());
      const filled = used.filter((r) => String(r.amount).trim());
      if (filled.some((r) => { const v = CRM.utils.parseAmount(r.amount); return isNaN(v) || v <= 0; })) return { error: 'Суми частин мають бути більші за нуль' };
      let parts = filled.map((r) => ({ catKey: r.catKey, amount: CRM.utils.round2(CRM.utils.parseAmount(r.amount)) }));
      const left = CRM.utils.round2(amount - parts.reduce((sum, p) => sum + p.amount, 0));
      if (empty.length === 1 && left > 0) parts.push({ catKey: empty[0].catKey, amount: left });
      else if (empty.length) return { error: 'Вкажи суму кожної частини' };
      if (parts.length < 2) return { error: 'Додай хоча б дві частини або натисни «Не розділяти»' };
      const rest = CRM.utils.round2(amount - parts.reduce((sum, p) => sum + p.amount, 0));
      if (Math.abs(rest) > 0.004) {
        const cur = F().currencyOf(st.accountId);
        return { error: rest > 0 ? `Частини мають дорівнювати сумі операції — залишилось розподілити ${fmt.money(rest, cur)}` : `Частини більші за суму операції на ${fmt.money(-rest, cur)}` };
      }
      return {
        splits: parts.map((p) => { const [c, sub] = p.catKey.split('|'); return { categoryId: c, subcategoryId: sub || null, amount: p.amount }; })
      };
    }

    // --- Оплата за уроки (js/tutor-money.js): дохід можна привʼязати до учня «Репетиторства» ---
    const tutorBox = CRM.tutorMoney && CRM.tutorMoney.txField ? CRM.tutorMoney.txField(existing, {
      studentId: o.tutorStudentId || null,
      onPick: (sid) => {
        if (!sid || st.categoryId || splitMode) return;
        const c = CRM.tutorMoney.findIncomeCategory();
        if (c) { st.categoryId = c.id; st.subcategoryId = null; fCat.setError(null); renderCats(); }
      }
    }) : null;

    // --- Дата й коментар ---
    const dateIn = ui.dateInput({ value: st.date, clearable: false, ariaLabel: 'Дата операції', onChange: () => { renderTo(); renderLimit(); } });
    const fDate = ui.field({ label: 'Дата', input: dateIn });
    const commentIn = ui.input({ value: st.comment || '', maxlength: 200, placeholder: 'Напр., продукти на тиждень' });
    const fComment = ui.field({ label: 'Коментар', input: commentIn });

    // --- Збереження ---
    async function submit(e) {
      if (e) e.preventDefault();
      let ok = true;
      let splitResult = null;
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
      } else if (splitMode) {
        if (!isNaN(amount) && amount > 0) {
          splitResult = collectSplits(CRM.utils.round2(amount));
          if (splitResult.error) { fCat.setError(splitResult.error); ok = false; }
        }
      } else if (!st.categoryId) { fCat.setError('Оберіть категорію'); ok = false; }
      if (!ok) { const bad = form.querySelector('.has-error input, .has-error select, .has-error button'); if (bad) bad.focus(); return; }

      let rec = Object.assign(existing ? CRM.utils.deepClone(existing) : {}, {
        type: st.type,
        amount: CRM.utils.round2(amount),
        accountId: st.accountId,
        toAccountId: st.type === 'transfer' ? st.toAccountId : null,
        toAmount: st.type === 'transfer' ? CRM.utils.round2(differentCurrencies() ? toAmount : amount) : null,
        categoryId: st.type === 'transfer' ? null : st.categoryId,
        subcategoryId: st.type === 'transfer' ? null : st.subcategoryId,
        date: dateIn.dateValue || D.today(),
        comment: commentIn.value.trim(),
        splits: st.type !== 'transfer' && splitMode && splitResult ? splitResult.splits : null
      });
      if (tutorBox) {
        const sid = st.type === 'income' ? tutorBox.value() : null;
        if (sid) rec.tutor = { studentId: sid }; else delete rec.tutor;
      }
      rec = F().normalizeSplits(rec);
      if (!existing) { rec.recurringId = rec.recurringId || null; rec.recurringDate = rec.recurringDate || null; }
      const saved = await CRM.store.save('transactions', rec);
      rememberAccount(st.type, st.accountId);
      dlg.close('force');
      F().ensureRatesFor([saved]);
      const note = limitNote(saved);
      ui.toast((isNew ? 'Транзакцію додано' : 'Зміни збережено') + (note ? ' · ' + note.text : ''), {
        type: note && note.level === 'over' ? 'warning' : 'success', duration: note ? 9000 : null,
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
      tutorBox ? tutorBox.el : null,
      h('div', { class: 'form-grid' }, fDate, fComment),
      h('button', { type: 'submit', hidden: true, tabIndex: -1, 'aria-hidden': 'true' }));

    renderType();
    renderAccounts();
    renderCats();
    renderTo();
    if (tutorBox) tutorBox.show(st.type);

    const footer = [
      existing ? ui.button({ label: 'Видалити', icon: 'trash', variant: 'danger-ghost', onClick: remove }) : null,
      h('span', { class: 'grow' }),
      ui.button({ label: 'Скасувати', onClick: () => dlg.close('button') }),
      ui.button({ label: isNew ? 'Додати' : 'Зберегти', variant: 'primary', icon: isNew ? 'plus' : 'check', onClick: () => submit() })
    ];

    const dlg = ui.modal({
      title: isNew ? 'Нова транзакція' : 'Транзакція',
      // «Повторити сьогодні» — угорі біля назви (у нижньому рядку кнопок на ПК не вміщалося)
      headerActions: existing ? ui.button({
        label: 'Повторити сьогодні', icon: 'repeat', variant: 'ghost', size: 'sm', className: 'tx-repeat',
        title: 'Створити таку саму операцію на сьогодні',
        onClick: () => { dlg.close('force'); repeatTx(existing.id); }
      }) : null,
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

  /** Що з лімітами після витрати (js/budget/limits.js): { text, level } | null. */
  function limitNote(tx) {
    if (!CRM.limits) return null;
    try { return CRM.limits.noteFor(tx); } catch (e) { console.error(e); return null; }
  }

  // ---------- «Повторити сьогодні» ----------
  /**
   * Копія операції на сьогодні одним кліком: та сама сума, рахунок, категорія (частини), коментар.
   * Без привʼязки до регулярного платежу й імпорту. Тост «Змінити · Скасувати».
   */
  async function repeatTx(id, opts) {
    const o = opts || {};
    const src = CRM.store.get('transactions', id);
    if (!src || src.deletedAt) { ui.toast('Транзакцію не знайдено', { type: 'error' }); return null; }
    const date = o.date || D.today();
    const rec = {
      type: src.type, amount: src.amount, accountId: src.accountId,
      toAccountId: src.type === 'transfer' ? src.toAccountId : null,
      toAmount: src.type === 'transfer' ? src.toAmount : null,
      categoryId: src.type === 'transfer' ? null : src.categoryId || null,
      subcategoryId: src.type === 'transfer' ? null : src.subcategoryId || null,
      splits: F().isSplit(src) ? CRM.utils.deepClone(src.splits) : null,
      date, comment: src.comment || '', recurringId: null, recurringDate: null
    };
    if (src.type === 'income' && src.tutor && src.tutor.studentId) rec.tutor = { studentId: src.tutor.studentId };   // оплата уроків того самого учня
    // Переказ між різними валютами — сума зарахування за сьогоднішнім курсом (якщо він є)
    if (rec.type === 'transfer' && rec.toAccountId && F().currencyOf(rec.accountId) !== F().currencyOf(rec.toAccountId)) {
      const conv = CRM.rates.convert(rec.amount, F().currencyOf(rec.accountId), F().currencyOf(rec.toAccountId), date);
      if (conv != null) rec.toAmount = CRM.utils.round2(conv);
    }
    const saved = await CRM.store.save('transactions', rec);
    F().ensureRatesFor([saved]);
    const when = date === D.today() ? 'на сьогодні' : 'на ' + fmt.dateShort(date);
    const note = limitNote(saved);
    ui.toast(`Повторено ${when}: ${F().txTitle(saved)} · ${F().txAmountLabel(saved)}` + (note ? ' · ' + note.text : ''), {
      type: note && note.level === 'over' ? 'warning' : 'success', duration: note ? 9000 : null,
      actions: [
        { label: 'Змінити', onClick: () => openTxForm({ id: saved.id }) },
        { label: 'Скасувати', onClick: () => CRM.store.removeForever('transactions', saved.id) }
      ]
    });
    return saved;
  }

  CRM.budget = { registerTab, openTxForm, repeatTx, rateLine, limitNote, TAB_ORDER };
})(window.CRM);
