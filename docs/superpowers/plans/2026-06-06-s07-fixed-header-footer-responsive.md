# S7 — Header/Footer fijos + safe-areas + auditoría responsive Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fijar el header móvil (`sticky` → `fixed top-0`) y el `BottomTabNav` con respeto a las safe-areas de iOS/Android (notch + home indicator) vía `env(safe-area-inset-*)`, compensar el `main` con padding calculado para que el contenido no quede oculto bajo header/footer, activar `viewport-fit=cover`, y dejar una auditoría responsive concreta a 360/390/768/1280 que mantenga Lighthouse mobile ≥95 y cero CLS nuevo. El layout debe ser correcto en los TRES contextos: PWA instalada (standalone iOS/Android), navegador móvil y desktop/web.

**Architecture:**
- `app/layout.tsx`: añadir `viewportFit: "cover"` al export `viewport: Viewport` de Next 16 (la API `Viewport` de `next` soporta `viewportFit`; NO se toca el `<meta>` a mano — Next lo emite). Mantener `width/initialScale/themeColor`.
- `app/globals.css`: definir variables CSS para las alturas de las barras y las safe-areas dentro de `:root`, de modo que `main` pueda compensar con `calc()` sin hardcodear. Las safe-areas valen `0px` fuera de standalone (navegador), así que no rompen desktop/web.
- `components/nav/AppShell.tsx`: el `<header>` móvil pasa de `sticky top-0` a `fixed top-0 left-0 right-0`, con `padding-top: env(safe-area-inset-top)` y altura efectiva mayor. El `<main>` recibe `padding-top` = altura header + inset-top (solo en móvil, `md:pt-0`) y `padding-bottom` = altura tab bar + inset-bottom (`md:pb-0`).
- `components/nav/BottomTabNav.tsx`: añadir `padding-bottom: env(safe-area-inset-bottom)` para que los tabs no queden bajo el home indicator; la altura del área táctil de cada tab se conserva ≥44px.
- Auditoría responsive: checklist ejecutado con Playwright (`browser_resize` + `browser_snapshot`/screenshot) a los 4 breakpoints, comprobando: sin dependencias de hover para acciones, cero CLS nuevo, contenido nunca oculto bajo barras, y Lighthouse mobile ≥95.

**Tech Stack:** Next.js 16.2.7 (App Router, React 19), Tailwind 4 (`@theme` en `app/globals.css`, sin config file — se usan utilidades arbitrarias `pt-[...]` y variables CSS), Base UI, Playwright (`pnpm exec playwright test`), Lighthouse (vía `pnpm dlx`/CLI o Playwright). SIEMPRE `pnpm`.

**Estado actual verificado (al escribir el plan):**
- `AppShell.tsx`: `main` = `flex-1 md:ml-56 flex flex-col min-h-dvh pb-[3.75rem] md:pb-0 outline-none`; header móvil = `flex md:hidden ... h-14 ... sticky top-0 z-20`; contenido = `flex-1 p-4 md:p-6 lg:p-8`.
- `BottomTabNav.tsx`: `nav` = `fixed bottom-0 left-0 right-0 z-40 flex md:hidden border-t ...`; cada tab `min-h-[3.5rem]` (56px ≈ el `pb-[3.75rem]`=60px del main, hay un pequeño descuadre que este plan corrige con la variable).
- `app/globals.css` NO contiene ninguna referencia a `safe-area` ni `env(` hoy.
- `app/layout.tsx` exporta `viewport` SIN `viewportFit`.
- Sidebar (desktop) ya es `fixed`; en desktop NO hay header móvil ni tab bar, así que las safe-areas (que son 0 en navegador desktop) no afectan.

---

### Task 1: `viewport-fit=cover` en el viewport de Next

**Files:**
- `app/layout.tsx` (export `viewport`, líneas 35-42)

