/**
 * generate-icons.mjs
 * Renders the Orbit SVG logo to PNG icons required by the PWA manifest.
 *
 * Outputs:
 *   public/icons/icon-192.png      — 192×192, transparent background
 *   public/icons/icon-512.png      — 512×512, transparent background
 *   public/icons/maskable-512.png  — 512×512, solid pastel background,
 *                                    logo within the 80% safe zone (~410px)
 *
 * Run: node scripts/generate-icons.mjs   (from orbit/ directory)
 */

import sharp from '/home/samu/code/personal/Mark-IV-Ach/orbit/node_modules/.pnpm/sharp@0.34.5/node_modules/sharp/lib/index.js';
import { writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');
const ICONS_DIR = path.join(ROOT, 'public', 'icons');

mkdirSync(ICONS_DIR, { recursive: true });

// ── Brand colours ────────────────────────────────────────────────────────────
const BG_LIGHT = '#f7f5ff';   // lavender-white background (maskable fill)
const RING_COLOR = '#c9b8ff'; // periwinkle ring stroke

// ── Planet arrangement ───────────────────────────────────────────────────────
// Same as OrbitLogo.tsx — ring radii as fractions of half the 100-unit viewBox.
const RING_RADII = [14, 22, 31];
const PLANETS = [
  { ring: 0, angle: 45,  r: 3.5, fill: '#f4a0b0' },
  { ring: 0, angle: 225, r: 3,   fill: '#a0d4f4' },
  { ring: 1, angle: 120, r: 4.5, fill: '#b8f0c8' },
  { ring: 1, angle: 290, r: 3.5, fill: '#ffd6a0' },
  { ring: 1, angle: 200, r: 3,   fill: '#d4b8f0' },
  { ring: 2, angle: 60,  r: 5,   fill: '#f4c0a0' },
  { ring: 2, angle: 165, r: 3.5, fill: '#a0e8d8' },
  { ring: 2, angle: 320, r: 4,   fill: '#f0b8d4' },
];

function toRad(deg) { return (deg * Math.PI) / 180; }

/**
 * Build the SVG markup for the Orbit logo mark.
 * @param {number} vb  — viewBox size (square, e.g. 100 for normal, 125 for maskable safe-zone)
 * @param {string} bgFill — 'none' or a hex colour for the background rect
 */
function buildSVG(vb = 100, bgFill = 'none') {
  const cx = vb / 2;
  const cy = vb / 2;
  // Scale ring radii proportionally if we enlarged the viewBox
  const scale = vb / 100;

  const rings = RING_RADII.map((r, i) => {
    const scaled = r * scale;
    const opacity = 0.55 - i * 0.08;
    const sw = (i === 0 ? 1.2 : i === 1 ? 1.0 : 0.85) * scale;
    return `<circle cx="${cx}" cy="${cy}" r="${scaled}" fill="none"
      stroke="${RING_COLOR}" stroke-width="${sw}" stroke-opacity="${opacity}"/>`;
  }).join('\n  ');

  const planets = PLANETS.map((p) => {
    const rRing = RING_RADII[p.ring] * scale;
    const rad = toRad(p.angle);
    const pcx = cx + rRing * Math.cos(rad);
    const pcy = cy + rRing * Math.sin(rad);
    const pr = p.r * scale;
    return `<circle cx="${pcx.toFixed(3)}" cy="${pcy.toFixed(3)}" r="${pr}" fill="${p.fill}" fill-opacity="0.92"/>`;
  }).join('\n  ');

  const coreR = 6.5 * scale;
  const hlR  = 2.2 * scale;
  const hlCx = cx - 2 * scale;
  const hlCy = cy - 2.5 * scale;

  const bgRect = bgFill !== 'none'
    ? `<rect width="${vb}" height="${vb}" fill="${bgFill}"/>`
    : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${vb} ${vb}" width="${vb}" height="${vb}">
  <defs>
    <radialGradient id="coreGrad" cx="50%" cy="40%" r="60%">
      <stop offset="0%" stop-color="#e8d8ff"/>
      <stop offset="100%" stop-color="${RING_COLOR}"/>
    </radialGradient>
  </defs>
  ${bgRect}
  ${rings}
  ${planets}
  <circle cx="${cx}" cy="${cy}" r="${coreR}" fill="url(#coreGrad)"/>
  <circle cx="${hlCx}" cy="${hlCy}" r="${hlR}" fill="white" fill-opacity="0.45"/>
</svg>`;
}

// ── Render helpers ────────────────────────────────────────────────────────────

async function renderIcon(svgString, sizePx, outPath) {
  const buf = Buffer.from(svgString);
  await sharp(buf, { density: 300 })
    .resize(sizePx, sizePx)
    .png()
    .toFile(outPath);

  const meta = await sharp(outPath).metadata();
  console.log(`  ✓ ${path.basename(outPath)} — ${meta.width}×${meta.height} px`);
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('Generating Orbit PWA icons...\n');

  // 192×192 — standard, transparent background
  await renderIcon(
    buildSVG(100, 'none'),
    192,
    path.join(ICONS_DIR, 'icon-192.png'),
  );

  // 512×512 — standard, transparent background
  await renderIcon(
    buildSVG(100, 'none'),
    512,
    path.join(ICONS_DIR, 'icon-512.png'),
  );

  // maskable-512 — solid bg, logo fits within 80% safe zone
  // Strategy: enlarge viewBox to 125 so the 100-unit mark sits inside 100/125 = 80% of the canvas.
  await renderIcon(
    buildSVG(125, BG_LIGHT),
    512,
    path.join(ICONS_DIR, 'maskable-512.png'),
  );

  console.log('\nAll icons written to public/icons/');
}

main().catch((err) => { console.error(err); process.exit(1); });
