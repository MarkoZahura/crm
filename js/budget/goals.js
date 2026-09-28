/* ==========================================================================
   goals.js — вкладка «Фінансові цілі».
   Три вкладки: Поточні, Досягнуті, Відкладені. Прогрес цілі — окреме число
   (не змінює баланси рахунків і капітал). Коли накопичене досягає цільової
   суми — ціль автоматично переходить у «Досягнуті» зі сповіщенням.
   ========================================================================== */
window.CRM = window.CRM || {};

(function (CRM) {
  'use strict';

  const { h, ui } = { h: CRM.ui.h, ui: CRM.ui };
  const D = CRM.date;
  const fmt = CRM.fmt;

  let tab = 'active';
  let filterCat = '';
  let sort = 'deadline';

  const SORTS = [['deadline', 'За строком'], ['progress', 'За прогресом'], ['target', 'За сумою'], ['name', 'За назвою']];

  function goals(status) { return CRM.store.list('goals').filter((g) => (g.status || 'active') === status); }
  function pct(g) { return g.target > 0 ? Math.min(100, (Number(g.saved) || 0) / g.target * 100) : 0; }

  /** Скільки відкладати щомісяця, щоб встигнути. */
  function planText(g) {
    const remaining = Math.max(0, CRM.utils.round2((Number(g.target) || 0) - (Number(g.saved) || 0)));
    if (g.status === 'achieved') return g.achievedAt ? `Досягнуто ${fmt.date(D.toKyivDate(g.achievedAt))}` : 'Досягнуто';
    if (!g.deadline) return remaining ? `Залишилось ${fmt.money(remaining, g.currency)} · без строку` : 'Без строку';
    const days = D.diffDays(D.today(), g.deadline);
    if (days < 0) return `Строк минув ${fmt.date(g.deadline)} · залишилось ${fmt.money(remaining, g.currency)}`;
    if (days <= 31) return `До ${fmt.date(g.deadline)} (${fmt.count(days, ['день', 'дні', 'днів'])}) треба ще ${fmt.money(remaining, g.currency)}`;
    const months = Math.max(1, Math.ceil(days / 30.44));
    return `≈ ${fmt.money(remaining / months, g.currency)} на місяць, щоб встигнути до ${fmt.date(g.deadline)}`;
  }

  function sorted(list) {
    return list.slice().sort((a, b) => {
      if (sort === 'progress') return pct(b) - pct(a);
      if (sort === 'target') return (CRM.rates.toUAH(b.target, b.currency) || 0) - (CRM.rates.toUAH(a.target, a.currency) || 0);
      if (sort === 'name') return a.name.localeCompare(b.name, 'uk');
      if (!a.deadline && !b.deadline) return a.name.localeCompare(b.name, 'uk');
      if (!a.deadline) return 1;
      if (!b.deadline) return -1;
      return a.deadline.localeCompare(b.deadline);
    });
  }

  // ---------- Дії ----------
  async function achieve(g) {
    await CRM.store.patch('goals', g.id, { status: 'achieved', achievedAt: new Date().toISOString() });
    await CRM.notify.push({ key: `goal:achieved:${g.id}`, kind: 'goal', title: 'Ціль досягнуто', text: g.name, target: { store: 'goals', id: g.id } });
    ui.toast(`Ціль «${g.name}» досягнуто!`, { type: 'success', action: { label: 'Показати', onClick: () => CRM.router.go('budget/goals', { tab: 'achieved' }) } });
  }

  async function setStatus(g, status) {
    await CRM.store.patch('goals', g.id, { status });
    ui.toast(status === 'paused' ? `«${g.name}» перенесено у Відкладені` : `«${g.name}» знову серед поточних`, {
      action: { label: 'Скасувати', onClick: () => CRM.store.patch('goals', g.id, { status: g.status }) }
    });
  }

  async function remove(g) {
    const ok = await ui.confirm({ title: 'Видалити ціль?', message: `«${g.name}» потрапить у Кошик. Відновити можна протягом 30 днів.`, confirmText: 'Видалити', danger: true });
    if (!ok) return;
    const batch = await CRM.store.softDelete('goals', g.id);
    ui.toast('Ціль перенесено в Кошик', { action: { label: 'Скасувати', onClick: () => CRM.store.restoreBatch(batch) } });
  }

  function openTopUp(g) {
    const remaining = Math.max(0, g.target - (g.saved || 0));
    const amountIn = h('input', { class: 'input amount-input', type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '0,00', 'aria-label': 'Сума поповнення' });
    const f = ui.field({ label: `Сума, ${g.currency}`, input: h('div', { class: 'amount-wrap' }, amountIn, h('span', { class: 'amount-cur' }, CRM.CURRENCIES[g.currency].symbol)), required: true, hint: `Накопичено ${fmt.money(g.saved || 0, g.currency)} з ${fmt.money(g.target, g.currency)} · залишилось ${fmt.money(remaining, g.currency)}. Баланси рахунків це не змінює.` });
    const quick = h('div', { class: 'chips' }, remaining > 0 ? h('button', { type: 'button', class: 'chip', onClick: () => { amountIn.value = String(CRM.utils.round2(remaining)).replace('.', ','); } }, `Уся решта: ${fmt.money(remaining, g.currency)}`) : null);
    async function submit(e) {
      if (e) e.preventDefault();
      const amount = CRM.utils.parseAmount(amountIn.value);
      if (isNaN(amount) || amount <= 0) { f.setError('Вкажи суму більшу за нуль'); return; }
      const cur = CRM.store.get('goals', g.id);
      const saved = CRM.utils.round2((Number(cur.saved) || 0) + amount);
      const history = (cur.history || []).concat([{ date: D.today(), amount: CRM.utils.round2(amount) }]);
      await CRM.store.patch('goals', g.id, { saved, history });
      dlg.close('force');
      if (saved >= cur.target && cur.status !== 'achieved') await achieve(Object.assign({}, cur, { saved }));
      else ui.toast(`Поповнено на ${fmt.money(amount, g.currency)}`, { type: 'success' });
    }
    const dlg = ui.modal({
      title: `Поповнити «${g.name}»`, size: 'sm',
      body: h('form', { class: 'form-stack', novalidate: true, onSubmit: submit }, f, quick, h('button', { type: 'submit', hidden: true, tabIndex: -1, 'aria-hidden': 'true' })),
      footer: [ui.button({ label: 'Скасувати', onClick: () => dlg.close('button') }), ui.button({ label: 'Поповнити', icon: 'plus', variant: 'primary', onClick: () => submit() })],
      initialFocus: amountIn
    });
  }

  // ---------- Форма цілі ----------
  function openForm(id) {
    const existing = id ? CRM.store.get('goals', id) : null;
    if (id && (!existing || existing.deletedAt)) { ui.toast('Ціль не знайдено', { type: 'error' }); return null; }
    const isNew = !existing;
    const st = existing ? CRM.utils.deepClone(existing) : { name: '', currency: 'UAH', target: null, saved: 0, deadline: null, category: '', status: 'active', history: [] };

    const nameIn = ui.input({ value: st.name, maxlength: 60, placeholder: 'Напр., Новий ноутбук' });
    const fName = ui.field({ label: 'Назва', input: nameIn, required: true });

    const curSeg = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Валюта' });
    const syms = [];
    function renderCur() {
      ui.mount(curSeg, CRM.dict.currencies.map((c) => h('button', {
        type: 'button', role: 'radio', class: st.currency === c ? 'active' : '', 'aria-checked': st.currency === c ? 'true' : 'false',
        onClick: () => { st.currency = c; renderCur(); }
      }, c)));
      syms.forEach((s) => { s.textContent = CRM.CURRENCIES[st.currency].symbol; });
    }
    const fCur = ui.field({ label: 'Валюта', input: curSeg });

    const moneyInput = (value, label) => {
      const inp = h('input', { class: 'input amount-input', type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '0,00', value: value != null && value !== '' ? String(value).replace('.', ',') : '', 'aria-label': label });
      const sym = h('span', { class: 'amount-cur' });
      syms.push(sym);
      return { inp, wrap: h('div', { class: 'amount-wrap' }, inp, sym) };
    };
    const target = moneyInput(st.target, 'Цільова сума');
    const saved = moneyInput(st.saved || '', 'Вже накопичено');
    const fTarget = ui.field({ label: 'Цільова сума', input: target.wrap, required: true });
    const fSaved = ui.field({ label: 'Прогрес (вже накопичено)', input: saved.wrap });
    renderCur();

    const dateIn = ui.dateInput({ value: st.deadline, placeholder: 'Без строку', ariaLabel: 'Строк досягнення' });
    const fDate = ui.field({ label: 'Строк досягнення', input: dateIn, hint: 'Необовʼязково' });

    const catSel = ui.select([{ value: '', label: 'Без категорії' }].concat(CRM.dict.goalCategories.map((c) => ({ value: c, label: c }))), { value: st.category || '', 'aria-label': 'Категорія' });
    const fCat = ui.field({ label: 'Категорія', input: catSel, hint: 'Необовʼязково — для фільтра й сортування' });

    async function submit(e) {
      if (e) e.preventDefault();
      let ok = true;
      const name = nameIn.value.trim();
      if (!name) { fName.setError('Вкажи назву цілі'); ok = false; }
      const t = CRM.utils.parseAmount(target.inp.value);
      if (isNaN(t) || t <= 0) { fTarget.setError('Вкажи суму більшу за нуль'); ok = false; }
      const sv = saved.inp.value.trim() ? CRM.utils.parseAmount(saved.inp.value) : 0;
      if (isNaN(sv) || sv < 0) { fSaved.setError('Вкажи число від нуля'); ok = false; }
      if (!ok) return;
      const rec = Object.assign(existing ? CRM.utils.deepClone(existing) : { status: 'active', history: [], achievedAt: null }, {
        name, currency: st.currency, target: CRM.utils.round2(t), saved: CRM.utils.round2(sv), deadline: dateIn.dateValue || null, category: catSel.value || null
      });
      const reached = rec.saved >= rec.target;
      if (!reached && rec.status === 'achieved') { rec.status = 'active'; rec.achievedAt = null; }
      const savedRec = await CRM.store.save('goals', rec);
      dlg.close('force');
      if (reached && savedRec.status !== 'achieved') await achieve(savedRec);
      else ui.toast(isNew ? `Ціль «${name}» поставлено` : 'Зміни збережено', { type: 'success' });
    }

    const dlg = ui.modal({
      title: isNew ? 'Нова фінансова ціль' : 'Редагувати ціль', size: 'md',
      body: h('form', { class: 'form-stack', novalidate: true, onSubmit: submit },
        fName, fCur, h('div', { class: 'form-grid' }, fTarget, fSaved), h('div', { class: 'form-grid' }, fDate, fCat),
        h('button', { type: 'submit', hidden: true, tabIndex: -1, 'aria-hidden': 'true' })),
      footer: h('div', { class: 'drawer-footer-inner' },
        existing ? ui.button({ label: 'Видалити', icon: 'trash', variant: 'danger-ghost', onClick: () => { dlg.close('force'); remove(existing); } }) : null,
        h('span', { class: 'grow' }),
        ui.button({ label: 'Скасувати', onClick: () => dlg.close('button') }),
        ui.button({ label: isNew ? 'Поставити ціль' : 'Зберегти', icon: isNew ? 'target' : 'check', variant: 'primary', onClick: () => submit() })),
      initialFocus: isNew ? nameIn : 'container'
    });
    return dlg;
  }

  // ---------- Картка ----------
  function card(g) {
    const p = pct(g);
    const status = g.status || 'active';
    const actions = [];
    if (status === 'active') {
      actions.push(ui.button({ label: 'Поповнити', icon: 'plus', size: 'sm', variant: 'primary', onClick: () => openTopUp(g) }));
      actions.push(ui.button({ label: 'Призупинити', size: 'sm', onClick: () => setStatus(g, 'paused') }));
    } else if (status === 'paused') {
      actions.push(ui.button({ label: 'Відновити', icon: 'restore', size: 'sm', onClick: () => setStatus(g, 'active') }));
    }
    actions.push(h('span', { class: 'grow' }));
    actions.push(ui.button({ icon: 'pencil', iconOnly: true, size: 'sm', variant: 'ghost', title: 'Редагувати ціль', onClick: () => openForm(g.id) }));
    actions.push(ui.button({ icon: 'trash', iconOnly: true, size: 'sm', variant: 'danger-ghost', title: 'Видалити ціль', onClick: () => remove(g) }));

    const uah = g.currency !== 'UAH' ? CRM.rates.toUAH(g.target, g.currency) : null;
    const overdue = status === 'active' && g.deadline && g.deadline < D.today();
    return h('article', { class: 'card goal-card st-' + status, dataset: { id: g.id } },
      h('div', { class: 'goal-head' },
        h('div', { class: 'goal-title' },
          h('h3', null, g.name),
          g.category ? h('span', { class: 'badge' }, g.category) : null),
        h('span', { class: 'goal-pct num' }, fmt.percent(p, p >= 10 || p === 0 ? 0 : 1))),
      h('div', { class: 'goal-amounts num' },
        h('strong', null, fmt.money(g.saved || 0, g.currency)), h('span', { class: 'subtle' }, ' з '), fmt.money(g.target, g.currency),
        uah != null ? h('span', { class: 'subtle' }, ` · ≈ ${fmt.money(uah, 'UAH')}`) : null),
      h('div', { class: 'progress goal-progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(p)), 'aria-label': 'Прогрес цілі' },
        h('div', { class: 'progress-bar', style: { width: p + '%' } })),
      h('div', { class: 'goal-plan' + (overdue ? ' overdue' : '') }, CRM.icon(status === 'achieved' ? 'checkCircle' : 'calendar', { size: 'sm' }), planText(g)),
      h('div', { class: 'goal-actions' }, actions));
  }

  // ---------- Вкладка ----------
  function render(container, route) {
    if (route.params.tab && ['active', 'achieved', 'paused'].includes(route.params.tab)) { tab = route.params.tab; CRM.router.consumeParam('tab'); }
    if (route.params.open) {
      const id = route.params.open;
      CRM.router.consumeParam('open');
      const g = CRM.store.get('goals', id);
      if (g && !g.deletedAt) tab = g.status || 'active';
      setTimeout(() => openForm(id), 0);
    }

    const counts = { active: goals('active').length, achieved: goals('achieved').length, paused: goals('paused').length };
    const sub = h('div', { class: 'chips', role: 'tablist', 'aria-label': 'Стан цілей' },
      CRM.dict.goalStatuses.map((s) => h('button', {
        type: 'button', role: 'tab', class: 'chip' + (tab === s.id ? ' active' : ''), 'aria-selected': tab === s.id ? 'true' : 'false',
        onClick: () => { tab = s.id; CRM.router.rerender(); }
      }, `${s.label} · ${counts[s.id]}`)));

    let list = goals(tab);
    const cats = Array.from(new Set(list.map((g) => g.category).filter(Boolean))).sort((a, b) => a.localeCompare(b, 'uk'));
    let controls = null;
    if (tab === 'active' && list.length) {
      const catSel = ui.select([{ value: '', label: 'Усі категорії' }].concat(cats.map((c) => ({ value: c, label: c }))), { value: cats.includes(filterCat) ? filterCat : '', 'aria-label': 'Категорія', class: 'select select-sm' });
      catSel.addEventListener('change', () => { filterCat = catSel.value; CRM.router.rerender(); });
      const sortSel = ui.select(SORTS.map(([v, l]) => ({ value: v, label: l })), { value: sort, 'aria-label': 'Сортування', class: 'select select-sm' });
      sortSel.addEventListener('change', () => { sort = sortSel.value; CRM.router.rerender(); });
      controls = h('div', { class: 'btn-row' }, catSel, sortSel);
      if (filterCat && cats.includes(filterCat)) list = list.filter((g) => g.category === filterCat);
    }
    list = tab === 'achieved' ? list.sort((a, b) => (b.achievedAt || '').localeCompare(a.achievedAt || '')) : sorted(list);

    const empty = {
      active: ['Ще немає поточних цілей', 'Постав ціль — ноутбук, подорож, подушка безпеки — і відстежуй, скільки відкладати щомісяця.'],
      achieved: ['Досягнутих цілей поки немає', 'Коли накопичене дорівнюватиме цільовій сумі, ціль зʼявиться тут.'],
      paused: ['Відкладених цілей немає', 'Призупинені цілі чекатимуть тут, доки ти їх не відновиш.']
    }[tab];

    ui.mount(container,
      h('div', { class: 'toolbar' }, sub, h('div', { class: 'btn-row' }, controls, ui.button({ label: 'Поставити ціль', icon: 'target', onClick: () => openForm() }))),
      list.length
        ? h('div', { class: 'goal-grid' }, list.map(card))
        : h('div', { class: 'card' }, ui.empty({ icon: 'target', title: empty[0], text: empty[1], action: tab === 'active' ? { label: 'Поставити ціль', icon: 'target', onClick: () => openForm() } : null })),
      h('p', { class: 'toolbar-note', style: { marginTop: '14px' } }, 'Прогрес цілей — окремий лічильник: поповнення не змінює баланси рахунків і капітал.'));
  }

  CRM.budget.registerTab('goals', { render });
  Object.assign(CRM.budget, { openGoalForm: openForm, openGoalTopUp: openTopUp });
})(window.CRM);
