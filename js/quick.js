/* ==========================================================================
   quick.js — швидке введення одним рядком (вікно пошуку Ctrl+K і кнопка ⚡ угорі).
   Прості правила, не ШІ:
     «завтра 15:00 урок»   → подія в Календарі
     «пт купити подарунок» → задача в «Плані дня» на пʼятницю
     «кава 65», «+15000 зарплата» → витрата / дохід у Бюджеті
     «вівсянка 80 г», «обід 650 ккал» → запис у щоденнику харчування
     «вода +2», «медитація», «читання 30 вчора» → відмітка звички (js/habits.js)
     «щопонеділка 18:00 англійська» → повторювана подія; «нагадай о 18:00 купити хліб» → задача з нагадуванням
     «переказ 1000 моно → готівка» → переказ між рахунками; «біг 5 км 28 хв», «віджимання 3×20» → журнал тренувань
     «ДР Марти 5 листопада» → день народження в «Людях»; «написав Марті» → «Поспілкувались»
     «кава 65; таксі 120» — кілька записів одним рядком (лише «;», дата переходить на наступні частини)
     «пт здати розділ #диплом» — задача з міткою «диплом»
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
  const CASH_WORDS = new Set(['готівка', 'готівкою', 'готівки', 'готівку', 'готівці', 'кеш', 'кешем', 'cash', 'налом']);
  const INCOME_RE = /^(зарплат|зп$|аванс|премі|стипенді|кешбек|дохід|доходу)/;
  const PREPS = new Set(['о', 'об', 'у', 'в', 'во', 'на', 'з', 'із', 'зі', 'до', 'по']);
  const DASH = /^[-–—]$/;
  const YEAR_UNITS = /^(рік|роки|років|року)$/;

  // Нагадування: «нагадай о 18:00 …», «… нагадай за 30 хв»
  const REMIND_RE = /^(нагадай|нагадайте|нагадати|нагадуй|нагадування|нагадуванням)$/;
  const REMIND_FILL = /^(мені|мене|нам|про|що|щоб)$/;
  const REMIND_STEPS = [5, 10, 15, 30, 60, 120, 1440];
  // Повтори: «щодня», «щопонеділка», «по понеділках і середах», «кожні 2 тижні», «раз на місяць»
  const REP_DAY = new Map([['щопонеділка', 0], ['щовівторка', 1], ['щосереди', 2], ['щочетверга', 3], ["щоп'ятниці", 4], ['щопятниці', 4], ['щосуботи', 5], ['щонеділі', 6]]);
  const PLURAL_DAY = new Map([['понеділках', 0], ['вівторках', 1], ['середах', 2], ['четвергах', 3], ["п'ятницях", 4], ['пятницях', 4], ['суботах', 5], ['неділях', 6]]);
  const WORKDAYS = [0, 1, 2, 3, 4];
  const REP_SIMPLE = {
    'щодня': { freq: 'day' }, 'щоденно': { freq: 'day' }, 'щотижня': { freq: 'week' }, 'щотижнево': { freq: 'week' },
    'щомісяця': { freq: 'month' }, 'щомісячно': { freq: 'month' }, 'щороку': { freq: 'year' }, 'щорічно': { freq: 'year' },
    'щобудня': { freq: 'week', days: WORKDAYS }, 'щобудній': { freq: 'week', days: WORKDAYS }
  };
  const EVERY_RE = /^(кожн(ий|ого|ої|у|е|і|их|ен|ою)|кожен)$/;
  const CONJ = new Set(['і', 'й', 'та', 'and', '&']);
  // Переказ: «переказ 1000 моно → готівка», «переказ 500 з приват на моно»
  const TRANSFER_RE = /^(переказ|переказати|переказав|переказала|переказую|переклав|переклала|перекинув|перекинула|перекинути|перевів|перевела)$/;
  const ARROWS = /^(→|->|=>|⇒|—>|–>)$/;
  // День народження: «ДР Марти 5 листопада», «день народження Андрія 12.03.1998»
  const BDAY_WORDS = new Set(['др', 'д.р', 'днюха', 'днюху', 'днюхи', 'днюхою', 'birthday', 'bday']);
  // Спілкування: «написав Марті», «поспілкувався з Мартою», «дзвонив мамі вчора»
  const CONTACT_RE = /^(на|від|по)?(писав|писала|писали|спілкувався|спілкувалася|спілкувалась|спілкувались|спілкувалися|дзвонив|дзвонила|дзвонили|говорив|говорила|говорили|бачився|бачилася|бачилась|бачились|бачилися)$|^(подзвонив|подзвонила|зідзвонився|зідзвонилася|зідзвонилась|зідзвонились|зідзвонилися|созвонились|побачився|побачилась|побачилася|побачились|зустрівся|зустрілася|зустрілась|зустрілись|зустрілися|переписувався|переписувалась|переписувались|списались|списалися|поговорив|поговорила|поговорили)$/;
  // Тренування: кардіо-слово + км/хв; силові — «віджимання 3×20», «жим 3×10×60», «присідання 4 по 15»
  const CARDIO = [
    [/^(біг|бігу|бігом|бігав|бігала|пробіжка|пробіжку|пробіжки|пробігся|пробіглась|пробіглася|бігання)$/, 'Біг'],
    [/^(ходьба|ходьбу|прогулянка|прогулянку|пішки|ходив|ходила)$/, 'Ходьба'],
    [/^(велосипед|велосипеді|вело|велик|велику|веліку|велопрогулянка|велопрогулянку)$/, 'Велосипед'],
    [/^(плавання|плавав|плавала|поплавав|поплавала)$/, 'Плавання'],
    [/^(скакалка|скакалку|скакалці)$/, 'Скакалка'],
    [/^(орбітрек|орбітреку|еліпс)$/, 'Орбітрек'],
    [/^(гребля|греблю)$/, 'Гребля'],
    [/^(лижі|лижах)$/, 'Лижі'],
    [/^(кардіо)$/, 'Кардіо']
  ];
  const SET_RE = /^(\d{1,2})[×xх*](\d{1,3})(?:[×xх*](\d{1,3}(?:[.,]\d{1,2})?))?(кг)?$/;
  const X_RE = /^[×xх*]$/;
  const KM_UNITS = /^(км|кілометр|кілометри|кілометрів|km)$/;
  const M_UNITS = /^(м|метрів|метри|m)$/;
  const EX_STEMS = /^(віджиман|підтягуван|присідан|випад|бурпі|скручуван|прес|жим|тяг|станов|біцепс|трицепс|брус|мах|розведен|згинан|розгинан|підйом|планк|гир)/;

  // ---------- Розбір рядка (чиста функція, без даних) ----------
  function tokenize(text) {
    const out = [];
    String(text || '').replace(/\s*(→|->|=>|⇒)\s*/g, ' → ').replace(/\S+/g, (raw) => {
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
  /**
   * Дата, що починається зі слова i: сьогодні/завтра/…, пн…нд («наступного понеділка»), «через N днів»,
   * 5.11, 5.11.2027, «5 листопада [1998]». → { date, from, last, noYear } або null.
   */
  function dateAt(T, i, today) {
    if (!free(T, i)) return null;
    const ty = D.parse(today).y;
    const n = T[i].n;
    let date = null;
    let from = i;
    let last = i;
    let noYear = false;
    let m;
    // день без року, якого в цьому році немає (29 лютого) — найближчий високосний рік
    const make = (yy, mm, dd, guess) => {
      if (dd <= D.daysInMonth(yy, mm)) return D.make(yy, mm, dd);
      if (guess && mm === 2 && dd === 29) { let y = yy; while (D.daysInMonth(y, 2) < 29) y++; return D.make(y, 2, 29); }
      return null;
    };
    if ((THIS_WORDS.has(n) || NEXT_RE.test(n)) && free(T, i + 1) && WEEKDAY.has(T[i + 1].n)) {
      const wd = WEEKDAY.get(T[i + 1].n);
      date = NEXT_RE.test(n) ? D.addDays(D.startOfWeek(today), 7 + wd) : D.addDays(today, (wd - D.weekday(today) + 7) % 7);
      last = i + 1;
    } else if (Object.prototype.hasOwnProperty.call(REL, n)) date = D.addDays(today, REL[n]);
    else if (WEEKDAY.has(n)) {
      const wd = WEEKDAY.get(n);
      date = D.addDays(today, (wd - D.weekday(today) + 7) % 7);
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
      if (mm >= 1 && mm <= 12 && dd >= 1) { date = make(yy, mm, dd, !m[3]); noYear = !m[3]; }
    } else if (/^\d{1,2}$/.test(n) && free(T, i + 1) && monthOf(T[i + 1].n) >= 0) {
      const dd = Number(n);
      const mm = monthOf(T[i + 1].n) + 1;
      let yy = ty;
      last = i + 1;
      noYear = true;
      if (free(T, i + 2) && /^(19|20)\d\d$/.test(T[i + 2].n)) {
        yy = Number(T[i + 2].n);
        last = i + 2;
        noYear = false;
        if (free(T, i + 3) && /^(р|року|рік)$/.test(T[i + 3].n)) last = i + 3;
      }
      if (dd >= 1) date = make(yy, mm, dd, noYear);
    }
    return date ? { date, from, last, noYear } : null;
  }
  function passDate(T, P, today) {
    for (let i = 0; i < T.length && !P.date; i++) {
      const d = dateAt(T, i, today);
      if (!d) continue;
      let from = d.from;
      if (free(T, from - 1) && /^(на|у|в|во|до|з|із)$/.test(T[from - 1].n)) {
        if (T[from - 1].n === 'до') P.deadline = true;
        from -= 1;
      }
      mark(T, from, d.last, 'date');
      P.date = { value: d.date, noYear: d.noYear };
    }
  }
  /** Проміжок часу з слова j: «30 хв», «2 год», «годину», «півгодини», «день», «2 дні» → { min, last, days } або null. */
  function leadAt(T, j) {
    if (!free(T, j)) return null;
    const n = T[j].n;
    const m = /^(\d+(?:[.,]\d+)?)(хв|год)$/.exec(n);
    if (m) return { min: m[2] === 'год' ? numOf(m[1]) * 60 : numOf(m[1]), last: j };
    if (/^\d+(?:[.,]\d+)?$/.test(n) && free(T, j + 1)) {
      const u = T[j + 1].n;
      if (MIN_UNITS.test(u)) return { min: numOf(n), last: j + 1 };
      if (HOUR_UNITS.test(u)) return { min: numOf(n) * 60, last: j + 1 };
      if (DAY_UNITS.test(u) || /^доб/.test(u)) return { min: numOf(n) * 1440, last: j + 1, days: true };
    }
    if (n === 'годину' || n === 'годинку') return { min: 60, last: j };
    if (n === 'хвилину') return { min: 1, last: j };
    if (n === 'півгодини') return { min: 30, last: j };
    if (n === 'пів' && free(T, j + 1) && /^годин/.test(T[j + 1].n)) return { min: 30, last: j + 1 };
    if (n === 'день' || n === 'добу') return { min: 1440, last: j, days: true };
    return null;
  }
  /** Нагадування: «нагадай …» (+ «за 30 хв / за годину / за день»). */
  function passRemind(T, P) {
    for (let i = 0; i < T.length && !P.remind; i++) {
      if (!free(T, i) || !REMIND_RE.test(T[i].n)) continue;
      mark(T, i, i, 'remind');
      P.remind = { before: null };
      if (free(T, i - 1) && /^(з|із|зі)$/.test(T[i - 1].n)) mark(T, i - 1, i - 1, 'remind');
      for (let j = i + 1; free(T, j) && REMIND_FILL.test(T[j].n); j++) mark(T, j, j, 'remind');
    }
    if (!P.remind) return;
    for (let i = 0; i < T.length; i++) {
      if (!free(T, i) || T[i].n !== 'за') continue;
      const r = leadAt(T, i + 1);
      if (!r || !(r.min > 0)) continue;
      mark(T, i, r.last, 'remind');
      P.remind.before = Math.round(r.min);
      break;
    }
  }
  /** «через 30 хв», «через 2 години», «через годину» → час від «зараз». */
  function passIn(T, P, now, today) {
    if (P.time) return;
    for (let i = 0; i < T.length; i++) {
      if (!free(T, i) || T[i].n !== 'через') continue;
      const r = leadAt(T, i + 1);
      if (!r || r.days || !(r.min >= 1) || r.min > 1440) continue;
      const total = now + Math.round(r.min);
      mark(T, i, r.last, 'time');
      P.time = { start: total % 1440, end: null };
      P.inMin = Math.round(r.min);
      if (total >= 1440) P.date = { value: D.addDays(today, Math.floor(total / 1440)), noYear: false };
      return;
    }
  }
  /** Слово-день тижня в будь-якій формі: «середу», «середи», «середах», «ср» → 0–6 або -1. */
  function dayWordAt(T, j) {
    if (!free(T, j)) return -1;
    const n = T[j].n;
    if (PLURAL_DAY.has(n)) return PLURAL_DAY.get(n);
    if (WEEKDAY.has(n)) return WEEKDAY.get(n);
    if (REP_DAY.has(n)) return REP_DAY.get(n);
    return -1;
  }
  function freqOfUnit(u) {
    if (DAY_UNITS.test(u)) return 'day';
    if (WEEK_UNITS.test(u)) return 'week';
    if (MONTH_UNITS.test(u)) return 'month';
    if (YEAR_UNITS.test(u)) return 'year';
    return null;
  }
  /** Повтор: «щопонеділка», «щодня», «по понеділках і середах», «кожні 2 тижні», «раз на місяць» + «до 20 грудня» / «10 разів». */
  function passRepeat(T, P, today) {
    let rule = null;
    let from = -1;
    let last = -1;
    const days = new Set();
    for (let i = 0; i < T.length && !rule; i++) {
      if (!free(T, i)) continue;
      const n = T[i].n;
      const nx = free(T, i + 1) ? T[i + 1].n : '';
      let r = null;
      let end = i;
      if (REP_DAY.has(n)) { r = { freq: 'week' }; days.add(REP_DAY.get(n)); }
      else if (REP_SIMPLE[n]) { r = { freq: REP_SIMPLE[n].freq }; (REP_SIMPLE[n].days || []).forEach((d) => days.add(d)); }
      else if (n === 'по' && (PLURAL_DAY.has(nx) || /^(буднях|будням|вихідних)$/.test(nx) || (WEEKDAY.has(nx) && nx.length === 2))) {
        r = { freq: 'week' };
        end = i + 1;
        if (/^будн/.test(nx)) WORKDAYS.forEach((d) => days.add(d));
        else if (nx === 'вихідних') { days.add(5); days.add(6); }
        else days.add(dayWordAt(T, i + 1));
      } else if (/^(у|в)$/.test(n) && nx === 'будні') { r = { freq: 'week' }; end = i + 1; WORKDAYS.forEach((d) => days.add(d)); }
      else if (EVERY_RE.test(n) && nx) {
        if (/^\d{1,2}$/.test(nx) && free(T, i + 2) && freqOfUnit(T[i + 2].n)) { r = { freq: freqOfUnit(T[i + 2].n), every: Number(nx) }; end = i + 2; }
        else if (freqOfUnit(nx)) { r = { freq: freqOfUnit(nx) }; end = i + 1; }
        else if (WEEKDAY.has(nx)) { r = { freq: 'week' }; days.add(WEEKDAY.get(nx)); end = i + 1; }
      } else if (n === 'раз' && nx === 'на' && free(T, i + 2)) {
        const u = T[i + 2].n;
        if (/^\d{1,2}$/.test(u) && free(T, i + 3) && freqOfUnit(T[i + 3].n)) { r = { freq: freqOfUnit(T[i + 3].n), every: Number(u) }; end = i + 3; }
        else if (freqOfUnit(u)) { r = { freq: freqOfUnit(u) }; end = i + 2; }
      }
      if (!r) continue;
      if (!(r.every >= 1 && r.every <= 99)) r.every = 1;
      from = i;
      last = end;
      // ще дні: «щопонеділка і середи», «по пн, ср, пт», «по понеділках і по четвергах»
      if (r.freq === 'week') {
        for (;;) {
          let k = last + 1;
          if (free(T, k) && CONJ.has(T[k].n)) k++;
          if (free(T, k) && T[k].n === 'по') k++;
          const d = dayWordAt(T, k);
          if (d < 0) break;
          days.add(d);
          last = k;
        }
      }
      rule = r;
    }
    if (!rule) return;
    mark(T, from, last, 'repeat');
    if (rule.freq === 'week' && days.size) rule.days = Array.from(days).sort((a, b) => a - b);
    // Закінчення: «до 20 грудня», «по 20.12», «10 разів»
    for (let i = 0; i < T.length; i++) {
      if (!free(T, i)) continue;
      const n = T[i].n;
      if ((n === 'до' || n === 'по') && !rule.until) {
        const d = dateAt(T, i + 1, today);
        if (d) {
          rule.until = d.noYear && d.date < today ? D.addYears(d.date, 1) : d.date;
          mark(T, i, d.last, 'repeat');
          continue;
        }
      }
      if (/^\d{1,3}$/.test(n) && !rule.count && free(T, i + 1) && /^(раз|рази|разів)$/.test(T[i + 1].n)) {
        rule.count = Number(n);
        mark(T, i, i + 1, 'repeat');
      }
    }
    P.repeat = rule;
  }
  /** Тривалість тренування: «28 хв», «1 год 20 хв», «45хв», «1,5 год» (позначає слова). */
  function durAt(T, i) {
    if (!free(T, i)) return null;
    const n = T[i].n;
    const m = /^(\d+(?:[.,]\d+)?)(хв|год)$/.exec(n);
    if (m) return { min: m[2] === 'год' ? numOf(m[1]) * 60 : numOf(m[1]), last: i };
    if (/^\d+(?:[.,]\d+)?$/.test(n) && free(T, i + 1)) {
      if (MIN_UNITS.test(T[i + 1].n)) return { min: numOf(n), last: i + 1 };
      if (HOUR_UNITS.test(T[i + 1].n)) return { min: numOf(n) * 60, last: i + 1 };
    }
    return null;
  }
  /** Підходи: «3×20», «3 x 20», «3×10×60», «3 по 20», «3 підходи по 20», + «60 кг» → { sets, reps, weight, last }. */
  function setAt(T, i) {
    if (!free(T, i)) return null;
    const n = T[i].n;
    let sets = null;
    let reps = null;
    let weight = null;
    let last = i;
    let m = SET_RE.exec(n);
    if (m) { sets = Number(m[1]); reps = Number(m[2]); if (m[3]) weight = numOf(m[3]); }
    else if (/^\d{1,2}$/.test(n)) {
      let j = i + 1;
      if (free(T, j) && /^підх/.test(T[j].n)) j++;
      if (free(T, j) && (X_RE.test(T[j].n) || T[j].n === 'по') && free(T, j + 1) && /^\d{1,3}$/.test(T[j + 1].n)) {
        sets = Number(n);
        reps = Number(T[j + 1].n);
        last = j + 1;
        if (free(T, last + 1) && X_RE.test(T[last + 1].n) && free(T, last + 2) && /^\d{1,3}(?:[.,]\d{1,2})?$/.test(T[last + 2].n)) {
          weight = numOf(T[last + 2].n);
          last += 2;
        }
      }
    }
    if (sets == null) return null;
    if (free(T, last + 1) && /^(повторень|повторів|разів|рази|раз)$/.test(T[last + 1].n)) last += 1;
    // вага окремо: «60 кг», «по 60 кг», «60кг»
    let j = last + 1;
    if (free(T, j) && T[j].n === 'по') j++;
    if (weight == null && free(T, j)) {
      const w = /^(\d{1,3}(?:[.,]\d{1,2})?)кг$/.exec(T[j].n);
      if (w) { weight = numOf(w[1]); last = j; }
      else if (/^\d{1,3}(?:[.,]\d{1,2})?$/.test(T[j].n) && free(T, j + 1) && KG_UNITS.test(T[j + 1].n)) { weight = numOf(T[j].n); last = j + 1; }
    } else if (weight != null && free(T, last + 1) && KG_UNITS.test(T[last + 1].n)) last += 1;
    if (m && m[4]) { /* «3×10×60кг» */ }
    if (sets < 1 || sets > 20 || reps < 1 || reps > 500 || (weight != null && !(weight > 0 && weight <= 500))) return null;
    return { sets, reps, weight, last };
  }
  /** Тренування: «біг 5 км 28 хв», «віджимання 3×20 підтягування 3×8», «жим 3×10×60», «віджимання 50». */
  function passWorkout(T, P, known) {
    // кардіо
    let ci = -1;
    let cname = null;
    T.forEach((t, i) => {
      if (ci >= 0 || !free(T, i)) return;
      const c = CARDIO.find(([re]) => re.test(t.n));
      if (c) { ci = i; cname = c[1]; }
    });
    if (ci >= 0) {
      let km = null;
      let min = null;
      const marks = [];
      for (let i = 0; i < T.length; i++) {
        if (!free(T, i) || i === ci) continue;
        const n = T[i].n;
        let m = /^(\d+(?:[.,]\d+)?)(км|km)$/.exec(n);
        if (m && km == null) { km = numOf(m[1]); marks.push([i, i]); continue; }
        m = /^(\d+)(м|m)$/.exec(n);
        if (m && km == null && Number(m[1]) >= 50) { km = Number(m[1]) / 1000; marks.push([i, i]); continue; }
        if (/^\d+(?:[.,]\d+)?$/.test(n) && free(T, i + 1)) {
          const u = T[i + 1].n;
          if (km == null && KM_UNITS.test(u)) { km = numOf(n); marks.push([i, i + 1]); i++; continue; }
          if (km == null && M_UNITS.test(u) && numOf(n) >= 50) { km = numOf(n) / 1000; marks.push([i, i + 1]); i++; continue; }
        }
        const d = durAt(T, i);
        if (d) { min = (min || 0) + d.min; marks.push([i, d.last]); i = d.last; }
      }
      if (min == null && P.dur) min = P.dur;
      if (km != null || min != null) {
        mark(T, ci, ci, 'workout');
        marks.forEach(([a, b]) => mark(T, a, b, 'workout'));
        P.workout = { cardio: true, name: cname, km: km != null ? Math.round(km * 100) / 100 : null, min: min != null ? Math.round(min) : null, sure: true };
      }
      return;
    }
    // силові: назва + підходи (кілька вправ підряд)
    const segs = [[]];
    const specs = [];
    for (let i = 0; i < T.length; i++) {
      if (!free(T, i)) continue;
      const sp = setAt(T, i);
      if (sp) {
        specs.push(Object.assign({ from: i }, sp));
        segs.push([]);
        i = sp.last;
        continue;
      }
      segs[segs.length - 1].push(i);
    }
    let exercises = [];
    if (specs.length) {
      const before = segs[0].length > 0;
      specs.forEach((sp, k) => {
        let idx = before ? segs[k] : segs[k + 1];
        idx = idx.filter((i) => !durAt(T, i) && !(i > 0 && durAt(T, i - 1) && durAt(T, i - 1).last === i));
        exercises.push({ idx, sp });
      });
    } else if (known) {
      // «віджимання 50» — відома вправа + одне число
      const nums = segs[0].filter((i) => /^\d{1,3}$/.test(T[i].n));
      const names = segs[0].filter((i) => !/^\d/.test(T[i].n) && !/^(повторень|повторів|разів|рази|раз)$/.test(T[i].n));
      if (nums.length === 1 && names.length && names.length <= 3 && Number(T[nums[0]].n) >= 1 && Number(T[nums[0]].n) <= 300 &&
        (EX_STEMS.test(T[names[0]].n) || known(names.map((i) => T[i].n).join(' ')))) {
        const after = free(T, nums[0] + 1) && /^(повторень|повторів|разів|рази|раз)$/.test(T[nums[0] + 1].n);
        if (!free(T, nums[0] + 1) || after || !isUnit(T[nums[0] + 1].n)) {
          exercises.push({ idx: names, sp: { sets: 1, reps: Number(T[nums[0]].n), weight: null, from: nums[0], last: after ? nums[0] + 1 : nums[0] } });
        }
      }
    }
    if (!exercises.length) return;
    // тривалість «20 хв»
    let min = null;
    for (let i = 0; i < T.length; i++) {
      const d = durAt(T, i);
      if (d) { min = (min || 0) + d.min; mark(T, i, d.last, 'workout'); i = d.last; }
    }
    if (min == null && P.dur) min = P.dur;
    let prev = null;
    const list = [];
    exercises.forEach(({ idx, sp }) => {
      const words = idx.filter((i) => free(T, i)).map((i) => T[i].raw);
      let name = words.join(' ').replace(/[,;:]+$/, '').trim();
      if (!name && prev) name = prev;
      idx.forEach((i) => { if (free(T, i)) T[i].tag = 'workout'; });
      mark(T, sp.from, sp.last, 'workout');
      if (!name) return;
      name = name.charAt(0).toUpperCase() + name.slice(1);
      prev = name;
      const sets = [];
      for (let k = 0; k < sp.sets; k++) sets.push({ reps: sp.reps, weight: sp.weight });
      const same = list.find((e) => U.normalize(e.name) === U.normalize(name));
      if (same) same.sets = same.sets.concat(sets); else list.push({ name, sets });
    });
    if (!list.length) return;
    const sure = list.some((e) => EX_STEMS.test(U.normalize(e.name)) || (known && known(e.name)));
    P.workout = { cardio: false, exercises: list, min: min != null ? Math.round(min) : null, sure };
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
      if (ARROWS.test(t.n)) { t.tag = 'transfer'; if (!P.transfer) P.transfer = {}; P.transfer.arrow = i; return; }
      if (TRANSFER_RE.test(t.n) && !P.transfer) { t.tag = 'transfer'; P.transfer = { word: i }; return; }
      if (TRANSFER_RE.test(t.n)) { t.tag = 'transfer'; P.transfer.word = i; return; }
      if (BDAY_WORDS.has(t.n) && !P.bday) { t.tag = 'bday'; P.bday = true; return; }
      if (/^(день|дня|днем|дню)$/.test(t.n) && free(T, i + 1) && /^народж/.test(T[i + 1].n) && !P.bday) {
        t.tag = 'bday';
        T[i + 1].tag = 'bday';
        P.bday = true;
        return;
      }
      if (CONTACT_RE.test(t.n) && P.contact == null) {
        t.tag = 'contact';
        P.contact = i;
        if (free(T, i + 1) && /^(з|із|зі|до)$/.test(T[i + 1].n)) T[i + 1].tag = 'contact';
        return;
      }
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
  function parse(text, today, opts) {
    const o = opts || {};
    const T = tokenize(text);
    if (!T.length) return null;
    const P = {
      tokens: T, time: null, dur: null, date: null, food: null, money: null, meal: null, prio: false, cash: false, deadline: false, incomeWord: false,
      remind: null, repeat: null, workout: null, transfer: null, bday: false, contact: null
    };
    const day = today || D.today();
    P.today = day;
    // мітки задачі: «#диплом» (до всіх інших правил, щоб не потрапили в назву вправи чи суму)
    T.forEach((t) => {
      const lm = /^#([^#\s].*)$/.exec(t.raw.replace(/[,;.!?]+$/, ''));
      if (lm) { t.tag = 'label'; (P.labels = P.labels || []).push(lm[1]); }
    });
    passRemind(T, P);
    passTime(T, P);
    passIn(T, P, toMin(o.now) != null ? toMin(o.now) : toMin(D.nowTime()), day);
    passDuration(T, P);
    passRepeat(T, P, day);
    passDate(T, P, day);
    passWorkout(T, P, o.known || null);
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
  const PAST_KINDS = new Set(['expense', 'income', 'meal', 'transfer', 'workout', 'contact']);
  /** Дата для виду запису: без року — найближча в майбутньому (події, задачі) або в минулому (гроші, їжа). */
  function dateFor(P, kind) {
    if (!P.date) return null;
    // дата з попередньої частини («a; b») у майбутньому не стосується витрат, їжі, тренувань — вони «сьогодні»
    if (P.dateFromPrev && PAST_KINDS.has(kind) && P.date.value > P.today) return null;
    let d = P.date.value;
    if (P.date.noYear) {
      if ((kind === 'event' || kind === 'task') && d < P.today) d = D.addYears(d, 1);
      if (PAST_KINDS.has(kind) && d > P.today) d = D.addYears(d, -1);
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
  const TITLE_DROP = ['date', 'time', 'dur', 'prio', 'remind', 'repeat', 'label'];
  /** «за 45 хв» → найближче з варіантів нагадування (5, 10, 15, 30 хв, 1–2 год, день). */
  function snapRemind(min) {
    if (min == null) return null;
    if (min <= 0) return 0;
    let best = REMIND_STEPS[0];
    REMIND_STEPS.forEach((v) => { if (Math.abs(v - min) < Math.abs(best - min)) best = v; });
    return best;
  }
  function remindText(v) {
    if (v == null) return null;
    if (v === 0) return 'нагадування в цей час';
    if (v % 1440 === 0) return v === 1440 ? 'нагадування за день' : `нагадування за ${v / 1440} дні`;
    if (v % 60 === 0) return `нагадування за ${v / 60} год`;
    return `нагадування за ${v} хв`;
  }
  function buildEvent(P) {
    const title = words(P, TITLE_DROP);
    if (!title) return null;
    let date = dateFor(P, 'event') || P.today;
    let repeat = null;
    if (P.repeat) {
      const r = P.repeat;
      let days = null;
      if (r.freq === 'week') {
        days = r.days && r.days.length ? r.days.slice() : [D.weekday(date)];
        // без дати — перший відповідний день, починаючи з сьогодні
        if (!P.date) for (let k = 0; k < 7 && !days.includes(D.weekday(date)); k++) date = D.addDays(date, 1);
      }
      repeat = { freq: r.freq, every: r.every || 1, days, until: r.until || null, count: r.until ? null : (r.count || null) };
    }
    const hist = newest(CRM.store.list('events').filter((e) => same(e.title, title)), 'updatedAt');
    const ws = wordsOf(title);
    const dictCat = (EVENT_DICT.find(([keys]) => dictHit(keys, ws)) || [])[1];
    const cat = hist && hist.cat ? hist.cat : dictCat || lastCat();
    let rec;
    if (P.time) {
      const start = P.time.start;
      let dur = P.time.end != null ? P.time.end - start : P.dur || (hist && !hist.allDay && hist.dur) || 60;
      dur = Math.max(5, Math.min(dur, 1440 - start));
      let remind = hist && !hist.allDay && hist.remind !== undefined ? hist.remind : 15;
      if (P.remind) remind = snapRemind(P.remind.before == null ? 0 : P.remind.before);
      rec = { title, date, allDay: false, start: hhmm(start), dur, cat, remind, note: '' };
    } else {
      rec = { title, date, allDay: true, start: null, dur: null, cat, remind: null, note: '' };
    }
    let problem = CRM.db.SCHEMA.events ? null : 'Браузер показує стару версію сайту — онови сторінку (Ctrl+F5).';
    const parts = [];
    if (repeat) {
      Object.assign(rec, { repeat, skip: [], overrides: {} });
      if (repeat.until && repeat.until < date) problem = problem || 'Дата закінчення раніше за початок — напиши іншу або відкрий форму.';
      parts.push(CRM.calendar.repeatText ? CRM.calendar.repeatText(rec) : 'Повторюється', 'з ' + dayShort(date));
    } else {
      parts.push(dayShort(date));
    }
    parts.push(rec.allDay ? 'весь день' : `${rec.start}–${hhmm(toMin(rec.start) + rec.dur)}`, CRM.calendar.categoryName(cat));
    if (P.remind) parts.push(rec.allDay ? 'без часу — нагадування не буде' : remindText(rec.remind));
    return { kind: 'event', label: 'Подія', icon: 'calendar', iconClass: 'ico-event', title, parts, rec, ok: !problem, problem };
  }

  // ---------- Задача ----------
  function buildTask(P) {
    if (P.repeat) return null;   // задачі не повторюються — лише подія
    const title = words(P, TITLE_DROP);
    if (!title) return null;
    const rec = { title, priority: P.prio ? 'high' : 'medium' };
    const parts = [];
    if (P.labels && P.labels.length) rec.labels = CRM.tasks.mergeLabels ? CRM.tasks.mergeLabels([], P.labels) : P.labels.slice();
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
    if (rec.labels && rec.labels.length) parts.push(rec.labels.map((l) => '#' + l).join(' '));
    if (P.remind) {
      if (rec.planStart || rec.deadlineTime) {
        rec.remind = snapRemind(P.remind.before == null ? 0 : P.remind.before);
        parts.push(remindText(rec.remind));
      } else {
        parts.push('без часу — нагадування не буде (додай час, напр. «о 9:00»)');
      }
    }
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
  /** Слово з «Моїх слів» (кабінет → «Швидке введення»): «сільпо» → Продукти › Супермаркет. */
  function wordHit(k, w) { return w === k || (k.length >= 4 && w.length >= 4 && w.startsWith(stem(k)) && Math.abs(w.length - k.length) <= 3); }
  function ownWord(kind, comment) {
    const ws = wordsOf(comment);
    if (!ws.length) return null;
    for (const item of ownWords()) {
      const c = categoryById(item.categoryId, kind);
      if (!c) continue;
      const kw = wordsOf(item.word);
      if (!kw.length) continue;
      for (let i = 0; i + kw.length <= ws.length; i++) {
        if (kw.every((k, j) => wordHit(k, ws[i + j]))) {
          const sub = (c.subcategories || []).find((x) => x.id === item.subcategoryId) || null;
          return { cat: c, sub, own: item };
        }
      }
    }
    return null;
  }
  function guessCategory(kind, comment, hist) {
    const cats = CRM.store.list('categories').filter((c) => c.kind === kind)
      .sort((a, b) => (a.order || 0) - (b.order || 0));
    if (!cats.length) return null;
    // 0) мої слова
    const own = ownWord(kind, comment);
    if (own) return own;
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
  function ownWords() { const w = settings().words; return Array.isArray(w) ? w.filter((x) => x && x.word && x.categoryId) : []; }
  function buildTx(P, kind) {
    if (!P.money || !CRM.budget) return null;
    const accounts = ranked().filter((a) => !a.deletedAt && !a.archived);
    const explicit = accounts.length ? accountByWord(P, accounts) : null;
    const comment = words(P, ['date', 'money', 'time', 'dur', 'cash', 'prio', 'food', 'remind', 'repeat', 'transfer', 'label'], explicit ? [explicit.index] : null);
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
    const name = words(P, ['date', 'time', 'dur', 'food', 'meal', 'prio', 'label'].concat(asGrams ? ['money'] : []));
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

  // ---------- Переказ між рахунками ----------
  /** Рахунок за словом: «моно» → Monobank, «приватбанку» → ПриватБанк, «готівку» → готівковий. */
  function accountOfToken(t, accounts) {
    const n = t.n;
    if (CASH_WORDS.has(n) || /^готівк/.test(n)) {
      const c = accounts.find((a) => a.type === 'cash');
      if (c) return c;
    }
    if (n.length < 3 || !/^[a-zа-яіїєґ']+$/.test(n) || PREPS.has(n)) return null;
    const s = n.length >= 6 ? stem(n) : n;
    return accounts.find((a) => wordsOf(a.name).some((w) => {
      if (w.length < 3) return false;
      if (w === n) return true;
      if (s.length < 3) return false;
      return w.startsWith(s) || latin(w).startsWith(latin(s)) || w.replace(/y/g, 'i').startsWith(latin(s));
    })) || null;
  }
  function defaultAccount(accounts, except) {
    const ok = (a) => a && a.id !== except;
    const byId = (id) => accounts.find((a) => a.id === id) || null;
    if (ok(byId(settings().accountId))) return byId(settings().accountId);
    const last = CRM.store.getSetting('budget.lastAccount', {}) || {};
    if (ok(byId(last.expense || last.any))) return byId(last.expense || last.any);
    return accounts.find((a) => ok(a) && a.type !== 'savings' && a.currency === 'UAH') || accounts.find(ok) || null;
  }
  function buildTransfer(P) {
    if (!P.transfer || !P.money || !CRM.budget) return null;
    const accounts = ranked().filter((a) => !a.deletedAt && !a.archived);
    const T = P.tokens;
    const found = [];
    T.forEach((t, i) => {
      if (t.tag && t.tag !== 'cash') return;
      const acc = accountOfToken(t, accounts);
      if (!acc) return;
      const prev = i > 0 ? T[i - 1].n : '';
      let role = null;
      if (/^(з|із|зі|від)$/.test(prev)) role = 'from';
      else if (/^(на|в|у|до)$/.test(prev)) role = 'to';
      else if (P.transfer.arrow != null) role = i > P.transfer.arrow ? 'to' : 'from';
      found.push({ acc, i, role, prep: /^(з|із|зі|від|на|в|у|до)$/.test(prev) ? i - 1 : null });
    });
    let from = (found.find((f) => f.role === 'from') || {}).acc || null;
    let to = (found.find((f) => f.role === 'to') || {}).acc || null;
    found.filter((f) => !f.role).forEach((f) => {
      if (!from && f.acc !== to) from = f.acc;
      else if (!to && f.acc !== from) to = f.acc;
    });
    if (!from && to) from = defaultAccount(accounts, to.id);
    const extra = [];
    found.forEach((f) => { extra.push(f.i); if (f.prep != null) extra.push(f.prep); });
    const comment = words(P, ['date', 'money', 'time', 'dur', 'cash', 'prio', 'food', 'remind', 'repeat', 'transfer', 'label'], extra);
    const date = dateFor(P, 'transfer') || P.today;
    let amount = P.money.amount;
    let toAmount = amount;
    let problem = null;
    const cur = P.money.cur;
    if (!accounts.length) problem = 'Спершу додай рахунки в «Бюджеті» — Enter відкриє форму.';
    else if (!from || !to) problem = 'Не зрозумів, з якого рахунку на який — напр., «переказ 1000 моно → готівка». Enter відкриє форму.';
    else if (from.id === to.id) problem = 'Рахунки однакові — Enter відкриє форму, там вибери інший.';
    else if (from.currency !== to.currency) {
      if (cur && cur === to.currency) {
        toAmount = amount;
        amount = CRM.rates.convert(toAmount, to.currency, from.currency, date);
      } else if (!cur || cur === from.currency) {
        toAmount = CRM.rates.convert(amount, from.currency, to.currency, date);
      } else problem = 'Валюта суми не збігається з рахунками — Enter відкриє форму.';
      if (!problem && (amount == null || toAmount == null)) problem = 'Курсу НБУ на цю дату ще немає — Enter відкриє форму, там введи суму зарахування.';
      if (!problem) { amount = U.round2(amount); toAmount = U.round2(toAmount); }
    } else if (cur && cur !== from.currency) problem = `Рахунки не в ${cur === 'USD' ? 'доларах' : cur === 'EUR' ? 'євро' : 'гривнях'} — Enter відкриє форму.`;
    const rec = {
      type: 'transfer', amount, accountId: from ? from.id : null, toAccountId: to ? to.id : null, toAmount: problem ? null : toAmount,
      categoryId: null, subcategoryId: null, date, comment, recurringId: null, recurringDate: null
    };
    const parts = [];
    if (from && amount != null) parts.push(fmt.money(amount, from.currency));
    if (from || to) parts.push(`${from ? from.name : '?'} → ${to ? to.name : '?'}`);
    if (!problem && from.currency !== to.currency) parts.push('зарахування ' + fmt.money(toAmount, to.currency) + ' (курс НБУ)');
    parts.push(relDay(date));
    return { kind: 'transfer', label: 'Переказ', icon: 'arrows', iconClass: 'ico-payment', title: comment || 'Переказ між рахунками', parts, rec, ok: !problem, problem };
  }

  // ---------- Тренування ----------
  const workoutTypeLabel = (t) => CRM.dict.label('workoutTypes', t) || 'Тренування';
  /** Тренування того самого дня й типу, записане через ⚡ (не з програми) — до нього додаються нові вправи. */
  function workoutTarget(type, date) {
    if (type === 'cardio') return null;
    return newest(CRM.store.list('workouts').filter((w) => w.quick && w.type === type && w.date === date && !w.program), 'updatedAt');
  }
  function exerciseType(name) {
    const n = U.normalize(name);
    const w = newest(CRM.store.list('workouts').filter((x) => (x.type === 'strength' || x.type === 'home') &&
      (x.exercises || []).some((e) => U.normalize(e.name) === n)), 'date');
    return w ? w.type : null;
  }
  /** Підходи коротко: [20,20,20] → «3×20», з вагою — «3×10×60 кг». */
  function setsText(sets) {
    const groups = [];
    sets.forEach((st) => {
      const g = groups[groups.length - 1];
      if (g && g.reps === st.reps && g.weight === st.weight) g.n++;
      else groups.push({ n: 1, reps: st.reps, weight: st.weight });
    });
    return groups.map((g) => `${g.n}×${g.reps}` + (g.weight != null ? `×${fmt.number(g.weight, 2).replace(/,00$/, '')} кг` : '')).join(', ');
  }
  function minText(m) { return m >= 60 ? `${Math.floor(m / 60)} год${m % 60 ? ' ' + (m % 60) + ' хв' : ''}` : `${m} хв`; }
  function buildWorkout(P, ctx) {
    if (!P.workout || !CRM.training || !CRM.db.SCHEMA.workouts) return null;
    const W = P.workout;
    const date = dateFor(P, 'workout') || P.today;
    let problem = date > P.today ? 'Майбутнє тренування в журнал не записати — для плану вибери «Подія».' : null;
    const base = { kind: 'workout', label: 'Тренування', icon: 'dumbbell', iconClass: 'ico-goal' };
    if (W.cardio) {
      const rec = { type: 'cardio', date, title: W.name, durationMin: W.min, distanceKm: W.km, exercises: [], note: '', quick: true };
      if (W.min != null && (W.min < 1 || W.min > 600)) problem = problem || 'Тривалість — від 1 до 600 хв.';
      if (W.km != null && !(W.km > 0 && W.km <= 500)) problem = problem || 'Дистанція — до 500 км.';
      const parts = [];
      if (W.km != null) parts.push(fmt.number(W.km, 2).replace(/,?0+$/, '') + ' км');
      if (W.min != null) parts.push(minText(W.min));
      const pace = W.km && W.min && CRM.training.pace ? CRM.training.pace(rec) : null;
      if (pace) parts.push('темп ' + pace);
      parts.push(workoutTypeLabel('cardio'), relDay(date));
      return Object.assign(base, { title: W.name, parts, rec, ok: !problem, problem, merge: false });
    }
    const hasWeight = W.exercises.some((e) => e.sets.some((st) => st.weight != null));
    const type = hasWeight ? 'strength' : W.exercises.map((e) => exerciseType(e.name)).find(Boolean) || 'home';
    const pending = ctx && (ctx.pending || []).some((x) => x.type === type && x.date === date);
    const merge = !!(workoutTarget(type, date) || pending);
    const rec = { type, date, title: '', durationMin: W.min, distanceKm: null, exercises: U.deepClone(W.exercises), note: '', quick: true };
    const parts = [W.exercises.length === 1 ? setsText(W.exercises[0].sets) : W.exercises.map((e) => `${e.name} ${setsText(e.sets)}`).join(', ')];
    if (W.min != null) parts.push(minText(W.min));
    parts.push(workoutTypeLabel(type));
    parts.push(merge ? (date === P.today ? 'додати до сьогоднішнього тренування' : 'додати до тренування ' + relDay(date)) : 'нове тренування' + (date === P.today ? '' : ', ' + relDay(date)));
    if (W.min != null && (W.min < 1 || W.min > 600)) problem = problem || 'Тривалість — від 1 до 600 хв.';
    return Object.assign(base, { title: W.exercises.map((e) => e.name).join(', '), parts, rec, ok: !problem, problem, merge, sure: W.sure });
  }

  // ---------- Люди: день народження, «поспілкувались» ----------
  /** Слова, схожі на імʼя (без розпізнаних частин і прийменників). */
  function nameTokens(P) {
    return P.tokens.map((t, i) => ({ t, i }))
      .filter(({ t }) => !t.tag && /^[a-zа-яіїєґ'-]+$/.test(t.n) && t.n.length >= 2 && !PREPS.has(t.n) && !/^(для|про|мені|сьогодні)$/.test(t.n));
  }
  function buildBirthday(P) {
    if (!P.bday || !CRM.people || !CRM.people.matchPeople) return null;
    const base = { kind: 'birthday', label: 'День народження', icon: 'cake', iconClass: 'ico-event' };
    const cand = nameTokens(P);
    if (!cand.length) return null;   // «5 листопада день народження» без імені — звичайна подія
    const m = CRM.people.matchPeople(cand.map((x) => x.t.n))[0] || null;
    const person = m ? m.person : null;
    let name = person ? person.name : CRM.people.guessName(cand[0].t.n);
    if (!person && cand[1] && cand[1].i === cand[0].i + 1 && /^[A-ZА-ЯІЇЄҐ]/.test(cand[1].t.raw)) name += ' ' + cand[1].t.raw.replace(/[^A-Za-zА-Яа-яІіЇїЄєҐґ'ʼ’-]/g, '');
    let problem = null;
    let md = null;
    let year = null;
    if (!P.date) problem = 'Напиши дату: «ДР Марти 5 листопада» (рік — за бажанням).';
    else {
      const d = D.parse(P.date.value);
      md = D.pad(d.m) + '-' + D.pad(d.d);
      if (!P.date.noYear) {
        year = d.y;
        if (P.date.value > P.today || year < 1900) problem = 'Рік народження — від 1900 і не пізніше сьогодні.';
      }
    }
    if (!CRM.people.canSave()) problem = 'Браузер показує стару версію сайту — онови сторінку (Ctrl+F5).';
    if (person && md && year == null && person.bday === md) year = person.bdayYear || null;
    const parts = [];
    if (md) parts.push('ДН: ' + CRM.people.mdText(md, year));
    if (person) {
      if (person.bday && md && (person.bday !== md || (year && person.bdayYear && person.bdayYear !== year))) parts.push('було: ' + CRM.people.mdText(person.bday, person.bdayYear));
      else if (person.bday === md) parts.push('уже записано');
      parts.push('у «Людях»');
    } else parts.push('нова людина в «Людях»');
    return Object.assign(base, { title: name, parts, rec: { personId: person ? person.id : null, name, md, year }, ok: !problem, problem });
  }
  function buildContact(P) {
    if (P.contact == null || !CRM.people || !CRM.people.matchPeople) return null;
    const cand = nameTokens(P).filter((x) => x.i > P.contact);
    if (!cand.length) return null;
    const base = { kind: 'contact', label: 'Поспілкувались', icon: 'chat', iconClass: 'ico-event' };
    const date = dateFor(P, 'contact') || P.today;
    let problem = date > P.today ? 'Позначити можна лише сьогодні або минулий день.' : null;
    const m = CRM.people.matchPeople(cand.map((x) => x.t.n))[0] || null;
    if (!m) {
      // невідоме слово з малої літери («писав диплом») — це не імʼя
      if (!/^[A-ZА-ЯІЇЄҐ]/.test(cand[0].t.raw)) return null;
      const name = CRM.people.guessName(cand[0].t.n);
      return Object.assign(base, {
        title: name, parts: ['немає в «Людях»'], rec: { personId: null, name, date }, ok: false,
        problem: problem || `«${name}» немає в «Людях» — Enter відкриє картку нової людини.`
      });
    }
    const p = m.person;
    if (!CRM.people.canSave()) problem = 'Браузер показує стару версію сайту — онови сторінку (Ctrl+F5).';
    const parts = [relDay(date) === 'сьогодні' ? 'поспілкувались сьогодні' : 'поспілкувались ' + relDay(date)];
    if (p.lastContact && p.lastContact > date) parts.push('уже позначено пізніше: ' + relDay(p.lastContact));
    if (p.freq) parts.push(`наступного разу — через ${fmt.count(p.freq, ['день', 'дні', 'днів'])}`);
    return Object.assign(base, { title: p.name, parts, rec: { personId: p.id, name: p.name, date }, ok: !problem, problem });
  }

  // ---------- Варіанти ----------
  const ORDER = ['habit', 'contact', 'birthday', 'workout', 'event', 'task', 'transfer', 'expense', 'income', 'meal'];
  function primaryKind(P, built) {
    if (built.contact && built.contact.ok) return 'contact';
    if (built.birthday) return 'birthday';
    if (built.transfer) return 'transfer';
    const wo = built.workout && built.workout.rec && built.workout.rec.date <= P.today ? built.workout : null;   // майбутнє — це план (подія)
    if (wo && !P.time && (wo.sure || !P.money)) return 'workout';
    if (built.habit) return 'habit';
    if (P.labels && P.labels.length && !P.time && !P.food && built.task) return 'task';   // «#мітка» буває лише в задач
    if (P.food) return 'meal';
    if (P.repeat) return 'event';
    if (P.deadline && (P.date || P.time)) return 'task';
    if (P.remind) return P.remind.before != null && P.time ? 'event' : 'task';
    if (P.time) return 'event';
    if (wo) return 'workout';
    if (P.money) return P.money.sign === '+' || (P.incomeWord && P.money.sign !== '-') ? 'income' : 'expense';
    if (built.contact) return 'contact';
    return 'task';
  }
  // Назви вправ з журналу (для «віджимання 50»), кеш на кілька секунд
  let knownSet = null;
  let knownAt = 0;
  function knownExercise(name) {
    if (!knownSet || Date.now() - knownAt > 5000) {
      knownSet = new Set();
      CRM.store.list('workouts').forEach((w) => (w.exercises || []).forEach((e) => { if (e.name) knownSet.add(U.normalize(e.name)); }));
      knownAt = Date.now();
    }
    return knownSet.has(U.normalize(name));
  }
  function planOne(raw, prefer, today, opts, ctx) {
    if (raw.length < 2) return null;
    const P = parse(raw, today, { now: opts && opts.now, known: knownExercise });
    if (!P) return null;
    if (ctx && ctx.date && !P.date) { P.date = Object.assign({}, ctx.date); P.dateFromPrev = true; }
    let strong = !!(P.time || P.date || P.food || P.money || P.repeat || P.remind || P.workout || P.transfer || P.bday);
    const built = {};
    // Звичка (js/habits.js): рядок = назва звички + число / «пропуск» / дата («вода +2», «медитація», «читання 30 вчора»)
    if (CRM.habits && CRM.habits.quickOption && !P.repeat) {
      try { built.habit = CRM.habits.quickOption(P, { dateFor }); } catch (e) { console.error(e); }
      if (built.habit) strong = true;
    }
    built.contact = buildContact(P);
    built.birthday = buildBirthday(P);
    built.workout = buildWorkout(P, ctx);
    if (built.contact && built.contact.ok) strong = true;
    if (CRM.calendar && CRM.calendar.categoryName) built.event = buildEvent(P);
    if (CRM.tasks && CRM.tasks.create) built.task = buildTask(P);
    if (P.money && !P.repeat) {
      built.transfer = buildTransfer(P);
      built.expense = buildTx(P, 'expense');
      built.income = buildTx(P, 'income');
    }
    if (!P.repeat && !P.transfer && !P.workout) built.meal = buildMeal(P);
    const options = ORDER.map((k) => built[k]).filter(Boolean);
    if (!options.length) return null;
    // «65» без опису — це пошук суми, а не запис
    if (P.money && !P.money.cur && !P.money.sign && !P.food && !P.time && !P.date && !P.workout &&
      !words(P, ['money']).length) return null;
    const want = prefer && options.some((o) => o.kind === prefer) ? prefer : primaryKind(P, built);
    let index = options.findIndex((o) => o.kind === want);
    if (index < 0) index = 0;
    return { text: raw, strong, options, index, parsed: P };
  }
  /**
   * Що можна створити з рядка. Повертає { strong, options: [...], index } або null.
   * strong — у рядку є час, дата, сума чи вага (тоді картка — над результатами пошуку).
   * prefer — вид, який людина вибрала перемикачем (зберігається, поки вона дописує рядок).
   * Кілька записів через «;» → { multi: true, parts: [план кожної частини], strong: true };
   * тоді prefer — масив видів для частин. Частина без своєї дати бере дату попередньої.
   * opts.now — 'ГГ:ХХ' замість поточного часу (для тестів «через 30 хв»).
   */
  function plan(text, prefer, today, opts) {
    const raw = String(text || '').trim();
    const pieces = raw.split(';').map((x) => x.trim()).filter(Boolean);
    if (pieces.length > 1) {
      const ctx = { date: null, pending: [] };
      const parts = pieces.map((piece, k) => {
        const pl = planOne(piece, Array.isArray(prefer) ? prefer[k] : null, today, opts, ctx);
        if (!pl) return { text: piece, options: [], index: -1, empty: true };
        if (pl.parsed.date && !pl.parsed.dateFromPrev) ctx.date = pl.parsed.date;
        const o = pl.options[pl.index];
        if (o.kind === 'workout' && o.rec && o.rec.type !== 'cardio') ctx.pending.push({ type: o.rec.type, date: o.rec.date });
        return pl;
      });
      return { text: raw, multi: true, strong: true, parts, options: [], index: -1 };
    }
    return planOne(pieces[0] || '', Array.isArray(prefer) ? prefer[0] : prefer, today, opts, null);
  }

  // ---------- Створення ----------
  const shortOf = (o) => (/^(expense|income|transfer)$/.test(o.kind) ? `${o.title} ${o.parts[0] || ''}`.trim() : o.title);
  async function removeRec(store, id) { if (CRM.store.get(store, id)) await CRM.store.removeForever(store, id); }
  /**
   * Виконати варіант без тосту. → { kind, store, id, text, short, undo() } або null.
   */
  async function apply(o) {
    if (!o || !o.ok) return null;
    const short = shortOf(o);
    if (o.kind === 'habit') {
      const r = o.rec;
      const res = await CRM.habits.setDay(r.habitId, r.date, r.value);
      if (!res) return null;
      return {
        kind: 'habit', store: 'habits', id: r.habitId, short, text: `${o.title}: ${o.parts[0]}`,
        undo: () => CRM.habits.restoreDay(r.habitId, r.date, res.before, res.startBefore)
      };
    }
    if (o.kind === 'event') {
      const saved = await CRM.store.save('events', o.rec);
      const when = saved.repeat && CRM.calendar.repeatText ? CRM.calendar.repeatText(saved) + ', з ' + dayShort(saved.date) : dayShort(saved.date);
      return {
        kind: 'event', store: 'events', id: saved.id, short,
        text: `${saved.repeat ? 'Повторювану подію' : 'Подію'} додано: ${when}${saved.allDay ? '' : ', ' + saved.start + '–' + hhmm(toMin(saved.start) + saved.dur)}`,
        undo: () => removeRec('events', saved.id)
      };
    }
    if (o.kind === 'task') {
      const rec = Object.assign({}, o.rec);
      if (rec.planDate && !rec.planStart) rec.planOrder = CRM.tasks.nextPlanOrder(rec.planDate);
      const saved = await CRM.tasks.create(rec);
      const text = saved.planDate ? `Задачу додано в «План дня»: ${relDay(saved.planDate)}` : saved.deadline ? `Задачу додано, дедлайн — ${relDay(saved.deadline)}` : 'Задачу додано';
      return { kind: 'task', store: 'tasks', id: saved.id, short, text: text + (saved.remind != null ? ' · ' + remindText(saved.remind) : ''), undo: () => removeRec('tasks', saved.id) };
    }
    if (o.kind === 'expense' || o.kind === 'income' || o.kind === 'transfer') {
      const saved = await CRM.store.save('transactions', o.rec);
      try { CRM.finance.ensureRatesFor([saved]); } catch (e) { /* курси підвантажаться пізніше */ }
      const text = o.kind === 'transfer' ? `Переказ додано: ${o.parts[0]} · ${o.parts[1]}` : `${o.kind === 'income' ? 'Дохід' : 'Витрату'} додано: ${o.parts[0]} · ${o.parts[1] || ''}`;
      return { kind: o.kind, store: 'transactions', id: saved.id, short, text, rec: saved, undo: () => removeRec('transactions', saved.id) };
    }
    if (o.kind === 'meal') {
      const saved = await CRM.store.save('meals', o.rec);
      return {
        kind: 'meal', store: 'meals', id: saved.id, short,
        text: `У щоденник: ${saved.name}, ${o.parts[0]}${o.parts[1] && /ккал/.test(o.parts[1]) ? ' (' + o.parts[1] + ')' : ''}`,
        undo: () => removeRec('meals', saved.id)
      };
    }
    if (o.kind === 'workout') {
      const rec = U.deepClone(o.rec);
      const target = workoutTarget(rec.type, rec.date);
      if (target) {
        const before = U.deepClone(target);
        const merged = U.deepClone(target);
        merged.exercises = merged.exercises || [];
        rec.exercises.forEach((ex) => {
          const same = merged.exercises.find((e) => U.normalize(e.name) === U.normalize(ex.name));
          if (same) same.sets = (same.sets || []).concat(ex.sets); else merged.exercises.push(ex);
        });
        if (rec.durationMin) merged.durationMin = (Number(merged.durationMin) || 0) + rec.durationMin;
        const saved = await CRM.store.save('workouts', merged);
        return {
          kind: 'workout', store: 'workouts', id: saved.id, short,
          text: `Додано до тренування (${relDay(saved.date)}): ${o.title} ${o.parts[0]}`,
          undo: async () => { const cur = CRM.store.get('workouts', saved.id); if (cur) await CRM.store.save('workouts', before); }
        };
      }
      const saved = await CRM.store.save('workouts', rec);
      return {
        kind: 'workout', store: 'workouts', id: saved.id, short,
        text: `Тренування додано: ${o.title} · ${o.parts.filter((x) => !/тренуванн/.test(x)).slice(0, 2).join(' · ')}`,
        undo: () => removeRec('workouts', saved.id)
      };
    }
    if (o.kind === 'birthday') {
      const r = o.rec;
      const cur = r.personId ? CRM.store.get('people', r.personId) : null;
      if (cur && !cur.deletedAt) {
        const before = { bday: cur.bday || null, bdayYear: cur.bdayYear || null };
        const saved = await CRM.people.save(Object.assign({}, cur, { bday: r.md, bdayYear: r.year || null }));
        return {
          kind: 'birthday', store: 'people', id: saved.id, short,
          text: `День народження записано: ${saved.name} — ${CRM.people.mdText(r.md, r.year)}`,
          undo: async () => { const p = CRM.store.get('people', saved.id); if (p) await CRM.people.save(Object.assign({}, p, before)); }
        };
      }
      const saved = await CRM.people.save(CRM.people.blank({ name: r.name, bday: r.md, bdayYear: r.year || null }));
      return {
        kind: 'birthday', store: 'people', id: saved.id, short,
        text: `Додано в «Люди»: ${saved.name}, ДН ${CRM.people.mdText(r.md, r.year)}`,
        undo: () => removeRec('people', saved.id)
      };
    }
    if (o.kind === 'contact') {
      const r = o.rec;
      const cur = CRM.store.get('people', r.personId);
      if (!cur || cur.deletedAt) return null;
      const before = cur.lastContact || null;
      const date = before && before > r.date ? before : r.date;
      const saved = await CRM.people.save(Object.assign({}, cur, { lastContact: date }));
      return {
        kind: 'contact', store: 'people', id: saved.id, short,
        text: `Позначено: поспілкувались з ${saved.name} ${relDay(r.date)}`,
        undo: async () => { const p = CRM.store.get('people', saved.id); if (p) await CRM.people.save(Object.assign({}, p, { lastContact: before })); }
      };
    }
    return null;
  }
  /** Створити один запис (тост «Змінити · Скасувати»). */
  async function create(o) {
    if (!o || !o.ok) return details(o);
    if (o.kind === 'habit') return CRM.habits.quickApply(o);
    const res = await apply(o);
    if (!res) return null;
    CRM.ui.toast(res.text, {
      type: 'success', duration: 9000,
      actions: [
        { label: 'Змінити', onClick: () => { openSaved(res.kind, res.id); if (res.rec && (res.kind === 'expense' || res.kind === 'income')) watchCategory(res.rec); } },
        {
          label: 'Скасувати', onClick: async () => {
            await res.undo();
            CRM.ui.toast(res.kind === 'contact' || res.kind === 'birthday' || /^Додано до/.test(res.text) ? 'Скасовано' : 'Скасовано — запис не створено');
          }
        }
      ]
    });
    return res;
  }
  /** Кілька записів одним рядком (через «;»): усе, що можна, — одним Enter; «Скасувати» прибирає всі. */
  async function createAll(pl) {
    const done = [];
    const failed = [];
    for (const part of pl.parts) {
      const o = part.options[part.index];
      if (!o || !o.ok) { failed.push({ text: part.text, why: o ? o.problem : 'не зрозумів, що створити' }); continue; }
      try {
        const res = await apply(o);
        if (res) done.push(res); else failed.push({ text: part.text, why: 'не вдалося створити' });
      } catch (e) {
        console.error(e);
        failed.push({ text: part.text, why: e && e.message ? e.message : String(e) });
      }
    }
    if (done.length) {
      const list = done.map((d) => d.short).join(', ');
      CRM.ui.toast(`Додано ${fmt.count(done.length, ['запис', 'записи', 'записів'])}: ${list.length > 90 ? list.slice(0, 88) + '…' : list}`, {
        type: 'success', duration: 9000,
        action: {
          label: 'Скасувати', onClick: async () => {
            for (const d of done.slice().reverse()) { try { await d.undo(); } catch (e) { console.error(e); } }
            CRM.ui.toast('Скасовано — записи не створено');
          }
        }
      });
    }
    if (failed.length) {
      CRM.ui.toast('Не створено: ' + failed.map((f) => `«${f.text}» — ${f.why}`).join('; '), { type: 'error', duration: 12000 });
    }
    return done;
  }
  function openSaved(kind, id) {
    if (kind === 'event') return CRM.calendar.openEditor(id);
    if (kind === 'task') return CRM.tasks.openTask(id);
    if (kind === 'expense' || kind === 'income' || kind === 'transfer') return CRM.budget.openTxForm({ id });
    if (kind === 'meal') return CRM.nutrition.openEntry(id);
    if (kind === 'habit') return CRM.habits.openPage(id);
    if (kind === 'workout') return CRM.training.openForm(id);
    if (kind === 'birthday' || kind === 'contact') return CRM.people.openPerson(id);
    return null;
  }
  /** «Детальніше»: відкрити звичайну форму, уже заповнену з рядка. */
  async function details(o) {
    if (!o) return null;
    const r = o.rec || {};
    if (o.kind === 'habit') return CRM.habits.openPage(r.habitId);
    if (o.kind === 'event') return CRM.calendar.openEditor(null, r);
    if (o.kind === 'task') {
      const pre = Object.assign({}, r);
      if (pre.planDate && !pre.planStart) pre.planOrder = CRM.tasks.nextPlanOrder(pre.planDate);
      return CRM.tasks.openNew(pre);
    }
    if (o.kind === 'expense' || o.kind === 'income' || o.kind === 'transfer') {
      return CRM.budget.openTxForm({
        type: o.kind, amount: r.amount, accountId: r.accountId || undefined, toAccountId: r.toAccountId || undefined,
        categoryId: r.categoryId, subcategoryId: r.subcategoryId, date: r.date, comment: r.comment
      });
    }
    if (o.kind === 'meal') {
      const meal = r.meal || (o.rec ? o.rec.meal : null);
      return CRM.nutrition.openAdd({ date: r.date, meal: meal || undefined, food: o.food || undefined, grams: o.grams || undefined, query: o.food ? undefined : o.query });
    }
    if (o.kind === 'workout') return CRM.training.openForm(null, U.deepClone(r));
    if (o.kind === 'birthday') {
      if (r.personId && o.ok) { const res = await apply(o); return res ? CRM.people.openPerson(res.id) : null; }
      if (r.personId) return CRM.people.openPerson(r.personId);
      return CRM.people.openPerson(null, { name: r.name || '', bday: o.ok ? r.md : null, bdayYear: o.ok ? r.year || null : null });
    }
    if (o.kind === 'contact') {
      if (r.personId) return CRM.people.openPerson(r.personId);
      return CRM.people.openPerson(null, { name: r.name || '', lastContact: r.date && r.date <= D.today() ? r.date : null });
    }
    return null;
  }

  // ---------- «Запамʼятати слово» після зміни категорії ----------
  function keyWord(comment) {
    const w = wordsOf(comment).find((x) => x.length >= 3 && /^[a-zа-яіїєґ']+$/.test(x));
    return w || null;
  }
  /** Після «Змінити» стежимо за витратою: якщо категорію поміняли — пропонуємо запамʼятати слово. */
  function watchCategory(rec) {
    const word = keyWord(rec.comment);
    if (!word) return;
    let timer = null;
    const off = CRM.store.on(['transactions'], () => {
      const t = CRM.store.get('transactions', rec.id);
      if (!t || t.deletedAt) { off(); clearTimeout(timer); return; }
      if (t.categoryId === rec.categoryId && (t.subcategoryId || null) === (rec.subcategoryId || null)) return;
      off();
      clearTimeout(timer);
      if (t.type !== 'expense' && t.type !== 'income') return;
      const c = CRM.store.get('categories', t.categoryId);
      if (!c) return;
      const sub = (c.subcategories || []).find((x) => x.id === t.subcategoryId) || null;
      CRM.ui.toast(`Запамʼятати: «${word}» → ${c.name}${sub ? ' › ' + sub.name : ''}? Наступного разу CRM вибере цю категорію сама.`, {
        duration: 15000,
        action: { label: 'Запамʼятати', onClick: () => addWord(word, c.id, sub ? sub.id : null) }
      });
    });
    timer = setTimeout(off, 10 * 60000);
  }
  async function addWord(word, categoryId, subcategoryId) {
    const w = U.normalize(word).replace(/\s+/g, ' ').trim();
    if (!w) return false;
    const c = CRM.store.get('categories', categoryId);
    if (!c) return false;
    const list = ownWords().filter((x) => !(U.normalize(x.word) === w && (CRM.store.get('categories', x.categoryId) || {}).kind === c.kind));
    list.push({ word: w, categoryId, subcategoryId: subcategoryId || null });
    await CRM.store.setSetting('quickInput', Object.assign({}, settings(), { words: list }));
    CRM.ui.toast(`Запамʼятовано: «${w}» → ${c.name}`, { type: 'success' });
    return true;
  }
  async function removeWord(word, categoryId) {
    const list = ownWords().filter((x) => !(x.word === word && x.categoryId === categoryId));
    await CRM.store.setSetting('quickInput', Object.assign({}, settings(), { words: list }));
  }

  // ---------- Історія рядків (на цьому пристрої) ----------
  const HIST_KEY = 'crm.quick.history';
  const HIST_MAX = 50;
  function histRead() {
    try {
      const v = JSON.parse(localStorage.getItem(HIST_KEY) || '[]');
      return Array.isArray(v) ? v.filter((x) => x && typeof x.t === 'string' && x.t.trim()) : [];
    } catch (e) { return []; }
  }
  function histWrite(list) { try { localStorage.setItem(HIST_KEY, JSON.stringify(list.slice(0, HIST_MAX))); } catch (e) { /* без історії */ } }
  const history = {
    /** Рядки від найновішого. */
    list() { return histRead().sort((a, b) => (b.at || 0) - (a.at || 0)).map((x) => x.t); },
    /** Найчастіші (при рівності — новіші). */
    top(n) { return histRead().sort((a, b) => (b.n || 1) - (a.n || 1) || (b.at || 0) - (a.at || 0)).slice(0, n || 6).map((x) => x.t); },
    push(text) {
      const t = String(text || '').replace(/\s+/g, ' ').trim();
      if (t.length < 2) return;
      const list = histRead();
      const k = U.normalize(t);
      const old = list.find((x) => U.normalize(x.t) === k);
      const rest = list.filter((x) => x !== old).sort((a, b) => (b.at || 0) - (a.at || 0));
      histWrite([{ t, n: (old ? old.n || 1 : 0) + 1, at: Date.now() }].concat(rest));
    },
    remove(text) { histWrite(histRead().filter((x) => x.t !== text)); },
    clear() { histWrite([]); }
  };

  // ---------- Картка «Буде створено» (для вікна пошуку) ----------
  /**
   * pl — результат plan(); handlers: { onKind(kind), onCreate(), onDetails() }.
   */
  function card(pl, handlers) {
    if (pl.multi) return multiCard(pl, handlers);
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
  /** Картка для кількох записів: рядок на кожну частину, клік по виду — наступний вид. */
  function multiCard(pl, handlers) {
    const h = CRM.ui.h;
    const ok = pl.parts.filter((p) => p.options[p.index] && p.options[p.index].ok).length;
    const total = pl.parts.length;
    const rows = pl.parts.map((part, k) => {
      const o = part.options[part.index];
      if (!o) {
        return h('div', { class: 'quick-row quick-row-bad', dataset: { part: k } },
          h('span', { class: 'list-row-icon ico-danger' }, CRM.icon('alert', { size: 'sm' })),
          h('div', { class: 'quick-text' },
            h('div', { class: 'quick-title' }, part.text),
            h('div', { class: 'quick-problem' }, 'Не зрозумів, що створити — допиши суму, час чи дату.')));
      }
      const next = part.options.length > 1 ? part.options[(part.index + 1) % part.options.length] : null;
      return h('div', { class: 'quick-row' + (o.ok ? '' : ' quick-row-bad'), dataset: { part: k, kind: o.kind } },
        h('span', { class: 'list-row-icon ' + o.iconClass }, CRM.icon(o.icon, { size: 'sm' })),
        h('div', { class: 'quick-text' },
          h('div', { class: 'quick-title' }, o.title),
          h('div', { class: 'quick-parts' }, o.parts.filter(Boolean).join(' · ')),
          o.problem ? h('div', { class: 'quick-problem' }, CRM.icon('alert', { size: 'sm' }), o.problem) : null),
        h('button', {
          type: 'button', class: 'chip quick-row-kind', tabIndex: -1, disabled: !next,
          title: next ? `Змінити на «${next.label}»` : null, 'aria-label': next ? `${o.label} — змінити на «${next.label}»` : o.label,
          onMousedown: (e) => e.preventDefault(),
          onClick: (e) => { e.stopPropagation(); if (next) handlers.onKind(next.kind, k); }
        }, o.label, next ? CRM.icon('repeat', { size: 'sm' }) : null));
    });
    return h('div', { class: 'quick-card quick-multi', role: 'option' },
      h('div', { class: 'quick-head' },
        h('span', { class: 'quick-badge' }, CRM.icon('zap', { size: 'sm' }), `Буде створено: ${fmt.count(total, ['запис', 'записи', 'записів'])}`)),
      h('div', { class: 'quick-rows' }, rows),
      h('div', { class: 'quick-actions' },
        CRM.ui.button({
          label: ok === total ? 'Створити все' : `Створити ${ok} з ${total}`, variant: 'primary', size: 'sm', className: 'quick-create',
          disabled: !ok, onClick: (e) => { e.stopPropagation(); handlers.onCreate(); }
        }),
        h('span', { class: 'quick-keys' }, h('span', { class: 'kbd' }, 'Enter'), 'створити все')));
  }

  const EXAMPLES = ['завтра 15:00 урок', 'кава 65', 'пт купити подарунок', 'вівсянка 80 г', '+15000 зарплата'];
  const MORE_EXAMPLES = ['щопонеділка 18:00 англійська', 'нагадай о 18:00 купити хліб', 'переказ 1000 моно → готівка', 'біг 5 км 28 хв',
    'віджимання 3×20', 'ДР Марти 5 листопада', 'написав Марті', 'кава 65; таксі 120'];

  // ---------- Мій кабінет ----------
  function categoryOptions() {
    const h = CRM.ui.h;
    const group = (kind, label) => {
      const cats = CRM.store.list('categories').filter((c) => c.kind === kind).sort((a, b) => (a.order || 0) - (b.order || 0));
      if (!cats.length) return null;
      return h('optgroup', { label }, cats.map((c) => [h('option', { value: c.id + '|' }, c.name)]
        .concat((c.subcategories || []).map((s) => h('option', { value: c.id + '|' + s.id }, `${c.name} › ${s.name}`)))));
    };
    return [h('option', { value: '' }, 'Категорія…'), group('expense', 'Витрати'), group('income', 'Доходи')];
  }
  function wordsBlock() {
    const h = CRM.ui.h;
    const box = h('div', { class: 'quick-words' });
    function render() {
      const list = ownWords().slice().sort((a, b) => a.word.localeCompare(b.word, 'uk'));
      const rows = list.map((x) => {
        const c = CRM.store.get('categories', x.categoryId);
        const sub = c ? (c.subcategories || []).find((s) => s.id === x.subcategoryId) : null;
        return h('div', { class: 'quick-word', dataset: { word: x.word } },
          h('span', { class: 'quick-word-key' }, x.word),
          h('span', { class: 'subtle' }, '→'),
          h('span', { class: 'quick-word-cat' }, c ? c.name + (sub ? ' › ' + sub.name : '') : 'категорію видалено'),
          h('button', {
            type: 'button', class: 'btn btn-ghost btn-icon btn-sm', 'aria-label': `Прибрати «${x.word}»`, title: 'Прибрати',
            onClick: async () => { await removeWord(x.word, x.categoryId); render(); }
          }, CRM.icon('x', { size: 'sm' })));
      });
      const wordIn = h('input', { class: 'input quick-word-input', type: 'text', maxlength: 40, placeholder: 'Слово, напр. сільпо', 'aria-label': 'Слово' });
      const catSel = h('select', { class: 'select quick-word-cat-select', 'aria-label': 'Категорія для слова' }, categoryOptions());
      const err = h('div', { class: 'field-error', hidden: true });
      const add = async () => {
        const w = wordIn.value.trim();
        const [cid, sid] = (catSel.value || '|').split('|');
        if (!w) { err.textContent = 'Напиши слово.'; err.hidden = false; wordIn.focus(); return; }
        if (!cid) { err.textContent = 'Вибери категорію.'; err.hidden = false; catSel.focus(); return; }
        await addWord(w, cid, sid || null);
        render();
        const inp = box.querySelector('.quick-word-input');
        if (inp) inp.focus();
      };
      wordIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
      CRM.ui.mount(box,
        h('div', { class: 'setting-desc quick-account-label' }, 'Мої слова — слово з рядка одразу вибирає категорію (важливіше за «як минулого разу» і вбудований словник):'),
        rows.length ? h('div', { class: 'quick-word-list' }, rows) : h('div', { class: 'subtle quick-word-empty' }, 'Поки немає. Додай тут або натисни «Запамʼятати», коли поміняєш категорію щойно створеної витрати.'),
        h('div', { class: 'quick-word-add' }, wordIn, catSel, CRM.ui.button({ label: 'Додати', className: 'quick-word-btn', onClick: add })),
        err);
    }
    render();
    return box;
  }
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
        h('div', { class: 'setting-desc' }, 'Ctrl+K або кнопка ⚡ угорі: напиши рядок — CRM створить подію (і повторювану), задачу з нагадуванням, витрату, переказ, запис їжі чи тренування, день народження в «Людях» або відмітить звичку («вода +2»). Кілька записів — через «;». На компʼютері ↑ у порожньому полі — попередні рядки. Прості правила, не ШІ.'),
        h('div', { class: 'quick-examples' }, EXAMPLES.concat(MORE_EXAMPLES).map((x) => h('button', {
          type: 'button', class: 'chip', title: 'Спробувати', onClick: () => CRM.search.open(x, { quick: true })
        }, x))),
        h('label', { class: 'setting-desc quick-account-label' }, 'Рахунок для витрат і доходів (якщо в рядку не вказано інший, напр. «кава 65 моно»):'),
        sel,
        wordsBlock()));
  }

  CRM.quick = {
    parse, plan, create, createAll, apply, details, card, settingsBlock, EXAMPLES, MORE_EXAMPLES, words, dateFor, history,
    addWord, removeWord, ownWords
  };
})(window.CRM);
