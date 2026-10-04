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

  // ---------- Вікно пошуку ----------
  function open(initial) {
    if (dlg && dlg.isOpen) { dlg.body.querySelector('input').focus(); return; }

    let selected = 0;
    let flat = [];

    const input = h('input', {
      class: 'search-input', type: 'text', enterkeyhint: 'search', placeholder: 'Пошук задач, транзакцій, рахунків, цілей…',
      'aria-label': 'Пошук', autocomplete: 'off', spellcheck: 'false', value: initial || ''
    });
    const results = h('div', { class: 'search-results', role: 'listbox', 'aria-label': 'Результати пошуку' });

    function choose(i) {
      const item = flat[i];
      if (!item) return;
      dlg.close('select');
      CRM.entities.open(item.store, item.rec.id);
    }

    function setSelected(i) {
      if (!flat.length) return;
      selected = (i + flat.length) % flat.length;
      results.querySelectorAll('.search-item').forEach((el, idx) => {
        el.classList.toggle('selected', idx === selected);
        el.setAttribute('aria-selected', idx === selected ? 'true' : 'false');
        if (idx === selected) el.scrollIntoView({ block: 'nearest' });
      });
    }

    function render() {
      const q = input.value;
      flat = [];
      selected = 0;
      if (!q.trim()) {
        CRM.ui.mount(results, CRM.ui.empty({
          icon: 'search', small: true, title: 'Що шукаємо?',
          text: 'Задачі (з описами й чеклістами), транзакції, рахунки, категорії, регулярні платежі, фінансові цілі, тренування, програми тренувань, харчування й навчання.'
        }));
        return;
      }
      const groups = searchAll(q);
      if (!groups.length) {
        CRM.ui.mount(results, CRM.ui.empty({ icon: 'search', small: true, title: 'Нічого не знайдено', text: `За запитом «${q.trim()}» немає збігів.` }));
        return;
      }
      const nodes = [];
      groups.forEach((g) => {
        const t = CRM.entities.types[g.store];
        nodes.push(h('div', { class: 'search-group-title' }, `${t.group} · ${g.items.length}`));
        g.items.slice(0, PER_GROUP).forEach((m) => {
          const idx = flat.length;
          flat.push(m);
          nodes.push(h('button', {
            type: 'button', class: 'search-item', role: 'option', tabIndex: -1,
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
      CRM.ui.mount(results, nodes);
      setSelected(0);
    }

    input.addEventListener('input', CRM.utils.debounce(render, 80));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(selected + 1); }
      else if (e.key === 'ArrowUp') { e.preventDefault(); setSelected(selected - 1); }
      else if (e.key === 'Enter') { e.preventDefault(); choose(selected); }
    });

    const footer = h('div', { class: 'search-footer' },
      h('span', null, h('span', { class: 'kbd' }, '↑'), h('span', { class: 'kbd' }, '↓'), 'вибір'),
      h('span', null, h('span', { class: 'kbd' }, 'Enter'), 'відкрити'),
      h('span', null, h('span', { class: 'kbd' }, 'Esc'), 'закрити'));

    dlg = CRM.ui.modal({
      hideHeader: true,
      className: 'search-modal',
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

  CRM.search = { init, open, searchAll };
})(window.CRM);
