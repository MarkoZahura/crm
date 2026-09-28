/* ==========================================================================
   gcal.js — Google Календар (лише читання), без сервера.

   Як це працює:
   • Вхід — бібліотека Google Identity Services (GIS), «token model»:
     google.accounts.oauth2.initTokenClient(...) → requestAccessToken().
     Google відкриває своє вікно входу й повертає тимчасовий ключ доступу
     (access token) приблизно на годину. Ключа для продовження (refresh token)
     у цій схемі немає, тож коли доступ спливає, потрібен клік
     «Оновити підключення» (зазвичай без повторного пароля).
   • Дані — Google Calendar API v3 (лише читання):
       GET /users/me/calendarList            (scope calendar.calendarlist.readonly)
       GET /calendars/{calendarId}/events    (scope calendar.events.readonly)
   • Google дозволяє вхід лише зі справжньої адреси сайту (https://… або
     http://localhost…), тому при відкритті index.html подвійним кліком
     (file://) календар недоступний.

   Налаштування (IndexedDB → settings):
     gcal       { clientId, wanted, calendars: [id…] | null }  — потрапляє в експорт
     gcalToken  { accessToken, expiresAt, list }               — НЕ експортується
     gcalCache  { at, from, to, calendars, events }            — НЕ експортується
   ========================================================================== */
window.CRM = window.CRM || {};

