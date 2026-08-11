import { PRODUCT, MIME } from "./config.js";
import { registerTool, listTools } from "./registry.js";
import { downloadZip } from "./zip.js";
import {
  canUseTool,
  getEntitlementState,
  limitMessage,
  recordTask,
} from "./entitlements.js";
import { mountBackgroundTool } from "./background-removal.js";
import { inspectMetadata } from "./metadata.js";
import { decodeHeic, isHeic } from "./heic.js";

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
];
toolDefs.forEach(registerTool);
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
};
const supportedFormats = new Set();
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
document.title = `${PRODUCT.brand} — private image tools`;
$("#isolation-text").textContent =
  `LOCAL / ${crossOriginIsolated ? "ISOLATED" : "NON-ISOLATED"}`;
$("#isolation-dot").parentElement.classList.add(
  crossOriginIsolated ? "good" : "bad",
);
$("#dialog-isolation").textContent = String(crossOriginIsolated);
$("#about-button").onclick = () => $("#about-dialog").showModal();
$("#close-about").onclick = () => $("#about-dialog").close();
$("#choose-files").onclick = () => $("#file-input").click();
$("#choose-folder").onclick = () => $("#folder-input").click();
$("#file-input").onchange = (e) => addFiles(e.target.files);
$("#folder-input").onchange = (e) => addFiles(e.target.files);
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
$("#dropzone").onkeydown = (e) => {
  if (e.key === "Enter" || e.key === " ") {
    e.preventDefault();
    $("#file-input").click();
  }
};
$("#reset-tool").onclick = () => renderControls();
$("#run-button").onclick = () =>
  state.running ? (state.cancel = true) : run();
