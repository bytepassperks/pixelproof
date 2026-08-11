const SIZE = 1024;
const ORT_URL =
  "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/ort.min.mjs";
const TRANSFORMERS_URL =
  "https://cdn.jsdelivr.net/npm/@huggingface/transformers@4.2.0";
const MATTE_MODEL = "Xenova/vitmatte-small-composition-1k";
const MATTE_REVISION = "6bc1297f6140f055a227b6d2cfe8c093281f35d2";
const models = {};

function integral(binary) {
  const stride = SIZE + 1;
  const out = new Uint32Array(stride * stride);
  for (let y = 0; y < SIZE; y += 1) {
    let row = 0;
    for (let x = 0; x < SIZE; x += 1) {
      row += binary[y * SIZE + x];
      out[(y + 1) * stride + x + 1] = out[y * stride + x + 1] + row;
    }
  }
  return out;
}

function rectSum(sum, x1, y1, x2, y2) {
  const stride = SIZE + 1;
  return (
    sum[y2 * stride + x2] -
    sum[y1 * stride + x2] -
    sum[y2 * stride + x1] +
    sum[y1 * stride + x1]
  );
}

function makeTrimap(logits, radius) {
  const binary = new Uint8Array(SIZE * SIZE);
  for (let i = 0; i < binary.length; i += 1) binary[i] = logits[i] >= 0 ? 1 : 0;
  const sum = integral(binary);
  const pixels = new Uint8ClampedArray(SIZE * SIZE * 4);
  let foreground = 0;
  let unknown = 0;
  let background = 0;
  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const x1 = Math.max(0, x - radius);
      const y1 = Math.max(0, y - radius);
      const x2 = Math.min(SIZE, x + radius + 1);
      const y2 = Math.min(SIZE, y + radius + 1);
      const area = (x2 - x1) * (y2 - y1);
      const count = rectSum(sum, x1, y1, x2, y2);
      const value = count === area ? 255 : count === 0 ? 0 : 128;
      if (value === 255) foreground += 1;
      else if (value === 128) unknown += 1;
      else background += 1;
      const index = (y * SIZE + x) * 4;
      pixels[index] = value;
      pixels[index + 1] = value;
      pixels[index + 2] = value;
      pixels[index + 3] = 255;
    }
  }
  return {
    pixels,
    stats: {
      foregroundPercent: (foreground * 100) / (SIZE * SIZE),
      unknownPercent: (unknown * 100) / (SIZE * SIZE),
      backgroundPercent: (background * 100) / (SIZE * SIZE),
      radiusPxAt1024: radius,
    },
  };
}

async function loadModels(config, progress) {
  if (!models.ort) {
    progress("Loading browser inference runtime…");
    models.ort = await import(ORT_URL);
    models.ort.env.wasm.wasmPaths =
      "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.20.1/dist/";
    models.ort.env.wasm.numThreads = Math.min(
      4,
      self.navigator.hardwareConcurrency || 4,
    );
  }
  if (!models.encoder) {
    progress("Loading selector encoder…");
    models.encoder = await models.ort.InferenceSession.create(
      config.encoderBuffer,
      {
        executionProviders: ["wasm"],
        graphOptimizationLevel: "all",
      },
    );
  }
  if (!models.decoder) {
    progress("Loading selector decoder…");
    models.decoder = await models.ort.InferenceSession.create(
      config.decoderBuffer,
      {
        executionProviders: ["wasm"],
        graphOptimizationLevel: "all",
      },
    );
  }
  if (!models.matte) {
    progress("Loading alpha-matting model…");
    const transformers = await import(TRANSFORMERS_URL);
    transformers.env.useBrowserCache = true;
    transformers.env.allowRemoteModels = true;
    transformers.env.backends.onnx.wasm.numThreads = Math.min(
      4,
      self.navigator.hardwareConcurrency || 4,
    );
    transformers.env.backends.onnx.wasm.proxy = false;
    models.processor = await transformers.AutoProcessor.from_pretrained(
      MATTE_MODEL,
      {
        revision: MATTE_REVISION,
      },
    );
    models.matte = await transformers.VitMatteForImageMatting.from_pretrained(
      MATTE_MODEL,
      {
        revision: MATTE_REVISION,
        device: "wasm",
        dtype: "fp32",
      },
    );
  }
}

