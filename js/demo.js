/* ==========================================================================
   demo.js — генератор демо-даних (приклади за 12 місяців).
   Потрібен, щоб перевірити діаграми, пошук, сповіщення й Кошик.
   Дати рахуються від сьогодні, тож демо завжди «свіже».
   ========================================================================== */
window.CRM = window.CRM || {};

(function (CRM) {
  'use strict';

  /** Передбачуваний генератор випадкових чисел (однакові демо щоразу). */
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  function generate() {
    const D = CRM.date;
    const uid = CRM.utils.uid;
    const rnd = mulberry32(20260926);
    const between = (min, max) => min + rnd() * (max - min);
    const money = (min, max) => Math.round(between(min, max) * 100) / 100;
    const pick = (arr) => arr[Math.floor(rnd() * arr.length)];
    const T = D.today();
    const tomorrow = D.addDays(T, 1);
    const iso = (date, time) => `${date}T${time || '09:00'}:00.000Z`;
    const nowIso = new Date().toISOString();
    const base = (o, date) => Object.assign({ createdAt: date ? iso(date) : nowIso, updatedAt: date ? iso(date) : nowIso, deletedAt: null }, o);

    // ---------- Категорії ----------
    const categories = [];
    const cat = { expense: {}, income: {} };
    ['expense', 'income'].forEach((kind) => {
      CRM.dict.defaultCategories[kind].forEach((c, i) => {
        const r = base({ id: uid(), kind, name: c.name, color: c.color, order: i, subcategories: c.subs.map((s) => ({ id: uid(), name: s })) });
        categories.push(r);
        cat[kind][c.name] = r;
      });
    });
    const C = (kind, name) => cat[kind][name].id;
    const S = (kind, name, subName) => {
      const s = cat[kind][name].subcategories.find((x) => x.name === subName);
      return s ? s.id : null;
    };

    // ---------- Рахунки ----------
    const start = D.addDays(D.addMonths(T, -12), 1);
    const acc = {
      main: base({ id: uid(), name: 'Основна картка', type: 'bank', currency: 'UAH', initialBalance: 15000, description: 'Картка для щоденних витрат' }, start),
      cash: base({ id: uid(), name: 'Готівка', type: 'cash', currency: 'UAH', initialBalance: 2000, description: '' }, start),
      usd: base({ id: uid(), name: 'Доларовий рахунок', type: 'bank', currency: 'USD', initialBalance: 600, description: 'Надходження з фрилансу' }, start),
      eur: base({ id: uid(), name: 'Електронний гаманець', type: 'ewallet', currency: 'EUR', initialBalance: 260, description: 'Оплата сервісів за кордоном' }, start),
      save: base({ id: uid(), name: 'Ощадний рахунок', type: 'savings', currency: 'UAH', initialBalance: 25000, description: 'Щомісячні відкладення' }, start),
      usdSave: base({ id: uid(), name: 'Валютна скарбничка', type: 'savings', currency: 'USD', initialBalance: 1200, description: '' }, start),
      inv: base({ id: uid(), name: 'Інвестиційний рахунок', type: 'investment', currency: 'USD', initialBalance: 1500, description: 'Облігації' }, start)
    };
    const accounts = Object.values(acc);

    // ---------- Транзакції ----------
    const transactions = [];
    function addTx(o) {
      const r = base(Object.assign({
        id: uid(), type: 'expense', comment: '', categoryId: null, subcategoryId: null,
        toAccountId: null, toAmount: null, recurringId: null, recurringDate: null
      }, o), o.date);
      transactions.push(r);
      return r;
    }
    const exp = (date, amount, catName, subName, comment, accountId) => addTx({
      type: 'expense', date, amount, accountId: accountId || acc.main.id,
      categoryId: C('expense', catName), subcategoryId: subName ? S('expense', catName, subName) : null, comment: comment || ''
    });
    const inc = (date, amount, catName, comment, accountId) => addTx({
      type: 'income', date, amount, accountId: accountId || acc.main.id, categoryId: C('income', catName), comment: comment || ''
    });
    const transfer = (date, fromId, toId, amount, toAmount, comment) => addTx({
      type: 'transfer', date, accountId: fromId, toAccountId: toId, amount, toAmount: toAmount == null ? amount : toAmount, comment: comment || ''
    });

    const shops = ['Сільпо', 'АТБ', 'Novus', 'Ринок', 'Фора'];
    const cafes = ['Кава з собою', 'Обід з друзями', 'Піца', 'Сніданок', 'Доставка суші'];
    let lastFreelance = -30;
    let i = 0;
    for (let day = start; day <= T; day = D.addDays(day, 1), i++) {
      const dom = D.parse(day).d;
      const month = D.parse(day).m;
      const wd = D.weekday(day);

      if ([1, 4, 6].includes(wd)) {
        const fromCash = rnd() < 0.15;
        exp(day, money(280, 1350), 'Продукти', rnd() < 0.8 ? 'Супермаркет' : 'Ринок', pick(shops), fromCash ? acc.cash.id : null);
      }
      if (rnd() < 0.26) exp(day, money(85, 640), 'Кафе й ресторани', rnd() < 0.6 ? 'Кава' : 'Доставка їжі', pick(cafes));
      if (wd < 5 && rnd() < 0.55) exp(day, pick([15, 15, 30, 45]), 'Транспорт', 'Громадський транспорт', '', rnd() < 0.5 ? acc.cash.id : null);
      if (rnd() < 0.07) exp(day, money(120, 360), 'Транспорт', 'Таксі', 'Таксі');
      if (rnd() < 0.035) exp(day, money(150, 1600), 'Здоровʼя', 'Аптека', 'Аптека');
      if (rnd() < 0.02) exp(day, money(700, 3600), 'Одяг і взуття', null, pick(['Кросівки', 'Куртка', 'Светр', 'Джинси']));
      if (wd >= 4 && rnd() < 0.28) exp(day, money(150, 900), 'Розваги', pick(['Кіно', 'Концерти', 'Ігри']), '');
      if (dom === 15 && rnd() < 0.45) exp(day, money(300, 1800), 'Освіта', pick(['Книги', 'Курси']), pick(['Книга', 'Онлайн-курс', 'Підручник']));
      if (rnd() < 0.012) exp(day, money(300, 1500), 'Подарунки', null, 'Подарунок');
      if (dom === 10) {
        const winter = [11, 12, 1, 2, 3].includes(month);
        exp(day, money(winter ? 2400 : 1100, winter ? 3600 : 1900), 'Житло й комунальні', 'Комунальні послуги', 'Комуналка');
      }
      if (dom === 12) exp(day, 250, 'Звʼязок та інтернет', 'Мобільний', 'Мобільний звʼязок');
      if (dom === 20) exp(day, 9.99, 'Підписки', null, 'Хмарне сховище', acc.eur.id);
      if (dom === 1 && i > 0) inc(day, money(80, 320), 'Кешбек і відсотки', 'Кешбек за місяць');
      if (i - lastFreelance > 40 && rnd() < 0.08) {
        inc(day, Math.round(between(250, 650)), 'Фриланс', pick(['Дизайн банера', 'Переклад', 'Консультація']), acc.usd.id);
        lastFreelance = i;
      }
      if (dom === 3) transfer(day, acc.main.id, acc.cash.id, 1500, null, 'Зняття готівки');
      if (dom === 6) transfer(day, acc.main.id, acc.save.id, 4000, null, 'Відкладаю на ощадний');
      if (dom === 8 && month % 2 === 0) transfer(day, acc.usd.id, acc.usdSave.id, 100, null, '');
      if (dom === 22 && month % 3 === 0) transfer(day, acc.usd.id, acc.inv.id, 150, null, 'Купівля облігацій');
    }
    // Обмін валюти (переказ між рахунками в різних валютах)
    const exchangeDay = D.addMonths(T, -5);
    transfer(exchangeDay, acc.main.id, acc.usd.id, 8450, 200, 'Купівля доларів');

    // ---------- Регулярні платежі (минулі — вже сплачені) ----------
    const recurring = [];
    function addRecurring(o) {
      const r = base(Object.assign({
        id: uid(), kind: 'expense', freq: { unit: 'month', every: 1 }, count: null, currency: 'UAH', paid: {},
        lastAccountId: acc.main.id, lastCategoryId: null, lastSubcategoryId: null
      }, o), o.startDate < start ? start : o.startDate);
      // Минулі дати (до вчора включно) позначаємо сплаченими
      let occ = r.startDate;
      let n = 0;
      const anchor = D.parse(r.startDate).d;
      while (occ < T && (r.count == null || n < r.count)) {
        if (occ >= start) {
          const tx = addTx({
            type: r.kind, date: occ, amount: r.amount, accountId: r.lastAccountId,
            categoryId: r.lastCategoryId, subcategoryId: r.lastSubcategoryId, comment: r.name,
            recurringId: r.id, recurringDate: occ
          });
          r.paid[occ] = tx.id;
        }
        n++;
        occ = r.freq.unit === 'year' ? D.addYears(r.startDate, n, anchor) : D.addMonths(r.startDate, n * r.freq.every, anchor);
      }
      recurring.push(r);
      return r;
    }
    const firstOn = (day) => D.make(D.parse(start).y, D.parse(start).m, day) < start
      ? D.addMonths(D.make(D.parse(start).y, D.parse(start).m, day), 1)
      : D.make(D.parse(start).y, D.parse(start).m, day);

    addRecurring({ name: 'Зарплата', kind: 'income', amount: 42000, startDate: firstOn(5), lastCategoryId: C('income', 'Зарплата') });
    addRecurring({ name: 'Оренда квартири', amount: 12000, startDate: firstOn(1), lastCategoryId: C('expense', 'Житло й комунальні'), lastSubcategoryId: S('expense', 'Житло й комунальні', 'Оренда') });
    addRecurring({ name: 'Домашній інтернет', amount: 300, startDate: firstOn(14), lastCategoryId: C('expense', 'Звʼязок та інтернет'), lastSubcategoryId: S('expense', 'Звʼязок та інтернет', 'Інтернет') });
    addRecurring({ name: 'Абонемент у спортзал', amount: 950, startDate: firstOn(18), lastCategoryId: C('expense', 'Спорт'), lastSubcategoryId: S('expense', 'Спорт', 'Абонемент') });
    const music = addRecurring({ name: 'Музичний сервіс', amount: 149, startDate: D.addMonths(tomorrow, -8), lastCategoryId: C('expense', 'Підписки') });
    addRecurring({ name: 'Річна підписка на хмару', amount: 1199, freq: { unit: 'year', every: 1 }, startDate: D.addYears(D.addDays(T, 40), -1), lastCategoryId: C('expense', 'Підписки') });

    // ---------- Фінансові цілі ----------
    const goals = [
      base({ id: uid(), name: 'Новий ноутбук', currency: 'USD', target: 1200, saved: 720, deadline: D.addMonths(T, 5), category: 'Техніка', status: 'active', achievedAt: null,
        history: [{ date: D.addMonths(T, -3), amount: 300 }, { date: D.addMonths(T, -2), amount: 220 }, { date: D.addMonths(T, -1), amount: 200 }] }),
      base({ id: uid(), name: 'Подушка безпеки', currency: 'UAH', target: 120000, saved: 54000, deadline: D.addMonths(T, 10), category: 'Подушка безпеки', status: 'active', achievedAt: null,
        history: [{ date: D.addMonths(T, -6), amount: 30000 }, { date: D.addMonths(T, -2), amount: 24000 }] }),
      base({ id: uid(), name: 'Поїздка в Карпати', currency: 'UAH', target: 15000, saved: 15000, deadline: D.addMonths(T, -1), category: 'Подорожі', status: 'achieved', achievedAt: iso(D.addMonths(T, -2)),
        history: [{ date: D.addMonths(T, -4), amount: 8000 }, { date: D.addMonths(T, -2), amount: 7000 }] }),
      base({ id: uid(), name: 'Фотокамера', currency: 'EUR', target: 900, saved: 150, deadline: null, category: 'Техніка', status: 'paused', achievedAt: null,
        history: [{ date: D.addMonths(T, -5), amount: 150 }] })
    ];

    // ---------- Задачі ----------
    const cl = (items) => items.map(([text, done]) => ({ id: uid(), text, done: !!done }));
    const task = (o) => base(Object.assign({
      id: uid(), description: '', status: 'todo', priority: 'medium', deadline: null, deadlineTime: null,
      checklist: [], done: false, completedAt: null
    }, o));
    const tasks = [
      task({ title: 'Підготувати презентацію до семінару', priority: 'high', status: 'doing', deadline: T, deadlineTime: '16:00',
        description: 'Слайди з основними висновками й 2–3 прикладами. Тривалість виступу — 10 хвилин.',
        checklist: cl([['Зібрати джерела', true], ['Скласти план слайдів', false], ['Відрепетирувати виступ', false]]) }),
      task({ title: 'Оплатити комунальні послуги', priority: 'medium', deadline: tomorrow }),
      task({ title: 'Записатися до стоматолога', priority: 'low', deadline: D.addDays(T, -2) }),
      task({ title: 'Оновити резюме', priority: 'medium', status: 'doing', deadline: D.addDays(T, 10),
        checklist: cl([['Додати останній досвід', true], ['Оновити навички', false], ['Попросити відгук у друга', false]]) }),
      task({ title: 'Скласти план тренувань на місяць', priority: 'medium', deadline: D.addDays(T, 3) }),
      task({ title: 'Купити подарунок другові', priority: 'medium', deadline: D.addDays(T, 7), description: 'Ідеї: книга, настільна гра, квитки на концерт.' }),
      task({ title: 'Прочитати статтю про формування звичок', priority: 'low', status: 'paused', deadline: D.addDays(T, 5) }),
      task({ title: 'Розібрати пошту', priority: 'low' }),
      task({ title: 'Здати звіт з практики', priority: 'high', done: true, completedAt: iso(D.addDays(T, -3), '15:20'), deadline: D.addDays(T, -3) }),
      task({ title: 'Продовжити абонемент у спортзал', priority: 'medium', done: true, completedAt: iso(D.addDays(T, -8), '10:05') }),
      task({ title: 'Замовити книги на семестр', priority: 'low', done: true, completedAt: iso(D.addDays(T, -15), '19:40'),
        checklist: cl([['Скласти список', true], ['Порівняти ціни', true], ['Оформити замовлення', true]]) })
    ];

    // ---------- Тренування (8 тижнів) ----------
    const workouts = [];
    const weekStart = D.startOfWeek(T);
    for (let w = 7; w >= 0; w--) {
      const mon = D.addDays(weekStart, -7 * w);
      const days = [
        { day: mon, type: 'strength' },
        { day: D.addDays(mon, 2), type: 'cardio' },
        { day: D.addDays(mon, 5), type: 'home' }
      ];
      days.forEach(({ day, type }) => {
        if (day > T) return;
        const prog = 7 - w; // поступовий прогрес
        let o;
        if (type === 'strength') {
          o = { durationMin: 60 + Math.round(between(-5, 10)), exercises: [
            { name: 'Присідання зі штангою', sets: Array.from({ length: 4 }, () => ({ reps: 8, weight: 60 + prog * 2.5 })) },
            { name: 'Жим лежачи', sets: Array.from({ length: 4 }, () => ({ reps: 8, weight: 50 + prog * 2.5 })) },
            { name: 'Тяга верхнього блоку', sets: Array.from({ length: 3 }, () => ({ reps: 10, weight: 45 })) }
          ] };
        } else if (type === 'cardio') {
          const km = Math.round(between(4, 8) * 10) / 10;
          o = { distanceKm: km, durationMin: Math.round(km * between(5.4, 6.3)), exercises: [], note: rnd() < 0.3 ? 'Легкий темп, парк' : '' };
        } else {
          o = { durationMin: 35 + Math.round(between(0, 10)), exercises: [
            { name: 'Віджимання', sets: Array.from({ length: 4 }, () => ({ reps: 15 + prog, weight: null })) },
            { name: 'Підтягування', sets: Array.from({ length: 4 }, () => ({ reps: 6 + Math.floor(prog / 2), weight: null })) },
            { name: 'Випади', sets: Array.from({ length: 3 }, () => ({ reps: 12, weight: null })) }
          ] };
        }
        workouts.push(base(Object.assign({ id: uid(), date: day, type, title: '', distanceKm: null, note: '' }, o), day));
      });
    }

    // ---------- Навчання ----------
    const topics = (list) => list.map(([title, done, deadline]) => ({ id: uid(), title, done: !!done, deadline: deadline || null }));
    const courses = [
      base({ id: uid(), title: 'Англійська B2', kind: 'course', status: 'active', link: 'https://example.com', deadline: D.addDays(T, 90),
        notes: 'Заняття щовівторка й щочетверга. Повторювати слова в застосунку щодня.',
        topics: topics([
          ['Present Perfect і Past Simple', true], ['Умовні речення', true], ['Пасивний стан', true], ['Фразові дієслова', true],
          ['Непряма мова', false], ['Модальні дієслова', false], ['Лексика: робота', false], ['Лексика: подорожі', false],
          ['Есе: аргументація', false, tomorrow], ['Пробний тест', false, D.addDays(T, 30)]
        ]) }),
      base({ id: uid(), title: 'Статистика для початківців', kind: 'course', status: 'active', link: '', deadline: D.addDays(T, 45),
        notes: 'Практику робити в Excel або Google Таблицях.',
        topics: topics([
          ['Описова статистика', true], ['Нормальний розподіл', true], ['t-критерій', false, D.addDays(T, 2)],
          ['Кореляція', false], ['Регресія', false], ['Підсумковий проєкт', false, D.addDays(T, 40)]
        ]) }),
      base({ id: uid(), title: 'Академічне письмо', kind: 'subject', status: 'done', link: '', deadline: D.addDays(T, -20),
        notes: '', topics: topics([['Структура тексту', true], ['Цитування', true], ['Анотація', true], ['Рецензія', true], ['Підсумкова робота', true]]) })
    ];

    // ---------- Сповіщення ----------
    const notifications = [
      base({ id: uid(), key: `task:due-today:${tasks[0].id}:${T}`, kind: 'task', title: 'Дедлайн сьогодні', text: tasks[0].title,
        target: { store: 'tasks', id: tasks[0].id }, read: false, dismissed: false, at: new Date(Date.now() - 25 * 60000).toISOString() }),
      base({ id: uid(), key: `task:overdue:${tasks[2].id}:${tasks[2].deadline}`, kind: 'task', title: 'Задачу прострочено', text: `${tasks[2].title} — дедлайн був ${CRM.fmt.dateShort(tasks[2].deadline)}`,
        target: { store: 'tasks', id: tasks[2].id }, read: false, dismissed: false, at: new Date(Date.now() - 24 * 60000).toISOString() }),
      base({ id: uid(), key: `payment:tomorrow:${music.id}:${tomorrow}`, kind: 'payment', title: 'Завтра платіж',
        text: `${music.name} — ${CRM.fmt.money(music.amount, music.currency)}`,
        target: { store: 'recurring', id: music.id }, read: false, dismissed: false, at: new Date(Date.now() - 23 * 60000).toISOString() }),
      base({ id: uid(), key: `goal:achieved:${goals[2].id}`, kind: 'goal', title: 'Ціль досягнуто', text: goals[2].name,
        target: { store: 'goals', id: goals[2].id }, read: true, dismissed: false, at: goals[2].achievedAt })
    ];

    // ---------- Кошик (кілька видалених записів) ----------
    const trashed = (rec, daysAgo) => Object.assign(rec, {
      deletedAt: new Date(Date.now() - daysAgo * 86400000).toISOString(), deleteBatch: uid(), deleteHead: true
    });
    tasks.push(trashed(task({ title: 'Скасована зустріч з куратором', priority: 'low', deadline: D.addDays(T, -6) }), 5));
    transactions.push(trashed(base({
      id: uid(), type: 'expense', date: D.addDays(T, -2), amount: 1250, accountId: acc.main.id, categoryId: C('expense', 'Інше'),
      subcategoryId: null, comment: 'Помилковий запис', toAccountId: null, toAmount: null, recurringId: null, recurringDate: null
    }), 2));
    goals.push(trashed(base({ id: uid(), name: 'Електросамокат', currency: 'UAH', target: 18000, saved: 2000, deadline: null, category: 'Інше', status: 'active', achievedAt: null, history: [] }), 28));

    return { categories, accounts, transactions, recurring, goals, tasks, workouts, courses, notifications };
  }

  CRM.demo = { generate };
})(window.CRM);
