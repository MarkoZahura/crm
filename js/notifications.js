/* ==========================================================================
   notifications.js — центр сповіщень (дзвіночок), правила нагадувань,
   системні сповіщення браузера.

   Важливо: без сервера нагадування перевіряються лише тоді, коли сайт
   відкритий (вкладка може бути у фоні). Коли сайт закрито — нічого не приходить.

   Розділи додають свої правила через CRM.notify.addRule(fn):
   fn() повертає масив { key, kind, title, text, target } — сповіщення з
   однаковим key створюється лише один раз.

   Формати ключів:
     task:due-today:<id>:<дата>      task:due-tomorrow:<id>:<дата дедлайну>
     task:overdue:<id>:<дата дедлайну>   task:done:<id>:<мітка часу>
     payment:today:<id>:<дата>       payment:tomorrow:<id>:<дата>
     goal:achieved:<id>              event:<id події>:<початок>
     learning:due-today|due-tomorrow|overdue:<курс>:<тема|course>:<дата>
   ========================================================================== */
window.CRM = window.CRM || {};

(function (CRM) {
  'use strict';

  const { h } = CRM.ui;
  const KEEP_DAYS = 60;

  const KINDS = {
    task: { icon: 'tasks', cls: 'ico-task' },
    payment: { icon: 'repeat', cls: 'ico-payment' },
    goal: { icon: 'target', cls: 'ico-goal' },
    event: { icon: 'calendar', cls: 'ico-event' },
    learning: { icon: 'graduation', cls: 'ico-learning' },
    system: { icon: 'info', cls: 'ico-event' }
  };

  const rules = [];
  let bellBtn = null;
  let badge = null;
  let panel = null;

  // ---------- Дані ----------
  function all() {
    return CRM.store.list('notifications').sort((a, b) => (b.at || b.createdAt).localeCompare(a.at || a.createdAt));
  }
  function visible() { return all().filter((n) => !n.dismissed); }
  function unreadCount() { return visible().filter((n) => !n.read).length; }

  /**
   * Додати сповіщення.
   * n = { key, kind, title, text, target: { store, id } | { route, params } | { url } }
   */
  async function push(n) {
    if (n.key && CRM.store.list('notifications').some((x) => x.key === n.key)) return null;
    const rec = await CRM.store.save('notifications', {
      key: n.key || null, kind: n.kind || 'system', title: n.title, text: n.text || '',
      target: n.target || null, read: !!n.read, dismissed: false, at: new Date().toISOString()
    });
    if (!rec.read) showSystem(rec);
    return rec;
  }

  async function markRead(id) {
    const n = CRM.store.get('notifications', id);
    if (n && !n.read) await CRM.store.patch('notifications', id, { read: true });
  }

  async function markAllRead() {
    const unread = visible().filter((n) => !n.read).map((n) => Object.assign({}, n, { read: true }));
    if (unread.length) await CRM.store.saveMany('notifications', unread);
  }

  /** «Очистити»: сповіщення ховаються, але їхні ключі пам'ятаються, щоб не з'явитися знову. */
  async function dismissAll() {
    const list = visible().map((n) => Object.assign({}, n, { read: true, dismissed: true }));
    if (list.length) await CRM.store.saveMany('notifications', list);
  }

  async function cleanupOld() {
    const limit = Date.now() - KEEP_DAYS * 86400000;
    const old = all().filter((n) => new Date(n.at || n.createdAt).getTime() < limit);
    for (const n of old) await CRM.store.removeForever('notifications', n.id);
  }

  function openTarget(n) {
    if (!n || !n.target) return;
    if (n.target.store) CRM.entities.open(n.target.store, n.target.id);
    else if (n.target.url && /^https:\/\//.test(n.target.url)) window.open(n.target.url, '_blank', 'noopener,noreferrer');
    else if (n.target.route) CRM.router.go(n.target.route, n.target.params || null);
  }

  // ---------- Правила ----------
  function addRule(fn) { rules.push(fn); }

  let running = false;
  async function runRules() {
    if (running) return;
    running = true;
    try {
      for (const rule of rules) {
        let items = [];
        try { items = (await rule()) || []; } catch (e) { console.error(e); }
        for (const it of items) await push(it);
      }
    } finally {
      running = false;
    }
  }

  // ---------- Системні сповіщення браузера ----------
  function supported() { return 'Notification' in window; }
  function permission() { return supported() ? Notification.permission : 'unsupported'; }
  function systemEnabled() {
    return permission() === 'granted' && CRM.store.getSetting('systemNotifications', true) !== false;
  }

  /** Показати системне сповіщення (за замовчуванням — лише коли вкладка не в фокусі). */
  function showSystem(rec, force) {
    if (!systemEnabled()) return false;
    if (!force && document.visibilityState === 'visible' && document.hasFocus()) return false;
    try {
      const n = new Notification(rec.title, { body: rec.text || '', tag: rec.key || rec.id, lang: 'uk' });
      n.onclick = () => {
        window.focus();
        n.close();
        markRead(rec.id);
        openTarget(rec);
      };
      return true;
    } catch (e) {
      // Деякі мобільні браузери не дозволяють сповіщення без service worker — тоді лише дзвіночок
      return false;
    }
  }

  async function requestPermission() {
    if (!supported()) {
      CRM.ui.toast('Цей браузер не підтримує системні сповіщення', { type: 'error' });
      return 'unsupported';
    }
    let result;
    try {
      result = await Notification.requestPermission();
    } catch (e) {
      result = Notification.permission;
    }
    if (result === 'granted') {
      await CRM.store.setSetting('systemNotifications', true);
      CRM.ui.toast('Системні сповіщення увімкнено', { type: 'success' });
    } else if (result === 'denied') {
      CRM.ui.toast('Браузер заблокував сповіщення. Дозволь їх у налаштуваннях сайту (значок ліворуч від адреси).', { type: 'error', duration: 8000 });
    }
    refreshPanel();
    document.dispatchEvent(new CustomEvent('crm:notifpermission'));
    return result;
  }

  /** Тестове сповіщення: і в дзвіночок, і системне (навіть якщо вкладка активна). */
  async function test() {
    const rec = await push({
      key: 'test:' + Date.now(), kind: 'system',
      title: 'Тестове сповіщення', text: 'Так виглядатимуть нагадування про задачі, платежі й події.'
    });
    if (rec) {
      const shown = showSystem(rec, true);
      if (!shown && permission() === 'granted') {
        CRM.ui.toast('Сповіщення додано в дзвіночок. Системні вимкнені або не підтримуються.');
      } else if (!shown) {
        CRM.ui.toast('Сповіщення додано в дзвіночок. Щоб бачити й системні — дозволь їх.');
      }
    }
  }

  // ---------- Дзвіночок ----------
  function createBell() {
    badge = h('span', { class: 'bell-badge', hidden: true });
    bellBtn = h('button', {
      type: 'button', class: 'btn btn-ghost btn-icon bell', title: 'Сповіщення', 'aria-label': 'Сповіщення',
      'aria-haspopup': 'dialog', onClick: togglePanel
    }, CRM.icon('bell'), badge);
    updateBadge();
    CRM.store.on(['notifications', '*'], () => { updateBadge(); refreshPanel(); });
    return bellBtn;
  }

  function updateBadge() {
    if (!badge) return;
    const n = unreadCount();
    badge.hidden = n === 0;
    badge.textContent = n > 9 ? '9+' : String(n);
    bellBtn.setAttribute('aria-label', n ? `Сповіщення: ${n} непрочитаних` : 'Сповіщення');
  }

  function togglePanel() {
    if (panel && panel.isOpen) { panel.close(); return; }
    panel = CRM.ui.popover(bellBtn, buildPanel(), { className: 'notif-pop', align: 'end', onClose: () => { panel = null; } });
  }

  function refreshPanel() {
    if (!panel || !panel.isOpen) return;
    panel.el.replaceChildren(buildPanel());
    panel.reposition();
  }

  function buildPanel() {
    const items = visible();
    const hasUnread = items.some((n) => !n.read);

    const head = h('div', { class: 'notif-head' },
      h('h3', null, 'Сповіщення'),
      h('div', { class: 'btn-row' },
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', disabled: !hasUnread, onClick: () => markAllRead() }, 'Прочитати всі'),
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm', disabled: !items.length, onClick: () => dismissAll() }, 'Очистити')));

    let banner = null;
    if (permission() === 'default') {
      banner = h('div', { class: 'notif-banner' },
        CRM.icon('bell', { size: 'sm' }),
        h('span', null, 'Показувати нагадування, коли вкладка у фоні'),
        h('button', { type: 'button', class: 'btn btn-sm btn-primary', onClick: () => requestPermission() }, 'Увімкнути'));
    }

    const list = items.length
      ? h('div', { class: 'notif-list' }, items.slice(0, 50).map(renderItem))
      : CRM.ui.empty({ icon: 'bell', title: 'Поки що тихо', text: 'Тут зʼявлятимуться нагадування про дедлайни, платежі, цілі й події.', small: true });

    return h('div', { class: 'notif-panel', role: 'dialog', 'aria-label': 'Сповіщення' },
      head, banner, list,
      h('div', { class: 'notif-foot' }, 'Нагадування приходять, поки сайт відкритий (вкладка може бути у фоні).'));
  }

  function renderItem(n) {
    const k = KINDS[n.kind] || KINDS.system;
    return h('button', {
      type: 'button', class: 'notif-item' + (n.read ? '' : ' unread'),
      onClick: async () => {
        if (panel) panel.close();
        await markRead(n.id);
        openTarget(n);
      }
    },
    h('span', { class: 'list-row-icon ' + k.cls }, CRM.icon(k.icon, { size: 'sm' })),
    h('span', { class: 'notif-main' },
      h('span', { class: 'notif-title' }, n.title),
      n.text ? h('span', { class: 'notif-text' }, n.text) : null,
      h('span', { class: 'notif-time' }, CRM.fmt.timeAgo(n.at || n.createdAt))),
    n.read ? null : h('span', { class: 'dot notif-unread-dot', 'aria-label': 'Непрочитане' }));
  }

  // ---------- Запуск ----------
  function init() {
    cleanupOld().catch((e) => console.error(e));
    runRules();
    document.addEventListener('crm:minute', () => { runRules(); refreshPanel(); });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') runRules(); });
  }

  CRM.notify = {
    KINDS, push, addRule, runRules, markRead, markAllRead, dismissAll, openTarget,
    permission, supported, requestPermission, systemEnabled, test, createBell, init, unreadCount
  };
})(window.CRM);
