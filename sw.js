/* ==========================================================================
   sw.js — «помічник у фоні» (service worker) застосунку «Моя CRM».

   Що робить:
   • зберігає копію файлів сайту → CRM відкривається миттєво й без інтернету;
   • нову версію бере, лише коли ВСІ її файли на місці й збігаються з
     контрольними сумами нижче (захист від неповного завантаження на GitHub);
     тоді сторінка показує плашку «Є нова версія · Оновити»;
   • Chart.js і Firebase з jsDelivr — теж зберігає (адреси з номером версії
     не змінюються), шрифти Google — оновлює у фоні.
   Дані CRM (IndexedDB) помічник не чіпає. Запити до Google, Firebase і НБУ
   йдуть у мережу як звичайно.

   Блок між позначками нижче генерує скрипт tests/make-sw.js (у проєкті
   Claude): він рахує sha256 кожного файлу сайту. Будь-яка зміна файлу →
   новий sw.js → браузер помічає нову версію. Вручну цей блок не правити.
   ========================================================================== */
'use strict';

// ---- АВТОМАТИЧНИЙ БЛОК (tests/make-sw.js) ----
const VERSION = '2026.10.29-2';
const BUILD = '3858e9f10e68';
const FILES = {
  'css/base.css': '19e80512c54e49e6',
  'css/components.css': '1f94a2f41c9beef3',
  'css/layout.css': '4d4476a29ada4d90',
  'css/sections.css': '74314b8654fb12c9',
  'icons/apple-touch-icon.png': 'f47bedd3e5d0ffb1',
  'icons/icon-192.png': 'f7cb5b0b096a8c5b',
  'icons/icon-512.png': '829fcd6660b3adcc',
  'icons/icon-maskable-512.png': 'cac5a3418e880e15',
  'icons/ring-192.png': '3c4eb5adb96499bf',
  'icons/ring-512.png': 'b1eeb7f14e3f400b',
  'icons/ring-apple-touch-icon.png': 'b6e90ef50c27270c',
  'icons/ring-maskable-512.png': '36d6b300b2bb5704',
  'icons/tiles-192.png': '21c89d5fa7e30fb1',
  'icons/tiles-512.png': 'e9bb21ac87c5e125',
  'icons/tiles-apple-touch-icon.png': '9454b72f51288974',
  'icons/tiles-maskable-512.png': '28ae91bcaf8a45f5',
  'index.html': '87fa5a6dcda8e31e',
  'js/app.js': 'fee84a60ba376ddb',
  'js/backup.js': 'd63f11891c0a78e0',
  'js/budget/accounts.js': '2df8f4fb9c0059fa',
  'js/budget/analytics.js': 'ecbea03d4333b25a',
  'js/budget/budget.js': 'e7861c87a81d8318',
  'js/budget/capital.js': 'deda6c6aefab6213',
  'js/budget/categories.js': '68ebd8e9622bade8',
  'js/budget/dashboard.js': '91fd9c86d7dfbca3',
  'js/budget/finance.js': 'd2d86c3b2b2f6a17',
  'js/budget/goals.js': '56c2aee704dec399',
  'js/budget/import.js': 'fa75950e41c6a6d1',
  'js/budget/recurring.js': '5277ce94419c5920',
  'js/budget/transactions.js': '2b26af9572534556',
  'js/calendar.js': '6537f76d6aa7bb25',
  'js/core/charts.js': 'b18bc9cd948e68cb',
  'js/core/db.js': 'b05dc80015e15911',
  'js/core/defaults.js': '32223999b81941f4',
  'js/core/entities.js': 'bdf7866d952bd8a0',
  'js/core/icons.js': '70d6a48224255bd0',
  'js/core/rates.js': 'ab9f062afb6292f6',
  'js/core/router.js': '3b4260417c6530e1',
  'js/core/schedule.js': '4f1d1d89f224b8c6',
  'js/core/store.js': '055384d023d8916e',
  'js/core/ui.js': '0b4af79cb3746b18',
  'js/core/utils.js': '92718eb6f9b9d30e',
  'js/demo.js': '308e44393ef85dc8',
  'js/gcal.js': 'b9312ba466c12e4d',
  'js/habits.js': 'e21f72a841eef3de',
  'js/home.js': 'addf96bb9e1af42e',
  'js/learning.js': 'f032d633405e9aff',
  'js/notifications.js': 'f194853373c640ea',
  'js/nutrition.js': '92def9b3e17a25a4',
  'js/people.js': '548d6c6026486fee',
  'js/profile.js': '96af8cfa0d9a668e',
  'js/program.js': '394ed56868fae621',
  'js/programs.js': '17e17a1f639bf04a',
  'js/pwa.js': '1a2b7b190c0e99b6',
  'js/quick.js': 'd3701fda55522fc9',
  'js/quotes.js': '57b3b169ce3e9dcb',
  'js/search.js': 'b6d692ed7659fc8a',
  'js/sync-config.js': '6e4963577579c35a',
  'js/sync.js': '7fc2e602ce7ecbd4',
  'js/tasks.js': 'c6509552bf4f3474',
  'js/training.js': '057239b930aadc95',
  'js/trash.js': '7ad01ec7851cf561',
  'manifest-c.json': '6bec32309f09144a',
  'manifest-tiles.json': 'a5d3ba9581552a4b',
  'manifest.json': '7f3be59507fe8ac5'
};
const CDN = [
  'https://cdn.jsdelivr.net/npm/chart.js@4.5.1/dist/chart.umd.min.js',
  'https://cdn.jsdelivr.net/npm/firebase@12.19.0/firebase-app-compat.js',
  'https://cdn.jsdelivr.net/npm/firebase@12.19.0/firebase-auth-compat.js',
  'https://cdn.jsdelivr.net/npm/firebase@12.19.0/firebase-firestore-compat.js'
];
// ---- КІНЕЦЬ АВТОМАТИЧНОГО БЛОКУ ----

