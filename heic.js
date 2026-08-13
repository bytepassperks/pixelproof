const HEIC_TYPES = new Set(["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"]);
const WORKER_TIMEOUT_MS = 30_000;

export function isHeic(file) {
  return HEIC_TYPES.has((file.type || "").toLowerCase()) || /\.(heic|heif)$/i.test(file.name || "");
}

export function decodeHeic(file, onProgress = () => {}) {
  const worker = new Worker("./heic-decoder-worker.js");
  onProgress("Loading the HEIC decoder locally…");
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      worker.terminate();
      reject(new Error("HEIC decoder timed out."));
    }, WORKER_TIMEOUT_MS);
    worker.onmessage = (event) => {
      clearTimeout(timeout);
      worker.terminate();
      if (event.data.error) reject(new Error(`HEIC decode failed: ${event.data.error}`));
      else resolve(event.data);
    };
    worker.onerror = (event) => {
      clearTimeout(timeout);
      worker.terminate();
      reject(event.error || new Error("HEIC decoder worker failed"));
    };
    file.arrayBuffer().then((buffer) => worker.postMessage({buffer}, [buffer]), (error) => {
      clearTimeout(timeout);
      worker.terminate();
      reject(error);
    });
  });
}
