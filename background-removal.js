import { canUseTool, limitMessage, recordTask } from "./entitlements.js";
import { decodeHeic, isHeic } from "./heic.js";
import { MODEL_CACHE, MODEL_INTEGRITY, modelName, verifyIntegrity } from "./privacy.js";

const MODEL_MIRROR = "https://pub-a8d1cffdfd404e2da5d08c1f0a266934.r2.dev";
const MODEL_CONFIG = Object.freeze({
  encoderUrl: `${MODEL_MIRROR}/efficient-sam-vitt-encoder.onnx`,
  decoderUrl: `${MODEL_MIRROR}/efficient-sam-vitt-decoder.onnx`,
  matteUrl: `${MODEL_MIRROR}/vitmatte-small-composition-1k.onnx`,
});

let current = null;

function element(tag, attributes = {}, text = "") {
  const node = document.createElement(tag);
  Object.entries(attributes).forEach(([key, value]) =>
    node.setAttribute(key, value),
  );
  if (text) node.textContent = text;
  return node;
}

function formatBytes(bytes) {
  return bytes > 1024 * 1024
    ? `${(bytes / 1024 / 1024).toFixed(1)} MB`
    : `${Math.round(bytes / 1024)} KB`;
}

async function cachedModel(url, onProgress) {
  if (!("caches" in window))
    return fetch(url).then((response) => response.arrayBuffer());
  const cache = await caches.open(MODEL_CACHE);
  const cached = await cache.match(url);
  if (cached) {
    onProgress(`Using cached model · ${new URL(url).hostname}`);
    const bytes = await cached.arrayBuffer();
    const expected = MODEL_INTEGRITY[modelName(url)];
    if (expected && !(await verifyIntegrity(bytes, expected)))
      throw new Error(`Cached model integrity check failed for ${modelName(url)}. Clear the model cache and try again.`);
    return bytes;
  }
  const response = await fetch(url);
  if (!response.ok || !response.body)
    throw new Error(`Model download failed (${response.status}).`);
  const total = Number(response.headers.get("content-length")) || 0;
  const reader = response.body.getReader();
  const chunks = [];
  let received = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    chunks.push(part.value);
    received += part.value.byteLength;
    onProgress(
      `Downloading model · ${formatBytes(received)}${total ? ` / ${formatBytes(total)}` : ""}`,
    );
  }
  const bytes = new Uint8Array(received);
  let offset = 0;
  chunks.forEach((chunk) => {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  });
  const expected = MODEL_INTEGRITY[modelName(url)];
  if (expected && !(await verifyIntegrity(bytes.buffer, expected)))
    throw new Error(`Model integrity check failed for ${modelName(url)}. The file was not used.`);
  await cache.put(
    url,
    new Response(bytes, {
      headers: { "content-type": "application/octet-stream" },
    }),
  );
  return bytes.buffer;
}

async function loadModelBuffers(onProgress) {
  const [encoderBuffer, decoderBuffer] = await Promise.all([
    cachedModel(MODEL_CONFIG.encoderUrl, onProgress),
    cachedModel(MODEL_CONFIG.decoderUrl, onProgress),
  ]);
  return { encoderBuffer, decoderBuffer };
}

function checkerboard(canvas, background = "checkerboard") {
  const context = canvas.getContext("2d");
  if (background === "checkerboard") {
    for (let y = 0; y < canvas.height; y += 20) {
      for (let x = 0; x < canvas.width; x += 20) {
        context.fillStyle = (x / 20 + y / 20) % 2 ? "#b0b0b0" : "#eeeeee";
        context.fillRect(x, y, 20, 20);
      }
    }
  } else {
    context.fillStyle = background;
    context.fillRect(0, 0, canvas.width, canvas.height);
  }
}

function renderPreview(canvas, result, background) {
  if (!result) return;
  checkerboard(canvas, background);
  const image = new Image();
  image.onload = () =>
    canvas.getContext("2d").drawImage(image, 0, 0, canvas.width, canvas.height);
  image.src = URL.createObjectURL(
    new Blob([result.buffer], { type: result.mime }),
  );
}

