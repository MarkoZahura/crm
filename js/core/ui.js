/* ==========================================================================
   ui.js — невеликий помічник для інтерфейсу:
   • h() — створення елементів;
   • модалки, бічні панелі, спливні меню — закриваються Esc і кліком поза ними;
   • підтвердження, тости, порожні стани, поля форм.
   ========================================================================== */
window.CRM = window.CRM || {};

(function (CRM) {
  'use strict';

  // ---------- Створення елементів ----------
  const PROP_KEYS = new Set(['value', 'checked', 'disabled', 'selected', 'multiple', 'indeterminate', 'readOnly', 'htmlFor', 'tabIndex']);

  function appendChildren(el, children) {
    children.forEach((c) => {
      if (c == null || c === false || c === true) return;
      if (Array.isArray(c)) { appendChildren(el, c); return; }
      el.appendChild(c instanceof Node ? c : document.createTextNode(String(c)));
    });
  }

  /**
   * h('button', { class: 'btn', onClick: fn }, 'Текст', CRM.icon('plus'))
   * Текст завжди вставляється як текст (не як HTML) — це безпечно.
   */
  function h(tag, props, ...children) {
    const el = document.createElement(tag);
    if (props) {
      Object.keys(props).forEach((k) => {
        const v = props[k];
        if (v == null || v === false) return;
        if (k === 'class' || k === 'className') el.className = v;
        else if (k === 'style' && typeof v === 'object') {
          Object.keys(v).forEach((sk) => {
            if (sk.startsWith('--')) el.style.setProperty(sk, v[sk]);
            else el.style[sk] = v[sk];
          });
        } else if (k === 'dataset') Object.assign(el.dataset, v);
        else if (k === 'text') el.textContent = v;
        else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v);
        else if (PROP_KEYS.has(k)) el[k] = v;
        else if (v === true) el.setAttribute(k, '');
        else el.setAttribute(k, v);
      });
    }
    appendChildren(el, children);
    return el;
  }

  function mount(container, ...children) {
    container.replaceChildren();
    appendChildren(container, children);
    return container;
  }

  function button(opts) {
    const o = opts || {};
    const cls = ['btn'];
    if (o.variant) cls.push('btn-' + o.variant);
    if (o.size) cls.push('btn-' + o.size);
    if (o.iconOnly) cls.push('btn-icon');
    if (o.className) cls.push(o.className);
    return h('button', {
      type: o.type || 'button',
      class: cls.join(' '),
      title: o.title,
      'aria-label': o.ariaLabel || (o.iconOnly ? o.title : null),
      disabled: o.disabled,
      onClick: o.onClick
    },
    o.icon ? CRM.icon(o.icon) : null,
    o.label && !o.iconOnly ? h('span', { class: 'btn-label' }, o.label) : null);
  }

  // ---------- Шари (модалки, панелі, меню) ----------
  const layers = [];

  function updateScrollLock() {
    const locked = layers.some((l) => l.lock);
    document.body.classList.toggle('no-scroll', locked);
  }

  function pushLayer(layer) { layers.push(layer); updateScrollLock(); }
  function removeLayer(layer) {
    const i = layers.indexOf(layer);
    if (i >= 0) layers.splice(i, 1);
    updateScrollLock();
  }

  // Esc закриває верхній шар
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !layers.length) return;
    const top = layers[layers.length - 1];
    if (top.escClose === false) return;
    e.preventDefault();
    e.stopPropagation();
    top.close('esc');
  }, true);

  // Клік поза спливним меню закриває його
  document.addEventListener('mousedown', (e) => {
    for (let i = layers.length - 1; i >= 0; i--) {
      const l = layers[i];
      if (!l.outsideClose) break; // модалки обробляють клік по фону самі
      if (l.el.contains(e.target) || (l.anchor && l.anchor.contains(e.target))) break;
      l.close('outside');
    }
  }, true);

  function focusables(root) {
    return Array.from(root.querySelectorAll(
      'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter((el) => el.offsetParent !== null || el === document.activeElement);
  }

  function trapFocus(root, e) {
    if (e.key !== 'Tab') return;
    const list = focusables(root);
    if (!list.length) return;
    const first = list[0];
    const last = list[list.length - 1];
    if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  }

  /** Спільна логіка для модалки та бічної панелі. */
  function openOverlay(kind, opts) {
    const o = opts || {};
    const prevFocus = document.activeElement;
    const titleId = 'dlg-' + CRM.utils.uid().slice(0, 8);
    const overlay = h('div', { class: 'overlay' + (kind === 'drawer' ? ' overlay-drawer' : '') + (o.center ? ' overlay-center' : '') });

    const closeBtn = h('button', {
      type: 'button', class: 'btn btn-ghost btn-icon btn-sm', 'aria-label': 'Закрити', title: 'Закрити (Esc)',
      onClick: () => api.close('button')
    }, CRM.icon('x'));

    const titleEl = h(kind === 'drawer' ? 'h2' : 'h2', { class: 'modal-title', id: titleId }, o.title || '');
    const header = h('div', { class: kind === 'drawer' ? 'drawer-header' : 'modal-header' },
      titleEl,
      h('div', { class: 'btn-row' }, o.headerActions || null, closeBtn));
    const body = h('div', { class: kind === 'drawer' ? 'drawer-body' : 'modal-body' });
    appendChildren(body, [o.body]);
    const footer = h('div', { class: kind === 'drawer' ? 'drawer-footer' : 'modal-footer' });
    appendChildren(footer, [o.footer]);

    const box = h('div', {
      class: (kind === 'drawer' ? 'drawer' : 'modal modal-' + (o.size || 'md')) + (o.className ? ' ' + o.className : ''),
      role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': titleId, tabIndex: -1
    }, o.hideHeader ? null : header, body, o.footer ? footer : null);

    overlay.appendChild(box);

    // Закриття кліком по фону (лише якщо і натискання, і відпускання — на фоні)
    let downOnOverlay = false;
    overlay.addEventListener('mousedown', (e) => { downOnOverlay = e.target === overlay; });
    overlay.addEventListener('click', (e) => {
      if (e.target === overlay && downOnOverlay) api.close('outside');
      downOnOverlay = false;
    });
    box.addEventListener('keydown', (e) => trapFocus(box, e));

    let closed = false;
    const layer = { el: overlay, lock: true, outsideClose: false, close: (reason) => api.close(reason) };

    const api = {
      el: box, body, footer, titleEl, overlay,
      setTitle(t) { titleEl.textContent = t; },
      /** Закрити. Якщо onBeforeClose повертає false — вікно лишається. */
      close(reason) {
        if (closed) return;
        if (o.onBeforeClose && reason !== 'force' && o.onBeforeClose(reason) === false) return;
        closed = true;
        removeLayer(layer);
        overlay.remove();
        if (prevFocus && typeof prevFocus.focus === 'function' && document.contains(prevFocus)) {
          try { prevFocus.focus({ preventScroll: true }); } catch (e) { /* ігноруємо */ }
        }
        if (o.onClose) o.onClose(reason);
      },
      get isOpen() { return !closed; }
    };

    document.body.appendChild(overlay);
    pushLayer(layer);

    // Початковий фокус: заданий елемент, інакше перше поле модалки, інакше саме вікно
    const target = o.initialFocus === 'container' ? box : (o.initialFocus || box.querySelector('[autofocus]') ||
      (kind === 'modal' ? box.querySelector('.modal-body input, .modal-body select, .modal-body textarea') : null));
    (target || box).focus({ preventScroll: true });

    return api;
  }

  function modal(opts) { return openOverlay('modal', opts); }
  function drawer(opts) { return openOverlay('drawer', opts); }

  /**
   * Вікно підтвердження. Повертає Promise<boolean>.
   * ui.confirm({ title, message, confirmText, danger })
   */
  function confirm(opts) {
    const o = opts || {};
    return new Promise((resolve) => {
      let result = false;
      const cancelBtn = button({ label: o.cancelText || 'Скасувати', onClick: () => dlg.close('cancel') });
      const okBtn = button({
        label: o.confirmText || 'Підтвердити',
        variant: o.danger ? 'danger' : 'primary',
        onClick: () => { result = true; dlg.close('confirm'); }
      });
      const message = typeof o.message === 'string' ? h('p', { class: 'modal-text' }, o.message) : o.message;
      const dlg = modal({
        title: o.title || 'Підтвердження',
        size: 'sm',
        center: true,
        body: message,
        footer: [cancelBtn, okBtn],
        initialFocus: o.danger ? cancelBtn : okBtn,
        onClose: () => resolve(result)
      });
    });
  }

  // ---------- Спливне меню біля кнопки ----------
  function popover(anchor, content, opts) {
    const o = opts || {};
    const el = h('div', { class: 'popover' + (o.className ? ' ' + o.className : ''), role: o.role || 'dialog' });
    appendChildren(el, [content]);
    document.body.appendChild(el);

    function position() {
      const r = anchor.getBoundingClientRect();
      const w = el.offsetWidth;
      const hgt = el.offsetHeight;
      const vw = document.documentElement.clientWidth;
      const vh = window.innerHeight;
      const gap = o.offset == null ? 8 : o.offset;
      let left = o.align === 'start' ? r.left : r.right - w;
      left = Math.max(8, Math.min(left, vw - w - 8));
      let top = r.bottom + gap;
      // Не вміщається знизу — показуємо над кнопкою
      if (top + hgt > vh - 8 && r.top - gap - hgt >= 8) top = r.top - gap - hgt;
      el.style.left = left + 'px';
      el.style.top = Math.max(8, top) + 'px';
    }
    position();
    window.addEventListener('resize', position);

    let closed = false;
    const layer = { el, anchor, lock: false, outsideClose: true, close: (reason) => api.close(reason) };
    const api = {
      el,
      reposition: position,
      close(reason) {
        if (closed) return;
        closed = true;
        removeLayer(layer);
        window.removeEventListener('resize', position);
        el.remove();
        if (o.onClose) o.onClose(reason);
      },
      get isOpen() { return !closed; }
    };
    pushLayer(layer);
    return api;
  }

  /** Зареєструвати власний шар (напр., мобільне меню), щоб його закривав Esc. */
  function registerLayer(opts) {
    const layer = { el: opts.el, anchor: opts.anchor, lock: !!opts.lock, outsideClose: !!opts.outsideClose, close: opts.close };
    pushLayer(layer);
    return () => removeLayer(layer);
  }

  // ---------- Тости ----------
  let toastStack = null;
  function toast(message, opts) {
    const o = opts || {};
    if (!toastStack) {
      toastStack = h('div', { class: 'toast-stack', role: 'status', 'aria-live': 'polite' });
      document.body.appendChild(toastStack);
    }
    const type = o.type || 'info';
    const iconName = type === 'success' ? 'checkCircle' : type === 'error' ? 'alert' : 'info';
    let timer = null;
    const el = h('div', { class: 'toast toast-' + type },
      h('span', { class: 'toast-ico' }, CRM.icon(iconName)),
      h('div', { class: 'toast-msg' }, message),
      o.action ? h('button', {
        type: 'button', class: 'toast-action',
        onClick: () => { close(); o.action.onClick(); }
      }, o.action.label) : null,
      h('button', { type: 'button', class: 'toast-close', 'aria-label': 'Закрити', onClick: () => close() }, CRM.icon('x', { size: 'sm' })));

    function close() {
      clearTimeout(timer);
      if (!el.isConnected) return;
      el.classList.add('leaving');
      setTimeout(() => el.remove(), 170);
    }
    function start() {
      clearTimeout(timer);
      timer = setTimeout(close, o.duration || (o.action ? 7000 : 4000));
    }
    el.addEventListener('mouseenter', () => clearTimeout(timer));
    el.addEventListener('mouseleave', start);

    toastStack.appendChild(el);
    while (toastStack.children.length > 3) toastStack.firstChild.remove();
    start();
    return { close };
  }

  // ---------- Порожній стан ----------
  function empty(opts) {
    const o = opts || {};
    return h('div', { class: 'empty' + (o.small ? ' empty-sm' : '') },
      h('div', { class: 'empty-icon' }, CRM.icon(o.icon || 'inbox')),
      o.title ? h('div', { class: 'empty-title' }, o.title) : null,
      o.text ? h('div', { class: 'empty-text' }, o.text) : null,
      o.action ? button({
        label: o.action.label, icon: o.action.icon, variant: o.action.variant || 'primary', onClick: o.action.onClick
      }) : null);
  }

  // ---------- Поля форм ----------
  /**
   * Обгортка поля з підписом, підказкою та місцем для помилки.
   * Повертає елемент з методом setError(текст | null).
   */
  function field(opts) {
    const o = opts || {};
    const id = o.id || (o.input && o.input.id) || ('f-' + CRM.utils.uid().slice(0, 8));
    if (o.input && !o.input.id) o.input.id = id;
    const errorEl = h('div', { class: 'field-error', id: id + '-err' });
    const wrap = h('div', { class: 'field' + (o.className ? ' ' + o.className : '') },
      o.label ? h('label', { class: 'field-label', htmlFor: id }, o.label, o.required ? h('span', { class: 'req', 'aria-hidden': 'true' }, '*') : null) : null,
      o.input,
      o.hint ? h('div', { class: 'field-hint' }, o.hint) : null,
      errorEl);
    wrap.setError = function (msg) {
      wrap.classList.toggle('has-error', !!msg);
      errorEl.textContent = msg || '';
      if (o.input) {
        if (msg) { o.input.setAttribute('aria-invalid', 'true'); o.input.setAttribute('aria-describedby', errorEl.id); }
        else { o.input.removeAttribute('aria-invalid'); o.input.removeAttribute('aria-describedby'); }
      }
    };
    if (o.input) o.input.addEventListener('input', () => wrap.setError(null));
    return wrap;
  }

  function input(props) { return h('input', Object.assign({ class: 'input', type: 'text', autocomplete: 'off' }, props)); }
  function textarea(props) { return h('textarea', Object.assign({ class: 'textarea' }, props)); }
  function select(options, props) {
    const el = h('select', Object.assign({ class: 'select' }, props));
    options.forEach((op) => {
      el.appendChild(h('option', { value: op.value, selected: op.value === (props && props.value) }, op.label));
    });
    return el;
  }

  // ---------- Вибір дати (календар з понеділка, українською) ----------
  /**
   * Поле дати: кнопка з датою «26 вересня 2026», що відкриває календар.
   * opts: { value: 'РРРР-ММ-ДД' | null, onChange(value|null), placeholder, clearable (true), ariaLabel }
   * Поточне значення — властивість .dateValue.
   */
  function dateInput(opts) {
    const o = Object.assign({ clearable: true, placeholder: 'Оберіть дату' }, opts || {});
    const D = CRM.date;
    let value = D.isDate(o.value) ? o.value : null;
    let pop = null;
    const text = h('span', { class: 'date-trigger-text' });
    const btn = h('button', {
      type: 'button', class: 'input date-trigger', 'aria-haspopup': 'dialog', 'aria-label': o.ariaLabel || 'Дата'
    }, CRM.icon('calendar', { size: 'sm' }), text);

    function renderLabel() {
      text.textContent = value ? CRM.fmt.date(value) : o.placeholder;
      btn.classList.toggle('is-empty', !value);
      btn.title = value ? CRM.fmt.dateLong(value) : o.placeholder;
    }

    function pick(v) {
      value = v;
      renderLabel();
      if (pop) pop.close();
      btn.focus({ preventScroll: true });
      if (o.onChange) o.onChange(value);
    }

    function openCalendar() {
      let focusDate = value || D.today();
      let viewMonth = D.startOfMonth(focusDate);
      const title = h('div', { class: 'dp-title', 'aria-live': 'polite' });
      const grid = h('div', { class: 'dp-grid', role: 'grid' });

      function render(focusIt) {
        title.textContent = CRM.fmt.month(viewMonth);
        const start = D.startOfWeek(viewMonth);
        const today = D.today();
        const cells = [];
        for (let i = 0; i < 42; i++) {
          const d = D.addDays(start, i);
          const cls = ['dp-day'];
          if (d.slice(0, 7) !== viewMonth.slice(0, 7)) cls.push('other');
          if (d === today) cls.push('today');
          if (d === value) cls.push('selected');
          if (D.weekday(d) >= 5) cls.push('weekend');
          cells.push(h('button', {
            type: 'button', class: cls.join(' '), role: 'gridcell', tabIndex: d === focusDate ? 0 : -1,
            'aria-selected': d === value ? 'true' : 'false', 'aria-label': CRM.fmt.dateLong(d), dataset: { date: d },
            onClick: () => pick(d)
          }, String(D.parse(d).d)));
        }
        mount(grid, CRM.WEEKDAYS_SHORT.map((w, i) => h('span', { class: 'dp-wd' + (i >= 5 ? ' weekend' : ''), 'aria-hidden': 'true' }, w)), cells);
        if (focusIt) {
          const cell = grid.querySelector(`[data-date="${focusDate}"]`);
          if (cell) cell.focus({ preventScroll: true });
        }
      }

      function move(newDate) {
        focusDate = newDate;
        if (D.startOfMonth(newDate) !== viewMonth) viewMonth = D.startOfMonth(newDate);
        render(true);
      }
      function shiftMonth(n) {
        viewMonth = D.addMonths(viewMonth, n);
        focusDate = D.addMonths(focusDate, n);
        render(false);
      }

      grid.addEventListener('keydown', (e) => {
        const map = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
        if (map[e.key] != null) { e.preventDefault(); move(D.addDays(focusDate, map[e.key])); }
        else if (e.key === 'PageUp') { e.preventDefault(); move(D.addMonths(focusDate, -1)); }
        else if (e.key === 'PageDown') { e.preventDefault(); move(D.addMonths(focusDate, 1)); }
        else if (e.key === 'Home') { e.preventDefault(); move(D.startOfWeek(focusDate)); }
        else if (e.key === 'End') { e.preventDefault(); move(D.endOfWeek(focusDate)); }
      });

      const content = h('div', { class: 'dp', role: 'dialog', 'aria-label': 'Вибір дати' },
        h('div', { class: 'dp-head' },
          h('button', { type: 'button', class: 'btn btn-ghost btn-icon btn-sm', 'aria-label': 'Попередній місяць', onClick: () => shiftMonth(-1) }, CRM.icon('chevronLeft', { size: 'sm' })),
          title,
          h('button', { type: 'button', class: 'btn btn-ghost btn-icon btn-sm', 'aria-label': 'Наступний місяць', onClick: () => shiftMonth(1) }, CRM.icon('chevronRight', { size: 'sm' }))),
        grid,
        h('div', { class: 'dp-foot' },
          h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: () => pick(D.today()) }, 'Сьогодні'),
          o.clearable && value ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm', onClick: () => pick(null) }, 'Очистити') : null));

      render(false);
      pop = popover(btn, content, { align: 'start', className: 'dp-pop', onClose: () => { pop = null; } });
      const cell = grid.querySelector(`[data-date="${focusDate}"]`);
      if (cell) cell.focus({ preventScroll: true });
    }

    btn.addEventListener('click', () => {
      if (pop && pop.isOpen) { pop.close(); return; }
      openCalendar();
    });

    Object.defineProperty(btn, 'dateValue', {
      get: () => value,
      set: (v) => { value = D.isDate(v) ? v : null; renderLabel(); }
    });
    renderLabel();
    return btn;
  }

  /**
   * Поле часу у форматі 24 години («ГГ:ХХ»). Розуміє «930», «9:30», «18.30».
   * opts: { value, onChange(value|null), ariaLabel }
   */
  function timeInput(opts) {
    const o = opts || {};
    let last = o.value || '';
    const el = h('input', {
      class: 'input input-time', type: 'text', inputmode: 'numeric', placeholder: 'ГГ:ХХ', maxlength: 5,
      value: last, 'aria-label': o.ariaLabel || 'Час (необовʼязково)', autocomplete: 'off'
    });
    function parse(str) {
      const s = String(str || '').trim();
      if (!s) return '';
      const m = /^(\d{1,2})(?:[:.\s-]?(\d{2}))?$/.exec(s);
      if (!m) return null;
      const hh = Number(m[1]);
      const mm = m[2] ? Number(m[2]) : 0;
      if (hh > 23 || mm > 59) return null;
      return CRM.date.pad(hh) + ':' + CRM.date.pad(mm);
    }
    el.addEventListener('focus', () => { last = el.value; });
    el.addEventListener('input', () => el.classList.remove('invalid'));
    el.addEventListener('change', () => {
      const v = parse(el.value);
      if (v === null) {
        el.classList.add('invalid');
        toast('Час — у форматі ГГ:ХХ, напр., 09:30 або 18:45', { type: 'error' });
        el.value = last;
        return;
      }
      el.value = v;
      last = v;
      if (o.onChange) o.onChange(v || null);
    });
    el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); el.blur(); } });
    el.parseTime = parse;
    return el;
  }

  // ---------- Заголовок сторінки ----------
  function pageHead(opts) {
    const o = opts || {};
    return h('div', { class: 'page-head' },
      h('div', { class: 'page-head-text' },
        h('h1', null, o.title),
        o.sub ? h('div', { class: 'page-head-sub' }, o.sub) : null),
      o.actions ? h('div', { class: 'page-head-actions' }, o.actions) : null);
  }

  CRM.h = h;
  CRM.ui = {
    h, mount, button, modal, drawer, confirm, popover, registerLayer, toast, empty,
    field, input, textarea, select, pageHead, dateInput, timeInput,
    get openLayers() { return layers.length; }
  };
})(window.CRM);
