/* ==========================================================================
   app.js — запуск застосунку: каркас (сайдбар + верхня панель; на телефоні — нижня панель,
   «Ще», кругла кнопка ⚡ і простий верх), тема, акцентний колір, стартові дані, годинник.
   Підключається останнім.
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
  // Меню групами (29.10.2026). count() → число або { n, hot, title }
  const NAV = [
    { group: 'День' },
    { id: 'home', label: 'Головна', icon: 'home' },
    { id: 'calendar', label: 'Календар', icon: 'calendar' },
    { id: 'tasks', label: 'Задачі', icon: 'tasks', count: tasksCount },
    { group: 'Гроші' },
    { id: 'budget', label: 'Бюджет', icon: 'wallet' },
    { group: 'Здоровʼя' },
    { id: 'training', label: 'Тренування', icon: 'dumbbell' },
    { id: 'nutrition', label: 'Харчування', icon: 'apple' },
    { id: 'habits', label: 'Звички', icon: 'habits', count: habitsCount },
    { group: 'Люди й навчання' },
    { id: 'people', label: 'Люди', icon: 'users' },
    { id: 'learning', label: 'Навчання', icon: 'book' },
    { id: 'tutor', label: 'Репетиторство', icon: 'board' },
    { id: 'books', label: 'Книги', icon: 'library' },
    { group: 'Інше' },
    { id: 'trash', label: 'Кошик', icon: 'trash', count: () => CRM.store.trashItems().length }
  ];

  /** «Задачі»: на сьогодні (дедлайн чи план) + прострочені; червоним, якщо є прострочені. */
  function tasksCount() {
    if (!CRM.tasks || !CRM.tasks.activeTasks) return 0;
    const T = CRM.date.today();
    let today = 0;
    let over = 0;
    CRM.tasks.activeTasks().forEach((t) => {
      if (t.deadline && t.deadline < T) over++;
      else if (!t.deadline && t.planDate && t.planDate < T) over++;
      else if (t.deadline === T || t.planDate === T) today++;
    });
    const n = today + over;
    const title = [today ? `${today} на сьогодні` : '', over ? `${over} ${CRM.fmt.plural(over, ['прострочена', 'прострочені', 'прострочених'])}` : ''].filter(Boolean).join(', ');
    return { n, hot: over > 0, title };
  }
  /** «Звички»: скільки ще відмітити сьогодні. */
  function habitsCount() {
    if (!CRM.habits || !CRM.habits.today) return 0;
    const t = CRM.habits.today();
    const n = Math.max(0, t.total - t.done);
    return { n, hot: false, title: n ? `Сьогодні ще ${n} з ${t.total}` : '' };
  }

  const el = {};
  let closeMobileNav = null;

  function buildShell() {
    const app = document.getElementById('app');

    el.nav = h('nav', { class: 'nav', 'aria-label': 'Розділи' },
      NAV.map((item, i) => {
        if (item.sep) return h('div', { class: 'nav-sep', role: 'separator' });
        if (item.group) {
          // Група без жодного завантаженого розділу (неповне оновлення сайту) — без заголовка
          const next = NAV.slice(i + 1);
          const end = next.findIndex((x) => x.group);
          const any = (end < 0 ? next : next.slice(0, end)).some((x) => x.id === 'trash' || CRM.router.routes.has(x.id));
          return any ? h('div', { class: 'nav-group', role: 'presentation' }, item.group) : null;
        }
        // Розділ не завантажився (неповне оновлення сайту) — не показуємо порожній пункт
        if (item.id !== 'trash' && !CRM.router.routes.has(item.id)) return null;
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
    // Телефон: назва розділу ліворуч (зʼявляється, коли великий заголовок сторінки сховався вгорі)
    el.titleText = h('span', { class: 'topbar-title-text' });
    el.title = h('div', { class: 'topbar-title', 'aria-hidden': 'true' }, h('span', { class: 'brand-mark', 'aria-hidden': 'true' }, 'C'), el.titleText);

    el.searchBtn = h('button', {
      type: 'button', class: 'search-trigger', title: 'Пошук (Ctrl+K)', 'aria-label': 'Пошук',
      onClick: () => CRM.search.open()
    }, CRM.icon('search', { size: 'sm' }), h('span', { class: 'search-label' }, 'Пошук'), h('span', { class: 'kbd' }, isMac() ? '⌘ K' : 'Ctrl K'));

    // ⚡ Швидке введення: той самий вікно, що й Ctrl+K, з підказками (на iPhone Ctrl+K немає)
    el.quickBtn = CRM.quick && CRM.search && CRM.search.openQuick ? h('button', {
      type: 'button', class: 'btn btn-ghost btn-icon quick-trigger', title: 'Швидке введення (' + (isMac() ? '⌘K' : 'Ctrl+K') + ')',
      'aria-label': 'Швидке введення', onClick: () => CRM.search.openQuick()
    }, CRM.icon('zap')) : null;

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
      h('div', { class: 'topbar-left' }, el.burger, el.title, el.date),
      h('div', { class: 'topbar-right' }, el.searchBtn, el.quickBtn, el.themeBtn, el.bellBtn, h('span', { class: 'topbar-divider' }), el.newTaskBtn));

    el.page = h('main', { class: 'page', id: 'page', tabIndex: -1 });
    buildTabbar();
    el.app = h('div', { class: 'app' }, el.sidebar, el.backdrop, h('div', { class: 'main' }, topbar, el.page), el.tabbar, el.fab);

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

  // ---------- Телефон: нижня панель, «Ще», кнопка ⚡, простий верх (29.10.2026, етап 3 дизайну) ----------
  // Показуються лише на вузькому екрані (до 860 px) — це робить CSS; на компʼютері лишаються меню й верхня панель.
  const TABS = ['home', 'calendar', 'tasks', 'budget'];
  const narrowMq = window.matchMedia ? window.matchMedia('(max-width: 860px)') : null;
  const coarseMq = window.matchMedia ? window.matchMedia('(pointer: coarse)') : null;
  const navItem = (id) => NAV.find((x) => x.id === id);
  const routeOk = (id) => id === 'trash' || CRM.router.routes.has(id);
  let closeMore = null;

  function buildTabbar() {
    el.tabs = {};
    const items = TABS.filter(routeOk).map((id) => {
      const it = navItem(id);
      const a = h('a', { class: 'tabbar-item', href: '#/' + id, dataset: { tab: id } },
        h('span', { class: 'tabbar-ico' }, CRM.icon(it.icon), it.count ? h('span', { class: 'tabbar-badge', dataset: { navCount: id } }) : null),
        h('span', { class: 'tabbar-label' }, it.label));
      el.tabs[id] = a;
      return a;
    });
    el.moreTab = h('button', {
      type: 'button', class: 'tabbar-item tabbar-more', dataset: { tab: 'more' }, 'aria-haspopup': 'dialog', 'aria-expanded': 'false',
      'aria-controls': 'more-sheet', onClick: toggleMore
    }, h('span', { class: 'tabbar-ico' }, CRM.icon('apps')), h('span', { class: 'tabbar-label' }, 'Ще'));
    el.tabbar = h('nav', { class: 'tabbar', 'aria-label': 'Основні розділи' }, items, el.moreTab);
    // Кругла кнопка ⚡ праворуч над панеллю — те саме швидке введення, що й Ctrl+K
    el.fab = el.quickBtn ? h('button', {
      type: 'button', class: 'fab', title: 'Швидке введення', 'aria-label': 'Швидке введення', onClick: () => CRM.search.openQuick()
    }, CRM.icon('zap')) : null;
  }

  function toggleMore() { if (closeMore) closeMore(); else openMore(); }

  /** Панель «Ще» знизу: решта розділів плитками за групами, «Мій кабінет» і тема. */
  function openMore() {
    const cur = CRM.router.current ? CRM.router.current.name : '';
    const groups = [];
    NAV.forEach((it) => {
      if (it.group) { groups.push({ title: it.group, items: [] }); return; }
      if (TABS.includes(it.id) || !routeOk(it.id) || !groups.length) return;
      groups[groups.length - 1].items.push(it);
    });
    const tile = (it) => h('a', {
      class: 'more-tile' + (cur === it.id ? ' active' : ''), href: '#/' + it.id, dataset: { route: it.id },
      'aria-current': cur === it.id ? 'page' : null, onClick: () => close()
    },
    h('span', { class: 'more-ico' }, CRM.icon(it.icon)),
    h('span', { class: 'more-label' }, it.label),
    it.count ? h('span', { class: 'more-count', dataset: { navCount: it.id } }) : null);

    const profile = CRM.store.getSetting('profile', {}) || {};
    const ini = CRM.utils.initials(profile.name);
    const avatar = h('span', { class: 'avatar' + (ini ? '' : ' is-empty') }, ini || CRM.icon('user', { size: 'sm' }));
    const profileLink = h('a', { class: 'more-profile' + (cur === 'profile' ? ' active' : ''), href: '#/profile', onClick: () => close() },
      avatar, h('span', { class: 'more-profile-text' }, h('span', { class: 'more-profile-name' }, profile.name || 'Мій кабінет'),
        h('span', { class: 'more-profile-hint' }, profile.name ? 'Мій кабінет' : 'Вкажи своє імʼя')),
      CRM.icon('chevronRight', { size: 'sm' }));

    const seg = h('div', { class: 'segmented more-theme-seg', role: 'radiogroup', 'aria-label': 'Тема' });
    const drawTheme = () => {
      const pref = theme.pref();
      CRM.ui.mount(seg, [['light', 'Світла'], ['dark', 'Темна'], ['system', 'Як у системі']].map(([id, label]) => h('button', {
        type: 'button', role: 'radio', class: pref === id ? 'active' : '', 'aria-checked': pref === id ? 'true' : 'false', dataset: { theme: id },
        onClick: async () => { await theme.set(id); drawTheme(); }
      }, label)));
    };
    drawTheme();

    const sheet = h('section', { class: 'more-sheet', id: 'more-sheet', role: 'dialog', 'aria-label': 'Усі розділи', tabIndex: -1 },
      h('div', { class: 'more-grab', 'aria-hidden': 'true' }),
      groups.filter((g) => g.items.length).map((g) => h('div', { class: 'more-group' },
        h('div', { class: 'more-title' }, g.title),
        h('div', { class: 'more-grid' }, g.items.map(tile)))),
      h('div', { class: 'more-foot' }, profileLink,
        h('div', { class: 'more-theme' }, h('span', { class: 'more-theme-label' }, 'Тема'), seg)));
    const backdrop = h('div', { class: 'more-backdrop', 'aria-hidden': 'true' });
    document.body.append(backdrop, sheet);
    el.moreTab.setAttribute('aria-expanded', 'true');
    el.moreTab.classList.add('open');
    el.tabbar.classList.add('more-open');
    const unregister = CRM.ui.registerLayer({ el: sheet, anchor: el.moreTab, lock: true, outsideClose: true, close: () => close() });
    function close() {
      if (closeMore !== close) return;
      closeMore = null;
      unregister();
      sheet.remove();
      backdrop.remove();
      el.moreTab.setAttribute('aria-expanded', 'false');
      el.moreTab.classList.remove('open');
      el.tabbar.classList.remove('more-open');
    }
    closeMore = close;
    updateShell();
    try { sheet.focus({ preventScroll: true }); } catch (e) { /* не критично */ }
  }

  function updateTabs(current) {
    const name = current ? current.name : '';
    Object.keys(el.tabs).forEach((id) => {
      const active = id === name;
      el.tabs[id].classList.toggle('active', active);
      if (active) el.tabs[id].setAttribute('aria-current', 'page'); else el.tabs[id].removeAttribute('aria-current');
    });
    // Розділ не з нижньої панелі (Тренування, Люди, кабінет…) — підсвічено «Ще»
    el.moreTab.classList.toggle('active', !!name && !TABS.includes(name));
    // Назва у верхній панелі
    const home = name === 'home' || !name;
    el.title.classList.toggle('is-home', home);
    el.titleText.textContent = home ? 'Моя CRM' : ((current && current.def && current.def.title) || 'Моя CRM');
    updateTitleVisibility();
  }

  /** Назва розділу вгорі — коли великий заголовок сторінки прокручено під верхню панель (як на iPhone). */
  function updateTitleVisibility() {
    if (!el.title || el.title.classList.contains('is-home')) return;
    const h1 = el.page.querySelector('.page-head h1');
    const top = el.title.closest('.topbar');
    const limit = top ? top.getBoundingClientRect().bottom : 56;
    el.title.classList.toggle('show', !h1 || h1.getBoundingClientRect().bottom <= limit + 2);
  }
  let titleRaf = 0;
  window.addEventListener('scroll', () => {
    if (titleRaf) return;
    titleRaf = requestAnimationFrame(() => { titleRaf = 0; updateTitleVisibility(); });
  }, { passive: true });

  // Клавіатура на телефоні відкрита (курсор у полі) — нижню панель і ⚡ ховаємо, щоб не займали місце
  function editable(t) {
    if (!t || !t.tagName) return false;
    if (t.isContentEditable) return true;
    if (t.tagName === 'TEXTAREA' || t.tagName === 'SELECT') return true;
    return t.tagName === 'INPUT' && !/^(checkbox|radio|button|submit|reset|range|color|file|image)$/i.test(t.type || '');
  }
  function syncTyping() {
    document.documentElement.classList.toggle('is-typing', !!(coarseMq && coarseMq.matches && editable(document.activeElement)));
  }
  document.addEventListener('focusin', syncTyping);
  document.addEventListener('focusout', () => setTimeout(syncTyping, 60));
  // Поле з курсором зникло разом з вікном (браузер тоді не повідомляє про втрату фокуса) — перевірити при дотику
  document.addEventListener('pointerdown', () => setTimeout(syncTyping, 60), true);
  if (narrowMq && narrowMq.addEventListener) narrowMq.addEventListener('change', () => { if (!narrowMq.matches && closeMore) closeMore(); });

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
      // Меню, нижня панель і «Ще» (телефон) показують однакові лічильники
      const badges = Array.from(el.nav.querySelectorAll(`[data-count="${item.id}"]`))
        .concat(Array.from(document.querySelectorAll(`[data-nav-count="${item.id}"]`)));
      if (!badges.length) return;
      let c = 0;
      try { c = item.count(); } catch (e) { console.error(e); }
      const o = typeof c === 'number' ? { n: c } : (c || { n: 0 });
      badges.forEach((badge) => {
        badge.textContent = o.n ? String(o.n) : '';
        badge.classList.toggle('hot', !!(o.n && o.hot));
        if (o.title && o.n) badge.setAttribute('title', o.title); else badge.removeAttribute('title');
      });
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
      updateShell();
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

    // Службові модулі запускаємо окремо: помилка в одному (або неповне оновлення сайту,
    // коли index.html старий і не підключає новий файл) не має зупиняти весь застосунок.
    const missing = [];
    [['search', 'js/search.js'], ['notify', 'js/notifications.js'], ['gcal', 'js/gcal.js'], ['sync', 'js/sync.js'], ['backup', 'js/backup.js'], ['pwa', 'js/pwa.js'], ['keys', 'js/keys.js'], ['tutor', 'js/tutor.js']]
      .forEach(([name, file]) => {
        if (!CRM[name] || typeof CRM[name].init !== 'function') { missing.push(file); return; }
        try { CRM[name].init(); } catch (e) { console.error(e); }
      });
    if (!CRM.nutrition) missing.push('js/nutrition.js');
    if (!CRM.programs) missing.push('js/programs.js');
    if (!CRM.calendar) missing.push('js/calendar.js');
    if (!CRM.quick) missing.push('js/quick.js');
    if (!CRM.people) missing.push('js/people.js');
    if (!CRM.habits) missing.push('js/habits.js');
    if (!CRM.books) missing.push('js/books.js');
    else if (CRM.tasks && !CRM.tasks.create) missing.push('js/tasks.js (нова версія)');
    if (!CRM.bankImport) missing.push('js/budget/import.js');
    if (!CRM.limits) missing.push('js/budget/limits.js');
    if (CRM.tutor && !CRM.tutorMoney) missing.push('js/tutor-money.js');
    if (CRM.finance && !CRM.finance.isSplit) missing.push('js/budget/finance.js (нова версія)');
    if (missing.length) {
      console.error('Не завантажено: ' + missing.join(', '));
      setTimeout(() => CRM.ui.toast('Сайт оновлено не повністю: не підключено ' + missing.join(', ') +
        '. Завантаж на GitHub усі файли з папки CRM, разом з index.html (README, розділ «Як оновити сайт»).', { type: 'error', duration: 20000 }), 600);
    }

    CRM.router.onRender((cur) => {
      updateActiveNav(cur);
      if (closeMore) closeMore();
      updateTabs(cur);
      syncTyping();
      // Сторінка домалювалась (картинки, дані) — перевірити ще раз, чи видно великий заголовок
      setTimeout(updateTitleVisibility, 120);
    });

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

  CRM.app = { boot, ensureDefaults, updateShell, openMore: () => openMore(), closeMore: () => closeMore && closeMore() };
  boot();
})(window.CRM);
