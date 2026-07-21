/* Dependency-free PNG icon generator for LiquidFloodie.
   Smoothie-glass mark on a teal→lime gradient. */
import { writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "icons");
mkdirSync(dir, { recursive: true });

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const t = Buffer.from(type, "ascii");
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([t, data])), 0);
  return Buffer.concat([len, t, data, crc]);
}
function png(w, h, rgba) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    sig,
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
const hex = (h) => [
  parseInt(h.slice(1, 3), 16),
  parseInt(h.slice(3, 5), 16),
  parseInt(h.slice(5, 7), 16),
];
function roundedIn(x, y, x0, x1, y0, y1, r) {
  if (x >= x0 + r && x <= x1 - r) return true;
  if (y >= y0 + r && y <= y1 - r) return true;
  const cxs = [x0 + r, x1 - r],
    cys = [y0 + r, y1 - r];
  for (const cx of cxs)
    for (const cy of cys) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) return true;
  return false;
}
function draw(size, { pad = true } = {}) {
  const buf = Buffer.alloc(size * size * 4);
  const c1 = hex("#0d9488"),
    c2 = hex("#84cc16");
  const r = size * 0.22;
  const inset = pad ? size * 0.1 : 0;
  const cx = size / 2,
    cy = size / 2;
  for (let y = 0; y < size; y++)
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      const inside =
        x >= inset &&
        y >= inset &&
        x < size - inset &&
        y < size - inset &&
        roundedIn(x, y, inset, size - inset, inset, size - inset, r * (1 - (2 * inset) / size));
      if (!inside) {
        buf[i] = 15;
        buf[i + 1] = 23;
        buf[i + 2] = 32;
        buf[i + 3] = pad ? 0 : 255;
        continue;
      }
      const t = (x + y) / (2 * size);
      let rr = c1[0] + (c2[0] - c1[0]) * t;
      let gg = c1[1] + (c2[1] - c1[1]) * t;
      let bb = c1[2] + (c2[2] - c1[2]) * t;
      // glass body (ellipse)
      const gx = (x - cx) / (size * 0.18);
      const gy = (y - cy * 1.05) / (size * 0.28);
      const inGlass = gx * gx + gy * gy < 1 && y > cy * 0.55 && y < cy * 1.45;
      // liquid fill lower half of glass
      const inLiquid = inGlass && y > cy * 0.95;
      // straw
      const straw =
        Math.abs(x - cx - size * 0.08) < size * 0.02 &&
        y > cy * 0.35 &&
        y < cy * 1.1;
      if (straw) {
        rr = 255;
        gg = 255;
        bb = 255;
      } else if (inLiquid) {
        rr = 250;
        gg = 120;
        bb = 90;
      } else if (inGlass) {
        rr = 230;
        gg = 250;
        bb = 255;
      }
      buf[i] = rr;
      buf[i + 1] = gg;
      buf[i + 2] = bb;
      buf[i + 3] = 255;
    }
  return png(size, size, buf);
}

const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" role="img" aria-label="LiquidFloodie">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0d9488"/>
      <stop offset="100%" stop-color="#84cc16"/>
    </linearGradient>
  </defs>
  <rect width="128" height="128" rx="28" fill="url(#g)"/>
  <ellipse cx="64" cy="78" rx="22" ry="30" fill="#e6faff" opacity="0.95"/>
  <ellipse cx="64" cy="88" rx="18" ry="16" fill="#fa785a"/>
  <rect x="74" y="36" width="5" height="42" rx="2" fill="#fff" transform="rotate(12 76 57)"/>
  <circle cx="42" cy="40" r="4" fill="#fff" opacity="0.7"/>
  <circle cx="52" cy="32" r="3" fill="#fff" opacity="0.5"/>
</svg>`;

writeFileSync(join(dir, "icon.svg"), svg);
writeFileSync(join(dir, "icon-180.png"), draw(180, { pad: false }));
writeFileSync(join(dir, "icon-192.png"), draw(192, { pad: false }));
writeFileSync(join(dir, "icon-512.png"), draw(512, { pad: false }));
writeFileSync(join(dir, "icon-maskable-512.png"), draw(512, { pad: true }));
// splash-ish solid for PWA
writeFileSync(join(dir, "splash-512.png"), draw(512, { pad: false }));
console.log("icons written to", dir);
