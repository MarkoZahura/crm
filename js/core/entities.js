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
  /** Частини операції (розділена — кілька категорій). entities.js вантажиться раніше за finance.js — тому без нього. */
  function txPartsOf(r) {
    if (r.type !== 'transfer' && Array.isArray(r.splits) && r.splits.length > 1) return r.splits;
    return [{ categoryId: r.categoryId, subcategoryId: r.subcategoryId }];
  }
  /** «Продукти» або «Продукти + Побут» для розділеної. */
  function txCats(r) {
    const names = [];
    txPartsOf(r).forEach((p) => { const n = catName(p.categoryId); if (n && !names.includes(n)) names.push(n); });
    return names.join(' + ');
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
      text: (r) => [r.title, r.description, (r.checklist || []).map((c) => c.text).join(' '), (Array.isArray(r.labels) ? r.labels : []).map((l) => l + ' #' + l).join(' ')],
      route: (r) => ['tasks', { tab: r.done ? 'archive' : null, open: r.id }]
    },
    events: {
      label: 'Подія', group: 'Події календаря', icon: 'calendar', iconClass: 'ico-event', section: 'calendar',
      title: (r) => r.title || 'Без назви',
      sub: (r) => {
        const C = CRM.calendar;
        const rep = C && C.repeatText ? C.repeatText(r) : '';
        return [rep || fmt().date(r.date), C ? C.whenText(r) : null, C ? C.categoryName(r.cat) : null].filter(Boolean).join(' · ');
      },
      text: (r) => [r.title, r.note],
      // Повторювана подія — найближчий повтор
      route: (r) => {
        const C = CRM.calendar;
        const n = C && C.isSeries && C.isSeries(r) ? C.nextOccurrence(r, CRM.date.today()) : null;
        return ['calendar', { view: 'day', date: n ? n.date : r.date, open: r.id, occ: n ? n.occ : null }];
      }
    },
    transactions: {
      label: 'Транзакція', group: 'Транзакції', icon: 'receipt', iconClass: 'ico-payment', section: 'budget',
      title: (r) => {
        if (r.comment) return r.comment;
        if (r.type === 'transfer') return `Переказ: ${accName(r.accountId)} → ${accName(r.toAccountId)}`;
        return txCats(r) || CRM.dict.label('txTypes', r.type);
      },
      sub: (r) => [fmt().date(r.date), txSignedAmount(r), txCats(r) || null, accName(r.accountId)].filter(Boolean).join(' · '),
      // Розділена операція шукається за кожною своєю категорією
      text: (r) => [r.comment, accName(r.accountId)].concat(...txPartsOf(r).map((p) => [catName(p.categoryId), subName(p.categoryId, p.subcategoryId)])),
      amounts: (r) => [r.amount, r.toAmount].filter((x) => typeof x === 'number'),
      route: (r) => ['budget/transactions', { open: r.id }],
      // Від чого залежить запис: якщо рахунок чи категорія теж у Кошику — запропонуємо відновити разом
      deps: (r) => [
        { store: 'accounts', id: r.accountId }, { store: 'accounts', id: r.toAccountId }
      ].concat(txPartsOf(r).map((p) => ({ store: 'categories', id: p.categoryId })))
        .filter((x, i, arr) => x.id && arr.findIndex((y) => y.store === x.store && y.id === x.id) === i)
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
      sub: (r) => [fmt().date(r.date), r.durationMin ? (CRM.training && CRM.training.durationText ? CRM.training.durationText(r.durationMin) : Math.round(r.durationMin) + ' хв') : null, r.distanceKm ? fmt().number(r.distanceKm, 1).replace(/,0$/, '') + ' км' : null].filter(Boolean).join(' · '),
      text: (r) => [r.title, CRM.dict.label('workoutTypes', r.type), (r.exercises || []).map((e) => e.name).join(' '), r.note],
      route: (r) => ['training', { open: r.id }]
    },
    programs: {
      label: 'Програма тренувань', group: 'Програми тренувань', icon: 'dumbbell', iconClass: 'ico-danger', section: 'training',
      title: (r) => r.title || 'Програма тренувань',
      sub: (r) => [r.kind === 'running' ? 'Біг' : 'Сила', r.durationWeeks ? fmt().count(r.durationWeeks, ['тиждень', 'тижні', 'тижнів']) : null,
        CRM.programs && !r.deletedAt ? CRM.programs.statusText(r) : null].filter(Boolean).join(' · '),
      text: (r) => {
        const plan = r.plan || {};
        return [r.title, (plan.rules || []).join(' '), (plan.exercises || []).map((e) => e.name).join(' ')];
      },
      route: (r) => ['training/program/' + r.id, null]
    },
    courses: {
      label: 'Навчання', group: 'Навчання', icon: 'graduation', iconClass: 'ico-learning', section: 'learning',
      title: (r) => r.title,
      sub: (r) => {
        const topics = r.topics || [];
        const done = topics.filter((t) => t.done).length;
        return [CRM.dict.label('courseKinds', r.kind), topics.length ? `${done}/${topics.length} тем` : null].filter(Boolean).join(' · ');
      },
      text: (r) => [r.title, r.notes, (r.topics || []).map(topicText).join(' ')],
      // Слова знайшлися в темі (назва, нотатки, посилання), а не в самому курсі — відкрити саме цю тему
      hit: (r, terms) => {
        const N = CRM.utils.normalize;
        const base = N([r.title, r.notes].filter(Boolean).join(' '));
        if (terms.every((x) => base.includes(x))) return null;
        const t = (r.topics || []).find((tp) => {
          const s = N([r.title, topicText(tp)].join(' '));
          return terms.every((x) => s.includes(x));
        });
        return t ? { topic: t.id, sub: `Тема «${t.title}»` } : null;
      },
      route: (r, hit) => ['learning', hit && hit.topic ? { open: r.id, topic: hit.topic } : { open: r.id }]
    },
    people: {
      label: 'Людина', group: 'Люди', icon: 'users', iconClass: 'ico-goal', section: 'people',
      title: (r) => r.name || 'Без імені',
      sub: (r) => {
        const P = CRM.people;
        const parts = [P ? P.groupOf(r.group).label : null];
        if (r.bday && P) parts.push('ДН ' + P.mdText(r.bday, r.bdayYear));
        if (r.phone) parts.push(r.phone);
        return parts.filter(Boolean).join(' · ');
      },
      text: (r) => [r.name, r.phone, r.telegram, r.instagram, r.email, r.notes, (r.gifts || []).map((g) => g.text).join(' '), (r.dates || []).map((d) => d.title).join(' ')],
      route: (r) => ['people', { open: r.id }]
    },
    habits: {
      label: 'Звичка', group: 'Звички', icon: 'habits', iconClass: 'ico-goal', section: 'habits',
      title: (r) => r.name || 'Звичка',
      sub: (r) => {
        const H = CRM.habits;
        if (!H) return '';
        const n = r.deletedAt ? 0 : H.streak(r);
        return [H.scheduleText(r), H.goalText(r), r.archived ? 'в архіві' : n ? 'серія: ' + H.streakText(r, n) : null].filter(Boolean).join(' · ');
      },
      text: (r) => [r.name, r.unit, r.note],
      route: (r) => ['habits/' + r.id, null]
    },
    books: {
      label: 'Книга', group: 'Книги', icon: 'library', iconClass: 'ico-learning', section: 'books',
      title: (r) => r.title || 'Книга',
      sub: (r) => (CRM.books ? CRM.books.subText(r) : r.author || ''),
      text: (r) => [r.title, r.author, r.notes, (Array.isArray(r.quotes) ? r.quotes : []).map((q) => q && q.text).join(' ')],
      // Слова знайшлися в цитаті, а не в назві чи нотатках — відкрити книгу з цією цитатою
      hit: (r, terms) => {
        const N = CRM.utils.normalize;
        const base = N([r.title, r.author, r.notes].filter(Boolean).join(' '));
        if (terms.every((x) => base.includes(x))) return null;
        const q = (Array.isArray(r.quotes) ? r.quotes : []).find((x) => x && x.text && terms.every((t) => N([r.title, r.author, x.text].join(' ')).includes(t)));
        if (!q) return null;
        const t = q.text.length > 60 ? q.text.slice(0, 58) + '…' : q.text;
        return { quote: q.id, sub: `Цитата «${t}»${q.page ? ', с. ' + q.page : ''}` };
      },
      route: (r, hit) => ['books/' + r.id, hit && hit.quote ? { quote: hit.quote } : null]
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

  /** Текст теми курсу для пошуку: назва, нотатки, назви й адреси посилань. */
  function topicText(t) {
    return [t.title, t.notes, (Array.isArray(t.links) ? t.links : []).map((l) => [l && l.title, l && l.url].filter(Boolean).join(' ')).join(' ')]
      .filter(Boolean).join(' ');
  }

  /** Відкрити запис: перехід до розділу з параметром open (hit — що саме знайшов пошук, якщо тип це вміє). */
  function open(store, id, hit) {
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
    const [path, params] = t.route(rec, hit || null);
    CRM.router.go(path, params);
  }

  CRM.entities = {
    types,
    order: ['tasks', 'events', 'people', 'habits', 'transactions', 'accounts', 'categories', 'recurring', 'goals', 'workouts', 'programs', 'courses', 'books', 'foods'],
    open, freqLabel, catName, accName, accCurrency, txSignedAmount
  };
})(window.CRM);