function rgbTensor(pixels) {
  const plane = SIZE * SIZE;
  const values = new Float32Array(plane * 3);
  for (let i = 0; i < plane; i += 1) {
    values[i] = pixels[i * 4] / 255;
    values[plane + i] = pixels[i * 4 + 1] / 255;
    values[plane * 2 + i] = pixels[i * 4 + 2] / 255;
  }
  return values;
}

async function encodeImage(image) {
  const canvas = new OffscreenCanvas(SIZE, SIZE);
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0, SIZE, SIZE);
  return {
    canvas,
    pixels: context.getImageData(0, 0, SIZE, SIZE).data,
  };
}

async function selectMask(image, clicks, progress) {
  const ort = models.ort;
  if (!models.embedding) {
    const { pixels } = await encodeImage(image);
    progress("Encoding image once for click refinement…");
    const encoded = await models.encoder.run({
      [models.encoder.inputNames[0]]: new ort.Tensor(
        "float32",
        rgbTensor(pixels),
        [1, 3, SIZE, SIZE],
      ),
    });
    models.embedding = encoded[models.encoder.outputNames[0]];
  }
  const points = [];
  const labels = [];
  for (const click of clicks) {
    points.push(click.x, click.y);
    labels.push(click.label);
  }
  while (points.length < 4) {
    points.push(-1, -1);
    labels.push(-1);
  }
  progress("Decoding the selected subject…");
  const decoded = await models.decoder.run({
    image_embeddings: models.embedding,
    batched_point_coords: new ort.Tensor(
      "float32",
      new Float32Array(points.slice(0, 4)),
      [1, 1, 2, 2],
    ),
    batched_point_labels: new ort.Tensor(
      "float32",
      new Float32Array(labels.slice(0, 2)),
      [1, 1, 2],
    ),
    orig_im_size: new ort.Tensor(
      "int64",
      BigInt64Array.from([BigInt(SIZE), BigInt(SIZE)]),
      [2],
    ),
  });
  return decoded[models.decoder.outputNames[0]].data;
}

function guidedAlpha(alpha, rgb, width, height, radius = 8, epsilon = 0.005) {
  const result = new Float32Array(alpha);
  const band = new Uint8Array(alpha.length);
  for (let i = 0; i < alpha.length; i += 1)
    band[i] = alpha[i] > 0.02 && alpha[i] < 0.98 ? 1 : 0;
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (!band[index]) continue;
      let sumA = 0;
      let sumR = 0;
      let sumG = 0;
      let sumB = 0;
      let count = 0;
      for (
        let yy = Math.max(0, y - radius);
        yy <= Math.min(height - 1, y + radius);
        yy += 1
      ) {
        for (
          let xx = Math.max(0, x - radius);
          xx <= Math.min(width - 1, x + radius);
          xx += 1
        ) {
          const other = yy * width + xx;
          sumA += alpha[other];
          sumR += rgb[other * 4];
          sumG += rgb[other * 4 + 1];
          sumB += rgb[other * 4 + 2];
          count += 1;
        }
      }
      const meanA = sumA / count;
      const meanR = sumR / count;
      const meanG = sumG / count;
      const meanB = sumB / count;
      const guide =
        (rgb[index * 4] - meanR) ** 2 +
        (rgb[index * 4 + 1] - meanG) ** 2 +
        (rgb[index * 4 + 2] - meanB) ** 2;
      result[index] = Math.max(
        0,
        Math.min(
          1,
          meanA + ((alpha[index] - meanA) * guide) / (guide + epsilon),
        ),
      );
    }
  }
  return result;
}

function decontaminate(rgba, alpha, width, height) {
  const output = new Uint8ClampedArray(rgba);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const value = alpha[index];
      if (value <= 0.05 || value >= 0.95) continue;
      let red = 0;
      let green = 0;
      let blue = 0;
      let samples = 0;
      for (
        let yy = Math.max(0, y - 4);
        yy <= Math.min(height - 1, y + 4);
        yy += 1
      ) {
        for (
          let xx = Math.max(0, x - 4);
          xx <= Math.min(width - 1, x + 4);
          xx += 1
        ) {
          const other = yy * width + xx;
          if (alpha[other] >= 0.02) continue;
          red += rgba[other * 4];
          green += rgba[other * 4 + 1];
          blue += rgba[other * 4 + 2];
          samples += 1;
        }
      }
      if (!samples) continue;
      const backgroundRed = red / samples;
      const backgroundGreen = green / samples;
      const backgroundBlue = blue / samples;
      const source = index * 4;
      output[source] = Math.max(
        0,
        Math.min(
          255,
          ((rgba[source] - (1 - value) * backgroundRed) /
            Math.max(value, 0.08)) *
            value,
        ),
      );
      output[source + 1] = Math.max(
        0,
        Math.min(
          255,
          ((rgba[source + 1] - (1 - value) * backgroundGreen) /
            Math.max(value, 0.08)) *
            value,
        ),
      );
      output[source + 2] = Math.max(
        0,
        Math.min(
          255,
          ((rgba[source + 2] - (1 - value) * backgroundBlue) /
            Math.max(value, 0.08)) *
            value,
        ),
      );
    }
  }
  return output;
}

