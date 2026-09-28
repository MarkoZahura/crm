/* ==========================================================================
   accounts.js — вкладка «Рахунки».
   Список від більшої суми до меншої (у гривневому еквіваленті): спершу
   банківські та інші рахунки, окремим блоком нижче — ощадні.
   Бічна панель: назва, тип, валюта, початковий баланс, опис.
   ========================================================================== */
window.CRM = window.CRM || {};

(function (CRM) {
  'use strict';

  const { h, ui } = { h: CRM.ui.h, ui: CRM.ui };
  const fmt = CRM.fmt;
  const F = () => CRM.finance;

  function txOfAccount(id) {
    return CRM.store.list('transactions').filter((t) => t.accountId === id || t.toAccountId === id);
  }

  function typeIcon(type) { const t = CRM.dict.get('accountTypes', type); return t ? t.icon : 'wallet'; }

  // ---------- Рядок рахунку ----------
  function row(x) {
    const a = x.account;
    const foreign = a.currency !== 'UAH';
    return h('button', { type: 'button', class: 'acc-row', onClick: () => openAccountForm(a.id), dataset: { id: a.id } },
      h('span', { class: 'list-row-icon acc-ico acc-' + a.type }, CRM.icon(typeIcon(a.type), { size: 'sm' })),
      h('span', { class: 'acc-main' },
        h('span', { class: 'acc-name' }, a.name),
        h('span', { class: 'acc-sub' }, [CRM.dict.label('accountTypes', a.type), a.description].filter(Boolean).join(' · '))),
      h('span', { class: 'acc-amount' },
        h('span', { class: 'acc-balance num' + (x.balance < 0 ? ' neg' : '') }, fmt.money(x.balance, a.currency)),
        foreign ? h('span', { class: 'acc-uah num' }, x.uah == null ? 'немає курсу' : '≈ ' + fmt.money(x.uah, 'UAH')) : null));
  }

  function block(title, list, icon) {
    const total = list.reduce((s, x) => s + (x.uah || 0), 0);
    return h('section', { class: 'card' },
      h('div', { class: 'card-head' },
        h('h2', null, CRM.icon(icon, { size: 'sm' }), title, h('span', { class: 'tab-count' }, String(list.length))),
        h('span', { class: 'acc-total num' }, fmt.money(total, 'UAH'))),
      h('div', { class: 'acc-list' }, list.map(row)));
  }

  function render(container, route) {
    const ranked = F().rankedAccounts();
    const regular = ranked.filter((x) => x.account.type !== 'savings');
    const saving = ranked.filter((x) => x.account.type === 'savings');
    const cap = F().capital();

    const toolbar = h('div', { class: 'toolbar' },
      h('div', { class: 'toolbar-note' }, ranked.length
        ? ['Загальний капітал: ', h('strong', { class: 'num' }, fmt.money(cap.total, 'UAH')), cap.missing ? ' (без рахунків, для яких немає курсу)' : '']
        : 'Рахунки: картки, готівка, ощадні, інвестиційні, електронні гаманці.'),
      ui.button({ label: 'Додати рахунок', icon: 'plus', onClick: () => openAccountForm() }));

    let content;
    if (!ranked.length) {
      content = h('div', { class: 'card' }, ui.empty({
        icon: 'bank', title: 'Ще немає рахунків — додай перший',
        text: 'Почни з основної картки й готівки. Початковий баланс — сума, яка є на рахунку зараз.',
        action: { label: 'Додати рахунок', icon: 'plus', onClick: () => openAccountForm() }
      }));
    } else {
      content = h('div', { class: 'stack' },
        regular.length ? block('Рахунки', regular, 'wallet') : null,
        saving.length ? block('Ощадні рахунки', saving, 'piggy') : null);
    }
    ui.mount(container, toolbar, content);

    if (route.params.open) {
      const id = route.params.open;
      CRM.router.consumeParam('open');
      setTimeout(() => openAccountForm(id), 0);
    }
  }

  // ---------- Форма рахунку ----------
  function openAccountForm(id) {
    const existing = id ? CRM.store.get('accounts', id) : null;
    if (id && (!existing || existing.deletedAt)) { ui.toast('Рахунок не знайдено', { type: 'error' }); return null; }
    const isNew = !existing;
    const txCount = existing ? txOfAccount(existing.id).length : 0;
    const st = existing ? CRM.utils.deepClone(existing) : { name: '', type: 'bank', currency: 'UAH', initialBalance: 0, description: '' };

    const nameIn = ui.input({ value: st.name, maxlength: 60, placeholder: 'Напр., Основна картка' });
    const fName = ui.field({ label: 'Назва', input: nameIn, required: true });

    const typeSel = ui.select(CRM.dict.accountTypes.map((t) => ({ value: t.id, label: t.label })), { value: st.type, 'aria-label': 'Тип рахунку' });
    const fType = ui.field({ label: 'Тип', input: typeSel });

    const curSeg = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Валюта' });
    const balCur = h('span', { class: 'amount-cur' });
    function renderCur() {
      ui.mount(curSeg, CRM.dict.currencies.map((c) => h('button', {
        type: 'button', role: 'radio', class: st.currency === c ? 'active' : '', 'aria-checked': st.currency === c ? 'true' : 'false',
        disabled: txCount > 0 && st.currency !== c,
        onClick: () => { st.currency = c; renderCur(); }
      }, `${CRM.CURRENCIES[c].symbol} ${c}`)));
      balCur.textContent = CRM.CURRENCIES[st.currency].symbol;
    }
    renderCur();
    const fCur = ui.field({
      label: 'Валюта', input: curSeg,
      hint: txCount > 0 ? 'Валюту не можна змінити: на рахунку вже є операції.' : null
    });

    const balIn = h('input', {
      class: 'input amount-input', type: 'text', inputmode: 'decimal', autocomplete: 'off', placeholder: '0,00',
      value: st.initialBalance ? String(st.initialBalance).replace('.', ',') : '', 'aria-label': 'Початковий баланс'
    });
    const fBal = ui.field({
      label: 'Початковий баланс', input: h('div', { class: 'amount-wrap' }, balIn, balCur),
      hint: 'Скільки було на рахунку до першої внесеної операції. Може бути відʼємним (борг за кредиткою).'
    });

    const descIn = ui.textarea({ value: st.description || '', rows: 2, maxlength: 300, placeholder: 'Необовʼязково: банк, призначення, умови' });
    const fDesc = ui.field({ label: 'Опис', input: descIn });

    let stats = null;
    if (existing) {
      const bal = F().balance(existing.id);
      stats = h('div', { class: 'acc-stats' },
        h('div', null, h('div', { class: 'stat-label' }, 'Поточний баланс'), h('div', { class: 'stat-value num' }, fmt.money(bal, existing.currency))),
        h('div', null, h('div', { class: 'stat-label' }, 'Операцій'), h('div', { class: 'stat-value num' }, String(txCount))),
        txCount ? h('a', { href: CRM.router.href('budget/transactions', { account: existing.id }), class: 'btn btn-sm', onClick: () => dlg.close('force') }, 'Показати операції', CRM.icon('chevronRight', { size: 'sm' })) : null);
    }

    async function submit(e) {
      if (e) e.preventDefault();
      let ok = true;
      const name = nameIn.value.trim();
      if (!name) { fName.setError('Вкажи назву рахунку'); ok = false; }
      const bal = balIn.value.trim() ? CRM.utils.parseAmount(balIn.value) : 0;
      if (isNaN(bal)) { fBal.setError('Вкажи число, напр., 12 000 або 1 250,50'); ok = false; }
      if (!ok) return;
      const rec = Object.assign(existing ? CRM.utils.deepClone(existing) : {}, {
        name, type: typeSel.value, currency: st.currency, initialBalance: CRM.utils.round2(bal), description: descIn.value.trim()
      });
      await CRM.store.save('accounts', rec);
      dlg.close('force');
      ui.toast(isNew ? `Рахунок «${name}» додано` : 'Зміни збережено', { type: 'success' });
    }

    async function remove() {
      const related = txOfAccount(existing.id).map((t) => ({ store: 'transactions', id: t.id }));
      const ok = await ui.confirm({
        title: 'Видалити рахунок?',
        message: related.length
          ? `«${existing.name}» і ${related.length} ${fmt.plural(related.length, ['операція', 'операції', 'операцій'])} потраплять у Кошик. Відновити можна разом протягом 30 днів.`
          : `«${existing.name}» потрапить у Кошик. Відновити можна протягом 30 днів.`,
        confirmText: 'Видалити', danger: true
      });
      if (!ok) return;
      const batch = await CRM.store.softDelete('accounts', existing.id, related);
      dlg.close('force');
      ui.toast('Рахунок перенесено в Кошик', { action: { label: 'Скасувати', onClick: () => CRM.store.restoreBatch(batch) } });
    }

    const form = h('form', { class: 'form-stack', novalidate: true, onSubmit: submit },
      stats, fName, h('div', { class: 'form-grid' }, fType, fCur), fBal, fDesc,
      h('button', { type: 'submit', hidden: true, tabIndex: -1, 'aria-hidden': 'true' }));

    const dlg = ui.drawer({
      title: isNew ? 'Новий рахунок' : 'Рахунок',
      body: form,
      footer: h('div', { class: 'drawer-footer-inner' },
        existing ? ui.button({ label: 'Видалити', icon: 'trash', variant: 'danger-ghost', onClick: remove }) : null,
        h('span', { class: 'grow' }),
        ui.button({ label: 'Скасувати', onClick: () => dlg.close('button') }),
        ui.button({ label: isNew ? 'Додати рахунок' : 'Зберегти', variant: 'primary', icon: isNew ? 'plus' : 'check', onClick: () => submit() })),
      initialFocus: isNew ? nameIn : 'container'
    });
    return dlg;
  }

  CRM.budget.registerTab('accounts', { render });
  CRM.budget.openAccountForm = openAccountForm;
})(window.CRM);
