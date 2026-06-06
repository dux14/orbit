# Orbit — Phase 2 + Quick Wins: Design Spec

**Fecha:** 2026-06-06 · **Estado:** Aprobado por Samu (sesión "Orbit")
**Relación:** complementa y parametriza `docs/phase-2-plan.md` (que se ejecuta tal cual); añade 6 quick wins de UI y deja Phase 3 con alcance definido.

## 1. Dinámica de ejecución

- El trabajo se divide en **12 sesiones quick-win intercaladas (UI ↔ Backend)**, cada una ≤30% del contexto de una sesión de Claude Code, terminando en: tests verdes → review gates de samu-flow → commit → `/compact`.
- Cada sesión es autocontenida y entregable. El plan de implementación (un archivo por sesión en `docs/superpowers/plans/`) permite retomar tras compact sin re-explorar.
- Research dentro de la sesión que lo necesita: `context7` (sintaxis/librerías) y `/last30days` (decisiones de herramienta).
- Review gates por tipo: `/code-review` siempre; `typescript-reviewer` en diffs .ts/.tsx sustanciales; `database-reviewer` en migraciones/RLS; `/security-review` en auth, crypto, secrets, endpoints; `/impeccable audit` + screenshot Playwright en cambios visuales.

## 2. Secuencia de sesiones

| # | Frente | Entregable | Items |
|---|--------|-----------|-------|
| S1 | UI | Tipografía Space Grotesk + Inter, base 17.5px; fix centrado login/onboarding mobile | 3, 4 |
| S2 | Backend | CP1: Supabase link + migraciones + RLS + types; auditoría de cuotas (baseline) | core, 9 |
| S3 | UI | Logo aurora: iconos PWA + apple-icon + favicon + OrbitLogo SVG + theme_color | 1 |
| S4 | Backend | CP2: Google OAuth + sesiones SSR + merge proxy CSP; **rotación de secrets** | core |
| S5 | UI | Refactor Add Subscription (una pantalla + acordeones) + selector de tarjeta inline | 5, 6 |
| S6 | Backend | CP3: sync cifrado (reconcile TDD, sync-repository, sync-service, conflict UX) | core |
| S7 | UI | Header/footer fixed + safe-areas; auditoría responsive mobile-first | 7, 8 |
| S8 | Backend | CP4: vincular vault local↔cuenta; onboarding multi-device | core |
| S9 | UI/Crypto | Envelope encryption + biometría WebAuthn PRF (partible en S9a/S9b) | 2 |
| S10 | Backend | CP5: recordatorios cloud opt-in (Web Push + pg_cron) | core |
| S11 | Backend | CP6: rate limiting + hardening + auditoría RLS | core |
| S12 | Backend | CP7: verificación E2E + Lighthouse + deploy + re-chequeo de cuotas | core, 9 |

Phase 3 (post-S12, specs propios en su momento): S13 TOTP · S14 auto-import CSV · S15 analytics · S16 shared/family · S17 web-of-trust. Per-record sync = Phase 2.5 condicional.

## 3. Decisiones de diseño (cerradas)

### 3.1 Backend (parametriza phase-2-plan.md)
- Decisiones §1 del plan: **(1) single-blob + versión** (per-record → Phase 2.5 condicional), **(2) reminder index opt-in default OFF**, **(3) prompt solo en conflicto real de versiones**, **(4) cuenta opcional** (local-first se preserva).
- **Multi-dispositivo es requisito de primera clase**: la misma cuenta debe ver el mismo vault en móvil (PWA instalada iOS/Android), web y desktop — todos consumen el mismo code path de sync (no hay ramas por plataforma). S6 implementa el motor, S8 la vinculación de dispositivos, y S12 lo verifica E2E con dos contextos de navegador simultáneos (editar en "dispositivo A" → aparecer en "dispositivo B").
- Proyecto Supabase: `vmcjkleuetcogqhdnlfx` (URL `https://vmcjkleuetcogqhdnlfx.supabase.co`).
- Google OAuth: client ID `457451718899-gp6onihjafeao8ai9cd3m4pb3eppf450.apps.googleusercontent.com`; redirect ya registrado `https://vmcjkleuetcogqhdnlfx.supabase.co/auth/v1/callback`. Client secret y `sb_secret_*` viven solo en Supabase config/secrets y Vercel env — nunca en el repo.
- Env: `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_ANON_KEY` (publishable) en `.env.local` y Vercel (Prod+Preview). Feature flag `NEXT_PUBLIC_SYNC_ENABLED` gatea la UI de cuenta/sync hasta CP7.
- **Rotación obligatoria** (tarea de S4): el `sb_secret_*` y el client secret de Google fueron expuestos en el chat de planificación → rotar tras configurar OAuth y actualizar referencias.

### 3.2 Identidad visual
- **Logo: dirección "Aurora gradient"** (generación Higgsfield job `fefa9c95-aa24-4c75-8d51-417937773e0a`, PNG 1024): sistema orbital en trazos de gradiente luminoso periwinkle→rosa, planetas pastel con halo, fondo plum oscuro.
- Pipeline de assets: script `scripts/` con `sharp` → `icon-192.png`, `icon-512.png`, `maskable-512.png` (safe zone 80%), `apple-icon`, favicon. `manifest.json`: `theme_color` plum oscuro coherente; revisar `background_color`/splash en light y dark.
- `OrbitLogo.tsx` se **redibuja como SVG** en la misma dirección (gradientes lineales, halos) manteniendo su API (`size`, `className`). El raster es solo para iconos.

