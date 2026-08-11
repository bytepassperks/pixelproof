function fitWithin(width, height, maxWidth, maxHeight) {
  const scale = Math.min(maxWidth / width, maxHeight / height, 1);
  return {width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale))};
}
function targetSize(width, height, op) {
  if (op.mode === 'percentage') return {width: Math.max(1, Math.round(width * op.value / 100)), height: Math.max(1, Math.round(height * op.value / 100))};
  if (op.mode === 'fit') return fitWithin(width, height, op.width, op.height);
  return {width: Math.max(1, Math.round(op.width || width)), height: Math.max(1, Math.round(op.height || height))};
}
function drawCover(ctx, source, width, height, anchor = 'center') {
  const scale = Math.max(width / source.width, height / source.height);
  const sw = source.width * scale, sh = source.height * scale;
  const x = anchor === 'left' ? 0 : anchor === 'right' ? width - sw : (width - sw) / 2;
  const y = anchor === 'top' ? 0 : anchor === 'bottom' ? height - sh : (height - sh) / 2;
  ctx.drawImage(source, x, y, sw, sh);
}
function drawContain(ctx, source, width, height) {
  const scale = Math.min(width / source.width, height / source.height);
  const sw = source.width * scale, sh = source.height * scale;
  ctx.drawImage(source, (width - sw) / 2, (height - sh) / 2, sw, sh);
}
async function decode(buffer, type) { return createImageBitmap(new Blob([buffer], {type})); }
async function encode(canvas, mime, quality) {
  const blob = await canvas.convertToBlob({type: mime, quality});
  return {bytes: await blob.arrayBuffer(), mime: blob.type, width: canvas.width, height: canvas.height};
}
function pngToIco(png, width, height) {
  const bytes = new Uint8Array(22 + png.byteLength);
  const view = new DataView(bytes.buffer);
  view.setUint16(0, 0, true);
  view.setUint16(2, 1, true);
  view.setUint16(4, 1, true);
  bytes[6] = width >= 256 ? 0 : width;
  bytes[7] = height >= 256 ? 0 : height;
  bytes[8] = 0; bytes[9] = 0; bytes[10] = 1; bytes[11] = 0;
  view.setUint32(12, png.byteLength, true);
  view.setUint32(16, 22, true);
  bytes.set(new Uint8Array(png), 22);
  return bytes.buffer;
}
function watermark(ctx, op, width, height) {
  if (op.text) {
    const size = Math.max(12, Math.round(Math.min(width, height) * (op.scale || 0.04)));
    ctx.save(); ctx.globalAlpha = op.opacity ?? 0.55; ctx.fillStyle = op.color || '#ffffff';
    ctx.font = `700 ${size}px ${op.font || "Arial"}`; ctx.shadowColor = '#000'; ctx.shadowBlur = 3;
    const metrics = ctx.measureText(op.text), pad = size;
    const x = op.position.includes('right') ? width - metrics.width - pad : op.position.includes('center') ? (width - metrics.width) / 2 : pad;
    const y = op.position.includes('bottom') ? height - pad : op.position.includes('center') ? height / 2 : size + pad;
    ctx.fillText(op.text, x, y); ctx.restore();
  }
}
function clamp(value, min = 0, max = 255) {
  return Math.min(max, Math.max(min, value));
}
function applyEditor(imageData, op) {
  const data = imageData.data;
  const brightness = Number(op.brightness || 0);
  const contrast = Number(op.contrast || 0);
  const saturation = Number(op.saturation || 0) / 100;
  const exposure = 2 ** Number(op.exposure || 0);
  const temperature = Number(op.temperature || 0);
  const tint = Number(op.tint || 0);
  const filter = op.filter || "none";
  const contrastScale = (259 * (contrast + 255)) / (255 * (259 - contrast));
  for (let i = 0; i < data.length; i += 4) {
    let r = data[i] * exposure;
    let g = data[i + 1] * exposure;
    let b = data[i + 2] * exposure;
    r = contrastScale * (r - 128) + 128 + brightness;
    g = contrastScale * (g - 128) + 128 + brightness;
    b = contrastScale * (b - 128) + 128 + brightness;
    const gray = 0.299 * r + 0.587 * g + 0.114 * b;
    r += (r - gray) * saturation + temperature * 0.8;
    g += (g - gray) * saturation + tint * 0.35;
    b += (b - gray) * saturation - temperature * 0.8;
    if (filter === "mono") {
      r = g = b = gray;
    } else if (filter === "warm") {
      r += 18; g += 6; b -= 12;
    } else if (filter === "cool") {
      r -= 10; g += 4; b += 16;
    } else if (filter === "faded") {
      r = r * 0.85 + 24; g = g * 0.85 + 24; b = b * 0.85 + 24;
    }
    data[i] = clamp(r);
    data[i + 1] = clamp(g);
    data[i + 2] = clamp(b);
  }
}
function sharpen(ctx, width, height, amount) {
  if (!amount) return;
  const source = ctx.getImageData(0, 0, width, height);
  const output = ctx.createImageData(width, height);
  const src = source.data, dst = output.data;
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const p = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        const value = src[p + c] * (1 + amount)
          - (src[p - 4 + c] + src[p + 4 + c] + src[p - width * 4 + c] + src[p + width * 4 + c]) * amount / 4;
        dst[p + c] = clamp(value);
      }
      dst[p + 3] = src[p + 3];
    }
  }
  ctx.putImageData(output, 0, 0);
}
function vignette(ctx, width, height, amount) {
  if (!amount) return;
  const gradient = ctx.createRadialGradient(width / 2, height / 2, Math.min(width, height) * 0.2, width / 2, height / 2, Math.max(width, height) * 0.7);
  gradient.addColorStop(0, "rgba(0,0,0,0)");
  gradient.addColorStop(1, `rgba(0,0,0,${Math.min(0.85, amount)})`);
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, width, height);
}
function drawCaption(ctx, text, width, height, y, size, color) {
  if (!text) return;
  const fontSize = Math.max(12, Math.round(Math.min(width, height) * size));
  ctx.save();
  ctx.font = `900 ${fontSize}px Impact, Arial Black, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillStyle = color || "#ffffff";
  ctx.strokeStyle = "#000000";
  ctx.lineJoin = "round";
  ctx.lineWidth = Math.max(3, fontSize * 0.12);
  ctx.strokeText(text, width / 2, y);
  ctx.fillText(text, width / 2, y);
  ctx.restore();
}
function blurBox(ctx, box, mode, strength) {
  const x = Math.max(0, Math.round(box.x)), y = Math.max(0, Math.round(box.y));
  const width = Math.min(ctx.canvas.width - x, Math.round(box.width));
  const height = Math.min(ctx.canvas.height - y, Math.round(box.height));
  if (width <= 0 || height <= 0) return;
  if (mode === "pixelate") {
    const size = Math.max(4, Math.round(strength));
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    const temp = new OffscreenCanvas(Math.max(1, Math.ceil(width / size)), Math.max(1, Math.ceil(height / size)));
    const tempContext = temp.getContext("2d");
    tempContext.drawImage(ctx.canvas, x, y, width, height, 0, 0, temp.width, temp.height);
    ctx.drawImage(temp, 0, 0, temp.width, temp.height, x, y, width, height);
    ctx.restore();
  } else {
    const blur = Math.max(2, Math.round(strength));
    const temp = new OffscreenCanvas(width, height);
    const tempContext = temp.getContext("2d");
    tempContext.filter = `blur(${blur}px)`;
    tempContext.drawImage(ctx.canvas, x, y, width, height, 0, 0, width, height);
    ctx.drawImage(temp, 0, 0, width, height, x, y, width, height);
  }
}
self.onmessage = async ({data}) => {
  try {
    const {id, file, operation} = data, image = await decode(file.buffer, file.type);
    if (image.width * image.height > (operation.maxPixels || 64_000_000)) throw new Error(`Image is too large (${image.width}×${image.height}).`);
    let width = image.width, height = image.height, canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d', {alpha: true});
    ctx.imageSmoothingQuality = 'high';
    if (operation.type === 'resize') ({width, height} = targetSize(width, height, operation));
    if (operation.type === 'crop') { width = operation.width; height = operation.height; }
    if (operation.type === 'rotate' && Math.abs(operation.degrees) % 180 === 90) [width, height] = [height, width];
    if (operation.type === 'web-export') ({width, height} = targetSize(width, height, operation));
    if (operation.type === 'social' || operation.type === 'icon-set') ({width, height} = targetSize(width, height, operation));
    if (operation.type === 'meme') ({width, height} = {width: image.width, height: image.height});
    canvas = new OffscreenCanvas(width, height); const out = canvas.getContext('2d', {alpha: true});
    out.imageSmoothingQuality = 'high';
    if (operation.type === 'crop') {
      out.drawImage(image, operation.x, operation.y, operation.width, operation.height, 0, 0, width, height);
    } else if (operation.type === 'rotate') {
      out.translate(width / 2, height / 2); out.rotate(operation.degrees * Math.PI / 180);
      out.scale(operation.flipX ? -1 : 1, operation.flipY ? -1 : 1);
      out.drawImage(image, -image.width / 2, -image.height / 2);
    } else if (operation.type === 'watermark') {
      out.drawImage(image, 0, 0);
      if (operation.imageBuffer) {
        const mark = await decode(operation.imageBuffer, operation.imageType || 'image/png');
        const scale = operation.scale || 0.2;
        const markWidth = Math.round(width * scale);
        const markHeight = Math.round(mark.height * markWidth / mark.width);
        const pad = Math.round(Math.min(width, height) * 0.03);
        const x = operation.position.includes('right') ? width - markWidth - pad : operation.position.includes('center') ? (width - markWidth) / 2 : pad;
        const y = operation.position.includes('bottom') ? height - markHeight - pad : operation.position.includes('center') ? (height - markHeight) / 2 : pad;
        out.save(); out.globalAlpha = operation.opacity ?? 0.55;
        out.drawImage(mark, x, y, markWidth, markHeight); out.restore(); mark.close();
      }
      watermark(out, operation, width, height);
    } else if (operation.type === 'resize' || operation.type === 'web-export' || operation.type === 'social' || operation.type === 'icon-set') {
      if (operation.mime === 'image/jpeg') { out.fillStyle = '#fff'; out.fillRect(0, 0, width, height); }
      if (operation.fill || operation.type === 'web-export' || (operation.type === 'resize' && operation.mode !== 'fit')) drawCover(out, image, width, height);
      else drawContain(out, image, width, height);
    } else if (operation.type === 'photo-editor') {
      out.drawImage(image, 0, 0);
      if (operation.blur) out.filter = `blur(${Number(operation.blur)}px)`;
      const pixels = out.getImageData(0, 0, width, height);
      applyEditor(pixels, operation);
      out.putImageData(pixels, 0, 0);
      sharpen(out, width, height, Number(operation.sharpen || 0));
      vignette(out, width, height, Number(operation.vignette || 0));
      watermark(out, operation, width, height);
    } else if (operation.type === 'meme') {
      out.drawImage(image, 0, 0);
      drawCaption(out, operation.top, width, height, height * (Number(operation.topPosition || 0.1)), Number(operation.size || 0.08), operation.color);
      drawCaption(out, operation.bottom, width, height, height * (1 - Number(operation.bottomPosition || 0.1)), Number(operation.size || 0.08), operation.color);
    } else if (operation.type === 'face-blur') {
      out.drawImage(image, 0, 0);
      for (const box of operation.boxes || []) blurBox(out, box, operation.mode, operation.strength);
    } else {
      out.drawImage(image, 0, 0);
      if (operation.flipX || operation.flipY) {
        const temp = new OffscreenCanvas(width, height), tx = temp.getContext('2d');
        tx.scale(operation.flipX ? -1 : 1, operation.flipY ? -1 : 1);
        tx.drawImage(canvas, operation.flipX ? -width : 0, operation.flipY ? -height : 0);
        out.clearRect(0, 0, width, height); out.drawImage(temp, 0, 0);
      }
    }
    let result = await encode(canvas, operation.mime || file.type || 'image/png', operation.quality);
    if (operation.ico) {
      result = {...result, bytes: pngToIco(result.bytes, width, height), mime: 'image/x-icon'};
    }
    self.postMessage({id, ok: true, ...result}, [result.bytes]);
    image.close();
  } catch (error) { self.postMessage({id: data.id, ok: false, error: String(error)}); }
};
