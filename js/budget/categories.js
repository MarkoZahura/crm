/* ==========================================================================
   categories.js — вкладка «Категорії».
   Два списки — «Витрати» і «Доходи», у кожного своя кнопка «Додати категорію».
   Вікно категорії: назва, колір з палітри, субкатегорії.
   Видалення категорії з операціями — з пропозицією перенести їх в іншу.
   ========================================================================== */
window.CRM = window.CRM || {};

(function (CRM) {
  'use strict';

  const { h, ui } = { h: CRM.ui.h, ui: CRM.ui };
  const fmt = CRM.fmt;
  const F = () => CRM.finance;

  function txOfCategory(id) { return CRM.store.list('transactions').filter((t) => t.categoryId === id); }

  function column(kind, title) {
    const cats = F().categories(kind);
    const counts = new Map();
    CRM.store.list('transactions').forEach((t) => { if (t.categoryId) counts.set(t.categoryId, (counts.get(t.categoryId) || 0) + 1); });
    return h('section', { class: 'card' },
      h('div', { class: 'card-head' },
        h('h2', null, title, h('span', { class: 'tab-count' }, String(cats.length))),
        ui.button({ label: 'Додати категорію', icon: 'plus', size: 'sm', onClick: () => openCategoryForm(null, kind) })),
      cats.length
        ? h('div', { class: 'cat-list' }, cats.map((c) => {
          const subs = c.subcategories || [];
          const n = counts.get(c.id) || 0;
          return h('button', { type: 'button', class: 'cat-row', onClick: () => openCategoryForm(c.id), dataset: { id: c.id } },
            h('span', { class: 'cat-swatch', style: { background: CRM.dict.categoryColor(c.color) } }),
            h('span', { class: 'cat-main' },
              h('span', { class: 'cat-name' }, c.name),
              subs.length ? h('span', { class: 'cat-subs' }, subs.slice(0, 4).map((s) => h('span', { class: 'mini-chip' }, s.name)), subs.length > 4 ? h('span', { class: 'mini-chip' }, '+' + (subs.length - 4)) : null) : null),
            h('span', { class: 'cat-count subtle num' }, n ? fmt.count(n, ['операція', 'операції', 'операцій']) : 'немає операцій'));
        }))
        : ui.empty({ icon: 'tag', small: true, title: 'Ще немає категорій', text: 'Додай першу, щоб розподіляти ' + (kind === 'expense' ? 'витрати.' : 'доходи.') }));
  }

  function render(container, route) {
    ui.mount(container,
      h('div', { class: 'toolbar' }, h('div', { class: 'toolbar-note' }, 'Колір категорії використовується в діаграмах. Субкатегорії — необовʼязкові.')),
      h('div', { class: 'cat-columns' }, column('expense', 'Витрати'), column('income', 'Доходи')));
    if (route.params.open) {
      const id = route.params.open;
      CRM.router.consumeParam('open');
      setTimeout(() => openCategoryForm(id), 0);
    }
  }

  // ---------- Вікно категорії ----------
  function openCategoryForm(id, kind) {
    const existing = id ? CRM.store.get('categories', id) : null;
    if (id && (!existing || existing.deletedAt)) { ui.toast('Категорію не знайдено', { type: 'error' }); return null; }
    const isNew = !existing;
    const st = existing ? CRM.utils.deepClone(existing) : {
      kind: kind || 'expense', name: '', color: nextFreeColor(kind || 'expense'), subcategories: [],
      order: F().categories(kind || 'expense').length
    };

    const nameIn = ui.input({ value: st.name, maxlength: 40, placeholder: kind === 'income' ? 'Напр., Зарплата' : 'Напр., Продукти' });
    const fName = ui.field({ label: 'Назва', input: nameIn, required: true });

    const sw = h('div', { class: 'swatches', role: 'radiogroup', 'aria-label': 'Колір' });
    function renderSw() {
      ui.mount(sw, CRM.dict.categoryColors.map((c) => h('button', {
        type: 'button', role: 'radio', class: 'swatch' + (st.color === c.id ? ' active' : ''),
        style: { '--sw': CRM.dict.categoryColor(c.id) }, title: c.name, 'aria-label': c.name,
        'aria-checked': st.color === c.id ? 'true' : 'false',
        onClick: () => { st.color = c.id; renderSw(); }
      }, st.color === c.id ? CRM.icon('check') : null)));
    }
    renderSw();
    const fColor = ui.field({ label: 'Колір', input: sw });

    const subsBox = h('div', { class: 'subs-edit' });
    const newSubIn = ui.input({ placeholder: 'Нова субкатегорія — Enter', maxlength: 40, 'aria-label': 'Нова субкатегорія' });
    function addSub() {
      const v = newSubIn.value.trim();
      if (!v) return;
      if (st.subcategories.some((s) => CRM.utils.normalize(s.name) === CRM.utils.normalize(v))) { ui.toast('Така субкатегорія вже є'); return; }
      st.subcategories.push({ id: CRM.utils.uid(), name: v });
      newSubIn.value = '';
      renderSubs();
      newSubIn.focus();
    }
    newSubIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addSub(); } });
    function renderSubs() {
      ui.mount(subsBox, st.subcategories.map((s) => {
        const inp = h('input', { class: 'input input-sm', value: s.name, maxlength: 40, 'aria-label': 'Назва субкатегорії' });
        inp.addEventListener('input', () => { s.name = inp.value; });
        return h('div', { class: 'sub-row' }, inp,
          h('button', {
            type: 'button', class: 'btn btn-ghost btn-icon btn-sm', title: 'Видалити субкатегорію', 'aria-label': 'Видалити субкатегорію',
            onClick: () => { st.subcategories = st.subcategories.filter((x) => x.id !== s.id); renderSubs(); }
          }, CRM.icon('x', { size: 'sm' })));
      }));
    }
    renderSubs();
    const fSubs = ui.field({
      label: 'Субкатегорії', input: h('div', { class: 'form-stack', style: { gap: '8px' } }, subsBox,
        h('div', { class: 'sub-row' }, newSubIn, ui.button({ label: 'Додати', size: 'sm', onClick: addSub })))
    });

    async function submit(e) {
      if (e) e.preventDefault();
      if (newSubIn.value.trim()) addSub();
      const name = nameIn.value.trim();
      if (!name) { fName.setError('Вкажи назву категорії'); return; }
      const dup = F().categories(st.kind).some((c) => c.id !== (existing && existing.id) && CRM.utils.normalize(c.name) === CRM.utils.normalize(name));
      if (dup) { fName.setError('Категорія з такою назвою вже є'); return; }
      st.subcategories = st.subcategories.map((s) => ({ id: s.id, name: s.name.trim() })).filter((s) => s.name);

      // Видалені субкатегорії з операціями: операції лишаються в категорії без субкатегорії
      if (existing) {
        const kept = new Set(st.subcategories.map((s) => s.id));
        const removed = (existing.subcategories || []).filter((s) => !kept.has(s.id));
        const affected = txOfCategory(existing.id).filter((t) => t.subcategoryId && !kept.has(t.subcategoryId));
        if (affected.length) {
          const ok = await ui.confirm({
            title: 'Видалити субкатегорії з операціями?',
            message: `${fmt.count(affected.length, ['операція', 'операції', 'операцій'])} із субкатегоріями ${removed.map((s) => `«${s.name}»`).join(', ')} залишаться в категорії «${name}» без субкатегорії.`,
            confirmText: 'Так, зберегти'
          });
          if (!ok) return;
          await CRM.store.saveMany('transactions', affected.map((t) => Object.assign({}, t, { subcategoryId: null })));
        }
      }
      const rec = Object.assign(existing ? CRM.utils.deepClone(existing) : {}, {
        kind: st.kind, name, color: st.color, subcategories: st.subcategories, order: st.order
      });
      await CRM.store.save('categories', rec);
      dlg.close('force');
      ui.toast(isNew ? `Категорію «${name}» додано` : 'Зміни збережено', { type: 'success' });
    }

    const form = h('form', { class: 'form-stack', novalidate: true, onSubmit: submit },
      fName, fColor, fSubs, h('button', { type: 'submit', hidden: true, tabIndex: -1, 'aria-hidden': 'true' }));

    const dlg = ui.modal({
      title: isNew ? (st.kind === 'income' ? 'Нова категорія доходів' : 'Нова категорія витрат') : 'Категорія',
      size: 'md', body: form,
      footer: h('div', { class: 'drawer-footer-inner' },
        existing ? ui.button({ label: 'Видалити', icon: 'trash', variant: 'danger-ghost', onClick: () => { dlg.close('force'); removeCategory(existing.id); } }) : null,
        h('span', { class: 'grow' }),
        ui.button({ label: 'Скасувати', onClick: () => dlg.close('button') }),
        ui.button({ label: isNew ? 'Додати' : 'Зберегти', variant: 'primary', icon: isNew ? 'plus' : 'check', onClick: () => submit() })),
      initialFocus: isNew ? nameIn : 'container'
    });
    return dlg;
  }

  function nextFreeColor(kind) {
    const used = new Set(F().categories(kind).map((c) => c.color));
    const free = CRM.dict.categoryColors.find((c) => !used.has(c.id));
    return free ? free.id : CRM.dict.categoryColors[0].id;
  }

  // ---------- Видалення з перенесенням операцій ----------
  async function removeCategory(id) {
    const cat = CRM.store.get('categories', id);
    if (!cat) return;
    const txs = txOfCategory(id);
    if (!txs.length) {
      const ok = await ui.confirm({
        title: 'Видалити категорію?', message: `«${cat.name}» потрапить у Кошик. Відновити можна протягом 30 днів.`,
        confirmText: 'Видалити', danger: true
      });
      if (!ok) return;
      const batch = await CRM.store.softDelete('categories', id);
      ui.toast('Категорію перенесено в Кошик', { action: { label: 'Скасувати', onClick: () => CRM.store.restoreBatch(batch) } });
      return;
    }
    const others = F().categories(cat.kind).filter((c) => c.id !== id);
    if (!others.length) {
      ui.modal({
        title: 'Не можна видалити', size: 'sm', center: true,
        body: h('p', { class: 'modal-text' }, `У категорії «${cat.name}» є ${fmt.count(txs.length, ['операція', 'операції', 'операцій'])}, а іншої категорії ${cat.kind === 'income' ? 'доходів' : 'витрат'}, куди їх можна перенести, немає. Спершу створи ще одну категорію.`)
      });
      return;
    }
    const target = ui.select(others.map((c) => ({ value: c.id, label: c.name })), { value: (others.find((c) => c.name === 'Інше') || others[0]).id, 'aria-label': 'Куди перенести' });
    let moveBtn;
    const dlg = ui.modal({
      title: 'Перенести операції й видалити?', size: 'sm', center: true,
      body: h('div', { class: 'form-stack' },
        h('p', { class: 'modal-text' }, `У категорії «${cat.name}» ${fmt.count(txs.length, ['операція', 'операції', 'операцій'])}. Перед видаленням перенеси їх в іншу категорію:`),
        ui.field({ label: 'Перенести в', input: target }),
        h('p', { class: 'field-hint' }, 'Субкатегорії операцій при цьому очищуються. Категорія потрапить у Кошик.')),
      footer: [
        ui.button({ label: 'Скасувати', onClick: () => dlg.close('button') }),
        (moveBtn = ui.button({
          label: 'Перенести й видалити', variant: 'danger',
          onClick: async () => {
            moveBtn.disabled = true;
            const to = CRM.store.get('categories', target.value);
            await CRM.store.saveMany('transactions', txs.map((t) => Object.assign({}, t, { categoryId: to.id, subcategoryId: null })));
            await CRM.store.softDelete('categories', id);
            dlg.close('force');
            ui.toast(`Категорію видалено, ${fmt.count(txs.length, ['операцію', 'операції', 'операцій'])} перенесено в «${to.name}»`, { type: 'success' });
          }
        }))
      ]
    });
  }

  CRM.budget.registerTab('categories', { render });
  CRM.budget.openCategoryForm = openCategoryForm;
})(window.CRM);
