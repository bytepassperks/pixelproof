import {PRODUCT} from "./config.js";

export const MODEL_CACHE = "pixelproof-model-cache-v1";
export const RECOVERY_DB = "pixelproof-recovery";
export const RECOVERY_RETENTION_MS = 24 * 60 * 60 * 1000;

export const MODEL_INTEGRITY = Object.freeze({
  "efficient-sam-vitt-encoder.onnx":
    "84ed466ffcc5c1f8d08409bc34a23bb364ab2c15e402cb12d4335a42be0e0951",
  "efficient-sam-vitt-decoder.onnx":
    "a62f8fa5ea080447c0689418d69e58f1e83e0b7adf9c142e2bd9bcc8045c0b11",
  "model.onnx":
    "bf28d2e0be2c073286e88d60ad649d7123da2749a2d99133fd1098d5887e0225",
});

const APP_ORIGIN = location.origin;
const ALLOWED_HOSTS = new Set([
  location.host,
  new URL(PRODUCT.workerUrl).host,
  new URL(PRODUCT.modelMirrorUrl).host,
  "huggingface.co",
  "cdn.jsdelivr.net",
  "us.aws.cdn.hf.co",
]);

function bytesToHex(bytes) {
  return [...new Uint8Array(bytes)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function verifyIntegrity(buffer, expected) {
  if (!expected || !crypto?.subtle) return false;
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return bytesToHex(digest) === expected;
}

export function modelName(url) {
  return new URL(url).pathname.split("/").filter(Boolean).pop() || "model.onnx";
}

export function resourceSnapshot() {
  const resources = performance.getEntriesByType("resource").map((entry) => {
    let url;
    try {
      url = new URL(entry.name);
    } catch {
      return null;
    }
    if (url.protocol === "blob:") return null;
    return {
      url: entry.name,
      host: url.host || "(local)",
      allowed: url.origin === APP_ORIGIN || ALLOWED_HOSTS.has(url.host),
      initiator: entry.initiatorType || "unknown",
      bytes: entry.transferSize || 0,
    };
  }).filter(Boolean);
  const external = resources.filter((item) => item.host !== location.host);
  return {resources, external, allowed: external.every((item) => item.allowed)};
}

function readStorageBytes() {
  let localBytes = 0;
  for (let index = 0; index < localStorage.length; index += 1) {
    const key = localStorage.key(index);
    localBytes += (key?.length || 0) + (localStorage.getItem(key) || "").length;
  }
  return localBytes;
}

async function recoveryBytes() {
  if (!("indexedDB" in window)) return 0;
  return new Promise((resolve) => {
    const request = indexedDB.open(RECOVERY_DB);
    request.onerror = () => resolve(0);
    request.onsuccess = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains("outputs")) return resolve(0);
      const get = db.transaction("outputs", "readonly").objectStore("outputs").getAll();
      get.onerror = () => resolve(0);
      get.onsuccess = () => resolve(get.result.reduce((sum, item) => {
        const bytes = item.bytes?.byteLength || item.bytes?.length || 0;
        return sum + bytes;
      }, 0));
    };
  });
}

async function modelCacheBytes() {
  if (!("caches" in window)) return 0;
  try {
    const cache = await caches.open(MODEL_CACHE);
    const requests = await cache.keys();
    let total = 0;
    for (const request of requests) {
      const response = await cache.match(request);
      if (!response) continue;
      const contentLength = Number(response.headers.get("content-length"));
      total += contentLength || (await response.clone().arrayBuffer()).byteLength;
    }
    return total;
  } catch {
    return 0;
  }
}

export async function localDataSummary() {
  const [recovery, models] = await Promise.all([recoveryBytes(), modelCacheBytes()]);
  return {
    localStorage: readStorageBytes(),
    recovery,
    models,
    recoveryRetention: "up to 24 hours",
  };
}

export async function clearLocalData(category) {
  if (category === "recovery" || category === "all") {
    await new Promise((resolve) => {
      const request = indexedDB.deleteDatabase(RECOVERY_DB);
      request.onsuccess = request.onerror = request.onblocked = () => resolve();
    });
  }
  if (category === "models" || category === "all") {
    if ("caches" in window) await caches.delete(MODEL_CACHE);
  }
  if (category === "settings" || category === "all") {
    const keep = new Set(["pixelproof-license-key", "pixelproof-license-state"]);
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (key && !keep.has(key)) localStorage.removeItem(key);
    }
  }
  if (category === "licence" || category === "all") {
    localStorage.removeItem("pixelproof-license-key");
    localStorage.removeItem("pixelproof-license-state");
  }
}

export function privacySelfTestText() {
  const snapshot = resourceSnapshot();
  const external = snapshot.external.length
    ? snapshot.external.map((item) => `${item.host} (${item.initiator})`).join(", ")
    : "none observed in this page session";
  return {
    snapshot,
    summary: snapshot.allowed
      ? "No disallowed application resource was observed. Resource Timing cannot inspect request bodies; the application has no image-upload request."
      : "A resource outside the app allow-list was observed. Inspect it in DevTools before continuing.",
    external,
  };
}
