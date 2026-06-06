# S3 — Aurora Logo: PWA Icons, Apple Icon, Favicon & OrbitLogo SVG Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Llevar la identidad visual de Orbit a la dirección "Aurora gradient": generar todos los iconos PWA + apple-icon + favicon desde el PNG 1024 de Higgsfield vía un script con `sharp`, actualizar el manifest con un `theme_color` plum oscuro coherente, y redibujar `OrbitLogo.tsx` como SVG con gradientes lineales periwinkle→rosa y halos en planetas manteniendo su API exacta.

**Architecture:** El asset fuente (PNG 1024, fondo plum oscuro) se descarga a `assets/brand/` (directorio NO público, fuera de `public/`, no servido). Un script Node ESM `scripts/generate-icons.mjs` usa `sharp` para producir `public/icons/icon-192.png`, `public/icons/icon-512.png` (convención existente del repo: el manifest ya apunta a `/icons/*`), `public/icons/maskable-512.png` (icono al 80% sobre fondo plum, safe zone), `app/apple-icon.png` (180×180) y `app/favicon.ico` multi-size. `app/icon.svg` se reescribe a mano en dirección aurora para el favicon vectorial que Next sirve. El manifest (`public/manifest.json`) recibe `theme_color`/`background_color` plum. `components/orbit/OrbitLogo.tsx` se reescribe como SVG con `linearGradient` periwinkle→rosa y halos blur en los planetas, fondo transparente, API `{ size=32, className }` intacta.

**Tech Stack:** Next.js 16.2.7 (App Router file conventions: `app/icon.svg`, `app/apple-icon.png`, `app/favicon.ico`; `next build --webpack`), React 19.2, `sharp` (devDependency, instalado con `pnpm add -D`), Node ESM scripts. Gestor: **pnpm** (nunca npm).

> **Nota de convención (importante):** el manifest actual (`public/manifest.json`) referencia los iconos en `public/icons/` (subdirectorio), NO en `public/` raíz. Este plan respeta esa convención existente y escribe en `public/icons/`. Los iconos de App Router (`app/icon.svg`, `app/apple-icon.png`, `app/favicon.ico`) los inyecta Next automáticamente en `<head>`; el `manifest.json` cubre los iconos instalables de PWA.

---

### Task 1: Descargar el asset fuente a `assets/brand/`

**Files:**
- Create: `assets/brand/orbit-aurora-1024.png` (descargado, NO público)
- Modify: `.gitignore` (asegurar que `assets/` queda fuera de git si se decide no versionar el raster; ver Step 3)

- [ ] **Step 1: Crear el directorio de assets fuente.**
  ```bash
  mkdir -p assets/brand
  ```
  Output esperado: directorio creado, sin salida.

- [ ] **Step 2: Descargar el PNG 1024 de Higgsfield.**
  ```bash
  curl -fSL \
    "https://d8j0ntlcm91z4.cloudfront.net/user_3EK4mLNGf3fRStE2J5aWcihPKiB/hf_20260606_165041_fefa9c95-aa24-4c75-8d51-417937773e0a.png" \
    -o assets/brand/orbit-aurora-1024.png
  ```
  Output esperado: descarga con código 200, archivo creado. Verificar:
  ```bash
  file assets/brand/orbit-aurora-1024.png
  ```
  Output esperado: `PNG image data, 1024 x 1024, 8-bit/color RGBA, non-interlaced` (o similar 1024×1024).

- [ ] **Step 3: Decidir versionado del raster fuente.**
  El raster fuente NO debe servirse públicamente. Mantenerlo en `assets/brand/` (fuera de `public/`). Versionarlo es aceptable (es la fuente de verdad de los iconos). Confirmar que `assets/` NO está ignorado si se quiere versionar:
  ```bash
  git check-ignore assets/brand/orbit-aurora-1024.png || echo "not ignored — will be tracked"
  ```
  Output esperado: `not ignored — will be tracked`. (Si apareciera ignorado, añadir excepción; por defecto no lo está.)

---

### Task 2: Instalar `sharp` y escribir `scripts/generate-icons.mjs`

**Files:**
- Modify: `package.json` (añade `sharp` a devDependencies vía CLI)
- Create: `scripts/generate-icons.mjs`

