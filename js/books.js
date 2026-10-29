/* ==========================================================================
   books.js — розділ «Книги»: полиці «Читаю · Хочу прочитати · Прочитано · Кинув»,
   журнал читання за днями («+30 сторінок» або «я на 120-й»), прогрес, темп і
   «дочитаєш приблизно …», оцінка 1–5 і нотатки, свої цитати (вони потрапляють
   у «Цитату дня» приблизно через день), сторінки з журналу самі зараховуються
   до звички-кількості зі сторінками («Читання — 20 сторінок»), блок «Читаю зараз»
   на Головній, запис через ⚡ («читав 30 сторінок»).
   Дані — лише в браузері й синхронізації (сховище books), не в коді.

   Книга: { id, title, author, pages: число|null (усього в книзі), shelf: 'reading'|'want'|'done'|'dropped',
            startPage: число (уже прочитано до журналу — не йде в статистику й звичку),
            startDate, endDate ('РРРР-ММ-ДД'|null), rating: 1–5|null, notes, color (id палітри),
            log: [{ id, date, pages (± скільки сторінок), at (ISO), hb: { id, v }|null (скільки додано до звички) }],
            quotes: [{ id, text, page|null, at }] }
   Поточна сторінка = startPage + сума pages журналу.
   ========================================================================== */
window.CRM = window.CRM || {};

