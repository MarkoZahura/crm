/* ==========================================================================
   tutor-money.js — «Репетиторство», етап 2 (пункт 3): гроші й оплати.

   • Ціна учня — за годину або за урок, у валюті учня (₴ за замовчуванням); нова ціна — з дати
     (минулі уроки лишаються за старою). Вартість уроку = ціна × тривалість (або ціна за урок),
     суму окремого уроку можна змінити у вікні уроку (lessons[дата].cost).
   • «Облік з» — окремо для кожного учня (за замовчуванням 1-ше число; з 25-го — наступного місяця):
     уроки раніше до оплати не рахуються. «На початок обліку» — борг або аванс (opening).
   • Урок рахується до оплати, щойно почався. Оплачуваний пропуск — lessons[дата].missed
     (урок зник з Календаря, але рахується й видно як «пропуск»).
   • Оплата — звичайний дохід у «Бюджеті» з полем tutor: { studentId } (категорія «Репетиторство»;
     учня можна вибрати й у формі транзакції Бюджету). Змінив/видалив операцію — борг перераховується.
     Інша валюта — за курсом НБУ на день оплати.
   • Баланс = залишок на початок − уроки + оплати: < 0 — борг, > 0 — «наперед ще N уроків».
   • Вкладка «Гроші» (#/tutor/money): місяць ‹ ›, зароблено / отримано / уроки й години,
     «Хто ще не заплатив», по учнях за місяць. На сторінці учня — картка «Гроші» й «Виписка».
   • Підсумок за місяць для батьків (шаблон — «Налаштування»): теми уроків + гроші;
     «Копіювати», «Telegram», «Надіслати…»; нагадування з 1-го по 7-ме число — для кожного учня.
   • ⚡: «Макс оплатив 1600» (без суми — увесь борг) і «урок Макс пт 16:00» (разовий урок).

   Учень (сховище students) отримує:
     money: { from: 'РРРР-ММ-ДД', currency: 'UAH'|'USD'|'EUR', opening: число (+ наперед, − борг),
              prices: [{ from: 'РРРР-ММ-ДД', amount, per: 'hour'|'lesson' }] }
     lessons[дата].cost — своя сума уроку; lessons[дата].missed — { start, dur, evId, occ, ov, ev }
     summaries: { 'РРРР-ММ': { sent: ISO } }
   Налаштування tutor (синхронізується): + summaryTemplate, payAccountId.
   Ключ нагадування: tutor:summary:<учень>:<РРРР-ММ>
   Адреси: #/tutor/money?month=РРРР-ММ-01, #/tutor?summary=<учень>&month=РРРР-ММ, #/tutor?pay=<учень>
   ========================================================================== */
window.CRM = window.CRM || {};