- [ ] **Step 1: Instalar sharp como devDependency.**
  ```bash
  pnpm add -D sharp
  ```
  Output esperado: `sharp` añadido a `devDependencies` en `package.json`, lockfile actualizado.

- [ ] **Step 2: Escribir el script de generación de iconos.**
  Crear `scripts/generate-icons.mjs` con el siguiente contenido completo. Plum oscuro de fondo de la maskable: `#1a1530` (coherente con el dark `--background` violet-slate del tema). El icono va al 80% centrado sobre ese fondo (safe zone maskable). Para los iconos no-maskable se usa el recorte directo del raster (su fondo plum ya forma parte del arte).
  ```js
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
  ```

- [ ] **Step 3: Añadir el script `icons` a `package.json`.**
  En `package.json`, dentro de `"scripts"`, añadir tras `"test:e2e": "playwright test"`:
  ```json
      "icons": "node scripts/generate-icons.mjs"
  ```
  (Recordar añadir la coma al final de la línea anterior.)

- [ ] **Step 4: Generar los iconos.**
  ```bash
  pnpm icons
  ```
  Output esperado: cinco líneas `✓ ...` (icon-192, icon-512, maskable-512, apple-icon 180) y `All icons generated.`

- [ ] **Step 5: Generar el favicon.ico multi-size.**
  Next sirve `app/favicon.ico` si existe. Generarlo desde el raster con sharp a 32×32 (ico no soportado directamente por sharp → generar PNG y convertir, o usar el icon.svg como favicon vectorial). Camino simple y robusto: dejar que Next genere el favicon desde `app/icon.svg` (Task 4) y NO crear `favicon.ico` manual. Verificar que no exista un `app/favicon.ico` legacy conflictivo:
  ```bash
  ls app/favicon.ico 2>/dev/null && echo "EXISTS — remove if legacy default" || echo "no favicon.ico — Next will use app/icon.svg"
  ```
  Output esperado: `no favicon.ico — Next will use app/icon.svg`.

- [ ] **Step 6: Commit.**
  ```bash
  git add package.json pnpm-lock.yaml scripts/generate-icons.mjs public/icons/ app/apple-icon.png assets/brand/orbit-aurora-1024.png
  git commit -m "feat(brand): aurora icon pipeline (sharp) — PWA icons + apple-icon from 1024 source"
  ```

---

### Task 3: Actualizar el manifest con theme_color plum

**Files:**
- Modify: `public/manifest.json` (líneas 7-8: `background_color`, `theme_color`)
- Modify: `app/layout.tsx` (viewport `themeColor` dark, línea 40)

- [ ] **Step 1: Actualizar background_color y theme_color del manifest.**
  En `public/manifest.json`, reemplazar las líneas 7-8:
  ```json
    "background_color": "#f7f5ff",
    "theme_color": "#c9b8ff",
  ```
  por:
  ```json
    "background_color": "#f8f6fe",
    "theme_color": "#1a1530",
  ```
  `theme_color` pasa a plum oscuro `#1a1530` (coherente con el fondo del asset aurora y el `--background` dark del tema). `background_color` se alinea al lavender-white del light theme (`#f8f6fe`, equivalente al `themeColor` light ya usado en `app/layout.tsx`).

- [ ] **Step 2: Alinear el themeColor dark del viewport con el plum del manifest.**
  En `app/layout.tsx`, línea 40, reemplazar:
  ```tsx
      { media: "(prefers-color-scheme: dark)", color: "#1e1a2e" },
  ```
  por:
  ```tsx
      { media: "(prefers-color-scheme: dark)", color: "#1a1530" },
  ```
  Así la barra de estado en dark coincide con el `theme_color` plum del manifest y el fondo del icono.

- [ ] **Step 3: Validar el manifest JSON.**
  ```bash
  node -e "JSON.parse(require('fs').readFileSync('public/manifest.json','utf8')); console.log('manifest valid JSON')"
  ```
  Output esperado: `manifest valid JSON`.

- [ ] **Step 4: Commit.**
  ```bash
  git add public/manifest.json app/layout.tsx
  git commit -m "feat(brand): plum theme_color (#1a1530) in manifest + dark viewport"
  ```

---

### Task 4: Reescribir `app/icon.svg` en dirección aurora (favicon vectorial)

**Files:**
- Modify: `app/icon.svg`

