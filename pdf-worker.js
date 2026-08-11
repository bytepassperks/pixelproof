importScripts("./vendor/pdf-lib/pdf-lib.min.js");

function fitBox(sourceWidth, sourceHeight, width, height, mode) {
  const scale = mode === "fill"
    ? Math.max(width / sourceWidth, height / sourceHeight)
    : Math.min(width / sourceWidth, height / sourceHeight);
  return {width: sourceWidth * scale, height: sourceHeight * scale};
}

async function buildPdf(images, options) {
  const {PDFDocument, rgb} = PDFLib;
  const pdf = await PDFDocument.create();
  for (const image of images) {
    const page = pdf.addPage([options.pageWidth, options.pageHeight]);
    const embedded = image.mime === "image/png"
      ? await pdf.embedPng(image.bytes)
      : await pdf.embedJpg(image.bytes);
    const margin = options.margin;
    const box = fitBox(embedded.width, embedded.height, options.pageWidth - margin * 2, options.pageHeight - margin * 2, options.mode);
    page.drawRectangle({x: 0, y: 0, width: options.pageWidth, height: options.pageHeight, color: rgb(1, 1, 1)});
    page.drawImage(embedded, {
      x: margin + (options.pageWidth - margin * 2 - box.width) / 2,
      y: margin + (options.pageHeight - margin * 2 - box.height) / 2,
      width: box.width,
      height: box.height,
    });
  }
  return pdf.save({useObjectStreams: true});
}

async function buildIdSheet(data) {
  const {PDFDocument, rgb} = PDFLib;
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([data.paperW * 72 / 25.4, data.paperH * 72 / 25.4]);
  const embedded = await pdf.embedJpg(data.image.bytes);
  const photoW = data.photoW * 72 / 25.4, photoH = data.photoH * 72 / 25.4;
  const paperW = data.paperW * 72 / 25.4, paperH = data.paperH * 72 / 25.4;
  const columns = Math.max(1, Math.floor(paperW / photoW));
  const rows = Math.max(1, Math.floor(paperH / photoH));
  const total = Math.min(data.copies, columns * rows);
  page.drawRectangle({x: 0, y: 0, width: paperW, height: paperH, color: rgb(1, 1, 1)});
  for (let index = 0; index < total; index++) {
    const column = index % columns, row = Math.floor(index / columns);
    page.drawImage(embedded, {x: column * photoW, y: paperH - (row + 1) * photoH, width: photoW, height: photoH});
  }
  return pdf.save({useObjectStreams: true});
}

self.onmessage = async ({data}) => {
  try {
    const bytes = data.idSheet ? await buildIdSheet(data) : await buildPdf(data.images, data.options);
    self.postMessage({ok: true, bytes}, [bytes.buffer]);
  } catch (error) {
    self.postMessage({ok: false, error: String(error?.message || error)});
  }
};
