/* ==========================================================================
   utils.js — допоміжні функції: дати за Києвом, формати дат і сум,
   ідентифікатори, валідація, робота з файлами.
   Усі дати зберігаються рядком 'РРРР-ММ-ДД' (календарна дата за Києвом).
   ========================================================================== */
window.CRM = window.CRM || {};

(function (CRM) {
  'use strict';

  // ---------- Часовий пояс ----------
  // Нова назва поясу — Europe/Kyiv; старі браузери знають лише Europe/Kiev.
  const TZ = (function () {
    try {
      new Intl.DateTimeFormat('en', { timeZone: 'Europe/Kyiv' });
      return 'Europe/Kyiv';
    } catch (e) {
      return 'Europe/Kiev';
    }
  })();

  const MONTHS_GEN = ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня',
    'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'];
  const MONTHS_NOM = ['Січень', 'Лютий', 'Березень', 'Квітень', 'Травень', 'Червень',
    'Липень', 'Серпень', 'Вересень', 'Жовтень', 'Листопад', 'Грудень'];
  const MONTHS_SHORT = ['січ', 'лют', 'бер', 'квіт', 'трав', 'черв',
    'лип', 'серп', 'вер', 'жовт', 'лист', 'груд'];
  const WEEKDAYS = ['понеділок', 'вівторок', 'середа', 'четвер', 'пʼятниця', 'субота', 'неділя'];
  const WEEKDAYS_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Нд'];

  const pad = (n) => String(n).padStart(2, '0');

  const partsFormatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
  });

  /** Частини дати й часу за Києвом для заданого моменту. */
  function kyivParts(moment) {
    const p = {};
    partsFormatter.formatToParts(moment || new Date()).forEach((x) => { p[x.type] = x.value; });
    return { y: +p.year, m: +p.month, d: +p.day, hh: +p.hour % 24, mm: +p.minute, ss: +p.second };
  }

  /** Сьогоднішня дата за Києвом: '2026-09-26'. */
  function today() {
    const p = kyivParts();
    return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
  }

  /** Поточний час за Києвом: '14:05'. */
  function nowTime() {
    const p = kyivParts();
    return `${pad(p.hh)}:${pad(p.mm)}`;
  }

  /** Дата за Києвом для довільного моменту (Date або ISO-рядок). */
  function toKyivDate(moment) {
    const p = kyivParts(moment instanceof Date ? moment : new Date(moment));
    return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
  }

  // ---------- Арифметика дат (на рядках 'РРРР-ММ-ДД', без часових поясів) ----------
  function parse(s) {
    const [y, m, d] = String(s).split('-').map(Number);
    return { y, m, d };
  }
  function isDate(s) {
    if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const { y, m, d } = parse(s);
    return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
  }
  function toUTC(s) {
    const { y, m, d } = parse(s);
    return Date.UTC(y, m - 1, d);
  }
  function fromUTC(ms) {
    const dt = new Date(ms);
    return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
  }
  function make(y, m, d) { return `${y}-${pad(m)}-${pad(d)}`; }
  function daysInMonth(y, m) { return new Date(Date.UTC(y, m, 0)).getUTCDate(); }
  function addDays(s, n) { return fromUTC(toUTC(s) + n * 86400000); }
  /** Додати місяці; якщо дня немає в новому місяці — останній день місяця. */
  function addMonths(s, n, anchorDay) {
    const { y, m, d } = parse(s);
    const total = y * 12 + (m - 1) + n;
    const ny = Math.floor(total / 12);
    const nm = total - ny * 12 + 1;
    return make(ny, nm, Math.min(anchorDay || d, daysInMonth(ny, nm)));
  }
  function addYears(s, n, anchorDay) { return addMonths(s, n * 12, anchorDay); }
  /** Кількість днів від a до b (b − a). */
  function diffDays(a, b) { return Math.round((toUTC(b) - toUTC(a)) / 86400000); }
  /** День тижня: 0 — понеділок … 6 — неділя. */
  function weekday(s) { return (new Date(toUTC(s)).getUTCDay() + 6) % 7; }
  function startOfWeek(s) { return addDays(s, -weekday(s)); }
  function endOfWeek(s) { return addDays(startOfWeek(s), 6); }
  function startOfMonth(s) { return s.slice(0, 8) + '01'; }
  function endOfMonth(s) { const { y, m } = parse(s); return make(y, m, daysInMonth(y, m)); }
  function monthKey(s) { return s.slice(0, 7); }
  function compare(a, b) { return a < b ? -1 : a > b ? 1 : 0; }

  // ---------- Формати дат ----------
  /** '2026-09-26' → '26 вересня 2026' */
  function formatDate(s) {
    if (!isDate(s)) return '';
    const { y, m, d } = parse(s);
    return `${d} ${MONTHS_GEN[m - 1]} ${y}`;
  }
  /** Коротко: '26 вересня' (рік — лише якщо не поточний). */
  function formatDateShort(s) {
    if (!isDate(s)) return '';
    const { y, m, d } = parse(s);
    const cy = parse(today()).y;
    return y === cy ? `${d} ${MONTHS_GEN[m - 1]}` : `${d} ${MONTHS_GEN[m - 1]} ${y}`;
  }
  /** 'Сьогодні' / 'Завтра' / 'Вчора' або коротка дата. */
  function formatRelativeDay(s) {
    const diff = diffDays(today(), s);
    if (diff === 0) return 'Сьогодні';
    if (diff === 1) return 'Завтра';
    if (diff === -1) return 'Вчора';
    return formatDateShort(s);
  }
  /** 'Вересень 2026' */
  function formatMonth(key) {
    const { y, m } = parse(key.length === 7 ? key + '-01' : key);
    return `${MONTHS_NOM[m - 1]} ${y}`;
  }
  /** Повна дата з днем тижня: 'субота, 26 вересня 2026' */
  function formatDateLong(s) {
    return `${WEEKDAYS[weekday(s)]}, ${formatDate(s)}`;
  }
  /** Момент (ISO) → '26 вересня 2026, 14:05' за Києвом */
  function formatDateTime(iso) {
    if (!iso) return '';
    const p = kyivParts(new Date(iso));
    return `${formatDate(make(p.y, p.m, p.d))}, ${pad(p.hh)}:${pad(p.mm)}`;
  }
  /** 'щойно', '5 хв тому', '2 год тому', 'вчора о 14:05', '26 вересня' */
  function timeAgo(iso) {
    const t = new Date(iso).getTime();
    const sec = Math.max(0, Math.round((Date.now() - t) / 1000));
    if (sec < 60) return 'щойно';
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min} хв тому`;
    const p = kyivParts(new Date(iso));
    const day = make(p.y, p.m, p.d);
    const hrs = Math.floor(min / 60);
    if (day === today() && hrs < 24) return `${hrs} год тому`;
    if (diffDays(day, today()) === 1) return `вчора о ${pad(p.hh)}:${pad(p.mm)}`;
    return formatDateShort(day);
  }

  // ---------- Числа й гроші ----------
  const NBSP = ' ';
  const CURRENCIES = {
    UAH: { code: 'UAH', symbol: '₴', name: 'Гривня' },
    USD: { code: 'USD', symbol: '$', name: 'Долар США' },
    EUR: { code: 'EUR', symbol: '€', name: 'Євро' }
  };

  function round2(n) { return Math.round((Number(n) + Number.EPSILON) * 100) / 100; }

  /** 12345.678 → '12 345,68' (пробіл — нерозривний). */
  function formatNumber(n, decimals) {
    const dec = decimals == null ? 2 : decimals;
    const factor = Math.pow(10, dec);
    const rounded = Math.round((Math.abs(Number(n) || 0) + Number.EPSILON) * factor) / factor;
    const [int, frac] = rounded.toFixed(dec).split('.');
    const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
    const neg = Number(n) < 0 && rounded !== 0;
    return (neg ? '−' : '') + grouped + (frac ? ',' + frac : '');
  }

  /**
   * Сума з валютою: '12 345,67 ₴', '$1 200,00', '€950,00'.
   * opts.sign — показувати '+' для додатних; opts.decimals — кількість знаків.
   */
  function formatMoney(amount, currency, opts) {
    const o = opts || {};
    const cur = currency || 'UAH';
    const value = Number(amount) || 0;
    const body = formatNumber(Math.abs(value), o.decimals == null ? 2 : o.decimals);
    const isZero = body.replace(/[^1-9]/g, '') === '';
    let s;
    if (cur === 'UAH') s = body + NBSP + '₴';
    else if (cur === 'USD') s = '$' + body;
    else if (cur === 'EUR') s = '€' + body;
    else s = body + NBSP + cur;
    if (value < 0 && !isZero) return '−' + s;
    if (o.sign && value > 0 && !isZero) return '+' + s;
    return s;
  }

  /** Розбір суми, введеної людиною: '1 200,50' / '1200.5' → 1200.5; інакше NaN. */
  function parseAmount(str) {
    if (typeof str === 'number') return str;
    const clean = String(str || '').replace(/[\s  ₴$€]/g, '').replace(',', '.');
    if (!/^-?\d+(\.\d+)?$/.test(clean)) return NaN;
    return Number(clean);
  }

  function formatPercent(n, decimals) {
    return formatNumber(n, decimals == null ? 1 : decimals).replace(/,0$/, '') + NBSP + '%';
  }

  /** Розмір файлу: '1,2 МБ' */
  function formatBytes(bytes) {
    const b = Number(bytes) || 0;
    if (b < 1024) return `${b}${NBSP}Б`;
    if (b < 1024 * 1024) return `${formatNumber(b / 1024, 1).replace(/,0$/, '')}${NBSP}КБ`;
    return `${formatNumber(b / (1024 * 1024), 1).replace(/,0$/, '')}${NBSP}МБ`;
  }

  /** Відмінювання: plural(5, ['задача', 'задачі', 'задач']) → 'задач' */
  function plural(n, forms) {
    const a = Math.abs(n) % 100;
    const b = a % 10;
    if (a > 10 && a < 20) return forms[2];
    if (b > 1 && b < 5) return forms[1];
    if (b === 1) return forms[0];
    return forms[2];
  }
  function countLabel(n, forms) { return `${n} ${plural(n, forms)}`; }

  // ---------- Рядки ----------
  /** Нормалізація для пошуку: нижній регістр, єдиний апостроф, без зайвих пробілів. */
  function normalize(s) {
    return String(s == null ? '' : s)
      .toLowerCase()
      .replace(/[’ʼ`´‘]/g, "'")
      .replace(/ё/g, 'е')
      .replace(/[\s  ]+/g, ' ')
      .trim();
  }
  function escapeRegExp(s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

  /** Ініціали з імені: 'Марія Коваленко' → 'МК' */
  function initials(name) {
    const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
    if (!parts.length) return '';
    const first = parts[0][0] || '';
    const second = parts.length > 1 ? parts[parts.length - 1][0] : (parts[0][1] || '');
    return (first + (parts.length > 1 ? second : '')).toUpperCase();
  }

  function isValidEmail(s) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(String(s).trim());
  }
  /** Телефон: цифри, пробіли, дужки, дефіси, '+' на початку; 10–15 цифр. */
  function isValidPhone(s) {
    const str = String(s).trim();
    if (!/^\+?[\d\s()\-]+$/.test(str)) return false;
    const digits = str.replace(/\D/g, '');
    return digits.length >= 10 && digits.length <= 15;
  }

  // ---------- Ідентифікатори й дрібниці ----------
  function uid() {
    if (window.crypto && typeof window.crypto.randomUUID === 'function') {
      return window.crypto.randomUUID();
    }
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function debounce(fn, ms) {
    let t = null;
    return function (...args) {
      clearTimeout(t);
      t = setTimeout(() => fn.apply(this, args), ms);
    };
  }

  function clamp(n, min, max) { return Math.min(max, Math.max(min, n)); }

  function sum(arr, fn) { return arr.reduce((acc, x) => acc + (fn ? fn(x) : x), 0); }

  function groupBy(arr, fn) {
    const map = new Map();
    arr.forEach((x) => {
      const k = fn(x);
      if (!map.has(k)) map.set(k, []);
      map.get(k).push(x);
    });
    return map;
  }

  function deepClone(obj) {
    return obj == null ? obj : JSON.parse(JSON.stringify(obj));
  }

  // ---------- Файли ----------
  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(String(r.result));
      r.onerror = () => reject(r.error || new Error('Не вдалося прочитати файл'));
      r.readAsText(file, 'utf-8');
    });
  }

  function blobToBase64(blob) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => {
        const s = String(r.result);
        resolve(s.slice(s.indexOf(',') + 1));
      };
      r.onerror = () => reject(r.error || new Error('Не вдалося прочитати файл'));
      r.readAsDataURL(blob);
    });
  }

  function base64ToBlob(b64, type) {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type: type || 'application/octet-stream' });
  }

  // ---------- Експорт ----------
  CRM.TZ = TZ;
  CRM.CURRENCIES = CURRENCIES;
  CRM.MONTHS_GEN = MONTHS_GEN;
  CRM.MONTHS_NOM = MONTHS_NOM;
  CRM.MONTHS_SHORT = MONTHS_SHORT;
  CRM.WEEKDAYS = WEEKDAYS;
  CRM.WEEKDAYS_SHORT = WEEKDAYS_SHORT;

  CRM.date = {
    today, nowTime, toKyivDate, kyivParts, parse, isDate, make, daysInMonth,
    addDays, addMonths, addYears, diffDays, weekday, startOfWeek, endOfWeek,
    startOfMonth, endOfMonth, monthKey, compare, toUTC, fromUTC, pad
  };

  CRM.fmt = {
    date: formatDate, dateShort: formatDateShort, relDay: formatRelativeDay,
    month: formatMonth, dateLong: formatDateLong, dateTime: formatDateTime, timeAgo,
    number: formatNumber, money: formatMoney, percent: formatPercent, bytes: formatBytes,
    plural, count: countLabel
  };

  CRM.utils = {
    uid, debounce, clamp, sum, groupBy, deepClone, round2, parseAmount,
    normalize, escapeRegExp, initials, isValidEmail, isValidPhone,
    downloadBlob, readFileAsText, blobToBase64, base64ToBlob, NBSP
  };
})(window.CRM);