- [ ] **Step 1: Reescribir el favicon SVG con gradientes aurora.**
  Reemplazar todo el contenido de `app/icon.svg` por el siguiente. Fondo plum redondeado (el favicon necesita fondo propio porque se ve sobre pestañas), anillos con stroke de gradiente periwinkle→rosa, planetas con halo:
  ```svg
  <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100" role="img" aria-label="Orbit">
    <defs>
      <linearGradient id="aurora" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#a8b4ff"/>
        <stop offset="55%" stop-color="#c9a0ff"/>
        <stop offset="100%" stop-color="#ff9ecb"/>
      </linearGradient>
      <radialGradient id="bgPlum" cx="50%" cy="42%" r="75%">
        <stop offset="0%" stop-color="#241c40"/>
        <stop offset="100%" stop-color="#15102a"/>
      </radialGradient>
      <filter id="halo" x="-60%" y="-60%" width="220%" height="220%">
        <feGaussianBlur stdDeviation="1.6"/>
      </filter>
    </defs>
    <rect x="0" y="0" width="100" height="100" rx="22" fill="url(#bgPlum)"/>
    <!-- rings (aurora gradient stroke) -->
    <circle cx="50" cy="50" r="14" fill="none" stroke="url(#aurora)" stroke-width="1.4" stroke-opacity="0.9"/>
    <circle cx="50" cy="50" r="22" fill="none" stroke="url(#aurora)" stroke-width="1.1" stroke-opacity="0.7"/>
    <circle cx="50" cy="50" r="31" fill="none" stroke="url(#aurora)" stroke-width="0.9" stroke-opacity="0.5"/>
    <!-- planets with halo -->
    <circle cx="59.9" cy="59.9" r="5.5" fill="#ff9ecb" filter="url(#halo)" fill-opacity="0.55"/>
    <circle cx="59.9" cy="59.9" r="3.2" fill="#ffc4dd"/>
    <circle cx="39.0" cy="69.05" r="6.5" fill="#a8b4ff" filter="url(#halo)" fill-opacity="0.5"/>
    <circle cx="39.0" cy="69.05" r="3.8" fill="#c8d0ff"/>
    <circle cx="73.75" cy="30.07" r="5.5" fill="#c9a0ff" filter="url(#halo)" fill-opacity="0.5"/>
    <circle cx="73.75" cy="30.07" r="3.2" fill="#e0c8ff"/>
    <circle cx="29.33" cy="42.48" r="2.6" fill="#ff9ecb"/>
    <!-- core -->
    <circle cx="50" cy="50" r="7.5" fill="url(#aurora)" filter="url(#halo)" fill-opacity="0.6"/>
    <circle cx="50" cy="50" r="5" fill="#f3edff"/>
  </svg>
  ```

- [ ] **Step 2: Commit.**
  ```bash
  git add app/icon.svg
  git commit -m "feat(brand): redraw favicon SVG in aurora direction (gradient rings + halos)"
  ```

---

### Task 5: Redibujar `components/orbit/OrbitLogo.tsx` como SVG aurora

**Files:**
- Modify: `components/orbit/OrbitLogo.tsx` (reescritura completa, API `{ size=32, className }` intacta)

