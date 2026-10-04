/* ==========================================================================
   program.js — програма тренувань «Верх тіла, 30 хв» (12 тижнів, 84 дні).

   • План на кожен день: адаптація (Ф1/Ф2), основа (A → B → C → відпочинок),
     розвантаження, ускладнення, тести сили.
   • Картка на сторінці «Тренування»: день, вправи з підходами, розминка,
     підказки техніки й відео, календар 12 тижнів із позначками виконаного.
   • «Записати тренування» відкриває форму журналу з уже вписаними вправами.
     Виконане визначається за записами журналу (поле program { run, day }),
     тож видалення / відновлення з Кошика одразу змінює позначки.
   • Тренування дня потрапляє в розклад на Головній.
   • З 04.10.2026 картка живе у вкладці «Тренування → Програми» (сторінка
     #/training/program/upper30); програма також дає дані для тижневого списку
     й «Сьогоднішнього тренування» (dayInfo, summary) — див. programs.js.

   Налаштування: trainingProgram = { id, run, startDate } (потрапляє в експорт).
   Особисті параметри (вік, зріст, вага, стартові результати) користувач вписує
   сам у «Мої параметри» — вони зберігаються лише в його браузері (налаштування
   trainingProfile, потрапляє в резервну копію), а не в коді сайту.
   ========================================================================== */
window.CRM = window.CRM || {};

