/* ==========================================================================
   quick.js — швидке введення одним рядком (вікно пошуку Ctrl+K і кнопка ⚡ угорі).
   Прості правила, не ШІ:
     «завтра 15:00 урок»   → подія в Календарі
     «пт купити подарунок» → задача в «Плані дня» на пʼятницю
     «кава 65», «+15000 зарплата» → витрата / дохід у Бюджеті
     «вівсянка 80 г», «обід 650 ккал» → запис у щоденнику харчування
   parse(text) — розбір рядка без даних; plan(text) — варіанти з урахуванням рахунків,
   категорій та історії; create(option) / details(option) — створити запис або відкрити форму.
   ========================================================================== */
window.CRM = window.CRM || {};

(function (CRM) {
  'use strict';

  const D = CRM.date;
  const U = CRM.utils;
  const fmt = CRM.fmt;

  // ---------- Словник розбору ----------
  const REL = { 'сьогодні': 0, 'сьогодня': 0, 'завтра': 1, 'післязавтра': 2, 'вчора': -1, 'учора': -1, 'позавчора': -2 };
  const WEEKDAY = new Map();
  [
    ['пн', 'понеділок', 'понеділка', 'понеділку'],
    ['вт', 'вівторок', 'вівторка', 'вівторку'],
    ['ср', 'середа', 'середу', 'середи'],
    ['чт', 'четвер', 'четверга', 'четвергу'],
    ['пт', "п'ятниця", "п'ятницю", "п'ятниці", 'пятниця', 'пятницю', 'пятниці'],
    ['сб', 'субота', 'суботу', 'суботи'],
    ['нд', 'неділя', 'неділю', 'неділі']
  ].forEach((words, wd) => words.forEach((w) => WEEKDAY.set(w, wd)));
  const THIS_WORDS = new Set(['цей', 'цього', 'цю', 'цієї', 'ця']);
  const NEXT_RE = /^наступн(ий|ого|у|ої|а)$/;
  const MONTHS = ['січня', 'лютого', 'березня', 'квітня', 'травня', 'червня', 'липня', 'серпня', 'вересня', 'жовтня', 'листопада', 'грудня'];
  function monthOf(t) { return t.length >= 3 && /^[а-яіїєґ]+$/.test(t) ? MONTHS.findIndex((m) => m.startsWith(t)) : -1; }

  const DAY_UNITS = /^(день|дні|днів|дня)$/;
  const WEEK_UNITS = /^(тиждень|тижні|тижнів|тижня)$/;
  const MONTH_UNITS = /^(місяць|місяці|місяців|місяця)$/;
  const HOUR_UNITS = /^(год|годин|година|години|годину)$/;
  const MIN_UNITS = /^(хв|хвилин|хвилина|хвилини|хвилину)$/;
  const GRAM_UNITS = /^(г|гр|грам|грамів|грами|грама|g|мл|ml)$/;
  const KG_UNITS = /^(кг|kg)$/;
  const KCAL_UNITS = /^(ккал|kcal)$/;
  const PCS_UNITS = /^(шт|штук|штуки|штука|штуку)$/;
  const PORTION_WORDS = /^(скиб|склян|порці|ложк|чашк|тарілк)/;
  const CUR = new Map([
    ['грн', 'UAH'], ['гривень', 'UAH'], ['гривні', 'UAH'], ['гривня', 'UAH'], ['гривню', 'UAH'], ['₴', 'UAH'], ['uah', 'UAH'],
    ['$', 'USD'], ['usd', 'USD'], ['дол', 'USD'], ['долар', 'USD'], ['долари', 'USD'], ['доларів', 'USD'], ['баксів', 'USD'], ['бакси', 'USD'],
    ['€', 'EUR'], ['eur', 'EUR'], ['євро', 'EUR']
  ]);
  const CUR_SIGN = { '$': 'USD', '€': 'EUR', '₴': 'UAH' };
  const DAYPART = { 'ранку': 'am', 'зранку': 'am', 'вечора': 'pm', 'ввечері': 'pm', 'дня': 'pm', 'ночі': 'night' };
  const MEAL_WORDS = {
    'сніданок': 'breakfast', 'сніданку': 'breakfast', 'обід': 'lunch', 'обіду': 'lunch',
    'вечеря': 'dinner', 'вечерю': 'dinner', 'вечері': 'dinner', 'перекус': 'snack', 'перекусу': 'snack'
  };
  const PRIO_WORDS = new Set(['терміново', 'важливо', 'важливе', 'важлива']);
  const CASH_WORDS = new Set(['готівка', 'готівкою', 'готівки', 'кеш', 'кешем', 'cash', 'налом']);
  const INCOME_RE = /^(зарплат|зп$|аванс|премі|стипенді|кешбек|дохід|доходу)/;
  const PREPS = new Set(['о', 'об', 'у', 'в', 'во', 'на', 'з', 'із', 'зі', 'до', 'по']);
  const DASH = /^[-–—]$/;

  // ---------- Розбір рядка (чиста функція, без даних) ----------
  function tokenize(text) {
    const out = [];
    String(text || '').replace(/\S+/g, (raw) => {
      let n = U.normalize(raw).replace(/^[«"“„(\[]+/, '').replace(/[»"”)\],;]+$/, '');
      if (n.length > 1 && n.endsWith('.')) n = n.slice(0, -1);
      let bang = false;
      if (n.length > 1 && /[^!]!+$/.test(n)) { bang = true; n = n.replace(/!+$/, ''); }
      out.push({ raw, n, tag: null, bang });
      return raw;
    });
    return out;
  }
  const free = (T, i) => i >= 0 && i < T.length && !T[i].tag;
  function mark(T, from, to, tag) { for (let k = from; k <= to; k++) T[k].tag = tag; }
  const numOf = (s) => Number(String(s).replace(',', '.'));

  /** «15:00», «9.30», «15» (голе число — лише якщо bare) → хвилини від початку доби. */
  function clock(t, bare) {
    let m = /^(\d{1,2})[:.](\d{2})$/.exec(t);
    if (m) {
      const hh = Number(m[1]);
      const mm = Number(m[2]);
      return hh > 24 || mm > 59 || hh * 60 + mm > 1440 ? null : hh * 60 + mm;
    }
    m = bare ? /^(\d{1,2})$/.exec(t) : null;
    return m && Number(m[1]) <= 24 ? Number(m[1]) * 60 : null;
  }
  /** «12.11», «5.01.2027» — схоже на дату (місяць 1–12). */
  function isDotDate(t) {
    const m = /^(\d{1,2})[./](\d{1,2})(?:[./](\d{2}|\d{4}))?$/.exec(t);
    return !!m && Number(m[2]) >= 1 && Number(m[2]) <= 12 && Number(m[1]) >= 1 && Number(m[1]) <= 31;
  }
  function isUnit(n) {
    return HOUR_UNITS.test(n) || MIN_UNITS.test(n) || GRAM_UNITS.test(n) || KG_UNITS.test(n) || KCAL_UNITS.test(n) ||
      PCS_UNITS.test(n) || CUR.has(n) || DAY_UNITS.test(n) || WEEK_UNITS.test(n) || MONTH_UNITS.test(n) ||
      monthOf(n) >= 0 || PORTION_WORDS.test(n) || /^(раз|рази|разів|клас|класі|людин|людини|людей|сторін|кг)/.test(n);
  }
  /** «ранку / вечора / дня / ночі» після часу. */
  function dayPart(T, j, min) {
    if (!free(T, j) || !DAYPART[T[j].n]) return null;
    const p = DAYPART[T[j].n];
    let hh = Math.floor(min / 60);
    if (p === 'pm' && hh < 12) hh += 12;
    if ((p === 'night' || p === 'am') && hh === 12) hh = 0;
    return { min: hh * 60 + (min % 60), pm: p === 'pm' };
  }
  /** Час з індексу j: { min, last, pm }. */
  function timeAt(T, j, bare) {
    if (!free(T, j)) return null;
    const min = clock(T[j].n, bare);
    if (min == null || min >= 1440) return null;
    const dp = dayPart(T, j + 1, min);
    return dp ? { min: dp.min, last: j + 1, pm: dp.pm } : { min, last: j, pm: false };
  }
  /** Кінець після початку: «- 16:30», «до 17», «–17 вечора». */
  function endAt(T, k, start) {
    if (!free(T, k)) return null;
    const n = T[k].n;
    let j;
    let glued = null;
    if (DASH.test(n) || n === 'до' || n === 'по') j = k + 1;
    else if (/^[-–—]\d/.test(n)) glued = n.slice(1);
    else return null;
    let e = glued != null ? clock(glued, true) : (free(T, j) ? clock(T[j].n, true) : null);
    if (e == null) return null;
    let last = glued != null ? k : j;
    let pm = false;
    const dp = dayPart(T, last + 1, e);
    if (dp) { e = dp.min; last += 1; pm = dp.pm; }
    if (e <= start && e < 720 && e + 720 > start) e += 720;   // «з 11 до 2» → до 14:00
    if (e <= start || e > 1440) return null;
    return { min: e, last, pm };
  }
  function setTime(P, T, from, last, start, end) {
    mark(T, from, last, 'time');
    P.time = { start, end: end == null ? null : end };
  }
  function passTime(T, P) {
    for (let i = 0; i < T.length && !P.time; i++) {
      if (!free(T, i)) continue;
      const n = T[i].n;
      // 1) «15:00-16:30», «18-19:30», «15–17» одним словом
      const m = /^(\d{1,2}(?:[:.]\d{2})?)[-–—](\d{1,2}(?:[:.]\d{2})?)$/.exec(n);
      if (m) {
        let s = clock(m[1], true);
        let e = clock(m[2], true);
        const prep = free(T, i - 1) && /^(о|об|з|із|в|у|во)$/.test(T[i - 1].n);
        if (s != null && e != null && s < 1440 && e > s && (/[:.]/.test(n) || prep || s >= 360)) {
          let last = i;
          const dp = dayPart(T, i + 1, e);
          if (dp) { e = dp.min; last = i + 1; if (dp.pm && s < 720 && s + 720 < e) s += 720; }
          setTime(P, T, prep ? i - 1 : i, last, s, e);
          break;
        }
      }
      // 2) «о 15», «об 11:30», «з 15 до 17», «в 18:00», «на 9:30»
      const strong = /^(о|об|з|із)$/.test(n);
      const soft = /^(в|у|во)$/.test(n);
      const colonOnly = /^(на|до)$/.test(n);
      if ((strong || soft || colonOnly) && free(T, i + 1)) {
        const tn = T[i + 1].n;
        const colon = /^\d{1,2}[:.]\d{2}$/.test(tn) && (strong || !isDotDate(tn) || tn.includes(':'));
        const bareNum = /^\d{1,2}$/.test(tn) && !(free(T, i + 2) && isUnit(T[i + 2].n)) &&
          (strong || (soft && Number(tn) >= 6 && Number(tn) <= 23));
        if (colon || bareNum) {
          const st = timeAt(T, i + 1, true);
          if (st) {
            const en = endAt(T, st.last + 1, st.min);
            let s = st.min;
            if (en && en.pm && s < 720 && s + 720 < en.min) s += 720;
            if (n === 'до') P.deadline = true;
            setTime(P, T, i, en ? en.last : st.last, s, en ? en.min : null);
            break;
          }
        }
      }
      // 3) «15:00» (або «15.30», якщо це не дата) окремо
      if (/^\d{1,2}:\d{2}$/.test(n) || (/^\d{1,2}\.\d{2}$/.test(n) && !isDotDate(n))) {
        const st = timeAt(T, i, false);
        if (st) {
          const en = endAt(T, st.last + 1, st.min);
          setTime(P, T, i, en ? en.last : st.last, st.min, en ? en.min : null);
          break;
        }
      }
    }
  }
  /** Тривалість: «на 2 год», «1,5 год», «90 хв», «на годину», «півгодини» (лише коли є час). */
  function passDuration(T, P) {
    if (!P.time || P.time.end != null) return;
    for (let i = 0; i < T.length; i++) {
      if (!free(T, i)) continue;
      const from = T[i].n === 'на' && free(T, i + 1) ? i : -1;
      const j = from >= 0 ? i + 1 : i;
      const n = T[j].n;
      let min = null;
      let last = j;
      let m = /^(\d+(?:[.,]\d+)?)(год|хв)$/.exec(n);
      if (m) min = m[2] === 'год' ? numOf(m[1]) * 60 : numOf(m[1]);
      else if (/^\d+(?:[.,]\d+)?$/.test(n) && free(T, j + 1) && (HOUR_UNITS.test(T[j + 1].n) || MIN_UNITS.test(T[j + 1].n))) {
        min = HOUR_UNITS.test(T[j + 1].n) ? numOf(n) * 60 : numOf(n);
        last = j + 1;
      } else if (n === 'півгодини') min = 30;
      else if (n === 'пів' && free(T, j + 1) && /^годин/.test(T[j + 1].n)) { min = 30; last = j + 1; }
      else if (from >= 0 && n === 'годину') min = 60;
      if (min == null) continue;
      min = Math.round(min);
      if (min < 5 || min > 1440) continue;
      mark(T, from >= 0 ? from : j, last, 'dur');
      P.dur = min;
      return;
    }
  }
  function passDate(T, P, today) {
    const ty = D.parse(today).y;
    for (let i = 0; i < T.length && !P.date; i++) {
      if (!free(T, i)) continue;
      const n = T[i].n;
      let date = null;
      let from = i;
      let last = i;
      let noYear = false;
      let m;
      if (Object.prototype.hasOwnProperty.call(REL, n)) date = D.addDays(today, REL[n]);
      else if (WEEKDAY.has(n)) {
        const wd = WEEKDAY.get(n);
        let next = false;
        if (free(T, i - 1) && (THIS_WORDS.has(T[i - 1].n) || NEXT_RE.test(T[i - 1].n))) { next = NEXT_RE.test(T[i - 1].n); from = i - 1; }
        date = next ? D.addDays(D.startOfWeek(today), 7 + wd) : D.addDays(today, (wd - D.weekday(today) + 7) % 7);
      } else if (n === 'через') {
        let j = i + 1;
        let k = 1;
        if (free(T, j) && /^\d{1,3}$/.test(T[j].n)) { k = Number(T[j].n); j++; }
        if (free(T, j)) {
          const u = T[j].n;
          if (DAY_UNITS.test(u)) date = D.addDays(today, k);
          else if (WEEK_UNITS.test(u)) date = D.addDays(today, 7 * k);
          else if (MONTH_UNITS.test(u)) date = D.addMonths(today, k);
          if (date) last = j;
        }
      } else if ((m = /^(\d{1,2})[./](\d{1,2})(?:[./](\d{2}|\d{4}))?$/.exec(n))) {
        const dd = Number(m[1]);
        const mm = Number(m[2]);
        const yy = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : ty;
        if (mm >= 1 && mm <= 12 && dd >= 1 && dd <= D.daysInMonth(yy, mm)) { date = D.make(yy, mm, dd); noYear = !m[3]; }
      } else if (/^\d{1,2}$/.test(n) && free(T, i + 1) && monthOf(T[i + 1].n) >= 0) {
        const dd = Number(n);
        const mm = monthOf(T[i + 1].n) + 1;
        let yy = ty;
        last = i + 1;
        noYear = true;
        if (free(T, i + 2) && /^20\d\d$/.test(T[i + 2].n)) {
          yy = Number(T[i + 2].n);
          last = i + 2;
          noYear = false;
          if (free(T, i + 3) && /^(р|року|рік)$/.test(T[i + 3].n)) last = i + 3;
        }
        if (dd >= 1 && dd <= D.daysInMonth(yy, mm)) date = D.make(yy, mm, dd);
      }
      if (!date) continue;
      if (free(T, from - 1) && /^(на|у|в|во|до|з|із)$/.test(T[from - 1].n)) {
        if (T[from - 1].n === 'до') P.deadline = true;
        from -= 1;
      }
      mark(T, from, last, 'date');
      P.date = { value: date, noYear };
    }
  }
  /** «80 г», «80г», «0,3 кг», «650 ккал», «2 шт», «2 скибки». */
  function passFood(T, P) {
    for (let i = 0; i < T.length && !P.food; i++) {
      if (!free(T, i)) continue;
      const n = T[i].n;
      let v = null;
      let u = null;
      let last = i;
      const m = /^(\d+(?:[.,]\d+)?)(г|гр|кг|мл|ккал|шт)$/.exec(n);
      if (m) { v = numOf(m[1]); u = m[2]; }
      else if (/^\d+(?:[.,]\d+)?$/.test(n) && free(T, i + 1)) { v = numOf(n); u = T[i + 1].n; last = i + 1; }
      if (v == null || !(v > 0)) continue;
      if (GRAM_UNITS.test(u)) P.food = { grams: v };
      else if (KG_UNITS.test(u)) P.food = { grams: v * 1000 };
      else if (KCAL_UNITS.test(u)) P.food = { kcal: v };
      else if (PCS_UNITS.test(u)) P.food = { count: v, word: 'шт' };
      else if (PORTION_WORDS.test(u)) P.food = { count: v, word: u };
      else continue;
      mark(T, i, last, 'food');
    }
  }
  /** Сума: «65», «65 грн», «65₴», «$8», «8 дол», «+15000», «1 200,50». */
  function passMoney(T, P) {
    const cands = [];
    for (let i = 0; i < T.length; i++) {
      if (!free(T, i)) continue;
      let j = i;
      let sign = null;
      if (/^[+\-−]$/.test(T[i].n) && free(T, i + 1)) { sign = T[i].n === '+' ? '+' : '-'; j = i + 1; }
      const m = /^([+\-−])?([$€₴])?(\d+(?:[.,]\d{1,2})?)([$€₴]|грн|uah|usd|eur|дол|євро)?$/.exec(T[j].n);
      if (!m) continue;
      if (m[1]) sign = m[1] === '+' ? '+' : '-';
      let raw = m[3];
      let cur = m[2] ? CUR_SIGN[m[2]] : m[4] ? (CUR_SIGN[m[4]] || CUR.get(m[4])) : null;
      let last = j;
      // тисячі окремим словом: «1 200», «12 500,50»
      if (!m[4] && /^\d{1,3}$/.test(raw) && free(T, j + 1)) {
        const t = /^(\d{3}(?:[.,]\d{1,2})?)([$€₴]|грн|uah|usd|eur|дол|євро)?$/.exec(T[j + 1].n);
        if (t) { raw += t[1]; last = j + 1; if (t[2]) cur = CUR_SIGN[t[2]] || CUR.get(t[2]); }
      }
      if (!cur && free(T, last + 1) && CUR.has(T[last + 1].n)) { cur = CUR.get(T[last + 1].n); last += 1; }
      const amount = numOf(raw);
      if (!(amount > 0)) { i = last; continue; }
      cands.push({ from: i, last, amount: U.round2(amount), cur, sign });
      i = last;
    }
    const pick = cands.find((c) => c.cur) || cands.find((c) => c.sign) || cands[cands.length - 1];
    if (!pick) return;
    mark(T, pick.from, pick.last, 'money');
    P.money = { amount: pick.amount, cur: pick.cur, sign: pick.sign };
  }
  function passWords(T, P) {
    T.forEach((t, i) => {
      if (t.tag) return;
      if (t.n === '!' || t.n === '!!' || PRIO_WORDS.has(t.n)) { t.tag = 'prio'; P.prio = true; return; }
      if (t.bang) P.prio = true;
      if (!P.meal && MEAL_WORDS[t.n]) {
        P.meal = MEAL_WORDS[t.n];
        t.tag = 'meal';
        if (free(T, i - 1) && T[i - 1].n === 'на') T[i - 1].tag = 'meal';
        return;
      }
      if (CASH_WORDS.has(t.n)) { t.tag = 'cash'; P.cash = true; return; }
      if (INCOME_RE.test(t.n)) P.incomeWord = true;
    });
  }

  /**
   * Розібрати рядок. Повертає { tokens, time, dur, date, food, money, meal, prio, cash, deadline, incomeWord }
   * або null для порожнього рядка. today — 'РРРР-ММ-ДД' (для тестів), за замовчуванням — сьогодні за Києвом.
   */
  function parse(text, today) {
    const T = tokenize(text);
    if (!T.length) return null;
    const P = { tokens: T, time: null, dur: null, date: null, food: null, money: null, meal: null, prio: false, cash: false, deadline: false, incomeWord: false };
    const day = today || D.today();
    P.today = day;
    passTime(T, P);
    passDuration(T, P);
    passDate(T, P, day);
    passFood(T, P);
    passMoney(T, P);
    passWords(T, P);
    return P;
  }

  /** Назва без розпізнаних частин. drop — теги, які прибрати; extra — номери слів (напр., рахунок). */
  function words(P, drop, extra) {
    const skip = new Set(drop);
    const ex = new Set(extra || []);
    let list = P.tokens.filter((t, i) => !(t.tag && skip.has(t.tag)) && !ex.has(i))
      .map((t) => (t.bang ? t.raw.replace(/!+$/, '') : t.raw));
    const isPrep = (s) => PREPS.has(U.normalize(s)) || /^[-–—:,.]+$/.test(s);
    while (list.length && isPrep(list[0])) list.shift();
    while (list.length && isPrep(list[list.length - 1])) list.pop();
    const s = list.join(' ').replace(/\s+/g, ' ').trim();
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : '';
  }
  /** Дата для виду запису: без року — найближча в майбутньому (події, задачі) або в минулому (гроші, їжа). */
  function dateFor(P, kind) {
    if (!P.date) return null;
    let d = P.date.value;
    if (P.date.noYear) {
      if ((kind === 'event' || kind === 'task') && d < P.today) d = D.addYears(d, 1);
      if ((kind === 'expense' || kind === 'income' || kind === 'meal') && d > P.today) d = D.addYears(d, -1);
    }
    return d;
  }

  // ---------- Допоміжне для варіантів ----------
  const hhmm = (min) => `${D.pad(Math.floor(min / 60))}:${D.pad(min % 60)}`;
  const toMin = (s) => { const m = /^(\d{1,2}):(\d{2})$/.exec(s || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
  function dayShort(d) { return `${CRM.WEEKDAYS_SHORT[D.weekday(d)]}, ${fmt.dateShort(d)}`; }
  function relDay(d) {
    const diff = D.diffDays(D.today(), d);
    if (diff === 0) return 'сьогодні';
    if (diff === 1) return 'завтра';
    if (diff === -1) return 'вчора';
    return dayShort(d);
  }
  function lsGet(key, def) { try { const v = localStorage.getItem(key); return v == null ? def : v; } catch (e) { return def; } }
  const same = (a, b) => U.normalize(a) === U.normalize(b);
  function newest(list, field) {
    let best = null;
    list.forEach((r) => {
      const k = (field && r[field] ? r[field] : '') + '|' + (r.createdAt || '');
      if (!best || k > best.k) best = { r, k };
    });
    return best ? best.r : null;
  }
  /** Основа слова для порівняння з назвами: «аптеку» → «апте», «кави» → «кав». */
  function stem(w) { return w.length <= 5 ? w.slice(0, w.length - 1) : w.slice(0, w.length - 2); }
  const wordsOf = (s) => U.normalize(s).split(/[^a-zа-яіїєґ0-9']+/).filter(Boolean);

  // Ключові слова → категорія Бюджету (назви стартових категорій; «*» — початок слова)
  const TX_DICT = {
    expense: [
      [['кава', 'кави', 'каву', "кав'ярн*", 'капучино', 'лате', 'латте', 'еспресо', 'американо', 'раф', 'флетвайт'], 'Кафе й ресторани', 'Кава'],
      [['доставка', 'доставку', 'глово', 'glovo'], 'Кафе й ресторани', 'Доставка їжі'],
      [['кафе', 'ресторан*', 'обід', 'обіди', 'вечеря', 'вечерю', 'сніданок', 'ланч', 'піца', 'піцу', 'суші', 'бургер*', 'шаурм*', 'шаверм*', 'макдональдс', 'kfc', 'пиво'], 'Кафе й ресторани'],
      [['супермаркет*', 'сільпо', 'атб', 'новус', 'novus', 'ашан', 'auchan', 'варус', 'фора'], 'Продукти', 'Супермаркет'],
      [['ринок', 'базар*'], 'Продукти', 'Ринок'],
      [['продукт*', 'хліб', 'молоко', 'овоч*', 'фрукт*', "м'ясо", 'яйця', 'їжа'], 'Продукти'],
      [['таксі', 'uklon', 'уклон', 'uber', 'убер', 'bolt', 'болт'], 'Транспорт', 'Таксі'],
      [['метро', 'маршрутк*', 'автобус*', 'трамва*', 'тролейбус*', 'проїзд*', 'електричк*', 'потяг*'], 'Транспорт', 'Громадський транспорт'],
      [['бензин*', 'пальне', 'заправк*', 'дизель', 'окко', 'wog'], 'Транспорт', 'Пальне'],
      [['оренд*'], 'Житло й комунальні', 'Оренда'],
      [['комуналк*', 'комунальн*', 'світло', 'електроенерг*', 'газ', 'вода', 'опаленн*'], 'Житло й комунальні', 'Комунальні послуги'],
      [['мобільн*', 'київстар', 'vodafone', 'водафон', 'lifecell', 'лайфсел*'], 'Звʼязок та інтернет', 'Мобільний'],
      [['інтернет*'], 'Звʼязок та інтернет', 'Інтернет'],
      [['аптек*', 'ліки', 'вітамін*'], 'Здоровʼя', 'Аптека'],
      [['лікар*', 'стоматолог*', 'аналіз*', 'клінік*'], 'Здоровʼя', 'Лікарі'],
      [['одяг*', 'взутт*', 'кросівк*', 'футболк*', 'джинс*', 'куртк*', 'штани', 'светр*'], 'Одяг і взуття'],
      [['кіно'], 'Розваги', 'Кіно'],
      [['концерт*'], 'Розваги', 'Концерти'],
      [['гра', 'ігри', 'steam', 'playstation'], 'Розваги', 'Ігри'],
      [['розваг*', 'боулінг*', 'театр*'], 'Розваги'],
      [['курс', 'курси', 'курсу'], 'Освіта', 'Курси'],
      [['книг*', 'книжк*'], 'Освіта', 'Книги'],
      [['абонемент*', 'спортзал*', 'фітнес*', 'басейн*'], 'Спорт', 'Абонемент'],
      [['спорядженн*', 'гантел*'], 'Спорт', 'Спорядження'],
      [['подарун*', 'квіти', 'букет*'], 'Подарунки'],
      [['підписк*', 'netflix', 'нетфлікс', 'spotify', 'youtube', 'ютуб', 'icloud', 'chatgpt', 'claude'], 'Підписки']
    ],
    income: [
      [['аванс*'], 'Зарплата', 'Аванс'],
      [['премі*'], 'Зарплата', 'Премія'],
      [['зарплат*', 'зп'], 'Зарплата'],
      [['стипенді*'], 'Стипендія'],
      [['фриланс*', 'замовленн*', 'урок*', 'репетитор*'], 'Фриланс'],
      [['подарун*'], 'Подарунки'],
      [['кешбек*', 'відсот*', 'депозит*'], 'Кешбек і відсотки']
    ]
  };
  const EVENT_DICT = [
    [['лікар*', 'стоматолог*', 'аналіз*', 'спортзал*', 'тренуванн*', 'пробіжк*', 'біг', 'басейн*', 'йога', 'масаж*'], 'health'],
    [['зустріч*', 'мітинг*', 'дзвінок', 'созвон*', 'нарада', 'співбесід*'], 'meeting'],
    [['пара', 'пари', 'лекці*', 'семінар*', 'іспит*', 'екзамен*', 'залік*', 'консультаці*', 'вебінар*'], 'study']
  ];
  function dictHit(keys, ws) {
    return keys.some((k) => (k.endsWith('*') ? ws.some((w) => w.startsWith(k.slice(0, -1))) : ws.includes(k)));
  }

  // ---------- Подія ----------
  function lastCat() {
    const c = lsGet('crm.cal.cat', 'personal');
    const cats = (CRM.calendar && CRM.calendar.CATEGORIES) || [];
    return cats.some((x) => x.id === c) ? c : 'personal';
  }
  function buildEvent(P) {
    const title = words(P, ['date', 'time', 'dur', 'prio']);
    if (!title) return null;
    const date = dateFor(P, 'event') || P.today;
    const hist = newest(CRM.store.list('events').filter((e) => same(e.title, title)), 'updatedAt');
    const ws = wordsOf(title);
    const dictCat = (EVENT_DICT.find(([keys]) => dictHit(keys, ws)) || [])[1];
    const cat = hist && hist.cat ? hist.cat : dictCat || lastCat();
    let rec;
    if (P.time) {
      const start = P.time.start;
      let dur = P.time.end != null ? P.time.end - start : P.dur || (hist && !hist.allDay && hist.dur) || 60;
      dur = Math.max(5, Math.min(dur, 1440 - start));
      const remind = hist && !hist.allDay && hist.remind !== undefined ? hist.remind : 15;
      rec = { title, date, allDay: false, start: hhmm(start), dur, cat, remind, note: '' };
    } else {
      rec = { title, date, allDay: true, start: null, dur: null, cat, remind: null, note: '' };
    }
    const parts = [dayShort(date), rec.allDay ? 'весь день' : `${rec.start}–${hhmm(toMin(rec.start) + rec.dur)}`, CRM.calendar.categoryName(cat)];
    const problem = CRM.db.SCHEMA.events ? null : 'Браузер показує стару версію сайту — онови сторінку (Ctrl+F5).';
    return { kind: 'event', label: 'Подія', icon: 'calendar', iconClass: 'ico-event', title, parts, rec, ok: !problem, problem };
  }

  // ---------- Задача ----------
  function buildTask(P) {
    const title = words(P, ['date', 'time', 'dur', 'prio']);
    if (!title) return null;
    const rec = { title, priority: P.prio ? 'high' : 'medium' };
    const parts = [];
    const start = P.time ? P.time.start : null;
    if (P.deadline && (P.date || P.time)) {
      rec.deadline = dateFor(P, 'task') || P.today;
      rec.deadlineTime = start != null ? hhmm(start) : null;
      parts.push(`Дедлайн: ${dayShort(rec.deadline)}${rec.deadlineTime ? ', ' + rec.deadlineTime : ''}`);
    } else if (P.date || P.time) {
      rec.planDate = dateFor(P, 'task') || P.today;
      if (start != null) {
        rec.planStart = hhmm(start);
        rec.planDur = P.time.end != null ? P.time.end - start : P.dur || null;
        const dur = Math.min(rec.planDur || (CRM.calendar ? CRM.calendar.TASK_DUR : 30), 1440 - start);
        parts.push(`План дня: ${dayShort(rec.planDate)}, ${rec.planStart}–${hhmm(start + dur)}`);
      } else {
        parts.push(`План дня: ${dayShort(rec.planDate)}`);
      }
    } else {
      parts.push('без дати');
    }
    if (P.prio) parts.push('високий пріоритет');
    return { kind: 'task', label: 'Задача', icon: 'tasks', iconClass: 'ico-task', title, parts, rec, ok: true, problem: null };
  }

  // ---------- Витрата / дохід ----------
  const LAT = { а: 'a', б: 'b', в: 'v', г: 'h', ґ: 'g', д: 'd', е: 'e', є: 'ie', ж: 'zh', з: 'z', и: 'y', і: 'i', ї: 'i', й: 'i', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'kh', ц: 'ts', ч: 'ch', ш: 'sh', щ: 'sch', ь: '', ю: 'iu', я: 'ia', "'": '' };
  function latin(w) { return w.split('').map((c) => (LAT[c] !== undefined ? LAT[c] : c)).join('').replace(/y/g, 'i'); }
  /** Слово з рядка, що називає рахунок: «моно» → «Monobank», «приват» → «ПриватБанк». */
  function accountByWord(P, accounts) {
    for (let i = 0; i < P.tokens.length; i++) {
      const t = P.tokens[i];
      if (t.tag || t.n.length < 3 || !/^[a-zа-яіїєґ']+$/.test(t.n)) continue;
      const s = t.n.length >= 4 ? t.n : null;
      const hit = accounts.find((a) => wordsOf(a.name).some((w) => {
        if (w.length < 3) return false;
        if (w === t.n) return true;
        if (!s) return false;
        const a1 = w.replace(/y/g, 'i');
        return w.startsWith(s) || latin(w).startsWith(latin(s)) || a1.startsWith(latin(s));
      }));
      if (hit) return { account: hit, index: i };
    }
    return null;
  }
  function categoryById(id, kind) {
    const c = id ? CRM.store.get('categories', id) : null;
    return c && !c.deletedAt && c.kind === kind ? c : null;
  }
  function guessCategory(kind, comment, hist) {
    const cats = CRM.store.list('categories').filter((c) => c.kind === kind)
      .sort((a, b) => (a.order || 0) - (b.order || 0));
    if (!cats.length) return null;
    // 1) як минулого разу
    if (hist) {
      const c = categoryById(hist.categoryId, kind);
      if (c) {
        const sub = (c.subcategories || []).find((s) => s.id === hist.subcategoryId);
        return { cat: c, sub: sub || null };
      }
    }
    const ws = wordsOf(comment).filter((w) => w.length >= 4);
    // 2) слово з рядка є в назві підкатегорії чи категорії
    if (ws.length) {
      const matchName = (name) => wordsOf(name).some((nw) => nw.length >= 4 && ws.some((w) => nw.startsWith(stem(w)) && stem(w).length >= 3));
      for (const c of cats) {
        const sub = (c.subcategories || []).find((s) => matchName(s.name));
        if (sub) return { cat: c, sub };
      }
      const c = cats.find((x) => matchName(x.name));
      if (c) return { cat: c, sub: null };
    }
    // 3) словник
    const all = wordsOf(comment);
    for (const [keys, catName, subName] of TX_DICT[kind]) {
      if (!dictHit(keys, all)) continue;
      const c = cats.find((x) => same(x.name, catName));
      if (!c) continue;
      const sub = subName ? (c.subcategories || []).find((s) => same(s.name, subName)) : null;
      return { cat: c, sub: sub || null };
    }
    // 4) «Інше»
    return { cat: cats.find((x) => same(x.name, 'Інше')) || cats[cats.length - 1], sub: null, fallback: true };
  }
  function ranked() {
    try { return CRM.finance.rankedAccounts().map((x) => x.account); } catch (e) { return CRM.store.list('accounts'); }
  }
  function settings() { return CRM.store.getSetting('quickInput', null) || {}; }
  function buildTx(P, kind) {
    if (!P.money || !CRM.budget) return null;
    const accounts = ranked().filter((a) => !a.deletedAt && !a.archived);
    const explicit = accounts.length ? accountByWord(P, accounts) : null;
    const comment = words(P, ['date', 'money', 'time', 'dur', 'cash', 'prio', 'food'], explicit ? [explicit.index] : null);
    const amount = P.money.amount;
    const hist = comment ? newest(CRM.store.list('transactions').filter((t) => t.type === kind && same(t.comment, comment)), 'date') : null;
    const guess = guessCategory(kind, comment, hist);
    const cur = P.money.cur;
    const fits = (a) => a && (!cur || a.currency === cur);
    const byId = (id) => accounts.find((a) => a.id === id) || null;
    let account = null;
    if (explicit && fits(explicit.account)) account = explicit.account;
    if (!account && P.cash) account = accounts.find((a) => a.type === 'cash' && fits(a)) || null;
    if (!account && hist && fits(byId(hist.accountId))) account = byId(hist.accountId);
    if (!account && fits(byId(settings().accountId))) account = byId(settings().accountId);
    if (!account) {
      const last = CRM.store.getSetting('budget.lastAccount', {}) || {};
      const id = last[kind] || last.any;
      if (fits(byId(id))) account = byId(id);
    }
    if (!account) account = accounts.find((a) => fits(a) && a.type !== 'savings' && (cur || a.currency === 'UAH')) || accounts.find(fits) || null;

    let problem = null;
    if (!accounts.length) problem = 'Спершу додай рахунок у «Бюджеті» — Enter відкриє форму.';
    else if (!account) problem = `Немає рахунку в ${cur === 'USD' ? 'доларах' : cur === 'EUR' ? 'євро' : 'гривнях'} — Enter відкриє форму, там вибери рахунок.`;
    else if (!guess) problem = `Немає категорій ${kind === 'income' ? 'доходів' : 'витрат'} — Enter відкриє форму.`;
    const currency = account ? account.currency : (cur || 'UAH');
    const rec = {
      type: kind, amount, accountId: account ? account.id : null, toAccountId: null, toAmount: null,
      categoryId: guess ? guess.cat.id : null, subcategoryId: guess && guess.sub ? guess.sub.id : null,
      date: dateFor(P, kind) || P.today, comment, recurringId: null, recurringDate: null
    };
    const money = fmt.money(kind === 'income' ? amount : -amount, currency, { sign: true });
    const parts = [money];
    if (guess) parts.push(guess.cat.name + (guess.sub ? ' › ' + guess.sub.name : ''));
    if (account) parts.push(account.name);
    parts.push(relDay(rec.date));
    return {
      kind, label: kind === 'income' ? 'Дохід' : 'Витрата', icon: kind === 'income' ? 'trendUp' : 'receipt', iconClass: 'ico-payment',
      title: comment || (guess ? guess.cat.name : kind === 'income' ? 'Дохід' : 'Витрата'), parts, rec, ok: !problem, problem
    };
  }

  // ---------- Їжа ----------
  function mealByTime() {
    const hh = D.kyivParts().hh;
    if (hh >= 4 && hh < 11) return 'breakfast';
    if (hh >= 11 && hh < 16) return 'lunch';
    if (hh >= 16 && hh < 21) return 'dinner';
    return 'snack';
  }
  const r1 = (v) => Math.round((Number(v) || 0) * 10) / 10;
  function gramsText(g) { return fmt.number(g, g < 10 && Math.round(g) !== g ? 1 : 0).replace(/,0$/, '') + ' г'; }
  function buildMeal(P) {
    if (!CRM.nutrition) return null;
    const asGrams = !P.food && P.money && !P.money.cur && !P.money.sign;
    if (!P.food && !asGrams) return null;
    const name = words(P, ['date', 'time', 'dur', 'food', 'meal', 'prio'].concat(asGrams ? ['money'] : []));
    const date = dateFor(P, 'meal') || P.today;
    const meal = P.meal || mealByTime();
    const mealName = CRM.dict.label('mealTypes', meal) || 'Перекус';
    const base = { kind: 'meal', label: 'Їжа', icon: 'utensils', iconClass: 'ico-goal', mealName };
    if (P.food && P.food.kcal) {
      const title = name || mealName;
      const rec = { date, meal, name: title, foodId: null, grams: null, per100: null, portion: null, manual: { kcal: r1(P.food.kcal), p: 0, f: 0, c: 0 } };
      return Object.assign(base, { title, parts: [`${fmt.number(Math.round(P.food.kcal), 0)} ккал`, mealName, relDay(date)], rec, ok: true, problem: null });
    }
    if (!name) return null;
    const food = CRM.nutrition.searchFoods(name, 1)[0] || null;
    const f = P.food || { grams: P.money.amount };
    let grams = f.grams || null;
    let portion = null;
    let problem = null;
    if (!food) problem = `«${name}» немає в довіднику — Enter відкриє «Додати їжу».`;
    else if (f.count) {
      const pw = food.portion && food.portion.grams > 0 ? food.portion : null;
      const okWord = pw && (f.word === 'шт' || U.normalize(pw.label).startsWith(f.word.slice(0, 4)));
      if (pw && okWord) { grams = f.count * pw.grams; portion = { label: pw.label, grams: pw.grams, count: r1(f.count) }; }
      else problem = `Для «${food.name}» немає порції — напиши вагу в грамах, напр. «${name} 100 г».`;
    }
    if (!problem && !(grams > 0 && grams <= 5000)) problem = 'Вага — від 1 г до 5 кг.';
    const title = food ? food.name : name;
    const parts = [];
    if (grams) parts.push(portion ? `${fmt.number(portion.count, 1).replace(/,0$/, '')} ${portion.label} (${gramsText(grams)})` : gramsText(grams));
    if (food && grams && !problem) parts.push(`${fmt.number(Math.round(food.kcal * grams / 100), 0)} ккал`);
    parts.push(mealName, relDay(date));
    const rec = food ? {
      date, meal, name: food.name, foodId: food.id, grams: r1(grams), manual: null, portion,
      per100: { kcal: r1(food.kcal), p: r1(food.p), f: r1(food.f), c: r1(food.c) }
    } : null;
    return Object.assign(base, { title, parts, rec, food, grams, query: name, ok: !problem, problem });
  }

  // ---------- Варіанти ----------
  const ORDER = ['event', 'task', 'expense', 'income', 'meal'];
  function primaryKind(P) {
    if (P.food) return 'meal';
    if (P.deadline && (P.date || P.time)) return 'task';
    if (P.time) return 'event';
    if (P.money) return P.money.sign === '+' || (P.incomeWord && P.money.sign !== '-') ? 'income' : 'expense';
    return 'task';
  }
  /**
   * Що можна створити з рядка. Повертає { strong, options: [...], index } або null.
   * strong — у рядку є час, дата, сума чи вага (тоді картка — над результатами пошуку).
   * prefer — вид, який людина вибрала перемикачем (зберігається, поки вона дописує рядок).
   */
  function plan(text, prefer, today) {
    const raw = String(text || '').trim();
    if (raw.length < 2) return null;
    const P = parse(raw, today);
    if (!P) return null;
    const strong = !!(P.time || P.date || P.food || P.money);
    const built = {};
    if (CRM.calendar && CRM.calendar.categoryName) built.event = buildEvent(P);
    if (CRM.tasks && CRM.tasks.create) built.task = buildTask(P);
    if (P.money) { built.expense = buildTx(P, 'expense'); built.income = buildTx(P, 'income'); }
    built.meal = buildMeal(P);
    const options = ORDER.map((k) => built[k]).filter(Boolean);
    if (!options.length) return null;
    // «65» без опису — це пошук суми, а не запис
    if (P.money && !P.money.cur && !P.money.sign && !P.food && !P.time && !P.date &&
      !words(P, ['money']).length) return null;
    const want = prefer && options.some((o) => o.kind === prefer) ? prefer : primaryKind(P);
    let index = options.findIndex((o) => o.kind === want);
    if (index < 0) index = 0;
    return { text: raw, strong, options, index, parsed: P };
  }

  // ---------- Створення ----------
  async function create(o) {
    if (!o || !o.ok) return details(o);
    let saved = null;
    let store = null;
    let text = '';
    if (o.kind === 'event') {
      store = 'events';
      saved = await CRM.store.save('events', o.rec);
      text = `Подію додано: ${dayShort(saved.date)}${saved.allDay ? '' : ', ' + saved.start + '–' + hhmm(toMin(saved.start) + saved.dur)}`;
    } else if (o.kind === 'task') {
      store = 'tasks';
      const rec = Object.assign({}, o.rec);
      if (rec.planDate && !rec.planStart) rec.planOrder = CRM.tasks.nextPlanOrder(rec.planDate);
      saved = await CRM.tasks.create(rec);
      text = saved.planDate ? `Задачу додано в «План дня»: ${relDay(saved.planDate)}` : saved.deadline ? `Задачу додано, дедлайн — ${relDay(saved.deadline)}` : 'Задачу додано';
    } else if (o.kind === 'expense' || o.kind === 'income') {
      store = 'transactions';
      saved = await CRM.store.save('transactions', o.rec);
      try { CRM.finance.ensureRatesFor([saved]); } catch (e) { /* курси підвантажаться пізніше */ }
      text = `${o.kind === 'income' ? 'Дохід' : 'Витрату'} додано: ${o.parts[0]} · ${o.parts[1] || ''}`;
    } else if (o.kind === 'meal') {
      store = 'meals';
      saved = await CRM.store.save('meals', o.rec);
      text = `У щоденник: ${saved.name}, ${o.parts[0]}${o.parts[1] && /ккал/.test(o.parts[1]) ? ' (' + o.parts[1] + ')' : ''}`;
    }
    if (!saved) return null;
    const id = saved.id;
    CRM.ui.toast(text, {
      type: 'success', duration: 9000,
      actions: [
        { label: 'Змінити', onClick: () => openSaved(o.kind, id) },
        {
          label: 'Скасувати', onClick: async () => {
            if (!CRM.store.get(store, id)) return;
            await CRM.store.removeForever(store, id);
            CRM.ui.toast('Скасовано — запис не створено');
          }
        }
      ]
    });
    return saved;
  }
  function openSaved(kind, id) {
    if (kind === 'event') return CRM.calendar.openEditor(id);
    if (kind === 'task') return CRM.tasks.openTask(id);
    if (kind === 'expense' || kind === 'income') return CRM.budget.openTxForm({ id });
    if (kind === 'meal') return CRM.nutrition.openEntry(id);
    return null;
  }
  /** «Детальніше»: відкрити звичайну форму, уже заповнену з рядка. */
  function details(o) {
    if (!o) return null;
    const r = o.rec || {};
    if (o.kind === 'event') return CRM.calendar.openEditor(null, r);
    if (o.kind === 'task') {
      const pre = Object.assign({}, r);
      if (pre.planDate && !pre.planStart) pre.planOrder = CRM.tasks.nextPlanOrder(pre.planDate);
      return CRM.tasks.openNew(pre);
    }
    if (o.kind === 'expense' || o.kind === 'income') {
      return CRM.budget.openTxForm({
        type: o.kind, amount: r.amount, accountId: r.accountId || undefined, categoryId: r.categoryId,
        subcategoryId: r.subcategoryId, date: r.date, comment: r.comment
      });
    }
    if (o.kind === 'meal') {
      const meal = r.meal || (o.rec ? o.rec.meal : null);
      return CRM.nutrition.openAdd({ date: r.date, meal: meal || undefined, food: o.food || undefined, grams: o.grams || undefined, query: o.food ? undefined : o.query });
    }
    return null;
  }

  // ---------- Картка «Буде створено» (для вікна пошуку) ----------
  /**
   * pl — результат plan(); handlers: { onKind(kind), onCreate(), onDetails() }.
   */
  function card(pl, handlers) {
    const h = CRM.ui.h;
    const o = pl.options[pl.index];
    const kinds = h('div', { class: 'segmented quick-kinds', role: 'radiogroup', 'aria-label': 'Що створити' },
      pl.options.map((x, i) => h('button', {
        type: 'button', role: 'radio', tabIndex: -1, class: i === pl.index ? 'active' : '', dataset: { kind: x.kind },
        'aria-checked': i === pl.index ? 'true' : 'false',
        onMousedown: (e) => e.preventDefault(),
        onClick: (e) => { e.stopPropagation(); handlers.onKind(x.kind); }
      }, x.label)));
    return h('div', { class: 'quick-card' + (pl.strong ? '' : ' quick-weak'), role: 'option', dataset: { kind: o.kind } },
      h('div', { class: 'quick-head' },
        h('span', { class: 'quick-badge' }, CRM.icon('zap', { size: 'sm' }), pl.strong ? 'Буде створено' : 'Створити'),
        kinds),
      h('div', { class: 'quick-main' },
        h('span', { class: 'list-row-icon ' + o.iconClass }, CRM.icon(o.icon, { size: 'sm' })),
        h('div', { class: 'quick-text' },
          h('div', { class: 'quick-title' }, o.title),
          h('div', { class: 'quick-parts' }, o.parts.filter(Boolean).join(' · ')),
          o.problem ? h('div', { class: 'quick-problem' }, CRM.icon('alert', { size: 'sm' }), o.problem) : null)),
      h('div', { class: 'quick-actions' },
        CRM.ui.button({
          label: o.ok ? 'Створити' : 'Відкрити форму', variant: 'primary', size: 'sm', className: 'quick-create',
          onClick: (e) => { e.stopPropagation(); handlers.onCreate(); }
        }),
        o.ok ? CRM.ui.button({ label: 'Детальніше', size: 'sm', className: 'quick-details', onClick: (e) => { e.stopPropagation(); handlers.onDetails(); } }) : null,
        h('span', { class: 'quick-keys' },
          h('span', { class: 'kbd' }, 'Enter'), o.ok ? 'створити' : 'форма',
          o.ok ? [h('span', { class: 'kbd' }, 'Shift+Enter'), 'детальніше'] : null,
          pl.options.length > 1 ? [h('span', { class: 'kbd' }, 'Tab'), 'інший тип'] : null)));
  }

  const EXAMPLES = ['завтра 15:00 урок', 'кава 65', 'пт купити подарунок', 'вівсянка 80 г', '+15000 зарплата'];

  // ---------- Мій кабінет ----------
  function settingsBlock() {
    const h = CRM.ui.h;
    const accounts = ranked().filter((a) => !a.deletedAt && !a.archived);
    const cur = settings().accountId || '';
    const sel = h('select', { class: 'select quick-account', 'aria-label': 'Рахунок для витрат' },
      h('option', { value: '' }, 'Автоматично — останній використаний'),
      accounts.map((a) => h('option', { value: a.id, selected: a.id === cur }, `${a.name} (${a.currency})`)));
    if (cur && !accounts.some((a) => a.id === cur)) sel.value = '';
    sel.addEventListener('change', async () => {
      const v = Object.assign({}, settings(), { accountId: sel.value || null });
      await CRM.store.setSetting('quickInput', v);
      CRM.ui.toast(sel.value ? 'Основний рахунок для швидкого введення збережено' : 'Рахунок — автоматично', { type: 'success' });
    });
    return h('div', { class: 'setting-row quick-settings', id: 'quick' },
      h('div', { class: 'setting-text' },
        h('div', { class: 'setting-title' }, CRM.icon('zap', { size: 'sm' }), 'Швидке введення'),
        h('div', { class: 'setting-desc' }, 'Ctrl+K або кнопка ⚡ угорі: напиши рядок — CRM створить подію, задачу, витрату чи запис їжі. Прості правила, не ШІ.'),
        h('div', { class: 'quick-examples' }, EXAMPLES.map((x) => h('button', {
          type: 'button', class: 'chip', title: 'Спробувати', onClick: () => CRM.search.open(x, { quick: true })
        }, x))),
        h('label', { class: 'setting-desc quick-account-label' }, 'Рахунок для витрат і доходів (якщо в рядку не вказано інший, напр. «кава 65 моно»):'),
        sel));
  }

  CRM.quick = { parse, plan, create, details, card, settingsBlock, EXAMPLES, words, dateFor };
})(window.CRM);
