const CACHE = 'ggnotes-cache-v1';
const ASSETS = [
  '/', '/index.html', '/styles.css', '/app.js', '/manifest.json'
];

self.addEventListener('install', evt=>{
  evt.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', evt=>{
  evt.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', evt=>{
  const req = evt.request;
  if(req.method !== 'GET') return;
  evt.respondWith(caches.match(req).then(r=> r || fetch(req).then(resp=>{
    if(resp && resp.status===200 && req.url.startsWith(self.location.origin)){
      const copy = resp.clone(); caches.open(CACHE).then(c=>c.put(req, copy));
    }
    return resp;
  }).catch(()=>caches.match('/index.html'))));
});
