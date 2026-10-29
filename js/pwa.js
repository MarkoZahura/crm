/* ==========================================================================
   pwa.js — CRM як застосунок (телефон і компʼютер):
   • реєструє «помічника у фоні» (sw.js): копія файлів сайту → миттєвий
     запуск і робота без інтернету;
   • плашка «Є нова версія · Оновити»; якщо не натиснути — нова версія
     вмикається сама при наступному запуску; після оновлення — «Що нового»;
   • блок «Застосунок» у «Моєму кабінеті»: номер версії, «Перевірити
     оновлення», як встановити, «Скинути збережені файли сайту»;
   • попередження, якщо нову версію завантажено на GitHub не повністю;
   • колір рядка стану телефона — за темою.
   З file:// (подвійний клік по index.html) помічник не реєструється.
   ========================================================================== */
window.CRM = window.CRM || {};

(function (CRM) {
  'use strict';

  // Номер версії — РРРР.ММ.ДД-N. Міняти при КОЖНІЙ доставці коду (і додавати запис у CHANGES),
  // потім запустити tests/make-sw.js — він переносить номер у sw.js і рахує контрольні суми файлів.
  const VERSION = '2026.10.29-4';
  // Що нового (найновіше — першим): 1–3 короткі рядки на версію.
  const CHANGES = [
    { v: '2026.10.29-4', items: [
      'Новий вигляд «Повітря»: світло-сіре тло, білі картки з мʼякою тінню замість рамок, більші заокруглення; темна тема теж оновлена.',
      'Меню групами: День, Гроші, Здоровʼя, Люди й навчання; біля «Задач» — скільки на сьогодні й прострочених, біля «Звичок» — скільки ще відмітити.',
      'Кольори стану однакові скрізь: прострочене — кораловий, «сьогодні» — бурштиновий; у задачах — кольорова риска зліва.'
    ] },
    { v: '2026.10.29-3', items: [
      'Гарячі клавіші на компʼютері: ? — усі клавіші, N — нова задача, E — подія, A — «Додати» на сторінці, / — пошук, G, потім літера — перейти (G C — Календар).',
      'У Календарі: T — сьогодні, ← → — назад і вперед, D / 3 / W / M — перегляд; у «Задачах»: J K — по списку, X — виконати, S — відкласти; [ ] — вкладки; Ctrl+Enter — зберегти вікно.',
      'Працюють і в українській розкладці; вимкнути можна в «Моєму кабінеті» → «Гарячі клавіші».'
    ] },
    { v: '2026.10.29-2', items: [
      'Люди: у день народження — кнопка «Привітати»: готовий текст (свої шаблони — у кабінеті) → «Копіювати», Telegram або «Надіслати…».',
      'Подарував ідею — CRM запропонує записати витрату в «Бюджет»; в ідеї можна вказати орієнтовну ціну.',
      'У картці людини — «Повʼязане» (події й задачі з її імʼям), своє нагадування («за 3 дні», «лише в день»…) і «Експорт .vcf».'
    ] },
    { v: '2026.10.29-1', items: [
      'Календар: новий шар «Дедлайни навчання» — теми й курси кольором курсу; галочка — тема вивчена, перетягни на інший день — новий дедлайн.',
      'Навчання: у кожної теми — свої нотатки й посилання (стрілочка ▸ біля теми); у курсу — колір.',
      'Пошук Ctrl+K знаходить і слова з нотаток тем — і відкриває саме цю тему.'
    ] },
    { v: '2026.10.28-3', items: [
      'Бюджет: «Імпорт виписки» (CSV) на вкладці «Транзакції» — Райффайзен розпізнається сам, категорії запамʼятовуються, дублікати пропускаються, звірка балансу.',
      'Транзакцію можна розділити на кілька категорій (чек із супермаркету) і повторити на сьогодні одним кліком (↻).',
      'Аналітика: «+23 %» біля кожної категорії й картка «Найбільші зміни» порівняно з минулим місяцем.'
    ] },
    { v: '2026.10.28-2', items: [
      'Календар: події на кілька днів (відпустка, поїздка) — «Весь день» і поле «По». Через ⚡: «відпустка 3–10 листопада».',
      '«Дублювати» і «Копіювати на…» у події; на ПК — перетягни з затиснутим Ctrl, щоб скопіювати.',
      'Свої категорії подій (назва, колір, нові) і фільтр за ними — у «Показати». Пошук подій (лупа), «Перейти до дати» — клік на назві періоду, номер тижня.'
    ] },
    { v: '2026.10.28-1', items: [
      'Мітки задач («диплом», «дім»): поле «Мітки» в задачі, фільтр на сторінці «Задачі», кнопка «Мітки» — перейменувати, колір, видалити. Через ⚡: «здати розділ #диплом».',
      '«Відкласти» задачу одним кліком (годинник у рядку або в задачі): завтра, понеділок, через тиждень чи інша дата.',
      '«Дублювати» в задачі — копія разом із чеклістом (без дат, пункти не відмічені).'
    ] },
    { v: '2026.10.27-6', items: [
      '⚡ розуміє більше: «щопонеділка 18:00 англійська», «нагадай о 18:00 купити хліб», «переказ 1000 моно → готівка», «біг 5 км 28 хв», «віджимання 3×20», «ДР Марти 5 листопада», «написав Марті».',
      'Кілька записів одним рядком — через «;» («кава 65; таксі 120»). На ПК ↑ у порожньому полі — попередні рядки, під полем — ті, що пишеш найчастіше.',
      'Свої слова для категорій («сільпо» → Продукти) — у кабінеті, «Швидке введення». У задачах — поле «Нагадати».'
    ] },
    { v: '2026.10.27-5', items: [
      'Новий розділ «Звички»: галочки або кількість з метою, лічильник «днів поспіль» і карта року. На Головній — «Звички сьогодні».',
      'Забув відмітити — клікни день на карті; «Пропуск» не обриває серію. Через ⚡: «вода +2», «медитація».'
    ] },
    { v: '2026.10.27-4', items: [
      'Новий розділ «Люди»: дні народження й важливі дати, ідеї подарунків, нагадування за тиждень і в день.',
      '«Час написати»: вибери, як часто хочеш спілкуватися, і натискай «Поспілкувались». Контакти можна завантажити з файлу .vcf.'
    ] },
    { v: '2026.10.27-3', items: [
      'Швидке введення: кнопка ⚡ угорі або Ctrl+K — напиши «завтра 15:00 урок», «кава 65» чи «вівсянка 80 г».',
      'CRM покаже, що створить; Tab чи перемикач змінює тип, Enter — створити, «Скасувати» — прибрати.'
    ] },
    { v: '2026.10.27-2', items: [
      'Нові іконки застосунку: «Кільце» (тепер основна) і «Плитки»; синя «C» теж лишилася.',
      'Іконку можна вибрати в «Моєму кабінеті» → «Застосунок» → «Іконка».'
    ] },
    { v: '2026.10.27-1', items: [
      'CRM можна встановити як застосунок — «Мій кабінет» → «Застосунок».',
      'Відкривається миттєво й працює без інтернету.',
      'Нові версії — плашкою «Є нова версія · Оновити»; номер версії — у «Моєму кабінеті».'
    ] }
  ];

  const { h, ui } = { h: CRM.ui.h, ui: CRM.ui };
  const startHref = location.href; // адреса, з якою відкрили (для перезапуску при оновленні)

  function lsGet(k, def) { try { const v = localStorage.getItem('crm.pwa.' + k); return v == null ? def : JSON.parse(v); } catch (e) { return def; } }
  function lsSet(k, v) { try { if (v == null) localStorage.removeItem('crm.pwa.' + k); else localStorage.setItem('crm.pwa.' + k, JSON.stringify(v)); } catch (e) { /* не критично */ } }
  function ssGet(k) { try { return sessionStorage.getItem('crm.pwa.' + k); } catch (e) { return null; } }
  function ssSet(k, v) { try { sessionStorage.setItem('crm.pwa.' + k, v); } catch (e) { /* не критично */ } }

  const isFile = () => location.protocol === 'file:';
  function isStandalone() {
    try { return !!((window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) || navigator.standalone === true); } catch (e) { return false; }
  }
  function isIOS() {
    const ua = navigator.userAgent || '';
    return /iPhone|iPad|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }
  const isAndroid = () => /Android/i.test(navigator.userAgent || '');

  /** '2026.10.27-1' → '27 жовтня 2026' (номер — лише якщо за день було кілька версій). */
  function versionLabel(v) {
    const m = /^(\d{4})\.(\d{2})\.(\d{2})(?:-(\d+))?$/.exec(v || '');
    if (!m) return v || '';
    const s = CRM.fmt.date(`${m[1]}-${m[2]}-${m[3]}`);
    return m[4] && m[4] !== '1' ? `${s}, № ${m[4]}` : s;
  }

  // ---------- Стан ----------
  let reg = null;
  let sw = 'idle';            // file | unsupported | blocked | starting | active
  let regError = '';
  let hadController = false;
  let installing = false;     // нова версія завантажується
  let waitingVersion = null;  // номер нової версії, що чекає
  let failure = lsGet('fail', null); // { version, first, at, problems } — нова версія на сайті неповна
  let lastCheck = null;       // { at, result, files? }
  let checking = null;
  let lastAuto = 0;
  let initiated = false;      // оновлення запустили в цій вкладці
  let autoMode = false;       // …і автоматично, при запуску
  let dismissed = null;       // плашку цієї версії закрили хрестиком
  let warned = false;
  let installPrompt = null;
  let barEl = null;
  let barTimer = null;

  function changed() { document.dispatchEvent(new CustomEvent('crm:pwachange')); }

  /** Перезавантажити сторінку; після автоматичного оновлення — з тією адресою, з якою CRM відкрили. */
  function restart() {
    if (autoMode && startHref !== location.href) { try { history.replaceState(null, '', startHref); } catch (e) { /* не критично */ } }
    location.reload();
  }

  /** Питання до помічника (версія, список файлів) через MessageChannel. */
  function ask(worker, type) {
    return new Promise((resolve) => {
      if (!worker) { resolve(null); return; }
      const ch = new MessageChannel();
      const t = setTimeout(() => resolve(null), 3000);
      ch.port1.onmessage = (e) => { clearTimeout(t); resolve(e.data || null); };
      try { worker.postMessage({ type }, [ch.port2]); } catch (e) { clearTimeout(t); resolve(null); }
    });
  }

  const hasUpdate = () => !!(reg && reg.waiting && navigator.serviceWorker.controller);

  // ---------- Плашка внизу екрана ----------
  function closeBar() {
    clearTimeout(barTimer);
    if (barEl) barEl.remove();
    barEl = null;
    document.body.classList.remove('has-pwa-bar');
  }

  function bar(o) {
    closeBar();
    barEl = h('div', { class: 'pwa-bar pwa-bar-' + o.kind, role: 'status', 'aria-live': 'polite' },
      h('span', { class: 'pwa-bar-ico' }, CRM.icon(o.icon)),
      h('div', { class: 'pwa-bar-text' },
        h('div', { class: 'pwa-bar-title' }, o.title),
        o.text ? h('div', { class: 'pwa-bar-sub' }, o.text) : null,
        o.list ? h('ul', { class: 'pwa-bar-list' }, o.list.map((t) => h('li', null, t))) : null),
      o.action ? h('button', { type: 'button', class: 'pwa-bar-btn', onClick: o.action.onClick }, o.action.label) : null,
      o.kind === 'busy' ? null : h('button', {
        type: 'button', class: 'toast-close', 'aria-label': 'Закрити',
        onClick: () => { closeBar(); if (o.onClose) o.onClose(); }
      }, CRM.icon('x', { size: 'sm' })));
    document.body.appendChild(barEl);
    document.body.classList.add('has-pwa-bar');
    document.body.style.setProperty('--pwa-bar-h', barEl.offsetHeight + 'px');
    if (o.duration) {
      const start = () => { clearTimeout(barTimer); barTimer = setTimeout(closeBar, o.duration); };
      barEl.addEventListener('mouseenter', () => clearTimeout(barTimer));
      barEl.addEventListener('mouseleave', start);
      start();
    }
  }

  function showUpdateBar() {
    if (!hasUpdate() || dismissed === (waitingVersion || '?')) return;
    bar({
      kind: 'update', icon: 'refresh', title: 'Є нова версія CRM',
      text: waitingVersion ? 'Від ' + versionLabel(waitingVersion) + '. Якщо не оновити зараз — увімкнеться при наступному запуску.' : null,
      action: { label: 'Оновити', onClick: applyUpdate },
      onClose: () => { dismissed = waitingVersion || '?'; }
    });
  }

  // ---------- Оновлення ----------
  function applyUpdate() {
    if (!hasUpdate()) { location.reload(); return; }
    initiated = true;
    lsSet('from', VERSION);
    bar({ kind: 'busy', icon: 'refresh', title: 'Оновлюю…' });
    reg.waiting.postMessage({ type: 'skipWaiting' });
    setTimeout(restart, 5000); // запасний варіант, якщо браузер не повідомить про зміну
  }

  /** Нова версія чекала з минулого разу — вмикаємо одразу при запуску. */
  function autoApply() {
    initiated = true;
    autoMode = true;
    ssSet('auto', String(Date.now()));
    lsSet('from', VERSION);
    reg.waiting.postMessage({ type: 'skipWaiting' });
    setTimeout(restart, 5000);
  }

  async function onWaiting() {
    if (!hasUpdate()) return;
    const info = await ask(reg.waiting, 'version');
    waitingVersion = (info && info.version) || null;
    failure = null;
    lsSet('fail', null);
    changed();
    showUpdateBar();
  }

  function settle(worker) {
    return new Promise((resolve) => {
      const done = () => ['installed', 'activating', 'activated', 'redundant'].includes(worker.state);
      if (done()) { resolve(worker.state); return; }
      const on = () => { if (done()) { worker.removeEventListener('statechange', on); resolve(worker.state); } };
      worker.addEventListener('statechange', on);
    });
  }

  function watch(worker) {
    if (!worker) return;
    installing = true;
    changed();
    settle(worker).then((state) => {
      installing = false;
      if (state === 'installed') onWaiting(); else changed();
    });
  }

  const WHY = { missing: 'немає на сайті', different: 'не збігається з новою версією', http: 'помилка сайту', network: 'не завантажився' };

  function onFailed(d) {
    if (d.offline) return;
    const prev = lsGet('fail', null);
    failure = {
      version: d.version, problems: (d.problems || []).slice(0, 50), at: Date.now(),
      first: prev && prev.version === d.version ? prev.first : Date.now()
    };
    lsSet('fail', failure);
    changed();
    // Одразу після завантаження GitHub ще кілька хвилин публікує файли — попереджаємо, лише якщо проблема тримається
    if (!warned && Date.now() - failure.first > 5 * 60 * 1000) {
      warned = true;
      ui.toast(`Нову версію CRM на GitHub завантажено не повністю (${problemsShort(failure.problems)}), тож поки працює попередня. Завантаж на GitHub усю папку CRM.`, {
        type: 'error', duration: 15000, action: { label: 'Деталі', onClick: () => CRM.router.go('profile', { focus: 'pwa' }) }
      });
    }
  }

  function problemsShort(list) {
    const names = list.slice(0, 3).map((p) => p.path);
    return names.join(', ') + (list.length > 3 ? ` і ще ${list.length - 3}` : '');
  }

  async function hash16(buf) {
    const d = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
    let s = '';
    for (let i = 0; i < 8; i++) s += d[i].toString(16).padStart(2, '0');
    return s;
  }

  /** Ручна перевірка: чи файли на сайті ті самі, що в збереженій версії (раптом на GitHub не оновили sw.js). */
  async function deepCheck() {
    const ctrl = navigator.serviceWorker.controller;
    const info = await ask(ctrl, 'files');
    if (!info || !info.files || !window.crypto || !crypto.subtle) return [];
    const stale = [];
    const base = new URL('./', ctrl.scriptURL).href;
    await Promise.all(Object.keys(info.files).map(async (path) => {
      try {
        const r = await fetch(base + path + '?fresh=' + Date.now(), { cache: 'no-store' });
        if (r.status === 404) { stale.push({ path, why: 'missing' }); return; }
        if (!r.ok) return;
        if (await hash16(await r.arrayBuffer()) !== info.files[path]) stale.push({ path, why: 'newer' });
      } catch (e) { /* немає звʼязку — пропускаємо */ }
    }));
    return stale.sort((a, b) => a.path.localeCompare(b.path));
  }

  /** Перевірити оновлення. manual — натиснули кнопку (тоді ще й звіряємо файли). */
  function check(manual) {
    if (!reg) return Promise.resolve({ result: sw });
    if (checking) return checking;
    checking = (async () => {
      const t0 = Date.now();
      lastAuto = t0;
      changed();
      let res;
      if (navigator.onLine === false) {
        lastCheck = { at: Date.now(), result: 'offline' };
        checking = null;
        changed();
        return lastCheck;
      }
      try {
        // Перше встановлення не вдалося (файли не збігалися) — браузер забув реєстрацію, реєструємо знову
        if (!reg.active && !reg.waiting && !reg.installing) await doRegister();
        else await reg.update();
        if (reg.installing) {
          const state = await settle(reg.installing);
          if (state === 'redundant') await new Promise((r) => setTimeout(r, 400)); // дочекатися повідомлення про причину
        }
        if (hasUpdate()) { await onWaiting(); res = { result: 'ready' }; }
        else if (failure && failure.at >= t0) res = { result: 'broken' };
        else {
          res = { result: 'latest' };
          // На сайті та сама версія, що працює, — давнє попередження про неповне завантаження вже неактуальне
          if (failure && !reg.installing) { failure = null; lsSet('fail', null); }
        }
      } catch (e) {
        res = { result: navigator.onLine === false ? 'offline' : 'error', error: String((e && e.message) || e) };
      }
      if (manual && res.result === 'latest' && navigator.serviceWorker.controller) {
        const stale = await deepCheck();
        if (stale.length) res = { result: 'stale', files: stale };
      }
      lastCheck = Object.assign({ at: Date.now() }, res);
      checking = null;
      changed();
      return res;
    })();
    return checking;
  }

  // ---------- «Що нового» ----------
  function hasData() {
    try {
      const p = CRM.store.getSetting('profile', null);
      if (p && p.name) return true;
      return ['tasks', 'events', 'transactions', 'workouts', 'meals', 'courses', 'accounts'].some((s) => CRM.store.list(s).length);
    } catch (e) { return false; }
  }

  function whatsNew() {
    const seen = lsGet('seen', null);
    if (seen === VERSION) return;
    const from = lsGet('from', null) || seen;
    lsSet('seen', VERSION);
    lsSet('from', null);
    if (!from && !hasData()) return; // новий пристрій — показувати нічого
    const list = [];
    for (const c of CHANGES) {
      if (c.v === from) break;
      list.push(...c.items);
    }
    if (!list.length) return;
    bar({
      kind: 'news', icon: 'sparkles', title: 'CRM оновлено', text: 'Версія від ' + versionLabel(VERSION) + '. Що нового:',
      list: list.slice(0, 6), action: { label: 'Добре', onClick: closeBar }, duration: 30000
    });
  }

  // ---------- Іконка застосунку ----------
  // Ті самі шляхи — у скрипті в <head> index.html (він ставить іконку ще до малювання сторінки).
  const ICONS = [
    { id: 'ring', name: 'Кільце', icon: 'icons/ring-192.png', apple: 'icons/ring-apple-touch-icon.png', manifest: 'manifest.json' },
    { id: 'tiles', name: 'Плитки', icon: 'icons/tiles-192.png', apple: 'icons/tiles-apple-touch-icon.png', manifest: 'manifest-tiles.json' },
    { id: 'c', name: 'Синя «C»', icon: 'icons/icon-192.png', apple: 'icons/apple-touch-icon.png', manifest: 'manifest-c.json' }
  ];
  const DEFAULT_ICON = 'ring';
  function iconId() {
    let v = null;
    try { v = localStorage.getItem('crm.icon'); } catch (e) { /* немає сховища */ }
    return ICONS.some((i) => i.id === v) ? v : DEFAULT_ICON;
  }
  const iconOf = (id) => ICONS.find((i) => i.id === id) || ICONS[0];

  /** Іконка вкладки, iPhone, маніфест, значок у меню й ?icon= в адресі — за вибором. */
  function applyIcon() {
    const ic = iconOf(iconId());
    const set = (sel, href) => { const l = document.querySelector(sel); if (l && l.getAttribute('href') !== href) l.setAttribute('href', href); };
    set('link[rel="icon"]', ic.icon);
    set('link[rel="apple-touch-icon"]', ic.apple);
    set('link[rel="manifest"]', ic.manifest);
    document.querySelectorAll('.brand-mark').forEach((m) => {
      m.classList.toggle('has-img', ic.id !== 'c');
      if (ic.id === 'c') m.textContent = 'C';
      else m.replaceChildren(h('img', { src: ic.icon, alt: '' }));
    });
    // iPhone запамʼятовує адресу сторінки, з якої застосунок додали на головний екран, — разом із ?icon=
    if (isFile()) return;
    try {
      const u = new URL(location.href);
      if (ic.id === DEFAULT_ICON) u.searchParams.delete('icon'); else u.searchParams.set('icon', ic.id);
      if (u.href !== location.href) history.replaceState(history.state, '', u.href);
    } catch (e) { /* не критично */ }
  }

  function setIcon(id) {
    try { localStorage.setItem('crm.icon', id); } catch (e) { /* немає сховища */ }
    applyIcon();
    changed();
  }

  function iconPicker() {
    const cur = iconId();
    const locked = isIOS() && isStandalone(); // у вікні застосунку на iPhone іконку на екрані так не змінити
    let note;
    if (locked) {
      note = 'Тут, у застосунку, іконку на головному екрані не змінити. Як поміняти: у «Синхронізації» перевір, що всі зміни надіслано → видали «Моя CRM» з головного екрана → у Safari відкрий CRM, тут вибери іконку → «Поділитися» → «На початковий екран». Потім у застосунку знову увійди в синхронізацію (дані повернуться) і підключи Google Календар.';
    } else if (isIOS()) {
      note = 'Вибери тут, у Safari, і вже потім додавай на початковий екран. Якщо застосунок уже додано — видали його з головного екрана й додай знову (перед цим перевір у «Синхронізації», що всі зміни надіслано; після входу дані повернуться, Google Календар підключи знову).';
    } else {
      note = 'Діє на цьому пристрої: вкладка й значок у меню змінюються одразу. Встановлений застосунок (Chrome, Edge) оновить іконку сам, іноді спитавши дозволу. На iPhone іконку вибирай у Safari перед додаванням на початковий екран.';
    }
    return h('div', { class: 'pwa-icons' },
      h('div', { class: 'setting-title' }, 'Іконка'),
      h('div', { class: 'pwa-icon-opts', role: 'radiogroup', 'aria-label': 'Іконка застосунку' },
        ICONS.map((ic) => h('button', {
          type: 'button', role: 'radio', class: 'pwa-icon-opt' + (ic.id === cur ? ' active' : ''),
          'aria-checked': ic.id === cur ? 'true' : 'false', disabled: locked, dataset: { icon: ic.id },
          onClick: () => { if (ic.id !== iconId()) setIcon(ic.id); }
        }, h('img', { src: ic.icon, alt: '' }), h('span', null, ic.name)))),
      h('div', { class: 'svc-info' }, note));
  }

  // ---------- Колір рядка стану (телефон, вікно застосунку) ----------
  function themeColor() {
    let m = document.querySelector('meta[name="theme-color"]');
    if (!m) { m = document.createElement('meta'); m.name = 'theme-color'; document.head.appendChild(m); }
    const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
    if (bg) m.content = bg;
  }

  // ---------- Встановлення ----------
  async function promptInstall() {
    if (!installPrompt) return;
    const e = installPrompt;
    installPrompt = null;
    changed();
    try { await e.prompt(); } catch (err) { ui.toast('Не вдалося відкрити вікно встановлення — скористайся меню браузера.', { type: 'error' }); }
  }

  // ---------- Скинути збережені файли ----------
  async function resetFiles() {
    const ok = await ui.confirm({
      title: 'Скинути збережені файли сайту?',
      message: 'Застосунок забуде збережену копію сайту й завантажить його з інтернету заново. Твої дані (задачі, бюджет, календар тощо) не зачіпаються.',
      confirmText: 'Скинути й перезавантажити'
    });
    if (!ok) return;
    if (navigator.onLine === false) { ui.toast('Потрібен інтернет — без нього сайт не завантажиться заново.', { type: 'error' }); return; }
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((r) => r.unregister()));
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith('crm-')).map((k) => caches.delete(k)));
    } catch (e) { console.warn(e); }
    lsSet('fail', null);
    location.reload();
  }

  // ---------- Блок у «Моєму кабінеті» ----------
  function timeLabel(ms) { const p = CRM.date.kyivParts(new Date(ms)); return String(p.hh).padStart(2, '0') + ':' + String(p.mm).padStart(2, '0'); }

  function problemList(list, why) {
    const shown = list.slice(0, 8);
    return h('ul', { class: 'pwa-files' },
      shown.map((p) => h('li', null, h('code', null, p.path), ' — ', why[p.why] || p.why)),
      list.length > shown.length ? h('li', null, `і ще ${list.length - shown.length}`) : null);
  }

  function statusNode() {
    if (sw === 'file') {
      return h('div', { class: 'callout callout-warning' }, CRM.icon('alert'),
        h('span', null, h('strong', null, 'Сайт відкрито як файл.'), ' Застосунок, робота без інтернету й оновлення плашкою працюють лише зі справжньої адреси сайту (GitHub Pages).'));
    }
    if (sw === 'unsupported') return h('div', { class: 'svc-info' }, 'Цей браузер не вміє працювати без інтернету — CRM відкривається як звичайний сайт.');
    if (sw === 'blocked') {
      return h('div', { class: 'callout callout-warning' }, CRM.icon('alert'),
        h('span', null, 'Браузер не запустив помічника для роботи без інтернету' + (regError ? ` (${regError})` : '') + '. Перевір, чи на GitHub є файл sw.js (у корені папки CRM); у приватному вікні це не працює.'));
    }
    if (installing) return h('div', { class: 'svc-info', 'data-pwa-status': 'installing' }, 'Завантажую нову версію…');
    if (hasUpdate()) {
      return h('div', { class: 'callout callout-info', 'data-pwa-status': 'ready' }, CRM.icon('refresh'),
        h('span', null, h('strong', null, 'Є нова версія' + (waitingVersion ? ' від ' + versionLabel(waitingVersion) : '') + '.'),
          ' Натисни «Оновити зараз» — або вона ввімкнеться сама при наступному запуску.'));
    }
    if (failure) {
      const ctrl = !!navigator.serviceWorker.controller;
      return h('div', { class: 'callout callout-warning', 'data-pwa-status': 'broken' }, CRM.icon('alert'),
        h('div', null,
          ctrl
            ? h('div', null, h('strong', null, 'Нову версію на GitHub завантажено не повністю'), ' — поки працює попередня. Файли, яких бракує або які не збігаються:')
            : h('div', null, h('strong', null, 'Файли на сайті не збігаються з sw.js'), ' — робота без інтернету не ввімкнулася. Файли, яких бракує або які не збігаються:'),
          problemList(failure.problems, WHY),
          h('div', null, 'Завантаж на GitHub усю папку CRM (README, розділ «Як оновити сайт») — і натисни «Перевірити оновлення».')));
    }
    if (lastCheck && lastCheck.result === 'stale') {
      return h('div', { class: 'callout callout-warning', 'data-pwa-status': 'stale' }, CRM.icon('alert'),
        h('div', null,
          h('div', null, h('strong', null, 'На сайті є інші файли, ніж у цій версії,'), ' але файл sw.js не оновлено — тому застосунок їх не бере:'),
          problemList(lastCheck.files, { newer: 'інший на сайті', missing: 'немає на сайті' }),
          h('div', null, 'Завантаж на GitHub усю папку CRM разом із sw.js. Якщо не допоможе — «Скинути збережені файли сайту».')));
    }
    if (lastCheck) {
      const t = timeLabel(lastCheck.at);
      const text = {
        latest: `Перевірено о ${t} — це остання версія.`,
        offline: `Немає інтернету — перевірю, щойно зʼявиться звʼязок.`,
        error: `Не вдалося перевірити о ${t}` + (lastCheck.error ? ` (${lastCheck.error})` : '') + '.',
        ready: `Перевірено о ${t}.`,
        broken: `Перевірено о ${t}.`
      }[lastCheck.result] || '';
      return text ? h('div', { class: 'svc-info', 'data-pwa-status': lastCheck.result }, text) : null;
    }
    if (sw === 'starting') return h('div', { class: 'svc-info', 'data-pwa-status': 'starting' }, 'Готую роботу без інтернету — за хвилину CRM відкриватиметься й без звʼязку.');
    return null;
  }

  function installHelp() {
    if (isStandalone()) {
      return isIOS()
        ? h('div', { class: 'svc-info' }, h('div', null, 'CRM відкрито як застосунок. На iPhone його дані окремі від Safari — щоб отримати свої, увійди в синхронізацію нижче й підключи Google Календар.'))
        : h('div', { class: 'svc-info' }, h('div', null, 'CRM відкрито як застосунок.'));
    }
    let lines;
    if (isIOS()) {
      lines = [
        'Як встановити на iPhone: у Safari натисни «Поділитися» (Share) → «На початковий екран» (Add to Home Screen) → «Додати».',
        'Перемикач «Відкрити як вебзастосунок» (Open as Web App): увімкнено — окреме вікно на весь екран, але дані окремі від Safari (усередині треба увійти в синхронізацію й підключити Google Календар); вимкнено — звичайна закладка, що відкриває CRM у Safari з тими самими даними.'
      ];
    } else if (isAndroid()) {
      lines = [installPrompt ? 'Натисни «Встановити» — CRM зʼявиться на головному екрані.' : 'Як встановити: у Chrome — меню ⋮ → «Встановити застосунок» або «Додати на головний екран».',
        'Застосунок і вкладка Chrome бачать ті самі дані.'];
    } else {
      lines = [installPrompt ? 'Натисни «Встановити» — CRM відкриватиметься окремим вікном, як програма.' : 'Як встановити на компʼютері: у Chrome чи Edge — значок встановлення праворуч в адресному рядку (або меню ⋮ → «Встановити…»).',
        'Встановлювати не обовʼязково: робота без інтернету й оновлення плашкою діють і у звичайній вкладці.'];
    }
    return h('div', { class: 'svc-info pwa-install' }, lines.map((t) => h('div', null, t)));
  }

  function settingsBlock() {
    const head = h('div', { class: 'setting-row' });
    const body = h('div', { class: 'svc-body' });
    const block = h('div', { class: 'svc-block pwa-block', id: 'pwa' }, head, body);

    function render() {
      const standalone = isStandalone();
      const badge = standalone ? ['badge-success', 'встановлено']
        : sw === 'active' ? ['badge-success', 'працює без інтернету']
          : sw === 'starting' ? ['', 'готується…']
            : sw === 'file' ? ['badge-warning', 'недоступно з файлу']
              : ['badge-warning', 'лише з інтернетом'];
      const actions = [];
      if (hasUpdate()) actions.push(ui.button({ label: 'Оновити зараз', icon: 'refresh', variant: 'primary', size: 'sm', onClick: applyUpdate }));
      if (reg) {
        const btn = ui.button({ label: checking ? 'Перевіряю…' : 'Перевірити оновлення', icon: hasUpdate() ? null : 'refresh', size: 'sm', disabled: !!checking, onClick: () => check(true) });
        btn.dataset.pwaCheck = '';
        actions.push(btn);
      }
      if (installPrompt && !standalone) actions.push(ui.button({ label: 'Встановити', icon: 'download', size: 'sm', onClick: promptInstall }));
      ui.mount(head,
        h('div', { class: 'setting-text' },
          h('div', { class: 'setting-title' }, CRM.icon('phone', { size: 'sm' }), 'Застосунок', h('span', { class: 'badge ' + badge[0], 'data-sw': sw }, badge[1])),
          h('div', { class: 'setting-desc' }, h('span', { 'data-version': VERSION }, 'Версія від ' + versionLabel(VERSION)), h('span', { class: 'pwa-ver' }, ' · ' + VERSION))),
        h('div', { class: 'setting-actions' }, actions));

      const parts = [statusNode(), iconPicker()];
      if (sw !== 'file') parts.push(installHelp());
      parts.push(h('div', { class: 'svc-info' },
        h('div', null, 'Без інтернету працює все, крім Google Календаря (показує збережене), курсів НБУ й синхронізації — зміни надішлються, щойно зʼявиться звʼязок.')));
      if (reg) {
        parts.push(h('div', { class: 'pwa-reset' },
          ui.button({ label: 'Скинути збережені файли сайту', size: 'sm', onClick: resetFiles }),
          h('span', { class: 'svc-info' }, 'Якщо CRM виглядає «старою» чи зламаною. Дані не зачіпає.')));
      }
      ui.mount(body, parts.filter(Boolean));
    }
    render();
    const on = () => render();
    document.addEventListener('crm:pwachange', on);
    block._destroy = () => document.removeEventListener('crm:pwachange', on);
    return block;
  }

  // ---------- Запуск ----------
  async function doRegister() {
    const r = await navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' });
    if (!r) throw new Error('');
    if (r !== reg) {
      reg = r;
      if (r.installing) watch(r.installing);
      r.addEventListener('updatefound', () => watch(r.installing));
    }
    return r;
  }

  async function register() {
    if (isFile()) { sw = 'file'; return; }
    if (!('serviceWorker' in navigator) || !window.isSecureContext || !window.caches) { sw = 'unsupported'; return; }
    const sws = navigator.serviceWorker;
    hadController = !!sws.controller;
    sw = hadController ? 'active' : 'starting';

    sws.addEventListener('controllerchange', () => {
      if (!hadController) { hadController = true; sw = 'active'; changed(); return; } // перше встановлення
      if (initiated) { restart(); return; }
      bar({ kind: 'update', icon: 'refresh', title: 'CRM оновлено в іншій вкладці', action: { label: 'Перезавантажити', onClick: () => location.reload() } });
    });
    sws.addEventListener('message', (e) => {
      const d = e.data || {};
      if (d.type === 'crm-sw-failed') onFailed(d);
      else if (d.type === 'crm-sw-installed' && failure) { failure = null; lsSet('fail', null); changed(); }
    });

    try {
      await doRegister();
    } catch (e) {
      sw = 'blocked';
      regError = (e && e.message) || '';
      changed();
      return;
    }

    if (hasUpdate()) {
      const last = Number(ssGet('auto')) || 0;
      if (Date.now() - last > 15000) { autoApply(); return; }
      onWaiting();
    }
    changed();

    // Перевірки: невдовзі після запуску, щопівгодини й коли застосунок знову на екрані
    setTimeout(() => check(false), 4000);
    setInterval(() => { if (document.visibilityState === 'visible') check(false); }, 30 * 60 * 1000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && Date.now() - lastAuto > 60 * 1000) check(false);
    });
  }

  function init() {
    applyIcon();
    themeColor();
    document.addEventListener('crm:themechange', themeColor);
    window.addEventListener('beforeinstallprompt', (e) => { installPrompt = e; changed(); });
    window.addEventListener('appinstalled', () => { installPrompt = null; changed(); ui.toast('CRM встановлено як застосунок', { type: 'success' }); });
    register().catch((e) => console.warn(e));
    setTimeout(whatsNew, 800);
  }

  CRM.pwa = {
    VERSION, CHANGES, ICONS, init, check, applyUpdate, settingsBlock, versionLabel, isStandalone, isIOS, iconId, setIcon,
    get state() { return { sw, installing, update: hasUpdate(), waitingVersion, failure, lastCheck }; }
  };
})(window.CRM);