- [ ] **Step 1: Reescribir el componente con gradientes aurora, halos y fondo transparente.**
  Reemplazar todo el contenido de `components/orbit/OrbitLogo.tsx` por el siguiente. Mantiene la API exacta (`size`, `className`, `...rest`), fondo transparente (sin `rect`, a diferencia del favicon), anillos con stroke de gradiente lineal periwinkle→rosa, planetas con halo blur. Los `id` de gradiente/filtro se sufijan con `useId()` para no colisionar si hay varios logos en la página:
  ```tsx
  /**
   * OrbitLogo — the Orbit brand mark (Aurora direction).
   *
   * Motif: concentric orbital rings drawn with a periwinkle→rose aurora gradient,
   * pastel planet-dots with soft halos, transparent background. The raster icons
   * (public/icons/*) are generated separately from the Higgsfield source art.
   *
   * Props:
   *   size      — pixel dimension of the square viewport (default 32)
   *   className — extra Tailwind / CSS classes forwarded to the <svg>
   */

  import { useId, type SVGProps } from "react";

  interface OrbitLogoProps extends SVGProps<SVGSVGElement> {
    size?: number;
  }

  /** Ring radii (viewBox 0..100, center 50). */
  const RING_RADII = [14, 22, 31] as const;

  /** Planets: position + halo/core radii + tint. */
  const PLANETS = [
    { cx: 59.9, cy: 59.9, halo: 5.5, core: 3.2, haloFill: "#ff9ecb", coreFill: "#ffc4dd" },
    { cx: 39.0, cy: 69.05, halo: 6.5, core: 3.8, haloFill: "#a8b4ff", coreFill: "#c8d0ff" },
    { cx: 73.75, cy: 30.07, halo: 5.5, core: 3.2, haloFill: "#c9a0ff", coreFill: "#e0c8ff" },
    { cx: 57.52, cy: 29.33, halo: 4.2, core: 2.4, haloFill: "#ff9ecb", coreFill: "#ffd0e3" },
    { cx: 29.33, cy: 42.48, halo: 4.0, core: 2.3, haloFill: "#a8b4ff", coreFill: "#cdd4ff" },
  ] as const;

  export function OrbitLogo({ size = 32, className, ...rest }: OrbitLogoProps) {
    const uid = useId().replace(/:/g, "");
    const gradId = `orbitAurora-${uid}`;
    const haloId = `orbitHalo-${uid}`;

    return (
      <svg
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 100 100"
        width={size}
        height={size}
        aria-label="Orbit logo"
        role="img"
        className={className}
        {...rest}
      >
        <defs>
          <linearGradient id={gradId} x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#a8b4ff" />
            <stop offset="55%" stopColor="#c9a0ff" />
            <stop offset="100%" stopColor="#ff9ecb" />
          </linearGradient>
          <filter id={haloId} x="-60%" y="-60%" width="220%" height="220%">
            <feGaussianBlur stdDeviation="1.6" />
          </filter>
        </defs>

        {/* ── Orbital rings (aurora gradient stroke) ──────────────────── */}
        {RING_RADII.map((r, i) => (
          <circle
            key={`ring-${i}`}
            cx="50"
            cy="50"
            r={r}
            fill="none"
            stroke={`url(#${gradId})`}
            strokeWidth={i === 0 ? 1.4 : i === 1 ? 1.1 : 0.9}
            strokeOpacity={0.9 - i * 0.2}
          />
        ))}

        {/* ── Planets (halo + core) ───────────────────────────────────── */}
        {PLANETS.map((p, i) => (
          <g key={`planet-${i}`}>
            <circle
              cx={p.cx}
              cy={p.cy}
              r={p.halo}
              fill={p.haloFill}
              fillOpacity={0.5}
              filter={`url(#${haloId})`}
            />
            <circle cx={p.cx} cy={p.cy} r={p.core} fill={p.coreFill} />
          </g>
        ))}

        {/* ── Central core ────────────────────────────────────────────── */}
        <circle
          cx="50"
          cy="50"
          r="7.5"
          fill={`url(#${gradId})`}
          fillOpacity={0.6}
          filter={`url(#${haloId})`}
        />
        <circle cx="50" cy="50" r="5" fill="#f3edff" />
      </svg>
    );
  }

  export default OrbitLogo;
  ```

- [ ] **Step 2: Typecheck.**
  ```bash
  pnpm exec tsc --noEmit
  ```
  Output esperado: exit 0. La firma `{ size, className, ...rest }` y el export por defecto se mantienen → no rompe consumidores (`app/unlock/page.tsx`, `app/onboarding/page.tsx`).

- [ ] **Step 3: Commit.**
  ```bash
  git add components/orbit/OrbitLogo.tsx
  git commit -m "feat(brand): redraw OrbitLogo as aurora SVG (gradient rings + planet halos)"
  ```

---

### Task 6: Verificación (build, manifest, screenshot del logo)

**Files:**
- Create: `e2e/s03-aurora-brand.spec.ts` (verificación de manifest + screenshot del logo)

- [ ] **Step 1: Build verde.**
  ```bash
  pnpm build
  ```
  Output esperado: "Compiled successfully", sin errores. Confirma que el nuevo `OrbitLogo`, `app/icon.svg` y `app/apple-icon.png` se resuelven.

- [ ] **Step 2: Escribir el spec de verificación de marca.**
  Crear `e2e/s03-aurora-brand.spec.ts` con el contenido completo. Verifica que el manifest sirve el `theme_color` plum y captura un screenshot del logo en `/onboarding` (donde `OrbitLogo size={56}` es visible):
  ```ts
  import { test, expect } from "@playwright/test";

  test("manifest serves plum theme_color and valid icons", async ({ request }) => {
    const res = await request.get("/manifest.json");
    expect(res.ok()).toBeTruthy();
    const manifest = await res.json();
    expect(manifest.theme_color).toBe("#1a1530");
    expect(manifest.background_color).toBe("#f8f6fe");
    const purposes = manifest.icons.map((i: { src: string }) => i.src);
    expect(purposes).toContain("/icons/icon-192.png");
    expect(purposes).toContain("/icons/icon-512.png");
    expect(purposes).toContain("/icons/maskable-512.png");

    // Each referenced icon actually resolves.
    for (const src of purposes) {
      const iconRes = await request.get(src);
      expect(iconRes.ok(), `${src} should resolve`).toBeTruthy();
    }
  });

  test("aurora OrbitLogo renders and screenshot captured", async ({ page }) => {
    await page.goto("/onboarding");
    const logo = page.getByRole("img", { name: "Orbit logo" }).first();
    await expect(logo).toBeVisible();
    await logo.screenshot({ path: "e2e/__screenshots__/s03-orbit-logo.png" });
  });
  ```

- [ ] **Step 3: Correr el spec.**
  ```bash
  pnpm exec playwright test e2e/s03-aurora-brand.spec.ts
  ```
  Output esperado: 2 tests passed. El test de manifest confirma `theme_color` plum y que los tres iconos resuelven (200).

- [ ] **Step 4: Inspeccionar el screenshot del logo.**
  Abrir `e2e/__screenshots__/s03-orbit-logo.png`. Confirmar visualmente: anillos con gradiente periwinkle→rosa, planetas con halo, fondo transparente. Adjuntar al reporte de sesión.

- [ ] **Step 5: Commit.**
  ```bash
  git add e2e/s03-aurora-brand.spec.ts
  git commit -m "test(e2e): verify aurora manifest theme_color, icon resolution, and logo render"
  ```

---

### Task 7: Gates y cierre

**Files:**
- (sin nuevos archivos; verificación y commit final)

- [ ] **Step 1: `/impeccable audit` sobre el logo y los iconos.**
  Invocar la skill `impeccable` en modo audit sobre `/onboarding` y `/unlock` (cambio visual de marca: logo aurora + favicon + theme_color). Registrar hallazgos; resolver bloqueantes.

- [ ] **Step 2: Screenshot Playwright del cambio visual.**
  Confirmar que `e2e/__screenshots__/s03-orbit-logo.png` está adjunto como evidencia (requisito samu-flow para cambios de UI). Añadir, si es útil, un screenshot full-page de `/onboarding` mostrando el logo en contexto.

- [ ] **Step 3: Validación de la instalabilidad PWA.**
  Con la app servida (`pnpm start`), abrir Chrome DevTools → Application → Manifest y confirmar: theme_color `#1a1530`, los tres iconos (incluido maskable) cargan sin warning de "safe zone". Alternativamente, el test de Task 6 Step 3 ya cubre la resolución de iconos automáticamente.

- [ ] **Step 4: `/code-review` del diff completo de la sesión.**
  Invocar `/code-review` sobre el diff de S3 (script, componente, manifest, layout, icon.svg). Aplicar correcciones de alta confianza. Prestar atención a que `scripts/generate-icons.mjs` no introduzca rutas frágiles y a que el SVG no tenga `id` colisionables (resuelto con `useId`).

- [ ] **Step 5: Verificación de evidencia.**
  Confirmar en orden: `pnpm exec tsc --noEmit` (exit 0), `pnpm build` (verde), `pnpm exec playwright test e2e/s03-aurora-brand.spec.ts` (2 passed), screenshot del logo presente. No afirmar "completo" sin estos outputs.

- [ ] **Step 6: Commit final de cierre.**
  ```bash
  git add -A
  git commit -m "chore(s03): close aurora logo + icons session with gates green"
  ```

- [ ] **Step 7: Recordar `/compact`.**
  Tras el commit final, ejecutar `/compact` para cerrar la sesión dejando el plan como punto de retoma.
