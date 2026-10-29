/* ==========================================================================
   limits.js — ліміти витрат на місяць (вкладка «Ліміти» в Бюджеті).
   • Ліміт на категорію витрат (субкатегорії рахуються в свою категорію)
     і загальний ліміт на всі витрати місяця. Щомісяця рахується заново.
   • Один ліміт діє на всі місяці; для вибраного місяця його можна змінити.
     Зміна «з цього місяця й далі» не переписує минулі місяці: старі значення
     для них запамʼятовуються, тож «вклався / перевищено» в історії не змінюється.
   • Ліміти — у гривнях; витрати в інших валютах — за курсом НБУ на день витрати;
     розділена витрата рахується частинами; перекази й доходи — ні.
   • Показ: вкладка «Ліміти», картка на Дашборді, блок «Ліміти» на Головній,
     підказка у формі транзакції, тост після витрати (форма, «Повторити», ⚡),
     дзвіночок на 80 % і 100 % (раз на місяць для кожного рівня).
   Налаштування budgetLimits (синхронізується):
     { total: число | null, cats: { id категорії: число },
       months: { 'РРРР-ММ': { total?: число | null, cats?: { id: число | null } } } }
     У months — лише те, що для місяця інакше; null — «цього місяця без ліміту».
   Ключі сповіщень: limit:<id категорії | total>:<РРРР-ММ>:80 | 100
   ========================================================================== */
window.CRM = window.CRM || {};

