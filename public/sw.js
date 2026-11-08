/*
 * Service Worker Walt P2P Терминала.
 *
 * Децентрализация на стороне клиента: после первой загрузки приложение
 * живёт из кеша — обновление курсов идёт прямо из браузера в P2P API Walt,
 * а оболочка терминала доступна даже без сети и без нашего сервера.
 *
 * Стратегии:
 *  - иконки и манифест — cache-first (по-настоящему статические файлы);
 *  - чанки /_next/static и навигация — network-first с откатом в кеш:
 *    всегда свежий код, а офлайн работает из кеша;
 *  - сторонние запросы (p2p.walletbot.me, прокси) не перехватываем.
 *
 * © 2026 Дуплей Максим Игоревич (maestro7it, quadd4rv1n7).
 * Код является интеллектуальной собственностью автора. Лицензия MIT.
 */

const CACHE = "p2p-terminal-v2";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(["/", "/manifest.webmanifest", "/icons/icon-192.png"]))
      .catch(() => {}),
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
      await self.clients.claim();
    })(),
  );
});

self.addEventListener("message", (event) => {
  if (event.data === "skip-waiting") self.skipWaiting();
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  try {
    const res = await fetch(request);
    if (res && res.ok) {
      const cache = await caches.open(CACHE);
      cache.put(request, res.clone());
    }
    return res;
  } catch (e) {
    return new Response("", { status: 504, statusText: "Offline" });
  }
}

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const res = await fetch(request);
    if (res && res.ok) cache.put(request, res.clone());
    return res;
  } catch (e) {
    const cached = await cache.match(request);
    if (cached) return cached;
    if (request.mode === "navigate") {
      const shell = await cache.match("/");
      if (shell) return shell;
    }
    return new Response("", { status: 504, statusText: "Offline" });
  }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  let url;
  try {
    url = new URL(req.url);
  } catch {
    return;
  }
  // чужие домены (P2P API, CORS-прокси, шрифты CDN) — не мешаем
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/icons/") || url.pathname === "/manifest.webmanifest") {
    event.respondWith(cacheFirst(req));
    return;
  }

  // /_next/static и всё остальное — network-first: свежий код, офлайн — из кеша
  event.respondWith(networkFirst(req));
});
