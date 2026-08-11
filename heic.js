const HEIC_TYPES = new Set(["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"]);

export function isHeic(file) {
  return HEIC_TYPES.has((file.type || "").toLowerCase()) || /\.(heic|heif)$/i.test(file.name || "");
}

export function decodeHeic(file, onProgress = () => {}) {
  const worker = new Worker("./heic-decoder-worker.js");
  onProgress("Loading the HEIC decoder locally…");
  return new Promise((resolve, reject) => {
    worker.onmessage = (event) => {
      worker.terminate();
      if (event.data.error) reject(new Error(`HEIC decode failed: ${event.data.error}`));
      else resolve(event.data);
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(event.error || new Error("HEIC decoder worker failed"));
    };
    file.arrayBuffer().then((buffer) => worker.postMessage({buffer}, [buffer]), reject);
  });
}
