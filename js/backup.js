/* ==========================================================================
   backup.js — щоденна резервна копія на Google Диск.

   • Раз на день (коли CRM відкрито на будь-якому пристрої) у папку
     «Моя CRM — резервні копії» на Google Диску записується файл
     crm-backup-РРРР-ММ-ДД.json — такий самий, як «Експортувати», але без
     вкладених файлів. Зберігаються останні 30 копій, старіші — у Кошик Диска.
   • Доступ — через те саме підключення Google, що й Календар (gcal.js), з
     дозволом drive.file: CRM бачить лише файли, які створила сама.
   • Сервера немає, тож якщо доступ Google сплив (≈ година), копія чекає:
     у дзвіночку зʼявляється нагадування, а «Оновити підключення» її запускає.
   • Налаштування driveBackup синхронізується — копію за день робить один пристрій.

   Google Drive API v3: files.list / files.create (multipart) / files.update.
   ========================================================================== */
window.CRM = window.CRM || {};

(function (CRM) {
  'use strict';

  const { h, ui } = { h: CRM.ui.h, ui: CRM.ui };
  const D = CRM.date;
  const API = 'https://www.googleapis.com/drive/v3';
  const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
  const FOLDER_NAME = 'Моя CRM — резервні копії';
  const FOLDER_MIME = 'application/vnd.google-apps.folder';
  const FILE_RE = /^crm-backup-\d{4}-\d{2}-\d{2}\.json$/;
  const SETTING = 'driveBackup';
  const RETRY_MS = 10 * 60 * 1000;

  let running = null;
  let lastError = null;      // { text, code }
  let lastFailAt = 0;
  let bootAt = Date.now();

  const pad = (n) => String(n).padStart(2, '0');
  const isFile = () => location.protocol === 'file:';

  function cfg() { return Object.assign({ enabled: false, keep: 30, folderId: null, lastDate: null, lastAt: null, lastSize: null }, CRM.store.getSetting(SETTING, null) || {}); }
  async function setCfg(changes) { await CRM.store.setSetting(SETTING, Object.assign(cfg(), changes)); }
  function changed() { document.dispatchEvent(new CustomEvent('crm:backupchange')); }
  function err(code, text) { const e = new Error(text || code); e.code = code; return e; }

  /** off | done | waiting | running | error */
  function status() {
    const c = cfg();
    if (!c.enabled) return 'off';
    if (running) return 'running';
    if (lastError) return 'error';
    if (c.lastDate === D.today()) return 'done';
    return 'waiting';
  }

  // ---------- Google Drive API ----------
  async function api(method, url, opts) {
    const o = opts || {};
    const token = CRM.gcal.accessToken('drive');
    if (!token) throw err('no-token', 'Потрібне підключення Google з доступом до Диска.');
    const headers = Object.assign({ Authorization: 'Bearer ' + token }, o.headers || {});
    let res;
    try {
      res = await fetch(url, { method, headers, body: o.body });
    } catch (e) {
      throw err('network', 'Немає звʼязку з Google Диском — спробую пізніше.');
    }
    if (res.status === 401) { await CRM.gcal.dropToken(); throw err('no-token', 'Доступ Google сплив.'); }
    if (res.status === 404 && o.allow404) return null;
    if (!res.ok) {
      let msg = '';
      let reason = '';
      try {
        const j = await res.json();
        msg = (j.error && j.error.message) || '';
        reason = JSON.stringify((j.error && (j.error.errors || j.error.details)) || '');
      } catch (e) { /* не JSON */ }
      if (res.status === 403 && (/accessNotConfigured|SERVICE_DISABLED/.test(reason) || /has not been used|is disabled/i.test(msg))) {
        throw err('api-disabled', 'У Google Cloud не ввімкнено Google Drive API. Увімкни його (README, розділ «Резервні копії на Google Диск») і натисни «Зробити копію зараз».');
      }
      if (res.status === 403 && /insufficient/i.test(msg + reason)) {
        throw err('scope', 'Google не дав доступу до Диска. Натисни «Зробити копію зараз» і дозволь CRM створювати файли на Диску.');
      }
      if (res.status === 403 && /storageQuota|quota/i.test(msg + reason)) throw err('quota', 'На Google Диску закінчилося місце.');
      throw err('http', `Google Диск відповів помилкою ${res.status}${msg ? ': ' + msg : ''}`);
    }
    return res.status === 204 ? null : res.json();
  }

  const q = (s) => encodeURIComponent(s);

  async function ensureFolder() {
    const c = cfg();
    if (c.folderId) {
      const f = await api('GET', `${API}/files/${q(c.folderId)}?fields=id,trashed`, { allow404: true });
      if (f && !f.trashed) return c.folderId;
    }
    const found = await api('GET', `${API}/files?q=${q(`name='${FOLDER_NAME}' and mimeType='${FOLDER_MIME}' and trashed=false`)}&fields=${q('files(id,name)')}&spaces=drive`);
    let id = found && found.files && found.files[0] && found.files[0].id;
    if (!id) {
      const created = await api('POST', `${API}/files?fields=id`, {
        headers: { 'Content-Type': 'application/json; charset=UTF-8' },
        body: JSON.stringify({ name: FOLDER_NAME, mimeType: FOLDER_MIME })
      });
      id = created.id;
    }
    await setCfg({ folderId: id });
    return id;
  }

  async function listBackups(folderId) {
    const r = await api('GET', `${API}/files?q=${q(`'${folderId}' in parents and trashed=false`)}&fields=${q('files(id,name,size)')}&orderBy=${q('name desc')}&pageSize=200&spaces=drive`);
    return ((r && r.files) || []).filter((f) => FILE_RE.test(f.name));
  }

  async function uploadNew(folderId, name, content) {
    const boundary = 'crm' + Math.random().toString(36).slice(2);
    const meta = { name, parents: [folderId], mimeType: 'application/json', description: 'Резервна копія «Моя CRM» (без вкладених файлів)' };
    const body = `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n` +
      `--${boundary}\r\nContent-Type: application/json\r\n\r\n${content}\r\n--${boundary}--`;
    return api('POST', `${UPLOAD}/files?uploadType=multipart&fields=${q('id,name,size')}`, {
      headers: { 'Content-Type': `multipart/related; boundary=${boundary}` }, body
    });
  }

  async function uploadUpdate(fileId, content) {
    return api('PATCH', `${UPLOAD}/files/${q(fileId)}?uploadType=media&fields=${q('id,name,size')}`, {
      headers: { 'Content-Type': 'application/json' }, body: content
    });
  }

  async function trash(fileId) {
    return api('PATCH', `${API}/files/${q(fileId)}?fields=id`, {
      headers: { 'Content-Type': 'application/json; charset=UTF-8' }, body: JSON.stringify({ trashed: true })
    });
  }

  // ---------- Копія ----------
  /** Зробити копію за сьогодні. opts.manual — показувати результат тостом. */
  function run(opts) {
    const o = opts || {};
    if (running) return running;
    running = (async () => {
      changed();
      try {
        const folderId = await ensureFolder();
        const name = `crm-backup-${D.today()}.json`;
        const content = JSON.stringify(await CRM.store.exportAll({ attachments: false }), null, 1);
        const list = await listBackups(folderId);
        const existing = list.find((f) => f.name === name);
        if (existing) await uploadUpdate(existing.id, content);
        else await uploadNew(folderId, name, content);
        const all = existing ? list : [{ name }].concat(list);
        const keep = Math.max(1, Number(cfg().keep) || 30);
        const extra = all.filter((f) => f.id).sort((a, b) => b.name.localeCompare(a.name)).slice(keep - (existing ? 0 : 1));
        for (const f of extra) await trash(f.id);
        await setCfg({ lastDate: D.today(), lastAt: new Date().toISOString(), lastSize: new Blob([content]).size });
        lastError = null;
        lastFailAt = 0;
        if (o.manual) ui.toast('Резервну копію збережено на Google Диск', { type: 'success' });
        return true;
      } catch (e) {
        lastFailAt = Date.now();
        if (e.code === 'no-token') { lastError = null; return false; }
        lastError = { text: e.message, code: e.code };
        if (o.manual) ui.toast(e.message, { type: 'error', duration: 9000 });
        return false;
      } finally {
        running = null;
        changed();
      }
    })();
    return running;
  }

  /** Зробити копію, якщо сьогодні її ще не було й доступ Google є. */
  function maybeRun() {
    const c = cfg();
    if (isFile() || !c.enabled || running || c.lastDate === D.today()) return;
    if (Date.now() - bootAt < 15000) return;                  // дати синхронізації підтягнути «вже зроблено» з іншого пристрою
    if (lastFailAt && Date.now() - lastFailAt < RETRY_MS) return;
    if (!CRM.gcal.accessToken('drive')) return;
    run();
  }

  /** Кнопка: увімкнути / «Зробити копію зараз» — за потреби спершу оновити доступ Google. */
  async function runNow() {
    if (!CRM.gcal.accessToken('drive')) {
      const ok = await CRM.gcal.connect({ refresh: true, quiet: true });
      if (!ok) return false;
      if (!CRM.gcal.accessToken('drive')) {
        lastError = { text: 'Google не дав доступу до Диска. Натисни ще раз і дозволь CRM створювати файли на Диску.', code: 'scope' };
        changed();
        return false;
      }
    }
    return run({ manual: true });
  }

  async function enable() {
    if (!(CRM.store.getSetting('gcal', null) || {}).clientId) {
      ui.toast('Спершу налаштуй Google Календар (Client ID) — копії використовують те саме підключення Google.', { type: 'error', duration: 7000 });
      return;
    }
    await setCfg({ enabled: true });
    lastError = null;
    changed();
    await runNow();
  }

  async function disable() {
    const ok = await ui.confirm({
      title: 'Вимкнути щоденні копії?',
      message: 'Нові копії на Google Диск більше не робитимуться. Уже збережені файли залишаться в папці «' + FOLDER_NAME + '».',
      confirmText: 'Вимкнути'
    });
    if (!ok) return;
    await setCfg({ enabled: false });
    lastError = null;
    changed();
  }

  // ---------- Нагадування, якщо копія чекає на доступ Google ----------
  CRM.notify.addRule(() => {
    const c = cfg();
    if (isFile() || !c.enabled || c.lastDate === D.today() || running) return [];
    if (CRM.gcal.accessToken('drive')) return [];
    if (Date.now() - bootAt < 60000) return [];               // спершу даємо шанс синхронізації
    return [{
      key: `backup:due:${D.today()}`, kind: 'system',
      title: 'Резервна копія на Google Диск чекає',
      text: 'Доступ Google сплив. Відкрий «Мій кабінет» і натисни «Зробити копію зараз».',
      target: { route: 'profile', params: { focus: 'backup' } }
    }];
  });

  // ---------- Блок у «Моєму кабінеті» ----------
  function when(iso) {
    if (!iso) return '';
    const p = D.kyivParts(new Date(iso));
    return `${CRM.fmt.date(D.toKyivDate(iso)).replace(/ \d{4}$/, '')} о ${pad(p.hh)}:${pad(p.mm)}`;
  }

  function settingsBlock() {
    const head = h('div', { class: 'setting-row' });
    const body = h('div', { class: 'svc-body' });
    const block = h('div', { class: 'svc-block backup-block', id: 'backup' }, head, body);
    const BADGE = {
      off: ['', 'вимкнено'], done: ['badge-success', 'сьогодні збережено'], waiting: ['badge-warning', 'очікує'],
      running: ['badge-accent', 'зберігаю…'], error: ['badge-danger', 'помилка']
    };
    function render() {
      const s = status();
      const c = cfg();
      const b = BADGE[s] || BADGE.off;
      const actions = [];
      if (s === 'off') {
        actions.push(ui.button({ label: 'Увімкнути', icon: 'upload', variant: 'primary', size: 'sm', disabled: isFile(), onClick: () => enable() }));
      } else {
        actions.push(ui.button({ label: s === 'running' ? 'Зберігаю…' : 'Зробити копію зараз', icon: 'upload', size: 'sm', disabled: s === 'running' || isFile(), onClick: () => runNow() }));
        actions.push(ui.button({ label: 'Вимкнути', size: 'sm', onClick: () => disable() }));
      }
      ui.mount(head,
        h('div', { class: 'setting-text' },
          h('div', { class: 'setting-title' }, CRM.icon('database', { size: 'sm' }), 'Щоденна копія на Google Диск', h('span', { class: 'badge ' + b[0], 'data-status': s }, b[1])),
          h('div', { class: 'setting-desc' }, `Раз на день, коли відкриваєш CRM, копія даних (без вкладених файлів) зберігається в папку «${FOLDER_NAME}». Зберігаються останні ${c.keep} копій.`)),
        h('div', { class: 'setting-actions' }, actions));
      const parts = [];
      if (s !== 'off') {
        const info = [];
        info.push(c.lastAt ? `Остання копія: ${when(c.lastAt)}${c.lastSize ? ` (${CRM.fmt.bytes(c.lastSize)})` : ''}.` : 'Копій ще не було.');
        if (s === 'waiting') info.push('Сьогоднішня копія чекає на доступ Google — він діє приблизно годину. Натисни «Зробити копію зараз» або «Оновити підключення» в блоці Google Календаря.');
        parts.push(h('div', { class: 'svc-info' },
          info.map((t) => h('div', null, t)),
          c.folderId ? h('a', { href: `https://drive.google.com/drive/folders/${encodeURIComponent(c.folderId)}`, target: '_blank', rel: 'noopener noreferrer', class: 'prog-video' }, CRM.icon('external', { size: 'sm' }), 'Відкрити папку на Google Диску') : null,
          h('div', null, 'CRM бачить на Диску лише файли, які створила сама. Відновити дані з копії: завантаж файл з Диска → «Імпортувати».')));
      } else {
        parts.push(h('div', { class: 'svc-info' },
          h('div', null, 'Потрібне підключення Google з блоку «Google Календар» і ввімкнений Google Drive API (README, розділ «Резервні копії на Google Диск»).')));
      }
      if (lastError) parts.push(h('div', { class: 'callout callout-warning svc-error', role: 'alert' }, CRM.icon('alert'), h('span', null, lastError.text)));
      ui.mount(body, parts);
    }
    render();
    const onChange = () => render();
    document.addEventListener('crm:backupchange', onChange);
    document.addEventListener('crm:gcalchange', onChange);
    block._destroy = () => { document.removeEventListener('crm:backupchange', onChange); document.removeEventListener('crm:gcalchange', onChange); };
    return block;
  }

  // ---------- Запуск ----------
  function init() {
    if (isFile()) return;
    bootAt = Date.now();
    setTimeout(maybeRun, 16000);
    document.addEventListener('crm:minute', maybeRun);
    document.addEventListener('crm:googletoken', () => { lastFailAt = 0; setTimeout(() => { bootAt = 0; maybeRun(); }, 500); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') maybeRun(); });
  }

  CRM.backup = { init, status, run, runNow, enable, disable, settingsBlock, FOLDER_NAME };
})(window.CRM);
