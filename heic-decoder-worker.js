/* Separately loaded LGPL libheif decoder. Keep this worker independent from app code. */
importScripts("./vendor/heic/libheif.js");

let runtime;
function exifOrientation(buffer) {
  const bytes = new Uint8Array(buffer);
  for (let offset = 0; offset + 10 < bytes.length; offset++) {
    const little = bytes[offset] === 0x49 && bytes[offset + 1] === 0x49 && bytes[offset + 2] === 0x2a && bytes[offset + 3] === 0;
    const big = bytes[offset] === 0x4d && bytes[offset + 1] === 0x4d && bytes[offset + 2] === 0 && bytes[offset + 3] === 0x2a;
    if (!little && !big) continue;
    const view = new DataView(buffer, offset);
    const count = view.getUint16(8, little);
    for (let i = 0; i < count; i++) {
      const entry = 10 + i * 12;
      if (entry + 12 > buffer.byteLength || view.getUint16(entry, little) !== 0x0112) continue;
      return view.getUint16(entry + 8, little);
    }
  }
  return 1;
}

function orientCanvas(source, orientation) {
  if (!orientation || orientation === 1) return source;
  const width = source.width, height = source.height;
  const quarterTurn = orientation >= 5 && orientation <= 8;
  const canvas = new OffscreenCanvas(quarterTurn ? height : width, quarterTurn ? width : height);
  const context = canvas.getContext("2d");
  switch (orientation) {
    case 2: context.translate(width, 0); context.scale(-1, 1); break;
    case 3: context.translate(width, height); context.rotate(Math.PI); break;
    case 4: context.translate(0, height); context.scale(1, -1); break;
    case 5: context.rotate(Math.PI / 2); context.scale(1, -1); break;
    case 6: context.translate(height, 0); context.rotate(Math.PI / 2); break;
    case 7: context.translate(height, 0); context.rotate(Math.PI / 2); context.scale(-1, 1); break;
    case 8: context.translate(0, width); context.rotate(-Math.PI / 2); break;
    default: return source;
  }
  context.drawImage(source, 0, 0);
  return canvas;
}

async function getRuntime() {
  if (!runtime) runtime = self.libheif({
    locateFile: (name) => new URL(`./vendor/heic/${name}`, self.location.href).href,
  });
  return runtime;
}

async function decode(buffer) {
  const libheif = await getRuntime();
  const decoder = new libheif.HeifDecoder();
  let images;
  try {
    images = decoder.decode(new Uint8Array(buffer));
    if (!images.length) throw new Error("HEIF image not found");
    const image = images[0];
    const width = image.get_width();
    const height = image.get_height();
    const imageData = new ImageData(width, height);
    imageData.data.fill(255);
    await new Promise((resolve, reject) => {
      image.display(imageData, (displayData) => displayData ? resolve() : reject(new Error("HEIF processing error")));
    });
    const canvas = new OffscreenCanvas(width, height);
    canvas.getContext("2d").putImageData(imageData, 0, 0);
    const upright = orientCanvas(canvas, exifOrientation(buffer));
    const blob = await upright.convertToBlob({type: "image/png"});
    return {buffer: await blob.arrayBuffer(), width: upright.width, height: upright.height};
  } finally {
    if (images) for (const image of images) image.free();
    if (decoder.decoder) libheif.heif_context_free(decoder.decoder);
  }
}

self.onmessage = async ({data}) => {
  const heartbeat = setInterval(() => self.postMessage({id: data.id, heartbeat: true}), 5_000);
  self.postMessage({id: data.id, started: true});
  try {
    const result = await decode(data.buffer);
    self.postMessage({id: data.id, ...result}, [result.buffer]);
  } catch (error) {
    self.postMessage({id: data.id, error: error?.message || String(error)});
  } finally { clearInterval(heartbeat); }
};
