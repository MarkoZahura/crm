/* ==========================================================================
   import.js — «Імпорт виписки» банку (файл CSV) на вкладці «Транзакції».

   • Файл: UTF-8 або Windows-1251, роздільник «;» / «,» / табуляція, поля в лапках.
     Шапку виписки (дані клієнта, рахунок, баланси) пропускаємо: шукаємо перший
     рядок заголовків таблиці з колонкою «Дата». Шапку не показуємо й не зберігаємо.
   • Колонки: Райффайзен Банк та схожі виписки розпізнаються самі; для іншого банку
     людина один раз зіставляє колонки (дата, сума, опис…) — CRM запамʼятовує це
     за набором заголовків (налаштування `bankImport`, синхронізується).
   • Перегляд перед імпортом: галочки, тип, категорія (памʼять «категорія банку /
     мерчант → категорія CRM», «Мої слова», словник), позначки «уже імпортовано»
     (ключ операції), «схоже, вже є» (внесено вручну — без галочки), «сума змінилась»
     (операція була «в обробці»). Перекази до «скрині» / зі «скрині» — перекази між
     карткою й ощадним рахунком «Скриня».
   • Після імпорту: «Скасувати імпорт» і звірка балансу з «Залишком після операції»
     + «Вирівняти» (змінити початковий баланс рахунку).
   ========================================================================== */
window.CRM = window.CRM || {};