(function (CRM) {
  'use strict';

  const { h, ui } = { h: CRM.ui.h, ui: CRM.ui };
  const D = CRM.date;
  const fmt = CRM.fmt;
  const U = CRM.utils;
  const F = () => CRM.finance;
  const S = () => CRM.store;

  const KEY = 'budgetLimits';
  const WARN = 0.8;          // з 80 % — бурштиновий і перше попередження
  const MAX_LIMIT = 1e9;
  const AVG_MONTHS = 3;      // середнє для підказок — за 3 попередні місяці
  const MONTHS_IN = ['січні', 'лютому', 'березні', 'квітні', 'травні', 'червні', 'липні', 'серпні', 'вересні', 'жовтні', 'листопаді', 'грудні'];

  const mk = (date) => date.slice(0, 7);
  const monthStart = (date) => D.startOfMonth(date);
  const monthLower = (date) => CRM.MONTHS_NOM[D.parse(monthStart(date)).m - 1].toLowerCase();
  const monthIn = (date) => MONTHS_IN[D.parse(monthStart(date)).m - 1];
  /** Сума без копійок: «1 350 ₴». */
  const m0 = (v) => fmt.money(Math.round(Number(v) || 0), 'UAH', { decimals: 0 });
  const num0 = (v) => fmt.number(Math.round(Number(v) || 0), 0);
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  // ---------- Налаштування ----------
  function raw() {
    const v = S().getSetting(KEY, null);
    return v && typeof v === 'object' ? v : {};
  }
  function norm(v) {
    const n = Number(v);
    return v != null && v !== '' && isFinite(n) && n > 0 ? U.round2(Math.min(n, MAX_LIMIT)) : null;
  }
  /** Ліміт «для всіх місяців»: 'total' або id категорії → число | null. */
  function baseOf(id) {
    const r = raw();
    return id === 'total' ? norm(r.total) : norm(r.cats && r.cats[id]);
  }
  function monthOver(month) {
    const r = raw();
    return (r.months && r.months[mk(month)]) || null;
  }
  /** Чи змінено ліміт саме для цього місяця. */
  function isOverridden(id, month) {
    const m = monthOver(month);
    if (!m) return false;
    return id === 'total' ? Object.prototype.hasOwnProperty.call(m, 'total') : !!(m.cats && Object.prototype.hasOwnProperty.call(m.cats, id));
  }
  /** Ліміт, що діє в місяці (дата будь-якого дня місяця): число | null. */
  function limitOf(id, month) {
    if (isOverridden(id, month)) {
      const m = monthOver(month);
      return norm(id === 'total' ? m.total : m.cats[id]);
    }
    return baseOf(id);
  }
  /** Чи задано хоч якийсь ліміт (будь-коли). */
  function hasAny() {
    const r = raw();
    if (norm(r.total) || Object.keys(r.cats || {}).some((id) => norm(r.cats[id]))) return true;
    return Object.values(r.months || {}).some((m) => norm(m.total) || Object.keys(m.cats || {}).some((id) => norm(m.cats[id])));
  }
  const expenseCats = () => F().categories('expense');
  function catName(id) { const c = S().get('categories', id); return c ? c.name : 'Без категорії'; }

  // ---------- Витрати за місяць ----------
  /**
   * Витрати місяця в гривнях: { total, cats: Map(id → сума), missing, list }.
   * opts.exclude — id операції, яку не рахувати (форма зміни операції).
   */
  function spentIn(month, opts) {
    const o = opts || {};
    const list = F().txInRange(monthStart(month), D.endOfMonth(month)).filter((t) => t.type === 'expense' && t.id !== o.exclude);
    const cats = new Map();
    let total = 0;
    let missing = 0;
    list.forEach((t) => {
      const uah = F().txUAH(t);
      if (uah == null) { missing++; return; }
      total += uah;
      const amt = Number(t.amount) || 0;
      F().txParts(t).forEach((p) => {
        if (!p.categoryId) return;
        const share = amt ? p.amount / amt : 1;
        cats.set(p.categoryId, (cats.get(p.categoryId) || 0) + uah * share);
      });
    });
    cats.forEach((v, k) => cats.set(k, U.round2(v)));
    return { total: U.round2(total), cats, missing, list };
  }

  /** Стан ліміту: { pct, left, over, level: ok | warn | over }. */
  function status(spent, limit) {
    const pct = limit ? spent / limit : 0;
    const over = U.round2(spent - limit);
    const level = over > 0.004 ? 'over' : pct >= WARN ? 'warn' : 'ok';
    return { pct, left: Math.max(0, U.round2(limit - spent)), over: over > 0.004 ? over : 0, level };
  }

  /**
   * Ліміти місяця зі станом: [{ id: 'total' | id категорії, name, color, limit, spent, pct, left, over, level, overridden }].
   * Загальний — першим; категорії — від найближчих до ліміту.
   */
  function items(month, spent) {
    const sp = spent || spentIn(month);
    const out = [];
    const lt = limitOf('total', month);
    if (lt) out.push(Object.assign({ id: 'total', name: 'Усі витрати', color: null, limit: lt, spent: sp.total, overridden: isOverridden('total', month) }, status(sp.total, lt)));
    const cats = [];
    expenseCats().forEach((c, i) => {
      const lim = limitOf(c.id, month);
      if (!lim) return;
      const s = sp.cats.get(c.id) || 0;
      cats.push(Object.assign({ id: c.id, name: c.name, color: CRM.dict.categoryColor(c.color), limit: lim, spent: s, overridden: isOverridden(c.id, month), order: i }, status(s, lim)));
    });
    cats.sort((a, b) => b.pct - a.pct || a.order - b.order);
    return out.concat(cats);
  }

  /** Середні витрати за AVG_MONTHS місяців перед month (лише місяці з історією): { total, cats: Map } | null. */
  function averages(month) {
    const start = F().historyStart();
    if (!start) return null;
    const first = monthStart(start);
    const months = [];
    for (let i = 1; i <= AVG_MONTHS; i++) {
      const m = D.addMonths(monthStart(month), -i);
      if (m >= first && m < monthStart(D.today())) months.push(m);
    }
    if (!months.length) return null;
    const cats = new Map();
    let total = 0;
    months.forEach((m) => {
      const sp = spentIn(m);
      total += sp.total;
      sp.cats.forEach((v, k) => cats.set(k, (cats.get(k) || 0) + v));
    });
    cats.forEach((v, k) => cats.set(k, v / months.length));
    return { total: total / months.length, cats, months: months.length };
  }
  /** Округлити вгору «по-людськи»: до 50 ₴ (до 1 000) або до 100 ₴. */
  function roundUp(v) {
    const step = v < 1000 ? 50 : 100;
    return Math.max(step, Math.ceil(v / step) * step);
  }

  // ---------- Збереження ----------
  function cleanSetting(r) {
    const out = { total: norm(r.total), cats: {}, months: {} };
    Object.keys(r.cats || {}).forEach((id) => { const v = norm(r.cats[id]); if (v) out.cats[id] = v; });
    Object.keys(r.months || {}).forEach((key) => {
      const m = r.months[key] || {};
      const mo = {};
      if (Object.prototype.hasOwnProperty.call(m, 'total')) mo.total = norm(m.total);
      const mc = {};
      Object.keys(m.cats || {}).forEach((id) => { mc[id] = norm(m.cats[id]); });
      if (Object.keys(mc).length) mo.cats = mc;
      if (Object.keys(mo).length) out.months[key] = mo;
    });
    return out;
  }
  async function saveSetting(next) {
    await S().setSetting(KEY, cleanSetting(next));
  }

  /**
   * Нові ліміти з місяця month і далі (vals: { total, cats: { id: число | null } } — лише змінені).
   * Минулі місяці з витратами, де діяв старий ліміт, отримують його як свій — історія не змінюється.
   */
  function applyFrom(month, vals) {
    const r = U.deepClone(raw());
    r.cats = r.cats || {};
    r.months = r.months || {};
    const keys = Object.keys(vals.cats || {}).map((id) => ({ id, v: vals.cats[id] }));
    if (Object.prototype.hasOwnProperty.call(vals, 'total')) keys.push({ id: 'total', v: vals.total });
    const start = F().historyStart();
    const firstMonth = start ? monthStart(start) : monthStart(month);
    const from = monthStart(month);
    // Минулі місяці з витратами — запамʼятати старе значення
    const past = [];
    for (let m = D.addMonths(from, -1), n = 0; m >= firstMonth && n < 120; m = D.addMonths(m, -1), n++) {
      if (F().txInRange(m, D.endOfMonth(m)).some((t) => t.type === 'expense')) past.push(m);
    }
    keys.forEach(({ id, v }) => {
      const old = baseOf(id);
      const nv = norm(v);
      if (old === nv) return;
      if (old) {
        past.forEach((m) => {
          const key = mk(m);
          const mo = r.months[key] = r.months[key] || {};
          if (id === 'total') { if (!Object.prototype.hasOwnProperty.call(mo, 'total')) mo.total = old; }
          else { mo.cats = mo.cats || {}; if (!Object.prototype.hasOwnProperty.call(mo.cats, id)) mo.cats[id] = old; }
        });
      }
      if (id === 'total') r.total = nv; else if (nv) r.cats[id] = nv; else delete r.cats[id];
    });
    return r;
  }
  /** Ліміти лише для одного місяця (vals — усі значення, що мають діяти в цьому місяці). */
  function applyMonth(month, vals) {
    const r = U.deepClone(raw());
    r.months = r.months || {};
    const key = mk(month);
    const mo = Object.assign({}, r.months[key] || {});
    mo.cats = Object.assign({}, mo.cats || {});
    const setOne = (id, v) => {
      const nv = norm(v);
      const base = baseOf(id);
      if (id === 'total') { if (nv === base) delete mo.total; else mo.total = nv; return; }
      if (nv === base) delete mo.cats[id]; else mo.cats[id] = nv;
    };
    if (Object.prototype.hasOwnProperty.call(vals, 'total')) setOne('total', vals.total);
    Object.keys(vals.cats || {}).forEach((id) => setOne(id, vals.cats[id]));
    if (!Object.keys(mo.cats).length) delete mo.cats;
    if (Object.keys(mo).length) r.months[key] = mo; else delete r.months[key];
    return r;
  }

  // ---------- Вікно «Ліміти на місяць» ----------
  /**
   * opts: { month (дата), focus: 'total' | id категорії, scope: 'all' | 'month' }
   */
  function openEditor(opts) {
    const o = opts || {};
    const month = monthStart(o.month || D.today());
    const cats = expenseCats();
    if (!cats.length) {
      ui.toast('Спершу додай категорії витрат на вкладці «Категорії»', { type: 'error' });
      return null;
    }
    let scope = o.scope || 'all';
    const avg = averages(month);
    const inputs = new Map();
    const fields = new Map();

    const valueFor = (id) => (scope === 'month' ? limitOf(id, month) : baseOf(id));
    // «36 892» — з пробілами між тисячами (parseAmount їх прибирає)
    const fmtIn = (v) => (v ? fmt.number(v, Number.isInteger(v) ? 0 : 2).replace(/\u00a0/g, ' ') : '');

    function limitInput(id, label) {
      const inp = h('input', {
        class: 'input input-sm amount-input lim-in', type: 'text', inputmode: 'decimal', autocomplete: 'off',
        placeholder: 'без ліміту', 'aria-label': `Ліміт: ${label}`, dataset: { id }
      });
      inp.addEventListener('input', () => { const f = fields.get(id); if (f) f.classList.remove('has-error'); });
      inputs.set(id, inp);
      return inp;
    }
    function avgHint(id) {
      if (!avg) return null;
      const v = id === 'total' ? avg.total : avg.cats.get(id) || 0;
      if (!v) return h('span', { class: 'lim-avg subtle' }, 'витрат не було');
      return h('span', { class: 'lim-avg subtle', title: `Середні витрати за ${fmt.count(avg.months, ['місяць', 'місяці', 'місяців'])}` }, `у середньому ${m0(v)}`);
    }
    function row(id, label, color) {
      const err = h('div', { class: 'lim-err' });
      const r = h('div', { class: 'lim-ed-row', dataset: { id } },
        h('span', { class: 'lim-ed-name' },
          color ? h('span', { class: 'cat-dot', style: { background: color } }) : CRM.icon('wallet', { size: 'sm' }),
          h('span', null, label)),
        avgHint(id),
        h('span', { class: 'amount-wrap lim-ed-amt' }, limitInput(id, label), h('span', { class: 'amount-cur' }, '₴')),
        err);
      r.setError = (msg) => { r.classList.toggle('has-error', !!msg); err.textContent = msg || ''; };
      fields.set(id, r);
      return r;
    }

    const scopeSeg = h('div', { class: 'segmented lim-scope', role: 'radiogroup', 'aria-label': 'Для яких місяців' });
    const scopeNote = h('div', { class: 'lim-scope-note subtle' });
    const resetBtn = h('button', {
      type: 'button', class: 'link-like lim-reset-month',
      onClick: () => {
        // Прибрати зміни місяця: у полях — ліміти «для всіх місяців»
        inputs.forEach((inp, id) => { inp.value = fmtIn(baseOf(id)); });
        resetBtn.hidden = true;
        resetBtn.dataset.done = '1';
      }
    }, `Як для всіх місяців`);
    function renderScope() {
      ui.mount(scopeSeg, [['all', `З ${monthGen(month)} і далі`], ['month', `Лише на ${monthLower(month)} ${D.parse(month).y}`]].map(([id, label]) => h('button', {
        type: 'button', role: 'radio', class: scope === id ? 'active' : '', 'aria-checked': scope === id ? 'true' : 'false', dataset: { scope: id },
        onClick: () => { if (scope === id) return; scope = id; fill(); renderScope(); }
      }, label)));
      scopeNote.textContent = scope === 'all'
        ? 'Ліміти діятимуть щомісяця, поки їх не зміниш. Минулі місяці лишаються з тими лімітами, що були.'
        : `Лише для ${monthGen(month)} ${D.parse(month).y}; інші місяці — без змін. Порожнє поле — цього місяця без ліміту.`;
      resetBtn.hidden = scope !== 'month' || !monthOver(month) || resetBtn.dataset.done === '1';
    }
    function fill() {
      inputs.forEach((inp, id) => { inp.value = fmtIn(valueFor(id)); });
      fields.forEach((f) => f.setError(null));
    }

    const fillAvg = avg ? h('button', {
      type: 'button', class: 'btn btn-sm lim-fill-avg', title: 'Заповнити порожні поля середніми витратами (з округленням угору)',
      onClick: () => {
        let n = 0;
        inputs.forEach((inp, id) => {
          if (inp.value.trim()) return;
          const v = id === 'total' ? avg.total : avg.cats.get(id) || 0;
          if (v > 0) { inp.value = String(roundUp(v)); n++; }
        });
        ui.toast(n ? `Заповнено ${fmt.count(n, ['поле', 'поля', 'полів'])} середніми витратами` : 'Порожніх полів із витратами в минулих місяцях немає');
      }
    }, CRM.icon('sparkles', { size: 'sm' }), 'Заповнити середніми') : null;

    const body = h('div', { class: 'lim-editor' },
      scopeSeg, scopeNote, resetBtn,
      h('div', { class: 'lim-ed-group' },
        h('div', { class: 'lim-ed-title' }, 'На всі витрати місяця'),
        row('total', 'Усі витрати', null)),
      h('div', { class: 'lim-ed-group' },
        h('div', { class: 'lim-ed-title' }, 'На категорії', h('span', { class: 'grow' }), fillAvg),
        h('div', { class: 'lim-ed-list' }, cats.map((c) => row(c.id, c.name, CRM.dict.categoryColor(c.color))))),
      h('div', { class: 'card-note' }, CRM.icon('info', { size: 'sm' }),
        'Ліміти — у гривнях; витрати в доларах і євро рахуються за курсом НБУ на день витрати, субкатегорії — у свою категорію. Порожнє поле — без ліміту.'));

    renderScope();
    fill();

    async function save() {
      const vals = { cats: {} };
      let ok = true;
      inputs.forEach((inp, id) => {
        const s = inp.value.trim();
        let v = null;
        if (s) {
          v = U.parseAmount(s);
          if (isNaN(v) || v <= 0) { fields.get(id).setError('Сума більша за 0, напр., 2 000 (порожньо — без ліміту)'); ok = false; return; }
          if (v > MAX_LIMIT) { fields.get(id).setError('Занадто велика сума'); ok = false; return; }
          v = U.round2(v);
        }
        if (id === 'total') vals.total = v; else vals.cats[id] = v;
      });
      if (!ok) { const bad = body.querySelector('.has-error input'); if (bad) bad.focus(); return; }
      const before = S().getSetting(KEY, null);
      let next;
      if (scope === 'month') {
        // Значення, що збігаються з лімітами «для всіх місяців», зміною місяця не вважаються
        next = applyMonth(month, vals);
      } else {
        // Лише змінене — щоб не «заморожувати» минуле без потреби
        const changed = { cats: {} };
        if (norm(vals.total) !== baseOf('total')) changed.total = vals.total;
        Object.keys(vals.cats).forEach((id) => { if (norm(vals.cats[id]) !== baseOf(id)) changed.cats[id] = vals.cats[id]; });
        next = applyFrom(month, changed);
        // Зміни цього місяця, що збігаються з новими лімітами, більше не потрібні
        const mo = next.months && next.months[mk(month)];
        if (mo) {
          if (Object.prototype.hasOwnProperty.call(mo, 'total') && norm(mo.total) === norm(next.total)) delete mo.total;
          Object.keys(mo.cats || {}).forEach((id) => { if (norm(mo.cats[id]) === norm((next.cats || {})[id])) delete mo.cats[id]; });
          if (mo.cats && !Object.keys(mo.cats).length) delete mo.cats;
          if (!Object.keys(mo).length) delete next.months[mk(month)];
        }
      }
      await saveSetting(next);
      dlg.close('force');
      ui.toast(scope === 'month' ? `Ліміти на ${monthLower(month)} збережено` : 'Ліміти збережено', {
        type: 'success',
        action: { label: 'Скасувати', onClick: () => S().setSetting(KEY, before) }
      });
      if (o.onSaved) o.onSaved();
    }

    const dlg = ui.modal({
      title: 'Ліміти на місяць', size: 'md', className: 'lim-modal',
      body,
      footer: h('div', { class: 'drawer-footer-inner' },
        h('span', { class: 'grow' }),
        ui.button({ label: 'Скасувати', onClick: () => dlg.close('button') }),
        ui.button({ label: 'Зберегти', variant: 'primary', icon: 'check', className: 'lim-save', onClick: () => save() })),
      initialFocus: inputs.get(o.focus) || inputs.get('total')
    });
    body.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.classList && e.target.classList.contains('lim-in')) { e.preventDefault(); save(); }
    });
    const focusEl = inputs.get(o.focus);
    if (focusEl) setTimeout(() => { focusEl.scrollIntoView({ block: 'center' }); focusEl.select(); }, 0);
    return dlg;
  }
  function monthGen(date) { return CRM.MONTHS_GEN[D.parse(monthStart(date)).m - 1]; }

  // ---------- Рядок ліміту ----------
  function bar(it) {
    const w = Math.min(100, it.pct * 100);
    return h('div', { class: 'lim-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(it.pct * 100)), 'aria-label': `${it.name}: ${fmt.percent(it.pct * 100, 0)}` },
      h('div', { class: 'lim-fill', style: { width: w + '%', background: it.level === 'ok' && it.color ? it.color : null } }));
  }
  const leftText = (it) => (it.over ? `перевищено на ${m0(it.over)}` : `лишилось ${m0(it.left)}`);
  function openTx(id, month) {
    const params = { month: monthStart(month) };
    if (id !== 'total') params.category = id;
    CRM.router.go('budget/transactions', params);
  }

  function limitRow(it, month, opts) {
    const o = opts || {};
    const past = mk(month) < mk(D.today());
    const row = h('div', {
      class: `lim-row lv-${it.level}` + (it.id === 'total' ? ' lim-row-total' : ''), dataset: { id: it.id },
      role: 'button', tabIndex: 0, title: 'Показати витрати за місяць'
    },
    h('div', { class: 'lim-top' },
      h('span', { class: 'lim-name' },
        it.id === 'total' ? h('span', { class: 'lim-ico' }, CRM.icon('wallet', { size: 'sm' })) : h('span', { class: 'cat-dot', style: { background: it.color } }),
        h('span', { class: 'lim-name-text' }, it.name),
        it.overridden ? h('span', { class: 'lim-badge', title: 'Ліміт змінено лише для цього місяця' }, `лише ${monthLower(month)}`) : null),
      h('span', { class: 'lim-nums num' }, h('strong', null, num0(it.spent)), ` з ${m0(it.limit)}`)),
    bar(it),
    h('div', { class: 'lim-bottom' },
      h('span', { class: 'lim-left' }, past ? h('span', { class: 'lim-state ' + (it.over ? 'bad' : 'good') }, it.over ? 'перевищено' : 'вклався') : null,
        past ? (it.over ? `на ${m0(it.over)}` : `лишилось ${m0(it.left)}`) : leftText(it)),
      h('span', { class: 'lim-pct num' }, fmt.percent(it.pct * 100, 0)),
      o.edit ? h('button', {
        type: 'button', class: 'btn btn-ghost btn-icon btn-sm lim-row-edit', title: 'Змінити ліміт', 'aria-label': `Змінити ліміт: ${it.name}`,
        onClick: (e) => { e.stopPropagation(); openEditor({ month, focus: it.id }); }
      }, CRM.icon('pencil', { size: 'sm' })) : null));
    const go = () => openTx(it.id, month);
    row.addEventListener('click', go);
    row.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === row) { e.preventDefault(); go(); } });
    return row;
  }

  // ---------- Вкладка «Ліміти» ----------
  let viewMonth = null;

  function render(container) {
    const T = D.today();
    const thisMonth = monthStart(T);
    const start = F().historyStart();
    const firstMonth = start && monthStart(start) < thisMonth ? monthStart(start) : thisMonth;
    const lastMonth = D.addMonths(thisMonth, 1);
    if (!viewMonth || viewMonth > lastMonth) viewMonth = thisMonth;
    if (viewMonth < firstMonth) viewMonth = firstMonth;
    const month = viewMonth;
    const isPast = month < thisMonth;
    const isFuture = month > thisMonth;
    const any = hasAny();

    const sp = spentIn(month);
    F().ensureRatesFor(sp.list);
    const list = items(month, sp);
    const total = list.find((x) => x.id === 'total') || null;
    const cats = list.filter((x) => x.id !== 'total');

    const nav = h('div', { class: 'month-nav' },
      h('button', { type: 'button', class: 'btn btn-icon btn-sm', 'aria-label': 'Попередній місяць', disabled: month <= firstMonth, onClick: () => { viewMonth = D.addMonths(month, -1); CRM.router.rerender(); } }, CRM.icon('chevronLeft', { size: 'sm' })),
      h('span', { class: 'month-title' }, fmt.month(month)),
      h('button', { type: 'button', class: 'btn btn-icon btn-sm', 'aria-label': 'Наступний місяць', disabled: month >= lastMonth, onClick: () => { viewMonth = D.addMonths(month, 1); CRM.router.rerender(); } }, CRM.icon('chevronRight', { size: 'sm' })));
    const editBtn = ui.button({
      label: any ? 'Змінити ліміти' : 'Задати ліміти', icon: any ? 'pencil' : 'plus', variant: 'primary', size: 'sm',
      className: 'lim-edit', dataset: { hk: 'add' },
      onClick: () => openEditor({ month })
    });
    const toolbar = h('div', { class: 'toolbar lim-toolbar' }, nav,
      month !== thisMonth ? h('button', { type: 'button', class: 'btn btn-ghost btn-sm lim-today', onClick: () => { viewMonth = thisMonth; CRM.router.rerender(); } }, 'Цей місяць') : null,
      h('span', { class: 'grow' }), editBtn);

    if (!expenseCats().length) {
      ui.mount(container, toolbar, h('div', { class: 'card' }, ui.empty({
        icon: 'tag', title: 'Спершу додай категорії витрат',
        text: 'Ліміти задаються на категорії витрат (кафе, таксі, продукти…) і на всі витрати місяця.',
        action: { label: 'До категорій', onClick: () => CRM.router.go('budget/categories') }
      })));
      return;
    }
    if (!any) {
      ui.mount(container, toolbar, h('div', { class: 'card lim-empty' }, ui.empty({
        icon: 'gauge', title: 'Ліміти ще не задано',
        text: 'Вкажи, скільки хочеш витрачати на місяць — на всі витрати й на окремі категорії. CRM покаже, скільки лишилось, підкаже у формі витрати й попередить на 80 % і 100 %.',
        action: { label: 'Задати ліміти', icon: 'plus', onClick: () => openEditor({ month }) }
      })), freeCard(month, sp, cats));
      return;
    }

    // Підсумок
    const counted = cats.concat(total ? [total] : []);
    const overN = counted.filter((x) => x.level === 'over').length;
    const warnN = counted.filter((x) => x.level === 'warn').length;
    let summary;
    if (!counted.length) summary = `На ${monthLower(month)} лімітів немає.`;
    else if (isPast) {
      summary = !overN ? `У ${monthIn(month)} вклався в усі ліміти (${counted.length}).`
        : overN === counted.length ? `У ${monthIn(month)} перевищено всі ліміти (${counted.length}).`
          : `У ${monthIn(month)}: вклався в ${counted.length - overN} з ${fmt.count(counted.length, ['ліміт', 'ліміти', 'лімітів'])}, перевищено — ${overN}.`;
    }
    else if (isFuture) summary = `Ліміти на ${monthLower(month)} — витрат ще немає.`;
    else {
      const parts = [`${counted.length - overN - warnN} з ${counted.length} — у межах`];
      if (warnN) parts.push(`${warnN} — майже вичерпано`);
      if (overN) parts.push(`${overN} — перевищено`);
      const days = D.daysInMonth(D.parse(T).y, D.parse(T).m) - D.parse(T).d;
      summary = parts.join(', ') + `. До кінця місяця ${fmt.count(days, ['день', 'дні', 'днів'])}.`;
    }

    // Загальний ліміт
    const totalCard = h('section', { class: 'card lim-total' },
      h('div', { class: 'card-head' }, h('h2', null, `Витрати за ${monthLower(month)}`), h('span', { class: 'subtle lim-summary' }, summary)),
      total ? h('div', { class: 'lim-list' }, limitRow(total, month, { edit: true }))
        : h('div', { class: 'lim-nototal' },
          h('span', null, 'Усього витрачено: ', h('strong', { class: 'num' }, m0(sp.total)), ' · загального ліміту немає'),
          h('button', { type: 'button', class: 'link-like lim-set-total', onClick: () => openEditor({ month, focus: 'total' }) }, 'Задати')));

    // Сума лімітів категорій більша за загальний
    const catSum = cats.reduce((s, c) => s + c.limit, 0);
    const sumWarn = total && catSum > total.limit + 0.004
      ? h('div', { class: 'callout callout-warning lim-warn-sum' }, CRM.icon('alert'),
        h('span', null, `Ліміти категорій разом — ${m0(catSum)}, це більше за загальний ліміт ${m0(total.limit)}.`))
      : null;

    const catsCard = h('section', { class: 'card lim-cats' },
      h('div', { class: 'card-head' }, h('h2', null, 'Ліміти категорій'), h('span', { class: 'subtle' }, cats.length ? fmt.count(cats.length, ['категорія', 'категорії', 'категорій']) : '')),
      cats.length ? h('div', { class: 'lim-list' }, cats.map((it) => limitRow(it, month, { edit: true })))
        : ui.empty({ icon: 'tag', small: true, title: 'Лімітів на категорії немає', text: 'Наприклад, «Кафе — 2 000 ₴» або «Таксі — 800 ₴».', action: { label: 'Додати', icon: 'plus', variant: 'secondary', onClick: () => openEditor({ month }) } }));

    const missingNote = sp.missing ? h('div', { class: 'callout callout-warning' }, CRM.icon('alert'),
      h('span', null, `${sp.missing} ${fmt.plural(sp.missing, ['витрату', 'витрати', 'витрат'])} у валюті не враховано — немає курсу НБУ. Натисни «Оновити» біля курсу вгорі.`)) : null;

    ui.mount(container, toolbar, h('div', { class: 'stack' }, missingNote, totalCard, sumWarn, catsCard, freeCard(month, sp, cats)));
  }

  /** Категорії з витратами цього місяця, але без ліміту. */
  function freeCard(month, sp, withLimit) {
    const has = new Set(withLimit.map((x) => x.id));
    const rows = expenseCats().filter((c) => !has.has(c.id) && (sp.cats.get(c.id) || 0) > 0)
      .map((c) => ({ c, spent: sp.cats.get(c.id) }))
      .sort((a, b) => b.spent - a.spent);
    if (!rows.length) return null;
    return h('section', { class: 'card lim-free' },
      h('div', { class: 'card-head' }, h('h2', null, 'Без ліміту'), h('span', { class: 'subtle' }, `витрати за ${monthLower(month)}`)),
      h('div', { class: 'lim-free-list' }, rows.map(({ c, spent }) => h('div', { class: 'lim-free-row', dataset: { id: c.id } },
        h('button', { type: 'button', class: 'lim-free-main', title: 'Показати витрати за місяць', onClick: () => openTx(c.id, month) },
          h('span', { class: 'cat-dot', style: { background: CRM.dict.categoryColor(c.color) } }),
          h('span', { class: 'lim-free-name' }, c.name),
          h('span', { class: 'num lim-free-sum' }, m0(spent))),
        h('button', { type: 'button', class: 'btn btn-ghost btn-sm lim-free-add', onClick: () => openEditor({ month, focus: c.id }) }, CRM.icon('plus', { size: 'sm' }), 'Ліміт')))));
  }

  // ---------- Картка (Дашборд і Головна) ----------
  /** opts: { max (5), home } → section.card */
  function card(opts) {
    const o = opts || {};
    const T = D.today();
    const max = o.max || 5;
    const head = h('div', { class: 'card-head' },
      h('h2', null, o.home ? 'Ліміти' : `Ліміти · ${monthLower(T)}`),
      h('a', { class: 'btn btn-ghost btn-sm', href: '#/budget/limits' }, o.home ? 'Усі ліміти' : 'Усі', CRM.icon('chevronRight', { size: 'sm' })));
    if (!hasAny() || !expenseCats().length) {
      return h('section', { class: 'card lim-card' }, head, ui.empty({
        icon: 'gauge', small: true, title: 'Ліміти ще не задано',
        text: o.home ? 'Скільки хочеш витрачати на місяць — на все й на окремі категорії.' : null,
        action: { label: 'Задати ліміти', icon: 'plus', variant: 'secondary', onClick: () => { CRM.router.go('budget/limits'); setTimeout(() => openEditor({ month: T }), 60); } }
      }));
    }
    const list = items(T);
    if (!list.length) {
      return h('section', { class: 'card lim-card' }, head, h('div', { class: 'card-body subtle' }, `На ${monthLower(T)} лімітів немає.`));
    }
    const total = list.find((x) => x.id === 'total');
    const cats = list.filter((x) => x.id !== 'total');
    const shown = (total ? [total] : []).concat(cats.slice(0, total ? max - 1 : max));
    const rest = list.length - shown.length;
    const row = (it) => h('button', {
      type: 'button', class: `lim-mini lv-${it.level}`, dataset: { id: it.id }, title: 'Показати витрати за місяць',
      onClick: () => openTx(it.id, T)
    },
    h('span', { class: 'lim-mini-top' },
      h('span', { class: 'lim-name' }, it.id === 'total' ? h('span', { class: 'lim-ico' }, CRM.icon('wallet', { size: 'sm' })) : h('span', { class: 'cat-dot', style: { background: it.color } }), h('span', { class: 'lim-name-text' }, it.name)),
      h('span', { class: 'lim-mini-left num' }, it.over ? `перевищено на ${m0(it.over)}` : `лишилось ${m0(it.left)}`)),
    bar(it),
    h('span', { class: 'lim-mini-nums num subtle' }, `${num0(it.spent)} з ${m0(it.limit)}`));
    return h('section', { class: 'card lim-card' }, head,
      h('div', { class: 'lim-mini-list' }, shown.map(row)),
      rest > 0 ? h('a', { class: 'more-link', href: '#/budget/limits' }, `Ще ${fmt.count(rest, ['ліміт', 'ліміти', 'лімітів'])}`) : null);
  }

  // ---------- Підказка у формі транзакції ----------
  /**
   * opts: { categoryId, amount (у валюті рахунку, необовʼязково), accountId, date, excludeId } → елемент або null.
   */
  function formHint(opts) {
    const o = opts || {};
    const date = o.date || D.today();
    const lc = o.categoryId ? limitOf(o.categoryId, date) : null;
    const lt = limitOf('total', date);
    if (!lc && !lt) return null;
    const sp = spentIn(date, { exclude: o.excludeId });
    const cur = o.accountId ? F().currencyOf(o.accountId) : 'UAH';
    const amt = Number(o.amount);
    const add = o.amount != null && isFinite(amt) && amt > 0 ? CRM.rates.toUAH(amt, cur, date) : null;
    const when = mk(date) === mk(D.today()) ? '' : ` на ${monthLower(date)}`;
    const lines = [];
    const line = (label, spent, limit, cls) => {
      const now = status(spent, limit);
      const after = add != null ? status(spent + add, limit) : null;
      return h('div', { class: 'tx-limit-line ' + cls + ' lv-' + (after || now).level },
        h('div', { class: 'tx-limit-text' },
          h('span', null, label, ': ', now.over ? `перевищено на ${m0(now.over)}` : `лишилось ${m0(now.left)} з ${m0(limit)}`),
          after ? h('span', { class: 'tx-limit-after' }, after.over ? ` → після цієї витрати перевищено на ${m0(after.over)}` : ` → після цієї витрати лишиться ${m0(after.left)}`) : null),
        h('div', { class: 'lim-bar lim-bar-sm' }, h('div', { class: 'lim-fill', style: { width: Math.min(100, (after || now).pct * 100) + '%' } })));
    };
    if (lc) lines.push(line(`Ліміт «${catName(o.categoryId)}»${when}`, sp.cats.get(o.categoryId) || 0, lc, 'tx-limit-cat'));
    if (lt) lines.push(line(`Усі витрати${when}`, sp.total, lt, 'tx-limit-total'));
    return h('div', { class: 'tx-limit' }, lines);
  }

  // ---------- Тост після витрати ----------
  /** Текст про ліміти після збереженої витрати: { text, level } | null. */
  function noteFor(tx) {
    if (!tx || tx.type !== 'expense' || tx.deletedAt) return null;
    const date = tx.date;
    const ids = [...new Set(F().txParts(tx).map((p) => p.categoryId).filter((id) => id && limitOf(id, date)))];
    const lt = limitOf('total', date);
    if (!ids.length && !lt) return null;
    const sp = spentIn(date);
    const notes = [];
    let level = 'ok';
    const worse = (l) => { if (l === 'over' || (l === 'warn' && level === 'ok')) level = l; };
    ids.forEach((id) => {
      const lim = limitOf(id, date);
      const st = status(sp.cats.get(id) || 0, lim);
      worse(st.level);
      notes.push(st.over ? `ліміт «${catName(id)}» перевищено на ${m0(st.over)}` : `на «${catName(id)}» лишилось ${m0(st.left)} з ${m0(lim)}`);
    });
    if (lt) {
      const st = status(sp.total, lt);
      if (st.over) { worse('over'); notes.push(`загальний ліміт перевищено на ${m0(st.over)}`); }
      else if (!ids.length || st.level === 'warn') { worse(st.level); notes.push(`усього на місяць лишилось ${m0(st.left)} з ${m0(lt)}`); }
    }
    if (!notes.length) return null;
    const prefix = mk(date) === mk(D.today()) ? '' : `${cap(monthLower(date))}: `;
    return { text: prefix + (prefix ? notes.join(' · ') : cap(notes.join(' · '))), level };
  }

  // ---------- Дзвіночок: 80 % і 100 % ----------
  CRM.notify.addRule(() => {
    if (!hasAny()) return [];
    const T = D.today();
    const M = mk(T);
    const out = [];
    const known = new Set(S().list('notifications').map((n) => n.key));
    items(T).forEach((it) => {
      const what = it.id === 'total' ? 'Усі витрати' : `«${it.name}»`;
      const k100 = `limit:${it.id}:${M}:100`;
      if (it.pct >= 1) {
        out.push({
          key: k100, kind: 'limit',
          title: it.over ? 'Ліміт перевищено' : 'Ліміт вичерпано',
          text: `${what}: ${num0(it.spent)} з ${m0(it.limit)}${it.over ? ` — більше на ${m0(it.over)}` : ''}`,
          target: { route: 'budget/limits' }
        });
      } else if (it.pct >= WARN && !known.has(k100)) {
        out.push({
          key: `limit:${it.id}:${M}:80`, kind: 'limit',
          title: 'Ліміт майже вичерпано',
          text: `${what}: витрачено ${fmt.percent(Math.floor(it.pct * 100), 0)} — лишилось ${m0(it.left)} з ${m0(it.limit)}`,
          target: { route: 'budget/limits' }
        });
      }
    });
    return out;
  });
  // Нова витрата чи змінені ліміти — одразу перевірити дзвіночок; змінені ліміти — перемалювати сторінку
  const recheck = U.debounce(() => { if (hasAny()) CRM.notify.runRules(); }, 700);
  let lastRaw = S().getSetting(KEY, null);
  S().on(['transactions', 'settings'], (changed) => {
    const now = S().getSetting(KEY, null);
    const limitsChanged = now !== lastRaw;
    lastRaw = now;
    if (changed.has('transactions') || limitsChanged) recheck();
    if (limitsChanged) {
      const cur = CRM.router.current;
      if (cur && (cur.name === 'budget' || cur.name === 'home')) CRM.router.rerender();
    }
  });

  CRM.budget.registerTab('limits', { render });
  CRM.limits = {
    KEY, WARN, limitOf, baseOf, isOverridden, hasAny, spentIn, status, items, averages, roundUp,
    applyFrom, applyMonth, openEditor, card, homeCard: () => card({ home: true, max: 4 }), formHint, noteFor
  };
})(window.CRM);
