/* ==========================================================================
   gcal.js — Google Календар (читання й зміна подій), без сервера.

   Як це працює:
   • Вхід — бібліотека Google Identity Services (GIS), «token model»:
     google.accounts.oauth2.initTokenClient(...) → requestAccessToken().
     Google відкриває своє вікно входу й повертає тимчасовий ключ доступу
     (access token) приблизно на годину. Ключа для продовження (refresh token)
     у цій схемі немає, тож коли доступ спливає, потрібен клік
     «Оновити підключення» (зазвичай без повторного пароля).
   • Дані — Google Calendar API v3:
       GET /users/me/calendarList            (scope calendar.calendarlist.readonly; accessRole — чи можна писати)
       GET /calendars/{calendarId}/events    (scope calendar.events — читати й змінювати події)
     Зміна подій (пункт 12, з 2026.11.15-4): GET / PATCH / DELETE /calendars/{calendarId}/events/{eventId},
     POST /calendars/{calendarId}/events (sendUpdates: all | none). Окреме заняття серії має власний id
     (виняток; скасувати — PATCH status «cancelled»), уся серія — recurringEventId (поле recurrence — RRULE).
     Старий ключ доступу (до 2026.11.15-4, лише читання) — події видно, а змінити можна після «Оновити підключення».
   • Кольори (з 2026.11.15-5): подія — colorId (1–11, назви як у Google: Лаванда, Шавлія…), без нього — колір
     календаря (calendarList backgroundColor). Показуємо сучасні кольори Google (GCOLORS), підлаштовані під тему.
   • Копії подій CRM (дублювання, gmirror.js) — звичайні події Google з extendedProperties.private.crmId;
     у CRM вони не показуються (eventsOn / eventsBetween / нагадування їх пропускають), поки є подія CRM.
   • Те саме підключення дає доступ і іншим розділам, якщо їх увімкнено: Google Диск
     (копії, drive.file — backup.js) і Google-таблиця «Репетиторство» (лише читання,
     spreadsheets.readonly — tutor.js; accessToken('sheets')).
   • Google дозволяє вхід лише зі справжньої адреси сайту (https://… або
     http://localhost…), тому при відкритті index.html подвійним кліком
     (file://) календар недоступний.

   Налаштування (IndexedDB → settings):
     gcal       { clientId, wanted, calendars: [id…] | null }  — потрапляє в експорт
     gcalToken  { accessToken, expiresAt, list }               — НЕ експортується
     gcalCache  { at, base, from, to, calendars, events }      — НЕ експортується
   • Події завантажуються наперед: від тижня тому до ~2 місяців уперед (base — день,
     від якого рахували). Розділ «Календар» може попросити інші дні (ensureRange) —
     тоді до цього вікна додається потрібний проміжок (до ~13 місяців в обидва боки).
   ========================================================================== */
window.CRM = window.CRM || {};

