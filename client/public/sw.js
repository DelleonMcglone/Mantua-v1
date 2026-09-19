/**
 * Task 071 (Phase 15, MX-004 / MX-007) — the Mantua service worker.
 *
 * Two jobs and nothing else:
 *
 * 1. Push. A push carries a small JSON payload the server encrypted for
 *    this browser (server/src/lib/push/send.ts `payloadFor`); it is shown
 *    as a notification and a tap opens the app at the payload's URL,
 *    focusing an open window when there is one.
 *
 * 2. Offline resilience for the installed app. Hashed build assets
 *    (`/assets/*-<hash>.*`) are immutable, so they are cached on first use
 *    and served from cache after. Navigations go network-first with the
 *    last good shell as the offline fallback. Nothing under `/api/` is
 *    ever cached — prices, positions and balances are always live, and a
 *    stale price shown as current would be worse than no price.
 *
 * A static file on our own origin, so the CSP's `worker-src 'self'` covers it.
 */
const CACHE = "mantua-shell-v1";
const SHELL = "/";

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.add(new Request(SHELL, { cache: "reload" })))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

const isHashedAsset = (url) =>
  url.origin === self.location.origin &&
  /^\/assets\/[^/]+-[A-Za-z0-9_-]{6,}\.[a-z0-9]+$/.test(url.pathname);

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.pathname.startsWith("/api/")) return; // always live, never cached

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches
            .open(CACHE)
            .then((cache) => cache.put(SHELL, copy))
            .catch(() => undefined);
          return res;
        })
        .catch(() => caches.match(SHELL).then((hit) => hit ?? Response.error())),
    );
    return;
  }

  if (isHashedAsset(url)) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ??
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches
                .open(CACHE)
                .then((cache) => cache.put(req, copy))
                .catch(() => undefined);
            }
            return res;
          }),
      ),
    );
  }
});

self.addEventListener("push", (event) => {
  let data = { title: "Mantua", body: "", url: "/", tag: undefined };
  try {
    if (event.data) data = { ...data, ...event.data.json() };
  } catch {
    // An unreadable payload still shows the app name rather than nothing.
  }
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      tag: data.tag,
      icon: "/assets/icon-192.png",
      badge: "/assets/icon-192.png",
      data: { url: data.url },
      renotify: false,
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url ?? "/", self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      const open = wins.find((w) => new URL(w.url).origin === self.location.origin);
      if (open) return open.navigate(target).then((w) => (w ?? open).focus());
      return self.clients.openWindow(target);
    }),
  );
});
