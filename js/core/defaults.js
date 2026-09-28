/* ==========================================================================
   defaults.js — довідники: статуси, типи, валюти, палітри, стартові категорії
   ========================================================================== */
window.CRM = window.CRM || {};

(function (CRM) {
  'use strict';

  const dict = {
    // Акцентні кольори інтерфейсу (значення — у css/base.css, тут — назви й колір для кружечків)
    accents: [
      { id: 'blue', name: 'Синій', color: '#2563eb' },
      { id: 'indigo', name: 'Індиго', color: '#4f46e5' },
      { id: 'violet', name: 'Фіолетовий', color: '#7c3aed' },
      { id: 'pink', name: 'Малиновий', color: '#be185d' },
      { id: 'red', name: 'Червоний', color: '#dc2626' },
      { id: 'orange', name: 'Помаранчевий', color: '#c2410c' },
      { id: 'amber', name: 'Бурштиновий', color: '#b45309' },
      { id: 'green', name: 'Зелений', color: '#15803d' },
      { id: 'teal', name: 'Бірюзовий', color: '#0f766e' },
      { id: 'graphite', name: 'Графітовий', color: '#334155' }
    ],

    taskStatuses: [
      { id: 'todo', label: 'Не розпочато' },
      { id: 'doing', label: 'В роботі' },
      { id: 'paused', label: 'На паузі' }
    ],
    priorities: [
      { id: 'high', label: 'Високий', weight: 3 },
      { id: 'medium', label: 'Середній', weight: 2 },
      { id: 'low', label: 'Низький', weight: 1 }
    ],

    currencies: ['UAH', 'USD', 'EUR'],
    txTypes: [
      { id: 'expense', label: 'Витрата' },
      { id: 'income', label: 'Дохід' },
      { id: 'transfer', label: 'Переказ' }
    ],
    accountTypes: [
      { id: 'bank', label: 'Банківський рахунок', icon: 'bank' },
      { id: 'cash', label: 'Готівка', icon: 'coins' },
      { id: 'savings', label: 'Ощадний рахунок', icon: 'piggy' },
      { id: 'investment', label: 'Інвестиційний', icon: 'arrows' },
      { id: 'ewallet', label: 'Електронний гаманець', icon: 'wallet' }
    ],

    /* Кольори категорій. Зберігаємо в категорії id кольору, а не hex —
       так діаграми беруть окремий відтінок для світлої й темної теми.
       Перші 8 — перевірена палітра, розрізнювана й при порушеннях кольорозору. */
    categoryColors: [
      { id: 'blue', name: 'Синій', light: '#2a78d6', dark: '#3987e5' },
      { id: 'orange', name: 'Помаранчевий', light: '#eb6834', dark: '#d95926' },
      { id: 'aqua', name: 'Морська хвиля', light: '#1baf7a', dark: '#199e70' },
      { id: 'yellow', name: 'Жовтий', light: '#eda100', dark: '#c98500' },
      { id: 'magenta', name: 'Рожевий', light: '#e87ba4', dark: '#d55181' },
      { id: 'green', name: 'Зелений', light: '#008300', dark: '#008300' },
      { id: 'violet', name: 'Фіолетовий', light: '#4a3aa7', dark: '#9085e9' },
      { id: 'red', name: 'Червоний', light: '#e34948', dark: '#e66767' },
      { id: 'teal', name: 'Бірюзовий', light: '#0e8fa3', dark: '#1ba3b8' },
      { id: 'brown', name: 'Коричневий', light: '#9a6334', dark: '#b27a48' },
      { id: 'olive', name: 'Оливковий', light: '#7a8a12', dark: '#94a52a' },
      { id: 'slate', name: 'Сірий', light: '#6b7280', dark: '#8b93a1' }
    ],

    // Стартовий набір категорій (створюється при першому запуску)
    defaultCategories: {
      expense: [
        { name: 'Продукти', color: 'green', subs: ['Супермаркет', 'Ринок'] },
        { name: 'Кафе й ресторани', color: 'orange', subs: ['Кава', 'Доставка їжі'] },
        { name: 'Транспорт', color: 'blue', subs: ['Громадський транспорт', 'Таксі', 'Пальне'] },
        { name: 'Житло й комунальні', color: 'violet', subs: ['Оренда', 'Комунальні послуги'] },
        { name: 'Звʼязок та інтернет', color: 'aqua', subs: ['Мобільний', 'Інтернет'] },
        { name: 'Здоровʼя', color: 'red', subs: ['Аптека', 'Лікарі'] },
        { name: 'Одяг і взуття', color: 'magenta', subs: [] },
        { name: 'Розваги', color: 'yellow', subs: ['Кіно', 'Концерти', 'Ігри'] },
        { name: 'Освіта', color: 'teal', subs: ['Курси', 'Книги'] },
        { name: 'Спорт', color: 'olive', subs: ['Абонемент', 'Спорядження'] },
        { name: 'Подарунки', color: 'brown', subs: [] },
        { name: 'Підписки', color: 'slate', subs: [] },
        { name: 'Інше', color: 'slate', subs: [] }
      ],
      income: [
        { name: 'Зарплата', color: 'green', subs: ['Аванс', 'Премія'] },
        { name: 'Стипендія', color: 'blue', subs: [] },
        { name: 'Фриланс', color: 'violet', subs: [] },
        { name: 'Подарунки', color: 'magenta', subs: [] },
        { name: 'Кешбек і відсотки', color: 'yellow', subs: [] },
        { name: 'Інше', color: 'slate', subs: [] }
      ]
    },

    goalCategories: ['Подорожі', 'Техніка', 'Подушка безпеки', 'Освіта', 'Житло', 'Авто', 'Здоровʼя', 'Подарунки', 'Інше'],
    goalStatuses: [
      { id: 'active', label: 'Поточні' },
      { id: 'achieved', label: 'Досягнуті' },
      { id: 'paused', label: 'Відкладені' }
    ],

    recurringUnits: [
      { id: 'day', label: 'день', every: 'Щодня' },
      { id: 'week', label: 'тиждень', every: 'Щотижня' },
      { id: 'month', label: 'місяць', every: 'Щомісяця' },
      { id: 'year', label: 'рік', every: 'Щороку' }
    ],

    workoutTypes: [
      { id: 'strength', label: 'Зал / силові' },
      { id: 'home', label: 'Вдома / власна вага' },
      { id: 'cardio', label: 'Біг / кардіо' },
      { id: 'other', label: 'Інше' }
    ],

    courseKinds: [
      { id: 'course', label: 'Курс' },
      { id: 'subject', label: 'Предмет' }
    ],
    courseStatuses: [
      { id: 'active', label: 'Активний' },
      { id: 'done', label: 'Завершений' },
      { id: 'paused', label: 'На паузі' }
    ]
  };

  /** Знайти запис довідника: CRM.dict.get('taskStatuses', 'todo') → { id, label } */
  dict.get = function (listName, id) {
    const list = dict[listName] || [];
    return list.find((x) => x.id === id) || null;
  };
  /** Підпис: CRM.dict.label('priorities', 'high') → 'Високий' */
  dict.label = function (listName, id) {
    const item = dict.get(listName, id);
    return item ? item.label : '';
  };
  /** Колір категорії з урахуванням поточної теми. */
  dict.categoryColor = function (colorId) {
    const c = dict.get('categoryColors', colorId) || dict.categoryColors[dict.categoryColors.length - 1];
    return document.documentElement.getAttribute('data-theme') === 'dark' ? c.dark : c.light;
  };

  CRM.dict = dict;
})(window.CRM);
