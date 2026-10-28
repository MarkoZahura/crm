/* ==========================================================================
   finance.js — фінансові розрахунки для Бюджету й Головної.
   • Баланс рахунку = початковий баланс + доходи − витрати ± перекази.
     Нічого не зберігається — щоразу рахується з транзакцій, тому завжди точно.
   • Суми в іноземній валюті перераховуються в гривню за курсом НБУ:
     операції — на дату операції, поточні баланси — за сьогоднішнім курсом.
   ========================================================================== */
window.CRM = window.CRM || {};

(function (CRM) {
  'use strict';

  const D = CRM.date;
  const S = () => CRM.store;

  // ---------- Рахунки ----------
  function accounts() { return S().list('accounts'); }
  function account(id) { return S().get('accounts', id); }
  function currencyOf(accountId) { const a = account(accountId); return a ? a.currency : 'UAH'; }

  /** Баланси всіх рахунків (у валюті рахунку). upTo — дата включно (необов'язково). */
  function balances(upTo) {
    const map = new Map();
    accounts().forEach((a) => map.set(a.id, Number(a.initialBalance) || 0));
    S().list('transactions').forEach((t) => {
      if (upTo && t.date > upTo) return;
      const amt = Number(t.amount) || 0;
      if (t.type === 'income') { if (map.has(t.accountId)) map.set(t.accountId, map.get(t.accountId) + amt); }
      else if (t.type === 'expense') { if (map.has(t.accountId)) map.set(t.accountId, map.get(t.accountId) - amt); }
      else if (t.type === 'transfer') {
        if (map.has(t.accountId)) map.set(t.accountId, map.get(t.accountId) - amt);
        const inc = t.toAmount != null ? Number(t.toAmount) : amt;
        if (map.has(t.toAccountId)) map.set(t.toAccountId, map.get(t.toAccountId) + inc);
      }
    });
    map.forEach((v, k) => map.set(k, CRM.utils.round2(v)));
    return map;
  }
  function balance(accountId, upTo) { return balances(upTo).get(accountId) || 0; }

  /** Рахунки з балансом і гривневим еквівалентом (за сьогоднішнім курсом), від більшого до меншого. */
  function rankedAccounts() {
    const bal = balances();
    return accounts().map((a) => {
      const b = bal.get(a.id) || 0;
      const uah = CRM.rates.toUAH(b, a.currency);
      return { account: a, balance: b, uah };
    }).sort((x, y) => (y.uah == null ? -Infinity : y.uah) - (x.uah == null ? -Infinity : x.uah) || x.account.name.localeCompare(y.account.name, 'uk'));
  }

  /** Загальний капітал у гривнях + структура за валютами. */
  function capital() {
    const list = rankedAccounts();
    const byCurrency = {};
    CRM.dict.currencies.forEach((c) => { byCurrency[c] = { amount: 0, uah: 0 }; });
    let total = 0;
    let missing = false;
    list.forEach((x) => {
      const bc = byCurrency[x.account.currency] || (byCurrency[x.account.currency] = { amount: 0, uah: 0 });
      bc.amount += x.balance;
      if (x.uah == null) { missing = true; return; }
      bc.uah += x.uah;
      total += x.uah;
    });
    return { total: CRM.utils.round2(total), byCurrency, missing, accounts: list };
  }

  /** Відкладені кошти — сума ощадних рахунків у гривнях. */
  function savings() {
    const list = rankedAccounts().filter((x) => x.account.type === 'savings');
    let total = 0;
    let missing = false;
    list.forEach((x) => { if (x.uah == null) missing = true; else total += x.uah; });
    return { total: CRM.utils.round2(total), count: list.length, missing };
  }

  // ---------- Капітал у часі ----------
  /** Дата, з якої рахунок враховується: створення або перша операція (що раніше). */
  function accountStarts() {
    const starts = new Map();
    accounts().forEach((a) => starts.set(a.id, a.createdAt ? D.toKyivDate(a.createdAt) : D.today()));
    S().list('transactions').forEach((t) => {
      [t.accountId, t.toAccountId].forEach((id) => {
        if (id && starts.has(id) && t.date < starts.get(id)) starts.set(id, t.date);
      });
    });
    return starts;
  }

  /** Найраніша дата історії (початок першого рахунку) або null. */
  function historyStart() {
    let min = null;
    accountStarts().forEach((d) => { if (!min || d < min) min = d; });
    return min;
  }

  /**
   * Капітал у гривнях на кожну з дат (дати — за зростанням).
   * Баланси рахуються на кінець дня, валюта — за курсом НБУ на цю дату (або найближчим відомим).
   */
  function capitalSeries(dates) {
    const accs = accounts();
    const starts = accountStarts();
    const bal = new Map(accs.map((a) => [a.id, Number(a.initialBalance) || 0]));
    const txs = S().list('transactions').slice().sort((a, b) => a.date.localeCompare(b.date));
    let i = 0;
    return dates.map((d) => {
      while (i < txs.length && txs[i].date <= d) {
        const t = txs[i++];
        const amt = Number(t.amount) || 0;
        if (t.type === 'income' && bal.has(t.accountId)) bal.set(t.accountId, bal.get(t.accountId) + amt);
        else if (t.type === 'expense' && bal.has(t.accountId)) bal.set(t.accountId, bal.get(t.accountId) - amt);
        else if (t.type === 'transfer') {
          if (bal.has(t.accountId)) bal.set(t.accountId, bal.get(t.accountId) - amt);
          if (bal.has(t.toAccountId)) bal.set(t.toAccountId, bal.get(t.toAccountId) + (t.toAmount != null ? Number(t.toAmount) : amt));
        }
      }
      let total = 0;
      let missing = false;
      let active = 0;
      accs.forEach((a) => {
        if (starts.get(a.id) > d) return;
        active++;
        const uah = CRM.rates.toUAH(bal.get(a.id), a.currency, d);
        if (uah == null) missing = true; else total += uah;
      });
      return { date: d, total: CRM.utils.round2(total), missing, active };
    });
  }

  function capitalAt(date) { return capitalSeries([date])[0]; }

  // ---------- Транзакції ----------
  function txCurrency(t) { return currencyOf(t.accountId); }

  /** Сума операції в гривнях за курсом на її дату (null, якщо курсу немає). */
  function txUAH(t) { return CRM.rates.toUAH(t.amount, txCurrency(t), t.date); }

  /** Транзакції за період [from, to] (будь-яка межа може бути null). */
  function txInRange(from, to) {
    return S().list('transactions').filter((t) => (!from || t.date >= from) && (!to || t.date <= to));
  }

  /**
   * Доходи й витрати за період у гривнях (перекази не враховуються).
   * categoryId — лише частина операцій цієї категорії (для розділених — частка частин).
   */
  function totals(list, categoryId) {
    let income = 0;
    let expense = 0;
    let missing = 0;
    list.forEach((t) => {
      if (t.type === 'transfer') return;
      let uah = txUAH(t);
      if (uah == null) { missing++; return; }
      if (categoryId) uah *= categoryShare(t, categoryId);
      if (t.type === 'income') income += uah; else expense += uah;
    });
    return { income: CRM.utils.round2(income), expense: CRM.utils.round2(expense), result: CRM.utils.round2(income - expense), missing };
  }

  /** Сума операції в довільній валюті (за курсом на дату операції). */
  function txIn(t, currency) { return CRM.rates.convert(t.amount, txCurrency(t), currency || 'UAH', t.date); }

  /** Доходи й витрати у вибраній валюті (перекази не враховуються). */
  function totalsIn(list, currency) {
    let income = 0;
    let expense = 0;
    let missing = 0;
    list.forEach((t) => {
      if (t.type === 'transfer') return;
      const v = txIn(t, currency);
      if (v == null) { missing++; return; }
      if (t.type === 'income') income += v; else expense += v;
    });
    return { income: CRM.utils.round2(income), expense: CRM.utils.round2(expense), result: CRM.utils.round2(income - expense), missing };
  }

  /** Суми за категоріями у вибраній валюті (розділена операція — кожна частина у своїй категорії). */
  function byCategoryIn(list, kind, currency) {
    return groupByCategory(list, kind, (t) => txIn(t, currency));
  }

  /** Суми за категоріями (у гривнях), від більшої до меншої. kind: 'expense' | 'income'. */
  function byCategory(list, kind) {
    return groupByCategory(list, kind, txUAH);
  }

  function groupByCategory(list, kind, valueOf) {
    const map = new Map();
    list.forEach((t) => {
      if (t.type !== kind) return;
      const v = valueOf(t);
      if (v == null) return;
      const total = Number(t.amount) || 0;
      // Кожна категорія операції рахується один раз (дві частини однієї категорії — разом)
      const seen = new Set();
      txParts(t).forEach((p) => {
        const share = total ? p.amount / total : 1;
        const key = p.categoryId || '—';
        const cur = map.get(key) || { categoryId: p.categoryId || null, amount: 0, count: 0 };
        cur.amount += v * share;
        if (!seen.has(key)) { cur.count++; seen.add(key); }
        map.set(key, cur);
      });
    });
    return Array.from(map.values())
      .map((x) => Object.assign(x, { amount: CRM.utils.round2(x.amount), category: x.categoryId ? S().get('categories', x.categoryId) : null }))
      .sort((a, b) => b.amount - a.amount);
  }

  // ---------- Розділені операції (чек на кілька категорій) ----------
  /** Чи розділена операція на кілька категорій. */
  function isSplit(t) {
    return !!t && t.type !== 'transfer' && Array.isArray(t.splits) && t.splits.length > 1;
  }
  /** Частини операції [{ categoryId, subcategoryId, amount }] (звичайна — одна частина на всю суму). */
  function txParts(t) {
    if (isSplit(t)) {
      return t.splits.map((p) => ({ categoryId: p.categoryId || null, subcategoryId: p.subcategoryId || null, amount: Number(p.amount) || 0 }));
    }
    return [{ categoryId: t.categoryId || null, subcategoryId: t.subcategoryId || null, amount: Number(t.amount) || 0 }];
  }
  /** Чи є в операції категорія (у будь-якій частині). */
  function hasCategory(t, id) {
    if (!id || t.type === 'transfer') return false;
    return txParts(t).some((p) => p.categoryId === id);
  }
  /** Частка суми операції, що припадає на категорію (0…1). */
  function categoryShare(t, id) {
    const total = Number(t.amount) || 0;
    if (!isSplit(t)) return t.categoryId === id ? 1 : 0;
    if (!total) return 0;
    return txParts(t).filter((p) => p.categoryId === id).reduce((s, p) => s + p.amount, 0) / total;
  }
  /** Сума частин операції в категорії (у валюті рахунку). */
  function categoryAmount(t, id) {
    return CRM.utils.round2(txParts(t).filter((p) => p.categoryId === id).reduce((s, p) => s + p.amount, 0));
  }
  /** Назва для списку: «Продукти + Побут» (розділена), «Кафе › Кава», «Переказ». */
  function txTitle(t) {
    if (t.type === 'transfer') return 'Переказ';
    if (!isSplit(t)) return categoryName(t.categoryId, t.subcategoryId);
    const names = [];
    txParts(t).forEach((p) => { const n = categoryName(p.categoryId); if (!names.includes(n)) names.push(n); });
    return names.length > 3 ? `${names.slice(0, 3).join(' + ')} + ще ${names.length - 3}` : names.join(' + ');
  }
  /** Кольори категорій операції (без повторів). */
  function txColors(t) {
    const out = [];
    txParts(t).forEach((p) => { const c = categoryColor(p.categoryId); if (!out.includes(c)) out.push(c); });
    return out;
  }
  /**
   * Привести частини до ладу: прибрати порожні, обʼєднати однакові категорії (+ субкатегорії),
   * 1 частина → звичайна операція. categoryId / subcategoryId — найбільшої частини
   * (так розділену операцію бачать і старі версії CRM). Повертає новий запис.
   */
  function normalizeSplits(rec) {
    const r = Object.assign({}, rec);
    if (r.type === 'transfer' || !Array.isArray(r.splits)) { r.splits = null; return r; }
    const merged = [];
    r.splits.forEach((p) => {
      const amount = CRM.utils.round2(Number(p.amount) || 0);
      if (!p.categoryId || amount <= 0) return;
      const same = merged.find((m) => m.categoryId === p.categoryId && (m.subcategoryId || null) === (p.subcategoryId || null));
      if (same) same.amount = CRM.utils.round2(same.amount + amount);
      else merged.push({ categoryId: p.categoryId, subcategoryId: p.subcategoryId || null, amount });
    });
    if (merged.length < 2) {
      if (merged.length === 1) { r.categoryId = merged[0].categoryId; r.subcategoryId = merged[0].subcategoryId; }
      r.splits = null;
      return r;
    }
    const main = merged.reduce((a, b) => (b.amount > a.amount ? b : a));
    r.splits = merged;
    r.categoryId = main.categoryId;
    r.subcategoryId = main.subcategoryId;
    return r;
  }

  /** Підвантажити курси НБУ на дати операцій в іноземній валюті (у фоні). */
  function ensureRatesFor(list) {
    const dates = [];
    list.forEach((t) => {
      if (txCurrency(t) !== 'UAH' || (t.toAccountId && currencyOf(t.toAccountId) !== 'UAH')) dates.push(t.date);
    });
    if (dates.length) CRM.rates.ensureDates(dates).catch(() => {});
  }

  // ---------- Періоди ----------
  function monthRange(date) {
    const d = date || D.today();
    return [D.startOfMonth(d), D.endOfMonth(d)];
  }

  // ---------- Категорії ----------
  function categoryName(id, subId) {
    const c = id ? S().get('categories', id) : null;
    if (!c) return 'Без категорії';
    const sub = subId ? (c.subcategories || []).find((s) => s.id === subId) : null;
    return sub ? `${c.name} › ${sub.name}` : c.name;
  }
  function categoryColor(id) {
    const c = id ? S().get('categories', id) : null;
    return CRM.dict.categoryColor(c ? c.color : 'slate');
  }
  function categories(kind) {
    return S().list('categories').filter((c) => !kind || c.kind === kind)
      .sort((a, b) => (a.order || 0) - (b.order || 0) || a.name.localeCompare(b.name, 'uk'));
  }

  /** Підпис суми операції зі знаком у валюті рахунку. */
  function txAmountLabel(t) {
    const cur = txCurrency(t);
    if (t.type === 'expense') return CRM.fmt.money(-t.amount, cur);
    if (t.type === 'income') return CRM.fmt.money(t.amount, cur, { sign: true });
    return CRM.fmt.money(t.amount, cur);
  }

  CRM.finance = {
    accounts, account, currencyOf, balances, balance, rankedAccounts, capital, savings,
    txCurrency, txUAH, txIn, txInRange, totals, totalsIn, byCategory, byCategoryIn, ensureRatesFor, monthRange,
    accountStarts, historyStart, capitalSeries, capitalAt,
    categoryName, categoryColor, categories, txAmountLabel,
    isSplit, txParts, hasCategory, categoryShare, categoryAmount, txTitle, txColors, normalizeSplits
  };
})(window.CRM);
