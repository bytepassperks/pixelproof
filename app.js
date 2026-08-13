import { PRODUCT, MIME, PLATFORM_PROFILES } from "./config.js";
import { registerTool, listTools } from "./registry.js";
import { downloadZip } from "./zip.js";
import {
  canUseTool,
  getEntitlementState,
  limitMessage,
  recordTask,
  revalidateLicense,
} from "./entitlements.js";
import { mountBackgroundTool } from "./background-removal.js";
import { inspectColorInfo, inspectMetadata } from "./metadata.js";
import { decodeHeic, isHeic } from "./heic.js";
import { generatePdf, imageForPdf, pdfPageSize } from "./pdf.js";
import {
  clearLocalData,
  localDataSummary,
  privacySelfTestText,
} from "./privacy.js";

let estimateRequest = 0;
const WORKER_START_TIMEOUT_MS = 20_000;
const WORKER_STALL_TIMEOUT_MS = 300_000;

const toolDefs = [
  {
    id: "compress",
    label: "Compress",
    kicker: "TOOL / COMPRESS",
    title: "Compress without guessing.",
    description:
      "Control quality while seeing output size before you download.",
  },
  {
    id: "target-size",
    label: "Target size",
    kicker: "TOOL / TARGET SIZE",
    title: "Hit the byte budget.",
    description: "Binary-search quality per image until every output fits the number you set.",
  },
  {
    id: "resize",
    label: "Resize",
    kicker: "TOOL / RESIZE",
    title: "Resize for the destination.",
    description: "Use exact dimensions, percentage, or a fit-within preset.",
  },
  {
    id: "crop",
    label: "Crop",
    kicker: "TOOL / CROP",
    title: "Crop the frame.",
    description: "Set a precise crop or use a common aspect ratio.",
  },
  {
    id: "transform",
    label: "Rotate / flip",
    kicker: "TOOL / TRANSFORM",
    title: "Turn the image, not the workflow.",
    description: "Rotate and flip without leaving the workbench.",
  },
  {
    id: "convert",
    label: "Convert",
    kicker: "TOOL / CONVERT",
    title: "Convert cleanly.",
    description: "Move between JPEG, PNG, and WebP with an honest MIME check.",
  },
  {
    id: "watermark",
    label: "Watermark",
    kicker: "TOOL / WATERMARK",
    title: "Mark the work.",
    description:
      "Add text or an image watermark with control over placement and opacity.",
  },
  {
    id: "web-export",
    label: "Web export",
    kicker: "WORKFLOW / WEB EXPORT",
    title: "One source. Every web size.",
    description:
      "Emit correctly named WordPress and Shopify responsive assets at once.",
  },
  {
    id: "background-removal",
    label: "Background removal",
    kicker: "ASSISTED / BACKGROUND",
    title: "Click the subject. Keep the edges.",
    description:
      "Prompted selection plus continuous alpha matting. Preview before export.",
  },
  {
    id: "photo-editor",
    label: "Photo editor",
    kicker: "TOOL / PHOTO EDITOR",
    title: "Tune the picture, not the original.",
    description: "Make controlled colour and light adjustments, then export at full resolution.",
  },
  {
    id: "meme",
    label: "Meme",
    kicker: "TOOL / MEME",
    title: "Caption it clearly.",
    description: "Top and bottom captions with a legible outline, ready for sharing.",
  },
  {
    id: "face-blur",
    label: "Face blur",
    kicker: "ASSISTED / PRIVACY",
    title: "Review every box before export.",
    description: "Manual privacy boxes with blur or pixelation. Nothing is silently trusted.",
  },
  {
    id: "icon-set",
    label: "Favicon / app icons",
    kicker: "WORKFLOW / ICON SET",
    title: "Every icon, correctly named.",
    description: "Emit favicon, PWA, and Apple touch icons with a copy-ready snippet.",
  },
  {
    id: "social",
    label: "Social presets",
    kicker: "WORKFLOW / SOCIAL",
    title: "One image. Every social frame.",
    description: "OG, Twitter, YouTube, Instagram, and LinkedIn sizes with fit or fill.",
  },
  {
    id: "rename",
    label: "Bulk rename",
    kicker: "WORKFLOW / RENAME",
    title: "Name the batch before it ships.",
    description: "Pattern-based names with sequence, stem, dimensions, and date tokens.",
  },
  {
    id: "palette",
    label: "Palette",
    kicker: "ANALYSIS / PALETTE",
    title: "Pull the colours out.",
    description: "Extract dominant colours as copyable hex values and exportable text.",
  },
  {
    id: "compare",
    operationTypes: ["compress"],
    label: "Compression compare",
    kicker: "ANALYSIS / COMPARE",
    title: "Pick quality by eye.",
    description: "Compare the source and compressed result with both file sizes visible.",
  },
  {
    id: "metadata",
    label: "Metadata",
    kicker: "PRIVACY / METADATA",
    title: "See what the file reveals.",
    description: "Inspect camera, timestamps, software, and GPS presence before stripping or preserving selected tags.",
  },
  {
    id: "image-to-pdf",
    operationTypes: ["pdf"],
    label: "Image to PDF",
    kicker: "WORKFLOW / PDF",
    title: "Build the document.",
    description: "Reorder images, choose physical page settings, and export one compact local PDF or one PDF per image.",
  },
  {
    id: "platform-profiles",
    operationTypes: ["resize"],
    label: "Platform profiles",
    kicker: "WORKFLOW / PUBLISHED GUIDANCE",
    title: "Start from the destination.",
    description: "Editable starting points based on published platform guidance, never a compliance guarantee.",
  },
  {
    id: "id-print-sheet",
    operationTypes: ["id-sheet"],
    label: "ID print sheet",
    kicker: "WORKFLOW / DIMENSIONS ONLY",
    title: "Lay out the photos.",
    description: "Create correctly sized 4×6 or A4 print sheets. PixelProof does not check eligibility requirements.",
  },
  {
    id: "svg-raster",
    operationTypes: ["resize", "svg-raster"],
    label: "SVG rasterise",
    kicker: "FORMAT / SVG",
    title: "Rasterise SVG safely.",
    description: "Remove active content and external references, then choose the output pixel dimensions.",
  },
];
toolDefs.forEach(registerTool);
function operationTypesForTool(toolId) {
  return toolDefs.find((tool) => tool.id === toolId)?.operationTypes || [toolId];
}
function operationTypeForTool(toolId) {
  return operationTypesForTool(toolId)[0];
}
const $ = (s) => document.querySelector(s);
const state = {
  tool: "compress",
  files: [],
  results: [],
  urls: [],
  running: false,
  cancel: false,
  faceBoxes: [],
  faceScale: {x: 1, y: 1},
  compareUrls: [],
  activeRunId: "",
  activeRunStartedAt: 0,
  recipe: null,
  retryFiles: [],
  pdfOrder: [],
  animationFiles: [],
  sample: false,
  appendSelection: false,
  resultNotice: "",
  resultToolId: "",
  resultToolLabel: "",
};
let pendingServiceWorkerReload = false;
function reloadWhenIdle() {
  if (state.running) {
    setTimeout(reloadWhenIdle, 250);
    return;
  }
  pendingServiceWorkerReload = false;
  window.location.reload();
}
const activeWorkers = new Map();
function cancelActiveWorkers() {
  activeWorkers.forEach((cancel) => cancel());
}
const supportedFormats = new Set();
const originalStats = new WeakMap();
const RECIPE_KEY = "pixelproof-recipes";
const SETTINGS_KEY = "pixelproof-tool-settings";
const RECOVERY_DB = "pixelproof-recovery";
const IOS_PIXEL_LIMIT = 24_000_000;
let recoveryWrites = Promise.resolve();
let recoveryWriteFailed = false;
function readStoredJson(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "null");
    return value ?? fallback;
  } catch {
    return fallback;
  }
}
function readStoredArray(key) {
  const value = readStoredJson(key, []);
  return Array.isArray(value)
    ? value.filter((entry) => entry && typeof entry === "object" && !Array.isArray(entry))
    : [];
}
function readStoredObject(key) {
  const value = readStoredJson(key, {});
  return value && typeof value === "object" && !Array.isArray(value)
    ? Object.assign(Object.create(null), value)
    : Object.create(null);
}
function writeStoredJson(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
const recipes = [
  {
    id: "web",
    name: "Web optimizer",
    description: "Fit wide images to 1920px, strip metadata, and export compact WebP.",
    steps: [
      {tool: "resize", label: "Fit within 1920×1080", operation: {type: "resize", mode: "fit", width: 1920, height: 1080, mime: "image/png"}},
      {tool: "compress", label: "WebP at quality 82, metadata stripped", operation: {type: "compress", mime: "image/webp", quality: 0.82, metadata: {mode: "strip"}}},
    ],
  },
  {
    id: "product",
    name: "Product photos",
    description: "Create consistent 2000px product assets without enlarging smaller originals.",
    steps: [
      {tool: "resize", label: "Fit within 2000×2000", operation: {type: "resize", mode: "fit", width: 2000, height: 2000, mime: "image/png"}},
      {tool: "compress", label: "JPEG at quality 88, metadata stripped", operation: {type: "compress", mime: "image/jpeg", quality: 0.88, metadata: {mode: "strip"}}},
    ],
  },
  {
    id: "social",
    name: "Social pack",
    description: "Create square, portrait, and story-ready outputs from every source.",
    steps: [
      {tool: "social", label: "Square 1080×1080, fit", operation: {type: "social", width: 1080, height: 1080, fill: false, mime: "image/png"}, variants: ["square"]},
      {tool: "social", label: "Portrait 1080×1350, fit", operation: {type: "social", width: 1080, height: 1350, fill: false, mime: "image/png"}, variants: ["portrait"]},
      {tool: "social", label: "Story 1080×1920, fit", operation: {type: "social", width: 1080, height: 1920, fill: false, mime: "image/png"}, variants: ["story"]},
    ],
  },
  {
    id: "target",
    name: "Compress to size",
    description: "Aim for 200 KB per image with quality search and no silent over-budget exports.",
    steps: [
      {tool: "target-size", label: "JPEG under 200 KB per image", operation: {type: "target-size", mime: "image/jpeg", targetBytes: 200000, reduceDimensions: true, metadata: {mode: "strip"}}},
    ],
  },
  {
    id: "responsive",
    name: "Responsive image set",
    description: "Emit three WebP widths for responsive websites.",
    steps: [
      {tool: "resize", label: "768px WebP", operation: {type: "resize", mode: "fit", width: 768, height: 768, mime: "image/webp"}, variants: ["768"]},
      {tool: "resize", label: "1200px WebP", operation: {type: "resize", mode: "fit", width: 1200, height: 1200, mime: "image/webp"}, variants: ["1200"]},
      {tool: "resize", label: "1920px WebP", operation: {type: "resize", mode: "fit", width: 1920, height: 1920, mime: "image/webp"}, variants: ["1920"]},
    ],
  },
  {
    id: "watermark",
    name: "Watermark batch",
    description: "Apply a consistent text mark to every image, then export compact JPEGs.",
    steps: [
      {tool: "watermark", label: "Text watermark: © Your brand", operation: {type: "watermark", text: "© Your brand", position: "bottom-right", opacity: 0.55, scale: 0.2, mime: "image/png"}},
      {tool: "compress", label: "JPEG at quality 88, metadata stripped", operation: {type: "compress", mime: "image/jpeg", quality: 0.88, metadata: {mode: "strip"}}},
    ],
  },
  {
    id: "privacy",
    name: "Private sharing",
    description: "Strip camera, GPS, and software metadata; review privacy boxes before sharing.",
    steps: [
      {tool: "metadata", label: "Strip all metadata", operation: {type: "metadata", mime: "image/jpeg", quality: 0.92, metadata: {mode: "strip"}}},
    ],
    note: "Face blur remains an explicit manual review in the Face blur tool; this recipe never claims automatic face detection.",
  },
];
function announce(message, kind = "") {
  const node = $("#run-status") || $("#recipe-status");
  if (!node) return;
  node.textContent = message;
  node.classList.toggle("error", kind === "error");
  node.classList.toggle("success", kind === "success");
}
function isIOS() {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}
function recoveryStore(mode, value) {
  return new Promise((resolve, reject) => {
    if (!window.indexedDB) {
      reject(new Error("Recovery storage is unavailable."));
      return;
    }
    const request = indexedDB.open(RECOVERY_DB);
    request.onupgradeneeded = () => request.result.createObjectStore("outputs", {keyPath: "id"});
    request.onerror = () => reject(request.error);
    request.onsuccess = () => {
      const db = request.result;
      const transaction = db.transaction("outputs", mode === "clear" ? "readwrite" : mode);
      transaction.onerror = () => reject(transaction.error);
      transaction.oncomplete = () => {
        db.close();
        resolve();
      };
      if (mode === "clear") transaction.objectStore("outputs").clear();
      else if (mode === "readwrite") transaction.objectStore("outputs").put(value);
      else {
        const get = transaction.objectStore("outputs").getAll();
        get.onsuccess = () => resolve(get.result);
      }
    };
  });
}
async function rememberOutput(result) {
  if (!result?.bytes) return;
  recoveryWrites = recoveryWrites.then(async () => {
    try {
      await recoveryStore("readwrite", {
        id: `${Date.now()}-${Math.random()}`,
        name: result.name,
        source: result.source || "",
        sourcePath: result.sourcePath || "",
        mime: result.mime,
        bytes: result.bytes,
        originalBytes: result.originalBytes || 0,
        savedAt: Date.now(),
        runId: result.runId || "",
        runStartedAt: result.runStartedAt || Date.now(),
      });
    } catch {
      recoveryWriteFailed = true;
    }
  });
  return recoveryWrites;
}
function clearRecoveryOutputs() {
  return recoveryStore("clear");
}
async function restoreRecovery() {
  try {
    const saved = await recoveryStore("readonly");
    if (!saved?.length || state.results.length) return;
    const recent = saved.filter((item) =>
      item.runId &&
      item.name &&
      item.mime &&
      ((item.bytes instanceof ArrayBuffer && item.bytes.byteLength > 0) ||
        (ArrayBuffer.isView(item.bytes) && item.bytes.byteLength > 0)) &&
      Date.now() - item.savedAt < 24 * 60 * 60 * 1000,
    );
    if (!recent.length) return;
    const runLabels = new Map();
    recent.forEach((item) => {
      const timestamp = Number(item.runStartedAt);
      const label = Number.isFinite(timestamp)
        ? new Date(timestamp).toLocaleString()
        : "unknown run";
      runLabels.set(timestamp, label);
    });
    const recovered = recent
      .sort((a, b) => (a.runStartedAt || 0) - (b.runStartedAt || 0))
      .map((item) => ({
        ...item,
        bytes: item.bytes,
        recoveryRunLabel: `Recovered run · ${runLabels.get(Number(item.runStartedAt)) || "unknown run"}`,
      }));
    state.results = recovered;
    state.resultNotice = `Recovered ${recovered.length} output${recovered.length === 1 ? "" : "s"} from ${runLabels.size} interrupted run${runLabels.size === 1 ? "" : "s"}.`;
    $("#results").hidden = false;
    renderResults();
    const recoveryMessage = `${recovered.length} completed output${recovered.length === 1 ? "" : "s"} recovered from your last interrupted job.`;
    const status = $("#run-status") || $("#recipe-status");
    if (status) {
      status.textContent = recoveryMessage;
      status.classList.add("success");
    }
  } catch {}
}
function allRecipes() {
  return [...recipes, ...readStoredArray(RECIPE_KEY)].filter((recipe) =>
    typeof recipe.id === "string" &&
    typeof recipe.name === "string" &&
    Array.isArray(recipe.steps) &&
    recipe.steps.length > 0 &&
    recipe.steps.every((step) =>
      step && typeof step.tool === "string" && typeof step.label === "string" &&
      step.operation && typeof step.operation === "object" && !Array.isArray(step.operation),
    ),
  );
}
function validateRecipeStep(step) {
  if (!step || typeof step.tool !== "string" || typeof step.label !== "string" ||
      step.label.length > 160 || !step.operation || typeof step.operation !== "object" ||
      Array.isArray(step.operation)) return "Recipe contains an unknown or invalid operation.";
  const tool = toolDefs.find((item) => item.id === step.tool);
  if (!tool)
    return `Recipe references unknown tool “${step.tool}”.`;
  if (!operationTypesForTool(step.tool).includes(step.operation.type))
    return `Recipe step “${step.label}” does not match its selected tool.`;
  return "";
}
function initRecipes() {
  const select = $("#recipe-select");
  if (!select) return;
  select.innerHTML = allRecipes().map((recipe) => `<option value="${escapeHtml(recipe.id)}">${escapeHtml(recipe.name)}</option>`).join("");
  select.onchange = () => renderRecipe(select.value);
  $("#recipe-run").onclick = () => runRecipe();
  $("#recipe-save").onclick = () => saveRecipe();
  $("#recipe-export").onclick = () => exportRecipe();
  $("#recipe-import").onclick = () => $("#recipe-import-file").click();
  $("#recipe-import-file").onchange = (event) => importRecipe(event);
  $("#toggle-tools").onclick = () => {
    $(".sidebar").scrollIntoView({behavior: "auto", block: "start"});
    $(".sidebar").classList.add("focus-tools");
    setTimeout(() => $(".sidebar").classList.remove("focus-tools"), 900);
  };
  renderRecipe(select.value);
}
function exportRecipe() {
  if (!state.recipe) return;
  const blob = new Blob([JSON.stringify({pixelproof: 1, formatVersion: 2, recipe: {...state.recipe, kind: "recipe"}}, null, 2)], {type: "application/json"});
  const url = URL.createObjectURL(blob), link = document.createElement("a");
  link.href = url; link.download = `${stem(state.recipe.name)}.pixelproof.json`;
  document.body.append(link); link.click();
  setTimeout(() => { link.remove(); URL.revokeObjectURL(url); }, 1000);
}
async function importRecipe(event) {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const documentData = JSON.parse(await file.text());
    const recipe = documentData.recipe || (documentData.pipeline?.kind === "recipe" ? documentData.pipeline : null);
    if (documentData.pixelproof !== 1 || !recipe?.name || !Array.isArray(recipe.steps) || !recipe.steps.length || recipe.steps.length > 40) throw new Error("Not a valid PixelProof recipe file.");
    if (documentData.formatVersion !== 2) {
      if (Number(documentData.formatVersion) > 2) throw new Error("This recipe was created by a newer PixelProof release.");
      throw new Error("This recipe uses an unsupported format version.");
    }
    if (JSON.stringify(recipe).length > 65536) throw new Error("Recipe file is too large.");
    recipe.id = `custom-${Date.now()}`;
    recipe.name = String(recipe.name).trim().slice(0, 80);
    if (!recipe.name) throw new Error("Recipe name is empty.");
    recipe.steps.forEach((step) => {
      const error = validateRecipeStep(step);
      if (error) throw new Error(error);
    });
    const saved = readStoredArray(RECIPE_KEY);
    saved.push(recipe);
    writeStoredJson(RECIPE_KEY, saved);
    initRecipes();
    $("#recipe-select").value = recipe.id;
    renderRecipe(recipe.id);
    $("#recipe-status").textContent = `Imported recipe “${recipe.name}”.`;
  } catch (error) {
    const message = error instanceof SyntaxError ? "The recipe file is not valid JSON." : error.message;
    $("#recipe-status").textContent = `Recipe import failed: ${message}`;
  }
  event.target.value = "";
}
function operationLabel(step) {
  const tool = toolDefs.find((item) => item.id === step.tool);
  return tool?.label || step.tool || "Operation";
}
function operationControls(operation) {
  const type = operation?.type;
  const field = (label, key, value, kind = "text", extra = "") =>
    `<label class="recipe-field"><span>${label}</span><input data-op="${key}" data-kind="${kind}" value="${escapeHtml(String(value ?? ""))}" ${extra}></label>`;
  const select = (label, key, value, options) =>
    `<label class="recipe-field"><span>${label}</span><select data-op="${key}">${options.map(([option, text]) => `<option value="${option}" ${option === value ? "selected" : ""}>${text}</option>`).join("")}</select></label>`;
  if (type === "resize") return `${select("Mode", "mode", operation.mode, [["fit", "Fit within"], ["exact", "Exact dimensions"], ["percent", "Percentage"]])}${field("Width", "width", operation.width, "number", 'min="1" step="1"')}${field("Height", "height", operation.height, "number", 'min="1" step="1"')}${select("Output", "mime", operation.mime, [["image/png", "PNG"], ["image/jpeg", "JPEG"], ["image/webp", "WebP"], ["image/avif", "AVIF"]])}`;
  if (type === "compress") return `${select("Output", "mime", operation.mime, [["image/jpeg", "JPEG"], ["image/png", "PNG"], ["image/webp", "WebP"], ["image/avif", "AVIF"]])}${field("Quality", "quality", Math.round((operation.quality ?? 0.82) * 100), "number", 'min="1" max="100" step="1"')}<p class="recipe-control-note">Metadata: ${escapeHtml(operation.metadata?.mode || "keep")}</p>`;
  if (type === "social") return `${field("Width", "width", operation.width, "number", 'min="1" step="1"')}${field("Height", "height", operation.height, "number", 'min="1" step="1"')}${select("Output", "mime", operation.mime, [["image/png", "PNG"], ["image/jpeg", "JPEG"], ["image/webp", "WebP"], ["image/avif", "AVIF"]])}<label class="recipe-check"><input type="checkbox" data-op="fill" ${operation.fill ? "checked" : ""}><span>Fill the frame</span></label>`;
  if (type === "target-size") return `${field("Target bytes", "targetBytes", operation.targetBytes, "number", 'min="1000" step="1000"')}${select("Output", "mime", operation.mime, [["image/jpeg", "JPEG"], ["image/webp", "WebP"], ["image/avif", "AVIF"]])}<label class="recipe-check"><input type="checkbox" data-op="reduceDimensions" ${operation.reduceDimensions ? "checked" : ""}><span>Reduce dimensions if needed</span></label>`;
  if (type === "watermark") return `${field("Text", "text", operation.text)}${select("Position", "position", operation.position, [["bottom-right", "Bottom right"], ["bottom-left", "Bottom left"], ["top-right", "Top right"], ["top-left", "Top left"], ["center", "Center"]])}${field("Opacity", "opacity", Math.round((operation.opacity ?? 0.55) * 100), "number", 'min="1" max="100" step="1"')}${field("Scale", "scale", Math.round((operation.scale ?? 0.2) * 100), "number", 'min="1" max="100" step="1"')}`;
  if (type === "metadata") return `${select("Metadata", "metadata.mode", operation.metadata?.mode || "strip", [["strip", "Strip all"], ["preserve", "Preserve"]])}${select("Output", "mime", operation.mime, [["image/jpeg", "JPEG"], ["image/png", "PNG"], ["image/webp", "WebP"]])}${field("Quality", "quality", Math.round((operation.quality ?? 0.92) * 100), "number", 'min="1" max="100" step="1"')}`;
  return `<p class="recipe-control-note">This operation uses the individual tool controls. Advanced JSON remains available below.</p>`;
}
function setOperationValue(operation, path, value) {
  const parts = path.split(".");
  const key = parts.pop();
  let target = operation;
  for (const part of parts) target = target[part] ||= {};
  target[key] = value;
}
function persistRecipeSettings() {
  const settings = readStoredObject("pixelproof-recipe-settings");
  settings[state.recipe.id] = {steps: state.recipe.steps};
  writeStoredJson("pixelproof-recipe-settings", settings);
}
function renderRecipe(id) {
  const recipe = allRecipes().find((item) => item.id === id) || recipes[0];
  state.recipe = structuredClone(recipe);
  try {
    const saved = readStoredObject("pixelproof-recipe-settings")[id];
    if (saved?.steps) state.recipe.steps = saved.steps;
  } catch {}
  $("#recipe-steps").innerHTML = state.recipe.steps.map((step, index) => `<details class="recipe-step" open><summary><span>${String(index + 1).padStart(2, "0")}</span><strong>${escapeHtml(operationLabel(step))}</strong><em>${escapeHtml(step.label)}</em></summary><div class="recipe-fields"><label class="recipe-field recipe-operation"><span>Operation</span><select data-step="${index}" class="recipe-tool">${toolDefs.map((tool) => `<option value="${tool.id}" ${tool.id === step.tool ? "selected" : ""}>${escapeHtml(tool.label)}</option>`).join("")}</select></label>${operationControls(step.operation)}</div><details class="recipe-advanced"><summary>Advanced operation data</summary><textarea data-step-json="${index}" aria-label="Advanced recipe step JSON">${escapeHtml(JSON.stringify(step.operation, null, 2))}</textarea><small>Edit the underlying operation only if you need a value not shown above.</small></details></details>`).join("") + (state.recipe.note ? `<p class="hint">${escapeHtml(state.recipe.note)}</p>` : "");
  $("#recipe-steps").querySelectorAll("[data-op]").forEach((control) => control.onchange = () => {
    const index = Number(control.closest(".recipe-step").querySelector("[data-step]").dataset.step);
    let value = control.type === "checkbox" ? control.checked : control.value;
    if (control.dataset.kind === "number") value = Number(value);
    if (["quality", "opacity", "scale"].includes(control.dataset.op)) value /= 100;
    setOperationValue(state.recipe.steps[index].operation, control.dataset.op, value);
    state.recipe.steps[index].label = `${operationLabel(state.recipe.steps[index])} · edited`;
    persistRecipeSettings();
    $("#recipe-status").textContent = "Step updated.";
  });
  $("#recipe-steps").querySelectorAll("[data-step-json]").forEach((area) => area.onchange = () => {
    try {
      const index = Number(area.dataset.stepJson);
      const operation = JSON.parse(area.value);
      if (!operation || typeof operation !== "object" || Array.isArray(operation) || typeof operation.type !== "string" || !operation.type.trim())
        throw new Error("Operation type is required.");
      state.recipe.steps[index].operation = operation;
      state.recipe.steps[index].label = `${state.recipe.steps[index].tool} operation`;
      persistRecipeSettings();
      $("#recipe-status").textContent = "Step updated.";
    } catch (error) {
      $("#recipe-status").textContent = error.message === "Operation type is required."
        ? error.message
        : "That step is not valid JSON yet.";
    }
  });
  $("#recipe-steps").querySelectorAll(".recipe-tool").forEach((select) => select.onchange = () => {
    state.recipe.steps[Number(select.dataset.step)].tool = select.value;
    const settings = readStoredObject("pixelproof-recipe-settings");
    settings[state.recipe.id] = {steps: state.recipe.steps};
    writeStoredJson("pixelproof-recipe-settings", settings);
    $("#recipe-status").textContent = "Tool type updated. Edit its operation below.";
  });
}
function saveRecipe() {
  if (!state.recipe) return;
  const name = window.prompt("Name this recipe", state.recipe.name);
  if (!name?.trim()) return;
  const custom = {...state.recipe, id: `custom-${Date.now()}`, name: name.trim().slice(0, 80)};
  const saved = readStoredArray(RECIPE_KEY);
  saved.push(custom);
  writeStoredJson(RECIPE_KEY, saved);
  initRecipes();
  $("#recipe-select").value = custom.id;
  renderRecipe(custom.id);
  $("#recipe-status").textContent = `Saved recipe “${custom.name}”.`;
}
const nav = $("#tool-nav");
toolDefs.forEach((tool) => {
  const button = document.createElement("button");
  button.className = "tool-link";
  button.dataset.tool = tool.id;
  button.innerHTML = `${tool.label}<span>→</span>`;
  button.onclick = () => selectTool(tool.id);
  nav.append(button);
});
document
  .querySelectorAll("[data-brand]")
  .forEach((el) => (el.textContent = PRODUCT.brand));
