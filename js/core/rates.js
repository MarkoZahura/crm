/* ==========================================================================
   rates.js — офіційні курси НБУ (USD і EUR до гривні).
   • Сьогоднішній курс завантажується раз на добу й зберігається в базі.
   • Якщо запит не вдався — використовується останній збережений курс
     (у розділах показується його дата).
   • Для історичних сум береться курс на відповідну дату (якщо доступний).
   Джерело: https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange?date=РРРРММДД&json
   Важливо: запит без дати повертає курс, який НБУ вже встановив НАПЕРЕД
   (напр., у суботу — на понеділок), тому ми завжди передаємо дату явно.
   ========================================================================== */
window.CRM = window.CRM || {};

(function (CRM) {
  'use strict';

  const API = 'https://bank.gov.ua/NBUStatService/v1/statdirectory/exchange';
  const CODES = ['USD', 'EUR'];
  const MAX_PARALLEL = 4;
  const RETRY_AFTER = 10 * 60 * 1000; // невдалу дату пробуємо знову не раніше ніж за 10 хв
  const inflight = new Map();
  const failed = new Map(); // дата → час невдалої спроби
  let lastError = null;

  /** '26.09.2026' → '2026-09-26' */
  function parseNbuDate(s) {
    const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(String(s || ''));
    return m ? `${m[3]}-${m[2]}-${m[1]}` : null;
  }

  /** Завантажити курс на дату з НБУ і зберегти в кеш (opts.save === false — лише повернути). */
  function fetchDate(date, opts) {
    const save = !opts || opts.save !== false;
    if (inflight.has(date)) return inflight.get(date);
    const p = (async () => {
      const url = `${API}?date=${date.replace(/-/g, '')}&json`;
      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) throw new Error('НБУ відповів помилкою ' + res.status);
      const arr = await res.json();
      const rec = { date, fetchedAt: new Date().toISOString(), rateDate: null };
      CODES.forEach((code) => {
        const row = Array.isArray(arr) ? arr.find((x) => x.cc === code) : null;
        if (row) {
          rec[code] = Number(row.rate);
          rec.rateDate = rec.rateDate || parseNbuDate(row.exchangedate);
        }
      });
      if (!CODES.every((c) => typeof rec[c] === 'number' && rec[c] > 0)) {
        throw new Error('НБУ ще не опублікував курс на ' + CRM.fmt.date(date));
      }
      if (save) await CRM.store.saveRate(rec);
      lastError = null;
      failed.delete(date);
      return rec;
    })();
    inflight.set(date, p);
    p.catch((e) => { lastError = e; failed.set(date, Date.now()); }).finally(() => inflight.delete(date));
    return p;
  }

  function recentlyFailed(date) {
    const t = failed.get(date);
    return t != null && Date.now() - t < RETRY_AFTER;
  }

  /** Переконатися, що є курс на сьогодні (раз на добу). Повертає курс або null. */
  async function ensureToday(force) {
    const t = CRM.date.today();
    const cached = CRM.store.getRate(t);
    if (cached) return cached;
    if (!force && recentlyFailed(t)) return null;
    try {
      return await fetchDate(t);
    } catch (e) {
      return null;
    }
  }

  /** Довантажити курси на кілька дат (для історичних графіків), не більше 4 запитів одночасно. */
  async function ensureDates(dates) {
    const today = CRM.date.today();
    const missing = Array.from(new Set(dates))
      .filter((d) => CRM.date.isDate(d) && d <= today && !CRM.store.getRate(d) && !inflight.has(d) && !recentlyFailed(d));
    if (!missing.length) return 0;
    const got = [];
    let i = 0;
    async function worker() {
      while (i < missing.length) {
        const d = missing[i++];
        try { got.push(await fetchDate(d, { save: false })); } catch (e) { /* пропускаємо — використаємо найближчий курс */ }
      }
    }
    await Promise.all(Array.from({ length: Math.min(MAX_PARALLEL, missing.length) }, worker));
    await CRM.store.saveRates(got);
    return got.length;
  }

  function sortedRates() {
    return CRM.store.allRates().filter((r) => r.USD && r.EUR).sort((a, b) => a.date.localeCompare(b.date));
  }

  /** Курс на дату: точний, інакше найближчий попередній, інакше найближчий наступний. */
  function rateFor(date) {
    const exact = CRM.store.getRate(date);
    if (exact && exact.USD && exact.EUR) return exact;
    const list = sortedRates();
    if (!list.length) return null;
    let best = null;
    for (const r of list) {
      if (r.date <= date) best = r; else break;
    }
    return best || list[0];
  }

  /** Поточний курс: на сьогодні або останній збережений. */
  function current() { return rateFor(CRM.date.today()); }

  /** Чи курс «свіжий» (на сьогодні). */
  function isFresh() {
    const r = current();
    return !!r && r.date === CRM.date.today();
  }

  /** Сума в гривнях. date — дата операції (за замовчуванням — сьогодні). null, якщо курсу немає. */
  function toUAH(amount, currency, date) {
    if (!currency || currency === 'UAH') return Number(amount) || 0;
    const r = date ? rateFor(date) : current();
    if (!r || !r[currency]) return null;
    return (Number(amount) || 0) * r[currency];
  }

  /** Конвертація між валютами через гривню. null, якщо курсу немає. */
  function convert(amount, from, to, date) {
    if (from === to) return Number(amount) || 0;
    const uah = toUAH(amount, from, date);
    if (uah == null) return null;
    if (to === 'UAH') return uah;
    const r = date ? rateFor(date) : current();
    if (!r || !r[to]) return null;
    return uah / r[to];
  }

  /** Підпис для інтерфейсу: 'Курс НБУ на 26 вересня 2026: $ 41,32 ₴ · € 48,10 ₴' */
  function describe() {
    const r = current();
    if (!r) return 'Курс НБУ ще не завантажено';
    return `Курс НБУ на ${CRM.fmt.date(r.rateDate || r.date)}: $1 = ${CRM.fmt.money(r.USD, 'UAH', { decimals: 4 })} · €1 = ${CRM.fmt.money(r.EUR, 'UAH', { decimals: 4 })}`;
  }

  function init() {
    ensureToday();
    document.addEventListener('crm:daychange', () => ensureToday());
  }

  CRM.rates = {
    API, init, fetchDate, ensureToday, ensureDates, rateFor, current, isFresh, toUAH, convert, describe,
    get lastError() { return lastError; }
  };
})(window.CRM);
