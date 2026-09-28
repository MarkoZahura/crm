/* ==========================================================================
   learning.js — розділ «Навчання».
   Курси й предмети з прогресом (виконані теми / усі), теми-чекліст
   з необовʼязковими дедлайнами, посилання й нотатки.
   Дедлайни курсів і тем потрапляють у розклад на Головній і в нагадування.
   Зміни в бічній панелі існуючого курсу зберігаються автоматично.
   ========================================================================== */
window.CRM = window.CRM || {};

(function (CRM) {
  'use strict';

  const { h, ui } = { h: CRM.ui.h, ui: CRM.ui };
  const D = CRM.date;
  const fmt = CRM.fmt;

  let statusFilter = 'active';

  function progress(c) {
    const topics = c.topics || [];
    const done = topics.filter((t) => t.done).length;
    return { done, total: topics.length, pct: topics.length ? done / topics.length * 100 : 0 };
  }

  /** Усі відкриті дедлайни: курсу й невиконаних тем (для активних курсів). */
  function deadlines(from, to) {
    const out = [];
    CRM.store.list('courses').forEach((c) => {
      if ((c.status || 'active') !== 'active') return;
      if (c.deadline && (!from || c.deadline >= from) && (!to || c.deadline <= to)) out.push({ course: c, topic: null, date: c.deadline });
      (c.topics || []).forEach((t) => {
        if (!t.done && t.deadline && (!from || t.deadline >= from) && (!to || t.deadline <= to)) out.push({ course: c, topic: t, date: t.deadline });
      });
    });
    return out.sort((a, b) => a.date.localeCompare(b.date));
  }

  function dueLabel(date) {
    const diff = D.diffDays(D.today(), date);
    if (diff < 0) return { text: 'Прострочено · ' + fmt.dateShort(date), cls: 'due-overdue' };
    if (diff === 0) return { text: 'Сьогодні', cls: 'due-today' };
    return { text: fmt.relDay(date), cls: '' };
  }

  // ---------- Сторінка ----------
  function card(c) {
    const p = progress(c);
    const next = deadlines().filter((d) => d.course.id === c.id)[0];
    const status = c.status || 'active';
    return h('article', { class: 'card goal-card course-card st-' + status, role: 'button', tabIndex: 0, dataset: { id: c.id },
      onClick: () => openCourse(c.id),
      onKeydown: (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) openCourse(c.id); }
    },
    h('div', { class: 'goal-head' },
      h('div', { class: 'goal-title' },
        h('h3', null, c.title),
        h('div', { class: 'btn-row', style: { gap: '6px' } },
          h('span', { class: 'badge' }, CRM.dict.label('courseKinds', c.kind) || 'Курс'),
          status !== 'active' ? h('span', { class: 'badge ' + (status === 'done' ? 'badge-success' : 'badge-warning') }, CRM.dict.label('courseStatuses', status)) : null)),
      h('span', { class: 'goal-pct num' }, fmt.percent(p.pct, 0))),
    h('div', { class: 'progress goal-progress', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': String(p.total), 'aria-valuenow': String(p.done), 'aria-label': 'Прогрес тем' },
      h('div', { class: 'progress-bar', style: { width: p.pct + '%' } })),
    h('div', { class: 'course-meta' },
      h('span', null, p.total ? `${p.done} з ${fmt.count(p.total, ['теми', 'тем', 'тем'])}` : 'Теми ще не додано'),
      c.deadline ? h('span', null, 'Дедлайн курсу: ' + fmt.date(c.deadline)) : null),
    next ? h('div', { class: 'goal-plan' + (next.date < D.today() ? ' overdue' : '') }, CRM.icon('calendar', { size: 'sm' }),
      `${next.topic ? `«${next.topic.title}»` : 'Курс'} — ${dueLabel(next.date).text.toLowerCase()}`) : null);
  }

  function upcomingCard() {
    const T = D.today();
    const list = deadlines(null, D.addDays(T, 14));
    if (!list.length) return null;
    return h('section', { class: 'card' },
      h('div', { class: 'card-head' }, h('h2', null, 'Найближчі дедлайни'), h('span', { class: 'subtle' }, 'прострочені й на 14 днів')),
      h('div', { class: 'upc-list' }, list.slice(0, 8).map((d) => {
        const dl = dueLabel(d.date);
        return h('button', { type: 'button', class: 'upc-row', onClick: () => openCourse(d.course.id) },
          h('span', { class: 'upc-date ' + (dl.cls === 'due-overdue' ? 'overdue' : '') }, dl.text),
          h('span', { class: 'learn-upc-main' },
            h('span', { class: 'upc-name' }, d.topic ? d.topic.title : 'Дедлайн курсу'),
            h('span', { class: 'learn-upc-course' }, d.course.title)));
      })));
  }

  function render(container, route) {
    const all = CRM.store.list('courses');
    const counts = { all: all.length };
    CRM.dict.courseStatuses.forEach((s) => { counts[s.id] = all.filter((c) => (c.status || 'active') === s.id).length; });
    const filters = [{ id: 'active', label: 'Активні' }, { id: 'done', label: 'Завершені' }, { id: 'paused', label: 'На паузі' }, { id: 'all', label: 'Усі' }];
    const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Стан' }, filters.map((f) => h('button', {
      type: 'button', class: 'chip' + (statusFilter === f.id ? ' active' : ''), 'aria-pressed': statusFilter === f.id ? 'true' : 'false',
      onClick: () => { statusFilter = f.id; CRM.router.rerender(); }
    }, `${f.label} · ${counts[f.id] || 0}`)));
    const items = (statusFilter === 'all' ? all : all.filter((c) => (c.status || 'active') === statusFilter))
      .sort((a, b) => (a.deadline || '9999').localeCompare(b.deadline || '9999') || a.title.localeCompare(b.title, 'uk'));

    const body = items.length
      ? h('div', { class: 'goal-grid' }, items.map(card))
      : h('div', { class: 'card' }, ui.empty({
        icon: 'graduation',
        title: all.length ? 'У цьому розділі порожньо' : 'Ще немає курсів — додай перший',
        text: all.length ? null : 'Курс або предмет із темами-чеклістом, дедлайнами й нотатками. Дедлайни зʼявляться на Головній і в нагадуваннях.',
        action: all.length ? null : { label: 'Додати курс', icon: 'plus', onClick: () => openCourse() }
      }));

    ui.mount(container,
      ui.pageHead({
        title: 'Навчання', sub: 'Курси й предмети: теми, прогрес, дедлайни, нотатки.',
        actions: ui.button({ label: 'Додати курс', icon: 'plus', variant: 'primary', onClick: () => openCourse() })
      }),
      h('div', { class: 'stack' }, upcomingCard(), all.length ? chips : null, body));

    if (route.params.open) {
      const id = route.params.open;
      CRM.router.consumeParam('open');
      setTimeout(() => openCourse(id), 0);
    }
  }

  // ---------- Бічна панель курсу ----------
  function openCourse(id) {
    const existing = id ? CRM.store.get('courses', id) : null;
    if (id && (!existing || existing.deletedAt)) { ui.toast('Курс не знайдено', { type: 'error' }); return null; }
    const isNew = !existing;
    const st = existing ? CRM.utils.deepClone(existing) : { id: CRM.utils.uid(), title: '', kind: 'course', status: 'active', link: '', deadline: null, topics: [], notes: '' };
    if (!st.topics) st.topics = [];

    async function commit(changes) {
      Object.assign(st, changes);
      if (isNew) return;
      const cur = CRM.store.get('courses', st.id);
      if (!cur || cur.deletedAt) return;
      await CRM.store.patch('courses', st.id, changes);
      if ('deadline' in changes || 'topics' in changes || 'status' in changes) CRM.notify.runRules();
    }
    const deferred = (fn, ms) => { let t = null; let args = null; const f = (...a) => { args = a; clearTimeout(t); t = setTimeout(() => { t = null; fn(...args); }, ms); }; f.flush = () => { if (t) { clearTimeout(t); t = null; fn(...args); } }; return f; };

    const titleIn = h('textarea', { class: 'task-title-input', rows: 1, maxlength: 120, placeholder: 'Назва курсу чи предмета', 'aria-label': 'Назва', value: st.title });
    const fTitle = ui.field({ input: titleIn, className: 'task-title-field' });
    const saveTitle = deferred((v) => commit({ title: v }), 400);
    titleIn.addEventListener('input', () => {
      titleIn.value = titleIn.value.replace(/\n/g, ' ');
      const v = titleIn.value.trim();
      if (isNew) { st.title = v; return; }
      if (!v) { fTitle.setError('Назва не може бути порожньою'); return; }
      fTitle.setError(null);
      saveTitle(v);
    });

    const seg = (list, cur, label, onPick) => {
      const wrap = h('div', { class: 'segmented', role: 'radiogroup', 'aria-label': label });
      const r = (val) => ui.mount(wrap, list.map((x) => h('button', {
        type: 'button', role: 'radio', class: val === x.id ? 'active' : '', 'aria-checked': val === x.id ? 'true' : 'false',
        onClick: () => { r(x.id); onPick(x.id); }
      }, x.label)));
      r(cur);
      wrap.refresh = r;
      return wrap;
    };
    const kindSeg = seg(CRM.dict.courseKinds, st.kind, 'Тип', (v) => commit({ kind: v }));
    const statusSeg = seg(CRM.dict.courseStatuses, st.status || 'active', 'Стан', (v) => { commit({ status: v }); renderTopics(); });
    const dateIn = ui.dateInput({ value: st.deadline, placeholder: 'Без дедлайну', ariaLabel: 'Дедлайн курсу', onChange: (d) => commit({ deadline: d || null }) });

    const linkIn = ui.input({ type: 'url', value: st.link || '', placeholder: 'https://…', maxlength: 500, 'aria-label': 'Посилання' });
    const linkOpen = h('a', { class: 'btn btn-sm', target: '_blank', rel: 'noopener noreferrer', title: 'Відкрити посилання' }, CRM.icon('external', { size: 'sm' }), 'Відкрити');
    const saveLink = deferred((v) => commit({ link: v }), 500);
    function updateLink() {
      const v = linkIn.value.trim();
      const valid = /^https?:\/\/\S+\.\S+/.test(v);
      linkOpen.hidden = !valid;
      if (valid) linkOpen.href = v; else linkOpen.removeAttribute('href');
    }
    linkIn.addEventListener('input', () => { updateLink(); if (isNew) st.link = linkIn.value.trim(); else saveLink(linkIn.value.trim()); });
    updateLink();

    // Теми-чекліст
    const topicsBox = h('div', { class: 'checklist' });
    const topicsHead = h('div', { class: 'section-head' });
    const newTopicIn = ui.input({ placeholder: 'Нова тема — Enter', maxlength: 150, 'aria-label': 'Нова тема' });
    function currentTopics() {
      if (isNew) return st.topics.slice();
      const cur = CRM.store.get('courses', st.id);
      return ((cur && cur.topics) || st.topics || []).slice();
    }
    const setTopics = (list) => commit({ topics: list }).then(renderTopics);
    newTopicIn.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const v = newTopicIn.value.trim();
      if (!v) return;
      newTopicIn.value = '';
      setTopics(currentTopics().concat([{ id: CRM.utils.uid(), title: v, done: false, deadline: null }]));
    });
    function renderTopics() {
      const list = currentTopics();
      const done = list.filter((t) => t.done).length;
      ui.mount(topicsHead,
        h('h3', null, CRM.icon('listChecks', { size: 'sm' }), 'Теми'),
        list.length ? h('span', { class: 'subtle num' }, `${done} з ${list.length}`) : null);
      const allDone = list.length && done === list.length && (st.status || 'active') === 'active' && !isNew;
      ui.mount(topicsBox,
        list.length ? h('div', { class: 'progress' }, h('div', { class: 'progress-bar', style: { width: (done / list.length * 100) + '%' } })) : null,
        list.map((t) => {
          const text = h('input', { class: 'check-text' + (t.done ? ' done' : ''), value: t.title, maxlength: 150, 'aria-label': 'Назва теми' });
          text.addEventListener('change', () => {
            const v = text.value.trim();
            if (!v) { text.value = t.title; return; }
            setTopics(currentTopics().map((x) => (x.id === t.id ? Object.assign({}, x, { title: v }) : x)));
          });
          text.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); text.blur(); } });
          const dl = ui.dateInput({
            value: t.deadline, placeholder: 'дедлайн', ariaLabel: 'Дедлайн теми',
            onChange: (d) => setTopics(currentTopics().map((x) => (x.id === t.id ? Object.assign({}, x, { deadline: d || null }) : x)))
          });
          dl.classList.add('topic-date');
          if (t.deadline && !t.done) { const lb = dueLabel(t.deadline); if (lb.cls) dl.classList.add(lb.cls); }
          return h('div', { class: 'check-item topic-item' },
            h('button', {
              type: 'button', class: 'task-check small' + (t.done ? ' checked' : ''), role: 'checkbox', 'aria-checked': t.done ? 'true' : 'false',
              'aria-label': t.done ? 'Зняти позначку' : 'Позначити тему вивченою',
              onClick: () => setTopics(currentTopics().map((x) => (x.id === t.id ? Object.assign({}, x, { done: !x.done }) : x)))
            }, CRM.icon('check', { size: 'sm' })),
            text, dl,
            h('button', {
              type: 'button', class: 'btn btn-ghost btn-icon btn-sm check-del', title: 'Видалити тему', 'aria-label': 'Видалити тему',
              onClick: () => setTopics(currentTopics().filter((x) => x.id !== t.id))
            }, CRM.icon('x', { size: 'sm' })));
        }),
        allDone ? h('div', { class: 'callout' }, CRM.icon('checkCircle'),
          h('span', null, 'Усі теми вивчено! ', h('button', { type: 'button', class: 'link-like', onClick: () => { commit({ status: 'done' }); statusSeg.refresh('done'); renderTopics(); } }, 'Позначити курс завершеним'))) : null);
    }
    renderTopics();

    const notesIn = ui.textarea({ value: st.notes || '', rows: 5, maxlength: 5000, placeholder: 'Конспект, корисні посилання, питання до викладача…', 'aria-label': 'Нотатки' });
    const saveNotes = deferred((v) => commit({ notes: v }), 500);
    notesIn.addEventListener('input', () => { if (isNew) st.notes = notesIn.value; else saveNotes(notesIn.value); });

    async function createNow() {
      const title = titleIn.value.trim();
      if (!title) { fTitle.setError('Вкажи назву курсу'); titleIn.focus(); return; }
      st.title = title;
      st.notes = notesIn.value;
      st.link = linkIn.value.trim();
      st.deadline = dateIn.dateValue || null;
      const rec = await CRM.store.save('courses', st);
      dlg.close('force');
      CRM.notify.runRules();
      ui.toast(`«${rec.title}» додано`, { type: 'success', action: { label: 'Відкрити', onClick: () => openCourse(rec.id) } });
    }

    async function remove() {
      const ok = await ui.confirm({ title: 'Видалити курс?', message: `«${st.title}» потрапить у Кошик разом із темами й нотатками. Відновити можна протягом 30 днів.`, confirmText: 'Видалити', danger: true });
      if (!ok) return;
      const batch = await CRM.store.softDelete('courses', st.id);
      dlg.close('force');
      ui.toast('Курс перенесено в Кошик', { action: { label: 'Скасувати', onClick: () => CRM.store.restoreBatch(batch) } });
    }

    const body = h('div', { class: 'task-editor' },
      fTitle,
      h('div', { class: 'editor-grid' },
        h('div', { class: 'editor-label' }, CRM.icon('graduation', { size: 'sm' }), 'Тип'), h('div', { class: 'editor-value' }, kindSeg),
        h('div', { class: 'editor-label' }, CRM.icon('clock', { size: 'sm' }), 'Стан'), h('div', { class: 'editor-value' }, statusSeg),
        h('div', { class: 'editor-label' }, CRM.icon('calendar', { size: 'sm' }), 'Дедлайн'), h('div', { class: 'editor-value' }, dateIn),
        h('div', { class: 'editor-label' }, CRM.icon('external', { size: 'sm' }), 'Посилання'), h('div', { class: 'editor-value' }, h('div', { class: 'sub-row' }, linkIn, linkOpen))),
      h('section', { class: 'editor-section' }, topicsHead, topicsBox, newTopicIn),
      h('section', { class: 'editor-section' }, h('div', { class: 'section-head' }, h('h3', null, CRM.icon('book', { size: 'sm' }), 'Нотатки')), notesIn));

    const dlg = ui.drawer({
      title: isNew ? 'Новий курс' : 'Курс',
      body,
      footer: h('div', { class: 'drawer-footer-inner' },
        isNew ? null : ui.button({ label: 'Видалити', icon: 'trash', variant: 'danger-ghost', onClick: remove }),
        h('span', { class: 'grow' }),
        isNew ? ui.button({ label: 'Скасувати', onClick: () => dlg.close('button') }) : h('span', { class: 'save-hint visible' }, 'Зміни зберігаються автоматично'),
        isNew ? ui.button({ label: 'Створити', icon: 'plus', variant: 'primary', onClick: createNow }) : null),
      initialFocus: isNew ? titleIn : 'container',
      onBeforeClose: () => {
        if (!isNew) { saveTitle.flush(); saveNotes.flush(); saveLink.flush(); return true; }
        const hasInput = titleIn.value.trim() || notesIn.value.trim() || st.topics.length;
        if (!hasInput) return true;
        ui.confirm({ title: 'Не створювати курс?', message: 'Введені дані не збережуться.', confirmText: 'Не створювати', cancelText: 'Повернутися', danger: true })
          .then((ok) => { if (ok) dlg.close('force'); });
        return false;
      }
    });
    dlg.el.classList.add('task-drawer');
    requestAnimationFrame(() => { titleIn.style.height = 'auto'; titleIn.style.height = titleIn.scrollHeight + 2 + 'px'; });
    return dlg;
  }

  // ---------- Розклад на Головній ----------
  CRM.home.addScheduleSource((date) => deadlines(date, date).map((d) => ({
    time: null, kind: 'learning', icon: 'graduation', cls: 'ico-learning',
    title: d.topic ? d.topic.title : `Дедлайн: ${d.course.title}`,
    sub: d.topic ? `Навчання · ${d.course.title}` : 'Навчання · дедлайн курсу',
    onClick: () => { CRM.router.go('learning', { open: d.course.id }); }
  })));

  // ---------- Нагадування ----------
  CRM.notify.addRule(() => {
    const T = D.today();
    const TM = D.addDays(T, 1);
    return deadlines(null, TM).map((d) => {
      const what = d.topic ? `«${d.topic.title}» (${d.course.title})` : `курс «${d.course.title}»`;
      const ref = `${d.course.id}:${d.topic ? d.topic.id : 'course'}`;
      if (d.date === T) return { key: `learning:due-today:${ref}:${d.date}`, kind: 'learning', title: 'Навчання: дедлайн сьогодні', text: what, target: { store: 'courses', id: d.course.id } };
      if (d.date === TM) return { key: `learning:due-tomorrow:${ref}:${d.date}`, kind: 'learning', title: 'Навчання: дедлайн завтра', text: what, target: { store: 'courses', id: d.course.id } };
      return { key: `learning:overdue:${ref}:${d.date}`, kind: 'learning', title: 'Навчання: дедлайн минув', text: `${what} — ${fmt.dateShort(d.date)}`, target: { store: 'courses', id: d.course.id } };
    });
  });

  CRM.router.register('learning', { title: 'Навчання', stores: ['courses'], render });
  CRM.learning = { openCourse, deadlines, progress };
})(window.CRM);
