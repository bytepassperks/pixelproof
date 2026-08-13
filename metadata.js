const textDecoder = new TextDecoder("latin1");
const textEncoder = new TextEncoder();

function readAscii(bytes, start, length) {
  return textDecoder.decode(bytes.subarray(start, start + length)).replace(/\0+$/, "");
}

function readValue(view, offset, type, count, little) {
  const sizes = {1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1};
  const size = sizes[type];
  if (!size || count > 64) return null;
  const total = size * count;
  const base = total <= 4 ? offset : view.getUint32(offset, little);
  if (base + total > view.byteLength) return null;
  const values = [];
  for (let index = 0; index < count; index++) {
    const at = base + index * size;
    if (type === 2 || type === 7) values.push(readAscii(new Uint8Array(view.buffer, view.byteOffset + at, size), 0, size));
    else if (type === 3) values.push(view.getUint16(at, little));
    else if (type === 4) values.push(view.getUint32(at, little));
    else if (type === 5) values.push(`${view.getUint32(at, little)}/${view.getUint32(at + 4, little)}`);
  }
  return values;
}

function parseTiff(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.byteLength < 8) return {};
  const endian = readAscii(bytes, 0, 2);
  if (endian !== "II" && endian !== "MM") return {};
  const little = endian === "II";
  if (view.getUint16(2, little) !== 42) return {};
  const base = view.getUint32(4, little);
  const names = {
    271: "cameraMake",
    272: "cameraModel",
    274: "orientation",
    282: "xResolution",
    283: "yResolution",
    305: "software",
    306: "dateTime",
    315: "artist",
    33432: "copyright",
    36867: "dateTimeOriginal",
    36868: "dateTimeDigitized",
    34853: "gpsOffset",
  };
  const result = {};
  const visited = new Set();
  function parseGps(offset) {
    if (offset + 2 > view.byteLength) return null;
    const gps = {};
    const count = view.getUint16(offset, little);
    for (let i = 0; i < count && offset + 2 + i * 12 + 12 <= view.byteLength; i++) {
      const entry = offset + 2 + i * 12;
      const tag = view.getUint16(entry, little);
      const type = view.getUint16(entry + 2, little);
      const valuesCount = view.getUint32(entry + 4, little);
      const value = readValue(view, entry + 8, type, valuesCount, little);
      if (tag === 1) gps.latRef = value?.[0]?.trim();
      if (tag === 2) gps.lat = value;
      if (tag === 3) gps.lonRef = value?.[0]?.trim();
      if (tag === 4) gps.lon = value;
    }
    const parseDms = (values) => values?.map((item) => {
      const [numerator, denominator] = item.split("/").map(Number);
      return denominator ? numerator / denominator : NaN;
    }).reduce((sum, number, index) => sum + number / (index === 0 ? 1 : index === 1 ? 60 : 3600), 0);
    if (!gps.lat || !gps.lon) return null;
    const latitude = parseDms(gps.lat);
    const longitude = parseDms(gps.lon);
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    return {
      latitude: `${gps.latRef === "S" ? "-" : ""}${latitude.toFixed(6)}`,
      longitude: `${gps.lonRef === "W" ? "-" : ""}${longitude.toFixed(6)}`,
    };
  }
  function ifd(offset, depth = 0) {
    if (depth > 2 || visited.has(offset) || offset + 2 > view.byteLength) return;
    visited.add(offset);
    const count = view.getUint16(offset, little);
    for (let i = 0; i < count && offset + 2 + i * 12 + 12 <= view.byteLength; i++) {
      const entry = offset + 2 + i * 12;
      const tag = view.getUint16(entry, little);
      const type = view.getUint16(entry + 2, little);
      const valuesCount = view.getUint32(entry + 4, little);
      const value = readValue(view, entry + 8, type, valuesCount, little);
      if (tag === 34853 && value?.[0]) {
        const coordinates = parseGps(Number(value[0]));
        if (coordinates) {
          result.gpsCoordinates = coordinates;
          result.gps = true;
        }
        ifd(Number(value[0]), depth + 1);
      } else if (names[tag] && value?.length) {
        result[names[tag]] = type === 3 || type === 4 ? value[0] : value.join("").trim();
      }
    }
    const nextAt = offset + 2 + count * 12;
    if (nextAt + 4 <= view.byteLength) {
      const next = view.getUint32(nextAt, little);
      if (next) ifd(next, depth);
    }
  }
  ifd(base);
  const gps = {};
  const gpsOffset = result.gpsOffset;
  delete result.gpsOffset;
  if (gpsOffset && Number.isFinite(Number(gpsOffset))) {
    // GPS IFD values are intentionally summarized from the raw offset. The
    // visible metadata report still flags GPS presence without inventing a
    // coordinate when a malformed maker segment is encountered.
    result.gps = "GPS coordinates present";
    result.gpsOffset = Number(gpsOffset);
  }
  return result;
}