function selectTool(id) {
  state.tool = id;
  state.results = [];
  $("#results").hidden = true;
  document
    .querySelectorAll(".tool-link")
    .forEach((b) => b.classList.toggle("active", b.dataset.tool === id));
  const tool = toolDefs.find((x) => x.id === id);
  $("#tool-kicker").textContent = tool.kicker;
  $("#tool-title").textContent = tool.title;
  $("#tool-description").textContent = tool.description;
  renderControls();
}
function addFiles(list) {
  const incoming = [...list].filter((f) =>
    /^image\/(jpeg|png|webp)$/.test(f.type) || isHeic(f),
  );
  if (!incoming.length) return;
  state.files = [...state.files, ...incoming].slice(0, getEntitlementState().maxFiles);
  const oversized = state.files.find((f) => f.size > PRODUCT.maxPixels * 4);
  $("#file-summary").hidden = false;
  $("#file-summary").innerHTML =
    `<span>${state.files.length} image${state.files.length === 1 ? "" : "s"} ready</span><span>${oversized ? "Large files will be checked before processing." : "Nothing leaves this browser."} · ${getEntitlementState().label}</span>`;
  $("#controls").hidden = false;
  renderControls();
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
  return `<div class="field ${wide}"><label>${label}</label>${html}</div>`;
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
    html = `<p class="hint">JPEG and WebP show a live estimate after you choose quality. PNG exports remain lossless.</p><div class="form-grid">${field("Output format", `<select id="format"><option value="image/jpeg">JPEG</option><option value="image/webp">WebP</option><option value="image/png">PNG</option></select>`)}${field("Quality", `<input id="quality" type="range" min="10" max="100" value="82"><output id="quality-output">82</output>`)}${field("Strip metadata", '<label class="check"><input id="strip" type="checkbox" checked> Remove EXIF and metadata</label>')}<div class="field"><label>Live output estimate</label><output id="size-estimate" class="mono">Choose an image to estimate</output></div></div>`;
  else if (id === "target-size")
    html = `<p class="hint">Each image gets its own quality search. If the target is unreachable at the current dimensions, the result explains why; optionally allow a dimension reduction.</p><div class="form-grid">${field("Output format", '<select id="format"><option value="image/jpeg">JPEG</option><option value="image/webp">WebP</option></select>')}${field("Maximum bytes", '<input id="targetBytes" type="number" min="1024" step="1024" value="200000">')}${field("When unreachable", '<label class="check"><input id="reduceDimensions" type="checkbox"> Reduce dimensions to reach the budget</label>')}</div>`;
  else if (id === "resize")
    html = `<div class="form-grid">${field("Mode", '<select id="mode"><option value="dimensions">Dimensions</option><option value="percentage">Percentage</option><option value="fit">Fit within preset</option></select>')}${field("Width", '<input id="width" type="number" min="1" value="1200">')}${field("Height", '<input id="height" type="number" min="1" value="800">')}${field("Percentage", '<input id="value" type="number" min="1" max="400" value="50">')}${field("Preset", '<select id="preset"><option value="1200x1200">Square 1200</option><option value="1920x1080">HD 1920×1080</option><option value="2048x2048">Shopify 2048</option></select>')}</div>`;
  else if (id === "crop")
    html = `<p class="hint">Drag the crop frame in the preview, or enter source pixels precisely.</p><div class="crop-preview"><canvas id="crop-preview" width="640" height="360"></canvas></div><div class="form-grid">${field("Aspect ratio", '<select id="aspect"><option value="free">Free</option><option value="1:1">1:1 square</option><option value="4:3">4:3</option><option value="16:9">16:9</option><option value="3:2">3:2</option></select>')}${field("X", '<input id="x" type="number" min="0" value="0">')}${field("Y", '<input id="y" type="number" min="0" value="0">')}${field("Width", '<input id="width" type="number" min="1" value="800">')}${field("Height", '<input id="height" type="number" min="1" value="600">')}</div>`;
  else if (id === "transform")
    html = `<div class="form-grid">${field("Rotation", '<select id="degrees"><option value="0">0°</option><option value="90">90° clockwise</option><option value="180">180°</option><option value="270">270° clockwise</option></select>')}${field("Flip", '<select id="flip"><option value="none">None</option><option value="x">Flip horizontal</option><option value="y">Flip vertical</option></select>')}</div>`;
  else if (id === "convert")
    html = `<div class="form-grid">${field("Output format", '<select id="format"><option value="image/jpeg">JPEG</option><option value="image/png">PNG</option><option value="image/webp">WebP</option></select>')}${field("Quality", '<input id="quality" type="range" min="10" max="100" value="88">')}</div>`;
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
  else
    html = `<p class="hint">Creates WordPress and Shopify sizes from each source image. Outputs are named with the source stem and destination suffix.</p><div class="form-grid">${field("Export family", '<select id="family"><option value="all">WordPress + Shopify</option><option value="wordpress">WordPress sizes</option><option value="shopify">Shopify sizes</option></select>')}${field("Output format", '<select id="format"><option value="image/jpeg">JPEG</option><option value="image/webp">WebP</option></select>')}</div>`;
  $("#control-content").innerHTML = html;
  mountPresetControls();
  if (id === "photo-editor") setupEditorPreview();
  if (id === "icon-set") $("#run-button").textContent = "Generate icon set";
  if (id === "palette") $("#run-button").textContent = "Extract palette";
  if (id === "compare") $("#run-button").textContent = "Compare";
  if (id === "target-size") $("#run-button").textContent = "Hit target size";
  if (id === "metadata") $("#run-button").textContent = "Strip / export";
  if ($("#quality")) {
    let estimateTimer;
    $("#quality").oninput = (e) => {
      const o = $("#quality-output");
      if (o) o.value = e.target.value;
      clearTimeout(estimateTimer);
      estimateTimer = setTimeout(updateEstimate, 250);
    };
    $("#format").onchange = updateEstimate;
    updateEstimate();
  }
  if (id === "crop") setupCropPreview();
  if (id === "metadata") updateMetadata();
  $("#controls").hidden = !state.files.length;
}
async function updateEstimate() {
  const output = $("#size-estimate");
  if (!output || !state.files[0] || state.running) return;
  output.textContent = "Estimating…";
  try {
    const result = await processOne(state.files[0], {
      ...options(),
      maxPixels: PRODUCT.maxPixels,
    });
    output.textContent = `${Math.round(result.bytes.byteLength / 1024)} KB · ${result.mime}`;
  } catch (error) {
    output.textContent = "Unavailable";
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
    row.innerHTML = '<button class="text-button" id="save-preset">Save settings</button><select id="saved-preset"><option value="">Apply saved preset…</option></select><button class="text-button" id="export-preset">Export pipeline</button><button class="text-button" id="import-preset">Import pipeline</button><input id="import-preset-file" type="file" accept="application/json,.json" hidden>';
    $("#control-content").append(row);
  }
  const select = $("#saved-preset");
  select.innerHTML = '<option value="">Apply saved preset…</option>';
  const presets = JSON.parse(localStorage.getItem("pixelproof-presets") || "[]");
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
    const next = JSON.parse(localStorage.getItem("pixelproof-presets") || "[]");
    next.push({name: name.trim(), tool: state.tool, values});
    localStorage.setItem("pixelproof-presets", JSON.stringify(next));
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
      if (document.pixelproof !== 1 || !payload?.name || !payload?.tool || !payload?.values || !toolDefs.some((tool) => tool.id === payload.tool) || typeof payload.values !== "object" || Array.isArray(payload.values)) throw new Error("Not a valid PixelProof pipeline file.");
      payload.name = String(payload.name).trim().replace(/[^\w .-]+/g, "").slice(0, 80);
      if (!payload.name) throw new Error("Pipeline name is empty.");
      const next = JSON.parse(localStorage.getItem("pixelproof-presets") || "[]");
      next.push({name: payload.name, tool: payload.tool, values: payload.values});
      localStorage.setItem("pixelproof-presets", JSON.stringify(next));
      if (payload.tool === state.tool) mountPresetControls();
      $("#run-status").textContent = `Imported pipeline “${payload.name}”.`;
    } catch (error) {
      $("#run-status").textContent = `Pipeline import failed: ${error.message}`;
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
  output.innerHTML = `<p><strong>${metadata.fieldCount ? `${metadata.fieldCount} metadata field${metadata.fieldCount === 1 ? "" : "s"} found` : "No readable EXIF fields found"}</strong> · ${Math.round(metadata.bytes / 1024)} KB · ${escapeHtml(metadata.format)}</p>${coordinates}<dl>${fields.map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd>`).join("")}</dl>`;
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
  $("#control-content").innerHTML = '<p class="hint">Manual review only: this build does not claim to detect every face. Drag boxes over every face or private region, then confirm the reviewed result before export.</p><canvas id="face-canvas" class="tool-preview" width="640" height="420"></canvas><div class="form-grid"><div class="field"><label>Method</label><select id="blurMode"><option value="blur">Blur</option><option value="pixelate">Pixelate</option></select></div><div class="field"><label>Strength</label><input id="blurStrength" type="range" min="4" max="32" value="12"></div></div><button class="text-button" id="face-delete">Delete last box</button><label class="check"><input id="face-confirm" type="checkbox"> I reviewed every box and confirm this export</label><div class="run-row"><button class="btn primary" id="face-run">Process reviewed boxes</button><button class="btn" id="face-export" hidden>Export privacy copy</button><span class="mono" id="face-status">Drag on the image to add a box.</span></div>';
  const canvas = $("#face-canvas"), file = state.files[0];
  if (!file) return;
  const image = new Image(), context = canvas.getContext("2d");
  let start = null;
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
  };
  canvas.onpointerdown = (event) => { const rect = canvas.getBoundingClientRect(); start = {x: event.clientX - rect.left, y: event.clientY - rect.top}; };
  canvas.onpointerup = (event) => {
    if (!start) return;
    const rect = canvas.getBoundingClientRect();
    const end = {x: event.clientX - rect.left, y: event.clientY - rect.top};
    const box = {x: Math.min(start.x, end.x), y: Math.min(start.y, end.y), width: Math.abs(end.x - start.x), height: Math.abs(end.y - start.y)};
    if (box.width > 4 && box.height > 4) state.faceBoxes.push(box);
    start = null; draw();
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
}
async function options() {
  const id = state.tool,
    q = Number($("#quality")?.value || 88),
    format = $("#format")?.value || "image/png";
  if (id === "compress" || id === "convert")
    return { type: id, mime: format, quality: q / 100 };
  if (id === "target-size") {
    return {type: id, mime: $("#format").value, targetBytes: Number($("#targetBytes").value), reduceDimensions: $("#reduceDimensions").checked, metadata: {mode: "strip"}};
  }
  if (id === "metadata") {
    const metadata = await inspectMetadata(state.files[0]);
    return {type: "metadata", mime: "image/jpeg", quality: 0.92, metadata: {mode: $("#metadataMode").value, ...metadata.fields}};
  }
  if (id === "resize") {
    const mode = $("#mode").value;
    let w = Number($("#width").value),
      h = Number($("#height").value);
    if (mode === "fit") [w, h] = $("#preset").value.split("x").map(Number);
    return {
      type: id,
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
      type: id,
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
      type: id,
      degrees: Number($("#degrees").value),
      flipX: flip === "x",
      flipY: flip === "y",
      mime: "image/png",
    };
  }
  if (id === "watermark") {
    const mark = $("#mark")?.files[0];
    return {
      type: id,
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
      type: id,
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
    return {type: id, width, height, fill: $("#framing").value === "fill", mime: "image/png"};
  }
  if (id === "icon-set") return {type: id, width: 512, height: 512, fill: false, mime: "image/png"};
  if (id === "rename") return {type: "rename", mime: "image/png"};
  if (id === "compare") return {type: "compress", mime: $("#format").value, quality: Number($("#quality").value) / 100};
  return { type: id, mime: format, quality: q / 100 };
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
  if (/could not be decoded|decode|invalidstateerror/i.test(message))
    return "This file could not be decoded as a supported image. Check that it is a real JPEG, PNG, WebP, or HEIC/HEIF file.";
  return message;
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
async function processOne(file, op) {
  let input = file;
  if (isHeic(file)) {
    const decoded = await decodeHeic(file, (message) => { $("#run-status").textContent = message; });
    input = new File([decoded.buffer], `${file.name}.png`, {type: "image/png"});
  }
  const worker = new Worker("./worker.js", {type: "module"});
  return new Promise((resolve, reject) => {
    worker.onmessage = (e) => {
      worker.terminate();
      e.data.ok ? resolve(e.data) : reject(new Error(e.data.error));
    };
    worker.onerror = (e) => {
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
    );
  });
}
function outputExtension(mime) {
  if (mime === "image/x-icon") return "ico";
  return Object.values(MIME).find((x) => x.mime === mime)?.ext || "png";
}
async function run() {
  if (state.tool === "background-removal") {
    const status = $("#run-status");
    status.textContent = "Use the background-removal controls below.";
    return;
  }
  if (state.tool === "face-blur") return;
  if (
    !state.files.length ||
    !canUseTool(state.tool, {
      fileCount: state.files.length,
      task: true,
    })
  ) {
    $("#run-status").textContent = limitMessage(state.tool, {
      fileCount: state.files.length,
      task: true,
    });
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
  button.textContent = "Cancel";
  state.results = [];
  $("#results").hidden = false;
  $("#result-list").innerHTML = "";
  $("#download-zip").hidden = true;
  const base = await options(),
    op = { ...base, maxPixels: PRODUCT.maxPixels },
    outputs = [];
  let done = 0;
  const tasks = [];
  for (const file of state.files) {
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
  const worker = async () => {
    while (cursor < tasks.length && !state.cancel) {
      const task = tasks[cursor++];
      $("#run-status").textContent =
        `Processing ${done + 1} of ${tasks.length}…`;
      try {
        const result = await processOne(task.file, task.op);
        outputs.push({
          name: outputName(task, result),
          ...result,
          source: task.file.name,
          sourcePath: relativePath(task.file),
        });
      } catch (error) {
        outputs.push({
          name: task.name,
          error: friendlyError(error),
          source: task.file.name,
        });
      }
      done++;
    }
  };
  await Promise.all(
    Array.from({ length: Math.min(PRODUCT.concurrency, tasks.length) }, worker),
  );
  state.results = outputs;
  recordTask();
  renderResults();
  if (state.tool === "icon-set") {
    $("#icon-snippet").textContent = `<link rel="icon" href="/favicon.ico" sizes="32x32">\n<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">\n<link rel="apple-touch-icon" href="/apple-touch-icon.png">\n<link rel="manifest" href="/site.webmanifest">\n\n{\n  "icons": [\n    {"src": "/icon-192.png", "sizes": "192x192", "type": "image/png"},\n    {"src": "/icon-512.png", "sizes": "512x512", "type": "image/png"}\n  ]\n}`;
  }
  if (state.tool === "compare") renderCompare(outputs[0]);
  state.running = false;
  button.textContent = "Process images";
  const failed = outputs.filter((result) => result.error).length;
  const succeeded = outputs.length - failed;
  $("#run-status").textContent = state.cancel
    ? `Cancelled after ${done} output${done === 1 ? "" : "s"}.`
    : failed
      ? `Finished with ${failed} error${failed === 1 ? "" : "s"}: ${succeeded} succeeded. See the output rows for next steps.`
      : `Finished ${done} output${done === 1 ? "" : "s"}.`;
  state.cancel = false;
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
  const sourceUrl = URL.createObjectURL(state.files[0]);
  const resultUrl = URL.createObjectURL(new Blob([result.bytes], {type: result.mime}));
  output.innerHTML = `<div class="compare-stage"><img src="${sourceUrl}" alt="Original"><img id="compare-result" src="${resultUrl}" alt="Compressed result"></div><label>Reveal result <input id="compare-slider" type="range" min="0" max="100" value="50"></label><p class="mono">Original ${Math.round(state.files[0].size / 1024)} KB · Result ${Math.round(result.bytes.byteLength / 1024)} KB</p>`;
  $("#compare-slider").oninput = (event) => { $("#compare-result").style.clipPath = `inset(0 ${100 - event.target.value}% 0 0)`; };
}
function renderResults() {
  const list = $("#result-list");
  list.innerHTML = "";
  const good = state.results.filter((r) => r.bytes);
  for (const r of state.results) {
    const row = document.createElement("div");
    row.className = "result-item";
    if (r.bytes) {
      const url = URL.createObjectURL(new Blob([r.bytes], { type: r.mime }));
      state.urls.push(url);
      const quality = r.quality ? ` · quality ${Math.round(r.quality * 100)}%` : "";
      const budget = r.resizedForBudget ? " · dimensions reduced to hit budget" : "";
      row.innerHTML = `<img class="result-thumb" src="${url}" alt=""><div><div class="result-name">${escapeHtml(r.name)}</div><div class="result-meta">${escapeHtml(r.mime)} · ${Math.round(r.bytes.byteLength / 1024)} KB · ${r.width}×${r.height}${quality}${budget}</div></div><a class="btn" href="${url}" download="${escapeHtml(r.name)}">Download</a>`;
    } else
      row.innerHTML = `<div></div><div><div class="result-name">${escapeHtml(r.source)}</div><div class="error">${escapeHtml(r.error)}</div></div>`;
    list.append(row);
  }
  if (good.length) {
    $("#download-zip").hidden = false;
    $("#download-zip").onclick = () =>
      downloadZip(
        good.map((x) => ({ name: x.name, bytes: x.bytes })),
        "pixelproof-results.zip",
      );
  }
}
selectTool("compress");
detectFormats();
async function detectFormats() {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
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
