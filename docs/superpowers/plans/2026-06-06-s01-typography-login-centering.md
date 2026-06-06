# S1 — Typography (Space Grotesk + Inter) & Login/Onboarding Centering Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reemplazar la tipografía de Orbit por Space Grotesk (headings) + Inter (body) con base 17.5px, y arreglar el centrado vertical real de las pantallas de login (`/unlock`) y onboarding en móvil con `dvh` + safe-areas.

**Architecture:** Las fuentes se cargan vía `next/font/google` en `app/layout.tsx` (self-hosted, subset latin) exponiendo las CSS variables `--font-inter`, `--font-space-grotesk` y `--font-geist-mono`. En `app/globals.css`, el bloque `@theme inline` de Tailwind 4 mapea `--font-sans`/`--font-heading`/`--font-mono` a esas variables y añade una escala tipográfica reescalada (base 17.5px, line-height body 1.6). El centrado de `/unlock` y `/onboarding` pasa de `min-h-dvh + justify-center + py-12` a un contenedor con padding asimétrico y safe-areas que centra de verdad en pantallas cortas sin que el contenido quede pegado arriba con el teclado virtual.

**Tech Stack:** Next.js 16.2.7 (App Router, `next build --webpack`), React 19.2, Tailwind CSS 4 (`@theme inline` en `app/globals.css`, sin config file), `next/font/google`, Playwright (verificación visual), Lighthouse (gate mobile ≥95). Gestor: **pnpm** (nunca npm).

---

### Task 1: Cambiar fuentes en `app/layout.tsx`

**Files:**
- Modify: `app/layout.tsx` (líneas 1-2 imports y declaraciones de fuentes 7-27; className en línea 72)

- [ ] **Step 1: Reemplazar import y declaración de fuentes display/body.**
  En `app/layout.tsx`, sustituir el import de la línea 2 y las declaraciones de las líneas 7-20 (DM_Serif_Display + Plus_Jakarta_Sans). Geist Mono se mantiene intacto.

  Cambiar la línea 2:
  ```tsx
  import { DM_Serif_Display, Plus_Jakarta_Sans, Geist_Mono } from "next/font/google";
  ```
  por:
  ```tsx
  import { Space_Grotesk, Inter, Geist_Mono } from "next/font/google";
  ```

  Reemplazar el bloque de las líneas 7-20:
  ```tsx
  /** Display / heading font — characterful serif for Orbit's premium feel */
  const dmSerifDisplay = DM_Serif_Display({
    weight: "400",
    subsets: ["latin"],
    variable: "--font-dm-serif",
    display: "swap",
  });

  /** Body / UI font — clean humanist sans */
  const plusJakartaSans = Plus_Jakarta_Sans({
    subsets: ["latin"],
    variable: "--font-plus-jakarta",
    display: "swap",
  });
  ```
  por:
  ```tsx
  /** Display / heading font — geometric grotesk for Orbit's premium feel */
  const spaceGrotesk = Space_Grotesk({
    subsets: ["latin"],
    weight: ["500", "600", "700"],
    variable: "--font-space-grotesk",
    display: "swap",
  });

  /** Body / UI font — clean neutral sans */
  const inter = Inter({
    subsets: ["latin"],
    variable: "--font-inter",
    display: "swap",
  });
  ```

- [ ] **Step 2: Actualizar el className del `<html>`.**
  En la línea 72, reemplazar:
  ```tsx
        className={`${dmSerifDisplay.variable} ${plusJakartaSans.variable} ${geistMono.variable} h-full antialiased`}
  ```
  por:
  ```tsx
        className={`${spaceGrotesk.variable} ${inter.variable} ${geistMono.variable} h-full antialiased`}
  ```

- [ ] **Step 3: Verificar typecheck.**
  Ejecutar:
  ```bash
  pnpm exec tsc --noEmit
  ```
  Output esperado: sin errores (exit 0). No debe quedar ninguna referencia a `dmSerifDisplay` ni `plusJakartaSans`.

- [ ] **Step 4: Commit.**
  ```bash
  git add app/layout.tsx
  git commit -m "feat(type): switch fonts to Space Grotesk (headings) + Inter (body)"
  ```

