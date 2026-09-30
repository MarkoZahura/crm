/* ==========================================================================
   nutrition.js — розділ «Харчування».
   • Щоденник: що з'їдено за день (сніданок, обід, вечеря, перекус),
     калорії й БЖВ проти денної норми, калорії за 7 днів.
   • Норма: калькулятор калорій і БЖВ (формула Міффліна — Сан Жеора,
     активність, мета). Вік, зріст і вага — спільні з «Моїми параметрами»
     тренувань; усе це зберігається лише в даних браузера, не в коді.
   • Продукти: вбудований довідник (значення на 100 г) + свої продукти
     й страви (страву можна порахувати з інгредієнтів).
   Дані: сховища foods (свої продукти) і meals (записи щоденника);
   налаштування nutritionProfile і nutritionTarget.
   ========================================================================== */
window.CRM = window.CRM || {};

(function (CRM) {
  'use strict';

  const { h, ui } = { h: CRM.ui.h, ui: CRM.ui };
  const D = CRM.date;
  const fmt = CRM.fmt;
  const U = CRM.utils;

  const PROFILE = 'nutritionProfile';
  const TARGET = 'nutritionTarget';
  const MEALS = CRM.dict.mealTypes;
  const CATS = CRM.dict.foodCategories;

  // ---------- Вбудований довідник ----------
  // [код, назва, категорія, ккал, білки, жири, вуглеводи (на 100 г), порція [назва, грамів]?]
  // Орієнтовні середні значення (за таблицями USDA FoodData Central і типовими етикетками).
  const BUILTIN_RAW = [
    ['buckwheat', 'Гречка (суха)', 'grains', 343, 13.3, 3.4, 71.5],
    ['buckwheat-cooked', 'Гречка варена', 'grains', 92, 3.4, 0.6, 19.9],
    ['rice', 'Рис білий (сухий)', 'grains', 365, 7.1, 0.7, 80],
    ['rice-cooked', 'Рис білий варений', 'grains', 130, 2.7, 0.3, 28.2],
    ['rice-brown-cooked', 'Рис бурий варений', 'grains', 123, 2.7, 1, 25.6],
    ['oats', 'Вівсяні пластівці (сухі)', 'grains', 379, 13.2, 6.5, 67.7],
    ['oatmeal', 'Вівсянка на воді', 'grains', 71, 2.5, 1.5, 12],
    ['pasta', 'Макарони (сухі)', 'grains', 371, 13, 1.5, 74.7],
    ['pasta-cooked', 'Макарони варені', 'grains', 158, 5.8, 0.9, 30.9],
    ['bulgur-cooked', 'Булгур варений', 'grains', 83, 3.1, 0.2, 18.6],
    ['quinoa-cooked', 'Кіноа варена', 'grains', 120, 4.4, 1.9, 21.3],
    ['millet', 'Пшоно (сухе)', 'grains', 378, 11, 4.2, 72.8],
    ['flour', 'Борошно пшеничне', 'grains', 364, 10.3, 1, 76.3],
    ['potato', 'Картопля сира', 'grains', 77, 2, 0.1, 17.5],
    ['potato-boiled', 'Картопля варена', 'grains', 87, 1.9, 0.1, 20.1],
    ['potato-mash', 'Картопляне пюре (з молоком і маслом)', 'grains', 113, 1.9, 4.2, 16.8],
    ['bread-white', 'Хліб пшеничний', 'grains', 266, 8.9, 3.3, 49, ['скибка', 30]],
    ['bread-rye', 'Хліб житній', 'grains', 259, 8.5, 3.3, 48.3, ['скибка', 30]],
    ['bread-wholegrain', 'Хліб цільнозерновий', 'grains', 252, 12.4, 3.5, 42.7, ['скибка', 30]],
    ['lavash', 'Лаваш / піта', 'grains', 275, 9.1, 1.2, 55.7],
    ['crispbread', 'Хлібці житні', 'grains', 366, 7.9, 1.3, 82.2, ['шт', 10]],

    ['chicken-breast', 'Куряче філе (сире)', 'meat', 120, 22.5, 2.6, 0],
    ['chicken-breast-cooked', 'Куряче філе варене / запечене', 'meat', 165, 31, 3.6, 0],
    ['chicken-thigh', 'Куряче стегно без шкіри (сире)', 'meat', 121, 19.7, 4.1, 0],
    ['turkey-breast', 'Філе індички (сире)', 'meat', 114, 23.7, 1.5, 0],
    ['beef-lean', 'Яловичина пісна (сира)', 'meat', 150, 21, 7, 0],
    ['beef-mince', 'Фарш яловичий 15% (сирий)', 'meat', 215, 18.6, 15, 0],
    ['pork-lean', 'Свинина пісна, вирізка (сира)', 'meat', 109, 21, 2.2, 0],
    ['salmon', 'Лосось (сирий)', 'meat', 208, 20.4, 13.4, 0],
    ['hake', 'Хек (сирий)', 'meat', 86, 16.6, 2.2, 0],
    ['pollock', 'Минтай (сирий)', 'meat', 72, 15.9, 0.9, 0],
    ['tuna-can', 'Тунець консервований у власному соку', 'meat', 116, 25.5, 0.8, 0],
    ['herring', 'Оселедець солоний', 'meat', 217, 19.8, 15.4, 0],
    ['shrimp', 'Креветки варені', 'meat', 99, 24, 0.3, 0.2],
    ['sausage-boiled', 'Ковбаса варена (докторська)', 'meat', 257, 12.8, 22.2, 1.5],
    ['frankfurters', 'Сосиски', 'meat', 266, 11, 23.9, 1.6, ['шт', 50]],
    ['ham', 'Шинка (нарізка)', 'meat', 163, 16.6, 8.6, 3.8],
    ['salo', 'Сало', 'meat', 797, 2.4, 89, 0],

    ['egg', 'Яйце куряче', 'dairy', 143, 12.6, 9.5, 0.7, ['шт', 55]],
    ['egg-white', 'Яєчний білок', 'dairy', 52, 10.9, 0.2, 0.7, ['шт', 33]],
    ['milk-25', 'Молоко 2,5%', 'dairy', 52, 2.8, 2.5, 4.7, ['склянка', 250]],
    ['milk-32', 'Молоко 3,2%', 'dairy', 59, 2.9, 3.2, 4.7, ['склянка', 250]],
    ['kefir-1', 'Кефір 1%', 'dairy', 40, 2.8, 1, 4, ['склянка', 250]],
    ['kefir-25', 'Кефір 2,5%', 'dairy', 51, 2.8, 2.5, 4, ['склянка', 250]],
    ['yogurt-greek', 'Йогурт грецький 2%', 'dairy', 73, 10, 1.9, 3.9],
    ['yogurt-natural', 'Йогурт натуральний 2,5%', 'dairy', 60, 4.3, 2.5, 5],
    ['cottage-0', 'Кисломолочний сир знежирений', 'dairy', 86, 18, 0.6, 1.8],
    ['cottage-5', 'Кисломолочний сир 5%', 'dairy', 121, 17.2, 5, 1.8],
    ['cottage-9', 'Кисломолочний сир 9%', 'dairy', 159, 16.7, 9, 2],
    ['cheese-hard', 'Сир твердий (гауда)', 'dairy', 356, 24.9, 27.4, 2.2],
    ['mozzarella', 'Моцарела', 'dairy', 299, 22.2, 22.4, 2.2],
    ['feta', 'Бринза / фета', 'dairy', 264, 14.2, 21.3, 4.1],
    ['sour-cream-15', 'Сметана 15%', 'dairy', 158, 2.6, 15, 3, ['ст. л.', 20]],
    ['butter', 'Масло вершкове 82%', 'dairy', 748, 0.5, 82.5, 0.8],
    ['whey', 'Протеїн сироватковий (порошок, у середньому)', 'dairy', 400, 78, 6, 8, ['мірна ложка', 30]],

    ['cucumber', 'Огірок', 'veg', 15, 0.7, 0.1, 3.6, ['шт', 120]],
    ['tomato', 'Помідор', 'veg', 18, 0.9, 0.2, 3.9, ['шт', 120]],
    ['cabbage', 'Капуста білокачанна', 'veg', 25, 1.3, 0.1, 5.8],
    ['carrot', 'Морква', 'veg', 41, 0.9, 0.2, 9.6, ['шт', 80]],
    ['onion', 'Цибуля ріпчаста', 'veg', 40, 1.1, 0.1, 9.3, ['шт', 90]],
    ['bell-pepper', 'Перець болгарський', 'veg', 27, 1, 0.3, 6, ['шт', 150]],
    ['broccoli', 'Броколі', 'veg', 34, 2.8, 0.4, 6.6],
    ['beet-boiled', 'Буряк варений', 'veg', 44, 1.7, 0.2, 10],
    ['zucchini', 'Кабачок', 'veg', 17, 1.2, 0.3, 3.1],
    ['lettuce', 'Салат листовий', 'veg', 15, 1.4, 0.2, 2.9],
    ['spinach', 'Шпинат', 'veg', 23, 2.9, 0.4, 3.6],
    ['mushrooms', 'Печериці', 'veg', 22, 3.1, 0.3, 3.3],
    ['avocado', 'Авокадо', 'veg', 160, 2, 14.7, 8.5, ['шт', 140]],
    ['beans-cooked', 'Квасоля варена', 'veg', 127, 8.7, 0.5, 22.8],
    ['lentils-cooked', 'Сочевиця варена', 'veg', 116, 9, 0.4, 20.1],
    ['chickpeas-cooked', 'Нут варений', 'veg', 164, 8.9, 2.6, 27.4],
    ['peas-can', 'Горошок зелений консервований', 'veg', 69, 4.4, 0.4, 12.6],
    ['hummus', 'Хумус', 'veg', 166, 7.9, 9.6, 14.3],

    ['apple', 'Яблуко', 'fruit', 52, 0.3, 0.2, 13.8, ['шт', 180]],
    ['banana', 'Банан', 'fruit', 89, 1.1, 0.3, 22.8, ['шт', 120]],
    ['orange', 'Апельсин', 'fruit', 47, 0.9, 0.1, 11.8, ['шт', 150]],
    ['pear', 'Груша', 'fruit', 57, 0.4, 0.1, 15.2, ['шт', 170]],
    ['tangerine', 'Мандарин', 'fruit', 53, 0.8, 0.3, 13.3, ['шт', 75]],
    ['grapes', 'Виноград', 'fruit', 69, 0.7, 0.2, 18.1],
    ['strawberry', 'Полуниця', 'fruit', 32, 0.7, 0.3, 7.7],
    ['kiwi', 'Ківі', 'fruit', 61, 1.1, 0.5, 14.7, ['шт', 75]],
    ['blueberry', 'Чорниця', 'fruit', 57, 0.7, 0.3, 14.5],
    ['raisins', 'Родзинки', 'fruit', 299, 3.1, 0.5, 79.2],
    ['apricots-dried', 'Курага', 'fruit', 241, 3.4, 0.5, 62.6],

    ['walnuts', 'Волоські горіхи', 'nuts', 654, 15.2, 65.2, 13.7],
    ['almonds', 'Мигдаль', 'nuts', 579, 21.2, 49.9, 21.6],
    ['peanuts', 'Арахіс', 'nuts', 567, 25.8, 49.2, 16.1],
    ['sunflower-seeds', 'Насіння соняшника', 'nuts', 584, 20.8, 51.5, 20],
    ['peanut-butter', 'Арахісова паста', 'nuts', 588, 25, 50, 20, ['ст. л.', 16]],
    ['sunflower-oil', 'Олія соняшникова', 'nuts', 884, 0, 100, 0, ['ст. л.', 14]],
    ['olive-oil', 'Олія оливкова', 'nuts', 884, 0, 100, 0, ['ст. л.', 14]],

    ['sugar', 'Цукор', 'sweet', 387, 0, 0, 100, ['ч. л.', 5]],
    ['honey', 'Мед', 'sweet', 304, 0.3, 0, 82.4, ['ч. л.', 8]],
    ['dark-chocolate', 'Шоколад чорний 70%', 'sweet', 598, 7.8, 42.6, 45.9],
    ['milk-chocolate', 'Шоколад молочний', 'sweet', 535, 7.7, 29.7, 59.4],
    ['cookies', 'Печиво (у середньому)', 'sweet', 450, 6.5, 18, 68],
    ['ketchup', 'Кетчуп', 'sweet', 101, 1, 0.1, 27.4, ['ст. л.', 17]],
    ['mayonnaise', 'Майонез 67%', 'sweet', 627, 0.4, 67, 3.9, ['ст. л.', 15]],
    ['coffee', 'Кава чорна без цукру', 'sweet', 2, 0.1, 0, 0, ['чашка', 200]],
    ['tea', 'Чай без цукру', 'sweet', 1, 0, 0, 0.2, ['чашка', 250]],
    ['orange-juice', 'Сік апельсиновий', 'sweet', 45, 0.7, 0.2, 10.4, ['склянка', 250]],
    ['cola', 'Кола', 'sweet', 42, 0, 0, 10.6, ['склянка', 250]],

    ['borscht', 'Борщ український (у середньому)', 'dish', 49, 2.4, 2.3, 4.8, ['тарілка', 300]],
    ['varenyky-potato', 'Вареники з картоплею (у середньому)', 'dish', 148, 4, 3, 26],
    ['pelmeni', 'Пельмені варені (у середньому)', 'dish', 245, 11.5, 12.5, 22],
    ['omelette', 'Омлет (у середньому)', 'dish', 154, 10.6, 11.7, 0.6],
    ['pizza', 'Піца (у середньому)', 'dish', 266, 11.4, 10.4, 33.3, ['шматок', 110]]
  ];
  const BUILTIN = BUILTIN_RAW.map(([code, name, cat, kcal, p, f, c, portion]) => ({
    id: 'b:' + code, name, cat, kcal, p, f, c,
    portion: portion ? { label: portion[0], grams: portion[1] } : null,
    kind: cat === 'dish' ? 'dish' : 'product', builtin: true
  }));
  const BUILTIN_MAP = new Map(BUILTIN.map((f) => [f.id, f]));

  const ACTIVITY = [
    { id: 'sedentary', label: 'Мінімальна', hint: 'сидяча робота, майже без тренувань', k: 1.2 },
    { id: 'light', label: 'Низька', hint: '1–3 тренування на тиждень', k: 1.375 },
    { id: 'moderate', label: 'Середня', hint: '3–5 тренувань на тиждень', k: 1.55 },
    { id: 'high', label: 'Висока', hint: '6–7 тренувань на тиждень', k: 1.725 },
    { id: 'extreme', label: 'Дуже висока', hint: 'фізична робота + щоденні тренування', k: 1.9 }
  ];
  const GOALS = [{ id: 'lose', label: 'Схуднути' }, { id: 'maintain', label: 'Тримати вагу' }, { id: 'gain', label: 'Набрати масу' }];
  const PACES = [{ id: 'slow', label: 'Повільно' }, { id: 'medium', label: 'Помірно' }, { id: 'fast', label: 'Швидше' }];
  const PACE_DELTA = { lose: { slow: -0.10, medium: -0.15, fast: -0.20 }, gain: { slow: 0.05, medium: 0.10, fast: 0.15 } };
  const PROTEIN_DEFAULT = { lose: 2, maintain: 1.6, gain: 1.8 };
  const FAT_DEFAULT = 25;

  // ---------- Числа ----------
  const num = (v) => Number(v) || 0;
  const r1 = (v) => Math.round(num(v) * 10) / 10;
  const round5 = (v) => Math.round(num(v) / 5) * 5;
  const round10 = (v) => Math.round(num(v) / 10) * 10;
  /** 1234 → «1 234» */
  const kc = (v) => fmt.number(Math.round(num(v)), 0);
  /** Грами: до 10 — з однією цифрою після коми, далі — цілі. */
  function gr(v) {
    const n = num(v);
    if (n > 0 && n < 10 && Math.round(n) !== n) return fmt.number(n, 1).replace(/,0$/, '');
    return fmt.number(Math.round(n), 0);
  }
  const dec = (v) => fmt.number(num(v), 1).replace(/,0$/, '');
  /** Розбір числа з поля: '' → null, некоректне → NaN. */
  function readNum(input) {
    const raw = String(input.value || '').trim();
    if (!raw) return null;
    return U.parseAmount(raw);
  }
  const ZERO = () => ({ kcal: 0, p: 0, f: 0, c: 0 });
  function add(a, b) { return { kcal: a.kcal + b.kcal, p: a.p + b.p, f: a.f + b.f, c: a.c + b.c }; }
  function mealLabel(id) { return CRM.dict.label('mealTypes', id) || 'Інше'; }

  // ---------- Продукти ----------
  function ownFoods() { return CRM.store.list('foods'); }
  /** Усі продукти для вибору: вбудовані (якщо їх не змінено) + свої. */
  function allFoods() {
    const own = ownFoods();
    const overridden = new Set(own.filter((f) => f.baseId).map((f) => f.baseId));
    return BUILTIN.filter((b) => !overridden.has(b.id)).concat(own);
  }
  function getFood(id) {
    if (!id) return null;
    if (BUILTIN_MAP.has(id)) {
      const o = ownFoods().find((f) => f.baseId === id);
      return o || BUILTIN_MAP.get(id);
    }
    const f = CRM.store.get('foods', id);
    return f && !f.deletedAt ? f : null;
  }
  const per100Of = (f) => ({ kcal: r1(f.kcal), p: r1(f.p), f: r1(f.f), c: r1(f.c) });
  function per100Text(f) { return `Б ${dec(f.p)} · Ж ${dec(f.f)} · В ${dec(f.c)}`; }
  function portionText(p) { return p && p.grams ? `1 ${p.label} ≈ ${gr(p.grams)} г` : ''; }

  function searchFoods(query, limit) {
    const q = U.normalize(query);
    if (!q) return [];
    const terms = q.split(' ').filter(Boolean);
    const out = [];
    allFoods().forEach((f) => {
      const name = U.normalize(f.name);
      if (!terms.every((t) => name.includes(t))) return;
      let score = name.startsWith(q) ? 4 : name.split(/[\s(/,-]+/).some((w) => w.startsWith(terms[0])) ? 3 : 1;
      if (!f.builtin) score += 0.5;
      out.push({ f, score });
    });
    out.sort((a, b) => b.score - a.score || a.f.name.length - b.f.name.length || a.f.name.localeCompare(b.f.name, 'uk'));
    return out.slice(0, limit || 40).map((x) => x.f);
  }

  /** Нещодавно використані продукти (з останньою кількістю). */
  function recentFoods(limit) {
    const seen = new Set();
    const out = [];
    CRM.store.list('meals')
      .filter((e) => e.foodId)
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
      .forEach((e) => {
        if (out.length >= (limit || 8) || seen.has(e.foodId)) return;
        seen.add(e.foodId);
        const f = getFood(e.foodId);
        if (f) out.push(f);
      });
    return out;
  }
  function lastUse(foodId) {
    let best = null;
    CRM.store.list('meals').forEach((e) => {
      if (e.foodId === foodId && (!best || (e.createdAt || '') > (best.createdAt || ''))) best = e;
    });
    return best;
  }

  // ---------- Записи щоденника ----------
  function entryTotals(e) {
    if (e.per100 && num(e.grams) > 0) {
      const k = num(e.grams) / 100;
      return { kcal: num(e.per100.kcal) * k, p: num(e.per100.p) * k, f: num(e.per100.f) * k, c: num(e.per100.c) * k };
    }
    const m = e.manual || {};
    return { kcal: num(m.kcal), p: num(m.p), f: num(m.f), c: num(m.c) };
  }
  function entriesOn(date) {
    return CRM.store.list('meals').filter((e) => e.date === date)
      .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  }
  function totalsFor(date) { return entriesOn(date).reduce((s, e) => add(s, entryTotals(e)), ZERO()); }
  function amountText(e) {
    if (e.portion && e.portion.count) return `${dec(e.portion.count)} ${e.portion.label} · ${gr(e.grams)} г`;
    if (e.grams) return `${gr(e.grams)} г`;
    return '';
  }
  function macrosText(t) { return `Б ${gr(t.p)} · Ж ${gr(t.f)} · В ${gr(t.c)}`; }
  const hasMacros = (t) => t.p > 0 || t.f > 0 || t.c > 0;

  // ---------- Норма ----------
  function profile() {
    const tp = CRM.store.getSetting('trainingProfile', null) || {};
    const np = CRM.store.getSetting(PROFILE, null) || {};
    return {
      sex: np.sex || null, age: tp.age || null, height: tp.height || null, weight: tp.weight || null,
      activity: np.activity || 'moderate', goal: np.goal || 'maintain', pace: np.pace || 'medium',
      proteinPerKg: np.proteinPerKg || null, fatPct: np.fatPct || null
    };
  }
  function target() {
    const t = CRM.store.getSetting(TARGET, null);
    return t && num(t.kcal) > 0 ? t : null;
  }

  /** Розрахунок норми. Повертає null, якщо бракує даних. */
  function calc(p) {
    const act = ACTIVITY.find((a) => a.id === p.activity);
    if (!p.sex || !p.age || !p.height || !p.weight || !act) return null;
    const bmr = 10 * p.weight + 6.25 * p.height - 5 * p.age + (p.sex === 'female' ? -161 : 5);
    const tdee = bmr * act.k;
    const delta = p.goal === 'maintain' ? 0 : ((PACE_DELTA[p.goal] || {})[p.pace] || 0);
    let kcal = tdee * (1 + delta);
    let floored = false;
    if (kcal < bmr) { kcal = bmr; floored = true; }
    kcal = round10(kcal);
    const ppk = p.proteinPerKg || PROTEIN_DEFAULT[p.goal] || 1.6;
    const fatPct = p.fatPct || FAT_DEFAULT;
    const protein = round5(p.weight * ppk);
    const fat = round5(kcal * fatPct / 100 / 9);
    const carbs = Math.max(0, round5((kcal - protein * 4 - fat * 9) / 4));
    return { bmr: Math.round(bmr), tdee: Math.round(tdee), delta, kcal, protein, fat, carbs, floored, ppk, fatPct };
  }

  // ---------- Спільні елементи ----------
  function seg(items, value, onPick, label, cls) {
    const el = h('div', { class: 'segmented nut-seg' + (cls ? ' ' + cls : ''), role: 'radiogroup', 'aria-label': label });
    const render = (v) => ui.mount(el, items.map((it) => h('button', {
      type: 'button', role: 'radio', class: it.id === v ? 'active' : '', 'aria-checked': it.id === v ? 'true' : 'false',
      onClick: () => { render(it.id); onPick(it.id); }
    }, it.label)));
    render(value);
    el.set = render;
    return el;
  }

  function ring(value, goal) {
    const ns = 'http://www.w3.org/2000/svg';
    const R = 44;
    const C = 2 * Math.PI * R;
    const pct = goal > 0 ? Math.min(value / goal, 1) : 0;
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 100 100');
    svg.setAttribute('class', 'nut-ring-svg');
    svg.setAttribute('aria-hidden', 'true');
    const circle = (cls) => {
      const c = document.createElementNS(ns, 'circle');
      c.setAttribute('cx', '50'); c.setAttribute('cy', '50'); c.setAttribute('r', String(R));
      c.setAttribute('class', cls);
      return c;
    };
    svg.appendChild(circle('nut-ring-track'));
    if (pct > 0) {
      const bar = circle('nut-ring-bar' + (goal > 0 && value > goal * 1.05 ? ' over' : ''));
      bar.setAttribute('stroke-dasharray', `${(C * pct).toFixed(1)} ${C.toFixed(1)}`);
      bar.setAttribute('transform', 'rotate(-90 50 50)');
      svg.appendChild(bar);
    }
    return svg;
  }

  function macroRow(key, label, value, goal) {
    const pct = goal > 0 ? Math.min(100, value / goal * 100) : 0;
    return h('div', { class: 'nut-macro nut-' + key },
      h('div', { class: 'nut-macro-head' },
        h('span', { class: 'nut-macro-name' }, h('span', { class: 'nut-dot' }), label),
        h('span', { class: 'nut-macro-val num' }, goal > 0 ? `${gr(value)} / ${gr(goal)} г` : `${gr(value)} г`)),
      goal > 0 ? h('div', { class: 'meter' }, h('div', { class: 'meter-fill', style: { width: pct.toFixed(1) + '%' } })) : null);
  }

  // ---------- Сторінка ----------
  let diaryDate = null;          // null — сьогодні
  let foodQuery = '';
  let foodFilter = 'all';
  let normDraft = null;
  const curDate = () => diaryDate || D.today();
  function setDate(d) { diaryDate = !d || d === D.today() ? null : d; CRM.router.rerender(); }

  const TABS = [['diary', 'Щоденник'], ['norm', 'Норма'], ['foods', 'Продукти']];

  function render(container, route) {
    const tabId = route.sub === 'norm' || route.sub === 'foods' ? route.sub : 'diary';
    if (route.sub !== 'norm') normDraft = null;
    if (tabId === 'diary' && D.isDate(route.params.date)) {
      diaryDate = route.params.date === D.today() ? null : route.params.date;
      CRM.router.consumeParam('date');
    }
    const nav = h('nav', { class: 'tabs', 'aria-label': 'Вкладки харчування' },
      TABS.map(([id, label]) => h('a', {
        href: '#/nutrition' + (id === 'diary' ? '' : '/' + id), class: 'tab' + (id === tabId ? ' active' : ''),
        'aria-current': id === tabId ? 'page' : null
      }, label)));
    const content = h('div', { class: 'nut-tab' });
    ui.mount(container,
      ui.pageHead({
        title: 'Харчування', sub: 'Щоденник їжі, норма калорій і БЖВ, довідник продуктів.',
        actions: ui.button({ label: 'Додати їжу', icon: 'plus', variant: 'primary', title: 'Додати їжу в щоденник', onClick: () => openAdd({ date: tabId === 'diary' ? curDate() : D.today() }) })
      }),
      nav, content);
    if (tabId === 'norm') normTab(content);
    else if (tabId === 'foods') foodsTab(content);
    else diaryTab(content);

    if (route.params.open) {
      const id = route.params.open;
      CRM.router.consumeParam('open');
      setTimeout(() => {
        if (tabId !== 'foods') { openEntry(id); return; }
        const f = getFood(id);
        if (f) openFoodForm(f); else ui.toast('Продукт не знайдено', { type: 'error' });
      }, 0);
    }
  }

  // ---------- Вкладка «Щоденник» ----------
  function dayTitle(date) {
    const diff = D.diffDays(D.today(), date);
    if (diff === 0) return 'Сьогодні';
    if (diff === -1) return 'Вчора';
    if (diff === 1) return 'Завтра';
    const w = CRM.WEEKDAYS[D.weekday(date)];
    return w.charAt(0).toUpperCase() + w.slice(1);
  }

  function dayNav(date) {
    const isToday = date === D.today();
    return h('div', { class: 'nut-daynav' },
      h('button', { type: 'button', class: 'btn btn-icon btn-sm', 'aria-label': 'Попередній день', title: 'Попередній день', onClick: () => setDate(D.addDays(date, -1)) }, CRM.icon('chevronLeft', { size: 'sm' })),
      h('div', { class: 'nut-day-title' }, h('span', { class: 'nut-day-name' }, dayTitle(date)), h('span', { class: 'nut-day-date' }, fmt.date(date))),
      h('button', { type: 'button', class: 'btn btn-icon btn-sm', 'aria-label': 'Наступний день', title: 'Наступний день', onClick: () => setDate(D.addDays(date, 1)) }, CRM.icon('chevronRight', { size: 'sm' })),
      isToday ? null : ui.button({ label: 'Сьогодні', size: 'sm', variant: 'ghost', onClick: () => setDate(null) }));
  }

  function summaryCard(date, tot, tg) {
    const left = tg ? tg.kcal - tot.kcal : 0;
    let status;
    if (!tg) status = h('div', { class: 'nut-status' }, 'Денну норму ще не задано.');
    else if (left >= 0) status = h('div', { class: 'nut-status' }, 'Залишилось ', h('strong', { class: 'num' }, kc(left) + ' ккал'));
    else status = h('div', { class: 'nut-status over' }, CRM.icon('alert', { size: 'sm' }), 'Понад норму на ', h('strong', { class: 'num' }, kc(-left) + ' ккал'));
    return h('section', { class: 'card nut-summary' },
      h('div', { class: 'card-body' },
        h('div', { class: 'nut-sum-top' },
          h('div', { class: 'nut-ring' }, ring(tot.kcal, tg ? tg.kcal : 0),
            h('div', { class: 'nut-ring-center' },
              h('span', { class: 'nut-ring-value num' }, kc(tot.kcal)),
              h('span', { class: 'nut-ring-label' }, tg ? `з ${kc(tg.kcal)} ккал` : 'ккал'))),
          h('div', { class: 'nut-sum-side' },
            status,
            h('div', { class: 'nut-macros' },
              macroRow('p', 'Білки', tot.p, tg ? tg.protein : 0),
              macroRow('f', 'Жири', tot.f, tg ? tg.fat : 0),
              macroRow('c', 'Вуглеводи', tot.c, tg ? tg.carbs : 0)))),
        tg ? null : h('div', { class: 'callout nut-callout' }, CRM.icon('info'),
          h('span', null, 'Порахуй свою норму калорій і БЖВ — тоді тут буде видно, скільки ще можна зʼїсти. ',
            h('a', { href: '#/nutrition/norm', class: 'link-like' }, 'Порахувати норму')))));
  }

  function entryRow(e) {
    const t = entryTotals(e);
    const sub = [amountText(e), hasMacros(t) ? macrosText(t) : (e.per100 ? macrosText(t) : 'швидкий запис')].filter(Boolean).join(' · ');
    return h('div', {
      class: 'nut-entry', role: 'button', tabIndex: 0, dataset: { id: e.id },
      onClick: () => openEntry(e.id),
      onKeydown: (ev) => { if (ev.key === 'Enter' && ev.target === ev.currentTarget) openEntry(e.id); }
    },
    h('span', { class: 'nut-entry-main' },
      h('span', { class: 'nut-entry-name' }, e.name || 'Без назви'),
      h('span', { class: 'nut-entry-sub' }, sub)),
    h('span', { class: 'nut-entry-kcal num' }, kc(t.kcal), h('span', { class: 'nut-unit' }, ' ккал')));
  }

  function mealsCard(date) {
    const entries = entriesOn(date);
    const prev = entriesOn(D.addDays(date, -1));
    return h('section', { class: 'card nut-meals' },
      MEALS.map((m) => {
        const items = entries.filter((e) => e.meal === m.id);
        const sum = items.reduce((s, e) => add(s, entryTotals(e)), ZERO());
        const yesterday = prev.filter((e) => e.meal === m.id);
        return h('div', { class: 'nut-meal', dataset: { meal: m.id } },
          h('div', { class: 'nut-meal-head' },
            h('span', { class: 'nut-meal-name' }, m.label),
            items.length ? h('span', { class: 'nut-meal-total num' }, kc(sum.kcal) + ' ккал') : null,
            h('span', { class: 'grow' }),
            !items.length && yesterday.length ? ui.button({ label: 'Як учора', icon: 'repeat', size: 'sm', variant: 'ghost', title: `Скопіювати ${m.label.toLowerCase()} з попереднього дня`, onClick: () => copyMeal(yesterday, date) }) : null,
            ui.button({ label: 'Додати', icon: 'plus', size: 'sm', variant: 'ghost', className: 'nut-meal-add', title: `Додати: ${m.label.toLowerCase()}`, onClick: () => openAdd({ date, meal: m.id }) })),
          items.length ? items.map(entryRow) : h('div', { class: 'nut-meal-empty' }, 'Ще нічого не записано'));
      }));
  }

  async function copyMeal(list, date) {
    const recs = list.map((e) => {
      const c = U.deepClone(e);
      ['id', 'createdAt', 'updatedAt', 'deletedAt', 'deleteBatch', 'deleteHead'].forEach((k) => delete c[k]);
      c.date = date;
      return c;
    });
    await CRM.store.saveMany('meals', recs);
    ui.toast(`Скопійовано ${fmt.count(recs.length, ['запис', 'записи', 'записів'])}`, { type: 'success' });
  }

  function weekCard(date, tg) {
    const days = [];
    for (let i = 6; i >= 0; i--) days.push(D.addDays(date, -i));
    const byDate = new Map();
    CRM.store.list('meals').forEach((e) => {
      if (e.date < days[0] || e.date > days[6]) return;
      byDate.set(e.date, (byDate.get(e.date) || 0) + entryTotals(e).kcal);
    });
    const vals = days.map((d) => Math.round(byDate.get(d) || 0));
    const filled = vals.filter((v) => v > 0);
    if (!filled.length) return null;
    const goal = tg ? tg.kcal : 0;
    const max = Math.max(goal, ...vals) * 1.12 || 1;
    const avg = Math.round(filled.reduce((a, b) => a + b, 0) / filled.length);
    return h('section', { class: 'card nut-week' },
      h('div', { class: 'card-head' },
        h('h2', null, 'Калорії за 7 днів'),
        h('span', { class: 'subtle' }, `у середньому ${kc(avg)} ккал`)),
      h('div', { class: 'card-body' },
        h('div', { class: 'nut-bars', role: 'group', 'aria-label': 'Калорії по днях' },
          days.map((d, i) => {
            const v = vals[i];
            const cls = ['nut-bar-col'];
            if (d === date) cls.push('sel');
            if (goal && v > goal * 1.05) cls.push('over');
            return h('button', {
              type: 'button', class: cls.join(' '), title: `${fmt.dateLong(d)}: ${kc(v)} ккал`,
              'aria-label': `${fmt.dateLong(d)}: ${kc(v)} ккал`, onClick: () => setDate(d)
            },
            h('span', { class: 'nut-bar-val num' }, v ? kc(v) : '—'),
            h('span', { class: 'nut-bar-track' },
              goal ? h('span', { class: 'nut-bar-norm', style: { bottom: (goal / max * 100).toFixed(1) + '%' } }) : null,
              h('span', { class: 'nut-bar', style: { height: (v / max * 100).toFixed(1) + '%' } })),
            h('span', { class: 'nut-bar-day' }, CRM.WEEKDAYS_SHORT[D.weekday(d)]),
            h('span', { class: 'nut-bar-date num' }, String(D.parse(d).d)));
          })),
        goal ? h('div', { class: 'nut-week-legend' }, h('span', { class: 'nut-legend-line' }), `норма ${kc(goal)} ккал`) : null));
  }

  function diaryTab(content) {
    const date = curDate();
    const tg = target();
    const tot = totalsFor(date);
    const hasAny = CRM.store.list('meals').length > 0;
    ui.mount(content,
      dayNav(date),
      h('div', { class: 'nut-grid' },
        h('div', { class: 'nut-side' }, summaryCard(date, tot, tg), weekCard(date, tg)),
        h('div', { class: 'nut-main' },
          !hasAny ? h('section', { class: 'card' }, ui.empty({
            icon: 'apple', title: 'Щоденник порожній — додай першу їжу',
            text: 'Обери продукт із довідника, вкажи грами — калорії, білки, жири й вуглеводи порахуються самі.',
            action: { label: 'Додати їжу', icon: 'plus', onClick: () => openAdd({ date }) }
          })) : null,
          mealsCard(date))));
  }

  // ---------- Додавання їжі ----------
  function mealByTime() {
    const hh = D.kyivParts().hh;
    if (hh >= 4 && hh < 11) return 'breakfast';
    if (hh >= 11 && hh < 16) return 'lunch';
    if (hh >= 16 && hh < 21) return 'dinner';
    return 'snack';
  }

  function resultRow(f, onPick) {
    return h('button', { type: 'button', class: 'nut-result', role: 'option', onClick: () => onPick(f) },
      h('span', { class: 'nut-result-main' },
        h('span', { class: 'nut-result-name' }, f.name,
          f.kind === 'dish' && !f.builtin ? h('span', { class: 'badge' }, 'страва') : !f.builtin ? h('span', { class: 'badge badge-accent' }, f.baseId ? 'змінено' : 'мій') : null),
        h('span', { class: 'nut-result-sub' }, per100Text(f) + (f.portion ? ' · ' + portionText(f.portion) : ''))),
      h('span', { class: 'nut-result-kcal num' }, kc(f.kcal), h('span', { class: 'nut-unit' }, ' ккал/100 г')));
  }

  /**
   * Вікно «Додати їжу»: пошук продукту → кількість → «Додати».
   * Після додавання вікно лишається відкритим (можна додати ще), «Готово» — закрити.
   * opts: { date, meal, food }
   */
  function openAdd(opts) {
    const o = opts || {};
    const date = o.date || curDate();
    let meal = o.meal || (date === D.today() ? mealByTime() : 'breakfast');
    let query = '';
    const added = [];
    const body = h('div', { class: 'nut-add' });
    const foot = h('div', { class: 'nut-add-foot' });
    const mealSeg = seg(MEALS, meal, (v) => { meal = v; renderAdded(); }, 'Прийом їжі', 'nut-meal-seg');
    const addedStrip = h('div', { class: 'nut-added', role: 'status', 'aria-live': 'polite' });
    const stepBox = h('div', { class: 'nut-step' });
    ui.mount(body,
      h('div', { class: 'nut-add-top' }, mealSeg, h('span', { class: 'nut-add-date subtle' }, date === D.today() ? 'сьогодні' : fmt.date(date))),
      addedStrip, stepBox);

    function renderAdded() {
      addedStrip.hidden = !added.length;
      if (!added.length) return;
      ui.mount(addedStrip, CRM.icon('checkCircle', { size: 'sm' }),
        h('span', null, 'Додано: ' + added.join(', ')));
    }

    // Крок 1: пошук
    let searchInput = null;
    function stepSearch() {
      let items = [];
      searchInput = h('input', {
        class: 'input nut-search', type: 'text', enterkeyhint: 'search', placeholder: 'Пошук: гречка, яйце, банан…',
        'aria-label': 'Пошук продукту', autocomplete: 'off', spellcheck: 'false', value: query
      });
      const list = h('div', { class: 'nut-results', role: 'listbox', 'aria-label': 'Продукти' });
      function update() {
        query = searchInput.value;
        const q = query.trim();
        if (q) {
          items = searchFoods(q, 40);
          ui.mount(list, items.length ? items.map((f) => resultRow(f, stepAmount)) : h('div', { class: 'nut-results-empty' },
            h('div', null, `«${q}» немає в довіднику.`),
            h('div', { class: 'btn-row' },
              ui.button({ label: 'Швидкий запис', icon: 'flame', size: 'sm', onClick: () => stepQuick(q) }),
              ui.button({ label: 'Створити продукт', icon: 'plus', size: 'sm', onClick: () => createFood(q) }))));
        } else {
          items = recentFoods(8);
          ui.mount(list, items.length
            ? [h('div', { class: 'nut-results-title' }, 'Нещодавні'), items.map((f) => resultRow(f, stepAmount))]
            : h('div', { class: 'nut-results-hint' }, 'Почни вводити назву. Порада: якщо зважуєш сире — обирай «сире / сухе», якщо готове — «варене».'));
        }
      }
      searchInput.addEventListener('input', update);
      searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { e.preventDefault(); if (items[0]) stepAmount(items[0]); }
      });
      update();
      ui.mount(stepBox, searchInput, list,
        h('div', { class: 'nut-add-links' },
          h('button', { type: 'button', class: 'link-like', onClick: () => stepQuick(searchInput.value.trim()) }, 'Швидкий запис — лише калорії'),
          h('button', { type: 'button', class: 'link-like', onClick: () => createFood(searchInput.value.trim()) }, 'Новий продукт')));
      ui.mount(foot, h('span', { class: 'grow' }),
        ui.button({ label: added.length ? 'Готово' : 'Скасувати', variant: added.length ? 'primary' : null, onClick: () => dlg.close('button') }));
      return searchInput;
    }

    function createFood(name) {
      openFoodForm(null, { name, onSaved: (f) => { if (dlg.isOpen) stepAmount(f); } });
    }

    // Крок 2: кількість
    function stepAmount(food) {
      const last = lastUse(food.id);
      const hasPortion = !!(food.portion && food.portion.grams > 0);
      let unit = hasPortion && (!last || last.portion) ? 'portion' : 'g';
      let value;
      if (last) value = unit === 'portion' && last.portion ? last.portion.count : last.grams;
      if (!value) value = unit === 'portion' ? 1 : 100;
      const amountIn = h('input', { class: 'input nut-amount', type: 'text', inputmode: 'decimal', 'aria-label': 'Кількість', value: dec(value) });
      const fAmount = ui.field({ input: amountIn });
      const preview = h('div', { class: 'nut-preview', 'aria-live': 'polite' });
      const chipsBox = h('div', { class: 'chips nut-quick' });
      const grams = () => {
        const v = readNum(amountIn);
        if (v == null || isNaN(v) || v <= 0) return null;
        return unit === 'portion' ? v * food.portion.grams : v;
      };
      function renderChips() {
        const vals = unit === 'portion' ? [0.5, 1, 2, 3] : [50, 100, 150, 200, 250];
        ui.mount(chipsBox, vals.map((v) => h('button', {
          type: 'button', class: 'chip', onClick: () => { amountIn.value = dec(v); update(); amountIn.focus(); }
        }, unit === 'portion' ? `${dec(v)} ${food.portion.label}` : `${v} г`)));
      }
      function update() {
        const g = grams();
        if (!g) { ui.mount(preview, h('span', { class: 'subtle' }, 'Вкажи кількість')); return; }
        const k = g / 100;
        const t = { kcal: food.kcal * k, p: food.p * k, f: food.f * k, c: food.c * k };
        ui.mount(preview,
          h('span', { class: 'nut-preview-kcal num' }, kc(t.kcal), h('span', { class: 'nut-unit' }, ' ккал')),
          h('span', { class: 'nut-preview-macros' },
            unit === 'portion' ? h('span', { class: 'subtle' }, `${gr(g)} г · `) : null, macrosText(t) + ' г'));
      }
      const unitCtl = hasPortion
        ? seg([{ id: 'g', label: 'г' }, { id: 'portion', label: food.portion.label }], unit, (v) => {
          const g = grams();
          unit = v;
          if (g) amountIn.value = v === 'portion' ? dec(Math.round(g / food.portion.grams * 2) / 2 || 1) : gr(g);
          renderChips(); update();
        }, 'Одиниця', 'nut-unit-seg')
        : h('span', { class: 'nut-unit-fixed' }, 'г');
      amountIn.addEventListener('input', update);
      amountIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });

      async function submit() {
        const g = grams();
        if (!g) { fAmount.setError('Вкажи кількість більшу за нуль'); amountIn.focus(); return; }
        if (g > 5000) { fAmount.setError('Забагато: максимум 5 кг за один запис'); return; }
        const rec = {
          date, meal, name: food.name, foodId: food.id, grams: r1(g), per100: per100Of(food), manual: null,
          portion: unit === 'portion' ? { label: food.portion.label, grams: food.portion.grams, count: r1(readNum(amountIn)) } : null
        };
        await CRM.store.save('meals', rec);
        added.push(`${food.name} (${amountText(rec)})`);
        renderAdded();
        query = '';
        const input = stepSearch();
        input.focus();
      }

      renderChips();
      update();
      ui.mount(stepBox,
        h('div', { class: 'nut-picked' },
          h('div', { class: 'nut-picked-name' }, food.name),
          h('div', { class: 'nut-picked-sub' }, `${kc(food.kcal)} ккал на 100 г · ${per100Text(food)}` + (hasPortion ? ` · ${portionText(food.portion)}` : ''))),
        h('div', { class: 'nut-amount-row' }, fAmount, unitCtl),
        chipsBox, preview);
      ui.mount(foot,
        ui.button({ label: 'Назад', icon: 'chevronLeft', onClick: () => stepSearch().focus() }),
        h('span', { class: 'grow' }),
        ui.button({ label: 'Додати', icon: 'plus', variant: 'primary', onClick: submit }));
      amountIn.focus();
      amountIn.select();
    }

    // Швидкий запис: лише калорії (і за бажанням БЖВ)
    function stepQuick(name) {
      const nameIn = ui.input({ value: name || '', maxlength: 80, placeholder: 'напр., Обід у кафе', 'aria-label': 'Назва' });
      const fName = ui.field({ label: 'Назва', input: nameIn, required: true });
      const numIn = (label, ph) => h('input', { class: 'input', type: 'text', inputmode: 'decimal', placeholder: ph, 'aria-label': label });
      const kIn = numIn('Калорії, ккал', 'ккал');
      const pIn = numIn('Білки, г', 'г');
      const fIn = numIn('Жири, г', 'г');
      const cIn = numIn('Вуглеводи, г', 'г');
      const fK = ui.field({ label: 'Калорії, ккал', input: kIn, required: true });
      const fP = ui.field({ label: 'Білки, г', input: pIn });
      const fF = ui.field({ label: 'Жири, г', input: fIn });
      const fC = ui.field({ label: 'Вуглеводи, г', input: cIn });
      async function submit() {
        let ok = true;
        const title = nameIn.value.trim();
        if (!title) { fName.setError('Вкажи назву'); ok = false; }
        const k = readNum(kIn);
        if (k == null || isNaN(k) || k <= 0 || k > 10000) { fK.setError('Калорії — число від 1 до 10 000'); ok = false; }
        const vals = [[fP, pIn], [fF, fIn], [fC, cIn]].map(([f, input]) => {
          const v = readNum(input);
          if (v == null) return 0;
          if (isNaN(v) || v < 0 || v > 1000) { f.setError('0–1000 г'); ok = false; return 0; }
          return v;
        });
        if (!ok) return;
        await CRM.store.save('meals', { date, meal, name: title, foodId: null, grams: null, per100: null, portion: null, manual: { kcal: r1(k), p: r1(vals[0]), f: r1(vals[1]), c: r1(vals[2]) } });
        added.push(`${title} (${kc(k)} ккал)`);
        renderAdded();
        query = '';
        stepSearch().focus();
      }
      ui.mount(stepBox,
        h('p', { class: 'modal-text' }, 'Для їжі, якої немає в довіднику: страва в кафе, перекус «на око». Білки, жири й вуглеводи — за бажанням.'),
        h('div', { class: 'form-stack' }, fName, h('div', { class: 'form-grid' }, fK, fP, fF, fC)));
      ui.mount(foot,
        ui.button({ label: 'Назад', icon: 'chevronLeft', onClick: () => stepSearch().focus() }),
        h('span', { class: 'grow' }),
        ui.button({ label: 'Додати', icon: 'plus', variant: 'primary', onClick: submit }));
      [nameIn, kIn, pIn, fIn, cIn].forEach((el) => el.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } }));
      (name ? kIn : nameIn).focus();
    }

    renderAdded();
    const first = o.food ? null : stepSearch();
    const dlg = ui.modal({
      title: 'Додати їжу', body, footer: foot, className: 'nut-add-modal',
      initialFocus: first || 'container',
      onClose: () => { if (added.length) ui.toast(`Додано в щоденник: ${fmt.count(added.length, ['запис', 'записи', 'записів'])}`, { type: 'success' }); }
    });
    if (o.food) stepAmount(o.food);
    return dlg;
  }

  // ---------- Редагування запису ----------
  function openEntry(id) {
    const e = CRM.store.get('meals', id);
    if (!e || e.deletedAt) { ui.toast('Запис не знайдено', { type: 'error' }); return null; }
    let meal = e.meal;
    const mealSeg = seg(MEALS, meal, (v) => { meal = v; }, 'Прийом їжі', 'nut-meal-seg');
    const dateIn = ui.dateInput({ value: e.date, clearable: false, ariaLabel: 'Дата' });
    const preview = h('div', { class: 'nut-preview', 'aria-live': 'polite' });
    let read;       // () → { ok, changes }
    let fields;
    if (e.per100) {
      const hasPortion = !!(e.portion && e.portion.grams);
      let unit = hasPortion ? 'portion' : 'g';
      const amountIn = h('input', { class: 'input nut-amount', type: 'text', inputmode: 'decimal', 'aria-label': 'Кількість', value: dec(hasPortion ? e.portion.count : e.grams) });
      const fAmount = ui.field({ input: amountIn });
      const grams = () => {
        const v = readNum(amountIn);
        if (v == null || isNaN(v) || v <= 0) return null;
        return unit === 'portion' ? v * e.portion.grams : v;
      };
      const update = () => {
        const g = grams();
        if (!g) { ui.mount(preview, h('span', { class: 'subtle' }, 'Вкажи кількість')); return; }
        const t = entryTotals({ per100: e.per100, grams: g });
        ui.mount(preview, h('span', { class: 'nut-preview-kcal num' }, kc(t.kcal), h('span', { class: 'nut-unit' }, ' ккал')),
          h('span', { class: 'nut-preview-macros' }, unit === 'portion' ? h('span', { class: 'subtle' }, `${gr(g)} г · `) : null, macrosText(t) + ' г'));
      };
      const unitCtl = hasPortion
        ? seg([{ id: 'g', label: 'г' }, { id: 'portion', label: e.portion.label }], unit, (v) => {
          const g = grams(); unit = v;
          if (g) amountIn.value = v === 'portion' ? dec(Math.round(g / e.portion.grams * 2) / 2 || 1) : gr(g);
          update();
        }, 'Одиниця', 'nut-unit-seg')
        : h('span', { class: 'nut-unit-fixed' }, 'г');
      amountIn.addEventListener('input', update);
      update();
      fields = [
        h('div', { class: 'nut-picked-sub' }, `${kc(e.per100.kcal)} ккал на 100 г · ${per100Text(e.per100)}`),
        h('div', { class: 'nut-amount-row' }, fAmount, unitCtl), preview];
      read = () => {
        const g = grams();
        if (!g || g > 5000) { fAmount.setError(!g ? 'Вкажи кількість більшу за нуль' : 'Максимум 5 кг'); return { ok: false }; }
        return { ok: true, changes: { grams: r1(g), portion: unit === 'portion' ? Object.assign({}, e.portion, { count: r1(readNum(amountIn)) }) : null } };
      };
    } else {
      const m = e.manual || {};
      const nameIn = ui.input({ value: e.name || '', maxlength: 80, 'aria-label': 'Назва' });
      const fName = ui.field({ label: 'Назва', input: nameIn, required: true });
      const mk = (label, v) => { const input = h('input', { class: 'input', type: 'text', inputmode: 'decimal', value: v ? dec(v) : '', 'aria-label': label }); return ui.field({ label, input }); };
      const fK = mk('Калорії, ккал', m.kcal); const fP = mk('Білки, г', m.p); const fF = mk('Жири, г', m.f); const fC = mk('Вуглеводи, г', m.c);
      fields = [fName, h('div', { class: 'form-grid' }, fK, fP, fF, fC)];
      read = () => {
        let ok = true;
        const title = nameIn.value.trim();
        if (!title) { fName.setError('Вкажи назву'); ok = false; }
        const val = (f, min, max, required) => {
          const v = readNum(f.querySelector('input'));
          if (v == null) { if (required) { f.setError('Обовʼязково'); ok = false; } return 0; }
          if (isNaN(v) || v < min || v > max) { f.setError(`${min}–${fmt.number(max, 0)}`); ok = false; return 0; }
          return r1(v);
        };
        const manual = { kcal: val(fK, 1, 10000, true), p: val(fP, 0, 1000), f: val(fF, 0, 1000), c: val(fC, 0, 1000) };
        return ok ? { ok: true, changes: { name: title, manual } } : { ok: false };
      };
    }

    async function save() {
      const r = read();
      if (!r.ok) return;
      await CRM.store.save('meals', Object.assign({}, CRM.store.get('meals', id), r.changes, { meal, date: dateIn.dateValue || e.date }));
      dlg.close('force');
      ui.toast('Зміни збережено', { type: 'success' });
    }
    async function remove() {
      const ok = await ui.confirm({ title: 'Видалити запис?', message: `«${e.name}» потрапить у Кошик. Відновити можна протягом 30 днів.`, confirmText: 'Видалити', danger: true });
      if (!ok) return;
      const batch = await CRM.store.softDelete('meals', id);
      dlg.close('force');
      ui.toast('Запис перенесено в Кошик', { action: { label: 'Скасувати', onClick: () => CRM.store.restoreBatch(batch) } });
    }

    const dlg = ui.modal({
      title: e.name || 'Запис',
      className: 'nut-entry-modal',
      body: h('div', { class: 'form-stack' },
        h('div', { class: 'nut-add-top' }, mealSeg),
        fields,
        ui.field({ label: 'Дата', input: dateIn })),
      footer: [
        ui.button({ label: 'Видалити', icon: 'trash', variant: 'danger-ghost', onClick: remove }),
        h('span', { class: 'grow' }),
        ui.button({ label: 'Скасувати', onClick: () => dlg.close('button') }),
        ui.button({ label: 'Зберегти', icon: 'check', variant: 'primary', onClick: save })]
    });
    dlg.el.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && ev.target.tagName === 'INPUT') { ev.preventDefault(); save(); } });
    return dlg;
  }

  // ---------- Вкладка «Норма» ----------
  function normTab(content) {
    if (!normDraft) normDraft = profile();
    const st = normDraft;
    const tg = target();

    const numField = (key, label, min, max, suffix, integer) => {
      const input = h('input', { class: 'input', type: 'text', inputmode: 'decimal', value: st[key] != null ? dec(st[key]) : '', placeholder: suffix, 'aria-label': label });
      const f = ui.field({ label, input });
      input.addEventListener('input', () => {
        const v = readNum(input);
        if (v == null) { st[key] = null; f.setError(null); }
        else if (isNaN(v) || v < min || v > max) { st[key] = null; f.setError(`Від ${min} до ${max}`); }
        else { st[key] = integer ? Math.round(v) : r1(v); f.setError(null); }
        update();
      });
      return f;
    };
    const fAge = numField('age', 'Вік, років', 15, 100, 'років', true);
    const fHeight = numField('height', 'Зріст, см', 120, 230, 'см', true);
    const fWeight = numField('weight', 'Вага, кг', 35, 250, 'кг', false);
    const sexSeg = seg([{ id: 'male', label: 'Чоловік' }, { id: 'female', label: 'Жінка' }], st.sex, (v) => { st.sex = v; update(); }, 'Стать');
    const actSel = ui.select(ACTIVITY.map((a) => ({ value: a.id, label: `${a.label} — ${a.hint}` })), { value: st.activity, 'aria-label': 'Активність' });
    actSel.addEventListener('change', () => { st.activity = actSel.value; update(); });
    const paceWrap = h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Темп'));
    const paceSeg = seg(PACES, st.pace, (v) => { st.pace = v; update(); }, 'Темп');
    paceWrap.appendChild(paceSeg);
    const paceHint = h('div', { class: 'field-hint' });
    paceWrap.appendChild(paceHint);
    const goalSeg = seg(GOALS, st.goal, (v) => {
      st.goal = v;
      pIn.placeholder = dec(PROTEIN_DEFAULT[v]);
      update();
    }, 'Мета');
    const pIn = h('input', { class: 'input', type: 'text', inputmode: 'decimal', value: st.proteinPerKg ? dec(st.proteinPerKg) : '', placeholder: dec(PROTEIN_DEFAULT[st.goal] || 1.6), 'aria-label': 'Білок, г на кг ваги' });
    const fP = ui.field({ label: 'Білок, г на кг ваги', input: pIn, hint: 'За замовчуванням: схуднення — 2, підтримка — 1,6, набір — 1,8 (у програмі тренувань — 1,6–2).' });
    pIn.addEventListener('input', () => {
      const v = readNum(pIn);
      if (v == null) { st.proteinPerKg = null; fP.setError(null); }
      else if (isNaN(v) || v < 0.8 || v > 3) { st.proteinPerKg = null; fP.setError('Від 0,8 до 3'); }
      else { st.proteinPerKg = r1(v); fP.setError(null); }
      update();
    });
    const fatIn = h('input', { class: 'input', type: 'text', inputmode: 'decimal', value: st.fatPct ? dec(st.fatPct) : '', placeholder: String(FAT_DEFAULT), 'aria-label': 'Жири, % калорій' });
    const fFat = ui.field({ label: 'Жири, % калорій', input: fatIn, hint: 'Зазвичай 20–35 %. Вуглеводи — усе, що лишається.' });
    fatIn.addEventListener('input', () => {
      const v = readNum(fatIn);
      if (v == null) { st.fatPct = null; fFat.setError(null); }
      else if (isNaN(v) || v < 15 || v > 45) { st.fatPct = null; fFat.setError('Від 15 до 45'); }
      else { st.fatPct = Math.round(v); fFat.setError(null); }
      update();
    });

    const result = h('div', { class: 'nut-result-box', 'aria-live': 'polite' });
    let lastCalc = null;

    function update() {
      paceWrap.hidden = st.goal === 'maintain';
      if (st.goal !== 'maintain') {
        const d = (PACE_DELTA[st.goal] || {})[st.pace] || 0;
        paceHint.textContent = st.goal === 'lose'
          ? `−${Math.abs(Math.round(d * 100))} % від витрати (≈${st.pace === 'slow' ? '0,25–0,5' : st.pace === 'medium' ? '0,5' : '0,5–1'} кг на тиждень)`
          : `+${Math.round(d * 100)} % до витрати (плавний набір ≈${st.pace === 'slow' ? '0,5' : st.pace === 'medium' ? '0,5–1' : '1–1,5'} кг на місяць)`;
      }
      const r = calc(st);
      lastCalc = r;
      if (!r) {
        const miss = [];
        if (!st.sex) miss.push('стать');
        if (!st.age) miss.push('вік');
        if (!st.height) miss.push('зріст');
        if (!st.weight) miss.push('вагу');
        ui.mount(result, h('div', { class: 'nut-result-empty' }, CRM.icon('flame'), h('span', null, `Вкажи ${miss.join(', ')} — і тут зʼявиться твоя норма.`)));
        return;
      }
      const same = tg && tg.kcal === r.kcal && tg.protein === r.protein && tg.fat === r.fat && tg.carbs === r.carbs;
      const pct = (g, k) => Math.round(g * k / r.kcal * 100);
      const goalWord = st.goal === 'maintain' ? 'підтримка ваги' : `${r.delta > 0 ? '+' : '−'}${Math.abs(Math.round(r.delta * 100))} % (${st.goal === 'lose' ? 'схуднення' : 'набір'})`;
      ui.mount(result,
        h('div', { class: 'nut-big' },
          h('span', { class: 'nut-big-label' }, 'Твоя норма'),
          h('span', { class: 'nut-big-value num' }, kc(r.kcal), h('span', { class: 'nut-big-unit' }, ' ккал на день'))),
        h('div', { class: 'nut-calc-steps' },
          h('div', null, h('span', null, 'Базовий обмін (у спокої)'), h('strong', { class: 'num' }, kc(r.bmr) + ' ккал')),
          h('div', null, h('span', null, 'Витрата з активністю'), h('strong', { class: 'num' }, kc(r.tdee) + ' ккал')),
          h('div', null, h('span', null, 'Мета'), h('strong', null, goalWord))),
        r.floored ? h('div', { class: 'callout callout-warning' }, CRM.icon('alert'), h('span', null, 'Норму піднято до базового обміну: їсти менше за нього не рекомендують.')) : null,
        h('div', { class: 'nut-bju' },
          h('div', { class: 'nut-bju-item nut-p' }, h('span', { class: 'nut-bju-label' }, h('span', { class: 'nut-dot' }), 'Білки'), h('span', { class: 'nut-bju-value num' }, `${r.protein} г`), h('span', { class: 'nut-bju-sub' }, `${pct(r.protein, 4)} % · ${dec(r.ppk)} г/кг`)),
          h('div', { class: 'nut-bju-item nut-f' }, h('span', { class: 'nut-bju-label' }, h('span', { class: 'nut-dot' }), 'Жири'), h('span', { class: 'nut-bju-value num' }, `${r.fat} г`), h('span', { class: 'nut-bju-sub' }, `${pct(r.fat, 9)} %`)),
          h('div', { class: 'nut-bju-item nut-c' }, h('span', { class: 'nut-bju-label' }, h('span', { class: 'nut-dot' }), 'Вуглеводи'), h('span', { class: 'nut-bju-value num' }, `${r.carbs} г`), h('span', { class: 'nut-bju-sub' }, `${pct(r.carbs, 4)} %`))),
        same
          ? h('div', { class: 'nut-saved-note' }, CRM.icon('checkCircle', { size: 'sm' }), 'Це твоя поточна норма')
          : ui.button({ label: tg ? 'Зберегти як нову норму' : 'Зберегти як мою норму', icon: 'check', variant: 'primary', className: 'nut-save-norm', onClick: saveNorm }));
    }

    async function saveNorm() {
      const r = lastCalc;
      if (!r) return;
      const tp = CRM.store.getSetting('trainingProfile', null) || {};
      await CRM.store.setSetting('trainingProfile', Object.assign({}, tp, { age: st.age, height: st.height, weight: st.weight }));
      await CRM.store.setSetting(PROFILE, { sex: st.sex, activity: st.activity, goal: st.goal, pace: st.pace, proteinPerKg: st.proteinPerKg, fatPct: st.fatPct });
      await CRM.store.setSetting(TARGET, { kcal: r.kcal, protein: r.protein, fat: r.fat, carbs: r.carbs, manual: false, date: D.today(), weight: st.weight });
      normDraft = null;
      CRM.router.rerender();
      ui.toast('Норму збережено — її видно в щоденнику й на Головній', { type: 'success' });
    }

    const current = tg
      ? h('section', { class: 'card nut-current' },
        h('div', { class: 'card-body nut-current-body' },
          h('div', { class: 'nut-current-main' },
            h('span', { class: 'nut-current-label' }, 'Моя норма зараз'),
            h('span', { class: 'nut-current-value num' }, `${kc(tg.kcal)} ккал`),
            h('span', { class: 'nut-current-sub' }, `Білки ${gr(tg.protein)} г · Жири ${gr(tg.fat)} г · Вуглеводи ${gr(tg.carbs)} г`),
            h('span', { class: 'nut-current-sub subtle' }, tg.manual ? 'Задано вручну' : `Розраховано ${fmt.date(tg.date) || ''}${tg.weight ? ` для ваги ${dec(tg.weight)} кг` : ''}`)),
          ui.button({ label: 'Задати вручну', icon: 'pencil', size: 'sm', onClick: manualDialog })))
      : h('section', { class: 'card nut-current' },
        h('div', { class: 'card-body nut-current-body' },
          h('div', { class: 'nut-current-main' },
            h('span', { class: 'nut-current-label' }, 'Норму ще не збережено'),
            h('span', { class: 'nut-current-sub' }, 'Заповни калькулятор нижче й натисни «Зберегти як мою норму». Або задай свої числа, якщо їх порадив тренер чи дієтолог.')),
          ui.button({ label: 'Задати вручну', icon: 'pencil', size: 'sm', onClick: manualDialog })));

    ui.mount(content, h('div', { class: 'stack' },
      current,
      h('section', { class: 'card' },
        h('div', { class: 'card-head' }, h('h2', null, CRM.icon('flame', { size: 'sm' }), 'Калькулятор норми')),
        h('div', { class: 'card-body nut-norm-grid' },
          h('div', { class: 'form-stack nut-norm-form' },
            h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Стать'), sexSeg),
            h('div', { class: 'form-grid nut-body-grid' }, fAge, fHeight, fWeight),
            h('div', { class: 'field-hint nut-shared-hint' }, CRM.icon('info', { size: 'sm' }), 'Вік, зріст і вага — ті самі, що в «Моїх параметрах» тренувань, і зберігаються лише в даних браузера.'),
            ui.field({ label: 'Активність', input: actSel }),
            h('div', { class: 'field' }, h('span', { class: 'field-label' }, 'Мета'), goalSeg),
            paceWrap,
            h('details', { class: 'nut-more' },
              h('summary', null, 'Точніше налаштування БЖВ'),
              h('div', { class: 'form-grid' }, fP, fFat))),
          result)),
      h('section', { class: 'card' },
        h('details', { class: 'nut-how' },
          h('summary', null, CRM.icon('info', { size: 'sm' }), 'Як це рахується'),
          h('div', { class: 'nut-how-body' },
            h('p', null, h('strong', null, 'Базовий обмін'), ' — формула Міффліна — Сан Жеора: 10 × вага (кг) + 6,25 × зріст (см) − 5 × вік + 5 (для чоловіків) або − 161 (для жінок).'),
            h('p', null, h('strong', null, 'Витрата за день'), ' = базовий обмін × коефіцієнт активності: 1,2 — мінімальна, 1,375 — низька, 1,55 — середня, 1,725 — висока, 1,9 — дуже висока.'),
            h('p', null, h('strong', null, 'Мета'), ': схуднення — мінус 10 / 15 / 20 %, набір маси — плюс 5 / 10 / 15 % (повільно / помірно / швидше). Нижче за базовий обмін норма не опускається.'),
            h('p', null, h('strong', null, 'БЖВ'), ': білок — грамів на кг ваги, жири — частка калорій, вуглеводи — решта. 1 г білка чи вуглеводів ≈ 4 ккал, 1 г жиру ≈ 9 ккал.'),
            h('p', { class: 'subtle' }, 'Це орієнтир для здорових дорослих. Якщо є захворювання, вагітність або особливі потреби — порадься з лікарем чи дієтологом. Стеж за вагою 2–3 тижні й коригуй норму на 100–200 ккал, якщо результат не такий, як хотілося.'))))));
    update();
  }

  function manualDialog() {
    const tg = target() || {};
    const mk = (label, v, ph) => { const input = h('input', { class: 'input', type: 'text', inputmode: 'decimal', value: v ? String(v) : '', placeholder: ph, 'aria-label': label }); return ui.field({ label, input }); };
    const fK = mk('Калорії, ккал', tg.kcal, 'ккал'); const fP = mk('Білки, г', tg.protein, 'г'); const fF = mk('Жири, г', tg.fat, 'г'); const fC = mk('Вуглеводи, г', tg.carbs, 'г');
    const hint = h('div', { class: 'field-hint' });
    const inputs = [fK, fP, fF, fC].map((f) => f.querySelector('input'));
    const upd = () => {
      const [p, f, c] = inputs.slice(1).map((i) => readNum(i));
      if ([p, f, c].every((v) => v != null && !isNaN(v))) hint.textContent = `За БЖВ виходить ≈${kc(p * 4 + f * 9 + c * 4)} ккал.`;
      else hint.textContent = 'Вкажи калорії й грами білків, жирів і вуглеводів на день.';
    };
    inputs.forEach((i) => i.addEventListener('input', upd));
    upd();
    async function save() {
      let ok = true;
      const val = (f, min, max) => {
        const v = readNum(f.querySelector('input'));
        if (v == null || isNaN(v) || v < min || v > max) { f.setError(`Від ${min} до ${fmt.number(max, 0)}`); ok = false; return 0; }
        return Math.round(v);
      };
      const t = { kcal: val(fK, 800, 6000), protein: val(fP, 0, 500), fat: val(fF, 0, 400), carbs: val(fC, 0, 1000) };
      if (!ok) return;
      await CRM.store.setSetting(TARGET, Object.assign(t, { manual: true, date: D.today(), weight: null }));
      dlg.close('force');
      CRM.router.rerender();
      ui.toast('Норму збережено', { type: 'success' });
    }
    const dlg = ui.modal({
      title: 'Моя норма на день', size: 'sm',
      body: h('div', { class: 'form-stack' }, h('div', { class: 'form-grid' }, fK, fP, fF, fC), hint),
      footer: [ui.button({ label: 'Скасувати', onClick: () => dlg.close('button') }), ui.button({ label: 'Зберегти', icon: 'check', variant: 'primary', onClick: save })]
    });
  }

  // ---------- Вкладка «Продукти» ----------
  function foodRow(f) {
    const badges = [];
    if (!f.builtin) badges.push(h('span', { class: 'badge badge-accent' }, f.baseId ? 'змінено' : f.kind === 'dish' ? 'моя страва' : 'мій'));
    return h('div', { class: 'nut-food-row', role: 'button', tabIndex: 0, dataset: { id: f.id },
      onClick: () => openFoodForm(f),
      onKeydown: (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) openFoodForm(f); } },
    h('span', { class: 'nut-entry-main' },
      h('span', { class: 'nut-entry-name' }, f.name, badges),
      h('span', { class: 'nut-entry-sub' }, per100Text(f) + (f.portion ? ' · ' + portionText(f.portion) : ''))),
    h('span', { class: 'nut-food-kcal num' }, kc(f.kcal), h('span', { class: 'nut-unit' }, ' ккал')),
    ui.button({ icon: 'plus', iconOnly: true, size: 'sm', variant: 'ghost', title: 'Додати в щоденник', onClick: (e) => { e.stopPropagation(); openAdd({ date: D.today(), food: f }); } }));
  }

  function foodsTab(content) {
    const listBox = h('div', { class: 'tx-list nut-food-list' });
    const searchIn = h('input', { class: 'input input-sm', type: 'text', placeholder: 'Пошук продукту', 'aria-label': 'Пошук продукту', value: foodQuery, autocomplete: 'off' });
    const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Категорія' });
    function renderChips() {
      const opts = [{ id: 'all', label: 'Усі' }, { id: 'mine', label: 'Мої' }].concat(CATS);
      ui.mount(chips, opts.map((c) => h('button', {
        type: 'button', class: 'chip' + (foodFilter === c.id ? ' active' : ''), 'aria-pressed': foodFilter === c.id ? 'true' : 'false',
        onClick: () => { foodFilter = c.id; renderChips(); renderList(); }
      }, c.label)));
    }
    function renderList() {
      const q = foodQuery.trim();
      let items = q ? searchFoods(q, 500) : allFoods();
      if (foodFilter === 'mine') items = items.filter((f) => !f.builtin);
      else if (foodFilter !== 'all') items = items.filter((f) => (f.cat || 'other') === foodFilter);
      if (!items.length) {
        ui.mount(listBox, ui.empty({
          icon: 'apple', small: true,
          title: foodFilter === 'mine' && !q ? 'Своїх продуктів ще немає' : 'Нічого не знайдено',
          text: foodFilter === 'mine' && !q ? 'Додай продукт з етикетки (калорії й БЖВ на 100 г) або страву з інгредієнтів.' : null,
          action: { label: q ? `Створити «${q}»` : 'Новий продукт', icon: 'plus', onClick: () => openFoodForm(null, { name: q }) }
        }));
        return;
      }
      const groups = new Map();
      if (!q) {
        const mine = items.filter((f) => !f.builtin);
        if (mine.length && foodFilter === 'all') groups.set('mine', mine);
        CATS.forEach((c) => {
          const arr = items.filter((f) => (f.cat || 'other') === c.id && (foodFilter !== 'all' || f.builtin));
          if (arr.length) groups.set(c.id, arr.sort((a, b) => a.name.localeCompare(b.name, 'uk')));
        });
      } else groups.set('found', items);
      const title = (id) => (id === 'mine' ? 'Мої продукти й страви' : id === 'found' ? `Знайдено: ${items.length}` : CRM.dict.label('foodCategories', id));
      ui.mount(listBox, Array.from(groups.entries()).map(([id, arr]) => h('div', { class: 'day-group' },
        h('div', { class: 'day-head' }, h('span', { class: 'day-name' }, title(id)), h('span', { class: 'day-total' }, 'на 100 г')),
        arr.map(foodRow))));
    }
    searchIn.addEventListener('input', () => { foodQuery = searchIn.value; renderList(); });
    renderChips();
    renderList();
    ui.mount(content, h('div', { class: 'stack' },
      h('section', { class: 'card' },
        h('div', { class: 'card-head nut-foods-head' },
          h('div', { class: 'tx-search nut-food-search' }, CRM.icon('search', { size: 'sm' }), searchIn),
          h('div', { class: 'btn-row' },
            ui.button({ label: 'Продукт', icon: 'plus', size: 'sm', onClick: () => openFoodForm(null) }),
            ui.button({ label: 'Страва', icon: 'plus', size: 'sm', onClick: () => openFoodForm(null, { kind: 'dish' }) }))),
        h('div', { class: 'nut-foods-chips' }, chips),
        listBox),
      h('p', { class: 'toolbar-note subtle' }, 'Значення вбудованих продуктів — орієнтовні середні (за таблицями USDA й типовими етикетками). Для точності бери дані з упаковки: будь-який продукт можна змінити або додати свій.')));
  }

  // ---------- Форма продукту / страви ----------
  /**
   * food — наявний продукт (вбудований або свій) чи null для нового.
   * opts: { kind: 'product' | 'dish', name, onSaved(food) }
   */
  function openFoodForm(food, opts) {
    const o = opts || {};
    const isBuiltin = !!(food && food.builtin);
    const isNew = !food || isBuiltin;
    const kind = food ? (food.kind || 'product') : (o.kind || 'product');
    const isDish = kind === 'dish' && !isBuiltin;
    const st = {
      name: food ? food.name : (o.name || ''),
      cat: food ? (food.cat || 'other') : (isDish ? 'dish' : 'other'),
      ingredients: food && food.ingredients ? U.deepClone(food.ingredients) : [],
      yield: food && food.yield ? food.yield : null
    };

    const nameIn = ui.input({ value: st.name, maxlength: 80, placeholder: isDish ? 'напр., Сирники домашні' : 'напр., Йогурт «Галичина» 1,5%', 'aria-label': 'Назва' });
    const fName = ui.field({ label: 'Назва', input: nameIn, required: true });
    const catSel = ui.select(CATS.map((c) => ({ value: c.id, label: c.label })), { value: st.cat, 'aria-label': 'Категорія' });
    const fCat = ui.field({ label: 'Категорія', input: catSel });
    const numIn = (label, v, ph) => h('input', { class: 'input', type: 'text', inputmode: 'decimal', value: v != null && v !== '' ? dec(v) : '', placeholder: ph, 'aria-label': label });
    const kIn = numIn('Калорії, ккал', food ? food.kcal : null, 'ккал');
    const pIn = numIn('Білки, г', food ? food.p : null, 'г');
    const fIn = numIn('Жири, г', food ? food.f : null, 'г');
    const cIn = numIn('Вуглеводи, г', food ? food.c : null, 'г');
    const fK = ui.field({ label: 'Калорії, ккал', input: kIn });
    const fP = ui.field({ label: 'Білки, г', input: pIn });
    const fF = ui.field({ label: 'Жири, г', input: fIn });
    const fC = ui.field({ label: 'Вуглеводи, г', input: cIn });
    const macroHint = h('div', { class: 'field-hint' });
    const updMacroHint = () => {
      const [p, f, c] = [pIn, fIn, cIn].map((i) => readNum(i));
      if ([p, f, c].some((v) => v != null && !isNaN(v))) macroHint.textContent = `За БЖВ виходить ≈${kc((p || 0) * 4 + (f || 0) * 9 + (c || 0) * 4)} ккал. Якщо калорії не вказано, візьмемо це число.`;
      else macroHint.textContent = 'Дивись на етикетці: «Харчова цінність на 100 г».';
    };
    [kIn, pIn, fIn, cIn].forEach((i) => i.addEventListener('input', updMacroHint));
    updMacroHint();

    const porLabelIn = ui.input({ value: food && food.portion ? food.portion.label : '', maxlength: 20, placeholder: isDish ? 'порція' : 'шт', 'aria-label': 'Назва порції' });
    const porGramsIn = h('input', { class: 'input', type: 'text', inputmode: 'decimal', value: food && food.portion ? dec(food.portion.grams) : '', placeholder: 'г', 'aria-label': 'Вага порції, г' });
    const fPorLabel = ui.field({ label: 'Порція (необовʼязково)', input: porLabelIn });
    const fPorGrams = ui.field({ label: 'Вага порції, г', input: porGramsIn, hint: isDish ? 'Щоб записувати страву порціями.' : 'Напр., 1 шт = 55 г — тоді можна записувати штуками.' });

    // Страва з інгредієнтів
    const ingBox = h('div', { class: 'nut-ings' });
    const dishSum = h('div', { class: 'nut-dish-sum', 'aria-live': 'polite' });
    const yieldIn = h('input', { class: 'input', type: 'text', inputmode: 'decimal', value: st.yield ? gr(st.yield) : '', placeholder: 'г', 'aria-label': 'Вага готової страви, г' });
    const fYield = ui.field({ label: 'Вага готової страви, г', input: yieldIn, hint: 'Зваж готову страву: під час варіння вода випаровується або вбирається. Не знаєш — лиши порожнім, візьмемо суму інгредієнтів.' });
    const pickerIn = h('input', { class: 'input', type: 'text', placeholder: 'Додати інгредієнт: пошук продукту', 'aria-label': 'Пошук інгредієнта', autocomplete: 'off' });
    const pickerList = h('div', { class: 'nut-results nut-picker-list' });
    let pickerItems = [];
    function renderPicker() {
      const q = pickerIn.value.trim();
      pickerItems = q ? searchFoods(q, 8).filter((f) => !food || f.id !== food.id) : [];
      pickerList.hidden = !q;
      ui.mount(pickerList, pickerItems.length ? pickerItems.map((f) => resultRow(f, addIngredient)) : q ? h('div', { class: 'nut-results-hint' }, 'Нічого не знайдено — спершу створи цей продукт.') : null);
    }
    function addIngredient(f) {
      st.ingredients.push({ foodId: f.id, name: f.name, grams: f.portion ? f.portion.grams : 100, per100: per100Of(f) });
      pickerIn.value = '';
      renderPicker();
      renderIngredients();
      const inputs = ingBox.querySelectorAll('.nut-ing-grams');
      if (inputs.length) { inputs[inputs.length - 1].focus(); inputs[inputs.length - 1].select(); }
    }
    pickerIn.addEventListener('input', renderPicker);
    pickerIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); if (pickerItems[0]) addIngredient(pickerItems[0]); } });
    function dishTotals() {
      const raw = st.ingredients.reduce((s, ing) => add(s, entryTotals({ per100: ing.per100, grams: num(ing.grams) })), ZERO());
      const rawGrams = st.ingredients.reduce((s, ing) => s + num(ing.grams), 0);
      const y = readNum(yieldIn);
      const weight = y && !isNaN(y) && y > 0 ? y : rawGrams;
      const k = weight > 0 ? 100 / weight : 0;
      return { raw, rawGrams, weight, per100: { kcal: r1(raw.kcal * k), p: r1(raw.p * k), f: r1(raw.f * k), c: r1(raw.c * k) } };
    }
    function renderDishSum() {
      if (!st.ingredients.length) { ui.mount(dishSum, h('span', { class: 'subtle' }, 'Додай інгредієнти — калорії на 100 г порахуються самі.')); return; }
      const t = dishTotals();
      yieldIn.placeholder = gr(t.rawGrams) + ' г';
      ui.mount(dishSum,
        h('div', null, 'Уся страва: ', h('strong', { class: 'num' }, `${kc(t.raw.kcal)} ккал`), ` · ${gr(t.weight)} г`),
        h('div', null, 'На 100 г: ', h('strong', { class: 'num' }, `${kc(t.per100.kcal)} ккал`), ` · ${per100Text(t.per100)}`));
    }
    function renderIngredients() {
      ui.mount(ingBox, st.ingredients.map((ing, i) => {
        const gIn = h('input', { class: 'input input-sm nut-ing-grams', type: 'text', inputmode: 'decimal', value: gr(ing.grams), 'aria-label': `Грамів: ${ing.name}` });
        const kcalEl = h('span', { class: 'nut-ing-kcal num' });
        const upd = () => { kcalEl.textContent = kc(entryTotals({ per100: ing.per100, grams: num(ing.grams) }).kcal) + ' ккал'; };
        gIn.addEventListener('input', () => { const v = readNum(gIn); ing.grams = v && !isNaN(v) && v > 0 ? r1(v) : 0; upd(); renderDishSum(); });
        upd();
        return h('div', { class: 'nut-ing' },
          h('span', { class: 'nut-ing-name' }, ing.name),
          gIn, h('span', { class: 'nut-unit' }, 'г'), kcalEl,
          h('button', { type: 'button', class: 'btn btn-ghost btn-icon btn-sm', title: 'Прибрати', 'aria-label': `Прибрати ${ing.name}`, onClick: () => { st.ingredients.splice(i, 1); renderIngredients(); } }, CRM.icon('x', { size: 'sm' })));
      }));
      renderDishSum();
    }
    yieldIn.addEventListener('input', renderDishSum);
    if (isDish) renderIngredients();

    async function save() {
      let ok = true;
      const name = nameIn.value.trim();
      if (!name) { fName.setError('Вкажи назву'); ok = false; }
      let values;
      if (isDish) {
        if (!st.ingredients.length) { ui.toast('Додай хоча б один інгредієнт', { type: 'error' }); ok = false; }
        if (st.ingredients.some((i) => !(num(i.grams) > 0))) { ui.toast('Вкажи грами для кожного інгредієнта', { type: 'error' }); ok = false; }
        const y = readNum(yieldIn);
        if (y != null && (isNaN(y) || y <= 0 || y > 50000)) { fYield.setError('Вага в грамах, напр., 850'); ok = false; }
        if (ok) values = dishTotals().per100;
      } else {
        const read = (f, input, max) => {
          const v = readNum(input);
          if (v == null) return null;
          if (isNaN(v) || v < 0 || v > max) { f.setError(`0–${max}`); ok = false; return null; }
          return r1(v);
        };
        const k = read(fK, kIn, 900); const p = read(fP, pIn, 100); const f = read(fF, fIn, 100); const c = read(fC, cIn, 100);
        if (ok && (p || 0) + (f || 0) + (c || 0) > 101) { fC.setError('Разом більше 100 г на 100 г продукту'); ok = false; }
        if (ok && k == null && p == null && f == null && c == null) { fK.setError('Вкажи калорії або БЖВ'); ok = false; }
        if (ok) values = { kcal: k != null ? k : r1((p || 0) * 4 + (f || 0) * 9 + (c || 0) * 4), p: p || 0, f: f || 0, c: c || 0 };
      }
      let portion = null;
      const pg = readNum(porGramsIn);
      if (pg != null) {
        if (isNaN(pg) || pg <= 0 || pg > 5000) { fPorGrams.setError('Вага в грамах'); ok = false; }
        else portion = { label: porLabelIn.value.trim() || (isDish ? 'порція' : 'шт'), grams: r1(pg) };
      }
      if (!ok) return;
      const rec = Object.assign(food && !isBuiltin ? U.deepClone(food) : {}, values, {
        name, cat: isDish ? 'dish' : catSel.value, kind: isDish ? 'dish' : (isBuiltin ? food.kind : 'product'), portion
      });
      if (isBuiltin) rec.baseId = food.id;
      if (isDish) { rec.ingredients = st.ingredients; rec.yield = readNum(yieldIn) || null; }
      const saved = await CRM.store.save('foods', rec);
      dlg.close('force');
      ui.toast(isNew && !isBuiltin ? 'Продукт додано' : 'Зміни збережено', { type: 'success' });
      if (o.onSaved) o.onSaved(saved);
    }

    async function remove() {
      const revert = !!food.baseId;
      const ok = await ui.confirm({
        title: revert ? 'Повернути стандартні значення?' : 'Видалити продукт?',
        message: revert ? `Твої зміни продукту «${food.name}» потраплять у Кошик, а в довіднику знову будуть стандартні значення.`
          : `«${food.name}» потрапить у Кошик. Записи щоденника з ним лишаться як є.`,
        confirmText: revert ? 'Повернути' : 'Видалити', danger: !revert
      });
      if (!ok) return;
      const batch = await CRM.store.softDelete('foods', food.id);
      dlg.close('force');
      ui.toast(revert ? 'Повернуто стандартні значення' : 'Продукт перенесено в Кошик', { action: { label: 'Скасувати', onClick: () => CRM.store.restoreBatch(batch) } });
    }

    const per100Grid = h('div', { class: 'form-grid nut-per100' }, fK, fP, fF, fC);
    const body = h('div', { class: 'form-stack' },
      isBuiltin ? h('div', { class: 'callout' }, CRM.icon('info'), h('span', null, 'Це продукт із вбудованого довідника. Твої значення збережуться як твоя версія, а стандартні можна буде повернути.')) : null,
      fName,
      isDish ? null : fCat,
      isDish
        ? h('section', { class: 'editor-section' },
          h('div', { class: 'section-head' }, h('h3', null, CRM.icon('listChecks', { size: 'sm' }), 'Інгредієнти (сирі, у грамах)')),
          ingBox, h('div', { class: 'nut-picker' }, pickerIn, pickerList), fYield, dishSum)
        : h('section', { class: 'editor-section' },
          h('div', { class: 'section-head' }, h('h3', null, CRM.icon('flame', { size: 'sm' }), 'На 100 г')),
          per100Grid, macroHint),
      h('div', { class: 'form-grid' }, fPorLabel, fPorGrams));
    pickerList.hidden = true;

    const canDelete = food && !isBuiltin;
    const dlg = ui.modal({
      title: isBuiltin ? 'Змінити продукт' : food ? (isDish ? 'Страва' : 'Продукт') : (isDish ? 'Нова страва' : 'Новий продукт'),
      className: 'nut-food-modal' + (isDish ? ' modal-lg' : ''),
      body,
      footer: [
        canDelete ? ui.button({ label: food.baseId ? 'Повернути стандартні' : 'Видалити', icon: food.baseId ? 'restore' : 'trash', variant: food.baseId ? 'ghost' : 'danger-ghost', onClick: remove }) : null,
        food ? ui.button({ label: 'У щоденник', icon: 'plus', variant: 'ghost', onClick: () => { dlg.close('force'); openAdd({ date: D.today(), food: getFood(food.id) || food }); } }) : null,
        h('span', { class: 'grow' }),
        ui.button({ label: 'Скасувати', onClick: () => dlg.close('button') }),
        ui.button({ label: isNew && !isBuiltin ? 'Додати' : 'Зберегти', icon: 'check', variant: 'primary', onClick: save })],
      initialFocus: food ? 'container' : nameIn
    });
    body.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && e.target.tagName === 'INPUT' && e.target !== pickerIn) { e.preventDefault(); save(); }
    });
    return dlg;
  }

  // ---------- Картка на Головній ----------
  function homeCard() {
    const T = D.today();
    const tg = target();
    const tot = totalsFor(T);
    const any = entriesOn(T).length > 0;
    const head = h('div', { class: 'card-head' },
      h('h2', null, 'Харчування сьогодні'),
      h('div', { class: 'btn-row' },
        ui.button({ icon: 'plus', iconOnly: true, size: 'sm', variant: 'ghost', title: 'Додати їжу', onClick: () => openAdd({ date: T }) }),
        h('a', { href: '#/nutrition', class: 'btn btn-ghost btn-sm' }, 'Щоденник', CRM.icon('chevronRight', { size: 'sm' }))));
    let body;
    if (!tg && !any) {
      body = h('div', { class: 'card-body nut-home-empty' },
        h('p', { class: 'subtle' }, 'Порахуй денну норму калорій і БЖВ та записуй, що їси, — тут буде видно, скільки ще лишилось.'),
        h('div', { class: 'btn-row' },
          h('a', { href: '#/nutrition/norm', class: 'btn btn-sm' }, CRM.icon('flame', { size: 'sm' }), 'Порахувати норму'),
          ui.button({ label: 'Додати їжу', icon: 'plus', size: 'sm', onClick: () => openAdd({ date: T }) })));
    } else {
      const left = tg ? tg.kcal - tot.kcal : 0;
      body = h('div', { class: 'card-body nut-home' },
        h('div', { class: 'nut-ring nut-ring-sm' }, ring(tot.kcal, tg ? tg.kcal : 0),
          h('div', { class: 'nut-ring-center' }, h('span', { class: 'nut-ring-value num' }, kc(tot.kcal)), h('span', { class: 'nut-ring-label' }, 'ккал'))),
        h('div', { class: 'nut-home-side' },
          h('div', { class: 'nut-home-line' },
            tg ? [h('strong', { class: 'num' }, `${kc(tot.kcal)} з ${kc(tg.kcal)} ккал`),
              h('span', { class: left >= 0 ? 'subtle' : 'nut-over-text' }, left >= 0 ? ` · залишилось ${kc(left)}` : ` · понад норму на ${kc(-left)}`)]
              : [h('strong', { class: 'num' }, `${kc(tot.kcal)} ккал`), h('span', { class: 'subtle' }, ' · норму не задано')]),
          h('div', { class: 'nut-macros nut-macros-sm' },
            macroRow('p', 'Білки', tot.p, tg ? tg.protein : 0),
            macroRow('f', 'Жири', tot.f, tg ? tg.fat : 0),
            macroRow('c', 'Вуглеводи', tot.c, tg ? tg.carbs : 0))));
    }
    return h('section', { class: 'card nut-home-card' }, head, body);
  }

  CRM.router.register('nutrition', { title: 'Харчування', stores: ['meals', 'foods'], render });
  CRM.nutrition = {
    BUILTIN, ACTIVITY, calc, target, profile, entryTotals, totalsFor, entriesOn, searchFoods, getFood, allFoods,
    openAdd, openEntry, openFoodForm, homeCard
  };
})(window.CRM);
