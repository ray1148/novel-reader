// Service Worker：讓網頁「秒開」並支援離線，同時確保能拿到新版。
// 策略：
//  - 前台頁面與其他檔案：stale-while-revalidate（先給快取、背景更新），開啟不必等網路。
//  - 後台頁面（admin / admin.html）：網路優先，連不上才用快取。後台不求秒開，但一定要拿到最新版，
//    避免被舊的快取（例如舊版的跳轉頁）卡住，結果開出來是前台畫面。
// 只處理同網域的 GET 請求，Firebase / Anthropic / Google 等外部連線一律不碰。
const CACHE = 'novel-reader-shell-v3';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function notifyUpdated() {
  const all = await self.clients.matchAll({ type: 'window' });
  all.forEach(c => c.postMessage({ type: 'nr-updated' }));
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const isAdmin = /(^|\/)admin(\.html)?\/?$/i.test(url.pathname);

  if (isAdmin) {
    // 後台：網路優先
    e.respondWith((async () => {
      const cache = await caches.open(CACHE);
      try {
        const res = await fetch(req, { cache: 'no-cache' });
        if (res && res.ok) cache.put(req, res.clone());
        return res;
      } catch (err) {
        return (await cache.match(req)) || Response.error();
      }
    })());
    return;
  }

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req, { ignoreSearch: true });
    const refresh = fetch(req, { cache: 'no-cache' }).then(async res => {
      if (res && res.ok) {
        let changed = false;
        if (cached) {
          const a = await cached.clone().text();
          const b = await res.clone().text();
          changed = a !== b;
        }
        await cache.put(req, res.clone());
        if (changed && (req.mode === 'navigate' || url.pathname.endsWith('.html') || url.pathname.endsWith('/'))) notifyUpdated();
      }
      return res;
    }).catch(() => null);

    if (cached) { e.waitUntil(refresh); return cached; }
    const res = await refresh;
    return res || (await cache.match('./')) || Response.error();
  })());
});
