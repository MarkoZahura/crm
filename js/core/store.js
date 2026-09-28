/* ==========================================================================
   store.js — дані застосунку в пам'яті + запис у IndexedDB.
   • Усі записи завантажуються при старті, тому читання миттєве.
   • Кожна зміна пишеться в базу і повідомляє розділи (on/emit),
     щоб вони перемалювалися.
   • Видалення «м'яке»: запис отримує deletedAt і потрапляє в Кошик.
     Записи, видалені разом (напр., рахунок і його операції),
     мають спільний deleteBatch і відновлюються разом.
   ========================================================================== */
window.CRM = window.CRM || {};

(function (CRM) {
  'use strict';

  const APP_ID = 'personal-crm';
  const SCHEMA_VERSION = 1;
  const MAX_ATTACHMENT = 10 * 1024 * 1024; // 10 МБ
  const TRASH_DAYS = 30;

  // Сховища з «звичайними» записами (мають id, можуть бути в Кошику)
  const DATA_STORES = ['tasks', 'accounts', 'transactions', 'categories', 'recurring', 'goals', 'workouts', 'courses', 'notifications'];
  // Налаштування, які не потрапляють в експорт (службові або секретні)
  const EXPORT_EXCLUDE = new Set(['gcalToken', 'gcalCache']);
  // Налаштування, що лишаються після «Очистити всі дані»
  const KEEP_ON_CLEAR = new Set(['theme', 'accent']);

  const cache = {};
  DATA_STORES.forEach((n) => { cache[n] = new Map(); });
  let attachments = new Map(); // лише метадані, без самого файлу
  let settings = new Map();
  let rates = new Map();

  // ---------- Події змін ----------
  const listeners = new Set();
  let pending = new Set();
  let scheduled = false;

  function emit(name) {
    pending.add(name);
    if (scheduled) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      const changed = pending;
      pending = new Set();
      listeners.forEach((l) => {
        if (!l.stores || Array.from(changed).some((s) => l.stores.has(s) || s === '*')) {
          try { l.fn(changed); } catch (e) { console.error(e); }
        }
      });
    });
  }

  /** Підписка на зміни: on(['tasks'], fn) або on(null, fn) — на всі. Повертає функцію відписки. */
  function on(stores, fn) {
    const l = { stores: stores ? new Set(stores) : null, fn };
    listeners.add(l);
    return () => listeners.delete(l);
  }

  // ---------- Гачок для синхронізації ----------
  // Модуль синхронізації (sync.js) дізнається про кожну локальну зміну:
  // { kind: 'put', store, recs } | { kind: 'del', store, ids } | { kind: 'setting', key } | { kind: 'reset' }.
  // Зміни, що прийшли з хмари (applyRemote / replaceSynced), гачок не викликають.
  let syncHook = null;
  function setSyncHook(fn) { syncHook = fn; }
  function notifySync(ev) {
    if (!syncHook) return;
    try { syncHook(ev); } catch (e) { console.error(e); }
  }

  // ---------- Завантаження ----------
  function stripBlob(rec) {
    const meta = Object.assign({}, rec);
    delete meta.blob;
    return meta;
  }

  async function load() {
    await CRM.db.open();
    await Promise.all(DATA_STORES.map(async (n) => {
      const arr = await CRM.db.getAll(n);
      cache[n] = new Map(arr.map((r) => [r.id, r]));
    }));
    const att = await CRM.db.getAll('attachments');
    attachments = new Map(att.map((r) => [r.id, stripBlob(r)]));
    const st = await CRM.db.getAll('settings');
    settings = new Map(st.map((r) => [r.key, r.value]));
    const rt = await CRM.db.getAll('rates');
    rates = new Map(rt.map((r) => [r.date, r]));
  }

  // ---------- Читання ----------
  /**
   * Список записів. opts.deleted: false (за замовчуванням — лише активні),
   * 'only' — лише видалені, 'all' — усі.
   */
  function list(name, opts) {
    const del = opts && opts.deleted;
    const arr = Array.from(cache[name].values());
    if (del === 'all') return arr;
    if (del === 'only') return arr.filter((r) => r.deletedAt);
    return arr.filter((r) => !r.deletedAt);
  }

  function get(name, id) { return (cache[name] && cache[name].get(id)) || null; }

  function count(name) { return list(name).length; }

  // ---------- Запис ----------
  function stamp(record) {
    const now = new Date().toISOString();
    const rec = Object.assign({}, record);
    if (!rec.id) rec.id = CRM.utils.uid();
    if (!rec.createdAt) rec.createdAt = now;
    rec.updatedAt = now;
    if (rec.deletedAt === undefined) rec.deletedAt = null;
    return rec;
  }

  /** Створити або оновити запис. Повертає збережений запис. */
  async function save(name, record) {
    const rec = stamp(record);
    await CRM.db.put(name, rec);
    cache[name].set(rec.id, rec);
    emit(name);
    notifySync({ kind: 'put', store: name, recs: [rec] });
    return rec;
  }

  async function saveMany(name, records) {
    const recs = records.map(stamp);
    await CRM.db.putMany(name, recs);
    recs.forEach((r) => cache[name].set(r.id, r));
    emit(name);
    notifySync({ kind: 'put', store: name, recs });
    return recs;
  }

  /** Оновити окремі поля запису: patch('tasks', id, { title: '…' }) */
  async function patch(name, id, changes) {
    const cur = get(name, id);
    if (!cur) throw new Error('Запис не знайдено');
    return save(name, Object.assign({}, cur, changes));
  }

  /** Остаточно видалити запис (без Кошика). */
  async function removeForever(name, id) {
    await CRM.db.remove(name, id);
    cache[name].delete(id);
    if (name === 'tasks') await removeAttachmentsOfTask(id);
    emit(name);
    notifySync({ kind: 'del', store: name, ids: [id] });
  }

  // ---------- Кошик (м'яке видалення) ----------
  /**
   * Перенести запис у Кошик разом із пов'язаними.
   * related — масив { store, id } записів, які видаляються разом (напр., операції рахунку).
   * Повертає id пакета — для «Скасувати».
   */
  async function softDelete(name, id, related) {
    const head = get(name, id);
    if (!head) return null;
    const batch = CRM.utils.uid();
    const now = new Date().toISOString();
    const byStore = {};
    const add = (store, rec, isHead) => {
      (byStore[store] = byStore[store] || []).push(Object.assign({}, rec, {
        deletedAt: now, deleteBatch: batch, deleteHead: isHead, updatedAt: now
      }));
    };
    add(name, head, true);
    (related || []).forEach((r) => {
      const rec = get(r.store, r.id);
      if (rec && !rec.deletedAt) add(r.store, rec, false);
    });
    await writeGroups(byStore);
    return batch;
  }

  /** Відновити все, що було видалено одним пакетом. */
  async function restoreBatch(batch) {
    const byStore = {};
    DATA_STORES.forEach((n) => {
      cache[n].forEach((rec) => {
        if (rec.deleteBatch === batch) {
          (byStore[n] = byStore[n] || []).push(Object.assign({}, rec, {
            deletedAt: null, deleteBatch: null, deleteHead: false, updatedAt: new Date().toISOString()
          }));
        }
      });
    });
    await writeGroups(byStore);
  }

  /** Остаточно видалити пакет із Кошика. */
  async function purgeBatch(batch) {
    const byStore = {};
    DATA_STORES.forEach((n) => {
      cache[n].forEach((rec) => {
        if (rec.deleteBatch === batch) (byStore[n] = byStore[n] || []).push(rec.id);
      });
    });
    const names = Object.keys(byStore);
    if (!names.length) return;
    await CRM.db.run(names, 'readwrite', (stores) => {
      names.forEach((n) => byStore[n].forEach((id) => stores[n].delete(id)));
    });
    names.forEach((n) => { byStore[n].forEach((id) => cache[n].delete(id)); emit(n); });
    names.forEach((n) => notifySync({ kind: 'del', store: n, ids: byStore[n] }));
    if (byStore.tasks) {
      for (const taskId of byStore.tasks) await removeAttachmentsOfTask(taskId);
    }
  }

  /** Елементи Кошика: «головні» записи пакетів, від найновіших. */
  function trashItems() {
    const items = [];
    DATA_STORES.forEach((n) => {
      if (n === 'notifications') return;
      cache[n].forEach((rec) => {
        if (rec.deletedAt && rec.deleteHead) {
          let related = 0;
          DATA_STORES.forEach((m) => cache[m].forEach((r) => {
            if (r.deleteBatch === rec.deleteBatch && !r.deleteHead) related++;
          }));
          items.push({ store: n, record: rec, related });
        }
      });
    });
    return items.sort((a, b) => (b.record.deletedAt || '').localeCompare(a.record.deletedAt || ''));
  }

  /** Автоочищення: пакети, що лежать у Кошику довше 30 днів. */
  async function purgeExpired() {
    const limit = Date.now() - TRASH_DAYS * 86400000;
    const expired = trashItems().filter((it) => new Date(it.record.deletedAt).getTime() < limit);
    for (const it of expired) await purgeBatch(it.record.deleteBatch);
    // Записи без «голови» (напр., після ручних змін) теж прибираємо
    return expired.length;
  }

  async function writeGroups(byStore) {
    const names = Object.keys(byStore);
    if (!names.length) return;
    await CRM.db.run(names, 'readwrite', (stores) => {
      names.forEach((n) => byStore[n].forEach((rec) => stores[n].put(rec)));
    });
    names.forEach((n) => { byStore[n].forEach((rec) => cache[n].set(rec.id, rec)); emit(n); });
    names.forEach((n) => notifySync({ kind: 'put', store: n, recs: byStore[n] }));
  }

  // ---------- Вкладення ----------
  function listAttachments(taskId) {
    return Array.from(attachments.values())
      .filter((a) => a.taskId === taskId)
      .sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
  }

  /** Додати файл до задачі. Кидає помилку з поясненням, якщо файл завеликий. */
  async function addAttachment(taskId, file) {
    if (file.size > MAX_ATTACHMENT) {
      throw new Error(`Файл «${file.name}» завеликий (${CRM.fmt.bytes(file.size)}). Максимум — 10 МБ.`);
    }
    const rec = {
      id: CRM.utils.uid(), taskId, name: file.name, type: file.type || 'application/octet-stream',
      size: file.size, createdAt: new Date().toISOString(), blob: file
    };
    await CRM.db.put('attachments', rec);
    attachments.set(rec.id, stripBlob(rec));
    emit('attachments');
    return stripBlob(rec);
  }

  async function getAttachmentBlob(id) {
    const rec = await CRM.db.get('attachments', id);
    return rec ? rec.blob : null;
  }

  async function removeAttachment(id) {
    await CRM.db.remove('attachments', id);
    attachments.delete(id);
    emit('attachments');
  }

  async function removeAttachmentsOfTask(taskId) {
    const ids = listAttachments(taskId).map((a) => a.id);
    if (!ids.length) return;
    await CRM.db.removeMany('attachments', ids);
    ids.forEach((id) => attachments.delete(id));
    emit('attachments');
  }

  // ---------- Налаштування ----------
  function getSetting(key, def) { return settings.has(key) ? settings.get(key) : def; }

  async function setSetting(key, value) {
    settings.set(key, value);
    await CRM.db.put('settings', { key, value });
    emit('settings');
    notifySync({ kind: 'setting', key });
  }

  // ---------- Курси валют (кеш) ----------
  function getRate(date) { return rates.get(date) || null; }
  function allRates() { return Array.from(rates.values()); }
  async function saveRate(rec) {
    rates.set(rec.date, rec);
    await CRM.db.put('rates', rec);
    emit('rates');
  }
  /** Зберегти кілька курсів одним записом (одне перемальовування замість багатьох). */
  async function saveRates(list) {
    if (!list.length) return;
    list.forEach((r) => rates.set(r.date, r));
    await CRM.db.putMany('rates', list);
    emit('rates');
  }

  // ---------- Експорт / імпорт ----------
  async function exportAll() {
    const stores = {};
    DATA_STORES.forEach((n) => { stores[n] = list(n, { deleted: 'all' }); });
    stores.settings = Array.from(settings.entries())
      .filter(([k]) => !EXPORT_EXCLUDE.has(k))
      .map(([key, value]) => ({ key, value }));
    stores.rates = allRates();
    stores.attachments = [];
    for (const meta of attachments.values()) {
      const blob = await getAttachmentBlob(meta.id);
      stores.attachments.push(Object.assign({}, meta, { data: blob ? await CRM.utils.blobToBase64(blob) : null }));
    }
    return { app: APP_ID, schema: SCHEMA_VERSION, exportedAt: new Date().toISOString(), stores };
  }

  /** Перевірити файл резервної копії. Кидає зрозумілу помилку, якщо щось не так. */
  function validateDump(obj) {
    if (!obj || typeof obj !== 'object' || obj.app !== APP_ID) {
      throw new Error('Це не файл резервної копії цієї CRM.');
    }
    if (typeof obj.schema !== 'number' || obj.schema > SCHEMA_VERSION) {
      throw new Error('Файл створено новішою версією застосунку. Онови сайт і спробуй ще раз.');
    }
    if (!obj.stores || typeof obj.stores !== 'object') {
      throw new Error('У файлі немає даних.');
    }
    const keyOf = { settings: 'key', rates: 'date' };
    Object.keys(obj.stores).forEach((n) => {
      if (!CRM.db.SCHEMA[n]) return; // невідомі сховища ігноруємо
      const arr = obj.stores[n];
      if (!Array.isArray(arr)) throw new Error(`Пошкоджений розділ «${n}» у файлі.`);
      const k = keyOf[n] || 'id';
      arr.forEach((r) => {
        if (!r || typeof r !== 'object' || r[k] == null) throw new Error(`Пошкоджений запис у розділі «${n}».`);
      });
    });
    return true;
  }

  /** Короткий підсумок файлу: скільки записів кожного типу (без видалених). */
  function summarize(obj) {
    const s = obj.stores || {};
    const live = (n) => (s[n] || []).filter((r) => !r.deletedAt).length;
    return {
      tasks: live('tasks'), accounts: live('accounts'), transactions: live('transactions'),
      categories: live('categories'), recurring: live('recurring'), goals: live('goals'),
      workouts: live('workouts'), courses: live('courses'), attachments: (s.attachments || []).length
    };
  }

  /** Повністю замінити дані вмістом резервної копії. */
  async function importAll(obj) {
    validateDump(obj);
    const data = {};
    CRM.db.STORE_NAMES.forEach((n) => { data[n] = []; });
    Object.keys(obj.stores).forEach((n) => {
      if (!data[n]) return;
      if (n === 'attachments') {
        data[n] = obj.stores[n].map((a) => {
          const rec = Object.assign({}, a);
          rec.blob = a.data ? CRM.utils.base64ToBlob(a.data, a.type) : new Blob([]);
          delete rec.data;
          return rec;
        });
      } else if (n === 'settings') {
        data[n] = obj.stores[n].filter((r) => !EXPORT_EXCLUDE.has(r.key));
      } else {
        data[n] = obj.stores[n];
      }
    });
    // Службові налаштування цього браузера (напр., токен Google) зберігаємо
    EXPORT_EXCLUDE.forEach((k) => { if (settings.has(k)) data.settings.push({ key: k, value: settings.get(k) }); });
    await CRM.db.replaceStores(data);
    await load();
    emit('*');  notifySync({ kind: 'reset' });
  }

  /** Замінити всі дані готовим набором (для демо-даних). data: { tasks: [...], ... } */
  async function replaceAll(dataIn) {
    const data = {};
    CRM.db.STORE_NAMES.forEach((n) => { data[n] = []; });
    Object.keys(dataIn).forEach((n) => { if (data[n]) data[n] = dataIn[n]; });
    // Налаштування інтерфейсу й профіль не чіпаємо, якщо їх не передано
    if (!dataIn.settings) data.settings = Array.from(settings.entries()).map(([key, value]) => ({ key, value }));
    await CRM.db.replaceStores(data);
    await load();
    emit('*');  notifySync({ kind: 'reset' });
  }

  /** Очистити всі дані (лишаються тільки тема та акцентний колір). */
  async function clearAll() {
    const data = {};
    CRM.db.STORE_NAMES.forEach((n) => { data[n] = []; });
    data.settings = Array.from(settings.entries())
      .filter(([k]) => KEEP_ON_CLEAR.has(k))
      .map(([key, value]) => ({ key, value }));
    await CRM.db.replaceStores(data);
    await load();
    emit('*');  notifySync({ kind: 'reset' });
  }

  // ---------- Зміни з хмари (без виклику гачка синхронізації) ----------
  /**
   * items: [{ store, rec }] — записати; [{ store, id, del: true }] — остаточно видалити;
   *        [{ setting: key, value }] — налаштування (value === undefined → видалити).
   */
  async function applyRemote(items) {
    if (!items || !items.length) return;
    const puts = {};
    const dels = {};
    const setPuts = [];
    const setDels = [];
    items.forEach((it) => {
      if (it.setting) {
        if (it.value === undefined) setDels.push(it.setting); else setPuts.push({ key: it.setting, value: it.value });
      } else if (it.del) (dels[it.store] = dels[it.store] || []).push(it.id);
      else (puts[it.store] = puts[it.store] || []).push(it.rec);
    });
    const names = Array.from(new Set(Object.keys(puts).concat(Object.keys(dels))
      .concat(setPuts.length || setDels.length ? ['settings'] : [])));
    await CRM.db.run(names, 'readwrite', (stores) => {
      Object.keys(puts).forEach((n) => puts[n].forEach((r) => stores[n].put(r)));
      Object.keys(dels).forEach((n) => dels[n].forEach((id) => stores[n].delete(id)));
      setPuts.forEach((s) => stores.settings.put(s));
      setDels.forEach((k) => stores.settings.delete(k));
    });
    Object.keys(puts).forEach((n) => { puts[n].forEach((r) => cache[n].set(r.id, r)); emit(n); });
    for (const n of Object.keys(dels)) {
      dels[n].forEach((id) => cache[n].delete(id));
      emit(n);
      if (n === 'tasks') for (const id of dels[n]) await removeAttachmentsOfTask(id);
    }
    setPuts.forEach((s) => settings.set(s.key, s.value));
    setDels.forEach((k) => settings.delete(k));
    if (setPuts.length || setDels.length) emit('settings');
  }

  /**
   * Замінити синхронізовані сховища даними з хмари (перший вхід на пристрої).
   * byStore: { tasks: [...], ... } для перелічених names; settingsKV: { key: value } для syncKeys.
   * Вкладення, сповіщення й курси лишаються; вкладення без задачі прибираються.
   */
  async function replaceSynced(names, byStore, syncKeys, settingsKV) {
    await CRM.db.run(names.concat(['settings']), 'readwrite', (stores) => {
      names.forEach((n) => { stores[n].clear(); (byStore[n] || []).forEach((r) => stores[n].put(r)); });
      syncKeys.forEach((k) => {
        if (Object.prototype.hasOwnProperty.call(settingsKV, k)) stores.settings.put({ key: k, value: settingsKV[k] });
        else stores.settings.delete(k);
      });
    });
    names.forEach((n) => { cache[n] = new Map((byStore[n] || []).map((r) => [r.id, r])); });
    syncKeys.forEach((k) => {
      if (Object.prototype.hasOwnProperty.call(settingsKV, k)) settings.set(k, settingsKV[k]); else settings.delete(k);
    });
    const orphans = Array.from(attachments.values()).filter((a) => !cache.tasks.has(a.taskId)).map((a) => a.id);
    if (orphans.length) {
      await CRM.db.removeMany('attachments', orphans);
      orphans.forEach((id) => attachments.delete(id));
    }
    emit('*');
  }

  /** Оновити updatedAt усіх записів сховищ (без гачка) — щоб після імпорту саме вони «перемогли» в хмарі. */
  async function touchAll(names) {
    const now = new Date().toISOString();
    const byStore = {};
    names.forEach((n) => { byStore[n] = Array.from(cache[n].values()).map((r) => Object.assign({}, r, { updatedAt: now })); });
    await CRM.db.run(names, 'readwrite', (stores) => { names.forEach((n) => byStore[n].forEach((r) => stores[n].put(r))); });
    names.forEach((n) => byStore[n].forEach((r) => cache[n].set(r.id, r)));
  }

  async function storageEstimate() {
    try {
      if (navigator.storage && navigator.storage.estimate) return await navigator.storage.estimate();
    } catch (e) { /* ігноруємо */ }
    return null;
  }

  CRM.store = {
    APP_ID, SCHEMA_VERSION, MAX_ATTACHMENT, TRASH_DAYS, DATA_STORES,
    load, on, emit, list, get, count, save, saveMany, patch, removeForever,
    softDelete, restoreBatch, purgeBatch, trashItems, purgeExpired,
    listAttachments, addAttachment, getAttachmentBlob, removeAttachment,
    getSetting, setSetting, getRate, allRates, saveRate, saveRates,
    exportAll, validateDump, summarize, importAll, replaceAll, clearAll, storageEstimate,
    setSyncHook, applyRemote, replaceSynced, touchAll
  };
})(window.CRM);
