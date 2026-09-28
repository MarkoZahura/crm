/* ==========================================================================
   schedule.js — дати, що повторюються (регулярні платежі).
   Регулярний платіж: { startDate, freq: { unit: 'day'|'week'|'month'|'year', every: N },
   count (кількість платежів або null — безстроково), paid: { 'РРРР-ММ-ДД': id транзакції } }
   Щомісячний платіж на 29–31 число в коротшому місяці переноситься на останній день.
   ========================================================================== */
window.CRM = window.CRM || {};

(function (CRM) {
  'use strict';

  const D = () => CRM.date;

  /** n-та дата серії (0 — перша). */
  function nth(r, n) {
    const every = Math.max(1, Number(r.freq && r.freq.every) || 1);
    const unit = (r.freq && r.freq.unit) || 'month';
    const anchor = D().parse(r.startDate).d;
    if (unit === 'day') return D().addDays(r.startDate, n * every);
    if (unit === 'week') return D().addDays(r.startDate, n * every * 7);
    if (unit === 'year') return D().addYears(r.startDate, n * every, anchor);
    return D().addMonths(r.startDate, n * every, anchor);
  }

  /** Приблизний номер повтору біля дати — щоб не перебирати з самого початку. */
  function guessIndex(r, date) {
    const every = Math.max(1, Number(r.freq && r.freq.every) || 1);
    const unit = (r.freq && r.freq.unit) || 'month';
    const days = D().diffDays(r.startDate, date);
    if (days <= 0) return 0;
    const step = unit === 'day' ? every : unit === 'week' ? every * 7 : unit === 'year' ? every * 365.25 : every * 30.44;
    return Math.max(0, Math.floor(days / step) - 2);
  }

  /** Усі дати платежу в проміжку [from, to] (включно). */
  function occurrences(r, from, to) {
    if (!r || !D().isDate(r.startDate) || !D().isDate(from) || !D().isDate(to)) return [];
    const out = [];
    let n = guessIndex(r, from);
    const limit = r.count ? Number(r.count) : Infinity;
    for (let guard = 0; guard < 5000 && n < limit; guard++, n++) {
      const d = nth(r, n);
      if (d > to) break;
      if (d >= from) out.push(d);
    }
    return out;
  }

  /** Наступна дата не раніше за from (або null, якщо серія закінчилась). */
  function nextOn(r, from) {
    const limit = r.count ? Number(r.count) : Infinity;
    let n = guessIndex(r, from);
    for (let guard = 0; guard < 5000 && n < limit; guard++, n++) {
      const d = nth(r, n);
      if (d >= from) return d;
    }
    return null;
  }

  /* Чи сплачено платіж, визначаємо за транзакціями з recurringId + recurringDate.
     Так статус завжди узгоджений: видалили транзакцію — платіж знову «до сплати»,
     відновили з Кошика — знову «сплачено». */
  let paidIndex = null;
  CRM.store.on(['transactions', '*'], () => { paidIndex = null; });
  function buildIndex() {
    paidIndex = new Map();
    CRM.store.list('transactions').forEach((t) => {
      if (t.recurringId && t.recurringDate) paidIndex.set(t.recurringId + '|' + t.recurringDate, t.id);
    });
  }
  /** Чи сплачено (отримано) платіж на цю дату. */
  function isPaid(r, date) {
    if (!paidIndex) buildIndex();
    return paidIndex.has(r.id + '|' + date);
  }
  /** id транзакції, якою сплачено платіж на дату (або null). */
  function paidTx(r, date) {
    if (!paidIndex) buildIndex();
    return paidIndex.get(r.id + '|' + date) || null;
  }

  /** Остання дата серії (для обмеженої кількості) або null. */
  function lastDate(r) { return r.count ? nth(r, Number(r.count) - 1) : null; }

  CRM.schedule = { nth, occurrences, nextOn, isPaid, paidTx, lastDate };
})(window.CRM);
