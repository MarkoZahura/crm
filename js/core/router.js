/* ==========================================================================
   router.js — навігація через «#» в адресі.
   Приклади: #/home, #/tasks?open=<id>, #/budget/accounts
   Працює і з файлу (подвійний клік), і на GitHub Pages.
   ========================================================================== */
window.CRM = window.CRM || {};

(function (CRM) {
  'use strict';

  const routes = new Map();
  const afterRender = new Set();
  let current = null;

  /**
   * Зареєструвати розділ.
   * def = { title, stores: ['tasks', …], render(container, route) → [cleanup] }
   * stores — які дані перемальовують сторінку при зміні.
   */
  function register(name, def) { routes.set(name, def); }

  function parse() {
    const raw = location.hash.replace(/^#\/?/, '');
    const qIndex = raw.indexOf('?');
    const pathStr = qIndex >= 0 ? raw.slice(0, qIndex) : raw;
    const qs = qIndex >= 0 ? raw.slice(qIndex + 1) : '';
    const parts = pathStr.split('/').filter(Boolean);
    const params = {};
    new URLSearchParams(qs).forEach((v, k) => { params[k] = v; });
    return { name: parts[0] || 'home', sub: parts[1] || null, parts, params };
  }

  function href(path, params) {
    let s = '#/' + String(path || 'home').replace(/^\/+/, '');
    const clean = {};
    Object.keys(params || {}).forEach((k) => { if (params[k] != null && params[k] !== '') clean[k] = params[k]; });
    const qs = new URLSearchParams(clean).toString();
    if (qs) s += '?' + qs;
    return s;
  }

  /** Перейти: go('budget/accounts', { open: id }) */
  function go(path, params, opts) {
    const target = href(path, params);
    if (location.hash === target) { render(); return; }
    if (opts && opts.replace) {
      history.replaceState(null, '', target);
      render();
    } else {
      location.hash = target;
    }
  }

  /** Прибрати параметр з адреси без перемальовування (напр., після відкриття запису). */
  function consumeParam(key) {
    const r = parse();
    if (!(key in r.params)) return;
    delete r.params[key];
    history.replaceState(null, '', href(r.parts.join('/') || 'home', r.params));
    if (current) current.route = parse();
  }

  function render() {
    const r = parse();
    const def = routes.get(r.name);
    if (!def) { go('home', null, { replace: true }); return; }
    const container = document.getElementById('page');
    if (!container) return;
    const samePage = current && current.name === r.name && current.sub === r.sub;
    if (current && current.cleanup) { try { current.cleanup(); } catch (e) { console.error(e); } }
    if (CRM.charts) CRM.charts.destroyAll();
    let cleanup = null;
    try {
      cleanup = def.render(container, r);
    } catch (e) {
      console.error(e);
      CRM.ui.mount(container, CRM.ui.empty({
        icon: 'alert', title: 'Щось пішло не так', text: 'Не вдалося показати сторінку. Спробуй оновити її (F5).'
      }));
    }
    current = { name: r.name, sub: r.sub, def, route: r, cleanup: typeof cleanup === 'function' ? cleanup : null };
    document.title = (def.title ? def.title + ' · ' : '') + 'Моя CRM';
    if (!samePage) window.scrollTo(0, 0);
    afterRender.forEach((fn) => fn(current));
  }

  /** Перемалювати поточну сторінку, зберігши прокрутку. */
  function rerender() {
    if (!current) return;
    const y = window.scrollY;
    const container = document.getElementById('page');
    if (current.cleanup) { try { current.cleanup(); } catch (e) { console.error(e); } }
    if (CRM.charts) { CRM.charts.destroyAll(); CRM.charts.setQuiet(true); }
    let cleanup = null;
    try {
      cleanup = current.def.render(container, parse());
    } catch (e) {
      console.error(e);
    }
    // Діаграми створюються в наступному кадрі — тоді ж повертаємо анімацію
    if (CRM.charts) requestAnimationFrame(() => requestAnimationFrame(() => CRM.charts.setQuiet(false)));
    current.cleanup = typeof cleanup === 'function' ? cleanup : null;
    window.scrollTo(0, y);
  }

  function start() {
    window.addEventListener('hashchange', render);
    render();
  }

  CRM.router = {
    register, parse, href, go, consumeParam, render, rerender, start,
    onRender: (fn) => { afterRender.add(fn); return () => afterRender.delete(fn); },
    get current() { return current; },
    get routes() { return routes; }
  };
})(window.CRM);
