const CACHE = 'ggnotes-cache-v9';
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

// Strategia "stale-while-revalidate": odpowiadamy NATYCHMIAST z lokalnego cache
// (brak opóźnienia przy każdym przejściu/ładowaniu), a w tle pobieramy najnowszą
// wersję z sieci i aktualizujemy cache na potrzeby kolejnego odświeżenia.
// Jeśli w cache nic nie ma (pierwsze uruchomienie), czekamy na sieć.
self.addEventListener('fetch', evt=>{
  const req = evt.request;
  if(req.method !== 'GET') return;
  if(!req.url.startsWith(self.location.origin)) return;

  evt.respondWith((async ()=>{
    const cached = await caches.match(req, { cacheName: CACHE });
    const networkFetch = fetch(req).then(resp=>{
      if(resp && resp.status===200){
        caches.open(CACHE).then(c=>c.put(req, resp.clone()));
      }
      return resp;
    }).catch(()=>null);

    if(cached) return cached;

    const fresh = await networkFetch;
    return fresh || caches.match('/index.html', { cacheName: CACHE });
  })());
});