- [ ] Añadir `viewportFit: "cover"` al objeto `viewport`. Reemplazar el export (líneas 35-42) por:
```tsx
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f8f6fe" },
    { media: "(prefers-color-scheme: dark)", color: "#1e1a2e" },
  ],
};
```
- [ ] `pnpm exec tsc --noEmit` → esperado: sin errores (`viewportFit` es propiedad válida del tipo `Viewport` de Next 16).
- [ ] Verificar el `<meta>` emitido: `pnpm build && pnpm start` en background, luego `curl -s http://localhost:3000/ | grep -o 'viewport-fit=cover'` → esperado: `viewport-fit=cover` presente en el meta viewport. (Alternativa sin build: `pnpm dev` y revisar el HTML.)
- [ ] Commit: `git commit -am "feat(layout): viewport-fit=cover for safe-area support"`

---

### Task 2: Variables CSS de barras y safe-areas en globals.css

**Files:**
- `app/globals.css` (bloque `:root`, línea 52)

- [ ] Dentro de `:root` (tras la línea 52 `:root {`), añadir las variables que parametrizan alturas de barras y safe-areas. Esto centraliza los números para que `AppShell` use `calc()`:
```css
  /* ── App shell metrics (S7) ─────────────────────────────────────────────
     Bar heights are fixed; safe-area insets resolve to 0px outside standalone
     (i.e. in a normal browser), so these calcs are correct on desktop/web too. */
  --app-header-h: 3.5rem;            /* mobile top bar (matches h-14) */
  --app-tabbar-h: 3.5rem;            /* bottom tab bar (matches min-h-[3.5rem]) */
  --safe-top: env(safe-area-inset-top, 0px);
  --safe-bottom: env(safe-area-inset-bottom, 0px);
  --app-header-total: calc(var(--app-header-h) + var(--safe-top));
  --app-tabbar-total: calc(var(--app-tabbar-h) + var(--safe-bottom));
```
- [ ] `pnpm dev` (o build) y confirmar que la app sigue cargando sin error de CSS. No hay assertion automatizable aquí; es definición de tokens. Continuar.
- [ ] Commit: `git commit -am "feat(css): app-shell metrics & safe-area inset variables"`

---

### Task 3: Header fijo con safe-area-inset-top en AppShell

**Files:**
- `components/nav/AppShell.tsx` (header línea 42, main línea 39)

- [ ] Cambiar el `<header>` móvil (línea 42) de `sticky top-0` a `fixed` con padding de safe-area y altura calculada. Reemplazar la línea de className del header por:
```tsx
        <header className="fixed md:hidden inset-x-0 top-0 z-30 flex items-center justify-between px-4 h-[var(--app-header-total)] pt-[var(--safe-top)] border-b border-border bg-background/95 backdrop-blur-sm supports-[backdrop-filter]:bg-background/80">
```
Notas: `h-[var(--app-header-total)]` reserva la altura del contenido (3.5rem) + el inset; `pt-[var(--safe-top)]` empuja el contenido visible por debajo del notch; `z-30` para quedar por encima del contenido (el tab bar usa `z-40`, el sidebar `z-30` pero no coexiste con el header móvil porque uno es `md:hidden` y el otro `hidden md:flex`).
- [ ] Compensar el `<main>` (línea 39). Como ahora el header es `fixed` (sale del flujo), el contenido necesita `padding-top` en móvil. Reemplazar la className del `<main>`:
```tsx
        className="flex-1 md:ml-56 flex flex-col min-h-dvh pt-[var(--app-header-total)] md:pt-0 pb-[var(--app-tabbar-total)] md:pb-0 outline-none"
```
Esto sustituye el `pb-[3.75rem]` hardcodeado por `pb-[var(--app-tabbar-total)]` (alinea el padding con la altura real del tab bar + home indicator) y añade el `pt` que antes no hacía falta porque el header era `sticky`.
- [ ] El `<div>` de contenido (línea 53, `flex-1 p-4 md:p-6 lg:p-8`) se mantiene; el padding de página vive ahí y se suma al padding del `main`. Sin cambios.
- [ ] `pnpm exec tsc --noEmit` → esperado: sin errores.
- [ ] Verificación visual con Playwright a 390×844 (móvil): el primer elemento del contenido (p.ej. el `<h1>` de la página) NO queda tapado por el header, y al hacer scroll el header permanece fijo arriba. Capturar screenshot.
- [ ] Commit: `git commit -am "feat(shell): fixed mobile header with safe-area-inset-top; main padding compensation"`

