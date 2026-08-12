const CACHE = 'ggnotes-cache-v5';
const ASSETS = [
  '/', '/index.html', '/styles.css', '/app.js', '/manifest.json', '/icon.svg'
];

self.addEventListener('install', evt=>{
  evt.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));
  self.skipWaiting();
});

// Usuwamy WSZYSTKIE stare cache przy aktywacji nowej wersji,
// aby nigdy nie serwować nieaktualnego app.js/index.html.
self.addEventListener('activate', evt=>{
  evt.waitUntil((async ()=>{
    const keys = await caches.keys();
    await Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)));
    await self.clients.claim();
  })());
});

// Strategia "network-first": zawsze próbujemy pobrać najnowszą wersję z sieci.
// Jeśli sieć zawiedzie (offline), korzystamy z lokalnego cache jako zapasu.
// Dzięki temu aktualizacje aplikacji są widoczne natychmiast, a offline nadal działa.
self.addEventListener('fetch', evt=>{
  const req = evt.request;
  if(req.method !== 'GET') return;
  if(!req.url.startsWith(self.location.origin)) return;

  evt.respondWith(
    fetch(req).then(resp=>{
      if(resp && resp.status===200){
        const copy = resp.clone();
        caches.open(CACHE).then(c=>c.put(req, copy));
      }
      return resp;
    }).catch(async ()=>{
      const cached = await caches.match(req, { cacheName: CACHE });
      return cached || caches.match('/index.html', { cacheName: CACHE });
    })
  );
});
