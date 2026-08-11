const CACHE = "pixelproof-shell-20260811-8";
const SHELL = [
  "./",
  "./index.html",
  "./app.html",
  "./activate.html",
  "./styles.css",
  "./app.js",
  "./landing.js",
  "./activation.js",
  "./background-removal.js",
  "./background-worker.js",
  "./config.js",
  "./entitlements.js",
  "./metadata.js",
  "./heic.js",
  "./registry.js",
  "./worker.js",
  "./heic-decoder-worker.js",
  "./zip.js",
  "./manifest.webmanifest",
  "./vendor/heic/libheif.js",
  "./vendor/heic/libheif.wasm",
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))).then(() => self.clients.claim()),
  );
});
self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("./app.html")));
    return;
  }
  event.respondWith(caches.match(request).then((cached) => cached || fetch(request)));
});
