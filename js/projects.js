/* ==========================================================================
   projects.js — «Проєкти»: великі справи з етапами (диплом, ремонт, переїзд).
   Пункт 9, етап 1 (15.11.2026, версія 2026.11.15-2).
   • Сховище projects: { name, color, status: active | paused | done, deadline, notes, links,
     stages: [{ id, name, start, end, done, doneAt, notes, links }], doneAt }.
   • Задачі проєкту — звичайні задачі з полями projectId і stageId (без етапу — stageId: null).
     Вони лишаються в «Задачах», на Головній і в «Плані дня».
   • Етап готовий сам, коли всі його задачі виконані, або вручну (done: true).
   • Поточний етап — перший незавершений. Прогрес проєкту — за задачами (без задач — за етапами).
   • Перенесення дедлайну етапу → «Зсунути наступні етапи?» (разом з датами їхніх задач).
   ========================================================================== */
window.CRM = window.CRM || {};

(function (CRM) {
  'use strict';

  const { h, ui } = { h: CRM.ui.h, ui: CRM.ui };
  const D = CRM.date;
  const fmt = CRM.fmt;
  const U = CRM.utils;

  const COLORS = ['blue', 'orange', 'aqua', 'violet', 'magenta', 'green', 'teal', 'red', 'yellow', 'brown', 'olive', 'slate'];
  const STATUSES = [{ id: 'active', label: 'Активний' }, { id: 'paused', label: 'На паузі' }, { id: 'done', label: 'Завершено' }];
  const MAX_LINKS = 20;
  const MAX_STAGES = 30;
  const DAYS = ['день', 'дні', 'днів'];

  // ---------- Дані ----------
  /** Браузер узяв старий db.js з кешу (без сховища projects) — не зберігати, а підказати оновити. */
  function canSave() {
    if (CRM.db.SCHEMA.projects) return true;
    ui.toast('Браузер показує стару версію сайту з кешу — онови сторінку (Ctrl+F5), щоб вести проєкти.', { type: 'error', duration: 9000 });
    return false;
  }
  function all() { return CRM.store.list('projects'); }
  function get(id) {
    const p = id ? CRM.store.get('projects', id) : null;
    return p && !p.deletedAt ? p : null;
  }
  function statusOf(p) { return STATUSES.some((s) => s.id === (p && p.status)) ? p.status : 'active'; }
  function statusLabel(s) { const x = STATUSES.find((y) => y.id === s); return x ? x.label : ''; }
  /** Активні й на паузі (не завершені). */
  function open() { return all().filter((p) => statusOf(p) !== 'done'); }
  function stagesOf(p) { return Array.isArray(p && p.stages) ? p.stages.filter((s) => s && s.id) : []; }

  function hashStr(s) {
    let x = 0;
    String(s || '').split('').forEach((c) => { x = (x * 31 + c.charCodeAt(0)) | 0; });
    return Math.abs(x);
  }
  function colorId(p) { return COLORS.includes(p && p.color) ? p.color : COLORS[hashStr(p && p.id) % COLORS.length]; }
  function colorOf(p) { return CRM.dict.categoryColor(colorId(p)); }
  function nextColor() {
    const used = new Set(open().map(colorId));
    return COLORS.find((c) => !used.has(c)) || COLORS[all().length % COLORS.length];
  }

  // ---------- Посилання й нотатки (як у темах «Навчання») ----------
  function linksOf(x) { return Array.isArray(x && x.links) ? x.links.filter((l) => l && l.url) : []; }
  function hasNotes(x) { return !!(x && x.notes && String(x.notes).trim()); }
  /** «example.com/x» → «https://example.com/x»; не http(s) або без домену → null. */
  function normUrl(v) {
    let s = String(v || '').trim();
    if (!s) return null;
    if (!/^[a-z][a-z0-9+.-]*:/i.test(s)) s = 'https://' + s.replace(/^\/+/, '');
    if (!/^https?:\/\/[^\s/?#]+\.[^\s/?#]{2,}/i.test(s) || /\s/.test(s)) return null;
    return s;
  }
  function hostOf(url) {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch (e) { return url; }
  }
  function linkLabel(l) { return (l.title && l.title.trim()) || hostOf(l.url); }

  // ---------- Задачі проєкту ----------
  function tasksOf(p, opts) {
    if (!p) return [];
    const withDeleted = opts && opts.deleted;
    return CRM.store.list('tasks', withDeleted ? { deleted: 'all' } : null).filter((t) => t.projectId === p.id);
  }
  /** Етап задачі (null — «Без етапу», зокрема якщо етап видалено). */
  function stageIdOf(p, t) {
    const sid = t && t.stageId;
    return sid && stagesOf(p).some((s) => s.id === sid) ? sid : null;
  }
  /** Проєкт задачі (лише якщо він існує й не в Кошику). */
  function projectOfTask(t) { return t && t.projectId ? get(t.projectId) : null; }
  function kyivDay(iso) { return iso ? D.toKyivDate(iso) : null; }

  /** Невиконані задачі по порядку: дедлайн → план → коли створено. */
  function sortOpen(list) {
    return list.slice().sort((a, b) => {
      const da = a.deadline || a.planDate || '9999';
      const db = b.deadline || b.planDate || '9999';
      if (da !== db) return da < db ? -1 : 1;
      return String(a.createdAt || '').localeCompare(String(b.createdAt || ''));
    });
  }

  // ---------- Розрахунки ----------
  /** Початок етапу: свій або наступний день після кінця попереднього. */
  function stageStart(stages, i) {
    const s = stages[i];
    if (s.start) return s.start;
    for (let j = i - 1; j >= 0; j--) {
      if (stages[j].end) return D.addDays(stages[j].end, 1);
      if (stages[j].start) return stages[j].start;
    }
    return null;
  }

  /**
   * Усе про проєкт одним обʼєктом.
   * → { p, status, stages: [{ s, i, start, end, total, done, open, auto, manual, isDone, doneAt, overdue, left, tasks, openTasks, doneTasks }],
   *     cur, curIdx, loose, doneStages, totalTasks, doneTasks, pct, deadline, start, overdue, next }
   */
  function info(p, T) {
    const today = T || D.today();
    const stages = stagesOf(p);
    const tasks = tasksOf(p);
    const byStage = new Map();
    const loose = [];
    tasks.forEach((t) => {
      const sid = stageIdOf(p, t);
      if (!sid) { loose.push(t); return; }
      if (!byStage.has(sid)) byStage.set(sid, []);
      byStage.get(sid).push(t);
    });
    const rows = stages.map((s, i) => {
      const list = byStage.get(s.id) || [];
      const doneList = list.filter((t) => t.done);
      const openList = list.filter((t) => !t.done);
      const auto = list.length > 0 && !openList.length;
      const manual = !!s.done;
      const isDone = auto || manual;
      let doneAt = null;
      if (manual && s.doneAt) doneAt = s.doneAt;
      else if (auto) doneAt = doneList.map((t) => kyivDay(t.completedAt)).filter(Boolean).sort().pop() || null;
      const end = s.end || null;
      const overdue = !isDone && !!end && end < today;
      return {
        s, i, start: stageStart(stages, i), end, total: list.length, done: doneList.length, open: openList.length,
        auto, manual, isDone, doneAt, overdue, left: end ? D.diffDays(today, end) : null,
        tasks: list, openTasks: sortOpen(openList), doneTasks: doneList.slice().sort((a, b) => String(b.completedAt || '').localeCompare(String(a.completedAt || '')))
      };
    });
    const curIdx = rows.findIndex((r) => !r.isDone);
    const cur = curIdx >= 0 ? rows[curIdx] : null;
    const totalTasks = tasks.length;
    const doneTasks = tasks.filter((t) => t.done).length;
    const doneStages = rows.filter((r) => r.isDone).length;
    const pct = totalTasks ? Math.round(doneTasks / totalTasks * 100) : rows.length ? Math.round(doneStages / rows.length * 100) : 0;
    const ends = rows.map((r) => r.end).filter(Boolean).sort();
    const deadline = p.deadline || ends[ends.length - 1] || null;
    // Початок проєкту: найраніша з дат створення, початків і кінців етапів
    const created = kyivDay(p.createdAt) || today;
    const start = [created].concat(rows.map((r) => r.start), ends).filter(Boolean).sort()[0];
    const status = statusOf(p);
    const next = cur && cur.openTasks.length ? cur.openTasks[0] : sortOpen(tasks.filter((t) => !t.done))[0] || null;
    return {
      p, status, stages: rows, cur, curIdx, loose: sortOpen(loose.filter((t) => !t.done)), looseDone: loose.filter((t) => t.done),
      doneStages, totalTasks, doneTasks, pct, deadline, start,
      overdue: status !== 'done' && !!deadline && deadline < today && rows.some((r) => !r.isDone),
      next
    };
  }

  // ---------- Тексти ----------
  function daysText(n) { return fmt.count(n, DAYS); }
  /** «ще 15 днів» / «сьогодні» / «завтра» / «прострочено на 3 дні». */
  function leftText(left) {
    if (left == null) return '';
    if (left < 0) return 'прострочено на ' + daysText(-left);
    if (left === 0) return 'сьогодні';
    if (left === 1) return 'завтра';
    return 'ще ' + daysText(left);
  }
  /** «1–20 вересня», «21 вересня – 31 жовтня», «до 30 листопада», «з 1 грудня». */
  function rangeText(start, end) {
    if (start && end) {
      if (start === end) return fmt.dateShort(end);
      const a = D.parse(start);
      const b = D.parse(end);
      if (a.y === b.y && a.m === b.m) return `${a.d}–${fmt.dateShort(end)}`;
      return `${fmt.dateShort(start)} – ${fmt.dateShort(end)}`;
    }
    if (end) return 'до ' + fmt.dateShort(end);
    if (start) return 'з ' + fmt.dateShort(start);
    return '';
  }
  /** Підпис етапу в списку. */
  function stageWhen(r) {
    if (r.isDone) return r.doneAt ? 'готово ' + fmt.dateShort(r.doneAt) : rangeText(r.start, r.end) || 'готово';
    if (r.end) return rangeText(r.start, r.end) + ' · ' + leftText(r.left);
    if (r.start) return rangeText(r.start, null);
    return 'без дат';
  }
  /** Рядок для картки й пошуку: «Етап 3 з 5 · Емпірика · до 30 листопада (ще 15 днів)». */
  function stageLine(x) {
    const st = x.stages;
    if (!st.length) return x.totalTasks ? `${x.doneTasks} з ${fmt.count(x.totalTasks, ['задачі', 'задач', 'задач'])}` : 'Етапів ще немає';
    if (!x.cur) return `Усі ${fmt.count(st.length, ['етап', 'етапи', 'етапів'])} готові`;
    const r = x.cur;
    const parts = [`Етап ${r.i + 1} з ${st.length}`, r.s.name];
    if (r.end) parts.push(`до ${fmt.dateShort(r.end)} (${leftText(r.left)})`);
    return parts.join(' · ');
  }
  function subText(p) {
    if (!p || p.deletedAt) return p ? statusLabel(statusOf(p)) : '';
    const x = info(p);
    const st = statusOf(p);
    if (st === 'done') return 'Завершено' + (p.doneAt ? ' ' + fmt.dateShort(p.doneAt) : '');
    return (st === 'paused' ? 'На паузі · ' : '') + stageLine(x);
  }

  // ---------- Зміни ----------
  async function patchProject(id, changes) {
    const p = get(id);
    if (!p) return null;
    return CRM.store.patch('projects', id, changes);
  }
  /** Змінити один етап (інші лишаються як є — зміни з іншого пристрою не губляться). */
  async function patchStage(pid, sid, changes) {
    const p = get(pid);
    if (!p) return null;
    const stages = stagesOf(p).map((s) => (s.id === sid ? Object.assign({}, s, changes) : s));
    return CRM.store.patch('projects', pid, { stages });
  }
  /** Знімок проєкту й задач для «Скасувати». */
  function snapshot(pid) {
    const p = get(pid);
    return { p: p ? U.deepClone(p) : null, tasks: p ? tasksOf(p).map((t) => U.deepClone(t)) : [] };
  }
  async function restoreSnapshot(snap) {
    if (!snap || !snap.p) return;
    await CRM.store.save('projects', snap.p);
    if (snap.tasks.length) await CRM.store.saveMany('tasks', snap.tasks);
    CRM.notify.runRules();
  }

  /** Позначити етап готовим / знову не готовим (з вибором, що робити з невиконаними задачами). */
  async function setStageDone(pid, sid, done) {
    const p = get(pid);
    if (!p) return;
    const x = info(p);
    const r = x.stages.find((y) => y.s.id === sid);
    if (!r) return;
    if (!done) {
      if (r.manual) {
        await patchStage(pid, sid, { done: false, doneAt: null });
        ui.toast(`Етап «${r.s.name}» знову в роботі`);
      } else if (r.auto) {
        ui.toast('Етап готовий, бо всі його задачі виконано. Щоб відкрити його знову, поверни задачу або додай нову.', { duration: 6000 });
      }
      return;
    }
    if (r.isDone) return;
    const nextRow = x.stages[r.i + 1] || null;
    let choice = 'keep';
    if (r.open) {
      choice = await askOpenTasks(r, nextRow);
      if (!choice) return;
    }
    const snap = snapshot(pid);
    const T = D.today();
    if (choice === 'move' && nextRow) {
      await CRM.store.saveMany('tasks', r.openTasks.map((t) => Object.assign({}, t, { stageId: nextRow.s.id })));
    } else if (choice === 'complete') {
      const now = new Date().toISOString();
      await CRM.store.saveMany('tasks', r.openTasks.map((t) => Object.assign({}, t, { done: true, completedAt: now })));
    }
    await patchStage(pid, sid, { done: true, doneAt: T });
    CRM.notify.runRules();
    const after = get(pid);
    const allDone = after && info(after).stages.every((y) => y.isDone);
    ui.toast(`Етап «${r.s.name}» готовий` + (allDone ? ' — це був останній!' : ''), {
      type: 'success', duration: 7000,
      action: { label: 'Скасувати', onClick: () => restoreSnapshot(snap) }
    });
  }

  /** Вікно «У етапі лишились задачі». → 'move' | 'complete' | 'keep' | null (скасовано) */
  function askOpenTasks(r, nextRow) {
    return new Promise((resolve) => {
      let res = null;
      const pick = (v) => { res = v; dlg.close('button'); };
      const n = r.open;
      const dlg = ui.modal({
        title: 'Етап готовий?', size: 'sm', center: true, className: 'pj-done-modal',
        body: h('div', null,
          h('p', { class: 'modal-text' }, `В етапі «${r.s.name}» ще ${fmt.count(n, ['невиконана задача', 'невиконані задачі', 'невиконаних задач'])}:`),
          h('ul', { class: 'pj-done-list-names' }, r.openTasks.slice(0, 5).map((t) => h('li', null, t.title || 'Без назви')),
            n > 5 ? h('li', { class: 'subtle' }, `і ще ${n - 5}`) : null),
          h('p', { class: 'modal-text subtle' }, 'Що з ними зробити?')),
        footer: h('div', { class: 'pj-done-actions' },
          nextRow ? ui.button({ label: `Перенести в «${nextRow.s.name}»`, variant: 'primary', className: 'pj-done-move', onClick: () => pick('move') }) : null,
          ui.button({ label: 'Позначити виконаними', className: 'pj-done-complete', variant: nextRow ? null : 'primary', onClick: () => pick('complete') }),
          ui.button({ label: 'Лишити як є', className: 'pj-done-keep', onClick: () => pick('keep') }),
          ui.button({ label: 'Скасувати', variant: 'ghost', className: 'pj-done-cancel', onClick: () => dlg.close('cancel') })),
        onClose: () => resolve(res)
      });
    });
  }

  /**
   * Зсунути наступні етапи (після етапу з індексом idx) на delta днів — разом з датами їхніх
   * невиконаних задач. withDeadline — і власний дедлайн проєкту.
   */
  async function shiftAfter(pid, idx, delta, withDeadline) {
    const p = get(pid);
    if (!p || !delta) return;
    const stages = stagesOf(p);
    const moved = new Set();
    const next = stages.map((s, i) => {
      if (i <= idx || s.done) return s;
      if (!s.start && !s.end) return s;
      moved.add(s.id);
      return Object.assign({}, s, { start: s.start ? D.addDays(s.start, delta) : s.start, end: s.end ? D.addDays(s.end, delta) : s.end });
    });
    const changes = { stages: next };
    if (withDeadline && p.deadline) changes.deadline = D.addDays(p.deadline, delta);
    await CRM.store.patch('projects', pid, changes);
    const tasks = tasksOf(p).filter((t) => !t.done && moved.has(stageIdOf(p, t)) && (t.deadline || t.planDate)).map((t) => Object.assign({}, t, {
      deadline: t.deadline ? D.addDays(t.deadline, delta) : t.deadline,
      planDate: t.planDate ? D.addDays(t.planDate, delta) : t.planDate
    }));
    if (tasks.length) await CRM.store.saveMany('tasks', tasks);
    CRM.notify.runRules();
  }

  /** Скільки наступних етапів і задач зсунеться (для питання). */
  function shiftScope(p, idx) {
    const stages = stagesOf(p);
    const ids = new Set();
    stages.forEach((s, i) => { if (i > idx && !s.done && (s.start || s.end)) ids.add(s.id); });
    const tasks = tasksOf(p).filter((t) => !t.done && ids.has(stageIdOf(p, t)) && (t.deadline || t.planDate));
    return { stages: ids.size, tasks: tasks.length };
  }

  /**
   * Питання «Зсунути наступні етапи?» після зміни дедлайну етапу. Зміну самого етапу вже записано.
   * before — знімок до зміни (для «Скасувати»).
   */
  function askShift(pid, idx, oldEnd, newEnd, before) {
    const p = get(pid);
    if (!p || !oldEnd || !newEnd || oldEnd === newEnd) return Promise.resolve(false);
    const delta = D.diffDays(oldEnd, newEnd);
    const scope = shiftScope(p, idx);
    if (!scope.stages) return Promise.resolve(false);
    const stage = stagesOf(p)[idx];
    return new Promise((resolve) => {
      let shifted = false;
      const dlTick = p.deadline ? h('input', { type: 'checkbox', class: 'pj-shift-dl' }) : null;
      const abs = Math.abs(delta);
      const dir = delta > 0 ? 'пізніше' : 'раніше';
      const go = async () => {
        shifted = true;
        const withDl = !!(dlTick && dlTick.checked);
        dlg.close('button');
        await shiftAfter(pid, idx, delta, withDl);
        ui.toast(`Наступні етапи зсунуто на ${delta > 0 ? '+' : '−'}${daysText(abs)}`, {
          type: 'success', duration: 8000,
          action: { label: 'Скасувати', onClick: () => restoreSnapshot(before) }
        });
      };
      const dlg = ui.modal({
        title: 'Зсунути наступні етапи?', size: 'sm', center: true, className: 'pj-shift-modal',
        body: h('div', null,
          h('p', { class: 'modal-text' }, `Етап «${stage ? stage.name : ''}» тепер закінчується на ${daysText(abs)} ${dir}: ${fmt.dateShort(oldEnd)} → ${fmt.dateShort(newEnd)}.`),
          h('p', { class: 'modal-text' }, `Зсунути ${scope.stages === 1 ? 'наступний етап' : 'наступні ' + fmt.count(scope.stages, ['етап', 'етапи', 'етапів'])} на стільки ж?` +
            (scope.tasks ? ` Разом з ${scope.stages === 1 ? 'ним' : 'ними'} зсунуться дати ${fmt.count(scope.tasks, ['задачі', 'задач', 'задач'])}.` : '')),
          dlTick ? h('label', { class: 'pj-shift-dl-row' }, dlTick, h('span', null, `і дедлайн проєкту: ${fmt.dateShort(p.deadline)} → ${fmt.dateShort(D.addDays(p.deadline, delta))}`)) : null),
        footer: [
          ui.button({ label: 'Лише цей етап', className: 'pj-shift-no', onClick: () => dlg.close('cancel') }),
          ui.button({ label: 'Зсунути', variant: 'primary', className: 'pj-shift-yes', onClick: go })
        ],
        onClose: () => resolve(shifted)
      });
      setTimeout(() => { const b = dlg.el.querySelector('.pj-shift-yes'); if (b) b.focus(); }, 0);
    });
  }

  /** Змінити дедлайн етапу (з Календаря чи вікна етапу) — з питанням про наступні. */
  async function moveStageEnd(pid, sid, date) {
    const p = get(pid);
    if (!p) return;
    const stages = stagesOf(p);
    const idx = stages.findIndex((s) => s.id === sid);
    if (idx < 0) return;
    const old = stages[idx].end || null;
    if (old === date) return;
    const before = snapshot(pid);
    const changes = { end: date || null };
    if (date && stages[idx].start && stages[idx].start > date) changes.start = date;
    await patchStage(pid, sid, changes);
    CRM.notify.runRules();
    const asked = old && date ? await askShift(pid, idx, old, date, before) : false;
    if (!asked) {
      ui.toast(`Дедлайн етапу «${stages[idx].name}»: ${date ? fmt.dateShort(date) : 'без дати'}`, {
        action: { label: 'Скасувати', onClick: () => restoreSnapshot(before) }
      });
    }
  }

  async function moveStage(pid, sid, dir) {
    const p = get(pid);
    if (!p) return;
    const stages = stagesOf(p).slice();
    const i = stages.findIndex((s) => s.id === sid);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= stages.length) return;
    const tmp = stages[i]; stages[i] = stages[j]; stages[j] = tmp;
    await CRM.store.patch('projects', pid, { stages });
  }

  async function removeStage(pid, sid) {
    const p = get(pid);
    if (!p) return;
    const r = info(p).stages.find((x) => x.s.id === sid);
    if (!r) return;
    const ok = await ui.confirm({
      title: 'Видалити етап?',
      message: r.total
        ? `Етап «${r.s.name}» зникне, а ${fmt.count(r.total, ['його задача', 'його задачі', 'його задач'])} перейдуть у «Без етапу» (самі задачі лишаться).`
        : `Етап «${r.s.name}» зникне з проєкту.`,
      confirmText: 'Видалити', danger: true
    });
    if (!ok) return;
    const snap = snapshot(pid);
    await CRM.store.patch('projects', pid, { stages: stagesOf(p).filter((s) => s.id !== sid) });
    if (r.tasks.length) await CRM.store.saveMany('tasks', r.tasks.map((t) => Object.assign({}, t, { stageId: null })));
    CRM.notify.runRules();
    ui.toast('Етап видалено', { action: { label: 'Скасувати', onClick: () => restoreSnapshot(snap) } });
  }

  async function setStatus(pid, status) {
    const p = get(pid);
    if (!p || statusOf(p) === status) return;
    const prev = { status: statusOf(p), doneAt: p.doneAt || null };
    await CRM.store.patch('projects', pid, { status, doneAt: status === 'done' ? D.today() : null });
    CRM.notify.runRules();
    if (status === 'done') {
      ui.toast(`Проєкт «${p.name}» завершено`, { type: 'success', action: { label: 'Скасувати', onClick: () => patchProject(pid, prev) } });
    }
  }

  async function addTask(pid, sid, title) {
    const p = get(pid);
    const v = String(title || '').trim();
    if (!p || !v) return null;
    return CRM.tasks.create({ title: v, projectId: pid, stageId: sid || null });
  }

  /** Перенести задачу в інший проєкт / етап (pid null — без проєкту). */
  async function assignTask(taskId, pid, sid) {
    const t = CRM.store.get('tasks', taskId);
    if (!t) return;
    await CRM.store.patch('tasks', taskId, { projectId: pid || null, stageId: pid ? sid || null : null });
  }

  // ---------- Видалення проєкту ----------
  async function removeProject(pid) {
    const p = get(pid);
    if (!p) return false;
    const tasks = tasksOf(p);
    let withTasks = false;
    if (tasks.length) {
      const choice = await new Promise((resolve) => {
        let res = null;
        const dlg = ui.modal({
          title: 'Видалити проєкт?', size: 'sm', center: true, className: 'pj-del-modal',
          body: h('p', { class: 'modal-text' }, `«${p.name}» потрапить у Кошик (відновити можна протягом 30 днів). У проєкті ${fmt.count(tasks.length, ['задача', 'задачі', 'задач'])} — що з ними зробити?`),
          footer: h('div', { class: 'pj-done-actions' },
            ui.button({ label: 'Лишити задачі', className: 'pj-del-keep', onClick: () => { res = 'keep'; dlg.close('button'); } }),
            ui.button({ label: 'Видалити й задачі', variant: 'danger', className: 'pj-del-all', onClick: () => { res = 'all'; dlg.close('button'); } }),
            ui.button({ label: 'Скасувати', variant: 'ghost', className: 'pj-del-cancel', onClick: () => dlg.close('cancel') })),
          onClose: () => resolve(res)
        });
      });
      if (!choice) return false;
      withTasks = choice === 'all';
    } else {
      const ok = await ui.confirm({ title: 'Видалити проєкт?', message: `«${p.name}» потрапить у Кошик разом з етапами й нотатками. Відновити можна протягом 30 днів.`, confirmText: 'Видалити', danger: true });
      if (!ok) return false;
    }
    const batch = await CRM.store.softDelete('projects', pid, withTasks ? tasks.map((t) => ({ store: 'tasks', id: t.id })) : []);
    CRM.notify.runRules();
    ui.toast(withTasks ? 'Проєкт і його задачі перенесено в Кошик' : 'Проєкт перенесено в Кошик', {
      action: { label: 'Скасувати', onClick: () => CRM.store.restoreBatch(batch) }
    });
    return true;
  }

  // ---------- Для задач ----------
  /** Позначка проєкту в рядку задачі: «Диплом · Емпірика» (клік — до проєкту). */
  function chip(t) {
    const p = projectOfTask(t);
    if (!p) return null;
    const sid = stageIdOf(p, t);
    const st = sid ? stagesOf(p).find((s) => s.id === sid) : null;
    const text = st ? `${p.name} · ${st.name}` : p.name;
    return h('span', {
      class: 'task-project', style: { '--pj': colorOf(p) }, dataset: { project: p.id },
      title: `Проєкт «${p.name}»` + (st ? `, етап «${st.name}»` : '') + ' — відкрити проєкт', role: 'link', tabIndex: -1,
      onClick: (e) => { e.stopPropagation(); e.preventDefault(); CRM.router.go('projects/' + p.id, sid ? { stage: sid } : null); }
    }, h('span', { class: 'task-project-dot' }), text);
  }

  /** Поле «Проєкт» у панелі задачі: select з групами (проєкт → «Без етапу» + етапи). */
  function taskField(task, onChange) {
    const cur = task.projectId ? CRM.store.get('projects', task.projectId) : null;
    const list = open().slice().sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'uk'));
    if (cur && !cur.deletedAt && !list.includes(cur)) list.push(cur);
    const value = task.projectId && cur && !cur.deletedAt ? `${task.projectId}|${stageIdOf(cur, task) || ''}` : '';
    const sel = h('select', { class: 'select task-project-select', 'aria-label': 'Проєкт' },
      h('option', { value: '' }, 'Без проєкту'),
      list.map((p) => h('optgroup', { label: p.name + (statusOf(p) === 'done' ? ' (завершено)' : statusOf(p) === 'paused' ? ' (на паузі)' : '') },
        h('option', { value: `${p.id}|` }, `${p.name} — без етапу`),
        stagesOf(p).map((s, i) => h('option', { value: `${p.id}|${s.id}` }, `${p.name} › ${i + 1}. ${s.name}`)))));
    sel.value = value;
    const openBtn = h('a', { class: 'btn btn-ghost btn-sm task-project-open', hidden: !value, title: 'Відкрити проєкт' }, CRM.icon('external', { size: 'sm' }), 'Відкрити');
    const sync = () => {
      const [pid, sid] = sel.value.split('|');
      openBtn.hidden = !pid;
      if (pid) openBtn.href = CRM.router.href('projects/' + pid, sid ? { stage: sid } : null);
      else openBtn.removeAttribute('href');
    };
    sync();
    sel.addEventListener('change', () => {
      const [pid, sid] = sel.value.split('|');
      sync();
      onChange({ projectId: pid || null, stageId: pid ? sid || null : null });
    });
    return { el: h('div', { class: 'task-project-edit' }, sel, openBtn), select: sel, openBtn };
  }

  /** Проєкти з невиконаними задачами — для фільтра на сторінці «Задачі». */
  function filterOptions(tasks) {
    const counts = new Map();
    let none = 0;
    tasks.forEach((t) => {
      const p = projectOfTask(t);
      if (p) counts.set(p.id, (counts.get(p.id) || 0) + 1); else none += 1;
    });
    const list = all().filter((p) => counts.has(p.id) || statusOf(p) !== 'done')
      .sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'uk'))
      .map((p) => ({ id: p.id, name: p.name, n: counts.get(p.id) || 0 }));
    return { list, none };
  }
  /** Задача належить вибраному у фільтрі: id проєкту, 'none' — без проєкту. */
  function matchFilter(t, f) {
    if (!f) return true;
    const p = projectOfTask(t);
    return f === 'none' ? !p : !!p && p.id === f;
  }

  // ---------- Шкала часу ----------
  function timeline(x, T) {
    const rows = x.stages.filter((r) => r.end || r.start);
    if (!rows.length) return null;
    let from = x.start;
    let to = x.deadline || rows.map((r) => r.end || r.start).sort().pop();
    rows.forEach((r) => { if (r.start && r.start < from) from = r.start; if (r.end && r.end > to) to = r.end; });
    if (!from || !to || to < from) return null;
    const span = D.diffDays(from, to) + 1;
    const pos = (d) => Math.max(0, Math.min(100, D.diffDays(from, d) / span * 100));
    const segs = [];
    x.stages.forEach((r) => {
      const end = r.end;
      const start = r.start || from;
      if (!end) return;
      const left = pos(start);
      const right = pos(D.addDays(end, 1));
      const width = Math.max(0.8, right - left);
      const cls = 'pj-tl-seg' + (r.isDone ? ' done' : r === x.cur ? ' cur' : '') + (r.overdue ? ' overdue' : '');
      const frac = r.total ? r.done / r.total : 0;
      segs.push(h('span', {
        class: cls, style: { left: left + '%', width: width + '%' }, dataset: { stage: r.s.id },
        title: `${r.i + 1}. ${r.s.name}: ${rangeText(r.start, r.end)}${r.isDone ? ' · готово' : r.total ? ` · ${r.done} з ${r.total}` : ''}`
      }, r === x.cur && frac ? h('i', { style: { width: Math.round(frac * 100) + '%' } }) : null));
    });
    if (!segs.length) return null;
    const ticks = [];
    let m = D.startOfMonth(from);
    if (m < from) m = D.addMonths(m, 1);
    for (let k = 0; m <= to && k < 36; k++, m = D.addMonths(m, 1)) {
      ticks.push(h('span', { class: 'pj-tl-tick', style: { left: pos(m) + '%' } }, CRM.MONTHS_SHORT[D.parse(m).m - 1]));
    }
    const today = T || D.today();
    const inRange = today >= from && today <= to;
    return h('div', { class: 'pj-tl', 'aria-label': `Шкала: ${rangeText(from, to)}` },
      h('div', { class: 'pj-tl-bar' }, segs,
        inRange ? h('span', { class: 'pj-tl-today', style: { left: pos(today) + '%' }, title: 'Сьогодні' }) : null,
        x.p.deadline ? h('span', { class: 'pj-tl-dl', style: { left: pos(x.p.deadline) + '%' }, title: 'Дедлайн проєкту: ' + fmt.dateShort(x.p.deadline) }, '◆') : null),
      h('div', { class: 'pj-tl-ticks' }, ticks,
        inRange ? h('span', { class: 'pj-tl-now', style: { left: pos(today) + '%' } }, 'сьогодні') : null));
  }

  // ---------- Сторінка: список ----------
  function bar(pct) {
    return h('div', { class: 'progress pj-bar', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct) },
      h('div', { class: 'progress-bar', style: { width: pct + '%' } }));
  }

  function card(p) {
    const x = info(p);
    const st = x.status;
    const overdue = x.cur && x.cur.overdue;
    return h('div', { class: 'pj-card' + (st === 'paused' ? ' is-paused' : '') + (st === 'done' ? ' is-done' : ''), dataset: { id: p.id }, style: { '--pj': colorOf(p) } },
      h('a', { class: 'pj-card-main', href: CRM.router.href('projects/' + p.id) },
        h('span', { class: 'pj-card-head' },
          h('span', { class: 'pj-dot' }),
          h('span', { class: 'pj-card-title' }, p.name || 'Без назви'),
          st === 'paused' ? h('span', { class: 'badge pj-paused' }, 'На паузі') : null,
          h('span', { class: 'pj-card-pct num' }, x.pct + ' %')),
        bar(x.pct),
        h('span', { class: 'pj-card-stage' + (overdue ? ' is-overdue' : '') },
          st === 'done' ? 'Завершено' + (p.doneAt ? ' ' + fmt.dateShort(p.doneAt) : '') + ` · ${fmt.count(x.stages.length, ['етап', 'етапи', 'етапів'])}` : stageLine(x))),
      st !== 'done' && x.next ? h('button', {
        type: 'button', class: 'pj-card-next', title: 'Відкрити задачу',
        onClick: () => CRM.tasks.openTask(x.next.id)
      }, h('span', { class: 'subtle' }, 'Далі:'), h('span', { class: 'pj-card-next-t' }, x.next.title || 'Без назви')) : null);
  }

  function tabsNav(cur, nOpen, nDone) {
    return h('nav', { class: 'tabs pj-tabs', 'aria-label': 'Проєкти' },
      [['open', 'Активні', nOpen], ['done', 'Завершені', nDone]].map(([id, label, n]) => h('a', {
        href: '#/projects' + (id === 'open' ? '' : '/done'), class: 'tab' + (id === cur ? ' active' : ''), dataset: { tab: id },
        'aria-current': id === cur ? 'page' : null
      }, label, h('span', { class: 'tab-count' }, String(n)))));
  }

  function sortOpenProjects(list) {
    const T = D.today();
    const key = (p) => {
      const x = info(p, T);
      return [statusOf(p) === 'paused' ? 1 : 0, (x.cur && x.cur.end) || x.deadline || '9999', String(p.name || '')];
    };
    return list.map((p) => ({ p, k: key(p) })).sort((a, b) => {
      for (let i = 0; i < 3; i++) if (a.k[i] !== b.k[i]) return a.k[i] < b.k[i] ? -1 : 1;
      return 0;
    }).map((y) => y.p);
  }

  function renderList(container, tab) {
    const list = all();
    const head = ui.pageHead({
      title: 'Проєкти', sub: 'Великі справи з етапами: диплом, ремонт, переїзд.',
      actions: [ui.button({ label: 'Новий проєкт', icon: 'plus', variant: 'primary', className: 'pj-add-btn', onClick: () => openForm(null) })]
    });
    if (!list.length) {
      ui.mount(container, head, h('section', { class: 'card pj-empty-card' }, ui.empty({
        icon: 'projects', title: 'Ще немає проєктів',
        text: 'Проєкт — це велика справа з етапами й датами: диплом, ремонт, переїзд. Задачі проєкту лишаються в «Задачах», а тут видно, що вже зроблено, що зараз і що далі.',
        action: { label: 'Новий проєкт', icon: 'plus', onClick: () => openForm(null) }
      })));
      return;
    }
    const openList = sortOpenProjects(list.filter((p) => statusOf(p) !== 'done'));
    const doneList = list.filter((p) => statusOf(p) === 'done').sort((a, b) => String(b.doneAt || '').localeCompare(String(a.doneAt || '')));
    const shown = tab === 'done' ? doneList : openList;
    const body = shown.length ? h('div', { class: 'pj-grid' }, shown.map(card))
      : h('section', { class: 'card' }, ui.empty({
        icon: tab === 'done' ? 'checkCircle' : 'projects', small: true,
        title: tab === 'done' ? 'Завершених проєктів ще немає' : 'Активних проєктів немає',
        text: tab === 'done' ? 'Коли всі етапи будуть готові — познач проєкт завершеним, і він переїде сюди.' : 'Усі проєкти завершено. Почнемо новий?',
        action: tab === 'done' ? null : { label: 'Новий проєкт', icon: 'plus', onClick: () => openForm(null) }
      }));
    ui.mount(container, head, tabsNav(tab, openList.length, doneList.length), body);
  }

  // ---------- Сторінка проєкту ----------
  const expanded = {};   // id проєкту → Map(id етапу → true/false), що розгорнув / згорнув сам
  const doneOpen = {};   // 'pid:sid' → показано виконані
  const extraOpen = {};  // 'pid:sid' → розгорнуто нотатки й посилання етапу
  const drafts = {};     // недописані нотатки (переживають перемальовування)

  function isExpanded(pid, sid, x) {
    const m = expanded[pid];
    if (m && m.has(sid)) return m.get(sid);
    if (sid === '__loose') return !x.stages.length;
    return !!x.cur && x.cur.s.id === sid;
  }
  function setExpanded(pid, sid, v) {
    if (!expanded[pid]) expanded[pid] = new Map();
    expanded[pid].set(sid, v);
  }

  /** Нотатки (автозбереження) + посилання — для проєкту (sid null) або етапу. */
  function notesLinks(p, sid) {
    const target = sid ? stagesOf(p).find((s) => s.id === sid) : p;
    if (!target) return null;
    const key = `pj-notes:${p.id}:${sid || ''}`;
    const notesIn = ui.textarea({
      class: 'textarea pj-notes', rows: sid ? 3 : 4, maxlength: 10000, dataset: { keep: key },
      placeholder: sid ? 'Нотатки до етапу: що здати, кому, вимоги…' : 'Нотатки до проєкту: мета, вимоги, контакти…',
      'aria-label': sid ? `Нотатки до етапу «${target.name}»` : 'Нотатки до проєкту'
    });
    notesIn.value = drafts[key] != null ? drafts[key] : target.notes || '';
    const state = h('span', { class: 'subtle pj-notes-state' });
    const flush = async () => {
      if (drafts[key] == null) return;
      const val = drafts[key];
      if (sid) await patchStage(p.id, sid, { notes: val });
      else await patchProject(p.id, { notes: val });
      if (drafts[key] === val) delete drafts[key];
      state.textContent = 'Збережено';
    };
    const later = U.debounce(flush, 600);
    notesIn.addEventListener('input', () => { drafts[key] = notesIn.value; state.textContent = ''; later(); });
    notesIn.addEventListener('blur', flush);

    const links = linksOf(target);
    const urlIn = ui.input({ type: 'url', placeholder: 'Посилання: https://…', maxlength: 1000, 'aria-label': 'Адреса посилання', class: 'input pj-link-url', dataset: { keep: `pj-url:${p.id}:${sid || ''}` } });
    const nameIn = ui.input({ placeholder: 'Назва (необовʼязково)', maxlength: 120, 'aria-label': 'Назва посилання', class: 'input pj-link-title', dataset: { keep: `pj-lname:${p.id}:${sid || ''}` } });
    const err = h('div', { class: 'pj-link-err', role: 'alert', hidden: true });
    const saveLinks = (fn) => {
      const cur = get(p.id);
      if (!cur) return null;
      if (!sid) return patchProject(p.id, { links: fn(linksOf(cur)) });
      const st = stagesOf(cur).find((s) => s.id === sid);
      return st ? patchStage(p.id, sid, { links: fn(linksOf(st)) }) : null;
    };
    const add = () => {
      if (!urlIn.value.trim()) { urlIn.focus(); return; }
      const url = normUrl(urlIn.value);
      if (!url) { err.textContent = 'Перевір адресу — має бути сайт, напр. https://docs.google.com/…'; err.hidden = false; urlIn.focus(); return; }
      if (links.length >= MAX_LINKS) { err.textContent = `Не більше ${MAX_LINKS} посилань`; err.hidden = false; return; }
      const link = { id: U.uid(), url, title: nameIn.value.trim() };
      urlIn.value = '';
      nameIn.value = '';
      saveLinks((l) => l.concat([link]));
    };
    const onKey = (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } };
    urlIn.addEventListener('keydown', onKey);
    nameIn.addEventListener('keydown', onKey);
    urlIn.addEventListener('input', () => { err.hidden = true; });

    const box = h('div', { class: 'pj-nl' },
      h('div', { class: 'pj-notes-wrap' }, notesIn, state),
      h('div', { class: 'pj-links' },
        links.map((l) => h('div', { class: 'pj-link', dataset: { id: l.id } },
          CRM.icon('link', { size: 'sm' }),
          h('a', { class: 'pj-link-a', href: l.url, target: '_blank', rel: 'noopener noreferrer', title: l.url }, linkLabel(l)),
          l.title ? h('span', { class: 'pj-link-host subtle' }, hostOf(l.url)) : null,
          h('button', {
            type: 'button', class: 'btn btn-ghost btn-icon btn-sm pj-link-del', title: 'Прибрати посилання', 'aria-label': `Прибрати посилання «${linkLabel(l)}»`,
            onClick: () => saveLinks((list) => list.filter((y) => y.id !== l.id))
          }, CRM.icon('x', { size: 'sm' })))),
        h('div', { class: 'pj-link-add' }, urlIn, nameIn,
          ui.button({ label: 'Додати', icon: 'plus', size: 'sm', className: 'pj-link-btn', onClick: add })),
        err));
    box.flush = flush;
    return box;
  }

  /** Список задач етапу (або «Без етапу») + поле нової задачі + виконані. */
  function stageTasks(p, sid, openTasks, doneTasks) {
    const key = `pj-new:${p.id}:${sid || ''}`;
    const newIn = ui.input({
      class: 'input pj-new-task', placeholder: 'Нова задача — Enter', maxlength: 200, enterkeyhint: 'done',
      'aria-label': 'Нова задача в етапі', dataset: { keep: key }
    });
    newIn.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' || e.isComposing) return;
      e.preventDefault();
      const v = newIn.value.trim();
      if (!v) return;
      newIn.value = '';
      addTask(p.id, sid, v);
    });
    const dk = `${p.id}:${sid || ''}`;
    const doneBox = doneTasks.length ? h('details', {
      class: 'pj-done-tasks', open: !!doneOpen[dk],
      onToggle: (e) => { doneOpen[dk] = e.currentTarget.open; }
    }, h('summary', null, `Виконані (${doneTasks.length})`),
    h('div', { class: 'task-list pj-task-list' }, doneTasks.map((t) => CRM.tasks.taskRow(t, { compact: true, archive: true, noProject: true })))) : null;
    return h('div', { class: 'pj-tasks' },
      openTasks.length ? h('div', { class: 'task-list pj-task-list' }, openTasks.map((t) => CRM.tasks.taskRow(t, { compact: true, noProject: true }))) : null,
      newIn, doneBox);
  }

  function stageMenu(anchor, p, r, count) {
    const item = (label, cls, fn, danger, disabled) => h('button', {
      type: 'button', role: 'menuitem', class: 'menu-item ' + cls + (danger ? ' danger' : ''), disabled: !!disabled,
      onClick: () => { pop.close(); fn(); }
    }, label);
    const pop = ui.popover(anchor, h('div', { class: 'menu pj-stage-menu', role: 'menu' },
      item('Змінити етап', 'pj-m-edit', () => openStageForm(p.id, r.s.id)),
      item('Перемістити вище', 'pj-m-up', () => moveStage(p.id, r.s.id, -1), false, r.i === 0),
      item('Перемістити нижче', 'pj-m-down', () => moveStage(p.id, r.s.id, 1), false, r.i === count - 1),
      item('Видалити етап', 'pj-m-del', () => removeStage(p.id, r.s.id), true)), { align: 'end' });
    const first = pop.el.querySelector('.menu-item:not([disabled])');
    if (first) first.focus();
    return pop;
  }

  function stageBlock(p, x, r, hl) {
    const sid = r.s.id;
    const isOpen = isExpanded(p.id, sid, x) || hl === sid;
    const isCur = x.cur === r;
    const toggle = () => { setExpanded(p.id, sid, !isOpen); CRM.router.rerender(); };
    const check = h('button', {
      type: 'button', class: 'task-check pj-stage-check' + (r.isDone ? ' checked' : ''), role: 'checkbox',
      'aria-checked': r.isDone ? 'true' : 'false',
      'aria-label': r.isDone ? `Етап «${r.s.name}» готовий` : `Позначити етап «${r.s.name}» готовим`,
      title: r.isDone ? (r.auto && !r.manual ? 'Готово: усі задачі виконано' : 'Готово — натисни, щоб повернути в роботу') : 'Позначити етап готовим',
      onClick: () => setStageDone(p.id, sid, !r.isDone)
    }, CRM.icon('check', { size: 'sm' }));
    const moreBtn = h('button', {
      type: 'button', class: 'btn btn-ghost btn-icon btn-sm pj-stage-more', title: 'Дії з етапом', 'aria-label': `Дії з етапом «${r.s.name}»`, 'aria-haspopup': 'menu',
      onClick: () => stageMenu(moreBtn, p, r, x.stages.length)
    }, CRM.icon('more', { size: 'sm' }));
    const badges = [];
    const nl = linksOf(r.s).length;
    if (nl) badges.push(h('span', { class: 'pj-badge', title: fmt.count(nl, ['посилання', 'посилання', 'посилань']) }, CRM.icon('link', { size: 'sm' }), h('span', { class: 'num' }, String(nl))));
    if (hasNotes(r.s)) badges.push(h('span', { class: 'pj-badge', title: 'Є нотатки' }, CRM.icon('file', { size: 'sm' })));
    const ek = `${p.id}:${sid}`;
    const extraIsOpen = extraOpen[ek] != null ? extraOpen[ek] : false;
    return h('section', {
      class: 'pj-stage' + (r.isDone ? ' is-done' : '') + (isCur ? ' is-current' : '') + (r.overdue ? ' is-overdue' : '') + (isOpen ? ' open' : '') + (hl === sid ? ' pj-hl' : ''),
      dataset: { stage: sid }
    },
    h('div', { class: 'pj-stage-head' },
      h('button', {
        type: 'button', class: 'btn btn-ghost btn-icon btn-sm pj-stage-toggle', 'aria-expanded': isOpen ? 'true' : 'false',
        title: isOpen ? 'Згорнути' : 'Розгорнути', 'aria-label': `${isOpen ? 'Згорнути' : 'Розгорнути'}: ${r.s.name}`, onClick: toggle
      }, CRM.icon('chevronRight', { size: 'sm' })),
      check,
      h('button', { type: 'button', class: 'pj-stage-name', onClick: toggle, tabIndex: -1 },
        h('span', { class: 'pj-stage-num num' }, `${r.i + 1}.`), h('span', { class: 'pj-stage-title' }, r.s.name),
        isCur && x.status !== 'done' ? h('span', { class: 'badge pj-now' }, 'зараз') : null),
      h('span', { class: 'pj-stage-meta' },
        badges.length ? h('span', { class: 'pj-badges' }, badges) : null,
        r.total ? h('span', { class: 'pj-stage-count num', title: 'Виконано задач' }, `${r.done}/${r.total}`) : null,
        h('span', { class: 'pj-stage-when' + (r.overdue ? ' is-overdue' : '') }, stageWhen(r))),
      moreBtn),
    isOpen ? h('div', { class: 'pj-stage-body' },
      r.total ? bar(Math.round(r.done / r.total * 100)) : null,
      stageTasks(p, sid, r.openTasks, r.doneTasks),
      h('details', {
        class: 'pj-stage-extra', open: extraIsOpen,
        onToggle: (e) => { extraOpen[ek] = e.currentTarget.open; }
      }, h('summary', null, CRM.icon('file', { size: 'sm' }), 'Нотатки й посилання', badges.length ? h('span', { class: 'pj-badges' }, badges.map((b) => b.cloneNode(true))) : null),
      notesLinks(p, sid))) : null);
  }

  function looseBlock(p, x) {
    const sid = '__loose';
    const isOpen = isExpanded(p.id, sid, x);
    const toggle = () => { setExpanded(p.id, sid, !isOpen); CRM.router.rerender(); };
    const n = x.loose.length;
    return h('section', { class: 'pj-stage pj-loose' + (isOpen ? ' open' : ''), dataset: { stage: '' } },
      h('div', { class: 'pj-stage-head' },
        h('button', {
          type: 'button', class: 'btn btn-ghost btn-icon btn-sm pj-stage-toggle', 'aria-expanded': isOpen ? 'true' : 'false',
          'aria-label': `${isOpen ? 'Згорнути' : 'Розгорнути'}: без етапу`, onClick: toggle
        }, CRM.icon('chevronRight', { size: 'sm' })),
        h('button', { type: 'button', class: 'pj-stage-name', onClick: toggle, tabIndex: -1 }, h('span', { class: 'pj-stage-title' }, x.stages.length ? 'Без етапу' : 'Задачі')),
        h('span', { class: 'pj-stage-meta' }, n ? h('span', { class: 'pj-stage-count num' }, String(n)) : null)),
      isOpen ? h('div', { class: 'pj-stage-body' }, stageTasks(p, null, x.loose, x.looseDone)) : null);
  }

  function renderProject(container, id, params) {
    const p = get(id);
    const back = h('a', { class: 'btn btn-ghost btn-sm pj-back', href: '#/projects' + (p && statusOf(p) === 'done' ? '/done' : '') }, CRM.icon('chevronLeft', { size: 'sm' }), 'Проєкти');
    if (!p) {
      ui.mount(container, back, ui.pageHead({ title: 'Проєкт не знайдено' }), h('section', { class: 'card' }, ui.empty({
        icon: 'projects', title: 'Такого проєкту немає', text: 'Можливо, його видалено (перевір Кошик).', action: { label: 'До проєктів', onClick: () => CRM.router.go('projects') }
      })));
      return null;
    }
    const T = D.today();
    const x = info(p, T);
    const hl = params && params.stage;
    if (hl) { setExpanded(p.id, hl, true); }
    const curSid = x.cur ? x.cur.s.id : null;
    const subParts = [];
    if (x.status === 'done') subParts.push('Завершено' + (p.doneAt ? ' ' + fmt.dateShort(p.doneAt) : ''));
    else {
      if (x.status === 'paused') subParts.push('На паузі');
      if (x.deadline) subParts.push(`Кінець — ${fmt.dateShort(x.deadline)} · ${leftText(D.diffDays(T, x.deadline))}`);
    }
    const head = ui.pageHead({
      title: h('span', { class: 'pj-title' }, h('span', { class: 'pj-dot', style: { '--pj': colorOf(p) } }), p.name || 'Без назви'),
      sub: subParts.join(' · ') || null,
      actions: [
        ui.button({ label: 'Змінити', icon: 'pencil', className: 'pj-edit', onClick: () => openForm(p.id) }),
        ui.button({
          label: 'Задача', icon: 'plus', variant: 'primary', className: 'pj-add-task', dataset: { hk: 'add' }, title: 'Нова задача в поточному етапі',
          onClick: () => CRM.tasks.openNew({ projectId: p.id, stageId: curSid })
        })
      ]
    });

    const statusSeg = h('div', { class: 'segmented pj-status-seg', role: 'radiogroup', 'aria-label': 'Стан проєкту' },
      STATUSES.map((s) => h('button', {
        type: 'button', role: 'radio', class: x.status === s.id ? 'active' : '', 'aria-checked': x.status === s.id ? 'true' : 'false', dataset: { status: s.id },
        onClick: () => setStatus(p.id, s.id)
      }, s.label)));
    const allDone = x.stages.length && x.stages.every((r) => r.isDone) && x.status !== 'done';
    const hero = h('section', { class: 'card pj-hero', style: { '--pj': colorOf(p) } },
      h('div', { class: 'card-body' },
        h('div', { class: 'pj-hero-top' },
          h('div', { class: 'pj-hero-pct' },
            h('b', { class: 'num' }, x.pct + ' %'),
            h('span', { class: 'subtle' }, [
              x.stages.length ? `${x.doneStages} з ${fmt.count(x.stages.length, ['етапу', 'етапів', 'етапів'])}` : null,
              x.totalTasks ? `${x.doneTasks} з ${fmt.count(x.totalTasks, ['задачі', 'задач', 'задач'])}` : null
            ].filter(Boolean).join(' · ') || 'Ще немає етапів і задач')),
          statusSeg),
        bar(x.pct),
        timeline(x, T),
        allDone ? h('div', { class: 'callout pj-all-done' }, CRM.icon('checkCircle'),
          h('span', null, 'Усі етапи готові! ', h('button', { type: 'button', class: 'link-like pj-finish', onClick: () => setStatus(p.id, 'done') }, 'Позначити проєкт завершеним'))) : null));

    const blocks = x.stages.map((r) => stageBlock(p, x, r, hl));
    const showLoose = x.loose.length || x.looseDone.length || !x.stages.length;
    const stagesCard = h('section', { class: 'card pj-stages-card' },
      h('div', { class: 'card-head' }, h('h2', null, CRM.icon('listChecks', { size: 'sm' }), 'Етапи'),
        x.stages.length ? h('span', { class: 'subtle num' }, `${x.doneStages} з ${x.stages.length}`) : null),
      h('div', { class: 'card-body pj-stages' },
        x.stages.length ? null : h('p', { class: 'subtle pj-no-stages' }, 'Етапів ще немає. Розбий проєкт на кроки з датами — так видно, що зараз і що далі.'),
        blocks,
        showLoose ? looseBlock(p, x) : null,
        x.stages.length < MAX_STAGES ? ui.button({ label: 'Етап', icon: 'plus', size: 'sm', variant: 'ghost', className: 'pj-add-stage', onClick: () => openStageForm(p.id, null) }) : null));

    const nl = notesLinks(p, null);
    const notesCard = h('section', { class: 'card pj-notes-card' },
      h('div', { class: 'card-head' }, h('h2', null, CRM.icon('file', { size: 'sm' }), 'Нотатки й посилання')),
      h('div', { class: 'card-body' }, nl));

    ui.mount(container, back, head, h('div', { class: 'stack pj-page', style: { '--pj': colorOf(p) } }, hero, stagesCard, notesCard));
    if (hl) {
      CRM.router.consumeParam('stage');
      setTimeout(() => {
        const el = container.querySelector(`.pj-stage[data-stage="${CSS.escape(hl)}"]`);
        if (el) { el.scrollIntoView({ block: 'center' }); setTimeout(() => el.classList.remove('pj-hl'), 2400); }
      }, 50);
    }
    return () => { container.querySelectorAll('.pj-nl').forEach((b) => { if (b.flush) b.flush(); }); };
  }

  function render(container, route) {
    // Не губимо фокус і недописане при перемальовуванні (нова задача Enter-ом, зміни з іншого пристрою)
    const ae = document.activeElement;
    let keep = null;
    if (ae && container.contains(ae) && ae.dataset && ae.dataset.keep) {
      keep = { key: ae.dataset.keep, value: ae.value, s: ae.selectionStart, e: ae.selectionEnd };
    }
    const onTheme = () => CRM.router.rerender();
    document.addEventListener('crm:themechange', onTheme);
    const sub = route && route.sub;
    let cleanup = null;
    if (!sub || sub === 'done') renderList(container, sub === 'done' ? 'done' : 'open');
    else cleanup = renderProject(container, sub, route.params);
    if (keep) {
      const el = container.querySelector(`[data-keep="${CSS.escape(keep.key)}"]`);
      if (el) { el.value = keep.value; el.focus(); try { el.setSelectionRange(keep.s, keep.e); } catch (e) { /* поле без виділення */ } }
    }
    const p = route && route.params;
    if (p && p.open) {
      const id = p.open;
      CRM.router.consumeParam('open');
      setTimeout(() => openForm(id), 0);
    }
    return () => {
      document.removeEventListener('crm:themechange', onTheme);
      if (cleanup) cleanup();
    };
  }

  // ---------- Вікно етапу ----------
  function openStageForm(pid, sid) {
    const p = get(pid);
    if (!p) return null;
    const stages = stagesOf(p);
    const idx = sid ? stages.findIndex((s) => s.id === sid) : stages.length;
    const st = sid ? stages[idx] : null;
    if (sid && !st) return null;
    const isNew = !st;
    // Новий етап: початок — наступний день після кінця останнього (якщо він є)
    const prevEnd = (() => { for (let j = idx - 1; j >= 0; j--) if (stages[j].end) return stages[j].end; return null; })();
    const nameIn = ui.input({ value: st ? st.name : '', maxlength: 120, placeholder: 'Напр.: Огляд літератури', 'aria-label': 'Назва етапу', class: 'input pj-stage-name-in' });
    const fName = ui.field({ label: 'Назва', input: nameIn });
    const startIn = ui.dateInput({ value: st ? st.start || null : null, placeholder: prevEnd ? 'Після попереднього' : 'Не вказано', ariaLabel: 'Початок етапу' });
    const endIn = ui.dateInput({ value: st ? st.end || null : null, placeholder: 'Без дедлайну', ariaLabel: 'Дедлайн етапу' });
    const err = h('div', { class: 'pj-form-err', role: 'alert', hidden: true });
    const save = async () => {
      const name = nameIn.value.trim();
      if (!name) { fName.setError('Вкажи назву етапу'); nameIn.focus(); return; }
      const start = startIn.dateValue || null;
      const end = endIn.dateValue || null;
      if (start && end && start > end) { err.textContent = 'Початок має бути не пізніше за дедлайн'; err.hidden = false; return; }
      dlg.close('force');
      const cur = get(pid);
      if (!cur) return;
      if (isNew) {
        const rec = { id: U.uid(), name, start, end, done: false, doneAt: null, notes: '', links: [] };
        await CRM.store.patch('projects', pid, { stages: stagesOf(cur).concat([rec]) });
        CRM.notify.runRules();
        ui.toast(`Етап «${name}» додано`, { type: 'success' });
        return;
      }
      const old = stagesOf(cur).find((s) => s.id === sid);
      if (!old) return;
      const before = snapshot(pid);
      await patchStage(pid, sid, { name, start, end });
      CRM.notify.runRules();
      const i = stagesOf(cur).findIndex((s) => s.id === sid);
      if (old.end && end && old.end !== end) await askShift(pid, i, old.end, end, before);
    };
    nameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); save(); } });
    const dlg = ui.modal({
      title: isNew ? 'Новий етап' : 'Етап', size: 'sm', className: 'pj-stage-modal',
      body: h('div', { class: 'form-stack' },
        fName,
        h('div', { class: 'pj-dates-row' },
          ui.field({ label: 'Початок', input: startIn, hint: prevEnd ? `Необовʼязково: інакше — з ${fmt.dateShort(D.addDays(prevEnd, 1))}` : 'Необовʼязково' }),
          ui.field({ label: 'Дедлайн', input: endIn })),
        err),
      footer: [
        isNew ? null : ui.button({ label: 'Видалити', icon: 'trash', variant: 'danger-ghost', className: 'pj-stage-del', onClick: () => { dlg.close('force'); removeStage(pid, sid); } }),
        h('span', { class: 'grow' }),
        ui.button({ label: 'Скасувати', onClick: () => dlg.close('cancel') }),
        ui.button({ label: isNew ? 'Додати' : 'Зберегти', variant: 'primary', className: 'pj-stage-save', onClick: save })
      ],
      initialFocus: nameIn
    });
    return dlg;
  }

  // ---------- Форма проєкту ----------
  function openForm(id) {
    const cur = id ? get(id) : null;
    if (id && !cur) { ui.toast('Цього проєкту більше немає', { type: 'error' }); return null; }
    const isNew = !cur;
    const st = cur ? U.deepClone(cur) : { id: U.uid(), name: '', color: nextColor(), status: 'active', deadline: null, notes: '', links: [], stages: [], doneAt: null };
    if (!Array.isArray(st.stages)) st.stages = [];
    // Рядки етапів у формі (id лишаються — задачі не губляться)
    let rows = stagesOf(st).map((s) => ({ id: s.id, name: s.name, start: s.start || null, end: s.end || null, orig: s }));
    if (isNew) rows = [{ id: U.uid(), name: '', start: null, end: null }];

    const nameIn = ui.input({ value: st.name, maxlength: 120, placeholder: 'Напр.: Диплом, Ремонт кухні', 'aria-label': 'Назва проєкту', class: 'input pj-name-in' });
    const fName = ui.field({ label: 'Назва', input: nameIn });

    let color = colorId(st);
    const sw = h('div', { class: 'swatches pj-swatches', role: 'radiogroup', 'aria-label': 'Колір проєкту' });
    function renderSw() {
      ui.mount(sw, COLORS.map((c) => {
        const inf = CRM.dict.get('categoryColors', c) || {};
        return h('button', {
          type: 'button', role: 'radio', class: 'swatch' + (color === c ? ' active' : ''), style: { '--sw': CRM.dict.categoryColor(c) },
          title: inf.name || c, 'aria-label': inf.name || c, 'aria-checked': color === c ? 'true' : 'false', dataset: { color: c },
          onClick: () => { color = c; renderSw(); }
        }, color === c ? CRM.icon('check') : null);
      }));
    }
    renderSw();

    let status = statusOf(st);
    const statusSeg = isNew ? null : h('div', { class: 'segmented pj-form-status', role: 'radiogroup', 'aria-label': 'Стан' });
    function renderStatus() {
      if (!statusSeg) return;
      ui.mount(statusSeg, STATUSES.map((s) => h('button', {
        type: 'button', role: 'radio', class: status === s.id ? 'active' : '', 'aria-checked': status === s.id ? 'true' : 'false', dataset: { status: s.id },
        onClick: () => { status = s.id; renderStatus(); }
      }, s.label)));
    }
    renderStatus();

    const dlIn = ui.dateInput({ value: st.deadline || null, placeholder: 'Як в останнього етапу', ariaLabel: 'Дедлайн проєкту' });

    // --- Етапи ---
    const stagesBox = h('div', { class: 'pj-form-stages' });
    function readRows() {
      stagesBox.querySelectorAll('.pj-form-stage').forEach((el) => {
        const r = rows.find((y) => y.id === el.dataset.id);
        if (!r) return;
        r.name = el.querySelector('.pj-fs-name').value;
        r.start = el.querySelector('.pj-fs-start').dateValue || null;
        r.end = el.querySelector('.pj-fs-end').dateValue || null;
      });
    }
    function renderStages(focusId) {
      ui.mount(stagesBox, rows.map((r, i) => {
        const nm = ui.input({ value: r.name, maxlength: 120, placeholder: `Етап ${i + 1}`, 'aria-label': `Назва етапу ${i + 1}`, class: 'input pj-fs-name' });
        nm.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); addRow(); } });
        const prevEnd = (() => { for (let j = i - 1; j >= 0; j--) if (rows[j].end) return rows[j].end; return null; })();
        const s = ui.dateInput({ value: r.start, placeholder: prevEnd ? 'після попер.' : 'початок', ariaLabel: `Початок етапу ${i + 1}`, className: 'input pj-fs-start' });
        const e = ui.dateInput({ value: r.end, placeholder: 'дедлайн', ariaLabel: `Дедлайн етапу ${i + 1}`, className: 'input pj-fs-end' });
        const iconBtn = (icon, label, cls, fn, disabled) => h('button', {
          type: 'button', class: 'btn btn-ghost btn-icon btn-sm ' + cls, title: label, 'aria-label': `${label}: етап ${i + 1}`, disabled: !!disabled, onClick: fn
        }, CRM.icon(icon, { size: 'sm' }));
        return h('div', { class: 'pj-form-stage', dataset: { id: r.id } },
          h('span', { class: 'pj-fs-num num' }, `${i + 1}.`),
          nm,
          h('span', { class: 'pj-fs-dates' }, s, h('span', { class: 'subtle' }, '–'), e),
          h('span', { class: 'pj-fs-acts' },
            iconBtn('chevronLeft', 'Вище', 'pj-fs-up', () => { readRows(); const t = rows[i - 1]; rows[i - 1] = rows[i]; rows[i] = t; renderStages(); }, i === 0),
            iconBtn('chevronRight', 'Нижче', 'pj-fs-down', () => { readRows(); const t = rows[i + 1]; rows[i + 1] = rows[i]; rows[i] = t; renderStages(); }, i === rows.length - 1),
            iconBtn('x', 'Прибрати', 'pj-fs-del', () => { readRows(); rows.splice(i, 1); renderStages(); })));
      }), rows.length < MAX_STAGES ? ui.button({ label: 'Етап', icon: 'plus', size: 'sm', variant: 'ghost', className: 'pj-fs-add', onClick: () => addRow() }) : null);
      if (focusId) {
        const el = stagesBox.querySelector(`.pj-form-stage[data-id="${focusId}"] .pj-fs-name`);
        if (el) el.focus();
      }
    }
    function addRow() {
      readRows();
      const r = { id: U.uid(), name: '', start: null, end: null };
      rows.push(r);
      renderStages(r.id);
    }
    renderStages();

    // --- Взяти задачі з мітки (лише новий проєкт) ---
    let labelSel = null;
    if (isNew && CRM.tasks.allLabels) {
      const labels = CRM.tasks.allLabels().filter((l) => l.total > 0 || l.active > 0);
      if (labels.length) {
        labelSel = h('select', { class: 'select pj-from-label', 'aria-label': 'Взяти задачі з мітки' },
          h('option', { value: '' }, 'Ні'),
          labels.map((l) => h('option', { value: l.key }, `#${l.name} · ${fmt.count(l.total != null ? l.total : l.active, ['задача', 'задачі', 'задач'])}`)));
      }
    }

    const err = h('div', { class: 'pj-form-err', role: 'alert', hidden: true });

    async function save() {
      if (!canSave()) return;
      readRows();
      const name = nameIn.value.trim();
      if (!name) { fName.setError('Вкажи назву проєкту'); nameIn.focus(); return; }
      fName.setError(null);
      const filled = rows.filter((r) => r.name.trim() || r.start || r.end);
      const noName = filled.find((r) => !r.name.trim());
      if (noName) { err.textContent = 'У кожного етапу має бути назва (порожній рядок можна прибрати ×)'; err.hidden = false; return; }
      const bad = filled.find((r) => r.start && r.end && r.start > r.end);
      if (bad) { err.textContent = `Етап «${bad.name.trim()}»: початок має бути не пізніше за дедлайн`; err.hidden = false; return; }
      err.hidden = true;
      const stages = filled.map((r) => Object.assign({ done: false, doneAt: null, notes: '', links: [] }, r.orig || {}, { id: r.id, name: r.name.trim(), start: r.start, end: r.end }));
      const deadline = dlIn.dateValue || null;
      if (isNew) {
        const rec = await CRM.store.save('projects', Object.assign(st, { name, color, stages, deadline, status: 'active' }));
        if (labelSel && labelSel.value) {
          const key = labelSel.value;
          const list = CRM.store.list('tasks').filter((t) => CRM.tasks.labelsOf(t).some((l) => CRM.tasks.labelKey(l) === key) && !t.projectId);
          if (list.length) await CRM.store.saveMany('tasks', list.map((t) => Object.assign({}, t, { projectId: rec.id, stageId: null })));
        }
        dlg.close('force');
        CRM.notify.runRules();
        CRM.router.go('projects/' + rec.id);
        ui.toast(`Проєкт «${rec.name}» створено`, { type: 'success' });
        return;
      }
      const now = get(st.id);
      if (!now) { dlg.close('force'); return; }
      // Етапи, яких у формі вже немає: їхні задачі — «Без етапу»
      const keep = new Set(stages.map((s) => s.id));
      const orphan = tasksOf(now).filter((t) => t.stageId && !keep.has(t.stageId) && stagesOf(now).some((s) => s.id === t.stageId));
      const changes = { name, color, stages, deadline };
      if (status !== statusOf(now)) { changes.status = status; changes.doneAt = status === 'done' ? D.today() : null; }
      await CRM.store.patch('projects', st.id, changes);
      if (orphan.length) await CRM.store.saveMany('tasks', orphan.map((t) => Object.assign({}, t, { stageId: null })));
      CRM.notify.runRules();
      dlg.close('force');
      ui.toast('Проєкт збережено', { type: 'success' });
    }

    const body = h('div', { class: 'form-stack pj-form' },
      fName,
      ui.field({ label: 'Колір', input: sw }),
      statusSeg ? ui.field({ label: 'Стан', input: statusSeg }) : null,
      h('section', { class: 'pj-form-sec' },
        h('div', { class: 'section-head' }, h('h3', null, CRM.icon('listChecks', { size: 'sm' }), 'Етапи'),
          h('span', { class: 'subtle' }, 'Назва й дедлайн; початок — необовʼязково')),
        stagesBox),
      ui.field({ label: 'Дедлайн проєкту', input: dlIn, hint: 'Якщо не вказати — дедлайн останнього етапу' }),
      labelSel ? ui.field({ label: 'Взяти задачі з мітки', input: labelSel, hint: 'Задачі з цією міткою стануть задачами проєкту (у групі «Без етапу»)' }) : null,
      err);

    const dlg = ui.drawer({
      title: isNew ? 'Новий проєкт' : 'Змінити проєкт',
      body,
      footer: h('div', { class: 'drawer-footer-inner' },
        isNew ? null : ui.button({ label: 'Видалити', icon: 'trash', variant: 'danger-ghost', className: 'pj-del', onClick: async () => { if (await removeProject(st.id)) { dlg.close('force'); CRM.router.go('projects'); } } }),
        h('span', { class: 'grow' }),
        ui.button({ label: 'Скасувати', onClick: () => dlg.close('button') }),
        ui.button({ label: isNew ? 'Створити' : 'Зберегти', icon: isNew ? 'plus' : 'check', variant: 'primary', className: 'pj-save', onClick: save })),
      initialFocus: isNew ? nameIn : 'container',
      onBeforeClose: (reason) => {
        if (reason === 'force') return true;
        readRows();
        const dirty = isNew
          ? !!(nameIn.value.trim() || rows.some((r) => r.name.trim() || r.start || r.end))
          : nameIn.value.trim() !== (st.name || '') || color !== colorId(st) || status !== statusOf(st) || (dlIn.dateValue || null) !== (st.deadline || null) ||
            JSON.stringify(rows.map((r) => [r.id, r.name.trim(), r.start, r.end])) !== JSON.stringify(stagesOf(st).map((s) => [s.id, s.name, s.start || null, s.end || null]));
        if (!dirty) return true;
        ui.confirm({ title: isNew ? 'Не створювати проєкт?' : 'Не зберігати зміни?', message: 'Введені дані не збережуться.', confirmText: isNew ? 'Не створювати' : 'Не зберігати', cancelText: 'Повернутися', danger: true })
          .then((ok) => { if (ok) dlg.close('force'); });
        return false;
      }
    });
    dlg.el.classList.add('pj-drawer');
    nameIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); const f = stagesBox.querySelector('.pj-fs-name'); if (f) f.focus(); } });
    return dlg;
  }

  function openProject(id, params) { CRM.router.go(id ? 'projects/' + id : 'projects', params || null); }

  CRM.router.register('projects', { title: 'Проєкти', stores: ['projects', 'tasks', 'attachments', 'settings'], render });

  CRM.projects = {
    all, get, open, statusOf, statusLabel, stagesOf, colorId, colorOf, nextColor, COLORS, STATUSES,
    tasksOf, stageIdOf, projectOfTask, info, stageStart, leftText, rangeText, stageWhen, stageLine, subText,
    normUrl, hostOf, linkLabel, linksOf, hasNotes,
    patchProject, patchStage, setStageDone, shiftAfter, shiftScope, askShift, moveStageEnd, moveStage, removeStage, setStatus,
    addTask, assignTask, removeProject, snapshot, restoreSnapshot,
    chip, taskField, filterOptions, matchFilter,
    openForm, openStageForm, openProject
  };
})(window.CRM);
