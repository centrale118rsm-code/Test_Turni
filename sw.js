// Service worker dell'app autisti di PROVA: notifiche sul telefono e MODALITÀ OFFLINE.
// Senza rete l'app si apre lo stesso con l'ultimo calendario scaricato (sola lettura):
// pagina, librerie, caratteri ed Excel restano in una copia sul dispositivo.
// Con la rete si scarica sempre la versione nuova (pagina ed Excel: prima Internet, poi la copia).
// v7: modalità offline. Il nome della cache è solo di questa app: le app dello stesso sito
// (ufficiale autisti, infermieri) hanno le loro cache e non si toccano.
const CACHE_PREFIX = 'test-autisti-';   // AREA TEST: cache propria, non tocca quelle delle app vere
const CACHE_NAME = CACHE_PREFIX + 'v16';
const OLD_CACHES = [];   // AREA TEST: non cancella le cache delle altre app sullo stesso sito

const urlsToCache = [
  './',
  './index.html',
  './manifest.json?v=8',
  './logo.png',
  './icon-autisti3-512.png',
  './icon-autisti3-192.png',
  './area-test.js',
  './firebase-mock.js',
  './generatore-turni.js',
  './firebase-modular-shim.js'
];
// librerie e caratteri presi da Internet che servono anche senza rete
const CDN_HOSTS = ['www.gstatic.com', 'cdnjs.cloudflare.com', 'fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  // una risorsa che non si scarica non blocca l'installazione
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => Promise.all(urlsToCache.map((u) => cache.add(u).catch(() => {})))));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((names) => Promise.all(names
    .filter((n) => n !== CACHE_NAME && (n.startsWith(CACHE_PREFIX) || OLD_CACHES.includes(n)))
    .map((n) => caches.delete(n)))));
  return self.clients.claim();
});

// chiave senza "?v=123": l'app aggiunge un numero diverso a ogni apertura per evitare copie vecchie
function bareKey(url) { const u = new URL(url); u.search = ''; u.hash = ''; return u.href; }
function storable(res) { return res && (res.ok || res.type === 'opaque'); }

// Prima Internet; senza rete (o se il sito non risponde) la copia sul dispositivo
function networkFirst(event, key) {
  return fetch(event.request).then((res) => {
    if (res.ok) { const copy = res.clone(); event.waitUntil(caches.open(CACHE_NAME).then((c) => c.put(key, copy)).catch(() => {})); }
    return res;
  }).catch(() => caches.open(CACHE_NAME)
    .then((c) => c.match(key).then((r) => r || (event.request.mode === 'navigate' ? c.match(new URL('./index.html', self.registration.scope).href) : null)))
    .then((r) => r || Response.error()));
}
// Prima la copia (icone, librerie con il numero di versione, caratteri); se manca si scarica e si conserva
function cacheFirst(event) {
  return caches.open(CACHE_NAME).then((c) => c.match(event.request).then((hit) => hit || fetch(event.request).then((res) => {
    if (storable(res)) { const copy = res.clone(); event.waitUntil(c.put(event.request, copy).catch(() => {})); }
    return res;
  })));
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;   // salvataggi, audio/video a pezzi: niente copia
  const url = new URL(req.url);
  const sameSite = url.origin === self.location.origin;
  // Firebase (turni, accessi), GitHub e il resto vanno sempre in rete: i turni offline li tiene Firestore
  if (!sameSite && !CDN_HOSTS.includes(url.hostname)) return;
  if (url.hostname === 'www.gstatic.com' && !url.pathname.startsWith('/firebasejs/')) return;
  if (req.mode === 'navigate' || /\.(xlsx|xlsm|html?)$/i.test(url.pathname)) { event.respondWith(networkFirst(event, bareKey(req.url))); return; }
  if (sameSite && !/(\.(png|jpe?g|gif|svg|webp|ico|mp3)|\/manifest\.json)$/i.test(url.pathname)) { event.respondWith(networkFirst(event, bareKey(req.url))); return; }
  event.respondWith(cacheFirst(event));
});

// ═══ NOTIFICHE SUL TELEFONO (Web Push) ═══
// Le manda il motore su GitHub (.github/motore): arrivano anche ad app chiusa.
self.addEventListener('push', (event) => {
  let d = {};
  try { d = event.data ? event.data.json() : {}; } catch (e) { d = { body: event.data ? event.data.text() : '' }; }
  const title = d.title || 'Turni 118';
  event.waitUntil(self.registration.showNotification(title, {
    body: d.body || '',
    icon: 'icon-autisti3-192.png',
    badge: 'icon-autisti3-192.png',
    tag: d.tag || undefined,
    renotify: !!d.tag,
    data: { url: d.url || './' }
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || './', self.registration.scope).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
    for (const c of list) { if (c.url.startsWith(self.registration.scope) && 'focus' in c) return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