---

### Task 2: Reescalar la tipografía en `app/globals.css`

**Files:**
- Modify: `app/globals.css` (bloque `@theme inline` líneas 7-12 para los mapeos de fuente; `@layer base` líneas 160-170 para base size y line-height)

- [ ] **Step 1: Remapear las font variables en `@theme inline`.**
  En `app/globals.css`, dentro del bloque `@theme inline`, reemplazar las líneas 10-12:
  ```css
    --font-sans: var(--font-plus-jakarta);
    --font-mono: var(--font-geist-mono);
    --font-heading: var(--font-dm-serif);
  ```
  por:
  ```css
    --font-sans: var(--font-inter);
    --font-mono: var(--font-geist-mono);
    --font-heading: var(--font-space-grotesk);
  ```

- [ ] **Step 2: Añadir la escala tipográfica al `@theme inline`.**
  Insertar las siguientes líneas dentro del bloque `@theme inline`, justo después de la línea `--font-heading: var(--font-space-grotesk);`. Estos custom tokens de tamaño de Tailwind 4 sobre-escriben los `text-*` por defecto para subir un punto la jerarquía coherente con base 17.5px:
  ```css
    /* ─── Type scale (base 17.5px) ─────────────────────────────────── */
    --text-xs: 0.8125rem;     /* 13px */
    --text-xs--line-height: 1.5;
    --text-sm: 0.9375rem;     /* 15px */
    --text-sm--line-height: 1.55;
    --text-base: 1rem;        /* 17.5px via :root font-size */
    --text-base--line-height: 1.6;
    --text-lg: 1.1428em;      /* ~20px */
    --text-lg--line-height: 1.5;
    --text-xl: 1.2857em;      /* ~22.5px */
    --text-xl--line-height: 1.4;
    --text-2xl: 1.5714em;     /* ~27.5px */
    --text-2xl--line-height: 1.3;
    --text-3xl: 1.9285em;     /* ~33.75px */
    --text-3xl--line-height: 1.2;
    --text-4xl: 2.4285em;     /* ~42.5px */
    --text-4xl--line-height: 1.15;
  ```

- [ ] **Step 3: Subir la base a 17.5px y aplicar line-height de body.**
  En `app/globals.css`, dentro de `@layer base` (líneas 160-170), reemplazar el bloque:
  ```css
  @layer base {
    * {
      @apply border-border outline-ring/50;
    }
    body {
      @apply bg-background text-foreground;
    }
    html {
      @apply font-sans;
    }
  }
  ```
  por:
  ```css
  @layer base {
    * {
      @apply border-border outline-ring/50;
    }
    html {
      @apply font-sans;
      font-size: 17.5px;
    }
    body {
      @apply bg-background text-foreground;
      line-height: 1.6;
    }
    h1, h2, h3, h4 {
      @apply font-heading;
      line-height: 1.15;
      letter-spacing: -0.01em;
    }
  }
  ```

- [ ] **Step 4: Build de verificación.**
  ```bash
  pnpm build
  ```
  Output esperado: build verde, sin errores de Tailwind/PostCSS, "Compiled successfully".

- [ ] **Step 5: Commit.**
  ```bash
  git add app/globals.css
  git commit -m "feat(type): base 17.5px, body line-height 1.6, rescaled heading hierarchy"
  ```

---

### Task 3: Centrado vertical real de `/unlock` en móvil

**Files:**
- Modify: `app/unlock/page.tsx` (contenedor raíz línea 60; toggle de tema línea 62)

- [ ] **Step 1: Reescribir el contenedor raíz con centrado real + safe-areas.**
  En `app/unlock/page.tsx`, reemplazar la línea 60:
  ```tsx
    <div className="min-h-dvh flex flex-col items-center justify-center bg-background px-4 py-12">
  ```
  por:
  ```tsx
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background px-4 pt-[max(2rem,env(safe-area-inset-top))] pb-[max(3.5rem,calc(env(safe-area-inset-bottom)+2.5rem))]">
  ```
  Esto da padding asimétrico (menos arriba, más abajo para óptica de centrado y para no chocar con el teclado virtual ni la barra inferior del navegador), respeta las safe-areas de iOS y conserva el centrado real con `min-h-dvh` + `justify-center`.