### 3.3 Tipografía
- **Space Grotesk** (headings, `--font-heading`) + **Inter** (body) vía `next/font/google`, subset latin, self-hosted. Geist Mono se mantiene para cifras tabulares.
- Base 16→**17.5px**, body `line-height 1.6`, jerarquía de títulos reescalada en `globals.css` (Tailwind 4 `@theme`).

### 3.4 Add Subscription (refactor — opción B)
- Una pantalla en el Sheet actual: bloque esencial siempre visible (serviceName, amount+currency, billingCycle, nextRenewalDate) + **selector de tarjeta** + 3 acordeones cerrados (Cuenta y plan / Credenciales / Notas y estado) con Base UI Collapsible.
- Selector de tarjeta: chips de `PaymentMethod`s (color+brand+··last4) + "+ Nueva tarjeta" inline (alias, brand, last4, color). Guardar crea el PaymentMethod en el vault (`upsertPaymentMethod`) **y** asigna `paymentMethodId` — la tarjeta aparece en Payment Methods automáticamente. Todo dentro del blob cifrado; PCI-safe sin cambios (solo alias/brand/last4/color).
- Validación inline, `inputmode="decimal"`, date picker nativo, targets ≥44px, i18n es/en.

### 3.5 Layout mobile (S1 y S7)
- Login/onboarding: centrado vertical real con `dvh` + padding asimétrico + safe-areas; verificado a 375×667 y 390×844 con/sin teclado virtual.
- AppShell: header mobile `sticky`→`fixed top-0` con `env(safe-area-inset-top)`; BottomTabNav añade `env(safe-area-inset-bottom)`; `main` compensa con padding calculado; `viewport-fit=cover`.
- Auditoría responsive (S7): 360/390/768/1280, sin dependencias de hover, `sizes` correctos en imágenes, cero CLS nuevo. Mobile-first, performance-first (Lighthouse mobile ≥95 se mantiene como gate), PWA-first.

### 3.6 Biometría (S9) — WebAuthn PRF
- **Envelope encryption** previo (compatible hacia atrás, migración transparente al primer unlock): `VaultKey` aleatoria cifra el blob; `KEK_master` = Argon2id(master password) la envuelve (como hoy); `KEK_bio` = HKDF(PRF de passkey) la envuelve opcionalmente.
- Enrolamiento opt-in en Settings, visible solo con soporte detectado (`PublicKeyCredential` + PRF: iOS/Safari 18.4+, Android Chrome, Chrome/Edge desktop). `userVerification: "required"`, `authenticatorAttachment: "platform"`.
- Unlock: botón "Face ID / huella" en `/unlock` → `credentials.get` + PRF → HKDF → desenvuelve `VaultKey`. Master password siempre como fallback/recovery.
- **Prohibido** el antipatrón gate-booleano (clave utilizable en IndexedDB sin envolver). Sin PRF → no hay biometría, solo master password.
- Limitaciones aceptadas: borrar datos del navegador exige re-enrolar; passkeys no interoperan entre ecosistemas Apple/Google; WebAuthn no funciona en in-app browsers; Firefox móvil sin soporte.
- Tests: unit de wrap/unwrap/HKDF; E2E con virtual authenticator de Playwright.

### 3.7 Cuotas (S2 baseline, S12 re-chequeo)
- Vercel Hobby: bandwidth 100 GB/mes, límites Fluid Compute/invocaciones, build minutes — medir con `vercel` CLI/MCP.
- Supabase Free: 500 MB DB, 50K MAU, 2M Realtime msgs/mes, pausa por inactividad de 7 días (pg_cron de CP5 mantiene actividad).
- Proyección: blob cifrado por usuario = KBs (DB no es riesgo); el riesgo es **Realtime/requests** → debounce agresivo del push de sync (ya contemplado en el plan).
- Entregable: `docs/quota-baseline.md` con uso actual, proyección y umbrales de alerta.

## 4. Phase 3 — alcance (sin tareas aún)

- **TOTP (S13):** secrets TOTP dentro del blob cifrado; código rotante en la ficha de credencial. Sin server.
- **Auto-import CSV (S14):** parser 100% client-side (zero-knowledge); mapeo de columnas + heurística de recurrencia para detectar suscripciones.
- **Analytics (S15):** agregados locales sobre el vault (tendencias, por categoría/tarjeta); sin telemetría externa.
- **Shared/family (S16) + web-of-trust (S17):** requieren diseño criptográfico propio (clave de grupo envuelta por clave de cada miembro); S17 es fundación de S16 → brainstorming + spec dedicados en su momento.

## 5. Criterios de éxito globales

1. Cada sesión cierra con sus gates en verde y commit propio.
2. Zero-knowledge intacto: el servidor solo ve ciphertext (excepción única: reminder index opt-in, default OFF).
3. Offline-first intacto: sin sesión o sin red == comportamiento Phase 1.
4. Lighthouse mobile ≥95 tras cada sesión UI.
5. Secrets rotados tras S4; ninguno en repo ni en bundles.
6. Cuotas: proyección dentro de free tier con margen documentado.
7. **Paridad multi-dispositivo**: editar el vault en un dispositivo y desbloquearlo en otro (móvil/web/desktop) produce el mismo estado descifrado; verificado E2E en S12 con dos contextos simultáneos y manual en al menos un móvil real.
