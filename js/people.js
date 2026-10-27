/* ==========================================================================
   people.js — розділ «Люди»: контакти, дні народження й інші важливі дати
   (щороку — у «Календарі» шаром «Дні народження й дати» і на Головній,
   нагадування за 7 днів і в день), ідеї подарунків, «давно не спілкувались»
   (частота + кнопка «Поспілкувались»), імпорт контактів з файлу .vcf.
   Дані — лише в браузері й синхронізації (сховище people), не в коді.

   Людина: { id, name, group, bday: 'ММ-ДД'|null, bdayYear: рік|null, phone, telegram, instagram, email, notes,
             dates: [{ id, title, md: 'ММ-ДД', year|null }], gifts: [{ id, text, done, doneAt }],
             freq: null|7|14|30|90|180 (днів), lastContact: 'РРРР-ММ-ДД'|null }
   Ключі нагадувань: people:soon:<id>:<bday|id дати>:<дата>, people:today:…, people:contact:<id>:<дата, коли настав час>
   ========================================================================== */
window.CRM = window.CRM || {};

(function (CRM) {
  'use strict';

  const { h, ui } = { h: CRM.ui.h, ui: CRM.ui };
  const D = CRM.date;
  const U = CRM.utils;
  const fmt = CRM.fmt;

  const GROUPS = [
    { id: 'family', label: 'Сімʼя', color: 'red' },
    { id: 'friends', label: 'Друзі', color: 'blue' },
    { id: 'work', label: 'Робота', color: 'orange' },
    { id: 'study', label: 'Навчання', color: 'violet' },
    { id: 'other', label: 'Інше', color: 'slate' }
  ];
  const FREQS = [
    { v: null, label: 'Не нагадувати' },
    { v: 7, label: 'Щотижня' },
    { v: 14, label: 'Раз на 2 тижні' },
    { v: 30, label: 'Щомісяця' },
    { v: 90, label: 'Раз на 3 місяці' },
    { v: 180, label: 'Раз на пів року' }
  ];
  const SOON_DAYS = 7;    // нагадування — за тиждень
  const HOME_DAYS = 14;   // Головна — найближчі 2 тижні
  const PAGE_DAYS = 30;   // сторінка «Люди» — найближчий місяць
  const SORTS = [{ id: 'name', label: 'За імʼям' }, { id: 'bday', label: 'За днем народження' }, { id: 'contact', label: 'Давно не спілкувались' }];

  // ---------- Дані ----------
  const list = () => CRM.store.list('people').slice().sort((a, b) => (a.name || '').localeCompare(b.name || '', 'uk'));
  const get = (id) => { const p = CRM.store.get('people', id); return p && !p.deletedAt ? p : null; };
  const groupOf = (id) => GROUPS.find((g) => g.id === id) || GROUPS[GROUPS.length - 1];
  const groupColor = (id) => CRM.dict.categoryColor(groupOf(id).color);
  const freqLabel = (v) => (FREQS.find((f) => f.v === v) || FREQS[0]).label;
  const openGifts = (p) => (p.gifts || []).filter((g) => g && g.text && !g.done);

  function canSave() {
    if (CRM.db.SCHEMA.people) return true;
    ui.toast('Браузер показує стару версію сайту з кешу — онови сторінку (Ctrl+F5), щоб додавати людей.', { type: 'error', duration: 9000 });
    return false;
  }
  async function save(rec) {
    const saved = await CRM.store.save('people', rec);
    CRM.notify.runRules();
    return saved;
  }

  // ---------- Річні дати ----------
  function validMd(md) {
    const m = /^(\d\d)-(\d\d)$/.exec(md || '');
    if (!m) return false;
    const mm = Number(m[1]);
    const dd = Number(m[2]);
    return mm >= 1 && mm <= 12 && dd >= 1 && dd <= D.daysInMonth(2024, mm);
  }
  const mdOf = (m, d) => D.pad(m) + '-' + D.pad(d);
  /** 'ММ-ДД' у році y (29 лютого в невисокосний рік → 28-ме). */
  function inYear(md, y) {
    const mm = Number(md.slice(0, 2));
    return D.make(y, mm, Math.min(Number(md.slice(3)), D.daysInMonth(y, mm)));
  }
  /** Найближча дата не раніше from. */
  function nextOf(md, from) {
    const y = D.parse(from).y;
    const a = inYear(md, y);
    return a >= from ? a : inYear(md, y + 1);
  }
  function mdText(md, year) {
    return `${Number(md.slice(3))} ${CRM.MONTHS_GEN[Number(md.slice(0, 2)) - 1]}` + (year ? ` ${year}` : '');
  }
  function dayShort(d) { return `${CRM.WEEKDAYS_SHORT[D.weekday(d)]}, ${fmt.dateShort(d)}`; }
  function inDays(d) {
    const n = D.diffDays(D.today(), d);
    if (n === 0) return 'сьогодні';
    if (n === 1) return 'завтра';
    if (n === -1) return 'вчора';
    return n > 0 ? 'через ' + fmt.count(n, ['день', 'дні', 'днів']) : fmt.count(-n, ['день', 'дні', 'днів']) + ' тому';
  }
  /** День народження й інші важливі дати людини. */
  function annual(p) {
    const out = [];
    if (p.bday && validMd(p.bday)) out.push({ id: 'bday', kind: 'birthday', title: 'День народження', md: p.bday, year: p.bdayYear || null });
    (p.dates || []).forEach((x) => {
      if (x && validMd(x.md)) out.push({ id: x.id, kind: 'date', title: (x.title || '').trim() || 'Важлива дата', md: x.md, year: x.year || null });
    });
    return out;
  }
  function entry(p, a, d) {
    const n = a.year ? D.parse(d).y - a.year : null;
    let yrs = '';
    if (n != null && n >= 0) {
      if (a.kind === 'birthday') yrs = d < D.today() ? `виповнилося ${n}` : `виповнюється ${n}`;
      else if (n > 0) yrs = fmt.count(n, ['рік', 'роки', 'років']);
    }
    return {
      key: p.id + ':' + a.id + ':' + d, person: p, personId: p.id, ann: a, kind: a.kind, date: d, years: n, yearsText: yrs,
      title: a.kind === 'birthday' ? `День народження: ${p.name}` : `${a.title}: ${p.name}`, gifts: openGifts(p).length
    };
  }
  /** Усі дні народження й дати від from до to (включно). */
  function datesBetween(from, to) {
    const out = [];
    const y0 = D.parse(from).y;
    const y1 = D.parse(to).y;
    list().forEach((p) => annual(p).forEach((a) => {
      for (let y = y0; y <= y1; y++) {
        if (a.year && y < a.year) continue;
        const d = inYear(a.md, y);
        if (d >= from && d <= to) out.push(entry(p, a, d));
      }
    }));
    return out.sort((x, y) => x.date.localeCompare(y.date) || (x.kind === 'birthday' ? -1 : 1) - (y.kind === 'birthday' ? -1 : 1) || x.person.name.localeCompare(y.person.name, 'uk'));
  }
  function upcoming(days) { const T = D.today(); return datesBetween(T, D.addDays(T, days)); }
  /** Найближча річна дата людини (для списку й сортування). */
  function nextAnnual(p) {
    const T = D.today();
    let best = null;
    annual(p).forEach((a) => {
      const d = nextOf(a.md, T);
      if (!best || d < best.date || (d === best.date && a.kind === 'birthday')) best = entry(p, a, d);
    });
    return best;
  }

  // ---------- «Давно не спілкувались» ----------
  function contactInfo(p) {
    if (!p.freq) return null;
    const T = D.today();
    const base = p.lastContact || (p.createdAt ? D.toKyivDate(p.createdAt) : T);
    const due = D.addDays(base, p.freq);
    return { base, due, overdue: due <= T, since: p.lastContact ? D.diffDays(p.lastContact, T) : null };
  }
  function lastText(p) {
    if (!p.lastContact) return 'ще не позначено, коли спілкувались';
    const n = D.diffDays(p.lastContact, D.today());
    if (n <= 0) return 'спілкувались сьогодні';
    if (n === 1) return 'спілкувались учора';
    return `спілкувались ${fmt.count(n, ['день', 'дні', 'днів'])} тому`;
  }
  function dueContacts() {
    return list().map((p) => ({ p, c: contactInfo(p) })).filter((x) => x.c && x.c.overdue)
      .sort((a, b) => a.c.due.localeCompare(b.c.due) || a.p.name.localeCompare(b.p.name, 'uk'));
  }
  async function markContacted(id) {
    const p = get(id);
    if (!p || !canSave()) return;
    const before = p.lastContact || null;
    await save(Object.assign({}, p, { lastContact: D.today() }));
    ui.toast(`Позначено: поспілкувались з ${p.name} сьогодні`, {
      type: 'success',
      action: { label: 'Скасувати', onClick: () => { const cur = get(id); if (cur) save(Object.assign({}, cur, { lastContact: before })); } }
    });
  }

  // ---------- Посилання ----------
  function tgUser(s) { return String(s || '').trim().replace(/^https?:\/\/(www\.)?(t\.me|telegram\.me)\//i, '').replace(/^@/, '').replace(/[/?#].*$/, '').replace(/[^A-Za-z0-9_]/g, ''); }
  function igUser(s) { return String(s || '').trim().replace(/^https?:\/\/(www\.)?instagram\.com\//i, '').replace(/^@/, '').replace(/[/?#].*$/, '').replace(/[^A-Za-z0-9_.]/g, ''); }
  function telHref(phone) { const d = String(phone || '').replace(/[^\d+]/g, ''); return d.length >= 5 ? 'tel:' + d : null; }
  /** Як написати: Telegram, інакше — подзвонити. */
  function writeLink(p) {
    if (tgUser(p.telegram)) return { href: 'https://t.me/' + tgUser(p.telegram), label: 'Telegram' };
    const t = telHref(p.phone);
    return t ? { href: t, label: 'Подзвонити' } : null;
  }
  function avatar(p, big) {
    return h('span', { class: 'avatar ppl-avatar' + (big ? ' avatar-lg' : ''), style: { background: groupColor(p.group) }, 'aria-hidden': 'true' }, U.initials(p.name || '?') || '?');
  }

  // ---------- Рядки ----------
  function giftBadge(n) {
    return n ? h('span', { class: 'ppl-gift', title: 'Ідеї подарунків' }, CRM.icon('gift', { size: 'sm' }), String(n)) : null;
  }
  /** Рядок найближчої дати: число й місяць, хто, скільки років, ідеї подарунків. */
  function upRow(e) {
    const left = D.diffDays(D.today(), e.date);
    return h('button', { type: 'button', class: 'ppl-up-row' + (left === 0 ? ' today' : ''), onClick: () => openPerson(e.personId) },
      h('span', { class: 'ppl-up-date' }, h('b', { class: 'num' }, String(Number(e.date.slice(8)))), h('span', null, CRM.MONTHS_SHORT[Number(e.date.slice(5, 7)) - 1])),
      h('span', { class: 'ppl-up-main' },
        h('span', { class: 'ppl-up-title' }, CRM.icon(e.kind === 'birthday' ? 'cake' : 'calendar', { size: 'sm' }), e.kind === 'birthday' ? e.person.name : `${e.person.name} — ${e.ann.title}`),
        h('span', { class: 'ppl-up-sub' }, [left === 0 ? 'сьогодні' : `${inDays(e.date)} · ${dayShort(e.date)}`, e.yearsText].filter(Boolean).join(' · '))),
      giftBadge(e.gifts));
  }
  function contactBtn(p, small) {
    return ui.button({
      label: 'Поспілкувались', icon: 'chat', size: 'sm', variant: small ? 'ghost' : null, className: 'ppl-contacted',
      title: 'Позначити, що сьогодні спілкувались', onClick: (e) => { e.stopPropagation(); markContacted(p.id); }
    });
  }
  function dueRow(x) {
    const p = x.p;
    const link = writeLink(p);
    return h('div', { class: 'ppl-due-row', role: 'button', tabIndex: 0, onClick: () => openPerson(p.id),
      onKeydown: (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); openPerson(p.id); } } },
    avatar(p),
    h('span', { class: 'ppl-up-main' },
      h('span', { class: 'ppl-up-title' }, p.name),
      h('span', { class: 'ppl-up-sub' }, `${freqLabel(p.freq)} · ${lastText(p)}`)),
    h('span', { class: 'ppl-due-actions' },
      link ? h('a', { class: 'btn btn-sm btn-ghost', href: link.href, target: link.href.startsWith('http') ? '_blank' : null, rel: 'noopener', onClick: (e) => e.stopPropagation() }, CRM.icon(link.label === 'Telegram' ? 'external' : 'phone', { size: 'sm' }), h('span', { class: 'btn-label' }, link.label)) : null,
      contactBtn(p)));
  }
  function personRow(p) {
    const g = groupOf(p.group);
    const nx = nextAnnual(p);
    const c = contactInfo(p);
    const parts = [g.label];
    if (p.bday && validMd(p.bday)) {
      const age = p.bdayYear ? D.parse(nextOf(p.bday, D.today())).y - p.bdayYear : null;
      parts.push(`ДН ${mdText(p.bday)}` + (age != null && age > 0 ? ` (виповниться ${age})` : ''));
    }
    if (c) parts.push(lastText(p));
    const badges = [];
    if (nx) {
      const left = D.diffDays(D.today(), nx.date);
      if (left === 0) badges.push(h('span', { class: 'badge badge-success' }, nx.kind === 'birthday' ? 'Сьогодні ДН' : 'Сьогодні: ' + nx.ann.title));
      else if (left <= SOON_DAYS) badges.push(h('span', { class: 'badge badge-accent' }, (nx.kind === 'birthday' ? 'ДН ' : '') + inDays(nx.date)));
    }
    if (c && c.overdue) badges.push(h('span', { class: 'badge badge-warning' }, 'Час написати'));
    return h('div', { class: 'list-row ppl-row', role: 'button', tabIndex: 0, dataset: { id: p.id }, onClick: () => openPerson(p.id),
      onKeydown: (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) { e.preventDefault(); openPerson(p.id); } } },
    avatar(p),
    h('span', { class: 'list-row-main' },
      h('span', { class: 'list-row-title' }, p.name),
      h('span', { class: 'list-row-sub' }, parts.join(' · '))),
    h('span', { class: 'ppl-row-side' }, badges, giftBadge(openGifts(p).length), c ? contactBtn(p, true) : null));
  }

  // ---------- Сторінка ----------
  let query = '';
  let groupFilter = 'all';
  let sortBy = 'name';

  function sorted(arr) {
    const T = D.today();
    if (sortBy === 'bday') {
      return arr.slice().sort((a, b) => {
        const x = a.bday && validMd(a.bday) ? nextOf(a.bday, T) : '9999';
        const y = b.bday && validMd(b.bday) ? nextOf(b.bday, T) : '9999';
        return x.localeCompare(y) || a.name.localeCompare(b.name, 'uk');
      });
    }
    if (sortBy === 'contact') {
      return arr.slice().sort((a, b) => {
        const x = a.lastContact || (a.freq ? '0000' : '9999');
        const y = b.lastContact || (b.freq ? '0000' : '9999');
        return x.localeCompare(y) || a.name.localeCompare(b.name, 'uk');
      });
    }
    return arr;
  }
  function matches(p, q) {
    if (!q) return true;
    const text = U.normalize([p.name, p.phone, p.telegram, p.instagram, p.email, p.notes,
      (p.gifts || []).map((g) => g.text).join(' '), (p.dates || []).map((d) => d.title).join(' ')].filter(Boolean).join(' '));
    return U.normalize(q).split(' ').every((t) => text.includes(t));
  }

  function render(container, route) {
    const all = list();
    const fileInput = h('input', { type: 'file', accept: '.vcf,text/vcard,text/x-vcard', class: 'sr-only', tabIndex: -1, 'aria-hidden': 'true' });
    fileInput.addEventListener('change', () => { const f = fileInput.files[0]; fileInput.value = ''; if (f) importFile(f); });
    const actions = [
      ui.button({ label: 'Імпорт .vcf', icon: 'upload', className: 'ppl-import-btn', title: 'Завантажити контакти з файлу .vcf (Google Контакти, iPhone)', onClick: () => fileInput.click() }),
      ui.button({ label: 'Додати людину', icon: 'plus', variant: 'primary', className: 'ppl-add-btn', onClick: () => openPerson() }),
      fileInput
    ];
    const head = ui.pageHead({ title: 'Люди', sub: 'Дні народження, важливі дати, ідеї подарунків і з ким давно не спілкувався.', actions });

    if (!all.length) {
      ui.mount(container, head, h('section', { class: 'card' }, ui.empty({
        icon: 'users', title: 'Ще нікого немає',
        text: 'Додай людей вручну або завантаж контакти з файлу .vcf (Google Контакти → Експортувати → vCard; iPhone — «Контакти» → поділитися). Дні народження зʼявляться в Календарі й на Головній, нагадування — за тиждень і в день.',
        action: { label: 'Додати людину', icon: 'plus', onClick: () => openPerson() }
      })));
    } else {
      const up = upcoming(PAGE_DAYS);
      const due = dueContacts();
      const upCard = h('section', { class: 'card ppl-card' },
        h('div', { class: 'card-head' }, h('h2', null, CRM.icon('cake', { size: 'sm' }), 'Найближчі дні народження й дати')),
        up.length ? h('div', { class: 'ppl-up-list' }, up.slice(0, 8).map(upRow), up.length > 8 ? h('div', { class: 'more-link subtle' }, `І ще ${up.length - 8} за місяць — дивись у Календарі`) : null)
          : h('div', { class: 'card-body subtle' }, 'Найближчий місяць — без днів народження й важливих дат.'));
      const dueCard = h('section', { class: 'card ppl-card' },
        h('div', { class: 'card-head' }, h('h2', null, CRM.icon('chat', { size: 'sm' }), 'Час написати', due.length ? h('span', { class: 'tab-count' }, String(due.length)) : null)),
        due.length ? h('div', { class: 'ppl-up-list' }, due.slice(0, 8).map(dueRow))
          : h('div', { class: 'card-body subtle' }, all.some((p) => p.freq)
            ? 'Усім, кому хотів, уже написав. Коли настане час — людина зʼявиться тут.'
            : 'Вибери в картці людини, як часто хочеш спілкуватися («Щомісяця»…) — і CRM нагадає, коли давно не писав.'));

      const counts = { all: all.length };
      GROUPS.forEach((g) => { counts[g.id] = all.filter((p) => (p.group || 'other') === g.id).length; });
      const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Група' },
        [{ id: 'all', label: 'Усі' }].concat(GROUPS).filter((g) => g.id === 'all' || counts[g.id]).map((g) => h('button', {
          type: 'button', class: 'chip' + (groupFilter === g.id ? ' active' : ''), 'aria-pressed': groupFilter === g.id ? 'true' : 'false', dataset: { group: g.id },
          onClick: () => { groupFilter = g.id; CRM.router.rerender(); }
        }, `${g.label} · ${counts[g.id] || 0}`)));
      if (groupFilter !== 'all' && !counts[groupFilter]) groupFilter = 'all';
      const searchIn = ui.input({ type: 'search', class: 'input ppl-search', placeholder: 'Пошук: імʼя, телефон, нотатки…', 'aria-label': 'Пошук людей', value: query });
      const sortSel = ui.select(SORTS.map((s) => ({ value: s.id, label: s.label })), { value: sortBy, 'aria-label': 'Сортування', class: 'select ppl-sort' });
      sortSel.addEventListener('change', () => { sortBy = sortSel.value; renderList(); });
      const listBox = h('div', { class: 'card ppl-list-card' });
      function renderList() {
        const items = sorted(all.filter((p) => (groupFilter === 'all' || (p.group || 'other') === groupFilter) && matches(p, query)));
        ui.mount(listBox, items.length
          ? h('div', { class: 'list ppl-list' }, items.map(personRow))
          : ui.empty({ icon: 'search', small: true, title: 'Нікого не знайдено', text: query ? `За запитом «${query}» нікого немає.` : null }));
      }
      searchIn.addEventListener('input', () => { query = searchIn.value; renderList(); });
      renderList();
      ui.mount(container, head,
        h('div', { class: 'stack' },
          h('div', { class: 'ppl-top' }, upCard, dueCard),
          h('div', { class: 'toolbar ppl-toolbar' }, chips, h('div', { class: 'ppl-tools' }, searchIn, sortSel)),
          listBox));
    }

    const p = route && route.params;
    if (p && p.open) {
      const id = p.open;
      CRM.router.consumeParam('open');
      setTimeout(() => openPerson(id), 0);
    }
  }

  // ---------- Вибір дня й місяця (рік — необовʼязково) ----------
  function mdPicker(md, year, label, onChange) {
    const daySel = h('select', { class: 'select ppl-day', 'aria-label': label + ': число' },
      h('option', { value: '' }, 'число'), Array.from({ length: 31 }, (_, i) => h('option', { value: String(i + 1) }, String(i + 1))));
    const monSel = h('select', { class: 'select ppl-month', 'aria-label': label + ': місяць' },
      h('option', { value: '' }, 'місяць'), CRM.MONTHS_GEN.map((m, i) => h('option', { value: String(i + 1) }, m)));
    const yearIn = h('input', { class: 'input ppl-year', inputmode: 'numeric', maxlength: 4, placeholder: 'рік', 'aria-label': label + ': рік (необовʼязково)', autocomplete: 'off' });
    if (md && validMd(md)) { daySel.value = String(Number(md.slice(3))); monSel.value = String(Number(md.slice(0, 2))); }
    if (year) yearIn.value = String(year);
    const err = h('div', { class: 'ppl-md-err', role: 'alert' });
    function read() {
      const d = Number(daySel.value) || 0;
      const m = Number(monSel.value) || 0;
      const ys = yearIn.value.trim();
      let y = null;
      if (ys) {
        if (!/^\d{4}$/.test(ys) || Number(ys) < 1900 || Number(ys) > D.parse(D.today()).y) return { error: 'Рік — 4 цифри, від 1900 до поточного' };
        y = Number(ys);
      }
      if (!d && !m) return y ? { error: 'Вкажи число й місяць' } : { md: null, year: null };
      if (!d || !m) return { error: 'Вкажи і число, і місяць' };
      if (d > D.daysInMonth(y || 2024, m)) return { error: y && m === 2 && d === 29 ? `${y} — не високосний рік` : 'У цьому місяці немає такого числа' };
      return { md: mdOf(m, d), year: y };
    }
    function fire() { const r = read(); err.textContent = r.error || ''; if (!r.error) onChange(r.md, r.year); }
    daySel.addEventListener('change', fire);
    monSel.addEventListener('change', fire);
    yearIn.addEventListener('input', fire);
    return { el: h('div', { class: 'ppl-md' }, daySel, monSel, yearIn), err, read };
  }

  // ---------- Картка людини (бічна панель) ----------
  function openPerson(id, preset) {
    const cur = id ? CRM.store.get('people', id) : null;
    if (id && !cur) { ui.toast('Цієї людини більше немає', { type: 'error' }); return null; }
    if (cur && cur.deletedAt) { ui.toast('Людина в Кошику — віднови, щоб відкрити'); return null; }
    let isNew = !cur;
    const st = cur ? U.deepClone(cur) : Object.assign({
      id: U.uid(), name: '', group: 'friends', bday: null, bdayYear: null, phone: '', telegram: '', instagram: '', email: '',
      notes: '', dates: [], gifts: [], freq: null, lastContact: null
    }, preset || {});
    st.dates = Array.isArray(st.dates) ? st.dates : [];
    st.gifts = Array.isArray(st.gifts) ? st.gifts : [];

    let timer = null;
    async function persist() {
      clearTimeout(timer);
      timer = null;
      if (isNew) return;
      const now = CRM.store.get('people', st.id);
      if (!now || now.deletedAt || !st.name.trim()) return;
      await save(Object.assign({}, now, U.deepClone(st), { name: st.name.trim() }));
    }
    function changed() {
      renderInfo();
      if (isNew) return;
      clearTimeout(timer);
      timer = setTimeout(persist, 400);
    }

    // Імʼя й група
    const nameIn = ui.input({ value: st.name, maxlength: 100, placeholder: 'Імʼя, напр. Марта Коваленко', 'aria-label': 'Імʼя' });
    const fName = ui.field({ label: 'Імʼя', input: nameIn, required: true });
    nameIn.addEventListener('input', () => {
      st.name = nameIn.value;
      if (!st.name.trim()) { fName.setError('Імʼя не може бути порожнім'); return; }
      if (!isNew) dlg.setTitle(st.name.trim());
      changed();
    });
    const groupSeg = h('div', { class: 'segmented ppl-groups', role: 'radiogroup', 'aria-label': 'Група' });
    function renderGroups() {
      ui.mount(groupSeg, GROUPS.map((g) => h('button', {
        type: 'button', role: 'radio', class: g.id === st.group ? 'active' : '', 'aria-checked': g.id === st.group ? 'true' : 'false', dataset: { group: g.id },
        onClick: () => { st.group = g.id; renderGroups(); changed(); }
      }, g.label)));
    }
    renderGroups();

    // День народження
    const info = h('div', { class: 'ppl-bday-info subtle' });
    function renderInfo() {
      if (!st.bday || !validMd(st.bday)) { info.textContent = 'Рік — необовʼязково (тоді CRM знатиме, скільки років).'; return; }
      const d = nextOf(st.bday, D.today());
      const n = st.bdayYear ? D.parse(d).y - st.bdayYear : null;
      info.textContent = `Наступний: ${dayShort(d)} (${inDays(d)})` + (n != null && n > 0 ? ` — виповниться ${n}` : '');
    }
    const bday = mdPicker(st.bday, st.bdayYear, 'День народження', (md, y) => { st.bday = md; st.bdayYear = md ? y : null; changed(); });
    renderInfo();

    // Контакти
    const contactField = (key, label, ph, mode) => {
      const inp = ui.input({ value: st[key] || '', maxlength: 120, placeholder: ph, 'aria-label': label, inputmode: mode || null, dataset: { field: key } });
      inp.addEventListener('input', () => { st[key] = inp.value.trim(); changed(); });
      return ui.field({ label, input: inp });
    };

    // Спілкування
    const freqSel = h('select', { class: 'select ppl-freq', 'aria-label': 'Як часто спілкуватися' },
      FREQS.map((f) => h('option', { value: f.v == null ? '' : String(f.v), selected: f.v === (st.freq || null) }, f.label)));
    freqSel.addEventListener('change', () => { st.freq = freqSel.value ? Number(freqSel.value) : null; changed(); renderContact(); });
    const lastIn = ui.dateInput({
      value: st.lastContact, placeholder: 'Ще не позначено', ariaLabel: 'Коли востаннє спілкувались',
      onChange: (v) => {
        if (v && v > D.today()) { lastIn.dateValue = st.lastContact; ui.toast('Дата спілкування не може бути в майбутньому', { type: 'error' }); return; }
        st.lastContact = v || null;
        changed();
        renderContact();
      }
    });
    const contactNote = h('div', { class: 'ppl-contact-note subtle' });
    function renderContact() {
      const c = contactInfo(st);
      if (!st.freq) { contactNote.textContent = 'Без нагадувань. Вибери частоту — і CRM нагадає, коли давно не спілкувались.'; return; }
      contactNote.textContent = c.overdue ? `Час написати (${lastText(st)}).` : `Наступне нагадування — ${dayShort(c.due)} (${inDays(c.due)}).`;
    }
    renderContact();
    const todayBtn = ui.button({
      label: 'Сьогодні', icon: 'chat', size: 'sm', className: 'ppl-today-btn', title: 'Поспілкувались сьогодні',
      onClick: () => { st.lastContact = D.today(); lastIn.dateValue = st.lastContact; changed(); renderContact(); }
    });
    const lastWrap = h('div', { class: 'ppl-last' }, lastIn, todayBtn);

    // Ідеї подарунків
    const giftsBox = h('div', { class: 'ppl-gifts' });
    function renderGifts(focusNew) {
      const order = st.gifts.slice().sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0));
      const addIn = ui.input({ placeholder: 'Додати ідею подарунка… (Enter)', maxlength: 200, 'aria-label': 'Нова ідея подарунка', class: 'input ppl-gift-add' });
      addIn.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const v = addIn.value.trim();
        if (!v) return;
        st.gifts.push({ id: U.uid(), text: v, done: false, doneAt: null });
        changed();
        renderGifts(true);
      });
      ui.mount(giftsBox,
        order.map((g) => {
          const text = h('input', { class: 'check-text' + (g.done ? ' done' : ''), value: g.text, maxlength: 200, 'aria-label': 'Ідея подарунка' });
          text.addEventListener('change', () => { const v = text.value.trim(); if (!v) { text.value = g.text; return; } g.text = v; changed(); });
          text.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); text.blur(); } });
          return h('div', { class: 'check-item ppl-gift-item' + (g.done ? ' done' : '') },
            h('button', {
              type: 'button', class: 'task-check small' + (g.done ? ' checked' : ''), role: 'checkbox', 'aria-checked': g.done ? 'true' : 'false',
              title: g.done ? 'Подаровано — натисни, щоб повернути' : 'Позначити подарованим', 'aria-label': g.done ? 'Повернути ідею' : 'Позначити подарованим',
              onClick: () => { g.done = !g.done; g.doneAt = g.done ? D.today() : null; changed(); renderGifts(); }
            }, CRM.icon('check', { size: 'sm' })),
            text,
            g.done && g.doneAt ? h('span', { class: 'subtle ppl-gift-when' }, 'подаровано ' + fmt.dateShort(g.doneAt)) : null,
            h('button', { type: 'button', class: 'check-del', 'aria-label': 'Видалити ідею', title: 'Видалити',
              onClick: () => { st.gifts = st.gifts.filter((x) => x.id !== g.id); changed(); renderGifts(); } }, CRM.icon('x', { size: 'sm' })));
        }),
        addIn);
      if (focusNew) addIn.focus();
    }
    renderGifts();

    // Інші важливі дати
    const datesBox = h('div', { class: 'ppl-dates' });
    function renderDates() {
      ui.mount(datesBox,
        st.dates.map((x) => {
          const t = ui.input({ value: x.title || '', maxlength: 80, placeholder: 'Напр., Річниця весілля', 'aria-label': 'Назва дати', class: 'input ppl-date-title' });
          t.addEventListener('input', () => { x.title = t.value.trim(); changed(); });
          const pk = mdPicker(x.md, x.year, 'Дата', (md, y) => { x.md = md; x.year = md ? y : null; changed(); });
          return h('div', { class: 'ppl-date-row' },
            h('div', { class: 'ppl-date-line' }, t,
              h('button', { type: 'button', class: 'btn btn-ghost btn-icon btn-sm', 'aria-label': 'Видалити дату', title: 'Видалити',
                onClick: () => { st.dates = st.dates.filter((y) => y.id !== x.id); changed(); renderDates(); } }, CRM.icon('trash', { size: 'sm' }))),
            pk.el, pk.err);
        }),
        ui.button({ label: 'Додати дату', icon: 'plus', size: 'sm', className: 'ppl-add-date', onClick: () => { st.dates.push({ id: U.uid(), title: '', md: null, year: null }); renderDates(); const ins = datesBox.querySelectorAll('.ppl-date-title'); if (ins.length) ins[ins.length - 1].focus(); } }));
    }
    renderDates();

    const notesIn = ui.textarea({ value: st.notes || '', rows: 3, maxlength: 4000, placeholder: 'Що любить, про що говорили, важливе…', 'aria-label': 'Нотатки' });
    notesIn.addEventListener('input', () => { st.notes = notesIn.value; changed(); });

    const section = (icon, title, ...content) => h('section', { class: 'ppl-sec' }, h('h3', { class: 'ppl-sec-title' }, CRM.icon(icon, { size: 'sm' }), title), content);
    const body = h('div', { class: 'form-stack ppl-editor' },
      fName,
      h('div', { class: 'field' }, h('div', { class: 'field-label' }, 'Група'), groupSeg),
      section('cake', 'День народження', bday.el, bday.err, info),
      section('phone', 'Контакти', h('div', { class: 'form-grid' },
        contactField('phone', 'Телефон', '+380…', 'tel'), contactField('telegram', 'Telegram', '@username'),
        contactField('instagram', 'Instagram', '@username'), contactField('email', 'Email', 'name@example.com', 'email'))),
      section('chat', 'Спілкування', ui.field({ label: 'Як часто хочу спілкуватися', input: freqSel }),
        h('div', { class: 'field' }, h('div', { class: 'field-label' }, 'Востаннє спілкувались'), lastWrap), contactNote),
      section('gift', 'Ідеї подарунків', giftsBox),
      section('calendar', 'Інші важливі дати', h('p', { class: 'subtle ppl-hint' }, 'Річниця, іменини тощо — щороку в Календарі з нагадуванням за тиждень і в день.'), datesBox),
      section('pencil', 'Нотатки', notesIn));

    const footer = h('div', { class: 'ppl-foot' });
    function renderFooter() {
      if (isNew) {
        ui.mount(footer, h('span', { class: 'grow' }),
          ui.button({ label: 'Скасувати', onClick: () => dlg.close('button') }),
          ui.button({ label: 'Додати', variant: 'primary', className: 'ppl-create', onClick: create }));
        return;
      }
      ui.mount(footer,
        ui.button({ label: 'Видалити', icon: 'trash', variant: 'danger-ghost', className: 'ppl-delete', onClick: remove }),
        h('span', { class: 'grow' }),
        h('span', { class: 'subtle ppl-autosave' }, 'Зміни зберігаються автоматично'));
    }
    function validate() {
      let ok = true;
      if (!st.name.trim()) { fName.setError('Вкажи імʼя'); ok = false; }
      const r = bday.read();
      if (r.error) { bday.err.textContent = r.error; ok = false; }
      return ok;
    }
    async function create() {
      if (!validate()) { nameIn.focus(); return; }
      if (!canSave()) return;
      st.name = st.name.trim();
      await save(U.deepClone(st));
      isNew = false;
      dlg.setTitle(st.name);
      renderFooter();
      ui.toast(`Додано: ${st.name}`, { type: 'success' });
    }
    async function remove() {
      const ok = await ui.confirm({
        title: 'Видалити людину?', message: `«${st.name}» перейде в Кошик — відновити можна протягом 30 днів.`, confirmText: 'Видалити', danger: true
      });
      if (!ok) return;
      clearTimeout(timer);
      timer = null;
      await persist();
      dlg.close('force');
      const batch = await CRM.store.softDelete('people', st.id);
      ui.toast(`${st.name} — у Кошику`, { action: { label: 'Скасувати', onClick: () => CRM.store.restoreBatch(batch) } });
    }
    renderFooter();

    const dlg = ui.drawer({
      title: isNew ? 'Нова людина' : st.name, body, footer, className: 'ppl-drawer',
      onClose: () => { if (timer) persist(); }
    });
    if (isNew) setTimeout(() => nameIn.focus(), 0);
    return dlg;
  }
  function openPage(id) { CRM.router.go('people', id ? { open: id } : null); }

  // ---------- Імпорт з .vcf (vCard 2.1 / 3.0 / 4.0) ----------
  function qpDecode(s) {
    const bytes = [];
    for (let i = 0; i < s.length; i++) {
      if (s[i] === '=' && /^[0-9A-Fa-f]{2}$/.test(s.substr(i + 1, 2))) { bytes.push(parseInt(s.substr(i + 1, 2), 16)); i += 2; }
      else bytes.push(s.charCodeAt(i) & 0xff);
    }
    try { return new TextDecoder('utf-8').decode(new Uint8Array(bytes)); } catch (e) { return s; }
  }
  const unescapeV = (s) => String(s).replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
  /** Дата з vCard: 1999-03-15, 19990315, --03-15, --0315 (+ рік 1604 чи X-APPLE-OMIT-YEAR — без року). */
  function vDate(v, params) {
    const s = String(v || '').trim();
    let m = /^(\d{4})-?(\d{2})-?(\d{2})/.exec(s);
    let y = null;
    let mm;
    let dd;
    if (m) { y = Number(m[1]); mm = Number(m[2]); dd = Number(m[3]); }
    else if ((m = /^--(\d{2})-?(\d{2})/.exec(s))) { mm = Number(m[1]); dd = Number(m[2]); }
    else return null;
    if (params['X-APPLE-OMIT-YEAR'] || y === 1604 || (y && (y < 1900 || y > D.parse(D.today()).y))) y = null;
    if (!(mm >= 1 && mm <= 12 && dd >= 1 && dd <= D.daysInMonth(y || 2024, mm))) return null;
    return { md: mdOf(mm, dd), year: y };
  }
  function abLabel(l) {
    const s = String(l || '').replace(/^_\$!<|>!\$_$/g, '');
    if (/anniversary/i.test(s)) return 'Річниця';
    if (!s || /^other$/i.test(s)) return 'Важлива дата';
    return s;
  }
  /** Розібрати текст .vcf → [{ name, phone, email, telegram, instagram, bday, bdayYear, dates, notes }]. */
  function parseVcf(text) {
    const raw = String(text || '').replace(/^﻿/, '').replace(/\r\n?/g, '\n').split('\n');
    const lines = [];
    raw.forEach((l) => {
      const last = lines.length ? lines[lines.length - 1] : null;
      if (last != null && /^[ \t]/.test(l)) lines[lines.length - 1] = last + l.slice(1);
      else if (last != null && /QUOTED-PRINTABLE/i.test(last.split(':')[0]) && /=$/.test(last)) lines[lines.length - 1] = last.slice(0, -1) + l;
      else lines.push(l);
    });
    const out = [];
    let card = null;
    lines.forEach((line) => {
      if (/^BEGIN:VCARD/i.test(line)) { card = { props: [] }; return; }
      if (/^END:VCARD/i.test(line)) { if (card) out.push(card); card = null; return; }
      if (!card) return;
      const i = line.indexOf(':');
      if (i < 0) return;
      const headPart = line.slice(0, i);
      let value = line.slice(i + 1);
      const parts = headPart.split(';');
      let name = parts[0];
      let group = null;
      const dot = name.indexOf('.');
      if (dot >= 0) { group = name.slice(0, dot).toLowerCase(); name = name.slice(dot + 1); }
      const params = {};
      parts.slice(1).forEach((p) => {
        const eq = p.indexOf('=');
        const k = eq < 0 ? 'TYPE' : p.slice(0, eq).toUpperCase();
        const v = eq < 0 ? p : p.slice(eq + 1);
        params[k] = params[k] ? params[k] + ',' + v.toLowerCase() : v.toLowerCase();
      });
      if (/quoted-printable/i.test(params.ENCODING || '')) value = qpDecode(value);
      card.props.push({ name: name.toUpperCase(), group, params, value: unescapeV(value) });
    });
    return out.map((c) => {
      const P = (n) => c.props.filter((p) => p.name === n);
      const first = (n) => { const x = P(n)[0]; return x ? x.value.trim() : ''; };
      let name = first('FN');
      if (!name) {
        const n = first('N').split(';');
        name = [n[1], n[2], n[0]].filter((x) => x && x.trim()).join(' ').trim();
      }
      if (!name) name = first('ORG').split(';')[0].trim();
      const tels = P('TEL');
      const tel = (tels.find((t) => /cell|mobile/.test(t.params.TYPE || '')) || tels[0] || {}).value || '';
      const b = P('BDAY')[0];
      const bd = b ? vDate(b.value, b.params) : null;
      const dates = [];
      P('ANNIVERSARY').concat(P('X-ANNIVERSARY')).forEach((a) => { const d = vDate(a.value, a.params); if (d) dates.push({ id: U.uid(), title: 'Річниця', md: d.md, year: d.year }); });
      P('X-ABDATE').forEach((a) => {
        const d = vDate(a.value, a.params);
        if (!d) return;
        const lbl = c.props.find((p) => p.name === 'X-ABLABEL' && p.group && p.group === a.group);
        dates.push({ id: U.uid(), title: abLabel(lbl ? lbl.value : ''), md: d.md, year: d.year });
      });
      const links = c.props.filter((p) => ['X-SOCIALPROFILE', 'IMPP', 'URL'].includes(p.name));
      const find = (re, typeRe) => {
        const x = links.find((p) => re.test(p.value) || typeRe.test(p.params.TYPE || '') || typeRe.test(p.params['X-SERVICE-TYPE'] || ''));
        return x ? x.value : '';
      };
      const tg = find(/t\.me\/|telegram/i, /telegram/);
      const ig = find(/instagram\.com/i, /instagram/);
      return {
        name: name.replace(/\s+/g, ' ').trim(), phone: tel.trim(), email: first('EMAIL'),
        telegram: tg ? '@' + tgUser(tg.replace(/^x-apple:|^telegram:/i, '')) : '', instagram: ig ? '@' + igUser(ig) : '',
        bday: bd ? bd.md : null, bdayYear: bd ? bd.year : null, dates, notes: first('NOTE')
      };
    }).filter((x) => x.name).map((x) => Object.assign(x, { telegram: x.telegram === '@' ? '' : x.telegram, instagram: x.instagram === '@' ? '' : x.instagram }));
  }

  async function importFile(file) {
    if (!canSave()) return;
    if (file.size > 10 * 1024 * 1024) { ui.toast('Файл завеликий (більше 10 МБ).', { type: 'error' }); return; }
    let text = '';
    try { text = await U.readFileAsText(file); } catch (e) { ui.toast('Не вдалося прочитати файл.', { type: 'error' }); return; }
    const cards = parseVcf(text);
    if (!cards.length) { ui.toast('У файлі не знайдено контактів. Потрібен файл .vcf (vCard) — напр., Google Контакти → «Експортувати» → vCard.', { type: 'error', duration: 9000 }); return; }
    openImport(cards, file.name);
  }

  function openImport(cards, fileName) {
    const existing = new Map(list().map((p) => [U.normalize(p.name), p]));
    const rows = cards.map((c, i) => ({ i, c, dup: existing.get(U.normalize(c.name)) || null, on: false }));
    rows.forEach((r) => { r.on = !!(r.c.bday && !r.dup); });
    const withBday = rows.filter((r) => r.c.bday).length;
    let group = 'friends';
    let q = '';
    const listEl = h('div', { class: 'ppl-imp-list' });
    const countEl = h('span');
    const goBtn = ui.button({ label: 'Додати', variant: 'primary', className: 'ppl-imp-go', onClick: run });
    function updateCount() {
      const n = rows.filter((r) => r.on).length;
      countEl.textContent = `Вибрано: ${n}`;
      goBtn.querySelector('.btn-label').textContent = n ? `Додати ${n}` : 'Додати';
      goBtn.disabled = !n;
    }
    function renderRows() {
      const vis = rows.filter((r) => !q || U.normalize(r.c.name).includes(U.normalize(q)));
      ui.mount(listEl, vis.length ? vis.map((r) => {
        const sub = [r.c.bday ? 'ДН ' + mdText(r.c.bday, r.c.bdayYear) : 'без дня народження', r.c.phone, r.c.dates.length ? `ще дат: ${r.c.dates.length}` : null].filter(Boolean).join(' · ');
        const box = h('input', { type: 'checkbox', checked: r.on, 'aria-label': r.c.name });
        box.addEventListener('change', () => { r.on = box.checked; updateCount(); });
        return h('label', { class: 'ppl-imp-row' + (r.dup ? ' dup' : '') },
          box,
          h('span', { class: 'ppl-up-main' }, h('span', { class: 'ppl-up-title' }, r.c.name), h('span', { class: 'ppl-up-sub' }, sub)),
          r.dup ? h('span', { class: 'badge', title: 'Така людина вже є — доповнимо порожні поля' }, 'уже є — доповнити') : null);
      }) : h('div', { class: 'subtle ppl-imp-none' }, 'Нікого не знайдено.'));
      updateCount();
    }
    const pick = (fn) => { rows.forEach((r) => { r.on = fn(r); }); renderRows(); };
    const search = ui.input({ type: 'search', placeholder: 'Пошук у файлі…', 'aria-label': 'Пошук у файлі', class: 'input ppl-imp-search' });
    search.addEventListener('input', () => { q = search.value; renderRows(); });
    const groupSel = ui.select(GROUPS.map((g) => ({ value: g.id, label: g.label })), { value: group, 'aria-label': 'Група для нових', class: 'select ppl-imp-group' });
    groupSel.addEventListener('change', () => { group = groupSel.value; });
    const body = h('div', { class: 'stack ppl-imp' },
      h('p', { class: 'modal-text' }, `У файлі «${fileName}» — ${fmt.count(cards.length, ['контакт', 'контакти', 'контактів'])}, з днем народження — ${withBday}. Вибери, кого додати (за замовчуванням — з днем народження). Дані лишаються лише в цьому браузері й твоїй синхронізації.`),
      h('div', { class: 'ppl-imp-tools' },
        h('div', { class: 'btn-row' },
          ui.button({ label: 'З днем народження', size: 'sm', onClick: () => pick((r) => !!r.c.bday && !r.dup) }),
          ui.button({ label: 'Усі', size: 'sm', onClick: () => pick(() => true) }),
          ui.button({ label: 'Нікого', size: 'sm', onClick: () => pick(() => false) })),
        search),
      listEl,
      h('div', { class: 'ppl-imp-foot' }, ui.field({ label: 'Група для нових', input: groupSel }), h('span', { class: 'subtle' }, countEl)));
    const dlg = ui.modal({ title: 'Імпорт контактів', size: 'lg', className: 'ppl-imp-modal', body, footer: [ui.button({ label: 'Скасувати', onClick: () => dlg.close('button') }), goBtn] });
    renderRows();

    async function run() {
      const chosen = rows.filter((r) => r.on);
      if (!chosen.length) return;
      const created = [];
      const updated = [];
      const seen = new Map();
      chosen.forEach((r) => {
        const c = r.c;
        const key = U.normalize(c.name);
        const base = seen.get(key) || r.dup;
        if (base) {
          const u = U.deepClone(base);
          ['phone', 'email', 'telegram', 'instagram'].forEach((k) => { if (!u[k] && c[k]) u[k] = c[k]; });
          if (!u.bday && c.bday) { u.bday = c.bday; u.bdayYear = c.bdayYear; }
          if (c.notes && !(u.notes || '').includes(c.notes)) u.notes = [u.notes, c.notes].filter(Boolean).join('\n');
          const have = new Set((u.dates || []).map((d) => d.md + '|' + d.title));
          u.dates = (u.dates || []).concat(c.dates.filter((d) => !have.has(d.md + '|' + d.title)));
          if (r.dup) updated.push(u); else created[created.indexOf(base)] = u;
          seen.set(key, u);
          return;
        }
        const rec = {
          id: U.uid(), name: c.name, group, bday: c.bday, bdayYear: c.bdayYear, phone: c.phone, telegram: c.telegram, instagram: c.instagram,
          email: c.email, notes: c.notes, dates: c.dates, gifts: [], freq: null, lastContact: null, source: 'vcf'
        };
        created.push(rec);
        seen.set(key, rec);
      });
      dlg.close('force');
      if (created.length) await CRM.store.saveMany('people', created);
      if (updated.length) await CRM.store.saveMany('people', updated);
      CRM.notify.runRules();
      ui.toast(`Додано: ${created.length}` + (updated.length ? `, доповнено: ${updated.length}` : ''), { type: 'success' });
    }
  }

  // ---------- Головна ----------
  function homeCard() {
    const ppl = list();
    const head = h('div', { class: 'card-head' },
      h('h2', null, 'Люди'),
      h('div', { class: 'btn-row' },
        ui.button({ icon: 'plus', iconOnly: true, size: 'sm', variant: 'ghost', title: 'Додати людину', onClick: () => openPerson() }),
        ppl.length ? h('a', { href: '#/people', class: 'btn btn-ghost btn-sm' }, 'Усі люди', CRM.icon('chevronRight', { size: 'sm' })) : null));
    if (!ppl.length) {
      return h('section', { class: 'card ppl-home' }, head, ui.empty({
        icon: 'cake', small: true, title: 'Дні народження й «час написати»',
        text: 'Додай людей — тут зʼявляться найближчі дні народження й кому давно не писав.',
        action: { label: 'Додати людину', icon: 'plus', onClick: () => openPerson() }
      }));
    }
    const up = upcoming(HOME_DAYS);
    const due = dueContacts();
    let upPart;
    if (up.length) upPart = h('div', { class: 'ppl-up-list' }, up.slice(0, 4).map(upRow));
    else {
      const next = ppl.map(nextAnnual).filter(Boolean).sort((a, b) => a.date.localeCompare(b.date))[0];
      upPart = h('div', { class: 'card-body subtle ppl-home-none' }, 'Найближчі 2 тижні — без днів народження.' + (next ? ` Наступний: ${next.person.name} — ${dayShort(next.date)}.` : ''));
    }
    return h('section', { class: 'card ppl-home' }, head,
      h('div', { class: 'ppl-home-sub' }, CRM.icon('cake', { size: 'sm' }), 'Найближчі дні народження'), upPart,
      due.length ? [h('div', { class: 'ppl-home-sub' }, CRM.icon('chat', { size: 'sm' }), 'Час написати'), h('div', { class: 'ppl-up-list' }, due.slice(0, 3).map(dueRow)),
        due.length > 3 ? h('a', { href: '#/people', class: 'more-link' }, `Ще ${due.length - 3} — відкрити «Люди»`) : null] : null);
  }

  // ---------- Реєстрація ----------
  CRM.router.register('people', { title: 'Люди', stores: ['people'], render });

  // Розклад на сьогодні (Головна): дні народження й дати
  if (CRM.home && CRM.home.addScheduleSource) {
    CRM.home.addScheduleSource((T) => datesBetween(T, T).map((e) => ({
      time: null, kind: 'people', icon: 'cake', cls: 'ico-goal', title: e.title,
      sub: [e.yearsText, e.gifts ? `ідей подарунків: ${e.gifts}` : null].filter(Boolean).join(' · ') || 'Люди',
      onClick: () => openPerson(e.personId)
    })));
  }

  // Нагадування: за 7 днів (або ближче, якщо CRM відкрили пізніше) і в день; «час написати»
  CRM.notify.addRule(() => {
    const out = [];
    const T = D.today();
    upcoming(SOON_DAYS).forEach((e) => {
      const left = D.diffDays(T, e.date);
      const name = e.person.name;
      const what = e.kind === 'birthday' ? `день народження: ${name}` : `${e.ann.title} — ${name}`;
      const gifts = e.gifts ? `ідей подарунків: ${e.gifts}` : null;
      const target = { store: 'people', id: e.personId };
      if (left === 0) {
        out.push({ key: `people:today:${e.personId}:${e.ann.id}:${e.date}`, kind: 'people', title: `Сьогодні ${what}`, text: [e.yearsText, gifts].filter(Boolean).join(' · '), target });
      } else {
        const when = left === 1 ? 'Завтра' : `Через ${fmt.count(left, ['день', 'дні', 'днів'])}`;
        out.push({ key: `people:soon:${e.personId}:${e.ann.id}:${e.date}`, kind: 'people', title: `${when} ${what}`, text: [dayShort(e.date), e.yearsText, gifts].filter(Boolean).join(' · '), target });
      }
    });
    dueContacts().forEach(({ p, c }) => {
      out.push({
        key: `people:contact:${p.id}:${c.due}`, kind: 'people', title: `Час написати: ${p.name}`,
        text: c.since != null ? `Востаннє спілкувались ${fmt.count(c.since, ['день', 'дні', 'днів'])} тому · ${freqLabel(p.freq).toLowerCase()}` : `Хочеш спілкуватися ${freqLabel(p.freq).toLowerCase()}`,
        target: { store: 'people', id: p.id }
      });
    });
    return out;
  });

  // ---------- Імена у відмінках (для ⚡: «ДР Марти 5 листопада», «написав Марті») ----------
  // Прості правила української відміни + список поширених імен (щоб «Марти» → «Марта», «Андрія» → «Андрій»).
  const COMMON_NAMES = ('Марта Марія Олена Ольга Оля Анна Аня Ганна Галина Галя Катерина Катя Ірина Іра Наталія Наталя Наташа ' +
    'Тетяна Таня Юлія Юля Оксана Світлана Софія Соня Анастасія Настя Дарина Дарія Даша Вікторія Віка Христина Соломія Надія Надя ' +
    'Людмила Люда Валентина Віра Любов Люба Лілія Ліля Алла Яна Діана Аліна Ангеліна Єва Злата Мирослава Ярослава Богдана Зоряна ' +
    "Уляна Василина Роксолана Марічка Емілія Поліна Олександра Валерія Інна Леся Лариса Маргарита Ніна Зоя Тамара Лідія Мілана Кіра " +
    "Вероніка Олеся Іванна Марина Карина Кристина Ксенія Майя Мар'яна Устина " +
    'Андрій Олександр Саша Сашко Іван Петро Павло Микола Михайло Дмитро Сергій Олег Тарас Богдан Василь Юрій Віталій Віктор ' +
    'Володимир Вова Ярослав Роман Максим Артем Денис Назар Остап Орест Євген Женя Ігор Антон Олексій Степан Григорій Костянтин ' +
    'Костя Матвій Марко Данило Владислав Влад Станіслав Руслан Анатолій Вадим Валентин Ілля Кирило Лев Мирослав Нестор Святослав ' +
    'Захар Тимофій Тимур Федір Леонід Борис Філіп Арсен Ростислав Любомир Маркіян Давид ' +
    'мама тато бабуся дідусь брат сестра дядько тітка хрещена хрещений').split(' ');
  const ALT = { 'г': 'з', 'к': 'ц', 'х': 'с' };
  const formsCache = new Map();
  /** Відмінкові форми слова з імені (нижній регістр): «марта» → марти, марті, марту, мартою… */
  function nameForms(word) {
    const w = U.normalize(word);
    if (formsCache.has(w)) return formsCache.get(w);
    const f = new Set([w]);
    const add = (base, ends) => ends.forEach((e) => f.add(base + e));
    const b = w.slice(0, -1);
    const last = w.slice(-1);
    if (w.length >= 2) {
      if (last === 'а') {
        add(b, ['и', 'і', 'у', 'ою', 'о']);
        const pre = b.slice(-1);
        if (ALT[pre]) f.add(b.slice(0, -1) + ALT[pre] + 'і');          // Ольга → Ользі, Марічка → Марічці
        if (/[жчшщ]/.test(pre)) add(b, ['ею', 'е']);                   // Даша → Дашею
      } else if (last === 'я') {
        add(b, ['і', 'ї', 'ю', 'ею', 'єю', 'є', 'е']);                   // Оля → Олі, Марія → Марії, Ілля → Іллею
      } else if (last === 'й') {
        add(b, ['я', 'ю', 'єм', 'ем', 'єві', 'еві', 'ї']);               // Андрій → Андрія, Андрію, Андрієм
      } else if (last === 'о') {
        add(b, ['а', 'у', 'ом', 'ові', 'е']);                           // Петро, Марко, тато
      } else if (last === 'ь') {
        add(b, ['я', 'ю', 'ем', 'еві']);                                // дідусь → дідуся, дідусем
      } else if (/[бвгґджзклмнпрстфхцчшщ]/.test(last)) {
        add(w, ['а', 'у', 'ом', 'ові', 'е', 'я', 'ю', 'ем', 'еві']);     // Іван → Івана, Ігор → Ігоря
        const m = /^(.*)і([рн])$/.exec(w);                              // Федір → Федора
        if (m) add(m[1] + 'о' + m[2], ['а', 'у', 'ом', 'ові', 'е']);
        if (/ов$/.test(w)) add(w, ['і', "'ю"]);                          // Любов → Любові
      }
    }
    formsCache.set(w, f);
    return f;
  }
  const capWord = (s) => s.split('-').map((x) => (x ? x.charAt(0).toUpperCase() + x.slice(1) : x)).join('-');
  /** Імʼя в називному відмінку — спроба: «марти» → «Марта», «андрія» → «Андрій». */
  function guessName(token) {
    const t = U.normalize(token);
    if (!t) return '';
    for (const n of COMMON_NAMES) {
      const nn = U.normalize(n);
      if (nn === t || nameForms(nn).has(t)) return capWord(nn);
    }
    let g = t;
    if (/ї$/.test(t)) g = t.slice(0, -1) + 'я';
    else if (/(ою|ею|єю)$/.test(t)) g = t.replace(/(ою|ею)$/, 'а').replace(/єю$/, 'я');
    else if (/и$/.test(t)) g = t.slice(0, -1) + 'а';
    else if (/і$/.test(t)) g = t.slice(0, -1) + (/[жчшщ]$/.test(t.slice(0, -1)) ? 'а' : 'я');
    return capWord(g);
  }
  /**
   * Люди, чиє імʼя схоже на слова з рядка (будь-який відмінок): [{ person, score, at }], найкращі першими.
   * words — слова в нижньому регістрі; at — номер слова, з якого почався збіг.
   */
  function matchPeople(words) {
    const ws = (words || []).map((x) => U.normalize(x)).filter(Boolean);
    if (!ws.length) return [];
    const out = [];
    list().forEach((p) => {
      const pw = U.normalize(p.name).split(/[\s]+/).filter((x) => x.length >= 2);
      let score = 0;
      let at = -1;
      pw.forEach((n, k) => {
        let best = 0;
        let bi = -1;
        ws.forEach((w, i) => {
          let s = 0;
          if (w === n) s = 3;
          else if (w.length >= 3 && nameForms(n).has(w)) s = 2;
          if (s && k === 0) s += 0.5;
          if (s > best) { best = s; bi = i; }
        });
        if (best) { score += best; if (at < 0 || bi < at) at = bi; }
      });
      if (score) out.push({ person: p, score, at });
    });
    return out.sort((a, b) => b.score - a.score || (b.person.updatedAt || '').localeCompare(a.person.updatedAt || ''));
  }
  /** Порожня картка людини з полями за замовчуванням. */
  function blank(fields) {
    return Object.assign({
      id: U.uid(), name: '', group: 'friends', bday: null, bdayYear: null, phone: '', telegram: '', instagram: '', email: '',
      notes: '', dates: [], gifts: [], freq: null, lastContact: null
    }, fields || {});
  }

  CRM.people = {
    GROUPS, FREQS, list, get, annual, datesBetween, upcoming, nextAnnual, nextOf, inYear, contactInfo, dueContacts,
    markContacted, openPerson, openPage, parseVcf, importFile, openImport, homeCard, groupOf, mdText, writeLink,
    nameForms, guessName, matchPeople, blank, save, canSave: () => !!CRM.db.SCHEMA.people
  };
})(window.CRM);
