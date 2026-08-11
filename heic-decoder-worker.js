/* Separately loaded LGPL libheif decoder. Keep this worker independent from app code. */
importScripts("./vendor/heic/libheif.js");

let runtime;
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
    const blob = await canvas.convertToBlob({type: "image/png"});
    return {buffer: await blob.arrayBuffer(), width, height};
  } finally {
    if (images) for (const image of images) image.free();
    if (decoder.decoder) libheif.heif_context_free(decoder.decoder);
  }
}

self.onmessage = async ({data}) => {
  try {
    const result = await decode(data.buffer);
    self.postMessage({id: data.id, ...result}, [result.buffer]);
  } catch (error) {
    self.postMessage({id: data.id, error: error?.message || String(error)});
  }
};
