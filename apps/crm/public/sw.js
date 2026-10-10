/*
 * HOME88 CRM service worker.
 *
 * What it does, and what it deliberately does not:
 *  - Keeps the app's own static files (scripts, styles, icons) so the CRM opens
 *    quickly and the offline page works with no network at all.
 *  - When a page cannot be reached, shows the offline page, where an agent can
 *    keep registering a property on the device.
 *  - Never stores a CRM page or an API answer: those hold personal and business
 *    data and always come live from the server. Data kept for offline work lives
 *    in IndexedDB, written by the app itself, and is cleared at logout.
 *  - Does not upload anything in the background: synchronisation runs in an open
 *    CRM page, where the agent sees it.
 */

const VERSION = "1";
const BASE = new URL(self.registration.scope).pathname.replace(/\/$/, "");
const SHELL = `h88-shell-${VERSION}`;
const STATIC = `h88-static-${VERSION}`;
const OFFLINE_URL = `${BASE}/offline`;
const MAX_STATIC_ENTRIES = 400;

/** Every static file the offline page's HTML refers to, as same-origin paths. */
function assetsOf(html) {
  const found = new Set();
  for (const m of html.matchAll(/\/_next\/static\/[^"'\s\\)<>]+/g)) found.add(`${BASE}${m[0]}`);
  for (const m of html.matchAll(/(?<![\w/])static\/(?:chunks|css|media)\/[^"'\s\\)<>]+/g)) found.add(`${BASE}/_next/${m[0]}`);
  return [...found].map((u) => u.replace(/&amp;/g, "&"));
}

async function precache() {
  const shell = await caches.open(SHELL);
  const response = await fetch(OFFLINE_URL, { cache: "no-store", credentials: "omit" });
  if (!response.ok) throw new Error(`offline page: ${response.status}`);
  const html = await response.clone().text();
  await shell.put(OFFLINE_URL, response);
  const files = await caches.open(STATIC);
  const wanted = [...assetsOf(html), `${BASE}/pwa/icon-192.png`, `${BASE}/pwa/icon-512.png`];
  await Promise.all(
    wanted.map(async (url) => {
      try {
        const r = await fetch(url, { credentials: "omit" });
        if (r.ok) await files.put(url, r);
      } catch {
        /* one missing file must not stop the install; it is fetched again when used */
      }
    }),
  );
}

self.addEventListener("install", (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key.startsWith("h88-") && key !== SHELL && key !== STATIC) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

async function trim(cache) {
  const keys = await cache.keys();
  for (const key of keys.slice(0, Math.max(0, keys.length - MAX_STATIC_ENTRIES))) await cache.delete(key);
}

/** Hashed build files never change, so a stored copy is always right. */
async function cacheFirst(request) {
  const cache = await caches.open(STATIC);
  const hit = await cache.match(request, { ignoreVary: true });
  if (hit) return hit;
  const response = await fetch(request);
  if (response.ok && response.type === "basic") {
    await cache.put(request, response.clone());
    void trim(cache);
  }
  return response;
}

async function pageOrOffline(request) {
  try {
    return await fetch(request);
  } catch {
    const offline = await caches.match(OFFLINE_URL);
    return offline ?? new Response("Δεν υπάρχει σύνδεση.", { status: 503, headers: { "content-type": "text/plain; charset=utf-8" } });
  }
}

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || !(url.pathname === BASE || url.pathname.startsWith(`${BASE}/`))) return;
  // Data is never cached here: it is personal, and it must be current.
  if (url.pathname.startsWith(`${BASE}/api/`)) return;
  if (url.pathname.startsWith(`${BASE}/_next/static/`) || url.pathname.startsWith(`${BASE}/pwa/`) || url.pathname.startsWith(`${BASE}/brand/`)) {
    event.respondWith(cacheFirst(request));
    return;
  }
  if (request.mode === "navigate") event.respondWith(pageOrOffline(request));
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "h88:clear") {
    event.waitUntil(
      (async () => {
        for (const key of await caches.keys()) if (key.startsWith("h88-")) await caches.delete(key);
      })(),
    );
  }
});
