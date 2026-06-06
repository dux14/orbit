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

async function ensureDir(p) {
  await mkdir(p, { recursive: true });
}

async function plainIcon(size, outPath) {
  await sharp(SRC)
    .resize(size, size, { fit: "cover" })
    .png()
    .toFile(outPath);
  console.log(`✓ ${outPath} (${size}x${size})`);
}

async function maskableIcon(size, outPath) {
  // Safe zone 80%: icono al 80% centrado sobre fondo plum.
  const inner = Math.round(size * 0.8);
  const resized = await sharp(SRC)
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

  // PWA installable icons (manifest references /icons/*)
  await plainIcon(192, resolve(ROOT, "public/icons/icon-192.png"));
  await plainIcon(512, resolve(ROOT, "public/icons/icon-512.png"));
  await maskableIcon(512, resolve(ROOT, "public/icons/maskable-512.png"));

  // Next App Router conventions
  await plainIcon(180, resolve(ROOT, "app/apple-icon.png"));

  console.log("All icons generated.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
