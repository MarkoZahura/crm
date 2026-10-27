/* ==========================================================================
   search.js — глобальний пошук по всіх розділах (Ctrl+K / ⌘K).
   Шукає по даних у пам'яті, тому результати миттєві.
   ========================================================================== */
window.CRM = window.CRM || {};

(function (CRM) {
  'use strict';

  const { h } = CRM.ui;
  const PER_GROUP = 6;
  let dlg = null;

  // ---------- Пошук ----------
  function searchAll(query) {
    const q = CRM.utils.normalize(query);
    if (!q) return [];
    const terms = q.split(' ').filter(Boolean);
    const raw = String(query).trim();
    const numeric = /^[\d\s .,]+$/.test(raw) && /\d/.test(raw)
      ? raw.replace(/[\s ]/g, '').replace(',', '.')
      : null;

    const groups = [];
    CRM.entities.order.forEach((store) => {
      const t = CRM.entities.types[store];
      const matches = [];
      CRM.store.list(store).forEach((rec) => {
        const text = CRM.utils.normalize(t.text(rec).filter(Boolean).join(' '));
        let ok = terms.every((term) => text.includes(term));
        if (!ok && numeric && t.amounts) {
          ok = t.amounts(rec).some((a) => Number(a).toFixed(2).startsWith(numeric) || String(a).startsWith(numeric));
        }
        if (!ok) return;
        const title = CRM.utils.normalize(t.title(rec));
        const score = title.startsWith(q) ? 3 : title.includes(q) ? 2 : 1;
        matches.push({ store, rec, score });
      });
      if (!matches.length) return;
      matches.sort((a, b) => b.score - a.score || (b.rec.updatedAt || '').localeCompare(a.rec.updatedAt || ''));
      groups.push({ store, items: matches, best: matches[0].score });
    });
    // Групи з точнішими збігами в назві — вище; інакше — звичний порядок розділів
    return groups
      .map((g, i) => Object.assign(g, { i }))
      .sort((a, b) => b.best - a.best || a.i - b.i);
  }

  /** Підсвітити збіги в тексті (безпечно — лише текстові вузли й <mark>). */
  function highlight(text, query) {
    const terms = CRM.utils.normalize(query).split(' ').filter((t) => t.length > 0);
    if (!terms.length || !text) return [text];
    const re = new RegExp('(' + terms.map(CRM.utils.escapeRegExp).join('|') + ')', 'gi');
    const out = [];
    let last = 0;
    String(text).replace(re, (m, _g, idx) => {
      if (idx > last) out.push(text.slice(last, idx));
      out.push(h('mark', null, m));
      last = idx + m.length;
      return m;
    });
    if (last < text.length) out.push(text.slice(last));
    return out;
  }

  // ---------- Вікно пошуку (і швидкого введення — js/quick.js) ----------
  /**
   * initial — текст у полі; opts.quick — відкрито кнопкою ⚡ «Швидке введення».
   */
  function open(initial, opts) {
    const o = opts || {};
    if (dlg && dlg.isOpen) {
      const inp = dlg.body.querySelector('input');
      if (initial != null && initial !== '') { inp.value = initial; inp.dispatchEvent(new Event('input')); }
      inp.focus();
      return;
    }

    const Q = CRM.quick && typeof CRM.quick.plan === 'function' ? CRM.quick : null;
    let selected = 0;
    let flat = [];
    let plan = null;        // що можна створити з рядка (CRM.quick.plan)
    let prefer = null;      // вид, вибраний перемикачем «Подія | Задача | …» (для «a; b» — масив видів частин)
    let histPos = -1;       // ↑ / ↓ у порожньому полі — попередні рядки (CRM.quick.history)
    let histList = [];
    let cardEl = null;
    let renderedQ = null;   // для якого рядка показано результати

    const input = h('input', {
      class: 'search-input', type: 'text', enterkeyhint: Q ? 'go' : 'search',
      placeholder: Q ? (o.quick ? 'Напр.: завтра 15:00 урок · кава 65' : 'Пошук або швидке введення: «кава 65»…') : 'Пошук задач, транзакцій, рахунків, цілей…',
      'aria-label': Q ? 'Пошук або швидке введення' : 'Пошук', autocomplete: 'off', spellcheck: 'false', value: initial || ''
    });
    const results = h('div', { class: 'search-results', role: 'listbox', 'aria-label': 'Результати пошуку' });

    async function runQuick(more) {
      if (!plan) return;
      const text = input.value;
      dlg.close('select');
      try {
        if (plan.multi) {
          const done = await Q.createAll(plan);
          if (done && done.length && Q.history) Q.history.push(text);
          return;
        }
        const opt = plan.options[plan.index];
        if (more || !opt.ok) Q.details(opt);
        else {
          const res = await Q.create(opt);
          if (res && Q.history) Q.history.push(text);
        }
      } catch (e) {
        console.error(e);
        CRM.ui.toast('Не вдалося створити запис: ' + (e && e.message ? e.message : e), { type: 'error' });
      }
    }
    function setKind(kind, part) {
      if (!plan) return;
      if (plan.multi) {
        prefer = Array.isArray(prefer) ? prefer.slice() : [];
        prefer[part] = kind;
      } else prefer = kind;
      plan = Q.plan(input.value, prefer);
      if (!plan || !cardEl) return;
      const fresh = renderCard();
      cardEl.replaceWith(fresh);
      cardEl = fresh;
      setSelected(selected);
      input.focus();
    }
    function cycleKind(step) {
      if (!plan || plan.multi || plan.options.length < 2) return;
      const i = (plan.index + step + plan.options.length) % plan.options.length;
      setKind(plan.options[i].kind);
    }
    function renderCard() {
      const idx = flat.findIndex((x) => x.quick);
      const el = Q.card(plan, { onKind: setKind, onCreate: () => runQuick(false), onDetails: () => runQuick(true) });
      el.classList.add('search-opt');
      el.tabIndex = -1;
      el.addEventListener('mousemove', () => { if (selected !== idx) setSelected(idx); });
      el.addEventListener('click', (e) => { if (e.target === el || !e.target.closest('button')) { setSelected(idx); input.focus(); } });
      return el;
    }

    function choose(i, more) {
      const item = flat[i];
      if (!item) return;
      if (item.quick) { runQuick(more); return; }
      dlg.close('select');
      CRM.entities.open(item.store, item.rec.id);
    }

    function setSelected(i) {
      if (!flat.length) return;
      selected = (i + flat.length) % flat.length;
      results.querySelectorAll('.search-opt').forEach((el, idx) => {
        el.classList.toggle('selected', idx === selected);
        el.setAttribute('aria-selected', idx === selected ? 'true' : 'false');
        if (idx === selected) el.scrollIntoView({ block: 'nearest' });
      });
    }

    /** Підставити рядок у поле (часті рядки, приклади) — курсор у кінці, щоб можна було поправити суму. */
    function useLine(x) {
      input.value = x;
      histPos = -1;
      render();
      input.focus();
      try { input.setSelectionRange(x.length, x.length); } catch (e) { /* не всі поля це вміють */ }
    }
    /** Найчастіші рядки на цьому пристрої — кнопки під порожнім полем (× — прибрати з історії). */
    function frequent() {
      const top = Q.history ? Q.history.top(6) : [];
      if (!top.length) return null;
      return h('div', { class: 'quick-frequent' },
        h('div', { class: 'quick-frequent-title' }, CRM.icon('clock', { size: 'sm' }), 'Часто пишеш'),
        h('div', { class: 'quick-frequent-list' }, top.map((x) => h('span', { class: 'chip quick-freq' },
          h('button', {
            type: 'button', class: 'quick-freq-use', tabIndex: -1, title: 'Підставити в поле',
            onMousedown: (e) => e.preventDefault(), onClick: () => useLine(x)
          }, x),
          h('button', {
            type: 'button', class: 'quick-freq-del', tabIndex: -1, 'aria-label': `Прибрати «${x}» з історії`, title: 'Прибрати з історії',
            onMousedown: (e) => e.preventDefault(),
            onClick: () => { Q.history.remove(x); render(); input.focus(); }
          }, CRM.icon('x', { size: 'sm' }))))));
    }
    function emptyState() {
      if (!Q) {
        return CRM.ui.empty({
          icon: 'search', small: true, title: 'Що шукаємо?',
          text: 'Задачі (з описами й чеклістами), транзакції, рахунки, категорії, регулярні платежі, фінансові цілі, тренування, програми тренувань, харчування й навчання.'
        });
      }
      const freq = frequent();
      const many = !!freq && Q.history.top(6).length >= 3;
      return h('div', { class: 'quick-empty' },
        h('div', { class: 'quick-empty-title' }, CRM.icon(o.quick ? 'zap' : 'search', { size: 'sm' }), o.quick ? 'Що додати?' : 'Пошук і швидке введення'),
        h('p', { class: 'quick-empty-text' }, o.quick
          ? 'Напиши одним рядком — CRM створить подію, задачу, витрату, тренування чи запис їжі. Перед створенням покаже, що саме вийде.'
          : 'Шукай задачі, події, людей, транзакції, рахунки, тренування, харчування й навчання — або напиши, що створити:'),
        freq,
        // Коли вже є часті рядки (≥3) — приклади не показуємо, щоб на телефоні не було тісно
        many ? null : h('div', { class: 'quick-examples' }, Q.EXAMPLES.map((x) => h('button', {
          type: 'button', class: 'chip', tabIndex: -1,
          onMousedown: (e) => e.preventDefault(),
          onClick: () => useLine(x)
        }, x))),
        h('p', { class: 'quick-empty-hint' }, many
          ? 'Підказка: ↑ — попередні рядки (на компʼютері), кілька записів — через «;». Більше прикладів — у кабінеті, «Швидке введення».'
          : 'Час → подія, лише дата → задача в «Плані дня», сума → витрата («+» — дохід), «г» чи «ккал» → їжа. Ще: «щопонеділка 18:00 …», «нагадай о 18:00 …», «переказ 1000 моно → готівка», «біг 5 км 28 хв», «ДР Марти 5 листопада», «написав Марті», кілька записів — через «;». Прості правила, не ШІ.'));
    }

    function render() {
      const q = input.value;
      renderedQ = q;
      flat = [];
      selected = 0;
      cardEl = null;
      if (!q.trim()) {
        plan = null;
        prefer = null;
        CRM.ui.mount(results, emptyState());
        return;
      }
      try { plan = Q ? Q.plan(q, prefer) : null; } catch (e) { console.error(e); plan = null; }
      const groups = searchAll(q);
      if (!groups.length && !plan) {
        CRM.ui.mount(results, CRM.ui.empty({ icon: 'search', small: true, title: 'Нічого не знайдено', text: `За запитом «${q.trim()}» немає збігів.` }));
        return;
      }
      const nodes = [];
      const pushCard = () => {
        flat.push({ quick: true });
        cardEl = renderCard();
        nodes.push(cardEl);
      };
      // Є час, дата, сума чи вага — картка «Буде створено» над результатами пошуку
      if (plan && plan.strong) pushCard();
      groups.forEach((g) => {
        const t = CRM.entities.types[g.store];
        nodes.push(h('div', { class: 'search-group-title' }, `${t.group} · ${g.items.length}`));
        g.items.slice(0, PER_GROUP).forEach((m) => {
          const idx = flat.length;
          flat.push(m);
          nodes.push(h('button', {
            type: 'button', class: 'search-item search-opt', role: 'option', tabIndex: -1,
            onClick: () => choose(idx),
            onMousemove: () => { if (selected !== idx) setSelected(idx); }
          },
          h('span', { class: 'list-row-icon ' + t.iconClass }, CRM.icon(t.icon, { size: 'sm' })),
          h('span', { class: 'search-item-main' },
            h('span', { class: 'search-item-title' }, highlight(t.title(m.rec), q)),
            h('span', { class: 'search-item-sub' }, t.sub(m.rec))),
          CRM.icon('chevronRight', { size: 'sm', className: 'subtle' })));
        });
        if (g.items.length > PER_GROUP) {
          nodes.push(h('div', { class: 'search-more' }, `і ще ${g.items.length - PER_GROUP} — уточни запит`));
        }
      });
      // Просто слова — спершу пошук, а внизу «Створити задачу «…»»
      if (plan && !plan.strong) {
        if (!groups.length) nodes.push(h('div', { class: 'quick-none' }, `Нічого не знайдено за запитом «${q.trim()}».`));
        nodes.push(h('div', { class: 'search-group-title' }, 'Швидке введення'));
        pushCard();
      }
      CRM.ui.mount(results, nodes);
      setSelected(0);
    }

    // Нове введення — перерахувати одразу; перемикач виду лишається, поки рядок не стерто
    input.addEventListener('input', CRM.utils.debounce(render, 80));
    input.addEventListener('keydown', (e) => {
      if (e.isComposing) return;
      // Історія: ↑ у порожньому полі — попередній рядок, ще ↑ — старіший, ↓ — назад
      const browsing = histPos >= 0 && input.value === histList[histPos];
      if (Q && Q.history && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && !e.altKey && !e.ctrlKey && !e.metaKey &&
        (browsing || (e.key === 'ArrowUp' && !input.value.trim()))) {
        if (!browsing) { histList = Q.history.list(); histPos = -1; }
        const next = histPos + (e.key === 'ArrowUp' ? 1 : -1);
        if (next < histList.length && (next >= 0 || browsing)) {
          e.preventDefault();
          histPos = next;
          input.value = next >= 0 ? histList[next] : '';
          render();
          const end = input.value.length;
          try { input.setSelectionRange(end, end); } catch (err) { /* */ }
          return;
        }
        if (e.key === 'ArrowUp' && !browsing) { e.preventDefault(); return; }
      }
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(selected + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setSelected(selected - 1); }
      else if (e.key === 'Tab' && plan && plan.multi) { e.preventDefault(); }
      else if (e.key === 'Tab' && plan && plan.options.length > 1) { e.preventDefault(); cycleKind(e.shiftKey ? -1 : 1); }
      else if (e.key === 'Enter') {
        e.preventDefault();
        // Рядок щойно змінився, а пошук ще не перерахувався (debounce) — рахуємо зараз
        if (input.value !== renderedQ) render();
        choose(selected, e.shiftKey);
      }
    });

    const footer = h('div', { class: 'search-footer' },
      h('span', null, h('span', { class: 'kbd' }, '↑'), h('span', { class: 'kbd' }, '↓'), 'вибір'),
      h('span', null, h('span', { class: 'kbd' }, 'Enter'), Q ? 'відкрити / створити' : 'відкрити'),
      h('span', null, h('span', { class: 'kbd' }, 'Esc'), 'закрити'));

    dlg = CRM.ui.modal({
      hideHeader: true,
      className: 'search-modal' + (Q ? ' has-quick' : ''),
      size: 'lg',
      body: [
        h('div', { class: 'search-input-wrap' }, CRM.icon('search'), input),
        results,
        footer
      ],
      initialFocus: input,
      onClose: () => { dlg = null; }
    });
    render();
  }

  function init() {
    document.addEventListener('keydown', (e) => {
      // e.code — фізична клавіша, тож працює й з українською розкладкою (Ctrl+Л)
      if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.code === 'KeyK' || e.key === 'k' || e.key === 'K')) {
        e.preventDefault();
        open();
      }
    });
  }

  /** Кнопка ⚡ «Швидке введення» (верхня панель). */
  function openQuick() { open('', { quick: true }); }

  CRM.search = { init, open, openQuick, searchAll };
})(window.CRM);
