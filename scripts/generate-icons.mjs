// scripts/generate-icons.mjs
// Genera todos los iconos de Orbit desde el raster fuente Aurora.
// Uso: pnpm icons
import sharp from "sharp";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const SRC = resolve(ROOT, "assets/brand/orbit-aurora-1024.png");

/** Plum oscuro de marca — coherente con el dark --background del tema. */
const PLUM = "#1a1530";
const PLUM_RGB = [0x1a, 0x15, 0x30];

async function ensureDir(p) {
  await mkdir(p, { recursive: true });
}

/**
 * El raster fuente es un squircle sobre fondo BLANCO OPACO (sin alfa). Usado
 * tal cual como apple-touch-icon, iOS aplica su propia máscara de esquinas y
 * deja ver ese blanco como un borde. Aquí hacemos flood-fill del fondo blanco
 * conectado a los bordes y lo reemplazamos por plum de marca, preservando los
 * brillos blancos internos del arte (no conectados al borde). El resultado es
 * un icono full-bleed sin borde blanco.
 */
async function plumFilledSource() {
  const { data, info } = await sharp(SRC)
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const { width, height, channels } = info;

  const isWhite = (i) => data[i] >= 245 && data[i + 1] >= 245 && data[i + 2] >= 245;
  const visited = new Uint8Array(width * height);
  const stack = [];
  const push = (x, y) => {
    if (x < 0 || x >= width || y < 0 || y >= height) return;
    const p = y * width + x;
    if (!visited[p]) {
      visited[p] = 1;
      stack.push(p);
    }
  };

  for (let x = 0; x < width; x++) {
    push(x, 0);
    push(x, height - 1);
  }
  for (let y = 0; y < height; y++) {
    push(0, y);
    push(width - 1, y);
  }

  while (stack.length) {
    const p = stack.pop();
    const i = p * channels;
    if (!isWhite(i)) continue; // borde del squircle → no expandir
    data[i] = PLUM_RGB[0];
    data[i + 1] = PLUM_RGB[1];
    data[i + 2] = PLUM_RGB[2];
    data[i + 3] = 255;
    const x = p % width;
    const y = (p / width) | 0;
    push(x + 1, y);
    push(x - 1, y);
    push(x, y + 1);
    push(x, y - 1);
  }

  return { buffer: Buffer.from(data), width, height, channels };
}

function fromRaw(src) {
  return sharp(src.buffer, {
    raw: { width: src.width, height: src.height, channels: src.channels },
  });
}

async function plainIcon(src, size, outPath) {
  await fromRaw(src)
    .resize(size, size, { fit: "cover" })
    .flatten({ background: PLUM })
    .png()
    .toFile(outPath);
  console.log(`✓ ${outPath} (${size}x${size})`);
}

async function maskableIcon(src, size, outPath) {
  // Safe zone 80%: icono al 80% centrado sobre fondo plum.
  const inner = Math.round(size * 0.8);
  const resized = await fromRaw(src)
    .resize(inner, inner, { fit: "cover" })
    .png()
    .toBuffer();
  const offset = Math.round((size - inner) / 2);
  await sharp({
    create: {
      width: size,
      height: size,
      channels: 4,
      background: PLUM,
    },
  })
    .composite([{ input: resized, top: offset, left: offset }])
    .png()
    .toFile(outPath);
  console.log(`✓ ${outPath} (maskable ${size}x${size}, 80% safe zone)`);
}

async function main() {
  await ensureDir(resolve(ROOT, "public/icons"));

  const src = await plumFilledSource();

  // PWA installable icons (manifest references /icons/*)
  await plainIcon(src, 192, resolve(ROOT, "public/icons/icon-192.png"));
  await plainIcon(src, 512, resolve(ROOT, "public/icons/icon-512.png"));
  await maskableIcon(src, 512, resolve(ROOT, "public/icons/maskable-512.png"));

  // Next App Router conventions
  await plainIcon(src, 180, resolve(ROOT, "app/apple-icon.png"));

  console.log("All icons generated.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
