/* ==========================================================================
   app.js — запуск застосунку: каркас (сайдбар + верхня панель), тема,
   акцентний колір, стартові дані, годинник. Підключається останнім.
   ========================================================================== */
window.CRM = window.CRM || {};

(function (CRM) {
  'use strict';

  const { h } = CRM.ui;

  // ---------- Тема й акцентний колір ----------
  const mql = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;

  function lsSet(key, value) {
    try {
      if (value == null) localStorage.removeItem(key);
      else localStorage.setItem(key, value);
    } catch (e) { /* localStorage може бути недоступним — не критично */ }
  }

  let lastApplied = null;
  const theme = {
    /** Вибір користувача: 'light' | 'dark' | 'system' */
    pref() { return CRM.store.getSetting('theme', 'system'); },
    /** Фактична тема зараз: 'light' | 'dark' */
    current() {
      const p = theme.pref();
      if (p === 'light' || p === 'dark') return p;
      return mql && mql.matches ? 'dark' : 'light';
    },
    apply() {
      const root = document.documentElement;
      const next = theme.current() + '|' + theme.accent();
      const changed = next !== lastApplied;
      lastApplied = next;
      root.setAttribute('data-theme', theme.current());
      root.setAttribute('data-accent', theme.accent());
      const btn = document.getElementById('theme-toggle');
      if (btn) {
        const dark = theme.current() === 'dark';
        btn.replaceChildren(CRM.icon(dark ? 'sun' : 'moon'));
        btn.title = dark ? 'Світла тема' : 'Темна тема';
        btn.setAttribute('aria-label', btn.title);
      }
      // Подія — лише коли тема чи колір справді змінились (інакше зайві перемальовування)
      if (changed) document.dispatchEvent(new CustomEvent('crm:themechange'));
    },
    async set(pref) {
      // Налаштування в пам'яті оновлюється одразу, тож тему застосовуємо без очікування запису в базу
      const saving = CRM.store.setSetting('theme', pref);
      lsSet('crm.theme', pref === 'system' ? null : pref);
      theme.apply();
      await saving;
    },
    toggle() { return theme.set(theme.current() === 'dark' ? 'light' : 'dark'); },
    accent() {
      const a = CRM.store.getSetting('accent', 'blue');
      return CRM.dict.get('accents', a) ? a : 'blue';
    },
    async setAccent(id) {
      const saving = CRM.store.setSetting('accent', id);
      lsSet('crm.accent', id);
      theme.apply();
      await saving;
    },
    /** Синхронізувати копію в localStorage (для миттєвого старту без «блимання»). */
    sync() {
      const p = theme.pref();
      lsSet('crm.theme', p === 'system' ? null : p);
      lsSet('crm.accent', theme.accent());
    }
  };
  if (mql && mql.addEventListener) {
    mql.addEventListener('change', () => { if (theme.pref() === 'system') theme.apply(); });
  }
  CRM.theme = theme;

  // ---------- Стартовий набір категорій ----------
  async function ensureDefaults() {
    if (CRM.store.getSetting('seeded')) return;
    const recs = [];
    ['expense', 'income'].forEach((kind) => {
      CRM.dict.defaultCategories[kind].forEach((c, i) => {
        recs.push({
          id: CRM.utils.uid(), kind, name: c.name, color: c.color, order: i,
          subcategories: c.subs.map((s) => ({ id: CRM.utils.uid(), name: s }))
        });
      });
    });
    // Якщо категорії вже є (напр., після імпорту) — не дублюємо
    if (!CRM.store.list('categories', { deleted: 'all' }).length) await CRM.store.saveMany('categories', recs);
    await CRM.store.setSetting('seeded', true);
  }

  // ---------- Каркас ----------
  const NAV = [
    { id: 'home', label: 'Головна', icon: 'home' },
    { id: 'tasks', label: 'Задачі', icon: 'tasks' },
    { id: 'budget', label: 'Бюджет', icon: 'wallet' },
    { id: 'training', label: 'Тренування', icon: 'dumbbell' },
    { id: 'learning', label: 'Навчання', icon: 'book' },
    { sep: true },
    { id: 'trash', label: 'Кошик', icon: 'trash', count: () => CRM.store.trashItems().length }
  ];

  const el = {};
  let closeMobileNav = null;

  function buildShell() {
    const app = document.getElementById('app');

    el.nav = h('nav', { class: 'nav', 'aria-label': 'Розділи' },
      NAV.map((item) => {
        if (item.sep) return h('div', { class: 'nav-sep', role: 'separator' });
        const a = h('a', { class: 'nav-item', href: '#/' + item.id, dataset: { route: item.id } },
          CRM.icon(item.icon), h('span', null, item.label),
          item.count ? h('span', { class: 'nav-count', dataset: { count: item.id } }) : null);
        a.addEventListener('click', () => { if (closeMobileNav) closeMobileNav(); });
        return a;
      }));

    el.avatar = h('span', { class: 'avatar' });
    el.profileName = h('span', { class: 'sidebar-profile-name' });
    el.profileHint = h('span', { class: 'sidebar-profile-hint' }, 'Мій кабінет');
    el.profileBtn = h('a', { class: 'sidebar-profile', href: '#/profile', title: 'Мій кабінет' },
      el.avatar,
      h('span', { class: 'sidebar-profile-text' }, el.profileName, el.profileHint));
    el.profileBtn.addEventListener('click', () => { if (closeMobileNav) closeMobileNav(); });

    el.sidebar = h('aside', { class: 'sidebar', id: 'sidebar' },
      h('div', { class: 'sidebar-brand' }, h('span', { class: 'brand-mark', 'aria-hidden': 'true' }, 'C'), h('span', null, 'Моя CRM')),
      el.nav,
      el.profileBtn);

    el.backdrop = h('div', { class: 'sidebar-backdrop' });

    // Верхня панель
    el.burger = h('button', {
      type: 'button', class: 'btn btn-ghost btn-icon burger', 'aria-label': 'Меню', title: 'Меню',
      'aria-controls': 'sidebar', 'aria-expanded': 'false', onClick: toggleMobileNav
    }, CRM.icon('menu'));
    el.date = h('div', { class: 'topbar-date' });

    el.searchBtn = h('button', {
      type: 'button', class: 'search-trigger', title: 'Пошук (Ctrl+K)', 'aria-label': 'Пошук',
      onClick: () => CRM.search.open()
    }, CRM.icon('search', { size: 'sm' }), h('span', { class: 'search-label' }, 'Пошук'), h('span', { class: 'kbd' }, isMac() ? '⌘ K' : 'Ctrl K'));

    el.themeBtn = h('button', {
      type: 'button', id: 'theme-toggle', class: 'btn btn-ghost btn-icon',
      onClick: () => theme.toggle()
    });

    el.bellBtn = CRM.notify.createBell();

    el.newTaskBtn = h('button', {
      type: 'button', class: 'btn btn-primary btn-new-task', title: 'Нова задача',
      onClick: () => {
        if (CRM.tasks && typeof CRM.tasks.openNew === 'function') CRM.tasks.openNew();
        else CRM.ui.toast('Форма задачі зʼявиться на етапі 2');
      }
    }, CRM.icon('plus'), h('span', { class: 'btn-label' }, 'Задача'));

    const topbar = h('header', { class: 'topbar' },
      h('div', { class: 'topbar-left' }, el.burger, el.date),
      h('div', { class: 'topbar-right' }, el.searchBtn, el.themeBtn, el.bellBtn, h('span', { class: 'topbar-divider' }), el.newTaskBtn));

    el.page = h('main', { class: 'page', id: 'page', tabIndex: -1 });
    el.app = h('div', { class: 'app' }, el.sidebar, el.backdrop, h('div', { class: 'main' }, topbar, el.page));

    CRM.ui.mount(app, el.app);
    updateShell();
    updateDate();
  }

  function isMac() { return /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent || ''); }

  // ---------- Мобільне меню ----------
  function toggleMobileNav() {
    if (closeMobileNav) { closeMobileNav(); return; }
    el.app.classList.add('nav-open');
    el.burger.setAttribute('aria-expanded', 'true');
    const unregister = CRM.ui.registerLayer({
      el: el.sidebar, anchor: el.burger, lock: true, outsideClose: true,
      close: () => closeMobileNav && closeMobileNav()
    });
    closeMobileNav = () => {
      el.app.classList.remove('nav-open');
      el.burger.setAttribute('aria-expanded', 'false');
      unregister();
      closeMobileNav = null;
    };
  }

  // ---------- Оновлення каркаса ----------
  function updateShell() {
    const profile = CRM.store.getSetting('profile', {}) || {};
    const ini = CRM.utils.initials(profile.name);
    el.avatar.textContent = ini || '';
    el.avatar.classList.toggle('is-empty', !ini);
    if (!ini) el.avatar.replaceChildren(CRM.icon('user', { size: 'sm' }));
    el.profileName.textContent = profile.name || 'Мій кабінет';
    el.profileHint.textContent = profile.name ? 'Мій кабінет' : 'Вкажи своє імʼя';

    NAV.forEach((item) => {
      if (!item.count) return;
      const badge = el.nav.querySelector(`[data-count="${item.id}"]`);
      const n = item.count();
      badge.textContent = n ? String(n) : '';
    });
  }

  function updateActiveNav(current) {
    const name = current ? current.name : '';
    el.nav.querySelectorAll('.nav-item').forEach((a) => {
      const active = a.dataset.route === name;
      a.classList.toggle('active', active);
      if (active) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
    });
    el.profileBtn.classList.toggle('active', name === 'profile');
  }

  function updateDate() {
    const s = CRM.fmt.dateLong(CRM.date.today());
    el.date.textContent = s.charAt(0).toUpperCase() + s.slice(1);
  }

  // ---------- Годинник: щохвилини ----------
  let lastDay = null;
  function tick() {
    const day = CRM.date.today();
    if (lastDay && day !== lastDay) {
      updateDate();
      document.dispatchEvent(new CustomEvent('crm:daychange', { detail: { day } }));
      CRM.router.rerender();
      CRM.store.purgeExpired().catch((e) => console.error(e));
    }
    lastDay = day;
    document.dispatchEvent(new CustomEvent('crm:minute'));
  }

  // ---------- Помилка запуску ----------
  function showFatal(err) {
    const app = document.getElementById('app');
    CRM.ui.mount(app, h('div', { class: 'page', style: { maxWidth: '640px', paddingTop: '12vh' } },
      CRM.ui.empty({
        icon: 'alert',
        title: 'Не вдалося відкрити сховище даних',
        text: (err && err.message ? err.message + ' ' : '') +
          'Можливо, браузер у приватному режимі або забороняє зберігати дані для цього сайту. ' +
          'Спробуй відкрити сайт у звичайному вікні Chrome або через GitHub Pages.'
      })));
  }

  // ---------- Запуск ----------
  async function boot() {
    try {
      await CRM.store.load();
      await ensureDefaults();
    } catch (e) {
      console.error(e);
      showFatal(e);
      return;
    }

    theme.apply();
    theme.sync();
    buildShell();
    theme.apply();

    CRM.search.init();
    CRM.notify.init();
    CRM.gcal.init();
    CRM.sync.init();

    CRM.router.onRender((cur) => updateActiveNav(cur));

    // Зміни даних → оновити каркас і, за потреби, поточну сторінку
    CRM.store.on(null, (changed) => {
      if (changed.has('settings') || changed.has('*')) { theme.apply(); theme.sync(); }
      // Після імпорту / демо-даних одразу перевіряємо нагадування
      if (changed.has('*')) CRM.notify.runRules();
      updateShell();
      const cur = CRM.router.current;
      if (!cur) return;
      const deps = cur.def.stores || [];
      if (changed.has('*') || deps.some((s) => changed.has(s))) CRM.router.rerender();
    });

    try {
      await CRM.store.purgeExpired();
    } catch (e) { console.error(e); }

    // Просимо браузер не видаляти дані сайту при нестачі місця (Chrome вирішує сам, без вікна)
    try {
      if (navigator.storage && navigator.storage.persist) {
        const already = await navigator.storage.persisted();
        if (!already) await navigator.storage.persist();
      }
    } catch (e) { /* не критично */ }

    CRM.router.start();
    CRM.rates.init();
    lastDay = CRM.date.today();
    setInterval(tick, 60 * 1000);
  }

  CRM.app = { boot, ensureDefaults, updateShell };
  boot();
})(window.CRM);
