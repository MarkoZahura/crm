/* ==========================================================================
   training.js — розділ «Тренування».
   Журнал тренувань (зал / силові, вдома / власна вага, біг / кардіо, інше),
   згрупований по тижнях; підсумок за тиждень або місяць; стовпчики часу
   тренувань за 8 тижнів; «Повторити» — копія тренування на сьогодні.
   Вкладки: «Журнал» (#/training) і «Програми» (#/training/programs,
   сторінка програми — #/training/program/<id>; див. programs.js і program.js).
   ========================================================================== */
window.CRM = window.CRM || {};

(function (CRM) {
  'use strict';

  const { h, ui } = { h: CRM.ui.h, ui: CRM.ui };
  const D = CRM.date;
  const fmt = CRM.fmt;

  const TYPE_ICON = { strength: 'dumbbell', home: 'home', cardio: 'trendUp', other: 'sparkles' };
  let summaryMode = 'week';
  let summaryAnchor = null;
  let typeFilter = 'all';
  const WEEKS_PAGE = 8;
  let weeksShown = WEEKS_PAGE;

  // ---------- Розрахунки ----------
  function list() { return CRM.store.list('workouts').sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || '').localeCompare(a.createdAt || '')); }
  function tonnage(w) {
    return (w.exercises || []).reduce((s, e) => s + (e.sets || []).reduce((ss, st) => ss + (Number(st.reps) || 0) * (Number(st.weight) || 0), 0), 0);
  }
  function setsCount(w) { return (w.exercises || []).reduce((s, e) => s + (e.sets || []).length, 0); }
  function pace(w) {
    if (!w.distanceKm || !w.durationMin) return null;
    const secPerKm = Math.round(w.durationMin * 60 / w.distanceKm);
    return `${Math.floor(secPerKm / 60)}:${String(secPerKm % 60).padStart(2, '0')} хв/км`;
  }
  /** Підсумки (тиждень, місяць): лише години й хвилини — «2 год 15 хв». */
  function durationLabel(min) {
    const m = Math.round(Number(min) || 0);
    if (m < 60) return `${m} хв`;
    return `${Math.floor(m / 60)} год${m % 60 ? ` ${m % 60} хв` : ''}`;
  }

  // ---------- Тривалість: хвилини й секунди ----------
  // Зберігається, як і раніше, у durationMin — хвилинах, тепер і з дробом (9:30 → 9,5 хв).
  const MAX_SEC = 600 * 60;
  /** Секунди тривалості (ціле число). */
  function durSec(min) { return Math.round((Number(min) || 0) * 60); }
  /** Секунди → хвилини для збереження (без «хвостів» на кшталт 9.516666666666667). */
  function secToMin(sec) { return Number((Math.round(sec) / 60).toFixed(6)); }
  /** Одного тренування: «45 хв», «9 хв 30 с», «1 год 5 хв», «1 год 5 хв 20 с». */
  function durationText(min) {
    const total = durSec(min);
    const hh = Math.floor(total / 3600);
    const mm = Math.floor((total % 3600) / 60);
    const ss = total % 60;
    const parts = [];
    if (hh) parts.push(`${hh} год`);
    if (mm || (!hh && !ss)) parts.push(`${mm} хв`);
    if (ss) parts.push(`${ss} с`);
    return parts.join(' ');
  }
  /** Для поля форми: цілі хвилини — «45», із секундами — «9:30» / «1:05:20». */
  function durationInput(min) {
    const total = durSec(min);
    if (!total) return '';
    if (total % 60 === 0) return String(total / 60);
    const hh = Math.floor(total / 3600);
    const mm = Math.floor((total % 3600) / 60);
    const ss = String(total % 60).padStart(2, '0');
    return hh ? `${hh}:${String(mm).padStart(2, '0')}:${ss}` : `${mm}:${ss}`;
  }
  /**
   * Розібрати тривалість, як її пишуть люди → секунди або null:
   * «45» (хвилини), «45,5», «9:30» (хв:сек), «1:05:20» (год:хв:сек), «1 год 5 хв», «9 хв 30 с», «90 хв», «1,5 год».
   */
  function parseDuration(text) {
    const s = String(text || '').trim().toLowerCase().replace(/\s+/g, ' ');
    if (!s) return null;
    let m = /^(\d+(?:[.,]\d+)?)$/.exec(s);
    if (m) return Math.round(Number(m[1].replace(',', '.')) * 60);
    m = /^(\d{1,4}):(\d{2})$/.exec(s);
    if (m) return Number(m[2]) < 60 ? Number(m[1]) * 60 + Number(m[2]) : null;
    m = /^(\d{1,2}):(\d{2}):(\d{2})$/.exec(s);
    if (m) return Number(m[2]) < 60 && Number(m[3]) < 60 ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : null;
    // З одиницями: «1 год 5 хв 20 с», «9хв 30с», «1,5 год»
    const re = /(\d+(?:[.,]\d+)?)\s*(години|годин|година|год|г|h|хвилини|хвилин|хвилина|хв|min|m|секунди|секунд|секунда|сек|с|s)\.?(?=\s|\d|$)/g;
    let rest = s;
    let sec = 0;
    let any = false;
    let x;
    while ((x = re.exec(s))) {
      const v = Number(x[1].replace(',', '.'));
      const u = x[2];
      if (/^(год|г|h)/.test(u)) sec += v * 3600;
      else if (/^(хв|min|m$)/.test(u)) sec += v * 60;
      else sec += v;
      any = true;
      rest = rest.replace(x[0], ' ');
    }
    if (!any || rest.replace(/[\s,і+та]/g, '') !== '') return null;
    return Math.round(sec);
  }
  function km(v) { return fmt.number(v, 1).replace(/,0$/, '') + ' км'; }
  function typeLabel(t) { return CRM.dict.label('workoutTypes', t) || 'Тренування'; }
  function title(w) { return w.title || typeLabel(w.type); }
  /** Значок прив'язки до програми: «Програма · день 17» або «Біг на вулиці · тиждень 3, день 2». */
  function programBadge(w) {
    if (!w.program) return null;
    if (w.program.week && CRM.programs) return CRM.programs.badgeText(w);
    if (w.program.week) return `Програма · тиждень ${w.program.week}, день ${w.program.day}`;
    return `Програма · день ${w.program.day}${w.program.repeat ? ' · повтор' : ''}`;
  }

  function summaryText(w) {
    if (w.type === 'cardio') return [w.distanceKm ? km(w.distanceKm) : null, pace(w)].filter(Boolean).join(' · ');
    const ex = (w.exercises || []).length;
    if (!ex) return w.note || '';
    const parts = [fmt.count(ex, ['вправа', 'вправи', 'вправ']), fmt.count(setsCount(w), ['підхід', 'підходи', 'підходів'])];
    const t = tonnage(w);
    if (t) parts.push(`тоннаж ${fmt.number(t, 0)} кг`);
    return parts.join(' · ');
  }

  function periodRange(mode, anchor) {
    return mode === 'week' ? [D.startOfWeek(anchor), D.endOfWeek(anchor)] : [D.startOfMonth(anchor), D.endOfMonth(anchor)];
  }
  function stats(from, to) {
    const items = CRM.store.list('workouts').filter((w) => w.date >= from && w.date <= to);
    const byType = new Map();
    items.forEach((w) => byType.set(w.type, (byType.get(w.type) || 0) + 1));
    let top = null;
    byType.forEach((n, t) => { if (!top || n > top[1]) top = [t, n]; });
    return {
      count: items.length,
      minutes: items.reduce((s, w) => s + (Number(w.durationMin) || 0), 0),
      tonnage: items.reduce((s, w) => s + tonnage(w), 0),
      km: items.reduce((s, w) => s + (Number(w.distanceKm) || 0), 0),
      top: top ? typeLabel(top[0]) : null
    };
  }

  // ---------- Сторінка ----------
  function summaryCard() {
    const T = D.today();
    if (!summaryAnchor) summaryAnchor = T;
    const [from, to] = periodRange(summaryMode, summaryAnchor);
    const s = stats(from, to);
    const isCurrent = T >= from && T <= to;
    const label = summaryMode === 'week'
      ? `${D.parse(from).d} ${CRM.MONTHS_GEN[D.parse(from).m - 1]} — ${fmt.date(to)}`
      : fmt.month(from);
    const shift = (n) => { summaryAnchor = summaryMode === 'week' ? D.addDays(summaryAnchor, 7 * n) : D.addMonths(summaryAnchor, n); CRM.router.rerender(); };
    const seg = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': 'Період підсумку' },
      [['week', 'Тиждень'], ['month', 'Місяць']].map(([id, l]) => h('button', {
        type: 'button', role: 'radio', class: summaryMode === id ? 'active' : '', 'aria-checked': summaryMode === id ? 'true' : 'false',
        onClick: () => { summaryMode = id; summaryAnchor = T; CRM.router.rerender(); }
      }, l)));
    return h('section', { class: 'card' },
      h('div', { class: 'card-head' },
        h('div', { class: 'month-nav' },
          h('button', { type: 'button', class: 'btn btn-icon btn-sm', 'aria-label': 'Попередній період', onClick: () => shift(-1) }, CRM.icon('chevronLeft', { size: 'sm' })),
          h('span', { class: 'month-title' }, label),
          h('button', { type: 'button', class: 'btn btn-icon btn-sm', 'aria-label': 'Наступний період', disabled: isCurrent, onClick: () => shift(1) }, CRM.icon('chevronRight', { size: 'sm' }))),
        seg),
      h('div', { class: 'card-body' },
        h('div', { class: 'kpi-row train-kpis' },
          h('div', { class: 'stat' }, h('div', { class: 'stat-label' }, 'Тренувань'), h('div', { class: 'stat-value num' }, String(s.count))),
          h('div', { class: 'stat' }, h('div', { class: 'stat-label' }, 'Загальний час'), h('div', { class: 'stat-value num' }, durationLabel(s.minutes))),
          h('div', { class: 'stat' }, h('div', { class: 'stat-label' }, 'Тоннаж'), h('div', { class: 'stat-value num' }, `${fmt.number(s.tonnage, 0)} кг`)),
          h('div', { class: 'stat' }, h('div', { class: 'stat-label' }, 'Дистанція'), h('div', { class: 'stat-value num' }, km(s.km))),
          h('div', { class: 'stat' }, h('div', { class: 'stat-label' }, 'Найчастіше'), h('div', { class: 'stat-value stat-value-sm' }, s.top || '—')))));
  }

  function weeksChart() {
    const T = D.today();
    const weeks = [];
    for (let i = 7; i >= 0; i--) weeks.push(D.startOfWeek(D.addDays(T, -7 * i)));
    const mins = weeks.map((w) => stats(w, D.endOfWeek(w)).minutes);
    const counts = weeks.map((w) => stats(w, D.endOfWeek(w)).count);
    if (!mins.some((m) => m > 0)) return null;
    return h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', null, 'Час тренувань за 8 тижнів')),
      h('div', { class: 'card-body' }, CRM.charts.bar({
        labels: weeks.map((w) => `${D.parse(w).d} ${CRM.MONTHS_SHORT[D.parse(w).m - 1]}`),
        titles: weeks.map((w, i) => `Тиждень з ${fmt.dateShort(w)} · ${fmt.count(counts[i], ['тренування', 'тренування', 'тренувань'])}`),
        values: mins, highlight: 7, height: 200,
        format: (v) => durationLabel(v),
        yFormat: (v) => `${v} хв`,
        ariaLabel: 'Хвилини тренувань за останні 8 тижнів'
      })));
  }

  function row(w) {
    const wd = CRM.WEEKDAYS_SHORT[D.weekday(w.date)];
    return h('div', { class: 'wo-row', role: 'button', tabIndex: 0, dataset: { id: w.id },
      onClick: () => openForm(w.id),
      onKeydown: (e) => { if (e.key === 'Enter' && e.target.classList.contains('wo-row')) openForm(w.id); }
    },
    h('span', { class: 'rec-date' }, h('span', { class: 'rec-day num' }, String(D.parse(w.date).d)), h('span', { class: 'rec-wd' }, wd)),
    h('span', { class: 'list-row-icon wo-ico wo-' + w.type }, CRM.icon(TYPE_ICON[w.type] || 'dumbbell', { size: 'sm' })),
    h('span', { class: 'rec-main' },
      h('span', { class: 'rec-name' }, h('span', { class: 'rec-title' }, title(w)),
        w.program ? h('span', { class: 'badge badge-accent' }, programBadge(w)) : w.title ? h('span', { class: 'badge' }, typeLabel(w.type)) : null),
      h('span', { class: 'rec-sub' }, summaryText(w) || '—')),
    h('span', { class: 'wo-dur num' }, w.durationMin ? durationText(w.durationMin) : ''),
    ui.button({ icon: 'repeat', iconOnly: true, size: 'sm', variant: 'ghost', title: 'Повторити сьогодні', onClick: (e) => { e.stopPropagation(); repeatToday(w); } }));
  }

  function journal() {
    let items = list();
    if (typeFilter !== 'all') items = items.filter((w) => w.type === typeFilter);
    const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Тип тренування' },
      [{ id: 'all', label: 'Усі' }].concat(CRM.dict.workoutTypes).map((t) => h('button', {
        type: 'button', class: 'chip' + (typeFilter === t.id ? ' active' : ''), 'aria-pressed': typeFilter === t.id ? 'true' : 'false',
        onClick: () => { typeFilter = t.id; weeksShown = WEEKS_PAGE; CRM.router.rerender(); }
      }, t.label)));
    let body;
    if (!items.length) {
      body = ui.empty({
        icon: 'dumbbell', small: typeFilter !== 'all',
        title: typeFilter === 'all' ? 'Ще немає тренувань — додай перше' : 'Тренувань цього типу немає',
        text: typeFilter === 'all' ? 'Зал, домашні тренування чи пробіжка — усе в одному журналі з підсумками за тиждень і місяць.' : null,
        action: typeFilter === 'all' ? { label: 'Додати тренування', icon: 'plus', onClick: () => openForm() } : null
      });
    } else {
      const groups = CRM.utils.groupBy(items, (w) => D.startOfWeek(w.date));
      const nodes = [];
      let n = 0;
      groups.forEach((ws, week) => {
        if (++n > weeksShown) return;
        const mins = ws.reduce((s, w) => s + (Number(w.durationMin) || 0), 0);
        const end = D.endOfWeek(week);
        nodes.push(h('div', { class: 'day-group' },
          h('div', { class: 'day-head' },
            h('span', { class: 'day-name' }, `${D.parse(week).d} ${CRM.MONTHS_GEN[D.parse(week).m - 1]} — ${D.parse(end).d} ${CRM.MONTHS_GEN[D.parse(end).m - 1]}`),
            h('span', { class: 'day-total' }, `${fmt.count(ws.length, ['тренування', 'тренування', 'тренувань'])} · ${durationLabel(mins)}`)),
          ws.map(row)));
      });
      const hiddenWeeks = groups.size - weeksShown;
      body = h('div', { class: 'tx-list' }, nodes,
        hiddenWeeks > 0 ? h('div', { class: 'list-more' }, ui.button({
          label: `Показати старіші (ще ${fmt.count(hiddenWeeks, ['тиждень', 'тижні', 'тижнів'])})`, size: 'sm', variant: 'ghost',
          onClick: () => { weeksShown += WEEKS_PAGE; CRM.router.rerender(); }
        })) : null);
    }
    return h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', null, 'Журнал'), chips),
      body);
  }

  const TABS = [['journal', 'Журнал'], ['programs', 'Програми']];

  function render(container, route) {
    const tabId = route.sub === 'programs' || route.sub === 'program' ? 'programs' : 'journal';
    const nav = h('nav', { class: 'tabs', 'aria-label': 'Вкладки тренувань' },
      TABS.map(([id, label]) => h('a', {
        href: '#/training' + (id === 'journal' ? '' : '/' + id), class: 'tab' + (id === tabId ? ' active' : ''),
        'aria-current': id === tabId ? 'page' : null
      }, label)));
    let content;
    let actions;
    if (tabId === 'programs') {
      // Без programs.js (неповне оновлення сайту) лишається вбудована програма «Верх тіла»
      content = CRM.programs
        ? (route.sub === 'program' ? CRM.programs.pageView(route.parts[2]) : CRM.programs.listView())
        : h('div', { class: 'stack' }, CRM.program ? CRM.program.card() : null);
      actions = CRM.programs ? CRM.programs.importButton({ variant: 'primary' }) : null;
    } else {
      const hasAny = CRM.store.list('workouts').length > 0;
      content = h('div', { class: 'stack' }, hasAny ? summaryCard() : null, hasAny ? weeksChart() : null, journal());
      actions = ui.button({ label: 'Додати тренування', icon: 'plus', variant: 'primary', onClick: () => openForm() });
    }
    ui.mount(container,
      ui.pageHead({ title: 'Тренування', sub: 'Журнал, підсумки й програми тренувань: зал, вдома, біг.', actions }),
      nav, content);
    if (route.params.open) {
      const id = route.params.open;
      CRM.router.consumeParam('open');
      setTimeout(() => openForm(id), 0);
    }
  }

  // ---------- Дії ----------
  async function repeatToday(w) {
    const copy = CRM.utils.deepClone(w);
    ['id', 'createdAt', 'updatedAt', 'deletedAt', 'deleteBatch', 'deleteHead', 'program', 'quick'].forEach((k) => delete copy[k]);
    copy.date = D.today();
    const saved = await CRM.store.save('workouts', copy);
    ui.toast(`«${title(w)}» скопійовано на сьогодні`, { type: 'success', action: { label: 'Відкрити', onClick: () => openForm(saved.id) } });
  }

  // ---------- Форма ----------
  function exerciseNames() {
    const set = new Set();
    CRM.store.list('workouts').forEach((w) => (w.exercises || []).forEach((e) => { if (e.name) set.add(e.name); }));
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'uk'));
  }

  /** Форма тренування. preset — заготовка для нового запису (напр., з програми тренувань). */
  function openForm(id, preset) {
    const existing = id ? CRM.store.get('workouts', id) : null;
    if (id && (!existing || existing.deletedAt)) { ui.toast('Тренування не знайдено', { type: 'error' }); return null; }
    const isNew = !existing;
    const st = existing ? CRM.utils.deepClone(existing)
      : Object.assign({ type: 'strength', date: D.today(), title: '', durationMin: null, distanceKm: null, exercises: [], note: '' }, preset ? CRM.utils.deepClone(preset) : {});
    if (!st.exercises) st.exercises = [];
    // Вправа без жодного підходу (напр., тест, де результат ще не вписано) — порожній рядок, щоб було куди вписати
    st.exercises.forEach((ex) => { if (!ex.sets || !ex.sets.length) ex.sets = [ex.unit === 'sec' ? { sec: null, weight: null } : { reps: null, weight: null }]; });

    const typeSeg = h('div', { class: 'segmented wo-types', role: 'radiogroup', 'aria-label': 'Тип тренування' });
    function renderType() {
      ui.mount(typeSeg, CRM.dict.workoutTypes.map((t) => h('button', {
        type: 'button', role: 'radio', class: st.type === t.id ? 'active' : '', 'aria-checked': st.type === t.id ? 'true' : 'false',
        onClick: () => { st.type = t.id; renderType(); renderByType(); }
      }, CRM.icon(TYPE_ICON[t.id], { size: 'sm' }), t.label)));
    }

    const dateIn = ui.dateInput({ value: st.date, clearable: false, ariaLabel: 'Дата тренування' });
    // Тривалість — хвилини («45») або хв:сек («9:30»), год:хв:сек («1:05:20»), «1 год 5 хв»
    const durIn = h('input', {
      class: 'input input-num wo-dur-in', type: 'text', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false',
      value: durationInput(st.durationMin), placeholder: '45 або 9:30', 'aria-label': 'Тривалість: хвилини або хв:сек'
    });
    const durHint = h('div', { class: 'field-hint wo-dur-hint' });
    const fDur = ui.field({ label: 'Тривалість', input: durIn, required: true });
    fDur.appendChild(durHint);
    function updateDurHint() {
      const v = durIn.value.trim();
      const sec = parseDuration(v);
      if (v && sec != null && sec > 0 && !/^\d+$/.test(v)) durHint.textContent = '= ' + durationText(secToMin(sec));
      else durHint.textContent = 'Хвилини (45) або хвилини й секунди через двокрапку (9:30); з годинами — 1:05:20.';
    }
    durIn.addEventListener('input', updateDurHint);
    updateDurHint();
    const titleIn = ui.input({ value: st.title || '', maxlength: 60, placeholder: 'Необовʼязково, напр., Ноги + спина' });
    const fTitle = ui.field({ label: 'Назва', input: titleIn });

    // Кардіо: дистанція й темп
    const distIn = h('input', { class: 'input input-num', type: 'text', inputmode: 'decimal', value: st.distanceKm ? String(st.distanceKm).replace('.', ',') : '', placeholder: 'км', 'aria-label': 'Дистанція, км' });
    const paceOut = h('div', { class: 'field-hint' });
    const fDist = ui.field({ label: 'Дистанція, км', input: distIn });
    fDist.appendChild(paceOut);
    function updatePace() {
      const d = CRM.utils.parseAmount(distIn.value);
      const sec = parseDuration(durIn.value);
      const m = sec ? sec / 60 : 0;
      paceOut.textContent = d > 0 && m > 0 ? `Темп: ${pace({ distanceKm: d, durationMin: m })}` : 'Темп рахується автоматично з дистанції й тривалості.';
    }
    distIn.addEventListener('input', updatePace);
    durIn.addEventListener('input', updatePace);
    updatePace();

    // Вправи з підходами
    const listId = 'ex-names-' + CRM.utils.uid().slice(0, 6);
    const datalist = h('datalist', { id: listId }, exerciseNames().map((n) => h('option', { value: n })));
    const exBox = h('div', { class: 'ex-list' });
    /** Повтори ↔ секунди: числа в підходах лишаються, змінюється лише що вони означають. */
    function setUnit(ex, unit) {
      if ((ex.unit === 'sec' ? 'sec' : 'reps') === unit) return;
      (ex.sets || []).forEach((s) => {
        if (unit === 'sec') { s.sec = s.reps != null ? s.reps : null; delete s.reps; } else { s.reps = s.sec != null ? s.sec : null; delete s.sec; }
      });
      if (unit === 'sec') ex.unit = 'sec'; else delete ex.unit;
      renderExercises();
    }
    function renderExercises() {
      const withWeight = st.type === 'strength' || st.type === 'home';
      ui.mount(exBox, st.exercises.map((ex, ei) => {
        const nameIn = h('input', { class: 'input ex-name', value: ex.name || '', placeholder: 'Вправа, напр., Присідання', list: listId, maxlength: 60, 'aria-label': 'Назва вправи' });
        nameIn.addEventListener('input', () => { ex.name = nameIn.value; });
        // Вправа на час (планка, утримання) — підходи в секундах
        const sec = ex.unit === 'sec';
        const key = sec ? 'sec' : 'reps';
        const unitSeg = h('div', { class: 'segmented ex-unit', role: 'radiogroup', 'aria-label': 'Що записувати в підходах' },
          [['reps', 'Повт.', 'Повтори'], ['sec', 'Сек.', 'Секунди (вправа на час)']].map(([id, label, full]) => h('button', {
            type: 'button', role: 'radio', class: key === id ? 'active' : '', 'aria-checked': key === id ? 'true' : 'false',
            'aria-label': full, title: full, dataset: { unit: id }, onClick: () => setUnit(ex, id)
          }, label)));
        return h('div', { class: 'ex-card' + (sec ? ' ex-sec' : '') },
          h('div', { class: 'ex-head' },
            h('span', { class: 'ex-num' }, String(ei + 1)),
            nameIn,
            unitSeg,
            h('button', { type: 'button', class: 'btn btn-ghost btn-icon btn-sm', title: 'Видалити вправу', 'aria-label': 'Видалити вправу', onClick: () => { st.exercises.splice(ei, 1); renderExercises(); } }, CRM.icon('trash', { size: 'sm' }))),
          h('div', { class: 'sets' },
            h('div', { class: 'set-row set-head' }, h('span', null, 'Підхід'), h('span', null, sec ? 'Секунди' : 'Повтори'), withWeight ? h('span', null, 'Вага, кг') : null, h('span')),
            (ex.sets || []).map((s, si) => {
              const val = h('input', {
                class: 'input input-sm', type: 'number', min: 0, step: 1, value: s[key] != null ? s[key] : '',
                placeholder: s.ph != null ? String(s.ph) : '', 'aria-label': `${sec ? 'Секунди' : 'Повтори'}, підхід ${si + 1}`
              });
              val.addEventListener('input', () => { s[key] = val.value === '' ? null : Number(val.value); });
              const weight = h('input', { class: 'input input-sm', type: 'text', inputmode: 'decimal', placeholder: st.type === 'home' ? 'за потреби' : '', value: s.weight != null ? String(s.weight).replace('.', ',') : '', 'aria-label': `Вага, підхід ${si + 1}` });
              weight.addEventListener('input', () => { const v = CRM.utils.parseAmount(weight.value); s.weight = weight.value.trim() === '' || isNaN(v) ? null : v; });
              return h('div', { class: 'set-row' },
                h('span', { class: 'subtle num' }, String(si + 1)), val, withWeight ? weight : null,
                h('button', { type: 'button', class: 'btn btn-ghost btn-icon btn-sm', title: 'Видалити підхід', 'aria-label': 'Видалити підхід', onClick: () => { ex.sets.splice(si, 1); renderExercises(); } }, CRM.icon('x', { size: 'sm' })));
            }),
            h('button', {
              type: 'button', class: 'btn btn-ghost btn-sm add-set',
              onClick: () => {
                const last = (ex.sets || [])[ex.sets.length - 1];
                const next = sec ? { sec: last ? last.sec : null } : { reps: last ? last.reps : null };
                next.weight = last ? last.weight : null;
                if (last && last.ph != null) next.ph = last.ph;
                ex.sets = (ex.sets || []).concat([next]);
                renderExercises();
              }
            }, CRM.icon('plus', { size: 'sm' }), 'Підхід')));
      }),
      h('button', {
        type: 'button', class: 'btn btn-sm',
        onClick: () => { st.exercises.push({ name: '', sets: [{ reps: null, weight: null }] }); renderExercises(); const inputs = exBox.querySelectorAll('.ex-name'); if (inputs.length) inputs[inputs.length - 1].focus(); }
      }, CRM.icon('plus', { size: 'sm' }), 'Додати вправу'));
    }

    const noteIn = ui.textarea({ value: st.note || '', rows: 3, maxlength: 1000, placeholder: 'Самопочуття, що вдалося, що змінити наступного разу' });
    const fNote = ui.field({ label: 'Нотатка', input: noteIn });

    const exSection = h('section', { class: 'editor-section' }, h('div', { class: 'section-head' }, h('h3', null, CRM.icon('dumbbell', { size: 'sm' }), 'Вправи')), exBox, datalist);
    const cardioSection = h('div', null, fDist);
    function renderByType() {
      const ex = st.type === 'strength' || st.type === 'home';
      exSection.hidden = !ex;
      cardioSection.hidden = st.type !== 'cardio';
      if (ex) renderExercises();
    }
    renderType();
    renderByType();

    async function submit(e) {
      if (e) e.preventDefault();
      let ok = true;
      const durS = parseDuration(durIn.value);
      const dur = durS != null ? secToMin(durS) : null;
      if (durS == null || durS < 1 || durS > MAX_SEC) {
        fDur.setError(durS != null && durS > MAX_SEC ? 'Не більше 600 хв (10 годин)' : 'Вкажи тривалість: хвилини (45) або хв:сек (9:30)');
        ok = false;
      }
      let dist = null;
      if (st.type === 'cardio' && distIn.value.trim()) {
        dist = CRM.utils.parseAmount(distIn.value);
        if (isNaN(dist) || dist <= 0 || dist > 500) { fDist.setError('Вкажи дистанцію в кілометрах, напр., 5 або 7,5'); ok = false; }
      }
      let exercises = [];
      if (st.type === 'strength' || st.type === 'home') {
        exercises = st.exercises
          .map((ex) => {
            const sec = ex.unit === 'sec';
            const k = sec ? 'sec' : 'reps';
            const sets = (ex.sets || []).filter((s) => s[k] != null && s[k] !== '').map((s) => {
              const v = Math.max(0, Math.round(Number(s[k]) || 0));
              const w = s.weight != null ? CRM.utils.round2(s.weight) : null;
              return sec ? { sec: v, weight: w } : { reps: v, weight: w };
            });
            return sec ? { name: (ex.name || '').trim(), unit: 'sec', sets } : { name: (ex.name || '').trim(), sets };
          })
          .filter((ex) => ex.name || ex.sets.length);
        if (exercises.some((ex) => !ex.name)) { ui.toast('Вкажи назву для кожної вправи', { type: 'error' }); ok = false; }
      }
      if (!ok) return;
      const rec = Object.assign(existing ? CRM.utils.deepClone(existing) : {}, {
        type: st.type, date: dateIn.dateValue || D.today(), title: titleIn.value.trim(), durationMin: dur,
        distanceKm: st.type === 'cardio' ? dist : null, exercises, note: noteIn.value.trim()
      });
      if (isNew && st.program) rec.program = st.program;
      await CRM.store.save('workouts', rec);
      dlg.close('force');
      ui.toast(isNew ? 'Тренування додано' : 'Зміни збережено', { type: 'success' });
    }

    async function remove() {
      const ok = await ui.confirm({ title: 'Видалити тренування?', message: 'Воно потрапить у Кошик. Відновити можна протягом 30 днів.', confirmText: 'Видалити', danger: true });
      if (!ok) return;
      const batch = await CRM.store.softDelete('workouts', existing.id);
      dlg.close('force');
      ui.toast('Тренування перенесено в Кошик', { action: { label: 'Скасувати', onClick: () => CRM.store.restoreBatch(batch) } });
    }

    const hint = isNew && st.hint ? h('div', { class: 'callout' }, CRM.icon('info'), h('span', null, st.hint)) : null;
    const form = h('form', { class: 'form-stack', novalidate: true, onSubmit: submit },
      hint,
      typeSeg,
      h('div', { class: 'form-grid' }, ui.field({ label: 'Дата', input: dateIn }), fDur),
      fTitle, cardioSection, exSection, fNote,
      h('button', { type: 'submit', hidden: true, tabIndex: -1, 'aria-hidden': 'true' }));

    const dlg = ui.drawer({
      title: isNew ? (st.program ? 'Тренування за програмою' : 'Нове тренування') : 'Тренування',
      body: form,
      footer: h('div', { class: 'drawer-footer-inner' },
        existing ? ui.button({ label: 'Видалити', icon: 'trash', variant: 'danger-ghost', onClick: remove }) : null,
        existing ? ui.button({ label: 'Повторити', title: 'Скопіювати це тренування на сьогодні', icon: 'repeat', variant: 'ghost', onClick: () => { dlg.close('force'); repeatToday(existing); } }) : null,
        h('span', { class: 'grow' }),
        ui.button({ label: 'Скасувати', onClick: () => dlg.close('button') }),
        ui.button({ label: isNew ? 'Додати' : 'Зберегти', icon: isNew ? 'plus' : 'check', variant: 'primary', onClick: () => submit() })),
      initialFocus: isNew ? durIn : 'container'
    });
    dlg.el.classList.add('wo-drawer');
    return dlg;
  }

  CRM.router.register('training', { title: 'Тренування', stores: ['workouts', 'programs'], render });
  // ---------- Вікно «Зсунути графік» (спільне для «Верх тіла» і програм з JSON) ----------
  /**
   * o: { defDate — дата за замовчуванням («Починаючи з тренування»),
   *      resolve(date) → дата тренування, яке переноситься (сама дата або найближче тренування після неї; кидає Error з текстом),
   *      defaultDays(датаТренування) → число, defaultFill(днів) → 'repeat'|'pause', repeatHint, intro,
   *      describe(датаТренування) → підпис тренування (необовʼязково),
   *      list() → [{ id, text }], add(date, days, fill) → Promise, remove(id) → Promise }.
   * Поля «На скільки днів» і «Перенести на дату» повʼязані: зміниш одне — друге порахується само.
   */
  function shiftDialog(o) {
    const MAX = 60;
    const daysWord = (n) => fmt.count(n, ['день', 'дні', 'днів']);
    let from = o.defDate;
    const session = () => { try { return o.resolve(from); } catch (e) { return null; } };
    const clamp = (n) => Math.max(1, Math.min(MAX, Math.round(Number(n) || 1)));
    const a0 = session();
    const daysIn = h('input', { class: 'input input-num', type: 'number', min: 1, max: MAX, step: 1, value: clamp(o.defaultDays ? o.defaultDays(a0 || from) : 1), 'aria-label': 'На скільки днів' });
    const days = () => { const n = Number(daysIn.value); return Number.isInteger(n) && n >= 1 && n <= MAX ? n : null; };
    const fDays = ui.field({ label: 'На скільки днів', input: daysIn });
    const dateIn = ui.dateInput({ value: from, clearable: false, ariaLabel: 'Починаючи з', onChange: (v) => { if (v) from = v; checkFrom(); syncTo(); } });
    const fDate = ui.field({ label: 'Починаючи з тренування', input: dateIn });
    const toIn = ui.dateInput({ value: null, clearable: false, placeholder: 'Оберіть дату', ariaLabel: 'Перенести на дату', onChange: (v) => {
      const a = session();
      if (!a || !v) { syncTo(); return; }
      const n = D.diffDays(a, v);
      if (n < 1 || n > MAX) {
        syncTo();
        fTo.setError(n < 1 ? `Має бути пізніше за ${fmt.dateShort(a)}` : `Не далі ніж на ${MAX} днів`);
        return;
      }
      daysIn.value = String(n);
      fDays.setError(null);
      autoFill();
      syncTo();
    } });
    const fTo = ui.field({ label: 'Перенести на дату', input: toIn });
    const sum = h('div', { class: 'ip-shift-sum', 'aria-live': 'polite' });
    function checkFrom() {
      try { o.resolve(from); fDate.setError(null); } catch (e) { fDate.setError(e.message); }
    }
    /** Нова дата тренування й підсумок — з дати тренування та кількості днів. */
    function syncTo() {
      const a = session();
      const n = days();
      fTo.setError(null);
      toIn.dateValue = a && n ? D.addDays(a, n) : null;
      if (!a || !n) { sum.textContent = ''; return; }
      const what = o.describe ? o.describe(a) : '';
      sum.textContent = `${a !== from ? 'Найближче тренування — ' : 'Тренування '}${fmt.dateShort(a)}${what ? ` (${what})` : ''} й усі наступні — на ${daysWord(n)} пізніше: тепер ${fmt.dateShort(D.addDays(a, n))}.`;
    }

    // Що в дні, що звільнилися
    let fill = o.defaultFill ? o.defaultFill(days() || 1) : 'pause';
    let fillTouched = false;
    const FILLS = [{ id: 'repeat', label: 'Повтор попередніх' }, { id: 'pause', label: 'Перерва' }];
    const fillSeg = h('div', { class: 'segmented ip-fill', role: 'radiogroup', 'aria-label': 'Дні, що звільнилися' });
    const fillHint = h('span');
    function renderFill() {
      ui.mount(fillSeg, FILLS.map((x) => h('button', {
        type: 'button', role: 'radio', class: fill === x.id ? 'active' : '', 'aria-checked': fill === x.id ? 'true' : 'false', dataset: { fill: x.id },
        onClick: () => { fill = x.id; fillTouched = true; renderFill(); }
      }, x.label)));
      fillHint.textContent = fill === 'pause' ? 'Без тренувань — програма продовжиться з того самого дня плану.' : (o.repeatHint || 'Повтор тренувань, що були перед зсувом.');
    }
    function autoFill() {
      if (fillTouched || !o.defaultFill) return;
      fill = o.defaultFill(Number(daysIn.value));
      renderFill();
    }
    renderFill();
    daysIn.addEventListener('input', () => { autoFill(); syncTo(); });
    const fFill = ui.field({ label: 'Дні, що звільнилися', input: fillSeg, hint: fillHint, className: 'ip-fill-field' });

    const listBox = h('div', { class: 'ip-shifts' });
    function renderList() {
      const items = o.list();
      ui.mount(listBox, items.length ? [h('div', { class: 'field-label' }, 'Уже зсунуто'),
        items.map((it) => h('div', { class: 'ip-shift' },
          h('span', null, it.text),
          h('button', { type: 'button', class: 'btn btn-ghost btn-sm', 'aria-label': 'Скасувати зсув', onClick: async () => { await o.remove(it.id); renderList(); checkFrom(); syncTo(); ui.toast('Зсув скасовано'); } }, CRM.icon('x', { size: 'sm' }), 'Скасувати')))] : null);
    }
    renderList();
    checkFrom();
    syncTo();

    const dlg = ui.modal({
      title: 'Зсунути графік',
      body: h('div', { class: 'stack', style: { gap: '14px' } },
        h('p', { class: 'modal-text' }, o.intro),
        h('div', { class: 'form-grid' }, fDate, fTo),
        h('div', { class: 'form-grid ip-shift-days' }, fDays, sum),
        fFill,
        listBox),
      footer: h('div', { class: 'btn-row' },
        ui.button({ label: 'Закрити', onClick: () => dlg.close('button') }),
        ui.button({ label: 'Зсунути', icon: 'calendar', variant: 'primary', onClick: async () => {
          const n = days();
          if (!n) { fDays.setError(`Від 1 до ${MAX} днів`); return; }
          try {
            await o.add(from, n, fill);
          } catch (e) { fDate.setError(e.message); return; }
          dlg.close('force');
          ui.toast(`Графік зсунуто на ${daysWord(n)}`, { type: 'success' });
        } }))
    });
    return dlg;
  }

  CRM.training = { openForm, stats, tonnage, pace, durationText, durationInput, parseDuration, durSec, secToMin, shiftDialog };
})(window.CRM);