(function (CRM) {
  'use strict';

  const { h, ui } = { h: CRM.ui.h, ui: CRM.ui };
  const D = CRM.date;

  const GIS_SRC = 'https://accounts.google.com/gsi/client';
  const API = 'https://www.googleapis.com/calendar/v3';
  const SCOPE_LIST = 'https://www.googleapis.com/auth/calendar.calendarlist.readonly';
  // Читати й змінювати події (до 2026.11.15-4 — calendar.events.readonly; старий ключ лише читає)
  const SCOPE_EVENTS = 'https://www.googleapis.com/auth/calendar.events';
  const SCOPES = SCOPE_LIST + ' ' + SCOPE_EVENTS;
  // Резервні копії на Google Диск (backup.js): доступ лише до файлів, які створила сама CRM
  const SCOPE_DRIVE = 'https://www.googleapis.com/auth/drive.file';
  const driveWanted = () => !!((CRM.store.getSetting('driveBackup', null) || {}).enabled);
  // «Репетиторство» (tutor.js): читати Google-таблицю з планами уроків — лише читання, лише коли таблицю підключено
  const SCOPE_SHEETS = 'https://www.googleapis.com/auth/spreadsheets.readonly';
  const sheetsWanted = () => !!((CRM.store.getSetting('tutor', null) || {}).sheetId);
  const scopes = () => SCOPES + (driveWanted() ? ' ' + SCOPE_DRIVE : '') + (sheetsWanted() ? ' ' + SCOPE_SHEETS : '');
  const REFRESH_MS = 10 * 60 * 1000;   // події оновлюються раз на 10 хв
  const REMIND_MIN = 15;               // нагадування за 15 хв до початку
  const WINDOW_BACK = 7;               // днів назад від сьогодні
  const WINDOW_AHEAD = 62;             // днів уперед (≈2 місяці)
  const EXTRA_LIMIT = 400;             // найдальші дні, які може попросити «Календар»
  const CLIENT_RE = /^\d+-[a-z0-9_]+\.apps\.googleusercontent\.com$/i;

  let gisPromise = null;
  let tokenClient = null;
  let tokenClientFor = null;
  let pending = null;       // очікування відповіді з вікна Google
  let refreshing = null;    // поточне завантаження подій
  let lastError = null;     // { text, code }
  let lastStatus = null;
  let extra = null;         // { from, to } — проміжок, який попросив «Календар» у цій сесії
  let lastEnsure = { key: '', at: 0 };

  const pad = (n) => String(n).padStart(2, '0');
  const isFile = () => location.protocol === 'file:';

  // ---------- Налаштування ----------
  function cfg() { return Object.assign({ clientId: '', wanted: false, calendars: null }, CRM.store.getSetting('gcal', null) || {}); }
  async function setCfg(changes) { await CRM.store.setSetting('gcal', Object.assign(cfg(), changes)); }
  function rawToken() { return CRM.store.getSetting('gcalToken', null); }
  function token() { const t = rawToken(); return t && t.accessToken && t.expiresAt > Date.now() ? t : null; }
  function cache() { const c = CRM.store.getSetting('gcalCache', null); return c && Array.isArray(c.events) ? c : null; }

  /** file | no-client | disconnected | expired | connected */
  function status() {
    if (isFile()) return 'file';
    const c = cfg();
    if (!c.clientId) return 'no-client';
    if (token()) return 'connected';
    return c.wanted ? 'expired' : 'disconnected';
  }

  function changed(detail) {
    lastStatus = status();
    document.dispatchEvent(new CustomEvent('crm:gcalchange', { detail: detail || {} }));
  }

  function err(code, text) { const e = new Error(text || code); e.code = code; return e; }

  // ---------- Час ----------
  /** Початок доби за Києвом як момент RFC 3339: '2026-09-26T21:00:00Z'. */
  function kyivStartISO(date) {
    const p0 = D.parse(date);
    const target = Date.UTC(p0.y, p0.m - 1, p0.d);
    let t = target;
    for (let i = 0; i < 2; i++) {
      const p = D.kyivParts(new Date(t));
      t += target - Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss);
    }
    return new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');
  }
  function hhmm(iso) { const p = D.kyivParts(new Date(iso)); return pad(p.hh) + ':' + pad(p.mm); }
  function timeOfDay(iso) { return iso ? hhmm(iso) : ''; }

  // ---------- Бібліотека входу Google ----------
  function gisReady() { return !!(window.google && google.accounts && google.accounts.oauth2); }

  function loadGis() {
    if (gisReady()) return Promise.resolve();
    if (gisPromise) return gisPromise;
    gisPromise = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = GIS_SRC;
      s.async = true;
      const fail = () => {
        gisPromise = null;
        s.remove();
        reject(err('gis', 'Не вдалося завантажити вікно входу Google. Перевір інтернет або вимкни блокувальник реклами для цього сайту.'));
      };
      s.onload = () => { if (gisReady()) resolve(); else fail(); };
      s.onerror = fail;
      document.head.appendChild(s);
    });
    return gisPromise;
  }

  function getTokenClient() {
    const id = cfg().clientId;
    const key = id + '|' + scopes();
    if (tokenClient && tokenClientFor === key) return tokenClient;
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: id,
      scope: scopes(),
      callback: onToken,
      error_callback: onTokenError
    });
    tokenClientFor = key;
    return tokenClient;
  }

  function onToken(resp) {
    const p = pending;
    pending = null;
    if (!p) return;
    if (!resp || resp.error) p.reject(err(resp && resp.error ? resp.error : 'unknown', resp && resp.error_description));
    else p.resolve(resp);
  }
  function onTokenError(e) {
    const p = pending;
    pending = null;
    if (p) p.reject(err((e && e.type) || 'unknown', e && e.message));
  }

  /** Відкрити вікно Google. prompt: undefined — вибір акаунта; '' — без зайвих питань (оновлення). */
  function requestToken(prompt) {
    return new Promise((resolve, reject) => {
      if (pending) pending.reject(err('superseded'));
      pending = { resolve, reject };
      const client = getTokenClient();
      if (prompt === undefined) client.requestAccessToken();
      else client.requestAccessToken({ prompt });
    });
  }

  function tokenErrorText(e) {
    switch (e.code) {
      case 'popup_failed_to_open': return 'Браузер заблокував вікно входу Google. Дозволь спливні вікна для цього сайту (значок праворуч в адресному рядку) і натисни ще раз.';
      case 'popup_closed': return 'Вікно входу закрито — підключення не завершено. Якщо Google показав помилку (напр., «origin_mismatch» або «invalid_client»), перевір Client ID і дозволену адресу сайту в Google Cloud.';
      case 'access_denied': return 'Доступ до календаря не надано.';
      case 'gis': case 'scope': return e.message;
      default: return 'Google не видав доступ' + (e.code && e.code !== 'unknown' ? ` (${e.code})` : '') + '. Перевір Client ID і налаштування в Google Cloud (README, розділ «Google Календар»).';
    }
  }

  // ---------- Підключення ----------
  async function connect(opts) {
    const o = opts || {};
    if (isFile()) {
      ui.toast('Google Календар працює лише на GitHub Pages або локальному сервері — не при відкритті файлу.', { type: 'error', duration: 7000 });
      return false;
    }
    if (!cfg().clientId) {
      ui.toast('Спершу вкажи Client ID у «Моєму кабінеті».', { type: 'error' });
      CRM.router.go('profile', { focus: 'gcal' });
      return false;
    }
    try {
      await loadGis();
      const resp = await requestToken(o.refresh ? '' : undefined);
      const oauth = google.accounts.oauth2;
      if (!oauth.hasGrantedAllScopes(resp, SCOPE_EVENTS)) {
        throw err('scope', 'Google не дав доступу до подій календаря. Натисни «Підключити» ще раз і залиш позначку біля доступу до календаря.');
      }
      const list = oauth.hasGrantedAllScopes(resp, SCOPE_LIST);
      const drive = oauth.hasGrantedAllScopes(resp, SCOPE_DRIVE);
      const sheets = oauth.hasGrantedAllScopes(resp, SCOPE_SHEETS);
      const secs = Number(resp.expires_in) || 3600;
      // write: ключ дає змінювати події (новий дозвіл calendar.events)
      await CRM.store.setSetting('gcalToken', { accessToken: resp.access_token, expiresAt: Date.now() + Math.max(60, secs - 60) * 1000, list, drive, sheets, write: true });
      await setCfg({ wanted: true });
      lastError = null;
      changed();
      document.dispatchEvent(new CustomEvent('crm:googletoken'));
      if (!o.quiet) ui.toast(o.refresh ? 'Підключення до Google оновлено' : 'Google Календар підключено', { type: 'success' });
      await refresh({ calendars: true });
      return true;
    } catch (e) {
      if (e.code === 'superseded') return false;
      lastError = { text: tokenErrorText(e), code: e.code };
      changed();
      ui.toast(lastError.text, { type: 'error', duration: 9000 });
      return false;
    }
  }

  async function disconnect() {
    const t = token();
    const ok = await ui.confirm({
      title: 'Відключити Google Календар?',
      message: (t
        ? 'Події зникнуть із Головної й Календаря, нагадувань про них не буде. Доступ, наданий цьому сайту в Google, буде відкликано.'
        : 'Події зникнуть із Головної й Календаря, нагадувань про них не буде. Термін доступу вже сплив, тож CRM більше не звертається до календаря.') +
        (driveWanted() ? ' Щоденні копії на Google Диск використовують це саме підключення — вони чекатимуть, доки ти знову не підключиш Google.' : '') +
        (sheetsWanted() ? ' Таблиця «Репетиторство» теж читається через це підключення — CRM показуватиме останнє збережене.' : ''),
      confirmText: 'Відключити'
    });
    if (!ok) return false;
    if (t && gisReady()) {
      try { google.accounts.oauth2.revoke(t.accessToken, () => {}); } catch (e) { /* доступ однаково забуваємо */ }
    }
    if (pending) { pending.reject(err('superseded')); pending = null; }
    await CRM.store.setSetting('gcalToken', null);
    await CRM.store.setSetting('gcalCache', null);
    await setCfg({ wanted: false });
    extra = null;
    lastError = null;
    changed();
    ui.toast('Google Календар відключено');
    return true;
  }

  // ---------- Запити до Calendar API ----------
  /**
   * Запит до Calendar API. method: GET | POST | PATCH | DELETE; body — обʼєкт (JSON) для POST/PATCH.
   * Помилки: e.code = expired | network | api-disabled | scope | rate | gone | http.
   */
  async function api(method, path, params, body) {
    const t = token();
    if (!t) throw err('expired', 'Доступ до Google Календаря сплив.');
    const qs = new URLSearchParams(params || {}).toString();
    const opts = { method, headers: { Authorization: 'Bearer ' + t.accessToken } };
    if (body !== undefined) {
      opts.headers['Content-Type'] = 'application/json';
      opts.body = JSON.stringify(body);
    }
    let res;
    try {
      res = await fetch(API + path + (qs ? '?' + qs : ''), opts);
    } catch (e) {
      throw err('network', 'Немає звʼязку з Google — спробую ще раз пізніше.');
    }
    if (res.status === 401) {
      await CRM.store.setSetting('gcalToken', null);
      throw err('expired', 'Доступ до Google Календаря сплив.');
    }
    if (!res.ok) {
      let msg = '';
      let reason = '';
      try {
        const j = await res.json();
        msg = (j.error && j.error.message) || '';
        reason = JSON.stringify((j.error && (j.error.errors || j.error.details)) || '');
      } catch (e) { /* відповідь не JSON */ }
      if (res.status === 403 && (/accessNotConfigured|SERVICE_DISABLED/.test(reason) || /has not been used|is disabled/i.test(msg))) {
        throw err('api-disabled', 'У проєкті Google Cloud не ввімкнено Google Calendar API. Увімкни його (README, розділ «Google Календар») і натисни «Оновити події».');
      }
      if (res.status === 403 && /insufficient/i.test(msg + reason)) {
        throw err('scope', method === 'GET'
          ? 'Бракує дозволу на читання календаря. Натисни «Відключити», потім «Підключити» й дозволь доступ.'
          : 'Google не дозволив CRM змінювати події. Натисни «Оновити підключення» й залиш галочку біля доступу до календаря.');
      }
      if (res.status === 429 || /rateLimit/i.test(reason)) throw err('rate', 'Google тимчасово обмежив кількість запитів — спробуй трохи пізніше.');
      if (method !== 'GET' && res.status === 403) throw err('forbidden', 'Google не дозволив змінити цю подію' + (msg ? `: ${msg}` : '.'));
      if (res.status === 404 || res.status === 410) throw err('gone', 'Цієї події вже немає в Google Календарі.');
      if (res.status === 409) throw err('conflict', 'Подія з таким ідентифікатором уже є в Google Календарі.');
      throw err('http', `Google відповів помилкою ${res.status}${msg ? ': ' + msg : ''}`);
    }
    if (res.status === 204 || method === 'DELETE') return null;
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  }
  const apiGet = (path, params) => api('GET', path, params);

  async function fetchCalendars(t) {
    if (!t.list) return [{ id: 'primary', summary: 'Основний календар', primary: true, selected: true, role: 'owner', tz: null, bg: null }];
    const out = [];
    let pageToken = null;
    let guard = 0;
    do {
      const params = { maxResults: '250' };
      if (pageToken) params.pageToken = pageToken;
      const j = await apiGet('/users/me/calendarList', params);
      (j.items || []).forEach((c) => {
        if (!c || !c.id || c.deleted) return;
        out.push({
          id: c.id, summary: String(c.summaryOverride || c.summary || c.id).slice(0, 120), primary: !!c.primary, selected: !!c.selected,
          role: typeof c.accessRole === 'string' ? c.accessRole : null, tz: typeof c.timeZone === 'string' ? c.timeZone : null,
          bg: /^#[0-9a-f]{6}$/i.test(c.backgroundColor || '') ? c.backgroundColor.toLowerCase() : null
        });
      });
      pageToken = j.nextPageToken || null;
      guard++;
    } while (pageToken && guard < 5);
    return out.sort((a, b) => (b.primary - a.primary) || a.summary.localeCompare(b.summary, 'uk'));
  }

  function normalizeEvent(ev, calId) {
    if (!ev || !ev.id || ev.status === 'cancelled' || !ev.start) return null;
    const me = (ev.attendees || []).find((a) => a && a.self);
    if (me && me.responseStatus === 'declined') return null;
    const allDay = !!ev.start.date && !ev.start.dateTime;
    const start = allDay ? ev.start.date : ev.start.dateTime;
    if (!start) return null;
    const end = allDay
      ? (ev.end && ev.end.date) || D.addDays(ev.start.date, 1)
      : (ev.end && ev.end.dateTime) || start;
    const out = {
      id: String(ev.id), cal: calId,
      title: String(ev.summary || '').trim().slice(0, 200) || '(без назви)',
      allDay, start, end,
      location: ev.location ? String(ev.location).slice(0, 200) : '',
      link: /^https:\/\//.test(ev.htmlLink || '') ? ev.htmlLink : null,
      tentative: ev.status === 'tentative'
    };
    // Для зміни з CRM (пункт 12): серія, опис, нагадування, хто організатор, чи є гості
    if (ev.recurringEventId) {
      out.rid = String(ev.recurringEventId);
      const o = ev.originalStartTime || {};
      out.ost = o.dateTime || o.date || start;
    }
    if (ev.description) out.desc = String(ev.description).slice(0, 8000);
    if (ev.start.timeZone) out.tz = String(ev.start.timeZone);
    if (ev.eventType && ev.eventType !== 'default') out.type = String(ev.eventType);
    // organizer.self Google пише лише як true (false — пропускає): немає — організатор хтось інший
    if (ev.organizer && !ev.organizer.self) out.notMine = true;
    if (ev.guestsCanModify) out.gcm = true;
    if (ev.privateCopy) out.privateCopy = true;
    // Колір події (1–11) і позначка копії події CRM (дублювання — gmirror.js)
    if (ev.colorId && /^\d{1,2}$/.test(String(ev.colorId))) out.color = String(ev.colorId);
    const ext = ev.extendedProperties && ev.extendedProperties.private;
    if (ext && typeof ext.crmId === 'string' && ext.crmId) out.crm = ext.crmId.slice(0, 100);
    if (ev.updated) out.upd = String(ev.updated);
    const guests = (ev.attendees || []).filter((a) => a && !a.self && !a.resource).length;
    if (guests) out.guests = guests;
    const r = ev.reminders;
    if (r && typeof r === 'object') {
      out.rem = r.useDefault ? 'default' : (Array.isArray(r.overrides) ? r.overrides : [])
        .filter((x) => x && Number.isFinite(Number(x.minutes)))
        .map((x) => ({ method: x.method === 'email' ? 'email' : 'popup', minutes: Number(x.minutes) }));
    }
    return out;
  }

  async function fetchEvents(calId, from, to) {
    const out = [];
    let pageToken = null;
    let guard = 0;
    do {
      const params = {
        timeMin: kyivStartISO(from), timeMax: kyivStartISO(D.addDays(to, 1)),
        singleEvents: 'true', orderBy: 'startTime', maxResults: '250'
      };
      if (pageToken) params.pageToken = pageToken;
      const j = await apiGet('/calendars/' + encodeURIComponent(calId) + '/events', params);
      (j.items || []).forEach((ev) => { const e = normalizeEvent(ev, calId); if (e) out.push(e); });
      pageToken = j.nextPageToken || null;
      guard++;
    } while (pageToken && guard < 4);
    return out;
  }

  /** Проміжок завантаження: від тижня тому до ~2 місяців уперед + те, що попросив «Календар». */
  function windowRange() {
    const base = D.today();
    let from = D.addDays(base, -WINDOW_BACK);
    let to = D.addDays(base, WINDOW_AHEAD);
    if (extra) {
      if (extra.from < from) from = extra.from;
      if (extra.to > to) to = extra.to;
    }
    return { base, from, to };
  }

  /** Завантажити події на весь проміжок (сьогодні й завтра — для Головної й нагадувань). */
  function refresh(opts) {
    const o = opts || {};
    if (refreshing) return refreshing;
    if (status() !== 'connected') return Promise.resolve(false);
    refreshing = (async () => {
      changed({ busy: true });
      // Коли почали завантажувати: зміни, надіслані в Google пізніше, у цьому кеші можуть ще не відбитись (gmirror.js)
      const started = new Date().toISOString();
      try {
        const t = token();
        const prev = cache();
        // Кеш календарів до 2026.11.15-5 — без кольору (bg): перечитати список
        const keep = prev && prev.calendars && prev.calendars.length && !o.calendars && prev.calendars.every((c) => 'bg' in c);
        const calendars = keep ? prev.calendars : await fetchCalendars(t);
        let selected = cfg().calendars;
        if (!Array.isArray(selected)) {
          selected = calendars.filter((c) => c.primary || c.selected).map((c) => c.id);
          if (!selected.length && calendars[0]) selected = [calendars[0].id];
          await setCfg({ calendars: selected });
        }
        const { base, from, to } = windowRange();
        const events = [];
        for (const c of calendars) {
          if (selected.indexOf(c.id) === -1) continue;
          (await fetchEvents(c.id, from, to)).forEach((e) => events.push(e));
        }
        events.sort((a, b) => eventStartMs(a) - eventStartMs(b));
        await CRM.store.setSetting('gcalCache', { at: new Date().toISOString(), started, base, from, to, calendars, events });
        lastError = null;
        return true;
      } catch (e) {
        lastError = e.code === 'expired' ? null : { text: e.message, code: e.code };
        if (o.manual && lastError) ui.toast(lastError.text, { type: 'error', duration: 8000 });
        return false;
      } finally {
        refreshing = null;
        changed();
        CRM.notify.runRules();
        // Поки завантажувались події, у Google щось змінили з CRM — завантажити ще раз
        if (refreshAgain) { refreshAgain = false; setTimeout(() => refresh(), 0); }
      }
    })();
    return refreshing;
  }

  function eventStartMs(e) { return e.allDay ? Date.parse(kyivStartISO(e.start)) : Date.parse(e.start); }

  // ---------- Зміна подій з CRM (пункт 12) ----------
  // Календарі, де можна писати (accessRole зі списку календарів; основний без списку — свій)
  const WRITE_ROLES = ['owner', 'writer', 'writerWithoutPrivateAccess'];
  // Часовий пояс нових подій, якщо в календаря свого не вказано (повторюваним Google його вимагає)
  const TZ_DEFAULT = 'Europe/Kiev';
  const enc = encodeURIComponent;

  function calInfo(id) {
    const c = cache();
    return (c && c.calendars && c.calendars.find((x) => x.id === id)) || null;
  }
  function calWritable(id) {
    const cal = calInfo(id);
    if (!cal) return id === 'primary';
    const role = cal.role || (cal.primary ? 'owner' : null);
    return WRITE_ROLES.indexOf(role) !== -1;
  }
  function calLabel(id) {
    const cal = calInfo(id);
    return cal ? (cal.primary ? 'основний' : cal.summary) : 'основний';
  }
  /** Календарі, у які можна додати нову подію: показані в CRM і з правом запису (основний — першим). */
  function writableCalendars() {
    if (isFile() || !cfg().wanted) return [];
    const c = cache();
    if (!c || !c.calendars) return [];
    const sel = cfg().calendars || [];
    return c.calendars.filter((x) => sel.indexOf(x.id) !== -1 && calWritable(x.id));
  }
  function calendarTz(id) { const cal = calInfo(id); return (cal && cal.tz) || TZ_DEFAULT; }

  // ---------- Кольори (з 2026.11.15-5) ----------
  // colorId події 1–11 — назви як у Google Календарі (Apps Script EventColor: 1 Lavender … 11 Tomato);
  // відтінки — як у сучасному вигляді Google (API colors.get віддає старі пастельні).
  const GCOLORS = [
    { id: '11', name: 'Томат', hex: '#d50000' }, { id: '4', name: 'Фламінго', hex: '#e67c73' },
    { id: '6', name: 'Мандарин', hex: '#f4511e' }, { id: '5', name: 'Банан', hex: '#f6bf26' },
    { id: '2', name: 'Шавлія', hex: '#33b679' }, { id: '10', name: 'Базилік', hex: '#0b8043' },
    { id: '7', name: 'Павич', hex: '#039be5' }, { id: '9', name: 'Чорниця', hex: '#3f51b5' },
    { id: '1', name: 'Лаванда', hex: '#7986cb' }, { id: '3', name: 'Виноград', hex: '#8e24aa' },
    { id: '8', name: 'Графіт', hex: '#616161' }
  ];
  const rgbOf = (hex) => { const n = parseInt(String(hex).slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
  const hexOf = (rgb) => '#' + rgb.map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, '0')).join('');
  function luminance(hex) {
    return rgbOf(hex).map((v) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); })
      .reduce((a, c, i) => a + c * [0.2126, 0.7152, 0.0722][i], 0);
  }
  const mix = (hex, to, k) => { const a = rgbOf(hex); const b = rgbOf(to); return hexOf(a.map((v, i) => v + (b[i] - v) * k)); };
  /** Колір, що читається на тлі теми: у світлій — пастельні темнішають, у темній — темні світлішають. */
  function readable(hex) {
    if (!/^#[0-9a-f]{6}$/i.test(hex || '')) return null;
    const dark = document.documentElement.getAttribute('data-theme') === 'dark';
    const L = luminance(hex);
    if (dark && L < 0.16) return mix(hex, '#ffffff', 0.32);
    if (!dark && L > 0.6) return mix(hex, '#000000', 0.32);
    return hex.toLowerCase();
  }
  const gColorHex = (id) => { const c = GCOLORS.find((x) => x.id === String(id)); return c ? c.hex : null; };
  /** Колір календаря Google (з його налаштувань) або бірюзовий CRM. */
  function calColor(cal) {
    const c = calInfo(cal);
    return (c && readable(c.bg)) || CRM.dict.categoryColor('teal');
  }
  /** Колір події Google у CRM: свій (colorId) або колір її календаря. */
  function colorOf(e) {
    const own = e && e.color ? gColorHex(e.color) : null;
    return own ? readable(own) : calColor(e && e.cal);
  }
  /** Відтінок (0–360), світлота й насиченість (0–1) — для порівняння кольорів «на око». */
  function hslOf(hex) {
    const [r, g, b] = rgbOf(hex).map((v) => v / 255);
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const l = (max + min) / 2;
    const d = max - min;
    if (!d) return { h: 0, s: 0, l };
    const s = d / (1 - Math.abs(2 * l - 1));
    let h;
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
    return { h: (h + 360) % 360, s: Math.min(1, s), l };
  }
  /** Найближчий колір Google до кольору (hex) — напр., для категорії CRM у копії події: спершу відтінок (для сірих — світлота). */
  function nearestColor(hex) {
    if (!/^#[0-9a-f]{6}$/i.test(hex || '')) return null;
    const a = hslOf(hex);
    let best = null;
    let bd = Infinity;
    GCOLORS.forEach((c) => {
      const b = hslOf(c.hex);
      let dh = Math.abs(a.h - b.h);
      if (dh > 180) dh = 360 - dh;
      const d = 3 * Math.min(a.s, b.s) * (dh / 180) ** 2 + (a.l - b.l) ** 2 + 0.5 * (a.s - b.s) ** 2;
      if (d < bd) { bd = d; best = c.id; }
    });
    return best;
  }

  // ---------- Копії подій CRM (дублювання — gmirror.js) ----------
  /** id події CRM, копією якої є ця подія Google (або null). */
  function copyOf(e) {
    if (!e) return null;
    if (e.crm) return e.crm;
    return CRM.gmirror && CRM.gmirror.crmIdOf ? CRM.gmirror.crmIdOf(e.cal, e.rid || e.id) : null;
  }
  /** Копію не показуємо в CRM, поки є сама подія CRM (вона показується своєю). */
  function isCopy(e) {
    const id = copyOf(e);
    return !!(id && CRM.store.get('events', id));
  }

  /** Чи триває подія з часом через північ (такі тут не перетягуємо й час не змінюємо). */
  function crossesMidnight(e) {
    if (e.allDay) return false;
    return D.toKyivDate(e.start) !== D.toKyivDate(new Date(Math.max(Date.parse(e.end) - 1, Date.parse(e.start))));
  }

  /**
   * Чи можна змінити подію з CRM: { ok, why, drag }.
   * Доступ, що сплив, не заважає — перед збереженням CRM попросить «Оновити підключення».
   */
  function editInfo(e) {
    if (!e || isFile() || !cfg().wanted) return { ok: false, drag: false, why: 'Google Календар не підключено.' };
    if (!calWritable(e.cal)) {
      return { ok: false, drag: false, why: `Календар «${calLabel(e.cal)}» — лише для перегляду: змінити подію можна тільки в самому Google Календарі.` };
    }
    if (e.type) {
      return { ok: false, drag: false, why: 'Це особлива подія Google («Не на роботі», «Робоче місце», «Час для зосередження», день народження з контактів чи подія з Gmail) — її можна змінити лише в Google Календарі.' };
    }
    if (e.notMine && !e.gcm) {
      return { ok: false, drag: false, why: 'Це запрошення від іншої людини — змінити час чи назву може лише організатор.' };
    }
    return { ok: true, drag: !crossesMidnight(e), why: null };
  }

  // --- Час ---
  /** Момент «дата + хвилини від півночі» за Києвом як RFC 3339 у UTC: '2026-11-16T08:00:00Z'. */
  function kyivISO(date, min) {
    const p0 = D.parse(date);
    const target = Date.UTC(p0.y, p0.m - 1, p0.d, 0, Number(min) || 0);
    let t = target;
    for (let i = 0; i < 3; i++) {
      const p = D.kyivParts(new Date(t));
      t += target - Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss);
    }
    return new Date(t).toISOString().replace(/\.\d{3}Z$/, 'Z');
  }
  const minOf = (hm) => { const m = /^(\d{1,2}):(\d{2})$/.exec(hm || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : 0; };

  /** Опис Google буває з HTML (жирний, посилання) — у формі показуємо текстом. Розбір без завантаження картинок і скриптів. */
  function textOf(desc) {
    const s = String(desc || '');
    if (!/<[a-z!/]/i.test(s)) return s;
    const html = s.replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d)>/gi, '\n');
    try {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      return (doc.body ? doc.body.textContent : '').replace(/\n{3,}/g, '\n\n').trim();
    } catch (e) { return s.replace(/<[^>]*>/g, ''); }
  }

  /** Нагадування Google у вигляді для форми: 'default' | 'none' | хвилини | 'custom' (кілька чи email). */
  function remindOf(e) {
    const r = e.rem;
    if (r === undefined || r === 'default') return 'default';
    if (!r.length) return 'none';
    if (r.length === 1 && r[0].method === 'popup') return r[0].minutes;
    return 'custom';
  }
  function remindBody(v) {
    if (v === 'default') return { useDefault: true };
    if (v === 'none') return { useDefault: false, overrides: [] };
    const n = Number(v);
    return Number.isFinite(n) ? { useDefault: false, overrides: [{ method: 'popup', minutes: Math.max(0, Math.min(40320, Math.round(n))) }] } : null;
  }

  /** Подія Google (з кешу) → поля форми CRM. */
  function toModel(e) {
    const m = {
      title: e.title === '(без назви)' ? '' : e.title, note: textOf(e.desc), location: e.location || '',
      gremind: remindOf(e), cal: e.cal, gcolor: e.color || ''
    };
    if (e.allDay) {
      const last = D.addDays(e.end, -1);
      return Object.assign(m, { date: e.start, endDate: last > e.start ? last : null, allDay: true, start: null, dur: null });
    }
    const dur = Math.max(1, Math.round((Date.parse(e.end) - Date.parse(e.start)) / 60000));
    return Object.assign(m, { date: D.toKyivDate(e.start), endDate: null, allDay: false, start: hhmm(e.start), dur });
  }

  /** start/end для Google з полів форми. Поле іншого виду явно стирається (null) — інакше PATCH їх змішав би. */
  function timesBody(v, tz) {
    if (v.allDay) {
      return { start: { date: v.date, dateTime: null, timeZone: null }, end: { date: D.addDays(v.endDate || v.date, 1), dateTime: null, timeZone: null } };
    }
    const s = kyivISO(v.date, minOf(v.start));
    const en = new Date(Date.parse(s) + (Number(v.dur) || 60) * 60000).toISOString().replace(/\.\d{3}Z$/, 'Z');
    return { start: { dateTime: s, timeZone: tz || TZ_DEFAULT, date: null }, end: { dateTime: en, timeZone: tz || TZ_DEFAULT, date: null } };
  }

  // --- Правила повтору (RRULE, RFC 5545) ↔ правило CRM { freq, every, days, until, count } ---
  const BYDAY = ['MO', 'TU', 'WE', 'TH', 'FR', 'SA', 'SU'];   // 0 — понеділок, як у CRM
  const FREQ_OF = { DAILY: 'day', WEEKLY: 'week', MONTHLY: 'month', YEARLY: 'year' };
  const FREQ_TO = { day: 'DAILY', week: 'WEEKLY', month: 'MONTHLY', year: 'YEARLY' };

  function rruleParts(line) {
    const parts = {};
    String(line || '').replace(/^RRULE:/i, '').split(';').forEach((kv) => {
      const i = kv.indexOf('=');
      if (i > 0) parts[kv.slice(0, i).toUpperCase()] = kv.slice(i + 1);
    });
    return parts;
  }
  function rruleLine(parts) {
    const order = ['FREQ', 'INTERVAL', 'BYDAY', 'BYMONTHDAY', 'BYMONTH', 'UNTIL', 'COUNT', 'WKST'];
    const keys = Object.keys(parts).sort((a, b) => {
      const ia = order.indexOf(a); const ib = order.indexOf(b);
      return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
    });
    return 'RRULE:' + keys.filter((k) => parts[k] !== undefined && parts[k] !== null && parts[k] !== '').map((k) => k + '=' + parts[k]).join(';');
  }
  /** UNTIL з RRULE → дата за Києвом (або null, якщо не розібрати). */
  function untilDate(v) {
    let m = /^(\d{4})(\d{2})(\d{2})$/.exec(v || '');
    if (m) return `${m[1]}-${m[2]}-${m[3]}`;
    m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(v || '');
    if (m) return D.toKyivDate(new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6])));
    return null;
  }
  /** Дата → UNTIL: «весь день» — РРРРММДД; з часом — кінець цього дня за Києвом у UTC. */
  function untilValue(date, allDay) {
    if (allDay) return date.replace(/-/g, '');
    const ms = Date.parse(kyivISO(D.addDays(date, 1), 0)) - 1000;
    return new Date(ms).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
  }

  /**
   * Розібрати recurrence серії: { rule (як у CRM) | null, simple, rrule, extra (інші рядки — EXDATE тощо) }.
   * simple — правило вміщається у форму CRM (щодня / щотижня в певні дні / щомісяця / щороку, до дати / N разів).
   */
  function parseRecurrence(lines, firstDate) {
    const list = (Array.isArray(lines) ? lines : []).map(String);
    const rr = list.filter((l) => /^RRULE:/i.test(l));
    const extra = list.filter((l) => !/^RRULE:/i.test(l));
    if (rr.length !== 1) return { rule: null, simple: false, rrule: rr[0] || null, extra };
    const p = rruleParts(rr[0]);
    const freq = FREQ_OF[String(p.FREQ || '').toUpperCase()];
    const known = ['FREQ', 'INTERVAL', 'BYDAY', 'UNTIL', 'COUNT', 'WKST', 'BYMONTHDAY', 'BYMONTH'];
    let simple = !!freq && Object.keys(p).every((k) => known.indexOf(k) !== -1);
    const every = p.INTERVAL ? Number(p.INTERVAL) : 1;
    if (!(Number.isInteger(every) && every >= 1 && every <= 99)) simple = false;
    let days = null;
    if (freq === 'week') {
      if (p.BYDAY) {
        const ds = p.BYDAY.split(',').map((x) => BYDAY.indexOf(x.trim().toUpperCase()));
        if (ds.some((i) => i < 0)) simple = false;
        else days = Array.from(new Set(ds)).sort((a, b) => a - b);
      } else if (D.isDate(firstDate)) days = [D.weekday(firstDate)];
    } else if (p.BYDAY) simple = false;
    const fd = D.isDate(firstDate) ? D.parse(firstDate) : null;
    if (p.BYMONTHDAY && !((freq === 'month' || freq === 'year') && fd && Number(p.BYMONTHDAY) === fd.d)) simple = false;
    if (p.BYMONTH && !(freq === 'year' && fd && Number(p.BYMONTH) === fd.m)) simple = false;
    let until = null;
    if (p.UNTIL) { until = untilDate(p.UNTIL); if (!until) simple = false; }
    let count = null;
    if (p.COUNT) { count = Number(p.COUNT); if (!(Number.isInteger(count) && count >= 1)) simple = false; }
    const rule = simple ? { freq, every, days: freq === 'week' ? days : null, until, count: until ? null : count } : null;
    return { rule, simple, rrule: rr[0], extra, parts: p };
  }

  /** Правило CRM → рядок RRULE. */
  function buildRRule(rule, allDay) {
    const p = { FREQ: FREQ_TO[rule.freq] };
    if (rule.every && rule.every > 1) p.INTERVAL = String(rule.every);
    if (rule.freq === 'week' && rule.days && rule.days.length) p.BYDAY = rule.days.slice().sort((a, b) => a - b).map((i) => BYDAY[i]).join(',');
    if (rule.until) p.UNTIL = untilValue(rule.until, allDay);
    else if (rule.count) p.COUNT = String(rule.count);
    return rruleLine(p);
  }
  /** Той самий RRULE, що закінчується датою date (COUNT прибирається). */
  function rruleUntil(line, date, allDay) {
    const p = rruleParts(line);
    delete p.COUNT;
    p.UNTIL = untilValue(date, allDay);
    return rruleLine(p);
  }
  /** Той самий RRULE з іншою кількістю разів (UNTIL лишається, якщо був). */
  function rruleCount(line, n) {
    const p = rruleParts(line);
    if (p.COUNT) p.COUNT = String(Math.max(1, n));
    return rruleLine(p);
  }
  /** Зсунути дні тижня (BYDAY) на delta днів — коли серію переносять на інший день. */
  function rruleShift(line, delta) {
    const p = rruleParts(line);
    const d = ((delta % 7) + 7) % 7;
    if (!d || !p.BYDAY) return line;
    const ds = p.BYDAY.split(',').map((x) => BYDAY.indexOf(x.trim().toUpperCase()));
    if (ds.some((i) => i < 0)) return line;
    p.BYDAY = Array.from(new Set(ds.map((i) => (i + d) % 7))).sort((a, b) => a - b).map((i) => BYDAY[i]).join(',');
    return rruleLine(p);
  }

  // --- Запити змін ---
  const evPath = (cal, id) => `/calendars/${enc(cal)}/events` + (id ? '/' + enc(id) : '');
  const sendOf = (send) => (send ? { sendUpdates: send } : null);

  function getEvent(cal, id) { return api('GET', evPath(cal, id)); }
  async function patchEvent(cal, id, body, send) {
    const r = await api('PATCH', evPath(cal, id), sendOf(send), body);
    await applyToCache(r, cal);
    return r;
  }
  async function insertEvent(cal, body, send) {
    const r = await api('POST', evPath(cal), sendOf(send), body);
    await applyToCache(r, cal);
    return r;
  }
  async function deleteEvent(cal, id, send) {
    await api('DELETE', evPath(cal, id), sendOf(send));
    await dropFromCache(cal, id);
    return null;
  }

  // --- Кеш одразу після зміни (не чекаючи 10 хв), потім — перевірка в Google ---
  async function saveEvents(c, events) {
    events.sort((a, b) => eventStartMs(a) - eventStartMs(b));
    await CRM.store.setSetting('gcalCache', Object.assign({}, c, { events }));
    changed();
  }
  async function applyToCache(r, cal) {
    const c = cache();
    if (!r || !c) { refreshSoon(); return; }
    // Серія (з recurrence) — у кеші лежать окремі заняття: їх перерахує Google
    if (Array.isArray(r.recurrence) && r.recurrence.length) { refreshSoon(); return; }
    const events = c.events.filter((x) => !(x.cal === cal && x.id === String(r.id)));
    const e = normalizeEvent(r, cal);
    if (e && (cfg().calendars || []).indexOf(cal) !== -1) events.push(e);
    await saveEvents(c, events);
    // Перенесене заняття серії могло змінити й інші дні — коротка перевірка
    if (r.recurringEventId) refreshSoon();
  }
  async function dropFromCache(cal, id) {
    const c = cache();
    if (!c) return;
    // Видалили всю серію — прибрати й усі її заняття
    await saveEvents(c, c.events.filter((x) => !(x.cal === cal && (x.id === id || x.rid === id))));
    refreshSoon();
  }
  let refreshAgain = false;
  function refreshSoon() {
    if (refreshing) { refreshAgain = true; return refreshing; }
    return refresh();
  }

  // --- Доступ сплив / бракує дозволу: «Оновити підключення» й та сама зміна ще раз ---
  function writeNeed() {
    const t = token();
    if (!t) return 'expired';
    if (!t.write) return 'scope';
    return null;
  }
  function askReconnect(need) {
    return ui.confirm({
      title: need === 'scope' ? 'Дозволь CRM змінювати події Google' : 'Доступ до Google сплив',
      message: need === 'scope'
        ? 'Досі CRM лише читала Google Календар. Натисни «Оновити підключення» — у вікні Google залиш галочку біля доступу до календаря, і зміна збережеться.'
        : 'Google видає доступ приблизно на годину. Натисни «Оновити підключення» (зазвичай один клік без пароля) — і зміна збережеться в Google Календарі.',
      confirmText: 'Оновити підключення'
    });
  }
  function failText(e) {
    if (e.code === 'network') return 'Немає звʼязку з Google — подію не змінено.';
    if (e.code === 'gone') return 'Цієї події вже немає в Google Календарі (її змінили чи видалили деінде) — оновлюю.';
    return e.message || 'Google не зберіг зміну.';
  }
  /**
   * Виконати зміну в Google. fn — async-функція з запитами (patchEvent, insertEvent…).
   * Повертає { ok, value } або { ok: false, cancelled } — тоді Календар повертає подію на місце.
   * opts.quiet — без тосту про помилку (його покаже той, хто викликав; уроки «Репетиторства», 2026.11.16-1).
   */
  async function run(fn, opts) {
    const quiet = !!(opts && opts.quiet);
    const attempt = async () => { try { return { ok: true, value: await fn() }; } catch (e) { return { ok: false, e }; } };
    const fail = (r) => {
      if (r.e && r.e.code === 'gone') refreshSoon();
      if (!quiet) ui.toast(failText(r.e || {}), { type: 'error', duration: 8000 });
      changed();
      return r;
    };
    let need = writeNeed();
    if (!need) {
      const r = await attempt();
      if (r.ok) return r;
      if (r.e.code !== 'expired' && r.e.code !== 'scope') return fail(r);
      need = r.e.code;
    }
    changed();
    const go = await askReconnect(need);
    if (!go) return { ok: false, cancelled: true };
    const ok = await connect({ refresh: true, quiet: true });
    if (!ok) return { ok: false, cancelled: true };
    if (writeNeed()) return fail({ e: err('scope', 'Google не дав дозволу змінювати події — залиш галочку біля доступу до календаря у вікні Google.') });
    const r2 = await attempt();
    return r2.ok ? r2 : fail(r2);
  }

  /** Підключення є, але ключ лише читає (до 2026.11.15-4): підказка «Онови підключення». */
  function readOnlyToken() { const t = token(); return !!(t && !t.write); }

  async function setCalendarSelected(id, on) {
    const cur = (cfg().calendars || []).filter((x) => x !== id);
    if (on) cur.push(id);
    await setCfg({ calendars: cur });
    changed();
    return refresh();
  }

  // ---------- Події на дату ----------
  function occursOn(e, date) {
    if (e.allDay) return e.start <= date && date < e.end;
    const s = D.toKyivDate(e.start);
    const endMs = Math.max(Date.parse(e.end) - 1, Date.parse(e.start));
    const en = D.toKyivDate(new Date(endMs));
    return s <= date && date <= en;
  }

  function eventsOn(date) {
    if (isFile() || !cfg().wanted) return [];
    const c = cache();
    if (!c || date < c.from || date > c.to) return [];
    return c.events.filter((e) => occursOn(e, date) && !isCopy(e));
  }

  /** Події, що зачіпають проміжок [from, to] (для розділу «Календар»). */
  function eventsBetween(from, to) {
    if (isFile() || !cfg().wanted) return [];
    const c = cache();
    if (!c || to < c.from || from > c.to) return [];
    return c.events.filter((e) => {
      if (isCopy(e)) return false;
      if (e.allDay) return e.start <= to && e.end > from;
      const s = D.toKyivDate(e.start);
      const en = D.toKyivDate(new Date(Math.max(Date.parse(e.end) - 1, Date.parse(e.start))));
      return s <= to && en >= from;
    });
  }

  /** Який проміжок дат зараз завантажено (або null). */
  function loadedRange() {
    if (isFile() || !cfg().wanted) return null;
    const c = cache();
    return c ? { from: c.from, to: c.to, at: c.at } : null;
  }

  /**
   * «Календар» показує дні [from, to]. Якщо їх ще не завантажено, а доступ дійсний —
   * завантажити (результат прийде подією crm:gcalchange). Повертає true, якщо завантаження почалося або вже йде.
   */
  function ensureRange(from, to) {
    if (status() !== 'connected' || !D.isDate(from) || !D.isDate(to)) return false;
    const c = cache();
    if (c && c.base === D.today() && from >= c.from && to <= c.to) return false;
    const T = D.today();
    const lo = D.addDays(T, -EXTRA_LIMIT);
    const hi = D.addDays(T, EXTRA_LIMIT);
    const f = from < lo ? lo : from;
    const t = to > hi ? hi : to;
    if (f > t) return false;
    if (c && c.base === T && f >= c.from && t <= c.to) return false;
    if (refreshing) return true;
    const key = f + '|' + t;
    // Після помилки не смикаємо Google щоразу, коли сторінка перемальовується
    if (lastError && key === lastEnsure.key && Date.now() - lastEnsure.at < REFRESH_MS) return false;
    lastEnsure = { key, at: Date.now() };
    extra = { from: f, to: t };
    refresh();
    return true;
  }

  /** Назва календаря для підпису (основний не підписуємо — там зазвичай адреса пошти). */
  function calendarName(id) {
    const c = cache();
    const cal = c && c.calendars && c.calendars.find((x) => x.id === id);
    return cal && !cal.primary ? cal.summary : '';
  }

  function openEvent(e) {
    if (e && e.link) window.open(e.link, '_blank', 'noopener,noreferrer');
    else ui.toast('Подію можна відкрити в Google Календарі.');
  }

  // ---------- Розклад на Головній ----------
  CRM.home.addScheduleSource((date) => {
    // «Заняття Макс», коли того дня є урок Макса в CRM, — показує tutor.js (без дублів)
    const list = eventsOn(date).filter((e) => !(CRM.tutor && CRM.tutor.isGoogleDuplicate && CRM.tutor.isGoogleDuplicate(e, date)));
    const multi = (cfg().calendars || []).length > 1;
    return list.map((e) => {
      const startsToday = !e.allDay && D.toKyivDate(e.start) === date;
      let when;
      if (e.allDay) when = 'весь день';
      else if (startsToday) when = `${hhmm(e.start)}–${hhmm(e.end)}`;
      else when = `триває до ${hhmm(e.end)}`;
      const parts = ['Google Календар', when];
      if (e.location) parts.push(e.location);
      if (multi) { const n = calendarName(e.cal); if (n) parts.push(n); }
      return {
        time: startsToday ? hhmm(e.start) : null,
        kind: 'event', icon: 'calendar', cls: 'ico-event',
        title: e.title, sub: parts.join(' · '),
        badge: e.tentative ? { text: 'Під питанням', cls: '' } : null,
        // Клік — та сама форма, що й у Календарі (змінити, видалити, «Відкрити в Google»)
        onClick: () => (CRM.calendar && CRM.calendar.openGoogle ? CRM.calendar.openGoogle(e, date) : openEvent(e))
      };
    });
  });

  // ---------- Нагадування за 15 хвилин ----------
  CRM.notify.addRule(() => {
    if (isFile() || !cfg().wanted) return [];
    const c = cache();
    if (!c) return [];
    const now = Date.now();
    return c.events.filter((e) => !e.allDay && !isCopy(e)).map((e) => {
      const left = Date.parse(e.start) - now;
      if (!(left > 0 && left <= REMIND_MIN * 60000)) return null;
      // урок, який є і в CRM, — нагадує CRM (за своїм часом), без дубля
      if (CRM.tutor && CRM.tutor.isGoogleDuplicate && CRM.tutor.isGoogleDuplicate(e, D.toKyivDate(e.start))) return null;
      const mins = Math.max(1, Math.round(left / 60000));
      return {
        key: `event:${e.id}:${e.start}`, kind: 'event',
        title: `Через ${mins} хв: ${e.title}`,
        text: `Google Календар · початок о ${hhmm(e.start)}` + (e.location ? ` · ${e.location}` : ''),
        target: e.link ? { url: e.link } : { route: 'home' }
      };
    }).filter(Boolean);
  });

  // ---------- Підпис під розкладом на Головній ----------
  /** Client ID є (напр., прийшов синхронізацією), але на цьому пристрої вхід у Google не зроблено. */
  function neverHere() { return !!cfg().clientId && !rawToken() && !cache(); }

  /** Підпис + стан дублювання подій CRM у Google (gmirror.js: «Чекають надсилання…», «Видалено в Google…»). */
  function statusNote() {
    const base = statusNoteBase();
    const more = CRM.gmirror && CRM.gmirror.noteParts ? CRM.gmirror.noteParts() : null;
    return more ? h('span', null, base, more) : base;
  }
  function statusNoteBase() {
    const s = status();
    const c = cache();
    const link = (text, onClick) => h('button', { type: 'button', class: 'link-like', onClick }, text);
    if (s === 'file') return h('span', null, 'Google Календар працює лише на GitHub Pages або локальному сервері, не з файлу.');
    if ((s === 'expired' || s === 'disconnected') && neverHere()) {
      return h('span', null, 'Google Календар не підключено на цьому пристрої · ', link('Підключити', () => connect()));
    }
    if (s === 'no-client' || s === 'disconnected') {
      return h('span', null, 'Google Календар не підключено · ', link('Підключити', () => CRM.router.go('profile', { focus: 'gcal' })));
    }
    if (s === 'expired') {
      return h('span', null,
        'Доступ до Google Календаря сплив' + (c ? ` (події станом на ${hhmm(c.at)})` : '') + ' · ',
        link('Оновити підключення', () => connect({ refresh: true })));
    }
    if (lastError) return h('span', null, 'Google Календар: ' + lastError.text + ' ', link('Спробувати ще', () => refresh({ manual: true })));
    if (!c) return h('span', null, refreshing ? 'Завантажую події Google Календаря…' : 'Google Календар підключено');
    const n = eventsOn(D.today()).length;
    return h('span', null,
      `Google Календар: ${n ? CRM.fmt.count(n, ['подія', 'події', 'подій']) + ' сьогодні' : 'подій сьогодні немає'} · оновлено о ${hhmm(c.at)} · `,
      link('Оновити', () => refresh({ manual: true })),
      // Ключ доступу ще старий (лише читання) — підказка, як дозволити зміни
      readOnlyToken() ? h('span', { class: 'gcal-ro-note' }, ' · Щоб змінювати події Google тут, ', link('онови підключення', () => connect({ refresh: true }))) : null);
  }

  // ---------- Блок у «Моєму кабінеті» ----------
  function settingsBlock() {
    const clientIn = ui.input({ id: 'gcal-client', value: cfg().clientId, placeholder: '1234567890-abc…apps.googleusercontent.com', maxlength: 200, spellcheck: false });
    const saveBtn = ui.button({ label: 'Зберегти', size: 'sm', disabled: true });
    const fClient = ui.field({
      label: 'Client ID', id: 'gcal-client', input: h('div', { class: 'sub-row', id: 'gcal-client-row' }, clientIn, saveBtn),
      hint: 'Тип клієнта в Google Cloud — «Web application». Client ID не секретний і не потрапляє в код сайту; з увімкненою синхронізацією він сам зʼявиться на інших твоїх пристроях.'
    });
    const onInput = () => {
      fClient.setError(null);
      saveBtn.disabled = clientIn.value.trim() === cfg().clientId;
    };
    clientIn.addEventListener('input', onInput);
    clientIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (!saveBtn.disabled) save(); } });
    saveBtn.addEventListener('click', save);

    async function save() {
      const v = clientIn.value.trim();
      if (v && !CLIENT_RE.test(v)) {
        fClient.setError('Не схоже на Client ID. Він має закінчуватися на .apps.googleusercontent.com — скопіюй його повністю з Google Cloud.');
        return;
      }
      const old = cfg().clientId;
      await setCfg({ clientId: v, calendars: v === old ? cfg().calendars : null, wanted: v === old ? cfg().wanted : false });
      if (v !== old) {
        tokenClient = null;
        await CRM.store.setSetting('gcalToken', null);
        await CRM.store.setSetting('gcalCache', null);
      }
      lastError = null;
      saveBtn.disabled = true;
      if (v) loadGis().catch(() => {});
      changed();
      ui.toast(v ? 'Client ID збережено — тепер натисни «Підключити»' : 'Client ID видалено', { type: 'success' });
    }

    let shownId = cfg().clientId;   // що показано в полі (щоб не затерти те, що людина друкує)
    const head = h('div', { class: 'setting-row' });
    const body = h('div', { class: 'gcal-body' });
    const block = h('div', { class: 'gcal-block', id: 'gcal' }, head, body);

    function badge(s, fresh) {
      if (fresh) return h('span', { class: 'badge', 'data-status': s }, 'не підключено');
      const map = {
        file: ['badge-warning', 'недоступно з файлу'], 'no-client': ['', 'не налаштовано'],
        disconnected: ['', 'не підключено'], expired: ['badge-warning', 'доступ сплив'], connected: ['badge-success', 'підключено']
      };
      const m = map[s];
      return h('span', { class: 'badge ' + m[0], 'data-status': s }, m[1]);
    }

    function render() {
      const s = status();
      const c = cfg();
      const ch = cache();
      const t = token();
      const actions = [];
      if (s === 'no-client' || s === 'disconnected' || s === 'file') {
        actions.push(ui.button({ label: 'Підключити', icon: 'link', variant: 'primary', size: 'sm', disabled: s !== 'disconnected', title: s === 'no-client' ? 'Спершу вкажи Client ID' : null, onClick: () => connect() }));
      }
      const fresh = (s === 'expired' || s === 'disconnected') && neverHere();
      if (fresh && s === 'expired') actions.push(ui.button({ label: 'Підключити', icon: 'link', variant: 'primary', size: 'sm', onClick: () => connect() }));
      else if (s === 'expired') actions.push(ui.button({ label: 'Оновити підключення', icon: 'refresh', variant: 'primary', size: 'sm', onClick: () => connect({ refresh: true }) }));
      // Ключ ще старий (лише читання) — дозволити CRM змінювати події (пункт 12)
      if (s === 'connected' && readOnlyToken()) actions.push(ui.button({ label: 'Дозволити зміни', icon: 'link', variant: 'primary', size: 'sm', className: 'gcal-allow-write', onClick: () => connect({ refresh: true }) }));
      if (s === 'connected') actions.push(ui.button({ label: refreshing ? 'Оновлюю…' : 'Оновити події', icon: 'refresh', size: 'sm', disabled: !!refreshing, onClick: () => refresh({ manual: true }) }));
      if (s === 'connected' || (s === 'expired' && !fresh)) actions.push(ui.button({ label: 'Відключити', size: 'sm', onClick: () => disconnect() }));

      ui.mount(head,
        h('div', { class: 'setting-text' },
          h('div', { class: 'setting-title' }, CRM.icon('calendar', { size: 'sm' }), 'Google Календар', badge(s, fresh)),
          h('div', { class: 'setting-desc' }, `Події видно в розділі «Календар» і в розкладі на Головній, за ${REMIND_MIN} хв до початку — нагадування. Змінювати, видаляти й додавати події Google можна прямо в «Календарі».`)),
        h('div', { class: 'setting-actions' }, actions));

      clientIn.disabled = s === 'connected' || s === 'expired';
      if (clientIn.disabled || clientIn.value.trim() === shownId) clientIn.value = c.clientId;
      shownId = c.clientId;
      saveBtn.disabled = clientIn.disabled || clientIn.value.trim() === c.clientId;

      const parts = [];
      if (s === 'file') {
        parts.push(h('div', { class: 'callout callout-warning' }, CRM.icon('alert'),
          h('span', null, h('strong', null, 'Сайт відкрито як файл.'), ' Google дозволяє вхід лише зі справжньої адреси сайту. Відкрий CRM на GitHub Pages або через локальний сервер (як — у README), там і підключай календар. Дані в кожній адресі окремі — перенось їх експортом та імпортом.')));
      }
      parts.push(fClient);
      if (!isFile()) {
        parts.push(h('div', { class: 'gcal-origin' },
          h('span', { class: 'subtle' }, 'Адреса цього сайту для Google Cloud (Authorized JavaScript origins):'),
          h('code', { class: 'gcal-code' }, location.origin),
          ui.button({ label: 'Копіювати', icon: 'copy', size: 'sm', variant: 'ghost', onClick: () => copyText(location.origin) })));
      }
      if ((s === 'connected' || s === 'expired') && ch && ch.calendars && ch.calendars.length) {
        const sel = c.calendars || [];
        parts.push(h('div', { class: 'gcal-cals' },
          h('div', { class: 'setting-title' }, 'Які календарі показувати'),
          ch.calendars.map((cal) => {
            const on = sel.indexOf(cal.id) !== -1;
            return h('button', {
              type: 'button', class: 'gcal-cal', role: 'checkbox', 'aria-checked': on ? 'true' : 'false', disabled: s !== 'connected',
              onClick: () => setCalendarSelected(cal.id, !on)
            },
            h('span', { class: 'task-check small' + (on ? ' checked' : '') }, CRM.icon('check', { size: 'sm' })),
            h('span', { class: 'gcal-cal-name' }, cal.summary),
            cal.primary ? h('span', { class: 'badge' }, 'основний') : null);
          })));
      }
      // Дублювання подій CRM у Google (gmirror.js)
      if ((s === 'connected' || s === 'expired') && !fresh && CRM.gmirror && CRM.gmirror.settingsPart) parts.push(CRM.gmirror.settingsPart());
      const info = [];
      if (s === 'connected') {
        info.push(`Доступ діє до ${hhmm(new Date(t.expiresAt + 60000).toISOString())}.`);
        if (ch) info.push(`Події оновлено о ${hhmm(ch.at)} (далі — кожні 10 хв, поки сайт відкритий), завантажено з ${CRM.fmt.dateShort(ch.from)} по ${CRM.fmt.dateShort(ch.to)}.`);
        if (readOnlyToken()) info.push('Поки CRM лише читає події: натисни «Дозволити зміни» — Google попросить дозвіл змінювати події, і їх можна буде переносити, змінювати й видаляти прямо в «Календарі».');
      }
      if (s === 'expired' && ch) info.push(`Показано події станом на ${hhmm(ch.at)}.`);
      if (fresh) info.push('Client ID уже є. Натисни «Підключити», щоб увійти в Google на цьому пристрої.');
      if (s !== 'file') {
        parts.push(h('div', { class: 'gcal-info' },
          info.length ? h('div', null, info.join(' ')) : null,
          h('div', null, 'Google видає доступ приблизно на годину і без сервера не продовжує його сам. Коли доступ спливе, натисни «Оновити підключення» — зазвичай це один клік без пароля.'),
          h('div', null, 'Покрокове налаштування Google Cloud — у файлі README.md, розділ «Google Календар».')));
      }
      if (lastError) {
        parts.push(h('div', { class: 'callout callout-warning gcal-error', role: 'alert' }, CRM.icon('alert'), h('span', null, lastError.text)));
      }
      ui.mount(body, parts);
    }
    render();

    const onChange = () => render();
    document.addEventListener('crm:gcalchange', onChange);
    if (cfg().clientId && !isFile()) loadGis().catch(() => {});
    block._destroy = () => document.removeEventListener('crm:gcalchange', onChange);
    return block;
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      ui.toast('Скопійовано: ' + text, { type: 'success' });
    } catch (e) {
      ui.toast('Не вдалося скопіювати — виділи адресу мишкою й натисни Ctrl+C.', { type: 'error' });
    }
  }

  // ---------- Запуск ----------
  function tick() {
    const s = status();
    if (s !== lastStatus) changed();
    if (s !== 'connected') return;
    const c = cache();
    const stale = !c || c.base !== D.today() || Date.now() - Date.parse(c.at) >= REFRESH_MS;
    if (stale && !lastErrorBlocks()) refresh();
  }
  // Після помилки налаштувань (API вимкнено, бракує дозволу) не смикаємо Google щохвилини
  let lastAuto = 0;
  function lastErrorBlocks() {
    if (!lastError) return false;
    if (Date.now() - lastAuto < REFRESH_MS) return true;
    lastAuto = Date.now();
    return false;
  }

  function init() {
    lastStatus = status();
    if (isFile()) return;
    const c = cfg();
    if (c.clientId && c.wanted) loadGis().catch(() => {});
    if (lastStatus === 'connected') refresh();
    document.addEventListener('crm:minute', tick);
    document.addEventListener('crm:daychange', () => { if (status() === 'connected') refresh(); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') tick(); });
    // Після імпорту чи очищення даних
    CRM.store.on(['*'], () => { tokenClient = null; lastError = null; tick(); });
    // Client ID прийшов з іншого пристрою (синхронізація) — одразу показати й підготувати вхід
    let lastId = cfg().clientId;
    CRM.store.on(['settings'], () => {
      const id = cfg().clientId;
      if (id === lastId) return;
      lastId = id;
      tokenClient = null;
      if (id) loadGis().catch(() => {});
      changed();
    });
  }

  /** Дійсний ключ доступу Google (для backup.js, tutor.js); need: 'drive' / 'sheets' — лише якщо дано доступ до Диска / таблиць. */
  function accessToken(need) {
    const t = token();
    if (!t) return null;
    if (need === 'drive' && !t.drive) return null;
    if (need === 'sheets' && !t.sheets) return null;
    return t.accessToken;
  }
  /** Ключ став недійсним (напр., Google відповів 401) — забути його. */
  async function dropToken() { await CRM.store.setSetting('gcalToken', null); changed(); }

  CRM.gcal = {
    SCOPES, SCOPE_EVENTS, SCOPE_DRIVE, SCOPE_SHEETS, init, status, connect, disconnect, refresh, statusNote, settingsBlock, accessToken, dropToken,
    eventsOn, eventsBetween, loadedRange, ensureRange, occursOn, openEvent, calendarName, hhmm,
    kyivStartISO, isValidClientId: (v) => CLIENT_RE.test(String(v || '').trim()),
    // Зміна подій з CRM (пункт 12)
    editInfo, crossesMidnight, writableCalendars, calWritable, calLabel, calendarTz, readOnlyToken, run,
    toModel, timesBody, remindBody, remindOf, textOf, kyivISO,
    parseRecurrence, buildRRule, rruleUntil, rruleCount, rruleShift, untilValue, untilDate,
    getEvent, patchEvent, insertEvent, deleteEvent, refreshSoon,
    // Кольори й дублювання (2026.11.15-5)
    GCOLORS, colorOf, calColor, nearestColor, readable, copyOf, isCopy,
    api, cache, cfg, setCfg, writeNeed, normalize: normalizeEvent, evPath, isFile: () => isFile(),
    primaryCalendar: () => { const c = cache(); const p = c && c.calendars && c.calendars.find((x) => x.primary); return p ? p.id : 'primary'; },
    selectedCalendars: () => cfg().calendars || []
  };
})(window.CRM);