const APP_CACHE = 'crm-app-' + VERSION + '-' + BUILD;
const CDN_CACHE = 'crm-cdn';
const FONT_CACHE = 'crm-fonts';
const BASE = new URL('./', self.location).href; // напр., https://markozahura.github.io/crm/
const BASE_PATH = new URL(BASE).pathname;

/** Перші 16 символів sha256 (hex) — як у FILES. */
async function hash16(buf) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', buf));
  let s = '';
  for (let i = 0; i < 8; i++) s += d[i].toString(16).padStart(2, '0');
  return s;
}

async function tell(msg) {
  try {
    const list = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    list.forEach((c) => c.postMessage(msg));
  } catch (e) { /* немає відкритих вкладок */ }
}

/** Той самий файл (та сама сума) з попередньої версії — щоб не завантажувати вдруге. */
async function fromOld(path, hash) {
  const keys = await caches.keys();
  for (const key of keys) {
    if (!key.startsWith('crm-app-') || key === APP_CACHE) continue;
    const r = await (await caches.open(key)).match(BASE + path);
    if (r && r.headers.get('X-CRM-Hash') === hash) return r;
  }
  return null;
}

async function install() {
  const cache = await caches.open(APP_CACHE);
  const problems = [];
  await Promise.all(Object.keys(FILES).map(async (path) => {
    const hash = FILES[path];
    try {
      let res = await fromOld(path, hash);
      if (!res) {
        // ?v=… і cache: 'reload' — повз кеш браузера й CDN, щоб узяти саме нову версію файлу
        const r = await fetch(BASE + path + '?v=' + hash, { cache: 'reload' });
        if (!r.ok) { problems.push({ path, why: r.status === 404 ? 'missing' : 'http', status: r.status }); return; }
        const buf = await r.arrayBuffer();
        if (await hash16(buf) !== hash) { problems.push({ path, why: 'different' }); return; }
        res = new Response(buf, { status: 200, headers: { 'Content-Type': r.headers.get('Content-Type') || 'application/octet-stream', 'X-CRM-Hash': hash } });
      }
      await cache.put(BASE + path, res);
    } catch (e) {
      problems.push({ path, why: 'network' });
    }
  }));
  if (problems.length) {
    await caches.delete(APP_CACHE);
    await tell({ type: 'crm-sw-failed', version: VERSION, offline: problems.every((p) => p.why === 'network'), problems });
    throw new Error('CRM ' + VERSION + ': не всі файли нової версії на місці');
  }
  // Бібліотеки з jsDelivr — не обовʼязково (без них CRM теж працює)
  try {
    const c = await caches.open(CDN_CACHE);
    await Promise.all(CDN.map(async (url) => {
      try {
        if (await c.match(url)) return;
        const r = await fetch(url, { mode: 'cors', credentials: 'omit' });
        if (r.ok) await c.put(url, r);
      } catch (e) { /* спробуємо при наступному запиті */ }
    }));
  } catch (e) { /* не критично */ }
  await tell({ type: 'crm-sw-installed', version: VERSION });
}

self.addEventListener('install', (event) => { event.waitUntil(install()); });

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('crm-app-') && k !== APP_CACHE).map((k) => caches.delete(k)));
    try {
      const c = await caches.open(CDN_CACHE);
      const reqs = await c.keys();
      await Promise.all(reqs.filter((r) => !CDN.includes(r.url)).map((r) => c.delete(r)));
    } catch (e) { /* не критично */ }
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  const d = event.data || {};
  const reply = (msg) => { if (event.ports && event.ports[0]) event.ports[0].postMessage(msg); };
  if (d.type === 'skipWaiting') self.skipWaiting();
  else if (d.type === 'version') reply({ version: VERSION });
  else if (d.type === 'files') reply({ version: VERSION, files: FILES });
});

// ---------- Відповіді на запити ----------
async function appFile(req, path) {
  const hit = await (await caches.open(APP_CACHE)).match(BASE + path);
  return hit || fetch(req); // збережену копію браузер міг видалити — тоді з мережі
}

async function cdnFile(req) {
  const c = await caches.open(CDN_CACHE);
  const hit = await c.match(req.url);
  if (hit) return hit;
  const r = await fetch(req);
  if (r.ok && (r.type === 'cors' || r.type === 'basic')) c.put(req.url, r.clone()).catch(() => {});
  return r;
}

async function fontFile(event, req) {
  const c = await caches.open(FONT_CACHE);
  const hit = await c.match(req);
  const net = fetch(req).then((r) => {
    if (r.ok || r.type === 'opaque') c.put(req, r.clone()).catch(() => {});
    return r;
  }).catch(() => null);
  if (hit) { event.waitUntil(net); return hit; }
  return (await net) || Response.error();
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    if (!url.pathname.startsWith(BASE_PATH) || url.searchParams.has('fresh')) return; // ?fresh — звірка з сайтом
    let path = decodeURIComponent(url.pathname.slice(BASE_PATH.length));
    if (req.mode === 'navigate' && path === '') path = 'index.html';
    if (!Object.prototype.hasOwnProperty.call(FILES, path)) return; // README тощо — з мережі
    event.respondWith(appFile(req, path));
    return;
  }
  if (CDN.includes(url.href)) { event.respondWith(cdnFile(req)); return; }
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') event.respondWith(fontFile(event, req));
});
