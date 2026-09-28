/* ==========================================================================
   tasks.js — розділ «Задачі».
   • Вкладки «Активні» та «Архів», сортування за дедлайном / пріоритетом,
     фільтр за статусом.
   • Бічна панель задачі: назва, опис, дедлайн, пріоритет, статус, чекліст,
     вкладення. Зміни існуючої задачі зберігаються автоматично.
   • Виконання — з підтвердженням; можна «Скасувати». Видалене — в Кошик.
   • Правила нагадувань: дедлайн сьогодні / завтра / прострочено.
   ========================================================================== */
window.CRM = window.CRM || {};

(function (CRM) {
  'use strict';

  const { h, ui } = { h: CRM.ui.h, ui: CRM.ui };
  const D = CRM.date;
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
    sort: loadPref('crm.tasks.sort', 'deadline')
  };

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
    if (checklist.length) meta.push(h('span', { class: 'task-meta-item', title: 'Чекліст' }, CRM.icon('listChecks', { size: 'sm' }), `${doneCount}/${checklist.length}`));
    if (files) meta.push(h('span', { class: 'task-meta-item', title: 'Вкладення' }, CRM.icon('paperclip', { size: 'sm' }), String(files)));
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
      o.archive ? ui.button({
        label: 'Відновити', icon: 'restore', size: 'sm',
        onClick: (e) => { e.stopPropagation(); reopen(t.id); }
      }) : null));
    return row;
  }

  // ---------- Дії ----------
  async function complete(id) {
    const t = CRM.store.get('tasks', id);
    if (!t || t.done) return false;
    const ok = await ui.confirm({
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
    }
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
    function renderFooter() {
      if (isNew) {
        ui.mount(footer,
          h('span', { class: 'grow' }),
          ui.button({ label: 'Скасувати', onClick: () => dlg.close('button') }),
          ui.button({ label: 'Створити задачу', variant: 'primary', icon: 'plus', onClick: createNow }));
        return;
      }
      const cur = CRM.store.get('tasks', task.id) || task;
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
      descIn,
      h('div', { class: 'editor-grid' },
        h('div', { class: 'editor-label' }, CRM.icon('calendar', { size: 'sm' }), 'Дедлайн'),
        h('div', { class: 'editor-value' },
          h('div', { class: 'deadline-inputs' }, dateIn, timeIn, clearBtn),
          quick),
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
          const hasInput = titleIn.value.trim() || descIn.value.trim() || task.checklist.length || pendingFiles.length || task.deadline;
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
      const filtered = view.filter === 'all' ? active : active.filter((t) => t.status === view.filter);
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

      if (!active.length) {
        content = h('div', { class: 'card' }, ui.empty({
          icon: 'tasks', title: 'Ще немає задач — додай першу',
          text: 'Задачі з дедлайном потраплять у розклад на Головній і в нагадування.',
          action: { label: 'Додати задачу', icon: 'plus', onClick: () => openNew() }
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

  CRM.router.register('tasks', { title: 'Задачі', stores: ['tasks', 'attachments'], render });

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

  CRM.tasks = {
    openNew, openTask, complete, reopen, remove, sortTasks, deadlineInfo, priorityTag, checkbox, taskRow,
    activeTasks, archivedTasks
  };
})(window.CRM);
