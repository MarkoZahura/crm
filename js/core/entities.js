/* ==========================================================================
   entities.js — опис типів записів для пошуку, Кошика й сповіщень:
   як називається тип, яка іконка, як показати назву та куди вести клік.
   ========================================================================== */
window.CRM = window.CRM || {};

(function (CRM) {
  'use strict';

  const S = () => CRM.store;
  const fmt = () => CRM.fmt;

  function catName(id) { const c = S().get('categories', id); return c ? c.name : ''; }
  function subName(catId, subId) {
    const c = S().get('categories', catId);
    const s = c && (c.subcategories || []).find((x) => x.id === subId);
    return s ? s.name : '';
  }
  function accName(id) { const a = S().get('accounts', id); return a ? a.name : 'Рахунок видалено'; }
  function accCurrency(id) { const a = S().get('accounts', id); return a ? a.currency : 'UAH'; }

  /** 'Щомісяця' / 'Кожні 2 тижні' */
  function freqLabel(freq) {
    if (!freq) return '';
    const unit = CRM.dict.get('recurringUnits', freq.unit);
    const n = Number(freq.every) || 1;
    if (n === 1 && unit) return unit.every;
    const forms = {
      day: ['день', 'дні', 'днів'], week: ['тиждень', 'тижні', 'тижнів'],
      month: ['місяць', 'місяці', 'місяців'], year: ['рік', 'роки', 'років']
    }[freq.unit] || ['раз', 'рази', 'разів'];
    return `Кожні ${n} ${fmt().plural(n, forms)}`;
  }

  function txSignedAmount(r) {
    const cur = accCurrency(r.accountId);
    if (r.type === 'expense') return fmt().money(-r.amount, cur);
    if (r.type === 'income') return fmt().money(r.amount, cur, { sign: true });
    return fmt().money(r.amount, cur);
  }

  const types = {
    tasks: {
      label: 'Задача', group: 'Задачі', icon: 'tasks', iconClass: 'ico-task', section: 'tasks',
      title: (r) => r.title || 'Без назви',
      sub: (r) => {
        if (r.done) return 'Архів' + (r.completedAt ? ' · виконано ' + fmt().dateShort(CRM.date.toKyivDate(r.completedAt)) : '');
        const parts = [CRM.dict.label('taskStatuses', r.status)];
        if (r.deadline) parts.push('дедлайн ' + fmt().relDay(r.deadline).toLowerCase());
        return parts.filter(Boolean).join(' · ');
      },
      text: (r) => [r.title, r.description, (r.checklist || []).map((c) => c.text).join(' ')],
      route: (r) => ['tasks', { tab: r.done ? 'archive' : null, open: r.id }]
    },
    transactions: {
      label: 'Транзакція', group: 'Транзакції', icon: 'receipt', iconClass: 'ico-payment', section: 'budget',
      title: (r) => {
        if (r.comment) return r.comment;
        if (r.type === 'transfer') return `Переказ: ${accName(r.accountId)} → ${accName(r.toAccountId)}`;
        return catName(r.categoryId) || CRM.dict.label('txTypes', r.type);
      },
      sub: (r) => [fmt().date(r.date), txSignedAmount(r), catName(r.categoryId) || null, accName(r.accountId)].filter(Boolean).join(' · '),
      text: (r) => [r.comment, catName(r.categoryId), subName(r.categoryId, r.subcategoryId), accName(r.accountId)],
      amounts: (r) => [r.amount, r.toAmount].filter((x) => typeof x === 'number'),
      route: (r) => ['budget/transactions', { open: r.id }],
      // Від чого залежить запис: якщо рахунок чи категорія теж у Кошику — запропонуємо відновити разом
      deps: (r) => [
        { store: 'accounts', id: r.accountId }, { store: 'accounts', id: r.toAccountId }, { store: 'categories', id: r.categoryId }
      ].filter((x) => x.id)
    },
    accounts: {
      label: 'Рахунок', group: 'Рахунки', icon: 'bank', iconClass: 'ico-event', section: 'budget',
      title: (r) => r.name,
      sub: (r) => [CRM.dict.label('accountTypes', r.type), r.currency].filter(Boolean).join(' · '),
      text: (r) => [r.name, r.description, CRM.dict.label('accountTypes', r.type)],
      route: (r) => ['budget/accounts', { open: r.id }]
    },
    categories: {
      label: 'Категорія', group: 'Категорії', icon: 'tag', iconClass: 'ico-goal', section: 'budget',
      title: (r) => r.name,
      sub: (r) => {
        const n = (r.subcategories || []).length;
        return (r.kind === 'income' ? 'Доходи' : 'Витрати') + (n ? ' · ' + fmt().count(n, ['субкатегорія', 'субкатегорії', 'субкатегорій']) : '');
      },
      text: (r) => [r.name, (r.subcategories || []).map((s) => s.name).join(' ')],
      route: (r) => ['budget/categories', { open: r.id }]
    },
    recurring: {
      label: 'Регулярний платіж', group: 'Регулярні платежі', icon: 'repeat', iconClass: 'ico-payment', section: 'budget',
      title: (r) => r.name,
      sub: (r) => [freqLabel(r.freq), fmt().money(r.amount, r.currency), r.kind === 'income' ? 'дохід' : null].filter(Boolean).join(' · '),
      text: (r) => [r.name],
      amounts: (r) => [r.amount],
      route: (r) => ['budget/recurring', { open: r.id }]
    },
    goals: {
      label: 'Фінансова ціль', group: 'Фінансові цілі', icon: 'target', iconClass: 'ico-goal', section: 'budget',
      title: (r) => r.name,
      sub: (r) => `${fmt().money(r.saved || 0, r.currency)} з ${fmt().money(r.target || 0, r.currency)}` +
        (r.status === 'achieved' ? ' · досягнуто' : r.status === 'paused' ? ' · відкладено' : ''),
      text: (r) => [r.name, r.category],
      amounts: (r) => [r.target],
      route: (r) => ['budget/goals', { tab: r.status, open: r.id }]
    },
    workouts: {
      label: 'Тренування', group: 'Тренування', icon: 'dumbbell', iconClass: 'ico-danger', section: 'training',
      title: (r) => r.title || CRM.dict.label('workoutTypes', r.type) || 'Тренування',
      sub: (r) => [fmt().date(r.date), r.durationMin ? r.durationMin + ' хв' : null, r.distanceKm ? fmt().number(r.distanceKm, 1).replace(/,0$/, '') + ' км' : null].filter(Boolean).join(' · '),
      text: (r) => [r.title, CRM.dict.label('workoutTypes', r.type), (r.exercises || []).map((e) => e.name).join(' '), r.note],
      route: (r) => ['training', { open: r.id }]
    },
    courses: {
      label: 'Навчання', group: 'Навчання', icon: 'graduation', iconClass: 'ico-learning', section: 'learning',
      title: (r) => r.title,
      sub: (r) => {
        const topics = r.topics || [];
        const done = topics.filter((t) => t.done).length;
        return [CRM.dict.label('courseKinds', r.kind), topics.length ? `${done}/${topics.length} тем` : null].filter(Boolean).join(' · ');
      },
      text: (r) => [r.title, r.notes, (r.topics || []).map((t) => t.title).join(' ')],
      route: (r) => ['learning', { open: r.id }]
    },
    foods: {
      label: 'Продукт', group: 'Продукти', icon: 'apple', iconClass: 'ico-goal', section: 'nutrition',
      title: (r) => r.name || 'Продукт',
      sub: (r) => [`${fmt().number(Math.round(Number(r.kcal) || 0), 0)} ккал на 100 г`, r.kind === 'dish' ? 'страва' : null, r.baseId ? 'змінений вбудований' : null].filter(Boolean).join(' · '),
      text: (r) => [r.name, (r.ingredients || []).map((i) => i.name).join(' ')],
      route: (r) => ['nutrition/foods', { open: r.id }]
    },
    meals: {
      label: 'Запис харчування', group: 'Харчування', icon: 'utensils', iconClass: 'ico-goal', section: 'nutrition',
      title: (r) => r.name || 'Їжа',
      sub: (r) => {
        const kcal = r.per100 && r.grams ? r.per100.kcal * r.grams / 100 : Number(r.manual && r.manual.kcal) || 0;
        return [fmt().date(r.date), CRM.dict.label('mealTypes', r.meal), `${fmt().number(Math.round(kcal), 0)} ккал`].filter(Boolean).join(' · ');
      },
      text: (r) => [r.name],
      route: (r) => ['nutrition', { date: r.date, open: r.id }]
    }
  };

  /** Відкрити запис: перехід до розділу з параметром open. */
  function open(store, id) {
    const t = types[store];
    const rec = S().get(store, id);
    if (!t || !rec) {
      CRM.ui.toast('Цей запис більше не існує', { type: 'error' });
      return;
    }
    if (rec.deletedAt) {
      CRM.ui.toast('Запис у Кошику — віднови його, щоб відкрити');
      CRM.router.go('trash');
      return;
    }
    const [path, params] = t.route(rec);
    CRM.router.go(path, params);
  }

  CRM.entities = {
    types,
    order: ['tasks', 'transactions', 'accounts', 'categories', 'recurring', 'goals', 'workouts', 'courses', 'foods'],
    open, freqLabel, catName, accName, accCurrency, txSignedAmount
  };
})(window.CRM);
