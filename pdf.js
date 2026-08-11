const PDF_ASSET = "./vendor/pdf-lib/pdf-lib.min.js";
import { decodeHeic, isHeic } from "./heic.js";

export function pdfPageSize(size, orientation, width, height) {
  let page = size === "a4" ? [595.28, 841.89] : size === "letter" ? [612, 792] : [width * 72 / 96, height * 72 / 96];
  if (orientation === "landscape" && page[1] > page[0]) page = [page[1], page[0]];
  if (orientation === "portrait" && page[0] > page[1]) page = [page[1], page[0]];
  return page;
}

export async function imageForPdf(file, svgSize = {width: 1200, height: 1200}) {
  let input = file;
  if (file.name.toLowerCase().endsWith(".svg") || file.type === "image/svg+xml") {
    const text = await file.text();
    const cleaned = text
      .replace(/<script[\s\S]*?<\/script>/gi, "")
      .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, "")
      .replace(/<style[\s\S]*?@import[\s\S]*?<\/style>/gi, "")
      .replace(/\son[a-z]+\s*=\s*(['"]).*?\1/gi, "")
      .replace(/\s(?:href|xlink:href)\s*=\s*(['"])(?!#).*?\1/gi, "");
    const viewBox = cleaned.match(/viewBox\s*=\s*["']\s*([\d.+-]+)[ ,]+([\d.+-]+)[ ,]+([\d.+-]+)[ ,]+([\d.+-]+)\s*["']/i);
    const inner = cleaned.replace(/<svg\b/i, `<svg width="${svgSize.width}" height="${svgSize.height}"${viewBox ? ` viewBox="${viewBox.slice(1).join(" ")}` : ""}`);
    input = new File([inner], `${file.name}.svg`, {type: "image/svg+xml"});
  }
  if (isHeic(file)) {
    const decoded = await decodeHeic(file);
    input = new File([decoded.buffer], `${file.name}.png`, {type: "image/png"});
  }
  const bitmap = await createImageBitmap(input);
  const scale = Math.min(1, 1800 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d", {alpha: false});
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", .82));
  return {bytes: await blob.arrayBuffer(), mime: "image/jpeg", width: canvas.width, height: canvas.height};
}

export async function generatePdf(images, options) {
  const worker = new Worker("./pdf-worker.js");
  return new Promise((resolve, reject) => {
    worker.onmessage = (event) => {
      worker.terminate();
      event.data.ok ? resolve(event.data.bytes) : reject(new Error(event.data.error));
    };
    worker.onerror = (event) => {
      worker.terminate();
      reject(event.error || new Error("PDF worker failed"));
    };
    worker.postMessage({images, options}, images.flatMap((image) => [image.bytes]));
  });
}