async function runMatte(image, trimapPixels, progress) {
  const { RawImage } = await import(TRANSFORMERS_URL);
  const rawImage = await RawImage.fromBlob(await imageToBlob(image));
  const trimapCanvas = new OffscreenCanvas(image.width, image.height);
  trimapCanvas
    .getContext("2d")
    .putImageData(new ImageData(trimapPixels, image.width, image.height), 0, 0);
  const trimap = await RawImage.fromBlob(
    await trimapCanvas.convertToBlob({ type: "image/png" }),
  );
  const prepared = await models.processor(rawImage, trimap);
  progress("Refining edges into continuous alpha…");
  const output = await models.matte(prepared);
  return output.alphas.data;
}

async function imageToBlob(image) {
  const canvas = new OffscreenCanvas(image.width, image.height);
  canvas.getContext("2d").drawImage(image, 0, 0);
  return canvas.convertToBlob({ type: "image/png" });
}

async function run(data) {
  const progress = (message) => self.postMessage({ type: "progress", message });
  await loadModels(data.config, progress);
  const image = await createImageBitmap(
    new Blob([data.imageBuffer], { type: data.imageType }),
  );
  const started = performance.now();
  const logits = await selectMask(image, data.clicks, progress);
  const trimap = makeTrimap(logits, data.bandRadius);
  const trimapCanvas = new OffscreenCanvas(image.width, image.height);
  const trimapContext = trimapCanvas.getContext("2d");
  const trimap1024 = new OffscreenCanvas(SIZE, SIZE);
  trimap1024
    .getContext("2d")
    .putImageData(new ImageData(trimap.pixels, SIZE, SIZE), 0, 0);
  trimapContext.drawImage(trimap1024, 0, 0, image.width, image.height);
  const trimapPixels = trimapContext.getImageData(
    0,
    0,
    image.width,
    image.height,
  ).data;
  let alpha = await runMatte(image, trimapPixels, progress);
  const source = await encodeImageAtSource(image);
  if (data.cleanEdges)
    alpha = guidedAlpha(alpha, source.pixels, image.width, image.height);
  const output = new OffscreenCanvas(image.width, image.height);
  const outputWidth = image.width;
  const outputHeight = image.height;
  const context = output.getContext("2d");
  context.drawImage(image, 0, 0);
  const rgba = context.getImageData(0, 0, image.width, image.height);
  if (data.cleanEdges) {
    rgba.data.set(decontaminate(rgba.data, alpha, image.width, image.height));
  }
  let intermediate = 0;
  for (let i = 0; i < alpha.length; i += 1) {
    const value = Math.max(0, Math.min(1, Number(alpha[i])));
    if (value > 0.01 && value < 0.99) intermediate += 1;
    rgba.data[i * 4 + 3] = Math.round(value * 255);
  }
  context.putImageData(rgba, 0, 0);
  const blob = await output.convertToBlob({ type: "image/png" });
  image.close();
  return {
    buffer: await blob.arrayBuffer(),
    width: outputWidth,
    height: outputHeight,
    mime: blob.type,
    intermediatePercent: (intermediate * 100) / alpha.length,
    trimapStats: trimap.stats,
    elapsedMs: performance.now() - started,
  };
}

async function encodeImageAtSource(image) {
  const canvas = new OffscreenCanvas(image.width, image.height);
  const context = canvas.getContext("2d");
  context.drawImage(image, 0, 0);
  return { pixels: context.getImageData(0, 0, image.width, image.height).data };
}

self.onmessage = async (event) => {
  const { id, ...data } = event.data;
  try {
    const result = await run(data);
    self.postMessage({ id, ok: true, ...result }, [result.buffer]);
  } catch (error) {
    self.postMessage({
      id,
      ok: false,
      error: String(error),
      stack: error.stack,
    });
  }
};
