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
function watermark(ctx, op, width, height) {
  if (op.text) {
    const size = Math.max(12, Math.round(Math.min(width, height) * (op.scale || 0.04)));
    ctx.save(); ctx.globalAlpha = op.opacity ?? 0.55; ctx.fillStyle = op.color || '#ffffff';
    ctx.font = `700 ${size}px Arial`; ctx.shadowColor = '#000'; ctx.shadowBlur = 3;
    const metrics = ctx.measureText(op.text), pad = size;
    const x = op.position.includes('right') ? width - metrics.width - pad : op.position.includes('center') ? (width - metrics.width) / 2 : pad;
    const y = op.position.includes('bottom') ? height - pad : op.position.includes('center') ? height / 2 : size + pad;
    ctx.fillText(op.text, x, y); ctx.restore();
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
    } else if (operation.type === 'resize' || operation.type === 'web-export') {
      if (operation.mime === 'image/jpeg') { out.fillStyle = '#fff'; out.fillRect(0, 0, width, height); }
      operation.type === 'resize' && operation.mode !== 'fit' ? out.drawImage(image, 0, 0, width, height) : drawContain(out, image, width, height);
    } else {
      out.drawImage(image, 0, 0);
      if (operation.flipX || operation.flipY) {
        const temp = new OffscreenCanvas(width, height), tx = temp.getContext('2d');
        tx.scale(operation.flipX ? -1 : 1, operation.flipY ? -1 : 1);
        tx.drawImage(canvas, operation.flipX ? -width : 0, operation.flipY ? -height : 0);
        out.clearRect(0, 0, width, height); out.drawImage(temp, 0, 0);
      }
    }
    const result = await encode(canvas, operation.mime || file.type || 'image/png', operation.quality);
    self.postMessage({id, ok: true, ...result}, [result.bytes]);
    image.close();
  } catch (error) { self.postMessage({id: data.id, ok: false, error: String(error)}); }
};