---

### Task 4: BottomTabNav con safe-area-inset-bottom

**Files:**
- `components/nav/BottomTabNav.tsx` (nav línea 22)

- [ ] Añadir `padding-bottom: env(safe-area-inset-bottom)` al `<nav>`. Reemplazar la className del `<nav>` (línea 22) por:
```tsx
      className="fixed bottom-0 left-0 right-0 z-40 flex md:hidden border-t border-border bg-background/95 backdrop-blur-sm supports-[backdrop-filter]:bg-background/80 pb-[var(--safe-bottom)]"
```
Cada tab conserva `min-h-[3.5rem]` (≥44px de área táctil); el `pb-[var(--safe-bottom)]` añade espacio bajo los tabs para el home indicator sin reducir el target. En navegador (no standalone) `--safe-bottom` = 0px, así que no cambia nada.
- [ ] `pnpm exec tsc --noEmit` → esperado: sin errores.
- [ ] Verificación con Playwright a 390×844: los tabs son visibles y clicables; el contenido scrolleable termina por encima del tab bar (gracias al `pb-[var(--app-tabbar-total)]` del main de la Task 3) sin solaparse. Capturar screenshot del fondo de página.
- [ ] Commit: `git commit -am "feat(nav): bottom tab bar respects safe-area-inset-bottom"`

---

### Task 5: Auditoría responsive con Playwright (checklist a 360/390/768/1280)

**Files:**
- (auditoría manual asistida por Playwright; sin código de app salvo fixes que surjan)

Ejecutar con el MCP de Playwright (`browser_navigate`, `browser_resize`, `browser_snapshot`, `browser_take_screenshot`) contra `pnpm build && pnpm start`. Antes de auditar rutas de vault, crear/desbloquear un vault (reusar las credenciales del e2e: master password `TestPassword1!`) para llegar a /dashboard.

- [ ] **360×640 (móvil pequeño Android):** navegar a /dashboard, /subscriptions, /payment-methods, /settings. En cada una: snapshot + screenshot. Verificar:
  - [ ] Header fijo arriba, no tapa el `<h1>` ni el primer card.
  - [ ] Tab bar fijo abajo, no tapa el último elemento scrolleable.
  - [ ] Sin scroll horizontal (overflow-x). Comprobar con `document.documentElement.scrollWidth <= clientWidth` vía `browser_evaluate`.
  - [ ] Targets táctiles ≥44px (tabs, FAB, botones de acción).
