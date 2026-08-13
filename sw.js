const CACHE = "pixelproof-shell-20260812-66";
const SHELL = [
  "./",
  "./index.html",
  "./app.html",
  "./activate.html",
  "./styles.css",
  "./vendor/fonts/alternatives/PlusJakartaSans-Latin.woff2",
  "./app.js",
  "./landing.js",
  "./activation.js",
  "./background-removal.js",
  "./background-worker.js",
  "./vendor/onnxruntime/ort.min.mjs",
  "./vendor/onnxruntime/ort-wasm-simd-threaded.jsep.mjs",
  "./vendor/onnxruntime/ort-wasm-simd-threaded.jsep.wasm",
  "./vendor/onnxruntime/ort-wasm-simd-threaded.mjs",
  "./vendor/onnxruntime/ort-wasm-simd-threaded.wasm",
  "./config.js",
  "./entitlements.js",
  "./privacy.js",
  "./metadata.js",
  "./heic.js",
  "./registry.js",
  "./worker.js",
  "./heic-decoder-worker.js",
  "./zip.js",
  "./pdf.js",
  "./pdf-worker.js",
  "./manifest.webmanifest",
  "./favicon.svg",
  "./social-preview.svg",
  "./vendor/images/pixelproof-dog-hero-1024.webp",
  "./vendor/images/pixelproof-dog-hero-512.webp",
  "./vendor/images/pixelproof-sample-photo-cutout.png",
  "./vendor/images/pixelproof-comparison-cutout.webp",
  "./vendor/images/pixelproof-sample-photo.jpg",
  "./vendor/images/pixelproof-comparison-photo.jpg",
  "./privacy-policy.html",
  "./terms.html",
  "./refunds.html",
  "./contact.html",
  "./vendor/heic/libheif.js",
  "./vendor/heic/libheif.wasm",
  "./vendor/pdf-lib/pdf-lib.min.js",
  "./vendor/avif/encode.js",
  "./vendor/avif/meta.js",
  "./vendor/avif/utils.js",
  "./vendor/avif/codec/pre.js",
  "./vendor/avif/codec/enc/avif_enc.js",
  "./vendor/avif/codec/enc/avif_enc.wasm",
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
  if (
    request.method === "POST" &&
    new URL(request.url).pathname.endsWith("/app.html")
  ) {
    event.respondWith(receiveSharedFiles(request));
    return;
  }
  if (request.method !== "GET" || new URL(request.url).origin !== self.location.origin) return;
  if (request.mode === "navigate") {
    event.respondWith(fetch(request).catch(() => caches.match("./app.html")));
    return;
  }
  event.respondWith(
    fetch(request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((cache) => cache.put(request, copy));
        }
        return response;
      })
      .catch(() => caches.match(request)),
  );
});

async function receiveSharedFiles(request) {
  const form = await request.formData();
  const files = [...form.getAll("images")]
    .filter((file) => file instanceof File)
    .slice(0, 100)
    .map((file) => ({
      name: file.name,
      type: file.type,
      bytes: file.arrayBuffer(),
    }));
  const db = await new Promise((resolve, reject) => {
    const open = indexedDB.open("pixelproof-recovery", 2);
    open.onupgradeneeded = () => {
      const database = open.result;
      if (!database.objectStoreNames.contains("outputs"))
        database.createObjectStore("outputs", {keyPath: "id"});
      if (!database.objectStoreNames.contains("shared-files"))
        database.createObjectStore("shared-files", {keyPath: "id"});
    };
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
  const entries = await Promise.all(files.map(async (file) => ({
    id: crypto.randomUUID(),
    name: file.name,
    type: file.type,
    bytes: await file.bytes,
  })));
  await new Promise((resolve, reject) => {
    const transaction = db.transaction("shared-files", "readwrite");
    entries.forEach((entry) => transaction.objectStore("shared-files").put(entry));
    transaction.oncomplete = resolve;
    transaction.onerror = () => reject(transaction.error);
  });
  db.close();
  return Response.redirect(new URL("./app.html?shared=1", request.url), 303);
}