(function (CRM) {
  'use strict';

  const { h, ui } = { h: CRM.ui.h, ui: CRM.ui };
  const D = CRM.date;
  const U = CRM.utils;
  const fmt = CRM.fmt;
  const TU = () => CRM.tutor;
  const EPS = 0.004;
  const CAT_NAME = 'Репетиторство';
  const LESSONS_F = ['урок', 'уроки', 'уроків'];
  const DEFAULT_SUMMARY = [
    'Англійська — підсумок за {місяць}',
    '',
    '{уроки}',
    '',
    'Уроків: {кількість} ({години})',
    'Сума: {сума}',
    '{з минулого}',
    'Оплачено: {оплачено}',
    '{до оплати}'
  ].join('\n');
  const SPH = [
    ['{імʼя}', 'name'], ["{ім'я}", 'name'], ['{місяць}', 'month'], ['{уроки}', 'lessons'], ['{кількість}', 'count'],
    ['{години}', 'hours'], ['{сума}', 'sum'], ['{з минулого}', 'carry'], ['{оплачено}', 'paid'], ['{до оплати}', 'due']
  ];
  // Рядок, де ці підстановки порожні, у підсумок не потрапляє
  const DROP = new Set(['lessons', 'count', 'sum', 'carry', 'paid', 'due']);

  // ---------- Дрібниці ----------
  const r2 = (v) => U.round2(Number(v) || 0);
  /** «1 600 ₴» (без копійок, якщо ціле), «−800 ₴», з opts.sign — «+1 600 ₴». */
  function money(v, cur, opts) {
    const x = r2(v);
    return fmt.money(x, cur || 'UAH', Object.assign({ decimals: Math.abs(x - Math.round(x)) < EPS ? 0 : 2 }, opts || {}));
  }
  const nowMin = () => { const p = D.kyivParts(); return p.hh * 60 + p.mm; };
  const minOf = (t) => { const m = /^(\d{1,2}):(\d{2})$/.exec(String(t || '')); return m ? Number(m[1]) * 60 + Number(m[2]) : null; };
  const monthKey = (m) => String(m).slice(0, 7);
  const monthOfKey = (k) => (/^\d{4}-\d{2}$/.test(String(k || '')) ? k + '-01' : D.isDate(k) ? D.startOfMonth(k) : null);
  const lower = (s) => String(s || '').charAt(0).toLowerCase() + String(s || '').slice(1);
  const upper = (s) => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);
  /** «листопад» (з роком, якщо не цього року). */
  function monthNom(m) {
    const p = D.parse(m);
    const n = CRM.MONTHS_NOM[p.m - 1].toLowerCase();
    return p.y === D.parse(D.today()).y ? n : `${n} ${p.y}`;
  }
  /** «3 листопада». */
  function dayText(d) { const p = D.parse(d); return `${p.d} ${CRM.MONTHS_GEN[p.m - 1]}`; }
  const curSign = (cur) => (CRM.CURRENCIES[cur] ? CRM.CURRENCIES[cur].symbol : cur);
  function parseAmount(s) {
    const n = U.parseAmount(String(s == null ? '' : s).trim());
    return Number.isFinite(n) ? r2(n) : NaN;
  }
  const amountStr = (v) => String(r2(v)).replace('.', ',');

  // ---------- Кеш (перерахунок при змінах даних і щохвилини) ----------
  let ver = 0;
  const memo = new Map();
  function cached(key, fn) {
    const k = ver + '|' + Math.floor(Date.now() / 60000) + '|' + key;
    if (memo.has(k)) return memo.get(k);
    if (memo.size > 400) memo.clear();
    const v = fn();
    memo.set(k, v);
    return v;
  }
  CRM.store.on(['students', 'events', 'transactions', 'accounts', 'settings', 'categories'], () => { ver++; memo.clear(); });

  // ---------- Ціна й вартість уроку ----------
  const get = (id) => (CRM.tutor ? TU().get(id) : null);
  /** Налаштування грошей учня або null (ціну не вказано). */
  function mcfg(s) {
    const m = s && s.money;
    return m && Array.isArray(m.prices) && m.prices.length && D.isDate(m.from) ? m : null;
  }
  const hasPrice = (s) => !!mcfg(s);
  const curOf = (s) => (s && s.money && CRM.CURRENCIES[s.money.currency] ? s.money.currency : 'UAH');
  function priceList(s) {
    const m = mcfg(s);
    return m ? m.prices.filter((p) => Number(p.amount) > 0).slice().sort((a, b) => String(a.from || '').localeCompare(String(b.from || ''))) : [];
  }
  /** Ціна на дату: остання, що діє не пізніше за дату (раніше за першу — перша). */
  function priceAt(s, date) {
    const list = priceList(s);
    if (!list.length) return null;
    let p = list[0];
    list.forEach((x) => { if (!x.from || x.from <= date) p = x; });
    return p;
  }
  const perText = (per) => (per === 'hour' ? 'за годину' : 'за урок');
  const priceText = (p, cur) => (p ? `${money(p.amount, cur)} ${perText(p.per)}` : '');
  /** Вартість за ціною (без своєї суми уроку). */
  function baseCost(s, date, dur) {
    const p = priceAt(s, date);
    if (!p) return 0;
    return r2(p.per === 'hour' ? Number(p.amount) * (Number(dur) || 0) / 60 : Number(p.amount));
  }
  function ownCost(s, date) {
    const c = TU().lessonData(s, date).cost;
    return typeof c === 'number' && c >= 0 ? r2(c) : null;
  }
  function lessonCost(s, date, dur) { const own = ownCost(s, date); return own != null ? own : baseCost(s, date, dur); }

  // ---------- Уроки до оплати, оплати, виписка ----------
  /** Уроки, що рахуються до оплати (від «Облік з» до зараз): [{ kind: 'lesson'|'missed', date, start, dur, cost, L? }]. */
  // Кешовані розрахунки беруть свіжий запис учня (переданий міг застаріти — кеш тримається за id)
  const fresh = (s) => (s && s.id ? get(s.id) || s : s);
  function counted(s0) {
    const s = fresh(s0);
    return cached('c:' + s.id, () => {
      const m = mcfg(s);
      if (!m) return [];
      const T = D.today();
      const nm = nowMin();
      if (m.from > T) return [];
      const out = [];
      TU().lessonsBetween(m.from, T, s.id).forEach((L) => {
        if (!TU().started(L, T, nm)) return;
        out.push({ kind: 'lesson', date: L.date, start: L.start, dur: L.dur, cost: lessonCost(s, L.date, L.dur), L });
      });
      missedList(s).forEach((x) => {
        if (x.date < m.from || x.date > T) return;
        const st = minOf(x.start);
        if (x.date === T && st != null && st > nm) return;
        out.push({ kind: 'missed', date: x.date, start: x.start, dur: x.dur, cost: lessonCost(s, x.date, x.dur) });
      });
      return out.sort((a, b) => a.date.localeCompare(b.date) || String(a.start || '').localeCompare(String(b.start || '')));
    });
  }
  /** Оплачувані пропуски учня: [{ date, start, dur, data }]. */
  function missedList(s) {
    const out = [];
    Object.keys((s && s.lessons) || {}).forEach((d) => {
      const ms = s.lessons[d] && s.lessons[d].missed;
      if (!ms || !D.isDate(d)) return;
      out.push({ date: d, start: ms.start || null, dur: Number(ms.dur) > 0 ? Number(ms.dur) : 60, data: ms });
    });
    return out.sort((a, b) => a.date.localeCompare(b.date));
  }
  function payments(sid) {
    return CRM.store.list('transactions').filter((t) => t.type === 'income' && t.tutor && t.tutor.studentId === sid)
      .sort((a, b) => a.date.localeCompare(b.date));
  }
  function txCur(t) { try { return CRM.finance.currencyOf(t.accountId); } catch (e) { return 'UAH'; } }
  function inCur(amount, from, to, date) {
    if (from === to) return r2(amount);
    const v = CRM.rates.convert(amount, from, to, date);
    return v == null ? null : r2(v);
  }
  /**
   * Виписка учня: { cur, from, rows: [{ kind: 'open'|'lesson'|'missed'|'pay', date, amount (±), bal, … }], balance, noRate }.
   * balance < 0 — борг, > 0 — наперед.
   */
  function ledger(s0) {
    if (!s0) return null;
    const s = fresh(s0);
    return cached('l:' + s.id, () => {
      const m = mcfg(s);
      if (!m) return null;
      const cur = curOf(s);
      const rows = [];
      const open = r2(m.opening);
      if (Math.abs(open) > EPS) rows.push({ kind: 'open', date: m.from, amount: open });
      counted(s).forEach((x) => rows.push(Object.assign({}, x, { amount: -x.cost })));
      payments(s.id).forEach((t) => {
        const a = inCur(t.amount, txCur(t), cur, t.date);
        rows.push({ kind: 'pay', date: t.date, amount: a == null ? 0 : a, noRate: a == null, tx: t });
      });
      const ord = { open: 0, lesson: 1, missed: 1, pay: 2 };
      rows.sort((a, b) => a.date.localeCompare(b.date) || ord[a.kind] - ord[b.kind] || String(a.start || '').localeCompare(String(b.start || '')));
      let bal = 0;
      rows.forEach((r) => { bal = r2(bal + r.amount); r.bal = bal; });
      return { cur, from: m.from, rows, balance: bal, noRate: rows.some((r) => r.noRate) };
    });
  }
  /** Вартість звичайного уроку: найближчий урок за розкладом → останній → ціна × звичайна тривалість. */
  function usualCost(s0) {
    const s = fresh(s0);
    return cached('u:' + s.id, () => {
      const T = D.today();
      const nx = TU().lessonsBetween(T, D.addDays(T, 35), s.id).find((L) => !TU().started(L));
      if (nx) return lessonCost(s, nx.date, nx.dur);
      const last = counted(s).filter((x) => x.kind === 'lesson').pop();
      if (last) return last.cost;
      return baseCost(s, T, TU().usual(s.id).dur);
    });
  }
  /** Найстаріший неоплачений урок (оплати гасять найдавніші уроки). */
  function debtSince(s, L) {
    let credit = 0;
    const charges = [];
    L.rows.forEach((r) => {
      if (r.kind === 'pay') credit += r.amount;
      else if (r.kind === 'open') { if (r.amount > 0) credit += r.amount; else charges.push({ date: r.date, cost: -r.amount }); } else charges.push({ date: r.date, cost: -r.amount });
    });
    for (const c of charges) {
      if (credit >= c.cost - EPS) credit -= c.cost;
      else return c.date;
    }
    return null;
  }
  /** Стан оплат: { state: 'debt'|'ahead'|'even', bal, cur, text, long, n, since } або null (ціни немає). */
  function balanceInfo(s) {
    const L = ledger(s);
    if (!L) return null;
    return infoOf(s, L.balance, L.cur, L);
  }
  function infoOf(s, bal, cur, L) {
    if (bal < -EPS) return { state: 'debt', bal, cur, text: `борг ${money(-bal, cur)}`, long: `борг ${money(-bal, cur)}`, since: L ? debtSince(s, L) : null };
    if (bal > EPS) {
      const uc = usualCost(s);
      const n = uc > EPS ? Math.floor((bal + EPS) / uc) : 0;
      return n >= 1
        ? { state: 'ahead', bal, cur, n, text: `наперед ще ${fmt.count(n, LESSONS_F)}`, long: `наперед ще ${fmt.count(n, LESSONS_F)} (${money(bal, cur)})` }
        : { state: 'ahead', bal, cur, n: 0, text: `наперед ${money(bal, cur)}`, long: `наперед ${money(bal, cur)}` };
    }
    return { state: 'even', bal: 0, cur, text: 'усе оплачено', long: 'усе оплачено' };
  }
  /** Короткий стан для кнопок і карток: «Борг 1 600 ₴» / «Наперед ще 2 уроки» / «Усе оплачено». */
  const infoTitle = (info) => upper(info.state === 'ahead' ? info.long : info.text);

  // ---------- Місяць ----------
  /** Підсумок місяця учня: { b0, lessons, pays, earned, paid, minutes, count, missed, b1, active } або null. */
  function monthStats(s, month) {
    const L = ledger(s);
    if (!L) return null;
    const end = D.endOfMonth(month);
    let b0 = 0;
    const lessons = [];
    const pays = [];
    L.rows.forEach((r) => {
      if (r.kind === 'open' || r.date < month) { if (r.date <= end) b0 += r.amount; return; }
      if (r.date > end) return;
      if (r.kind === 'pay') pays.push(r); else lessons.push(r);
    });
    const earned = r2(lessons.reduce((a, x) => a + x.cost, 0));
    const paid = r2(pays.reduce((a, x) => a + x.amount, 0));
    return {
      month, end, cur: L.cur, b0: r2(b0), lessons, pays, earned, paid,
      minutes: lessons.reduce((a, x) => a + (Number(x.dur) || 0), 0),
      count: lessons.filter((x) => x.kind === 'lesson').length, missed: lessons.filter((x) => x.kind === 'missed').length,
      b1: r2(b0 - earned + paid), active: end >= L.from
    };
  }
  /** Уроки місяця, що ще будуть (за розкладом): { n, cost }. */
  function planned(s, month) {
    const m = mcfg(s);
    if (!m) return { n: 0, cost: 0 };
    const T = D.today();
    const end = D.endOfMonth(month);
    const from = [month, T, m.from].sort().pop();
    if (from > end) return { n: 0, cost: 0 };
    let n = 0;
    let cost = 0;
    TU().lessonsBetween(from, end, s.id).forEach((L) => { if (TU().started(L)) return; n++; cost += lessonCost(s, L.date, L.dur); });
    return { n, cost: r2(cost) };
  }
  /** Уроки місяця за розкладом (усі — і минулі, і майбутні): { n, cost } — для «За листопад». */
  function monthPlan(s, month) {
    const end = D.endOfMonth(month);
    let n = 0;
    let cost = 0;
    TU().lessonsBetween(month, end, s.id).forEach((L) => { n++; cost += lessonCost(s, L.date, L.dur); });
    return { n, cost: r2(cost) };
  }

  // ---------- Підсумок за місяць ----------
  function summaryTemplate() { const t = String((TU().cfg().summaryTemplate) || '').trim(); return t || DEFAULT_SUMMARY; }
  function fillSummary(tpl, v) {
    const lines = String(tpl || '').replace(/\r\n?/g, '\n').split('\n').map((line) => {
      let drop = false;
      let out = line;
      SPH.forEach(([ph, k]) => {
        if (!out.includes(ph)) return;
        const val = String(v[k] == null ? '' : v[k]).trim();
        if (!val && DROP.has(k)) drop = true;
        out = out.split(ph).join(val);
      });
      return drop ? null : out.replace(/\s*\(\s*\)/g, '');
    }).filter((x) => x !== null);
    return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  }
  /** Що піде в підсумок за місяць: { values, items, st }. */
  function summaryValues(s, month) {
    const T = D.today();
    const end = D.endOfMonth(month);
    const items = [];
    let tl = [];
    try { tl = TU().timeline(s).entries; } catch (e) { console.error(e); }
    tl.forEach((e) => {
      if (!e.date || e.date < month || e.date > end) return;
      if (e.lesson) { if (!TU().started(e.lesson)) return; } else if (e.date > T) return;
      items.push({ date: e.date, start: e.lesson ? e.lesson.start : null, kind: e.lesson ? 'lesson' : 'sheet', dur: e.lesson ? e.lesson.dur : null, text: TU().whatOrPlan(e) });
    });
    missedList(s).forEach((x) => { if (x.date >= month && x.date <= end && x.date <= T) items.push({ date: x.date, start: x.start, kind: 'missed', dur: x.dur, text: '' }); });
    items.sort((a, b) => a.date.localeCompare(b.date) || String(a.start || '').localeCompare(String(b.start || '')));
    const lines = items.map((x) => `${dayText(x.date)} — ${x.kind === 'missed' ? 'пропуск (оплачується)' : TU().oneLine(x.text) || 'урок'}`);
    const nMiss = items.filter((x) => x.kind === 'missed').length;
    const nLes = items.length - nMiss;
    const minutes = items.reduce((a, x) => a + (Number(x.dur) || 0), 0);
    const values = {
      name: s.name, month: monthNom(month), lessons: lines.join('\n'),
      count: items.length ? `${nLes}${nMiss ? ` + ${fmt.count(nMiss, ['пропуск', 'пропуски', 'пропусків'])}` : ''}` : '',
      hours: items.length && items.every((x) => x.dur) ? TU().durText(minutes) : '',
      sum: '', carry: '', paid: '', due: ''
    };
    const st = monthStats(s, month);
    if (st && st.active) {
      const cur = st.cur;
      values.sum = money(st.earned, cur);
      if (st.b0 < -EPS) values.carry = `Борг з попередніх місяців: ${money(-st.b0, cur)}`;
      else if (st.b0 > EPS) values.carry = `Залишок з попередніх місяців: ${money(st.b0, cur)} (наперед)`;
      // Оплати після кінця місяця (до кінця наступного) теж гасять борг цього місяця — підсумок зазвичай надсилають на початку наступного
      const payEnd = [T, D.addDays(D.addMonths(month, 2), -1)].sort()[0];
      const paidTo = r2(ledger(s).rows.filter((r) => r.kind === 'pay' && r.date >= month && r.date <= payEnd).reduce((a, r) => a + r.amount, 0));
      if (paidTo > EPS) values.paid = money(paidTo, cur);
      const R = r2(st.b0 - st.earned + paidTo);
      const info = balanceInfo(s);
      if (R < -EPS) values.due = `До оплати: ${money(-R, cur)}`;
      else if (info && info.state === 'ahead') values.due = `Оплачено наперед: ${info.long.replace(/^наперед /, '')}`;
      else values.due = 'Усе оплачено';
    }
    return { values, items, st };
  }
  function summaryText(s, month) { return fillSummary(summaryTemplate(), summaryValues(s, month).values); }
  const summarySent = (s, month) => (s && s.summaries && s.summaries[monthKey(month)] && s.summaries[monthKey(month)].sent) || null;
  const summaryKey = (sid, month) => `tutor:summary:${sid}:${monthKey(month)}`;
  async function markSummarySent(sid, month, on) {
    const s = get(sid);
    if (!s) return () => {};
    const k = monthKey(month);
    const before = summarySent(s, month);
    const set = async (val) => {
      const cur = get(sid);
      if (!cur) return;
      const summaries = Object.assign({}, cur.summaries || {});
      if (val) summaries[k] = { sent: val }; else delete summaries[k];
      await CRM.store.save('students', Object.assign({}, cur, { summaries }));
    };
    await set(on ? new Date().toISOString() : null);
    if (on && CRM.notify && CRM.notify.dismissKey) CRM.notify.dismissKey(summaryKey(sid, month)).catch(() => {});
    return () => set(before);
  }
  /** Місяць за замовчуванням: до 7-го числа — минулий, далі — поточний. */
  function defaultSummaryMonth() {
    const T = D.today();
    return D.parse(T).d <= 7 ? D.addMonths(D.startOfMonth(T), -1) : D.startOfMonth(T);
  }

  /** Вікно «Підсумок за місяць»: текст із шаблону, ‹ місяць ›, «Копіювати», «Telegram», «Надіслати…». */
  function openSummary(sid, month0) {
    const s0 = get(sid);
    if (!s0) { ui.toast('Цього учня більше немає', { type: 'error' }); return null; }
    let month = monthOfKey(month0) || defaultSummaryMonth();
    const cm = D.startOfMonth(D.today());
    if (month > cm) month = cm;
    const to = TU().reportPerson(s0);
    const area = ui.textarea({ rows: 14, maxlength: 8000, class: 'textarea tu-report-text tm-sum-text', 'aria-label': 'Текст підсумку' });
    const tgA = h('a', { class: 'btn tu-tg', target: '_blank', rel: 'noopener noreferrer' }, CRM.icon('send'), h('span', { class: 'btn-label' }, 'Telegram'));
    const link = () => (to && CRM.people && CRM.people.tgLink ? CRM.people.tgLink(to, area.value) : null);
    const syncTg = () => { const l = link(); if (l) tgA.href = l.href; };
    area.addEventListener('input', syncTg);
    const nav = h('div', { class: 'month-nav tm-sum-nav' });
    const status = h('div', { class: 'tu-sent-line subtle' });
    const minMonth = D.addMonths(cm, -24);
    function renderNav() {
      ui.mount(nav,
        h('button', { type: 'button', class: 'btn btn-icon btn-sm tm-sum-prev', 'aria-label': 'Попередній місяць', disabled: month <= minMonth, onClick: () => { month = D.addMonths(month, -1); load(); } }, CRM.icon('chevronLeft', { size: 'sm' })),
        h('span', { class: 'month-title' }, fmt.month(month)),
        h('button', { type: 'button', class: 'btn btn-icon btn-sm tm-sum-next', 'aria-label': 'Наступний місяць', disabled: month >= cm, onClick: () => { month = D.addMonths(month, 1); load(); } }, CRM.icon('chevronRight', { size: 'sm' })));
    }
    function renderStatus() {
      const at = summarySent(get(sid), month);
      const T = D.today();
      ui.mount(status, at
        ? [CRM.icon('checkCircle', { size: 'sm' }), h('span', null, `Надіслано ${TU().sentText(at)}`),
          h('button', { type: 'button', class: 'link-like tm-unsend', onClick: async () => { await markSummarySent(sid, month, false); renderStatus(); } }, 'Ще не надіслано')]
        : [h('span', null, D.endOfMonth(month) >= T ? 'Місяць ще не закінчився.' : 'Ще не надіслано.'),
          h('button', { type: 'button', class: 'link-like tm-mark-sent', onClick: () => done('Позначено як надісланий') }, 'Я вже надіслав')]);
    }
    function load() {
      const s = get(sid) || s0;
      const sv = summaryValues(s, month);
      area.value = sv.items.length ? fillSummary(summaryTemplate(), sv.values) : `За ${monthNom(month)} уроків немає.`;
      dlg.setTitle(`Підсумок: ${s.name} — ${monthNom(month)}`);
      syncTg();
      renderNav();
      renderStatus();
    }
    async function done(msg) {
      const m = month;
      const undo = await markSummarySent(sid, m, true);
      renderStatus();
      ui.toast(msg || 'Підсумок позначено як надісланий', { type: 'success', action: { label: 'Скасувати', onClick: async () => { await undo(); renderStatus(); } } });
    }
    const l0 = link();
    const toLine = h('div', { class: 'tu-report-to' },
      h('span', { class: 'subtle' }, 'Кому: '),
      to ? h('strong', null, to.name) : h('span', null, s0.reportTo === 'none' ? 'звіти цьому учневі не надсилаються' : 'не вибрано'),
      to && !l0 ? h('span', { class: 'subtle' }, ' — у картці немає Telegram чи телефону') : null,
      h('button', { type: 'button', class: 'link-like', onClick: () => { dlg.close('who'); TU().openForm(sid, { focus: 'report' }); } }, 'Змінити'));
    const copyBtn = ui.button({ label: 'Копіювати', icon: 'copy', className: 'tm-sum-copy', onClick: async () => {
      const ok = await TU().copyText(area.value, area);
      if (!ok) { ui.toast('Не вдалося скопіювати — виділи текст і натисни Ctrl+C', { type: 'error' }); return; }
      await done('Скопійовано — встав у месенджер. Позначено «надіслано».');
    } });
    tgA.addEventListener('click', () => { setTimeout(() => done('Відкрито Telegram — підсумок позначено як надісланий'), 0); });
    const shareBtn = navigator.share ? ui.button({ label: 'Надіслати…', icon: 'external', className: 'tm-sum-share', onClick: async () => {
      try { await navigator.share({ text: area.value }); await done('Підсумок надіслано'); } catch (er) { /* скасовано */ }
    } }) : null;
    const body = h('div', { class: 'form-stack tu-report tm-sum' },
      h('div', { class: 'tm-sum-top' }, nav, toLine),
      area,
      h('div', { class: 'field-hint' }, 'Текст можна підправити — зміни лише для цього повідомлення. Шаблон — «Налаштування» в «Репетиторстві».'),
      status);
    const dlg = ui.modal({
      title: `Підсумок: ${s0.name}`, size: 'md', className: 'tm-sum-modal', body,
      footer: [copyBtn, l0 ? tgA : null, shareBtn, ui.button({ label: 'Закрити', onClick: () => dlg.close('button') })].filter(Boolean),
      initialFocus: copyBtn
    });
    load();
    if (TU().linked(s0)) TU().ensureFresh();
    return dlg;
  }

  // ---------- Категорія «Репетиторство» і оплата ----------
  function incomeCats() { try { return CRM.finance.categories('income'); } catch (e) { return []; } }
  function findIncomeCategory() {
    const cats = incomeCats();
    return cats.find((c) => U.normalize(c.name) === 'репетиторство') || cats.find((c) => /^репетит/.test(U.normalize(c.name))) || null;
  }
  async function incomeCategory() {
    const hit = findIncomeCategory();
    if (hit) return hit;
    const order = incomeCats().reduce((m, c) => Math.max(m, Number(c.order) || 0), 0) + 1;
    return CRM.store.save('categories', { kind: 'income', name: CAT_NAME, color: 'teal', subcategories: [], order });
  }
  function payAccounts() {
    try { return CRM.finance.rankedAccounts().map((x) => x.account).filter((a) => !a.archived); } catch (e) { return []; }
  }
  /**
   * Рахунок для оплати: спершу рахунки у валюті учня (cur), серед них — як минулого разу (оплата уроків → дохід)
   * → основний неощадний; якщо в цій валюті рахунків немає — так само серед усіх.
   */
  function defaultPayAccount(accounts, cur) {
    const pick = (list) => {
      const by = (id) => list.find((a) => a.id === id) || null;
      const last = CRM.store.getSetting('budget.lastAccount', {}) || {};
      return by(TU().cfg().payAccountId) || by(last.income) || by(last.any) || list.find((a) => a.type !== 'savings') || list[0] || null;
    };
    const same = cur ? accounts.filter((a) => a.currency === cur) : [];
    return (same.length ? pick(same) : null) || pick(accounts);
  }
  /** Записати оплату → транзакція доходу. r = { sid, amount, accountId, date, comment }. */
  async function savePayment(r) {
    const s = get(r.sid);
    const cat = await incomeCategory();
    const saved = await CRM.store.save('transactions', {
      type: 'income', amount: r2(r.amount), accountId: r.accountId, toAccountId: null, toAmount: null,
      categoryId: cat ? cat.id : null, subcategoryId: null, splits: null, date: r.date || D.today(),
      comment: r.comment || `Оплата: ${s ? s.name : ''}`.trim(), recurringId: null, recurringDate: null,
      tutor: { studentId: r.sid }
    });
    try { CRM.finance.ensureRatesFor([saved]); } catch (e) { /* курси підвантажаться пізніше */ }
    const lastAcc = Object.assign({}, CRM.store.getSetting('budget.lastAccount', {}) || {}, { income: saved.accountId, any: saved.accountId });
    CRM.store.setSetting('budget.lastAccount', lastAcc);
    if (TU().cfg().payAccountId !== saved.accountId) TU().setCfg({ payAccountId: saved.accountId });
    return saved;
  }
  function paidToast(saved, sid) {
    const s = get(sid);
    const info = s ? balanceInfo(s) : null;
    ui.toast(`Оплату записано: ${money(saved.amount, txCur(saved), { sign: true })} · ${s ? s.name : ''}${info ? ': ' + info.long : ''}`, {
      type: 'success', duration: 9000,
      actions: [
        { label: 'Змінити', onClick: () => CRM.budget.openTxForm({ id: saved.id }) },
        { label: 'Скасувати', onClick: async () => { if (CRM.store.get('transactions', saved.id)) await CRM.store.removeForever('transactions', saved.id); ui.toast('Скасовано — оплату не записано'); } }
      ]
    });
  }

  /** Вікно «Отримав оплату»: сума (підказки «увесь борг», «1 урок», «за місяць»), рахунок, дата → дохід у «Бюджеті». */
  function openPayment(sid, preset) {
    const s = get(sid);
    if (!s) { ui.toast('Цього учня більше немає', { type: 'error' }); return null; }
    if (!CRM.finance || !CRM.budget) { ui.toast('«Бюджет» не завантажився — онови сторінку', { type: 'error' }); return null; }
    if (!TU().canSave()) return null;
    const accounts = payAccounts();
    if (!accounts.length) return CRM.budget.openTxForm({ type: 'income' });   // покаже «Спершу додай рахунок»
    const p = preset || {};
    const cur = curOf(s);
    const info = balanceInfo(s);
    const acc0 = accounts.find((a) => a.id === p.accountId) || defaultPayAccount(accounts, cur);
    const accSel = h('select', { class: 'select tm-pay-acc', 'aria-label': 'Рахунок' },
      accounts.map((a) => h('option', { value: a.id, selected: acc0 && a.id === acc0.id }, a.name + (a.currency !== 'UAH' ? ` (${a.currency})` : ''))));
    const accCur = () => { const a = accounts.find((x) => x.id === accSel.value); return a ? a.currency : 'UAH'; };
    const amountIn = ui.input({ inputmode: 'decimal', value: p.amount ? amountStr(p.amount) : '', placeholder: '0', 'aria-label': 'Сума', class: 'input amount-input tm-pay-amount', autocomplete: 'off' });
    const curEl = h('span', { class: 'amount-cur' });
    const fAmount = ui.field({ label: 'Сума', required: true, input: h('div', { class: 'amount-wrap' }, amountIn, curEl) });
    const dateIn = ui.dateInput({ value: p.date || D.today(), clearable: false, ariaLabel: 'Дата оплати', onChange: () => renderAfter() });
    const commentIn = ui.input({ value: p.comment || `Оплата: ${s.name}`, maxlength: 200, 'aria-label': 'Коментар' });
    const chips = h('div', { class: 'tm-chips' });
    const after = h('div', { class: 'tm-after subtle' });
    const toAcc = (v) => { const c = accCur(); return c === cur ? r2(v) : inCur(v, cur, c, dateIn.dateValue || D.today()); };
    function chip(label, v, cls) {
      return h('button', { type: 'button', class: 'chip ' + cls, onClick: () => { const x = toAcc(v); if (x == null) return; amountIn.value = amountStr(x); fAmount.setError(null); renderAfter(); amountIn.focus(); } }, label);
    }
    function renderChips() {
      const list = [];
      if (info && info.state === 'debt') list.push(chip(`Увесь борг · ${money(-info.bal, cur)}`, -info.bal, 'tm-chip-debt'));
      if (hasPrice(s)) {
        const uc = usualCost(s);
        if (uc > EPS) list.push(chip(`1 урок · ${money(uc, cur)}`, uc, 'tm-chip-one'));
        const cm = defaultFrom();   // наприкінці місяця (з 25-го) — уже наступний місяць
        const mp = monthPlan(s, cm);
        if (mp.n >= 2) list.push(chip(`За ${monthNom(cm)} · ${fmt.count(mp.n, LESSONS_F)} · ${money(mp.cost, cur)}`, mp.cost, 'tm-chip-month'));
      }
      ui.mount(chips, list.length ? list : null);
      chips.hidden = !list.length;
    }
    function renderAfter() {
      curEl.textContent = curSign(accCur());
      const v = parseAmount(amountIn.value);
      if (!info || !(v > 0)) { ui.mount(after, info ? `Зараз: ${info.long}.` : 'Ціну учня не вказано — оплата просто запишеться в «Бюджет».'); return; }
      const inS = inCur(v, accCur(), cur, dateIn.dateValue || D.today());
      if (inS == null) { ui.mount(after, `Зараз: ${info.long}. Курсу НБУ немає — перерахую, коли він завантажиться.`); return; }
      const nx = infoOf(s, r2(info.bal + inS), cur, null);
      ui.mount(after, accCur() !== cur ? `≈ ${money(inS, cur)} · ` : '', `Після оплати: `, h('strong', null, nx.long), '.');
    }
    amountIn.addEventListener('input', () => { fAmount.setError(null); renderAfter(); });
    accSel.addEventListener('change', renderAfter);
    async function submit() {
      const v = parseAmount(amountIn.value);
      if (!(v > 0)) { fAmount.setError('Вкажи суму більшу за нуль, напр., 1600'); amountIn.focus(); return; }
      if (v > 1e9) { fAmount.setError('Занадто велика сума'); amountIn.focus(); return; }
      dlg.close('force');
      const saved = await savePayment({ sid, amount: v, accountId: accSel.value, date: dateIn.dateValue || D.today(), comment: commentIn.value.trim() });
      paidToast(saved, sid);
      if (p.onSaved) p.onSaved(saved);
    }
    amountIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    const m = mcfg(s);
    const early = m && (dateIn.dateValue || D.today()) < m.from;
    const body = h('div', { class: 'form-stack tm-pay' },
      fAmount, chips, after,
      h('div', { class: 'form-grid' }, ui.field({ label: 'Рахунок', input: accSel }), ui.field({ label: 'Дата', input: dateIn })),
      ui.field({ label: 'Коментар', input: commentIn }),
      h('div', { class: 'field-hint' }, `Запишу дохід у «Бюджет» (категорія «${(findIncomeCategory() || {}).name || CAT_NAME}»${findIncomeCategory() ? '' : ' — створю'}).`,
        early ? ` Облік — з ${fmt.date(m.from)}: ця оплата зарахується як аванс.` : ''));
    const dlg = ui.modal({
      title: `Оплата: ${s.name}`, size: 'sm', className: 'tm-pay-modal', body,
      footer: [ui.button({ label: 'Скасувати', onClick: () => dlg.close('button') }), ui.button({ label: 'Записати оплату', icon: 'check', variant: 'primary', className: 'tm-pay-save', onClick: submit })],
      initialFocus: amountIn
    });
    renderChips();
    renderAfter();
    if (amountIn.value) amountIn.select();
    return dlg;
  }

  // ---------- Ціна учня: вікно ----------
  /** «Облік з» за замовчуванням: 1-ше число цього місяця, а з 25-го — наступного. */
  function defaultFrom() {
    const T = D.today();
    return D.parse(T).d >= 25 ? D.addMonths(D.startOfMonth(T), 1) : D.startOfMonth(T);
  }
  function seg(options, value, onPick, cls) {
    const box = h('div', { class: 'segmented ' + (cls || ''), role: 'radiogroup' });
    let cur = value;
    function draw() {
      ui.mount(box, options.map((o) => h('button', {
        type: 'button', role: 'radio', class: cur === o.id ? 'active' : '', 'aria-checked': cur === o.id ? 'true' : 'false', dataset: { v: o.id },
        onClick: () => { cur = o.id; draw(); onPick(o.id); }
      }, o.label)));
    }
    draw();
    return box;
  }
  /** Вікно «Ціна й облік»: ціна (за годину / за урок, валюта), з якої дати нова ціна, «Облік з», залишок на початок. */
  function openMoney(sid) {
    const s = get(sid);
    if (!s) { ui.toast('Цього учня більше немає', { type: 'error' }); return null; }
    if (!TU().canSave()) return null;
    const T = D.today();
    const had = hasPrice(s);
    const m0 = had ? mcfg(s) : {};
    const p0 = had ? priceAt(s, T) : null;
    let per = p0 ? p0.per : 'hour';
    let openKind = had && r2(m0.opening) < -EPS ? 'debt' : had && r2(m0.opening) > EPS ? 'ahead' : 'none';
    const amountIn = ui.input({ inputmode: 'decimal', value: p0 ? amountStr(p0.amount) : '', placeholder: 'Напр., 400', 'aria-label': 'Ціна', class: 'input amount-input tm-price', autocomplete: 'off' });
    const curSel = ui.select(CRM.dict.currencies.map((c) => ({ value: c, label: c === 'UAH' ? '₴ грн' : c === 'USD' ? '$ USD' : '€ EUR' })), { value: curOf(s), class: 'select tm-cur', 'aria-label': 'Валюта' });
    const perSeg = seg([{ id: 'hour', label: 'за годину' }, { id: 'lesson', label: 'за урок' }], per, (v) => { per = v; renderSince(); renderChips(); }, 'tm-per');
    const fPrice = ui.field({ label: 'Ціна', required: true, input: h('div', { class: 'tm-price-row' }, h('div', { class: 'tm-price-in' }, amountIn, curSel), perSeg) });
    const fromIn = ui.dateInput({ value: had ? m0.from : defaultFrom(), clearable: false, ariaLabel: 'Облік з', onChange: () => renderSince() });
    const fFrom = ui.field({ label: 'Облік з', input: fromIn, hint: 'Уроки раніше цієї дати до оплати не рахуються (в історії вони лишаються).' });
    const sinceIn = had ? ui.dateInput({ value: T, clearable: false, ariaLabel: 'Нова ціна діє з' }) : null;
    const fSince = had ? ui.field({ label: 'Нова ціна діє з', input: sinceIn, hint: `Уроки до цієї дати лишаються за ціною ${priceText(p0, curOf(s))}.` }) : null;
    function changed() {
      const v = parseAmount(amountIn.value);
      return had && (Math.abs(v - Number(p0.amount)) > EPS || per !== p0.per);
    }
    function renderSince() { if (fSince) fSince.hidden = !changed(); }
    amountIn.addEventListener('input', () => { fPrice.setError(null); renderSince(); renderChips(); });
    // Залишок на початок обліку
    const openIn = ui.input({ inputmode: 'decimal', value: had && Math.abs(r2(m0.opening)) > EPS ? amountStr(Math.abs(m0.opening)) : '', placeholder: '0', 'aria-label': 'Сума на початок', class: 'input amount-input tm-open-amount', autocomplete: 'off' });
    const openCur = h('span', { class: 'amount-cur' });
    const openChips = h('div', { class: 'tm-chips tm-open-chips' });
    const openRow = h('div', { class: 'tm-open-row' }, h('div', { class: 'amount-wrap' }, openIn, openCur), openChips);
    const openSeg = seg([{ id: 'none', label: 'Нічого' }, { id: 'debt', label: 'Борг' }, { id: 'ahead', label: 'Оплачено наперед' }], openKind, (v) => { openKind = v; openRow.hidden = v === 'none'; fOpen.setError(null); if (v !== 'none') openIn.focus(); }, 'tm-open-kind');
    const fOpen = ui.field({ label: 'На початок обліку', input: h('div', { class: 'tm-open' }, openSeg, openRow), hint: 'Якщо учень уже був винен за минулі уроки або заплатив наперед.' });
    openRow.hidden = openKind === 'none';
    function renderChips() {
      openCur.textContent = curSign(curSel.value);
      const v = parseAmount(amountIn.value);
      if (!(v > 0)) { ui.mount(openChips, null); return; }
      const one = per === 'hour' ? r2(v * TU().usual(sid).dur / 60) : v;
      ui.mount(openChips, [1, 2, 4].map((n) => h('button', {
        type: 'button', class: 'chip tm-open-chip', dataset: { n: String(n) },
        onClick: () => { openIn.value = amountStr(one * n); fOpen.setError(null); }
      }, `${fmt.count(n, LESSONS_F)} · ${money(one * n, curSel.value)}`)));
    }
    curSel.addEventListener('change', renderChips);
    // Історія цін
    const list = had ? priceList(s) : [];
    let keep = list.slice();
    const hist = h('div', { class: 'tm-prices' });
    function renderHist() {
      if (keep.length < 2) { ui.mount(hist, null); return; }
      ui.mount(hist, h('div', { class: 'tm-prices-title subtle' }, 'Ціни раніше:'), keep.map((x, i) => h('div', { class: 'tm-price-hist' },
        h('span', null, `${i === 0 ? 'спочатку' : 'з ' + fmt.date(x.from)} — ${priceText(x, curOf(s))}`),
        i > 0 ? h('button', { type: 'button', class: 'btn btn-ghost btn-icon btn-sm tm-price-del', 'aria-label': 'Прибрати цю зміну ціни', title: 'Прибрати цю зміну ціни', onClick: () => { keep = keep.filter((y) => y !== x); renderHist(); } }, CRM.icon('x', { size: 'sm' })) : null)));
    }
    renderHist();
    async function submit() {
      const v = parseAmount(amountIn.value);
      if (!(v > 0)) { fPrice.setError('Вкажи ціну, більшу за 0'); amountIn.focus(); return; }
      if (v > 1e7) { fPrice.setError('Занадто велика ціна'); amountIn.focus(); return; }
      const from = fromIn.dateValue || defaultFrom();
      let opening = 0;
      if (openKind !== 'none') {
        const ov = parseAmount(openIn.value);
        if (!(ov > 0)) { fOpen.setError('Вкажи суму або вибери «Нічого»'); openIn.focus(); return; }
        opening = openKind === 'debt' ? -ov : ov;
      }
      let prices;
      if (!had) prices = [{ from, amount: v, per }];
      else {
        prices = keep.map((x) => Object.assign({}, x));
        if (changed()) {
          const since = sinceIn.dateValue || T;
          if (since <= from || since <= (prices[0] && prices[0].from)) prices = [{ from, amount: v, per }];
          else { prices = prices.filter((x) => String(x.from || '') < since); prices.push({ from: since, amount: v, per }); }
        }
        if (prices.length) prices[0] = Object.assign({}, prices[0], { from: prices[0].from && prices[0].from < from ? prices[0].from : from });
      }
      const before = U.deepClone(s);
      const rec = Object.assign({}, get(sid) || s, { money: { from, currency: curSel.value, opening: r2(opening), prices } });
      dlg.close('saved');
      await CRM.store.save('students', rec);
      const info = balanceInfo(get(sid));
      ui.toast(`${had ? 'Збережено' : 'Ціну додано'}: ${priceText(priceAt(get(sid), T), curSel.value)}${info ? ' · ' + info.long : ''}`, {
        type: 'success', action: { label: 'Скасувати', onClick: () => CRM.store.save('students', before) }
      });
    }
    async function remove() {
      const ok = await ui.confirm({
        title: 'Вимкнути облік грошей учня?',
        message: 'Ціна, облік і борг зникнуть з «Репетиторства». Оплати в «Бюджеті» лишаються.',
        confirmText: 'Вимкнути', danger: true
      });
      if (!ok) return;
      const before = U.deepClone(get(sid));
      const rec = Object.assign({}, before);
      delete rec.money;
      dlg.close('removed');
      await CRM.store.save('students', rec);
      ui.toast('Облік грошей учня вимкнено', { action: { label: 'Скасувати', onClick: () => CRM.store.save('students', before) } });
    }
    amountIn.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); submit(); } });
    const dlg = ui.modal({
      title: `Ціна й оплати: ${s.name}`, size: 'md', className: 'tm-money-modal',
      body: h('div', { class: 'form-stack tm-money-form' }, fPrice, fSince, hist, fFrom, fOpen),
      footer: [
        had ? ui.button({ label: 'Вимкнути облік', icon: 'trash', variant: 'danger-ghost', className: 'tm-money-del', onClick: remove }) : null,
        h('span', { class: 'grow' }),
        ui.button({ label: 'Скасувати', onClick: () => dlg.close('button') }),
        ui.button({ label: had ? 'Зберегти' : 'Додати', variant: 'primary', className: 'tm-money-save', onClick: submit })
      ].filter(Boolean),
      initialFocus: amountIn
    });
    renderSince();
    renderChips();
    return dlg;
  }

  // ---------- Пропуск, що оплачується ----------
  /** Запис для lessons[дата].missed з уроку L (при скасуванні «Пропуск — оплачується»). */
  function missedRecord(L, evBefore) {
    const ev = evBefore || {};
    return {
      start: L.start || null, dur: L.dur, evId: L.evId || null, occ: L.occ || null,
      ov: L.series && ev.overrides && L.occ && ev.overrides[L.occ] ? U.deepClone(ev.overrides[L.occ]) : null,
      ev: L.series ? null : { title: ev.title || '', cat: ev.cat || null, remind: ev.remind == null ? null : ev.remind, note: ev.note || '' }
    };
  }
  /** Пропуски для «Історії» на сторінці учня: [{ key: 'M:<дата>', date, missed }]. */
  function missedEntries(s) { return missedList(s).filter((x) => x.date <= D.today()).map((x) => ({ key: 'M:' + x.date, date: x.date, missed: x })); }
  function missedRow(s, e) {
    const x = e.missed;
    const cost = hasPrice(s) && mcfg(s).from <= x.date ? lessonCost(s, x.date, x.dur) : null;
    const open = () => openMissed(s.id, x.date);
    return h('div', {
      class: 'tu-erow tm-missed-row', role: 'button', tabIndex: 0, dataset: { key: e.key, sid: s.id }, style: { '--tu': TU().colorOf(s) },
      onClick: open, onKeydown: (ev) => { if ((ev.key === 'Enter' || ev.key === ' ') && ev.target === ev.currentTarget) { ev.preventDefault(); open(); } }
    },
    h('span', { class: 'tu-erow-when' }, h('span', { class: 'tu-erow-date' }, TU().dayShort(x.date)), h('span', { class: 'tu-erow-time subtle num' }, x.start || '')),
    h('span', { class: 'tu-erow-text' }, 'Пропуск — урок скасовано, але оплачується'),
    h('span', { class: 'tu-erow-side' }, h('span', { class: 'badge tm-chip-missed' }, cost != null ? `пропуск · ${money(cost, curOf(s))}` : 'пропуск')));
  }
  function openMissed(sid, date) {
    const s = get(sid);
    const x = s && missedList(s).find((m) => m.date === date);
    if (!x) { ui.toast('Цього пропуску більше немає', { type: 'error' }); return null; }
    const counts = hasPrice(s) && mcfg(s).from <= date;
    const body = h('div', { class: 'form-stack' },
      h('p', { class: 'modal-text' }, `${upper(TU().dayLong(date))}${x.start ? ', ' + x.start : ''} (${TU().durText(x.dur)}) — урок скасовано, але він оплачується.`),
      h('p', { class: 'modal-text subtle' }, counts ? `Рахується до оплати як урок: ${money(lessonCost(s, date, x.dur), curOf(s))}. У підсумку за місяць — «пропуск».` : 'У підсумку за місяць — «пропуск». До оплати не рахується (ціни чи обліку на цю дату немає).'));
    const dlg = ui.modal({
      title: `Пропуск: ${s.name}`, size: 'sm', className: 'tm-missed-modal', body,
      footer: [
        ui.button({ label: 'Не рахувати', className: 'tm-missed-free', onClick: async () => {
          dlg.close('free');
          const before = U.deepClone(x.data);
          await TU().setLessonData(sid, date, { missed: null });
          ui.toast(`Пропуск ${TU().dayShort(date)} більше не рахується`, { action: { label: 'Скасувати', onClick: () => TU().setLessonData(sid, date, { missed: before }) } });
        } }),
        ui.button({ label: 'Повернути урок', icon: 'calendar', className: 'tm-missed-restore', onClick: async () => { dlg.close('restore'); await restoreMissed(sid, date); } }),
        ui.button({ label: 'Закрити', variant: 'primary', onClick: () => dlg.close('button') })
      ]
    });
    return dlg;
  }
  /** «Повернути урок»: знову в Календар (повтор серії — прибрати з skip; разовий — новий урок), без позначки пропуску. */
  async function restoreMissed(sid, date) {
    const s = get(sid);
    const x = s && missedList(s).find((m) => m.date === date);
    if (!x) return false;
    const ms = x.data;
    const ev = ms.evId ? CRM.store.get('events', ms.evId) : null;
    if (ev && !ev.deletedAt && ev.repeat && ms.occ) {
      const ov = Object.assign({}, ev.overrides || {});
      if (ms.ov) ov[ms.occ] = U.deepClone(ms.ov);
      await CRM.store.patch('events', ev.id, { skip: (ev.skip || []).filter((d) => d !== ms.occ), overrides: ov });
    } else {
      const src = ms.ev || {};
      await CRM.store.save('events', {
        title: src.title || TU().lessonTitle(s.name), date, allDay: false, start: ms.start || TU().usual(sid).start, dur: Number(ms.dur) || 60,
        cat: src.cat || TU().lessonCat(), remind: src.remind === undefined ? 15 : src.remind, note: src.note || '', studentId: sid
      });
    }
    await TU().setLessonData(sid, date, { missed: null });
    ui.toast(`Урок ${TU().dayShort(date)} повернуто в Календар`, { type: 'success' });
    return true;
  }

  // ---------- Вікно уроку: вартість і оплата ----------
  /** Блок «Оплата» у вікні уроку. → { el, destroy } */
  function lessonBox(sid, key) {
    const el = h('div', { class: 'tm-lesson' });
    let editing = false;
    function render() {
      const s = get(sid);
      const e = s ? TU().entryFor(s, key) : null;
      const L = e && e.lesson;
      if (!s || !L) { ui.mount(el, null); return; }
      if (!hasPrice(s)) {
        ui.mount(el, h('div', { class: 'tm-lesson-none subtle' }, 'Ціну учня не вказано. ', h('button', { type: 'button', class: 'link-like tm-lesson-price', onClick: () => openMoney(sid) }, 'Вказати ціну')));
        return;
      }
      const m = mcfg(s);
      const cur = curOf(s);
      if (L.date < m.from) {
        ui.mount(el, h('div', { class: 'tu-sec tm-lesson-sec' }, h('div', { class: 'tu-sec-title' }, 'Оплата'),
          h('div', { class: 'subtle' }, `До початку обліку (з ${fmt.date(m.from)}) — до оплати не рахується.`)));
        return;
      }
      const own = ownCost(s, L.date);
      const base = baseCost(s, L.date, L.dur);
      const cost = own != null ? own : base;
      const p = priceAt(s, L.date);
      const note = own != null ? `своя сума; за ціною — ${money(base, cur)}` : p.per === 'hour' ? `${TU().durText(L.dur)} × ${money(p.amount, cur)}/год` : 'ціна за урок';
      const info = balanceInfo(s);
      let costRow;
      if (editing) {
        const inp = ui.input({ inputmode: 'decimal', value: amountStr(cost), 'aria-label': 'Сума цього уроку', class: 'input input-sm amount-input tm-cost-in', autocomplete: 'off' });
        const save = async () => {
          const v = parseAmount(inp.value);
          if (!(v >= 0)) { inp.focus(); return; }
          editing = false;
          await TU().setLessonData(sid, L.date, { cost: Math.abs(v - base) < EPS ? null : v });
          render();
        };
        inp.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); ev.stopPropagation(); save(); } if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); editing = false; render(); } });
        costRow = h('div', { class: 'tm-cost-edit' }, h('div', { class: 'amount-wrap' }, inp, h('span', { class: 'amount-cur' }, curSign(cur))),
          ui.button({ label: 'Зберегти', size: 'sm', variant: 'primary', className: 'tm-cost-save', onClick: save }),
          own != null ? ui.button({ label: 'За ціною', size: 'sm', className: 'tm-cost-reset', onClick: async () => { editing = false; await TU().setLessonData(sid, L.date, { cost: null }); render(); } }) : null,
          ui.button({ label: 'Скасувати', size: 'sm', variant: 'ghost', onClick: () => { editing = false; render(); } }));
        setTimeout(() => { inp.focus(); inp.select(); }, 0);
      } else {
        costRow = h('div', { class: 'tm-cost' }, h('span', null, 'Цей урок: ', h('strong', { class: 'num tm-cost-val' }, money(cost, cur))), h('span', { class: 'subtle' }, ` (${note})`),
          h('button', { type: 'button', class: 'link-like tm-cost-change', onClick: () => { editing = true; render(); } }, 'Змінити'));
      }
      ui.mount(el, h('div', { class: 'tu-sec tm-lesson-sec' },
        h('div', { class: 'tu-sec-title' }, 'Оплата'),
        costRow,
        !TU().started(L) ? h('div', { class: 'subtle tm-lesson-later' }, 'Рахуватиметься до оплати, коли урок почнеться.') : null,
        h('div', { class: 'tm-lesson-bal' },
          h('span', { class: 'tm-bal-text tm-bal-' + info.state }, `Зараз: ${info.long}`),
          ui.button({ label: 'Отримав оплату', icon: 'plus', size: 'sm', className: 'tm-lesson-pay', onClick: () => openPayment(sid) }))));
    }
    const off = CRM.store.on(['students', 'events', 'transactions'], () => { if (!editing) render(); });
    render();
    return { el, destroy: off };
  }

  // ---------- Сторінка учня й картка ----------
  /** Рядок у картці учня (список «Учні»): «борг 1 600 ₴» + «Оплата». */
  function cardLine(s) {
    if (!hasPrice(s)) return null;
    const info = balanceInfo(s);
    return h('div', { class: 'tm-card-line' },
      h('span', { class: 'badge tm-badge tm-badge-' + info.state }, info.text),
      h('span', { class: 'grow' }),
      ui.button({ label: 'Оплата', icon: 'plus', size: 'sm', variant: 'ghost', className: 'tm-card-pay', title: 'Отримав оплату', onClick: (ev) => { ev.preventDefault(); ev.stopPropagation(); openPayment(s.id); } }));
  }
  /** Картка «Гроші» на сторінці учня. */
  function moneyCard(s) {
    const head = h('div', { class: 'card-head' }, h('h2', null, 'Гроші'),
      hasPrice(s) ? ui.button({ label: 'Ціна', icon: 'pencil', size: 'sm', variant: 'ghost', className: 'tm-edit', title: 'Ціна, облік, залишок на початок', onClick: () => openMoney(s.id) }) : null);
    if (!hasPrice(s)) {
      return h('section', { class: 'card tu-money' }, head, h('div', { class: 'card-body form-stack' },
        h('div', { class: 'subtle' }, 'Вкажи ціну уроку — CRM рахуватиме, скільки учень винен чи заплатив наперед, а оплати піде в «Бюджет».'),
        h('div', { class: 'btn-row' }, ui.button({ label: 'Вказати ціну', icon: 'plus', size: 'sm', variant: 'primary', className: 'tm-set-price', onClick: () => openMoney(s.id) }),
          ui.button({ label: `Підсумок за ${monthNom(defaultSummaryMonth())}`, icon: 'send', size: 'sm', className: 'tm-summary', onClick: () => openSummary(s.id) }))));
    }
    const m = mcfg(s);
    const cur = curOf(s);
    const info = balanceInfo(s);
    const L = ledger(s);
    const p = priceAt(s, D.today());
    const sm = defaultSummaryMonth();
    return h('section', { class: 'card tu-money' }, head, h('div', { class: 'card-body form-stack' },
      h('div', { class: 'tm-bal tm-bal-' + info.state }, infoTitle(info)),
      info.state === 'debt' && info.since ? h('div', { class: 'subtle tm-since' }, `за уроки з ${dayText(info.since)}`) : null,
      h('div', { class: 'tm-price-line subtle' }, `${priceText(p, cur)} · облік з ${fmt.date(m.from)}`,
        Math.abs(r2(m.opening)) > EPS ? ` · на початок: ${m.opening < 0 ? 'борг ' + money(-m.opening, cur) : 'наперед ' + money(m.opening, cur)}` : ''),
      L.noRate ? h('div', { class: 'tm-warn' }, CRM.icon('alert', { size: 'sm' }), 'Для оплати в іншій валюті ще немає курсу НБУ — суму буде перераховано, коли він завантажиться.') : null,
      h('div', { class: 'btn-row' },
        ui.button({ label: 'Отримав оплату', icon: 'plus', size: 'sm', variant: 'primary', className: 'tm-pay', onClick: () => openPayment(s.id) }),
        ui.button({ label: `Підсумок за ${monthNom(sm)}`, icon: 'send', size: 'sm', className: 'tm-summary', onClick: () => openSummary(s.id, sm) }))));
  }
  const stmtMore = {};
  function balShort(bal, cur) { return bal < -EPS ? `борг ${money(-bal, cur)}` : bal > EPS ? `наперед ${money(bal, cur)}` : '0'; }
  /** Картка «Виписка» на сторінці учня: уроки й оплати за датами із залишком після кожного запису. */
  function statementCard(s) {
    const L = ledger(s);
    if (!L) return null;
    const rows = L.rows.slice().reverse();
    const shown = stmtMore[s.id] || 10;
    const cur = L.cur;
    const accName = (t) => { const a = CRM.store.get('accounts', t.accountId); return a ? a.name : 'рахунок видалено'; };
    const line = (r) => {
      let label;
      let sub = '';
      let open = null;
      if (r.kind === 'open') label = 'На початок обліку';
      else if (r.kind === 'lesson') { label = `Урок · ${TU().durText(r.dur)}`; sub = r.start || ''; open = () => TU().openLessonOn(s.id, r.date); } else if (r.kind === 'missed') { label = `Пропуск (оплачується) · ${TU().durText(r.dur)}`; sub = r.start || ''; open = () => openMissed(s.id, r.date); } else {
        label = `Оплата · ${accName(r.tx)}`;
        sub = txCur(r.tx) !== cur ? money(r.tx.amount, txCur(r.tx)) + (r.noRate ? ' · курсу ще немає' : '') : '';
        open = () => CRM.budget.openTxForm({ id: r.tx.id });
      }
      return h('div', {
        class: 'tm-srow tm-srow-' + r.kind + (open ? ' clickable' : ''), role: open ? 'button' : null, tabIndex: open ? 0 : null, dataset: { kind: r.kind, date: r.date },
        onClick: open, onKeydown: open ? (ev) => { if (ev.key === 'Enter' && ev.target === ev.currentTarget) { ev.preventDefault(); open(); } } : null
      },
      h('span', { class: 'tm-srow-date' }, TU().dayShort(r.date)),
      h('span', { class: 'tm-srow-label' }, label, sub ? h('span', { class: 'subtle' }, ' · ' + sub) : null),
      h('span', { class: 'tm-srow-amount num ' + (r.amount > 0 ? 'tx-income' : '') }, money(r.amount, cur, { sign: true })),
      h('span', { class: 'tm-srow-bal subtle num' }, balShort(r.bal, cur)));
    };
    return h('section', { class: 'card tu-stmt' },
      h('div', { class: 'card-head' }, h('h2', null, 'Виписка', rows.length ? h('span', { class: 'tab-count' }, String(rows.length)) : null)),
      rows.length ? h('div', { class: 'tm-slist' }, rows.slice(0, shown).map(line)) : h('div', { class: 'card-body subtle' }, `З ${fmt.date(L.from)} ще не було уроків і оплат.`),
      rows.length > shown ? h('div', { class: 'card-foot' }, ui.button({ label: `Показати ще ${Math.min(10, rows.length - shown)}`, size: 'sm', variant: 'ghost', className: 'tm-stmt-more', onClick: () => { stmtMore[s.id] = shown + 10; CRM.router.rerender(); } })) : null);
  }

  // ---------- Вкладка «Гроші» ----------
  const pageState = { month: null };
  function kpi(label, value, note, cls) {
    return h('div', { class: 'kpi ' + (cls || '') }, h('div', { class: 'kpi-label' }, label), h('div', { class: 'kpi-value num' }, value), note ? h('div', { class: 'kpi-note' }, note) : null);
  }
  function toUAH(v, cur, date) { if (cur === 'UAH') return v; const x = CRM.rates.toUAH(v, cur, date); return x == null ? null : x; }
  function renderPage(container, route) {
    const p = (route && route.params) || {};
    const T = D.today();
    const cm = D.startOfMonth(T);
    const priced = TU().all().filter(hasPrice);
    let minM = priced.reduce((acc, s) => { const f = D.startOfMonth(mcfg(s).from); return !acc || f < acc ? f : acc; }, null) || cm;
    if (minM > cm) minM = cm;
    if (p.month) { const mm = monthOfKey(p.month); if (mm) pageState.month = mm; CRM.router.consumeParam('month'); }
    let month = pageState.month || cm;
    if (month > cm) month = cm;
    if (month < minM) month = minM;
    pageState.month = month;
    const body = [];
    const noPrice = TU().active().filter((s) => !hasPrice(s));
    if (!priced.length) {
      body.push(ui.empty({
        icon: 'wallet', title: 'Вкажи учням ціну уроку',
        text: 'Тоді тут буде заробіток за місяць, хто скільки винен і хто заплатив наперед, а оплати підуть у «Бюджет».',
        action: TU().active().length ? null : { label: 'Додати учня', icon: 'plus', onClick: () => TU().openForm(null) }
      }));
      if (noPrice.length) body.push(h('section', { class: 'card tm-noprice' }, h('div', { class: 'card-head' }, h('h2', null, 'Учні без ціни')),
        h('div', { class: 'tm-list' }, noPrice.map((s) => h('div', { class: 'tm-row' }, nameCell(s), h('span', { class: 'grow' }),
          ui.button({ label: 'Вказати ціну', icon: 'plus', size: 'sm', className: 'tm-row-price', onClick: () => openMoney(s.id) }))))));
      ui.mount(container, h('div', { class: 'page tu-page tm-page' }, TU().listHead(), TU().tabsNav('money'), body));
      return;
    }
    // --- Місяць ---
    let earned = 0;
    let paid = 0;
    let count = 0;
    let missed = 0;
    let minutes = 0;
    let unknown = false;
    let plan = { n: 0, cost: 0 };
    const rows = [];
    priced.forEach((s) => {
      const st = monthStats(s, month);
      if (!st || !st.active) return;
      if (s.archived && !st.lessons.length && !st.pays.length) return;
      st.lessons.forEach((x) => { const v = toUAH(x.cost, st.cur, x.date); if (v == null) unknown = true; else earned += v; });
      st.pays.forEach((x) => { const v = CRM.finance ? CRM.finance.txUAH(x.tx) : x.amount; if (v == null) unknown = true; else paid += v; });
      count += st.count;
      missed += st.missed;
      minutes += st.minutes;
      if (month === cm) { const pl = planned(s, month); plan = { n: plan.n + pl.n, cost: plan.cost + (toUAH(pl.cost, st.cur, T) || 0) }; }
      rows.push({ s, st });
    });
    const nav = h('div', { class: 'month-nav tm-month-nav' },
      h('button', { type: 'button', class: 'btn btn-icon btn-sm tm-prev', 'aria-label': 'Попередній місяць', disabled: month <= minM, onClick: () => { pageState.month = D.addMonths(month, -1); CRM.router.rerender(); } }, CRM.icon('chevronLeft', { size: 'sm' })),
      h('span', { class: 'month-title' }, fmt.month(month)),
      h('button', { type: 'button', class: 'btn btn-icon btn-sm tm-next', 'aria-label': 'Наступний місяць', disabled: month >= cm, onClick: () => { pageState.month = D.addMonths(month, 1); CRM.router.rerender(); } }, CRM.icon('chevronRight', { size: 'sm' })));
    const approx = unknown ? '≈ ' : '';
    body.push(h('section', { class: 'card tm-month' },
      h('div', { class: 'card-head' }, h('h2', null, month === cm ? 'Цей місяць' : 'Місяць'), nav),
      h('div', { class: 'card-body' },
        h('div', { class: 'kpi-row tm-kpis' },
          kpi('Зароблено за уроки', approx + money(earned, 'UAH'), month === cm && plan.n ? `ще за розкладом: ${fmt.count(plan.n, LESSONS_F)} · ≈ ${money(plan.cost, 'UAH')}` : null, 'tm-kpi-earned'),
          kpi('Отримано оплат', approx + money(paid, 'UAH'), null, 'tm-kpi-paid'),
          kpi('Уроків', String(count) + (missed ? ` + ${missed}` : ''), missed ? fmt.count(missed, ['пропуск оплачується', 'пропуски оплачуються', 'пропусків оплачуються']) : null, 'tm-kpi-count'),
          kpi('Годин', minutes ? TU().durText(minutes) : '0', null, 'tm-kpi-hours')),
        unknown ? h('div', { class: 'tm-warn subtle' }, CRM.icon('alert', { size: 'sm' }), 'Частину сум у валюті ще не перераховано — немає курсу НБУ.') : null)));
    // --- Хто ще не заплатив ---
    const debtors = priced.map((s) => ({ s, info: balanceInfo(s) })).filter((x) => x.info && x.info.state === 'debt')
      .sort((a, b) => (toUAH(-b.info.bal, b.info.cur, T) || 0) - (toUAH(-a.info.bal, a.info.cur, T) || 0));
    body.push(h('section', { class: 'card tm-debtors' },
      h('div', { class: 'card-head' }, h('h2', null, 'Хто ще не заплатив', debtors.length ? h('span', { class: 'tab-count' }, String(debtors.length)) : null)),
      debtors.length ? h('div', { class: 'tm-list' }, debtors.map(({ s, info }) => h('div', { class: 'tm-row', dataset: { id: s.id } },
        nameCell(s),
        h('span', { class: 'tm-row-main' }, h('strong', { class: 'num tm-debt' }, money(-info.bal, info.cur)), info.since ? h('span', { class: 'subtle' }, ` · за уроки з ${dayText(info.since)}`) : null),
        h('span', { class: 'grow' }),
        ui.button({ label: 'Отримав оплату', icon: 'plus', size: 'sm', className: 'tm-row-pay', onClick: () => openPayment(s.id) }))))
        : h('div', { class: 'card-body tm-all-paid' }, CRM.icon('checkCircle', { size: 'sm' }), h('span', null, 'Усі розрахувались.'))));
    // --- По учнях за місяць ---
    body.push(h('section', { class: 'card tm-students' },
      h('div', { class: 'card-head' }, h('h2', null, `По учнях · ${monthNom(month)}`)),
      rows.length ? h('div', { class: 'tm-table' },
        h('div', { class: 'tm-trow tm-thead subtle' }, h('span', null, 'Учень'), h('span', null, 'Уроки'), h('span', { class: 'num' }, 'Зароблено'), h('span', { class: 'num' }, 'Оплачено'), h('span', null, 'Зараз'), h('span')),
        rows.map(({ s, st }) => {
          const info = balanceInfo(s);
          return h('div', { class: 'tm-trow', dataset: { id: s.id } },
            nameCell(s),
            h('span', { class: 'tm-tc-les' }, `${st.count}${st.missed ? ' + ' + st.missed : ''} · ${st.minutes ? TU().durText(st.minutes) : '0 год'}`),
            h('span', { class: 'num tm-tc-earned', dataset: { label: 'Зароблено' } }, money(st.earned, st.cur)),
            h('span', { class: 'num tm-tc-paid', dataset: { label: 'Оплачено' } }, money(st.paid, st.cur)),
            h('span', { class: 'tm-tc-now' }, h('span', { class: 'badge tm-badge tm-badge-' + info.state }, info.text)),
            h('span', { class: 'tm-tc-act' }, ui.button({ label: 'Підсумок', icon: 'send', size: 'sm', variant: 'ghost', className: 'tm-row-sum', onClick: () => openSummary(s.id, month) })));
        }))
        : h('div', { class: 'card-body subtle' }, `За ${monthNom(month)} уроків і оплат немає.`),
      noPrice.length ? h('div', { class: 'card-foot tm-noprice-foot subtle' }, `Без ціни: ${noPrice.map((s) => s.name).join(', ')} · `,
        h('button', { type: 'button', class: 'link-like', onClick: () => openMoney(noPrice[0].id) }, `Вказати ціну (${noPrice[0].name})`)) : null));
    ui.mount(container, h('div', { class: 'page tu-page tm-page' }, TU().listHead(), TU().tabsNav('money'), body));
  }
  function nameCell(s) {
    return h('a', { href: CRM.router.href('tutor/' + s.id), class: 'tm-name' }, h('span', { class: 'tu-dot', style: { background: TU().colorOf(s) } }), s.name, s.archived ? h('span', { class: 'badge' }, 'архів') : null);
  }

  // ---------- Налаштування: шаблон підсумку ----------
  function settingsSection() {
    const tplIn = ui.textarea({ value: summaryTemplate(), rows: 9, maxlength: 3000, 'aria-label': 'Шаблон підсумку за місяць', class: 'textarea tm-tpl' });
    let timer = null;
    const save = () => { const v = tplIn.value.trim(); return TU().setCfg({ summaryTemplate: !v || v === DEFAULT_SUMMARY ? '' : v }); };
    tplIn.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(save, 500); });
    const reset = ui.button({ label: 'Як було спочатку', size: 'sm', variant: 'ghost', className: 'tm-tpl-reset', onClick: async () => { tplIn.value = DEFAULT_SUMMARY; await save(); ui.toast('Шаблон підсумку — як спочатку'); } });
    const el = h('div', { class: 'tu-set-sec' }, h('h3', null, 'Шаблон підсумку за місяць'),
      ui.field({ input: tplIn, hint: 'Підстановки: {імʼя}, {місяць}, {уроки} (дата й «Що робили» кожного уроку), {кількість}, {години}, {сума}, {з минулого}, {оплачено}, {до оплати}. Рядок з порожньою підстановкою (крім {години}) у підсумок не потрапляє; гроші — лише для учнів з ціною.' }),
      reset);
    return { el, flush: () => { clearTimeout(timer); return save(); } };
  }

  // ---------- Форма транзакції в «Бюджеті»: «Оплата за уроки» ----------
  /** Поле вибору учня для доходу. → { el, value(), show(type), set(id) } або null (учнів немає). */
  function txField(existing, opts) {
    const o = opts || {};
    if (!CRM.tutor || !CRM.db.SCHEMA.students) return null;
    const cur = (existing && existing.tutor && existing.tutor.studentId) || o.studentId || null;
    const list = TU().all().filter((s) => !s.archived || s.id === cur);
    if (!list.length && !cur) return null;
    const sel = h('select', { class: 'select tx-tutor', 'aria-label': 'Оплата за уроки' },
      h('option', { value: '' }, '— ні —'),
      list.map((s) => h('option', { value: s.id, selected: s.id === cur }, s.name + (s.archived ? ' (архів)' : ''))),
      cur && !list.some((s) => s.id === cur) ? h('option', { value: cur, selected: true }, 'Учень видалений') : null);
    sel.addEventListener('change', () => { if (o.onPick) o.onPick(sel.value || null); });
    const f = ui.field({ label: 'Оплата за уроки', input: sel, hint: 'Вибери учня — оплата зарахується в «Репетиторстві», борг перерахується.', className: 'tx-tutor-field' });
    return { el: f, value: () => sel.value || null, show: (type) => { f.hidden = type !== 'income'; }, set: (id) => { sel.value = id || ''; } };
  }

  // ---------- ⚡ Швидке введення ----------
  const PAY_RE = /^(оплатив|оплатила|оплатили|заплатив|заплатила|заплатили|сплатив|сплатила|сплатили|оплата|оплату|оплати|розрахувався|розрахувалася|розрахувалась|розрахувались)$/;
  const LESSON_RE = /^(урок|уроку|уроки|заняття|занятття)$/;
  /**
   * Варіанти для ⚡: { tutorpay?, lesson? }. ctx = { dateFor, account: { account, index } | null, accounts }.
   * «Макс оплатив 1600», «оплата Макса», «урок Макс пт 16:00», «заняття з Мариною завтра 18:00 1,5 год».
   */
  function quickOptions(P, ctx) {
    const out = {};
    if (!CRM.tutor || !CRM.db.SCHEMA.students || !TU().active().length) return out;
    const toks = P.tokens;
    const payI = toks.findIndex((t) => !t.tag && PAY_RE.test(t.n));
    const lesI = toks.findIndex((t) => !t.tag && LESSON_RE.test(t.n));
    if (payI < 0 && lesI < 0) return out;
    let s = null;
    toks.forEach((t, i) => {
      if (s || t.tag || i === payI || i === lesI || (ctx.account && ctx.account.index === i)) return;
      const x = TU().studentOfTitle(t.raw);
      if (x) s = x;
    });
    if (!s) return out;
    if (payI >= 0) out.tutorpay = payOption(P, s, ctx);
    else out.lesson = lessonOption(P, s, ctx);
    return out;
  }
  function relDay(d) { const r = TU().relDay(d); return /^(Сьогодні|Завтра|Вчора)$/.test(r) ? r.toLowerCase() : r; }
  function payOption(P, s, ctx) {
    const base = { kind: 'tutorpay', label: 'Оплата', icon: 'trendUp', iconClass: 'ico-payment', sure: true, sid: s.id };
    const accounts = ctx.accounts || [];
    const info = balanceInfo(s);
    const cur = curOf(s);
    let problem = null;
    if (!CRM.finance || !CRM.budget) problem = '«Бюджет» не завантажився — онови сторінку.';
    else if (!accounts.length) problem = 'Спершу додай рахунок у «Бюджеті» — Enter відкриє форму.';
    const want = P.money && P.money.cur;
    const fits = (a) => a && (!want || a.currency === want);
    let account = ctx.account && fits(ctx.account.account) ? ctx.account.account : null;
    if (!account) { const d = defaultPayAccount(accounts.filter(fits), want || cur); if (d) account = d; }
    if (!account && !problem) problem = `Немає рахунку в ${want === 'USD' ? 'доларах' : want === 'EUR' ? 'євро' : 'гривнях'} — Enter відкриє форму.`;
    const date = ctx.dateFor(P, 'income') || P.today;
    const accCur = account ? account.currency : (want || 'UAH');
    let amount = P.money ? P.money.amount : null;
    let fromDebt = false;
    if (amount == null) {
      if (info && info.state === 'debt') { amount = accCur === cur ? -info.bal : inCur(-info.bal, cur, accCur, date); fromDebt = true; }
      if (amount == null && !problem) problem = info && info.state !== 'debt' ? `${s.name}: ${info.long} — напиши суму: «${s.name} оплатив 1600».` : `Напиши суму: «${s.name} оплатив 1600».`;
    }
    if (date > P.today && !problem) problem = 'Оплату можна записати лише сьогодні або в минулий день.';
    const parts = [];
    if (amount != null) parts.push(money(amount, accCur, { sign: true }) + (fromDebt ? ' (увесь борг)' : ''));
    parts.push((findIncomeCategory() || {}).name || CAT_NAME);
    if (account) parts.push(account.name);
    parts.push(relDay(date));
    if (info && amount != null) {
      const inS = inCur(amount, accCur, cur, date);
      if (inS != null) parts.push('після: ' + infoOf(s, r2(info.bal + inS), cur, null).long);
    }
    return Object.assign(base, {
      title: `Оплата: ${s.name}`, parts, ok: !problem, problem,
      rec: { sid: s.id, amount: amount == null ? null : r2(amount), accountId: account ? account.id : null, date, comment: `Оплата: ${s.name}` }
    });
  }
  function lessonOption(P, s, ctx) {
    const base = { kind: 'lesson', label: 'Урок', icon: 'board', iconClass: 'ico-learning', sid: s.id };
    const date = ctx.dateFor(P, 'event') || P.today;
    const u = TU().usual(s.id);
    const startMin = P.time ? P.time.start : minOf(u.start);
    let dur = P.time && P.time.end != null ? P.time.end - P.time.start : P.dur || u.dur;
    dur = Math.max(15, Math.min(dur, 1440 - startMin));
    const start = TU().hhmm(startMin);
    const rec = { title: TU().lessonTitle(s.name), date, allDay: false, start, dur, cat: TU().lessonCat(), remind: 15, note: '', studentId: s.id };
    let problem = CRM.calendar && CRM.db.SCHEMA.events ? null : 'Браузер показує стару версію сайту — онови сторінку (Ctrl+F5).';
    if (s.archived) problem = problem || `«${s.name}» в архіві — спершу поверни учня.`;
    const parts = [TU().dayShort(date), `${start}–${TU().hhmm(Math.min(1440, startMin + dur))}`, P.time ? 'разовий урок' : 'разовий урок, звичайний час'];
    const same = TU().lessonsBetween(date, date, s.id);
    if (same.length) parts.push(`того дня вже є урок${same[0].start ? ' о ' + same[0].start : ''}`);
    return Object.assign(base, { title: s.name, parts, rec, ok: !problem, problem, timed: !!(P.time || P.date) });
  }
  /** Виконати варіант ⚡ (без тосту) → { kind, store, id, short, text, undo }. */
  async function quickApply(o) {
    if (!o || !o.ok) return null;
    if (o.kind === 'tutorpay') {
      const r = o.rec;
      if (!(r.amount > 0) || !r.accountId) return null;
      const saved = await savePayment(r);
      const s = get(r.sid);
      const info = s ? balanceInfo(s) : null;
      return {
        kind: 'tutorpay', store: 'transactions', id: saved.id, short: `${o.title} ${money(saved.amount, txCur(saved), { sign: true })}`,
        text: `Оплату записано: ${money(saved.amount, txCur(saved), { sign: true })} · ${s ? s.name : ''}${info ? ': ' + info.long : ''}`,
        undo: async () => { if (CRM.store.get('transactions', saved.id)) await CRM.store.removeForever('transactions', saved.id); }
      };
    }
    if (o.kind === 'lesson') {
      if (!TU().canSave()) return null;
      const saved = await CRM.store.save('events', o.rec);
      return {
        kind: 'lesson', store: 'events', id: saved.id, short: `Урок: ${o.title}`,
        text: `Урок додано: ${o.title}, ${TU().dayShort(saved.date)}, ${saved.start}–${TU().hhmm(Math.min(1440, minOf(saved.start) + saved.dur))}`,
        undo: async () => { if (CRM.store.get('events', saved.id)) await CRM.store.removeForever('events', saved.id); }
      };
    }
    return null;
  }
  /** «Змінити» з тосту ⚡. */
  function openSaved(kind, id) {
    if (kind === 'tutorpay') return CRM.budget.openTxForm({ id });
    if (kind === 'lesson') { const ev = CRM.store.get('events', id); return ev ? TU().openLessonOn(ev.studentId, ev.date) : null; }
    return null;
  }
  /** «Детальніше» з ⚡: заповнене вікно. */
  function details(o) {
    const r = o.rec || {};
    if (o.kind === 'tutorpay') return openPayment(r.sid || o.sid, { amount: r.amount || null, date: r.date, accountId: r.accountId });
    if (o.kind === 'lesson') return TU().openOneOff(r.studentId || o.sid, { date: r.date, start: r.start, dur: r.dur });
    return null;
  }

  // ---------- Нагадування «Надіслати підсумок» (1–7 числа) ----------
  if (CRM.notify && CRM.notify.addRule) {
    CRM.notify.addRule(() => {
      if (!CRM.db.SCHEMA.students || !CRM.tutor) return [];
      const T = D.today();
      if (D.parse(T).d > 7) return [];
      const month = D.addMonths(D.startOfMonth(T), -1);
      const out = [];
      TU().active().forEach((s) => {
        if (!TU().wantsReport(s) || summarySent(s, month)) return;
        const sv = summaryValues(s, month);
        if (!sv.items.length) return;
        const to = TU().reportPerson(s);
        out.push({
          key: summaryKey(s.id, month), kind: 'tutor', title: `Надіслати підсумок за ${monthNom(month)}: ${s.name}`,
          text: `Уроків: ${sv.values.count}${sv.values.due ? ' · ' + lower(sv.values.due) : ''} — текст${to && to.id !== s.personId ? ' для «' + to.name + '»' : ''} готовий.`,
          target: { route: 'tutor', params: { summary: s.id, month: monthKey(month) } }
        });
      });
      return out;
    });
  }

  CRM.tutorMoney = {
    DEFAULT_SUMMARY, hasPrice, mcfg, curOf, priceAt, priceList, baseCost, lessonCost, counted, payments, ledger, usualCost, balanceInfo,
    monthStats, planned, monthPlan, summaryValues, summaryText, fillSummary, summaryTemplate, summarySent, markSummarySent, defaultSummaryMonth, defaultFrom,
    findIncomeCategory, incomeCategory, savePayment, openPayment, openMoney, openSummary, openMissed, restoreMissed, missedRecord, missedEntries, missedRow, missedList,
    lessonBox, cardLine, moneyCard, statementCard, renderPage, settingsSection, txField, quickOptions, quickApply, openSaved, details, money
  };
})(window.CRM);
