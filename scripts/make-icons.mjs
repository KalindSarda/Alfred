// Generates Alfred's icons without any image library: a shaded blue orb with a soft glow on navy.
// Run once: node scripts/make-icons.mjs   (outputs are committed in web/public)
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const byte of buf) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const out = Buffer.alloc(body.length + 8);
  out.writeUInt32BE(data.length, 0);
  body.copy(out, 4);
  out.writeUInt32BE(crc32(body), body.length + 4);
  return out;
}

const NAVY = [16, 26, 46];
const BLUE = [43, 108, 222];
const DEEP = [22, 50, 122];
const GLOW = [60, 120, 235];

const mix = (a, b, t) => a.map((v, i) => v + (b[i] - v) * t);
const clamp = (v, lo = 0, hi = 1) => Math.min(hi, Math.max(lo, v));

/** Colour of one pixel: navy background, a halo around the orb, then a lit sphere with a specular highlight. */
function pixel(x, y, size, radius) {
  const dx = (x + 0.5) / size - 0.5;
  const dy = (y + 0.5) / size - 0.5;
  const d = Math.hypot(dx, dy);

  // Halo: soft blue light falling off outside the sphere.
  const halo = d > radius ? Math.exp(-(((d - radius) / 0.1) ** 2)) * 0.55 : 0;
  let color = mix(NAVY, GLOW, halo);

  // Sphere with antialiased edge.
  const coverage = clamp((radius - d) * size + 0.5);
  if (coverage > 0) {
    const nx = dx / radius;
    const ny = dy / radius;
    const nz = Math.sqrt(clamp(1 - nx * nx - ny * ny));
    const light = [-0.35, -0.42, 0.84];
    const diffuse = clamp(nx * light[0] + ny * light[1] + nz * light[2]);
    let sphere = mix(DEEP, BLUE, clamp(diffuse * 1.15));
    const half = [light[0], light[1], light[2] + 1];
    const hl = Math.hypot(...half);
    const spec = clamp((nx * half[0] + ny * half[1] + nz * half[2]) / hl) ** 36;
    sphere = mix(sphere, [235, 244, 255], spec * 0.75);
    color = mix(color, sphere, coverage);
  }
  return color.map((v) => Math.round(clamp(v, 0, 255)));
}

function png(size, radius) {
  const rows = [];
  for (let y = 0; y < size; y++) {
    const row = Buffer.alloc(1 + size * 3);
    for (let x = 0; x < size; x++) {
      const [r, g, b] = pixel(x, y, size, radius);
      row[1 + x * 3] = r;
      row[2 + x * 3] = g;
      row[3 + x * 3] = b;
    }
    rows.push(row);
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

mkdirSync("web/public", { recursive: true });
for (const [name, size, radius] of [
  ["icon-192.png", 192, 0.27],
  ["icon-512.png", 512, 0.27], // also the Telegram bot's profile picture
  ["apple-touch-icon.png", 180, 0.27],
  ["favicon-32.png", 32, 0.36],
]) {
  writeFileSync(`web/public/${name}`, png(size, radius));
  console.log(`wrote web/public/${name}`);
}

// The browser-tab icon is vector so it stays crisp at any size: the orb alone on a transparent background.
writeFileSync(
  "web/public/favicon.svg",
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">
  <defs>
    <radialGradient id="orb" cx="36%" cy="30%" r="78%">
      <stop offset="0" stop-color="#9cc2ff"/>
      <stop offset="0.45" stop-color="#2b6cde"/>
      <stop offset="1" stop-color="#16327a"/>
    </radialGradient>
  </defs>
  <circle cx="32" cy="32" r="30" fill="url(#orb)"/>
  <ellipse cx="24" cy="20" rx="8" ry="5" fill="#ffffff" opacity="0.35" transform="rotate(-25 24 20)"/>
</svg>
`,
);
console.log("wrote web/public/favicon.svg");