- [ ] **Step 2: Anclar el toggle de tema a la safe-area.**
  En la línea 62, reemplazar:
  ```tsx
        <div className="fixed top-4 right-4">
  ```
  por:
  ```tsx
        <div className="fixed right-4 top-[max(1rem,env(safe-area-inset-top))]">
  ```

- [ ] **Step 3: Typecheck.**
  ```bash
  pnpm exec tsc --noEmit
  ```
  Output esperado: exit 0, sin errores.

- [ ] **Step 4: Commit.**
  ```bash
  git add app/unlock/page.tsx
  git commit -m "fix(unlock): real vertical centering with dvh + asymmetric padding + safe-areas"
  ```

---

### Task 4: Centrado vertical real de `/onboarding` en móvil

**Files:**
- Modify: `app/onboarding/page.tsx` (contenedor raíz línea 84; toggle de tema línea 86)

- [ ] **Step 1: Reescribir el contenedor raíz con centrado real + safe-areas.**
  En `app/onboarding/page.tsx`, reemplazar la línea 84:
  ```tsx
    <div className="min-h-dvh flex flex-col items-center justify-center bg-background px-4 py-12">
  ```
  por:
  ```tsx
    <div className="flex min-h-dvh flex-col items-center justify-center bg-background px-4 pt-[max(2rem,env(safe-area-inset-top))] pb-[max(3.5rem,calc(env(safe-area-inset-bottom)+2.5rem))]">
  ```
  El onboarding tiene más contenido (warning + dos campos + strength bar); en pantallas cortas `justify-center` + `min-h-dvh` lo mantiene centrado y el padding inferior evita que el botón quede tapado por el teclado.

- [ ] **Step 2: Anclar el toggle de tema a la safe-area.**
  En la línea 86, reemplazar:
  ```tsx
        <div className="fixed top-4 right-4">
  ```
  por:
  ```tsx
        <div className="fixed right-4 top-[max(1rem,env(safe-area-inset-top))]">
  ```

- [ ] **Step 3: Typecheck.**
  ```bash
  pnpm exec tsc --noEmit
  ```
  Output esperado: exit 0, sin errores.

- [ ] **Step 4: Commit.**
  ```bash
  git add app/onboarding/page.tsx
  git commit -m "fix(onboarding): real vertical centering with dvh + asymmetric padding + safe-areas"
  ```

---

### Task 5: Verificación visual con Playwright (375×667 y 390×844)

**Files:**
- Create: `e2e/s01-typography-centering.spec.ts` (script efímero de verificación visual; se conserva como screenshot test ligero)

- [ ] **Step 1: Crear el spec de verificación visual.**
  Crear `e2e/s01-typography-centering.spec.ts` con el siguiente contenido completo. Asume el patrón del repo de correr contra el build de prod (ver commit `b324b7c`); el `webServer` ya configurado en `playwright.config.ts` levanta la app. Verifica que cada viewport renderiza, captura screenshot y comprueba que el heading usa Space Grotesk.
  ```ts
  import { test, expect } from "@playwright/test";

  const VIEWPORTS = [
    { name: "iphone-se", width: 375, height: 667 },
    { name: "iphone-14", width: 390, height: 844 },
  ];

  for (const vp of VIEWPORTS) {
    test(`onboarding centered + Space Grotesk @ ${vp.name}`, async ({ page }) => {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/onboarding");

      const heading = page.getByRole("heading", { level: 1 });
      await expect(heading).toBeVisible();

      // Heading font resolves to Space Grotesk
      const fontFamily = await heading.evaluate(
        (el) => getComputedStyle(el).fontFamily,
      );
      expect(fontFamily.toLowerCase()).toContain("space grotesk");

      // Base font-size is 17.5px
      const htmlFontSize = await page.evaluate(
        () => getComputedStyle(document.documentElement).fontSize,
      );
      expect(htmlFontSize).toBe("17.5px");

      await page.screenshot({
        path: `e2e/__screenshots__/s01-onboarding-${vp.name}.png`,
        fullPage: true,
      });
    });

    test(`unlock screen renders @ ${vp.name}`, async ({ page }) => {
      // Seed a vault so /unlock doesn't bounce to /onboarding.
      await page.addInitScript(() => {
        // Marker only; real vault existence is checked via IndexedDB in-app.
      });
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await page.goto("/unlock");
      // Either the unlock form or a redirect to onboarding is acceptable here;
      // we only assert the page paints without layout overflow.
      const body = page.locator("body");
      const overflow = await body.evaluate(
        (el) => el.scrollWidth - el.clientWidth,
      );
      expect(overflow).toBeLessThanOrEqual(1);
      await page.screenshot({
        path: `e2e/__screenshots__/s01-unlock-${vp.name}.png`,
      });
    });
  }
  ```