(function (CRM) {
  'use strict';

  const { h, ui } = { h: CRM.ui.h, ui: CRM.ui };
  const D = CRM.date;

  const GIS_SRC = 'https://accounts.google.com/gsi/client';
  const API = 'https://www.googleapis.com/calendar/v3';
  const SCOPE_LIST = 'https://www.googleapis.com/auth/calendar.calendarlist.readonly';
  const SCOPE_EVENTS = 'https://www.googleapis.com/auth/calendar.events.readonly';
  const SCOPES = SCOPE_LIST + ' ' + SCOPE_EVENTS;
  const REFRESH_MS = 10 * 60 * 1000;   // події оновлюються раз на 10 хв
  const REMIND_MIN = 15;               // нагадування за 15 хв до початку
  const CLIENT_RE = /^\d+-[a-z0-9_]+\.apps\.googleusercontent\.com$/i;

  let gisPromise = null;
  let tokenClient = null;
  let tokenClientFor = null;
  let pending = null;       // очікування відповіді з вікна Google
  let refreshing = null;    // поточне завантаження подій
  let lastError = null;     // { text, code }
  let lastStatus = null;

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
    if (tokenClient && tokenClientFor === id) return tokenClient;
    tokenClient = google.accounts.oauth2.initTokenClient({
      client_id: id,
      scope: SCOPES,
      callback: onToken,
      error_callback: onTokenError
    });
    tokenClientFor = id;
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
      const secs = Number(resp.expires_in) || 3600;
      await CRM.store.setSetting('gcalToken', { accessToken: resp.access_token, expiresAt: Date.now() + Math.max(60, secs - 60) * 1000, list });
      await setCfg({ wanted: true });
      lastError = null;
      changed();
      ui.toast(o.refresh ? 'Підключення до Google Календаря оновлено' : 'Google Календар підключено', { type: 'success' });
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
      message: t
        ? 'Події зникнуть із Головної, нагадувань про них не буде. Доступ, наданий цьому сайту в Google, буде відкликано.'
        : 'Події зникнуть із Головної, нагадувань про них не буде. Термін доступу вже сплив, тож CRM більше не звертається до календаря.',
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
    lastError = null;
    changed();
    ui.toast('Google Календар відключено');
    return true;
  }

  // ---------- Запити до Calendar API ----------
  async function apiGet(path, params) {
    const t = token();
    if (!t) throw err('expired', 'Доступ до Google Календаря сплив.');
    const qs = new URLSearchParams(params || {}).toString();
    let res;
    try {
      res = await fetch(API + path + (qs ? '?' + qs : ''), { headers: { Authorization: 'Bearer ' + t.accessToken } });
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
        throw err('scope', 'Бракує дозволу на читання календаря. Натисни «Відключити», потім «Підключити» й дозволь доступ.');
      }
      if (res.status === 429 || /rateLimit/i.test(reason)) throw err('rate', 'Google тимчасово обмежив кількість запитів — спробую пізніше.');
      throw err('http', `Google відповів помилкою ${res.status}${msg ? ': ' + msg : ''}`);
    }
    return res.json();
  }

  async function fetchCalendars(t) {
    if (!t.list) return [{ id: 'primary', summary: 'Основний календар', primary: true, selected: true }];
    const out = [];
    let pageToken = null;
    let guard = 0;
    do {
      const params = { maxResults: '250' };
      if (pageToken) params.pageToken = pageToken;
      const j = await apiGet('/users/me/calendarList', params);
      (j.items || []).forEach((c) => {
        if (!c || !c.id || c.deleted) return;
        out.push({ id: c.id, summary: String(c.summaryOverride || c.summary || c.id).slice(0, 120), primary: !!c.primary, selected: !!c.selected });
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
    return {
      id: String(ev.id), cal: calId,
      title: String(ev.summary || '').trim().slice(0, 200) || '(без назви)',
      allDay, start, end,
      location: ev.location ? String(ev.location).slice(0, 200) : '',
      link: /^https:\/\//.test(ev.htmlLink || '') ? ev.htmlLink : null,
      tentative: ev.status === 'tentative'
    };
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

  /** Завантажити події на сьогодні й завтра (завтра — для нагадувань після півночі). */
  function refresh(opts) {
    const o = opts || {};
    if (refreshing) return refreshing;
    if (status() !== 'connected') return Promise.resolve(false);
    refreshing = (async () => {
      changed({ busy: true });
      try {
        const t = token();
        const prev = cache();
        const calendars = prev && prev.calendars && prev.calendars.length && !o.calendars ? prev.calendars : await fetchCalendars(t);
        let selected = cfg().calendars;
        if (!Array.isArray(selected)) {
          selected = calendars.filter((c) => c.primary || c.selected).map((c) => c.id);
          if (!selected.length && calendars[0]) selected = [calendars[0].id];
          await setCfg({ calendars: selected });
        }
        const from = D.today();
        const to = D.addDays(from, 1);
        const events = [];
        for (const c of calendars) {
          if (selected.indexOf(c.id) === -1) continue;
          (await fetchEvents(c.id, from, to)).forEach((e) => events.push(e));
        }
        events.sort((a, b) => eventStartMs(a) - eventStartMs(b));
        await CRM.store.setSetting('gcalCache', { at: new Date().toISOString(), from, to, calendars, events });
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
      }
    })();
    return refreshing;
  }

  function eventStartMs(e) { return e.allDay ? Date.parse(kyivStartISO(e.start)) : Date.parse(e.start); }

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
    return c.events.filter((e) => occursOn(e, date));
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
    const list = eventsOn(date);
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
        onClick: () => openEvent(e)
      };
    });
  });

  // ---------- Нагадування за 15 хвилин ----------
  CRM.notify.addRule(() => {
    if (isFile() || !cfg().wanted) return [];
    const c = cache();
    if (!c) return [];
    const now = Date.now();
    return c.events.filter((e) => !e.allDay).map((e) => {
      const left = Date.parse(e.start) - now;
      if (!(left > 0 && left <= REMIND_MIN * 60000)) return null;
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
  function statusNote() {
    const s = status();
    const c = cache();
    const link = (text, onClick) => h('button', { type: 'button', class: 'link-like', onClick }, text);
    if (s === 'file') return h('span', null, 'Google Календар працює лише на GitHub Pages або локальному сервері, не з файлу.');
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
      link('Оновити', () => refresh({ manual: true })));
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

    const head = h('div', { class: 'setting-row' });
    const body = h('div', { class: 'gcal-body' });
    const block = h('div', { class: 'gcal-block', id: 'gcal' }, head, body);

    function badge(s) {
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
      if (s === 'expired') actions.push(ui.button({ label: 'Оновити підключення', icon: 'refresh', variant: 'primary', size: 'sm', onClick: () => connect({ refresh: true }) }));
      if (s === 'connected') actions.push(ui.button({ label: refreshing ? 'Оновлюю…' : 'Оновити події', icon: 'refresh', size: 'sm', disabled: !!refreshing, onClick: () => refresh({ manual: true }) }));
      if (s === 'connected' || s === 'expired') actions.push(ui.button({ label: 'Відключити', size: 'sm', onClick: () => disconnect() }));

      ui.mount(head,
        h('div', { class: 'setting-text' },
          h('div', { class: 'setting-title' }, CRM.icon('calendar', { size: 'sm' }), 'Google Календар', badge(s)),
          h('div', { class: 'setting-desc' }, `Лише читання. Події на сьогодні зʼявляються в розкладі на Головній, за ${REMIND_MIN} хв до початку — нагадування.`)),
        h('div', { class: 'setting-actions' }, actions));

      clientIn.disabled = s === 'connected' || s === 'expired';
      if (clientIn.disabled) clientIn.value = c.clientId;
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
          h('div', { class: 'setting-title' }, 'Календарі на Головній'),
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
      const info = [];
      if (s === 'connected') {
        info.push(`Доступ діє до ${hhmm(new Date(t.expiresAt + 60000).toISOString())}.`);
        if (ch) info.push(`Події оновлено о ${hhmm(ch.at)} (далі — кожні 10 хв, поки сайт відкритий).`);
      }
      if (s === 'expired' && ch) info.push(`Показано події станом на ${hhmm(ch.at)}.`);
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
    const stale = !c || c.from !== D.today() || Date.now() - Date.parse(c.at) >= REFRESH_MS;
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
  }

  CRM.gcal = {
    SCOPES, init, status, connect, disconnect, refresh, statusNote, settingsBlock,
    eventsOn, kyivStartISO, isValidClientId: (v) => CLIENT_RE.test(String(v || '').trim())
  };
})(window.CRM);
