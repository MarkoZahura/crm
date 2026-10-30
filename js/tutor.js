/* ==========================================================================
   tutor.js — розділ «Репетиторство» (пункт 3, етап 1): учні, розклад уроків
   у «Календарі», плани й записи уроків з Google-таблиці «Репетиторство»,
   звіт для батьків після уроку («Копіювати», «Telegram», «Надіслати…»),
   блок «Уроки сьогодні» на Головній, дзвіночок «Надіслати звіт».

   • Учень — запис сховища students; його картка з контактами — у «Людях»
     (personId; група «Учні»), батьки — окремі люди (reportTo — кому йде звіт).
   • Уроки — звичайні події «Календаря» з полем studentId: серія на кожен рядок
     розкладу («чт 14:00, 2 год») і разові уроки. Перенести — перетягуванням у
     Календарі, скасувати — у вікні уроку (повтор серії → skip, разовий → Кошик).
   • Google-таблиця лише ЧИТАЄТЬСЯ (Google Sheets API v4, spreadsheets.readonly,
     той самий вхід Google, що й «Календар», js/gcal.js). Аркуш «Планування»: рядок на
     учня — Ім'я | Рівень | Логіка | Підручники. Аркуш «Репетиторство»: блок із 5 рядків
     на учня — дати, «Що робили?», «ДЗ», «Що будем робити?» (= план НАСТУПНОГО уроку),
     «Статус оплати»; заняття — стовпцями (C, далі пари E:F, H:I…, значення в лівій
     клітинці). CRM ставить стовпці таблиці на уроки з Календаря: стовпець з датою — на
     урок того дня, без дати — по черзі (align). Тож план скасованого уроку сам переходить
     на наступний урок.
   • Учень без таблиці — ті самі поля (план, що робили, ДЗ, наступного разу) у CRM
     (lessons[дата]); при скасуванні CRM пропонує зсунути план на наступні уроки.

   Учень: { id, name, sheetName ('' — як імʼя), personId|null, reportTo: 'self'|'none'|id людини,
            color (id палітри), goal, examDate|null, notes, archived,
            lessons: { 'РРРР-ММ-ДД': { notes, sent (ISO)|null, plan, what, hw, next } } }
   Налаштування: tutor { sheetId, template } (синхронізується), tutorSheetCache (лише пристрій,
   не в експорті) — останнє прочитане з таблиці.
   Ключ нагадування: tutor:report:<учень>:<дата>
   Адреси: #/tutor (учні), #/tutor/lessons, #/tutor/<id учня>, ?lesson=<id учня>&date=<дата>[&report=1]
   ========================================================================== */
window.CRM = window.CRM || {};

