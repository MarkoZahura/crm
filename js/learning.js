/* ==========================================================================
   learning.js — розділ «Навчання».
   Курси й предмети з прогресом (виконані теми / усі), теми-чекліст
   з необовʼязковими дедлайнами, посилання й нотатки — і для курсу, і для
   кожної теми (розгортається під темою). У курсу є колір.
   Дедлайни курсів і тем потрапляють у розклад на Головній, у нагадування
   і в «Календар» (шар «Дедлайни навчання» — calendarItems / setTopicDone /
   moveDeadline). Зміни в бічній панелі існуючого курсу зберігаються автоматично.
   ========================================================================== */
window.CRM = window.CRM || {};

(function (CRM) {
  'use strict';

  const { h, ui } = { h: CRM.ui.h, ui: CRM.ui };
  const D = CRM.date;
  const fmt = CRM.fmt;

  // Синій — останнім серед яскравих: ним уже позначено задачі (колір акценту за замовчуванням)
  const COLORS = ['violet', 'orange', 'teal', 'magenta', 'green', 'aqua', 'red', 'yellow', 'blue', 'brown', 'olive', 'slate'];
  const MAX_LINKS = 20;

  let statusFilter = 'active';

  function progress(c) {
    const topics = c.topics || [];
    const done = topics.filter((t) => t.done).length;
    return { done, total: topics.length, pct: topics.length ? done / topics.length * 100 : 0 };
  }
  const isActive = (c) => (c.status || 'active') === 'active';

  // ---------- Колір курсу ----------
  function hashStr(s) {
    let x = 0;
    for (let i = 0; i < s.length; i++) x = (x * 31 + s.charCodeAt(i)) | 0;
    return Math.abs(x);
  }
  /** Id кольору палітри: вибраний або (доки не вибрано) сталий за id курсу. */
  function colorId(c) {
    if (c && c.color && CRM.dict.get('categoryColors', c.color)) return c.color;
    return COLORS[hashStr(String((c && c.id) || '')) % COLORS.length];
  }
  function colorOf(c) { return CRM.dict.categoryColor(colorId(c)); }
  function nextColor() {
    const list = CRM.store.list('courses').filter(isActive);
    const used = new Set(list.map(colorId));
    return COLORS.find((c) => !used.has(c)) || COLORS[list.length % COLORS.length];
  }

  // ---------- Посилання й нотатки теми ----------
  function topicLinks(t) { return Array.isArray(t && t.links) ? t.links.filter((l) => l && l.url) : []; }
  function hasNotes(t) { return !!(t && t.notes && String(t.notes).trim()); }
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

  /** Усі відкриті дедлайни: курсу й невиконаних тем (для активних курсів). */
  function deadlines(from, to) {
    const out = [];
    CRM.store.list('courses').forEach((c) => {
      if (!isActive(c)) return;
      if (c.deadline && (!from || c.deadline >= from) && (!to || c.deadline <= to)) out.push({ course: c, topic: null, date: c.deadline });
      (c.topics || []).forEach((t) => {
        if (!t.done && t.deadline && (!from || t.deadline >= from) && (!to || t.deadline <= to)) out.push({ course: c, topic: t, date: t.deadline });
      });
    });
    return out.sort((a, b) => a.date.localeCompare(b.date));
  }

  /**
   * Для «Календаря» (шар «Дедлайни навчання»): дедлайни активних курсів і їхніх тем
   * у проміжку, разом із вивченими темами (вони показуються закресленими).
   */
  function calendarItems(from, to) {
    const T = D.today();
    const out = [];
    CRM.store.list('courses').forEach((c) => {
      if (!isActive(c)) return;
      const inRange = (d) => D.isDate(d) && d >= from && d <= to;
      if (inRange(c.deadline)) out.push({ key: c.id + ':course', course: c, topic: null, date: c.deadline, done: false, overdue: c.deadline < T, color: colorOf(c) });
      (c.topics || []).forEach((t) => {
        if (!inRange(t.deadline)) return;
        out.push({ key: c.id + ':' + t.id, course: c, topic: t, date: t.deadline, done: !!t.done, overdue: !t.done && t.deadline < T, color: colorOf(c) });
      });
    });
    return out;
  }

  function dueLabel(date) {
    const diff = D.diffDays(D.today(), date);
    if (diff < 0) return { text: 'Прострочено · ' + fmt.dateShort(date), cls: 'due-overdue' };
    if (diff === 0) return { text: 'Сьогодні', cls: 'due-today' };
    return { text: fmt.relDay(date), cls: '' };
  }
  function dayShort(d) { return `${CRM.WEEKDAYS_SHORT[D.weekday(d)]}, ${fmt.dateShort(d)}`; }

  // ---------- Зміни з інших місць (Календар) ----------
  async function patchTopic(courseId, topicId, changes) {
    const c = CRM.store.get('courses', courseId);
    if (!c || c.deletedAt) return null;
    const before = (c.topics || []).find((t) => t.id === topicId);
    if (!before) return null;
    const topics = c.topics.map((t) => (t.id === topicId ? Object.assign({}, t, changes) : t));
    await CRM.store.patch('courses', courseId, { topics });
    CRM.notify.runRules();
    return before;
  }

  /** Позначити тему вивченою (або зняти позначку) — з тостом «Скасувати». */
  async function setTopicDone(courseId, topicId, done) {
    const before = await patchTopic(courseId, topicId, { done: !!done });
    if (!before) { ui.toast('Цієї теми більше немає', { type: 'error' }); return null; }
    const c = CRM.store.get('courses', courseId);
    const p = c ? progress(c) : null;
    ui.toast(done ? `«${before.title}» — вивчено${p ? ` (${p.done} з ${p.total})` : ''}` : `«${before.title}» — знову не вивчено`, {
      type: done ? 'success' : undefined,
      action: { label: 'Скасувати', onClick: () => patchTopic(courseId, topicId, { done: !!before.done }) }
    });
    return true;
  }

  /** Новий дедлайн теми (topicId) або курсу (topicId = null) — з тостом «Скасувати». */
  async function moveDeadline(courseId, topicId, date) {
    if (!D.isDate(date)) return null;
    const c = CRM.store.get('courses', courseId);
    if (!c || c.deletedAt) { ui.toast('Цього курсу більше немає', { type: 'error' }); return null; }
    let name;
    let undo;
    if (topicId) {
      const before = await patchTopic(courseId, topicId, { deadline: date });
      if (!before) { ui.toast('Цієї теми більше немає', { type: 'error' }); return null; }
      if (before.deadline === date) return true;
      name = before.title;
      undo = () => patchTopic(courseId, topicId, { deadline: before.deadline || null });
    } else {
      const was = c.deadline || null;
      if (was === date) return true;
      await CRM.store.patch('courses', courseId, { deadline: date });
      CRM.notify.runRules();
      name = c.title;
      undo = async () => { await CRM.store.patch('courses', courseId, { deadline: was }); CRM.notify.runRules(); };
    }
    ui.toast(`«${name}» — новий дедлайн: ${dayShort(date)}`, { action: { label: 'Скасувати', onClick: undo } });
    return true;
  }

  // ---------- Сторінка ----------
  function card(c) {
    const p = progress(c);
    const next = deadlines().filter((d) => d.course.id === c.id)[0];
    const status = c.status || 'active';
    return h('article', { class: 'card goal-card course-card st-' + status, role: 'button', tabIndex: 0, dataset: { id: c.id, color: colorId(c) },
      style: { '--cc': colorOf(c) },
      onClick: () => openCourse(c.id),
      onKeydown: (e) => { if (e.key === 'Enter' && e.target === e.currentTarget) openCourse(c.id); }
    },
    h('div', { class: 'goal-head' },
      h('div', { class: 'goal-title' },
        h('h3', null, h('span', { class: 'course-dot', 'aria-hidden': 'true' }), c.title),
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
        return h('button', { type: 'button', class: 'upc-row', onClick: () => openCourse(d.course.id, { topic: d.topic ? d.topic.id : null }) },
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
        text: all.length ? null : 'Курс або предмет із темами-чеклістом, дедлайнами, нотатками й посиланнями до кожної теми. Дедлайни зʼявляться на Головній, у Календарі й у нагадуваннях.',
        action: all.length ? null : { label: 'Додати курс', icon: 'plus', onClick: () => openCourse() }
      }));

    ui.mount(container,
      ui.pageHead({
        title: 'Навчання', sub: 'Курси й предмети: теми, прогрес, дедлайни, нотатки й посилання.',
        actions: ui.button({ label: 'Додати курс', icon: 'plus', variant: 'primary', onClick: () => openCourse() })
      }),
      h('div', { class: 'stack' }, upcomingCard(), all.length ? chips : null, body));

    if (route.params.open) {
      const id = route.params.open;
      const topic = route.params.topic || null;
      CRM.router.consumeParam('open');
      if (topic) CRM.router.consumeParam('topic');
      setTimeout(() => openCourse(id, { topic }), 0);
    }
    // Кольори карток залежать від теми
    const onTheme = () => CRM.router.rerender();
    document.addEventListener('crm:themechange', onTheme);
    return () => document.removeEventListener('crm:themechange', onTheme);
  }

  // ---------- Бічна панель курсу ----------
  /** opts.topic — id теми, яку розгорнути й показати. */
  function openCourse(id, opts) {
    const o = opts || {};
    const existing = id ? CRM.store.get('courses', id) : null;
    if (id && (!existing || existing.deletedAt)) { ui.toast('Курс не знайдено', { type: 'error' }); return null; }
    const isNew = !existing;
    const st = existing ? CRM.utils.deepClone(existing)
      : { id: CRM.utils.uid(), title: '', kind: 'course', status: 'active', color: nextColor(), link: '', deadline: null, topics: [], notes: '' };
    if (!st.topics) st.topics = [];

    async function commit(changes) {
      Object.assign(st, changes);
      if (isNew) return;
      const cur = CRM.store.get('courses', st.id);
      if (!cur || cur.deletedAt) return;
      await CRM.store.patch('courses', st.id, changes);
      if ('deadline' in changes || 'topics' in changes || 'status' in changes) CRM.notify.runRules();
    }
    const deferred = (fn, ms) => {
      let t = null; let args = null;
      const f = (...a) => { args = a; clearTimeout(t); t = setTimeout(() => { t = null; fn(...args); }, ms); };
      f.flush = () => { if (t) { clearTimeout(t); t = null; return fn(...args); } return null; };
      return f;
    };

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

    // Колір курсу (дедлайни в Календарі й смужка на картці)
    const sw = h('div', { class: 'swatches course-swatches', role: 'radiogroup', 'aria-label': 'Колір курсу' });
    function renderSw() {
      const cur = colorId(st);
      ui.mount(sw, COLORS.map((c) => {
        const info = CRM.dict.get('categoryColors', c) || {};
        return h('button', {
          type: 'button', role: 'radio', class: 'swatch' + (cur === c ? ' active' : ''), style: { '--sw': CRM.dict.categoryColor(c) },
          title: info.name || c, 'aria-label': info.name || c, 'aria-checked': cur === c ? 'true' : 'false', dataset: { color: c },
          onClick: () => { commit({ color: c }); renderSw(); }
        }, cur === c ? CRM.icon('check') : null);
      }));
    }
    renderSw();

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

    // ---------- Теми-чекліст ----------
    const topicsBox = h('div', { class: 'checklist' });
    const topicsHead = h('div', { class: 'section-head' });
    const newTopicIn = ui.input({ placeholder: 'Нова тема — Enter', maxlength: 150, 'aria-label': 'Нова тема' });
    const expanded = new Set(o.topic ? [o.topic] : []);
    const noteSavers = new Map();   // id теми → відкладене збереження нотатки
    const rows = new Map();         // id теми → { badges }

    function currentTopics() {
      if (isNew) return st.topics.slice();
      const cur = CRM.store.get('courses', st.id);
      return ((cur && cur.topics) || st.topics || []).slice();
    }
    /**
     * Зміни списку тем — по черзі: кожна читає теми вже після попередньої
     * (інакше нотатка, що саме зберігається, і галочка могли б перезаписати одна одну).
     */
    let topicQueue = Promise.resolve();
    function writeTopics(fn) {
      const p = topicQueue.then(() => commit({ topics: fn(currentTopics()) }));
      topicQueue = p.catch((e) => console.error(e));
      return p;
    }
    /** Спершу зберегти недописані нотатки, потім змінити список тем і перемалювати. */
    async function updTopics(fn, after) {
      noteSavers.forEach((f) => f.flush());
      await writeTopics(fn);
      renderTopics();
      if (after) after();
    }
    const mapTopic = (id, changes) => (list) => list.map((x) => (x.id === id ? Object.assign({}, x, changes) : x));

    newTopicIn.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const v = newTopicIn.value.trim();
      if (!v) return;
      newTopicIn.value = '';
      updTopics((list) => list.concat([{ id: CRM.utils.uid(), title: v, done: false, deadline: null }]));
    });

    function badges(t) {
      const links = topicLinks(t);
      const out = [];
      if (links.length) out.push(h('span', { class: 'topic-badge tb-links', title: fmt.count(links.length, ['посилання', 'посилання', 'посилань']) }, CRM.icon('link', { size: 'sm' }), h('span', { class: 'num' }, String(links.length))));
      if (hasNotes(t)) out.push(h('span', { class: 'topic-badge tb-notes', title: 'Є нотатки' }, CRM.icon('file', { size: 'sm' })));
      return out;
    }
    const hasMeta = (t) => !!(t.deadline || hasNotes(t) || topicLinks(t).length);
    function refreshBadges(id) {
      const r = rows.get(id);
      const t = currentTopics().find((x) => x.id === id);
      if (!r || !t) return;
      ui.mount(r.badges, badges(t));
      r.wrap.classList.toggle('has-meta', hasMeta(t));
    }

    function toggleTopic(id) {
      if (expanded.has(id)) expanded.delete(id); else expanded.add(id);
      const saver = noteSavers.get(id);
      if (saver) saver.flush();
      topicQueue.then(() => {
        renderTopics();
        const wrap = topicsBox.querySelector(`.topic-wrap[data-topic="${id}"]`);
        const btn = wrap && wrap.querySelector('.topic-more');
        if (btn) btn.focus();
      });
    }

    /** Розгорнута частина теми: нотатки й посилання. */
    function extraOf(t) {
      const notes = ui.textarea({
        value: t.notes || '', rows: 3, maxlength: 5000, class: 'textarea topic-notes',
        placeholder: 'Нотатки до теми: конспект, сторінки підручника, питання…', 'aria-label': `Нотатки до теми «${t.title}»`
      });
      const saver = deferred((v) => writeTopics(mapTopic(t.id, { notes: v })).then(() => refreshBadges(t.id)), 500);
      noteSavers.set(t.id, saver);
      notes.addEventListener('input', () => saver(notes.value));
      notes.addEventListener('blur', () => saver.flush());

      const links = topicLinks(t);
      const urlIn = ui.input({ type: 'url', placeholder: 'Посилання: https://…', maxlength: 1000, 'aria-label': 'Адреса посилання', class: 'input topic-link-url' });
      const nameIn = ui.input({ placeholder: 'Назва (необовʼязково)', maxlength: 120, 'aria-label': 'Назва посилання', class: 'input topic-link-title' });
      const err = h('div', { class: 'topic-link-err', role: 'alert', hidden: true });
      const add = () => {
        const url = normUrl(urlIn.value);
        if (!urlIn.value.trim()) { urlIn.focus(); return; }
        if (!url) { err.textContent = 'Перевір адресу — має бути сайт, напр. https://youtube.com/…'; err.hidden = false; urlIn.focus(); return; }
        if (topicLinks(currentTopics().find((x) => x.id === t.id)).length >= MAX_LINKS) { err.textContent = `Не більше ${MAX_LINKS} посилань у темі`; err.hidden = false; return; }
        const link = { id: CRM.utils.uid(), url, title: nameIn.value.trim() };
        updTopics((list) => list.map((x) => (x.id === t.id ? Object.assign({}, x, { links: topicLinks(x).concat([link]) }) : x)), () => {
          const inp = topicsBox.querySelector(`.topic-wrap[data-topic="${t.id}"] .topic-link-url`);
          if (inp) inp.focus();
        });
      };
      const onKey = (e) => { if (e.key === 'Enter') { e.preventDefault(); add(); } };
      urlIn.addEventListener('keydown', onKey);
      nameIn.addEventListener('keydown', onKey);
      urlIn.addEventListener('input', () => { err.hidden = true; });

      return h('div', { class: 'topic-extra' },
        notes,
        h('div', { class: 'topic-links' },
          links.map((l) => h('div', { class: 'topic-link', dataset: { id: l.id } },
            CRM.icon('link', { size: 'sm' }),
            h('a', { class: 'topic-link-a', href: l.url, target: '_blank', rel: 'noopener noreferrer', title: l.url }, linkLabel(l)),
            l.title ? h('span', { class: 'topic-link-host subtle' }, hostOf(l.url)) : null,
            h('button', {
              type: 'button', class: 'btn btn-ghost btn-icon btn-sm topic-link-del', title: 'Прибрати посилання', 'aria-label': `Прибрати посилання «${linkLabel(l)}»`,
              onClick: () => updTopics((list) => list.map((x) => (x.id === t.id ? Object.assign({}, x, { links: topicLinks(x).filter((y) => y.id !== l.id) }) : x)))
            }, CRM.icon('x', { size: 'sm' })))),
          h('div', { class: 'topic-link-add' }, urlIn, nameIn,
            ui.button({ label: 'Додати', icon: 'plus', size: 'sm', className: 'topic-link-btn', onClick: add })),
          err));
    }

    function renderTopics() {
      const list = currentTopics();
      const done = list.filter((t) => t.done).length;
      noteSavers.clear();
      rows.clear();
      ui.mount(topicsHead,
        h('h3', null, CRM.icon('listChecks', { size: 'sm' }), 'Теми'),
        list.length ? h('span', { class: 'subtle num' }, `${done} з ${list.length}`) : null);
      const allDone = list.length && done === list.length && (st.status || 'active') === 'active' && !isNew;
      ui.mount(topicsBox,
        list.length ? h('div', { class: 'progress' }, h('div', { class: 'progress-bar', style: { width: (done / list.length * 100) + '%' } })) : null,
        list.map((t) => {
          const open = expanded.has(t.id);
          const text = h('input', { class: 'check-text' + (t.done ? ' done' : ''), value: t.title, maxlength: 150, 'aria-label': 'Назва теми' });
          text.addEventListener('change', () => {
            const v = text.value.trim();
            if (!v) { text.value = t.title; return; }
            updTopics(mapTopic(t.id, { title: v }));
          });
          text.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); text.blur(); } });
          const dl = ui.dateInput({
            value: t.deadline, placeholder: 'дедлайн', ariaLabel: 'Дедлайн теми',
            onChange: (d) => updTopics(mapTopic(t.id, { deadline: d || null }))
          });
          dl.classList.add('topic-date');
          if (t.deadline && !t.done) { const lb = dueLabel(t.deadline); if (lb.cls) dl.classList.add(lb.cls); }
          const badgeBox = h('button', {
            type: 'button', class: 'topic-badges', tabIndex: -1, 'aria-hidden': 'true', onClick: () => toggleTopic(t.id)
          }, badges(t));
          const wrap = h('div', { class: 'topic-wrap' + (open ? ' open' : '') + (hasMeta(t) ? ' has-meta' : ''), dataset: { topic: t.id } },
            h('div', { class: 'check-item topic-item' },
              h('button', {
                type: 'button', class: 'btn btn-ghost btn-icon btn-sm topic-more', 'aria-expanded': open ? 'true' : 'false',
                title: open ? 'Згорнути' : 'Нотатки й посилання', 'aria-label': `${open ? 'Згорнути' : 'Нотатки й посилання'}: ${t.title}`,
                onClick: () => toggleTopic(t.id)
              }, CRM.icon('chevronRight', { size: 'sm' })),
              h('button', {
                type: 'button', class: 'task-check small' + (t.done ? ' checked' : ''), role: 'checkbox', 'aria-checked': t.done ? 'true' : 'false',
                'aria-label': t.done ? 'Зняти позначку' : 'Позначити тему вивченою',
                onClick: () => updTopics(mapTopic(t.id, { done: !t.done }))
              }, CRM.icon('check', { size: 'sm' })),
              text,
              // Значки й дедлайн; на телефоні — другим рядком під назвою (див. CSS)
              h('span', { class: 'topic-meta' }, badgeBox, dl),
              h('button', {
                type: 'button', class: 'btn btn-ghost btn-icon btn-sm check-del', title: 'Видалити тему', 'aria-label': 'Видалити тему',
                onClick: () => updTopics((l) => l.filter((x) => x.id !== t.id))
              }, CRM.icon('x', { size: 'sm' }))),
            open ? extraOf(t) : null);
          rows.set(t.id, { badges: badgeBox, wrap });
          return wrap;
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
      noteSavers.forEach((f) => f.flush());
      await topicQueue;
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
      noteSavers.forEach((f) => f.flush());
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
        h('div', { class: 'editor-label' }, CRM.icon('palette', { size: 'sm' }), 'Колір'), h('div', { class: 'editor-value' }, sw),
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
        if (!isNew) { saveTitle.flush(); saveNotes.flush(); saveLink.flush(); noteSavers.forEach((f) => f.flush()); return true; }
        const hasInput = titleIn.value.trim() || notesIn.value.trim() || st.topics.length;
        if (!hasInput) return true;
        ui.confirm({ title: 'Не створювати курс?', message: 'Введені дані не збережуться.', confirmText: 'Не створювати', cancelText: 'Повернутися', danger: true })
          .then((ok) => { if (ok) dlg.close('force'); });
        return false;
      }
    });
    dlg.el.classList.add('task-drawer', 'course-drawer');
    requestAnimationFrame(() => {
      titleIn.style.height = 'auto'; titleIn.style.height = titleIn.scrollHeight + 2 + 'px';
      // Відкрито з Календаря / пошуку — показати потрібну тему
      if (o.topic) {
        const wrap = topicsBox.querySelector(`.topic-wrap[data-topic="${o.topic}"]`);
        if (wrap) {
          wrap.scrollIntoView({ block: 'center' });
          wrap.classList.add('topic-hl');
          setTimeout(() => wrap.classList.remove('topic-hl'), 2200);
        }
      }
    });
    return dlg;
  }

  // ---------- Розклад на Головній ----------
  CRM.home.addScheduleSource((date) => deadlines(date, date).map((d) => ({
    time: null, kind: 'learning', icon: 'graduation', cls: 'ico-learning',
    title: d.topic ? d.topic.title : `Дедлайн: ${d.course.title}`,
    sub: d.topic ? `Навчання · ${d.course.title}` : 'Навчання · дедлайн курсу',
    onClick: () => { CRM.router.go('learning', d.topic ? { open: d.course.id, topic: d.topic.id } : { open: d.course.id }); }
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
  CRM.learning = {
    COLORS, openCourse, deadlines, progress, calendarItems, setTopicDone, moveDeadline,
    colorId, colorOf, topicLinks, hasNotes, normUrl, hostOf, linkLabel
  };
})(window.CRM);
