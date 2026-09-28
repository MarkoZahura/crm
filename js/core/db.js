/* ==========================================================================
   db.js — робота з IndexedDB (база даних у браузері).
   Тут лише «низький рівень»: відкрити базу, прочитати, записати, видалити.
   Логіка застосунку — у store.js.
   ========================================================================== */
window.CRM = window.CRM || {};

(function (CRM) {
  'use strict';

  const DB_NAME = 'personal-crm';
  const DB_VERSION = 1;

  /** Схема сховищ. Змінюючи схему, збільш DB_VERSION і додай міграцію в onupgradeneeded. */
  const SCHEMA = {
    settings: { keyPath: 'key' },
    tasks: { keyPath: 'id' },
    attachments: { keyPath: 'id', indexes: [['taskId', 'taskId']] },
    accounts: { keyPath: 'id' },
    transactions: { keyPath: 'id', indexes: [['date', 'date'], ['accountId', 'accountId']] },
    categories: { keyPath: 'id' },
    recurring: { keyPath: 'id' },
    goals: { keyPath: 'id' },
    workouts: { keyPath: 'id', indexes: [['date', 'date']] },
    courses: { keyPath: 'id' },
    notifications: { keyPath: 'id' },
    rates: { keyPath: 'date' }
  };

  let dbPromise = null;

  function reqToPromise(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window) || !window.indexedDB) {
        reject(new Error('Цей браузер не підтримує IndexedDB.'));
        return;
      }
      let req;
      try {
        req = indexedDB.open(DB_NAME, DB_VERSION);
      } catch (e) {
        reject(e);
        return;
      }
      req.onupgradeneeded = () => {
        const db = req.result;
        Object.keys(SCHEMA).forEach((name) => {
          const def = SCHEMA[name];
          let store;
          if (!db.objectStoreNames.contains(name)) {
            store = db.createObjectStore(name, { keyPath: def.keyPath });
          } else {
            store = req.transaction.objectStore(name);
          }
          (def.indexes || []).forEach(([idx, path]) => {
            if (!store.indexNames.contains(idx)) store.createIndex(idx, path, { unique: false });
          });
        });
      };
      req.onsuccess = () => {
        const db = req.result;
        // Якщо сайт відкрито в іншій вкладці з новішою версією — закриваємо з'єднання.
        db.onversionchange = () => { db.close(); };
        resolve(db);
      };
      req.onerror = () => reject(req.error || new Error('Не вдалося відкрити базу даних.'));
      req.onblocked = () => reject(new Error('Базу даних заблоковано іншою вкладкою. Закрий інші вкладки з цим сайтом і онови сторінку.'));
    });
    return dbPromise;
  }

  /** Виконати дії в одній транзакції; Promise завершується, коли транзакція записана. */
  async function run(storeNames, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(storeNames, mode);
      let result;
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Транзакцію скасовано'));
      const stores = Array.isArray(storeNames)
        ? storeNames.reduce((acc, n) => { acc[n] = tx.objectStore(n); return acc; }, {})
        : tx.objectStore(storeNames);
      result = fn(stores, tx);
    });
  }

  async function getAll(store) {
    const db = await open();
    return reqToPromise(db.transaction(store, 'readonly').objectStore(store).getAll());
  }

  async function get(store, key) {
    const db = await open();
    return reqToPromise(db.transaction(store, 'readonly').objectStore(store).get(key));
  }

  function put(store, value) { return run(store, 'readwrite', (s) => { s.put(value); }); }

  function putMany(store, values) {
    return run(store, 'readwrite', (s) => { values.forEach((v) => s.put(v)); });
  }

  function remove(store, key) { return run(store, 'readwrite', (s) => { s.delete(key); }); }

  function removeMany(store, keys) {
    return run(store, 'readwrite', (s) => { keys.forEach((k) => s.delete(k)); });
  }

  function clear(store) { return run(store, 'readwrite', (s) => { s.clear(); }); }

  /** Замінити вміст кількох сховищ за одну транзакцію (для імпорту й демо-даних). */
  function replaceStores(data) {
    const names = Object.keys(data);
    return run(names, 'readwrite', (stores) => {
      names.forEach((n) => {
        stores[n].clear();
        (data[n] || []).forEach((v) => stores[n].put(v));
      });
    });
  }

  async function getByIndex(store, index, value) {
    const db = await open();
    return reqToPromise(db.transaction(store, 'readonly').objectStore(store).index(index).getAll(value));
  }

  CRM.db = {
    DB_NAME, DB_VERSION, SCHEMA,
    STORE_NAMES: Object.keys(SCHEMA),
    open, run, getAll, get, put, putMany, remove, removeMany, clear, replaceStores, getByIndex
  };
})(window.CRM);