export async function inspectMetadata(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const result = { format: file.type || "unknown", bytes: file.size, fields: {}, gps: false };
  if (file.type === "image/jpeg" || /\.jpe?g$/i.test(file.name)) {
    for (let offset = 2; offset + 4 < bytes.length && bytes[offset] === 0xff; ) {
      const marker = bytes[offset + 1];
      if (marker === 0xda || marker === 0xd9) break;
      const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
      if (length < 2 || offset + 2 + length > bytes.length) break;
      if (marker === 0xe1 && readAscii(bytes, offset + 4, 4) === "Exif") {
        const parsed = parseTiff(bytes.subarray(offset + 10, offset + 2 + length));
        if (parsed.gps) result.gps = true;
        if (parsed.gpsCoordinates) result.gpsCoordinates = parsed.gpsCoordinates;
        delete parsed.gpsOffset;
        result.fields = {...result.fields, ...parsed};
      }
      offset += 2 + length;
    }
  }
  result.fieldCount = Object.keys(result.fields).length + (result.gps ? 1 : 0);
  return result;
}

export async function inspectColorInfo(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const info = {bitDepth: 8, embeddedProfile: false};
  if (bytes[0] === 0x89 && readAscii(bytes, 1, 3) === "PNG" && bytes.length >= 26) {
    info.bitDepth = bytes[24];
    for (let offset = 8; offset + 12 <= bytes.length; ) {
      const length = new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0);
      const type = readAscii(bytes, offset + 4, 4);
      if (type === "iCCP") info.embeddedProfile = true;
      offset += 12 + length;
      if (type === "IEND") break;
    }
  } else if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    for (let offset = 2; offset + 4 <= bytes.length && bytes[offset] === 0xff; ) {
      const marker = bytes[offset + 1];
      if (marker === 0xda || marker === 0xd9) break;
      const length = (bytes[offset + 2] << 8) | bytes[offset + 3];
      if (length < 2 || offset + 2 + length > bytes.length) break;
      if (marker === 0xe2 && readAscii(bytes, offset + 4, 11) === "ICC_PROFILE") info.embeddedProfile = true;
      offset += 2 + length;
    }
  }
  return info;
}

function putAscii(bytes, offset, value) {
  bytes.set(textEncoder.encode(`${value}\0`), offset);
}

export function buildPreservedExif(metadata = {}) {
  const entries = [];
  if (metadata.orientation) entries.push({tag: 274, type: 3, count: 1, value: Number(metadata.orientation)});
  if (metadata.copyright) entries.push({tag: 33432, type: 2, text: metadata.copyright});
  if (!entries.length) return null;
  const copyright = entries.find((entry) => entry.text);
  const header = 8;
  const ifd = header + 2 + entries.length * 12 + 4;
  const textLength = copyright ? `${copyright.text}\0`.length : 0;
  const textAt = ifd;
  const bytes = new Uint8Array(textAt + textLength);
  bytes.set([0x49, 0x49, 0x2a, 0, 8, 0, 0, 0], 0);
  const view = new DataView(bytes.buffer);
  view.setUint16(header, entries.length, true);
  entries.forEach((entry, index) => {
    const at = header + 2 + index * 12;
    view.setUint16(at, entry.tag, true);
    view.setUint16(at + 2, entry.type, true);
    view.setUint32(at + 4, entry.text ? `${entry.text}\0`.length : (entry.count || 1), true);
    if (entry.text) {
      view.setUint32(at + 8, textAt, true);
      putAscii(bytes, textAt, entry.text);
    } else view.setUint16(at + 8, entry.value, true);
  });
  return new Uint8Array(bytes);
}

export function injectJpegExif(jpegBuffer, metadata) {
  const exif = buildPreservedExif(metadata);
  if (!exif) return jpegBuffer;
  const payload = new Uint8Array(6 + exif.length);
  payload.set([0x45, 0x78, 0x69, 0x66, 0, 0], 0);
  payload.set(exif, 6);
  if (payload.length > 65533) return jpegBuffer;
  const segmentLength = payload.length + 2;
  const segment = new Uint8Array(2 + segmentLength);
  segment.set([0xff, 0xe1, segmentLength >> 8, segmentLength & 255], 0);
  segment.set(payload, 4);
  const source = new Uint8Array(jpegBuffer);
  if (source[0] !== 0xff || source[1] !== 0xd8) return jpegBuffer;
  const output = new Uint8Array(source.length + segment.length);
  output.set(source.subarray(0, 2), 0);
  output.set(segment, 2);
  output.set(source.subarray(2), 2 + segment.length);
  return output.buffer;
}