(function (CRM) {
  'use strict';

  const { h, ui } = { h: CRM.ui.h, ui: CRM.ui };
  const D = CRM.date;
  const fmt = CRM.fmt;
  const U = CRM.utils;
  const F = () => CRM.finance;
  const SETTING = 'bankImport';
  const PAGE = 200;
  const norm = (s) => U.normalize(s);

  // ======================================================================
  // CSV
  // ======================================================================
  /** Байти файлу → текст: UTF-8 (без BOM), інакше Windows-1251. */
  function decode(buf) {
    const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
    let text;
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes); } catch (e) {
      try { text = new TextDecoder('windows-1251').decode(bytes); } catch (e2) { text = new TextDecoder('utf-8').decode(bytes); }
    }
    return text.replace(/^﻿/, '');
  }

  /** Роздільник за рядками, схожими на таблицю: «;», «,» або табуляція. */
  function detectDelimiter(text) {
    const lines = text.split(/\r?\n/).filter((l) => l.trim()).slice(0, 200);
    let best = ';';
    let bestScore = -1;
    [';', '\t', ','].forEach((d) => {
      // Скільки рядків мають ≥3 полів — і наскільки однакова їх кількість
      const counts = lines.map((l) => splitLine(l, d).length).filter((n) => n >= 3);
      if (!counts.length) return;
      const freq = new Map();
      counts.forEach((n) => freq.set(n, (freq.get(n) || 0) + 1));
      const top = Math.max(...freq.values());
      if (top > bestScore) { bestScore = top; best = d; }
    });
    return best;
  }
  function splitLine(line, d) { return parseCsv(line, d)[0] || []; }

  /** Розбір CSV (лапки, «""» всередині, перенос рядка в лапках). → масив рядків з масивів полів. */
  function parseCsv(text, delim) {
    const d = delim || ';';
    const rows = [];
    let row = [];
    let field = '';
    let quoted = false;
    let i = 0;
    const n = text.length;
    while (i < n) {
      const ch = text[i];
      if (quoted) {
        if (ch === '"') {
          if (text[i + 1] === '"') { field += '"'; i += 2; continue; }
          quoted = false; i++; continue;
        }
        field += ch; i++; continue;
      }
      if (ch === '"' && field.trim() === '') { quoted = true; field = ''; i++; continue; }
      if (ch === d) { row.push(field); field = ''; i++; continue; }
      if (ch === '\r' || ch === '\n') {
        row.push(field); rows.push(row); row = []; field = '';
        if (ch === '\r' && text[i + 1] === '\n') i++;
        i++; continue;
      }
      field += ch; i++;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.map((r) => r.map((x) => x.trim()));
  }

  // ======================================================================
  // Значення
  // ======================================================================
  /** «-1 234,56» / «1234.56» / «1,234.56» / «−15,00 ₴» → число або NaN. */
  function parseNum(str) {
    let s = String(str == null ? '' : str).replace(/[\s  '₴$€]/g, '').replace(/^−/, '-').replace(/[A-Za-zА-Яа-яІіЇїЄєҐґ]/g, '');
    if (!s) return NaN;
    if (/^\(.*\)$/.test(s)) s = '-' + s.slice(1, -1);
    const lastComma = s.lastIndexOf(',');
    const lastDot = s.lastIndexOf('.');
    if (lastComma > -1 && lastDot > -1) {
      // Остання з двох — десяткова
      s = lastComma > lastDot ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
    } else if (lastComma > -1) {
      s = (s.match(/,/g) || []).length > 1 ? s.replace(/,/g, '') : s.replace(',', '.');
    }
    if (!/^[-+]?\d+(\.\d+)?$/.test(s)) return NaN;
    return Number(s);
  }

  /** «05.01.2027 09:10:00» / «2027-01-05 09:10» / «05/01/2027» / «05.01.27» → { date, time } або null. */
  function parseDateTime(str) {
    const s = String(str || '').trim();
    let m = s.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})(?:[ ,T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
    let y; let mo; let d;
    if (m) { d = +m[1]; mo = +m[2]; y = +m[3]; if (y < 100) y += 2000; }
    else {
      m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
      if (!m) return null;
      y = +m[1]; mo = +m[2]; d = +m[3];
    }
    if (mo < 1 || mo > 12 || d < 1 || d > D.daysInMonth(y, mo) || y < 1990 || y > 2100) return null;
    const time = m[4] != null ? `${String(+m[4]).padStart(2, '0')}:${m[5]}:${m[6] || '00'}` : '';
    return { date: D.make(y, mo, d), time };
  }

  /** Короткий відбиток рядка (cyrb53) — ключ операції, без самих даних. */
  function hash(str) {
    let h1 = 0xdeadbeef;
    let h2 = 0x41c6ce57;
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
  }

  // ======================================================================
  // Заголовки й колонки
  // ======================================================================
  /** Перший рядок заголовків таблиці: ≥3 непорожніх полів, одне з них — «Дата»/«Date». */
  function findHeader(rows) {
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      const filled = r.filter((x) => x).length;
      if (filled < 3) continue;
      if (!r.some((x) => /дата|date/i.test(x) && x.length <= 60)) continue;
      // Під заголовком має бути хоч один рядок із датою
      const next = rows.slice(i + 1, i + 6).find((x) => x.filter(Boolean).length >= 3);
      if (next && next.some((x) => parseDateTime(x))) return i;
    }
    return -1;
  }

  const signature = (headers) => headers.map((x) => norm(x)).join('|');

  const ROLES = [
    { id: 'date', label: 'Дата', required: true },
    { id: 'amount', label: 'Сума (− витрата, + надходження)' },
    { id: 'debit', label: 'Витрата (списання)' },
    { id: 'credit', label: 'Надходження (зарахування)' },
    { id: 'desc', label: 'Опис операції', required: true },
    { id: 'category', label: 'Категорія банку' },
    { id: 'currency', label: 'Валюта операції' },
    { id: 'opAmount', label: 'Сума у валюті операції' },
    { id: 'balance', label: 'Залишок після операції' }
  ];

  /** Здогадатися, яка колонка за що відповідає. → { map: { роль: індекс|null }, mode: 'signed'|'split' } */
  function guessMap(headers) {
    const H = headers.map((x) => norm(x));
    const pick = (score) => {
      let best = null;
      let bestS = 0;
      H.forEach((x, i) => { const s = score(x); if (s > bestS) { bestS = s; best = i; } });
      return best;
    };
    const has = (x, re) => re.test(x);
    const map = {};
    map.date = pick((x) => {
      if (!has(x, /дата|date/)) return 0;
      let s = 5;
      if (has(x, /здійсн|час|time|операці|транзакц/)) s += 3;
      if (has(x, /виконан|банком|проведен|обробк|posted|народж/)) s -= 4;
      return s;
    });
    map.exec = pick((x) => (has(x, /дата/) && has(x, /виконан|проведен|обробк|банком/) ? 5 : has(x, /posted/) ? 4 : 0));
    if (map.exec === map.date) map.exec = null;
    map.time = pick((x) => (x === 'час' || x === 'time' || x === 'час операції' ? 5 : 0));
    const sumScore = (x) => {
      if (!has(x, /сума|amount|сумма/)) return 0;
      if (has(x, /коміс|кешбек|кэшбэк|fee|cashback/)) return 0;
      let s = 4;
      if (has(x, /рахун|картк|account|card|uah|грн/)) s += 3;
      if (has(x, /операці|транзакц|transaction/) && !has(x, /рахун|картк/)) s -= 2;
      return s;
    };
    map.debit = pick((x) => (has(x, /витрат|дебет|debit|списан|видат/) && !has(x, /коміс/) ? 5 : 0));
    map.credit = pick((x) => (has(x, /надходж|кредит|credit|зарахув|прихід|поповн/) && !has(x, /коміс|кешбек/) ? 5 : 0));
    map.amount = pick(sumScore);
    const mode = map.debit != null && map.credit != null && map.debit !== map.credit ? 'split' : 'signed';
    if (mode === 'signed') { map.debit = null; map.credit = null; }
    map.desc = pick((x) => (has(x, /деталі|опис|признач|description|details|merchant|коментар|назва/) ? (has(x, /деталі|опис|признач/) ? 6 : 4) : 0));
    map.category = pick((x) => (has(x, /^категорія|^category|категорія операці/) ? 5 : 0));
    map.currency = pick((x) => (has(x, /валют|currency/) && !has(x, /сума|amount|курс|rate/) ? (has(x, /операці|транзакц/) ? 6 : 4) : 0));
    map.opAmount = pick((x) => (has(x, /сума|amount/) && has(x, /валюті операці|валюті транзакц|transaction currency|original/) ? 5 : 0));
    if (map.opAmount === map.amount) map.opAmount = null;
    map.balance = pick((x) => (has(x, /залишок|баланс|balance|остаток/) ? 5 : 0));
    map.mcc = pick((x) => (x === 'mcc' || has(x, /^mcc|код категорії/) ? 5 : 0));
    return { map, mode };
  }

  /** Відомі банки — назва за заголовками (колонки однаково визначає guessMap). */
  const KNOWN = [
    { name: 'Райффайзен Банк', test: (H) => H.includes('дата і час здійснення операції') && H.includes('деталі операції') && H.includes('сума у валюті рахунку') },
    { name: 'monobank', test: (H) => H.some((x) => /^дата [iі] час операції$/.test(x)) && H.includes('деталі операції') && H.some((x) => x.startsWith('сума в валюті картки')) }
  ];
  function knownBank(headers) {
    const H = headers.map((x) => norm(x));
    const k = KNOWN.find((x) => x.test(H));
    return k ? k.name : null;
  }

  // ======================================================================
  // Налаштування імпорту (памʼять)
  // ======================================================================
  function settings() {
    const v = CRM.store.getSetting(SETTING, null);
    return { profiles: (v && v.profiles) || {}, rules: (v && v.rules) || {} };
  }
  async function saveSettings(patch) {
    const cur = settings();
    const next = { profiles: Object.assign({}, cur.profiles, patch.profiles || {}), rules: Object.assign({}, cur.rules, patch.rules || {}) };
    await CRM.store.setSetting(SETTING, next);
  }

  // ======================================================================
  // Рядки виписки
  // ======================================================================
  /** «Продукти та супермаркети: SILPO» → { bankCat, merchant } */
  function splitDetails(details, catCol, catSep) {
    const s = String(details || '').trim();
    if (catCol) return { bankCat: catCol, merchant: s };
    if (catSep) {
      const m = s.match(/^([^:]{2,45}):\s*(.*)$/);
      if (m && !/\d{3,}/.test(m[1])) return { bankCat: m[1].trim(), merchant: m[2].trim() || m[1].trim() };
    }
    return { bankCat: '', merchant: s };
  }
  /** Ключ мерчанта для памʼяті: «SILPO 1234 KYIV» → «silpo kyiv». */
  function merchantKey(s) {
    return norm(s).replace(/[^a-zа-яіїєґ' ]+/g, ' ').replace(/\s+/g, ' ').trim().split(' ').filter((w) => w.length > 1).slice(0, 4).join(' ');
  }
  const BOX_TO = /переказ до скрин/i;
  const BOX_FROM = /зняття (зі|з|із) скрин/i;

  /**
   * Прочитати рядки таблиці за зіставленням колонок.
   * → { items, bad: [{ line, why }], catSep }
   */
  function readItems(rows, headerIdx, prof) {
    const map = prof.map;
    const data = rows.slice(headerIdx + 1);
    const items = [];
    const bad = [];
    // «Категорія: опис» у більшості рядків — ділимо так само
    const descs = data.map((r) => (map.desc != null ? r[map.desc] : '')).filter(Boolean);
    const catSep = prof.catSep != null ? prof.catSep : descs.length > 0 && descs.filter((x) => /^[^:\d]{2,45}:\s*\S/.test(x)).length / descs.length >= 0.6;
    const seen = new Map();
    data.forEach((r, k) => {
      const line = headerIdx + 2 + k;
      if (!r.some((x) => x)) return;
      if (r.filter((x) => x).length < 2) return;
      const dateCell = map.date != null ? String(r[map.date] || '') : '';
      const dt = parseDateTime(dateCell);
      // Без дати — не операція (підсумки, порожні рядки); схоже на дату, але не читається — повідомимо
      if (!dt) { if (/\d{1,4}[./-]\d{1,2}[./-]\d{1,4}/.test(dateCell)) bad.push({ line, why: 'дата' }); return; }
      if (!dt.time && map.time != null) { const t = String(r[map.time] || '').match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/); if (t) dt.time = `${t[1].padStart(2, '0')}:${t[2]}:${t[3] || '00'}`; }
      let amount;
      if (prof.mode === 'split') {
        const deb = parseNum(r[map.debit]);
        const cred = parseNum(r[map.credit]);
        amount = (isNaN(cred) ? 0 : Math.abs(cred)) - (isNaN(deb) ? 0 : Math.abs(deb));
        if (isNaN(deb) && isNaN(cred)) amount = NaN;
      } else amount = parseNum(map.amount != null ? r[map.amount] : '');
      if (isNaN(amount)) { bad.push({ line, why: 'сума' }); return; }
      amount = U.round2(amount);
      if (!amount) return;
      const details = map.desc != null ? String(r[map.desc] || '').trim() : '';
      const { bankCat, merchant } = splitDetails(details, map.category != null ? String(r[map.category] || '').trim() : '', catSep);
      const currency = map.currency != null ? String(r[map.currency] || '').trim().toUpperCase() : '';
      const opAmount = map.opAmount != null ? parseNum(r[map.opAmount]) : NaN;
      const balance = map.balance != null ? parseNum(r[map.balance]) : NaN;
      const pending = map.exec != null ? !String(r[map.exec] || '').trim() : false;
      const base = `${dt.date} ${dt.time}|${details}`;
      const n = (seen.get(base + '|' + amount) || 0) + 1;
      seen.set(base + '|' + amount, n);
      let kind = amount < 0 ? 'expense' : 'income';
      if (amount < 0 && BOX_TO.test(details)) kind = 'toBox';
      if (amount > 0 && BOX_FROM.test(details)) kind = 'fromBox';
      items.push({
        i: items.length, line, date: dt.date, time: dt.time, dt: `${dt.date} ${dt.time || '00:00:00'}`,
        amount: Math.abs(amount), signed: amount, details, bankCat, merchant,
        currency: /^[A-Z]{3}$/.test(currency) ? currency : '', opAmount: isNaN(opAmount) ? null : Math.abs(opAmount),
        balance: isNaN(balance) ? null : balance, pending, kind,
        key: hash(`${base}|${amount}|${n}`), loose: hash(`${base}|${n}`),
        mKey: merchantKey(merchant), bKey: norm(bankCat)
      });
    });
    return { items, bad, catSep };
  }

  // ======================================================================
  // Категорії
  // ======================================================================
  // Категорія банку → стартова категорія CRM (назви з defaults.js; «*» — початок слова)
  const BANK_DICT = {
    expense: [
      [['продукт*', 'супермаркет*'], 'Продукти', 'Супермаркет'],
      [['кафе', 'ресторан*', 'фастфуд*', 'фаст-фуд', 'кав\'ярн*'], 'Кафе й ресторани'],
      [['доставк*'], 'Кафе й ресторани', 'Доставка їжі'],
      [['таксі'], 'Транспорт', 'Таксі'],
      [['азс', 'пальне', 'заправк*', 'паливо'], 'Транспорт', 'Пальне'],
      [['транспорт*', 'проїзд*', 'автосервіс*', 'авто', 'парковк*'], 'Транспорт'],
      [['книг*'], 'Освіта', 'Книги'],
      [['освіт*', 'навчанн*', 'курси'], 'Освіта'],
      [['спорт*', 'фітнес*'], 'Спорт'],
      [['комунальн*'], 'Житло й комунальні', 'Комунальні послуги'],
      [['оренд*'], 'Житло й комунальні', 'Оренда'],
      [['мобільн*', 'звʼязок', 'зв\'язок', 'поповнення мобільного'], 'Звʼязок та інтернет', 'Мобільний'],
      [['інтернет*'], 'Звʼязок та інтернет', 'Інтернет'],
      [['аптек*', 'ліки'], 'Здоровʼя', 'Аптека'],
      [['медицин*', 'здоров*', 'лікар*', 'клінік*', 'стоматолог*'], 'Здоровʼя'],
      [['одяг*', 'взутт*'], 'Одяг і взуття'],
      [['ігри', 'ігор', 'гра'], 'Розваги', 'Ігри'],
      [['кіно', 'кінотеатр*'], 'Розваги', 'Кіно'],
      [['розваг*', 'дозвілл*'], 'Розваги'],
      [['подарун*', 'квіти', 'квіт*'], 'Подарунки'],
      [['підписк*', 'цифров*', 'сервіс*'], 'Підписки']
    ],
    income: [
      [['кешбек*', 'кешбэк*', 'cashback', 'відсот*', 'депозит*'], 'Кешбек і відсотки'],
      [['зарплат*', 'заробітн*'], 'Зарплата'],
      [['стипенді*'], 'Стипендія'],
      [['подарун*'], 'Подарунки']
    ]
  };
  // Латинські назви мерчантів у виписках (словник швидкого введення — кирилицею)
  const MERCHANT_DICT = {
    expense: [
      [['silpo', 'atb', 'novus', 'fora', 'varus', 'auchan', 'ashan', 'metro', 'eko', 'tavria', 'nash kray', 'velyka kyshenya'], 'Продукти', 'Супермаркет'],
      [['glovo', 'bolt food', 'rocket', 'zakaz'], 'Кафе й ресторани', 'Доставка їжі'],
      [['uklon', 'uber', 'bolt'], 'Транспорт', 'Таксі'],
      [['okko', 'wog', 'socar', 'upg', 'shell', 'brsm'], 'Транспорт', 'Пальне'],
      [['mcdonald', 'kfc', 'puzata', 'lviv croissants', 'aroma kava', 'starbucks', 'coffee', 'kava'], 'Кафе й ресторани'],
      [['apteka', 'pharm'], 'Здоровʼя', 'Аптека'],
      [['netflix', 'spotify', 'youtube', 'google one', 'apple.com', 'icloud', 'openai', 'chatgpt', 'anthropic', 'claude'], 'Підписки'],
      [['kyivstar', 'vodafone', 'lifecell'], 'Звʼязок та інтернет', 'Мобільний'],
      [['steam', 'playstation', 'xbox', 'epic games'], 'Розваги', 'Ігри'],
      [['multiplex', 'planeta kino'], 'Розваги', 'Кіно']
    ],
    income: []
  };
  function dictMatch(dict, text) {
    const t = norm(text);
    if (!t) return null;
    const words = t.split(/[^a-zа-яіїєґ']+/).filter(Boolean);
    for (const [keys, cat, sub] of dict) {
      const hit = keys.some((k) => {
        if (k.includes(' ') || k.includes('.')) return t.includes(k);
        return k.endsWith('*') ? words.some((w) => w.startsWith(k.slice(0, -1))) : words.includes(k);
      });
      if (hit) return { cat, sub };
    }
    return null;
  }
  function categoryByName(kind, name, subName) {
    const c = F().categories(kind).find((x) => norm(x.name) === norm(name));
    if (!c) return null;
    const sub = subName ? (c.subcategories || []).find((s) => norm(s.name) === norm(subName)) : null;
    return { categoryId: c.id, subcategoryId: sub ? sub.id : null };
  }
  function validCat(kind, categoryId, subcategoryId) {
    const c = categoryId && CRM.store.get('categories', categoryId);
    if (!c || c.deletedAt || c.kind !== kind) return null;
    const sub = subcategoryId ? (c.subcategories || []).find((s) => s.id === subcategoryId) : null;
    return { categoryId: c.id, subcategoryId: sub ? sub.id : null };
  }
  function fallbackCat(kind) {
    const cats = F().categories(kind);
    const other = cats.find((c) => norm(c.name) === 'інше') || cats[cats.length - 1];
    return other ? { categoryId: other.id, subcategoryId: null } : { categoryId: null, subcategoryId: null };
  }
  const ruleKey = (kind, type, value) => `${kind}|${type}|${value}`;

  /** Категорія для рядка: памʼять (мерчант, категорія банку) → «Мої слова» → категорія банку → словники → «Інше». */
  function suggest(it, rules) {
    const kind = it.kind;
    const r1 = it.mKey && rules[ruleKey(kind, 'm', it.mKey)];
    if (r1) { const v = validCat(kind, r1.categoryId, r1.subcategoryId); if (v) return Object.assign(v, { source: 'rule' }); }
    const r2 = it.bKey && rules[ruleKey(kind, 'b', it.bKey)];
    if (r2) { const v = validCat(kind, r2.categoryId, r2.subcategoryId); if (v) return Object.assign(v, { source: 'rule' }); }
    const Q = CRM.quick;
    // Мої слова (кабінет → «Швидке введення») — за описом
    if (Q && Q.guessCategory) {
      const g = Q.guessCategory(kind, it.merchant, null);
      if (g && g.own) return { categoryId: g.cat.id, subcategoryId: g.sub ? g.sub.id : null, source: 'own' };
    }
    const b = it.bankCat ? dictMatch(BANK_DICT[kind], it.bankCat) : null;
    if (b) { const v = categoryByName(kind, b.cat, b.sub); if (v) return Object.assign(v, { source: 'bank' }); }
    const m = dictMatch(MERCHANT_DICT[kind], it.merchant);
    if (m) { const v = categoryByName(kind, m.cat, m.sub); if (v) return Object.assign(v, { source: 'dict' }); }
    if (Q && Q.guessCategory) {
      const g = Q.guessCategory(kind, [it.merchant, it.bankCat].filter(Boolean).join(' '), null);
      if (g && !g.fallback) return { categoryId: g.cat.id, subcategoryId: g.sub ? g.sub.id : null, source: 'dict' };
    }
    return Object.assign(fallbackCat(kind), { source: 'fallback' });
  }

  // ======================================================================
  // Порівняння з тим, що вже є в CRM
  // ======================================================================
  /**
   * status: new | dup (уже імпортовано) | changed (була «в обробці», сума змінилась) |
   *         similar (схоже на внесене вручну) | skip (скриню не імпортуємо)
   */
  function markExisting(items, accountId, boxId) {
    const all = CRM.store.list('transactions', { deleted: 'all' });
    const byKey = new Map();
    const byLoose = new Map();
    all.forEach((t) => {
      if (!t.import) return;
      if (t.import.key) byKey.set(t.import.key, t);
      if (t.import.pending && t.import.loose) byLoose.set(t.import.loose, t);
    });
    const manual = CRM.store.list('transactions').filter((t) => !t.import);
    const used = new Set();
    items.forEach((it) => {
      it.match = null;
      it.prevAmount = null;
      const dup = byKey.get(it.key);
      if (dup) { it.status = 'dup'; it.match = dup.id; it.inTrash = !!dup.deletedAt; return; }
      const ch = byLoose.get(it.loose);
      if (ch && !ch.deletedAt) { it.status = 'changed'; it.match = ch.id; it.prevAmount = ch.amount; return; }
      if ((it.kind === 'toBox' || it.kind === 'fromBox') && boxId === 'skip') { it.status = 'skip'; return; }
      // Схоже на внесене вручну: той самий рахунок, сума, дата ±1 день
      const sim = manual.find((t) => {
        if (used.has(t.id) || U.round2(t.amount) !== it.amount) return false;
        if (Math.abs(D.diffDays(t.date, it.date)) > 1) return false;
        if (it.kind === 'expense' || it.kind === 'income') return t.type === it.kind && t.accountId === accountId;
        if (!boxId || boxId === 'new') return false;
        return t.type === 'transfer' && (it.kind === 'toBox'
          ? t.accountId === accountId && t.toAccountId === boxId
          : t.accountId === boxId && t.toAccountId === accountId);
      });
      if (sim) { used.add(sim.id); it.status = 'similar'; it.match = sim.id; return; }
      it.status = 'new';
    });
  }
  const isPlain = (it) => it.kind === 'expense' || it.kind === 'income';
  const canImport = (it) => it.status === 'new' || it.status === 'similar' || it.status === 'changed';

  // ======================================================================
  // Звірка балансу
  // ======================================================================
  /**
   * Залишок у банку на кінець виписки: останній відомий «Залишок після операції»
   * + суми операцій після нього. → { date, bank } або null.
   */
  function bankEndBalance(items) {
    if (!items.some((x) => x.balance != null)) return null;
    // Хронологічно: за датою й часом, однакові — за порядком у файлі (файл від нових до старих або навпаки)
    const newestFirst = items.length > 1 && items[0].dt > items[items.length - 1].dt;
    const chron = items.slice().sort((a, b) => a.dt.localeCompare(b.dt) || (newestFirst ? b.i - a.i : a.i - b.i));
    let idx = -1;
    chron.forEach((x, k) => { if (x.balance != null) idx = k; });
    let bal = chron[idx].balance;
    chron.slice(idx + 1).forEach((x) => { bal += x.signed; });
    return { date: chron[chron.length - 1].date, bank: U.round2(bal) };
  }

  // ======================================================================
  // Вікно імпорту
  // ======================================================================
  function openImport(opts) {
    const o = opts || {};
    if (!F().accounts().length) {
      const dlg0 = ui.modal({
        title: 'Імпорт виписки', size: 'sm', center: true,
        body: ui.empty({
          icon: 'bank', small: true, title: 'Спершу додай рахунок',
          text: 'Операції з виписки записуються на рахунок у CRM — картку, з якої виписка.',
          action: { label: 'Додати рахунок', icon: 'plus', onClick: () => { dlg0.close('force'); CRM.router.go('budget/accounts'); setTimeout(() => CRM.budget.openAccountForm && CRM.budget.openAccountForm(), 50); } }
        })
      });
      return dlg0;
    }

    const S = {
      file: null, rows: null, headerIdx: -1, headers: [], sig: '', bank: '', prof: null,
      items: [], bad: [], filter: 'all', shown: PAGE, result: null, error: null, busy: false
    };
    const body = h('div', { class: 'imp' });
    const footer = h('div', { class: 'drawer-footer-inner imp-footer' });
    const dlg = ui.modal({
      title: 'Імпорт виписки', size: 'lg', className: 'imp-modal',
      body, footer,
      onBeforeClose: (reason) => {
        if (S.busy) return false;
        if (reason === 'outside' && S.items.length && !S.result) return false;
        return true;
      }
    });

    // ---------- Крок 1: файл ----------
    const fileIn = h('input', { type: 'file', class: 'imp-file-input', accept: '.csv,text/csv,text/plain', hidden: true });
    fileIn.addEventListener('change', () => { if (fileIn.files && fileIn.files[0]) loadFile(fileIn.files[0]); fileIn.value = ''; });

    async function loadFile(file) {
      S.error = null;
      if (file.size > 20 * 1024 * 1024) { S.error = 'Файл завеликий (понад 20 МБ). Вибери виписку за коротший період.'; render(); return; }
      let text;
      try { text = decode(new Uint8Array(await file.arrayBuffer())); } catch (e) { S.error = 'Не вдалося прочитати файл.'; render(); return; }
      const rows = parseCsv(text, detectDelimiter(text));
      const hi = findHeader(rows);
      if (hi < 0) {
        S.error = 'У файлі не знайдено таблиці з операціями. Потрібен файл CSV, де є рядок заголовків із колонкою «Дата» і під ним — операції.';
        render();
        return;
      }
      S.file = { name: file.name, size: file.size };
      S.items = [];
      S.filter = 'all';
      S.shown = PAGE;
      S.rows = rows;
      S.headerIdx = hi;
      S.headers = rows[hi].map((x, i) => x || `Колонка ${i + 1}`);
      S.sig = signature(S.headers);
      const saved = settings().profiles[S.sig];
      const guess = guessMap(S.headers);
      const known = knownBank(S.headers);
      S.prof = saved ? Object.assign({ map: guess.map, mode: guess.mode }, U.deepClone(saved)) : { name: known || '', map: guess.map, mode: guess.mode, accountId: null, box: null };
      S.prof.known = !!known;
      if (!S.prof.name) S.prof.name = known || 'Мій банк';
      S.colsOpen = !saved && !known;
      if (!S.prof.accountId || !F().account(S.prof.accountId)) S.prof.accountId = o.accountId || guessAccount();
      analyze();
      render();
    }
    function guessAccount() {
      const ranked = F().rankedAccounts().map((x) => x.account);
      const named = S.prof && S.prof.name ? ranked.find((a) => norm(a.name).includes(norm(S.prof.name).split(' ')[0])) : null;
      return (named || ranked.find((a) => a.type !== 'savings' && a.currency === 'UAH') || ranked[0]).id;
    }
    function defaultBox() {
      const acc = F().accounts();
      const box = acc.find((a) => /скрин/i.test(a.name) && a.id !== S.prof.accountId);
      return box ? box.id : 'new';
    }
    function mapReady() {
      const m = S.prof.map;
      return m.date != null && m.desc != null && (S.prof.mode === 'split' ? m.debit != null && m.credit != null : m.amount != null);
    }

    /** Перерахувати рядки: прочитати, категорії, порівняти з CRM. Вибір людини лишається. */
    function analyze() {
      const prevItems = new Map(S.items.map((x) => [x.key, x]));
      if (!mapReady()) { S.items = []; S.bad = []; return; }
      const { items, bad, catSep } = readItems(S.rows, S.headerIdx, S.prof);
      S.catSep = catSep;
      S.items = items;
      S.bad = bad;
      S.hasBox = items.some((x) => x.kind === 'toBox' || x.kind === 'fromBox');
      if (S.hasBox && (!S.prof.box || (S.prof.box !== 'skip' && S.prof.box !== 'new' && !F().account(S.prof.box)))) S.prof.box = defaultBox();
      const rules = settings().rules;
      items.forEach((it) => {
        const was = prevItems.get(it.key);
        if (isPlain(it)) {
          if (was && was.userCat && isPlain(was) && was.kind === it.kind) { it.cat = was.cat; it.userCat = true; } else it.cat = suggest(it, rules);
        }
        it.userCheck = was ? was.userCheck : undefined;
      });
      markExisting(items, S.prof.accountId, S.hasBox ? S.prof.box : null);
      items.forEach((it) => {
        const def = it.status === 'new' || it.status === 'changed';
        it.checked = canImport(it) ? (it.userCheck != null ? it.userCheck : def) : false;
      });
    }

    // ---------- Відображення ----------
    function render() {
      if (S.result) return renderResult();
      if (!S.rows) return renderPick();
      renderMain();
    }

    function renderPick() {
      const drop = h('div', { class: 'imp-drop', tabIndex: 0, role: 'button', 'aria-label': 'Вибрати файл виписки' },
        CRM.icon('upload'),
        h('div', { class: 'imp-drop-title' }, 'Перетягни сюди файл виписки або натисни, щоб вибрати'),
        h('div', { class: 'imp-drop-hint' }, 'Формат CSV. Райффайзен: «Довідка про рух коштів по рахунку» → CSV. Для іншого банку колонки зіставиш один раз — CRM запамʼятає.'));
      drop.addEventListener('click', () => fileIn.click());
      drop.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileIn.click(); } });
      drop.addEventListener('dragover', (e) => { e.preventDefault(); drop.classList.add('over'); });
      drop.addEventListener('dragleave', () => drop.classList.remove('over'));
      drop.addEventListener('drop', (e) => {
        e.preventDefault();
        drop.classList.remove('over');
        const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
        if (f) loadFile(f);
      });
      ui.mount(body,
        S.error ? h('div', { class: 'callout callout-warning imp-error' }, CRM.icon('alert'), h('span', null, S.error)) : null,
        drop, fileIn,
        h('p', { class: 'field-hint imp-privacy' }, CRM.icon('shield', { size: 'sm' }),
          'Шапку виписки (імʼя, ІПН, номер рахунку) CRM не читає й не зберігає — лише рядки операцій.'));
      ui.mount(footer, h('span', { class: 'grow' }), ui.button({ label: 'Закрити', onClick: () => dlg.close('button') }));
    }

    function accountSelect() {
      const sel = h('select', { class: 'select select-sm imp-account', 'aria-label': 'Рахунок у CRM' },
        F().rankedAccounts().map((x) => h('option', { value: x.account.id, selected: x.account.id === S.prof.accountId }, `${x.account.name} · ${x.account.currency}`)));
      sel.addEventListener('change', () => {
        S.prof.accountId = sel.value;
        if (S.prof.box === sel.value) S.prof.box = defaultBox();
        analyze(); render();
      });
      return sel;
    }
    function boxSelect() {
      const accs = F().rankedAccounts().map((x) => x.account).filter((a) => a.id !== S.prof.accountId);
      const sel = h('select', { class: 'select select-sm imp-box', 'aria-label': 'Рахунок для скрині' },
        h('option', { value: 'new', selected: S.prof.box === 'new' }, 'Створити ощадний рахунок «Скриня»'),
        accs.map((a) => h('option', { value: a.id, selected: a.id === S.prof.box }, a.name)),
        h('option', { value: 'skip', selected: S.prof.box === 'skip' }, 'Не імпортувати ці рядки'));
      sel.addEventListener('change', () => { S.prof.box = sel.value; analyze(); render(); });
      return sel;
    }

    function columnsBlock() {
      const opt = (sel, none) => [none ? h('option', { value: '' }, none) : h('option', { value: '' }, '— оберіть —')]
        .concat(S.headers.map((x, i) => h('option', { value: String(i), selected: sel === i }, sample(x, i))));
      const sample = (x, i) => {
        const v = S.rows.slice(S.headerIdx + 1).map((r) => r[i]).find((y) => y);
        return v ? `${x} (напр., ${String(v).slice(0, 24)})` : x;
      };
      const roleSel = (role, optional) => {
        const sel = h('select', { class: 'select select-sm imp-col', dataset: { role: role.id }, 'aria-label': role.label },
          opt(S.prof.map[role.id], optional ? 'немає' : null));
        sel.addEventListener('change', () => { S.prof.map[role.id] = sel.value === '' ? null : Number(sel.value); analyze(); render(); });
        return h('label', { class: 'imp-col-field' }, h('span', { class: 'imp-col-label' }, role.label, role.required || (!optional) ? h('span', { class: 'req' }, '*') : null), sel);
      };
      const R = (id) => ROLES.find((r) => r.id === id);
      const modeSel = h('select', { class: 'select select-sm imp-mode', 'aria-label': 'Як записано суму' },
        h('option', { value: 'signed', selected: S.prof.mode !== 'split' }, 'Одна колонка зі знаком'),
        h('option', { value: 'split', selected: S.prof.mode === 'split' }, 'Дві колонки: витрати й надходження'));
      modeSel.addEventListener('change', () => { S.prof.mode = modeSel.value; analyze(); render(); });
      const nameIn = h('input', { class: 'input input-sm imp-bank-name', value: S.prof.name, maxlength: 40, 'aria-label': 'Назва банку' });
      nameIn.addEventListener('change', () => { S.prof.name = nameIn.value.trim() || 'Мій банк'; });
      const det = h('details', { class: 'imp-cols', open: S.colsOpen },
        h('summary', null, mapReady()
          ? [h('strong', null, S.prof.name), S.prof.known ? ' — колонки розпізнано' : ' — колонки зіставлено', h('span', { class: 'subtle' }, ' · змінити')]
          : [h('strong', null, 'Зістав колонки'), ' — вкажи, де дата, сума й опис (один раз для цього банку)']),
        h('div', { class: 'imp-col-grid' },
          h('label', { class: 'imp-col-field' }, h('span', { class: 'imp-col-label' }, 'Назва банку'), nameIn),
          roleSel(R('date')),
          h('label', { class: 'imp-col-field' }, h('span', { class: 'imp-col-label' }, 'Сума'), modeSel),
          S.prof.mode === 'split' ? [roleSel(R('debit')), roleSel(R('credit'))] : roleSel(R('amount')),
          roleSel(R('desc')),
          roleSel(R('category'), true),
          roleSel(R('currency'), true),
          roleSel(R('opAmount'), true),
          roleSel(R('balance'), true)));
      det.addEventListener('toggle', () => { S.colsOpen = det.open; });
      return det;
    }

    function counts() {
      const c = { all: S.items.length, new: 0, nocat: 0, similar: 0, dup: 0 };
      S.items.forEach((it) => {
        if (it.status === 'new' || it.status === 'changed') c.new++;
        if (it.status === 'similar') c.similar++;
        if (it.status === 'dup') c.dup++;
        if (isPlain(it) && canImport(it) && it.cat && it.cat.source === 'fallback' && !it.userCat) c.nocat++;
      });
      return c;
    }
    function visible() {
      return S.items.filter((it) => {
        switch (S.filter) {
          case 'new': return it.status === 'new' || it.status === 'changed';
          case 'nocat': return isPlain(it) && canImport(it) && it.cat && it.cat.source === 'fallback' && !it.userCat;
          case 'similar': return it.status === 'similar';
          case 'dup': return it.status === 'dup';
          default: return true;
        }
      });
    }

    const accCur = () => F().currencyOf(S.prof.accountId);
    function boxName() {
      if (S.prof.box === 'new') return 'Скриня';
      const a = F().account(S.prof.box);
      return a ? a.name : 'Скриня';
    }

    function catButton(it) {
      const c = it.cat && it.cat.categoryId ? CRM.store.get('categories', it.cat.categoryId) : null;
      const name = c ? F().categoryName(it.cat.categoryId, it.cat.subcategoryId) : 'Без категорії';
      return h('button', {
        type: 'button', class: 'imp-cat' + (it.cat && it.cat.source === 'fallback' && !it.userCat ? ' fallback' : '') + (it.userCat ? ' user' : ''),
        title: 'Змінити категорію', disabled: !canImport(it),
        onClick: (e) => openCatPicker(e.currentTarget, it)
      }, h('span', { class: 'cat-dot', style: { background: F().categoryColor(c ? c.id : null) } }), h('span', { class: 'imp-cat-name' }, name), CRM.icon('chevronDown', { size: 'sm' }));
    }

    function openCatPicker(anchor, it) {
      const list = h('div', { class: 'imp-cat-list', role: 'listbox' });
      F().categories(it.kind).forEach((c) => {
        const opt = (sub) => h('button', {
          type: 'button', class: 'imp-cat-opt' + (sub ? ' sub' : '') + (it.cat && it.cat.categoryId === c.id && (it.cat.subcategoryId || null) === (sub ? sub.id : null) ? ' active' : ''),
          dataset: { value: c.id + '|' + (sub ? sub.id : '') },
          onClick: () => { pop.close('pick'); setCat(it, c.id, sub ? sub.id : null); }
        }, sub ? null : h('span', { class: 'cat-dot', style: { background: CRM.dict.categoryColor(c.color) } }), sub ? sub.name : c.name);
        list.appendChild(opt(null));
        (c.subcategories || []).forEach((sub) => list.appendChild(opt(sub)));
      });
      const pop = ui.popover(anchor, h('div', null,
        it.mKey ? h('div', { class: 'imp-cat-hint' }, 'Для всіх рядків «', h('strong', null, it.merchant.slice(0, 40)), '» і наступних виписок') : null,
        list), { className: 'imp-cat-pop', align: 'start' });
      const act = list.querySelector('.active');
      if (act) { act.scrollIntoView({ block: 'nearest' }); act.focus(); } else { const f = list.querySelector('button'); if (f) f.focus(); }
    }

    /** Змінити категорію рядка; ті самі мерчанти в цьому файлі (ще не змінені вручну) — так само. */
    function setCat(it, categoryId, subcategoryId) {
      const cat = { categoryId, subcategoryId, source: 'user' };
      it.cat = cat;
      it.userCat = true;
      S.items.forEach((x) => {
        if (x === it || x.userCat || x.kind !== it.kind || !x.mKey || x.mKey !== it.mKey) return;
        x.cat = Object.assign({}, cat, { source: 'same' });
      });
      renderFilters();
      renderList();
    }

    function rowEl(it) {
      const check = h('input', {
        type: 'checkbox', class: 'imp-check', checked: it.checked, disabled: !canImport(it),
        'aria-label': 'Імпортувати рядок'
      });
      check.addEventListener('change', () => { it.checked = check.checked; it.userCheck = check.checked; updateSummary(); });
      const cur = accCur();
      let kindEl;
      if (it.kind === 'toBox') kindEl = h('span', { class: 'imp-transfer' }, CRM.icon('arrows', { size: 'sm' }), `Переказ → ${boxName()}`);
      else if (it.kind === 'fromBox') kindEl = h('span', { class: 'imp-transfer' }, CRM.icon('arrows', { size: 'sm' }), `Переказ ← ${boxName()}`);
      else kindEl = catButton(it);
      const badges = [];
      if (it.status === 'dup') badges.push(h('span', { class: 'imp-badge dup' }, it.inTrash ? 'уже імпортовано (у Кошику)' : 'уже імпортовано'));
      if (it.status === 'similar') badges.push(h('span', { class: 'imp-badge similar', title: 'У CRM є операція з тією самою сумою на цьому рахунку в цей день (±1 день) — мабуть, внесена вручну' }, 'схоже, вже є'));
      if (it.status === 'changed') badges.push(h('span', { class: 'imp-badge changed' }, `сума змінилась: було ${fmt.money(it.prevAmount, cur)}`));
      if (it.status === 'skip') badges.push(h('span', { class: 'imp-badge dup' }, 'не імпортується'));
      if (it.pending) badges.push(h('span', { class: 'imp-badge pending', title: 'Банк ще не завершив операцію — сума може трохи змінитися' }, 'в обробці'));
      const foreign = it.currency && it.currency !== cur && it.opAmount != null;
      const sign = it.signed < 0 ? -1 : 1;
      return h('div', { class: 'imp-row imp-' + it.status + (it.checked ? '' : ' off'), dataset: { i: String(it.i), status: it.status, kind: it.kind } },
        h('label', { class: 'imp-check-wrap' }, check),
        h('div', { class: 'imp-when' }, h('span', { class: 'imp-date' }, fmt.dateShort(it.date)), it.time ? h('span', { class: 'imp-time subtle' }, it.time.slice(0, 5)) : null),
        h('div', { class: 'imp-main' },
          h('div', { class: 'imp-desc', title: it.details }, it.merchant || it.details || '—'),
          h('div', { class: 'imp-sub' }, it.bankCat ? h('span', { class: 'imp-bankcat subtle' }, it.bankCat) : null, badges)),
        h('div', { class: 'imp-kind' }, kindEl),
        h('div', { class: 'imp-amt num ' + (sign < 0 ? 'tx-expense' : 'tx-income') },
          fmt.money(sign * it.amount, cur, { sign: sign > 0 }),
          foreign ? h('span', { class: 'imp-op subtle' }, fmt.money(it.opAmount, it.currency)) : null));
    }

    let listEl = null;
    let summaryEl = null;
    let goBtn = null;
    function renderList() {
      if (!listEl) return;
      const vis = visible();
      const shown = vis.slice(0, S.shown);
      ui.mount(listEl,
        shown.length ? shown.map(rowEl) : h('div', { class: 'imp-none subtle' }, 'Немає рядків за цим фільтром.'),
        vis.length > S.shown ? h('button', {
          type: 'button', class: 'more-link btn-link imp-more',
          onClick: () => { S.shown += PAGE; renderList(); }
        }, `Показати ще (${vis.length - S.shown})`) : null);
      updateSummary();
    }

    function selected() { return S.items.filter((it) => it.checked && canImport(it)); }
    function updateSummary() {
      if (!summaryEl) return;
      const sel = selected();
      const cur = accCur();
      let exp = 0; let inc = 0; let box = 0;
      sel.forEach((it) => { if (it.kind === 'expense') exp += it.amount; else if (it.kind === 'income') inc += it.amount; else box++; });
      ui.mount(summaryEl, sel.length
        ? [h('strong', null, `Вибрано ${sel.length}`),
          exp ? ` · витрати ${fmt.money(exp, cur)}` : null,
          inc ? ` · надходження ${fmt.money(inc, cur)}` : null,
          box ? ` · ${fmt.count(box, ['переказ', 'перекази', 'переказів'])} зі скринею` : null]
        : 'Нічого не вибрано');
      if (goBtn) {
        goBtn.disabled = !sel.length || S.busy;
        goBtn.querySelector('.btn-label').textContent = sel.length ? `Імпортувати ${sel.length}` : 'Імпортувати';
      }
      const all = listEl && listEl.parentNode ? listEl.parentNode.querySelector('.imp-all') : null;
      if (all) {
        const vis = visible().filter(canImport);
        all.checked = vis.length > 0 && vis.every((x) => x.checked);
        all.indeterminate = !all.checked && vis.some((x) => x.checked);
      }
    }

    let chipsEl = null;
    /** Фільтри з кількістю рядків (перемальовуються й після зміни категорії). */
    function renderFilters() {
      if (!chipsEl) return;
      const c = counts();
      if (S.filter === 'nocat' && !c.nocat) S.filter = 'all';
      const chip = (id, label, n) => h('button', {
        type: 'button', class: 'chip imp-filter' + (S.filter === id ? ' active' : ''), dataset: { filter: id }, 'aria-pressed': S.filter === id ? 'true' : 'false',
        onClick: () => { S.filter = id; S.shown = PAGE; render(); }
      }, label, h('span', { class: 'chip-count' }, String(n)));
      ui.mount(chipsEl,
        chip('all', 'Усі', c.all), chip('new', 'Нові', c.new),
        c.nocat || S.filter === 'nocat' ? chip('nocat', 'Без категорії', c.nocat) : null,
        c.similar ? chip('similar', 'Схоже, вже є', c.similar) : null,
        c.dup ? chip('dup', 'Уже імпортовано', c.dup) : null);
    }

    function renderMain() {
      const cur = accCur();
      const dates = S.items.map((x) => x.date).sort();
      const head = h('div', { class: 'imp-head' },
        h('div', { class: 'imp-file' }, CRM.icon('file', { size: 'sm' }), h('span', { class: 'imp-file-name' }, S.file.name),
          h('button', { type: 'button', class: 'link-like imp-other', onClick: () => fileIn.click() }, 'Інший файл')),
        S.items.length ? h('div', { class: 'imp-period subtle' },
          `${fmt.count(S.items.length, ['операція', 'операції', 'операцій'])} · ${fmt.dateShort(dates[0])} — ${fmt.dateShort(dates[dates.length - 1])}`) : null);
      const accRow = h('div', { class: 'imp-accs' },
        h('label', { class: 'imp-col-field' }, h('span', { class: 'imp-col-label' }, 'Рахунок у CRM'), accountSelect()),
        S.hasBox ? h('label', { class: 'imp-col-field' }, h('span', { class: 'imp-col-label' }, 'Скриня (накопичення в банку)'), boxSelect()) : null);
      const notes = [];
      if (S.bad.length) {
        notes.push(h('div', { class: 'callout callout-warning imp-bad' }, CRM.icon('alert'),
          h('span', null, `${fmt.count(S.bad.length, ['рядок', 'рядки', 'рядків'])} не вдалося прочитати (${Array.from(new Set(S.bad.map((b) => b.why))).join(', ')}; рядки файлу ${S.bad.slice(0, 5).map((b) => b.line).join(', ')}${S.bad.length > 5 ? '…' : ''}). Перевір колонки.`)));
      }
      const foreignCur = S.items.find((x) => x.currency && x.currency !== cur && x.opAmount != null);
      if (foreignCur) notes.push(h('div', { class: 'field-hint imp-cur-hint' }, `Операції в іншій валюті записуються в ${cur} (як у виписці), а сума у валюті — у коментарі.`));

      if (!mapReady() || !S.items.length) {
        ui.mount(body, head, columnsBlock(), accRow, notes,
          h('div', { class: 'card imp-empty' }, ui.empty({
            icon: 'file', small: true,
            title: mapReady() ? 'У файлі немає операцій' : 'Вкажи колонки «Дата», «Сума» й «Опис»',
            text: mapReady() ? 'Можливо, колонки зіставлено неправильно.' : 'Відкрий «Зістав колонки» вище — CRM запамʼятає це для наступних виписок цього банку.'
          })), fileIn);
        ui.mount(footer, h('span', { class: 'grow' }), ui.button({ label: 'Скасувати', onClick: () => dlg.close('button') }));
        return;
      }

      const allBox = h('input', { type: 'checkbox', class: 'imp-all', 'aria-label': 'Вибрати всі видимі' });
      allBox.addEventListener('change', () => {
        visible().filter(canImport).forEach((it) => { it.checked = allBox.checked; it.userCheck = allBox.checked; });
        renderList();
      });
      chipsEl = h('div', { class: 'chips' });
      const filters = h('div', { class: 'imp-filters' },
        h('label', { class: 'imp-all-wrap', title: 'Вибрати всі / жодної' }, allBox), chipsEl);
      renderFilters();
      listEl = h('div', { class: 'imp-list' });
      summaryEl = h('div', { class: 'imp-sum' });
      ui.mount(body, head, columnsBlock(), accRow, notes,
        h('div', { class: 'imp-table card' }, filters, listEl),
        h('p', { class: 'field-hint imp-learn' }, CRM.icon('info', { size: 'sm' }),
          'Категорії, які ти зміниш, CRM запамʼятає для цього магазину чи категорії банку — наступного разу підставить сама.'),
        fileIn);
      goBtn = ui.button({ label: 'Імпортувати', icon: 'upload', variant: 'primary', className: 'imp-go', onClick: () => runImport() });
      ui.mount(footer, summaryEl, h('span', { class: 'grow' }), ui.button({ label: 'Скасувати', onClick: () => dlg.close('button') }), goBtn);
      renderList();
    }

    // ---------- Імпорт ----------
    async function runImport() {
      const sel = selected();
      if (!sel.length || S.busy) return;
      S.busy = true;
      goBtn.disabled = true;
      try {
        const accountId = S.prof.accountId;
        const acc = F().account(accountId);
        const cur = acc.currency;
        let boxId = S.prof.box;
        let createdBox = null;
        if (sel.some((x) => x.kind === 'toBox' || x.kind === 'fromBox') && boxId === 'new') {
          createdBox = await CRM.store.save('accounts', {
            name: 'Скриня', type: 'savings', currency: cur, initialBalance: 0,
            description: `Накопичувальна скриня в банку (${S.prof.name}) — з імпорту виписки`
          });
          boxId = createdBox.id;
        }
        const recs = [];
        const changed = [];
        const commentOf = (it) => {
          let c = it.merchant || it.details || '';
          if (it.currency && it.currency !== cur && it.opAmount != null) c += ` (${fmt.money(it.opAmount, it.currency)})`;
          return c.slice(0, 200);
        };
        sel.forEach((it) => {
          const imp = { key: it.key, loose: it.loose, pending: it.pending, bank: S.prof.name };
          if (it.status === 'changed') {
            const old = CRM.store.get('transactions', it.match);
            if (old) {
              changed.push(old);
              recs.push(Object.assign({}, old, { amount: it.amount, toAmount: old.type === 'transfer' ? it.amount : old.toAmount, import: imp }));
              return;
            }
          }
          const base = { amount: it.amount, date: it.date, comment: commentOf(it), recurringId: null, recurringDate: null, splits: null, import: imp };
          if (it.kind === 'toBox' || it.kind === 'fromBox') {
            recs.push(Object.assign(base, {
              type: 'transfer', accountId: it.kind === 'toBox' ? accountId : boxId, toAccountId: it.kind === 'toBox' ? boxId : accountId,
              toAmount: it.amount, categoryId: null, subcategoryId: null
            }));
          } else {
            recs.push(Object.assign(base, {
              type: it.kind, accountId, toAccountId: null, toAmount: null,
              categoryId: it.cat ? it.cat.categoryId : null, subcategoryId: it.cat ? it.cat.subcategoryId : null
            }));
          }
        });
        // Операції, що були «в обробці», а тепер завершені — зняти позначку (без нових записів)
        const settle = S.items.filter((it) => it.status === 'dup' && !it.pending).map((it) => CRM.store.get('transactions', it.match))
          .filter((t) => t && !t.deletedAt && t.import && t.import.pending)
          .map((t) => Object.assign({}, t, { import: Object.assign({}, t.import, { pending: false }) }));
        const saved = await CRM.store.saveMany('transactions', recs);
        if (settle.length) await CRM.store.saveMany('transactions', settle);
        F().ensureRatesFor(saved);
        const createdIds = saved.filter((t) => !changed.some((c) => c.id === t.id)).map((t) => t.id);

        // Памʼять: профіль банку й категорії, які людина змінила
        const rules = {};
        S.items.forEach((it) => {
          if (!it.userCat || !it.cat || !it.checked) return;
          if (it.mKey) rules[ruleKey(it.kind, 'm', it.mKey)] = { categoryId: it.cat.categoryId, subcategoryId: it.cat.subcategoryId || null };
        });
        // Категорія банку → категорія CRM, якщо всі рядки цієї категорії банку отримали одну й ту саму
        const byBank = new Map();
        S.items.filter((it) => isPlain(it) && it.bKey && it.checked && it.cat).forEach((it) => {
          const k = ruleKey(it.kind, 'b', it.bKey);
          const arr = byBank.get(k) || [];
          arr.push(it);
          byBank.set(k, arr);
        });
        byBank.forEach((arr, k) => {
          if (!arr.some((x) => x.userCat)) return;
          const first = arr[0].cat;
          if (arr.every((x) => x.cat.categoryId === first.categoryId && (x.cat.subcategoryId || null) === (first.subcategoryId || null))) {
            rules[k] = { categoryId: first.categoryId, subcategoryId: first.subcategoryId || null };
          }
        });
        const prof = { name: S.prof.name, map: S.prof.map, mode: S.prof.mode, accountId, box: createdBox ? createdBox.id : S.prof.box, catSep: S.catSep };
        await saveSettings({ profiles: { [S.sig]: prof }, rules });

        const sum = { expense: 0, income: 0, box: 0, n: createdIds.length, changed: changed.length };
        sel.forEach((it) => { if (it.status === 'changed') return; if (it.kind === 'expense') sum.expense += it.amount; else if (it.kind === 'income') sum.income += it.amount; else sum.box++; });
        S.result = {
          sum, createdIds, changed, createdBox, accountId,
          skipped: S.items.filter((it) => it.status === 'dup').length,
          check: bankEndBalance(S.items)
        };
        S.busy = false;
        render();
        ui.toast(`Імпортовано: ${fmt.count(createdIds.length, ['операція', 'операції', 'операцій'])}`, { type: 'success', action: { label: 'Скасувати', onClick: () => undoImport() } });
      } catch (e) {
        console.error(e);
        S.busy = false;
        updateSummary();
        ui.toast('Не вдалося імпортувати: ' + (e.message || 'помилка'), { type: 'error' });
      }
    }

    async function undoImport() {
      const R = S.result;
      if (!R || R.undone) return;
      R.undone = true;
      await CRM.store.removeManyForever('transactions', R.createdIds);
      if (R.changed.length) await CRM.store.saveMany('transactions', R.changed);
      if (R.createdBox && !CRM.store.list('transactions').some((t) => t.accountId === R.createdBox.id || t.toAccountId === R.createdBox.id)) {
        await CRM.store.removeForever('accounts', R.createdBox.id);
      }
      if (dlg.isOpen) { S.result = null; analyze(); render(); }
      ui.toast('Імпорт скасовано', { type: 'success' });
    }

    function renderResult() {
      const R = S.result;
      const acc = F().account(R.accountId);
      const cur = acc ? acc.currency : 'UAH';
      const lines = [
        h('div', { class: 'imp-res-main' }, CRM.icon('checkCircle'), h('strong', null, `Додано: ${fmt.count(R.sum.n, ['операція', 'операції', 'операцій'])}`)),
        h('ul', { class: 'imp-res-list' },
          R.sum.expense ? h('li', null, `витрати — ${fmt.money(R.sum.expense, cur)}`) : null,
          R.sum.income ? h('li', null, `надходження — ${fmt.money(R.sum.income, cur)}`) : null,
          R.sum.box ? h('li', null, `перекази зі скринею — ${R.sum.box}`) : null,
          R.changed.length ? h('li', null, `оновлено суму — ${R.changed.length}`) : null,
          R.skipped ? h('li', null, `пропущено як уже імпортовані — ${R.skipped}`) : null,
          R.createdBox ? h('li', null, 'створено ощадний рахунок «Скриня»') : null)
      ];
      // Звірка балансу
      let check = null;
      if (R.check && acc) {
        const crm = F().balance(R.accountId, R.check.date);
        const diff = U.round2(R.check.bank - crm);
        if (Math.abs(diff) < 0.005) {
          check = h('div', { class: 'callout imp-balance ok' }, CRM.icon('check'),
            h('span', null, `Баланс «${acc.name}» збігається з банком: ${fmt.money(R.check.bank, cur)} на ${fmt.dateShort(R.check.date)}.`));
        } else {
          check = h('div', { class: 'callout callout-warning imp-balance' }, CRM.icon('scale'),
            h('div', null,
              h('div', null, `У банку на ${fmt.dateShort(R.check.date)} — `, h('strong', { class: 'num' }, fmt.money(R.check.bank, cur)),
                `, у CRM — `, h('strong', { class: 'num' }, fmt.money(crm, cur)), ` (різниця ${fmt.money(diff, cur, { sign: true })}).`),
              h('div', { class: 'field-hint' }, 'Різниця буває, якщо частину операцій не імпортовано або початковий баланс рахунку в CRM інший, ніж у банку.'),
              h('button', {
                type: 'button', class: 'btn btn-sm imp-align',
                onClick: async () => {
                  const a = F().account(R.accountId);
                  const before = a.initialBalance || 0;
                  await CRM.store.patch('accounts', a.id, { initialBalance: U.round2(before + diff) });
                  ui.toast(`Початковий баланс «${a.name}» змінено — тепер як у банку`, {
                    type: 'success', action: { label: 'Скасувати', onClick: () => CRM.store.patch('accounts', a.id, { initialBalance: before }) }
                  });
                  render();
                }
              }, 'Вирівняти')));
        }
      }
      ui.mount(body, h('div', { class: 'imp-result' }, lines, check));
      ui.mount(footer,
        h('button', { type: 'button', class: 'btn btn-danger-ghost imp-undo', onClick: () => undoImport() }, CRM.icon('restore'), h('span', { class: 'btn-label' }, 'Скасувати імпорт')),
        h('span', { class: 'grow' }),
        ui.button({ label: 'Показати операції', className: 'imp-show', onClick: () => { dlg.close('force'); CRM.router.go('budget/transactions', { account: R.accountId }); } }),
        ui.button({ label: 'Готово', variant: 'primary', className: 'imp-done', onClick: () => dlg.close('force') }));
    }

    render();
    if (o.file) loadFile(o.file);
    return dlg;
  }

  CRM.bankImport = {
    decode, detectDelimiter, parseCsv, parseNum, parseDateTime, hash, findHeader, guessMap, knownBank,
    readItems, splitDetails, merchantKey, suggest, markExisting, bankEndBalance, settings, BANK_DICT, MERCHANT_DICT
  };
  if (CRM.budget) CRM.budget.openImport = openImport;
})(window.CRM);