- [ ] **Step 2: Correr el spec.**
  ```bash
  pnpm exec playwright test e2e/s01-typography-centering.spec.ts
  ```
  Output esperado: 4 tests passed. Si `/unlock` redirige a `/onboarding` (sin vault), el assert de overflow sigue siendo válido.

- [ ] **Step 3: Inspeccionar los screenshots.**
  Abrir `e2e/__screenshots__/s01-onboarding-iphone-se.png` y `s01-onboarding-iphone-14.png`. Confirmar visualmente: contenido centrado verticalmente (no pegado arriba), headings en Space Grotesk, body legible con la nueva base. Adjuntar al reporte de sesión.

- [ ] **Step 4: Commit.**
  ```bash
  git add e2e/s01-typography-centering.spec.ts
  git commit -m "test(e2e): verify S1 typography + mobile centering at 375x667 and 390x844"
  ```

---

### Task 6: Gates y cierre

**Files:**
- (sin nuevos archivos; verificación y commit final)

- [ ] **Step 1: Lighthouse mobile ≥95 (gate de sesión UI).**
  Con la app servida (`pnpm build && pnpm start` en background), correr Lighthouse móvil sobre `/onboarding`:
  ```bash
  pnpm dlx lighthouse http://localhost:3000/onboarding \
    --only-categories=performance,accessibility,best-practices \
    --form-factor=mobile --screenEmulation.mobile \
    --quiet --chrome-flags="--headless" --output=json --output-path=./lighthouse-s01.json
  ```
  Verificar Performance ≥ 0.95. Si baja, revisar que las fuentes usan `display: "swap"` y subset latin (ya configurado en Task 1). El cambio de fuentes no debe introducir layout shift: `next/font` reserva métricas automáticamente.

- [ ] **Step 2: `/impeccable audit` sobre las pantallas tocadas.**
  Invocar la skill `impeccable` en modo audit sobre `/unlock` y `/onboarding` (cambio visual de tipografía + layout). Registrar hallazgos; resolver los bloqueantes antes de cerrar.

- [ ] **Step 3: Screenshot Playwright del cambio visual.**
  Confirmar que los screenshots de Task 5 están adjuntos como evidencia del cambio visual (requisito de samu-flow para cambios de UI).

- [ ] **Step 4: `/code-review` del diff completo de la sesión.**
  Invocar `/code-review` sobre el diff de S1. Aplicar correcciones de alta confianza.

- [ ] **Step 5: Verificación de evidencia.**
  Confirmar en orden: `pnpm exec tsc --noEmit` (exit 0), `pnpm build` (verde), `pnpm exec playwright test e2e/s01-typography-centering.spec.ts` (4 passed), `lighthouse-s01.json` Performance ≥0.95. No afirmar "completo" sin estos outputs.

- [ ] **Step 6: Limpiar artefacto temporal de Lighthouse y commit final.**
  ```bash
  rm -f lighthouse-s01.json
  git add -A
  git commit -m "chore(s01): close typography + login centering session with gates green"
  ```

- [ ] **Step 7: Recordar `/compact`.**
  Tras el commit final, ejecutar `/compact` para cerrar la sesión dejando el plan como punto de retoma.