export async function runBackground({ files, status, preview, controls }) {
  if (!files[0]) {
    status.textContent = "Choose an image first.";
    return;
  }
  if (!crossOriginIsolated) {
    status.textContent =
      "This tool needs cross-origin isolation for threaded browser inference.";
    status.classList.add("error");
    return;
  }
  if (!canUseTool("background-removal", { fileCount: 1, task: true })) {
    status.textContent = limitMessage("background-removal", {
      fileCount: 1,
      task: true,
    });
    return;
  }
  const file = files[0];
  let inputFile = file;
  if (isHeic(file)) {
    try {
      const decoded = await decodeHeic(file, (message) => { status.textContent = message; });
      inputFile = new File([decoded.buffer], `${file.name}.png`, {type: "image/png"});
    } catch (error) {
      status.textContent = error.message;
      status.classList.add("error");
      controls.run.disabled = false;
      return;
    }
  }
  const clicks = current.clicks;
  if (!clicks.length) {
    status.textContent = "Click the subject on the image before running.";
    status.classList.add("error");
    return;
  }
  status.classList.remove("error", "success");
  controls.run.disabled = true;
  if (!current.worker)
    current.worker = new Worker("./background-worker.js", { type: "module" });
  let result;
  try {
    let modelBuffers = null;
    if (!current.modelsLoaded) {
      modelBuffers = await loadModelBuffers((message) => {
        status.textContent = message;
      });
    }
    result = await new Promise((resolve, reject) => {
      current.worker.onmessage = (event) => {
        if (event.data.type === "progress") {
          status.textContent = event.data.message;
          return;
        }
        if (event.data.ok) resolve(event.data);
        else reject(new Error(event.data.error));
      };
      current.worker.onerror = (event) =>
        reject(event.error || new Error("Background worker failed."));
      inputFile.arrayBuffer().then((imageBuffer) =>
        current.worker.postMessage(
          {
            id: inputFile.name,
            imageBuffer,
            imageType: inputFile.type,
            clicks,
            bandRadius: Number(controls.band.value),
            cleanEdges: controls.clean.checked,
            config: modelBuffers || {},
          },
          modelBuffers
            ? [
                imageBuffer,
                modelBuffers.encoderBuffer,
                modelBuffers.decoderBuffer,
              ]
            : [imageBuffer],
        ),
      );
    });
  } catch (error) {
    status.textContent = error.message;
    status.classList.add("error");
    controls.run.disabled = false;
    return;
  }
  current.modelsLoaded = true;
  controls.run.disabled = false;
  if (!result) return;
  current.result = result;
  recordTask();
  renderPreview(preview, result, controls.background.value);
  status.classList.add("success");
  status.textContent = `Ready · ${result.trimapStats.unknownPercent.toFixed(1)}% unknown band · ${formatBytes(result.buffer.byteLength)}`;
  controls.export.hidden = false;
  controls.export.onclick = () => {
    const url = URL.createObjectURL(
      new Blob([result.buffer], { type: result.mime }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `${file.name.replace(/\.[^.]+$/, "")}-cutout.png`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
}

export function mountBackgroundTool(container, context) {
  container.innerHTML = "";
  current = { clicks: [], result: null };
  const notice = element(
    "p",
    { class: "hint" },
    "Click the subject to select it. Add a negative click with Shift if the selector includes the wrong object. Strongest on people, animals, and products; transparent glass remains difficult.",
  );
  const canvas = element("canvas", {
    class: "background-canvas",
    width: "640",
    height: "480",
    tabindex: "0",
    "aria-label": "Image selection canvas",
  });
  const controls = {
    run: element(
      "button",
      { class: "btn primary", type: "button" },
      "Run selection and matting",
    ),
    export: element(
      "button",
      { class: "btn", type: "button", hidden: "" },
      "Export transparent PNG",
    ),
    band: element("input", {
      type: "range",
      min: "12",
      max: "64",
      value: "36",
    }),
    bandPreset: element("select"),
    clean: element("input", { type: "checkbox", checked: true }),
    background: element("select"),
    x: element("input", {type: "number", min: "0", max: "1024", value: "512", "aria-label": "Selection X coordinate"}),
    y: element("input", {type: "number", min: "0", max: "1024", value: "512", "aria-label": "Selection Y coordinate"}),
    sign: element("select", {"aria-label": "Selection point type"}),
    point: element("button", {class: "btn", type: "button"}, "Set selection point"),
  };
  controls.sign.append(element("option", {value: "1"}, "Positive subject point"));
  controls.sign.append(element("option", {value: "0"}, "Negative background point"));
  [
    ["checkerboard", "Checkerboard"],
    ["#ffffff", "White"],
    ["#000000", "Black"],
    ["#27b4c7", "Colour"],
  ].forEach(([value, label]) => {
    controls.background.append(element("option", { value }, label));
  });
  [
    ["hair", "Hair / fur · wide band"],
    ["product", "Product / hard edge · narrow band"],
  ].forEach(([value, label]) => {
    controls.bandPreset.append(element("option", { value }, label));
  });
  controls.bandPreset.onchange = () => {
    controls.band.value = controls.bandPreset.value === "hair" ? "36" : "16";
  };
  const grid = element("div", { class: "form-grid background-options" });
  const field = (label, input) => {
    const wrapper = element("div", { class: "field" });
    wrapper.append(element("label", {}, label), input);
    return wrapper;
  };
  grid.append(
    field("Unknown band", controls.band),
    field("Edge preset", controls.bandPreset),
    field("Preview background", controls.background),
    field(
      "Optional cleanup",
      (() => {
        const label = element("label", { class: "check" });
        label.append(controls.clean, document.createTextNode(" Clean edges"));
        return label;
      })(),
    ),
  );
  const status = element(
    "p",
    { class: "mono background-status" },
    "Model downloads begin only when you run the tool.",
  );
  const row = element("div", { class: "run-row" });
  const pointGrid = element("div", {class: "form-grid background-point"});
  pointGrid.append(field("X (0–1024)", controls.x), field("Y (0–1024)", controls.y), field("Point type", controls.sign), controls.point);
  row.append(controls.run, controls.export, status);
  container.append(notice, canvas, pointGrid, grid, row);
  const file = context.files[0];
  if (file) {
    const drawSource = (source) => {
      const image = new Image();
      image.onload = () => {
        canvas.width = image.naturalWidth;
        canvas.height = image.naturalHeight;
        canvas.getContext("2d").drawImage(image, 0, 0);
        URL.revokeObjectURL(image.src);
      };
      image.src = URL.createObjectURL(source);
    };
    if (isHeic(file)) {
      status.textContent = "Loading the HEIC decoder locally…";
      decodeHeic(file).then((decoded) => {
        drawSource(new Blob([decoded.buffer], {type: "image/png"}));
        status.textContent = "HEIC ready. Click the subject to select it.";
      }).catch((error) => {
        status.textContent = error.message;
        status.classList.add("error");
      });
    } else {
      drawSource(file);
    }
    const setPoint = (x, y, label) => {
      const boundedX = Math.max(0, Math.min(1024, Math.round(x)));
      const boundedY = Math.max(0, Math.min(1024, Math.round(y)));
      controls.x.value = String(boundedX);
      controls.y.value = String(boundedY);
      current.clicks = [{x: boundedX, y: boundedY, label}];
      const displayX = Math.round((boundedX * canvas.width) / 1024);
      const displayY = Math.round((boundedY * canvas.height) / 1024);
      status.textContent = `${label ? "Positive" : "Negative"} selection point set at ${boundedX}, ${boundedY}.`;
      const context2d = canvas.getContext("2d");
      context2d.fillStyle = label ? "#ffe45c" : "#e02b1d";
      context2d.beginPath();
      context2d.arc(displayX, displayY, Math.max(8, canvas.width / 80), 0, Math.PI * 2);
      context2d.fill();
    };
    controls.point.onclick = () => setPoint(Number(controls.x.value), Number(controls.y.value), Number(controls.sign.value));
    canvas.onkeydown = (event) => {
      if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Enter", " "].includes(event.key)) return;
      event.preventDefault();
      if (event.key === "Enter" || event.key === " ") {
        setPoint(Number(controls.x.value), Number(controls.y.value), Number(controls.sign.value));
        return;
      }
      const delta = event.shiftKey ? 10 : 1;
      if (event.key === "ArrowLeft") controls.x.value = String(Math.max(0, Number(controls.x.value) - delta));
      if (event.key === "ArrowRight") controls.x.value = String(Math.min(1024, Number(controls.x.value) + delta));
      if (event.key === "ArrowUp") controls.y.value = String(Math.max(0, Number(controls.y.value) - delta));
      if (event.key === "ArrowDown") controls.y.value = String(Math.min(1024, Number(controls.y.value) + delta));
      status.textContent = `Selection point ${controls.x.value}, ${controls.y.value}. Press Enter to set it.`;
    };
      canvas.onclick = (event) => {
      const rect = canvas.getBoundingClientRect();
      const x = Math.round(
        ((event.clientX - rect.left) * canvas.width) / rect.width,
      );
      const y = Math.round(
        ((event.clientY - rect.top) * canvas.height) / rect.height,
      );
      const modelX = Math.round((x * 1024) / canvas.width);
      const modelY = Math.round((y * 1024) / canvas.height);
      setPoint((modelX * 1024) / canvas.width, (modelY * 1024) / canvas.height, event.shiftKey ? 0 : 1);
      status.textContent = `${event.shiftKey ? "Negative" : "Positive"} click registered at ${x}, ${y} → model ${modelX}, ${modelY}`;
      };
      canvas.addEventListener("dragstart", (event) => event.preventDefault());
      canvas.addEventListener("selectstart", (event) => event.preventDefault());
  }
  controls.background.onchange = () =>
    renderPreview(canvas, current.result, controls.background.value);
  controls.run.onclick = () =>
    runBackground({ files: context.files, status, preview: canvas, controls });
}
