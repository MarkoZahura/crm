/* ==========================================================================
   tasks.js — розділ «Задачі».
   • Вкладки «Активні» та «Архів», сортування за дедлайном / пріоритетом,
     фільтр за статусом.
   • Бічна панель задачі: назва, опис, дедлайн, пріоритет, статус, чекліст,
     вкладення. Зміни існуючої задачі зберігаються автоматично.
   • Виконання — з підтвердженням; можна «Скасувати». Видалене — в Кошик.
   • Правила нагадувань: дедлайн сьогодні / завтра / прострочено.
   • План (з 24.10.2026, «Календар», етап 2): planDate — день, на який задачу
     заплановано (окремо від дедлайну), planStart 'ГГ:ХХ' | null — час у годинній
     сітці, planDur — тривалість у хв (за замовчуванням 30), planOrder — порядок
     у «Плані дня» серед задач без часу.
   • Нагадування (з 27.10.2026, ⚡ «нагадай о 18:00 …»): remind — хв до часу в плані
     (planDate + planStart), а якщо його немає — до часу дедлайну; null — без нагадування.
   • Мітки (з 28.10.2026): labels — ['диплом', 'дім'] (як написано; порівняння без регістру);
     свій колір мітки — налаштування taskLabels { 'мітка': { color } } (синхронізується),
     інакше колір за назвою. Фільтр за міткою, «Мітки» — перейменувати / колір / видалити.
   • «Відкласти» (завтра / понеділок / через тиждень / інша дата): переносить день у плані,
     а якщо плану немає — дедлайн; без дат — ставить у «План дня». «Дублювати» — копія без дат,
     чекліст не відмічений.
   ========================================================================== */
window.CRM = window.CRM || {};

