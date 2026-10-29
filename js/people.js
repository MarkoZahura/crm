/* ==========================================================================
   people.js — розділ «Люди»: контакти, дні народження й інші важливі дати
   (щороку — у «Календарі» шаром «Дні народження й дати» і на Головній,
   нагадування за 7 днів і в день), ідеї подарунків, «давно не спілкувались»
   (частота + кнопка «Поспілкувались»), імпорт контактів з файлу .vcf.
   Дані — лише в браузері й синхронізації (сховище people), не в коді.

   Людина: { id, name, group, bday: 'ММ-ДД'|null, bdayYear: рік|null, phone, telegram, instagram, email, notes,
             dates: [{ id, title, md: 'ММ-ДД', year|null }],
             gifts: [{ id, text, done, doneAt, price: орієнтовна ціна|null, txId: витрата в Бюджеті|null }],
             freq: null|7|14|30|90|180 (днів), lastContact: 'РРРР-ММ-ДД'|null,
             remindDays: 14|7|3|1|0|-1 (за скільки днів нагадувати про ДН і дати; 0 — лише в день, -1 — ні; немає — 7),
             greetName: 'як звертатися' ('' — кличний відмінок імені автоматично),
             greeted: { 'РРРР': 'РРРР-ММ-ДД' } (коли привітали з ДН цього року) }
   Ключі нагадувань: people:soon:<id>:<bday|id дати>:<дата>, people:today:…, people:contact:<id>:<дата, коли настав час>
   Доробки 29.10 (етап 6): подарунок → витрата (openGiftExpense), «Привітати» (openGreet; свої шаблони —
   синхронізоване налаштування greetings { templates }), «Повʼязане» в картці (related: події, задачі, Google
   з імʼям людини в будь-якому відмінку), своє нагадування (remindDays), експорт .vcf (toVcf, openExport).
   ========================================================================== */
window.CRM = window.CRM || {};