if ("serviceWorker" in navigator) {
  if (navigator.serviceWorker.controller)
    navigator.serviceWorker.addEventListener("controllerchange", () => {
      if (state.running) {
        pendingServiceWorkerReload = true;
        announce("An app update is ready. It will be applied after this job finishes.", "success");
        reloadWhenIdle();
        return;
      }
      window.location.reload();
    });
  navigator.serviceWorker.register("./sw.js", {updateViaCache: "none"}).catch(() => {});
}
document.title = `${PRODUCT.brand} — private image tools`;
$("#isolation-text").textContent =
  `LOCAL / ${crossOriginIsolated ? "ISOLATED" : "NON-ISOLATED"}`;
if (isIOS()) {
  $("#isolation-text").textContent += " · iOS safety limits active";
  $("#isolation-text").title = "Large images and batches are capped on iPhone and iPad to reduce Safari memory termination risk.";
}
$("#isolation-dot").parentElement.classList.add(
  crossOriginIsolated ? "good" : "bad",
);
$("#dialog-isolation").textContent = String(crossOriginIsolated);
$("#about-button").onclick = () => {
  $("#about-dialog").showModal();
  renderPrivacySelfTest();
  renderLocalData();
};
$("#close-about").onclick = () => $("#about-dialog").close();
function renderPrivacySelfTest() {
  const result = privacySelfTestText();
  $("#privacy-test-summary").textContent = result.summary;
  $("#privacy-resource-list").textContent = result.snapshot.resources.length
    ? result.snapshot.resources.map((item) =>
      `${item.allowed ? "✓" : "!"} ${item.host} · ${item.initiator}${item.bytes ? ` · ${item.bytes} bytes` : ""}`,
    ).join("\n")
    : "No resource timing entries are available yet.";
}
async function renderLocalData() {
  const summary = await localDataSummary();
  const format = formatBytes;
  $("#local-data-summary").innerHTML = [
    `<p><strong>Recovery outputs:</strong> ${format(summary.recovery)} · retained ${summary.recoveryRetention}</p>`,
    `<p><strong>Settings, recipes, profiles, presets, task count, licence state, key, and revalidation timestamp:</strong> ${format(summary.localStorage)}</p>`,
    `<p><strong>Background-removal models:</strong> ${format(summary.models)}</p>`,
  ].join("");
}
$("#privacy-refresh").onclick = renderPrivacySelfTest;
document.querySelectorAll("[data-clear-local]").forEach((button) => {
  button.onclick = async () => {
    await clearLocalData(button.dataset.clearLocal);
    $("#local-data-status").textContent = `${button.textContent.replace("Clear ", "")} cleared from this browser.`;
    await renderLocalData();
  };
});
renderPrivacySelfTest();
$("#choose-files").onclick = () => {
  state.appendSelection = false;
  $("#file-input").click();
};
$("#choose-folder").onclick = () => {
  state.appendSelection = false;
  $("#folder-input").click();
};
$("#sample-run").onclick = async () => {
  const button = $("#sample-run");
  button.disabled = true;
  button.textContent = "Loading sample…";
  try {
    const response = await fetch("./vendor/images/pixelproof-sample-photo.jpg", {cache: "no-store"});
    if (!response.ok) throw new Error("Sample image could not be loaded.");
    const blob = await response.blob();
    clearFiles();
    state.sample = true;
    const file = new File([blob], "pixelproof-sample.jpg", {type: "image/jpeg"});
    addFiles([file], true);
    $("#run-status").textContent = "Bundled sample ready. Running the local pipeline…";
    await run([file], true);
  } catch (error) {
    $("#run-status").textContent = "The bundled sample could not be loaded. Choose one of your own files instead.";
  } finally {
    button.disabled = false;
    button.textContent = "See it work with a sample";
  }
};
$("#file-input").onchange = (e) => {
  const append = state.appendSelection;
  state.appendSelection = false;
  addFiles(e.target.files, false, append);
};
$("#folder-input").onchange = (e) => addFiles(e.target.files);
async function consumeSharedFiles() {
  if (!window.indexedDB) return;
  try {
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open(RECOVERY_DB, 2);
      request.onupgradeneeded = () => {
        const database = request.result;
        if (!database.objectStoreNames.contains("outputs"))
          database.createObjectStore("outputs", {keyPath: "id"});
        if (!database.objectStoreNames.contains("shared-files"))
          database.createObjectStore("shared-files", {keyPath: "id"});
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    const entries = await new Promise((resolve, reject) => {
      const request = db.transaction("shared-files", "readonly").objectStore("shared-files").getAll();
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    if (entries.length) {
      const transaction = db.transaction("shared-files", "readwrite");
      entries.forEach((entry) => transaction.objectStore("shared-files").delete(entry.id));
      await new Promise((resolve) => { transaction.oncomplete = resolve; });
      addFiles(entries.map((entry) => new File([entry.bytes], entry.name, {type: entry.type})));
      $("#run-status").textContent = `${entries.length} shared image${entries.length === 1 ? "" : "s"} added.`;
    }
    db.close();
  } catch {
    $("#run-status").textContent = "Shared files could not be opened. Use Choose files instead.";
  }
}
if (window.launchQueue?.setConsumer)
  window.launchQueue.setConsumer(async ({files}) => addFiles(await Promise.all(files.map((handle) => handle.getFile()))));
if (new URLSearchParams(location.search).has("shared"))
  consumeSharedFiles();
document.addEventListener("paste", (event) => {
  const files = [...(event.clipboardData?.items || [])]
    .filter((item) => item.kind === "file")
    .map((item) => item.getAsFile())
    .filter(Boolean);
  if (files.length) {
    event.preventDefault();
    addFiles(files);
    $("#run-status").textContent = `${files.length} pasted image${files.length === 1 ? "" : "s"} added.`;
  }
});
["dragenter", "dragover"].forEach((type) =>
  $("#dropzone").addEventListener(type, (e) => {
    e.preventDefault();
    $("#dropzone").classList.add("drag");
  }),
);
["dragleave", "drop"].forEach((type) =>
  $("#dropzone").addEventListener(type, (e) => {
    e.preventDefault();
    $("#dropzone").classList.remove("drag");
  }),
);
$("#dropzone").ondrop = (e) => addFiles(e.dataTransfer.files);
window.addEventListener("beforeunload", (event) => {
  if (!state.running) return;
  event.preventDefault();
  event.returnValue = "Processing is still running. Completed outputs will remain recoverable, but leaving may stop the batch.";
});
document.addEventListener("visibilitychange", () => {
  if (state.running && document.visibilityState === "hidden")
    announce("This tab is in the background. Keep it open; completed outputs are saved as they finish.");
  else if (state.running)
    announce("Processing resumed in the foreground.");
});
window.addEventListener("offline", () => announce("You are offline. Local image processing can continue; model downloads and app updates cannot.", "error"));
window.addEventListener("online", () => announce("Connection restored. Local processing remains in this tab.", "success"));
window.addEventListener("storage", (event) => {
  if (event.key === "pixelproof-task-state" || event.key === "pixelproof-license-state")
    window.dispatchEvent(new Event("entitlementchange"));
});
$("#reset-tool").onclick = () => {
  const all = savedSettings();
  delete all[state.tool];
  writeStoredJson(SETTINGS_KEY, all);
  renderControls();
};
$("#run-button").onclick = () => {
  if (state.running) {
    state.cancel = true;
    cancelActiveWorkers();
  } else run();
};
function selectTool(id) {
  if (state.running) {
    state.cancel = true;
    cancelActiveWorkers();
    const current = toolDefs.find((tool) => tool.id === state.tool);
    $("#run-status").textContent = `${current?.label || "The current tool"} is still running. Use Cancel current job to stop it before switching tools.`;
    $("#run-button").focus();
    return;
  }
  if (state.results.length) {
    state.resultNotice = previousResultNotice();
    renderResults();
  }
  state.tool = id;
  $("#run-status").textContent = "";
  $("#results").hidden = false;
  setProgress(0, 0);
document
  .querySelectorAll(".tool-link")
    .forEach((b) => {
      const active = b.dataset.tool === id;
      b.classList.toggle("active", active);
      if (active) b.setAttribute("aria-current", "page");
      else b.removeAttribute("aria-current");
    });
  const tool = toolDefs.find((x) => x.id === id);
  $("#tool-kicker").textContent = tool.kicker;
  $("#tool-title").textContent = tool.title;
  $("#tool-description").textContent = tool.description;
  renderControls();
}
function addFiles(list, isSample = false, append = false) {
  if (state.running) {
    $("#run-status").textContent = "A job is running. Cancel it before changing the selection.";
    return;
  }
  const incoming = [...list].filter((f) =>
    /^image\/(jpeg|png|webp|bmp|gif|svg\+xml|apng)$/.test(f.type) ||
    /^(image\/(x-icon|vnd\.microsoft\.icon))$/.test(f.type) ||
    /\.(heic|heif|bmp|gif|ico|cur|svg|apng)$/i.test(f.name) || isHeic(f) ||
    (f.size > 0 && !f.name.includes(".")),
  );
  if (!incoming.length) {
    $("#run-status").textContent = "No supported image files were added. Choose a non-empty JPEG, PNG, WebP, HEIC/HEIF, BMP, GIF, ICO, or SVG file.";
    return;
  }
  if (!isSample && state.sample) {
    state.files = [];
    state.animationFiles = [];
    state.pdfOrder = [];
  }
  if (!isSample) state.sample = false;
  if (!append) {
    if (state.results.length) {
      state.resultNotice = previousResultNotice();
      renderResults();
    }
    state.files = [];
    state.animationFiles = [];
    state.pdfOrder = [];
  }
  state.files = [...state.files, ...incoming];
  state.pdfOrder = state.files;
  inspectAnimations(incoming).then((found) => {
    state.animationFiles = [...new Set([...state.animationFiles, ...found])];
    renderAnimationWarning();
  });
  const oversized = state.files.find((f) => f.size > PRODUCT.maxPixels * 4);
  $("#file-summary").hidden = false;
  const entitlement = getEntitlementState();
  const jobLimit = entitlement.tasksPerDay === Infinity
    ? "unlimited jobs"
    : `${Math.max(0, entitlement.tasksPerDay - entitlement.tasksUsed)} jobs left today`;
  $("#file-summary").innerHTML =
    `<span>${state.sample ? "Bundled sample · " : ""}${state.files.length} image${state.files.length === 1 ? "" : "s"} selected for the next run.</span><span>${oversized ? "Large files will be checked before processing." : "Image bytes stay in this browser."} · ${entitlement.label} · ${jobLimit}</span><div class="file-summary-actions"><button class="text-button add-selection" type="button">Add files</button><button class="text-button clear-selection" type="button">Clear selection</button></div><div id="animation-warning"></div><div id="color-warning"></div>`;
  $(".add-selection")?.addEventListener("click", () => {
    state.appendSelection = true;
    $("#file-input").click();
  });
  $(".clear-selection")?.addEventListener("click", clearFiles);
  $(".clear-sample")?.addEventListener("click", clearFiles);
  $("#controls").hidden = false;
  renderControls();
  renderColorWarning(state.files);
}
function refreshJobLimit() {
  const summary = $("#file-summary");
  const spans = summary?.querySelectorAll(":scope > span");
  if (!spans?.[1]) return;
  const entitlement = getEntitlementState();
  const jobLimit = entitlement.tasksPerDay === Infinity
    ? "unlimited jobs"
    : `${Math.max(0, entitlement.tasksPerDay - entitlement.tasksUsed)} jobs left today`;
  const oversized = state.files.some((file) => file.size > PRODUCT.maxPixels * 4);
  spans[1].textContent = `${oversized ? "Large files will be checked before processing." : "Image bytes stay in this browser."} · ${entitlement.label} · ${jobLimit}`;
}
window.addEventListener("entitlementchange", refreshJobLimit);
function scheduleDailyEntitlementRefresh() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  setTimeout(() => {
    refreshJobLimit();
    scheduleDailyEntitlementRefresh();
  }, Math.max(1_000, next.getTime() - now.getTime()));
}
scheduleDailyEntitlementRefresh();
function clearFiles() {
  if (state.running) {
    $("#run-status").textContent = "A job is running. Cancel it before clearing the selection.";
    return;
  }
  if (state.results.length) {
    state.resultNotice = previousResultNotice();
    renderResults();
  }
  state.files = [];
  state.appendSelection = false;
  state.sample = false;
  state.animationFiles = [];
  state.pdfOrder = [];
  $("#file-input").value = "";
  $("#folder-input").value = "";
  $("#file-summary").hidden = true;
  $("#controls").hidden = true;
  $("#results").hidden = false;
  setProgress(0, 0);
  $("#run-status").textContent = "";
}
function revokeResultUrls() {
  state.urls.splice(0).forEach((url) => URL.revokeObjectURL(url));
  state.compareUrls.splice(0).forEach((url) => URL.revokeObjectURL(url));
}
function previousResultNotice() {
  const tool = toolDefs.find((item) => item.id === state.resultToolId);
  const label = tool?.label || state.resultToolLabel || "Previous tool";
  const count = state.results.filter((result) => result.bytes).length;
  const noun = count === 1 ? "completed output" : "completed outputs";
  const pronoun = count === 1 ? "It" : "They";
  const verb = count === 1 ? "remains" : "remain";
  return `Previous ${label} run · ${count} ${noun} ${verb} below. ${pronoun} ${count === 1 ? "is" : "are"} not part of the next run.`;
}
function setRunBusy(busy) {
  const current = toolDefs.find((tool) => tool.id === state.tool);
  document.querySelectorAll(".tool-link").forEach((link) => {
    link.disabled = busy;
    link.setAttribute("aria-disabled", String(busy));
    link.classList.toggle("busy", busy);
    if (busy) link.title = `${current?.label || "Current tool"} is running. Cancel the job before switching tools.`;
    else link.removeAttribute("title");
  });
  const button = $("#run-button");
  if (!button) return;
  const progress = $("#run-progress");
  if (progress) progress.hidden = !busy;
  button.textContent = busy ? "Cancel current job" : "Process images";
  button.setAttribute("aria-label", busy
    ? `Cancel current ${current?.label || "image"} job`
    : `Run ${current?.label || "image"} job`);
}
function outputEstimatePending() {
  const output = $("#size-estimate");
  if (!output || !state.files[0]) return;
  const countLabel = state.files.length > 1 ? `First image of ${state.files.length}` : "Selected image";
  output.textContent = `${countLabel}: estimating…`;
  estimateRequest++;
}
async function inspectAnimations(files) {
  const found = [];
  for (const file of files) {
    const bytes = new Uint8Array(await file.slice(0, Math.min(file.size, 2_000_000)).arrayBuffer());
    const name = file.name;
    const gif = bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46 && countGifFrames(bytes) > 1;
    const apng = bytes.includes(0x61) && bytes.includes(0x63) && bytes.includes(0x54) && bytes.includes(0x4c) && hasChunk(bytes, "acTL");
    const webp = hasChunk(bytes, "ANIM");
    if (gif || apng || webp) found.push(name);
  }
  return found;
}
function hasChunk(bytes, text) {
  const needle = [...text].map((character) => character.charCodeAt(0));
  for (let index = 0; index <= bytes.length - needle.length; index++)
    if (needle.every((value, offset) => bytes[index + offset] === value)) return true;
  return false;
}
function countGifFrames(bytes) {
  let frames = 0;
  let index = 13;
  if (bytes.length < 13) return 0;
  const packed = bytes[10];
  index += packed & 0x80 ? 3 * (2 ** ((packed & 0x07) + 1)) : 0;
  const skipSubBlocks = () => {
    while (index < bytes.length) {
      const size = bytes[index++];
      if (!size) break;
      index += size;
    }
  };
  while (index < bytes.length) {
    if (bytes[index] === 0x2c) {
      frames++;
      if (frames > 1) return frames;
      index += 10;
      if (index > bytes.length) break;
      const localPacked = bytes[index - 1];
      if (localPacked & 0x80) index += 3 * (2 ** ((localPacked & 0x07) + 1));
      index++;
      skipSubBlocks();
    } else if (bytes[index] === 0x21) {
      index += 2;
      skipSubBlocks();
    } else if (bytes[index] === 0x3b) {
      break;
    } else {
      index++;
    }
  }
  return frames;
}
function renderAnimationWarning() {
  const output = $("#animation-warning");
  if (!output || !state.animationFiles.length) return;
  output.innerHTML = `<div class="warning-callout"><strong>Animated input detected:</strong> ${state.animationFiles.map(escapeHtml).join(", ")}. Only the first frame will be processed; animation will not be preserved. <label class="check"><input id="allow-animation" type="checkbox"> I understand</label></div>`;
}
async function renderColorWarning(files = state.files) {
  const output = $("#color-warning");
  if (!output) return;
  const infos = await Promise.all(files.map((file) => inspectColorInfo(file)));
  const profile = files.filter((file, index) => infos[index].embeddedProfile).map((file) => file.name);
  const highDepth = files
    .map((file, index) => ({file, info: infos[index]}))
    .filter(({info}) => info.bitDepth > 8)
    .map(({file, info}) => `${file.name} (${info.bitDepth}-bit)`);
  if (!profile.length && !highDepth.length) {
    output.innerHTML = "";
    return;
  }
  const details = [];
  if (profile.length) details.push(`embedded colour profiles may be converted to the browser's working colour space and are not carried into exports: ${profile.join(", ")}`);
  if (highDepth.length) details.push(`Higher-than-8-bit input is reduced to 8-bit canvas output: ${highDepth.join(", ")}`);
  output.innerHTML = `<div class="warning-callout"><strong>Colour handling:</strong> ${details.join(". ")}.</div>`;
}
function savedSettings() {
  return readStoredObject(SETTINGS_KEY);
}
function persistSettings() {
  const values = {};
  $("#control-content")?.querySelectorAll("input[id], select[id], textarea[id]").forEach((input) => {
    if (input.type !== "file") values[input.id] = input.type === "checkbox" ? input.checked : input.value;
  });
  const all = savedSettings();
  all[state.tool] = values;
  writeStoredJson(SETTINGS_KEY, all);
}
function restoreSettings() {
  const values = savedSettings()[state.tool] || {};
  Object.entries(values).forEach(([id, value]) => {
    const input = document.getElementById(id);
    if (!input) return;
    if (input.type === "checkbox") input.checked = value === true || value === "true";
    else input.value = value;
  });
}
function relativePath(file) {
  const safe = [];
  for (const part of (file.webkitRelativePath || file.name).replace(/^\/+/, "").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") { safe.pop(); continue; }
    safe.push(part.replace(/[<>:"|?*\x00-\x1f]/g, "_"));
  }
  return safe.join("/") || "image";
}
function field(label, html, wide = "") {
  const controlId = html.match(/\bid="([^"]+)"/)?.[1];
  return `<div class="field ${wide}"><label${controlId ? ` for="${controlId}"` : ""}>${label}</label>${html}</div>`;
}
async function inputFormatPreference(file) {
  if (
    !file ||
    (!/^image\/(png|gif|bmp|x-icon|svg\+xml)/i.test(file.type) &&
      !/\.(png|gif|bmp|ico|svg)$/i.test(file.name))
  )
    return null;
  try {
    const image = await createImageBitmap(file);
    const canvas = document.createElement("canvas");
    canvas.width = 96;
    canvas.height = 96;
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0, 96, 96);
    const pixels = context.getImageData(0, 0, 96, 96).data;
    image.close();
    let alpha = false;
    const colours = new Set();
    for (let index = 0; index < pixels.length; index += 4) {
      if (pixels[index + 3] < 255) alpha = true;
      colours.add(
        [
          pixels[index] >> 4,
          pixels[index + 1] >> 4,
          pixels[index + 2] >> 4,
          pixels[index + 3] >> 4,
        ].join(","),
      );
      if (colours.size > 96) break;
    }
    return {mime: "image/png", flat: alpha || colours.size <= 96};
  } catch {
    return null;
  }
}
function renderControls() {
  const id = state.tool;
  $("#run-button").textContent = "Process images";
  $("#run-button").hidden = id === "background-removal";
  if (id === "background-removal") {
    mountBackgroundTool($("#control-content"), { files: state.files });
    mountPresetControls();
    $("#controls").hidden = !state.files.length;
    return;
  }
  if (id === "face-blur") {
    $("#run-button").hidden = true;
    mountFaceBlur();
    $("#controls").hidden = !state.files.length;
    return;
  }
  let html = "";
  if (id === "compress")
    html = `<p class="hint">Format defaults to PNG for transparency and flat-colour art, JPEG for photographs. You can override it. PNG is lossless by default. Palette mode is for flat-colour graphics; gradients, screenshots, and photographs may show visible dithering, so keep those on Lossless.</p><div class="form-grid">${field("Output format", `<select id="format"><option value="image/jpeg">JPEG</option><option value="image/webp">WebP</option><option value="image/png">PNG</option><option value="image/avif">AVIF</option></select>`)}${field("Quality", `<input id="quality" type="range" min="10" max="100" value="82"><output id="quality-output">82</output>`)}${field("PNG mode", '<select id="pngMode"><option value="lossless">Lossless</option><option value="palette">Smaller palette (slightly lossy)</option></select>')}${field("Strip metadata", '<label class="check"><input id="strip" type="checkbox" checked> Remove EXIF and metadata</label>')}<div class="field"><label>Live output estimate</label><output id="size-estimate" class="mono">Choose an image to estimate</output></div></div>`;
  else if (id === "target-size")
    html = `<p class="hint">Each image gets its own quality search. If the target is unreachable at the current dimensions, the result explains why; optionally allow a dimension reduction.</p><div class="form-grid">${field("Output format", '<select id="format"><option value="image/jpeg">JPEG</option><option value="image/webp">WebP</option></select>')}${field("Maximum bytes", '<input id="targetBytes" type="number" min="1024" step="1024" value="200000">')}${field("When unreachable", '<label class="check"><input id="reduceDimensions" type="checkbox"> Reduce dimensions to reach the budget</label>')}</div>`;
  else if (id === "resize")
    html = `<div class="form-grid">${field("Mode", '<select id="mode"><option value="dimensions">Dimensions</option><option value="percentage">Percentage</option><option value="fit">Fit within preset</option></select>')}${field("Width", '<input id="width" type="number" min="1" value="1200">')}${field("Height", '<input id="height" type="number" min="1" value="800">')}${field("Percentage", '<input id="value" type="number" min="1" max="400" value="50">')}${field("Preset", '<select id="preset"><option value="1200x1200">Square 1200</option><option value="1920x1080">HD 1920×1080</option><option value="2048x2048">Shopify 2048</option></select>')}</div>`;
  else if (id === "crop")
    html = `<p class="hint">Drag the crop frame in the preview, or enter source pixels precisely.</p><div class="crop-preview"><canvas id="crop-preview" width="640" height="360"></canvas></div><div class="form-grid">${field("Aspect ratio", '<select id="aspect"><option value="free">Free</option><option value="1:1">1:1 square</option><option value="4:3">4:3</option><option value="16:9">16:9</option><option value="3:2">3:2</option></select>')}${field("X", '<input id="x" type="number" min="0" value="0">')}${field("Y", '<input id="y" type="number" min="0" value="0">')}${field("Width", '<input id="width" type="number" min="1" value="800">')}${field("Height", '<input id="height" type="number" min="1" value="600">')}</div>`;
  else if (id === "transform")
    html = `<div class="form-grid">${field("Rotation", '<select id="degrees"><option value="0">0°</option><option value="90">90° clockwise</option><option value="180">180°</option><option value="270">270° clockwise</option></select>')}${field("Flip", '<select id="flip"><option value="none">None</option><option value="x">Flip horizontal</option><option value="y">Flip vertical</option></select>')}</div>`;
  else if (id === "convert")
    html = `<div class="form-grid">${field("Output format", '<select id="format"><option value="image/jpeg">JPEG</option><option value="image/png">PNG</option><option value="image/webp">WebP</option><option value="image/avif">AVIF</option></select>')}${field("Quality", '<input id="quality" type="range" min="10" max="100" value="88">')}</div>`;
  else if (id === "watermark")
    html = `<div class="form-grid">${field("Text watermark", '<input id="text" placeholder="© Your brand">', "field-wide")}${field("Image watermark", '<input id="mark" type="file" accept="image/png,image/jpeg,image/webp">')}${field("Position", '<select id="position"><option value="bottom-right">Bottom right</option><option value="bottom-left">Bottom left</option><option value="center">Center</option><option value="top-right">Top right</option></select>')}${field("Opacity", '<input id="opacity" type="range" min="0.1" max="1" step="0.05" value="0.55">')}${field("Scale", '<input id="scale" type="range" min="0.05" max="0.6" step="0.01" value="0.2">')}</div>`;
  else if (id === "photo-editor")
    html = `<canvas id="editor-preview" class="tool-preview" width="640" height="420"></canvas><p class="hint">Double-click any slider to reset that adjustment. Use reset-all for the complete edit.</p><div class="form-grid editor-grid">${field("Brightness", '<input id="brightness" type="range" min="-100" max="100" value="0">')}${field("Contrast", '<input id="contrast" type="range" min="-100" max="100" value="0">')}${field("Saturation", '<input id="saturation" type="range" min="-100" max="100" value="0">')}${field("Exposure", '<input id="exposure" type="range" min="-2" max="2" step="0.1" value="0">')}${field("Temperature", '<input id="temperature" type="range" min="-100" max="100" value="0">')}${field("Tint", '<input id="tint" type="range" min="-100" max="100" value="0">')}${field("Sharpen", '<input id="sharpen" type="range" min="0" max="2" step="0.1" value="0">')}${field("Blur", '<input id="blur" type="range" min="0" max="8" step="0.5" value="0">')}${field("Vignette", '<input id="vignette" type="range" min="0" max="0.8" step="0.05" value="0">')}${field("Filter", '<select id="filter"><option value="none">None</option><option value="mono">Monochrome</option><option value="warm">Warm</option><option value="cool">Cool</option><option value="faded">Faded</option></select>')}${field("Overlay text", '<input id="text" placeholder="Optional text">')}${field("Text font", '<select id="font"><option value="Arial">Arial</option><option value="Georgia">Georgia</option><option value="Courier New">Courier New</option><option value="Impact">Impact</option></select>')}${field("Text colour", '<input id="color" type="color" value="#ffffff">')}${field("Text size", '<input id="textSize" type="range" min="0.02" max="0.15" step="0.01" value="0.05">')}${field("Text position", '<select id="position"><option value="bottom-right">Bottom right</option><option value="bottom-left">Bottom left</option><option value="center">Center</option><option value="top-right">Top right</option></select>')}</div><button class="text-button" id="reset-adjustments">Reset all adjustments</button>`;
  else if (id === "meme")
    html = `<div class="form-grid">${field("Top caption", '<input id="top" placeholder="TOP TEXT">', "field-wide")}${field("Bottom caption", '<input id="bottom" placeholder="BOTTOM TEXT">', "field-wide")}${field("Caption size", '<input id="size" type="range" min="0.04" max="0.14" step="0.01" value="0.08">')}${field("Top position", '<input id="topPosition" type="range" min="0.05" max="0.35" step="0.01" value="0.1">')}${field("Bottom position", '<input id="bottomPosition" type="range" min="0.05" max="0.35" step="0.01" value="0.1">')}</div>`;
  else if (id === "social")
    html = `<div class="form-grid">${field("Preset", '<select id="preset"><option value="og">OG / Facebook · 1200×630</option><option value="twitter">Twitter card · 1200×675</option><option value="youtube">YouTube thumbnail · 1280×720</option><option value="instagram-square">Instagram square · 1080×1080</option><option value="instagram-portrait">Instagram portrait · 1080×1350</option><option value="instagram-story">Instagram story · 1080×1920</option><option value="linkedin">LinkedIn · 1200×627</option></select>')}${field("Framing", '<select id="framing"><option value="fit">Fit — no crop</option><option value="fill">Fill — crop edges</option></select>')}</div>`;
  else if (id === "icon-set")
    html = `<p class="hint">Generates standard names for browser, PWA, and Apple icons.</p><div class="form-grid">${field("Background", '<select id="iconBackground"><option value="transparent">Transparent</option><option value="#ffffff">White</option></select>')}</div><div class="snippet-box" id="icon-snippet">Run the set to generate the copy-ready snippet.</div>`;
  else if (id === "rename")
    html = `<p class="hint">Tokens: <code>{prefix}</code> <code>{stem}</code> <code>{seq}</code> <code>{width}</code> <code>{height}</code> <code>{date}</code>.</p><div class="form-grid">${field("Pattern", '<input id="pattern" value="{prefix}-{seq}-{stem}">')}${field("Prefix", '<input id="prefix" value="export">')}${field("Zero padding", '<input id="padding" type="number" min="1" max="6" value="3">')}</div>`;
  else if (id === "palette")
    html = `<div class="form-grid">${field("Colours", '<input id="paletteCount" type="number" min="3" max="12" value="6">')}</div><div id="palette-output" class="palette-output">Run extraction to see copyable colours.</div>`;
  else if (id === "compare")
    html = `<div class="form-grid">${field("Format", '<select id="format"><option value="image/jpeg">JPEG</option><option value="image/webp">WebP</option></select>')}${field("Quality", '<input id="quality" type="range" min="10" max="100" value="75">')}</div><div id="compare-output" class="compare-output">Run a comparison to inspect the result.</div>`;
  else if (id === "metadata")
    html = `<p class="hint">Metadata is read directly from the selected file bytes. GPS is called out separately because location data can be sensitive.</p><div id="metadata-output" class="metadata-output">Choose an image to inspect.</div><div class="form-grid">${field("Export mode", '<select id="metadataMode"><option value="strip">Strip all metadata</option><option value="preserve">Keep copyright and orientation</option></select>')}</div>`;
  else if (id === "image-to-pdf")
    html = `<p class="hint">PDFs embed re-encoded JPEG pages at a size-conscious quality. Drag pages below to change their order. A combined PDF or one PDF per image can be exported.</p><div id="pdf-pages" class="pdf-pages"></div><div class="form-grid">${field("Page size", '<select id="pdfSize"><option value="a4">A4</option><option value="letter">US Letter</option><option value="match">Match image</option></select>')}${field("Orientation", '<select id="pdfOrientation"><option value="portrait">Portrait</option><option value="landscape">Landscape</option></select>')}${field("Image framing", '<select id="pdfMode"><option value="fit">Fit — no crop</option><option value="fill">Fill — crop edges</option></select>')}${field("Margins (mm)", '<input id="pdfMargin" type="number" min="0" max="50" step="1" value="10">')}${field("Output", '<select id="pdfOutput"><option value="combined">One combined PDF</option><option value="single">One PDF per image</option></select>')}</div><p id="pdf-status" class="hint"></p>`;
  else if (id === "platform-profiles") {
    const profiles = [...PLATFORM_PROFILES, ...readStoredArray("pixelproof-platform-profiles")];
    html = `<p class="hint">These are starting points based on published guidance. They are editable, date-stamped references—not platform approval or a compliance guarantee.</p><div class="form-grid">${field("Profile", `<select id="platformProfile">${profiles.map((profile) => `<option value="${escapeHtml(profile.id)}">${escapeHtml(profile.name)}</option>`).join("")}</select>`)}${field("Width (px)", '<input id="platformWidth" type="number" min="1" value="1200">')}${field("Height (px)", '<input id="platformHeight" type="number" min="1" value="800">')}${field("Framing", '<select id="platformMode"><option value="fit">Fit — no crop</option><option value="fill">Fill — crop edges</option></select>')}${field("Output", '<select id="platformMime"><option value="image/jpeg">JPEG</option><option value="image/png">PNG</option><option value="image/webp">WebP</option></select>')}</div><div id="platform-source" class="profile-source"></div><button class="text-button" id="save-platform-profile">Save as editable profile</button>`;
  } else if (id === "id-print-sheet")
    html = `<p class="warning-callout"><strong>DIMENSIONS AND PRINT LAYOUT ONLY.</strong> PixelProof does not check face position, expression, lighting, background, editing rules, eligibility, or application acceptance.</p><div class="form-grid">${field("Photo profile", '<select id="idProfile"><option value="us">US passport · 2×2 in / 51×51 mm</option><option value="ca">Canada passport · 50×70 mm</option><option value="uk">UK passport · 35×45 mm</option></select>')}${field("Paper", '<select id="idPaper"><option value="4x6">4×6 inch</option><option value="a4">A4</option></select>')}${field("Copies", '<input id="idCopies" type="number" min="1" max="20" value="6">')}</div><p class="hint">Sources and checked dates are shown before export. Use the result as a print layout, not proof of acceptance.</p><div id="id-source" class="profile-source"></div>`;
  else if (id === "svg-raster")
    html = `<p class="hint">SVG is rasterised locally after scripts, event handlers, and external resource references are removed. Choose the output pixel dimensions.</p><div class="form-grid">${field("Raster width", '<input id="svgWidth" type="number" min="1" max="8000" value="1200">')}${field("Raster height", '<input id="svgHeight" type="number" min="1" max="8000" value="1200">')}</div>`;
  else
    html = `<p class="hint">Creates WordPress and Shopify sizes from each source image. Outputs are named with the source stem and destination suffix.</p><div class="form-grid">${field("Export family", '<select id="family"><option value="all">WordPress + Shopify</option><option value="wordpress">WordPress sizes</option><option value="shopify">Shopify sizes</option></select>')}${field("Output format", '<select id="format"><option value="image/jpeg">JPEG</option><option value="image/webp">WebP</option></select>')}</div>`;
  $("#control-content").innerHTML = html;
  restoreSettings();
  $("#control-content").querySelectorAll("input[id], select[id], textarea[id]").forEach((input) => {
    input.addEventListener("change", persistSettings);
    input.addEventListener("input", persistSettings);
  });
  mountPresetControls();
  if (id === "photo-editor") setupEditorPreview();
  if (id === "icon-set") $("#run-button").textContent = "Generate icon set";
  if (id === "palette") $("#run-button").textContent = "Extract palette";
  if (id === "compare") $("#run-button").textContent = "Compare";
  if (id === "target-size") $("#run-button").textContent = "Hit target size";
  if (id === "metadata") $("#run-button").textContent = "Strip / export";
  if (id === "image-to-pdf") {
    $("#run-button").textContent = "Build PDF";
    renderPdfPages();
  }
  if (id === "platform-profiles") setupPlatformProfileControls();
  if (id === "id-print-sheet") setupIdSheetControls();
  if ($("#quality")) {
    let estimateTimer;
    const updateQualityAvailability = () => {
      const lossless = $("#format")?.value === "image/png" && $("#pngMode")?.value === "lossless";
      $("#quality").disabled = lossless;
      $("#quality").closest(".field")?.classList.toggle("is-disabled", lossless);
    };
    $("#quality").oninput = (e) => {
      const o = $("#quality-output");
      if (o) o.value = e.target.value;
      clearTimeout(estimateTimer);
      outputEstimatePending();
      estimateTimer = setTimeout(updateEstimate, 250);
    };
    $("#format").onchange = () => {
      updateQualityAvailability();
      outputEstimatePending();
      updateEstimate();
    };
    if ($("#pngMode")) $("#pngMode").onchange = () => {
      updateQualityAvailability();
      outputEstimatePending();
      updateEstimate();
    };
    updateQualityAvailability();
    updateEstimate();
    if (id === "compress" && state.files[0]) {
      inputFormatPreference(state.files[0]).then((preference) => {
        if (!preference || !$("#format") || $("#format").dataset.userChosen) return;
        $("#format").value = preference.mime;
        updateEstimate();
      });
      $("#format").addEventListener("change", () => {
        $("#format").dataset.userChosen = "true";
      }, {once: true});
    }
  }
  if (id === "crop") setupCropPreview();
  if (id === "metadata") updateMetadata();
  $("#controls").hidden = !state.files.length;
}
function renderPdfPages() {
  const list = $("#pdf-pages");
  if (!list) return;
  const files = state.pdfOrder.length ? state.pdfOrder : state.files;
  list.innerHTML = files.map((file, index) => `<div class="pdf-page" draggable="true" data-index="${index}"><button class="drag-handle" type="button" aria-label="Reorder page ${index + 1}">☷</button><strong>${index + 1}</strong><span>${escapeHtml(relativePath(file))}</span></div>`).join("");
  let dragged;
  const movePage = (from, target) => {
    if (from === target || target < 0 || target >= files.length) return;
    const ordered = [...files];
    const [moved] = ordered.splice(from, 1);
    ordered.splice(target, 0, moved);
    state.pdfOrder = ordered;
    renderPdfPages();
    list.querySelector(`.drag-handle[aria-label="Reorder page ${target + 1}"]`)?.focus();
  };
  list.querySelectorAll(".pdf-page").forEach((page) => {
    page.ondragstart = () => { dragged = Number(page.dataset.index); page.classList.add("dragging"); };
    page.ondragend = () => page.classList.remove("dragging");
    page.ondragover = (event) => event.preventDefault();
    page.ondrop = (event) => {
      event.preventDefault();
      const target = Number(page.dataset.index);
      movePage(dragged, target);
    };
    const handle = page.querySelector(".drag-handle");
    handle.onkeydown = (event) => {
      const index = Number(page.dataset.index);
      if (event.key === "ArrowUp" || event.key === "ArrowLeft") {
        event.preventDefault();
        movePage(index, index - 1);
      } else if (event.key === "ArrowDown" || event.key === "ArrowRight") {
        event.preventDefault();
        movePage(index, index + 1);
      }
    };
    handle.onpointerdown = (event) => {
      dragged = Number(page.dataset.index);
      page.classList.add("dragging");
      handle.setPointerCapture?.(event.pointerId);
    };
    handle.onpointerup = (event) => {
      if (dragged === undefined) return;
      const targetPage = document.elementFromPoint(event.clientX, event.clientY)?.closest(".pdf-page");
      const target = targetPage ? Number(targetPage.dataset.index) : dragged;
      const from = dragged;
      page.classList.remove("dragging");
      dragged = undefined;
      movePage(from, target);
    };
    handle.onpointercancel = () => {
      dragged = undefined;
      page.classList.remove("dragging");
    };
  });
}
function setupPlatformProfileControls() {
  const select = $("#platformProfile"), source = $("#platform-source");
  const custom = readStoredArray("pixelproof-platform-profiles");
  const profiles = [...PLATFORM_PROFILES, ...custom];
  const apply = () => {
    const profile = profiles.find((item) => item.id === select.value) || profiles[0];
    $("#platformWidth").value = profile.width; $("#platformHeight").value = profile.height;
    $("#platformMode").value = profile.mode || "fit"; $("#platformMime").value = profile.mime || "image/jpeg";
    source.innerHTML = `Starting point · checked ${escapeHtml(profile.checked || "local")} · <a href="${escapeHtml(profile.source || "#")}" target="_blank" rel="noreferrer">published source</a>`;
  };
  select.onchange = apply; apply();
  $("#save-platform-profile").onclick = () => {
    const name = window.prompt("Name this editable platform profile");
    if (!name?.trim()) return;
    const saved = readStoredArray("pixelproof-platform-profiles");
    saved.push({id: `custom-${Date.now()}`, name: name.trim().slice(0, 80), width: Number($("#platformWidth").value), height: Number($("#platformHeight").value), mode: $("#platformMode").value, mime: $("#platformMime").value, source: "User-edited from published guidance", checked: new Date().toISOString().slice(0, 10)});
    writeStoredJson("pixelproof-platform-profiles", saved);
    renderControls();
    $("#run-status").textContent = `Saved editable profile “${name.trim()}”.`;
  };
}
function setupIdSheetControls() {
  const sources = {
    us: ["US passport: 51×51 mm; head guidance 25–35 mm", "https://travel.state.gov/content/travel/en/passports/how-apply/photos.html"],
    ca: ["Canada passport: 50×70 mm", "https://www.canada.ca/en/immigration-refugees-citizenship/services/canadian-passports/photos.html"],
    uk: ["UK passport: 35×45 mm; face guidance 29–34 mm", "https://www.gov.uk/government/publications/passport-photos-guide-for-photographers/guidance-for-photographers"],
  };
  const update = () => {
    const [text, url] = sources[$("#idProfile").value];
    $("#id-source").innerHTML = `${escapeHtml(text)} · <a href="${url}" target="_blank" rel="noreferrer">official source</a> · checked 2026-08-11`;
  };
  $("#idProfile").onchange = update; update();
}
async function updateEstimate() {
  const output = $("#size-estimate");
  if (!output || !state.files[0] || state.running) return;
  const request = ++estimateRequest;
  const countLabel = state.files.length > 1 ? `First image of ${state.files.length}` : "Selected image";
  output.textContent = `${countLabel}: estimating…`;
  try {
    const base = await options();
    const result = await processOne(state.files[0], {
      ...base,
      maxPixels: PRODUCT.maxPixels,
    });
    if (request !== estimateRequest) return;
    const lossless = result.mime === "image/png" && $("#pngMode")?.value === "lossless";
    output.textContent = `${countLabel}: ${formatBytes(result.bytes.byteLength)} · ${result.mime}${lossless ? " · lossless" : ""}`;
  } catch (error) {
    if (request === estimateRequest) output.textContent = `${countLabel}: unavailable`;
  }
}
function setupCropPreview() {
  const canvas = $("#crop-preview"),
    file = state.files[0];
  if (!canvas || !file) return;
  const image = new Image();
  image.onload = () => {
    const scale = Math.min(
        canvas.width / image.naturalWidth,
        canvas.height / image.naturalHeight,
      ),
      dw = image.naturalWidth * scale,
      dh = image.naturalHeight * scale,
      ox = (canvas.width - dw) / 2,
      oy = (canvas.height - dh) / 2;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(image, ox, oy, dw, dh);
    const frame = () => {
      ctx.drawImage(image, ox, oy, dw, dh);
      const x = Number($("#x").value) || 0,
        y = Number($("#y").value) || 0,
        w = Number($("#width").value) || image.naturalWidth,
        h = Number($("#height").value) || image.naturalHeight;
      ctx.fillStyle = "#12203a99";
      ctx.fillRect(ox, oy, dw, dh);
      ctx.clearRect(ox + x * scale, oy + y * scale, w * scale, h * scale);
      ctx.drawImage(
        image,
        ox + x * scale,
        oy + y * scale,
        w * scale,
        h * scale,
        ox + x * scale,
        oy + y * scale,
        w * scale,
        h * scale,
      );
      ctx.strokeStyle = "#ffe45c";
      ctx.lineWidth = 3;
      ctx.strokeRect(ox + x * scale, oy + y * scale, w * scale, h * scale);
    };
    frame();
    ["x", "y", "width", "height", "aspect"].forEach((id) =>
      $("#" + id)?.addEventListener("input", frame),
    );
    let dragging = false,
      last;
    canvas.onpointerdown = (e) => {
      dragging = true;
      last = e;
      canvas.setPointerCapture(e.pointerId);
    };
    canvas.onpointermove = (e) => {
      if (!dragging) return;
      const scale = Math.min(
        canvas.width / image.naturalWidth,
        canvas.height / image.naturalHeight,
      );
      $("#x").value = Math.max(
        0,
        Math.round(Number($("#x").value) - (last.clientX - e.clientX) / scale),
      );
      $("#y").value = Math.max(
        0,
        Math.round(Number($("#y").value) - (last.clientY - e.clientY) / scale),
      );
      last = e;
      frame();
    };
    canvas.onpointerup = () => {
      dragging = false;
    };
  };
  image.src = URL.createObjectURL(file);
}
function mountPresetControls() {
  let row = $("#preset-actions");
  if (!row) {
    row = document.createElement("div");
    row.id = "preset-actions";
    row.className = "preset-actions";
    row.innerHTML = '<button class="text-button" id="save-preset">Save settings</button><select id="saved-preset" aria-label="Apply saved preset"><option value="">Apply saved preset…</option></select><button class="text-button" id="export-preset">Export pipeline</button><button class="text-button" id="import-preset">Import pipeline</button><input id="import-preset-file" type="file" accept="application/json,.json" hidden>';
    $("#control-content").append(row);
  }
  const select = $("#saved-preset");
  select.innerHTML = '<option value="">Apply saved preset…</option>';
  const presets = readStoredArray("pixelproof-presets");
  presets.filter((preset) => preset.tool === state.tool).forEach((preset, index) => {
    const option = document.createElement("option");
    option.value = String(index);
    option.textContent = preset.name;
    select.append(option);
  });
  $("#save-preset").onclick = () => {
    const name = window.prompt("Name this preset");
    if (!name) return;
    const values = {};
    $("#control-content").querySelectorAll("input[id], select[id]").forEach((input) => {
      if (input.id !== "saved-preset") values[input.id] = input.type === "checkbox" ? input.checked : input.value;
    });
    const next = readStoredArray("pixelproof-presets");
    next.push({name: name.trim(), tool: state.tool, values});
    writeStoredJson("pixelproof-presets", next);
    mountPresetControls();
  };
  $("#export-preset").onclick = () => {
    const matching = presets.filter((preset) => preset.tool === state.tool);
    const selected = matching[Number(select.value)] || matching[matching.length - 1];
    const payload = selected || (() => {
      const values = {};
      $("#control-content").querySelectorAll("input[id], select[id]").forEach((input) => {
        if (!["saved-preset", "import-preset-file"].includes(input.id)) values[input.id] = input.type === "checkbox" ? input.checked : input.value;
      });
      return {name: `${state.tool} pipeline`, tool: state.tool, values};
    })();
    const blob = new Blob([JSON.stringify({pixelproof: 1, pipeline: payload}, null, 2)], {type: "application/json"});
    const url = URL.createObjectURL(blob), link = document.createElement("a");
    link.href = url; link.download = `${stem(payload.name || state.tool)}.pixelproof.json`;
    document.body.append(link); link.click();
    setTimeout(() => { link.remove(); URL.revokeObjectURL(url); }, 1000);
  };
  $("#import-preset").onclick = () => $("#import-preset-file").click();
  $("#import-preset-file").onchange = async (event) => {
    const file = event.target.files[0];
    if (!file) return;
    try {
      const document = JSON.parse(await file.text());
      const payload = document.pipeline;
      if (document.pixelproof !== 1 || !payload?.name || !payload?.tool || !payload?.values ||
          !toolDefs.some((tool) => tool.id === payload.tool) ||
          typeof payload.values !== "object" || Array.isArray(payload.values))
        throw new Error("Not a valid PixelProof pipeline file.");
      if (JSON.stringify(payload).length > 65536) throw new Error("Pipeline file is too large.");
      payload.name = String(payload.name).trim().replace(/[^\w .-]+/g, "").slice(0, 80);
      if (!payload.name) throw new Error("Pipeline name is empty.");
      if (Object.keys(payload.values).some((key) => typeof key !== "string" || key.length > 80))
        throw new Error("Pipeline contains an invalid control value.");
      const next = readStoredArray("pixelproof-presets");
      next.push({name: payload.name, tool: payload.tool, values: payload.values});
      writeStoredJson("pixelproof-presets", next);
      if (payload.tool === state.tool) mountPresetControls();
      $("#run-status").textContent = `Imported pipeline “${payload.name}”.`;
    } catch (error) {
      const message = error instanceof SyntaxError ? "The pipeline file is not valid JSON." : error.message;
      $("#run-status").textContent = `Pipeline import failed: ${message}`;
    }
    event.target.value = "";
  };
  select.onchange = () => {
    const matching = presets.filter((preset) => preset.tool === state.tool);
    const preset = matching[Number(select.value)];
    if (!preset) return;
    Object.entries(preset.values).forEach(([id, value]) => {
      const input = document.getElementById(id);
      if (!input) return;
      if (input.type === "checkbox") input.checked = value === true || value === "true";
      else input.value = value;
      input.dispatchEvent(new Event("input", {bubbles: true}));
      input.dispatchEvent(new Event("change", {bubbles: true}));
    });
  };
}
async function updateMetadata() {
  const output = $("#metadata-output"), file = state.files[0];
  if (!output || !file) return;
  output.textContent = "Reading metadata…";
  const metadata = await inspectMetadata(file);
  const fields = Object.entries(metadata.fields).filter(([key]) => !["gpsOffset", "gpsCoordinates", "gps"].includes(key));
  const coordinates = metadata.gpsCoordinates ? `<p class="metadata-warning">GPS coordinates: ${metadata.gpsCoordinates.latitude}, ${metadata.gpsCoordinates.longitude}. Strip metadata before sharing if that is not intentional.</p>` : (metadata.gps ? '<p class="metadata-warning">GPS data is present but its coordinates could not be decoded.</p>' : '<p>No GPS coordinates were found in the readable EXIF block.</p>');
  output.innerHTML = `<p><strong>${metadata.fieldCount ? `${metadata.fieldCount} metadata field${metadata.fieldCount === 1 ? "" : "s"} found` : "No readable EXIF fields found"}</strong> · ${formatBytes(metadata.bytes)} · ${escapeHtml(metadata.format)}</p>${coordinates}<dl>${fields.map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd>`).join("")}</dl>`;
}
function editorOperation() {
  return {
    type: "photo-editor",
    brightness: Number($("#brightness")?.value || 0),
    contrast: Number($("#contrast")?.value || 0),
    saturation: Number($("#saturation")?.value || 0),
    exposure: Number($("#exposure")?.value || 0),
    temperature: Number($("#temperature")?.value || 0),
    tint: Number($("#tint")?.value || 0),
    filter: $("#filter")?.value || "none",
    sharpen: Number($("#sharpen")?.value || 0),
    blur: Number($("#blur")?.value || 0),
    vignette: Number($("#vignette")?.value || 0),
    text: $("#text")?.value || "",
    color: $("#color")?.value || "#ffffff",
    font: $("#font")?.value || "Arial",
    scale: Number($("#textSize")?.value || 0.05),
    position: $("#position")?.value || "bottom-right",
    mime: "image/png",
  };
}
function setupEditorPreview() {
  const canvas = $("#editor-preview"), file = state.files[0];
  if (!canvas || !file) return;
  const image = new Image();
  const draw = () => {
    const context = canvas.getContext("2d");
    context.clearRect(0, 0, canvas.width, canvas.height);
    const scale = Math.min(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
    const width = image.naturalWidth * scale, height = image.naturalHeight * scale;
    const preset = $("#filter").value;
    const presetFilter = preset === "mono" ? "grayscale(1)" : preset === "warm" ? "sepia(.35)" : preset === "cool" ? "hue-rotate(12deg)" : preset === "faded" ? "opacity(.86)" : "";
    context.filter = `brightness(${100 + Number($("#brightness").value)}%) contrast(${100 + Number($("#contrast").value)}%) saturate(${100 + Number($("#saturation").value)}%) blur(${Number($("#blur").value)}px) ${presetFilter}`;
    context.drawImage(image, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
    context.filter = "none";
    const text = $("#text").value;
    if (text) {
      const fontSize = Math.max(14, Math.round(Math.min(width, height) * Number($("#textSize").value)));
      context.font = `700 ${fontSize}px ${$("#font").value}`;
      context.fillStyle = $("#color").value;
      context.shadowColor = "#000";
      context.shadowBlur = 3;
      const metrics = context.measureText(text);
      const position = $("#position").value;
      const x = position.includes("right") ? canvas.width - metrics.width - 12 : position === "center" ? (canvas.width - metrics.width) / 2 : 12;
      const y = position.includes("bottom") ? canvas.height - 14 : position === "center" ? canvas.height / 2 : fontSize + 12;
      context.fillText(text, x, y);
    }
  };
  image.onload = draw;
  image.src = URL.createObjectURL(file);
  $("#control-content").querySelectorAll("input, select").forEach((input) => input.addEventListener("input", draw));
  $("#control-content").querySelectorAll("input[type=range]").forEach((input) => input.ondblclick = () => {
    input.value = input.id === "textSize" ? "0.05" : "0";
    draw();
  });
  $("#reset-adjustments").onclick = () => {
    $("#control-content").querySelectorAll("input[type=range]").forEach((input) => {
      input.value = input.id === "textSize" ? "0.05" : "0";
    });
    $("#filter").value = "none";
    draw();
  };
}
function mountFaceBlur() {
  state.faceBoxes = [];
  $("#control-content").innerHTML = '<p class="hint">Manual review only: this build does not claim to detect every face. Drag boxes over every face or private region, or add regions numerically below for a keyboard and screen-reader accessible path.</p><canvas id="face-canvas" class="tool-preview" width="640" height="420" tabindex="0" aria-label="Visual preview of privacy regions"></canvas><div class="form-grid"><div class="field"><label for="blurMode">Method</label><select id="blurMode"><option value="blur">Blur</option><option value="pixelate">Pixelate</option></select></div><div class="field"><label for="blurStrength">Strength</label><input id="blurStrength" type="range" min="4" max="32" value="12"></div></div><section class="face-regions" aria-labelledby="face-regions-title"><h3 id="face-regions-title">Reviewed regions</h3><p class="hint">Enter source-image pixels. Arrow keys nudge a focused value by one pixel; use Add region to create a box without a mouse.</p><div id="face-region-list" aria-live="polite"></div><button class="btn" id="face-add-region" type="button">Add region</button></section><button class="text-button" id="face-delete">Delete last box</button><label class="check"><input id="face-confirm" type="checkbox"> I reviewed every box and confirm this export</label><div class="run-row"><button class="btn primary" id="face-run">Process reviewed boxes</button><button class="btn" id="face-export" hidden>Export privacy copy</button><span class="mono" id="face-status" role="status" aria-live="polite">Drag on the image to add a box.</span></div>';
  const canvas = $("#face-canvas"), file = state.files[0];
  if (!file) return;
  const image = new Image(), context = canvas.getContext("2d");
  let start = null;
  const renderRegions = () => {
    const list = $("#face-region-list");
    list.innerHTML = "";
    state.faceBoxes.forEach((box, index) => {
      const row = document.createElement("div");
      row.className = "face-region";
      row.innerHTML = `<strong>Region ${index + 1}</strong><div class="form-grid">${["x", "y", "width", "height"].map((key) => `<label>${key}<input type="number" min="0" step="1" data-face-index="${index}" data-face-key="${key}" value="${Math.round(box[key])}"></label>`).join("")}</div><button class="text-button" type="button" data-face-remove="${index}">Remove region</button>`;
      list.append(row);
    });
    list.querySelectorAll("[data-face-index]").forEach((input) => {
      input.oninput = () => {
        const box = state.faceBoxes[Number(input.dataset.faceIndex)];
        const key = input.dataset.faceKey;
        const value = Math.max(0, Number(input.value) || 0);
        box[key] = key === "x" ? state.faceScale.ox + value * state.faceScale.scale
          : key === "y" ? state.faceScale.oy + value * state.faceScale.scale
            : value * state.faceScale.scale;
        draw();
      };
    });
    list.querySelectorAll("[data-face-remove]").forEach((button) => {
      button.onclick = () => {
        state.faceBoxes.splice(Number(button.dataset.faceRemove), 1);
        renderRegions();
        draw();
        $("#face-status").textContent = `${state.faceBoxes.length} reviewed region${state.faceBoxes.length === 1 ? "" : "s"}.`;
      };
    });
  };
  const addRegion = (box = {x: 0, y: 0, width: 100, height: 100}) => {
    state.faceBoxes.push(box);
    renderRegions();
    draw();
    const first = $("#face-region-list input");
    first?.focus();
    $("#face-status").textContent = `${state.faceBoxes.length} reviewed region${state.faceBoxes.length === 1 ? "" : "s"}.`;
  };
  const draw = () => {
    context.clearRect(0, 0, canvas.width, canvas.height);
    const scale = Math.min(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
    const width = image.naturalWidth * scale, height = image.naturalHeight * scale;
    context.drawImage(image, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
    context.strokeStyle = "#ffe45c"; context.lineWidth = 3;
    state.faceBoxes.forEach((box) => context.strokeRect(box.x, box.y, box.width, box.height));
  };
  image.onload = () => {
    const scale = Math.min(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
    state.faceScale = {scale, ox: (canvas.width - image.naturalWidth * scale) / 2, oy: (canvas.height - image.naturalHeight * scale) / 2};
    draw();
  };
  image.src = URL.createObjectURL(file);
  $("#face-delete").onclick = () => {
    state.faceBoxes.pop();
    draw();
    $("#face-status").textContent = `${state.faceBoxes.length} reviewed box${state.faceBoxes.length === 1 ? "" : "es"}.`;
    renderRegions();
  };
  $("#face-add-region").onclick = () => addRegion();
  canvas.onpointerdown = (event) => {
    const rect = canvas.getBoundingClientRect();
    start = {x: event.clientX - rect.left, y: event.clientY - rect.top};
    canvas.setPointerCapture?.(event.pointerId);
  };
  canvas.addEventListener("dragstart", (event) => event.preventDefault());
  canvas.addEventListener("selectstart", (event) => event.preventDefault());
  canvas.onpointerup = (event) => {
    if (!start) return;
    const rect = canvas.getBoundingClientRect();
    const end = {x: event.clientX - rect.left, y: event.clientY - rect.top};
    const box = {x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y)};
    if (box.width > 4 && box.height > 4) state.faceBoxes.push(box);
    start = null; renderRegions(); draw();
    $("#face-status").textContent = `${state.faceBoxes.length} reviewed box${state.faceBoxes.length === 1 ? "" : "es"}.`;
  };
  $("#face-run").onclick = async () => {
    if (!canUseTool("face-blur", {fileCount: 1, task: true})) {
      $("#face-status").textContent = limitMessage("face-blur", {fileCount: 1, task: true});
      return;
    }
    if (!state.faceBoxes.length) { $("#face-status").textContent = "Add at least one box."; return; }
    if (!$("#face-confirm").checked) { $("#face-status").textContent = "Confirm that every box was reviewed before export."; return; }
    const result = await processOne(file, {...faceOperation(), maxPixels: PRODUCT.maxPixels});
    state.results = [{name: `${stem(file.name)}-privacy.png`, ...result, source: file.name}];
    $("#results").hidden = false;
    renderResults();
    $("#face-status").textContent = "Reviewed privacy copy ready.";
  };
}
function faceOperation() {
  const file = state.files[0];
  const frame = state.faceScale;
  return {type: "face-blur", boxes: state.faceBoxes.map((box) => ({x: (box.x - frame.ox) / frame.scale, y: (box.y - frame.oy) / frame.scale, width: box.width / frame.scale, height: box.height / frame.scale})), mode: $("#blurMode").value, strength: Number($("#blurStrength").value), mime: "image/png"};
}
async function runPalette() {
  const output = $("#palette-output"), file = state.files[0];
  if (!file) return;
  const image = await createImageBitmap(file), canvas = document.createElement("canvas");
  canvas.width = 96; canvas.height = 96;
  canvas.getContext("2d").drawImage(image, 0, 0, 96, 96); image.close();
  const pixels = canvas.getContext("2d").getImageData(0, 0, 96, 96).data, buckets = new Map();
  for (let i = 0; i < pixels.length; i += 16) {
    const key = [pixels[i] >> 4, pixels[i + 1] >> 4, pixels[i + 2] >> 4].join(",");
    buckets.set(key, (buckets.get(key) || 0) + 1);
  }
  const colours = [...buckets.entries()].sort((a, b) => b[1] - a[1]).slice(0, Number($("#paletteCount").value)).map(([key]) => key.split(",").map((v) => Number(v) * 17));
  const hex = colours.map(([r, g, b]) => `#${[r, g, b].map((v) => v.toString(16).padStart(2, "0")).join("")}`);
  output.innerHTML = hex.map((value) => `<button class="palette-swatch" data-colour="${value}" style="background:${value}">${value}</button>`).join("") + '<button class="btn" id="download-palette">Download palette</button>';
  output.querySelectorAll("[data-colour]").forEach((button) => button.onclick = () => navigator.clipboard?.writeText(button.dataset.colour));
  $("#download-palette").onclick = () => { const url = URL.createObjectURL(new Blob([hex.join("\n")], {type: "text/plain"})); const link = document.createElement("a"); link.href = url; link.download = `${stem(file.name)}-palette.txt`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 500); };
  recordTask();
  refreshJobLimit();
}
async function options() {
  const id = state.tool,
    q = Number($("#quality")?.value || 88),
    format = $("#format")?.value || "image/png";
  if (id === "compress" || id === "convert")
    return { type: operationTypeForTool(id), mime: format, quality: q / 100, pngOptimize: false, pngPalette: format === "image/png" && $("#pngMode")?.value === "palette" };
  if (id === "target-size") {
    return {type: operationTypeForTool(id), mime: $("#format").value, targetBytes: Number($("#targetBytes").value), reduceDimensions: $("#reduceDimensions").checked, metadata: {mode: "strip"}};
  }
  if (id === "metadata") {
    const metadata = await inspectMetadata(state.files[0]);
    return {type: operationTypeForTool(id), mime: "image/jpeg", quality: 0.92, metadata: {mode: $("#metadataMode").value, ...metadata.fields}};
  }
  if (id === "platform-profiles") return {type: operationTypeForTool(id), mode: $("#platformMode").value === "fill" ? "fill" : "contain", width: Number($("#platformWidth").value), height: Number($("#platformHeight").value), mime: $("#platformMime").value};
  if (id === "image-to-pdf") return {type: operationTypeForTool(id), pageSize: $("#pdfSize").value, orientation: $("#pdfOrientation").value, mode: $("#pdfMode").value, margin: Number($("#pdfMargin").value || 0)};
  if (id === "id-print-sheet") return {type: operationTypeForTool(id), profile: $("#idProfile").value, paper: $("#idPaper").value, copies: Number($("#idCopies").value || 1)};
  if (id === "svg-raster") return {type: operationTypeForTool(id), mode: "exact", width: Number($("#svgWidth").value), height: Number($("#svgHeight").value), mime: "image/png"};
  if (id === "resize") {
    const mode = $("#mode").value;
    let w = Number($("#width").value),
      h = Number($("#height").value);
    if (mode === "fit") [w, h] = $("#preset").value.split("x").map(Number);
    return {
      type: operationTypeForTool(id),
      mode,
      width: w,
      height: h,
      value: Number($("#value").value),
      mime: "image/png",
    };
  }
  if (id === "crop") {
    let w = Number($("#width").value),
      h = Number($("#height").value);
    const aspect = $("#aspect").value;
    if (aspect !== "free") {
      const [a, b] = aspect.split(":").map(Number);
      h = Math.round((w * b) / a);
    }
    return {
      type: operationTypeForTool(id),
      x: Number($("#x").value),
      y: Number($("#y").value),
      width: w,
      height: h,
      mime: "image/png",
    };
  }
  if (id === "transform") {
    const flip = $("#flip").value;
    return {
      type: operationTypeForTool(id),
      degrees: Number($("#degrees").value),
      flipX: flip === "x",
      flipY: flip === "y",
      mime: "image/png",
    };
  }
  if (id === "watermark") {
    const mark = $("#mark")?.files[0];
    return {
      type: operationTypeForTool(id),
      text: $("#text").value,
      position: $("#position").value,
      opacity: Number($("#opacity").value),
      scale: Number($("#scale").value),
      imageBuffer: mark ? mark.arrayBuffer() : null,
      imageType: mark?.type,
      mime: "image/png",
    };
  }
  if (id === "photo-editor") return editorOperation();
  if (id === "meme") {
    return {
      type: operationTypeForTool(id),
      top: $("#top").value,
      bottom: $("#bottom").value,
      size: Number($("#size").value),
      topPosition: Number($("#topPosition").value),
      bottomPosition: Number($("#bottomPosition").value),
      mime: "image/png",
    };
  }
  if (id === "social") {
    const sizes = {
      og: [1200, 630],
      twitter: [1200, 675],
      youtube: [1280, 720],
      "instagram-square": [1080, 1080],
      "instagram-portrait": [1080, 1350],
      "instagram-story": [1080, 1920],
      linkedin: [1200, 627],
    };
    const [width, height] = sizes[$("#preset").value];
    return {type: operationTypeForTool(id), width, height, fill: $("#framing").value === "fill", mime: "image/png"};
  }
  if (id === "icon-set") return {type: operationTypeForTool(id), width: 512, height: 512, fill: false, mime: "image/png"};
  if (id === "rename") return {type: operationTypeForTool(id), mime: "image/png"};
  if (id === "compare") return {type: operationTypeForTool(id), mime: $("#format").value, quality: Number($("#quality").value) / 100};
  return { type: operationTypeForTool(id), mime: format, quality: q / 100 };
}
function stem(name) {
  return (
    name
      .replace(/\.[^.]+$/, "")
      .replace(/[^a-z0-9_-]+/gi, "-")
      .replace(/^-|-$/g, "") || "image"
  );
}
function friendlyError(error) {
  const message = String(error?.message || error || "Unknown image-processing error.");
  if (error?.userFacing) return message;
  if (/(?:worker|decoder) (?:stalled|timed out)/i.test(message))
    return "PixelProof stopped waiting for a browser worker. Try again, or use a smaller image.";
  if (/could not be decoded|decode|invalidstateerror/i.test(message))
    return "This file could not be decoded as a supported image. Check that it is a real JPEG, PNG, WebP, HEIC/HEIF, BMP, GIF, ICO, or SVG file.";
  if (/worker failed|failed to fetch|network|out of memory|memory/i.test(message))
    return "PixelProof could not finish this file in the browser. Try again, or use a smaller image.";
  return "PixelProof could not finish this file in the browser. Try again or choose a smaller, supported image.";
}
function setProgress(done, total) {
  const progress = $("#run-progress");
  if (!progress) return;
  const percent = total ? Math.round((done * 100) / total) : 0;
  progress.setAttribute("aria-valuenow", String(percent));
  progress.querySelector("i").style.width = `${percent}%`;
}
function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[character]));
}
async function processOne(file, op, onProgress = () => {}) {
  let input = file;
  if (file.name.toLowerCase().endsWith(".svg") || file.type === "image/svg+xml") {
    const text = await file.text();
    const width = Number(op.svgWidth || $("#svgWidth")?.value || 1200);
    const height = Number(op.svgHeight || $("#svgHeight")?.value || 1200);
    const cleaned = text
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "")
      .replace(/<style[\s\S]*?@import[\s\S]*?<\/style>/gi, "")
      .replace(/\son[a-z]+\s*=\s*(['"]).*?\1/gi, "")
      .replace(/\s(?:href|xlink:href)\s*=\s*(['"])(?!#).*?\1/gi, "");
    const viewBox = cleaned.match(/viewBox\s*=\s*["']\s*([\d.+-]+)[ ,]+([\d.+-]+)[ ,]+([\d.+-]+)[ ,]+([\d.+-]+)\s*["']/i);
    const replacement = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"${viewBox ? ` viewBox="${viewBox.slice(1).join(" ")}` : ""}`;
    const svgBlob = new Blob([cleaned.replace(/<svg\b[^>]*>/i, `${replacement}>`)], {type: "image/svg+xml"});
    const svgUrl = URL.createObjectURL(svgBlob);
    try {
      const image = await new Promise((resolve, reject) => {
        const element = new Image();
        element.onload = () => resolve(element);
        element.onerror = () => reject(new Error("The SVG could not be rasterised."));
        element.src = svgUrl;
      });
      const canvas = document.createElement("canvas");
      canvas.width = width;
      canvas.height = height;
      canvas.getContext("2d").drawImage(image, 0, 0, width, height);
      const raster = await new Promise((resolve, reject) =>
        canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("The SVG could not be rasterised.")), "image/png"),
      );
      input = new File([await raster.arrayBuffer()], `${file.name}.png`, {type: "image/png"});
    } finally {
      URL.revokeObjectURL(svgUrl);
    }
    if (op.type === "svg-raster") op = {...op, type: "resize"};
  }
  if (isHeic(file)) {
    const decoded = await decodeHeic(file, (message) => { $("#run-status").textContent = message; });
    input = new File([decoded.buffer], `${file.name}.png`, {type: "image/png"});
  }
  if (!input.type) {
    const extension = file.name.toLowerCase().split(".").pop();
    const types = {jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", bmp: "image/bmp", gif: "image/gif", ico: "image/x-icon", cur: "image/x-icon", apng: "image/apng"};
    input = new File([await input.arrayBuffer()], file.name, {type: types[extension] || "image/jpeg"});
  }
  const worker = new Worker("./worker.js", {type: "module"});
  return new Promise((resolve, reject) => {
    let started = false;
    let settled = false;
    let lastSignal = Date.now();
    const removeWorker = () => activeWorkers.delete(worker);
    const cancel = () => {
      if (settled) return;
      settled = true;
      clearInterval(watchdog);
      removeWorker();
      worker.terminate();
      const error = new Error("Job cancelled.");
      error.cancelled = true;
      reject(error);
    };
    activeWorkers.set(worker, cancel);
    const watchdog = setInterval(() => {
      const limit = started ? WORKER_STALL_TIMEOUT_MS : WORKER_START_TIMEOUT_MS;
      if (Date.now() - lastSignal < limit) return;
      clearInterval(watchdog);
      removeWorker();
      worker.terminate();
      reject(new Error("Image worker stalled."));
    }, 1_000);
    worker.onmessage = (e) => {
      lastSignal = Date.now();
      if (Number.isFinite(e.data.progress)) {
        onProgress(Math.max(0, Math.min(1, e.data.progress)));
        return;
      }
      if (e.data.started || e.data.heartbeat) {
        started ||= e.data.started === true;
        return;
      }
      clearInterval(watchdog);
      settled = true;
      removeWorker();
      worker.terminate();
      if (e.data.ok) resolve(e.data);
      else {
        const error = new Error(e.data.error);
        error.userFacing = e.data.userFacing === true;
        reject(error);
      }
    };
    worker.onerror = (e) => {
      clearInterval(watchdog);
      settled = true;
      removeWorker();
      worker.terminate();
      reject(e.error || new Error("Worker failed"));
    };
    Promise.resolve(op.imageBuffer).then((mark) =>
      input.arrayBuffer().then((buffer) => {
        const transfers = [buffer];
        if (mark) transfers.push(mark);
        worker.postMessage(
          {
            id: file.name,
            file: { buffer, type: input.type },
            operation: { ...op, imageBuffer: mark },
          },
          transfers,
        );
      }),
    ).catch((error) => {
      clearInterval(watchdog);
      settled = true;
      removeWorker();
      worker.terminate();
      reject(error);
    });
  });
}
function outputExtension(mime) {
  if (mime === "image/x-icon") return "ico";
  if (mime === "image/avif") return "avif";
  return Object.values(MIME).find((x) => x.mime === mime)?.ext || "png";
}
function validateOperation(operation) {
  const positive = (value, label) =>
    Number.isFinite(value) && value > 0 ? "" : `${label} must be a positive number.`;
  if (["resize", "social", "web-export"].includes(operation.type))
    return positive(operation.width, "Width") || positive(operation.height, "Height");
  if (operation.type === "crop") {
    if (![operation.x, operation.y, operation.width, operation.height].every(Number.isFinite))
      return "Crop coordinates and dimensions must be numbers.";
    if (operation.x < 0 || operation.y < 0 || operation.width <= 0 || operation.height <= 0)
      return "Crop coordinates cannot be negative and width/height must be greater than zero.";
  }
  if (["compress", "convert"].includes(operation.type) &&
      (!Number.isFinite(operation.quality) || operation.quality < 0.1 || operation.quality > 1))
    return "Quality must be between 10 and 100.";
  if (operation.type === "target-size" &&
      (!Number.isFinite(operation.targetBytes) || operation.targetBytes < 1000))
    return "Target size must be at least 1000 bytes.";
  if (operation.type === "transform" &&
      (!Number.isFinite(operation.degrees) || operation.degrees % 90 !== 0))
    return "Rotation must be a multiple of 90 degrees.";
  if (operation.type === "watermark") {
    if (typeof operation.text !== "string" || operation.text.length > 5000)
      return "Watermark text must be 5000 characters or fewer.";
    if (!Number.isFinite(operation.opacity) || operation.opacity < 1 || operation.opacity > 100 ||
        !Number.isFinite(operation.scale) || operation.scale < 1 || operation.scale > 100)
      return "Watermark opacity and scale must be between 1 and 100.";
  }
  if (operation.type === "pdf" &&
      (!Number.isFinite(operation.margin) || operation.margin < 0 || operation.margin > 50))
    return "PDF margins must be between 0 and 50 mm.";
  if (operation.type === "id-sheet" &&
      (!Number.isInteger(operation.copies) || operation.copies < 1 || operation.copies > 1000))
    return "Copies must be a whole number between 1 and 1000.";
  return "";
}
async function preflight(files, isSample = false) {
  const foundAnimations = await inspectAnimations(files);
  if (foundAnimations.length) {
    state.animationFiles = [...new Set([...state.animationFiles, ...foundAnimations])];
    renderAnimationWarning();
  }
  if (state.animationFiles.some((name) => files.some((file) => file.name === name)) && !$("#allow-animation")?.checked)
    return `Animated input detected (${state.animationFiles.join(", ")}). Only the first frame will be processed. Confirm the warning before processing.`;
  const tier = getEntitlementState();
  if (files.length > tier.maxFiles)
    return `This batch has ${files.length} files, but ${tier.label} allows ${tier.maxFiles}. Remove these extras or upgrade: ${files.slice(tier.maxFiles).slice(0, 4).map((file) => file.name).join(", ")}${files.length - tier.maxFiles > 4 ? "…" : ""}`;
  const oversized = [];
  for (const file of files) {
    if (file.size > PRODUCT.maxPixels * 4) {
      oversized.push(file.name);
      continue;
    }
    if (isHeic(file)) continue;
    try {
      const image = await createImageBitmap(file.type === "image/svg+xml" ? new Blob([await file.text()], {type: file.type}) : file);
      originalStats.set(file, {width: image.width, height: image.height});
      if (image.width * image.height > PRODUCT.maxPixels) oversized.push(`${file.name} (${image.width}×${image.height})`);
      image.close();
    } catch {}
  }
  if (oversized.length) return `These files exceed the browser pixel limit before processing: ${oversized.join(", ")}. Resize them first or remove them from the batch.`;
  if (state.tool === "crop") {
    const crop = await options();
    const outside = files.find((file) => {
      const dimensions = originalStats.get(file);
      return dimensions && (
        crop.x + crop.width > dimensions.width ||
        crop.y + crop.height > dimensions.height
      );
    });
    if (outside)
      return `Crop rectangle must fit inside ${outside.name} (${originalStats.get(outside).width}×${originalStats.get(outside).height}).`;
  }
  if (isIOS()) {
    const iosOversized = files.filter((file) => {
      const stats = originalStats.get(file);
      return stats && stats.width * stats.height > IOS_PIXEL_LIMIT;
    });
    if (iosOversized.length)
      return `iPhone/iPad safety limit: ${iosOversized.map((file) => file.name).join(", ")} exceeds 24 MP. Resize large phone images before processing to avoid Safari memory termination.`;
    if (files.length > 25)
      return `iPhone/iPad safety limit: this ${files.length}-file batch is too large for reliable mobile memory. Process 25 files or fewer at a time.`;
  }
  if (!isSample && !canUseTool(state.tool, {fileCount: files.length, task: true}))
    return limitMessage(state.tool, {fileCount: files.length, task: true});
  return "";
}
function uniqueName(name, used) {
  const count = used.get(name) || 0;
  used.set(name, count + 1);
  if (!count) return name;
  const dot = name.lastIndexOf(".");
  return `${name.slice(0, dot)}-${count + 1}${name.slice(dot)}`;
}
async function run(runFiles = state.files, isSample = false) {
  if (state.tool === "background-removal") {
    const status = $("#run-status");
    status.textContent = "Use the background-removal controls below.";
    return;
  }
  if (state.tool === "face-blur") return;
  if (state.tool === "image-to-pdf") return runPdfWorkspace(runFiles);
  if (state.tool === "id-print-sheet") return runIdPrintSheet(runFiles);
  if (!runFiles.length) {
    $("#run-status").textContent = "Choose at least one image first.";
    return;
  }
  const preflightMessage = await preflight(runFiles, isSample);
  if (preflightMessage) {
    $("#run-status").textContent = preflightMessage;
    return;
  }
  if (state.tool === "palette") {
    await runPalette();
    $("#run-status").textContent = "Palette extracted.";
    return;
  }
  const button = $("#run-button");
  state.running = true;
  state.cancel = false;
  state.activeRunId = crypto.randomUUID();
  state.activeRunStartedAt = Date.now();
  setRunBusy(true);
  revokeResultUrls();
  state.results = [];
  state.resultNotice = "";
  $("#results").hidden = false;
  $("#result-list").innerHTML = "";
  $("#download-zip").hidden = true;
  $("#save-folder").hidden = true;
  const base = await options(),
    op = { ...base, maxPixels: PRODUCT.maxPixels },
    outputs = [], usedNames = new Map();
  const invalidOperation = validateOperation(base);
  if (invalidOperation) {
    $("#run-status").textContent = invalidOperation;
    setRunBusy(false);
    state.running = false;
    return;
  }
  let done = 0;
  const tasks = [];
  for (const file of runFiles) {
    if (state.tool === "web-export") {
      const family = $("#family").value;
      for (const preset of PRODUCT.webExports.filter(
        (x) => family === "all" || x.name.toLowerCase().startsWith(family),
      ))
        tasks.push({
          file,
          op: {
            ...op,
            type: "web-export",
            width: preset.width,
            height: preset.height,
          },
          name: `${stem(file.name)}-${preset.suffix}`,
        });
    } else if (state.tool === "icon-set") {
      [
        ["favicon-16x16", 16], ["favicon-32x32", 32], ["apple-touch-icon", 180],
        ["icon-192", 192], ["icon-512", 512],
      ].forEach(([name, size]) => tasks.push({file, op: {...op, width: size, height: size}, name: state.files.length > 1 ? `${stem(file.name)}-${name}` : name}));
      tasks.push({file, op: {...op, width: 32, height: 32, ico: true}, name: state.files.length > 1 ? `${stem(file.name)}-favicon` : "favicon"});
    } else tasks.push({ file, op, name: stem(file.name) });
  }
  let cursor = 0;
  tasks.forEach((task, index) => {
    task.sequence = index + 1;
  });
  setProgress(0, tasks.length);
  const returnFocus = document.activeElement === button;
  const worker = async () => {
    while (cursor < tasks.length && !state.cancel) {
      const task = tasks[cursor++];
      $("#run-status").textContent =
        `Processing ${done + 1} of ${tasks.length}: ${task.file.name} · ${done} finished · ${tasks.length - done - 1} remaining`;
      try {
        const result = await processOne(task.file, task.op, (progress) =>
          setProgress(done + progress, tasks.length),
        );
        outputs.push({
          name: uniqueName(outputName(task, result), usedNames),
          ...result,
          source: task.file.name,
          sourcePath: relativePath(task.file),
          file: task.file,
          originalBytes: task.file.size,
          originalStats: originalStats.get(task.file),
          runId: state.activeRunId,
          runStartedAt: state.activeRunStartedAt,
        });
        rememberOutput(outputs[outputs.length - 1]);
      } catch (error) {
        if (error.cancelled) break;
        outputs.push({
          name: task.name,
          error: friendlyError(error),
          source: task.file.name,
          sourcePath: relativePath(task.file),
          file: task.file,
          originalBytes: task.file.size,
          originalStats: originalStats.get(task.file),
        });
      }
      done++;
      setProgress(done, tasks.length);
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(PRODUCT.concurrency, tasks.length) }, worker),
  );
  await recoveryWrites;
  state.results = outputs;
  if (!isSample) {
    recordTask();
    refreshJobLimit();
  }
  renderResults();
  setProgress(done, tasks.length);
  if (returnFocus) $("#result-list .result-download, #result-list .retry-result")?.focus();
  if (state.tool === "icon-set") {
    $("#icon-snippet").textContent = `<link rel="icon" href="/favicon.ico" sizes="32x32">\n<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">\n<link rel="apple-touch-icon" href="/apple-touch-icon.png">\n<link rel="manifest" href="/site.webmanifest">\n\n{\n  "icons": [\n    {"src": "/icon-192.png", "sizes": "192x192", "type": "image/png"},\n    {"src": "/icon-512.png", "sizes": "512x512", "type": "image/png"}\n  ]\n}`;
  }
  if (state.tool === "compare") renderCompare(outputs[0]);
  state.running = false;
  setRunBusy(false);
  const failed = outputs.filter((result) => result.error).length;
  const succeeded = outputs.length - failed;
  const summary = resultSummary(outputs);
  $("#result-summary").textContent = isSample
    ? `Sample complete — ${summary} This run does not count against your daily allowance.`
    : summary;
  $("#run-status").textContent = state.cancel
    ? `Cancelled after ${done} output${done === 1 ? "" : "s"}.`
    : failed
      ? `Finished with ${failed} error${failed === 1 ? "" : "s"}: ${succeeded} succeeded. Failed files remain below; retry them individually.`
      : `Finished ${done} output${done === 1 ? "" : "s"}.`;
  if (recoveryWriteFailed)
    $("#run-status").textContent += " Recovery storage is unavailable; download these outputs before leaving.";
  state.cancel = false;
}
function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10 * 1024 ? 1 : 0)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
function resultSummary(outputs) {
  const good = outputs.filter((result) => result.bytes);
  const input = good.reduce((sum, result) => sum + (result.originalBytes || 0), 0);
  const output = good.reduce((sum, result) => sum + result.bytes.byteLength, 0);
  const failed = outputs.length - good.length;
  if (!good.length) return `${failed} file${failed === 1 ? "" : "s"} failed.`;
  const delta = input - output;
  const percent = input ? Math.abs((delta / input) * 100).toFixed(1) : "0.0";
  const change = delta >= 0
    ? `${formatBytes(delta)} saved (${percent}% smaller)`
    : `${formatBytes(Math.abs(delta))} larger (${percent}% larger)`;
  return `${good.length} output${good.length === 1 ? "" : "s"} · ${formatBytes(input)} in → ${formatBytes(output)} out · ${change}${failed ? ` · ${failed} failed` : ""}. Download below.`;
}
async function runPdfWorkspace(runFiles) {
  const message = await preflight(runFiles);
  if (message) { $("#run-status").textContent = message; return; }
  const invalidOperation = validateOperation(await options());
  if (invalidOperation) { $("#run-status").textContent = invalidOperation; return; }
  const button = $("#run-button");
  state.running = true;
  state.activeRunId = crypto.randomUUID();
  state.activeRunStartedAt = Date.now();
  setRunBusy(true);
  button.disabled = true; $("#results").hidden = false; $("#result-list").innerHTML = "";
  try {
    const ordered = state.pdfOrder.length ? state.pdfOrder : runFiles;
    const images = [];
    setProgress(0, ordered.length);
    for (const file of ordered) {
      $("#run-status").textContent = `Preparing ${images.length + 1} of ${ordered.length} for PDF…`;
      const encoded = await imageForPdf(file, {width: Number($("#svgWidth")?.value || 1200), height: Number($("#svgHeight")?.value || 1200)});
      images.push({...encoded, source: file});
      setProgress(images.length, ordered.length);
    }
    const pageSize = $("#pdfSize").value;
    const output = $("#pdfOutput").value;
    const margin = Number($("#pdfMargin").value || 0) * 72 / 25.4;
    const make = async (items) => {
      const first = items[0];
      const [pageWidth, pageHeight] = pdfPageSize(pageSize, $("#pdfOrientation").value, first.width, first.height);
      return generatePdf(items, {pageWidth, pageHeight, margin, mode: $("#pdfMode").value});
    };
    if (output === "single") {
      const usedNames = new Map();
      for (let index = 0; index < images.length; index++) {
        const bytes = await make([images[index]]);
        const name = uniqueName(`${stem(images[index].source.name)}.pdf`, usedNames);
        state.results.push({name, bytes, mime: "application/pdf", source: images[index].source.name, sourcePath: relativePath(images[index].source), originalBytes: images[index].source.size});
      }
    } else {
      const bytes = await make(images);
      state.results = [{name: "pixelproof-images.pdf", bytes, mime: "application/pdf", source: `${images.length} images`, originalBytes: runFiles.reduce((sum, file) => sum + file.size, 0)}];
    }
    renderResults();
    setProgress(1, 1);
    const total = state.results.reduce((sum, result) => sum + result.bytes.byteLength, 0);
    $("#run-status").textContent = `PDF ready: ${formatBytes(total)} across ${state.results.length} file${state.results.length === 1 ? "" : "s"}.`;
    recordTask();
    refreshJobLimit();
  } catch (error) {
    state.results = [{source: "PDF export", error: friendlyError(error)}]; renderResults();
    $("#run-status").textContent = `PDF export failed: ${friendlyError(error)}`;
  } finally { state.running = false; setRunBusy(false); button.disabled = false; }
}
async function runIdPrintSheet(runFiles) {
  const message = await preflight(runFiles.slice(0, 1));
  if (message) { $("#run-status").textContent = message; return; }
  const file = runFiles[0];
  if (!file) return;
  const requestedCopies = Number($("#idCopies").value || 1);
  const invalidOperation = validateOperation({type: "id-sheet", copies: requestedCopies});
  if (invalidOperation) { $("#run-status").textContent = invalidOperation; return; }
  const profiles = {us: [51, 51], ca: [50, 70], uk: [35, 45]};
  const papers = {"4x6": [152.4, 101.6], a4: [210, 297]};
  state.running = true;
  state.activeRunId = crypto.randomUUID();
  state.activeRunStartedAt = Date.now();
  setRunBusy(true);
  try {
    const [photoW, photoH] = profiles[$("#idProfile").value], [paperW, paperH] = papers[$("#idPaper").value];
    setProgress(0, 1);
    const image = await imageForPdf(file, undefined, photoW / photoH);
    const margin = 5, gutter = 2;
    const bytes = await generateIdSheet(image, photoW, photoH, paperW, paperH, requestedCopies, margin, gutter);
    state.results = [{name: `${stem(file.name)}-${$("#idProfile").value}-print-sheet.pdf`, bytes, mime: "application/pdf", source: file.name, originalBytes: file.size}];
    renderResults();
    setProgress(1, 1);
    const columns = Math.max(1, Math.floor((paperW - margin * 2 + gutter) / (photoW + gutter)));
    const rows = Math.max(1, Math.floor((paperH - margin * 2 + gutter) / (photoH + gutter)));
    const capacity = columns * rows;
    const placed = Math.min(requestedCopies, capacity);
    const copyStatus = requestedCopies > capacity
      ? ` ${placed} of ${requestedCopies} requested copies fit on the sheet.`
      : ` ${placed} copies placed.`;
    $("#run-status").textContent = `Print sheet ready: ${photoW}×${photoH} mm photos on ${paperW}×${paperH} mm paper.${copyStatus} Dimensions only; review all official requirements yourself.`;
    recordTask();
    refreshJobLimit();
  } finally {
    state.running = false;
    setRunBusy(false);
  }
}
async function generateIdSheet(image, photoW, photoH, paperW, paperH, copies, margin, gutter) {
  const worker = new Worker("./pdf-worker.js");
  const payload = {idSheet: true, image, photoW, photoH, paperW, paperH, copies, margin, gutter};
  return new Promise((resolve, reject) => {
    let started = false;
    let lastSignal = Date.now();
    const watchdog = setInterval(() => {
      const limit = started ? WORKER_STALL_TIMEOUT_MS : WORKER_START_TIMEOUT_MS;
      if (Date.now() - lastSignal < limit) return;
      clearInterval(watchdog);
      worker.terminate();
      reject(new Error("Print-sheet worker stalled."));
    }, 1_000);
    worker.onmessage = (event) => {
      lastSignal = Date.now();
      if (event.data.started || event.data.heartbeat) {
        started ||= event.data.started === true;
        return;
      }
      clearInterval(watchdog);
      worker.terminate();
      event.data.ok ? resolve(event.data.bytes) : reject(new Error(event.data.error));
    };
    worker.onerror = (event) => { clearInterval(watchdog); worker.terminate(); reject(event.error || new Error("Print-sheet worker failed")); };
    worker.postMessage(payload, [image.bytes]);
  });
}
async function runRecipe() {
  const files = state.files;
  if (!state.recipe) return;
  if (!files.length) {
    $("#recipe-status").textContent = "Choose files or a folder before running a recipe.";
    return;
  }
  const invalidStep = state.recipe.steps.find((step) => validateRecipeStep(step));
  if (invalidStep) {
    $("#recipe-status").textContent = validateRecipeStep(invalidStep);
    return;
  }
  const message = await preflight(files);
  if (message) {
    $("#recipe-status").textContent = message;
    return;
  }
  const button = $("#recipe-run");
  button.disabled = true;
  state.running = true;
  state.activeRunId = crypto.randomUUID();
  setRunBusy(true);
  revokeResultUrls();
  state.results = [];
  state.resultNotice = "";
  $("#results").hidden = false;
  $("#result-list").innerHTML = "";
  $("#download-zip").hidden = true;
  $("#save-folder").hidden = true;
  const outputs = [], usedNames = new Map();
  let completed = 0;
  const stepCount = Math.max(1, state.recipe.steps.length);
  const totalWork = files.length * stepCount;
  setProgress(0, totalWork);
  const returnFocus = document.activeElement === button;
  try {
    for (const file of files) {
      try {
      const variants = state.recipe.steps.some((step) => step.variants);
      const branches = variants
        ? state.recipe.steps.filter((step) => step.variants).map((step) => ({step, input: file}))
        : [{step: null, input: file}];
      if (variants) {
        for (const branch of branches) {
          let input = branch.input, result;
          const step = branch.step;
          result = await processOne(input, {...step.operation, maxPixels: PRODUCT.maxPixels});
          const suffix = step.variants[0];
          const directory = relativePath(file).split("/").slice(0, -1).join("/");
          const name = `${stem(file.name)}-${suffix}.${outputExtension(result.mime)}`;
          outputs.push({...result, name: uniqueName(directory ? `${directory}/${name}` : name, usedNames), source: file.name, sourcePath: relativePath(file), file, originalBytes: file.size, originalStats: originalStats.get(file), runId: state.activeRunId, runStartedAt: state.activeRunStartedAt});
          rememberOutput(outputs[outputs.length - 1]);
        }
      } else {
        let input = file, result;
        for (let stepIndex = 0; stepIndex < state.recipe.steps.length; stepIndex += 1) {
          const step = state.recipe.steps[stepIndex];
          $("#recipe-status").textContent = `Processing file ${completed + 1} of ${files.length}: ${step.label} · ${completed} finished · ${files.length - completed - 1} remaining`;
          result = await processOne(input, {...step.operation, maxPixels: PRODUCT.maxPixels}, (progress) =>
            setProgress(completed * stepCount + stepIndex + progress, totalWork),
          );
          input = new File([result.bytes], `${file.name}.${outputExtension(result.mime)}`, {type: result.mime});
          setProgress(completed * stepCount + stepIndex + 1, totalWork);
        }
        const directory = relativePath(file).split("/").slice(0, -1).join("/");
        const name = `${stem(file.name)}-${stem(state.recipe.name)}.${outputExtension(result.mime)}`;
        outputs.push({...result, name: uniqueName(directory ? `${directory}/${name}` : name, usedNames), source: file.name, sourcePath: relativePath(file), file, originalBytes: file.size, originalStats: originalStats.get(file), runId: state.activeRunId, runStartedAt: state.activeRunStartedAt});
        rememberOutput(outputs[outputs.length - 1]);
      }
      completed++;
      setProgress(completed * stepCount, totalWork);
      } catch (error) {
        outputs.push({source: file.name, sourcePath: relativePath(file), file, error: friendlyError(error)});
        completed++;
        setProgress(completed * stepCount, totalWork);
      }
    }
    await recoveryWrites;
    state.results = outputs;
    recordTask();
    refreshJobLimit();
    renderResults();
    $("#result-summary").textContent = resultSummary(outputs);
    setProgress(totalWork, totalWork);
    if (returnFocus) $("#result-list .result-download, #result-list .retry-result")?.focus();
    const failed = outputs.filter((result) => result.error).length;
    const succeeded = outputs.length - failed;
    $("#recipe-status").textContent = failed
      ? `Recipe finished with ${failed} error${failed === 1 ? "" : "s"}: ${succeeded} succeeded. Failed files remain below; retry them individually.`
      : `Recipe complete: ${outputs.length} output${outputs.length === 1 ? "" : "s"}.`;
  } finally {
    state.running = false;
    setRunBusy(false);
    button.disabled = false;
  }
}
function outputName(task, result) {
  const directory = relativePath(task.file).split("/").slice(0, -1).join("/");
  const joinPath = (name) => directory ? `${directory}/${name}` : name;
  if (state.tool !== "rename") return joinPath(`${task.name}.${outputExtension(result.mime)}`);
  const pattern = $("#pattern").value || "{prefix}-{seq}-{stem}";
  const prefix = ($("#prefix").value || "export").replace(/[^a-z0-9_-]+/gi, "-");
  const padding = Math.max(1, Number($("#padding").value) || 3);
  const sequence = String(task.sequence || 1).padStart(padding, "0");
  const date = new Date().toISOString().slice(0, 10);
  return joinPath(pattern
    .replaceAll("{prefix}", prefix)
    .replaceAll("{stem}", stem(task.file.name))
    .replaceAll("{seq}", sequence)
    .replaceAll("{width}", String(result.width))
    .replaceAll("{height}", String(result.height))
    .replaceAll("{date}", date) + `.${outputExtension(result.mime)}`);
}
function renderCompare(result) {
  const output = $("#compare-output");
  if (!output || !result || !state.files[0]) return;
  state.compareUrls.splice(0).forEach((url) => URL.revokeObjectURL(url));
  const sourceUrl = URL.createObjectURL(state.files[0]);
  const resultUrl = URL.createObjectURL(new Blob([result.bytes], {type: result.mime}));
  state.compareUrls.push(sourceUrl, resultUrl);
  output.innerHTML = `<div class="compare-stage"><img src="${sourceUrl}" alt="Original"><img id="compare-result" src="${resultUrl}" alt="Compressed result"></div><label>Reveal result <input id="compare-slider" type="range" min="0" max="100" value="50"></label><p class="mono">Original ${formatBytes(state.files[0].size)} · Result ${formatBytes(result.bytes.byteLength)}</p>`;
  $("#compare-slider").oninput = (event) => { $("#compare-result").style.clipPath = `inset(0 ${100 - event.target.value}% 0 0)`; };
}
function renderResults() {
  const list = $("#result-list");
  state.urls.splice(0).forEach((url) => URL.revokeObjectURL(url));
  list.innerHTML = "";
  const historyNote = $("#result-history-note");
  if (historyNote) {
    historyNote.textContent = state.resultNotice;
    historyNote.hidden = !state.resultNotice;
  }
  if (!state.resultNotice || !state.resultToolId) {
    state.resultToolId = state.tool;
    state.resultToolLabel = toolDefs.find((item) => item.id === state.tool)?.label || state.tool;
  }
  const good = state.results.filter((r) => r.bytes);
  for (const r of state.results) {
    const row = document.createElement("article");
    row.className = "result-frame";
    row.style.setProperty("--result-index", String(list.children.length));
    if (r.bytes) {
      const url = URL.createObjectURL(new Blob([r.bytes], { type: r.mime }));
      state.urls.push(url);
      const quality = r.quality ? ` · quality ${Math.round(r.quality * 100)}%` : "";
      const budget = r.resizedForBudget ? " · dimensions reduced to hit budget" : "";
      const outputBytes = r.bytes.byteLength;
      const byteNote = r.originalBytes && r.originalBytes !== outputBytes
        ? ` · ${formatBytes(outputBytes)} · was ${formatBytes(r.originalBytes)}`
        : ` · ${formatBytes(outputBytes)}`;
      const hasDimensions = r.width && r.height;
      const dimensionsChanged = hasDimensions && r.originalStats
        && (r.width !== r.originalStats.width || r.height !== r.originalStats.height);
      const dimensionNote = hasDimensions
        ? ` · ${r.width}×${r.height}${dimensionsChanged ? ` · was ${r.originalStats.width}×${r.originalStats.height}` : ""}`
        : "";
      row.innerHTML = `<figure class="result-print"><img class="result-thumb" src="${url}" alt=""><figcaption><strong>${escapeHtml(r.name)}</strong><span>${escapeHtml(r.mime)}${byteNote}${dimensionNote}${quality}${budget}${r.recoveryRunLabel ? ` · ${escapeHtml(r.recoveryRunLabel)}` : ""}</span></figcaption></figure><a class="btn result-download" draggable="true" href="${url}" download="${escapeHtml(r.name)}">Download</a>`;
      const download = row.querySelector("a[download]");
      download.addEventListener("dragstart", (event) => {
        event.dataTransfer?.setData(
          "DownloadURL",
          `${r.mime}:${r.name}:${url}`,
        );
        event.dataTransfer?.setData("text/uri-list", url);
        event.dataTransfer.effectAllowed = "copy";
      });
    } else {
      row.innerHTML = `<div class="result-failure"><strong>${escapeHtml(r.sourcePath || r.source)}</strong><span class="error">${escapeHtml(r.error)}</span><button class="text-button retry-result">Retry this file</button></div>`;
      row.querySelector(".retry-result").onclick = () => r.file && run([r.file]);
    }
    list.append(row);
  }
  if (good.length) {
    $("#download-zip").hidden = false;
    $("#folder-save-note").hidden = "showDirectoryPicker" in window;
    $("#download-zip").onclick = async () => {
      try {
        const total = good.reduce((sum, result) => sum + result.bytes.byteLength, 0);
        const estimate = await navigator.storage?.estimate?.();
        if (estimate?.quota && estimate.quota - estimate.usage < total * 1.2)
          announce("There may not be enough browser storage for this ZIP. Try saving to a folder or download fewer results.", "error");
        await downloadZip(good.map((x) => ({ name: x.name, bytes: x.bytes })), "pixelproof-results.zip");
        announce(`ZIP ready: ${good.length} output${good.length === 1 ? "" : "s"}.`, "success");
      } catch (error) {
        announce(`ZIP export failed: ${friendlyError(error)}. Try saving fewer results or use Save to folder.`, "error");
      }
    };
    if ("showDirectoryPicker" in window) {
      $("#save-folder").hidden = false;
      $("#save-folder").onclick = () => saveResultsToFolder(good);
    }
  }
}
async function saveResultsToFolder(results) {
  const choice = $("#save-folder-choice");
  const choiceText = $("#save-folder-choice-text");
  const overwriteButton = $("#save-folder-overwrite");
  const keepButton = $("#save-folder-keep");
  const cancelButton = $("#save-folder-cancel");
  const hideChoice = () => {
    choice.hidden = true;
    overwriteButton.onclick = null;
    keepButton.onclick = null;
    cancelButton.onclick = null;
  };
  const chooseCollisionAction = (names) => new Promise((resolve) => {
    const previousFocus = document.activeElement;
    const sample = names.length > 5 ? `${names.slice(0, 5).join(", ")} and ${names.length - 5} more` : names.join(", ");
    choiceText.textContent = `${names.length} file${names.length === 1 ? "" : "s"} already exist${names.length === 1 ? "s" : ""}: ${sample}.`;
    choice.hidden = false;
    requestAnimationFrame(() => overwriteButton.focus());
    const finish = (action) => {
      hideChoice();
      previousFocus?.focus();
      resolve(action);
    };
    overwriteButton.onclick = () => finish("overwrite");
    keepButton.onclick = () => finish("keep");
    cancelButton.onclick = () => finish("cancel");
  });
  const getDirectory = async (root, parts, create) => {
    let directory = root;
    for (const part of parts) directory = await directory.getDirectoryHandle(part, {create});
    return directory;
  };
  const nextName = (name, used, index) => {
    const dot = name.lastIndexOf(".");
    const base = dot > 0 ? name.slice(0, dot) : name;
    const extension = dot > 0 ? name.slice(dot) : "";
    let candidate = `${base}-${index}${extension}`;
    while (used.has(candidate)) candidate = `${base}-${++index}${extension}`;
    return {candidate, index};
  };
  try {
    const total = results.reduce((sum, result) => sum + result.bytes.byteLength, 0);
    const estimate = await navigator.storage?.estimate?.();
    if (estimate?.quota && estimate.quota - estimate.usage < total * 1.2)
      announce("There may not be enough space for this folder export. Use Download ZIP or save fewer results.", "error");
    const root = await window.showDirectoryPicker({mode: "readwrite"});
    const plan = [];
    for (const result of results) {
      const parts = result.name.split("/");
      const filename = parts.pop();
      let directory;
      try {
        directory = await getDirectory(root, parts, false);
      } catch (error) {
        if (error?.name !== "NotFoundError") throw error;
        directory = null;
      }
      let exists = false;
      if (directory) {
        try {
          await directory.getFileHandle(filename);
          exists = true;
        } catch (error) {
          if (error?.name !== "NotFoundError") throw error;
        }
      }
      plan.push({result, parts, filename, directory, exists});
    }
    const collisions = plan.filter((item) => item.exists);
    let action = "overwrite";
    if (collisions.length) {
      action = await chooseCollisionAction(collisions.map((item) => item.result.name));
      if (action === "cancel") return;
    }
    const usedByDirectory = new Map();
    let overwritten = 0;
    let renamed = 0;
    for (const item of plan) {
      const directory = item.directory || await getDirectory(root, item.parts, true);
      let filename = item.filename;
      const key = item.parts.join("/");
      if (!usedByDirectory.has(key)) usedByDirectory.set(key, new Set());
      const used = usedByDirectory.get(key);
      if (action === "keep" && item.exists) {
        let suffix = 2;
        while (true) {
          try {
            await directory.getFileHandle(filename);
            const next = nextName(item.filename, used, suffix++);
            filename = next.candidate;
          } catch (error) {
            if (error?.name === "NotFoundError") break;
            throw error;
          }
        }
        renamed++;
      } else if (item.exists) {
        overwritten++;
      }
      used.add(filename);
      const handle = await directory.getFileHandle(filename, {create: true});
      const writable = await handle.createWritable();
      await writable.write(item.result.bytes);
      await writable.close();
    }
    announce(`Saved ${results.length} result${results.length === 1 ? "" : "s"}: ${results.length} written, ${overwritten} overwritten, ${renamed} renamed.`, "success");
  } catch (error) {
    if (error?.name !== "AbortError") {
      announce(`Folder save failed: ${friendlyError(error)}. Use Download ZIP instead.`, "error");
    }
  }
}
selectTool("compress");
initRecipes();
restoreRecovery();
revalidateLicense().then((result) => {
  if (result.status === "invalid")
    announce("Your stored licence is no longer active. The Free tier remains available; activate again if you have a current key.");
});
detectFormats();
async function detectFormats() {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  supportedFormats.add("image/avif");
  for (const mime of Object.values(MIME).map((x) => x.mime)) {
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, mime));
    if (blob?.type === mime) supportedFormats.add(mime);
  }
  document.querySelectorAll("select#format").forEach((select) =>
    [...select.options].forEach((option) => {
      option.disabled = !supportedFormats.has(option.value);
    }),
  );
}
