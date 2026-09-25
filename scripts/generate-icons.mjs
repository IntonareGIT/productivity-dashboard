// Generates the PWA icons (public/pwa-192x192.png, public/pwa-512x512.png).
// Dependency-free PNG encoder using Node's built-in zlib.
// Run: node scripts/generate-icons.mjs
import zlib from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// --- CRC32 (required for PNG chunks) ---
const CRC_TABLE = new Uint32Array(256);
for (let n = 0; n < 256; n++) {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[n] = c >>> 0;
}
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeBuf = Buffer.from(type, 'ascii');
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

// --- Drawing helpers ---
const BG = [79, 70, 229];      // indigo-600
const FG = [255, 255, 255];    // white "P"

function inRect(x, y, x0, y0, x1, y1) {
  return x >= x0 && x < x1 && y >= y0 && y < y1;
}

// Simple "P" glyph: stem + bowl with a punched-out counter.
function isForeground(x, y, s) {
  const stem = inRect(x, y, 0.30 * s, 0.20 * s, 0.42 * s, 0.80 * s);
  const bowl = inRect(x, y, 0.30 * s, 0.20 * s, 0.70 * s, 0.52 * s);
  const hole = inRect(x, y, 0.42 * s, 0.30 * s, 0.58 * s, 0.42 * s);
  return (stem || bowl) && !hole;
}

function generateIcon(size, filePath) {
  const raw = Buffer.alloc(size * (1 + size * 4)); // filter byte + RGBA per pixel
  let o = 0;
  for (let y = 0; y < size; y++) {
    raw[o++] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      const [r, g, b] = isForeground(x, y, size) ? FG : BG;
      raw[o++] = r;
      raw[o++] = g;
      raw[o++] = b;
      raw[o++] = 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // color type RGBA
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
  writeFileSync(filePath, png);
  console.log(`Wrote ${filePath} (${png.length} bytes)`);
}

const publicDir = join(__dirname, '..', 'public');
mkdirSync(publicDir, { recursive: true });
generateIcon(192, join(publicDir, 'pwa-192x192.png'));
generateIcon(512, join(publicDir, 'pwa-512x512.png'));
