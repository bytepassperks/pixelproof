const HEIC_TYPES = new Set(["image/heic", "image/heif", "image/heic-sequence", "image/heif-sequence"]);
const WORKER_START_TIMEOUT_MS = 20_000;
const WORKER_STALL_TIMEOUT_MS = 300_000;

export function isHeic(file) {
  return HEIC_TYPES.has((file.type || "").toLowerCase()) || /\.(heic|heif)$/i.test(file.name || "");
}

export function decodeHeic(file, onProgress = () => {}) {
  const worker = new Worker("./heic-decoder-worker.js");
  onProgress("Loading the HEIC decoder locally…");
  return new Promise((resolve, reject) => {
    let started = false;
    let lastSignal = Date.now();
    const watchdog = setInterval(() => {
      const limit = started ? WORKER_STALL_TIMEOUT_MS : WORKER_START_TIMEOUT_MS;
      if (Date.now() - lastSignal < limit) return;
      clearInterval(watchdog);
      worker.terminate();
      reject(new Error("HEIC decoder stalled."));
    }, 1_000);
    worker.onmessage = (event) => {
      lastSignal = Date.now();
      if (event.data.started || event.data.heartbeat) {
        started ||= event.data.started === true;
        return;
      }
      clearInterval(watchdog);
      worker.terminate();
      if (event.data.error) reject(new Error(`HEIC decode failed: ${event.data.error}`));
      else resolve(event.data);
    };
    worker.onerror = (event) => {
      clearInterval(watchdog);
      worker.terminate();
      reject(event.error || new Error("HEIC decoder worker failed"));
    };
    file.arrayBuffer().then((buffer) => worker.postMessage({buffer}, [buffer]), (error) => {
      clearInterval(watchdog);
      worker.terminate();
      reject(error);
    });
  });
}