(function (CRM) {
  'use strict';

  const { h, ui } = { h: CRM.ui.h, ui: CRM.ui };
  const D = CRM.date;
  const U = CRM.utils;
  const fmt = CRM.fmt;

  const SHELVES = [
    { id: 'reading', label: 'Читаю', tab: 'Читаю' },
    { id: 'want', label: 'Хочу прочитати', tab: 'Хочу прочитати' },
    { id: 'done', label: 'Прочитано', tab: 'Прочитано' },
    { id: 'dropped', label: 'Кинув', tab: 'Кинув' }
  ];
  const SHELF_IDS = SHELVES.map((s) => s.id);
  const COLORS = ['orange', 'teal', 'violet', 'red', 'blue', 'green', 'magenta', 'brown', 'olive', 'aqua', 'yellow', 'slate'];
  const MAX_PAGES = 20000;
  const PACE_DAYS = 14;
  const MAX_QUOTE = 2000;
  const STARS = [1, 2, 3, 4, 5];
  const PAGE_FORMS = ['сторінка', 'сторінки', 'сторінок'];
  const BOOK_FORMS = ['книга', 'книги', 'книг'];

  // ---------- Дані ----------
  const get = (id) => { const x = CRM.store.get('books', id); return x && !x.deletedAt ? x : null; };
  const all = () => CRM.store.list('books');
  const shelfOf = (b) => (SHELF_IDS.includes(b && b.shelf) ? b.shelf : 'want');
  const shelfLabel = (id) => (SHELVES.find((s) => s.id === id) || SHELVES[1]).label;
  const colorOf = (b) => CRM.dict.categoryColor(b && b.color ? b.color : 'orange');
  const totalOf = (b) => { const n = Math.round(Number(b && b.pages)); return n > 0 ? n : null; };
  const num = (n) => fmt.number(n, 0);
  const pagesText = (n) => `${num(n)} стор.`;

  function canSave() {
    if (CRM.db.SCHEMA.books) return true;
    ui.toast('Браузер показує стару версію сайту з кешу — онови сторінку (Ctrl+F5), щоб вести книги.', { type: 'error', duration: 9000 });
    return false;
  }

  /** Журнал за порядком: дата, потім час запису. */
  function logOf(b) {
    return (Array.isArray(b && b.log) ? b.log : [])
      .filter((e) => e && D.isDate(e.date) && Number.isFinite(Number(e.pages)))
      .slice()
      .sort((x, y) => (x.date < y.date ? -1 : x.date > y.date ? 1 : String(x.at || '').localeCompare(String(y.at || ''))));
  }
  const quotesOf = (b) => (Array.isArray(b && b.quotes) ? b.quotes.filter((q) => q && q.text) : []);
  const startPageOf = (b) => Math.max(0, Math.round(Number(b && b.startPage) || 0));

  /** Поточна сторінка (не менше 0). */
  function currentPage(b) {
    const s = logOf(b).reduce((acc, e) => acc + Number(e.pages), startPageOf(b));
    return Math.max(0, Math.round(s));
  }
  /** Прогрес: { cur, total, frac, left, pct }. Прочитана — 100 %. */
  function progress(b) {
    const total = totalOf(b);
    let cur = currentPage(b);
    if (total && cur > total) cur = total;
    if (shelfOf(b) === 'done' && total) cur = total;
    const frac = total ? Math.min(1, cur / total) : 0;
    return { cur, total, frac, pct: Math.round(frac * 100), left: total ? Math.max(0, total - cur) : null };
  }
  /** Сторінок за проміжок дат (включно) — у однієї книги або в усіх. */
  function pagesBetween(from, to, books) {
    let s = 0;
    (books || all()).forEach((b) => logOf(b).forEach((e) => { if (e.date >= from && e.date <= to) s += Number(e.pages); }));
    return Math.max(0, Math.round(s));
  }
  const lastActivity = (b) => { const l = logOf(b); const e = l[l.length - 1]; return e ? e.date + (e.at || '') : (b.startDate || '') + (b.updatedAt || ''); };
  function firstDate(b) { const l = logOf(b); return l.length ? l[0].date : null; }
  /** Темп — сторінок на день за останні 2 тижні (або від першого запису, якщо він пізніше). */
  function pace(books, T) {
    const today = T || D.today();
    const list = books || all();
    const from = D.addDays(today, -(PACE_DAYS - 1));
    let first = null;
    list.forEach((b) => { const f = firstDate(b); if (f && (!first || f < first)) first = f; });
    if (!first) return null;
    const start = first > from ? first : from;
    const days = Math.max(1, D.diffDays(start, today) + 1);
    const sum = pagesBetween(start, today, list);
    return sum > 0 ? sum / days : null;
  }
  /** «Дочитаєш приблизно …» — дата або null. */
  function eta(b, T) {
    const p = progress(b);
    if (!p.total || !p.left || shelfOf(b) !== 'reading') return null;
    const v = pace([b], T);
    if (!v) return null;
    const days = Math.ceil(p.left / v);
    return days > 3650 ? null : D.addDays(T || D.today(), days);
  }
  function paceText(v) { return v >= 10 ? `~${num(Math.round(v))} стор./день` : `~${fmt.number(Math.round(v * 10) / 10, v % 1 ? 1 : 0)} стор./день`; }
  /** Прочитані книги за рік (за датою «дочитав»). */
  function readInYear(y) { return all().filter((b) => shelfOf(b) === 'done' && b.endDate && b.endDate.slice(0, 4) === String(y)); }

  const byTitle = (a, b) => String(a.title || '').localeCompare(String(b.title || ''), 'uk');
  /** Книги полиці в їхньому порядку. */
  function onShelf(shelf) {
    const list = all().filter((b) => shelfOf(b) === shelf);
    if (shelf === 'reading') return list.sort((a, b) => lastActivity(b).localeCompare(lastActivity(a)) || byTitle(a, b));
    if (shelf === 'want') return list.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')) || byTitle(a, b));
    return list.sort((a, b) => String(b.endDate || '').localeCompare(String(a.endDate || '')) || byTitle(a, b));
  }

  // ---------- Звичка «Читання» ----------
  /** Звичка-кількість зі сторінками (одиниця «сторінок», «стор.»…) — до неї зараховуються сторінки з журналу. */
  function readingHabit() {
    if (!CRM.habits || !CRM.habits.active) return null;
    return CRM.habits.active().find((hb) => hb.kind === 'count' && /^(стор|стр|с\.?$|pages?)/.test(U.normalize(hb.unit || ''))) || null;
  }
  async function habitAdd(date, pages) {
    const hb = readingHabit();
    if (!hb || !(pages > 0) || date > D.today()) return null;
    if (CRM.habits.startOf && date < CRM.habits.startOf(hb)) return null;
    const ds = CRM.habits.dayState(hb, date);
    const base = ds.v === CRM.habits.SKIP ? 0 : Number(ds.v) || 0;
    const res = await CRM.habits.setDay(hb.id, date, base + pages);
    return res ? { id: hb.id, v: pages } : null;
  }
  async function habitSub(link, date) {
    if (!link || !link.id || !(link.v > 0) || !CRM.habits) return;
    const hb = CRM.habits.get(link.id);
    if (!hb || date > D.today()) return;
    const ds = CRM.habits.dayState(hb, date);
    const base = ds.v === CRM.habits.SKIP ? 0 : Number(ds.v) || 0;
    await CRM.habits.setDay(hb.id, date, Math.max(0, Math.round((base - link.v) * 10) / 10));
  }

  // ---------- Зміни ----------
  async function saveBook(rec) { return CRM.store.save('books', rec); }

  /**
   * Запис у журнал: pages — скільки сторінок (+ / −). → { saved, entry, finished, undo } або null.
   * Книга з «Хочу прочитати» переходить у «Читаю».
   */
  async function addEntry(id, opts) {
    const b = get(id);
    if (!b || !canSave()) return null;
    const T = D.today();
    const date = D.isDate(opts && opts.date) ? opts.date : T;
    const pages = Math.round(Number(opts && opts.pages) || 0);
    if (date > T) { ui.toast('Майбутні дні записати не можна', { type: 'error' }); return null; }
    if (!pages) return null;
    const before = { shelf: b.shelf, startDate: b.startDate || null, endDate: b.endDate || null };
    const hb = pages > 0 ? await habitAdd(date, pages) : null;
    const fresh = get(id) || b;
    const entry = { id: U.uid(), date, pages, at: new Date().toISOString(), hb };
    const rec = Object.assign({}, fresh, { log: (Array.isArray(fresh.log) ? fresh.log : []).concat(entry) });
    if (shelfOf(rec) === 'want' || shelfOf(rec) === 'dropped') { rec.shelf = 'reading'; rec.endDate = null; }
    if (shelfOf(rec) === 'reading' && (!rec.startDate || date < rec.startDate)) rec.startDate = date;
    const saved = await saveBook(rec);
    const p = progress(saved);
    const finished = shelfOf(saved) === 'reading' && !!p.total && currentPage(saved) >= p.total;
    return {
      saved, entry, finished,
      undo: async () => {
        const cur = get(id);
        if (cur) await saveBook(Object.assign({}, cur, before, { log: (cur.log || []).filter((e) => e.id !== entry.id) }));
        if (hb) await habitSub(hb, date);
      }
    };
  }
  /** Прибрати запис журналу (разом зі сторінками у звичці). */
  async function removeEntry(id, entryId) {
    const b = get(id);
    if (!b || !canSave()) return null;
    const e = (b.log || []).find((x) => x.id === entryId);
    if (!e) return null;
    await saveBook(Object.assign({}, b, { log: (b.log || []).filter((x) => x.id !== entryId) }));
    if (e.hb) await habitSub(e.hb, e.date);
    return {
      undo: async () => {
        const cur = get(id);
        if (!cur) return;
        const hb = e.hb ? await habitAdd(e.date, e.hb.v) : null;
        const again = get(id) || cur;
        await saveBook(Object.assign({}, again, { log: (again.log || []).filter((x) => x.id !== e.id).concat(Object.assign({}, e, { hb })) }));
      }
    };
  }
  /** Змінити запис журналу (дату й кількість сторінок). */
  async function updateEntry(id, entryId, changes) {
    const b = get(id);
    if (!b || !canSave()) return null;
    const e = (b.log || []).find((x) => x.id === entryId);
    if (!e) return null;
    const date = D.isDate(changes.date) ? changes.date : e.date;
    const pages = Math.round(Number(changes.pages));
    if (!pages || date > D.today()) return null;
    if (date === e.date && pages === Number(e.pages)) return { same: true };
    if (e.hb) await habitSub(e.hb, e.date);
    const hb = pages > 0 ? await habitAdd(date, pages) : null;
    const cur = get(id) || b;
    await saveBook(Object.assign({}, cur, { log: (cur.log || []).map((x) => (x.id === entryId ? Object.assign({}, x, { date, pages, hb }) : x)) }));
    return { saved: get(id) };
  }

  /** Перенести на полицю (дати ставляться самі). → «Скасувати» в тості. */
  async function setShelf(id, shelf, opts) {
    const b = get(id);
    if (!b || !SHELF_IDS.includes(shelf) || !canSave()) return null;
    if (shelfOf(b) === shelf) return b;
    const T = D.today();
    const before = { shelf: b.shelf, startDate: b.startDate || null, endDate: b.endDate || null };
    const rec = Object.assign({}, b, { shelf });
    const first = firstDate(b);
    if (shelf === 'reading') { rec.startDate = b.startDate || T; rec.endDate = null; }
    if (shelf === 'done' || shelf === 'dropped') { rec.startDate = b.startDate || first || T; rec.endDate = T; if (rec.startDate > T) rec.startDate = T; }
    if (shelf === 'want') { rec.endDate = null; if (!logOf(b).length) rec.startDate = null; }
    const saved = await saveBook(rec);
    if (!(opts && opts.silent)) {
      const msg = shelf === 'done' ? `«${saved.title}» — прочитано! Оціни книгу зірками на її сторінці.`
        : shelf === 'reading' ? `«${saved.title}» — у «Читаю»` : shelf === 'dropped' ? `«${saved.title}» — у «Кинув». Історія збережена.` : `«${saved.title}» — у «Хочу прочитати»`;
      const actions = [];
      if (shelf === 'done' && !(CRM.router.current && CRM.router.current.name === 'books' && CRM.router.current.sub === id)) actions.push({ label: 'Оцінити', onClick: () => openBook(id) });
      actions.push({ label: 'Скасувати', onClick: async () => { const c = get(id); if (c) await saveBook(Object.assign({}, c, before)); } });
      ui.toast(msg, { type: 'success', duration: 8000, actions });
    }
    return saved;
  }
  async function setRating(id, n) {
    const b = get(id);
    if (!b || !canSave()) return null;
    const v = STARS.includes(Number(n)) ? Number(n) : null;
    return saveBook(Object.assign({}, b, { rating: v }));
  }
  async function setNotes(id, text) {
    const b = get(id);
    if (!b || !canSave()) return null;
    const v = String(text || '').slice(0, 10000);
    if ((b.notes || '') === v) return b;
    return saveBook(Object.assign({}, b, { notes: v }));
  }
  async function addQuote(id, q) {
    const b = get(id);
    if (!b || !canSave()) return null;
    const text = String(q.text || '').trim().slice(0, MAX_QUOTE);
    if (!text) return null;
    const page = Math.round(Number(q.page)) > 0 ? Math.round(Number(q.page)) : null;
    const quote = { id: U.uid(), text, page, at: new Date().toISOString() };
    await saveBook(Object.assign({}, b, { quotes: (Array.isArray(b.quotes) ? b.quotes : []).concat(quote) }));
    return quote;
  }
  async function updateQuote(id, qid, q) {
    const b = get(id);
    if (!b || !canSave()) return null;
    const text = String(q.text || '').trim().slice(0, MAX_QUOTE);
    if (!text) return null;
    const page = Math.round(Number(q.page)) > 0 ? Math.round(Number(q.page)) : null;
    return saveBook(Object.assign({}, b, { quotes: (b.quotes || []).map((x) => (x.id === qid ? Object.assign({}, x, { text, page }) : x)) }));
  }
  async function removeQuote(id, qid) {
    const b = get(id);
    if (!b || !canSave()) return null;
    const q = (b.quotes || []).find((x) => x.id === qid);
    if (!q) return null;
    await saveBook(Object.assign({}, b, { quotes: (b.quotes || []).filter((x) => x.id !== qid) }));
    ui.toast('Цитату видалено', {
      action: { label: 'Скасувати', onClick: async () => { const c = get(id); if (c) await saveBook(Object.assign({}, c, { quotes: (c.quotes || []).filter((x) => x.id !== qid).concat(q) })); } }
    });
    return q;
  }

  // ---------- Цитати ----------
  /** Усі свої цитати в сталому порядку (однаково на всіх пристроях). */
  function allQuotes() {
    const out = [];
    all().slice().sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')) || String(a.id).localeCompare(String(b.id)))
      .forEach((b) => quotesOf(b).slice().sort((x, y) => String(x.at || '').localeCompare(String(y.at || '')) || String(x.id).localeCompare(String(y.id)))
        .forEach((q) => out.push({ q, book: b })));
    return out;
  }
  /** Підпис цитати: «Леся Українка, «Лісова пісня», с. 112». */
  function quoteSource(book, q) {
    return [book.author, `«${book.title}»`, q && q.page ? `с. ${q.page}` : null].filter(Boolean).join(', ');
  }
  /**
   * Своя цитата для «Цитати дня» — приблизно через день (непарні дні), по черзі; інакше null.
   * Те саме число дня → та сама цитата на всіх пристроях.
   */
  function quoteFor(date) {
    if (!CRM.db.SCHEMA.books) return null;
    const list = allQuotes();
    if (!list.length) return null;
    const day = Math.floor(D.toUTC(date || D.today()) / 86400000);
    if (((day % 2) + 2) % 2 !== 1) return null;
    const k = Math.floor(day / 2) % list.length;
    const it = list[(k + list.length) % list.length];
    return { text: it.q.text, author: quoteSource(it.book, it.q), own: true, bookId: it.book.id, quoteId: it.q.id };
  }

  // ---------- Елементи ----------
  function cover(b, size) {
    const t = String(b.title || '?').trim();
    const letter = (t.match(/[\p{L}\p{N}]/u) || ['?'])[0].toUpperCase();
    return h('span', { class: 'bk-cover' + (size ? ' bk-cover-' + size : ''), style: { '--bk': colorOf(b) }, 'aria-hidden': 'true' },
      h('span', { class: 'bk-cover-letter' }, letter));
  }
  function bar(frac) {
    return h('span', { class: 'bk-bar', 'aria-hidden': 'true' }, h('span', { style: { width: Math.round(Math.min(1, frac) * 100) + '%' } }));
  }
  function starsView(n) {
    const v = Number(n) || 0;
    return h('span', { class: 'bk-stars-view', title: v ? `Оцінка: ${v} з 5` : 'Без оцінки', 'aria-label': v ? `Оцінка: ${v} з 5` : 'Без оцінки' },
      STARS.map((i) => h('span', { class: 'bk-star' + (i <= v ? ' on' : '') }, CRM.icon('star', { size: 'sm' }))));
  }
  function starsInput(value, onChange, cls) {
    let v = Number(value) || 0;
    const box = h('div', { class: 'bk-stars' + (cls ? ' ' + cls : ''), role: 'radiogroup', 'aria-label': 'Оцінка' });
    function paint() {
      ui.mount(box, STARS.map((i) => h('button', {
        type: 'button', role: 'radio', class: 'bk-star-btn' + (i <= v ? ' on' : ''), dataset: { star: String(i) },
        'aria-checked': i === v ? 'true' : 'false', 'aria-label': `${i} з 5`, title: i === v ? 'Натисни ще раз, щоб прибрати оцінку' : `${i} з 5`,
        onClick: () => { v = v === i ? 0 : i; paint(); onChange(v || null); }
      }, CRM.icon('star'))));
    }
    paint();
    return box;
  }
  function dayShort(d) { return `${CRM.WEEKDAYS_SHORT[D.weekday(d)]}, ${fmt.dateShort(d)}`; }
  function relDay(d) {
    const n = D.diffDays(d, D.today());
    if (n === 0) return 'сьогодні';
    if (n === 1) return 'вчора';
    return dayShort(d);
  }
  function progressText(b) {
    const p = progress(b);
    if (shelfOf(b) === 'done') return p.total ? `${pagesText(p.total)}` : 'прочитано';
    if (p.total) return `с. ${num(p.cur)} з ${num(p.total)} · ${p.pct} %`;
    return p.cur ? `с. ${num(p.cur)}` : 'ще не почато';
  }
  /** Підпис книги (пошук, Кошик). */
  function subText(b) {
    const s = shelfOf(b);
    const parts = [b.author || null, shelfLabel(s)];
    if (s === 'reading') parts.push(progressText(b));
    if (s === 'done' && b.rating) parts.push('★'.repeat(b.rating));
    return parts.filter(Boolean).join(' · ');
  }
  function datesText(b) {
    const s = shelfOf(b);
    if (s === 'reading') return b.startDate ? `читаю з ${fmt.dateShort(b.startDate)}` : '';
    if (s === 'done') {
      if (!b.endDate) return '';
      const days = b.startDate ? D.diffDays(b.startDate, b.endDate) + 1 : null;
      return `прочитано ${fmt.dateShort(b.endDate)}` + (days && days > 0 ? ` · за ${fmt.count(days, ['день', 'дні', 'днів'])}` : '');
    }
    if (s === 'dropped') {
      const p = progress(b);
      return [p.cur ? `кинув на с. ${num(p.cur)}${p.total ? ' з ' + num(p.total) : ''}` : 'кинув', b.endDate ? fmt.dateShort(b.endDate) : null].filter(Boolean).join(' · ');
    }
    return b.createdAt ? `додано ${fmt.dateShort(D.toKyivDate(b.createdAt))}` : '';
  }

  // ---------- Віконце «Записати прочитане» ----------
  let logPop = null;
  /** Невелике віконце біля кнопки: «+ сторінок» або «я на сторінці». */
  function openLog(id, anchor) {
    const b = get(id);
    if (!b) return null;
    if (logPop) { logPop.close(); logPop = null; }
    const p = progress(b);
    let mode = 'add';
    const numIn = h('input', { class: 'input bk-pop-num num', inputmode: 'numeric', maxlength: 6, placeholder: '30', 'aria-label': 'Скільки сторінок' });
    const seg = h('div', { class: 'segmented bk-pop-mode', role: 'radiogroup', 'aria-label': 'Що вписую' });
    const hint = h('div', { class: 'bk-pop-hint subtle' });
    function paint() {
      ui.mount(seg, [['add', 'Прочитав сторінок'], ['at', 'Я на сторінці']].map(([k, l]) => h('button', {
        type: 'button', role: 'radio', class: mode === k ? 'active' : '', 'aria-checked': mode === k ? 'true' : 'false', dataset: { mode: k },
        onClick: () => { mode = k; paint(); numIn.focus(); }
      }, l)));
      numIn.placeholder = mode === 'add' ? '30' : String(Math.min(p.total || 9999, p.cur + 30));
      hint.textContent = `Зараз: ${progressText(b)}`;
    }
    paint();
    const save = async () => {
      const r = readLog(b, mode, numIn.value);
      if (r.error) { numIn.classList.add('invalid'); hint.textContent = r.error; numIn.focus(); return; }
      pop.close();
      await logPages(id, { pages: r.pages });
    };
    numIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
    numIn.addEventListener('input', () => numIn.classList.remove('invalid'));
    const content = h('div', { class: 'bk-pop' },
      h('div', { class: 'bk-pop-title' }, cover(b, 'xs'), h('span', null, b.title)),
      seg,
      h('div', { class: 'bk-pop-row' }, numIn, ui.button({ label: 'Записати', variant: 'primary', size: 'sm', className: 'bk-pop-save', onClick: save })),
      hint);
    const pop = ui.popover(anchor, content, { className: 'bk-popover', align: 'start', onClose: () => { if (logPop === pop) logPop = null; } });
    logPop = pop;
    setTimeout(() => numIn.focus(), 0);
    return pop;
  }
  /** Розібрати введене: mode 'add' — скільки прочитав, 'at' — на якій сторінці. → { pages } або { error }. */
  function readLog(b, mode, raw) {
    const s = String(raw || '').replace(/\s/g, '').replace(/^\+/, '');
    if (!/^\d{1,6}$/.test(s)) return { error: mode === 'add' ? 'Вкажи, скільки сторінок прочитав' : 'Вкажи номер сторінки' };
    const n = Number(s);
    const cur = currentPage(b);
    const total = totalOf(b);
    if (mode === 'at') {
      if (total && n > total) return { error: `У книзі ${pagesText(total)}` };
      if (n === cur) return { error: 'Ти вже на цій сторінці' };
      return { pages: n - cur };
    }
    if (!n) return { error: 'Більше нуля, будь ласка' };
    if (n > MAX_PAGES) return { error: 'Завелике число' };
    if (total && cur + n > total) return { error: `Лишилось лише ${pagesText(Math.max(0, total - cur))}` };
    return { pages: n };
  }
  /** Записати з тостом «Скасувати» (і «Прочитано», якщо дійшов до останньої сторінки). */
  async function logPages(id, opts) {
    const res = await addEntry(id, opts);
    if (!res) return null;
    toastEntry(res);
    return res;
  }
  function entryText(res) {
    const b = res.saved;
    const e = res.entry;
    const sign = e.pages > 0 ? '+' : '−';
    return `${b.title}: ${sign}${pagesText(Math.abs(e.pages))} · ${progressText(b)} · ${relDay(e.date)}` + (res.entry.hb ? ' · до звички теж' : '');
  }
  function toastEntry(res, extra) {
    const actions = (extra || []).slice();
    if (res.finished) actions.unshift({ label: 'Прочитано', onClick: () => setShelf(res.saved.id, 'done') });
    actions.push({ label: 'Скасувати', onClick: async () => { await res.undo(); ui.toast('Скасовано — запис прибрано'); } });
    ui.toast(res.finished ? `Остання сторінка! ${entryText(res)}. Перенести в «Прочитано»?` : entryText(res), { type: 'success', duration: res.finished ? 15000 : 9000, actions });
  }

  // ---------- Сторінка «Книги» ----------
  let quoteQuery = '';
  const drafts = {};
  const TABS = SHELVES.map((s) => s.id).concat('quotes');

  function tabsNav(cur) {
    const count = (id) => (id === 'quotes' ? allQuotes().length : onShelf(id).length);
    return h('nav', { class: 'tabs bk-tabs', 'aria-label': 'Полиці' },
      TABS.map((id) => h('a', {
        href: '#/books' + (id === 'reading' ? '' : '/' + id), class: 'tab' + (id === cur ? ' active' : ''), dataset: { tab: id },
        'aria-current': id === cur ? 'page' : null
      }, id === 'quotes' ? 'Цитати' : shelfLabel(id), h('span', { class: 'tab-count' }, String(count(id))))));
  }

  function bookCard(b) {
    const s = shelfOf(b);
    const p = progress(b);
    const T = D.today();
    let meta = null;
    let action = null;
    if (s === 'reading') {
      const e = eta(b, T);
      meta = h('div', { class: 'bk-card-meta' },
        p.total ? bar(p.frac) : null,
        h('span', { class: 'bk-card-prog' }, progressText(b)),
        e ? h('span', { class: 'bk-card-eta subtle' }, `дочитаєш ~${fmt.dateShort(e)}`) : null);
      const btn = ui.button({ label: 'Записати', icon: 'plus', size: 'sm', className: 'bk-card-log', title: 'Записати прочитане', onClick: (ev) => { ev.preventDefault(); ev.stopPropagation(); openLog(b.id, btn); } });
      action = btn;
    } else if (s === 'want') {
      action = ui.button({ label: 'Почати читати', size: 'sm', className: 'bk-card-start', onClick: (ev) => { ev.preventDefault(); ev.stopPropagation(); setShelf(b.id, 'reading'); } });
    } else if (s === 'done') {
      meta = h('div', { class: 'bk-card-meta' }, starsView(b.rating));
    }
    return h('div', { class: 'bk-card', dataset: { id: b.id, shelf: s }, style: { '--bk': colorOf(b) } },
      h('a', { class: 'bk-card-main', href: CRM.router.href('books/' + b.id) },
        cover(b),
        h('span', { class: 'bk-card-text' },
          h('span', { class: 'bk-card-title' }, b.title),
          b.author ? h('span', { class: 'bk-card-author subtle' }, b.author) : null,
          meta,
          h('span', { class: 'bk-card-dates subtle' }, datesText(b)))),
      action ? h('div', { class: 'bk-card-act' }, action) : null);
  }

  function summaryCard() {
    const T = D.today();
    const week = pagesBetween(D.addDays(T, -6), T);
    const v = pace(null, T);
    const year = Number(T.slice(0, 4));
    const read = readInYear(year);
    const tile = (label, value, sub, icon, cls) => h('div', { class: 'stat bk-stat' + (cls ? ' ' + cls : '') },
      h('div', { class: 'stat-label' }, h('span', { class: 'stat-ico' }, CRM.icon(icon, { size: 'sm' })), label),
      h('div', { class: 'stat-value num' }, value), sub ? h('div', { class: 'bk-stat-sub subtle' }, sub) : null);
    // 7 стовпчиків: сторінки за останні 7 днів
    const days = [];
    for (let i = 6; i >= 0; i--) { const d = D.addDays(T, -i); days.push({ d, n: pagesBetween(d, d) }); }
    const max = Math.max(1, ...days.map((x) => x.n));
    const bars = h('span', { class: 'bk-week-bars', 'aria-hidden': 'true' }, days.map((x) => h('i', { class: x.d === T ? 'today' : '', style: { height: Math.max(8, Math.round((x.n / max) * 100)) + '%' }, title: `${dayShort(x.d)}: ${pagesText(x.n)}` })));
    const hb = readingHabit();
    const link = hb
      ? h('div', { class: 'bk-habit-note subtle' }, CRM.icon('habits', { size: 'sm' }),
        h('span', null, 'Сторінки з журналу самі зараховуються до звички ', h('a', { href: CRM.router.href('habits/' + hb.id) }, `«${hb.name}»`), ' — окремо відмічати її не треба.'))
      : CRM.habits ? h('div', { class: 'bk-habit-note subtle' }, CRM.icon('habits', { size: 'sm' }),
        h('span', null, 'Хочеш серію «днів поспіль»? Створи звичку зі сторінками — і сторінки з журналу зараховуватимуться до неї самі. '),
        ui.button({ label: 'Звичка «Читання»', size: 'sm', variant: 'ghost', className: 'bk-habit-create', onClick: () => CRM.habits.openForm(null, { name: 'Читання', kind: 'count', target: 20, unit: 'сторінок', step: 5, color: 'orange' }) })) : null;
    return h('section', { class: 'card bk-summary' },
      h('div', { class: 'card-body' },
        h('div', { class: 'stats bk-stats' },
          tile('За 7 днів', pagesText(week), h('span', { class: 'bk-week' }, bars), 'book', 'bk-stat-week'),
          tile('Темп', v ? paceText(v) : '—', 'за 2 тижні', 'trendUp'),
          tile(`Прочитано у ${year}`, fmt.count(read.length, BOOK_FORMS), read.length ? pagesText(read.reduce((s, b) => s + (totalOf(b) || 0), 0)) : 'дочитай першу', 'checkCircle'),
          tile('Цитат', String(allQuotes().length), 'у «Цитаті дня» — приблизно через день', 'quote')),
        link));
  }

  function shelfList(shelf) {
    const list = onShelf(shelf);
    if (!list.length) {
      const text = {
        reading: 'Зараз нічого не читаєш. Додай книгу або перенеси з «Хочу прочитати».',
        want: 'Тут список книжок, які хочеш прочитати. Кнопка «Почати читати» перенесе книгу в «Читаю».',
        done: 'Тут будуть прочитані книги з оцінками й датами. Коли дочитаєш до останньої сторінки, CRM запропонує перенести книгу сюди.',
        dropped: 'Тут книги, які ти кинув. Вони не рахуються прочитаними, але історія лишається.'
      }[shelf];
      const want = shelf === 'reading' ? onShelf('want').slice(0, 3) : [];
      return h('section', { class: 'card bk-empty-shelf' }, ui.empty({ icon: 'library', small: true, title: shelf === 'reading' ? 'Що читаєш зараз?' : 'Порожньо', text }),
        want.length ? h('div', { class: 'bk-start-from-want' }, h('div', { class: 'subtle' }, 'Почати з «Хочу прочитати»:'),
          h('div', { class: 'chips' }, want.map((b) => h('button', { type: 'button', class: 'chip bk-start-chip', dataset: { id: b.id }, onClick: () => setShelf(b.id, 'reading') }, b.title)))) : null);
    }
    if (shelf === 'done') {
      const years = new Map();
      list.forEach((b) => { const y = b.endDate ? b.endDate.slice(0, 4) : '—'; if (!years.has(y)) years.set(y, []); years.get(y).push(b); });
      return h('div', { class: 'stack' }, [...years.entries()].map(([y, bs]) => h('section', { class: 'bk-year-group' },
        h('h2', { class: 'bk-year-head' }, y === '—' ? 'Без дати' : y, h('span', { class: 'subtle' }, ` · ${fmt.count(bs.length, BOOK_FORMS)}`)),
        h('div', { class: 'bk-grid' }, bs.map(bookCard)))));
    }
    return h('div', { class: 'bk-grid' }, list.map(bookCard));
  }

  function quotesTab() {
    const items = allQuotes().slice().reverse();
    if (!items.length) {
      return h('section', { class: 'card' }, ui.empty({
        icon: 'quote', small: true, title: 'Ще немає цитат',
        text: 'Відкрий книгу й додай цитату (текст і сторінку). Свої цитати показуються в «Цитаті дня» на Головній приблизно через день.'
      }));
    }
    const listBox = h('div', { class: 'bk-qlist' });
    const countEl = h('span', { class: 'subtle bk-q-count' });
    function paint() {
      const terms = U.normalize(quoteQuery).split(' ').filter(Boolean);
      const shown = items.filter((it) => { const s = U.normalize([it.q.text, it.book.title, it.book.author].join(' ')); return terms.every((t) => s.includes(t)); });
      countEl.textContent = terms.length ? `Знайдено: ${shown.length} з ${items.length}` : fmt.count(items.length, ['цитата', 'цитати', 'цитат']);
      ui.mount(listBox, shown.length ? shown.map((it) => quoteRow(it.q, it.book, { withBook: true })) : h('div', { class: 'subtle bk-q-none' }, 'Нічого не знайдено.'));
    }
    const search = ui.input({ class: 'input bk-q-search', type: 'search', value: quoteQuery, placeholder: 'Пошук у цитатах, назвах і авторах…', 'aria-label': 'Пошук у цитатах', dataset: { keep: 'q-search' } });
    search.addEventListener('input', () => { quoteQuery = search.value; paint(); });
    paint();
    return h('section', { class: 'card bk-quotes-card' },
      h('div', { class: 'card-head' }, h('h2', null, CRM.icon('quote', { size: 'sm' }), 'Мої цитати'), countEl),
      h('div', { class: 'card-body' }, search, listBox));
  }

  function quoteRow(q, b, opts) {
    const o = opts || {};
    return h('figure', { class: 'bk-quote' + (o.hl ? ' bk-hl' : ''), dataset: { id: q.id, book: b.id }, style: { '--bk': colorOf(b) } },
      h('blockquote', { class: 'bk-quote-text' }, q.text),
      h('figcaption', { class: 'bk-quote-meta' },
        o.withBook ? h('a', { class: 'bk-quote-src', href: CRM.router.href('books/' + b.id, { quote: q.id }) }, '— ' + quoteSource(b, q))
          : h('span', { class: 'bk-quote-src subtle' }, q.page ? `с. ${q.page}` : 'без сторінки'),
        o.withBook ? null : h('span', { class: 'bk-quote-btns' },
          ui.button({ icon: 'pencil', iconOnly: true, size: 'sm', variant: 'ghost', className: 'bk-quote-edit', title: 'Змінити цитату', onClick: () => openQuoteForm(b.id, q.id) }),
          ui.button({ icon: 'trash', iconOnly: true, size: 'sm', variant: 'ghost', className: 'bk-quote-del', title: 'Видалити цитату', onClick: () => removeQuote(b.id, q.id) }))));
  }

  function renderList(container, tab) {
    const books = all();
    const head = ui.pageHead({
      title: 'Книги', sub: 'Що читаю, прогрес у сторінках, оцінки й свої цитати.',
      actions: [ui.button({ label: 'Додати книгу', icon: 'plus', variant: 'primary', className: 'bk-add-btn', onClick: () => openForm(null, { shelf: SHELF_IDS.includes(tab) ? tab : 'reading' }) })]
    });
    if (!books.length) {
      ui.mount(container, head, h('section', { class: 'card bk-empty-card' }, ui.empty({
        icon: 'library', title: 'Ще немає книг',
        text: 'Додай книгу, яку читаєш, або список «Хочу прочитати». Записуй, скільки сторінок прочитав за день, — CRM покаже прогрес, темп і коли приблизно дочитаєш. Свої цитати з книжок потраплятимуть у «Цитату дня».',
        action: { label: 'Додати книгу', icon: 'plus', onClick: () => openForm(null, { shelf: 'reading' }) }
      })));
      return;
    }
    const body = tab === 'quotes' ? quotesTab() : shelfList(tab);
    ui.mount(container, head, tabsNav(tab), h('div', { class: 'stack' }, tab === 'reading' ? summaryCard() : null, body));
  }

  // ---------- Сторінка книги ----------
  function renderBook(container, id, params) {
    const b = get(id);
    const back = h('a', { class: 'btn btn-ghost btn-sm bk-back', href: '#/books' + (b && shelfOf(b) !== 'reading' ? '/' + shelfOf(b) : '') }, CRM.icon('chevronLeft', { size: 'sm' }), 'Книги');
    if (!b) {
      ui.mount(container, back, ui.pageHead({ title: 'Книгу не знайдено' }), h('section', { class: 'card' }, ui.empty({
        icon: 'library', title: 'Такої книги немає', text: 'Можливо, її видалено (перевір Кошик).', action: { label: 'До книг', onClick: () => CRM.router.go('books') }
      })));
      return;
    }
    const T = D.today();
    const s = shelfOf(b);
    const p = progress(b);
    const head = ui.pageHead({
      title: b.title,
      sub: [b.author || 'Автор не вказаний', p.total ? pagesText(p.total) : null].filter(Boolean).join(' · '),
      actions: [ui.button({ label: 'Змінити', icon: 'pencil', className: 'bk-edit', onClick: () => openForm(b.id) })]
    });

    // Полиця, прогрес, оцінка
    const shelfSeg = h('div', { class: 'segmented bk-shelf-seg', role: 'radiogroup', 'aria-label': 'Полиця' },
      SHELVES.map((x) => h('button', {
        type: 'button', role: 'radio', class: s === x.id ? 'active' : '', 'aria-checked': s === x.id ? 'true' : 'false', dataset: { shelf: x.id },
        onClick: () => setShelf(b.id, x.id)
      }, x.label)));
    const e = eta(b, T);
    const v = pace([b], T);
    const week = pagesBetween(D.addDays(T, -6), T, [b]);
    const hero = h('section', { class: 'card bk-hero', style: { '--bk': colorOf(b) } },
      h('div', { class: 'card-body bk-hero-body' },
        cover(b, 'lg'),
        h('div', { class: 'bk-hero-main' },
          shelfSeg,
          h('div', { class: 'bk-hero-dates subtle' }, datesText(b) || ' '),
          s !== 'want' || p.cur ? h('div', { class: 'bk-hero-prog' },
            p.total ? bar(p.frac) : null,
            h('div', { class: 'bk-hero-prog-text' }, h('b', { class: 'num' }, progressText(b)))) : null,
          s === 'reading' ? h('div', { class: 'bk-hero-stats' },
            h('span', { class: 'bk-hs' }, h('span', { class: 'subtle' }, 'За 7 днів'), h('b', { class: 'num' }, pagesText(week))),
            h('span', { class: 'bk-hs' }, h('span', { class: 'subtle' }, 'Темп'), h('b', { class: 'num' }, v ? paceText(v) : '—')),
            h('span', { class: 'bk-hs bk-hs-eta' }, h('span', { class: 'subtle' }, 'Дочитаєш'), h('b', null, e ? 'приблизно ' + fmt.dateShort(e) : p.total ? '—' : 'вкажи кількість сторінок'))) : null,
          h('div', { class: 'bk-hero-rate' }, h('span', { class: 'subtle' }, 'Оцінка'),
            starsInput(b.rating, (n) => setRating(b.id, n), 'bk-rate')))));

    // Журнал
    const log = logOf(b);
    const T7 = D.addDays(T, -6);
    let running = startPageOf(b);
    const withTo = log.map((x) => { running += Number(x.pages); return { e: x, to: running }; }).reverse();
    const showAll = !!showAllLog[b.id];
    const shown = showAll ? withTo : withTo.slice(0, 20);
    const logForm = s === 'reading' || s === 'want' ? logFormBox(b) : null;
    const logCard = h('section', { class: 'card bk-log-card' },
      h('div', { class: 'card-head' }, h('h2', null, CRM.icon('book', { size: 'sm' }), 'Журнал читання'),
        log.length ? h('span', { class: 'subtle' }, `за 7 днів: ${pagesText(pagesBetween(T7, T, [b]))}`) : null),
      h('div', { class: 'card-body' },
        logForm,
        log.length ? h('div', { class: 'bk-entries' }, shown.map(({ e: x, to }) => entryRow(b, x, to))) : h('div', { class: 'subtle bk-no-log' }, s === 'want' ? 'Запиши перші прочитані сторінки — книга перейде в «Читаю».' : 'Записів ще немає.'),
        withTo.length > shown.length ? ui.button({ label: `Показати всі (${withTo.length})`, size: 'sm', variant: 'ghost', className: 'bk-log-more', onClick: () => { showAllLog[b.id] = true; CRM.router.rerender(); } }) : null));

    // Цитати
    const hlQuote = params && params.quote;
    const quotes = quotesOf(b).slice().sort((x, y) => (Number(x.page) || 1e9) - (Number(y.page) || 1e9) || String(x.at || '').localeCompare(String(y.at || '')));
    const quoteCard = h('section', { class: 'card bk-quotes-book' },
      h('div', { class: 'card-head' }, h('h2', null, CRM.icon('quote', { size: 'sm' }), 'Цитати', quotes.length ? h('span', { class: 'tab-count' }, String(quotes.length)) : null)),
      h('div', { class: 'card-body' },
        quoteFormBox(b),
        quotes.length ? h('div', { class: 'bk-qlist' }, quotes.map((q) => quoteRow(q, b, { hl: q.id === hlQuote }))) : null));

    // Нотатки (зберігаються самі)
    const notesKey = 'notes:' + b.id;
    const notesIn = ui.textarea({ class: 'textarea bk-notes', rows: 4, maxlength: 10000, placeholder: 'Думки про книгу, що запамʼяталось, кому порадити…', 'aria-label': 'Нотатки', dataset: { keep: notesKey } });
    notesIn.value = drafts[notesKey] != null ? drafts[notesKey] : b.notes || '';
    const savedNote = h('span', { class: 'subtle bk-notes-state' });
    const flush = async () => {
      if (drafts[notesKey] == null) return;
      const val = drafts[notesKey];
      await setNotes(b.id, val);
      if (drafts[notesKey] === val) delete drafts[notesKey];
      savedNote.textContent = 'Збережено';
    };
    const later = U.debounce(flush, 600);
    notesIn.addEventListener('input', () => { drafts[notesKey] = notesIn.value; savedNote.textContent = ''; later(); });
    notesIn.addEventListener('blur', flush);
    const notesCard = h('section', { class: 'card bk-notes-card' },
      h('div', { class: 'card-head' }, h('h2', null, CRM.icon('pencil', { size: 'sm' }), 'Нотатки'), savedNote),
      h('div', { class: 'card-body' }, notesIn));

    ui.mount(container, back, head, h('div', { class: 'stack' }, hero, logCard, quoteCard, notesCard));
    if (hlQuote) {
      CRM.router.consumeParam('quote');
      setTimeout(() => {
        const el = container.querySelector(`.bk-quote[data-id="${CSS.escape(hlQuote)}"]`);
        if (el) { el.scrollIntoView({ block: 'center' }); setTimeout(() => el.classList.remove('bk-hl'), 2400); }
      }, 50);
    }
    return flush;
  }
  const showAllLog = {};

  function logFormBox(b) {
    const key = 'log:' + b.id;
    let mode = drafts[key + ':mode'] || 'add';
    let date = D.today();
    const numIn = h('input', { class: 'input bk-log-num num', inputmode: 'numeric', maxlength: 6, placeholder: '30', 'aria-label': 'Скільки сторінок', dataset: { keep: key } });
    numIn.value = drafts[key] || '';
    const seg = h('div', { class: 'segmented bk-log-mode', role: 'radiogroup', 'aria-label': 'Що вписую' });
    const err = h('div', { class: 'bk-log-err', role: 'alert' });
    function paint() {
      ui.mount(seg, [['add', 'Прочитав сторінок'], ['at', 'Я на сторінці']].map(([k, l]) => h('button', {
        type: 'button', role: 'radio', class: mode === k ? 'active' : '', 'aria-checked': mode === k ? 'true' : 'false', dataset: { mode: k },
        onClick: () => { mode = k; drafts[key + ':mode'] = k; paint(); numIn.focus(); }
      }, l)));
      numIn.placeholder = mode === 'add' ? '30' : String(Math.min(totalOf(b) || 9999, currentPage(b) + 30));
      numIn.setAttribute('aria-label', mode === 'add' ? 'Скільки сторінок прочитав' : 'На якій ти сторінці');
    }
    paint();
    const dateIn = ui.dateInput({ value: date, clearable: false, ariaLabel: 'Дата', onChange: (v) => { if (v) date = v; } });
    dateIn.classList.add('bk-log-date');
    const save = async () => {
      err.textContent = '';
      if (date > D.today()) { err.textContent = 'Майбутні дні записати не можна'; return; }
      const r = readLog(get(b.id) || b, mode, numIn.value);
      if (r.error) { err.textContent = r.error; numIn.classList.add('invalid'); numIn.focus(); return; }
      delete drafts[key];
      numIn.value = '';
      await logPages(b.id, { pages: r.pages, date });
    };
    numIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
    numIn.addEventListener('input', () => { drafts[key] = numIn.value; numIn.classList.remove('invalid'); err.textContent = ''; });
    return h('div', { class: 'bk-log' },
      seg,
      h('div', { class: 'bk-log-row' }, numIn, dateIn, ui.button({ label: 'Записати', icon: 'plus', variant: 'primary', className: 'bk-log-add', onClick: save })),
      err,
      h('div', { class: 'field-hint' }, `Зараз: ${progressText(b)}. «Я на сторінці» — CRM сама порахує, скільки прочитано.`));
  }

  function entryRow(b, e, to) {
    const n = Number(e.pages);
    const total = totalOf(b);
    return h('div', { class: 'bk-entry' + (n < 0 ? ' neg' : ''), dataset: { id: e.id, date: e.date } },
      h('span', { class: 'bk-entry-date' }, relDay(e.date) === 'сьогодні' || relDay(e.date) === 'вчора' ? `${relDay(e.date)[0].toUpperCase() + relDay(e.date).slice(1)}, ${fmt.dateShort(e.date)}` : dayShort(e.date)),
      h('b', { class: 'bk-entry-pages num' }, (n > 0 ? '+' : '−') + pagesText(Math.abs(n))),
      h('span', { class: 'bk-entry-to subtle' }, `до с. ${num(Math.max(0, total ? Math.min(total, to) : to))}`),
      e.hb ? h('span', { class: 'bk-entry-hb', title: 'Зараховано до звички' }, CRM.icon('habits', { size: 'sm' })) : h('span'),
      h('span', { class: 'bk-entry-btns' },
        ui.button({ icon: 'pencil', iconOnly: true, size: 'sm', variant: 'ghost', className: 'bk-entry-edit', title: 'Змінити запис', onClick: (ev) => openEntryEdit(b.id, e.id, ev.currentTarget) }),
        ui.button({
          icon: 'trash', iconOnly: true, size: 'sm', variant: 'ghost', className: 'bk-entry-del', title: 'Видалити запис',
          onClick: async () => {
            const res = await removeEntry(b.id, e.id);
            if (res) ui.toast(`Запис ${dayShort(e.date)} (${n > 0 ? '+' : '−'}${pagesText(Math.abs(n))}) видалено`, { action: { label: 'Скасувати', onClick: () => res.undo() } });
          }
        })));
  }

  function openEntryEdit(id, entryId, anchor) {
    const b = get(id);
    const e = b && (b.log || []).find((x) => x.id === entryId);
    if (!e) return null;
    if (logPop) { logPop.close(); logPop = null; }
    let date = e.date;
    const numIn = h('input', { class: 'input bk-edit-num num', inputmode: 'numeric', maxlength: 7, value: String(e.pages), 'aria-label': 'Сторінок (мінус — якщо повернувся назад)' });
    const dateIn = ui.dateInput({ value: date, clearable: false, ariaLabel: 'Дата', onChange: (v) => { if (v) date = v; } });
    const err = h('div', { class: 'bk-log-err' });
    const save = async () => {
      const n = Number(String(numIn.value).replace(/\s/g, '').replace('−', '-'));
      if (!Number.isInteger(n) || !n || Math.abs(n) > MAX_PAGES) { err.textContent = 'Ціле число сторінок, не нуль'; numIn.focus(); return; }
      if (date > D.today()) { err.textContent = 'Майбутні дні — ні'; return; }
      pop.close();
      const res = await updateEntry(id, entryId, { date, pages: n });
      if (res && !res.same) ui.toast('Запис змінено', { type: 'success' });
    };
    numIn.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); save(); } });
    const pop = ui.popover(anchor, h('div', { class: 'bk-pop bk-edit-pop' },
      h('div', { class: 'bk-pop-title' }, 'Запис журналу'),
      h('label', { class: 'field-label' }, 'Сторінок'), numIn,
      h('label', { class: 'field-label' }, 'Дата'), dateIn,
      err,
      h('div', { class: 'bk-pop-row' }, ui.button({ label: 'Зберегти', variant: 'primary', size: 'sm', className: 'bk-edit-save', onClick: save }))),
    { className: 'bk-popover', onClose: () => { if (logPop === pop) logPop = null; } });
    logPop = pop;
    setTimeout(() => { numIn.focus(); numIn.select(); }, 0);
    return pop;
  }

  function quoteFormBox(b) {
    const key = 'quote:' + b.id;
    const textIn = ui.textarea({ class: 'textarea bk-q-text', rows: 2, maxlength: MAX_QUOTE, placeholder: 'Цитата з книги…', 'aria-label': 'Текст цитати', dataset: { keep: key } });
    textIn.value = drafts[key] || '';
    const pageIn = ui.input({ class: 'input bk-q-page num', inputmode: 'numeric', maxlength: 6, placeholder: 'с.', 'aria-label': 'Сторінка', dataset: { keep: key + ':page' } });
    pageIn.value = drafts[key + ':page'] || '';
    const err = h('div', { class: 'bk-log-err' });
    const add = async () => {
      const text = textIn.value.trim();
      if (!text) { err.textContent = 'Встав або впиши текст цитати'; textIn.focus(); return; }
      const ps = pageIn.value.replace(/\s/g, '');
      if (ps && !/^\d{1,6}$/.test(ps)) { err.textContent = 'Сторінка — число'; pageIn.focus(); return; }
      delete drafts[key]; delete drafts[key + ':page'];
      const q = await addQuote(b.id, { text, page: ps ? Number(ps) : null });
      if (q) ui.toast('Цитату додано — вона зʼявлятиметься в «Цитаті дня»', { type: 'success' });
    };
    textIn.addEventListener('input', () => { drafts[key] = textIn.value; err.textContent = ''; });
    pageIn.addEventListener('input', () => { drafts[key + ':page'] = pageIn.value; err.textContent = ''; });
    textIn.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); e.stopPropagation(); add(); } });
    pageIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } });
    return h('div', { class: 'bk-qform' }, textIn,
      h('div', { class: 'bk-qform-row' }, pageIn, ui.button({ label: 'Додати цитату', icon: 'plus', size: 'sm', className: 'bk-q-add', onClick: add })),
      err);
  }

  function openQuoteForm(id, qid) {
    const b = get(id);
    const q = b && quotesOf(b).find((x) => x.id === qid);
    if (!q) return null;
    const textIn = ui.textarea({ class: 'textarea bk-qe-text', rows: 4, maxlength: MAX_QUOTE, 'aria-label': 'Текст цитати' });
    textIn.value = q.text;
    const pageIn = ui.input({ class: 'input bk-qe-page num', inputmode: 'numeric', maxlength: 6, value: q.page ? String(q.page) : '', 'aria-label': 'Сторінка' });
    const fText = ui.field({ label: 'Цитата', input: textIn, required: true });
    const fPage = ui.field({ label: 'Сторінка', input: pageIn });
    const submit = async () => {
      const text = textIn.value.trim();
      if (!text) { fText.setError('Текст не може бути порожнім'); return; }
      const ps = pageIn.value.replace(/\s/g, '');
      if (ps && !/^\d{1,6}$/.test(ps)) { fPage.setError('Сторінка — число'); return; }
      dlg.close('force');
      await updateQuote(id, qid, { text, page: ps ? Number(ps) : null });
      ui.toast('Цитату збережено', { type: 'success' });
    };
    const dlg = ui.modal({
      title: 'Цитата', size: 'md', className: 'bk-qe-modal',
      body: h('div', { class: 'form-stack' }, fText, fPage),
      footer: [ui.button({ label: 'Скасувати', onClick: () => dlg.close('button') }), ui.button({ label: 'Зберегти', variant: 'primary', className: 'bk-qe-save', onClick: submit })]
    });
    setTimeout(() => textIn.focus(), 0);
    return dlg;
  }

  function render(container, route) {
    // Не губимо фокус і недописане при перемальовуванні (зміни з іншого пристрою, автозбереження)
    const ae = document.activeElement;
    let keep = null;
    if (ae && container.contains(ae) && ae.dataset && ae.dataset.keep) {
      keep = { key: ae.dataset.keep, value: ae.value, s: ae.selectionStart, e: ae.selectionEnd };
    }
    const onTheme = () => CRM.router.rerender();
    document.addEventListener('crm:themechange', onTheme);
    const sub = route && route.sub;
    let flush = null;
    if (!sub || TABS.includes(sub)) renderList(container, sub || 'reading');
    else flush = renderBook(container, sub, route.params);
    if (keep) {
      const el = container.querySelector(`[data-keep="${CSS.escape(keep.key)}"]`);
      if (el) { el.value = keep.value; el.focus(); try { el.setSelectionRange(keep.s, keep.e); } catch (e) { /* поле без виділення */ } }
    }
    const p = route && route.params;
    if (p && p.open) {
      const id = p.open;
      CRM.router.consumeParam('open');
      setTimeout(() => openForm(id), 0);
    }
    return () => {
      document.removeEventListener('crm:themechange', onTheme);
      if (logPop) { logPop.close(); logPop = null; }
      if (flush) flush();
    };
  }

  // ---------- Форма книги ----------
  function nextColor() {
    const used = new Set(all().filter((b) => shelfOf(b) === 'reading' || shelfOf(b) === 'want').map((x) => x.color));
    return COLORS.find((c) => !used.has(c)) || COLORS[all().length % COLORS.length];
  }
  function openForm(id, preset) {
    const cur = id ? CRM.store.get('books', id) : null;
    if (id && (!cur || cur.deletedAt)) { ui.toast(cur ? 'Книга в Кошику — віднови, щоб змінити' : 'Цієї книги більше немає', { type: 'error' }); return null; }
    const isNew = !cur;
    const st = Object.assign({ title: '', author: '', pages: null, shelf: 'reading', startPage: 0, startDate: null, endDate: null, rating: null, notes: '', color: nextColor() },
      cur ? U.deepClone(cur) : {}, preset || {});
    st.shelf = shelfOf(st);

    const titleIn = ui.input({ value: st.title, maxlength: 200, placeholder: 'Напр., Лісова пісня', 'aria-label': 'Назва книги', class: 'input bk-title-in' });
    const authorIn = ui.input({ value: st.author || '', maxlength: 120, placeholder: 'Напр., Леся Українка', 'aria-label': 'Автор', class: 'input bk-author-in' });
    const pagesIn = ui.input({ value: totalOf(st) ? String(totalOf(st)) : '', inputmode: 'numeric', maxlength: 6, placeholder: '320', 'aria-label': 'Сторінок у книзі', class: 'input bk-pages-in num' });
    const startPageIn = ui.input({ value: startPageOf(st) ? String(startPageOf(st)) : '', inputmode: 'numeric', maxlength: 6, placeholder: '0', 'aria-label': 'Уже прочитано до журналу', class: 'input bk-startpage-in num' });
    const fTitle = ui.field({ label: 'Назва', input: titleIn, required: true });
    const fPages = ui.field({ label: 'Сторінок у книзі', input: pagesIn, hint: 'Потрібно для смужки прогресу й «дочитаєш приблизно …».' });
    const fStartPage = ui.field({
      label: isNew ? 'Я зараз на сторінці' : 'Прочитано до журналу', input: startPageIn,
      hint: 'Якщо почав читати раніше. Ці сторінки не йдуть у статистику й звичку.'
    });

    const shelfSeg = h('div', { class: 'segmented bk-shelves', role: 'radiogroup', 'aria-label': 'Полиця' });
    const startIn = ui.dateInput({ value: st.startDate, ariaLabel: 'Почав читати', onChange: (v) => { st.startDate = v || null; } });
    startIn.classList.add('bk-start-in');
    const endIn = ui.dateInput({ value: st.endDate, ariaLabel: 'Дочитав', onChange: (v) => { st.endDate = v || null; } });
    endIn.classList.add('bk-end-in');
    const fStart = ui.field({ label: 'Почав читати', input: startIn });
    const fEnd = ui.field({ label: 'Дочитав', input: endIn });
    const ratingBox = h('div', { class: 'field bk-form-rate' }, h('div', { class: 'field-label' }, 'Оцінка'), starsInput(st.rating, (n) => { st.rating = n; }, 'bk-form-stars'));
    function renderShelf() {
      ui.mount(shelfSeg, SHELVES.map((x) => h('button', {
        type: 'button', role: 'radio', class: st.shelf === x.id ? 'active' : '', 'aria-checked': st.shelf === x.id ? 'true' : 'false', dataset: { shelf: x.id },
        onClick: () => { st.shelf = x.id; renderShelf(); }
      }, x.label)));
      fStartPage.hidden = st.shelf === 'want';
      fStart.hidden = st.shelf === 'want';
      fEnd.hidden = st.shelf !== 'done' && st.shelf !== 'dropped';
      fEnd.querySelector('.field-label').firstChild.textContent = st.shelf === 'dropped' ? 'Кинув' : 'Дочитав';
      ratingBox.hidden = st.shelf === 'want';
    }

    const sw = h('div', { class: 'swatches bk-swatches', role: 'radiogroup', 'aria-label': 'Колір обкладинки' });
    function renderSw() {
      ui.mount(sw, COLORS.map((c) => {
        const info = CRM.dict.get('categoryColors', c) || {};
        return h('button', {
          type: 'button', role: 'radio', class: 'swatch' + (st.color === c ? ' active' : ''), style: { '--sw': CRM.dict.categoryColor(c) },
          title: info.name || c, 'aria-label': info.name || c, 'aria-checked': st.color === c ? 'true' : 'false', dataset: { color: c },
          onClick: () => { st.color = c; renderSw(); }
        }, st.color === c ? CRM.icon('check') : null);
      }));
    }
    renderSw();
    renderShelf();
    const notesIn = ui.textarea({ value: st.notes || '', rows: 3, maxlength: 10000, placeholder: 'Хто порадив, чому хочу прочитати, враження…', 'aria-label': 'Нотатки', class: 'textarea bk-notes-in' });

    const body = h('div', { class: 'form-stack bk-form' },
      fTitle,
      h('div', { class: 'form-grid' }, ui.field({ label: 'Автор', input: authorIn }), fPages),
      h('div', { class: 'field' }, h('div', { class: 'field-label' }, 'Полиця'), shelfSeg),
      h('div', { class: 'form-grid' }, fStartPage, fStart, fEnd),
      ratingBox,
      ui.field({ label: 'Колір обкладинки', input: sw }),
      ui.field({ label: 'Нотатки', input: notesIn }));

    const readInt = (inp) => { const s = String(inp.value).replace(/\s/g, ''); if (!s) return null; return /^\d{1,6}$/.test(s) ? Number(s) : NaN; };
    async function submit() {
      [fTitle, fPages, fStartPage, fEnd].forEach((f) => f.setError(null));
      let ok = true;
      const title = titleIn.value.trim();
      if (!title) { fTitle.setError('Вкажи назву'); ok = false; }
      const pages = readInt(pagesIn);
      if (Number.isNaN(pages) || (pages != null && (pages < 1 || pages > MAX_PAGES))) { fPages.setError('Ціле число від 1 до 20 000'); ok = false; }
      let startPage = st.shelf === 'want' ? (cur ? startPageOf(cur) : 0) : readInt(startPageIn);
      if (startPage == null) startPage = 0;
      if (Number.isNaN(startPage)) { fStartPage.setError('Ціле число'); ok = false; } else if (pages && startPage > pages) { fStartPage.setError(`Не більше ${num(pages)}`); ok = false; }
      if ((st.shelf === 'done' || st.shelf === 'dropped') && st.startDate && st.endDate && st.endDate < st.startDate) { fEnd.setError('Не раніше за дату початку'); ok = false; }
      if (!ok) { (title ? pagesIn : titleIn).focus(); return; }
      if (!canSave()) return;
      const T = D.today();
      const rec = Object.assign({}, cur || { id: U.uid(), log: [], quotes: [] }, {
        title, author: authorIn.value.trim(), pages: pages || null, shelf: st.shelf, startPage,
        rating: st.shelf === 'want' ? (cur ? cur.rating || null : null) : st.rating || null,
        color: st.color, notes: notesIn.value.trim()
      });
      if (st.shelf === 'want') { rec.startDate = cur && logOf(cur).length ? st.startDate : null; rec.endDate = null; }
      else {
        rec.startDate = st.startDate || (cur && firstDate(cur)) || T;
        rec.endDate = st.shelf === 'done' || st.shelf === 'dropped' ? st.endDate || T : null;
        if (rec.endDate && rec.startDate > rec.endDate) rec.startDate = rec.endDate;
      }
      dlg.close('force');
      const saved = await saveBook(rec);
      if (cur && drafts['notes:' + cur.id] != null) delete drafts['notes:' + cur.id];
      const onPage = CRM.router.current && CRM.router.current.name === 'books' && CRM.router.current.sub === saved.id;
      ui.toast(isNew ? `Книгу додано: ${saved.title}` : 'Книгу збережено', { type: 'success', action: isNew && !onPage ? { label: 'Відкрити', onClick: () => openBook(saved.id) } : null });
    }
    async function remove() {
      const ok = await ui.confirm({ title: 'Видалити книгу?', message: `«${cur.title}» разом із журналом і цитатами перейде в Кошик — відновити можна протягом 30 днів. Сторінки, уже зараховані до звички, лишаться в ній.`, confirmText: 'Видалити', danger: true });
      if (!ok) return;
      dlg.close('force');
      const batch = await CRM.store.softDelete('books', cur.id);
      if (CRM.router.current && CRM.router.current.name === 'books' && CRM.router.current.sub === cur.id) CRM.router.go('books');
      ui.toast(`Книгу «${cur.title}» — у Кошику`, { action: { label: 'Скасувати', onClick: () => CRM.store.restoreBatch(batch) } });
    }
    const footer = isNew
      ? [ui.button({ label: 'Скасувати', onClick: () => dlg.close('button') }), ui.button({ label: 'Додати', variant: 'primary', className: 'bk-save', onClick: submit })]
      : [ui.button({ label: 'Видалити', icon: 'trash', variant: 'danger-ghost', className: 'bk-delete', onClick: remove }),
        h('span', { class: 'grow' }),
        ui.button({ label: 'Скасувати', onClick: () => dlg.close('button') }), ui.button({ label: 'Зберегти', variant: 'primary', className: 'bk-save', onClick: submit })];
    [titleIn, authorIn, pagesIn, startPageIn].forEach((inp) => inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }));
    const dlg = ui.modal({ title: isNew ? 'Нова книга' : 'Книга: ' + cur.title, size: 'md', className: 'bk-form-modal', body, footer });
    setTimeout(() => titleIn.focus(), 0);
    return dlg;
  }
  function openBook(id) { CRM.router.go(id ? 'books/' + id : 'books'); }

  // ---------- Головна: «Читаю зараз» ----------
  function homeCard() {
    const reading = onShelf('reading');
    const head = (extra) => h('div', { class: 'card-head' },
      h('h2', null, 'Читаю зараз', extra),
      h('div', { class: 'btn-row' },
        ui.button({ icon: 'plus', iconOnly: true, size: 'sm', variant: 'ghost', title: 'Додати книгу', className: 'bk-home-add', onClick: () => openForm(null, { shelf: 'reading' }) }),
        all().length ? h('a', { href: '#/books', class: 'btn btn-ghost btn-sm' }, 'Усі книги', CRM.icon('chevronRight', { size: 'sm' })) : null));
    if (!all().length) {
      return h('section', { class: 'card bk-home' }, head(), ui.empty({
        icon: 'library', small: true, title: 'Що читаєш зараз?',
        text: 'Додай книгу — тут буде прогрес у сторінках і кнопка «+», щоб записати прочитане за день.',
        action: { label: 'Додати книгу', icon: 'plus', onClick: () => openForm(null, { shelf: 'reading' }) }
      }));
    }
    const T = D.today();
    const rows = reading.slice(0, 4).map((b) => {
      const p = progress(b);
      const today = pagesBetween(T, T, [b]);
      const plus = h('button', {
        type: 'button', class: 'btn btn-sm bk-hplus', dataset: { id: b.id }, title: 'Записати прочитане', 'aria-label': `${b.title}: записати прочитане`,
        onClick: (e) => { e.stopPropagation(); openLog(b.id, plus); }
      }, CRM.icon('plus', { size: 'sm' }), h('span', null, 'стор.'));
      return h('div', { class: 'bk-hrow', dataset: { id: b.id }, style: { '--bk': colorOf(b) } },
        h('a', { class: 'bk-hrow-main', href: CRM.router.href('books/' + b.id) },
          cover(b, 'sm'),
          h('span', { class: 'bk-hrow-text' },
            h('span', { class: 'bk-hrow-title' }, b.title),
            h('span', { class: 'bk-hrow-sub subtle' }, [progressText(b), today ? `сьогодні +${num(today)}` : null].filter(Boolean).join(' · ')),
            p.total ? bar(p.frac) : null)),
        plus);
    });
    const want = onShelf('want');
    const week = pagesBetween(D.addDays(T, -6), T);
    return h('section', { class: 'card bk-home' },
      head(reading.length ? h('span', { class: 'tab-count' }, String(reading.length)) : null),
      rows.length ? h('div', { class: 'bk-hlist' }, rows)
        : h('div', { class: 'card-body bk-home-none' }, h('div', { class: 'subtle' }, 'Зараз нічого не читаєш.'),
          want.length ? ui.button({ label: `Почати: «${want[0].title}»`, size: 'sm', className: 'bk-home-start', onClick: () => setShelf(want[0].id, 'reading') }) : null),
      reading.length > 4 ? h('div', { class: 'card-body subtle bk-home-more' }, `і ще ${reading.length - 4} — у «Книгах»`) : null,
      week ? h('div', { class: 'card-foot bk-home-week' }, CRM.icon('book', { size: 'sm' }), `За 7 днів: ${pagesText(week)}`) : null);
  }

  // ---------- Швидке введення (⚡): «читав 30 сторінок», «Кобзар 20», «я на 120-й сторінці», «+30 стор. вчора» ----------
  const READ_WORDS = new Set(['читав', 'читала', 'читали', 'прочитав', 'прочитала', 'прочитали', 'почитав', 'почитала', 'дочитав', 'дочитала', 'читаю', 'читання', 'прочитано', 'книга', 'книгу', 'книжка', 'книжку', 'книги', 'книжки']);
  const FILLER = new Set(['я', 'вже', 'уже', 'зараз', 'ще', 'і', 'й', 'та', 'ну', 'у', 'в', 'з', 'із', 'зі', 'про', 'сьогодні', 'вчора', 'позавчора', '+']);
  const UNIT_RE = /^(стор|сторін|стр$|с$|сторінк)/;
  const ORD_RE = /^(\d{1,6})-?(й|ий|ій|а|у|ої|ю|ому|ім|ая)$/;
  function titleWords(s) {
    return U.normalize(s).split(/\s+/).map((w) => w.replace(/[^a-zа-яіїєґ'0-9-]/g, '')).filter((w) => /[a-zа-яіїєґ0-9]/.test(w));
  }
  function wordMatch(t, w) {
    if (t === w) return true;
    if (t.length < 3) return false;
    const st = w.length <= 4 ? w : w.slice(0, Math.max(3, w.length - 2));
    return w.startsWith(t) || t.startsWith(st);
  }
  /** Варіант «Книга» для швидкого введення або null. helpers: { dateFor }. */
  function quickOption(P, helpers) {
    if (!CRM.db.SCHEMA.books || !P || !P.tokens) return null;
    const pool = all().filter((b) => shelfOf(b) === 'reading' || shelfOf(b) === 'want');
    if (!pool.length) return null;
    let verb = false;
    let unit = false;
    let unitFirst = false;
    let amount = null;
    let abs = false;
    let plus = false;
    let prep = false;
    let bad = false;
    const names = [];
    P.tokens.forEach((t) => {
      if (t.tag === 'date') return;
      const n = t.n.replace(/\.$/, '');
      if (READ_WORDS.has(n)) { verb = true; return; }
      if (FILLER.has(n)) { if (n === '+') plus = true; return; }
      if (/^(на|до|по)$/.test(n)) { prep = true; return; }
      let m = /^\+(\d{1,6})$/.exec(n);
      if (m) { if (amount != null) bad = true; amount = Number(m[1]); plus = true; return; }
      m = ORD_RE.exec(n);
      if (m) { if (amount != null) bad = true; amount = Number(m[1]); abs = true; return; }
      m = /^(\d{1,6})$/.exec(n);
      if (m) { if (amount != null) bad = true; amount = Number(m[1]); if (prep || unitFirst) abs = true; return; }
      if (UNIT_RE.test(n)) { unit = true; if (amount == null) unitFirst = true; return; }
      names.push(n);
    });
    if (bad || amount == null) return null;
    // Книга: за словами назви (або автора), інакше — та, що читаєш останньою
    let book = null;
    let titleMatch = false;
    if (names.length) {
      let best = null;
      pool.forEach((b) => {
        [titleWords(b.title), titleWords(b.author || '')].forEach((bw, src) => {
          for (let k = 0; k + names.length <= bw.length; k++) {
            if (!names.every((t, j) => wordMatch(t, bw[k + j]))) continue;
            const score = names.length / bw.length + (k === 0 ? 0.5 : 0) + (src === 0 ? 0.3 : 0) + (shelfOf(b) === 'reading' ? 0.2 : 0);
            if (!best || score > best.score) best = { b, score };
          }
        });
      });
      if (!best) return null;
      book = best.b;
      titleMatch = true;
    } else {
      if (!verb && !unit) return null;
      book = onShelf('reading')[0] || null;
      if (!book) return null;
    }
    const T = D.today();
    const date = (helpers && helpers.dateFor ? helpers.dateFor(P, 'meal') : null) || T;
    const cur = currentPage(book);
    const total = totalOf(book);
    // «Кобзар 120», коли 120 > прочитаного й ≤ сторінок у книзі, а «+120» вийшло б за кінець — це сторінка, на якій ти
    if (!abs && !plus && !unit && total && cur + amount > total && amount > cur && amount <= total) abs = true;
    const pages = abs ? amount - cur : amount;
    let problem = null;
    if (date > T) problem = 'Майбутні дні записати не можна.';
    else if (!pages) problem = 'Ти вже на цій сторінці.';
    else if (total && cur + pages > total) problem = `У книзі ${pagesText(total)} — лишилось ${pagesText(Math.max(0, total - cur))}.`;
    else if (cur + pages < 0) problem = 'Сторінка менша за нуль.';
    const to = cur + pages;
    const hb = pages > 0 ? readingHabit() : null;
    const parts = [
      `${pages >= 0 ? '+' : '−'}${pagesText(Math.abs(pages))} → с. ${num(Math.max(0, to))}${total ? ' з ' + num(total) : ''}`,
      relDay(date),
      hb ? `звичка «${hb.name}» теж` : null,
      shelfOf(book) === 'want' ? 'почнеш читати' : null,
      total && to >= total && !problem ? 'остання сторінка!' : null
    ].filter(Boolean);
    return {
      kind: 'book', label: 'Книга', icon: 'library', iconClass: 'ico-learning', title: book.title,
      parts, rec: { bookId: book.id, date, pages }, ok: !problem, problem, titleMatch, linkedHabit: hb ? hb.id : null
    };
  }
  /** Застосувати варіант «Книга» (тост «Змінити · Скасувати»). */
  async function quickApply(o) {
    if (!o || !o.rec) return null;
    const res = await addEntry(o.rec.bookId, { date: o.rec.date, pages: o.rec.pages });
    if (!res) return null;
    toastEntry(res, [{ label: 'Змінити', onClick: () => openBook(o.rec.bookId) }]);
    return res;
  }

  // ---------- Реєстрація ----------
  CRM.router.register('books', { title: 'Книги', stores: ['books', 'habits'], render });

  CRM.books = {
    SHELVES, COLORS, all, get, shelfOf, shelfLabel, onShelf, currentPage, progress, pagesBetween, pace, eta, readInYear,
    readingHabit, addEntry, removeEntry, updateEntry, logPages, setShelf, setRating, setNotes, addQuote, updateQuote, removeQuote,
    allQuotes, quoteFor, quoteSource, subText, openForm, openBook, openLog, openQuoteForm, homeCard, quickOption, quickApply, canSave, readLog
  };
})(window.CRM);