- [ ] **390×844 (iPhone moderno):** repetir las 4 rutas. Además abrir el Sheet de Add Subscription y el de Add Card: verificar que el Sheet no queda tapado por barras ni por el teclado virtual (no se puede simular teclado en headless, anotar para verificación manual en móvil real).
- [ ] **768×1024 (tablet / breakpoint md):** verificar la transición: a 768px el Sidebar aparece (`md:flex`), el header móvil y el tab bar desaparecen (`md:hidden`), y `main` usa `md:ml-56 md:pt-0 md:pb-0`. Confirmar que no hay doble padding ni hueco fantasma del header.
- [ ] **1280×800 (desktop):** Sidebar fijo, contenido con `md:ml-56`. Confirmar que NO hay padding de safe-area visible (insets = 0 en navegador) y el layout es idéntico al actual salvo mejoras.
- [ ] **Sin dependencias de hover:** revisar `payment-methods/page.tsx` — las acciones Editar/Eliminar de `CardTile` están en `opacity-0 group-hover:opacity-100 group-focus-within:opacity-100`. En móvil/táctil no hay hover; confirmar que `group-focus-within` las revela al tocar (focus). Si en táctil quedan inalcanzables, anotar como hallazgo y proponer fix (p.ej. siempre visibles en `<md`). Documentar la decisión.
- [ ] **CLS:** con `browser_evaluate`, medir layout shift cargando cada ruta (PerformanceObserver `layout-shift`) y confirmar que el header/footer fijos NO introducen shift nuevo (el contenido ya nace con el padding correcto, sin salto). Anotar valores.
- [ ] Si algún breakpoint revela solape, overflow o target <44px, aplicar el fix mínimo en `AppShell`/`BottomTabNav`/`globals.css` y re-verificar el breakpoint afectado. Commit por fix: `git commit -am "fix(responsive): <descripción> at <breakpoint>"`.
- [ ] Guardar los screenshots de los 4 breakpoints (al menos /dashboard y /subscriptions) como evidencia para el gate de cierre.

---

### Task 6: Lighthouse mobile ≥95

**Files:**
- (verificación; sin código salvo fixes)

- [ ] Con la app en build de prod (`pnpm build && pnpm start`), correr Lighthouse mobile sobre /dashboard (autenticado no es trivial; usar al menos /onboarding o /unlock que son públicas, más /dashboard si se puede semillar el vault). Comando: `pnpm dlx lighthouse http://localhost:3000/onboarding --only-categories=performance,accessibility,best-practices --form-factor=mobile --screenEmulation.mobile --quiet --chrome-flags="--headless" --output=json --output-path=./lighthouse-s7.json`.
- [ ] Verificar Performance ≥95 y Accessibility ≥95 (gate del spec §3.5 / §5.4). Si Performance cae por debajo, investigar regresiones de S7 (no debería haber: solo CSS de layout). Atender y re-correr.
- [ ] Anotar las puntuaciones en el reporte de cierre. (No commitear el JSON salvo que el repo ya trackee artefactos de Lighthouse — por la política global, los artefactos de Claude Code no van a git.)

---

### Task 7: Gates y cierre

**Files:**
- (verificación; sin código nuevo salvo fixes de los gates)

- [ ] `pnpm vitest run` → esperado: toda la suite unit verde (S7 no toca lógica; debe seguir igual).
- [ ] `pnpm build && pnpm exec playwright test` → esperado: la suite E2E existente sigue verde (nav y dialogs no cambian de semántica; solo padding/posición). Si algún selector de e2e dependía de la posición del header, ajustar el test (no la app) con los patrones ya usados.
- [ ] `/impeccable audit` + screenshots Playwright de los 4 breakpoints (360/390/768/1280) en /dashboard y /subscriptions, además del header en scroll y el tab bar al fondo. Verificar safe-areas, foco visible, contraste, cero CLS.
- [ ] `/code-review` sobre el diff de la sesión.
- [ ] `typescript-reviewer` sobre el diff de `AppShell.tsx` (único `.tsx` con cambios estructurales; `BottomTabNav.tsx` y `layout.tsx` son cambios mínimos pero inclúyelos si el reviewer lo pide).
- [ ] Verificación manual (superpowers:verification-before-completion): si hay un dispositivo iOS/Android disponible, instalar la PWA y confirmar en standalone que (a) el header respeta el notch, (b) los tabs respetan el home indicator, (c) en navegador móvil (no instalado) el layout también es correcto, (d) en desktop nada cambió a peor. Documentar qué contexto se verificó realmente.
- [ ] Commit final si hubo fixes: `git commit -am "fix(s7): address review & audit feedback"`. NO mergear; dejar la rama lista.
- [ ] `/compact`.