(function (CRM) {
  'use strict';

  const { h, ui } = { h: CRM.ui.h, ui: CRM.ui };
  const D = CRM.date;
  const REMIND_FALLBACK = [
    { v: null, label: 'Без нагадування' }, { v: 0, label: 'У момент початку' }, { v: 5, label: 'За 5 хв' }, { v: 10, label: 'За 10 хв' },
    { v: 15, label: 'За 15 хв' }, { v: 30, label: 'За 30 хв' }, { v: 60, label: 'За 1 год' }, { v: 120, label: 'За 2 год' }, { v: 1440, label: 'За 1 день' }
  ];
  const remindList = () => (CRM.calendar && CRM.calendar.REMINDERS) || REMIND_FALLBACK;
  /** Мілісекунди моменту «дата + хвилини від 00:00» за київським часом. */
  function kyivMs(date, min) {
    const p0 = D.parse(date);
    const target = Date.UTC(p0.y, p0.m - 1, p0.d, Math.floor(min / 60), min % 60);
    let t = target;
    for (let i = 0; i < 2; i++) {
      const p = D.kyivParts(new Date(t));
      t += target - Date.UTC(p.y, p.m - 1, p.d, p.hh, p.mm, p.ss);
    }
    return t;
  }
  /** До якого часу нагадування задачі: план з часом, інакше дедлайн з часом. → { date, time, what } або null. */
  function remindAnchor(t) {
    if (t.planDate && t.planStart) return { date: t.planDate, time: t.planStart, what: 'plan' };
    if (t.deadline && t.deadlineTime) return { date: t.deadline, time: t.deadlineTime, what: 'deadline' };
    return null;
  }
  const fmt = CRM.fmt;

  // ---------- Налаштування вигляду (запам'ятовуються в цьому браузері) ----------
  function loadPref(key, def) {
    try { return localStorage.getItem(key) || def; } catch (e) { return def; }
  }
  function savePref(key, value) {
    try { localStorage.setItem(key, value); } catch (e) { /* не критично */ }
  }
  const view = {
    filter: loadPref('crm.tasks.filter', 'all'),
    sort: loadPref('crm.tasks.sort', 'deadline'),
    label: loadPref('crm.tasks.label', '')
  };

  // ---------- Мітки ----------
  const LABEL_MAX = 40;
  const AUTO_COLORS = ['blue', 'orange', 'aqua', 'yellow', 'magenta', 'green', 'violet', 'red', 'teal', 'brown', 'olive'];
  /** Ключ мітки для порівняння: без регістру, без «#». */
  const labelKey = (s) => CRM.utils.normalize(s).replace(/^#+/, '').trim();
  function cleanLabel(s) { return String(s || '').replace(/^#+/, '').replace(/\s+/g, ' ').trim().slice(0, LABEL_MAX); }
  function labelsOf(t) { return Array.isArray(t && t.labels) ? t.labels.filter((x) => typeof x === 'string' && x.trim()) : []; }
  function labelSettings() { return CRM.store.getSetting('taskLabels', null) || {}; }
  /** Колір мітки: свій (кабінет «Мітки») або стабільний за назвою. → id палітри. */
  function labelColorId(name) {
    const k = labelKey(name);
    const own = labelSettings()[k];
    if (own && own.color && CRM.dict.get('categoryColors', own.color)) return own.color;
    let x = 0;
    for (const ch of k) x = (x * 31 + ch.codePointAt(0)) >>> 0;
    return AUTO_COLORS[x % AUTO_COLORS.length];
  }
  function labelChip(name) {
    return h('span', { class: 'task-label', style: { '--lbl': CRM.dict.categoryColor(labelColorId(name)) }, dataset: { label: labelKey(name) } }, name);
  }
  /** Усі мітки з задач (активних і архівних): [{ name, key, active, total }] за абеткою. */
  function allLabels() {
    const m = new Map();
    CRM.store.list('tasks').forEach((t) => labelsOf(t).forEach((l) => {
      const k = labelKey(l);
      if (!k) return;
      const e = m.get(k) || { name: l, key: k, active: 0, total: 0 };
      e.total++;
      if (!t.done) e.active++;
      m.set(k, e);
    }));
    return Array.from(m.values()).sort((a, b) => a.name.localeCompare(b.name, 'uk'));
  }
  const hasLabel = (t, key) => labelsOf(t).some((l) => labelKey(l) === key);
  /** Додати мітки до списку без повторів (написання — як у вже наявної мітки). */
  function mergeLabels(list, more) {
    const known = new Map(allLabels().map((x) => [x.key, x.name]));
    const out = labelsOf({ labels: list }).slice();
    (more || []).forEach((raw) => {
      const name = cleanLabel(raw);
      const k = labelKey(name);
      if (!k || out.some((l) => labelKey(l) === k)) return;
      out.push(known.get(k) || name);
    });
    return out;
  }

  // ---------- Дані ----------
  function activeTasks() { return CRM.store.list('tasks').filter((t) => !t.done); }
  function archivedTasks() {
    return CRM.store.list('tasks').filter((t) => t.done)
      .sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || ''));
  }
  function prioWeight(p) { const x = CRM.dict.get('priorities', p); return x ? x.weight : 0; }

  function compareDeadline(a, b) {
    if (!a.deadline && !b.deadline) return 0;
    if (!a.deadline) return 1;
    if (!b.deadline) return -1;
    return (a.deadline + (a.deadlineTime || '99:99')).localeCompare(b.deadline + (b.deadlineTime || '99:99'));
  }

  function sortTasks(list, mode) {
    return list.slice().sort((a, b) => {
      const byPrio = prioWeight(b.priority) - prioWeight(a.priority);
      const byDl = compareDeadline(a, b);
      const byCreated = (a.createdAt || '').localeCompare(b.createdAt || '');
      return mode === 'priority' ? (byPrio || byDl || byCreated) : (byDl || byPrio || byCreated);
    });
  }

  /** Підпис дедлайну: { label, cls } або null. */
  function deadlineInfo(t) {
    if (!t.deadline) return null;
    const diff = D.diffDays(D.today(), t.deadline);
    const time = t.deadlineTime ? ', ' + t.deadlineTime : '';
    if (!t.done && diff < 0) return { label: 'Прострочено · ' + fmt.dateShort(t.deadline), cls: 'due-overdue' };
    if (diff === 0) return { label: 'Сьогодні' + time, cls: t.done ? '' : 'due-today' };
    if (diff === 1) return { label: 'Завтра' + time, cls: '' };
    if (diff === -1) return { label: 'Вчора' + time, cls: '' };
    return { label: fmt.dateShort(t.deadline) + time, cls: '' };
  }

  /** Найбільший порядок серед задач без часу, запланованих на дату (для нових — у кінець списку). */
  function nextPlanOrder(date, exceptId) {
    let max = -1;
    CRM.store.list('tasks').forEach((x) => {
      if (x.id !== exceptId && x.planDate === date && !x.planStart && typeof x.planOrder === 'number' && x.planOrder > max) max = x.planOrder;
    });
    return max + 1;
  }

  /** Підпис плану: «сьогодні, 10:00» або null. */
  function planLabel(t) {
    if (!t.planDate) return null;
    return fmt.relDay(t.planDate).toLowerCase() + (t.planStart ? ', ' + t.planStart : '');
  }

  // ---------- Дрібні елементи ----------
  function priorityTag(p) {
    const item = CRM.dict.get('priorities', p) || CRM.dict.get('priorities', 'medium');
    return h('span', { class: 'prio prio-' + item.id, title: 'Пріоритет: ' + item.label.toLowerCase() },
      h('span', { class: 'prio-dot', 'aria-hidden': 'true' }), h('span', { class: 'prio-label' }, item.label));
  }

  function statusBadge(t) {
    const label = CRM.dict.label('taskStatuses', t.status) || 'Не розпочато';
    if (t.done) return h('span', { class: 'badge badge-success' }, 'Виконано');
    const btn = h('button', {
      type: 'button', class: 'badge status status-' + (t.status || 'todo'), title: 'Змінити статус',
      'aria-haspopup': 'menu',
      onClick: (e) => { e.stopPropagation(); statusMenu(btn, t.id); }
    }, label, CRM.icon('chevronDown', { size: 'sm' }));
    return btn;
  }

  function statusMenu(anchor, id) {
    const t = CRM.store.get('tasks', id);
    if (!t) return;
    const pop = ui.popover(anchor, h('div', { class: 'menu', role: 'menu' },
      CRM.dict.taskStatuses.map((s) => h('button', {
        type: 'button', role: 'menuitemradio', class: 'menu-item' + (s.id === t.status ? ' active' : ''),
        'aria-checked': s.id === t.status ? 'true' : 'false',
        onClick: async (e) => {
          e.stopPropagation();
          pop.close();
          if (s.id !== t.status) await CRM.store.patch('tasks', id, { status: s.id });
        }
      }, h('span', { class: 'status-dot status-' + s.id }), s.label, s.id === t.status ? CRM.icon('check', { size: 'sm' }) : null))),
    { align: 'start', className: 'menu-pop' });
  }

  /** Кружечок-чекбокс задачі. */
  function checkbox(t) {
    return h('button', {
      type: 'button', class: 'task-check' + (t.done ? ' checked' : ''), role: 'checkbox',
      'aria-checked': t.done ? 'true' : 'false',
      'aria-label': t.done ? 'Задачу виконано' : `Позначити «${t.title}» виконаною`,
      title: t.done ? 'Виконано' : 'Позначити виконаною',
      disabled: t.done,
      onClick: (e) => { e.stopPropagation(); if (!t.done) complete(t.id); }
    }, CRM.icon('check', { size: 'sm' }));
  }

  /** Рядок задачі (для списку задач і Головної). */
  function taskRow(t, opts) {
    const o = opts || {};
    const dl = deadlineInfo(t);
    const checklist = t.checklist || [];
    const doneCount = checklist.filter((c) => c.done).length;
    const files = CRM.store.listAttachments(t.id).length;
    const meta = [];
    const labels = labelsOf(t);
    if (labels.length) meta.push(h('span', { class: 'task-labels' }, labels.map(labelChip)));
    if (checklist.length) meta.push(h('span', { class: 'task-meta-item', title: 'Чекліст' }, CRM.icon('listChecks', { size: 'sm' }), `${doneCount}/${checklist.length}`));
    if (files) meta.push(h('span', { class: 'task-meta-item', title: 'Вкладення' }, CRM.icon('paperclip', { size: 'sm' }), String(files)));
    if (t.planDate && !t.done) meta.push(h('span', { class: 'task-meta-item task-plan' + (t.planDate < D.today() ? ' overdue' : ''), title: 'Заплановано в календарі' }, CRM.icon('target', { size: 'sm' }), 'План: ' + planLabel(t)));
    if (o.archive && t.completedAt) meta.push(h('span', { class: 'task-meta-item' }, 'Виконано ' + fmt.dateShort(D.toKyivDate(t.completedAt))));

    const row = h('div', {
      class: 'task-row' + (t.done ? ' is-done' : '') + (o.compact ? ' compact' : ''),
      role: 'button', tabIndex: 0, 'aria-label': 'Відкрити задачу ' + t.title, dataset: { id: t.id },
      onClick: () => openTask(t.id),
      onKeydown: (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === row) { e.preventDefault(); openTask(t.id); } }
    },
    checkbox(t),
    h('div', { class: 'task-main' },
      h('div', { class: 'task-title' }, t.title),
      meta.length ? h('div', { class: 'task-meta' }, meta) : null),
    h('div', { class: 'task-cols' },
      o.compact ? null : statusBadge(t),
      priorityTag(t.priority),
      h('span', { class: 'task-due ' + (dl ? dl.cls : 'subtle') }, dl ? dl.label : 'Без дедлайну'),
      !t.done && !o.compact && !o.archive ? snoozeButton(t.id) : null,
      o.archive ? ui.button({
        label: 'Відновити', icon: 'restore', size: 'sm',
        onClick: (e) => { e.stopPropagation(); reopen(t.id); }
      }) : null));
    return row;
  }

  // ---------- Дії ----------
  /** opts.confirm === false — без вікна підтвердження (галочка в «Календарі»; є «Скасувати»). */
  async function complete(id, opts) {
    const t = CRM.store.get('tasks', id);
    if (!t || t.done) return false;
    const ok = opts && opts.confirm === false ? true : await ui.confirm({
      title: `Позначити задачу „${t.title}“ виконаною?`,
      message: 'Вона перейде в Архів. Повернути її можна кнопкою «Відновити».',
      confirmText: 'Так, виконано'
    });
    if (!ok) return false;
    await CRM.store.patch('tasks', id, { done: true, completedAt: new Date().toISOString() });
    const n = await CRM.notify.push({
      key: `task:done:${id}:${Date.now()}`, kind: 'task', title: 'Задачу виконано', text: t.title,
      target: { store: 'tasks', id }, read: true
    });
    ui.toast('Задачу виконано й перенесено в архів', {
      type: 'success',
      action: {
        label: 'Скасувати',
        onClick: async () => {
          await CRM.store.patch('tasks', id, { done: false, completedAt: null });
          if (n) await CRM.store.removeForever('notifications', n.id);
          ui.toast('Задачу повернуто в активні');
        }
      }
    });
    return true;
  }

  /** Створити задачу одразу (без панелі) — напр., з «Плану дня» в «Календарі». */
  async function create(fields) {
    const rec = await CRM.store.save('tasks', Object.assign({
      title: '', description: '', status: 'todo', priority: 'medium',
      deadline: null, deadlineTime: null, checklist: [], done: false, completedAt: null
    }, fields || {}));
    CRM.notify.runRules();
    return rec;
  }

  // ---------- Відкласти ----------
  function dayShort(d) { return `${CRM.WEEKDAYS_SHORT[D.weekday(d)]}, ${fmt.dateShort(d)}`; }
  /** Варіанти: завтра, найближчий наступний понеділок (у понеділок — через тиждень), сьогодні + 7. */
  function snoozeTargets() {
    const T = D.today();
    return [
      { id: 'tomorrow', label: 'Завтра', date: D.addDays(T, 1) },
      { id: 'monday', label: 'Понеділок', date: D.addDays(T, 7 - D.weekday(T)) },
      { id: 'week', label: 'Через тиждень', date: D.addDays(T, 7) }
    ];
  }
  /**
   * Відкласти задачу на date: день у «Плані дня» (час лишається), якщо плану немає — дедлайн,
   * якщо немає й дедлайну — поставити в «План дня» цього дня. Тост «Скасувати».
   */
  async function snooze(id, date) {
    const t = CRM.store.get('tasks', id);
    if (!t || t.deletedAt || t.done || !D.isDate(date)) return null;
    const before = { planDate: t.planDate || null, planStart: t.planStart || null, planOrder: t.planOrder == null ? null : t.planOrder, deadline: t.deadline || null, deadlineTime: t.deadlineTime || null };
    let changes;
    let what = 'plan';
    if (t.planDate) {
      changes = { planDate: date };
      if (!t.planStart && date !== t.planDate) changes.planOrder = nextPlanOrder(date, t.id);
    } else if (t.deadline) {
      changes = { deadline: date };
      what = 'deadline';
    } else {
      changes = { planDate: date, planStart: null, planOrder: nextPlanOrder(date, t.id) };
    }
    await CRM.store.patch('tasks', id, changes);
    CRM.notify.runRules();
    ui.toast(`«${t.title}» відкладено на ${dayShort(date)}${what === 'deadline' ? ' (дедлайн)' : ''}`, {
      type: 'success', duration: 8000,
      action: {
        label: 'Скасувати',
        onClick: async () => {
          if (!CRM.store.get('tasks', id)) return;
          await CRM.store.patch('tasks', id, before);
          CRM.notify.runRules();
          ui.toast('Повернуто як було');
        }
      }
    });
    return changes;
  }
  /** Меню «Відкласти на…» біля кнопки. */
  function snoozeMenu(anchor, id, onDone) {
    const pick = (date) => { pop.close(); snooze(id, date).then((ch) => { if (ch && onDone) onDone(ch); }); };
    const pop = ui.popover(anchor, h('div', { class: 'snooze-menu', role: 'menu', 'aria-label': 'Відкласти на' },
      h('div', { class: 'snooze-title' }, 'Відкласти на…'),
      snoozeTargets().map((x) => h('button', {
        type: 'button', class: 'snooze-opt', role: 'menuitem', dataset: { when: x.id }, onClick: () => pick(x.date)
      }, h('span', null, x.label), h('span', { class: 'snooze-date' }, dayShort(x.date)))),
      h('button', {
        type: 'button', class: 'snooze-opt', role: 'menuitem', dataset: { when: 'date' },
        onClick: () => { pop.close(); snoozeToDate(id, onDone); }
      }, h('span', null, 'Інша дата…'))), { className: 'snooze-pop' });
    const first = pop.el.querySelector('.snooze-opt');
    if (first) first.focus();
    pop.el.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
      e.preventDefault();
      const opts = Array.from(pop.el.querySelectorAll('.snooze-opt'));
      const i = opts.indexOf(document.activeElement);
      opts[(i + (e.key === 'ArrowDown' ? 1 : -1) + opts.length) % opts.length].focus();
    });
    return pop;
  }
  function snoozeToDate(id, onDone) {
    const t = CRM.store.get('tasks', id);
    if (!t) return;
    const di = ui.dateInput({ value: D.addDays(D.today(), 1), ariaLabel: 'Нова дата' });
    const err = h('div', { class: 'field-error', hidden: true });
    const ok = ui.button({
      label: 'Відкласти', variant: 'primary', className: 'snooze-ok',
      onClick: async () => {
        const d = di.dateValue;
        if (!d) { err.textContent = 'Вибери дату'; err.hidden = false; return; }
        dlg.close('force');
        const ch = await snooze(id, d);
        if (ch && onDone) onDone(ch);
      }
    });
    const dlg = ui.modal({
      title: 'Відкласти на дату', size: 'sm', center: true, className: 'snooze-modal',
      body: [h('p', { class: 'modal-text' }, t.planDate ? 'Переїде день у «Плані дня» (час лишиться).' : t.deadline ? 'Переїде дедлайн.' : 'Задача зʼявиться в «Плані дня» цього дня.'), di, err],
      footer: [ui.button({ label: 'Скасувати', onClick: () => dlg.close('cancel') }), ok],
      initialFocus: ok
    });
  }
  function snoozeButton(id) {
    const btn = ui.button({
      icon: 'clock', iconOnly: true, size: 'sm', variant: 'ghost', title: 'Відкласти', className: 'task-snooze',
      onClick: (e) => { e.stopPropagation(); snoozeMenu(btn, id); }
    });
    btn.addEventListener('keydown', (e) => e.stopPropagation());
    return btn;
  }

  // ---------- Дублювати ----------
  /** Копія задачі: назва «… (копія)», опис, пріоритет, мітки, чекліст (усе не відмічене); без дат і вкладень. */
  async function duplicate(id) {
    const t = CRM.store.get('tasks', id);
    if (!t || t.deletedAt) return null;
    const rec = await create({
      title: `${t.title || 'Без назви'} (копія)`, description: t.description || '', priority: t.priority || 'medium', status: 'todo',
      labels: labelsOf(t).slice(),
      checklist: (t.checklist || []).map((c) => ({ id: CRM.utils.uid(), text: c.text, done: false }))
    });
    ui.toast('Створено копію задачі', {
      type: 'success', duration: 8000,
      action: { label: 'Скасувати', onClick: async () => { if (CRM.store.get('tasks', rec.id)) await CRM.store.removeForever('tasks', rec.id); ui.toast('Копію прибрано'); } }
    });
    return rec;
  }

  // ---------- Керування мітками ----------
  async function renameLabel(oldKey, newName) {
    const name = cleanLabel(newName);
    const nk = labelKey(name);
    if (!nk) return false;
    const changed = [];
    CRM.store.list('tasks').forEach((t) => {
      const ls = labelsOf(t);
      if (!ls.some((l) => labelKey(l) === oldKey)) return;
      const out = [];
      ls.forEach((l) => {
        const v = labelKey(l) === oldKey ? name : l;
        if (!out.some((x) => labelKey(x) === labelKey(v))) out.push(v);
      });
      changed.push(Object.assign({}, t, { labels: out }));
    });
    if (changed.length) await CRM.store.saveMany('tasks', changed);
    if (nk !== oldKey) {
      const st = Object.assign({}, labelSettings());
      if (st[oldKey] && !st[nk]) st[nk] = st[oldKey];
      if (st[oldKey]) { delete st[oldKey]; await CRM.store.setSetting('taskLabels', st); }
    }
    if (view.label === oldKey) { view.label = nk; savePref('crm.tasks.label', nk); }
    ui.toast(`Мітку перейменовано на «${name}» (${fmt.count(changed.length, ['задача', 'задачі', 'задач'])})`, { type: 'success' });
    return true;
  }
  async function deleteLabel(key) {
    const lb = allLabels().find((x) => x.key === key);
    if (!lb) return false;
    const ok = await ui.confirm({
      title: `Видалити мітку «${lb.name}»?`,
      message: `Її буде прибрано з ${fmt.count(lb.total, ['задачі', 'задач', 'задач'])}. Самі задачі лишаться.`,
      confirmText: 'Видалити мітку', danger: true
    });
    if (!ok) return false;
    const snapshot = [];
    const changed = [];
    CRM.store.list('tasks').forEach((t) => {
      if (!hasLabel(t, key)) return;
      snapshot.push({ id: t.id, labels: labelsOf(t).slice() });
      changed.push(Object.assign({}, t, { labels: labelsOf(t).filter((l) => labelKey(l) !== key) }));
    });
    if (changed.length) await CRM.store.saveMany('tasks', changed);
    const st = Object.assign({}, labelSettings());
    const color = st[key];
    if (color) { delete st[key]; await CRM.store.setSetting('taskLabels', st); }
    if (view.label === key) { view.label = ''; savePref('crm.tasks.label', ''); }
    ui.toast(`Мітку «${lb.name}» видалено`, {
      type: 'success', duration: 8000,
      action: {
        label: 'Скасувати',
        onClick: async () => {
          const back = snapshot.map((x) => { const t = CRM.store.get('tasks', x.id); return t ? Object.assign({}, t, { labels: x.labels }) : null; }).filter(Boolean);
          if (back.length) await CRM.store.saveMany('tasks', back);
          if (color) await CRM.store.setSetting('taskLabels', Object.assign({}, labelSettings(), { [key]: color }));
          ui.toast('Мітку повернуто');
        }
      }
    });
    return true;
  }
  async function setLabelColor(key, colorId) {
    const st = Object.assign({}, labelSettings());
    if (colorId) st[key] = { color: colorId }; else delete st[key];
    await CRM.store.setSetting('taskLabels', st);
  }
  /** Вікно «Мітки задач»: колір, перейменувати, видалити. */
  function openLabels() {
    const body = h('div', { class: 'lbl-manage' });
    let off = null;
    function render() {
      const list = allLabels();
      if (!list.length) {
        ui.mount(body, ui.empty({ icon: 'tag', small: true, title: 'Міток ще немає', text: 'Додай мітку в задачі (поле «Мітки») або через ⚡: «здати розділ #диплом».' }));
        return;
      }
      ui.mount(body,
        h('p', { class: 'subtle lbl-hint' }, 'Змінене імʼя застосовується до всіх задач з цією міткою; якщо така мітка вже є — вони обʼєднаються.'),
        list.map((x) => {
          const sw = h('button', {
            type: 'button', class: 'lbl-swatch', style: { '--lbl': CRM.dict.categoryColor(labelColorId(x.name)) },
            title: 'Колір мітки', 'aria-label': `Колір мітки «${x.name}»`,
            onClick: () => colorMenu(sw, x)
          });
          const nameIn = h('input', { class: 'input input-sm lbl-name', value: x.name, maxlength: LABEL_MAX, 'aria-label': `Назва мітки «${x.name}»` });
          const save = async () => {
            const v = cleanLabel(nameIn.value);
            if (!v) { nameIn.value = x.name; return; }
            if (v === x.name) return;
            await renameLabel(x.key, v);
          };
          nameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); nameIn.blur(); } if (e.key === 'Escape') { nameIn.value = x.name; } });
          nameIn.addEventListener('change', save);
          return h('div', { class: 'lbl-row', dataset: { label: x.key } },
            sw, nameIn,
            h('span', { class: 'lbl-count subtle' }, x.active === x.total ? fmt.count(x.total, ['задача', 'задачі', 'задач']) : `${x.active} активн. · ${x.total} усього`),
            ui.button({ icon: 'trash', iconOnly: true, size: 'sm', variant: 'ghost', title: 'Видалити мітку', className: 'lbl-del', onClick: () => deleteLabel(x.key) }));
        }));
    }
    function colorMenu(anchor, x) {
      const cur = labelSettings()[x.key];
      const pop = ui.popover(anchor, h('div', { class: 'lbl-colors' },
        h('div', { class: 'swatches' }, CRM.dict.categoryColors.map((c) => h('button', {
          type: 'button', class: 'swatch' + (labelColorId(x.name) === c.id ? ' active' : ''), style: { '--sw': CRM.dict.categoryColor(c.id) },
          title: c.name, 'aria-label': c.name, dataset: { color: c.id },
          onClick: async () => { pop.close(); await setLabelColor(x.key, c.id); }
        }))),
        cur ? h('button', { type: 'button', class: 'link-like lbl-auto', onClick: async () => { pop.close(); await setLabelColor(x.key, null); } }, 'Автоматично (за назвою)') : null), { align: 'start', className: 'lbl-colors-pop' });
    }
    render();
    off = CRM.store.on(['tasks', 'settings'], () => {
      if (body.contains(document.activeElement) && document.activeElement.classList.contains('lbl-name')) return;
      render();
    });
    const dlg = ui.modal({
      title: 'Мітки задач', size: 'sm', className: 'lbl-modal', body,
      footer: [ui.button({ label: 'Готово', variant: 'primary', onClick: () => dlg.close('button') })],
      onClose: () => { if (off) off(); }
    });
    return dlg;
  }

  async function reopen(id) {
    const t = CRM.store.get('tasks', id);
    if (!t || !t.done) return;
    await CRM.store.patch('tasks', id, { done: false, completedAt: null });
    ui.toast(`«${t.title}» знову серед активних`, {
      type: 'success',
      action: { label: 'Показати', onClick: () => CRM.router.go('tasks', { open: id }) }
    });
    CRM.notify.runRules();
  }

  async function remove(id) {
    const t = CRM.store.get('tasks', id);
    if (!t) return false;
    const ok = await ui.confirm({
      title: 'Видалити задачу?',
      message: `„${t.title}“ потрапить у Кошик. Звідти її можна відновити протягом 30 днів.`,
      confirmText: 'Видалити', danger: true
    });
    if (!ok) return false;
    const batch = await CRM.store.softDelete('tasks', id);
    ui.toast('Задачу перенесено в Кошик', {
      action: { label: 'Скасувати', onClick: () => CRM.store.restoreBatch(batch) }
    });
    return true;
  }

  // ---------- Вкладення: перегляд і завантаження ----------
  async function viewAttachment(meta) {
    const blob = await CRM.store.getAttachmentBlob(meta.id);
    if (!blob) { ui.toast('Файл не знайдено', { type: 'error' }); return; }
    const type = meta.type || blob.type || '';
    if (type.startsWith('image/')) {
      const url = URL.createObjectURL(blob);
      ui.modal({
        title: meta.name, size: 'lg', center: true, className: 'preview-modal',
        body: h('div', { class: 'preview-wrap' }, h('img', { src: url, alt: meta.name, class: 'preview-img' })),
        footer: [
          ui.button({ label: 'Завантажити', icon: 'download', onClick: () => CRM.utils.downloadBlob(blob, meta.name) })
        ],
        onClose: () => URL.revokeObjectURL(url)
      });
      return;
    }
    if (/^(application\/pdf|text\/|audio\/|video\/|application\/json)/.test(type)) {
      // Текст відкриваємо з явним кодуванням UTF-8, щоб кирилиця читалася правильно
      const viewBlob = type.startsWith('text/') || type === 'application/json' ? new Blob([blob], { type: 'text/plain;charset=utf-8' }) : blob;
      const url = URL.createObjectURL(viewBlob);
      const win = window.open(url, '_blank');
      if (!win) {
        ui.toast('Браузер не дав відкрити нову вкладку — завантажую файл');
        CRM.utils.downloadBlob(blob, meta.name);
      }
      setTimeout(() => URL.revokeObjectURL(url), 60000);
      return;
    }
    ui.toast('Цей тип файлу не відкривається в браузері — завантажую його');
    CRM.utils.downloadBlob(blob, meta.name);
  }

  async function downloadAttachment(meta) {
    const blob = await CRM.store.getAttachmentBlob(meta.id);
    if (!blob) { ui.toast('Файл не знайдено', { type: 'error' }); return; }
    CRM.utils.downloadBlob(blob, meta.name);
  }

  function fileIcon(type) { return (type || '').startsWith('image/') ? 'image' : 'file'; }

  // ---------- Бічна панель задачі ----------
  function openNew(prefill) { return openEditor(null, prefill); }
  function openTask(id) { return openEditor(id); }

  /** Відкладене збереження з можливістю «дозберегти» негайно. */
  function deferred(fn, ms) {
    let timer = null;
    let pending = null;
    const run = () => { clearTimeout(timer); timer = null; if (pending) { const a = pending; pending = null; return fn(...a); } return null; };
    const call = (...args) => { pending = args; clearTimeout(timer); timer = setTimeout(run, ms); };
    call.flush = run;
    return call;
  }

  function openEditor(taskId, prefill) {
    const isNew = !taskId;
    let task;
    if (isNew) {
      task = Object.assign({
        id: CRM.utils.uid(), title: '', description: '', status: 'todo', priority: 'medium',
        deadline: null, deadlineTime: null, checklist: [], done: false, completedAt: null
      }, prefill || {});
    } else {
      const cur = CRM.store.get('tasks', taskId);
      if (!cur) { ui.toast('Задачу не знайдено', { type: 'error' }); return null; }
      if (cur.deletedAt) { ui.toast('Задача в Кошику — віднови її, щоб відкрити'); return null; }
      task = CRM.utils.deepClone(cur);
    }
    const pendingFiles = []; // файли нової задачі — зберігаються разом зі створенням
    const savedHint = h('span', { class: 'save-hint' });
    let savedTimer = null;

    async function commit(changes) {
      Object.assign(task, changes);
      if (isNew) return;
      const cur = CRM.store.get('tasks', task.id);
      if (!cur || cur.deletedAt) return;
      await CRM.store.patch('tasks', task.id, changes);
      savedHint.textContent = 'Збережено';
      savedHint.classList.add('visible');
      clearTimeout(savedTimer);
      savedTimer = setTimeout(() => savedHint.classList.remove('visible'), 1500);
      if ('deadline' in changes || 'deadlineTime' in changes) CRM.notify.runRules();
    }

    // --- Назва ---
    const titleIn = h('textarea', {
      class: 'task-title-input', rows: 1, maxlength: 200, placeholder: 'Назва задачі', 'aria-label': 'Назва задачі',
      value: task.title
    });
    const titleField = ui.field({ input: titleIn, className: 'task-title-field' });
    const saveTitle = deferred((v) => commit({ title: v }), 400);
    titleIn.addEventListener('input', () => {
      titleIn.value = titleIn.value.replace(/\n/g, ' ');
      autoGrow(titleIn);
      const v = titleIn.value.trim();
      if (isNew) { task.title = v; return; }
      if (!v) { titleField.setError('Назва не може бути порожньою'); return; }
      titleField.setError(null);
      saveTitle(v);
    });
    titleIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); descIn.focus(); } });

    // --- Опис ---
    const descIn = ui.textarea({ placeholder: 'Опис, посилання, деталі…', rows: 3, value: task.description || '', 'aria-label': 'Опис' });
    const saveDesc = deferred((v) => commit({ description: v }), 500);
    descIn.addEventListener('input', () => { autoGrow(descIn); if (isNew) task.description = descIn.value; else saveDesc(descIn.value); });

    // --- Дедлайн ---
    const dateIn = ui.dateInput({
      value: task.deadline, placeholder: 'Без дедлайну', ariaLabel: 'Дата дедлайну',
      onChange: (d) => setDeadline(d, timeIn.value)
    });
    const timeIn = ui.timeInput({ value: task.deadlineTime || '', onChange: (t) => setDeadline(dateIn.dateValue, t) });
    timeIn.disabled = !task.deadline;
    timeIn.title = 'Час — необовʼязково';
    const clearBtn = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', hidden: !task.deadline, onClick: () => setDeadline(null, null) }, 'Очистити');
    function setDeadline(date, time) {
      dateIn.dateValue = date || null;
      timeIn.value = date ? (time || '') : '';
      timeIn.disabled = !date;
      clearBtn.hidden = !date;
      commit({ deadline: date || null, deadlineTime: date && time ? time : null });
      renderQuick();
      if (typeof renderRemind === 'function') renderRemind();
    }
    // --- План (день у «Календарі») ---
    const planDateIn = ui.dateInput({
      value: task.planDate, placeholder: 'Не заплановано', ariaLabel: 'Заплановано на',
      onChange: (d) => setPlan(d, planTimeIn.value)
    });
    const planTimeIn = ui.timeInput({ value: task.planStart || '', ariaLabel: 'Час у плані (необовʼязково)', onChange: (t) => setPlan(planDateIn.dateValue, t) });
    planTimeIn.disabled = !task.planDate;
    planTimeIn.title = 'Час — необовʼязково: без нього задача стоїть у «Плані дня» по порядку';
    const planClear = h('button', { type: 'button', class: 'btn btn-ghost btn-sm', hidden: !task.planDate, onClick: () => setPlan(null, null) }, 'Очистити');
    function setPlan(date, time) {
      planDateIn.dateValue = date || null;
      planTimeIn.value = date ? (time || '') : '';
      planTimeIn.disabled = !date;
      planClear.hidden = !date;
      const changes = { planDate: date || null, planStart: date && time ? time : null };
      if (date && !time && (date !== task.planDate || task.planStart)) changes.planOrder = nextPlanOrder(date, task.id);
      commit(changes);
      renderPlanQuick();
      if (typeof renderRemind === 'function') renderRemind();
      if ('planStart' in changes) CRM.notify.runRules();
    }
    const planQuick = h('div', { class: 'chips' });
    function renderPlanQuick() {
      const T = D.today();
      ui.mount(planQuick, [['Сьогодні', T], ['Завтра', D.addDays(T, 1)]].map(([label, date]) => h('button', {
        type: 'button', class: 'chip' + (planDateIn.dateValue === date ? ' active' : ''),
        onClick: () => setPlan(date, planTimeIn.value)
      }, label)));
    }
    renderPlanQuick();

    // --- Мітки ---
    const labelsBox = h('div', { class: 'task-labels-edit' });
    const labelIn = h('input', { class: 'input input-sm task-label-input', type: 'text', maxlength: LABEL_MAX, placeholder: 'Додати мітку…', 'aria-label': 'Нова мітка', autocomplete: 'off', enterkeyhint: 'done' });
    const labelSugg = h('div', { class: 'task-label-sugg' });
    function currentLabels() {
      if (isNew) return labelsOf(task);
      const cur = CRM.store.get('tasks', task.id);
      return labelsOf(cur || task);
    }
    async function setLabels(list) {
      await commit({ labels: list });
      renderLabels();
    }
    function addLabel(v) {
      const list = mergeLabels(currentLabels(), [v]);
      labelIn.value = '';
      if (list.length !== currentLabels().length) setLabels(list).then(() => labelIn.focus());
      else renderSugg();
    }
    function renderSugg() {
      const q = labelKey(labelIn.value);
      const mine = new Set(currentLabels().map(labelKey));
      const list = allLabels().filter((x) => !mine.has(x.key) && (!q || x.key.includes(q))).slice(0, 10);
      const show = document.activeElement === labelIn || !!q;
      ui.mount(labelSugg, show ? list.map((x) => h('button', {
        type: 'button', class: 'chip task-label-sug', tabIndex: -1, dataset: { label: x.key },
        onMousedown: (e) => e.preventDefault(), onClick: () => addLabel(x.name)
      }, h('span', { class: 'task-label-dot', style: { '--lbl': CRM.dict.categoryColor(labelColorId(x.name)) } }), x.name)) : null);
    }
    function renderLabels() {
      ui.mount(labelsBox, currentLabels().map((l) => h('span', { class: 'task-label task-label-x', style: { '--lbl': CRM.dict.categoryColor(labelColorId(l)) }, dataset: { label: labelKey(l) } },
        l,
        h('button', {
          type: 'button', class: 'task-label-del', 'aria-label': `Прибрати мітку «${l}»`, title: 'Прибрати',
          onClick: () => setLabels(currentLabels().filter((x) => labelKey(x) !== labelKey(l)))
        }, CRM.icon('x', { size: 'sm' })))), labelIn);
      renderSugg();
    }
    labelIn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ',') { e.preventDefault(); if (labelIn.value.trim()) addLabel(labelIn.value); }
      else if (e.key === 'Backspace' && !labelIn.value) {
        const list = currentLabels();
        if (list.length) { e.preventDefault(); setLabels(list.slice(0, -1)).then(() => labelIn.focus()); }
      }
    });
    labelIn.addEventListener('input', renderSugg);
    labelIn.addEventListener('focus', renderSugg);
    labelIn.addEventListener('blur', () => setTimeout(() => { if (labelIn.value.trim()) addLabel(labelIn.value); else renderSugg(); }, 150));
    renderLabels();

    // --- Нагадування (до часу в плані або дедлайну) ---
    const remindOpts = remindList().slice();
    if (task.remind != null && !remindOpts.some((r) => r.v === task.remind)) remindOpts.push({ v: task.remind, label: `За ${task.remind} хв` });
    const remindSel = ui.select(remindOpts.map((r) => ({ value: r.v == null ? '' : String(r.v), label: r.label })),
      { value: task.remind == null ? '' : String(task.remind), 'aria-label': 'Нагадати' });
    remindSel.classList.add('task-remind');
    const remindHint = h('div', { class: 'field-hint task-remind-hint' });
    function renderRemind() {
      const a = remindAnchor(task);
      remindSel.disabled = !a && task.remind == null;
      remindHint.textContent = a
        ? (a.what === 'plan' ? `До часу в плані: ${fmt.relDay(a.date).toLowerCase()}, ${a.time}.` : `До дедлайну: ${fmt.relDay(a.date).toLowerCase()}, ${a.time}.`) + ' Приходить, лише коли CRM відкрита.'
        : 'Потрібен час у «Заплановано» або в дедлайні.';
    }
    remindSel.addEventListener('change', () => {
      const v = remindSel.value === '' ? null : Number(remindSel.value);
      commit({ remind: v });
      CRM.notify.runRules();
      renderRemind();
    });
    renderRemind();

    const quick = h('div', { class: 'chips' });
    function renderQuick() {
      const T = D.today();
      const opts = [['Сьогодні', T], ['Завтра', D.addDays(T, 1)], ['Через тиждень', D.addDays(T, 7)]];
      ui.mount(quick, opts.map(([label, date]) => h('button', {
        type: 'button', class: 'chip' + (dateIn.dateValue === date ? ' active' : ''),
        onClick: () => setDeadline(date, timeIn.value)
      }, label)));
    }
    renderQuick();

    // --- Пріоритет і статус ---
    function segmented(list, current, onPick, label) {
      const wrap = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': label });
      const render = (val) => ui.mount(wrap, list.map((x) => h('button', {
        type: 'button', role: 'radio', class: val === x.id ? 'active' : '', 'aria-checked': val === x.id ? 'true' : 'false',
        onClick: () => { render(x.id); onPick(x.id); }
      }, x.dot ? h('span', { class: x.dot }) : null, x.label)));
      render(current);
      return wrap;
    }
    const prioList = ['low', 'medium', 'high'].map((id) => ({ id, label: CRM.dict.label('priorities', id), dot: 'prio-dot prio-' + id }));
    const prioSeg = segmented(prioList, task.priority, (v) => commit({ priority: v }), 'Пріоритет');
    const statusList = CRM.dict.taskStatuses.map((s) => ({ id: s.id, label: s.label, dot: 'status-dot status-' + s.id }));
    const statusSeg = segmented(statusList, task.status, (v) => commit({ status: v }), 'Статус');

    // --- Чекліст ---
    const checklistBox = h('div', { class: 'checklist' });
    const checklistHead = h('div', { class: 'section-head' });
    const newItemIn = ui.input({ placeholder: 'Додати пункт і натиснути Enter', 'aria-label': 'Новий пункт чекліста', maxlength: 200 });
    newItemIn.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const text = newItemIn.value.trim();
      if (!text) return;
      newItemIn.value = '';
      commit({ checklist: currentChecklist().concat([{ id: CRM.utils.uid(), text, done: false }]) }).then(renderChecklist);
    });
    function currentChecklist() {
      if (isNew) return task.checklist.slice();
      const cur = CRM.store.get('tasks', task.id);
      return ((cur && cur.checklist) || task.checklist || []).slice();
    }
    function updateItem(itemId, changes) {
      const list = currentChecklist().map((c) => (c.id === itemId ? Object.assign({}, c, changes) : c));
      return commit({ checklist: list });
    }
    function renderChecklist() {
      const list = isNew ? task.checklist : currentChecklist();
      const done = list.filter((c) => c.done).length;
      ui.mount(checklistHead,
        h('h3', null, CRM.icon('listChecks', { size: 'sm' }), 'Чекліст'),
        list.length ? h('span', { class: 'subtle num' }, `${done} з ${list.length}`) : null);
      const progress = list.length
        ? h('div', { class: 'progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(list.length), 'aria-valuenow': String(done) },
          h('div', { class: 'progress-bar', style: { width: Math.round(done / list.length * 100) + '%' } }))
        : null;
      ui.mount(checklistBox, progress, list.map((c) => {
        const text = h('input', { class: 'check-text' + (c.done ? ' done' : ''), value: c.text, maxlength: 200, 'aria-label': 'Текст пункту' });
        text.addEventListener('change', () => {
          const v = text.value.trim();
          if (!v) { text.value = c.text; return; }
          updateItem(c.id, { text: v });
        });
        text.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); text.blur(); } });
        return h('div', { class: 'check-item' },
          h('button', {
            type: 'button', class: 'task-check small' + (c.done ? ' checked' : ''), role: 'checkbox',
            'aria-checked': c.done ? 'true' : 'false', 'aria-label': c.done ? 'Зняти позначку' : 'Позначити пункт',
            onClick: async () => { await updateItem(c.id, { done: !c.done }); renderChecklist(); }
          }, CRM.icon('check', { size: 'sm' })),
          text,
          h('button', {
            type: 'button', class: 'btn btn-ghost btn-icon btn-sm check-del', title: 'Видалити пункт', 'aria-label': 'Видалити пункт',
            onClick: async () => { await commit({ checklist: currentChecklist().filter((x) => x.id !== c.id) }); renderChecklist(); }
          }, CRM.icon('x', { size: 'sm' })));
      }));
    }
    renderChecklist();

    // --- Вкладення ---
    const filesBox = h('div', { class: 'files' });
    const filesHead = h('div', { class: 'section-head' });
    const fileInput = h('input', { type: 'file', multiple: true, class: 'sr-only', tabIndex: -1, 'aria-hidden': 'true' });
    const fileError = h('div', { class: 'field-error', style: { display: 'none' }, role: 'alert' });
    fileInput.addEventListener('change', () => { addFiles(Array.from(fileInput.files)); fileInput.value = ''; });
    const drop = h('div', { class: 'dropzone', tabIndex: 0, role: 'button', 'aria-label': 'Додати файли',
      onClick: () => fileInput.click(),
      onKeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); fileInput.click(); } }
    }, CRM.icon('paperclip', { size: 'sm' }), h('span', null, 'Перетягни файли сюди або ', h('span', { class: 'link-like' }, 'вибери на компʼютері')), h('span', { class: 'subtle' }, 'до 10 МБ кожен'));
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
    drop.addEventListener('drop', (e) => { if (e.dataTransfer && e.dataTransfer.files) addFiles(Array.from(e.dataTransfer.files)); });

    async function addFiles(files) {
      const errors = [];
      for (const f of files) {
        if (f.size > CRM.store.MAX_ATTACHMENT) {
          errors.push(`Файл «${f.name}» завеликий (${fmt.bytes(f.size)}). Максимум — 10 МБ.`);
          continue;
        }
        if (isNew) { pendingFiles.push(f); continue; }
        try { await CRM.store.addAttachment(task.id, f); } catch (e) { errors.push(e.message); }
      }
      fileError.textContent = errors.join(' ');
      fileError.style.display = errors.length ? 'block' : 'none';
      if (errors.length) ui.toast(errors[0], { type: 'error', duration: 7000 });
      renderFiles();
    }

    function renderFiles() {
      const list = isNew
        ? pendingFiles.map((f, i) => ({ id: 'p' + i, name: f.name, size: f.size, type: f.type, pending: i }))
        : CRM.store.listAttachments(task.id);
      ui.mount(filesHead,
        h('h3', null, CRM.icon('paperclip', { size: 'sm' }), 'Вкладення'),
        list.length ? h('span', { class: 'subtle num' }, String(list.length)) : null);
      ui.mount(filesBox, list.map((a) => h('div', { class: 'file-row' },
        h('span', { class: 'list-row-icon' }, CRM.icon(fileIcon(a.type), { size: 'sm' })),
        h('div', { class: 'file-main' },
          a.pending != null
            ? h('span', { class: 'file-name' }, a.name)
            : h('button', { type: 'button', class: 'file-name link-like', title: 'Переглянути', onClick: () => viewAttachment(a) }, a.name),
          h('span', { class: 'file-sub' }, fmt.bytes(a.size) + (a.createdAt ? ' · ' + fmt.dateShort(D.toKyivDate(a.createdAt)) : ' · буде збережено зі задачею'))),
        h('div', { class: 'list-row-actions' },
          a.pending != null ? null : ui.button({ icon: 'eye', iconOnly: true, size: 'sm', variant: 'ghost', title: 'Переглянути', onClick: () => viewAttachment(a) }),
          a.pending != null ? null : ui.button({ icon: 'download', iconOnly: true, size: 'sm', variant: 'ghost', title: 'Завантажити', onClick: () => downloadAttachment(a) }),
          ui.button({
            icon: 'trash', iconOnly: true, size: 'sm', variant: 'danger-ghost', title: 'Видалити файл',
            onClick: async () => {
              if (a.pending != null) { pendingFiles.splice(a.pending, 1); renderFiles(); return; }
              const ok = await ui.confirm({ title: 'Видалити файл?', message: `«${a.name}» буде видалено назавжди.`, confirmText: 'Видалити', danger: true });
              if (!ok) return;
              await CRM.store.removeAttachment(a.id);
              renderFiles();
            }
          })))));
    }
    renderFiles();

    // --- Нижня панель ---
    const footer = h('div', { class: 'drawer-footer-inner' });
    const taskActions = h('div', { class: 'task-actions' });
    function renderFooter() {
      if (isNew) {
        ui.mount(footer,
          h('span', { class: 'grow' }),
          ui.button({ label: 'Скасувати', onClick: () => dlg.close('button') }),
          ui.button({ label: 'Створити задачу', variant: 'primary', icon: 'plus', onClick: createNow }));
        return;
      }
      const cur = CRM.store.get('tasks', task.id) || task;
      // «Відкласти» і «Дублювати» — рядком під назвою (у нижній панелі на вузькому екрані тісно)
      const snoozeBtn = cur.done ? null : ui.button({
        label: 'Відкласти', icon: 'clock', size: 'sm', className: 'task-act task-snooze-btn',
        onClick: () => snoozeMenu(snoozeBtn, task.id, () => dlg.close('force'))
      });
      ui.mount(taskActions,
        snoozeBtn,
        ui.button({
          label: 'Дублювати', icon: 'copy', size: 'sm', className: 'task-act task-dup', title: 'Копія задачі: без дат, чекліст не відмічений',
          onClick: async () => { const rec = await duplicate(task.id); if (rec) { dlg.close('force'); setTimeout(() => openTask(rec.id), 0); } }
        }));
      ui.mount(footer,
        ui.button({ label: 'Видалити', icon: 'trash', variant: 'danger-ghost', onClick: async () => { if (await remove(task.id)) dlg.close('force'); } }),
        h('span', { class: 'grow' }),
        savedHint,
        cur.done
          ? ui.button({ label: 'Відновити', icon: 'restore', onClick: () => reopen(task.id) })
          : ui.button({ label: 'Позначити виконаною', icon: 'check', variant: 'primary', onClick: () => complete(task.id) }));
    }
    renderFooter();

    async function createNow() {
      const title = titleIn.value.trim();
      if (!title) { titleField.setError('Вкажи назву задачі'); titleIn.focus(); return; }
      task.title = title;
      task.description = descIn.value;
      const rec = await CRM.store.save('tasks', task);
      for (const f of pendingFiles) {
        try { await CRM.store.addAttachment(rec.id, f); } catch (e) { ui.toast(e.message, { type: 'error' }); }
      }
      dlg.close('force');
      CRM.notify.runRules();
      ui.toast('Задачу створено', { type: 'success', action: { label: 'Відкрити', onClick: () => openTask(rec.id) } });
    }

    // --- Збирання панелі ---
    const doneBadge = !isNew && task.done ? h('span', { class: 'badge badge-success' }, 'В архіві') : null;
    const body = h('div', { class: 'task-editor' },
      titleField,
      isNew ? null : taskActions,
      descIn,
      h('div', { class: 'editor-grid' },
        h('div', { class: 'editor-label' }, CRM.icon('calendar', { size: 'sm' }), 'Дедлайн'),
        h('div', { class: 'editor-value' },
          h('div', { class: 'deadline-inputs' }, dateIn, timeIn, clearBtn),
          quick),
        h('div', { class: 'editor-label' }, CRM.icon('target', { size: 'sm' }), 'Заплановано'),
        h('div', { class: 'editor-value' },
          h('div', { class: 'deadline-inputs' }, planDateIn, planTimeIn, planClear),
          planQuick,
          h('div', { class: 'field-hint' }, 'День, коли збираєшся робити задачу, — вона зʼявиться в «Календарі». Дедлайн — до коли треба встигнути.')),
        h('div', { class: 'editor-label' }, CRM.icon('bell', { size: 'sm' }), 'Нагадати'),
        h('div', { class: 'editor-value' }, remindSel, remindHint),
        h('div', { class: 'editor-label' }, CRM.icon('tag', { size: 'sm' }), 'Мітки'),
        h('div', { class: 'editor-value' }, labelsBox, labelSugg),
        h('div', { class: 'editor-label' }, CRM.icon('flag', { size: 'sm' }), 'Пріоритет'),
        h('div', { class: 'editor-value' }, prioSeg),
        h('div', { class: 'editor-label' }, CRM.icon('clock', { size: 'sm' }), 'Статус'),
        h('div', { class: 'editor-value' }, statusSeg)),
      h('section', { class: 'editor-section' }, checklistHead, checklistBox, newItemIn),
      h('section', { class: 'editor-section' }, filesHead, filesBox, drop, fileInput, fileError));

    const dlg = ui.drawer({
      title: isNew ? 'Нова задача' : 'Задача',
      headerActions: doneBadge,
      body,
      footer,
      initialFocus: isNew ? titleIn : 'container',
      onBeforeClose: (reason) => {
        if (isNew) {
          const hasInput = titleIn.value.trim() || descIn.value.trim() || task.checklist.length || pendingFiles.length || task.deadline || task.planDate;
          if (!hasInput) return true;
          ui.confirm({
            title: 'Не створювати задачу?', message: 'Введені дані не збережуться.',
            confirmText: 'Не створювати', cancelText: 'Повернутися', danger: true
          }).then((ok) => { if (ok) dlg.close('force'); });
          return false;
        }
        saveTitle.flush();
        saveDesc.flush();
        if (!titleIn.value.trim()) ui.toast('Назву не змінено: вона не може бути порожньою');
        return true;
      },
      onClose: () => { unsub(); }
    });
    dlg.el.classList.add('task-drawer');

    requestAnimationFrame(() => { autoGrow(titleIn); autoGrow(descIn); });

    // Оновлюємо панель, якщо задачу змінили деінде (напр., виконали зі списку)
    const unsub = CRM.store.on(['tasks', 'attachments', '*'], () => {
      if (isNew || !dlg.isOpen) return;
      const cur = CRM.store.get('tasks', task.id);
      if (!cur || cur.deletedAt) { dlg.close('force'); return; }
      dlg.titleEl.textContent = 'Задача';
      const head = dlg.el.querySelector('.drawer-header .btn-row');
      const badge = head.querySelector('.badge');
      if (cur.done && !badge) head.prepend(h('span', { class: 'badge badge-success' }, 'В архіві'));
      if (!cur.done && badge) badge.remove();
      renderFooter();
      renderFiles();
      if (!checklistBox.contains(document.activeElement)) renderChecklist();
      if (document.activeElement !== labelIn) renderLabels();
    });

    return dlg;
  }

  function autoGrow(el) {
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 2 + 'px';
  }

  // ---------- Сторінка ----------
  const FILTERS = [{ id: 'all', label: 'Усі' }].concat(CRM.dict.taskStatuses.map((s) => ({ id: s.id, label: s.label })));

  function render(container, route) {
    const tab = route.params.tab === 'archive' ? 'archive' : 'active';
    const active = activeTasks();
    const archived = archivedTasks();

    const tabs = h('div', { class: 'tabs', role: 'tablist' },
      [['active', 'Активні', active.length], ['archive', 'Архів', archived.length]].map(([id, label, n]) => h('button', {
        type: 'button', role: 'tab', class: 'tab' + (tab === id ? ' active' : ''), 'aria-selected': tab === id ? 'true' : 'false',
        onClick: () => CRM.router.go('tasks', id === 'archive' ? { tab: 'archive' } : null)
      }, label, h('span', { class: 'tab-count' }, String(n)))));

    let toolbar = null;
    let content;
    if (tab === 'active') {
      const labels = allLabels();
      if (view.label && !labels.some((x) => x.key === view.label)) { view.label = ''; savePref('crm.tasks.label', ''); }
      const byStatus = view.filter === 'all' ? active : active.filter((t) => t.status === view.filter);
      const filtered = view.label ? byStatus.filter((t) => hasLabel(t, view.label)) : byStatus;
      const sorted = sortTasks(filtered, view.sort);
      const sortSel = ui.select([
        { value: 'deadline', label: 'За дедлайном' },
        { value: 'priority', label: 'За пріоритетом' }
      ], { value: view.sort, 'aria-label': 'Сортування', class: 'select select-sm' });
      sortSel.addEventListener('change', () => { view.sort = sortSel.value; savePref('crm.tasks.sort', view.sort); CRM.router.rerender(); });
      toolbar = h('div', { class: 'toolbar' },
        h('div', { class: 'chips', role: 'group', 'aria-label': 'Фільтр за статусом' }, FILTERS.map((f) => {
          const n = f.id === 'all' ? active.length : active.filter((t) => t.status === f.id).length;
          return h('button', {
            type: 'button', class: 'chip' + (view.filter === f.id ? ' active' : ''), 'aria-pressed': view.filter === f.id ? 'true' : 'false',
            onClick: () => { view.filter = f.id; savePref('crm.tasks.filter', f.id); CRM.router.rerender(); }
          }, `${f.label} · ${n}`);
        })),
        h('label', { class: 'toolbar-sort' }, CRM.icon('sort', { size: 'sm' }), h('span', { class: 'sr-only' }, 'Сортування'), sortSel));
      const shown = labels.filter((x) => x.active > 0 || x.key === view.label);
      const labelBar = labels.length ? h('div', { class: 'toolbar task-label-bar' },
        h('div', { class: 'chips', role: 'group', 'aria-label': 'Фільтр за міткою' },
          h('button', {
            type: 'button', class: 'chip' + (!view.label ? ' active' : ''), 'aria-pressed': !view.label ? 'true' : 'false', dataset: { label: '' },
            onClick: () => { view.label = ''; savePref('crm.tasks.label', ''); CRM.router.rerender(); }
          }, 'Усі мітки'),
          shown.map((x) => h('button', {
            type: 'button', class: 'chip task-label-chip' + (view.label === x.key ? ' active' : ''), 'aria-pressed': view.label === x.key ? 'true' : 'false', dataset: { label: x.key },
            onClick: () => { view.label = view.label === x.key ? '' : x.key; savePref('crm.tasks.label', view.label); CRM.router.rerender(); }
          }, h('span', { class: 'task-label-dot', style: { '--lbl': CRM.dict.categoryColor(labelColorId(x.name)) } }), `${x.name} · ${x.active}`))),
        ui.button({ label: 'Мітки', icon: 'tag', size: 'sm', variant: 'ghost', className: 'task-labels-manage', onClick: () => openLabels() })) : null;
      toolbar = [toolbar, labelBar];

      if (!active.length) {
        content = h('div', { class: 'card' }, ui.empty({
          icon: 'tasks', title: 'Ще немає задач — додай першу',
          text: 'Задачі з дедлайном потраплять у розклад на Головній і в нагадування.',
          action: { label: 'Додати задачу', icon: 'plus', onClick: () => openNew() }
        }));
      } else if (!sorted.length && view.label) {
        const lb = labels.find((x) => x.key === view.label);
        content = h('div', { class: 'card' }, ui.empty({
          icon: 'tag', small: true, title: `Немає активних задач з міткою «${lb ? lb.name : view.label}»` + (view.filter !== 'all' ? ` і статусом «${CRM.dict.label('taskStatuses', view.filter)}»` : ''),
          action: { label: 'Показати всі', variant: 'secondary', onClick: () => { view.label = ''; view.filter = 'all'; savePref('crm.tasks.label', ''); savePref('crm.tasks.filter', 'all'); CRM.router.rerender(); } }
        }));
      } else if (!sorted.length) {
        content = h('div', { class: 'card' }, ui.empty({
          icon: 'inbox', small: true, title: `Немає задач зі статусом «${CRM.dict.label('taskStatuses', view.filter)}»`,
          action: { label: 'Показати всі', variant: 'secondary', onClick: () => { view.filter = 'all'; savePref('crm.tasks.filter', 'all'); CRM.router.rerender(); } }
        }));
      } else {
        content = h('div', { class: 'card task-list' }, sorted.map((t) => taskRow(t)));
      }
    } else {
      content = archived.length
        ? h('div', { class: 'card task-list' }, archived.map((t) => taskRow(t, { archive: true })))
        : h('div', { class: 'card' }, ui.empty({ icon: 'archive', title: 'Архів порожній', text: 'Виконані задачі зʼявлятимуться тут — їх можна повернути в активні.' }));
    }

    ui.mount(container,
      ui.pageHead({
        title: 'Задачі',
        sub: `${fmt.count(active.length, ['активна', 'активні', 'активних'])} · ${archived.length} в архіві`,
        actions: ui.button({ label: 'Нова задача', icon: 'plus', variant: 'primary', onClick: () => openNew() })
      }),
      tabs, toolbar, content);

    if (route.params.open) {
      const id = route.params.open;
      CRM.router.consumeParam('open');
      setTimeout(() => openTask(id), 0);
    }
  }

  CRM.router.register('tasks', { title: 'Задачі', stores: ['tasks', 'attachments', 'settings'], render });

  // ---------- Нагадування ----------
  CRM.notify.addRule(() => {
    const T = D.today();
    const tomorrow = D.addDays(T, 1);
    const out = [];
    activeTasks().forEach((t) => {
      if (!t.deadline) return;
      const time = t.deadlineTime ? ` о ${t.deadlineTime}` : '';
      const target = { store: 'tasks', id: t.id };
      if (t.deadline === T) {
        out.push({ key: `task:due-today:${t.id}:${T}`, kind: 'task', title: 'Дедлайн сьогодні' + time, text: t.title, target });
      } else if (t.deadline === tomorrow) {
        out.push({ key: `task:due-tomorrow:${t.id}:${tomorrow}`, kind: 'task', title: 'Дедлайн завтра' + time, text: t.title, target });
      } else if (t.deadline < T) {
        out.push({ key: `task:overdue:${t.id}:${t.deadline}`, kind: 'task', title: 'Задачу прострочено', text: `${t.title} — дедлайн був ${fmt.dateShort(t.deadline)}`, target });
      }
    });
    return out;
  });
  // Своє нагадування задачі: за N хв до часу в плані (або дедлайну)
  CRM.notify.addRule(() => {
    const T = D.today();
    const now = Date.now();
    const out = [];
    activeTasks().forEach((t) => {
      if (t.remind == null || t.remind === '') return;
      const a = remindAnchor(t);
      if (!a || a.date < D.addDays(T, -1) || a.date > D.addDays(T, 2)) return;
      const m = /^(\d{1,2}):(\d{2})$/.exec(a.time);
      if (!m) return;
      const lead = Number(t.remind);
      const left = kyivMs(a.date, Number(m[1]) * 60 + Number(m[2])) - now;
      const due = lead === 0 ? left <= 0 && left > -5 * 60000 : left > 0 && left <= lead * 60000;
      if (!due) return;
      let title;
      if (lead === 0) title = `Час: ${t.title}`;
      else if (left < 60 * 60000) title = `Через ${Math.max(1, Math.round(left / 60000))} хв: ${t.title}`;
      else title = `${a.date === T ? 'Сьогодні' : 'Завтра'} о ${a.time}: ${t.title}`;
      out.push({
        key: `task:remind:${t.id}:${a.date}T${a.time}:${lead}`, kind: 'task', title,
        text: a.what === 'plan' ? `Задача · План дня · ${a.time}` : `Задача · дедлайн о ${a.time}`,
        target: { store: 'tasks', id: t.id }
      });
    });
    return out;
  });

  CRM.tasks = {
    openNew, openTask, create, complete, reopen, remove, sortTasks, deadlineInfo, priorityTag, checkbox, taskRow,
    labelsOf, labelChip, labelKey, labelColorId, allLabels, mergeLabels, openLabels, renameLabel, deleteLabel, setLabelColor,
    snooze, snoozeTargets, snoozeMenu, duplicate,
    activeTasks, archivedTasks, nextPlanOrder, planLabel
  };
})(window.CRM);
