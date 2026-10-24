// Service Worker：讓網頁「秒開」並支援離線，同時確保能拿到新版。
// 策略 = stale-while-revalidate（先給快取、背景更新）：
//  - 開啟網頁時直接用上次存的版本，不必等網路（以前是「網路優先」，網路慢或不穩
//    時，要等到逾時才開得起來，這就是剛點進去會卡住的主要原因之一）。
//  - 同時在背景向網路重新抓一份；如果內容跟快取的不一樣，就存起來並通知網頁
//    「有新版本」，下次開啟（或重新整理）就會是新版。
// 只處理同網域的 GET 請求，Firebase / Anthropic / Google 等外部連線一律不碰。
const CACHE = 'novel-reader-shell-v2';

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

  e.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req, { ignoreSearch: true });

    // 背景更新：no-cache 讓瀏覽器一定向伺服器確認（避開 GitHub Pages 的短暫快取）
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

    if (cached) { e.waitUntil(refresh); return cached; }       // 有快取：立刻回，背景更新
    const res = await refresh;                                  // 第一次（沒快取）：只能等網路
    return res || (await cache.match('./')) || Response.error();
  })());
});