(function (CRM) {
  'use strict';

  const { h, ui } = { h: CRM.ui.h, ui: CRM.ui };
  const D = CRM.date;
  const fmt = CRM.fmt;

  const PROGRAM_ID = 'upper30';
  const PROGRAM_NAME = 'Верх тіла, 30 хв';
  const DAYS = 84;
  const SETTING = 'trainingProgram';
  const PROFILE = 'trainingProfile';
  const COLOR = 'violet'; // колір програми в тижневому списку й на Головній

  // ---------- Бібліотека вправ ----------
  const EX = {
    scap: { n: 'Скапулярні підтягування', v: 'https://www.youtube.com/watch?v=-ZIpSoTRsuE', c: [
      'Руки прямі весь час, рухаються лише лопатки.',
      'Тягни плечі вниз, «від вух», і злегка зведи лопатки.',
      '1 с утримання вгорі, повільне повернення у вис.'] },
    pull: { n: 'Підтягування прямим хватом', c: [
      'Хват трохи ширший за плечі, долоні від себе.',
      'Перед рухом «встанови» лопатки вниз, як у скапулярних.',
      'Думай «тягну лікті до ребер», а не «тягну себе руками».',
      'Підборіддя над перекладиною, груди тягнуться до турніка.',
      'Внизу повністю випрямляй руки. Без розгойдування і ривків ногами.'] },
    chin: { n: 'Підтягування зворотним хватом', c: [
      'Долоні до себе, хват на ширині плечей.',
      'Більше працює біцепс — відчуй його скорочення вгорі.',
      'Лікті йдуть вниз і трохи назад, корпус не розгойдується.'] },
    neg: { n: 'Негативні підтягування', v: 'https://www.youtube.com/watch?v=sQyCyQcfXCw', c: [
      'Застрибни або стань на стілець так, щоб підборіддя було над перекладиною.',
      'Опускайся рівно 5 с (рахуй уголос), рівномірно, без «падіння» в кінці.',
      'Лопатки тримай зведеними і опущеними до самого низу.'] },
    pausepull: { n: 'Підтягування з паузою 2 с вгорі', c: [
      'Звичайне підтягування, але вгорі зупинка на 2 с з підборіддям над перекладиною.',
      'Під час паузи груди тягнуться до турніка, плечі не піднімаються до вух.'] },
    weightpull: { n: 'Підтягування з гантеллю між стопами', c: [
      'Затисни одну гантель між стопами (схрести гомілки) і перевір, що тримається надійно.',
      'Техніка як у звичайних підтягуваннях: лопатки вниз, лікті до ребер, підборіддя над перекладиною.',
      'Якщо гантель вислизає або з\'являються ривки — повертайся до підтягувань без ваги.'] },
    push: { n: 'Віджимання класичні', c: [
      'Долоні трохи ширші за плечі, під плечима або трохи нижче.',
      'Тіло — пряма лінія: сідниці і прес напружені, таз не провисає і не задирається.',
      'Лікті під кутом ≈45° до корпусу, а не в сторони.',
      'Груди опускаються майже до підлоги, вгорі руки повністю випрямлені.'] },
    narrow: { n: 'Вузькі віджимання', c: [
      'Долоні вужче за плечі (можна трикутником — «алмазні», якщо зап\'ястям комфортно).',
      'Лікті ковзають вздовж корпусу, назад.',
      'Фокус на трицепсі: вгорі повністю випрямляй руки і відчуй його скорочення.'] },
    pike: { n: 'Pike-віджимання', v: 'https://www.youtube.com/watch?v=pHR5yG6xBps', c: [
      'Таз високо вгору, тіло схоже на перевернуту літеру «V».',
      'Опускай голову вперед, трохи попереду долонь: голова і руки утворюють трикутник.',
      'Лікті не розводь сильно в сторони.',
      'Навантаження — на плечі.'] },
    decline: { n: 'Віджимання з ногами на підвищенні', c: [
      'Стопи на стільці або дивані (≈40–50 см).',
      'Пряма лінія тіла, особливо не провисай у попереку.',
      'Акцент на верх грудей і передню частину плечей.'] },
    archer: { n: 'Лучник-віджимання (archer)', v: 'https://www.youtube.com/watch?v=MxVbNel13Ek', c: [
      'Широка постановка рук.',
      'Опускайся до однієї руки, друга майже випрямлена і лише допомагає.',
      'Корпус не перекошується, таз паралельно підлозі.',
      'Якщо важко — зменш амплітуду або постав руки трохи вужче.'] },
    row: { n: 'Тяга гантелі однією рукою', v: 'https://www.youtube.com/watch?v=tLnlWj7LQ34', c: [
      'Вільна рука і коліно — на стілець або диван, спина рівна, паралельна підлозі.',
      'Тягни лікоть назад до стегна дугою, а не прямо вгору до плеча.',
      'Вгорі стисни спину; внизу повністю розтягни руку, дай лопатці піти вперед.',
      'Корпус не розвертається під час руху.'] },
    press: { n: 'Жим гантелей стоячи', c: [
      'Прес і сідниці напружені, поперек не прогинається.',
      'Старт: гантелі на рівні плечей, лікті трохи попереду корпусу.',
      'Вижимай вгору, наприкінці гантелі трохи сходяться над головою.',
      'Опускай повільно до рівня вух або трохи нижче.'] },
    lateral: { n: 'Махи гантелями в сторони', v: 'https://www.youtube.com/watch?v=pgrWjBfaFe8', c: [
      'Лікті трохи зігнуті, піднімай до рівня плечей, не вище.',
      'Думай «розводжу руки в сторони» — рух веде лікоть.',
      'Без розгойдування корпусом. Плечі не підтягуються до вух.',
      'Якщо гантелі занадто важкі — роби по одній руці, тримаючись за опору, і сповільни опускання.'] },
    rear: { n: 'Розведення гантелей у нахилі', v: 'https://www.youtube.com/watch?v=buuYPLVXsJg', c: [
      'Нахил майже паралельно підлозі, спина рівна, коліна злегка зігнуті.',
      'Руки розводяться в сторони дугою, лікті трохи зігнуті.',
      'Фокус на задній частині плеча; лопатки сильно не зводь.',
      'Шию не задирай, дивись у підлогу.'] },
    curl: { n: 'Підйом гантелей на біцепс', c: [
      'Лікті притиснуті до корпусу і нерухомі.',
      'Під час підйому розвертай долоню вгору, вгорі стисни біцепс.',
      'Опускання 2–3 с до повного випрямлення руки.',
      'Корпус не розгойдується.'] },
    hammer: { n: 'Молоткові підйоми', c: [
      'Долоні дивляться одна на одну весь рух.',
      'Лікті нерухомі, піднімай до рівня плеча.',
      'Працюють плечовий м\'яз і передпліччя — руки виглядають «товщими».'] },
    french: { n: 'Французький жим однією гантеллю двома руками', v: 'https://www.youtube.com/watch?v=X-iV-cG8cYs', c: [
      'Тримай гантель за верхній диск обома долонями над головою.',
      'Лікті дивляться вперед і не розходяться в сторони.',
      'Опускай гантель за голову до глибокого розтягнення трицепса, піднімай до повного випрямлення.',
      'Прес напружений, поперек не прогинається. Можна виконувати сидячи.'] }
  };

  const WARMUP = [
    'Скапулярні підтягування — 1×10',
    'Легкі віджимання — 1×8, повільно',
    'Жим гантелей стоячи — 1×8, без зусиль',
    'Розведення гантелей у нахилі — 1×10'
  ];

  // ---------- План ----------
  /** Пункт плану: e — ключ вправи або [ключі] для суперсету; s — підходи, r — відпочинок. */
  const it = (e, s, r, note, title) => ({ e, s, r, note: note || '', t: title || '' });
  const pick = (map, w) => map[w];

  function F1(w) {
    return [
      it('pull', pick({ 1: '3×4', 2: '4×4' }, w), '90 с'),
      it('push', pick({ 1: '3×10', 2: '3×12' }, w), '90 с', 'Темп 2-1-1.'),
      it('row', pick({ 1: '2×12', 2: '3×12' }, w), '90 с', 'Кількість — на кожну руку.'),
      it('hammer', pick({ 1: '2×10', 2: '3×10' }, w), '90 с')
    ];
  }
  function F2(w) {
    return [
      it('chin', pick({ 1: '3×4', 2: '4×4' }, w), '90 с'),
      it('press', pick({ 1: '3×10', 2: '3×12' }, w), '90 с'),
      it('narrow', pick({ 1: '2×8', 2: '3×8' }, w), '90 с'),
      it('rear', pick({ 1: '2×12', 2: '3×12' }, w), '90 с')
    ];
  }
  function A(w) {
    if (w === 7 || w === 12) {
      return [
        it('pull', '3×6', '90–120 с'),
        it('row', '2×15', '60 с', 'На кожну руку. Пауза 1 с вгорі.'),
        it('neg', '1×3', '90 с', 'Опускання 5 с.'),
        it('curl', '2×12', '60 с')
      ];
    }
    if (w <= 6) {
      return [
        it('pull', pick({ 3: '5×5', 4: '5×6', 5: '5×7', 6: '5×7' }, w), '90–120 с'),
        it('row', pick({ 3: '3×12', 4: '3×15', 5: '3×15', 6: '3×18' }, w), '60 с', 'На кожну руку. Пауза 1 с вгорі.'),
        it('neg', pick({ 3: '2×3', 4: '2×3', 5: '2×4', 6: '2×4' }, w), '90 с', 'Опускання 5 с.'),
        it('curl', pick({ 3: '3×10', 4: '3×12', 5: '3×13', 6: '3×15' }, w), '60 с')
      ];
    }
    const p = w === 11
      ? it('weightpull', '4×4', '2 хв', 'Якщо в тижні 10 всі 5×8 не вийшли чисто — замість цього зроби 5×8 без ваги.')
      : it('pull', pick({ 8: '5×6', 9: '5×7', 10: '5×8' }, w), '2 хв');
    return [
      p,
      it('row', pick({ 8: '3×15', 9: '3×15', 10: '3×18', 11: '3×20' }, w), '60 с', 'На кожну руку. Пауза 2 с вгорі, опускання 3 с.'),
      it('pausepull', w <= 9 ? '2×3' : '2×4', '90 с'),
      it(['curl', 'hammer'], w <= 9 ? '3 × (12 + макс.)' : '3 × (15 + макс.)', '60 с після пари',
        'Спочатку підйоми на біцепс, одразу без відпочинку — молоткові до ЗП 1.', 'Біцепс → одразу молоткові')
    ];
  }
  function B(w) {
    if (w === 7 || w === 12) {
      return [
        it('push', '2×12', '90 с', 'Темп 3-1-1.'),
        it('pike', '2×8', '90 с'),
        it('press', '2×12', '60–75 с'),
        it('narrow', '1×10', '60 с')
      ];
    }
    if (w <= 6) {
      return [
        it('push', pick({ 3: '4×10', 4: '4×12', 5: '4×13', 6: '4×15' }, w), '90 с', 'Темп 3-1-1.'),
        it('pike', pick({ 3: '3×6', 4: '3×8', 5: '3×9', 6: '3×10' }, w), '90 с'),
        it('press', pick({ 3: '3×10', 4: '3×12', 5: '3×13', 6: '3×15' }, w), '60–75 с'),
        it('narrow', pick({ 3: '2×8', 4: '2×10', 5: '2×11', 6: '2×12' }, w), '60 с')
      ];
    }
    return [
      it('decline', pick({ 8: '4×10', 9: '4×10', 10: '4×12', 11: '4×14' }, w), '90 с'),
      it('archer', pick({ 8: '3×4', 9: '3×4', 10: '3×5', 11: '3×6' }, w), '90 с', 'Кількість — на кожну сторону.'),
      it('pike', w <= 9 ? '3×8' : '3×10', '90 с', 'Темп 3-1-1.'),
      it('press', w <= 9 ? '3×12' : '3×15', '60 с', 'Пауза 1 с внизу.'),
      it('narrow', w <= 9 ? '1 × до ЗП 1' : '2 × до ЗП 1', '60 с')
    ];
  }
  function C(w) {
    const superset = (s) => it(['french', 'hammer'], s, '60 с після пари', 'Суперсет: дві вправи підряд без відпочинку, потім пауза.', 'Суперсет: французький жим + молоткові');
    if (w === 7 || w === 12) {
      return [it('chin', '2×6', '90–120 с'), it('lateral', '2×12', '60 с'), it('rear', '2×15', '60 с'), superset('2 × (12 + 12)')];
    }
    if (w <= 6) {
      return [
        it('chin', pick({ 3: '4×5', 4: '4×6', 5: '4×6', 6: '4×7' }, w), '90–120 с'),
        it('lateral', pick({ 3: '3×10', 4: '3×12', 5: '3×13', 6: '3×15' }, w), '60 с'),
        it('rear', pick({ 3: '3×12', 4: '3×15', 5: '3×15', 6: '3×15' }, w), '60 с'),
        superset(pick({ 3: '3 × (10 + 10)', 4: '3 × (12 + 12)', 5: '3 × (13 + 12)', 6: '3 × (15 + 12)' }, w))
      ];
    }
    return [
      it('chin', pick({ 8: '4×6', 9: '4×7', 10: '4×7', 11: '4×8' }, w), '90–120 с'),
      it('lateral', w <= 9 ? '4×12' : '4×15', '60 с', 'В останньому підході одразу додай 8 неповних повторень у верхній половині руху.'),
      it('rear', pick({ 8: '3×15', 9: '3×15', 10: '3×18', 11: '3×20' }, w), '60 с'),
      superset(w <= 9 ? '3 × (15 + 12)' : '3 × (15 + 15)')
    ];
  }
  const TEST = () => [
    it('pull', '1 × максимум', '3–5 хв', 'Тільки чисті повторення: повне випрямлення внизу, підборіддя над перекладиною, без ривків.'),
    it('push', '1 × максимум', '', 'Тільки з правильною технікою.')
  ];

  const PHASES = [
    { id: 'adapt', name: 'Адаптація', color: 'aqua' },
    { id: 'base', name: 'Основа', color: 'blue' },
    { id: 'deload', name: 'Розвантаження', color: 'yellow' },
    { id: 'hard', name: 'Ускладнення', color: 'violet' },
    { id: 'test', name: 'Тест сили', color: 'orange' }
  ];
  const PHASE = Object.fromEntries(PHASES.map((p) => [p.id, p]));
  const RIR = { adapt: '3–4', base: '1–2', deload: '3–4', hard: '1–2, у позначених підходах — 0–1' };
  const TITLES = { F1: 'Ф1 · адаптація', F2: 'Ф2 · адаптація', A: 'A · спина і біцепс', B: 'B · груди, плечі, трицепс', C: 'C · плечі і руки', R: 'Відпочинок', T: 'Тест сили' };
  const CODE = { F1: 'Ф1', F2: 'Ф2', A: 'A', B: 'B', C: 'C', R: '—', T: 'Т' };

  function phaseOfWeek(w) {
    if (w <= 2) return 'adapt';
    if (w <= 6) return 'base';
    if (w === 7 || w === 12) return 'deload';
    return 'hard';
  }

  /** План дня d (1…84). start — дата старту, щоб підписати дати в нотатках. */
  function planFor(d, start) {
    const w = Math.ceil(d / 7);
    let type;
    if (d <= 14) {
      type = ['F1', 'R', 'F2', 'R', 'F1', 'F2', 'R'][(d - 1) % 7];
      if (d === 14) type = 'T';
    } else {
      type = ['A', 'B', 'C', 'R'][(d - 15) % 4];
      if (d === 50 || d === DAYS) type = 'T';
    }
    const trainPhase = phaseOfWeek(w);
    const items = { F1, F2, A, B, C }[type] ? { F1, F2, A, B, C }[type](w) : type === 'T' ? TEST() : null;
    let dur = '';
    let minutes = null;
    if (type === 'F1' || type === 'F2') { dur = '20–25 хв'; minutes = 25; } else if (type === 'T') { dur = '≈15 хв'; minutes = 15; } else if (type !== 'R') {
      if (trainPhase === 'deload') { dur = '15–20 хв'; minutes = 20; } else { dur = '25–30 хв'; minutes = 30; }
    }
    const on = (n) => (start ? fmt.dateShort(D.addDays(start, n - 1)) : `дня ${n}`);
    const notes = [];
    if (d === 1) notes.push('Старт! Перед тренуванням зроби фото і заміри: рука, груди, плечі.');
    if (d === 14) notes.push('Перший тест: максимум чистих підтягувань і віджимань за один підхід. Ці цифри — твоя стартова точка.');
    if (d === 15) notes.push('Починається основна фаза: тренування по колу A → B → C → відпочинок. Останні повторення мають даватися важко.');
    if (d === 29 || d === 57) notes.push('Сьогодні день фото і замірів — зроби їх зранку.');
    if (d === 43 || d === 78) notes.push('Тиждень розвантаження: підходів менше, навантаження легше. Це стратегія, а не лінь — після нього сила зазвичай зростає.');
    if (d === 50) notes.push(`Тест після тижня розвантаження. Порівняй з результатами ${on(14)}.`);
    if (d === 51) notes.push('Починається фаза ускладнення: нові вправи і паузи.');
    if (d === DAYS) notes.push(`Фінальний тест програми. Порівняй з ${on(14)} і ${on(50)}. Сьогодні також день фото і замірів.`);
    if (type === 'R' && !notes.length) notes.push('Сьогодні м\'язи відновлюються — саме в цей час вони ростуть. За бажанням — прогулянка 20–30 хв.');
    return { d, w, type, phase: type === 'T' ? 'test' : trainPhase, trainPhase, items, dur, minutes, note: notes.join(' ') };
  }

  /** «3×12–15» → { n: 3, reps: [12] }; «3 × (12 + макс.)» → { n: 3, reps: [12, null] }. */
  function parseSets(s, count) {
    const m = /^(\d+)\s*×\s*(.*)$/.exec(String(s).trim());
    if (!m) return { n: 1, reps: new Array(count).fill(null) };
    const n = Number(m[1]);
    const rest = m[2].trim();
    const num = (x) => { const v = parseInt(x, 10); return Number.isFinite(v) ? v : null; };
    if (rest.startsWith('(')) {
      const parts = rest.replace(/[()]/g, '').split('+').map((x) => num(x.trim()));
      return { n, reps: Array.from({ length: count }, (_, i) => (parts[i] !== undefined ? parts[i] : null)) };
    }
    return { n, reps: new Array(count).fill(num(rest)) };
  }

  /** Заготовка для форми журналу. */
  function presetFor(plan, date) {
    const exercises = [];
    (plan.items || []).forEach((x) => {
      const keys = Array.isArray(x.e) ? x.e : [x.e];
      const ps = parseSets(x.s, keys.length);
      keys.forEach((k, i) => {
        exercises.push({ name: EX[k].n, sets: Array.from({ length: ps.n }, () => ({ reps: ps.reps[i], weight: null })) });
      });
    });
    const c = cfg();
    return {
      type: 'home', date, title: TITLES[plan.type], durationMin: plan.minutes, distanceKm: null,
      exercises, note: '', program: { id: PROGRAM_ID, run: c.run, day: plan.d }
    };
  }

  // ---------- Стан ----------
  function cfg() { const c = CRM.store.getSetting(SETTING, null); return c && c.id === PROGRAM_ID && c.startDate ? c : null; }
  function dayIndex(date) { const c = cfg(); return c ? D.diffDays(c.startDate, date) + 1 : null; }
  function dateOfDay(d) { const c = cfg(); return c ? D.addDays(c.startDate, d - 1) : null; }
  function doneMap() {
    const c = cfg();
    const map = new Map();
    if (!c) return map;
    CRM.store.list('workouts').forEach((w) => {
      if (w.program && w.program.id === PROGRAM_ID && w.program.run === c.run) map.set(w.program.day, w);
    });
    return map;
  }
  const trainingDays = () => { const out = []; for (let d = 1; d <= DAYS; d++) if (planFor(d).type !== 'R') out.push(d); return out; };

  let selDay = null;

  function inDays(n) {
    if (n === 0) return 'сьогодні';
    if (n === 1) return 'завтра';
    return `через ${fmt.count(n, ['день', 'дні', 'днів'])}`;
  }

  // ---------- Дії ----------
  function defaultStart() {
    const T = D.today();
    return T <= '2026-10-01' ? '2026-10-01' : T;
  }

  function startDialog(editing) {
    const c = cfg();
    const dateIn = ui.dateInput({ value: editing && c ? c.startDate : defaultStart(), clearable: false, ariaLabel: 'Дата старту' });
    const body = h('div', { class: 'stack', style: { gap: '14px' } },
      ui.field({ label: 'Перший день програми', input: dateIn }),
      h('p', { class: 'modal-text' }, '12 тижнів (84 дні). Перші 2 тижні — адаптація, далі тренування йдуть по колу A → B → C → відпочинок незалежно від днів тижня.'),
      editing ? h('div', { class: 'callout' }, CRM.icon('info'), h('span', null, 'Уже записані тренування лишаються прив\'язаними до своїх днів програми.')) : null);
    const dlg = ui.modal({
      title: editing ? 'Дата старту програми' : `Додати програму «${PROGRAM_NAME}»`,
      body,
      footer: h('div', { class: 'btn-row' },
        ui.button({ label: 'Скасувати', onClick: () => dlg.close('button') }),
        ui.button({ label: editing ? 'Зберегти' : 'Додати програму', variant: 'primary', icon: editing ? 'check' : 'plus', onClick: async () => {
          const start = dateIn.dateValue || defaultStart();
          const next = editing && c ? Object.assign({}, c, { startDate: start }) : { id: PROGRAM_ID, run: CRM.utils.uid(), startDate: start };
          await CRM.store.setSetting(SETTING, next);
          selDay = null;
          dlg.close('force');
          CRM.router.rerender();
          ui.toast(editing ? 'Дату старту змінено' : `Програму додано: старт ${fmt.date(start)}`, { type: 'success' });
        } }))
    });
  }

  async function finish() {
    const ok = await ui.confirm({
      title: 'Прибрати програму?',
      message: 'План зникне зі сторінки «Тренування» і з Головної. Записані тренування залишаться в журналі. Програму можна буде додати знову.',
      confirmText: 'Прибрати', danger: true
    });
    if (!ok) return;
    await CRM.store.setSetting(SETTING, null);
    selDay = null;
    CRM.router.rerender();
    ui.toast('Програму прибрано');
  }

  function rulesDialog() {
    const sec = (title, ...content) => h('section', { class: 'prog-rule' }, h('h3', null, title), ...content);
    const ul = (items) => h('ul', null, items.map((x) => h('li', null, x)));
    const dlg = ui.modal({
      title: 'Правила програми', size: 'lg',
      body: h('div', { class: 'prog-rules' },
        sec('Запас повторень (ЗП)',
          h('p', null, 'Скільки ще повторень ти міг би зробити з правильною технікою в кінці підходу.'),
          ul(['Адаптація і розвантаження: ЗП 3–4 — легко, фокус на техніці.', 'Основа і ускладнення: ЗП 1–2 — останні повторення важкі, але техніка не ламається.', 'До повної «відмови» не йдемо, крім окремо позначених підходів.'])),
        sec('Темп', h('p', null, 'Запис «3-1-1» — 3 с опускання, 1 с пауза, 1 с підйом. Якщо темп не вказано, опускай повільно (2–3 с), піднімай контрольовано, без ривків.')),
        sec('Як ускладнювати',
          h('p', null, 'Якщо в усіх підходах вправи зробив верхню межу повторень з правильною технікою — наступного разу ускладни: +1 повторення, довша пауза або повільніше опускання.'),
          h('p', null, 'Гантелі фіксованої ваги, тому навантаження росте за рахунок повторень, пауз, повільного опускання і роботи однією рукою. Коли в тязі й жимі легко виходить понад 20 повторень навіть з паузами — час для важчих або розбірних гантелей.')),
        sec('Пропуски, втома, біль', ul([
          'Пропустив тренування — не переганяй: зроби пропущене наступного дня.',
          'Печіння в м\'язах — нормально. Гострий біль у суглобах (плече, лікоть, зап\'ясток) — зупинись і заміни вправу на легшу. Якщо біль повторюється — покажись лікарю.',
          'Сильна втома кілька днів поспіль — додай ще один день відпочинку.'])),
        sec('Щоб результат був помітним', ul([
          'Записуй повторення в кожному підході — так видно прогрес.',
          'Фото і заміри (рука, груди, плечі) у дні 1, 29, 57 і 84: одне освітлення, та сама поза, зранку.',
          'Сон 7–9 годин.',
          'Білок — орієнтовно 1,6–2 г на кг ваги тіла на день' + (proteinText(profile().weight) ? `, для тебе це ${proteinText(profile().weight)}` : '') + ' (м\'ясо, риба, яйця, сир, молочні продукти, бобові); їсти трохи більше, ніж витрачаєш (плавний набір ≈0,5–1 кг на місяць); 3–4 нормальних прийоми їжі.',
          'Ноги в програмі навмисно не тренуються — короткі тренування ніг можна додати у дні відпочинку.']))),
      footer: ui.button({ label: 'Зрозуміло', variant: 'primary', onClick: () => dlg.close('button') })
    });
  }

  // ---------- Мої параметри (лише в браузері користувача) ----------
  function profile() { return Object.assign({ age: null, height: null, weight: null, pullups: '', pushups: '', dumbbells: '', goal: '' }, CRM.store.getSetting(PROFILE, null) || {}); }
  function hasProfile(p) { return !!(p.age || p.height || p.weight || p.pullups || p.pushups || p.dumbbells || p.goal); }
  /** Норма білка 1,6–2 г на кг ваги, округлено до 5 г: 70 кг → «≈110–140 г». */
  function proteinText(weight) {
    const w = Number(weight);
    if (!w) return null;
    const r5 = (x) => Math.round(x / 5) * 5;
    return `≈${r5(w * 1.6)}–${r5(w * 2)} г`;
  }
  function profileParts(p) {
    const out = [];
    if (p.age) out.push(`${p.age} ${fmt.plural(p.age, ['рік', 'роки', 'років'])}`);
    if (p.height) out.push(`${p.height} см`);
    if (p.weight) out.push(`${fmt.number(p.weight, 1).replace(/,0$/, '')} кг`);
    if (p.pullups) out.push(`підтягування ${p.pullups}`);
    if (p.pushups) out.push(`віджимання ${p.pushups}`);
    if (p.dumbbells) out.push(`гантелі ${p.dumbbells}`);
    return out;
  }

  function profileDialog() {
    const p = profile();
    const num = (value, label, min, max, step, ph) => {
      const input = h('input', { class: 'input', type: 'text', inputmode: 'decimal', value: value != null ? String(value).replace('.', ',') : '', placeholder: ph, 'aria-label': label });
      const f = ui.field({ label, input });
      f.read = () => {
        const raw = input.value.trim();
        if (!raw) return { ok: true, value: null };
        const v = CRM.utils.parseAmount(raw);
        if (isNaN(v) || v < min || v > max) { f.setError(`Від ${min} до ${max}`); return { ok: false }; }
        f.setError(null);
        return { ok: true, value: step === 1 ? Math.round(v) : CRM.utils.round2(v) };
      };
      return f;
    };
    const txt = (value, label, ph, hint) => {
      const input = ui.input({ value: value || '', placeholder: ph, maxlength: 80, 'aria-label': label });
      const f = ui.field({ label, input, hint });
      f.read = () => input.value.trim();
      return f;
    };
    const fAge = num(p.age, 'Вік, років', 10, 100, 1, 'років');
    const fHeight = num(p.height, 'Зріст, см', 100, 250, 1, 'см');
    const fWeight = num(p.weight, 'Вага, кг', 30, 250, 0.1, 'кг');
    const fPull = txt(p.pullups, 'Підтягування зараз', 'напр., 8 за підхід');
    const fPush = txt(p.pushups, 'Віджимання зараз', 'напр., 20 за підхід');
    const fDb = txt(p.dumbbells, 'Гантелі', 'напр., пара по 8 кг');
    const goalIn = ui.textarea({ value: p.goal || '', rows: 2, maxlength: 300, placeholder: 'Чого хочеш досягти за програму', 'aria-label': 'Мета' });
    const protein = h('div', { class: 'field-hint', style: { marginTop: '6px' } });
    const updProtein = () => { const v = CRM.utils.parseAmount(fWeight.querySelector('input').value); const t = proteinText(v > 0 ? v : null); protein.textContent = t ? `Норма білка: ${t} на день (1,6–2 г на кг ваги).` : 'З ваги порахується норма білка на день.'; };
    fWeight.querySelector('input').addEventListener('input', updProtein);
    updProtein();

    const dlg = ui.modal({
      title: 'Мої параметри',
      body: h('div', { class: 'stack', style: { gap: '14px' } },
        h('p', { class: 'modal-text' }, 'Зберігаються лише в цьому браузері (і в резервній копії) — не в коді сайту. Усі поля необовʼязкові.'),
        h('div', null, h('div', { class: 'form-grid prog-profile-grid' }, fAge, fHeight, fWeight), protein),
        h('div', { class: 'form-grid' }, fPull, fPush),
        fDb,
        ui.field({ label: 'Мета', input: goalIn })),
      footer: h('div', { class: 'btn-row' },
        ui.button({ label: 'Скасувати', onClick: () => dlg.close('button') }),
        ui.button({ label: 'Зберегти', icon: 'check', variant: 'primary', onClick: async () => {
          const a = fAge.read(); const hh = fHeight.read(); const w = fWeight.read();
          if (!a.ok || !hh.ok || !w.ok) return;
          await CRM.store.setSetting(PROFILE, { age: a.value, height: hh.value, weight: w.value, pullups: fPull.read(), pushups: fPush.read(), dumbbells: fDb.read(), goal: goalIn.value.trim() });
          dlg.close('force');
          CRM.router.rerender();
          ui.toast('Параметри збережено', { type: 'success' });
        } }))
    });
  }

  function profileStrip() {
    const p = profile();
    if (!hasProfile(p)) {
      return h('div', { class: 'prog-profile empty' }, CRM.icon('user', { size: 'sm' }),
        h('span', null, 'Додай свої параметри — вік, зріст, вагу, стартові результати. Норма білка порахується з ваги.'),
        h('button', { type: 'button', class: 'link-like', onClick: profileDialog }, 'Додати'));
    }
    const prot = proteinText(p.weight);
    return h('div', { class: 'prog-profile' }, CRM.icon('user', { size: 'sm' }),
      h('div', { class: 'prog-profile-text' },
        h('span', null, profileParts(p).join(' · ') + (prot ? ` · білок ${prot}/день` : '')),
        p.goal ? h('span', { class: 'subtle' }, `Мета: ${p.goal}`) : null),
      h('button', { type: 'button', class: 'link-like', onClick: profileDialog }, 'Змінити'));
  }

  function openMenu(anchor) {
    const pop = ui.popover(anchor, h('div', { class: 'menu', role: 'menu' },
      h('button', { type: 'button', role: 'menuitem', class: 'menu-item', onClick: () => { pop.close(); rulesDialog(); } }, 'Правила програми'),
      h('button', { type: 'button', role: 'menuitem', class: 'menu-item', onClick: () => { pop.close(); profileDialog(); } }, 'Мої параметри'),
      h('button', { type: 'button', role: 'menuitem', class: 'menu-item', onClick: () => { pop.close(); startDialog(true); } }, 'Змінити дату старту'),
      h('button', { type: 'button', role: 'menuitem', class: 'menu-item danger', onClick: () => { pop.close(); finish(); } }, 'Прибрати програму')),
    { align: 'end' });
  }

  function record(plan) {
    const date = dateOfDay(plan.d);
    const done = doneMap().get(plan.d);
    if (done) { CRM.training.openForm(done.id); return; }
    CRM.training.openForm(null, presetFor(plan, date > D.today() ? D.today() : date));
  }

  // ---------- Картка на сторінці «Тренування» ----------
  function offerCard() {
    return h('section', { class: 'card prog-offer' },
      h('span', { class: 'prog-offer-ico' }, CRM.icon('dumbbell')),
      h('div', { class: 'prog-offer-text' },
        h('div', { class: 'setting-title' }, `Програма «${PROGRAM_NAME}»`),
        h('div', { class: 'setting-desc' }, '12 тижнів: турнік, віджимання, гантелі. План на кожен день, підказки техніки й відео, запис у журнал в один клік.')),
      ui.button({ label: 'Додати програму', icon: 'plus', size: 'sm', onClick: () => startDialog(false) }));
  }

  function exerciseBlock(x) {
    const keys = Array.isArray(x.e) ? x.e : [x.e];
    const name = x.t || EX[keys[0]].n;
    const tips = h('details', { class: 'prog-tips' },
      h('summary', null, 'На чому зосередитись'),
      keys.map((k) => h('div', { class: 'prog-tip' },
        keys.length > 1 ? h('div', { class: 'prog-tip-name' }, EX[k].n) : null,
        h('ul', null, EX[k].c.map((c) => h('li', null, c))),
        EX[k].v ? h('a', { href: EX[k].v, target: '_blank', rel: 'noopener noreferrer', class: 'prog-video' }, CRM.icon('external', { size: 'sm' }), 'Відео техніки') : null)));
    const meta = [x.r ? `Відпочинок ${x.r}.` : '', x.note].filter(Boolean).join(' ');
    return h('div', { class: 'prog-ex' },
      h('div', { class: 'prog-ex-head' }, h('span', { class: 'prog-ex-name' }, name), h('span', { class: 'prog-ex-sets num' }, x.s)),
      meta ? h('div', { class: 'prog-ex-meta' }, meta) : null,
      tips);
  }

  function dayDetail(plan, done) {
    const c = cfg();
    const T = D.today();
    const date = dateOfDay(plan.d);
    const isToday = date === T;
    const wdName = ['понеділок', 'вівторок', 'середа', 'четвер', 'пʼятниця', 'субота', 'неділя'][D.weekday(date)];
    const nav = h('div', { class: 'prog-nav' },
      h('button', { type: 'button', class: 'btn btn-icon btn-sm', 'aria-label': 'Попередній день програми', disabled: plan.d === 1, onClick: () => { selDay = plan.d - 1; CRM.router.rerender(); } }, CRM.icon('chevronLeft', { size: 'sm' })),
      h('div', { class: 'prog-date' }, h('span', { class: 'prog-date-main' }, `${fmt.date(date).replace(/ \d{4}$/, '')}, ${wdName}`), isToday ? h('span', { class: 'badge badge-accent' }, 'сьогодні') : null),
      h('button', { type: 'button', class: 'btn btn-icon btn-sm', 'aria-label': 'Наступний день програми', disabled: plan.d === DAYS, onClick: () => { selDay = plan.d + 1; CRM.router.rerender(); } }, CRM.icon('chevronRight', { size: 'sm' })));

    const facts = h('div', { class: 'prog-facts' },
      h('span', null, `День ${plan.d} з ${DAYS}`),
      h('span', null, `Тиждень ${plan.w}`),
      h('span', null, `Фаза: ${PHASE[plan.trainPhase].name}`),
      plan.dur ? h('span', null, plan.dur) : null,
      plan.items && plan.type !== 'T' ? h('span', null, `ЗП ${RIR[plan.trainPhase]}`) : null);

    const parts = [nav,
      h('h3', { class: 'prog-title' }, h('span', { class: 'prog-dot', style: { '--ph': CRM.dict.categoryColor(PHASE[plan.phase].color) }, hidden: plan.type === 'R' }), plan.type === 'R' ? 'Відпочинок' : TITLES[plan.type]),
      facts];
    if (plan.note) parts.push(h('div', { class: 'callout' }, CRM.icon('info'), h('span', null, plan.note)));

    if (plan.items) {
      let action;
      if (done) {
        action = h('div', { class: 'prog-done' },
          h('span', { class: 'badge badge-success' }, CRM.icon('check', { size: 'sm' }), 'Виконано'),
          h('span', { class: 'subtle' }, `${fmt.dateShort(done.date)} · ${done.durationMin} хв`),
          ui.button({ label: 'Відкрити запис', size: 'sm', variant: 'ghost', onClick: () => CRM.training.openForm(done.id) }));
      } else if (date > T) {
        action = h('div', { class: 'prog-done subtle' }, `Ще попереду — ${inDays(D.diffDays(T, date))}`);
      } else {
        action = ui.button({
          label: isToday ? 'Записати тренування' : 'Записати (пропущений день)', icon: 'plus', variant: isToday ? 'primary' : null,
          className: 'prog-record', onClick: () => record(plan)
        });
      }
      parts.push(action);
      parts.push(h('details', { class: 'prog-warm' },
        h('summary', null, 'Розминка, 4 хв'),
        h('ol', null, WARMUP.map((x) => h('li', null, x))),
        h('a', { href: EX.scap.v, target: '_blank', rel: 'noopener noreferrer', class: 'prog-video' }, CRM.icon('external', { size: 'sm' }), 'Відео: скапулярні підтягування')));
      parts.push(h('div', { class: 'prog-ex-list' }, plan.items.map(exerciseBlock)));
      if (plan.type === 'T') parts.push(h('p', { class: 'subtle prog-small' }, 'Відпочинок між підходами тесту — 3–5 хв. Запиши обидва результати в журнал.'));
    } else {
      const next = plan.d < DAYS ? planFor(plan.d + 1, c.startDate) : null;
      parts.push(h('p', { class: 'subtle prog-small' }, next ? `Наступного дня: ${next.type === 'R' ? 'відпочинок' : TITLES[next.type]}.` : 'Це останній день програми.'));
    }
    return h('div', { class: 'prog-day' }, parts);
  }

  function calendar(selected, done) {
    const c = cfg();
    const T = D.today();
    const cells = [h('div')];
    for (let k = 0; k < 7; k++) cells.push(h('div', { class: 'prog-wd' }, CRM.WEEKDAYS_SHORT[D.weekday(D.addDays(c.startDate, k))]));
    for (let w = 1; w <= 12; w++) {
      cells.push(h('div', { class: 'prog-wk' }, `Т${w}`));
      for (let k = 0; k < 7; k++) {
        const d = (w - 1) * 7 + k + 1;
        const p = planFor(d);
        const date = D.addDays(c.startDate, d - 1);
        const isDone = done.has(d);
        const cls = ['prog-cell'];
        if (p.type === 'R') cls.push('rest');
        if (isDone) cls.push('done');
        if (date === T) cls.push('today');
        if (d === selected) cls.push('sel');
        if (p.type !== 'R' && date < T && !isDone) cls.push('missed');
        const pd = D.parse(date);
        cells.push(h('button', {
          type: 'button', class: cls.join(' '),
          style: p.type === 'R' ? null : { '--ph': CRM.dict.categoryColor(PHASE[p.phase].color) },
          'aria-label': `${fmt.date(date)}: ${p.type === 'R' ? 'відпочинок' : TITLES[p.type]}${isDone ? ', виконано' : ''}`,
          'aria-pressed': d === selected ? 'true' : 'false',
          onClick: () => { selDay = d; CRM.router.rerender(); }
        },
        h('span', { class: 'prog-cell-date' }, `${pd.d}.${String(pd.m).padStart(2, '0')}`),
        h('span', { class: 'prog-cell-code' }, CODE[p.type]),
        isDone ? h('span', { class: 'prog-cell-check' }, CRM.icon('check', { size: 'sm' })) : null));
      }
    }
    const legend = h('div', { class: 'prog-legend' },
      PHASES.map((p) => h('span', null, h('i', { style: { '--ph': CRM.dict.categoryColor(p.color) } }), p.name)),
      h('span', null, h('i', { class: 'rest' }), 'Відпочинок'));
    return h('div', { class: 'prog-cal' }, h('div', { class: 'prog-grid', role: 'group', 'aria-label': 'Календар програми, 12 тижнів' }, cells), legend);
  }

  function statusText() {
    const c = cfg();
    if (!c) return '';
    const idx = dayIndex(D.today());
    if (idx < 1) return `старт ${fmt.dateShort(c.startDate)} — ${inDays(1 - idx)}`;
    if (idx > DAYS) return `завершено ${fmt.dateShort(D.addDays(c.startDate, DAYS - 1))}`;
    return `день ${idx} з ${DAYS} · тиждень ${Math.ceil(idx / 7)} · ${PHASE[phaseOfWeek(Math.ceil(idx / 7))].name.toLowerCase()}`;
  }

  // ---------- Дані для вкладки «Програми», тижня й Головної ----------
  /** Підсумок для картки у списку програм (null — програму не додано). */
  function summary() {
    const c = cfg();
    if (!c) return null;
    const done = doneMap();
    return {
      name: PROGRAM_NAME, startDate: c.startDate, endDate: D.addDays(c.startDate, DAYS - 1), status: statusText(),
      doneCount: Array.from(done.keys()).filter((d) => d >= 1 && d <= DAYS).length, total: trainingDays().length,
      weeks: 12, week: Math.min(12, Math.max(1, Math.ceil(dayIndex(D.today()) / 7)))
    };
  }
  /** План на дату: { d, week, rest, title, items: ['Підтягування прямим хватом 3×4', …], done } або null. */
  function dayInfo(date) {
    const c = cfg();
    if (!c) return null;
    const d = D.diffDays(c.startDate, date) + 1;
    if (d < 1 || d > DAYS) return null;
    const p = planFor(d, c.startDate);
    const items = (p.items || []).map((x) => `${x.t || EX[Array.isArray(x.e) ? x.e[0] : x.e].n} ${x.s}`);
    return { d, date, week: p.w, rest: p.type === 'R', title: p.type === 'R' ? 'Відпочинок' : TITLES[p.type], items, plan: p, done: doneMap().get(d) || null };
  }
  /** Відкрити сторінку програми на дні d. */
  function openDay(d) {
    selDay = d;
    CRM.router.go('training/program/' + PROGRAM_ID);
  }
  /** «Виконано» / «Записати тренування» для дня d. */
  function recordDay(d) {
    const c = cfg();
    if (!c || d < 1 || d > DAYS) return;
    record(planFor(d, c.startDate));
  }

  function card() {
    const c = cfg();
    if (!c) return offerCard();
    const T = D.today();
    const idx = dayIndex(T);
    const done = doneMap();
    const total = trainingDays().length;
    const doneCount = Array.from(done.keys()).filter((d) => d >= 1 && d <= DAYS).length;
    if (selDay == null || selDay < 1 || selDay > DAYS) selDay = Math.min(DAYS, Math.max(1, idx));
    const plan = planFor(selDay, c.startDate);

    const status = statusText();

    const menuBtn = h('button', { type: 'button', class: 'btn btn-ghost btn-icon btn-sm', 'aria-label': 'Дії з програмою', title: 'Дії з програмою', 'aria-haspopup': 'menu' }, CRM.icon('more', { size: 'sm' }));
    menuBtn.addEventListener('click', () => openMenu(menuBtn));

    return h('section', { class: 'card prog-card' },
      h('div', { class: 'card-head' },
        h('div', { class: 'prog-head' },
          h('h2', null, `Програма: ${PROGRAM_NAME.toLowerCase()}`),
          h('span', { class: 'subtle' }, status)),
        h('div', { class: 'btn-row' },
          h('span', { class: 'prog-count subtle num' }, `Виконано ${doneCount} з ${total}`),
          menuBtn)),
      h('div', { class: 'card-body prog-body' }, profileStrip(),
        h('div', { class: 'prog-layout' }, dayDetail(plan, done.get(plan.d)), calendar(plan.d, done))));
  }

  // ---------- Розклад на Головній ----------
  CRM.home.addScheduleSource((date) => {
    const c = cfg();
    if (!c) return [];
    const d = D.diffDays(c.startDate, date) + 1;
    if (d < 1 || d > DAYS) return [];
    const p = planFor(d, c.startDate);
    if (p.type === 'R') return [];
    const done = doneMap().get(d);
    return [{
      time: null, kind: 'training', icon: 'dumbbell', cls: 'ico-danger',
      title: p.type === 'T' ? 'Тест сили' : `Тренування ${TITLES[p.type]}`,
      sub: `Програма · тиждень ${p.w} · ${p.dur}`,
      badge: done ? { text: 'Виконано', cls: 'badge-success' } : null,
      onClick: () => openDay(d)
    }];
  });

  CRM.program = {
    card, offerCard, summary, dayInfo, openDay, recordDay, statusText, planFor, presetFor, parseSets, cfg, doneMap, profile, proteinText,
    DAYS, PROGRAM_ID, NAME: PROGRAM_NAME, COLOR, EX
  };
})(window.CRM);
