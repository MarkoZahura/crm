/* ==========================================================================
   keys.js — гарячі клавіші й довідка «?» (дрібні доробки, етап 7, 29.10.2026).
   Скрізь: ? — довідка, / — пошук і ⚡, N — нова задача, E — нова подія,
   A — головна кнопка «Додати» сторінки (на Головній — ⚡), G, потім літера — перейти.
   Календар: T, ← → / K J, D, 3, W, M. Задачі: ↓ ↑ / J K, Enter, X, S.
   Вкладки: [ і ]. У вікнах: Ctrl+Enter — головна кнопка («Зберегти» / «Додати»).
   Клавіші беруться за місцем на клавіатурі (e.code), тож працюють і в українській
   розкладці (G = П). Не спрацьовують, коли пишеш у полі, коли відкрите вікно чи
   меню (крім ?, Esc і Ctrl+Enter) і з Ctrl / Alt / ⌘ (Ctrl+C тощо не чіпаємо).
   Вимикач — у «Моєму кабінеті», окремо на кожному пристрої (localStorage crm.keys.off).
   ========================================================================== */
window.CRM = window.CRM || {};

(function (CRM) {
  'use strict';

  const h = CRM.ui.h;
  const ui = CRM.ui;
  const LS_OFF = 'crm.keys.off';
  const G_WAIT = 1500;

  // Українська розкладка: та сама клавіша (для підписів у довідці)
  const UA = {
    KeyQ: 'й', KeyW: 'ц', KeyE: 'у', KeyR: 'к', KeyT: 'е', KeyY: 'н', KeyU: 'г', KeyI: 'ш', KeyO: 'щ', KeyP: 'з',
    BracketLeft: 'х', BracketRight: 'ї', KeyA: 'ф', KeyS: 'і', KeyD: 'в', KeyF: 'а', KeyG: 'п', KeyH: 'р', KeyJ: 'о',
    KeyK: 'л', KeyL: 'д', KeyZ: 'я', KeyX: 'ч', KeyC: 'с', KeyV: 'м', KeyB: 'и', KeyN: 'т', KeyM: 'ь', Slash: '.'
  };
  const CODE_OF = { '[': 'BracketLeft', ']': 'BracketRight', '/': 'Slash' };

  // G, потім літера — розділи (порядок — як у меню)
  const GO = [
    { code: 'KeyH', key: 'H', route: 'home', label: 'Головна' },
    { code: 'KeyC', key: 'C', route: 'calendar', label: 'Календар' },
    { code: 'KeyT', key: 'T', route: 'tasks', label: 'Задачі' },
    { code: 'KeyB', key: 'B', route: 'budget', label: 'Бюджет' },
    { code: 'KeyW', key: 'W', route: 'training', label: 'Тренування' },
    { code: 'KeyF', key: 'F', route: 'nutrition', label: 'Харчування' },
    { code: 'KeyL', key: 'L', route: 'learning', label: 'Навчання' },
    { code: 'KeyP', key: 'P', route: 'people', label: 'Люди' },
    { code: 'KeyZ', key: 'Z', route: 'habits', label: 'Звички' },
    { code: 'KeyK', key: 'K', route: 'trash', label: 'Кошик' },
    { code: 'KeyM', key: 'M', route: 'profile', label: 'Мій кабінет' }
  ];

  const CAL_VIEWS = { KeyD: 'day', Digit3: '3days', Numpad3: '3days', KeyW: 'week', KeyM: 'month' };

  function isMac() { return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || ''); }
  const CTRL = () => (isMac() ? '⌘' : 'Ctrl');

  /** Довідка: групи рядків. keys — варіанти; у варіанті пробіл = «потім», «+» = разом. */
  function groups() {
    const C = CTRL();
    return [
      { id: 'all', title: 'Скрізь', rows: [
        { keys: ['?'], text: 'Ця довідка' },
        { keys: ['/', C + '+K'], text: 'Пошук і швидке введення ⚡' },
        { keys: ['N'], text: 'Нова задача' },
        { keys: ['E'], text: 'Нова подія в Календарі' },
        { keys: ['A'], text: '«Додати» на цій сторінці: людина, звичка, курс, транзакція, їжа… (на Головній — ⚡)' },
        { keys: ['Esc'], text: 'Закрити вікно, панель чи меню' }
      ] },
      { id: 'go', title: 'Перейти: G, потім літера', rows: GO.map((g) => ({ keys: ['G ' + g.key], text: g.label })) },
      { id: 'cal', title: 'Календар', rows: [
        { keys: ['T'], text: 'Сьогодні' },
        { keys: ['←', 'K'], text: 'Назад (попередній день, тиждень, місяць)' },
        { keys: ['→', 'J'], text: 'Вперед' },
        { keys: ['D'], text: 'День' },
        { keys: ['3'], text: 'Три дні' },
        { keys: ['W'], text: 'Тиждень' },
        { keys: ['M'], text: 'Місяць' },
        { keys: [C + '+перетягнути'], text: 'Скопіювати подію мишкою замість переносу' },
        { keys: ['Alt+↑', 'Alt+↓'], text: '«План дня»: змінити порядок задачі' }
      ] },
      { id: 'tasks', title: 'Задачі (список на сторінці «Задачі»)', rows: [
        { keys: ['↓', 'J'], text: 'Наступна задача' },
        { keys: ['↑', 'K'], text: 'Попередня задача' },
        { keys: ['Enter'], text: 'Відкрити вибрану' },
        { keys: ['X'], text: 'Виконати (в Архіві — повернути в активні)' },
        { keys: ['S'], text: 'Відкласти: завтра, понеділок, через тиждень…' }
      ] },
      { id: 'tabs', title: 'Вкладки (Бюджет, Задачі, Тренування, Харчування)', rows: [
        { keys: ['['], text: 'Попередня вкладка' },
        { keys: [']'], text: 'Наступна вкладка' }
      ] },
      { id: 'dlg', title: 'У вікнах', rows: [
        { keys: [C + '+Enter'], text: 'Зберегти / Додати (головна кнопка вікна), навіть з курсором у нотатках; бічну панель, що зберігається сама, — закрити' },
        { keys: ['Esc'], text: 'Закрити без збереження' },
        { keys: ['Tab', 'Shift+Tab'], text: 'Наступне / попереднє поле' }
      ] },
      { id: 'quick', title: 'Швидке введення ⚡', rows: [
        { keys: ['Enter'], text: 'Створити те, що на картці «Буде створено»' },
        { keys: ['Shift+Enter'], text: 'Відкрити заповнену форму' },
        { keys: ['Tab'], text: 'Інший вид запису (подія, задача, витрата…)' },
        { keys: ['↑'], text: 'У порожньому полі — попередні рядки' }
      ] }
    ];
  }

  // ---------- Стан ----------
  let gTimer = null;
  let gHint = null;
  let helpDlg = null;
  let sel = { id: null, index: -1 };
  let sideBtn = null;

  function enabled() {
    try { return localStorage.getItem(LS_OFF) !== '1'; } catch (e) { return true; }
  }
  function setEnabled(on) {
    try { if (on) localStorage.removeItem(LS_OFF); else localStorage.setItem(LS_OFF, '1'); } catch (e) { /* не критично */ }
    cancelG();
    applyState();
    document.dispatchEvent(new CustomEvent('crm:keyschange', { detail: { enabled: !!on } }));
  }
  function applyState() {
    document.documentElement.classList.toggle('kb-off', !enabled());
    if (sideBtn) sideBtn.hidden = !enabled();
    decorate();
  }

  // ---------- Допоміжне ----------
  function typing(t) {
    if (!t || t === document.body || t === document.documentElement) return false;
    if (t.isContentEditable) return true;
    const tag = t.tagName;
    if (tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (tag === 'INPUT') return !/^(checkbox|radio|button|submit|reset|range|color|file|image)$/i.test(t.type || 'text');
    return false;
  }
  function layersOpen() {
    if (ui.layerCount) return ui.layerCount() > 0;
    return !!document.querySelector('.overlay, .popover');
  }
  const visible = (el) => !!el && el.offsetParent !== null && !el.disabled && !el.hidden;
  const page = () => document.getElementById('page');
  const routeName = () => (CRM.router.current ? CRM.router.current.name : '');
  function pageEl(selector) {
    const p = page();
    if (!p) return null;
    return Array.from(p.querySelectorAll(selector)).find(visible) || null;
  }

  // ---------- G, потім літера ----------
  function startG() {
    cancelG();
    gHint = h('div', { class: 'kb-ghint', role: 'status', 'aria-live': 'polite' },
      h('span', { class: 'kb-ghint-title' }, keyEl('G'), ' перейти:'),
      GO.filter((g) => CRM.router.routes.has(g.route) || g.route === 'trash').map((g) =>
        h('span', { class: 'kb-ghint-item' }, keyEl(g.key), h('span', null, g.label))));
    gHint.addEventListener('mousedown', (e) => e.preventDefault());
    document.body.appendChild(gHint);
    gTimer = setTimeout(cancelG, G_WAIT);
  }
  function cancelG() {
    if (gTimer) { clearTimeout(gTimer); gTimer = null; }
    if (gHint) { gHint.remove(); gHint = null; }
  }
  function goTo(g) {
    if (!CRM.router.routes.has(g.route)) { ui.toast(`Розділ «${g.label}» зараз недоступний`, { type: 'error' }); return; }
    CRM.router.go(g.route);
  }

  // ---------- Дії ----------
  function findAdd() {
    return pageEl('[data-hk="add"]') || (() => {
      const list = Array.from((page() || document).querySelectorAll('.page-head-actions .btn-primary')).filter(visible);
      return list[list.length - 1] || null;
    })();
  }
  function addHere() {
    if (routeName() === 'home') { openQuick(); return; }
    const btn = findAdd();
    if (btn) { btn.click(); return; }
    ui.toast('На цій сторінці немає кнопки «Додати»', { duration: 2500 });
  }
  function openQuick() {
    if (CRM.search && CRM.search.openQuick && CRM.quick) CRM.search.openQuick();
    else if (CRM.search) CRM.search.open();
  }
  function newEvent() {
    if (routeName() === 'calendar') {
      const b = findAdd();
      if (b) { b.click(); return; }
    }
    if (CRM.calendar && CRM.calendar.openNew) CRM.calendar.openNew();
    else ui.toast('Календар зараз недоступний', { type: 'error' });
  }
  function newTask() {
    if (CRM.tasks && CRM.tasks.openNew) CRM.tasks.openNew();
  }

  /** Вкладки сторінки: [ — попередня, ] — наступна (по колу). */
  function switchTab(dir) {
    const nav = pageEl('.tabs');
    if (!nav) return false;
    const tabs = Array.from(nav.querySelectorAll('.tab')).filter((t) => t.offsetParent !== null);
    if (tabs.length < 2) return false;
    let i = tabs.findIndex((t) => t.classList.contains('active'));
    if (i < 0) i = 0;
    const next = tabs[(i + dir + tabs.length) % tabs.length];
    next.click();
    return true;
  }

  /** Календар: клавіші натискають ті самі кнопки, що й мишка (data-hk у calendar.js). */
  function calendarKey(code) {
    const click = (hk) => { const b = pageEl(`[data-hk="${hk}"]`); if (b) b.click(); return !!b; };
    if (code === 'KeyT') return click('today') || true;
    if (code === 'ArrowLeft' || code === 'KeyK') return click('prev');
    if (code === 'ArrowRight' || code === 'KeyJ') return click('next');
    if (CAL_VIEWS[code]) return click('view-' + CAL_VIEWS[code]);
    return false;
  }

  // ---------- Список задач ----------
  function taskRows() {
    const p = page();
    return p ? Array.from(p.querySelectorAll('.task-list .task-row')) : [];
  }
  function currentRow(rows) {
    const ae = document.activeElement;
    const row = ae && ae.closest ? ae.closest('.task-row') : null;
    if (row && rows.includes(row)) return row;
    return sel.id ? rows.find((r) => r.dataset.id === sel.id) || null : null;
  }
  function select(row, i) {
    taskRows().forEach((r) => r.classList.remove('kb-sel'));
    row.classList.add('kb-sel');
    sel = { id: row.dataset.id, index: i };
    try { row.focus({ preventScroll: true }); } catch (e) { row.focus(); }
    row.scrollIntoView({ block: 'nearest' });
    if (!row._kbWatch) {
      row._kbWatch = true;
      row.addEventListener('focusout', (e) => { if (!row.contains(e.relatedTarget)) row.classList.remove('kb-sel'); });
      row.addEventListener('focusin', () => { if (sel.id === row.dataset.id) row.classList.add('kb-sel'); });
    }
  }
  /** Меню «Відкласти» закрили (Esc / клік поза ним) — повертаємо вибір на ту саму задачу. */
  function refocusAfterMenu(id) {
    const started = Date.now();
    const iv = setInterval(() => {
      if (document.querySelector('.snooze-pop') && Date.now() - started < 120000) return;
      clearInterval(iv);
      const ae = document.activeElement;
      if (ae && ae !== document.body && ae !== document.documentElement) return;
      if (layersOpen() || routeName() !== 'tasks') return;
      const rows = taskRows();
      const r = rows.find((x) => x.dataset.id === id);
      if (r) select(r, rows.indexOf(r));
    }, 120);
  }
  function moveTask(dir) {
    const rows = taskRows();
    if (!rows.length) return false;
    const cur = currentRow(rows);
    let i;
    if (cur) i = rows.indexOf(cur) + dir;
    else if (sel.index >= 0) i = dir > 0 ? sel.index : sel.index - 1; // вибрану щойно виконали — стаємо на її місце
    else i = dir > 0 ? 0 : rows.length - 1;
    i = Math.max(0, Math.min(rows.length - 1, i));
    select(rows[i], i);
    return true;
  }
  function taskAction(code) {
    const rows = taskRows();
    const row = currentRow(rows);
    if (!row || !CRM.tasks) return false;
    const id = row.dataset.id;
    const t = CRM.store.get('tasks', id);
    if (!t) return false;
    sel = { id, index: rows.indexOf(row) };
    if (code === 'KeyX') {
      if (t.done) CRM.tasks.reopen(id); else CRM.tasks.complete(id);
      return true;
    }
    if (code === 'KeyS') {
      const b = row.querySelector('.task-snooze');
      if (b && !t.done) { b.click(); refocusAfterMenu(id); return true; }
      return false;
    }
    return false;
  }

  // ---------- Ctrl+Enter у вікні ----------
  // Вікно (модалка) — головна кнопка внизу («Зберегти», «Додати», «Поставити ціль»…).
  // Бічна панель — лише «Створити / Додати / Зберегти / Готово»; панель, що зберігається сама
  // (задача, людина, курс), просто закривається — головна кнопка там «Позначити виконаною», її не чіпаємо.
  const DRAWER_SAVE = /^(Створити|Додати|Зберегти|Готово)/;
  function ctrlEnter() {
    const overlays = document.querySelectorAll('.overlay');
    const top = overlays[overlays.length - 1];
    if (!top) return false;
    const drawer = !!top.querySelector('.drawer');
    const find = () => {
      const list = Array.from(top.querySelectorAll('.modal-footer .btn-primary, .drawer-footer .btn-primary'))
        .filter((b) => visible(b) && (!drawer || DRAWER_SAVE.test((b.textContent || '').trim())));
      return list[list.length - 1] || null;
    };
    const closeBtn = () => (drawer ? top.querySelector('.drawer-header button[aria-label="Закрити"]') : null);
    if (!find() && !closeBtn()) return false;
    // Як при кліку мишкою: спершу поле втрачає фокус (спрацьовують «change» і автозбереження)
    const ae = document.activeElement;
    if (ae && top.contains(ae) && typeof ae.blur === 'function' && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.tagName === 'SELECT')) ae.blur();
    const btn = find() || closeBtn();
    if (!btn || !document.contains(btn)) return false;
    btn.click();
    return true;
  }

  // ---------- Обробник ----------
  const isEnter = (e) => e.key === 'Enter' || e.code === 'Enter' || e.code === 'NumpadEnter';
  /** Ctrl+Enter — на етапі «перехоплення», раніше за поля: багато полів самі ловлять Enter (без перевірки Ctrl). */
  function onCtrlEnter(e) {
    if (e.defaultPrevented || e.isComposing || !enabled()) return;
    if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey || !isEnter(e)) return;
    if (ctrlEnter()) { e.preventDefault(); e.stopPropagation(); }
  }

  function onKeydown(e) {
    if (e.defaultPrevented || e.isComposing || e.keyCode === 229) return;
    if (!enabled()) { cancelG(); return; }
    if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta' || e.key === 'CapsLock') return;
    const code = e.code || '';
    const mod = e.ctrlKey || e.metaKey;

    if (mod && !e.altKey && !e.shiftKey && isEnter(e)) { cancelG(); return; } // Ctrl+Enter — див. onCtrlEnter
    if (mod || e.altKey) { cancelG(); return; }
    if (typing(e.target)) { cancelG(); return; }

    const help = e.key === '?' || (code === 'Slash' && e.shiftKey);
    if (help) { e.preventDefault(); cancelG(); toggleHelp(); return; }
    if (layersOpen()) { cancelG(); return; }

    if (gTimer) {
      const g = GO.find((x) => x.code === code);
      cancelG();
      if (g) { e.preventDefault(); goTo(g); }
      return;
    }
    if (e.shiftKey) return;

    const route = routeName();
    const nav = code === 'ArrowUp' || code === 'ArrowDown' || code === 'ArrowLeft' || code === 'ArrowRight' || code === 'KeyJ' || code === 'KeyK';
    if (e.repeat && !nav) return;

    // Сторінки
    if (route === 'calendar' && (code === 'KeyT' || code === 'ArrowLeft' || code === 'ArrowRight' || code === 'KeyJ' || code === 'KeyK' || CAL_VIEWS[code])) {
      if (calendarKey(code)) e.preventDefault();
      return;
    }
    if (route === 'tasks') {
      if (code === 'ArrowDown' || code === 'KeyJ') { if (moveTask(1)) e.preventDefault(); return; }
      if (code === 'ArrowUp' || code === 'KeyK') { if (moveTask(-1)) e.preventDefault(); return; }
      if (code === 'KeyX' || code === 'KeyS') { if (taskAction(code)) e.preventDefault(); return; }
    }
    if (code === 'BracketLeft' || code === 'BracketRight') {
      if (switchTab(code === 'BracketLeft' ? -1 : 1)) e.preventDefault();
      return;
    }

    // Скрізь
    switch (code) {
      case 'KeyG': e.preventDefault(); startG(); return;
      case 'KeyN': e.preventDefault(); newTask(); return;
      case 'KeyE': e.preventDefault(); newEvent(); return;
      case 'KeyA': e.preventDefault(); addHere(); return;
      case 'Slash':
      case 'NumpadDivide':
        e.preventDefault();
        if (CRM.search) CRM.search.open();
        return;
      default:
    }
  }

  // ---------- Довідка ----------
  /** <kbd> з українською літерою тієї самої клавіші. */
  function keyEl(k) {
    const code = CODE_OF[k] || (/^[A-Z]$/.test(k) ? 'Key' + k : null);
    const ua = code && UA[code];
    return h('kbd', { class: 'kbd kb-key' }, k, ua ? h('small', { class: 'kb-ua', 'aria-hidden': 'true', title: 'В українській розкладці' }, ua.toUpperCase()) : null);
  }
  function comboEl(variant) {
    const steps = variant.split(' ');
    const out = [];
    steps.forEach((step, si) => {
      if (si) out.push(h('span', { class: 'kb-then' }, 'потім'));
      const parts = step === '+' ? ['+'] : step.split('+');
      parts.forEach((p, pi) => {
        if (pi) out.push(h('span', { class: 'kb-plus' }, '+'));
        out.push(/^(перетягнути)$/.test(p) ? h('span', { class: 'kb-word' }, p) : keyEl(p));
      });
    });
    return h('span', { class: 'kb-combo' }, out);
  }
  function rowText(r) { return CRM.utils.normalize(r.text + ' ' + r.keys.join(' ')); }

  function toggleHelp() {
    if (helpDlg && helpDlg.isOpen) { helpDlg.close('button'); return; }
    openHelp();
  }

  function openHelp() {
    if (helpDlg && helpDlg.isOpen) return helpDlg;
    const G = groups();
    const search = h('input', { type: 'search', class: 'input kb-search', placeholder: 'Пошук: «задача», «тиждень», «G»…', 'aria-label': 'Пошук клавіші' });
    const empty = h('div', { class: 'kb-empty', hidden: true }, 'Нічого не знайдено');
    const sections = G.map((g) => {
      const rows = g.rows.map((r) => {
        const el = h('div', { class: 'kb-row' },
          h('div', { class: 'kb-keys' }, r.keys.map((k, i) => [i ? h('span', { class: 'kb-or' }, 'або') : null, comboEl(k)])),
          h('div', { class: 'kb-text' }, r.text));
        el._text = rowText(r);
        return el;
      });
      const sec = h('section', { class: 'kb-group', dataset: { group: g.id } }, h('h3', { class: 'kb-gtitle' }, g.title), rows);
      sec._rows = rows;
      return sec;
    });
    search.addEventListener('input', () => {
      const terms = CRM.utils.normalize(search.value).split(' ').filter(Boolean);
      let any = false;
      sections.forEach((sec) => {
        const head = CRM.utils.normalize(sec.querySelector('.kb-gtitle').textContent);
        let n = 0;
        sec._rows.forEach((r) => {
          const ok = !terms.length || terms.every((t) => r._text.includes(t) || head.includes(t));
          r.hidden = !ok;
          if (ok) n++;
        });
        sec.hidden = n === 0;
        if (n) any = true;
      });
      empty.hidden = any;
    });
    const on = enabled();
    const note = h('p', { class: 'kb-note' + (on ? '' : ' kb-note-off') }, on
      ? 'Клавіші працюють і в українській розкладці — маленька літера на клавіші показує, яка це. Не спрацьовують, коли пишеш у полі.'
      : 'Зараз гарячі клавіші вимкнено на цьому пристрої — увімкнути можна в «Моєму кабінеті».');
    helpDlg = ui.modal({
      title: 'Гарячі клавіші',
      size: 'lg',
      className: 'kb-modal',
      body: [h('div', { class: 'kb-top' }, search), note, h('div', { class: 'kb-groups' }, sections), empty],
      footer: [
        routeName() === 'profile' ? null : ui.button({ label: 'Налаштування', className: 'kb-settings', onClick: () => { helpDlg.close('button'); CRM.router.go('profile', { focus: 'keys' }); } }),
        ui.button({ label: 'Закрити', onClick: () => helpDlg.close('button') })
      ],
      initialFocus: search,
      onClose: () => { helpDlg = null; }
    });
    return helpDlg;
  }

  // ---------- Підказки на кнопках ----------
  function hint(el, key) {
    if (!el) return;
    if (el.dataset.hkBase == null) el.dataset.hkBase = el.getAttribute('title') || '';
    const base = el.dataset.hkBase;
    if (!enabled()) {
      if (base) el.setAttribute('title', base); else el.removeAttribute('title');
      return;
    }
    const label = base || (el.textContent || '').trim();
    el.setAttribute('title', label ? `${label} · ${key}` : key);
  }
  function decorate() {
    const nav = document.querySelectorAll('.nav-item[data-route]');
    nav.forEach((a) => {
      const g = GO.find((x) => x.route === a.dataset.route);
      if (g) hint(a, 'G ' + g.key);
    });
    hint(document.querySelector('.sidebar-profile'), 'G M');
    hint(document.querySelector('.btn-new-task'), 'N');
    hint(document.querySelector('.search-trigger'), `${CTRL()}+K або /`);
    const p = page();
    if (!p) return;
    if (routeName() !== 'home') {
      const add = findAdd();
      if (add) hint(add, routeName() === 'calendar' ? 'A або E' : 'A');
    }
    if (routeName() === 'calendar') {
      const map = { prev: '← або K', next: '→ або J', today: 'T', 'view-day': 'D', 'view-3days': '3', 'view-week': 'W', 'view-month': 'M' };
      p.querySelectorAll('[data-hk]').forEach((b) => { if (map[b.dataset.hk]) hint(b, map[b.dataset.hk]); });
    }
  }
  let decoQueued = false;
  function decorateSoon() {
    if (decoQueued) return;
    decoQueued = true;
    requestAnimationFrame(() => { decoQueued = false; decorate(); });
  }

  // ---------- Мій кабінет ----------
  function settingsBlock() {
    const row = h('div', { class: 'setting-row kb-settings-row', id: 'keys' });
    function render() {
      const on = enabled();
      const seg = h('div', { class: 'segmented kb-toggle', role: 'radiogroup', 'aria-label': 'Гарячі клавіші' },
        [[true, 'Увімкнено'], [false, 'Вимкнено']].map(([v, label]) => h('button', {
          type: 'button', role: 'radio', class: on === v ? 'active' : '', 'aria-checked': on === v ? 'true' : 'false',
          dataset: { on: v ? '1' : '0' },
          onClick: () => {
            if (enabled() === v) return;
            setEnabled(v);
            render();
            ui.toast(v ? 'Гарячі клавіші ввімкнено' : 'Гарячі клавіші вимкнено на цьому пристрої', { type: v ? 'success' : undefined });
          }
        }, label)));
      ui.mount(row,
        h('div', { class: 'setting-text' },
          h('div', { class: 'setting-title' }, CRM.icon('keyboard', { size: 'sm' }), 'Гарячі клавіші',
            h('span', { class: 'badge ' + (on ? 'badge-success' : 'badge-warning') }, on ? 'увімкнено' : 'вимкнено')),
          h('div', { class: 'setting-desc' },
            'На компʼютері: ', keyEl('?'), ' — усі клавіші, ', keyEl('N'), ' — нова задача, ', keyEl('E'), ' — подія, ',
            keyEl('A'), ' — «Додати» на сторінці, ', keyEl('/'), ' — пошук, ', keyEl('G'), ', потім літера — перейти (',
            keyEl('G'), ' ', keyEl('C'), ' — Календар). Працюють і в українській розкладці; не спрацьовують, коли пишеш у полі.'),
          h('div', { class: 'setting-desc subtle' }, 'Вимикач діє лише на цьому пристрої.')),
        h('div', { class: 'setting-actions' }, seg,
          ui.button({ label: 'Показати всі', size: 'sm', className: 'kb-show-all', onClick: () => openHelp() })));
    }
    render();
    return row;
  }

  // ---------- Запуск ----------
  let started = false;
  function init() {
    if (started) return;
    started = true;
    document.addEventListener('keydown', onCtrlEnter, true);
    document.addEventListener('keydown', onKeydown);
    window.addEventListener('blur', cancelG);
    document.addEventListener('mousedown', (e) => { if (gHint && !gHint.contains(e.target)) cancelG(); }, true);

    // «? Клавіші» внизу меню (лише на компʼютері — на телефоні ховає CSS)
    const sidebar = document.querySelector('.sidebar');
    if (sidebar && !sidebar.querySelector('.sidebar-keys')) {
      sideBtn = h('button', { type: 'button', class: 'sidebar-keys', title: 'Гарячі клавіші (?)', onClick: () => openHelp() },
        h('kbd', { class: 'kbd' }, '?'), h('span', null, 'Клавіші'));
      const prof = sidebar.querySelector('.sidebar-profile');
      sidebar.insertBefore(sideBtn, prof || null);
    }

    const p = page();
    if (p && window.MutationObserver) new MutationObserver(decorateSoon).observe(p, { childList: true });
    CRM.router.onRender(() => { sel = { id: null, index: -1 }; decorateSoon(); });
    applyState();
  }

  CRM.keys = { init, enabled, setEnabled, openHelp, settingsBlock, groups, GO, UA, decorate };
})(window.CRM);