(function (CRM) {
  'use strict';

  const { h, ui } = { h: CRM.ui.h, ui: CRM.ui };
  const D = CRM.date;
  const U = CRM.utils;
  const fmt = CRM.fmt;

  const GROUPS = [
    { id: 'family', label: 'Сімʼя', color: 'red' },
    { id: 'friends', label: 'Друзі', color: 'blue' },
    { id: 'work', label: 'Робота', color: 'orange' },
    { id: 'study', label: 'Навчання', color: 'violet' },
    { id: 'other', label: 'Інше', color: 'slate' }
  ];
  const FREQS = [
    { v: null, label: 'Не нагадувати' },
    { v: 7, label: 'Щотижня' },
    { v: 14, label: 'Раз на 2 тижні' },
    { v: 30, label: 'Щомісяця' },
    { v: 90, label: 'Раз на 3 місяці' },
    { v: 180, label: 'Раз на пів року' }
  ];
  const SOON_DAYS = 7;    // позначка «ДН через N днів» у списку
  const HOME_DAYS = 14;   // Головна — найближчі 2 тижні
  const PAGE_DAYS = 30;   // сторінка «Люди» — найближчий місяць
  const SORTS = [{ id: 'name', label: 'За імʼям' }, { id: 'bday', label: 'За днем народження' }, { id: 'contact', label: 'Давно не спілкувались' }];
  // Своє нагадування для людини (доробка 27): за скільки днів до ДН і дат
  const REMINDS = [
    { v: 14, label: 'За 2 тижні' }, { v: 7, label: 'За тиждень' }, { v: 3, label: 'За 3 дні' },
    { v: 1, label: 'За день' }, { v: 0, label: 'Лише в день' }, { v: -1, label: 'Не нагадувати' }
  ];
  const DEFAULT_REMIND = 7;
  const MAX_REMIND = 14;
  // «Привітати» (доробка 25): готові тексти; {імʼя} — звертання в кличному відмінку
  const GREETINGS = [
    '{імʼя}, з днем народження! 🎉 Бажаю здоровʼя, натхнення й побільше приводів усміхатися. Нехай цей рік буде щедрим на добрі події!',
    'З днем народження, {імʼя}! Щастя, тепла й усього, про що мрієш 🎂',
    '{імʼя}, вітаю з днем народження! Усього найкращого 🙌',
    '{імʼя}, щиро вітаю з днем народження! Бажаю міцного здоровʼя, успіхів у справах і гарного настрою.',
    '{імʼя}, з днем народження! Ти не старієш — ти прокачуєшся до нового рівня 😄 Нехай цей рівень буде найкращим!',
    '{імʼя}, з днем народження! Дякую, що ти є. Нехай поруч завжди будуть люди, з якими добре, а кожен день приносить щось приємне ❤️'
  ];
  const MAX_TEMPLATES = 20;
  // «Повʼязане» (доробка 26): скільки днів назад і вперед шукати
  const REL_PAST = 60;
  const REL_NEXT = 90;
  const REL_SHOW = 5;
  // Імена, що є й звичайними словами («роман», «віра», «ігор»), — лише з великої літери
  const AMBIG = new Set(['віра', 'надія', 'любов', 'люба', 'лев', 'роман', 'слава', 'злата', 'роза', 'лілія', 'калина', 'лука', 'соня', 'влад', 'ігор', 'мила']);

  // ---------- Дані ----------
  const list = () => CRM.store.list('people').slice().sort((a, b) => (a.name || '').localeCompare(b.name || '', 'uk'));
  const get = (id) => { const p = CRM.store.get('people', id); return p && !p.deletedAt ? p : null; };
  const groupOf = (id) => GROUPS.find((g) => g.id === id) || GROUPS[GROUPS.length - 1];
  const groupColor = (id) => CRM.dict.categoryColor(groupOf(id).color);
  const freqLabel = (v) => (FREQS.find((f) => f.v === v) || FREQS[0]).label;
  const openGifts = (p) => (p.gifts || []).filter((g) => g && g.text && !g.done);

  function canSave() {
    if (CRM.db.SCHEMA.people) return true;
    ui.toast('Браузер показує стару версію сайту з кешу — онови сторінку (Ctrl+F5), щоб додавати людей.', { type: 'error', duration: 9000 });
    return false;
  }
  async function save(rec) {
    const saved = await CRM.store.save('people', rec);
    CRM.notify.runRules();
    return saved;
  }

  // ---------- Річні дати ----------
  function validMd(md) {
    const m = /^(\d\d)-(\d\d)$/.exec(md || '');
    if (!m) return false;
    const mm = Number(m[1]);
    const dd = Number(m[2]);
    return mm >= 1 && mm <= 12 && dd >= 1 && dd <= D.daysInMonth(2024, mm);
  }
  const mdOf = (m, d) => D.pad(m) + '-' + D.pad(d);
  /** 'ММ-ДД' у році y (29 лютого в невисокосний рік → 28-ме). */
  function inYear(md, y) {
    const mm = Number(md.slice(0, 2));
    return D.make(y, mm, Math.min(Number(md.slice(3)), D.daysInMonth(y, mm)));
  }
  /** Найближча дата не раніше from. */
  function nextOf(md, from) {
    const y = D.parse(from).y;
    const a = inYear(md, y);
    return a >= from ? a : inYear(md, y + 1);
  }
  function mdText(md, year) {
    return `${Number(md.slice(3))} ${CRM.MONTHS_GEN[Number(md.slice(0, 2)) - 1]}` + (year ? ` ${year}` : '');
  }
  function dayShort(d) { return `${CRM.WEEKDAYS_SHORT[D.weekday(d)]}, ${fmt.dateShort(d)}`; }
  function inDays(d) {
    const n = D.diffDays(D.today(), d);
    if (n === 0) return 'сьогодні';
    if (n === 1) return 'завтра';
    if (n === -1) return 'вчора';
    return n > 0 ? 'через ' + fmt.count(n, ['день', 'дні', 'днів']) : fmt.count(-n, ['день', 'дні', 'днів']) + ' тому';
  }
  /** День народження й інші важливі дати людини. */
  function annual(p) {
    const out = [];
    if (p.bday && validMd(p.bday)) out.push({ id: 'bday', kind: 'birthday', title: 'День народження', md: p.bday, year: p.bdayYear || null });
    (p.dates || []).forEach((x) => {
      if (x && validMd(x.md)) out.push({ id: x.id, kind: 'date', title: (x.title || '').trim() || 'Важлива дата', md: x.md, year: x.year || null });
    });
    return out;
  }
  function entry(p, a, d) {
    const n = a.year ? D.parse(d).y - a.year : null;
    let yrs = '';
    if (n != null && n >= 0) {
      if (a.kind === 'birthday') yrs = d < D.today() ? `виповнилося ${n}` : `виповнюється ${n}`;
      else if (n > 0) yrs = fmt.count(n, ['рік', 'роки', 'років']);
    }
    return {
      key: p.id + ':' + a.id + ':' + d, person: p, personId: p.id, ann: a, kind: a.kind, date: d, years: n, yearsText: yrs,
      title: a.kind === 'birthday' ? `День народження: ${p.name}` : `${a.title}: ${p.name}`, gifts: openGifts(p).length
    };
  }
  /** Усі дні народження й дати від from до to (включно). */
  function datesBetween(from, to) {
    const out = [];
    const y0 = D.parse(from).y;
    const y1 = D.parse(to).y;
    list().forEach((p) => annual(p).forEach((a) => {
      for (let y = y0; y <= y1; y++) {
        if (a.year && y < a.year) continue;
        const d = inYear(a.md, y);
        if (d >= from && d <= to) out.push(entry(p, a, d));
      }
    }));
    return out.sort((x, y) => x.date.localeCompare(y.date) || (x.kind === 'birthday' ? -1 : 1) - (y.kind === 'birthday' ? -1 : 1) || x.person.name.localeCompare(y.person.name, 'uk'));
  }
  function upcoming(days) { const T = D.today(); return datesBetween(T, D.addDays(T, days)); }
  /** Найближча річна дата людини (для списку й сортування). */
  function nextAnnual(p) {
    const T = D.today();
    let best = null;
    annual(p).forEach((a) => {
      const d = nextOf(a.md, T);
      if (!best || d < best.date || (d === best.date && a.kind === 'birthday')) best = entry(p, a, d);
    });
    return best;
  }

  // ---------- «Давно не спілкувались» ----------
  function contactInfo(p) {
    if (!p.freq) return null;
    const T = D.today();
    const base = p.lastContact || (p.createdAt ? D.toKyivDate(p.createdAt) : T);
    const due = D.addDays(base, p.freq);
    return { base, due, overdue: due <= T, since: p.lastContact ? D.diffDays(p.lastContact, T) : null };
  }
  function lastText(p) {
    if (!p.lastContact) return 'ще не позначено, коли спілкувались';
    const n = D.diffDays(p.lastContact, D.today());
    if (n <= 0) return 'спілкувались сьогодні';
    if (n === 1) return 'спілкувались учора';
    return `спілкувались ${fmt.count(n, ['день', 'дні', 'днів'])} тому`;
  }
  function dueContacts() {
    return list().map((p) => ({ p, c: contactInfo(p) })).filter((x) => x.c && x.c.overdue)
      .sort((a, b) => a.c.due.localeCompare(b.c.due) || a.p.name.localeCompare(b.p.name, 'uk'));
  }
  async function markContacted(id) {
    const p = get(id);
    if (!p || !canSave()) return;
    const before = p.lastContact || null;
    await save(Object.assign({}, p, { lastContact: D.today() }));
    ui.toast(`Позначено: поспілкувались з ${p.name} сьогодні`, {
      type: 'success',
      action: { label: 'Скасувати', onClick: () => { const cur = get(id); if (cur) save(Object.assign({}, cur, { lastContact: before })); } }
    });
  }

  // ---------- Посилання ----------
  function tgUser(s) { return String(s || '').trim().replace(/^https?:\/\/(www\.)?(t\.me|telegram\.me)\//i, '').replace(/^@/, '').replace(/[/?#].*$/, '').replace(/[^A-Za-z0-9_]/g, ''); }
  function igUser(s) { return String(s || '').trim().replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/^@/, '').replace(/[/?#].*$/, '').replace(/[^A-Za-z0-9_.]/g, ''); }
  function telHref(phone) { const d = String(phone || '').replace(/[^\d+]/g, ''); return d.length >= 5 ? 'tel:' + d : null; }
  /** Як написати: Telegram, інакше — подзвонити. */
  function writeLink(p) {
    if (tgUser(p.telegram)) return { href: 'https://t.me/' + tgUser(p.telegram), label: 'Telegram' };
    const t = telHref(p.phone);
    return t ? { href: t, label: 'Подзвонити' } : null;
  }
  function avatar(p, big) {
    return h('span', { class: 'avatar ppl-avatar' + (big ? ' avatar-lg' : ''), style: { background: groupColor(p.group) }, 'aria-hidden': 'true' }, U.initials(p.name || '?') || '?');
  }

  // ---------- Своє нагадування (доробка 27) ----------
  /** За скільки днів нагадувати про ДН і дати людини: 14, 7, 3, 1, 0 (лише в день), -1 (не нагадувати). */
  function remindOf(p) {
    const v = p ? p.remindDays : null;
    return REMINDS.some((r) => r.v === v) ? v : DEFAULT_REMIND;
  }
  const remindLabel = (v) => (REMINDS.find((r) => r.v === v) || REMINDS[1]).label;

  // ---------- Відмінки імені: кличний («Марто») і орудний («з Мартою») ----------
  const UA_WORD = /^[а-щьюяєіїґ'ʼ’]+$/;
  const VOC_EXC = { 'тато': 'тату', 'ілля': 'ілле', 'федір': 'федоре', 'яків': 'якове', 'хрещена': 'хрещена', 'хрещений': 'хрещений' };
  const INS_EXC = { 'ігор': 'ігорем', 'федір': 'федором', 'яків': 'яковом', 'любов': 'любовʼю' };
  /** Кличний відмінок одного слова в нижньому регістрі (null — не знаємо, лишити як є). */
  function vocLower(w) {
    if (VOC_EXC[w]) return VOC_EXC[w];
    if (w.length < 2 || !UA_WORD.test(w)) return null;
    if (/(івна|ївна)$/.test(w)) return w.slice(0, -1) + 'о';                 // Петрівна → Петрівно
    if (/(ович|евич|євич|йович)$/.test(w)) return w + 'у';                    // Петрович → Петровичу
    const last = w.slice(-1);
    const b = w.slice(0, -1);
    if (last === 'а') return b + 'о';                                         // Марта → Марто, мама → мамо
    if (last === 'я') return /[іi]$/.test(b) ? b + 'є' : b + 'ю';             // Марія → Маріє, Оля → Олю
    if (last === 'й') return /[ії]$/.test(b) ? b + 'ю' : null;                // Андрій → Андрію
    if (last === 'о') return /к$/.test(b) ? b + 'у' : b + 'е';                // Марко → Марку, Петро → Петре
    if (last === 'ь') return b + 'ю';                                         // Василь → Василю, дідусь → дідусю
    if (last === 'к') return w + 'у';                                         // Ярик → Ярику, Марк → Марку
    if (last === 'г') return b + 'же';                                        // Олег → Олеже
    if (/[бвґдзлмнпрстфхцчшщж]/.test(last)) return w + 'е';                   // Іван → Іване, Ігор → Ігоре
    return null;
  }
  /** Орудний відмінок («зустріч з Мартою»). */
  function insLower(w) {
    if (INS_EXC[w]) return INS_EXC[w];
    if (w.length < 2 || !UA_WORD.test(w)) return null;
    const last = w.slice(-1);
    const b = w.slice(0, -1);
    if (last === 'а') return /[жчшщ]$/.test(b) ? b + 'ею' : b + 'ою';         // Марта → Мартою, Даша → Дашею
    if (last === 'я') return /[іi]$/.test(b) ? b + 'єю' : b + 'ею';           // Марія → Марією, Оля → Олею
    if (last === 'й') return /[ії]$/.test(b) ? b + 'єм' : null;               // Андрій → Андрієм
    if (last === 'о') return b + 'ом';                                        // Петро → Петром
    if (last === 'ь') return b + 'ем';                                        // Василь → Василем
    if (/[жчшщ]/.test(last)) return w + 'ем';
    if (/[бвгґдзклмнпрстфхц]/.test(last)) return w + 'ом';                    // Іван → Іваном
    return null;
  }
  /** Застосувати відмінок до слова (зберігаючи велику літеру й частини через дефіс). */
  function caseWord(word, fn) {
    return String(word).split('-').map((part) => {
      if (!part) return part;
      const lw = part.toLowerCase();
      const r = fn(lw);
      if (!r) return part;
      return part[0] !== lw[0] ? r.charAt(0).toUpperCase() + r.slice(1) : r;
    }).join('-');
  }
  const nameWords = (p) => String((p && p.name) || '').trim().split(/\s+/).filter(Boolean);
  const firstName = (p) => nameWords(p)[0] || '';
  /** Звертання: своє з картки або кличний відмінок імені (з по батькові, якщо записано). */
  function autoAddress(p) {
    const w = nameWords(p);
    if (!w.length) return '';
    const first = caseWord(w[0], vocLower);
    if (w[1] && /(івна|ївна|ович|евич|євич|йович)$/i.test(w[1])) return first + ' ' + caseWord(w[1], vocLower);
    return first;
  }
  function greetAddress(p) { return String((p && p.greetName) || '').trim() || autoAddress(p); }
  /** «з Мартою» — для назви нової події. */
  function withName(p) { const f = firstName(p); return f ? caseWord(f, insLower) : ''; }

  // ---------- «Привітати» (доробка 25) ----------
  function ownTemplates() {
    const g = CRM.store.getSetting('greetings', null);
    return g && Array.isArray(g.templates) ? g.templates.filter((t) => typeof t === 'string' && t.trim()) : [];
  }
  function allTemplates() { return ownTemplates().concat(GREETINGS); }
  /** Підставити звертання замість {імʼя} (також {ім'я}, {імя}, {name}); перша літера — велика. */
  function fillGreeting(tpl, addr) {
    let s = String(tpl || '').replace(/\{\s*(ім[ʼ'’]?я|name)\s*\}/gi, addr || '');
    s = s.replace(/^\s*,\s*/, '').trim();
    return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
  }
  /** Найближчий (до сьогодні) день народження: { date, year, left } або null. */
  function greetOcc(p) {
    if (!p || !p.bday || !validMd(p.bday)) return null;
    const T = D.today();
    const y = D.parse(T).y;
    let best = null;
    [y - 1, y, y + 1].forEach((yy) => {
      const d = inYear(p.bday, yy);
      const left = D.diffDays(T, d);
      if (!best || Math.abs(left) < Math.abs(best.left) || (Math.abs(left) === Math.abs(best.left) && left > best.left)) best = { date: d, year: yy, left };
    });
    return best;
  }
  /** Дата, коли привітали з цим днем народження (або null). */
  function greetedAt(p, occ) {
    const o = occ || greetOcc(p);
    return o && p.greeted && p.greeted[o.year] ? p.greeted[o.year] : null;
  }
  const isBdayToday = (p) => { const o = greetOcc(p); return !!o && o.left === 0; };
  /** Посилання в Telegram з уже вписаним текстом: t.me/<username>?text=… або t.me/+<номер>?text=… */
  function tgLink(p, text) {
    const q = text ? '?text=' + encodeURIComponent(text) : '';
    const u = tgUser(p.telegram);
    if (u) return { href: 'https://t.me/' + u + q, byPhone: false };
    let d = String(p.phone || '').replace(/\D/g, '');
    if (d.length === 10 && d[0] === '0') d = '38' + d;      // 067… → 38067…
    return d.length >= 11 ? { href: 'https://t.me/+' + d + q, byPhone: true } : null;
  }
  async function copyText(text, area) {
    try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; } } catch (e) { /* далі — запасний спосіб */ }
    try {
      area.focus();
      area.select();
      return document.execCommand('copy');
    } catch (e) { return false; }
  }
  /** Позначити: привітали (цього року) і поспілкувались сьогодні. Повертає «Скасувати». */
  async function markGreeted(id, year) {
    const p = get(id);
    if (!p) return null;
    const T = D.today();
    const before = { greeted: p.greeted ? U.deepClone(p.greeted) : null, lastContact: p.lastContact || null };
    const greeted = Object.assign({}, p.greeted || {});
    greeted[year] = T;
    await save(Object.assign({}, p, { greeted, lastContact: !p.lastContact || p.lastContact < T ? T : p.lastContact }));
    return async () => { const cur = get(id); if (cur) await save(Object.assign({}, cur, before)); };
  }

  /** Вікно «Привітати»: готовий текст → «Копіювати», «Telegram», на телефоні «Надіслати…». */
  function openGreet(id) {
    const p = get(id);
    if (!p) { ui.toast('Цієї людини більше немає', { type: 'error' }); return null; }
    if (!canSave()) return null;
    const occ = greetOcc(p);
    const tpls = allTemplates();
    const own = ownTemplates().length;
    // Без своїх шаблонів — різним людям різні тексти (сталий вибір для людини й року)
    let idx = 0;
    if (!own) {
      let hs = 0;
      String(p.id + (occ ? occ.year : '')).split('').forEach((ch) => { hs = (hs * 31 + ch.charCodeAt(0)) >>> 0; });
      idx = hs % tpls.length;
    }
    let edited = false;
    const auto = autoAddress(p);
    const addrIn = ui.input({ value: greetAddress(p), maxlength: 60, placeholder: auto, 'aria-label': 'Як звертатися', class: 'input greet-addr' });
    const textIn = ui.textarea({ rows: 5, maxlength: 2000, 'aria-label': 'Текст привітання', class: 'textarea greet-text' });
    const countEl = h('span', { class: 'subtle greet-count' });
    const tgBox = h('span', { class: 'greet-tg-box' });
    const tgHint = h('div', { class: 'subtle greet-tg-hint' });
    let done = false;

    function compose() {
      textIn.value = fillGreeting(tpls[idx], addrIn.value.trim() || auto || firstName(p));
      edited = false;
      countEl.textContent = `${idx + 1} з ${tpls.length}` + (idx < own ? ' · мій шаблон' : '');
      updateLinks();
    }
    function updateLinks() {
      const cur = get(id) || p;
      const tg = tgLink(cur, textIn.value.trim());
      ui.mount(tgBox, tg ? h('a', {
        class: 'btn greet-tg', href: tg.href, target: '_blank', rel: 'noopener',
        onClick: () => { setTimeout(() => finish('tg'), 0); }
      }, CRM.icon('external', { size: 'sm' }), h('span', { class: 'btn-label' }, 'Telegram')) : null);
      tgHint.textContent = tg && tg.byPhone ? 'Telegram за номером телефону відкриє чат, лише якщо людина дозволила знаходити себе за номером. Інакше — «Копіювати».' : '';
    }
    let addrTimer = null;
    addrIn.addEventListener('input', () => {
      if (!edited) compose();
      clearTimeout(addrTimer);
      addrTimer = setTimeout(saveAddr, 500);
    });
    async function saveAddr() {
      clearTimeout(addrTimer);
      addrTimer = null;
      const cur = get(id);
      if (!cur) return;
      const v = addrIn.value.trim();
      const want = v && v !== auto ? v : '';
      if ((cur.greetName || '') !== want) await save(Object.assign({}, cur, { greetName: want }));
    }
    textIn.addEventListener('input', () => { edited = true; updateLinks(); });

    async function finish(how) {
      if (done) return;
      done = true;
      if (addrTimer) await saveAddr();
      dlg.close('force');
      const undo = await markGreeted(id, occ ? occ.year : D.parse(D.today()).y);
      const first = firstName(p);
      const msg = (how === 'copy' ? 'Текст скопійовано — встав його в месенджер. ' : '') + `Позначено: ${first || p.name} — привітано, поспілкувались сьогодні`;
      ui.toast(msg, { type: 'success', duration: 8000, action: undo ? { label: 'Скасувати', onClick: undo } : null });
    }
    const copyBtn = ui.button({
      label: 'Копіювати', icon: 'copy', variant: 'primary', className: 'greet-copy',
      onClick: async () => {
        const ok = await copyText(textIn.value, textIn);
        if (!ok) { ui.toast('Не вдалося скопіювати — виділи текст і скопіюй вручну.', { type: 'error' }); return; }
        finish('copy');
      }
    });
    const shareBtn = navigator.share ? ui.button({
      label: 'Надіслати…', icon: 'upload', className: 'greet-share', title: 'Меню «Поділитися»: Viber, WhatsApp, Повідомлення…',
      onClick: async () => {
        try { await navigator.share({ text: textIn.value }); finish('share'); } catch (e) { /* скасовано — нічого не позначаємо */ }
      }
    }) : null;
    const nextBtn = ui.button({ label: 'Інший текст', icon: 'refresh', size: 'sm', className: 'greet-next', onClick: () => { idx = (idx + 1) % tpls.length; compose(); textIn.focus(); } });

    let when = 'День народження не вказано — привітання все одно можна надіслати.';
    if (occ) {
      const age = p.bdayYear ? occ.year - p.bdayYear : null;
      const ageTxt = age != null && age > 0 ? (occ.left < 0 ? ` · виповнилося ${age}` : ` · виповнюється ${age}`) : '';
      if (occ.left === 0) when = 'Сьогодні день народження' + ageTxt;
      else if (occ.left === -1) when = 'День народження був учора' + ageTxt;
      else if (occ.left < 0) when = `День народження був ${dayShort(occ.date)} (${inDays(occ.date)})` + ageTxt;
      else when = `День народження — ${dayShort(occ.date)} (${inDays(occ.date)})` + ageTxt;
      const g = greetedAt(p, occ);
      if (g) when += ` · уже привітано ${fmt.dateShort(g)}`;
    }
    const personBtn = ui.button({ label: 'Картка', icon: 'user', size: 'sm', variant: 'ghost', className: 'greet-person', title: 'Відкрити картку людини', onClick: () => { dlg.close('button'); if (!document.querySelector('.ppl-drawer')) openPerson(id); } });
    const body = h('div', { class: 'stack greet-body' },
      h('div', { class: 'greet-when' }, CRM.icon('cake', { size: 'sm' }), h('span', { class: 'grow' }, when), personBtn),
      ui.field({ label: 'Як звертатися', input: addrIn, hint: `Автоматично — «${auto}». Своє звертання запамʼятається для цієї людини.` }),
      h('div', { class: 'field' },
        h('div', { class: 'greet-text-head' }, h('span', { class: 'field-label' }, 'Текст'), h('span', { class: 'greet-tools' }, countEl, nextBtn)),
        textIn,
        h('div', { class: 'field-hint' }, 'Можна змінити перед надсиланням. Свої шаблони — «Мій кабінет» → «Привітання».')),
      tgHint);
    const dlg = ui.modal({
      title: 'Привітати: ' + p.name, size: 'md', className: 'greet-modal', body,
      footer: [shareBtn, tgBox, copyBtn],
      initialFocus: copyBtn,
      onClose: () => { if (addrTimer) saveAddr(); }
    });
    compose();
    return dlg;
  }

  // ---------- Подарунок → витрата (доробка 24) ----------
  function giftAccounts() {
    try { return CRM.finance.rankedAccounts().map((x) => x.account).filter((a) => a && !a.deletedAt && !a.archived); } catch (e) { return []; }
  }
  function giftDefaultAccount(accounts) {
    const byId = (x) => accounts.find((a) => a.id === x) || null;
    const qi = CRM.store.getSetting('quickInput', null) || {};
    const last = CRM.store.getSetting('budget.lastAccount', {}) || {};
    return byId(qi.accountId) || byId(last.expense) || byId(last.any) ||
      accounts.find((a) => a.type !== 'savings' && a.currency === 'UAH') || accounts[0] || null;
  }
  function expenseCats() {
    return CRM.store.list('categories').filter((c) => c.kind === 'expense').sort((a, b) => (a.order || 0) - (b.order || 0));
  }
  /** Категорія для подарунка: «Подарунки» → словник швидкого введення → «Інше». */
  function giftCategory(cats) {
    const c = cats.find((x) => U.normalize(x.name) === 'подарунки') || cats.find((x) => /^подарун/.test(U.normalize(x.name)));
    if (c) return { cat: c, sub: null };
    try {
      const g = CRM.quick && CRM.quick.guessCategory ? CRM.quick.guessCategory('expense', 'подарунок', null) : null;
      if (g && g.cat) return { cat: g.cat, sub: g.sub || null };
    } catch (e) { /* без швидкого введення */ }
    const other = cats.find((x) => U.normalize(x.name) === 'інше') || cats[cats.length - 1];
    return other ? { cat: other, sub: null } : null;
  }
  const parseAmount = (s) => {
    const n = Number(String(s == null ? '' : s).replace(/[\s  ₴]/g, '').replace(',', '.'));
    return Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
  };
  /** Чи можна записати витрату (є рахунки й категорії витрат, бюджет завантажено). */
  function canGiftExpense() { return !!(CRM.finance && CRM.budget) && giftAccounts().length > 0 && expenseCats().length > 0; }
  /**
   * Вікно «Скільки коштував?» після галочки «подаровано».
   * handlers: { onSaved(txId), onUndo() } — щоб картка людини оновила свій стан.
   */
  function openGiftExpense(person, gift, handlers) {
    const hd = handlers || {};
    const accounts = giftAccounts();
    const cats = expenseCats();
    if (!accounts.length || !cats.length) return null;
    const acc0 = giftDefaultAccount(accounts);
    const cat0 = giftCategory(cats);
    const amountIn = ui.input({ inputmode: 'decimal', value: gift.price ? String(gift.price).replace('.', ',') : '', placeholder: '0', 'aria-label': 'Сума', class: 'input gift-amount', autocomplete: 'off' });
    const curEl = h('span', { class: 'gift-cur subtle' });
    const fAmount = ui.field({ label: 'Скільки коштував', required: true, input: h('div', { class: 'gift-amount-row' }, amountIn, curEl) });
    const accSel = h('select', { class: 'select gift-account', 'aria-label': 'Рахунок' },
      accounts.map((a) => h('option', { value: a.id, selected: acc0 && a.id === acc0.id }, a.name + (a.currency !== 'UAH' ? ` (${a.currency})` : ''))));
    const showCur = () => { const a = accounts.find((x) => x.id === accSel.value); curEl.textContent = a ? a.currency : ''; };
    accSel.addEventListener('change', showCur);
    showCur();
    const catSel = h('select', { class: 'select gift-cat', 'aria-label': 'Категорія' });
    cats.forEach((c) => {
      catSel.appendChild(h('option', { value: c.id + '|', selected: cat0 && cat0.cat.id === c.id && !cat0.sub }, c.name));
      (c.subcategories || []).forEach((s) => catSel.appendChild(h('option', { value: c.id + '|' + s.id, selected: cat0 && cat0.sub && cat0.sub.id === s.id }, `${c.name} › ${s.name}`)));
    });
    const dateIn = ui.dateInput({ value: gift.doneAt || D.today(), clearable: false, ariaLabel: 'Дата витрати' });
    const comment = `Подарунок: ${gift.text} — ${person.name}`;
    const body = h('div', { class: 'form-stack gift-form' },
      h('p', { class: 'modal-text' }, `Для: ${person.name}. Запишу витрату в «Бюджет» з коментарем «${comment}».`),
      fAmount,
      h('div', { class: 'form-grid' }, ui.field({ label: 'Рахунок', input: accSel }), ui.field({ label: 'Категорія', input: catSel })),
      ui.field({ label: 'Дата', input: dateIn }));
    async function add() {
      const amount = parseAmount(amountIn.value);
      if (!amount) { fAmount.setError('Вкажи суму, більшу за 0'); amountIn.focus(); return; }
      const [categoryId, sub] = catSel.value.split('|');
      const rec = {
        type: 'expense', amount, accountId: accSel.value, toAccountId: null, toAmount: null,
        categoryId, subcategoryId: sub || null, date: dateIn.dateValue || D.today(), comment,
        recurringId: null, recurringDate: null, gift: { personId: person.id, giftId: gift.id }
      };
      dlg.close('force');
      const saved = await CRM.store.save('transactions', rec);
      try { CRM.finance.ensureRatesFor([saved]); } catch (e) { /* курси підвантажаться пізніше */ }
      const lastAcc = Object.assign({}, CRM.store.getSetting('budget.lastAccount', {}) || {}, { expense: saved.accountId, any: saved.accountId });
      CRM.store.setSetting('budget.lastAccount', lastAcc);
      if (hd.onSaved) hd.onSaved(saved.id, amount);
      const acc = accounts.find((a) => a.id === saved.accountId);
      ui.toast(`Витрату додано: ${fmt.money(-amount, acc ? acc.currency : 'UAH', { sign: true })} · ${comment}`, {
        type: 'success',
        actions: [
          { label: 'Змінити', onClick: () => CRM.budget.openTxForm({ id: saved.id }) },
          { label: 'Скасувати', onClick: async () => { await CRM.store.removeForever('transactions', saved.id); if (hd.onUndo) hd.onUndo(saved.id); } }
        ]
      });
    }
    amountIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    const dlg = ui.modal({
      title: 'Подаровано: ' + gift.text, size: 'sm', className: 'gift-modal', body,
      footer: [
        ui.button({ label: 'Без витрати', className: 'gift-skip', onClick: () => dlg.close('button') }),
        ui.button({ label: 'Додати витрату', icon: 'receipt', variant: 'primary', className: 'gift-add', onClick: add })
      ],
      initialFocus: amountIn
    });
    if (amountIn.value) amountIn.select();
    return dlg;
  }
  /** Витрата подарунка (якщо ще існує й не в Кошику). */
  function giftTx(g) {
    if (!g || !g.txId) return null;
    const t = CRM.store.get('transactions', g.txId);
    return t && !t.deletedAt ? t : null;
  }
  function txMoney(t) {
    const acc = CRM.store.get('accounts', t.accountId);
    return fmt.money(t.amount, acc ? acc.currency : 'UAH');
  }

  // ---------- «Повʼязане»: події, задачі й Google з імʼям людини (доробка 26) ----------
  const TOKEN_SPLIT = /[^0-9A-Za-zА-ЯҐЄІЇа-яґєії'ʼ’]+/;
  /**
   * Перевірка тексту: чи згадано людину — імʼя в будь-якому відмінку або прізвище (з великої літери).
   * Якщо є інша людина з тим самим імʼям, а в тексті — її прізвище, це не про цю людину.
   */
  function mentionMatcher(p) {
    const w = nameWords(p);
    if (!w.length) return () => false;
    const first = U.normalize(w[0]).split('-')[0];
    if (first.length < 2) return () => false;
    const firstForms = nameForms(first);
    const strictCase = AMBIG.has(first);
    const sur = w.length > 1 ? U.normalize(w[w.length - 1]) : null;
    const surForms = sur && sur.length >= 3 ? nameForms(sur) : null;
    const otherSur = new Set();
    list().forEach((o) => {
      if (o.id === p.id) return;
      const ow = nameWords(o);
      if (ow.length < 2 || U.normalize(ow[0]).split('-')[0] !== first) return;
      const os = U.normalize(ow[ow.length - 1]);
      if (os !== sur) nameForms(os).forEach((f) => otherSur.add(f));
    });
    const upper = (t) => t[0] !== t[0].toLowerCase();
    return (text) => {
      if (!text) return false;
      let hitFirst = false;
      let hitSur = false;
      let hitOther = false;
      String(text).split(TOKEN_SPLIT).forEach((t) => {
        if (!t) return;
        const n = U.normalize(t);
        if (firstForms.has(n) && (!strictCase || upper(t))) hitFirst = true;
        if (surForms && surForms.has(n) && upper(t)) hitSur = true;
        if (otherSur.has(n) && upper(t)) hitOther = true;
      });
      return hitSur || (hitFirst && !hitOther);
    };
  }
  /**
   * Події (власні й Google) і задачі, де згадано людину.
   * → { next: [...], past: [...] }; пункт: { kind: event|task|gcal, key, date, time, title, done, overdue, series, … }
   */
  function related(p) {
    const T = D.today();
    const from = D.addDays(T, -REL_PAST);
    const to = D.addDays(T, REL_NEXT);
    const m = mentionMatcher(p);
    const next = [];
    const past = [];
    // Власні події (з повторами): для кожної — найближчий майбутній і останній минулий день
    if (CRM.calendar && CRM.calendar.occurrences) {
      let occ = [];
      try { occ = CRM.calendar.occurrences(from, to); } catch (e) { console.error(e); }
      const nx = new Map();
      const ps = new Map();
      occ.forEach((o) => {
        const ev = o.ev;
        if (!ev || !(m(ev.title) || m(ev.note))) return;
        const it = {
          kind: 'event', key: 'e:' + ev.id, id: ev.id, occ: ev.occ || null, date: o.date,
          time: ev.allDay ? null : ev.start, title: ev.title || 'Подія', series: !!(ev.repeat || ev.occ)
        };
        if (o.date >= T) { if (!nx.has(ev.id) || nx.get(ev.id).date > o.date) nx.set(ev.id, it); }
        else if (!ps.has(ev.id) || ps.get(ev.id).date < o.date) ps.set(ev.id, it);
      });
      nx.forEach((it) => next.push(it));
      ps.forEach((it) => past.push(it));
    }
    // Задачі: активні — у «Найближче», виконані за останні 2 місяці — у «Нещодавно»
    CRM.store.list('tasks').forEach((t) => {
      if (!(m(t.title) || m(t.description))) return;
      const it = { kind: 'task', key: 't:' + t.id, id: t.id, title: t.title || 'Задача', done: !!t.done };
      if (!t.done) {
        it.date = t.planDate || t.deadline || null;
        it.time = t.planDate ? t.planStart || null : t.deadlineTime || null;
        it.overdue = !!it.date && it.date < T;
        it.what = t.planDate ? 'план' : t.deadline ? 'дедлайн' : null;
        next.push(it);
      } else {
        it.date = t.completedAt ? D.toKyivDate(t.completedAt) : (t.planDate || t.deadline || null);
        if (it.date && it.date >= from) past.push(it);
      }
    });
    // Google Календар — лише те, що вже завантажено
    if (CRM.gcal && CRM.gcal.eventsBetween) {
      let gs = [];
      try { gs = CRM.gcal.eventsBetween(from, to); } catch (e) { gs = []; }
      gs.forEach((e) => {
        if (!m(e.title)) return;
        const date = e.allDay ? e.start : D.toKyivDate(e.start);
        const endDay = e.allDay ? D.addDays(e.end, -1) : D.toKyivDate(new Date(Math.max(Date.parse(e.end) - 1, Date.parse(e.start))));
        const it = { kind: 'gcal', key: 'g:' + e.cal + ':' + e.id, ev: e, date: endDay >= T && date < T ? T : date, time: e.allDay ? null : (CRM.gcal.hhmm ? CRM.gcal.hhmm(e.start) : null), title: e.title };
        (endDay >= T ? next : past).push(it);
      });
    }
    const key = (x) => (x.date || '9999-99-99') + ' ' + (x.time || '');
    next.sort((a, b) => key(a).localeCompare(key(b)) || a.title.localeCompare(b.title, 'uk'));
    past.sort((a, b) => key(b).localeCompare(key(a)) || a.title.localeCompare(b.title, 'uk'));
    return { next, past };
  }

  // ---------- Експорт у .vcf (доробка 28) ----------
  const vEsc = (s) => String(s == null ? '' : s).replace(/\\/g, '\\\\').replace(/\r?\n/g, '\\n').replace(/,/g, '\\,').replace(/;/g, '\\;');
  /** Перенесення довгих рядків vCard: не більше 75 байтів у рядку, продовження — з пробілу. */
  function vFold(line) {
    const enc = new TextEncoder();
    const out = [];
    let cur = '';
    let bytes = 0;
    let limit = 75;
    for (const ch of line) {
      const b = enc.encode(ch).length;
      if (bytes + b > limit) { out.push(cur); cur = ''; bytes = 0; limit = 74; }
      cur += ch;
      bytes += b;
    }
    out.push(cur);
    return out.join('\r\n ');
  }
  function vDateOut(md, year) {
    return year ? { params: '', value: `${year}-${md}` } : { params: ';X-APPLE-OMIT-YEAR=1604', value: `1604-${md}` };
  }
  /** Люди → текст .vcf (vCard 3.0, UTF-8). Ідеї подарунків, частота й нагадування — не експортуються. */
  function toVcf(people) {
    const lines = [];
    (people || []).forEach((p) => {
      const w = nameWords(p);
      const given = w[0] || '';
      const family = w.length > 1 ? w.slice(1).join(' ') : '';
      lines.push('BEGIN:VCARD', 'VERSION:3.0', 'PRODID:-//Моя CRM//UK', 'FN:' + vEsc(p.name), `N:${vEsc(family)};${vEsc(given)};;;`);
      if (p.phone) lines.push('TEL;TYPE=CELL:' + vEsc(p.phone));
      if (p.email) lines.push('EMAIL;TYPE=INTERNET:' + vEsc(p.email));
      if (p.bday && validMd(p.bday)) { const d = vDateOut(p.bday, p.bdayYear); lines.push('BDAY' + d.params + ':' + d.value); }
      let n = 0;
      (p.dates || []).forEach((x) => {
        if (!x || !validMd(x.md)) return;
        n++;
        const d = vDateOut(x.md, x.year);
        const title = (x.title || '').trim();
        lines.push(`item${n}.X-ABDATE${d.params}:${d.value}`, `item${n}.X-ABLabel:` + (/^річниця$/i.test(title) ? '_$!<Anniversary>!$_' : vEsc(title || 'Важлива дата')));
      });
      if (tgUser(p.telegram)) lines.push('X-SOCIALPROFILE;TYPE=telegram:https://t.me/' + tgUser(p.telegram));
      if (igUser(p.instagram)) lines.push('X-SOCIALPROFILE;TYPE=instagram:https://instagram.com/' + igUser(p.instagram));
      if (p.notes) lines.push('NOTE:' + vEsc(p.notes));
      lines.push('CATEGORIES:' + vEsc(groupOf(p.group).label), 'END:VCARD');
    });
    return lines.map(vFold).join('\r\n') + (lines.length ? '\r\n' : '');
  }
  function vcfName(s) { return (String(s || '').replace(/[\\/:*?"<>|\r\n\t]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'contact') + '.vcf'; }
  function downloadVcf(people, fileName) {
    const blob = new Blob([toVcf(people)], { type: 'text/vcard;charset=utf-8' });
    U.downloadBlob(blob, fileName);
  }
  /** Вікно «Експорт .vcf»: вибрати людей (усі / група / пошук) і зберегти файл. */
  function openExport() {
    const all = list();
    if (!all.length) { ui.toast('Ще нікого немає — нема чого зберігати.'); return null; }
    const rows = all.map((p) => ({ p, on: true }));
    let q = '';
    const listEl = h('div', { class: 'ppl-imp-list ppl-exp-list' });
    const countEl = h('span');
    const goBtn = ui.button({ label: 'Зберегти', icon: 'download', variant: 'primary', className: 'ppl-exp-go', onClick: run });
    function updateCount() {
      const n = rows.filter((r) => r.on).length;
      countEl.textContent = `Вибрано: ${n} з ${rows.length}`;
      goBtn.querySelector('.btn-label').textContent = n ? `Зберегти ${n}` : 'Зберегти';
      goBtn.disabled = !n;
    }
    function renderRows() {
      const vis = rows.filter((r) => !q || U.normalize(r.p.name).includes(U.normalize(q)));
      ui.mount(listEl, vis.length ? vis.map((r) => {
        const sub = [groupOf(r.p.group).label, r.p.bday && validMd(r.p.bday) ? 'ДН ' + mdText(r.p.bday, r.p.bdayYear) : null, r.p.phone].filter(Boolean).join(' · ');
        const box = h('input', { type: 'checkbox', checked: r.on, 'aria-label': r.p.name });
        box.addEventListener('change', () => { r.on = box.checked; updateCount(); });
        return h('label', { class: 'ppl-imp-row ppl-exp-row', dataset: { id: r.p.id } }, box,
          h('span', { class: 'ppl-up-main' }, h('span', { class: 'ppl-up-title' }, r.p.name), h('span', { class: 'ppl-up-sub' }, sub)));
      }) : h('div', { class: 'subtle ppl-imp-none' }, 'Нікого не знайдено.'));
      updateCount();
    }
    const pick = (fn) => { rows.forEach((r) => { r.on = fn(r); }); renderRows(); };
    const search = ui.input({ type: 'search', placeholder: 'Пошук…', 'aria-label': 'Пошук людей для експорту', class: 'input ppl-imp-search' });
    search.addEventListener('input', () => { q = search.value; renderRows(); });
    const groups = GROUPS.filter((g) => all.some((p) => (p.group || 'other') === g.id));
    const body = h('div', { class: 'stack ppl-imp ppl-exp' },
      h('p', { class: 'modal-text' }, 'Вибери, кого зберегти у файл .vcf (його відкриють iPhone, Google Контакти, Outlook). У файл ідуть імʼя, телефон, email, Telegram, Instagram, день народження, інші дати й нотатки. Ідеї подарунків і нагадування лишаються лише в CRM.'),
      h('div', { class: 'ppl-imp-tools' },
        h('div', { class: 'btn-row ppl-exp-picks' },
          ui.button({ label: 'Усі', size: 'sm', className: 'ppl-exp-all', onClick: () => pick(() => true) }),
          ui.button({ label: 'Нікого', size: 'sm', className: 'ppl-exp-none', onClick: () => pick(() => false) }),
          groups.length > 1 ? groups.map((g) => ui.button({ label: g.label, size: 'sm', variant: 'ghost', className: 'ppl-exp-group', title: `Лише група «${g.label}»`, onClick: () => pick((r) => (r.p.group || 'other') === g.id) })) : null),
        search),
      listEl,
      h('div', { class: 'ppl-imp-foot' }, h('span', { class: 'subtle' }, countEl)));
    const dlg = ui.modal({ title: 'Експорт контактів (.vcf)', size: 'lg', className: 'ppl-exp-modal', body, footer: [ui.button({ label: 'Скасувати', onClick: () => dlg.close('button') }), goBtn] });
    renderRows();
    function run() {
      const chosen = rows.filter((r) => r.on).map((r) => r.p);
      if (!chosen.length) return;
      const name = `crm-contacts-${D.today()}.vcf`;
      downloadVcf(chosen, name);
      dlg.close('force');
      ui.toast(`Збережено ${fmt.count(chosen.length, ['контакт', 'контакти', 'контактів'])} у файл ${name}`, { type: 'success' });
    }
    return dlg;
  }

  // ---------- Рядки ----------
  function giftBadge(n) {
    return n ? h('span', { class: 'ppl-gift', title: 'Ідеї подарунків' }, CRM.icon('gift', { size: 'sm' }), String(n)) : null;
  }
  /** Рядок найближчої дати: число й місяць, хто, скільки років, ідеї подарунків. */
  /** «Привітати» (у день народження) або «Привітано ✓», якщо вже. */
  function greetAction(p, small) {
    const g = greetedAt(p);
    if (g) return h('span', { class: 'badge badge-success ppl-greeted', title: 'Привітано ' + fmt.dateShort(g) }, CRM.icon('check', { size: 'sm' }), 'Привітано');
    return ui.button({
      label: 'Привітати', icon: 'cake', size: 'sm', variant: small ? 'ghost' : 'primary', className: 'ppl-greet-btn',
      title: 'Готовий текст привітання → «Копіювати» або Telegram', onClick: (ev) => { ev.stopPropagation(); openGreet(p.id); }
    });
  }
  /** Рядок найближчої дати: число й місяць, хто, скільки років, ідеї подарунків; у день народження — «Привітати». */
  function upRow(e) {
    const left = D.diffDays(D.today(), e.date);
    const open = () => openPerson(e.personId);
    return h('div', {
      class: 'ppl-up-row' + (left === 0 ? ' today' : ''), role: 'button', tabIndex: 0, dataset: { id: e.personId }, onClick: open,
      onKeydown: (ev) => { if ((ev.key === 'Enter' || ev.key === ' ') && ev.target === ev.currentTarget) { ev.preventDefault(); open(); } }
    },
    h('span', { class: 'ppl-up-date' }, h('b', { class: 'num' }, String(Number(e.date.slice(8)))), h('span', null, CRM.MONTHS_SHORT[Number(e.date.slice(5, 7)) - 1])),
    h('span', { class: 'ppl-up-main' },
      h('span', { class: 'ppl-up-title' }, CRM.icon(e.kind === 'birthday' ? 'cake' : 'calendar', { size: 'sm' }), e.kind === 'birthday' ? e.person.name : `${e.person.name} — ${e.ann.title}`),
      h('span', { class: 'ppl-up-sub' }, [left === 0 ? 'сьогодні' : `${inDays(e.date)} · ${dayShort(e.date)}`, e.yearsText].filter(Boolean).join(' · '))),
    giftBadge(e.gifts),
    left === 0 && e.kind === 'birthday' ? greetAction(e.person) : null);
  }
  function contactBtn(p, small) {
    return ui.button({
      label: 'Поспілкувались', icon: 'chat', size: 'sm', variant: small ? 'ghost' : null, className: 'ppl-contacted',
      title: 'Позначити, що сьогодні спілкувались', onClick: (e) => { e.stopPropagation(); markContacted(p.id); }
    });
  }
  function dueRow(x) {
    const p = x.p;
    const link = writeLink(p);
    return h('div', { class: 'ppl-due-row', role: 'button', tabIndex: 0, onClick: () => openPerson(p.id),
      onKeydown: (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); openPerson(p.id); } } },
    avatar(p),
    h('span', { class: 'ppl-up-main' },
      h('span', { class: 'ppl-up-title' }, p.name),
      h('span', { class: 'ppl-up-sub' }, `${freqLabel(p.freq)} · ${lastText(p)}`)),
    h('span', { class: 'ppl-due-actions' },
      link ? h('a', { class: 'btn btn-sm btn-ghost', href: link.href, target: link.href.startsWith('http') ? '_blank' : null, rel: 'noopener', onClick: (e) => e.stopPropagation() }, CRM.icon(link.label === 'Telegram' ? 'external' : 'phone', { size: 'sm' }), h('span', { class: 'btn-label' }, link.label)) : null,
      contactBtn(p)));
  }
  function personRow(p) {
    const g = groupOf(p.group);
    const nx = nextAnnual(p);
    const c = contactInfo(p);
    const parts = [g.label];
    if (p.bday && validMd(p.bday)) {
      const age = p.bdayYear ? D.parse(nextOf(p.bday, D.today())).y - p.bdayYear : null;
      parts.push(`ДН ${mdText(p.bday)}` + (age != null && age > 0 ? ` (виповниться ${age})` : ''));
    }
    if (c) parts.push(lastText(p));
    const badges = [];
    if (nx) {
      const left = D.diffDays(D.today(), nx.date);
      if (left === 0) badges.push(h('span', { class: 'badge badge-success' }, nx.kind === 'birthday' ? 'Сьогодні ДН' : 'Сьогодні: ' + nx.ann.title));
      else if (left <= SOON_DAYS) badges.push(h('span', { class: 'badge badge-accent' }, (nx.kind === 'birthday' ? 'ДН ' : '') + inDays(nx.date)));
    }
    if (c && c.overdue) badges.push(h('span', { class: 'badge badge-warning' }, 'Час написати'));
    return h('div', { class: 'list-row ppl-row', role: 'button', tabIndex: 0, dataset: { id: p.id }, onClick: () => openPerson(p.id),
      onKeydown: (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); openPerson(p.id); } } },
    avatar(p),
    h('span', { class: 'list-row-main' },
      h('span', { class: 'list-row-title' }, p.name),
      h('span', { class: 'list-row-sub' }, parts.join(' · '))),
    h('span', { class: 'ppl-row-side' }, badges, giftBadge(openGifts(p).length), c ? contactBtn(p, true) : null));
  }

  // ---------- Сторінка ----------
  let query = '';
  let groupFilter = 'all';
  let sortBy = 'name';

  function sorted(arr) {
    const T = D.today();
    if (sortBy === 'bday') {
      return arr.slice().sort((a, b) => {
        const x = a.bday && validMd(a.bday) ? nextOf(a.bday, T) : '9999';
        const y = b.bday && validMd(b.bday) ? nextOf(b.bday, T) : '9999';
        return x.localeCompare(y) || a.name.localeCompare(b.name, 'uk');
      });
    }
    if (sortBy === 'contact') {
      return arr.slice().sort((a, b) => {
        const x = a.lastContact || (a.freq ? '0000' : '9999');
        const y = b.lastContact || (b.freq ? '0000' : '9999');
        return x.localeCompare(y) || a.name.localeCompare(b.name, 'uk');
      });
    }
    return arr;
  }
  function matches(p, q) {
    if (!q) return true;
    const text = U.normalize([p.name, p.phone, p.telegram, p.instagram, p.email, p.notes,
      (p.gifts || []).map((g) => g.text).join(' '), (p.dates || []).map((d) => d.title).join(' ')].filter(Boolean).join(' '));
    return U.normalize(q).split(' ').every((t) => text.includes(t));
  }

  function render(container, route) {
    const all = list();
    const fileInput = h('input', { type: 'file', accept: '.vcf,text/vcard,text/x-vcard', class: 'sr-only', tabIndex: -1, 'aria-hidden': 'true' });
    fileInput.addEventListener('change', () => { const f = fileInput.files[0]; fileInput.value = ''; if (f) importFile(f); });
    const actions = [
      ui.button({ label: 'Імпорт .vcf', icon: 'upload', className: 'ppl-import-btn', title: 'Завантажити контакти з файлу .vcf (Google Контакти, iPhone)', onClick: () => fileInput.click() }),
      all.length ? ui.button({ label: 'Експорт .vcf', icon: 'download', className: 'ppl-export-btn', title: 'Зберегти людей у файл .vcf (для iPhone, Google Контактів)', onClick: () => openExport() }) : null,
      ui.button({ label: 'Додати людину', icon: 'plus', variant: 'primary', className: 'ppl-add-btn', onClick: () => openPerson() }),
      fileInput
    ];
    const head = ui.pageHead({ title: 'Люди', sub: 'Дні народження, важливі дати, ідеї подарунків і з ким давно не спілкувався.', actions });

    if (!all.length) {
      ui.mount(container, head, h('section', { class: 'card' }, ui.empty({
        icon: 'users', title: 'Ще нікого немає',
        text: 'Додай людей вручну або завантаж контакти з файлу .vcf (Google Контакти → Експортувати → vCard; iPhone — «Контакти» → поділитися). Дні народження зʼявляться в Календарі й на Головній, нагадування — за тиждень і в день.',
        action: { label: 'Додати людину', icon: 'plus', onClick: () => openPerson() }
      })));
    } else {
      const up = upcoming(PAGE_DAYS);
      const due = dueContacts();
      const upCard = h('section', { class: 'card ppl-card' },
        h('div', { class: 'card-head' }, h('h2', null, CRM.icon('cake', { size: 'sm' }), 'Найближчі дні народження й дати')),
        up.length ? h('div', { class: 'ppl-up-list' }, up.slice(0, 8).map(upRow), up.length > 8 ? h('div', { class: 'more-link subtle' }, `І ще ${up.length - 8} за місяць — дивись у Календарі`) : null)
          : h('div', { class: 'card-body subtle' }, 'Найближчий місяць — без днів народження й важливих дат.'));
      const dueCard = h('section', { class: 'card ppl-card' },
        h('div', { class: 'card-head' }, h('h2', null, CRM.icon('chat', { size: 'sm' }), 'Час написати', due.length ? h('span', { class: 'tab-count' }, String(due.length)) : null)),
        due.length ? h('div', { class: 'ppl-up-list' }, due.slice(0, 8).map(dueRow))
          : h('div', { class: 'card-body subtle' }, all.some((p) => p.freq)
            ? 'Усім, кому хотів, уже написав. Коли настане час — людина зʼявиться тут.'
            : 'Вибери в картці людини, як часто хочеш спілкуватися («Щомісяця»…) — і CRM нагадає, коли давно не писав.'));

      const counts = { all: all.length };
      GROUPS.forEach((g) => { counts[g.id] = all.filter((p) => (p.group || 'other') === g.id).length; });
      const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Група' },
        [{ id: 'all', label: 'Усі' }].concat(GROUPS).filter((g) => g.id === 'all' || counts[g.id]).map((g) => h('button', {
          type: 'button', class: 'chip' + (groupFilter === g.id ? ' active' : ''), 'aria-pressed': groupFilter === g.id ? 'true' : 'false', dataset: { group: g.id },
          onClick: () => { groupFilter = g.id; CRM.router.rerender(); }
        }, `${g.label} · ${counts[g.id] || 0}`)));
      if (groupFilter !== 'all' && !counts[groupFilter]) groupFilter = 'all';
      const searchIn = ui.input({ type: 'search', class: 'input ppl-search', placeholder: 'Пошук: імʼя, телефон, нотатки…', 'aria-label': 'Пошук людей', value: query });
      const sortSel = ui.select(SORTS.map((s) => ({ value: s.id, label: s.label })), { value: sortBy, 'aria-label': 'Сортування', class: 'select ppl-sort' });
      sortSel.addEventListener('change', () => { sortBy = sortSel.value; renderList(); });
      const listBox = h('div', { class: 'card ppl-list-card' });
      function renderList() {
        const items = sorted(all.filter((p) => (groupFilter === 'all' || (p.group || 'other') === groupFilter) && matches(p, query)));
        ui.mount(listBox, items.length
          ? h('div', { class: 'list ppl-list' }, items.map(personRow))
          : ui.empty({ icon: 'search', small: true, title: 'Нікого не знайдено', text: query ? `За запитом «${query}» нікого немає.` : null }));
      }
      searchIn.addEventListener('input', () => { query = searchIn.value; renderList(); });
      renderList();
      ui.mount(container, head,
        h('div', { class: 'stack' },
          h('div', { class: 'ppl-top' }, upCard, dueCard),
          h('div', { class: 'toolbar ppl-toolbar' }, chips, h('div', { class: 'ppl-tools' }, searchIn, sortSel)),
          listBox));
    }

    const p = route && route.params;
    if (p && p.open) {
      const id = p.open;
      const greet = !!p.greet;
      CRM.router.consumeParam('open');
      if (greet) CRM.router.consumeParam('greet');
      setTimeout(() => { if (openPerson(id) && greet) openGreet(id); }, 0);
    }
  }

  // ---------- Вибір дня й місяця (рік — необовʼязково) ----------
  function mdPicker(md, year, label, onChange) {
    const daySel = h('select', { class: 'select ppl-day', 'aria-label': label + ': число' },
      h('option', { value: '' }, 'число'), Array.from({ length: 31 }, (_, i) => h('option', { value: String(i + 1) }, String(i + 1))));
    const monSel = h('select', { class: 'select ppl-month', 'aria-label': label + ': місяць' },
      h('option', { value: '' }, 'місяць'), CRM.MONTHS_GEN.map((m, i) => h('option', { value: String(i + 1) }, m)));
    const yearIn = h('input', { class: 'input ppl-year', inputmode: 'numeric', maxlength: 4, placeholder: 'рік', 'aria-label': label + ': рік (необовʼязково)', autocomplete: 'off' });
    if (md && validMd(md)) { daySel.value = String(Number(md.slice(3))); monSel.value = String(Number(md.slice(0, 2))); }
    if (year) yearIn.value = String(year);
    const err = h('div', { class: 'ppl-md-err', role: 'alert' });
    function read() {
      const d = Number(daySel.value) || 0;
      const m = Number(monSel.value) || 0;
      const ys = yearIn.value.trim();
      let y = null;
      if (ys) {
        if (!/^\d{4}$/.test(ys) || Number(ys) < 1900 || Number(ys) > D.parse(D.today()).y) return { error: 'Рік — 4 цифри, від 1900 до поточного' };
        y = Number(ys);
      }
      if (!d && !m) return y ? { error: 'Вкажи число й місяць' } : { md: null, year: null };
      if (!d || !m) return { error: 'Вкажи і число, і місяць' };
      if (d > D.daysInMonth(y || 2024, m)) return { error: y && m === 2 && d === 29 ? `${y} — не високосний рік` : 'У цьому місяці немає такого числа' };
      return { md: mdOf(m, d), year: y };
    }
    function fire() { const r = read(); err.textContent = r.error || ''; if (!r.error) onChange(r.md, r.year); }
    daySel.addEventListener('change', fire);
    monSel.addEventListener('change', fire);
    yearIn.addEventListener('input', fire);
    return { el: h('div', { class: 'ppl-md' }, daySel, monSel, yearIn), err, read };
  }

  // ---------- Картка людини (бічна панель) ----------
  function openPerson(id, preset) {
    const cur = id ? CRM.store.get('people', id) : null;
    if (id && !cur) { ui.toast('Цієї людини більше немає', { type: 'error' }); return null; }
    if (cur && cur.deletedAt) { ui.toast('Людина в Кошику — віднови, щоб відкрити'); return null; }
    let isNew = !cur;
    const st = cur ? U.deepClone(cur) : Object.assign({
      id: U.uid(), name: '', group: 'friends', bday: null, bdayYear: null, phone: '', telegram: '', instagram: '', email: '',
      notes: '', dates: [], gifts: [], freq: null, lastContact: null
    }, preset || {});
    st.dates = Array.isArray(st.dates) ? st.dates : [];
    st.gifts = Array.isArray(st.gifts) ? st.gifts : [];

    // Зберігаємо лише поля, змінені в картці (dirty): те, що змінилося деінде (привітання, «Поспілкувались»,
    // скасування витрати подарунка), не перезаписується старим станом картки.
    const dirty = new Set();
    let timer = null;
    let ownSave = false;
    async function persist() {
      clearTimeout(timer);
      timer = null;
      if (isNew || !dirty.size) return;
      const now = CRM.store.get('people', st.id);
      if (!now || now.deletedAt || !st.name.trim()) return;
      const patch = {};
      dirty.forEach((k) => { patch[k] = U.deepClone(st[k]); });
      if ('name' in patch) patch.name = st.name.trim();
      dirty.clear();
      ownSave = true;
      try { await save(Object.assign({}, now, patch)); } finally { ownSave = false; }
    }
    function changed(...keys) {
      keys.forEach((k) => dirty.add(k));
      renderInfo();
      renderGreet();
      if (isNew) return;
      clearTimeout(timer);
      timer = setTimeout(persist, 400);
    }

    // Імʼя й група
    const nameIn = ui.input({ value: st.name, maxlength: 100, placeholder: 'Імʼя, напр. Марта Коваленко', 'aria-label': 'Імʼя' });
    const fName = ui.field({ label: 'Імʼя', input: nameIn, required: true });
    let relTimer = null;
    nameIn.addEventListener('input', () => {
      st.name = nameIn.value;
      if (!st.name.trim()) { fName.setError('Імʼя не може бути порожнім'); return; }
      if (!isNew) dlg.setTitle(st.name.trim());
      changed('name');
      clearTimeout(relTimer);
      relTimer = setTimeout(renderRelated, 350);
    });
    const groupSeg = h('div', { class: 'segmented ppl-groups', role: 'radiogroup', 'aria-label': 'Група' });
    function renderGroups() {
      ui.mount(groupSeg, GROUPS.map((g) => h('button', {
        type: 'button', role: 'radio', class: g.id === st.group ? 'active' : '', 'aria-checked': g.id === st.group ? 'true' : 'false', dataset: { group: g.id },
        onClick: () => { st.group = g.id; renderGroups(); changed('group'); }
      }, g.label)));
    }
    renderGroups();

    // День народження
    const info = h('div', { class: 'ppl-bday-info subtle' });
    function renderInfo() {
      if (!st.bday || !validMd(st.bday)) { info.textContent = 'Рік — необовʼязково (тоді CRM знатиме, скільки років).'; return; }
      const d = nextOf(st.bday, D.today());
      const n = st.bdayYear ? D.parse(d).y - st.bdayYear : null;
      info.textContent = `Наступний: ${dayShort(d)} (${inDays(d)})` + (n != null && n > 0 ? ` — виповниться ${n}` : '');
    }
    const bday = mdPicker(st.bday, st.bdayYear, 'День народження', (md, y) => { st.bday = md; st.bdayYear = md ? y : null; changed('bday', 'bdayYear'); });
    renderInfo();

    // «Привітати» і звертання (доробка 25)
    const greetNameIn = ui.input({ value: st.greetName || '', maxlength: 60, 'aria-label': 'Як звертатися', class: 'input ppl-greet-name' });
    greetNameIn.addEventListener('input', () => { st.greetName = greetNameIn.value.trim(); changed('greetName'); });
    const greetBox = h('div', { class: 'ppl-greet-row' });
    function renderGreet() {
      const auto = autoAddress(st);
      greetNameIn.placeholder = auto ? `${auto} (автоматично)` : 'Напр., Марточко';
      if (isNew || !st.bday || !validMd(st.bday)) { greetBox.hidden = true; ui.mount(greetBox); return; }
      greetBox.hidden = false;
      const occ = greetOcc(st);
      const g = greetedAt(st, occ);
      const today = occ && occ.left === 0;
      ui.mount(greetBox,
        ui.button({
          label: 'Привітати', icon: 'cake', size: 'sm', variant: today && !g ? 'primary' : null, className: 'ppl-greet-btn',
          title: 'Готовий текст привітання → «Копіювати», Telegram або «Надіслати…»',
          onClick: async () => { await persist(); openGreet(st.id); }
        }),
        h('span', { class: 'subtle ppl-greet-note' + (g ? ' greeted' : '') },
          g ? `Привітано ${fmt.dateShort(g)}` : today ? 'Сьогодні день народження!' : 'Готовий текст → «Копіювати» або Telegram'));
    }

    // Своє нагадування (доробка 27)
    const remindSel = h('select', { class: 'select ppl-remind', 'aria-label': 'Нагадувати про день народження й дати' },
      REMINDS.map((r) => h('option', { value: String(r.v), selected: r.v === remindOf(st) }, r.label)));
    remindSel.addEventListener('change', () => { st.remindDays = Number(remindSel.value); changed('remindDays'); });

    // Контакти
    const contactField = (key, label, ph, mode) => {
      const inp = ui.input({ value: st[key] || '', maxlength: 120, placeholder: ph, 'aria-label': label, inputmode: mode || null, dataset: { field: key } });
      inp.addEventListener('input', () => { st[key] = inp.value.trim(); changed(key); });
      return ui.field({ label, input: inp });
    };

    // Спілкування
    const freqSel = h('select', { class: 'select ppl-freq', 'aria-label': 'Як часто спілкуватися' },
      FREQS.map((f) => h('option', { value: f.v == null ? '' : String(f.v), selected: f.v === (st.freq || null) }, f.label)));
    freqSel.addEventListener('change', () => { st.freq = freqSel.value ? Number(freqSel.value) : null; changed('freq'); renderContact(); });
    const lastIn = ui.dateInput({
      value: st.lastContact, placeholder: 'Ще не позначено', ariaLabel: 'Коли востаннє спілкувались',
      onChange: (v) => {
        if (v && v > D.today()) { lastIn.dateValue = st.lastContact; ui.toast('Дата спілкування не може бути в майбутньому', { type: 'error' }); return; }
        st.lastContact = v || null;
        changed('lastContact');
        renderContact();
      }
    });
    const contactNote = h('div', { class: 'ppl-contact-note subtle' });
    function renderContact() {
      const c = contactInfo(st);
      if (!st.freq) { contactNote.textContent = 'Без нагадувань. Вибери частоту — і CRM нагадає, коли давно не спілкувались.'; return; }
      contactNote.textContent = c.overdue ? `Час написати (${lastText(st)}).` : `Наступне нагадування — ${dayShort(c.due)} (${inDays(c.due)}).`;
    }
    renderContact();
    const todayBtn = ui.button({
      label: 'Сьогодні', icon: 'chat', size: 'sm', className: 'ppl-today-btn', title: 'Поспілкувались сьогодні',
      onClick: () => { st.lastContact = D.today(); lastIn.dateValue = st.lastContact; changed('lastContact'); renderContact(); }
    });
    const lastWrap = h('div', { class: 'ppl-last' }, lastIn, todayBtn);

    // Ідеї подарунків (+ орієнтовна ціна; «подаровано» → витрата в Бюджеті — доробка 24)
    const giftsBox = h('div', { class: 'ppl-gifts' });
    async function toggleGift(g) {
      if (!g.done) {
        g.done = true;
        g.doneAt = D.today();
        changed('gifts');
        renderGifts();
        if (isNew || !canGiftExpense()) return;
        await persist();
        const person = Object.assign({}, st, { name: st.name.trim() });
        openGiftExpense(person, g, {
          onSaved: (txId, amount) => { setGift(g.id, { txId, price: g.price || amount }); },
          onUndo: () => { setGift(g.id, { txId: null }); }
        });
        return;
      }
      const tx = giftTx(g);
      if (tx) {
        const del = await ui.confirm({
          title: 'Повернути ідею подарунка?',
          message: `До неї привʼязано витрату «${tx.comment || 'Подарунок'}» (${txMoney(tx)}). Видалити й витрату? Вона перейде в Кошик.`,
          confirmText: 'Видалити витрату', cancelText: 'Лишити витрату', danger: true
        });
        if (del) {
          const batch = await CRM.store.softDelete('transactions', tx.id);
          ui.toast('Витрату на подарунок — у Кошику', { action: { label: 'Скасувати', onClick: async () => { await CRM.store.restoreBatch(batch); setGift(g.id, { txId: tx.id, done: true, doneAt: g.doneAt || D.today() }); } } });
        }
      }
      g.done = false;
      g.doneAt = null;
      g.txId = null;
      changed('gifts');
      renderGifts();
    }
    /** Змінити ідею: у картці (якщо відкрита) або одразу в збереженому записі. */
    async function setGift(giftId, fields) {
      if (dlg.isOpen) {
        const g = st.gifts.find((x) => x.id === giftId);
        if (g) { Object.assign(g, fields); changed('gifts'); renderGifts(); await persist(); }
        return;
      }
      const now = get(st.id);
      if (!now) return;
      await save(Object.assign({}, now, { gifts: (now.gifts || []).map((x) => (x.id === giftId ? Object.assign({}, x, fields) : x)) }));
    }
    function renderGifts(focusNew) {
      const order = st.gifts.slice().sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0));
      const addIn = ui.input({ placeholder: 'Додати ідею подарунка… (Enter)', maxlength: 200, 'aria-label': 'Нова ідея подарунка', class: 'input ppl-gift-add' });
      addIn.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const v = addIn.value.trim();
        if (!v) return;
        st.gifts.push({ id: U.uid(), text: v, done: false, doneAt: null, price: null, txId: null });
        changed('gifts');
        renderGifts(true);
      });
      ui.mount(giftsBox,
        order.map((g) => {
          const text = h('input', { class: 'check-text' + (g.done ? ' done' : ''), value: g.text, maxlength: 200, 'aria-label': 'Ідея подарунка' });
          text.addEventListener('change', () => { const v = text.value.trim(); if (!v) { text.value = g.text; return; } g.text = v; changed('gifts'); });
          text.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); text.blur(); } });
          let side = null;
          if (g.done) {
            const tx = giftTx(g);
            side = h('span', { class: 'subtle ppl-gift-when' }, 'подаровано' + (g.doneAt ? ' ' + fmt.dateShort(g.doneAt) : ''),
              tx ? [' · ', h('button', { type: 'button', class: 'link-btn ppl-gift-tx', title: 'Відкрити витрату в Бюджеті', onClick: () => CRM.budget.openTxForm({ id: tx.id }) }, txMoney(tx))] : null);
          } else {
            const price = h('input', {
              class: 'input ppl-gift-price', inputmode: 'decimal', maxlength: 12, placeholder: 'ціна', 'aria-label': 'Орієнтовна ціна, ₴', title: 'Орієнтовна ціна, ₴ — підставиться у витрату, коли позначиш «подаровано»',
              value: g.price ? String(g.price).replace('.', ',') : ''
            });
            price.addEventListener('change', () => {
              const v = price.value.trim();
              const n = v ? parseAmount(v) : null;
              if (v && !n) { price.value = g.price ? String(g.price).replace('.', ',') : ''; return; }
              g.price = n;
              changed('gifts');
            });
            price.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); price.blur(); } });
            side = h('span', { class: 'ppl-gift-price-wrap' }, price, h('span', { class: 'subtle' }, '₴'));
          }
          return h('div', { class: 'check-item ppl-gift-item' + (g.done ? ' done' : ''), dataset: { gift: g.id } },
            h('button', {
              type: 'button', class: 'task-check small' + (g.done ? ' checked' : ''), role: 'checkbox', 'aria-checked': g.done ? 'true' : 'false',
              title: g.done ? 'Подаровано — натисни, щоб повернути' : 'Позначити подарованим', 'aria-label': g.done ? 'Повернути ідею' : 'Позначити подарованим',
              onClick: () => toggleGift(g)
            }, CRM.icon('check', { size: 'sm' })),
            text,
            side,
            h('button', { type: 'button', class: 'check-del', 'aria-label': 'Видалити ідею', title: 'Видалити',
              onClick: () => { st.gifts = st.gifts.filter((x) => x.id !== g.id); changed('gifts'); renderGifts(); } }, CRM.icon('x', { size: 'sm' })));
        }),
        addIn);
      if (focusNew) addIn.focus();
    }
    renderGifts();

    // Інші важливі дати
    const datesBox = h('div', { class: 'ppl-dates' });
    function renderDates() {
      ui.mount(datesBox,
        st.dates.map((x) => {
          const t = ui.input({ value: x.title || '', maxlength: 80, placeholder: 'Напр., Річниця весілля', 'aria-label': 'Назва дати', class: 'input ppl-date-title' });
          t.addEventListener('input', () => { x.title = t.value.trim(); changed('dates'); });
          const pk = mdPicker(x.md, x.year, 'Дата', (md, y) => { x.md = md; x.year = md ? y : null; changed('dates'); });
          return h('div', { class: 'ppl-date-row' },
            h('div', { class: 'ppl-date-line' }, t,
              h('button', { type: 'button', class: 'btn btn-ghost btn-icon btn-sm', 'aria-label': 'Видалити дату', title: 'Видалити',
                onClick: () => { st.dates = st.dates.filter((y) => y.id !== x.id); changed('dates'); renderDates(); } }, CRM.icon('trash', { size: 'sm' }))),
            pk.el, pk.err);
        }),
        ui.button({ label: 'Додати дату', icon: 'plus', size: 'sm', className: 'ppl-add-date', onClick: () => { st.dates.push({ id: U.uid(), title: '', md: null, year: null }); renderDates(); const ins = datesBox.querySelectorAll('.ppl-date-title'); if (ins.length) ins[ins.length - 1].focus(); } }));
    }
    renderDates();

    // Повʼязане: події, задачі й Google з імʼям людини (доробка 26)
    const relBox = h('div', { class: 'ppl-rel' });
    let relAll = { next: false, past: false };
    function relRow(it) {
      const T = D.today();
      const parts = [];
      if (it.date) {
        parts.push((it.date === T ? 'Сьогодні' : it.date === D.addDays(T, 1) ? 'Завтра' : it.date === D.addDays(T, -1) ? 'Учора' : dayShort(it.date)) + (it.time ? ', ' + it.time : ''));
      }
      if (it.kind === 'task') parts.push(it.done ? 'задача · виконано' : it.what === 'план' ? 'задача в плані дня' : it.what ? `задача · ${it.what}` : 'задача без дати');
      else if (it.kind === 'gcal') parts.push('Google Календар');
      else parts.push(it.series ? 'Календар · повторюється' : 'Календар');
      const icon = it.kind === 'task' ? 'tasks' : it.kind === 'gcal' ? 'external' : it.series ? 'repeat' : 'calendar';
      const open = () => {
        if (it.kind === 'gcal') { CRM.gcal.openEvent(it.ev); return; }
        persist();
        dlg.close('force');
        if (it.kind === 'task') CRM.tasks.openTask(it.id);
        else CRM.calendar.go('day', it.date, { open: it.id, occ: it.occ || null });
      };
      return h('button', { type: 'button', class: 'ppl-rel-row' + (it.done ? ' done' : '') + (it.overdue ? ' overdue' : ''), dataset: { kind: it.kind, key: it.key }, onClick: open },
        h('span', { class: 'ppl-rel-ico' }, CRM.icon(icon, { size: 'sm' })),
        h('span', { class: 'ppl-up-main' },
          h('span', { class: 'ppl-rel-title' }, it.title),
          h('span', { class: 'ppl-up-sub' }, parts.join(' · '))));
    }
    function relGroup(label, cls, items, which) {
      if (!items.length) return null;
      const shown = relAll[which] ? items : items.slice(0, REL_SHOW);
      return h('div', { class: 'ppl-rel-group ' + cls },
        h('div', { class: 'ppl-rel-head' }, label, h('span', { class: 'tab-count' }, String(items.length))),
        shown.map(relRow),
        items.length > shown.length ? h('button', { type: 'button', class: 'link-btn ppl-rel-more', onClick: () => { relAll[which] = true; renderRelated(); } }, `Показати всі (${items.length})`) : null);
    }
    function renderRelated() {
      if (!relBox.isConnected && dlg && !dlg.isOpen) return;
      if (isNew || !st.name.trim()) {
        ui.mount(relBox, h('p', { class: 'subtle ppl-hint' }, 'Після додавання тут зʼявляться події й задачі, де згадано цю людину.'));
        return;
      }
      const r = related(Object.assign({}, st, { name: st.name.trim() }));
      const f = firstName(st);
      const evBtn = CRM.calendar && CRM.calendar.openEditor ? ui.button({
        label: 'Подія', icon: 'plus', size: 'sm', className: 'ppl-rel-event', title: `Нова подія «Зустріч з ${withName(st)}»`,
        onClick: () => {
          const hh = D.kyivParts().hh;
          CRM.calendar.openEditor(null, { title: `Зустріч з ${withName(st)}`, date: D.today(), allDay: false, start: D.pad(Math.min(23, hh + 1)) + ':00', dur: 60 });
        }
      }) : null;
      const taskBtn = CRM.tasks && CRM.tasks.openNew ? ui.button({
        label: 'Задача', icon: 'plus', size: 'sm', className: 'ppl-rel-task', title: `Нова задача «${f}: …»`,
        onClick: () => CRM.tasks.openNew({ title: f + ': ' })
      }) : null;
      ui.mount(relBox,
        r.next.length || r.past.length
          ? [relGroup('Найближче', 'ppl-rel-next', r.next, 'next'), relGroup('Нещодавно', 'ppl-rel-past', r.past, 'past')]
          : h('p', { class: 'subtle ppl-hint ppl-rel-none' }, `Подій і задач з «${f}» за 2 місяці назад і 3 вперед немає. Пиши імʼя в назві — напр., «Зустріч з ${withName(st)}».`),
        h('div', { class: 'btn-row ppl-rel-add' }, evBtn, taskBtn));
    }

    const notesIn = ui.textarea({ value: st.notes || '', rows: 3, maxlength: 4000, placeholder: 'Що любить, про що говорили, важливе…', 'aria-label': 'Нотатки' });
    notesIn.addEventListener('input', () => { st.notes = notesIn.value; changed('notes'); });

    const section = (icon, title, ...content) => h('section', { class: 'ppl-sec' }, h('h3', { class: 'ppl-sec-title' }, CRM.icon(icon, { size: 'sm' }), title), content);
    const body = h('div', { class: 'form-stack ppl-editor' },
      fName,
      h('div', { class: 'field' }, h('div', { class: 'field-label' }, 'Група'), groupSeg),
      section('cake', 'День народження', bday.el, bday.err, info, greetBox,
        h('div', { class: 'form-grid ppl-greet-grid' },
          ui.field({ label: 'Як звертатися', input: greetNameIn, hint: 'Для «Привітати». Порожньо — автоматично.' }),
          ui.field({ label: 'Нагадувати', input: remindSel, hint: 'Про день народження й інші дати.' }))),
      section('phone', 'Контакти', h('div', { class: 'form-grid' },
        contactField('phone', 'Телефон', '+380…', 'tel'), contactField('telegram', 'Telegram', '@username'),
        contactField('instagram', 'Instagram', '@username'), contactField('email', 'Email', 'name@example.com', 'email'))),
      section('chat', 'Спілкування', ui.field({ label: 'Як часто хочу спілкуватися', input: freqSel }),
        h('div', { class: 'field' }, h('div', { class: 'field-label' }, 'Востаннє спілкувались'), lastWrap), contactNote),
      section('link', 'Повʼязане', relBox),
      section('gift', 'Ідеї подарунків', h('p', { class: 'subtle ppl-hint' }, 'Ціна — орієнтовна. Позначиш «подаровано» — CRM запропонує записати витрату в «Бюджет».'), giftsBox),
      section('calendar', 'Інші важливі дати', h('p', { class: 'subtle ppl-hint' }, 'Річниця, іменини тощо — щороку в Календарі з нагадуванням (як вибрано вище в «Нагадувати»).'), datesBox),
      section('pencil', 'Нотатки', notesIn));

    const footer = h('div', { class: 'ppl-foot' });
    function renderFooter() {
      if (isNew) {
        ui.mount(footer, h('span', { class: 'grow' }),
          ui.button({ label: 'Скасувати', onClick: () => dlg.close('button') }),
          ui.button({ label: 'Додати', variant: 'primary', className: 'ppl-create', onClick: create }));
        return;
      }
      ui.mount(footer,
        ui.button({ label: 'Видалити', icon: 'trash', variant: 'danger-ghost', className: 'ppl-delete', onClick: remove }),
        ui.button({
          label: 'Зберегти контакт', icon: 'download', variant: 'ghost', size: 'sm', className: 'ppl-vcf-one', title: 'Зберегти цю людину у файл .vcf (для iPhone, Google Контактів)',
          onClick: async () => { await persist(); const p = get(st.id); if (p) { downloadVcf([p], vcfName(p.name)); ui.toast(`Збережено у файл ${vcfName(p.name)}`, { type: 'success' }); } }
        }),
        h('span', { class: 'grow' }),
        h('span', { class: 'subtle ppl-autosave' }, 'Зміни зберігаються автоматично'));
    }
    function validate() {
      let ok = true;
      if (!st.name.trim()) { fName.setError('Вкажи імʼя'); ok = false; }
      const r = bday.read();
      if (r.error) { bday.err.textContent = r.error; ok = false; }
      return ok;
    }
    async function create() {
      if (!validate()) { nameIn.focus(); return; }
      if (!canSave()) return;
      st.name = st.name.trim();
      ownSave = true;
      try { await save(U.deepClone(st)); } finally { ownSave = false; }
      dirty.clear();
      isNew = false;
      dlg.setTitle(st.name);
      renderFooter();
      renderGreet();
      renderRelated();
      ui.toast(`Додано: ${st.name}`, { type: 'success' });
    }
    async function remove() {
      const ok = await ui.confirm({
        title: 'Видалити людину?', message: `«${st.name}» перейде в Кошик — відновити можна протягом 30 днів.`, confirmText: 'Видалити', danger: true
      });
      if (!ok) return;
      clearTimeout(timer);
      timer = null;
      await persist();
      dlg.close('force');
      const batch = await CRM.store.softDelete('people', st.id);
      ui.toast(`${st.name} — у Кошику`, { action: { label: 'Скасувати', onClick: () => CRM.store.restoreBatch(batch) } });
    }
    renderFooter();

    // Зміни, зроблені деінде (привітання, «Поспілкувались», інший пристрій), — у поля, яких картка не змінювала
    function onPeople() {
      if (ownSave || isNew) return;
      const now = CRM.store.get('people', st.id);
      if (!now || now.deletedAt) return;
      const was = U.deepClone(st);
      ['greeted', 'lastContact', 'greetName', 'gifts', 'freq', 'remindDays'].forEach((k) => { if (!dirty.has(k)) st[k] = U.deepClone(now[k]); });
      if (!st.gifts || !Array.isArray(st.gifts)) st.gifts = [];
      if (was.lastContact !== st.lastContact) { lastIn.dateValue = st.lastContact; renderContact(); }
      if ((was.greetName || '') !== (st.greetName || '') && document.activeElement !== greetNameIn) greetNameIn.value = st.greetName || '';
      if (JSON.stringify(was.gifts) !== JSON.stringify(st.gifts) && !giftsBox.contains(document.activeElement)) renderGifts();
      if (was.freq !== st.freq) { freqSel.value = st.freq ? String(st.freq) : ''; renderContact(); }
      if (was.remindDays !== st.remindDays) remindSel.value = String(remindOf(st));
      renderGreet();
    }
    const offPeople = CRM.store.on(['people'], onPeople);
    const offRel = CRM.store.on(['events', 'tasks', 'transactions'], () => { renderRelated(); if (!giftsBox.contains(document.activeElement)) renderGifts(); });
    const onGcal = () => renderRelated();
    document.addEventListener('crm:gcalchange', onGcal);

    const dlg = ui.drawer({
      title: isNew ? 'Нова людина' : st.name, body, footer, className: 'ppl-drawer',
      onClose: () => {
        if (timer) persist();
        clearTimeout(relTimer);
        offPeople();
        offRel();
        document.removeEventListener('crm:gcalchange', onGcal);
      }
    });
    renderGreet();
    renderRelated();
    if (isNew) setTimeout(() => nameIn.focus(), 0);
    return dlg;
  }
  function openPage(id) { CRM.router.go('people', id ? { open: id } : null); }

  // ---------- Імпорт з .vcf (vCard 2.1 / 3.0 / 4.0) ----------
  function qpDecode(s) {
    const bytes = [];
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(s.substr(i + 1, 2))) { bytes.push(parseInt(s.substr(i + 1, 2), 16)); i += 2; }
      else bytes.push(s.charCodeAt(i) & 0xff);
    }
    try { return new TextDecoder('utf-8').decode(new Uint8Array(bytes)); } catch (e) { return s; }
  }
  const unescapeV = (s) => String(s).replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
  /** Дата з vCard: 1999-03-15, 19990315, --03-15, --0315 (+ рік 1604 чи X-APPLE-OMIT-YEAR — без року). */
  function vDate(v, params) {
    const s = String(v || '').trim();
    let m = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(s);
    let y = null;
    let mm;
    let dd;
    if (m) { y = Number(m[1]); mm = Number(m[2]); dd = Number(m[3]); }
    else if ((m = /^--(\d{2})-?(\d{2})/.exec(s))) { mm = Number(m[1]); dd = Number(m[2]); }
    else return null;
    if (params['X-APPLE-OMIT-YEAR'] || y === 1604 || (y && (y < 1900 || y > D.parse(D.today()).y))) y = null;
    if (!(mm >= 1 && mm <= 12 && dd >= 1 && dd <= D.daysInMonth(y || 2024, mm))) return null;
    return { md: mdOf(mm, dd), year: y };
  }
  function abLabel(l) {
    const s = String(l || '').replace(/^_\$!<|>!\$_$/g, '');
    if (/anniversary/i.test(s)) return 'Річниця';
    if (!s || /^other$/i.test(s)) return 'Важлива дата';
    return s;
  }
  /** Розібрати текст .vcf → [{ name, phone, email, telegram, instagram, bday, bdayYear, dates, notes }]. */
  function parseVcf(text) {
    const raw = String(text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
    const lines = [];
    raw.forEach((l) => {
      const last = lines.length ? lines[lines.length - 1] : null;
      if (last != null && /^[ \t]/.test(l)) lines[lines.length - 1] = last + l.slice(1);
      else if (last != null && /QUOTED-PRINTABLE/i.test(last.split(':')[0]) && /=$/.test(last)) lines[lines.length - 1] = last.slice(0, -1) + l;
      else lines.push(l);
    });
    const out = [];
    let card = null;
    lines.forEach((line) => {
      if (/^BEGIN:VCARD/i.test(line)) { card = { props: [] }; return; }
      if (/^END:VCARD/i.test(line)) { if (card) out.push(card); card = null; return; }
      if (!card) return;
      const i = line.indexOf(':');
      if (i < 0) return;
      const headPart = line.slice(0, i);
      let value = line.slice(i + 1);
      const parts = headPart.split(';');
      let name = parts[0];
      let group = null;
      const dot = name.indexOf('.');
      if (dot >= 0) { group = name.slice(0, dot).toLowerCase(); name = name.slice(dot + 1); }
      const params = {};
      parts.slice(1).forEach((p) => {
        const eq = p.indexOf('=');
        const k = eq < 0 ? 'TYPE' : p.slice(0, eq).toUpperCase();
        const v = eq < 0 ? p : p.slice(eq + 1);
        params[k] = params[k] ? params[k] + ',' + v.toLowerCase() : v.toLowerCase();
      });
      if (/quoted-printable/i.test(params.ENCODING || '')) value = qpDecode(value);
      card.props.push({ name: name.toUpperCase(), group, params, value: unescapeV(value) });
    });
    return out.map((c) => {
      const P = (n) => c.props.filter((p) => p.name === n);
      const first = (n) => { const x = P(n)[0]; return x ? x.value.trim() : ''; };
      let name = first('FN');
      if (!name) {
        const n = first('N').split(';');
        name = [n[1], n[2], n[0]].filter((x) => x && x.trim()).join(' ').trim();
      }
      if (!name) name = first('ORG').split(';')[0].trim();
      const tels = P('TEL');
      const tel = (tels.find((t) => /cell|mobile/.test(t.params.TYPE || '')) || tels[0] || {}).value || '';
      const b = P('BDAY')[0];
      const bd = b ? vDate(b.value, b.params) : null;
      const dates = [];
      P('ANNIVERSARY').concat(P('X-ANNIVERSARY')).forEach((a) => { const d = vDate(a.value, a.params); if (d) dates.push({ id: U.uid(), title: 'Річниця', md: d.md, year: d.year }); });
      P('X-ABDATE').forEach((a) => {
        const d = vDate(a.value, a.params);
        if (!d) return;
        const lbl = c.props.find((p) => p.name === 'X-ABLABEL' && p.group && p.group === a.group);
        dates.push({ id: U.uid(), title: abLabel(lbl ? lbl.value : ''), md: d.md, year: d.year });
      });
      const links = c.props.filter((p) => ['X-SOCIALPROFILE', 'IMPP', 'URL'].includes(p.name));
      const find = (re, typeRe) => {
        const x = links.find((p) => re.test(p.value) || typeRe.test(p.params.TYPE || '') || typeRe.test(p.params['X-SERVICE-TYPE'] || ''));
        return x ? x.value : '';
      };
      const tg = find(/t\.me\/|telegram/i, /telegram/);
      const ig = find(/instagram\.com/i, /instagram/);
      // CATEGORIES — група (так пише експорт CRM: «Сімʼя», «Друзі»…)
      const cats = first('CATEGORIES').split(',').map((x) => U.normalize(x));
      const grp = GROUPS.find((g) => cats.includes(U.normalize(g.label)));
      return {
        name: name.replace(/\s+/g, ' ').trim(), phone: tel.trim(), email: first('EMAIL'), group: grp ? grp.id : null,
        telegram: tg ? '@' + tgUser(tg.replace(/^x-apple:|^telegram:/i, '')) : '', instagram: ig ? '@' + igUser(ig) : '',
        bday: bd ? bd.md : null, bdayYear: bd ? bd.year : null, dates, notes: first('NOTE')
      };
    }).filter((x) => x.name).map((x) => Object.assign(x, { telegram: x.telegram === '@' ? '' : x.telegram, instagram: x.instagram === '@' ? '' : x.instagram }));
  }

  async function importFile(file) {
    if (!canSave()) return;
    if (file.size > 10 * 1024 * 1024) { ui.toast('Файл завеликий (більше 10 МБ).', { type: 'error' }); return; }
    let text = '';
    try { text = await U.readFileAsText(file); } catch (e) { ui.toast('Не вдалося прочитати файл.', { type: 'error' }); return; }
    const cards = parseVcf(text);
    if (!cards.length) { ui.toast('У файлі не знайдено контактів. Потрібен файл .vcf (vCard) — напр., Google Контакти → «Експортувати» → vCard.', { type: 'error', duration: 9000 }); return; }
    openImport(cards, file.name);
  }

  function openImport(cards, fileName) {
    const existing = new Map(list().map((p) => [U.normalize(p.name), p]));
    const rows = cards.map((c, i) => ({ i, c, dup: existing.get(U.normalize(c.name)) || null, on: false }));
    rows.forEach((r) => { r.on = !!(r.c.bday && !r.dup); });
    const withBday = rows.filter((r) => r.c.bday).length;
    let group = 'friends';
    let q = '';
    const listEl = h('div', { class: 'ppl-imp-list' });
    const countEl = h('span');
    const goBtn = ui.button({ label: 'Додати', variant: 'primary', className: 'ppl-imp-go', onClick: run });
    function updateCount() {
      const n = rows.filter((r) => r.on).length;
      countEl.textContent = `Вибрано: ${n}`;
      goBtn.querySelector('.btn-label').textContent = n ? `Додати ${n}` : 'Додати';
      goBtn.disabled = !n;
    }
    function renderRows() {
      const vis = rows.filter((r) => !q || U.normalize(r.c.name).includes(U.normalize(q)));
      ui.mount(listEl, vis.length ? vis.map((r) => {
        const sub = [r.c.bday ? 'ДН ' + mdText(r.c.bday, r.c.bdayYear) : 'без дня народження', r.c.phone, r.c.dates.length ? `ще дат: ${r.c.dates.length}` : null].filter(Boolean).join(' · ');
        const box = h('input', { type: 'checkbox', checked: r.on, 'aria-label': r.c.name });
        box.addEventListener('change', () => { r.on = box.checked; updateCount(); });
        return h('label', { class: 'ppl-imp-row' + (r.dup ? ' dup' : '') },
          box,
          h('span', { class: 'ppl-up-main' }, h('span', { class: 'ppl-up-title' }, r.c.name), h('span', { class: 'ppl-up-sub' }, sub)),
          r.dup ? h('span', { class: 'badge', title: 'Така людина вже є — доповнимо порожні поля' }, 'уже є — доповнити') : null);
      }) : h('div', { class: 'subtle ppl-imp-none' }, 'Нікого не знайдено.'));
      updateCount();
    }
    const pick = (fn) => { rows.forEach((r) => { r.on = fn(r); }); renderRows(); };
    const search = ui.input({ type: 'search', placeholder: 'Пошук у файлі…', 'aria-label': 'Пошук у файлі', class: 'input ppl-imp-search' });
    search.addEventListener('input', () => { q = search.value; renderRows(); });
    const groupSel = ui.select(GROUPS.map((g) => ({ value: g.id, label: g.label })), { value: group, 'aria-label': 'Група для нових', class: 'select ppl-imp-group' });
    groupSel.addEventListener('change', () => { group = groupSel.value; });
    const body = h('div', { class: 'stack ppl-imp' },
      h('p', { class: 'modal-text' }, `У файлі «${fileName}» — ${fmt.count(cards.length, ['контакт', 'контакти', 'контактів'])}, з днем народження — ${withBday}. Вибери, кого додати (за замовчуванням — з днем народження). Дані лишаються лише в цьому браузері й твоїй синхронізації.`),
      h('div', { class: 'ppl-imp-tools' },
        h('div', { class: 'btn-row' },
          ui.button({ label: 'З днем народження', size: 'sm', onClick: () => pick((r) => !!r.c.bday && !r.dup) }),
          ui.button({ label: 'Усі', size: 'sm', onClick: () => pick(() => true) }),
          ui.button({ label: 'Нікого', size: 'sm', onClick: () => pick(() => false) })),
        search),
      listEl,
      h('div', { class: 'ppl-imp-foot' }, ui.field({ label: 'Група для нових', input: groupSel }), h('span', { class: 'subtle' }, countEl)));
    const dlg = ui.modal({ title: 'Імпорт контактів', size: 'lg', className: 'ppl-imp-modal', body, footer: [ui.button({ label: 'Скасувати', onClick: () => dlg.close('button') }), goBtn] });
    renderRows();

    async function run() {
      const chosen = rows.filter((r) => r.on);
      if (!chosen.length) return;
      const created = [];
      const updated = [];
      const seen = new Map();
      chosen.forEach((r) => {
        const c = r.c;
        const key = U.normalize(c.name);
        const base = seen.get(key) || r.dup;
        if (base) {
          const u = U.deepClone(base);
          ['phone', 'email', 'telegram', 'instagram'].forEach((k) => { if (!u[k] && c[k]) u[k] = c[k]; });
          if (!u.bday && c.bday) { u.bday = c.bday; u.bdayYear = c.bdayYear; }
          if (c.notes && !(u.notes || '').includes(c.notes)) u.notes = [u.notes, c.notes].filter(Boolean).join('\n');
          const have = new Set((u.dates || []).map((d) => d.md + '|' + d.title));
          u.dates = (u.dates || []).concat(c.dates.filter((d) => !have.has(d.md + '|' + d.title)));
          if (r.dup) updated.push(u); else created[created.indexOf(base)] = u;
          seen.set(key, u);
          return;
        }
        const rec = {
          id: U.uid(), name: c.name, group: c.group || group, bday: c.bday, bdayYear: c.bdayYear, phone: c.phone, telegram: c.telegram, instagram: c.instagram,
          email: c.email, notes: c.notes, dates: c.dates, gifts: [], freq: null, lastContact: null, source: 'vcf'
        };
        created.push(rec);
        seen.set(key, rec);
      });
      dlg.close('force');
      if (created.length) await CRM.store.saveMany('people', created);
      if (updated.length) await CRM.store.saveMany('people', updated);
      CRM.notify.runRules();
      ui.toast(`Додано: ${created.length}` + (updated.length ? `, доповнено: ${updated.length}` : ''), { type: 'success' });
    }
  }

  // ---------- Головна ----------
  function homeCard() {
    const ppl = list();
    const head = h('div', { class: 'card-head' },
      h('h2', null, 'Люди'),
      h('div', { class: 'btn-row' },
        ui.button({ icon: 'plus', iconOnly: true, size: 'sm', variant: 'ghost', title: 'Додати людину', onClick: () => openPerson() }),
        ppl.length ? h('a', { href: '#/people', class: 'btn btn-ghost btn-sm' }, 'Усі люди', CRM.icon('chevronRight', { size: 'sm' })) : null));
    if (!ppl.length) {
      return h('section', { class: 'card ppl-home' }, head, ui.empty({
        icon: 'cake', small: true, title: 'Дні народження й «час написати»',
        text: 'Додай людей — тут зʼявляться найближчі дні народження й кому давно не писав.',
        action: { label: 'Додати людину', icon: 'plus', onClick: () => openPerson() }
      }));
    }
    const up = upcoming(HOME_DAYS);
    const due = dueContacts();
    let upPart;
    if (up.length) upPart = h('div', { class: 'ppl-up-list' }, up.slice(0, 4).map(upRow));
    else {
      const next = ppl.map(nextAnnual).filter(Boolean).sort((a, b) => a.date.localeCompare(b.date))[0];
      upPart = h('div', { class: 'card-body subtle ppl-home-none' }, 'Найближчі 2 тижні — без днів народження.' + (next ? ` Наступний: ${next.person.name} — ${dayShort(next.date)}.` : ''));
    }
    return h('section', { class: 'card ppl-home' }, head,
      h('div', { class: 'ppl-home-sub' }, CRM.icon('cake', { size: 'sm' }), 'Найближчі дні народження'), upPart,
      due.length ? [h('div', { class: 'ppl-home-sub' }, CRM.icon('chat', { size: 'sm' }), 'Час написати'), h('div', { class: 'ppl-up-list' }, due.slice(0, 3).map(dueRow)),
        due.length > 3 ? h('a', { href: '#/people', class: 'more-link' }, `Ще ${due.length - 3} — відкрити «Люди»`) : null] : null);
  }

  // ---------- Реєстрація ----------
  CRM.router.register('people', { title: 'Люди', stores: ['people'], render });

  // Розклад на сьогодні (Головна): дні народження й дати
  if (CRM.home && CRM.home.addScheduleSource) {
    CRM.home.addScheduleSource((T) => datesBetween(T, T).map((e) => {
      const bd = e.kind === 'birthday';
      const g = bd ? greetedAt(e.person) : null;
      return {
        time: null, kind: 'people', icon: 'cake', cls: 'ico-goal', title: e.title,
        sub: [e.yearsText, e.gifts ? `ідей подарунків: ${e.gifts}` : null].filter(Boolean).join(' · ') || 'Люди',
        // День народження: клік — «Привітати» (звідти є й «Картка людини»)
        badge: bd ? (g ? { cls: 'badge-success', text: 'Привітано' } : { cls: 'badge-accent', text: 'Привітати' }) : null,
        onClick: () => (bd && !g ? openGreet(e.personId) : openPerson(e.personId))
      };
    }));
  }

  // Нагадування: за 7 днів (або ближче, якщо CRM відкрили пізніше) і в день; «час написати»
  CRM.notify.addRule(() => {
    const out = [];
    const T = D.today();
    upcoming(MAX_REMIND).forEach((e) => {
      const left = D.diffDays(T, e.date);
      const lead = remindOf(e.person);
      if (lead < 0 || left > lead) return;
      const name = e.person.name;
      const what = e.kind === 'birthday' ? `день народження: ${name}` : `${e.ann.title} — ${name}`;
      const gifts = e.gifts ? `ідей подарунків: ${e.gifts}` : null;
      const target = { store: 'people', id: e.personId };
      if (left === 0) {
        const bd = e.kind === 'birthday';
        out.push({
          key: `people:today:${e.personId}:${e.ann.id}:${e.date}`, kind: 'people', title: `Сьогодні ${what}`,
          text: [e.yearsText, gifts, bd ? 'натисни, щоб привітати' : null].filter(Boolean).join(' · '),
          target: bd ? { route: 'people', params: { open: e.personId, greet: '1' } } : target
        });
      } else {
        const when = left === 1 ? 'Завтра' : `Через ${fmt.count(left, ['день', 'дні', 'днів'])}`;
        out.push({ key: `people:soon:${e.personId}:${e.ann.id}:${e.date}`, kind: 'people', title: `${when} ${what}`, text: [dayShort(e.date), e.yearsText, gifts].filter(Boolean).join(' · '), target });
      }
    });
    dueContacts().forEach(({ p, c }) => {
      out.push({
        key: `people:contact:${p.id}:${c.due}`, kind: 'people', title: `Час написати: ${p.name}`,
        text: c.since != null ? `Востаннє спілкувались ${fmt.count(c.since, ['день', 'дні', 'днів'])} тому · ${freqLabel(p.freq).toLowerCase()}` : `Хочеш спілкуватися ${freqLabel(p.freq).toLowerCase()}`,
        target: { store: 'people', id: p.id }
      });
    });
    return out;
  });

  // ---------- Імена у відмінках (для ⚡: «ДР Марти 5 листопада», «написав Марті») ----------
  // Прості правила української відміни + список поширених імен (щоб «Марти» → «Марта», «Андрія» → «Андрій»).
  const COMMON_NAMES = ('Марта Марія Олена Ольга Оля Анна Аня Ганна Галина Галя Катерина Катя Ірина Іра Наталія Наталя Наташа ' +
    'Тетяна Таня Юлія Юля Оксана Світлана Софія Соня Анастасія Настя Дарина Дарія Даша Вікторія Віка Христина Соломія Надія Надя ' +
    'Людмила Люда Валентина Віра Любов Люба Лілія Ліля Алла Яна Діана Аліна Ангеліна Єва Злата Мирослава Ярослава Богдана Зоряна ' +
    "Уляна Василина Роксолана Марічка Емілія Поліна Олександра Валерія Інна Леся Лариса Маргарита Ніна Зоя Тамара Лідія Мілана Кіра " +
    "Вероніка Олеся Іванна Марина Карина Кристина Ксенія Майя Мар'яна Устина " +
    'Андрій Олександр Саша Сашко Іван Петро Павло Микола Михайло Дмитро Сергій Олег Тарас Богдан Василь Юрій Віталій Віктор ' +
    'Володимир Вова Ярослав Роман Максим Артем Денис Назар Остап Орест Євген Женя Ігор Антон Олексій Степан Григорій Костянтин ' +
    'Костя Матвій Марко Данило Владислав Влад Станіслав Руслан Анатолій Вадим Валентин Ілля Кирило Лев Мирослав Нестор Святослав ' +
    'Захар Тимофій Тимур Федір Леонід Борис Філіп Арсен Ростислав Любомир Маркіян Давид ' +
    'мама тато бабуся дідусь брат сестра дядько тітка хрещена хрещений').split(' ');
  const ALT = { 'г': 'з', 'к': 'ц', 'х': 'с' };
  const formsCache = new Map();
  /** Відмінкові форми слова з імені (нижній регістр): «марта» → марти, марті, марту, мартою… */
  function nameForms(word) {
    const w = U.normalize(word);
    if (formsCache.has(w)) return formsCache.get(w);
    const f = new Set([w]);
    const add = (base, ends) => ends.forEach((e) => f.add(base + e));
    const b = w.slice(0, -1);
    const last = w.slice(-1);
    if (w.length >= 2) {
      if (last === 'а') {
        add(b, ['и', 'і', 'у', 'ою', 'о']);
        const pre = b.slice(-1);
        if (ALT[pre]) f.add(b.slice(0, -1) + ALT[pre] + 'і');          // Ольга → Ользі, Марічка → Марічці
        if (/[жчшщ]/.test(pre)) add(b, ['ею', 'е']);                   // Даша → Дашею
      } else if (last === 'я') {
        add(b, ['і', 'ї', 'ю', 'ею', 'єю', 'є', 'е']);                   // Оля → Олі, Марія → Марії, Ілля → Іллею
      } else if (last === 'й') {
        add(b, ['я', 'ю', 'єм', 'ем', 'єві', 'еві', 'ї']);               // Андрій → Андрія, Андрію, Андрієм
      } else if (last === 'о') {
        add(b, ['а', 'у', 'ом', 'ові', 'е']);                           // Петро, Марко, тато
      } else if (last === 'ь') {
        add(b, ['я', 'ю', 'ем', 'еві']);                                // дідусь → дідуся, дідусем
      } else if (/[бвгґджзклмнпрстфхцчшщ]/.test(last)) {
        add(w, ['а', 'у', 'ом', 'ові', 'е', 'я', 'ю', 'ем', 'еві']);     // Іван → Івана, Ігор → Ігоря
        const m = /^(.*)і([рнв])$/.exec(w);                             // Федір → Федора, Яків → Якова
        if (m) add(m[1] + 'о' + m[2], ['а', 'у', 'ом', 'ові', 'е']);
        if (/ов$/.test(w)) add(w, ['і', "'ю"]);                          // Любов → Любові
      }
    }
    formsCache.set(w, f);
    return f;
  }
  const capWord = (s) => s.split('-').map((x) => (x ? x.charAt(0).toUpperCase() + x.slice(1) : x)).join('-');
  /** Імʼя в називному відмінку — спроба: «марти» → «Марта», «андрія» → «Андрій». */
  function guessName(token) {
    const t = U.normalize(token);
    if (!t) return '';
    for (const n of COMMON_NAMES) {
      const nn = U.normalize(n);
      if (nn === t || nameForms(nn).has(t)) return capWord(nn);
    }
    let g = t;
    if (/ї$/.test(t)) g = t.slice(0, -1) + 'я';
    else if (/(ою|ею|єю)$/.test(t)) g = t.replace(/(ою|ею)$/, 'а').replace(/єю$/, 'я');
    else if (/и$/.test(t)) g = t.slice(0, -1) + 'а';
    else if (/і$/.test(t)) g = t.slice(0, -1) + (/[жчшщ]$/.test(t.slice(0, -1)) ? 'а' : 'я');
    return capWord(g);
  }
  /**
   * Люди, чиє імʼя схоже на слова з рядка (будь-який відмінок): [{ person, score, at }], найкращі першими.
   * words — слова в нижньому регістрі; at — номер слова, з якого почався збіг.
   */
  function matchPeople(words) {
    const ws = (words || []).map((x) => U.normalize(x)).filter(Boolean);
    if (!ws.length) return [];
    const out = [];
    list().forEach((p) => {
      const pw = U.normalize(p.name).split(/[\s]+/).filter((x) => x.length >= 2);
      let score = 0;
      let at = -1;
      pw.forEach((n, k) => {
        let best = 0;
        let bi = -1;
        ws.forEach((w, i) => {
          let s = 0;
          if (w === n) s = 3;
          else if (w.length >= 3 && nameForms(n).has(w)) s = 2;
          if (s && k === 0) s += 0.5;
          if (s > best) { best = s; bi = i; }
        });
        if (best) { score += best; if (at < 0 || bi < at) at = bi; }
      });
      if (score) out.push({ person: p, score, at });
    });
    return out.sort((a, b) => b.score - a.score || (b.person.updatedAt || '').localeCompare(a.person.updatedAt || ''));
  }
  /** Порожня картка людини з полями за замовчуванням. */
  function blank(fields) {
    return Object.assign({
      id: U.uid(), name: '', group: 'friends', bday: null, bdayYear: null, phone: '', telegram: '', instagram: '', email: '',
      notes: '', dates: [], gifts: [], freq: null, lastContact: null
    }, fields || {});
  }

  // ---------- «Мій кабінет» → «Привітання»: свої шаблони (синхронізуються) ----------
  async function saveTemplates(list) {
    const templates = list.map((t) => String(t || '').trim()).filter(Boolean).slice(0, MAX_TEMPLATES);
    await CRM.store.setSetting('greetings', Object.assign({}, CRM.store.getSetting('greetings', null) || {}, { templates }));
  }
  function settingsBlock() {
    const listEl = h('div', { class: 'greet-tpls' });
    function render() {
      const tpls = ownTemplates();
      const addIn = ui.textarea({ rows: 3, maxlength: 1000, placeholder: 'Напр.: {імʼя}, з днем народження! …', 'aria-label': 'Новий шаблон привітання', class: 'textarea greet-tpl-new' });
      const err = h('div', { class: 'greet-tpl-err', role: 'alert' });
      const addBtn = ui.button({
        label: 'Додати шаблон', icon: 'plus', size: 'sm', className: 'greet-tpl-add',
        onClick: async () => {
          const v = addIn.value.trim();
          if (!v) { err.textContent = 'Напиши текст шаблону'; addIn.focus(); return; }
          if (tpls.length >= MAX_TEMPLATES) { err.textContent = `Не більше ${MAX_TEMPLATES} шаблонів`; return; }
          await saveTemplates(tpls.concat(v));
          ui.toast('Шаблон привітання додано', { type: 'success' });
          render();
        }
      });
      ui.mount(listEl,
        tpls.map((t, i) => {
          const area = ui.textarea({ rows: 2, maxlength: 1000, value: t, 'aria-label': `Мій шаблон ${i + 1}`, class: 'textarea greet-tpl-text' });
          area.addEventListener('change', async () => {
            const v = area.value.trim();
            const next = ownTemplates();
            if (!v) { area.value = next[i] || t; return; }
            next[i] = v;
            await saveTemplates(next);
            ui.toast('Шаблон збережено', { type: 'success' });
          });
          return h('div', { class: 'greet-tpl', dataset: { i: String(i) } }, area,
            h('button', {
              type: 'button', class: 'btn btn-ghost btn-icon btn-sm greet-tpl-del', 'aria-label': 'Видалити шаблон', title: 'Видалити шаблон',
              onClick: async () => {
                const before = ownTemplates();
                await saveTemplates(before.filter((_, k) => k !== i));
                render();
                ui.toast('Шаблон видалено', { action: { label: 'Скасувати', onClick: async () => { await saveTemplates(before); render(); } } });
              }
            }, CRM.icon('trash', { size: 'sm' })));
        }),
        h('div', { class: 'greet-tpl-addrow' }, addIn, err, addBtn));
    }
    render();
    return h('div', { class: 'setting-row greet-settings', id: 'greet' },
      h('div', { class: 'setting-text' },
        h('div', { class: 'setting-title' }, CRM.icon('cake', { size: 'sm' }), 'Привітання з днем народження'),
        h('div', { class: 'setting-desc' }, 'Кнопка «Привітати» (у день народження — на Головній і в «Людях», завжди — у картці людини) готує текст: спершу твої шаблони, далі 6 готових («Інший текст» перебирає). {імʼя} — місце для звертання: «Марто», «Андрію» або як вписано в картці людини («Як звертатися»). Шаблони синхронізуються між пристроями.'),
        listEl,
        h('details', { class: 'greet-builtin' }, h('summary', null, `Готові тексти (${GREETINGS.length})`),
          h('ol', null, GREETINGS.map((t) => h('li', null, t))))));
  }

  CRM.people = {
    GROUPS, FREQS, REMINDS, GREETINGS, list, get, annual, datesBetween, upcoming, nextAnnual, nextOf, inYear, contactInfo, dueContacts,
    markContacted, openPerson, openPage, parseVcf, importFile, openImport, homeCard, groupOf, mdText, writeLink,
    nameForms, guessName, matchPeople, blank, save, canSave: () => !!CRM.db.SCHEMA.people,
    remindOf, autoAddress, greetAddress, withName, fillGreeting, allTemplates, ownTemplates, greetOcc, greetedAt, tgLink, openGreet,
    openGiftExpense, giftCategory, mentionMatcher, related, toVcf, openExport, settingsBlock,
    vocative: (w) => caseWord(w, vocLower), instrumental: (w) => caseWord(w, insLower)
  };
})(window.CRM);
