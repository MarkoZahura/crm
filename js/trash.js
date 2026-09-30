/* ==========================================================================
   trash.js — Кошик: усі видалені записи з усіх розділів.
   Відновити, видалити назавжди, очистити кошик. Через 30 днів записи
   видаляються автоматично (перевірка при запуску й раз на добу).
   ========================================================================== */
window.CRM = window.CRM || {};

(function (CRM) {
  'use strict';

  const { h, ui } = { h: CRM.ui.h, ui: CRM.ui };

  const FILTERS = [
    { id: 'all', label: 'Усі', match: () => true },
    { id: 'tasks', label: 'Задачі', match: (s) => s === 'tasks' },
    { id: 'budget', label: 'Бюджет', match: (s) => ['accounts', 'transactions', 'categories', 'recurring', 'goals'].includes(s) },
    { id: 'training', label: 'Тренування', match: (s) => s === 'workouts' },
    { id: 'nutrition', label: 'Харчування', match: (s) => s === 'foods' || s === 'meals' },
    { id: 'learning', label: 'Навчання', match: (s) => s === 'courses' }
  ];
  let filter = 'all';

  function daysLeft(deletedAt) {
    const deletedDay = CRM.date.toKyivDate(deletedAt);
    return Math.max(0, CRM.store.TRASH_DAYS - CRM.date.diffDays(deletedDay, CRM.date.today()));
  }

  async function restore(item) {
    const t = CRM.entities.types[item.store];
    // Залежності в Кошику (напр., рахунок транзакції) — відновлюємо разом, якщо користувач погодиться
    const deps = (t && t.deps ? t.deps(item.record) : [])
      .map((d) => ({ d, rec: CRM.store.get(d.store, d.id) }))
      .filter((x) => x.rec && x.rec.deletedAt && x.rec.deleteBatch !== item.record.deleteBatch);
    if (deps.length) {
      const names = Array.from(new Set(deps.map((x) => `${CRM.entities.types[x.d.store].label.toLowerCase()} «${CRM.entities.types[x.d.store].title(x.rec)}»`)));
      const ok = await ui.confirm({
        title: 'Відновити разом?',
        message: `У Кошику також ${names.join(', ')}, без ${names.length > 1 ? 'яких' : 'чого'} цей запис показуватиметься неповно. Відновити разом?`,
        confirmText: 'Відновити все', cancelText: 'Скасувати'
      });
      if (!ok) return;
      for (const b of new Set(deps.map((x) => x.rec.deleteBatch))) await CRM.store.restoreBatch(b);
    }
    await CRM.store.restoreBatch(item.record.deleteBatch);
    const title = t ? t.title(item.record) : 'Запис';
    ui.toast(`«${title}» відновлено`, {
      type: 'success',
      action: { label: 'Відкрити', onClick: () => CRM.entities.open(item.store, item.record.id) }
    });
  }

  async function purge(item) {
    const t = CRM.entities.types[item.store];
    const title = t ? t.title(item.record) : 'запис';
    const extra = item.related
      ? ` Разом з ним буде видалено ${item.related} ${CRM.fmt.plural(item.related, ['повʼязаний запис', 'повʼязані записи', 'повʼязаних записів'])}.`
      : '';
    const ok = await ui.confirm({
      title: 'Видалити назавжди?',
      message: `«${title}» буде видалено без можливості відновлення.${extra}`,
      confirmText: 'Видалити назавжди',
      danger: true
    });
    if (!ok) return;
    await CRM.store.purgeBatch(item.record.deleteBatch);
    ui.toast('Видалено назавжди');
  }

  async function emptyTrash() {
    const items = CRM.store.trashItems();
    if (!items.length) return;
    const ok = await ui.confirm({
      title: 'Очистити кошик?',
      message: `Усі ${items.length} ${CRM.fmt.plural(items.length, ['запис', 'записи', 'записів'])} буде видалено назавжди. Це не можна скасувати.`,
      confirmText: 'Очистити кошик',
      danger: true
    });
    if (!ok) return;
    for (const it of items) await CRM.store.purgeBatch(it.record.deleteBatch);
    ui.toast('Кошик очищено');
  }

  function renderRow(item) {
    const t = CRM.entities.types[item.store];
    const left = daysLeft(item.record.deletedAt);
    const days = (n) => `${n} ${CRM.fmt.plural(n, ['день', 'дні', 'днів'])}`;
    const parts = [t ? t.label : item.store];
    if (item.related) parts.push(`разом із ${item.related} ${CRM.fmt.plural(item.related, ['повʼязаним записом', 'повʼязаними записами', 'повʼязаними записами'])}`);
    parts.push('видалено ' + CRM.fmt.dateShort(CRM.date.toKyivDate(item.record.deletedAt)));
    if (left > 3) parts.push(`ще ${days(left)}`);
    const meta = [
      h('span', null, parts.join(' · ')),
      left <= 3 ? h('span', { class: 'badge badge-warning' }, left === 0 ? 'видалиться сьогодні' : `видалиться через ${days(left)}`) : null
    ];
    return h('div', { class: 'list-row trash-row' },
      h('span', { class: 'list-row-icon ' + (t ? t.iconClass : '') }, CRM.icon(t ? t.icon : 'trash', { size: 'sm' })),
      h('div', { class: 'list-row-main' },
        h('div', { class: 'list-row-title' }, t ? t.title(item.record) : item.record.id),
        h('div', { class: 'list-row-sub trash-meta' }, meta)),
      h('div', { class: 'list-row-actions' },
        ui.button({ label: 'Відновити', icon: 'restore', size: 'sm', onClick: () => restore(item) }),
        ui.button({ icon: 'trash', iconOnly: true, size: 'sm', variant: 'danger-ghost', title: 'Видалити назавжди', onClick: () => purge(item) })));
  }

  function render(container) {
    const all = CRM.store.trashItems();
    const f = FILTERS.find((x) => x.id === filter) || FILTERS[0];
    const items = all.filter((it) => f.match(it.store));

    const chips = h('div', { class: 'chips', role: 'tablist', 'aria-label': 'Фільтр' },
      FILTERS.map((x) => {
        const n = all.filter((it) => x.match(it.store)).length;
        return h('button', {
          type: 'button', class: 'chip' + (x.id === filter ? ' active' : ''), role: 'tab',
          'aria-selected': x.id === filter ? 'true' : 'false',
          onClick: () => { filter = x.id; CRM.router.rerender(); }
        }, n ? `${x.label} · ${n}` : x.label);
      }));

    let content;
    if (!all.length) {
      content = h('div', { class: 'card' }, ui.empty({
        icon: 'trash', title: 'Кошик порожній',
        text: 'Видалені задачі, транзакції, рахунки та інші записи зберігаються тут 30 днів — їх можна відновити.'
      }));
    } else if (!items.length) {
      content = h('div', { class: 'card' }, ui.empty({ icon: 'inbox', title: 'У цьому розділі кошик порожній', small: true }));
    } else {
      content = h('div', { class: 'card list' }, items.map(renderRow));
    }

    ui.mount(container,
      ui.pageHead({
        title: 'Кошик',
        sub: 'Видалене зберігається 30 днів, потім зникає назавжди.',
        actions: ui.button({ label: 'Очистити кошик', icon: 'trash', variant: 'danger-ghost', disabled: !all.length, onClick: emptyTrash })
      }),
      h('div', { class: 'stack' }, all.length ? chips : null, content));
  }

  CRM.router.register('trash', {
    title: 'Кошик',
    stores: ['tasks', 'accounts', 'transactions', 'categories', 'recurring', 'goals', 'workouts', 'courses', 'foods', 'meals'],
    render
  });

  CRM.trash = { restore, purge, emptyTrash };
})(window.CRM);
