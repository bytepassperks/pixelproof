const encoder = new TextEncoder();
function crc32(bytes) {
  let crc = -1;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ (0xedb88320 & -(crc & 1));
  }
  return (crc ^ -1) >>> 0;
}
function u16(n) { return new Uint8Array([n & 255, n >>> 8]); }
function u32(n) { return new Uint8Array([n & 255, n >>> 8, n >>> 16, n >>> 24]); }
function concat(parts) {
  const length = parts.reduce((n, part) => n + part.length, 0);
  const out = new Uint8Array(length); let offset = 0;
  for (const part of parts) { out.set(part, offset); offset += part.length; }
  return out;
}
async function deflate(bytes) {
  if (!('CompressionStream' in self)) return bytes;
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
export async function downloadZip(entries, filename = 'pixelproof-results.zip') {
  const local = [], central = []; let offset = 0;
  for (const entry of entries) {
    const name = encoder.encode(entry.name), raw = new Uint8Array(entry.bytes);
    const compressed = await deflate(raw), method = compressed.length < raw.length ? 8 : 0;
    const payload = method ? compressed : raw, crc = crc32(raw);
    const header = concat([u32(0x04034b50), u16(20), u16(0), u16(method), u16(0),
      u16(0), u32(crc), u32(payload.length), u32(raw.length), u16(name.length), u16(0), name]);
    local.push(header, payload);
    central.push(concat([u32(0x02014b50), u16(20), u16(20), u16(0), u16(method), u16(0),
      u16(0), u32(crc), u32(payload.length), u32(raw.length), u16(name.length), u16(0),
      u16(0), u16(0), u16(0), u32(0), u32(offset), name]));
    offset += header.length + payload.length;
  }
  const centralBytes = concat(central);
  const end = concat([u32(0x06054b50), u16(0), u16(0), u16(entries.length), u16(entries.length),
    u32(centralBytes.length), u32(offset), u16(0)]);
  const blob = new Blob([concat([...local, centralBytes, end])], {type: 'application/zip'});
  const url = URL.createObjectURL(blob), a = document.createElement('a');
  a.href = url; a.download = filename; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
}