(function (CRM) {
  'use strict';

  const { h, ui } = { h: CRM.ui.h, ui: CRM.ui };
  const D = CRM.date;
  const U = CRM.utils;
  const fmt = CRM.fmt;

  const SETTING = 'tutor';
  const CACHE = 'tutorSheetCache';
  const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets/';
  const PLAN_SHEET = 'Планування';
  const JOURNAL_SHEET = 'Репетиторство';
  const REFRESH_MS = 10 * 60 * 1000;   // таблиця перечитується раз на 10 хв
  const FRESH_MS = 2 * 60 * 1000;      // при відкритті розділу — якщо старіша за 2 хв
  const AHEAD = 120;                   // на скільки днів уперед показувати уроки
  const NEAR_DAYS = 3;                 // стовпець з датою підходить уроку ±3 дні (перенесли)
  const COLORS = ['teal', 'orange', 'violet', 'magenta', 'green', 'blue', 'red', 'brown', 'olive', 'aqua', 'yellow', 'slate'];
  const DURS = [45, 60, 90, 120, 150, 180, 210];
  const FIELDS = [
    { id: 'what', label: 'Що робили', ph: 'Що встигли на уроці' },
    { id: 'hw', label: 'Домашнє завдання', ph: 'H/w: …' },
    { id: 'next', label: 'Наступного разу', ph: 'План наступного уроку' }
  ];
  const DEFAULT_TEMPLATE = 'Урок англійської — {дата} ({тривалість})\n\nЩо робили: {що робили}\nДомашнє завдання: {домашнє}\nНаступного разу: {наступного разу}';
  const PH = [
    ['{імʼя}', 'name'], ["{ім'я}", 'name'], ['{дата}', 'date'], ['{тривалість}', 'dur'],
    ['{що робили}', 'what'], ['{домашнє}', 'hw'], ['{наступного разу}', 'next']
  ];

  // ---------- Дані ----------
  const get = (id) => { const x = id ? CRM.store.get('students', id) : null; return x && !x.deletedAt ? x : null; };
  const all = () => (CRM.db.SCHEMA.students ? CRM.store.list('students') : []).slice().sort((a, b) => (a.name || '').localeCompare(b.name || '', 'uk'));
  const active = () => all().filter((s) => !s.archived);
  const colorOf = (s) => CRM.dict.categoryColor(s && s.color ? s.color : 'teal');
  const lessonData = (s, date) => (s && s.lessons && s.lessons[date]) || {};
  const pad = (n) => String(n).padStart(2, '0');
  const isFile = () => location.protocol === 'file:';

  function canSave() {
    if (CRM.db.SCHEMA.students) return true;
    ui.toast('Браузер показує стару версію сайту з кешу — онови сторінку (Ctrl+F5), щоб вести учнів.', { type: 'error', duration: 9000 });
    return false;
  }
  async function save(rec) { return CRM.store.save('students', rec); }
  function cfg() { return Object.assign({ sheetId: '', template: '' }, CRM.store.getSetting(SETTING, null) || {}); }
  async function setCfg(changes) { await CRM.store.setSetting(SETTING, Object.assign(cfg(), changes)); }
  function cache() {
    const c = CRM.store.getSetting(CACHE, null);
    return c && c.blocks && c.sheetId && c.sheetId === cfg().sheetId ? c : null;
  }
  function nextColor() {
    const used = new Set(active().map((s) => s.color));
    return COLORS.find((c) => !used.has(c)) || COLORS[all().length % COLORS.length];
  }
  function person(id) { return id && CRM.people ? CRM.people.get(id) : null; }
  function personOf(s) { return person(s && s.personId); }
  /** Кому надсилати звіт: людина з «Людей» | null; s.reportTo — 'self' (сам учень), 'none' або id людини. */
  function reportPerson(s) {
    if (!s || s.reportTo === 'none') return null;
    if (s.reportTo && s.reportTo !== 'self') return person(s.reportTo);
    return personOf(s);
  }
  const wantsReport = (s) => !!s && s.reportTo !== 'none';

  function minOf(t) { const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; }
  function hhmm(v) { return pad(Math.floor(v / 60)) + ':' + pad(v % 60); }
  function durText(min) {
    const m = Math.round(Number(min) || 0);
    if (!m) return '';
    const hh = Math.floor(m / 60);
    const mm = m % 60;
    if (!hh) return `${mm} хв`;
    if (!mm) return `${hh} год`;
    if (mm === 30) return `${hh},5 год`;
    return `${hh} год ${mm} хв`;
  }
  function dayShort(d) { return `${CRM.WEEKDAYS_SHORT[D.weekday(d)]}, ${fmt.dateShort(d)}`; }
  /** «Сьогодні» / «Завтра» / «Вчора» або «Чт, 30 жовтня». */
  function relDay(d) { const n = D.diffDays(D.today(), d); return n === 0 ? 'Сьогодні' : n === 1 ? 'Завтра' : n === -1 ? 'Вчора' : dayShort(d); }
  function dayLong(d) { return `${CRM.WEEKDAYS_SHORT[D.weekday(d)].toLowerCase()}, ${D.parse(d).d} ${CRM.MONTHS_GEN[D.parse(d).m - 1]}`; }
  function nowMin() { const p = D.kyivParts(); return p.hh * 60 + p.mm; }
  function oneLine(s, max) {
    const t = String(s || '').replace(/\s+/g, ' ').trim();
    return max && t.length > max ? t.slice(0, max - 1).trimEnd() + '…' : t;
  }

  // ---------- Таблиця: розбір (чисті функції) ----------
  /** Імʼя для зіставлення: нижній регістр, один апостроф, без зайвих пробілів. */
  function normName(s) { return U.normalize(s).replace(/['"«»]/g, ''); }
  /** 0 → A, 25 → Z, 26 → AA. */
  function colLetter(i) {
    let n = i + 1;
    let s = '';
    while (n > 0) { const r = (n - 1) % 26; s = String.fromCharCode(65 + r) + s; n = Math.floor((n - 1) / 26); }
    return s;
  }
  /** Текст клітинки: «-» і порожнє — нічого. */
  function cellText(v) {
    const s = String(v == null ? '' : v).replace(/\r\n?/g, '\n').trim();
    return /^[-–—\s.]*$/.test(s) ? '' : s;
  }
  /** «26.06.», «19.08», «05.11.2026», «5.11.26» → { d, m, y|null }. */
  function parseDayMonth(text) {
    const m = /^(\d{1,2})[./](\d{1,2})(?:[./](\d{2}|\d{4}))?\.?$/.exec(String(text || '').trim());
    if (!m) return null;
    const d = Number(m[1]);
    const mo = Number(m[2]);
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    let y = m[3] ? Number(m[3]) : null;
    if (y != null && y < 100) y += 2000;
    if (y != null && d > D.daysInMonth(y, mo)) return null;
    return { d, m: mo, y };
  }
  /**
   * Дати без року: стовпці йдуть по черзі, тож рік — від останньої дати назад
   * (остання — найближча до сьогодні, не далі ніж ~2 місяці вперед).
   */
  function assignYears(cols, today) {
    const T = today || D.today();
    const ty = D.parse(T).y;
    const dated = cols.filter((c) => c.dm);
    let year = null;
    for (let k = dated.length - 1; k >= 0; k--) {
      const c = dated[k];
      if (c.dm.y) year = c.dm.y;
      else if (year == null) {
        let best = null;
        [ty - 1, ty, ty + 1].forEach((y) => {
          if (c.dm.d > D.daysInMonth(y, c.dm.m)) return;
          const diff = D.diffDays(T, D.make(y, c.dm.m, c.dm.d));
          const score = diff > 75 ? 1e6 + diff : Math.abs(diff);
          if (!best || score < best.score) best = { y, score };
        });
        year = best ? best.y : ty;
      } else {
        const nx = dated[k + 1];
        if (nx && (c.dm.m > nx.dm.m || (c.dm.m === nx.dm.m && c.dm.d > nx.dm.d))) year -= 1;
      }
      const y = c.dm.y || year;
      c.date = c.dm.d <= D.daysInMonth(y, c.dm.m) ? D.make(y, c.dm.m, c.dm.d) : null;
      year = y;
    }
    cols.forEach((c) => { if (!c.dm) c.date = null; delete c.dm; });
    return cols;
  }
  /** Аркуш «Планування»: { імʼя: { name, level, logic, books } }. */
  function parsePlanning(rows) {
    const out = {};
    if (!Array.isArray(rows) || !rows.length) return out;
    const head = (rows[0] || []).map((x) => normName(x));
    const find = (re, def) => { const i = head.findIndex((x) => re.test(x)); return i >= 0 ? i : def; };
    const iName = find(/^ім/, 0);
    const iLevel = find(/^рів/, 1);
    const iLogic = find(/^лог/, 2);
    const iBooks = find(/^підруч/, 3);
    rows.slice(1).forEach((r) => {
      const name = cellText((r || [])[iName]);
      if (!name) return;
      out[normName(name)] = { name, level: cellText(r[iLevel]), logic: cellText(r[iLogic]), books: cellText(r[iBooks]) };
    });
    return out;
  }
  /**
   * Аркуш «Репетиторство»: блоки учнів. Блок — рядок дат (імʼя у стовпці A), під ним
   * «Що робили?», «ДЗ», «Що будем робити?», «Статус оплати» (підписи — у стовпці B).
   * → { імʼя: { name, row (рядок дат, 1-based), whatRow, cols: [{ c, a1, dateText, date, what, hw, next }] } }
   */
  function parseJournal(rows, today) {
    const out = {};
    if (!Array.isArray(rows)) return out;
    const lab = (r) => normName((rows[r] || [])[1]);
    for (let r = 1; r < rows.length; r++) {
      if (!/^що робил/.test(lab(r))) continue;
      const name = cellText((rows[r - 1] || [])[0]);
      if (!name) continue;
      const findRow = (re, def) => { for (let k = r + 1; k <= r + 4 && k < rows.length; k++) if (re.test(lab(k))) return k; return def; };
      const hwR = findRow(/^(дз|д\/з|домашн)/, r + 1);
      const nextR = findRow(/^що буде/, r + 2);
      const dates = rows[r - 1] || [];
      const line = (k) => rows[k] || [];
      const set = new Set();
      [r, hwR, nextR].forEach((k) => line(k).forEach((v, c) => { if (c >= 2 && cellText(v)) set.add(c); }));
      dates.forEach((v, c) => { if (c >= 2 && cellText(v)) set.add(c); });
      if (cellText(dates[1])) set.add(2);
      const cs = Array.from(set).sort((a, b) => a - b);
      const cols = cs.map((c) => {
        const dateText = cellText(dates[c]) || (!set.has(c - 1) && c - 1 >= 1 ? cellText(dates[c - 1]) : '');
        return { c, a1: colLetter(c), dateText, dm: parseDayMonth(dateText), what: cellText(line(r)[c]), hw: cellText(line(hwR)[c]), next: cellText(line(nextR)[c]) };
      });
      assignYears(cols, today);
      const key = normName(name);
      if (!out[key]) out[key] = { name, row: r, whatRow: r, cols };   // row — номер рядка дат (з 1), whatRow — індекс рядка «Що робили?» (з 0)
    }
    return out;
  }
  /** Весь знімок таблиці для кешу. */
  function parseSheet(sheetId, meta, ranges, today) {
    const sheets = ((meta && meta.sheets) || []).map((x) => x.properties || {});
    const byTitle = (t) => sheets.find((p) => normName(p.title) === normName(t));
    const plan = byTitle(PLAN_SHEET);
    const journal = byTitle(JOURNAL_SHEET);
    const vr = (title) => {
      const r = (ranges || []).find((x) => x && typeof x.range === 'string' && normName(x.range.replace(/^'?(.*?)'?!.*$/, '$1')) === normName(title));
      return (r && r.values) || [];
    };
    return {
      at: new Date().toISOString(), sheetId, title: (meta && meta.properties && meta.properties.title) || '',
      gidPlan: plan ? plan.sheetId : null, gidJournal: journal ? journal.sheetId : null,
      hasPlan: !!plan, hasJournal: !!journal,
      plan: plan ? parsePlanning(vr(PLAN_SHEET)) : {},
      blocks: journal ? parseJournal(vr(JOURNAL_SHEET), today) : {}
    };
  }
  /** Посилання або ID таблиці → ID. */
  function sheetIdFrom(input) {
    const s = String(input || '').trim();
    const m = /\/spreadsheets\/d\/([a-zA-Z0-9_-]{20,})/.exec(s);
    if (m) return m[1];
    return /^[a-zA-Z0-9_-]{20,}$/.test(s) ? s : '';
  }
  function sheetUrl(gid, a1) {
    const id = cfg().sheetId;
    if (!id) return null;
    const frag = gid != null ? `#gid=${gid}${a1 ? '&range=' + a1 : ''}` : '';
    return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(id)}/edit${frag}`;
  }
  /** Блок учня в таблиці (або null). */
  function blockOf(s) {
    const c = cache();
    if (!c || !s) return null;
    return c.blocks[normName(s.sheetName || s.name)] || null;
  }
  function planningOf(s) {
    const c = cache();
    if (!c || !s) return null;
    return c.plan[normName(s.sheetName || s.name)] || null;
  }
  /** Учень звʼязаний з таблицею (є посилання й блок з таким імʼям). */
  const linked = (s) => !!blockOf(s);

  // ---------- Таблиця: читання (Google Sheets API v4, лише читання) ----------
  let loading = null;
  let lastError = null;   // { code, text }
  function err(code, text) { const e = new Error(text || code); e.code = code; return e; }
  function changed() { document.dispatchEvent(new CustomEvent('crm:tutorsheet')); }
  function token() { return CRM.gcal && CRM.gcal.accessToken ? CRM.gcal.accessToken('sheets') : null; }

  /** off | file | no-google | need-access | loading | error | ok */
  function sheetStatus() {
    if (!cfg().sheetId) return 'off';
    if (isFile()) return 'file';
    if (!CRM.gcal || !((CRM.store.getSetting('gcal', null) || {}).clientId)) return 'no-google';
    if (loading) return 'loading';
    if (!token()) return 'need-access';
    if (lastError) return 'error';
    return cache() ? 'ok' : 'loading';
  }

  async function api(path, params) {
    const t = token();
    if (!t) throw err('no-token', 'Потрібен доступ Google до таблиць.');
    const qs = params && params.length ? '?' + params.map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v)).join('&') : '';
    let res;
    try {
      res = await fetch(SHEETS_API + path + qs, { headers: { Authorization: 'Bearer ' + t } });
    } catch (e) {
      throw err('network', 'Немає звʼязку з Google — покажу збережене, спробую пізніше.');
    }
    if (res.status === 401) {
      if (CRM.gcal.dropToken) await CRM.gcal.dropToken();
      throw err('no-token', 'Доступ Google сплив.');
    }
    if (!res.ok) {
      let msg = '';
      let reason = '';
      try {
        const j = await res.json();
        msg = (j.error && j.error.message) || '';
        reason = JSON.stringify((j.error && (j.error.details || j.error.errors || j.error.status)) || '');
      } catch (e) { /* не JSON */ }
      if (res.status === 403 && (/SERVICE_DISABLED|accessNotConfigured/.test(reason) || /has not been used|is disabled/i.test(msg))) {
        throw err('api-disabled', 'У Google Cloud не ввімкнено Google Sheets API. Увімкни його (README, розділ «Репетиторство») і натисни «Оновити з таблиці».');
      }
      if (res.status === 403 && /insufficient/i.test(msg + reason)) throw err('scope', 'Бракує дозволу читати таблиці — натисни «Дозволити читати таблицю».');
      if (res.status === 403) throw err('denied', 'Google не дає доступу до цієї таблиці. Перевір, що вона відкривається в тому самому акаунті Google, що й у CRM.');
      if (res.status === 404) throw err('not-found', 'Таблицю не знайдено — перевір посилання.');
      if (res.status === 429) throw err('rate', 'Google тимчасово обмежив кількість запитів — спробую пізніше.');
      throw err('http', `Google відповів помилкою ${res.status}${msg ? ': ' + msg : ''}`);
    }
    return res.json();
  }

  /** Прочитати таблицю (метадані + два аркуші) і зберегти знімок. */
  function refresh(opts) {
    const o = opts || {};
    const id = cfg().sheetId;
    if (!id || isFile() || !token()) return Promise.resolve(false);
    if (loading) return loading;
    loading = (async () => {
      await null;   // спершу запамʼятати «читаю», потім повідомити сторінки (інакше перемальовування знову почне читання)
      changed();
      try {
        const meta = await api(encodeURIComponent(id), [['fields', 'properties.title,sheets.properties(sheetId,title)']]);
        const titles = ((meta && meta.sheets) || []).map((x) => (x.properties || {}).title).filter(Boolean);
        const want = [PLAN_SHEET, JOURNAL_SHEET].map((t) => titles.find((x) => normName(x) === normName(t))).filter(Boolean);
        if (!want.some((t) => normName(t) === normName(JOURNAL_SHEET))) {
          throw err('no-sheet', `У таблиці немає аркуша «${JOURNAL_SHEET}» — CRM шукає саме таку назву (аркуші: ${titles.map((t) => '«' + t + '»').join(', ') || 'немає'}).`);
        }
        const vals = await api(encodeURIComponent(id) + '/values:batchGet',
          want.map((t) => ['ranges', `'${t.replace(/'/g, "''")}'`]).concat([['majorDimension', 'ROWS'], ['valueRenderOption', 'FORMATTED_VALUE']]));
        const snap = parseSheet(id, meta, (vals && vals.valueRanges) || []);
        lastError = null;
        await CRM.store.setSetting(CACHE, snap);
        if (o.toast) ui.toast(`Таблицю оновлено: ${Object.keys(snap.blocks).length} ${fmt.plural(Object.keys(snap.blocks).length, ['учень', 'учні', 'учнів'])}`, { type: 'success' });
        return true;
      } catch (e) {
        lastError = { code: e.code || 'http', text: e.message, at: Date.now() };
        if (o.toast && e.code !== 'no-token') ui.toast(lastError.text, { type: 'error', duration: 9000 });
        return false;
      } finally {
        loading = null;
        changed();
      }
    })();
    return loading;
  }
  /** Перечитати, якщо знімок старіший за ms (тихо). */
  function ensureFresh(ms) {
    const c = cache();
    if (c && Date.now() - Date.parse(c.at) < (ms || FRESH_MS)) return;
    if (lastError && lastError.at && Date.now() - lastError.at < 60000) return;
    refresh();
  }
  /** Кнопка «Дозволити читати таблицю» / «Оновити підключення»: вікно Google, потім читання. */
  async function grantAccess() {
    if (!CRM.gcal) return false;
    const st = CRM.gcal.status();
    if (st === 'no-client') { ui.toast('Спершу вкажи Client ID Google у «Моєму кабінеті» — таблиця використовує те саме підключення, що й Календар.', { type: 'error', duration: 8000 }); CRM.router.go('profile', { focus: 'gcal' }); return false; }
    const ok = await CRM.gcal.connect(st === 'disconnected' ? { quiet: true } : { refresh: true, quiet: true });
    if (!ok) return false;
    if (!token()) {
      lastError = { code: 'scope', text: 'Google не дав доступу до таблиць. Натисни ще раз і залиш позначку біля «Переглядати таблиці Google».' };
      changed();
      ui.toast(lastError.text, { type: 'error', duration: 9000 });
      return false;
    }
    if (loading) return loading;
    const c = cache();
    if (c && Date.now() - Date.parse(c.at) < 15000 && !lastError) return true;   // уже прочитано після входу (crm:googletoken)
    return refresh({ toast: true });
  }
  /** Скільки часу тому оновлено знімок. */
  function cacheAge() {
    const c = cache();
    if (!c) return '';
    const p = D.kyivParts(new Date(c.at));
    const day = D.make(p.y, p.m, p.d);
    return (day === D.today() ? 'сьогодні о ' : fmt.dateShort(day) + ' о ') + pad(p.hh) + ':' + pad(p.mm);
  }

  // ---------- Уроки (події Календаря з studentId) ----------
  function lessonEvents(sid) {
    return CRM.store.list('events').filter((e) => e.studentId && (!sid || e.studentId === sid));
  }
  /** Уроки в [from, to]: [{ sid, date, start, dur, startMin, endMin, ev, series, occ }] за часом. */
  function lessonsBetween(from, to, sid) {
    if (!CRM.calendar || !CRM.calendar.occurrences) return [];
    return CRM.calendar.occurrences(from, to)
      .filter(({ ev }) => ev.studentId && (!sid || ev.studentId === sid) && get(ev.studentId))
      .map(({ ev, date, series }) => {
        const startMin = ev.allDay || !ev.start ? null : minOf(ev.start);
        const dur = Number(ev.dur) > 0 ? Number(ev.dur) : 60;
        return {
          sid: ev.studentId, date, start: startMin == null ? null : ev.start, dur, startMin,
          endMin: startMin == null ? null : Math.min(1440, startMin + dur), ev, series: series || null, occ: ev.occ || null, evId: ev.id
        };
      })
      .sort((a, b) => a.date.localeCompare(b.date) || (a.startMin || 0) - (b.startMin || 0));
  }
  function firstLessonDate(sid) {
    let d = null;
    lessonEvents(sid).forEach((e) => { if (D.isDate(e.date) && (!d || e.date < d)) d = e.date; });
    return d;
  }
  function lessonsOf(sid, to) {
    const from = firstLessonDate(sid);
    if (!from) return [];
    return lessonsBetween(from, to || D.addDays(D.today(), AHEAD), sid);
  }
  function lessonOn(sid, date) { return lessonsBetween(date, date, sid)[0] || null; }
  /** Урок почався (або вже минув). */
  function started(L, T, nm) {
    const today = T || D.today();
    if (L.date < today) return true;
    if (L.date > today) return false;
    return L.startMin == null || (nm == null ? nowMin() : nm) >= L.startMin;
  }
  function ended(L, T, nm) {
    const today = T || D.today();
    if (L.date < today) return true;
    if (L.date > today) return false;
    return L.endMin == null || (nm == null ? nowMin() : nm) >= L.endMin;
  }

  // ---------- Уроки, які є ще й у Google Календарі («Заняття Макс») ----------
  const LESSON_WORD = /(занят|урок|англ|lesson|english|ielts|репетит)/i;
  const WORD_SPLIT = /[^0-9a-zа-яґєії'ʼ’]+/i;
  /** Слова імені учня в усіх відмінках (з «Імені в таблиці» теж). */
  function nameWords(s) {
    const out = new Set();
    [s.name, s.sheetName].forEach((n) => String(n || '').split(WORD_SPLIT).forEach((w) => {
      const x = U.normalize(w);
      if (x.length < 3) return;
      out.add(x);
      if (CRM.people && CRM.people.nameForms) CRM.people.nameForms(x).forEach((f) => out.add(f));
    }));
    return out;
  }
  let wordsCache = { key: '', map: null };
  /** Учень, чиє імʼя є в назві події (одне слово — будь-який відмінок), або null. */
  function studentOfTitle(title) {
    const list = active();
    const key = list.map((x) => x.id + ':' + x.name + ':' + (x.sheetName || '')).join('|');
    if (wordsCache.key !== key) wordsCache = { key, map: list.map((x) => ({ s: x, w: nameWords(x) })) };
    const words = String(title || '').split(WORD_SPLIT).map((w) => U.normalize(w)).filter(Boolean);
    const hit = wordsCache.map.find((x) => words.some((w) => x.w.has(w)));
    return hit ? get(hit.s.id) || hit.s : null;   // свіжий запис (кеш слів — лише за іменами)
  }
  function gMin(iso) { const p = D.kyivParts(new Date(iso)); return p.hh * 60 + p.mm; }
  /**
   * Подія Google — копія уроку з CRM: в назві імʼя учня, того самого дня в CRM є його урок,
   * і в назві є «Заняття» / «Урок» … або час перетинається з уроком. Такі події CRM не показує (без дублів).
   * index — необовʼязково, з dupIndex(from, to) (щоб не рахувати уроки для кожної події окремо).
   */
  function isGoogleDuplicate(g, date, index) {
    if (!g || g.allDay || !D.isDate(date) || !all().length) return false;
    const s = studentOfTitle(g.title);
    if (!s) return false;
    const list = index ? (index.get(date + '|' + s.id) || []) : lessonsBetween(date, date, s.id);
    if (!list.length) return false;
    if (LESSON_WORD.test(g.title)) return true;
    const a = D.toKyivDate(g.start) === date ? gMin(g.start) : 0;
    const b = D.toKyivDate(g.end) === date ? gMin(g.end) : 1440;
    return list.some((L) => L.startMin != null && a < L.endMin && b > L.startMin);
  }
  /** Уроки CRM за проміжок: «дата|учень» → [уроки] — для isGoogleDuplicate. */
  function dupIndex(from, to) {
    const m = new Map();
    if (!all().length) return m;
    lessonsBetween(from, to).forEach((L) => { const k = L.date + '|' + L.sid; if (!m.has(k)) m.set(k, []); m.get(k).push(L); });
    return m;
  }
  /** Розклад учня з Google Календаря (завантажені події «Заняття Лука»): [{ days, start, dur }] — найчастіший час для кожного дня. */
  function googleSlots(s) {
    if (!s || !CRM.gcal || !CRM.gcal.eventsBetween) return [];
    const T = D.today();
    let evs = [];
    try { evs = CRM.gcal.eventsBetween(D.addDays(T, -7), D.addDays(T, 62)); } catch (e) { return []; }
    const byDay = new Map();
    evs.forEach((g) => {
      if (g.allDay || !LESSON_WORD.test(g.title)) return;
      const who = studentOfTitle(g.title);
      if (!who || who.id !== s.id) return;
      const d = D.toKyivDate(g.start);
      const start = hhmm(gMin(g.start));
      const dur = Math.max(15, Math.round((Date.parse(g.end) - Date.parse(g.start)) / 60000));
      const wd = D.weekday(d);
      if (!byDay.has(wd)) byDay.set(wd, new Map());
      const k = start + '|' + dur;
      byDay.get(wd).set(k, (byDay.get(wd).get(k) || 0) + 1);
    });
    const best = [];
    byDay.forEach((m, wd) => {
      const top = Array.from(m.entries()).sort((a, b) => b[1] - a[1])[0];
      if (top[1] < 2) return;   // один раз за ~2 місяці — разовий урок, не розклад
      const [start, dur] = top[0].split('|');
      best.push({ day: wd, start, dur: Number(dur) });
    });
    const out = [];
    best.sort((a, b) => a.day - b.day).forEach((x) => {
      const same = out.find((o) => o.start === x.start && o.dur === x.dur);
      if (same) same.days.push(x.day); else out.push({ days: [x.day], start: x.start, dur: x.dur });
    });
    return out;
  }
  function googleSlotText(sl) {
    return `${sl.days.map((d) => CRM.WEEKDAYS_SHORT[d]).join(', ')} ${sl.start}–${hhmm(Math.min(1440, minOf(sl.start) + sl.dur))}`;
  }
  /** «Створити такий розклад, як у Google»: серії з сьогодні. */
  async function slotsFromGoogle(sid) {
    const s = get(sid);
    const list = googleSlots(s);
    if (!s || !list.length || !canSave()) return [];
    const T = D.today();
    const saved = [];
    for (const sl of list) {
      saved.push(await CRM.store.save('events', {
        title: lessonTitle(s.name), date: firstOn(sl.days, T), allDay: false, start: sl.start, dur: sl.dur, cat: lessonCat(), remind: 15, note: '',
        repeat: { freq: 'week', every: 1, days: sl.days.slice().sort(), until: null, count: null }, skip: [], overrides: {}, studentId: s.id
      }));
    }
    ui.toast(`Розклад як у Google: ${list.map(googleSlotText).join('; ')}. Події «${s.name}» з Google тепер не дублюються.`, {
      type: 'success', duration: 9000,
      action: { label: 'Скасувати', onClick: () => CRM.store.removeManyForever('events', saved.map((x) => x.id)) }
    });
    return saved;
  }

  // ---------- Стовпці таблиці ↔ уроки ----------
  /**
   * Поставити стовпці таблиці на уроки. cols: [{ date|null, what }], lessons: [{ date, started }] (обидва по черзі).
   * Стовпець з датою — на урок того самого дня (або ±3 дні, якщо урок перенесли); без дати — по черзі між ними.
   * Стовпець, де вже записано «Що робили?», не стає на урок, що ще не почався.
   * → { colL: [номер уроку | null], lesC: [номер стовпця | null], virtual: номер уроку | null }
   *   virtual — урок одразу після останнього стовпця: його план — «Що будем робити?» останнього стовпця.
   */
  function align(cols, lessons) {
    const n = cols.length;
    const m = lessons.length;
    const colL = new Array(n).fill(null);
    const lesC = new Array(m).fill(null);
    const link = (j, i) => { colL[j] = i; lesC[i] = j; };
    const near = (a, b) => Math.abs(D.diffDays(a, b)) <= NEAR_DAYS;
    // 1) Точні збіги дат (по черзі)
    const pins = [];
    let from = 0;
    for (let j = 0; j < n; j++) {
      const d = cols[j].date;
      if (!d) continue;
      let k = from;
      while (k < m && lessons[k].date < d) k++;
      if (k < m && lessons[k].date === d && !(cols[j].what && !lessons[k].started)) { link(j, k); pins.push([j, k]); from = k + 1; }
    }
    const nextDated = (j, j1) => { for (let k = j + 1; k < j1; k++) if (cols[k].date) return cols[k].date; return null; };
    const prevDated = (j, j0) => { for (let k = j - 1; k >= j0; k--) if (cols[k].date) return cols[k].date; return null; };
    function forward(j0, j1, i0, i1) {
      let j = j0;
      let i = i0;
      while (j < j1 && i < i1) {
        const c = cols[j];
        const L = lessons[i];
        if (c.what && !L.started) { j++; continue; }
        if (c.date) {
          if (near(c.date, L.date)) { link(j, i); j++; i++; } else if (c.date < L.date) j++; else i++;
        } else {
          const nd = nextDated(j, j1);
          if (nd && nd < L.date && !near(nd, L.date)) { j++; continue; }
          link(j, i); j++; i++;
        }
      }
    }
    function backward(j0, j1, i0, i1) {
      let j = j1 - 1;
      let i = i1 - 1;
      while (j >= j0 && i >= i0) {
        const c = cols[j];
        const L = lessons[i];
        if (c.what && !L.started) { i--; continue; }
        if (c.date) {
          if (near(c.date, L.date)) { link(j, i); j--; i--; } else if (c.date > L.date) j--; else i--;
        } else {
          const pd = prevDated(j, j0);
          if (pd && pd > L.date && !near(pd, L.date)) { j--; continue; }
          link(j, i); j--; i--;
        }
      }
    }
    if (!pins.length) forward(0, n, 0, m);
    else {
      backward(0, pins[0][0], 0, pins[0][1]);
      for (let k = 0; k < pins.length - 1; k++) forward(pins[k][0] + 1, pins[k + 1][0], pins[k][1] + 1, pins[k + 1][1]);
      const last = pins[pins.length - 1];
      forward(last[0] + 1, n, last[1] + 1, m);
    }
    // 2) Урок після останнього стовпця
    let virtual = null;
    if (n) {
      let lastL = -1;
      lesC.forEach((j, i) => { if (j != null) lastL = i; });
      if (colL[n - 1] != null) virtual = colL[n - 1] + 1 < m ? colL[n - 1] + 1 : null;
      else if (cols[n - 1].what) {
        for (let i = lastL + 1; i < m; i++) if (!lessons[i].started) { virtual = i; break; }
      }
      if (virtual != null && lesC[virtual] != null) virtual = null;
    }
    return { colL, lesC, virtual };
  }

  /**
   * Усі уроки учня з даними: [{ key, date, start, dur, lesson|null, col|null, plan, what, hw, next, fromSheet, virtual }]
   * по черзі: уроки з Календаря + стовпці таблиці без уроку (історія до CRM).
   */
  function timeline(s) {
    const T = D.today();
    const nm = nowMin();
    const lessons = lessonsOf(s.id).map((L) => Object.assign(L, { started: started(L, T, nm) }));
    const block = blockOf(s);
    const out = [];
    const ownEntry = (L) => {
      const x = lessonData(s, L.date);
      return { key: 'L:' + L.date, date: L.date, start: L.start, dur: L.dur, lesson: L, col: null, plan: x.plan || '', what: x.what || '', hw: x.hw || '', next: x.next || '', fromSheet: false };
    };
    if (!block) { lessons.forEach((L) => out.push(ownEntry(L))); return { entries: out, block: null }; }
    const cols = block.cols;
    const a = align(cols, lessons);
    const entryOf = (L, j) => {
      const c = j == null ? null : cols[j];
      const prev = j == null ? null : j > 0 ? cols[j - 1] : null;
      return {
        key: L ? 'L:' + L.date : 'C:' + c.a1, date: L ? L.date : c.date, start: L ? L.start : null, dur: L ? L.dur : null,
        lesson: L || null, col: c, colPrev: prev, plan: prev ? prev.next : '', what: c ? c.what : '', hw: c ? c.hw : '', next: c ? c.next : '', fromSheet: true
      };
    };
    const used = new Set();
    let li = 0;
    const flushLessons = (until) => {
      while (li < lessons.length && (until == null || li < until)) {
        if (a.lesC[li] == null) {
          if (li === a.virtual) {
            const last = cols[cols.length - 1];
            out.push({ key: 'L:' + lessons[li].date, date: lessons[li].date, start: lessons[li].start, dur: lessons[li].dur, lesson: lessons[li], col: null, colPrev: last, plan: last.next, what: '', hw: '', next: '', fromSheet: true, virtual: true });
          } else {
            out.push(Object.assign(entryOf(lessons[li], null), { colPrev: null }));
          }
        }
        li++;
      }
    };
    cols.forEach((c, j) => {
      const i = a.colL[j];
      if (i != null) {
        flushLessons(i);
        out.push(entryOf(lessons[i], j));
        used.add(i);
        li = Math.max(li, i + 1);
      } else {
        if (c.date) { while (li < lessons.length && lessons[li].date < c.date) flushLessons(li + 1); }
        out.push(entryOf(null, j));
      }
    });
    flushLessons(null);
    return { entries: out, block };
  }
  /** Дані одного уроку учня (дата — день уроку) або стовпця таблиці (key 'C:…'). */
  function entryFor(s, key) {
    return timeline(s).entries.find((e) => e.key === key) || null;
  }
  /** Що піде у звіт «Що робили»: записане, а якщо ще порожньо — план. */
  const whatOrPlan = (e) => e.what || e.plan || '';

  // ---------- Запис даних уроку (нотатки, «надіслано», власний план) ----------
  async function setLessonData(sid, date, changes) {
    const s = get(sid);
    if (!s || !D.isDate(date)) return null;
    const lessons = Object.assign({}, s.lessons || {});
    const cur = Object.assign({}, lessons[date] || {}, changes);
    Object.keys(cur).forEach((k) => { if (cur[k] == null || cur[k] === '') delete cur[k]; });
    if (Object.keys(cur).length) lessons[date] = cur; else delete lessons[date];
    return save(Object.assign({}, s, { lessons }));
  }
  const sentAt = (s, date) => lessonData(s, date).sent || null;
  async function markSent(sid, date, on) {
    const before = sentAt(get(sid), date);
    await setLessonData(sid, date, { sent: on ? new Date().toISOString() : null });
    return async () => { await setLessonData(sid, date, { sent: before }); };
  }
  function sentText(iso) {
    const p = D.kyivParts(new Date(iso));
    const day = D.make(p.y, p.m, p.d);
    return `${day === D.today() ? 'сьогодні' : fmt.dateShort(day)} о ${pad(p.hh)}:${pad(p.mm)}`;
  }

  // ---------- Звіт для батьків ----------
  function template() { return String(cfg().template || '').trim() || DEFAULT_TEMPLATE; }
  /** Підставити значення в шаблон; рядок з порожнім «що робили / домашнє / наступного разу» — прибрати. */
  function fillTemplate(tpl, v) {
    const lines = String(tpl || '').replace(/\r\n?/g, '\n').split('\n').map((line) => {
      let drop = false;
      let out = line;
      PH.forEach(([ph, k]) => {
        if (!out.includes(ph)) return;
        const val = String(v[k] == null ? '' : v[k]).trim();
        if (!val && ['what', 'hw', 'next'].includes(k)) drop = true;
        out = out.split(ph).join(val);
      });
      return drop ? null : out.replace(/\s*\(\s*\)/g, '');
    }).filter((x) => x !== null);
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  function reportText(s, e) {
    return fillTemplate(template(), {
      name: s.name, date: e.date ? dayLong(e.date) : '', dur: e.dur ? durText(e.dur) : '',
      what: whatOrPlan(e), hw: e.hw, next: e.next
    });
  }
  async function copyText(text, area) {
    try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(text); return true; } } catch (e) { /* далі — запасний спосіб */ }
    try {
      if (!area) return false;
      area.focus();
      area.select();
      return document.execCommand('copy');
    } catch (e) { return false; }
  }

  /** Вікно «Звіт»: текст із шаблону → «Копіювати», «Telegram», на телефоні «Надіслати…»; після — «надіслано». */
  function openReport(sid, key) {
    const s = get(sid);
    if (!s) { ui.toast('Цього учня більше немає', { type: 'error' }); return null; }
    const e = entryFor(s, key);
    if (!e) { ui.toast('Цього уроку більше немає', { type: 'error' }); return null; }
    const to = reportPerson(s);
    const area = ui.textarea({ value: reportText(s, e), rows: 10, maxlength: 6000, class: 'textarea tu-report-text', 'aria-label': 'Текст звіту' });
    const tgA = h('a', { class: 'btn tu-tg', target: '_blank', rel: 'noopener noreferrer' }, CRM.icon('send'), h('span', { class: 'btn-label' }, 'Telegram'));
    const link = () => (to && CRM.people && CRM.people.tgLink ? CRM.people.tgLink(to, area.value) : null);
    function syncTg() { const l = link(); if (l) tgA.href = l.href; }
    area.addEventListener('input', syncTg);
    const status = h('div', { class: 'tu-sent-line subtle' });
    function renderStatus() {
      const at = e.date ? sentAt(get(sid), e.date) : null;
      ui.mount(status, at
        ? [CRM.icon('checkCircle', { size: 'sm' }), h('span', null, `Надіслано ${sentText(at)}`),
          h('button', { type: 'button', class: 'link-like tu-unsend', onClick: async () => { await markSent(sid, e.date, false); renderStatus(); } }, 'Ще не надіслано')]
        : e.date ? [h('span', null, 'Ще не надіслано.'), h('button', { type: 'button', class: 'link-like tu-mark-sent', onClick: () => done('Позначено як надісланий') }, 'Я вже надіслав')] : []);
    }
    async function done(msg) {
      if (!e.date) { if (msg) ui.toast(msg, { type: 'success' }); return; }
      const undo = await markSent(sid, e.date, true);
      renderStatus();
      ui.toast(msg || 'Звіт позначено як надісланий', { type: 'success', action: { label: 'Скасувати', onClick: async () => { await undo(); renderStatus(); } } });
    }
    const l0 = link();
    const toLine = h('div', { class: 'tu-report-to' },
      h('span', { class: 'subtle' }, 'Кому: '),
      to ? h('strong', null, to.name) : h('span', null, s.reportTo === 'none' ? 'звіти цьому учневі не надсилаються' : 'не вибрано'),
      to && !l0 ? h('span', { class: 'subtle' }, ' — у картці немає Telegram чи телефону') : null,
      to && l0 && l0.byPhone ? h('span', { class: 'subtle' }, ' — Telegram за номером (якщо людина дозволила знаходити себе за номером)') : null,
      h('button', { type: 'button', class: 'link-like tu-report-who', onClick: () => { dlg.close('who'); openForm(s.id, { focus: 'report' }); } }, 'Змінити'));
    const copyBtn = ui.button({ label: 'Копіювати', icon: 'copy', className: 'tu-copy', onClick: async () => {
      const ok = await copyText(area.value, area);
      if (!ok) { ui.toast('Не вдалося скопіювати — виділи текст і натисни Ctrl+C', { type: 'error' }); return; }
      await done('Скопійовано — встав у месенджер. Позначено «надіслано».');
    } });
    tgA.addEventListener('click', () => { setTimeout(() => done('Відкрито Telegram — звіт позначено як надісланий'), 0); });
    const shareBtn = navigator.share ? ui.button({ label: 'Надіслати…', icon: 'external', className: 'tu-share', onClick: async () => {
      try { await navigator.share({ text: area.value }); await done('Звіт надіслано'); } catch (er) { /* скасовано */ }
    } }) : null;
    const body = h('div', { class: 'form-stack tu-report' },
      toLine,
      area,
      h('div', { class: 'field-hint' }, 'Текст можна підправити — зміни лише для цього повідомлення. Шаблон — «Налаштування» в «Репетиторстві».'),
      status);
    const dlg = ui.modal({
      title: `Звіт: ${s.name}${e.date ? ' — ' + dayLong(e.date) : ''}`, size: 'md', className: 'tu-report-modal', body,
      footer: [copyBtn, l0 ? tgA : null, shareBtn, ui.button({ label: 'Закрити', onClick: () => dlg.close('button') })].filter(Boolean),
      initialFocus: copyBtn
    });
    syncTg();
    renderStatus();
    return dlg;
  }

  // ---------- Вікно уроку ----------
  function statusChip(s, e) {
    const L = e.lesson;
    if (!L) return null;
    const T = D.today();
    const at = sentAt(s, L.date);
    if (at) return h('span', { class: 'badge badge-success tu-chip-sent' }, CRM.icon('check', { size: 'sm' }), 'звіт надіслано');
    if (ended(L) && wantsReport(s)) return h('span', { class: 'badge tu-chip-due' }, 'звіт не надіслано');
    if (L.date === T) return h('span', { class: 'badge tu-chip-today' }, started(L) ? 'іде зараз' : 'сьогодні');
    return null;
  }
  function whenLine(e) {
    if (!e.date) return 'без дати';
    const L = e.lesson;
    const t = L && L.startMin != null ? `, ${L.start}–${hhmm(L.endMin)} (${durText(L.dur)})` : '';
    return CRM.fmt.dateLong(e.date).replace(/^./, (c) => c.toUpperCase()) + t;
  }
  function textBlock(text, empty) {
    return text ? h('div', { class: 'tu-text' }, text) : h('div', { class: 'tu-text tu-empty subtle' }, empty);
  }

  /** Вікно уроку: план, що робили / ДЗ / наступного разу (з таблиці або свої), нотатки для себе, «Звіт». */
  function openLesson(sid, key) {
    const s0 = get(sid);
    if (!s0) { ui.toast('Цього учня більше немає', { type: 'error' }); return null; }
    let e = entryFor(s0, key);
    if (!e) { ui.toast('Цього уроку більше немає', { type: 'error' }); return null; }
    const date = e.date;
    const head = h('div', { class: 'tu-lesson-head' });
    const sheetBox = h('div', { class: 'tu-lesson-sheet' });
    const isLinked = linked(s0);
    const timers = {};
    function own(id, label, ph, value) {
      const ta = ui.textarea({ value: value || '', rows: id === 'plan' ? 3 : 2, maxlength: 4000, placeholder: ph, 'aria-label': label, class: 'textarea tu-own-' + id, dataset: { field: id } });
      ta.addEventListener('input', () => {
        clearTimeout(timers[id]);
        timers[id] = setTimeout(() => setLessonData(sid, date, { [id]: ta.value.trim() }), 500);
      });
      ta.addEventListener('blur', () => { clearTimeout(timers[id]); if (ta.value.trim() !== (lessonData(get(sid), date)[id] || '')) setLessonData(sid, date, { [id]: ta.value.trim() }); });
      return ui.field({ label, input: ta });
    }
    function renderHead() {
      const s = get(sid) || s0;
      ui.mount(head,
        h('div', { class: 'tu-when' }, CRM.icon('clock', { size: 'sm' }), h('span', null, whenLine(e)), statusChip(s, e)),
        !e.lesson ? h('div', { class: 'subtle tu-only-sheet' }, 'Запис з таблиці — цього уроку немає в Календарі.') : null);
    }
    function renderSheet() {
      if (!isLinked) return;
      const c = cache();
      const s = get(sid) || s0;
      const fresh = entryFor(s, key);
      if (fresh) e = fresh;
      const block = blockOf(s);
      const a1 = !block ? null : e.col ? `${e.col.a1}${block.whatRow + 1}` : `A${block.row}`;
      const st = sheetStatus();
      ui.mount(sheetBox,
        h('div', { class: 'tu-sec' },
          h('div', { class: 'tu-sec-title' }, 'План уроку'),
          textBlock(e.plan, e.lesson ? 'У таблиці для цього уроку плану немає («Що будем робити?» попереднього стовпця порожнє).' : '—')),
        h('div', { class: 'tu-sec' },
          h('div', { class: 'tu-sec-title' }, 'Після уроку'),
          FIELDS.map((f) => h('div', { class: 'tu-kv', dataset: { field: f.id } },
            h('div', { class: 'tu-k subtle' }, f.label),
            f.id === 'what' && !e.what && e.plan
              ? textBlock('', 'Ще не записано — у звіт піде план уроку.')
              : textBlock(e[f.id], '—')))),
        h('div', { class: 'tu-src subtle' },
          CRM.icon('file', { size: 'sm' }),
          h('span', null, e.col ? `З таблиці: стовпець ${e.col.a1}${e.col.dateText ? ' (' + e.col.dateText + ')' : ''}` : e.virtual ? 'План — з останнього стовпця таблиці' : 'У таблиці для цього уроку ще немає стовпця'),
          c ? h('span', null, ` · оновлено ${cacheAge()}`) : null,
          sheetUrl(c && c.gidJournal, a1) ? h('a', { href: sheetUrl(c.gidJournal, a1), target: '_blank', rel: 'noopener noreferrer', class: 'link-like tu-open-sheet' }, 'Відкрити в таблиці', CRM.icon('external', { size: 'sm' })) : null,
          st === 'need-access' ? h('button', { type: 'button', class: 'link-like', onClick: () => grantAccess() }, 'Оновити підключення')
            : h('button', { type: 'button', class: 'link-like tu-refresh', disabled: st === 'loading', onClick: () => refresh({ toast: true }) }, st === 'loading' ? 'Оновлюю…' : 'Оновити з таблиці')));
    }
    let ownBox = null;
    if (!isLinked && date) {
      const x = lessonData(s0, date);
      ownBox = h('div', { class: 'tu-own form-stack' },
        h('div', { class: 'subtle tu-own-note' }, cfg().sheetId ? `Учня «${s0.sheetName || s0.name}» немає в таблиці — записи ведуться тут, у CRM.` : 'Записи уроку — тут, у CRM (Google-таблицю можна підключити в «Налаштуваннях»).'),
        own('plan', 'План уроку', 'Що робимо на уроці', x.plan),
        FIELDS.map((f) => own(f.id, f.label, f.ph, x[f.id])));
    }
    let notesTimer = null;
    const notesIn = date ? ui.textarea({ value: lessonData(s0, date).notes || '', rows: 3, maxlength: 4000, placeholder: 'Типові помилки, що повторити… У звіт не йде.', 'aria-label': 'Нотатки для себе', class: 'textarea tu-notes' }) : null;
    if (notesIn) {
      notesIn.addEventListener('input', () => { clearTimeout(notesTimer); notesTimer = setTimeout(() => setLessonData(sid, date, { notes: notesIn.value.trim() }), 500); });
      notesIn.addEventListener('blur', () => { clearTimeout(notesTimer); if (notesIn.value.trim() !== (lessonData(get(sid), date).notes || '')) setLessonData(sid, date, { notes: notesIn.value.trim() }); });
    }
    // Вартість уроку й оплата (js/tutor-money.js)
    const moneyBox = CRM.tutorMoney && e.lesson ? CRM.tutorMoney.lessonBox(sid, key) : null;
    const body = h('div', { class: 'form-stack tu-lesson' },
      head,
      isLinked ? sheetBox : ownBox,
      moneyBox ? moneyBox.el : null,
      notesIn ? ui.field({ label: 'Нотатки для себе', input: notesIn }) : null);
    const L = e.lesson;
    const footer = [
      L ? ui.button({ label: 'Скасувати урок', icon: 'x', variant: 'danger-ghost', className: 'tu-cancel', onClick: async () => { const ok = await cancelLesson(sid, L.date); if (ok) dlg.close('cancel'); } }) : null,
      L && CRM.calendar ? ui.button({ label: 'Змінити в календарі', icon: 'calendar', variant: 'ghost', className: 'tu-edit-ev', onClick: () => { dlg.close('edit'); CRM.calendar.openEditor(L.evId, null, L.occ); } }) : null,
      ui.button({ label: 'Звіт', icon: 'send', variant: 'primary', className: 'tu-report-btn', onClick: () => { flush(); dlg.close('report'); openReport(sid, key); } })
    ].filter(Boolean);
    function flush() {
      Object.keys(timers).forEach((k) => clearTimeout(timers[k]));
      if (ownBox) ownBox.querySelectorAll('textarea[data-field]').forEach((ta) => setLessonData(sid, date, { [ta.dataset.field]: ta.value.trim() }));
      if (notesIn) { clearTimeout(notesTimer); setLessonData(sid, date, { notes: notesIn.value.trim() }); }
    }
    const onSheet = () => { renderSheet(); renderHead(); };
    document.addEventListener('crm:tutorsheet', onSheet);
    const off = CRM.store.on(['students', 'events'], () => { if (!get(sid)) { dlg.close('force'); return; } renderHead(); });
    const dlg = ui.modal({
      title: `${e.lesson ? 'Урок' : 'Запис уроку'}: ${s0.name}`, size: 'md', className: 'tu-lesson-modal', body, footer,
      initialFocus: 'container',
      onClose: () => { document.removeEventListener('crm:tutorsheet', onSheet); off(); flush(); if (moneyBox) moneyBox.destroy(); }
    });
    renderHead();
    renderSheet();
    if (isLinked) ensureFresh();
    return dlg;
  }
  /** Відкрити урок за датою (з Календаря, Головної, сповіщення). */
  function openLessonOn(sid, date, opts) {
    const s = get(sid);
    if (!s) { ui.toast('Цього учня більше немає', { type: 'error' }); return null; }
    if (opts && opts.report) return openReport(sid, 'L:' + date);
    return openLesson(sid, 'L:' + date);
  }

  // ---------- Скасувати урок ----------
  function hasPlanFields(x) { return !!(x && (x.plan || x.hw || x.next)); }
  /** Свої плани (учень без таблиці): з дня скасованого уроку зсунути на наступні уроки. */
  function shiftedLessons(s, fromDate, dates) {
    const lessons = U.deepClone(s.lessons || {});
    const keys = Object.keys(lessons).filter((d) => d >= fromDate && hasPlanFields(lessons[d])).sort();
    if (!keys.length) return null;
    const moved = keys.map((d) => { const x = lessons[d]; const p = { plan: x.plan, hw: x.hw, next: x.next }; delete x.plan; delete x.hw; delete x.next; return { d, p }; });
    moved.forEach((m, k) => {
      const target = dates[k] || m.d;
      lessons[target] = Object.assign({}, lessons[target] || {}, m.p);
    });
    Object.keys(lessons).forEach((d) => { Object.keys(lessons[d]).forEach((f) => { if (lessons[d][f] == null || lessons[d][f] === '') delete lessons[d][f]; }); if (!Object.keys(lessons[d]).length) delete lessons[d]; });
    return lessons;
  }
  async function cancelLesson(sid, date) {
    const s = get(sid);
    const L = lessonOn(sid, date);
    if (!s || !L) { ui.toast('Цього уроку більше немає', { type: 'error' }); return false; }
    if (!canSave()) return false;
    const ownPlans = !linked(s) && Object.keys(s.lessons || {}).some((d) => d >= date && hasPlanFields(s.lessons[d]));
    const box = ownPlans ? h('input', { type: 'checkbox', class: 'tu-shift-box', checked: true }) : null;
    // Етап 2 (js/tutor-money.js): пропуск, що оплачується, — урок зникає з Календаря, але рахується до оплати
    const TM = CRM.tutorMoney;
    const costText = TM && TM.hasPrice(s) && TM.mcfg(s).from <= date ? TM.money(TM.lessonCost(s, date, L.dur), TM.curOf(s)) : null;
    const msg = h('div', { class: 'form-stack' },
      h('p', { class: 'modal-text' }, TM
        ? `Урок ${dayLong(date)}${L.start ? ', ' + L.start : ''} зникне з Календаря.`
        : `Урок ${dayLong(date)}${L.start ? ', ' + L.start : ''} зникне з Календаря й не рахуватиметься.`),
      TM ? h('p', { class: 'modal-text subtle tu-cancel-how' }, '«Без оплати» — урок не рахується. «Пропуск — оплачується» — учень платить за нього',
        costText ? ` (${costText})` : '', ', у підсумку за місяць він буде «пропуском».') : null,
      linked(s) ? h('p', { class: 'modal-text subtle' }, 'План з таблиці сам перейде на наступний урок.') : null,
      box ? h('label', { class: 'check tu-shift' }, box, h('span', null, 'Зсунути план на наступні уроки')) : null);
    const choice = await new Promise((resolve) => {
      let res = null;
      const noBtn = ui.button({ label: 'Ні', onClick: () => dlg.close('cancel') });
      const paidBtn = TM ? ui.button({ label: 'Пропуск — оплачується', className: 'tu-cancel-paid', onClick: () => { res = 'paid'; dlg.close('ok'); } }) : null;
      const freeBtn = ui.button({ label: TM ? 'Без оплати' : 'Скасувати урок', variant: 'danger', className: 'tu-cancel-free', onClick: () => { res = 'free'; dlg.close('ok'); } });
      const dlg = ui.modal({ title: 'Скасувати урок?', size: 'sm', center: true, body: msg, footer: [noBtn, paidBtn, freeBtn].filter(Boolean), initialFocus: noBtn, className: 'tu-cancel-modal', onClose: () => resolve(res) });
    });
    if (!choice) return false;
    const evBefore = U.deepClone(CRM.store.get('events', L.evId));
    const sBefore = U.deepClone(s);
    let batch = null;
    if (L.series) {
      const cur = CRM.store.get('events', L.evId);
      const ov = Object.assign({}, cur.overrides || {});
      delete ov[L.occ];
      await CRM.store.patch('events', cur.id, { skip: (cur.skip || []).filter((d) => d !== L.occ).concat(L.occ).sort(), overrides: ov });
    } else {
      batch = await CRM.store.softDelete('events', L.evId);
    }
    if (box && box.checked) {
      const dates = lessonsOf(sid).map((x) => x.date).filter((d) => d >= date);
      const lessons = shiftedLessons(get(sid), date, dates);
      if (lessons) await save(Object.assign({}, get(sid), { lessons }));
    }
    if (choice === 'paid') await setLessonData(sid, date, { missed: TM.missedRecord(L, evBefore) });
    ui.toast(`Урок ${dayShort(date)} скасовано${choice === 'paid' ? ' — пропуск оплачується' : ''}${box && box.checked ? ' — план зсунуто' : ''}`, {
      action: { label: 'Скасувати', onClick: async () => {
        if (batch) await CRM.store.restoreBatch(batch); else await CRM.store.save('events', evBefore);
        if ((box && box.checked) || choice === 'paid') await save(Object.assign({}, get(sid) || sBefore, { lessons: sBefore.lessons || {} }));
      } }
    });
    return true;
  }

  // ---------- Розклад (серії подій) ----------
  const lessonTitle = (name) => `Урок: ${String(name || '').trim()}`;
  function lessonCat() {
    const cats = CRM.calendar && CRM.calendar.categories ? CRM.calendar.categories() : [];
    return cats.some((c) => c.id === 'work') ? 'work' : 'other';
  }
  /** Перший день не раніше за from, що припадає на один із днів тижня (0 — пн). */
  function firstOn(days, from) {
    for (let k = 0; k < 7; k++) { const d = D.addDays(from, k); if (days.includes(D.weekday(d))) return d; }
    return from;
  }
  function isSeriesEv(e) { return !!(CRM.calendar && CRM.calendar.isSeries && CRM.calendar.isSeries(e)); }
  /** Рядки розкладу: серії, що ще тривають (або почнуться). */
  function slots(sid) {
    const T = D.today();
    return lessonEvents(sid).filter((e) => isSeriesEv(e) && !(e.repeat.until && e.repeat.until < T))
      .sort((a, b) => ((a.repeat.days || [9])[0] - (b.repeat.days || [9])[0]) || String(a.start || '').localeCompare(String(b.start || '')));
  }
  function slotText(e) {
    const T = D.today();
    const r = e.repeat || {};
    const simple = r.freq === 'week' && Number(r.every || 1) === 1 && Array.isArray(r.days) && r.days.length;
    const days = simple ? r.days.slice().sort().map((d) => CRM.WEEKDAYS_SHORT[d]).join(', ') : (CRM.calendar.repeatText ? CRM.calendar.repeatText(e) : 'повтор');
    const s = minOf(e.start);
    const time = s == null ? 'весь день' : `${e.start}–${hhmm(Math.min(1440, s + (Number(e.dur) || 60)))}`;
    return [days + ' ' + time, e.dur ? durText(e.dur) : null, e.date > T ? 'з ' + fmt.dateShort(e.date) : null, r.until ? 'до ' + fmt.dateShort(r.until) : null].filter(Boolean).join(' · ');
  }
  /** Звичайна тривалість і час уроку учня (для разового уроку). */
  function usual(sid) {
    const sl = slots(sid)[0] || lessonEvents(sid).slice(-1)[0];
    return sl ? { start: sl.start || '16:00', dur: Number(sl.dur) || 60 } : { start: '16:00', dur: 60 };
  }

  /** Вікно рядка розкладу: дні тижня, час, з якої дати (до якої). evId — змінити наявний. */
  function openSlot(sid, evId) {
    const s = get(sid);
    if (!s || !CRM.calendar) return null;
    const cur = evId ? CRM.store.get('events', evId) : null;
    const T = D.today();
    const r0 = cur && cur.repeat ? cur.repeat : null;
    let days = r0 && Array.isArray(r0.days) && r0.days.length ? r0.days.slice() : [];
    const u = usual(sid);
    const s0 = cur && cur.start ? cur.start : u.start;
    const d0 = cur && cur.dur ? Number(cur.dur) : u.dur;
    const dayRow = h('div', { class: 'tu-days', role: 'group', 'aria-label': 'Дні тижня' });
    function renderDays() {
      ui.mount(dayRow, CRM.WEEKDAYS_SHORT.map((w, i) => h('button', {
        type: 'button', class: 'tu-day' + (days.includes(i) ? ' active' : ''), 'aria-pressed': days.includes(i) ? 'true' : 'false', dataset: { day: String(i) },
        onClick: () => { days = days.includes(i) ? days.filter((x) => x !== i) : days.concat(i).sort(); fDays.setError(null); renderDays(); }
      }, w)));
    }
    renderDays();
    const fDays = ui.field({ label: 'Дні', input: dayRow });
    const startIn = ui.timeInput({ value: s0, ariaLabel: 'Початок' });
    const endIn = ui.timeInput({ value: hhmm(Math.min(1440, (minOf(s0) || 960) + d0)), ariaLabel: 'Кінець' });
    const durEl = h('span', { class: 'subtle tu-dur' });
    let span = d0;
    const showDur = () => { const a = minOf(startIn.value); const b = minOf(endIn.value); durEl.textContent = a != null && b != null && b > a ? durText(b - a) : ''; };
    startIn.addEventListener('change', () => { const a = minOf(startIn.value); if (a == null) return; endIn.value = hhmm(Math.min(1440, a + span)); showDur(); });
    endIn.addEventListener('change', () => { const a = minOf(startIn.value); const b = minOf(endIn.value); if (a != null && b != null && b > a) span = b - a; fTime.setError(null); showDur(); });
    showDur();
    const durBtns = h('div', { class: 'tu-durs' }, DURS.map((m) => h('button', {
      type: 'button', class: 'chip tu-dur-chip', dataset: { dur: String(m) },
      onClick: () => { const a = minOf(startIn.value); if (a == null) return; span = m; endIn.value = hhmm(Math.min(1440, a + m)); fTime.setError(null); showDur(); }
    }, durText(m))));
    const fTime = ui.field({ label: 'Час', input: h('div', { class: 'tu-time-wrap' }, h('div', { class: 'kal-times-row' }, startIn, h('span', { class: 'subtle' }, '–'), endIn, durEl), durBtns) });
    const fromIn = ui.dateInput({ value: cur ? (cur.date > T ? cur.date : T) : T, clearable: false, ariaLabel: cur ? 'Зміни діють з' : 'З дати' });
    const untilIn = ui.dateInput({ value: r0 && r0.until ? r0.until : null, clearable: true, placeholder: 'Без кінця', ariaLabel: 'До дати' });
    const fFrom = ui.field({ label: cur ? 'Зміни діють з' : 'З дати', input: fromIn, hint: cur ? 'Минулі уроки лишаються як були.' : null });
    const fUntil = ui.field({ label: 'До дати', input: untilIn, hint: s.examDate ? `Іспит — ${fmt.date(s.examDate)}` : 'Необовʼязково' });
    async function submit() {
      const a = minOf(startIn.value);
      const b = minOf(endIn.value);
      let bad = false;
      if (!days.length) { fDays.setError('Вибери хоча б один день'); bad = true; }
      if (a == null || b == null || b <= a) { fTime.setError('Кінець має бути пізніше за початок'); bad = true; }
      const from = fromIn.dateValue || T;
      const until = untilIn.dateValue || null;
      if (until && until < from) { fUntil.setError('Не раніше за дату початку'); bad = true; }
      if (bad || !canSave()) return;
      const rule = { freq: 'week', every: 1, days: days.slice().sort(), until, count: null };
      const fields = { start: hhmm(a), dur: b - a, allDay: false };
      if (!cur) {
        const saved = await CRM.store.save('events', Object.assign({ title: lessonTitle(s.name), cat: lessonCat(), remind: 15, note: '', studentId: s.id },
          fields, { date: firstOn(rule.days, from), repeat: rule, skip: [], overrides: {} }));
        dlg.close('saved');
        ui.toast(`Розклад: ${slotText(saved)}`, { type: 'success', action: { label: 'Скасувати', onClick: () => CRM.store.removeForever('events', saved.id) } });
        return;
      }
      const before = U.deepClone(cur);
      const sameTime = cur.start === fields.start && Number(cur.dur) === fields.dur && JSON.stringify((r0.days || []).slice().sort()) === JSON.stringify(rule.days);
      if (cur.date >= from) {
        await CRM.store.save('events', Object.assign({}, cur, fields, { date: firstOn(rule.days, cur.date > from ? cur.date : from), repeat: rule },
          sameTime ? {} : { overrides: {} }));
        dlg.close('saved');
        ui.toast('Розклад змінено', { type: 'success', action: { label: 'Скасувати', onClick: () => CRM.store.save('events', before) } });
        return;
      }
      const pick = (obj, test) => { const o = {}; Object.keys(obj || {}).forEach((k) => { if (test(k)) o[k] = obj[k]; }); return o; };
      await CRM.store.save('events', Object.assign({}, cur, {
        repeat: Object.assign({}, r0, { until: D.addDays(from, -1), count: null }),
        skip: (cur.skip || []).filter((d) => d < from), overrides: pick(cur.overrides, (k) => k < from)
      }));
      const nu = await CRM.store.save('events', Object.assign({ title: cur.title || lessonTitle(s.name), cat: cur.cat || lessonCat(), remind: cur.remind == null ? null : cur.remind, note: cur.note || '', studentId: s.id },
        fields, { date: firstOn(rule.days, from), repeat: rule, skip: sameTime ? (cur.skip || []).filter((d) => d >= from) : [], overrides: sameTime ? pick(cur.overrides, (k) => k >= from) : {} }));
      dlg.close('saved');
      ui.toast(`Розклад змінено з ${dayShort(from)}`, { type: 'success', action: { label: 'Скасувати', onClick: async () => { await CRM.store.removeForever('events', nu.id); await CRM.store.save('events', before); } } });
    }
    const footer = [
      cur ? ui.button({ label: 'Прибрати…', icon: 'trash', variant: 'danger-ghost', className: 'tu-slot-del', onClick: async () => { const ok = await removeSlot(sid, cur.id); if (ok) dlg.close('removed'); } }) : null,
      ui.button({ label: 'Скасувати', onClick: () => dlg.close('button') }),
      ui.button({ label: cur ? 'Зберегти' : 'Додати', variant: 'primary', className: 'tu-slot-save', onClick: submit })
    ].filter(Boolean);
    const dlg = ui.modal({
      title: cur ? 'Змінити розклад' : 'Розклад: новий день', size: 'sm', className: 'tu-slot-modal',
      body: h('div', { class: 'form-stack tu-slot' }, fDays, fTime, h('div', { class: 'tu-row2' }, fFrom, fUntil)),
      footer, initialFocus: dayRow.querySelector('button')
    });
    return dlg;
  }
  async function removeSlot(sid, evId) {
    const cur = CRM.store.get('events', evId);
    if (!cur) return false;
    const T = D.today();
    const dateIn = ui.dateInput({ value: cur.date > T ? cur.date : T, clearable: false, ariaLabel: 'З якого дня прибрати' });
    const msg = h('div', { class: 'form-stack' },
      h('p', { class: 'modal-text' }, `«${slotText(cur)}» більше не буде в розкладі. Минулі уроки лишаються.`),
      ui.field({ label: 'Прибрати з', input: dateIn }));
    const ok = await ui.confirm({ title: 'Прибрати з розкладу?', message: msg, confirmText: 'Прибрати', danger: true });
    if (!ok) return false;
    const from = dateIn.dateValue || T;
    const before = U.deepClone(cur);
    if (cur.date >= from) {
      const batch = await CRM.store.softDelete('events', cur.id);
      ui.toast('Прибрано з розкладу', { action: { label: 'Скасувати', onClick: () => CRM.store.restoreBatch(batch) } });
    } else {
      await CRM.store.save('events', Object.assign({}, cur, { repeat: Object.assign({}, cur.repeat, { until: D.addDays(from, -1), count: null }) }));
      ui.toast(`Прибрано з розкладу з ${dayShort(from)}`, { action: { label: 'Скасувати', onClick: () => CRM.store.save('events', before) } });
    }
    return true;
  }
  /** Разовий (додатковий) урок. */
  function openOneOff(sid, preset) {
    const s = get(sid);
    if (!s || !CRM.calendar) return null;
    const p = preset || {};
    const u = usual(sid);
    const dateIn = ui.dateInput({ value: p.date || D.today(), clearable: false, ariaLabel: 'Дата' });
    const st = p.start || u.start;
    const startIn = ui.timeInput({ value: st, ariaLabel: 'Початок' });
    const endIn = ui.timeInput({ value: hhmm(Math.min(1440, (minOf(st) || 960) + (p.dur || u.dur))), ariaLabel: 'Кінець' });
    let span = p.dur || u.dur;
    const durEl = h('span', { class: 'subtle tu-dur' });
    const showDur = () => { const a = minOf(startIn.value); const b = minOf(endIn.value); durEl.textContent = a != null && b != null && b > a ? durText(b - a) : ''; };
    startIn.addEventListener('change', () => { const a = minOf(startIn.value); if (a == null) return; endIn.value = hhmm(Math.min(1440, a + span)); showDur(); });
    endIn.addEventListener('change', () => { const a = minOf(startIn.value); const b = minOf(endIn.value); if (a != null && b != null && b > a) span = b - a; fTime.setError(null); showDur(); });
    showDur();
    const fTime = ui.field({ label: 'Час', input: h('div', { class: 'kal-times-row' }, startIn, h('span', { class: 'subtle' }, '–'), endIn, durEl) });
    async function submit() {
      const a = minOf(startIn.value);
      const b = minOf(endIn.value);
      if (a == null || b == null || b <= a) { fTime.setError('Кінець має бути пізніше за початок'); return; }
      if (!canSave()) return;
      const date = dateIn.dateValue || D.today();
      const saved = await CRM.store.save('events', { title: lessonTitle(s.name), date, allDay: false, start: hhmm(a), dur: b - a, cat: lessonCat(), remind: 15, note: '', studentId: s.id });
      dlg.close('saved');
      ui.toast(`Урок додано: ${dayShort(date)}, ${saved.start}`, { type: 'success', action: { label: 'Скасувати', onClick: () => CRM.store.removeForever('events', saved.id) } });
    }
    const dlg = ui.modal({
      title: `Разовий урок: ${s.name}`, size: 'sm', className: 'tu-oneoff-modal',
      body: h('div', { class: 'form-stack' }, ui.field({ label: 'Дата', input: dateIn }), fTime),
      footer: [ui.button({ label: 'Скасувати', onClick: () => dlg.close('button') }), ui.button({ label: 'Додати', variant: 'primary', className: 'tu-oneoff-save', onClick: submit })],
      initialFocus: startIn
    });
    return dlg;
  }

  // ---------- Учень: форма ----------
  function reportOptions(s) {
    const opts = [{ value: 'self', label: 'Самому учневі' }];
    const ppl = CRM.people ? CRM.people.list() : [];
    const me = s && s.personId;
    const parents = ppl.filter((p) => p.group === 'parents' && p.id !== me);
    const others = ppl.filter((p) => p.group !== 'parents' && p.id !== me);
    parents.concat(others).forEach((p) => opts.push({ value: p.id, label: p.name + (p.group === 'parents' || !CRM.people.groupOf ? '' : ` · ${CRM.people.groupOf(p.group).label}`) }));
    if (CRM.people && CRM.people.canSave()) opts.push({ value: 'new', label: '+ Нова людина (мама чи тато)…' });
    opts.push({ value: 'none', label: 'Не надсилати звітів' });
    return opts;
  }
  function swatchRow(value, onPick) {
    const row = h('div', { class: 'tu-swatches', role: 'radiogroup', 'aria-label': 'Колір' });
    let cur = value;
    function draw() {
      ui.mount(row, COLORS.map((c) => h('button', {
        type: 'button', class: 'tu-swatch' + (c === cur ? ' active' : ''), role: 'radio', 'aria-checked': c === cur ? 'true' : 'false',
        title: (CRM.dict.get('categoryColors', c) || {}).name || c, dataset: { color: c }, style: { background: CRM.dict.categoryColor(c) },
        onClick: () => { cur = c; onPick(c); draw(); }
      })));
    }
    draw();
    return row;
  }
  /** Форма учня: імʼя, у таблиці, колір, мета, дата іспиту, кому звіт, нотатки. */
  function openForm(id, opts) {
    const o = opts || {};
    const cur = id ? CRM.store.get('students', id) : null;
    if (id && (!cur || cur.deletedAt)) { ui.toast(cur ? 'Учень у Кошику — віднови, щоб змінити' : 'Цього учня більше немає', { type: 'error' }); return null; }
    if (!canSave()) return null;
    const st = Object.assign({ name: '', sheetName: '', color: nextColor(), goal: '', examDate: null, notes: '', reportTo: 'self' }, cur || {}, o.preset || {});
    const nameIn = ui.input({ value: st.name, maxlength: 80, placeholder: 'Напр., Макс', 'aria-label': 'Імʼя', class: 'input tu-name' });
    const fName = ui.field({ label: 'Імʼя', required: true, input: nameIn });
    const sheetIn = ui.input({ value: st.sheetName || '', maxlength: 80, placeholder: 'Як імʼя', 'aria-label': 'Імʼя в таблиці', class: 'input tu-sheetname' });
    const c = cache();
    const taken = new Set(all().filter((x) => !cur || x.id !== cur.id).map((x) => normName(x.sheetName || x.name)));
    const free = c ? Object.keys(c.blocks).filter((k) => !taken.has(k)).map((k) => c.blocks[k].name) : [];
    const chips = free.length ? h('div', { class: 'tu-sheet-chips' }, h('span', { class: 'subtle' }, 'У таблиці:'), free.map((n) => h('button', {
      type: 'button', class: 'chip tu-sheet-chip', dataset: { name: n },
      onClick: () => { if (!nameIn.value.trim()) nameIn.value = n; sheetIn.value = normName(n) === normName(nameIn.value) ? '' : n; fName.setError(null); }
    }, n))) : null;
    const fSheet = ui.field({ label: 'Імʼя в Google-таблиці', input: sheetIn,
      hint: c ? 'Як підписаний блок учня (стовпець A аркуша «Репетиторство»). Порожньо — як імʼя.' : 'Як підписаний блок учня в таблиці. Порожньо — як імʼя. Таблицю підключають у «Налаштуваннях».' });
    let color = st.color;
    const goalIn = ui.input({ value: st.goal || '', maxlength: 120, placeholder: 'Напр., IELTS Academic 6.5', 'aria-label': 'Мета' });
    const examIn = ui.dateInput({ value: st.examDate || null, clearable: true, placeholder: 'Немає', ariaLabel: 'Дата іспиту' });
    const repSel = ui.select(reportOptions(cur), { value: st.reportTo && (st.reportTo === 'self' || st.reportTo === 'none' || person(st.reportTo)) ? st.reportTo : 'self', 'aria-label': 'Кому надсилати звіт', class: 'select tu-report-to-sel' });
    const newName = ui.input({ maxlength: 80, placeholder: 'Напр., Мама Макса', 'aria-label': 'Імʼя мами чи тата' });
    const newTg = ui.input({ maxlength: 60, placeholder: '@username', 'aria-label': 'Telegram мами чи тата' });
    const newPhone = ui.input({ maxlength: 30, placeholder: '+380…', 'aria-label': 'Телефон мами чи тата', inputmode: 'tel' });
    const fNewName = ui.field({ label: 'Імʼя', input: newName });
    const newBox = h('div', { class: 'tu-newperson' }, fNewName, h('div', { class: 'tu-row2' }, ui.field({ label: 'Telegram', input: newTg }), ui.field({ label: 'Телефон', input: newPhone })),
      h('div', { class: 'field-hint' }, 'Зʼявиться в «Людях» у групі «Батьки учнів».'));
    newBox.hidden = true;
    repSel.addEventListener('change', () => { newBox.hidden = repSel.value !== 'new'; if (!newBox.hidden) newName.focus(); });
    const fRep = ui.field({ label: 'Кому надсилати звіт', input: repSel, hint: 'Кнопка «Telegram» у звіті відкриває чат саме з цією людиною (Telegram або телефон — у її картці в «Людях»).' });
    const notesIn = ui.textarea({ value: st.notes || '', rows: 3, maxlength: 3000, placeholder: 'Необовʼязково: на що звертати увагу, домовленості…', 'aria-label': 'Нотатки' });
    async function submit() {
      const name = nameIn.value.replace(/\s+/g, ' ').trim();
      if (!name) { fName.setError('Впиши імʼя'); nameIn.focus(); return; }
      if (all().some((x) => (!cur || x.id !== cur.id) && normName(x.name) === normName(name))) { fName.setError('Учень з таким імʼям уже є'); nameIn.focus(); return; }
      let reportTo = repSel.value;
      if (reportTo === 'new') {
        const pn = newName.value.replace(/\s+/g, ' ').trim();
        if (!pn) { fNewName.setError('Впиши імʼя'); newName.focus(); return; }
        const p = await CRM.people.save(CRM.people.blank({ name: pn, group: 'parents', telegram: newTg.value.trim(), phone: newPhone.value.trim(), notes: `${name}: звіти про уроки` }));
        reportTo = p.id;
      }
      const sheetName = sheetIn.value.replace(/\s+/g, ' ').trim();
      const rec = Object.assign({ lessons: {}, archived: false, personId: null }, cur || {}, {
        name, sheetName: normName(sheetName) === normName(name) ? '' : sheetName, color, goal: goalIn.value.trim(),
        examDate: examIn.dateValue || null, notes: notesIn.value.trim(), reportTo
      });
      if (!cur && CRM.people && CRM.people.canSave()) {
        const same = CRM.people.list().find((p) => normName(p.name) === normName(name));
        rec.personId = same ? same.id : (await CRM.people.save(CRM.people.blank({ name, group: 'students' }))).id;
      }
      const saved = await save(rec);
      if (cur && cur.name !== name) {
        const evs = lessonEvents(cur.id).filter((e) => e.title === lessonTitle(cur.name)).map((e) => Object.assign({}, e, { title: lessonTitle(name) }));
        if (evs.length) await CRM.store.saveMany('events', evs);
      }
      dlg.close('saved');
      if (!cur) {
        ui.toast(`Учня «${name}» додано — тепер розклад уроків`, { type: 'success' });
        CRM.router.go('tutor/' + saved.id);
        // У Google Календарі вже є його уроки — сторінка запропонує такий самий розклад; інакше — одразу вікно розкладу
        if (!googleSlots(saved).length) setTimeout(() => openSlot(saved.id), 60);
      } else ui.toast('Збережено', { type: 'success' });
    }
    nameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    const footer = [
      cur ? ui.button({ label: 'Видалити', icon: 'trash', variant: 'danger-ghost', className: 'tu-del', onClick: async () => { const ok = await removeStudent(cur.id); if (ok) dlg.close('deleted'); } }) : null,
      cur ? ui.button({ label: cur.archived ? 'Повернути з архіву' : 'В архів', icon: 'archive', variant: 'ghost', className: 'tu-archive', onClick: async () => { const ok = await setArchived(cur.id, !cur.archived); if (ok) dlg.close('archived'); } }) : null,
      ui.button({ label: 'Скасувати', onClick: () => dlg.close('button') }),
      ui.button({ label: cur ? 'Зберегти' : 'Додати', variant: 'primary', className: 'tu-save', onClick: submit })
    ].filter(Boolean);
    const dlg = ui.modal({
      title: cur ? cur.name : 'Новий учень', size: 'md', className: 'tu-form-modal',
      body: h('div', { class: 'form-stack tu-form' },
        fName, h('div', null, fSheet, chips),
        ui.field({ label: 'Колір', input: swatchRow(color, (v) => { color = v; }) }),
        h('div', { class: 'tu-row2' }, ui.field({ label: 'Мета', input: goalIn }), ui.field({ label: 'Дата іспиту', input: examIn })),
        fRep, newBox,
        ui.field({ label: 'Нотатки', input: notesIn })),
      footer, initialFocus: o.focus === 'report' ? repSel : nameIn
    });
    return dlg;
  }
  async function removeStudent(id) {
    const s = get(id);
    if (!s) return false;
    const evs = lessonEvents(id);
    const ok = await ui.confirm({
      title: `Видалити «${s.name}»?`,
      message: `Учень${evs.length ? ' і його уроки в Календарі' : ''} перейдуть у Кошик — їх можна відновити протягом 30 днів. Картка в «Людях» лишиться.`,
      confirmText: 'Видалити', danger: true
    });
    if (!ok) return false;
    const batch = await CRM.store.softDelete('students', id, evs.map((e) => ({ store: 'events', id: e.id })));
    ui.toast(`«${s.name}» — у Кошику`, { action: { label: 'Скасувати', onClick: () => CRM.store.restoreBatch(batch) } });
    CRM.router.go('tutor');
    return true;
  }
  /** В архів: розклад закінчується сьогодні, майбутні разові уроки — у Кошик. Повернути — лише позначка. */
  async function setArchived(id, on) {
    const s = get(id);
    if (!s) return false;
    const T = D.today();
    if (!on) { await save(Object.assign({}, s, { archived: false })); ui.toast(`«${s.name}» знову серед учнів`, { type: 'success' }); return true; }
    const ok = await ui.confirm({
      title: `«${s.name}» — в архів?`,
      message: 'Розклад уроків закінчиться сьогодні, майбутні разові уроки зникнуть з Календаря. Минулі уроки й записи лишаються. Повернути учня можна будь-коли.',
      confirmText: 'В архів'
    });
    if (!ok) return false;
    const before = lessonEvents(id).map((e) => U.deepClone(e));
    const sBefore = U.deepClone(s);
    const changes = [];
    const gone = [];
    before.forEach((e) => {
      if (isSeriesEv(e)) {
        if (e.date > T) gone.push(e.id);
        else if (!e.repeat.until || e.repeat.until > T) changes.push(Object.assign({}, e, { repeat: Object.assign({}, e.repeat, { until: T, count: null }) }));
      } else if (e.date > T) gone.push(e.id);
    });
    if (changes.length) await CRM.store.saveMany('events', changes);
    let batch = null;
    if (gone.length) batch = await CRM.store.softDelete('events', gone[0], gone.slice(1).map((x) => ({ store: 'events', id: x })));
    await save(Object.assign({}, get(id), { archived: true }));
    ui.toast(`«${s.name}» — в архіві`, { action: { label: 'Скасувати', onClick: async () => {
      if (batch) await CRM.store.restoreBatch(batch);
      const keep = before.filter((e) => changes.some((c) => c.id === e.id));
      if (keep.length) await CRM.store.saveMany('events', keep);
      await save(sBefore);
    } } });
    return true;
  }

  // ---------- Налаштування: таблиця й шаблон звіту ----------
  function sheetBar() {
    const st = sheetStatus();
    const c = cache();
    const btn = (label, onClick, cls, icon) => ui.button({ label, icon, size: 'sm', className: cls, onClick });
    let text = '';
    let icon = 'file';
    let actions = [];
    const gst = CRM.gcal ? CRM.gcal.status() : 'no-client';
    if (st === 'off') { text = 'Підключи Google-таблицю «Репетиторство» — CRM братиме з неї плани й записи уроків.'; actions = [btn('Підключити таблицю', () => openSettings(), 'tu-connect', 'link')]; }
    else if (st === 'file') { text = 'Таблиця читається лише на сайті, не з файлу на компʼютері.'; icon = 'info'; }
    else if (st === 'no-google') { text = 'Таблиця використовує те саме підключення Google, що й «Календар», — спершу вкажи Client ID у «Моєму кабінеті».'; actions = [h('a', { href: CRM.router.href('profile', { focus: 'gcal' }), class: 'btn btn-sm' }, 'Мій кабінет')]; }
    else if (st === 'need-access') {
      text = gst === 'connected' ? 'Дозволь CRM читати Google-таблиці (один раз, у вікні Google).' : 'Доступ Google сплив — онови підключення, щоб прочитати таблицю.';
      icon = 'alert';
      actions = [btn(gst === 'connected' ? 'Дозволити читати таблицю' : gst === 'disconnected' ? 'Підключити Google' : 'Оновити підключення', () => grantAccess(), 'tu-grant', 'refresh')];
    } else if (st === 'loading') { text = 'Читаю таблицю…'; icon = 'refresh'; }
    else if (st === 'error') { text = lastError.text; icon = 'alert'; actions = [btn('Спробувати ще', () => refresh({ toast: true }), 'tu-retry', 'refresh')]; }
    else if (st === 'ok') {
      text = `Таблиця${c.title ? ' «' + c.title + '»' : ''} · оновлено ${cacheAge()}`;
      actions = [btn('Оновити', () => refresh({ toast: true }), 'tu-refresh', 'refresh'),
        h('a', { href: sheetUrl(c.gidJournal), target: '_blank', rel: 'noopener noreferrer', class: 'btn btn-sm btn-ghost tu-open' }, CRM.icon('external', { size: 'sm' }), h('span', { class: 'btn-label' }, 'Відкрити'))];
    }
    if (st !== 'ok' && st !== 'off' && c) text += ` Показую збережене (${cacheAge()}).`;
    return h('div', { class: 'tu-bar tu-bar-' + st, role: st === 'error' ? 'alert' : null },
      h('span', { class: 'tu-bar-ico' }, CRM.icon(icon, { size: 'sm' })), h('span', { class: 'tu-bar-text' }, text),
      actions.length ? h('div', { class: 'tu-bar-actions' }, actions) : null);
  }
  function openSettings() {
    const c0 = cfg();
    const urlIn = ui.input({ value: c0.sheetId ? sheetUrl(null) : '', placeholder: 'https://docs.google.com/spreadsheets/d/…', 'aria-label': 'Посилання на Google-таблицю', class: 'input tu-sheet-url' });
    const fUrl = ui.field({ label: 'Посилання на Google-таблицю «Репетиторство»', input: urlIn,
      hint: 'Скопіюй адресу таблиці з браузера. CRM лише читає таблицю — нічого в ній не змінює. Потрібні аркуші «Репетиторство» (журнал) і «Планування» (рівень, логіка, підручники).' });
    const statusBox = h('div', { class: 'tu-set-status' });
    function renderStatus() {
      const c = cache();
      const names = c ? Object.keys(c.blocks).map((k) => {
        const b = c.blocks[k];
        const who = all().find((s) => normName(s.sheetName || s.name) === k);
        return h('span', { class: 'chip tu-found' + (who ? ' active' : ''), title: who ? `Учень «${who.name}» у CRM` : 'Ще не доданий у CRM' }, b.name, h('span', { class: 'subtle' }, ` · ${b.cols.length}`));
      }) : [];
      ui.mount(statusBox, cfg().sheetId ? sheetBar() : null,
        c ? h('div', { class: 'tu-found-row' }, h('span', { class: 'subtle' }, `Аркуш «${JOURNAL_SHEET}»: ${names.length} ${fmt.plural(names.length, ['блок', 'блоки', 'блоків'])} учнів${c.hasPlan ? `, «${PLAN_SHEET}»: ${Object.keys(c.plan).length}` : `, аркуша «${PLAN_SHEET}» немає`}. Число — скільки стовпців-занять.`), names) : null);
    }
    async function saveUrl() {
      const v = urlIn.value.trim();
      const id = sheetIdFrom(v);
      if (v && !id) { fUrl.setError('Це не схоже на посилання на Google-таблицю (має бути …/spreadsheets/d/…)'); return; }
      const old = cfg().sheetId;
      await setCfg({ sheetId: id });
      if (id !== old) { await CRM.store.setSetting(CACHE, null); lastError = null; }
      renderStatus();
      if (!id) { ui.toast('Таблицю відключено'); return; }
      ui.toast('Посилання збережено', { type: 'success' });
      if (token()) refresh({ toast: true });
    }
    urlIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); saveUrl(); } });
    const tplIn = ui.textarea({ value: template(), rows: 7, maxlength: 3000, 'aria-label': 'Шаблон звіту', class: 'textarea tu-tpl' });
    let tplTimer = null;
    const saveTpl = () => { const v = tplIn.value.trim(); return setCfg({ template: !v || v === DEFAULT_TEMPLATE ? '' : v }); };
    tplIn.addEventListener('input', () => { clearTimeout(tplTimer); tplTimer = setTimeout(saveTpl, 500); });
    const resetBtn = ui.button({ label: 'Як було спочатку', size: 'sm', variant: 'ghost', className: 'tu-tpl-reset', onClick: async () => { tplIn.value = DEFAULT_TEMPLATE; await saveTpl(); ui.toast('Шаблон — як спочатку'); } });
    const onSheet = () => renderStatus();
    document.addEventListener('crm:tutorsheet', onSheet);
    const off = CRM.store.on(['settings', 'students'], renderStatus);
    const sumSec = CRM.tutorMoney ? CRM.tutorMoney.settingsSection() : null;   // шаблон підсумку за місяць
    const dlg = ui.modal({
      title: 'Налаштування репетиторства', size: 'md', className: 'tu-settings-modal',
      body: h('div', { class: 'form-stack' },
        h('div', { class: 'tu-set-sec' }, h('h3', null, 'Google-таблиця'), h('div', { class: 'tu-url-row' }, fUrl, ui.button({ label: 'Зберегти', className: 'tu-url-save', onClick: saveUrl })), statusBox),
        h('div', { class: 'tu-set-sec' }, h('h3', null, 'Шаблон звіту для батьків'),
          ui.field({ input: tplIn, hint: 'Підстановки: {імʼя}, {дата}, {тривалість}, {що робили}, {домашнє}, {наступного разу}. Рядок, де «що робили», «домашнє» чи «наступного разу» порожнє, у звіт не потрапляє.' }),
          resetBtn),
        sumSec ? sumSec.el : null),
      footer: [ui.button({ label: 'Готово', variant: 'primary', onClick: () => dlg.close('button') })],
      initialFocus: urlIn,
      onClose: async () => { clearTimeout(tplTimer); await saveTpl(); if (sumSec) await sumSec.flush(); document.removeEventListener('crm:tutorsheet', onSheet); off(); }
    });
    renderStatus();
    return dlg;
  }

  // ---------- Сторінка ----------
  function entryRow(s, e, opts) {
    const o = opts || {};
    const L = e.lesson;
    const future = L && !ended(L);
    const text = future ? e.plan : whatOrPlan(e);
    const open = () => openLesson(s.id, e.key);
    return h('div', {
      class: 'tu-erow' + (L ? '' : ' tu-erow-sheet') + (L && L.date === D.today() ? ' is-today' : ''), role: 'button', tabIndex: 0, dataset: { key: e.key, sid: s.id },
      style: { '--tu': colorOf(s) },
      onClick: open, onKeydown: (ev) => { if ((ev.key === 'Enter' || ev.key === ' ') && ev.target === ev.currentTarget) { ev.preventDefault(); open(); } }
    },
    h('span', { class: 'tu-erow-when' },
      h('span', { class: 'tu-erow-date' }, e.date ? (o.rel ? relDay(e.date) : dayShort(e.date)) : 'без дати'),
      h('span', { class: 'tu-erow-time subtle num' }, L && L.start ? L.start : e.col ? 'стовп. ' + e.col.a1 : '')),
    o.name ? h('span', { class: 'tu-erow-name' }, h('span', { class: 'tu-dot', style: { background: colorOf(s) } }), s.name) : null,
    h('span', { class: 'tu-erow-text' + (text ? '' : ' subtle') }, text ? oneLine(text, 200) : future ? 'Плану ще немає' : '—'),
    h('span', { class: 'tu-erow-side' },
      statusChip(s, e),
      L && ended(L) && !sentAt(s, L.date) && wantsReport(s)
        ? ui.button({ label: 'Звіт', icon: 'send', size: 'sm', className: 'tu-erow-report', onClick: (ev) => { ev.stopPropagation(); openReport(s.id, e.key); } }) : null));
  }
  function tabsNav(cur) {
    const tabs = [{ id: 'students', label: 'Учні', href: '#/tutor', n: active().length }, { id: 'lessons', label: 'Уроки', href: '#/tutor/lessons' }];
    // «Гроші» (js/tutor-money.js, етап 2)
    if (CRM.tutorMoney) tabs.push({ id: 'money', label: 'Гроші', href: '#/tutor/money' });
    return h('nav', { class: 'tabs tu-tabs', 'aria-label': 'Репетиторство' }, tabs.map((t) => h('a', {
      href: t.href, class: 'tab' + (t.id === cur ? ' active' : ''), dataset: { tab: t.id }, 'aria-current': t.id === cur ? 'page' : null
    }, t.label, t.n != null ? h('span', { class: 'tab-count' }, String(t.n)) : null)));
  }
  function listHead() {
    const T = D.today();
    const today = lessonsBetween(T, T).filter((L) => !get(L.sid).archived).length;
    const n = active().length;
    return ui.pageHead({
      title: 'Репетиторство',
      sub: n ? `${fmt.count(n, ['учень', 'учні', 'учнів'])} · ${today ? 'сьогодні ' + fmt.count(today, ['урок', 'уроки', 'уроків']) : 'сьогодні уроків немає'}` : 'Учні, розклад, плани з Google-таблиці й звіти для батьків',
      actions: [
        ui.button({ label: 'Налаштування', icon: 'file', className: 'tu-settings', onClick: () => openSettings() }),
        ui.button({ label: 'Учень', icon: 'plus', variant: 'primary', className: 'tu-add', dataset: { hk: 'add' }, onClick: () => openForm(null) })
      ]
    });
  }
  function studentCard(s) {
    const pl = planningOf(s);
    const tl = timeline(s).entries;
    const nx = tl.find((e) => e.lesson && !ended(e.lesson));
    const T = D.today();
    const due = wantsReport(s) ? tl.filter((e) => e.lesson && ended(e.lesson) && e.date >= D.addDays(T, -7) && !sentAt(s, e.date)).pop() : null;
    const sl = slots(s.id);
    const sub = [pl && pl.level, s.goal, s.examDate && s.examDate >= T ? `іспит ${fmt.dateShort(s.examDate)}` : null].filter(Boolean).join(' · ');
    return h('section', { class: 'card tu-card', dataset: { id: s.id }, style: { '--tu': colorOf(s) } },
      h('a', { class: 'tu-card-main', href: CRM.router.href('tutor/' + s.id) },
        h('span', { class: 'avatar tu-avatar', style: { background: colorOf(s) }, 'aria-hidden': 'true' }, U.initials(s.name) || '?'),
        h('span', { class: 'tu-card-text' },
          h('span', { class: 'tu-card-name' }, s.name, s.archived ? h('span', { class: 'badge' }, 'архів') : null),
          h('span', { class: 'tu-card-sub subtle' }, sub || (sl.length ? sl.map(slotText).join('; ') : 'Розкладу ще немає'))),
        CRM.icon('chevronRight', { size: 'sm', className: 'tu-card-go' })),
      nx ? h('button', { type: 'button', class: 'tu-card-next', onClick: () => openLesson(s.id, nx.key) },
        h('span', { class: 'tu-card-when' }, CRM.icon('clock', { size: 'sm' }), `${relDay(nx.date)}${nx.start ? ', ' + nx.start : ''}`),
        h('span', { class: 'tu-card-plan' + (nx.plan ? '' : ' subtle') }, nx.plan ? oneLine(nx.plan, 160) : 'Плану ще немає'))
        : !sl.length && !s.archived ? h('div', { class: 'tu-card-next subtle' }, ui.button({ label: 'Додати розклад', icon: 'plus', size: 'sm', variant: 'ghost', className: 'tu-card-slot', onClick: () => openSlot(s.id) })) : null,
      CRM.tutorMoney ? CRM.tutorMoney.cardLine(s) : null,
      due ? h('div', { class: 'tu-card-due' }, h('span', null, `Звіт за ${dayShort(due.date)} не надіслано`),
        ui.button({ label: 'Звіт', icon: 'send', size: 'sm', className: 'tu-card-report', onClick: () => openReport(s.id, due.key) })) : null);
  }
  function renderStudents(container) {
    const list = active();
    const arch = all().filter((s) => s.archived);
    const body = [];
    if (!all().length) {
      body.push(ui.empty({
        icon: 'board', title: 'Додай першого учня',
        text: 'Уроки за розкладом стануть у Календарі, плани підтягнуться з Google-таблиці, а звіт для батьків збереться сам.',
        action: { label: 'Додати учня', icon: 'plus', onClick: () => openForm(null) }
      }));
    } else {
      body.push(h('div', { class: 'tu-grid' }, list.map(studentCard)));
      if (arch.length) {
        const det = h('details', { class: 'tu-archive-list' }, h('summary', null, `Архів · ${arch.length}`), h('div', { class: 'tu-grid' }, arch.map(studentCard)));
        body.push(det);
      }
    }
    ui.mount(container, h('div', { class: 'page tu-page' }, listHead(), sheetBar(), tabsNav('students'), body));
  }
  function renderLessons(container) {
    const T = D.today();
    const list = lessonsBetween(D.addDays(T, -14), D.addDays(T, 7)).filter((L) => !get(L.sid).archived);
    const tls = new Map();
    const entry = (L) => {
      if (!tls.has(L.sid)) tls.set(L.sid, timeline(get(L.sid)).entries);
      return tls.get(L.sid).find((e) => e.key === 'L:' + L.date) || { key: 'L:' + L.date, date: L.date, lesson: L, plan: '', what: '', hw: '', next: '' };
    };
    const group = (title, arr, cls) => (arr.length ? h('section', { class: 'card tu-lgroup ' + cls },
      h('div', { class: 'card-head' }, h('h2', null, title, h('span', { class: 'tab-count' }, String(arr.length)))),
      h('div', { class: 'tu-elist' }, arr.map((L) => entryRow(get(L.sid), entry(L), { name: true, rel: true })))) : null);
    const today = list.filter((L) => L.date === T);
    const next = list.filter((L) => L.date > T);
    const past = list.filter((L) => L.date < T).reverse();
    const body = list.length ? [group('Сьогодні', today, 'tu-today'), group('Наступні 7 днів', next, 'tu-next'), group('Минулі 2 тижні', past, 'tu-past')]
      : [ui.empty({ icon: 'calendar', title: 'Уроків поруч немає', text: all().length ? 'Додай учневі розклад — уроки зʼявляться тут і в Календарі.' : 'Спершу додай учня.', action: { label: all().length ? 'До учнів' : 'Додати учня', onClick: () => (all().length ? CRM.router.go('tutor') : openForm(null)) } })];
    ui.mount(container, h('div', { class: 'page tu-page' }, listHead(), sheetBar(), tabsNav('lessons'), body));
  }
  const histMore = {};
  /** «Історія» (від нових до старих) + оплачувані пропуски (js/tutor-money.js) — кожен перед першим старішим записом. */
  function mergeMissed(list, missed) {
    if (!missed.length) return list;
    const out = list.slice();
    missed.slice().sort((a, b) => b.date.localeCompare(a.date)).forEach((m) => {
      const i = out.findIndex((e) => e.date && e.date < m.date);
      out.splice(i < 0 ? out.length : i, 0, m);
    });
    return out;
  }
  function renderStudent(container, id) {
    const s = get(id);
    if (!s) {
      ui.mount(container, h('div', { class: 'page tu-page' }, h('a', { href: '#/tutor', class: 'btn btn-ghost btn-sm tu-back' }, CRM.icon('chevronLeft', { size: 'sm' }), 'Усі учні'),
        ui.empty({ icon: 'board', title: 'Учня не знайдено', text: 'Можливо, його видалено (подивись у Кошику).' })));
      return;
    }
    const T = D.today();
    const tl = timeline(s);
    const block = tl.block;
    const pl = planningOf(s);
    const up = tl.entries.filter((e) => e.lesson && !ended(e.lesson));
    const past = mergeMissed(tl.entries.filter((e) => !(e.lesson && !ended(e.lesson))).reverse(), CRM.tutorMoney ? CRM.tutorMoney.missedEntries(s) : []);
    const shown = histMore[id] || 10;
    const sl = slots(id);
    const gsl = sl.length ? [] : googleSlots(s);
    const to = reportPerson(s);
    const me = personOf(s);
    const c = cache();
    const kv = (k, v) => (v ? h('div', { class: 'tu-kv' }, h('div', { class: 'tu-k subtle' }, k), h('div', { class: 'tu-text' }, v)) : null);
    const left = h('div', { class: 'tu-col' },
      h('section', { class: 'card tu-up' },
        h('div', { class: 'card-head' }, h('h2', null, 'Найближчі уроки')),
        up.length ? h('div', { class: 'tu-elist' }, up.slice(0, 4).map((e) => entryRow(s, e, { rel: true })))
          : h('div', { class: 'card-body subtle' }, sl.length ? 'Найближчим часом уроків немає.' : 'Розкладу ще немає — додай дні уроків праворуч.')),
      h('section', { class: 'card tu-hist' },
        h('div', { class: 'card-head' }, h('h2', null, 'Історія', past.length ? h('span', { class: 'tab-count' }, String(past.length)) : null)),
        past.length ? h('div', { class: 'tu-elist' }, past.slice(0, shown).map((e) => (e.missed ? CRM.tutorMoney.missedRow(s, e) : entryRow(s, e, {})))) : h('div', { class: 'card-body subtle' }, 'Ще не було уроків.'),
        past.length > shown ? h('div', { class: 'card-foot' }, ui.button({ label: `Показати ще ${Math.min(10, past.length - shown)}`, size: 'sm', variant: 'ghost', className: 'tu-more', onClick: () => { histMore[id] = shown + 10; CRM.router.rerender(); } })) : null),
      CRM.tutorMoney ? CRM.tutorMoney.statementCard(s) : null);
    const right = h('div', { class: 'tu-col' },
      CRM.tutorMoney ? CRM.tutorMoney.moneyCard(s) : null,
      h('section', { class: 'card tu-slots' },
        h('div', { class: 'card-head' }, h('h2', null, 'Розклад'),
          ui.button({ label: 'День', icon: 'plus', size: 'sm', variant: 'ghost', className: 'tu-slot-add', title: 'Додати день уроків', onClick: () => openSlot(id) })),
        sl.length ? h('div', { class: 'tu-slot-list' }, sl.map((e) => h('button', { type: 'button', class: 'tu-slot-row', dataset: { id: e.id }, onClick: () => openSlot(id, e.id) },
          CRM.icon('repeat', { size: 'sm' }), h('span', null, slotText(e)), CRM.icon('pencil', { size: 'sm', className: 'tu-slot-edit' }))))
          : gsl.length && !s.archived ? h('div', { class: 'card-body tu-gslots' },
            h('div', null, `У Google Календарі є уроки «${s.name}»: `, h('strong', null, gsl.map(googleSlotText).join('; ')), '.'),
            h('div', { class: 'subtle' }, 'Створи такий самий розклад у CRM — тоді уроки можна переносити й скасовувати тут, а події з Google не показуватимуться двічі.'),
            ui.button({ label: 'Створити такий розклад', icon: 'repeat', size: 'sm', variant: 'primary', className: 'tu-from-google', onClick: () => slotsFromGoogle(id) }))
            : h('div', { class: 'card-body subtle' }, s.archived ? 'Учень в архіві.' : 'Ще немає — натисни «+ День».'),
        h('div', { class: 'card-foot' }, ui.button({ label: 'Разовий урок', icon: 'plus', size: 'sm', variant: 'ghost', className: 'tu-oneoff', onClick: () => openOneOff(id) }))),
      h('section', { class: 'card tu-sheet' },
        h('div', { class: 'card-head' }, h('h2', null, 'З таблиці')),
        h('div', { class: 'card-body form-stack' },
          !cfg().sheetId ? h('div', { class: 'subtle' }, 'Таблицю не підключено — записи уроків ведуться в CRM.', ' ', h('button', { type: 'button', class: 'link-like', onClick: () => openSettings() }, 'Підключити'))
            : !c ? h('div', { class: 'subtle' }, sheetStatus() === 'loading' ? 'Читаю таблицю…' : 'Таблицю ще не прочитано.')
              : !block ? h('div', { class: 'subtle tu-no-block' }, `У таблиці немає блоку «${s.sheetName || s.name}» — записи ведуться в CRM. Якщо в таблиці учень підписаний інакше, вкажи це в «Змінити» → «Імʼя в Google-таблиці».`)
                : [kv('Рівень', pl && pl.level), kv('Логіка', pl && pl.logic), kv('Підручники', pl && pl.books),
                  !pl ? h('div', { class: 'subtle' }, `На аркуші «${PLAN_SHEET}» учня немає.`) : null,
                  h('div', { class: 'tu-src subtle' }, `Блок «${block.name}» · ${fmt.count(block.cols.length, ['стовпець', 'стовпці', 'стовпців'])}`,
                    h('a', { href: sheetUrl(c.gidJournal, 'A' + block.row), target: '_blank', rel: 'noopener noreferrer', class: 'link-like tu-open-block' }, 'Відкрити', CRM.icon('external', { size: 'sm' })))])),
      h('section', { class: 'card tu-who' },
        h('div', { class: 'card-head' }, h('h2', null, 'Про учня')),
        h('div', { class: 'card-body form-stack' },
          kv('Мета', s.goal),
          s.examDate ? kv('Іспит', `${fmt.date(s.examDate)}${s.examDate >= T ? ' — ' + (s.examDate === T ? 'сьогодні' : 'через ' + fmt.count(D.diffDays(T, s.examDate), ['день', 'дні', 'днів'])) : ''}`) : null,
          kv('Звіт', s.reportTo === 'none' ? 'не надсилати' : to ? to.name + (s.reportTo === 'self' || !s.reportTo ? ' (сам учень)' : '') : 'не вибрано'),
          kv('Нотатки', s.notes),
          h('div', { class: 'btn-row' },
            me && CRM.people ? h('a', { href: CRM.router.href('people', { open: me.id }), class: 'btn btn-sm btn-ghost tu-person' }, CRM.icon('user', { size: 'sm' }), h('span', { class: 'btn-label' }, 'Картка в «Людях»')) : null,
            to && to.id !== (me && me.id) && CRM.people ? h('a', { href: CRM.router.href('people', { open: to.id }), class: 'btn btn-sm btn-ghost tu-person-to' }, CRM.icon('users', { size: 'sm' }), h('span', { class: 'btn-label' }, to.name)) : null))));
    const subLine = [pl && pl.level, s.goal, s.archived ? 'в архіві' : null].filter(Boolean).join(' · ');
    ui.mount(container, h('div', { class: 'page tu-page tu-student', style: { '--tu': colorOf(s) } },
      h('a', { href: '#/tutor', class: 'btn btn-ghost btn-sm tu-back' }, CRM.icon('chevronLeft', { size: 'sm' }), 'Усі учні'),
      ui.pageHead({
        title: s.name, sub: subLine || null,
        actions: [
          ui.button({ label: 'Змінити', icon: 'pencil', className: 'tu-edit', onClick: () => openForm(id) }),
          ui.button({ label: 'Разовий урок', icon: 'plus', variant: 'primary', className: 'tu-add-lesson', dataset: { hk: 'add' }, onClick: () => openOneOff(id) })
        ]
      }),
      cfg().sheetId && sheetStatus() !== 'ok' ? sheetBar() : null,
      h('div', { class: 'tu-two' }, left, right)));
  }
  function render(container, route) {
    const sub = route && route.sub;
    const p = (route && route.params) || {};
    const onSheet = () => CRM.router.rerender();
    document.addEventListener('crm:tutorsheet', onSheet);
    if (!sub) renderStudents(container);
    else if (sub === 'lessons') renderLessons(container);
    else if (sub === 'money' && CRM.tutorMoney) CRM.tutorMoney.renderPage(container, route);
    else renderStudent(container, sub);
    if (p.lesson && p.date) {
      const sid = p.lesson;
      const date = p.date;
      const rep = p.report === '1';
      CRM.router.consumeParam('lesson'); CRM.router.consumeParam('date'); CRM.router.consumeParam('report');
      setTimeout(() => openLessonOn(sid, date, { report: rep }), 0);
    }
    if (p.open) { const id = p.open; CRM.router.consumeParam('open'); setTimeout(() => openForm(id), 0); }
    // Підсумок за місяць (дзвіночок) і «Отримав оплату» — js/tutor-money.js
    if (p.summary && CRM.tutorMoney) { const sid = p.summary; const m = p.month; CRM.router.consumeParam('summary'); CRM.router.consumeParam('month'); setTimeout(() => CRM.tutorMoney.openSummary(sid, m), 0); }
    if (p.pay && CRM.tutorMoney) { const sid = p.pay; CRM.router.consumeParam('pay'); setTimeout(() => CRM.tutorMoney.openPayment(sid), 0); }
    if (cfg().sheetId && token()) ensureFresh();
    return () => document.removeEventListener('crm:tutorsheet', onSheet);
  }

  // ---------- Головна: «Уроки сьогодні» ----------
  function entryOn(s, date) { return timeline(s).entries.find((e) => e.key === 'L:' + date) || null; }
  function homeCard() {
    const T = D.today();
    const list = lessonsBetween(T, T).filter((L) => !get(L.sid).archived);
    const head = h('div', { class: 'card-head' },
      h('h2', null, 'Уроки сьогодні', list.length ? h('span', { class: 'tab-count' }, String(list.length)) : null),
      h('a', { href: '#/tutor/lessons', class: 'btn btn-ghost btn-sm' }, 'Усі уроки', CRM.icon('chevronRight', { size: 'sm' })));
    let body;
    if (!list.length) {
      const nx = lessonsBetween(D.addDays(T, 1), D.addDays(T, 14)).find((L) => !get(L.sid).archived);
      body = h('div', { class: 'card-body tu-home-none' },
        h('div', { class: 'subtle' }, 'Сьогодні уроків немає.'),
        nx ? h('button', { type: 'button', class: 'link-like tu-home-next', onClick: () => openLessonOn(nx.sid, nx.date) }, `Наступний: ${dayShort(nx.date)}${nx.start ? ', ' + nx.start : ''} — ${get(nx.sid).name}`) : null);
    } else {
      body = h('div', { class: 'tu-elist tu-home-list' }, list.map((L) => {
        const s = get(L.sid);
        return entryRow(s, entryOn(s, L.date) || { key: 'L:' + L.date, date: L.date, lesson: L, plan: '', what: '', hw: '', next: '' }, { name: true, rel: true });
      }));
    }
    const st = sheetStatus();
    const note = ['need-access', 'error'].includes(st) && all().some(linked)
      ? h('div', { class: 'card-foot tu-home-note' }, CRM.icon('alert', { size: 'sm' }), h('span', null, st === 'error' ? 'Таблиця: ' + lastError.text : 'Таблиця: доступ Google сплив — плани можуть бути не найсвіжіші.'),
        h('button', { type: 'button', class: 'link-like', onClick: () => (st === 'error' ? refresh({ toast: true }) : grantAccess()) }, st === 'error' ? 'Спробувати ще' : 'Оновити'))
      : null;
    return h('section', { class: 'card tu-home' }, head, body, note);
  }

  // ---------- Розклад на Головній ----------
  if (CRM.home && CRM.home.addScheduleSource) {
    CRM.home.addScheduleSource((date) => lessonsBetween(date, date).filter((L) => !get(L.sid).archived).map((L) => {
      const s = get(L.sid);
      const e = entryOn(s, date);
      const plan = e && (ended(L) ? whatOrPlan(e) : e.plan);
      return {
        time: L.start || null, kind: 'tutor', icon: 'board', cls: 'ico-learning', title: lessonTitle(s.name),
        sub: ['Урок', L.start ? `${L.start}–${hhmm(L.endMin)}` : null, plan ? oneLine(plan, 70) : null].filter(Boolean).join(' · '),
        badge: sentAt(s, date) ? { text: 'Звіт ✓', cls: 'badge-success' } : null,
        onClick: () => openLessonOn(s.id, date)
      };
    }));
  }

  // ---------- Нагадування «Надіслати звіт» ----------
  if (CRM.notify && CRM.notify.addRule) {
    CRM.notify.addRule(() => {
      if (!CRM.db.SCHEMA.students) return [];
      const T = D.today();
      const nm = nowMin();
      const out = [];
      lessonsBetween(D.addDays(T, -1), T).forEach((L) => {
        const s = get(L.sid);
        if (!s || s.archived || !wantsReport(s) || !ended(L, T, nm) || sentAt(s, L.date)) return;
        const to = reportPerson(s);
        out.push({
          key: `tutor:report:${s.id}:${L.date}`, kind: 'tutor', title: `Надіслати звіт: ${s.name}`,
          text: `Урок ${dayLong(L.date)}${L.start ? ', ' + L.start : ''} закінчився — звіт${to && to.id !== s.personId ? ' для «' + to.name + '»' : ''} готовий.`,
          target: { route: 'tutor', params: { lesson: s.id, date: L.date, report: '1' } }
        });
      });
      return out;
    });
  }

  // ---------- Для Календаря й пошуку ----------
  function colorOfEvent(ev) { const s = ev && ev.studentId ? get(ev.studentId) : null; return s ? colorOf(s) : null; }
  function subText(s) {
    const pl = planningOf(s);
    const nx = lessonsBetween(D.today(), D.addDays(D.today(), 30), s.id).find((L) => !ended(L));
    return [s.archived ? 'в архіві' : null, pl && pl.level, s.goal, nx ? `наступний урок ${dayShort(nx.date)}${nx.start ? ', ' + nx.start : ''}` : null].filter(Boolean).join(' · ');
  }

  // ---------- Запуск ----------
  function init() {
    if (isFile()) return;
    setTimeout(() => { if (cfg().sheetId && token()) refresh(); }, 2500);
    document.addEventListener('crm:minute', () => { if (cfg().sheetId && token()) ensureFresh(REFRESH_MS); });
    document.addEventListener('crm:googletoken', () => { if (cfg().sheetId && token()) refresh(); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && cfg().sheetId && token()) ensureFresh(REFRESH_MS); });
    // Посилання на таблицю змінилось (тут або на іншому пристрої) — прочитати нову
    let lastId = cfg().sheetId;
    CRM.store.on(['settings'], () => {
      const id = cfg().sheetId;
      if (id === lastId) return;
      lastId = id;
      lastError = null;
      changed();
      if (id && token()) refresh();
    });
    // Головна з блоком «Уроки сьогодні» — перемалювати, коли прочитано таблицю
    document.addEventListener('crm:tutorsheet', () => {
      if (document.querySelector('#page .home [data-block="tutor"]') && CRM.router.rerender) CRM.router.rerender();
    });
  }

  CRM.router.register('tutor', { title: 'Репетиторство', stores: ['students', 'events', 'people', 'settings'], render });

  CRM.tutor = {
    DEFAULT_TEMPLATE, COLORS, init, all, active, get, cfg, setCfg, cache, sheetStatus, refresh, grantAccess, ensureFresh,
    parseSheet, parseJournal, parsePlanning, parseDayMonth, assignYears, align, timeline, entryFor, sheetIdFrom, sheetUrl, colLetter, normName,
    blockOf, planningOf, linked, lessonsBetween, lessonsOf, lessonOn, slots, slotText, lessonTitle, fillTemplate, reportText, template,
    openLesson, openLessonOn, openReport, openForm, openSlot, openOneOff, openSettings, cancelLesson, removeStudent, setArchived,
    setLessonData, markSent, homeCard, colorOfEvent, subText, canSave, shiftedLessons, durText,
    studentOfTitle, isGoogleDuplicate, dupIndex, googleSlots, slotsFromGoogle,
    // для js/tutor-money.js (етап 2)
    lessonData, started, ended, whatOrPlan, reportPerson, wantsReport, copyText, sentText, dayShort, dayLong, relDay, oneLine, hhmm, minOf,
    usual, lessonCat, colorOf, personOf, listHead, sheetBar, tabsNav
  };
})(window.CRM);
