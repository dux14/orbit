# S12 — Verificación E2E + Lighthouse + deploy + re-chequeo de cuotas Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Conduce Vercel y Supabase por CLI/MCP (autenticados) — nunca por la web UI. SIEMPRE `pnpm`.

**Goal:** Implementar la sesión S12 = Checkpoint 7 de `docs/phase-2-plan.md` + el criterio §5.7 (paridad multi-dispositivo): suite E2E completa del flujo sync con el test de paridad multi-dispositivo (dos contextos de navegador: A edita → B converge; offline en B → A edita → B reconecta y converge o muestra conflicto), Lighthouse mobile ≥95, bundle size check, verificación manual en móvil real documentada, rollout activando `NEXT_PUBLIC_SYNC_ENABLED=true` en Vercel (preview → smoke → prod), re-chequeo de cuotas con consumo real post-sync, y el checklist final de cierre de Phase 2 contra el spec §5.

**Architecture:** Los tests E2E corren contra una **build de producción** (`pnpm build && pnpm start`), igual que la suite existente en `e2e/orbit.spec.ts` (el dev overlay intercepta pointer events y solo prod ejercita el CSP nonce real). El test multi-dispositivo usa dos `BrowserContext` aislados (Playwright aísla IndexedDB/localStorage por contexto), cada uno autenticado con la misma cuenta Supabase, simulando dos dispositivos de un mismo usuario. Helpers de auth/sync de S8 viven en `e2e/helpers/`; este plan añade `e2e/helpers/multi-device.ts`. El rollout es aditivo y reversible: bajar la flag revierte la app a comportamiento Phase 1.

**Tech Stack:** Playwright (`@playwright/test`, channel chrome, proyectos `mobile`/`desktop`) · Next.js prod build · Supabase (cuenta de prueba real para OAuth/sync) · Vercel CLI (env + deploy + promote) · Lighthouse · `docs/quota-baseline.md` (de S2) · `pnpm`.

---

## 0. Decisiones bloqueadas (no re-litigar)

| Tema | Decisión |
|---|---|
| Paridad multi-dispositivo | Requisito de primera clase (§3.1, §5.7). E2E con dos contextos simultáneos + manual en ≥1 móvil real. |
| E2E target | Prod build (`pnpm build && pnpm start`), no `pnpm dev`. Convención ya establecida en `playwright.config.ts`. |
| Auth en E2E | Sync/OAuth necesitan origen https real → el flujo OAuth completo se verifica en **preview deploy**; los tests locales usan una sesión sembrada o un usuario de prueba (ver Task 2). |
| Rollout | `NEXT_PUBLIC_SYNC_ENABLED=true` → preview → smoke → promote a prod. Reversible bajando la flag. |
| Lighthouse | Mobile ≥95 se mantiene como gate. |

---

## Task 1: Helpers multi-dispositivo E2E

**Files:** `e2e/helpers/multi-device.ts`

- [ ] Leer los helpers de S8 en `e2e/helpers/` (auth, sign-in, seed de sesión). Si no existen aún, leer `e2e/orbit.spec.ts` para reusar `createVault`/`unlockVault` y adaptarlos. Nombrar consistente con S8.
- [ ] Crear `e2e/helpers/multi-device.ts`:
  ```ts
  import { type Browser, type BrowserContext, type Page, expect } from '@playwright/test';

  export const MASTER_PASSWORD = 'TestPassword1!';
  export const SERVICE_A = 'Netflix';
  export const SERVICE_B = 'Spotify';

  /**
   * Spin up an isolated browser context = "a device".
   * Each context has its own IndexedDB / localStorage / cookies, so two contexts
   * model two physical devices of the SAME signed-in user.
   */
  export async function openDevice(browser: Browser): Promise<{ context: BrowserContext; page: Page }> {
    const context = await browser.newContext();
    const page = await context.newPage();
    return { context, page };
  }

  /**
   * Sign in the test user via Supabase. In CI/local we seed a session rather than
   * driving the real Google consent screen (OAuth needs an https origin — that path
   * is verified on the preview deploy in Task 6). Here we inject a session token
   * obtained once via the Supabase CLI and stored as TEST_SUPABASE_SESSION env.
   *
   * Falls back to assuming an already-authed local dev session if the env is absent.
   */
  export async function signInTestUser(page: Page): Promise<void> {
    const session = process.env.TEST_SUPABASE_SESSION;
    if (session) {
      await page.addInitScript((s) => {
        // @supabase/ssr reads the session from the auth cookie / storage key.
        localStorage.setItem('sb-vmcjkleuetcogqhdnlfx-auth-token', s);
      }, session);
    }
    await page.goto('/');
  }

  /** Create (or unlock) the same-password vault on this device and reach the dashboard. */
  export async function setupVault(page: Page, password = MASTER_PASSWORD): Promise<void> {
    await page.goto('/');
    // New device with a synced remote vault → /unlock; brand-new → /onboarding.
    await Promise.race([
      page.waitForURL('**/onboarding', { timeout: 15_000 }).catch(() => {}),
      page.waitForURL('**/unlock', { timeout: 15_000 }).catch(() => {}),
      page.waitForURL('**/dashboard', { timeout: 15_000 }).catch(() => {}),
    ]);

    if (page.url().includes('/onboarding')) {
      await page.getByLabel('Master password').first().fill(password);
      await page.getByLabel('Confirm password').fill(password);
      await page.getByRole('button', { name: /create vault/i }).click();
      await page.waitForURL('**/dashboard', { timeout: 20_000 });
    } else if (page.url().includes('/unlock')) {
      await page.getByLabel('Master password').fill(password);
      await page.getByRole('button', { name: /unlock vault/i }).click();
      await page.waitForURL('**/dashboard', { timeout: 20_000 });
    }
  }

  /** Navigate to /subscriptions via the viewport-visible nav link (no hard reload). */
  export async function gotoSubscriptions(page: Page): Promise<void> {
    await page.getByRole('link', { name: /^subscriptions$/i }).filter({ visible: true }).click();
    await page.waitForURL('**/subscriptions', { timeout: 10_000 });
  }

  /** Add a subscription via the Add sheet. */
  export async function addSubscription(page: Page, name: string, amount = '9.99', renewal = '2026-12-31'): Promise<void> {
    await gotoSubscriptions(page);
    const addBtn = page.getByRole('button', { name: /add subscription/i }).or(
      page.getByRole('button', { name: /^add$/i }),
    );
    await addBtn.first().click();
    await page.getByLabel('Service name').fill(name);
    await page.getByLabel('Amount').fill(amount);
    await page.getByLabel('Next renewal').fill(renewal);
    await page.getByRole('button', { name: /^save$/i }).click();
    await expect(page.getByRole('button', { name: new RegExp(name, 'i') })).toBeVisible({ timeout: 10_000 });
  }

  /** Force a sync reconcile by triggering app focus (sync runs on focus per S6). */
  export async function triggerSync(page: Page): Promise<void> {
    await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  }

  /** Take this context offline / online to simulate disconnection. */
  export async function setOffline(context: BrowserContext, offline: boolean): Promise<void> {
    await context.setOffline(offline);
  }

  /** Assert a subscription with `name` is visible on the subscriptions screen. */
  export async function expectSubscriptionVisible(page: Page, name: string): Promise<void> {
    await gotoSubscriptions(page);
    await triggerSync(page);
    await expect(page.getByRole('button', { name: new RegExp(name, 'i') })).toBeVisible({ timeout: 15_000 });
  }
  ```
  Ajustar el storage key de la sesión Supabase (`sb-<ref>-auth-token`) y los selectores al estado real tras S4/S6/S8. El mecanismo de `triggerSync` debe coincidir con cómo S6 dispara `reconcileNow()` (focus/visibility/realtime); si S6 expone un hook de test, usarlo.
- [ ] Typecheck del helper: `pnpm exec tsc --noEmit` — limpio.
- [ ] Commit: `test(e2e): multi-device helpers (two-context device parity)`.

---

## Task 2: Sembrar usuario/sesión de prueba para E2E

**Files:** `e2e/helpers/multi-device.ts` (doc del setup), `docs/manual-checklists/s12-e2e.md`

- [ ] Crear un usuario de prueba dedicado en Supabase (no el personal). Vía SQL/MCP o CLI:
  ```sql
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role)
  values ('cccccccc-0000-0000-0000-0000000000e2', 'e2e@orbit.test', crypt('E2ePassw0rd!', gen_salt('bf')), now(), 'authenticated', 'authenticated')
  on conflict (id) do nothing;
  ```
- [ ] Obtener un session token para inyectar en E2E. Opción simple: usar el endpoint de password grant del proyecto (solo para el usuario de prueba) y guardar el JSON resultante como `TEST_SUPABASE_SESSION`:
  ```bash
  curl -s "https://vmcjkleuetcogqhdnlfx.supabase.co/auth/v1/token?grant_type=password" \
    -H "apikey: $NEXT_PUBLIC_SUPABASE_ANON_KEY" -H "Content-Type: application/json" \
    -d '{"email":"e2e@orbit.test","password":"E2ePassw0rd!"}'
  ```
  Output esperado: JSON con `access_token`/`refresh_token`. Exportar el shape que `@supabase/ssr` espera como `TEST_SUPABASE_SESSION` en `.env.local` / CI secret (NO commitear).
- [ ] Documentar el setup en `docs/manual-checklists/s12-e2e.md` (cómo regenerar el token, que el usuario es solo de prueba).
- [ ] Commit (solo docs): `docs(e2e): test user + session seeding for sync e2e`.

---

## Task 3: Test E2E de paridad multi-dispositivo

**Files:** `e2e/multi-device.spec.ts`

- [ ] Crear `e2e/multi-device.spec.ts` con el test completo de paridad:
  ```ts
  /**
   * Multi-device parity (Phase 2 success criterion §5.7).
   * Two isolated browser contexts = two devices of the same signed-in user.
   *
   * Covers:
   *   1. Device A edits → Device B converges (online sync).
   *   2. Device B offline → Device A edits → B reconnects → converges OR shows conflict.
   *
   * Requires NEXT_PUBLIC_SYNC_ENABLED=true and a seeded TEST_SUPABASE_SESSION.
   */
  import { test, expect } from '@playwright/test';
  import {
    openDevice, signInTestUser, setupVault, addSubscription,
    expectSubscriptionVisible, triggerSync, setOffline,
    SERVICE_A, SERVICE_B,
  } from './helpers/multi-device';

  test.describe('multi-device sync parity', () => {
    test.skip(process.env.NEXT_PUBLIC_SYNC_ENABLED !== 'true', 'sync flag disabled');

    test('A edits → B converges (online)', async ({ browser }) => {
      const a = await openDevice(browser);
      const b = await openDevice(browser);

      // Both sign in as the same user and unlock the same vault (same master password).
      await signInTestUser(a.page);
      await setupVault(a.page);
      await signInTestUser(b.page);
      await setupVault(b.page);

      // A adds a subscription; sync pushes it.
      await addSubscription(a.page, SERVICE_A);
      await triggerSync(a.page);

      // B reconciles and sees A's edit.
      await expectSubscriptionVisible(b.page, SERVICE_A);

      await a.context.close();
      await b.context.close();
    });

    test('B offline → A edits → B reconnects → converges or shows conflict', async ({ browser }) => {
      const a = await openDevice(browser);
      const b = await openDevice(browser);

      await signInTestUser(a.page);
      await setupVault(a.page);
      await signInTestUser(b.page);
      await setupVault(b.page);

      // B goes offline.
      await setOffline(b.context, true);

      // A edits while B is disconnected.
      await addSubscription(a.page, SERVICE_B);
      await triggerSync(a.page);

      // B reconnects and reconciles.
      await setOffline(b.context, false);
      await triggerSync(b.page);

      // Either B converges (fast-forward: A's edit appears) OR a conflict prompt shows
      // (if B had also edited). With B making no local edits, expect convergence.
      const converged = b.page.getByRole('button', { name: new RegExp(SERVICE_B, 'i') });
      const conflictPrompt = b.page.getByText(/changed on another device|conflicto|conflict/i);

      await expect.poll(async () => {
        if (await conflictPrompt.isVisible().catch(() => false)) return 'conflict';
        await triggerSync(b.page);
        if (await converged.isVisible().catch(() => false)) return 'converged';
        return 'pending';
      }, { timeout: 20_000 }).not.toBe('pending');

      // No-conflict case must converge; if a conflict shows, resolving "use remote" converges.
      if (await conflictPrompt.isVisible().catch(() => false)) {
        await b.page.getByRole('button', { name: /use remote|usar remoto/i }).click();
        await expectSubscriptionVisible(b.page, SERVICE_B);
      } else {
        await expectSubscriptionVisible(b.page, SERVICE_B);
      }

      await a.context.close();
      await b.context.close();
    });
  });
  ```
  Ajustar los textos del conflict prompt a los strings i18n reales de S6 (Task de conflict UX). Si S6 expone botones "keep local / use remote", usar esos nombres exactos.
- [ ] Correr local (con la flag y sesión): `NEXT_PUBLIC_SYNC_ENABLED=true pnpm test:e2e multi-device` — output esperado: ambos tests verdes (o `skipped` si la flag está off; en S12 debe ir `true`).
- [ ] Commit: `test(e2e): multi-device parity — online converge + offline reconnect`.

---

## Task 4: Suite E2E completa del flujo sync

**Files:** `e2e/sync.spec.ts`

- [ ] Crear `e2e/sync.spec.ts` cubriendo el resto del flujo de CP7 (sign-in → link/upload → new device pull+unlock → conflict path → sign-out locks → cloud-reminders toggle escribe/borra índice):
  ```ts
  import { test, expect } from '@playwright/test';
  import {
    openDevice, signInTestUser, setupVault, addSubscription,
    gotoSubscriptions, triggerSync, MASTER_PASSWORD, SERVICE_A,
  } from './helpers/multi-device';

  test.describe('encrypted sync flow', () => {
    test.skip(process.env.NEXT_PUBLIC_SYNC_ENABLED !== 'true', 'sync flag disabled');

    test('local vault links and uploads on sign-in', async ({ browser }) => {
      const a = await openDevice(browser);
      // Create a LOCAL vault first (Phase 1), then sign in → it should link/upload.
      await a.page.goto('/');
      await setupVault(a.page);
      await addSubscription(a.page, SERVICE_A);
      // Sign in links the local vault to the account.
      await signInTestUser(a.page);
      await triggerSync(a.page);
      // Settings shows "Sync enabled" / last synced.
      await a.page.getByRole('link', { name: /^settings$/i }).filter({ visible: true }).click();
      await expect(a.page.getByText(/synced|sincronizado|sync enabled/i)).toBeVisible({ timeout: 15_000 });
      await a.context.close();
    });

    test('new device pulls remote vault and unlocks with same password', async ({ browser }) => {
      const fresh = await openDevice(browser);
      await signInTestUser(fresh.page);
      // No local vault but remote exists → prompt for master password → pull + decrypt.
      await setupVault(fresh.page, MASTER_PASSWORD);
      await gotoSubscriptions(fresh.page);
      await triggerSync(fresh.page);
      await expect(fresh.page.getByRole('button', { name: new RegExp(SERVICE_A, 'i') })).toBeVisible({ timeout: 15_000 });
      await fresh.context.close();
    });

    test('sign-out locks the vault', async ({ browser }) => {
      const a = await openDevice(browser);
      await signInTestUser(a.page);
      await setupVault(a.page);
      await a.page.getByRole('link', { name: /^settings$/i }).filter({ visible: true }).click();
      await a.page.getByRole('button', { name: /sign out|cerrar sesión/i }).click();
      // After sign-out the vault is locked → reload should land on /unlock or /onboarding.
      await a.page.goto('/');
      await Promise.race([
        a.page.waitForURL('**/unlock', { timeout: 15_000 }),
        a.page.waitForURL('**/onboarding', { timeout: 15_000 }),
      ]);
      await a.context.close();
    });

    test('cloud reminders toggle writes then deletes the index', async ({ browser }) => {
      const a = await openDevice(browser);
      await signInTestUser(a.page);
      await setupVault(a.page);
      await a.page.getByRole('link', { name: /^settings$/i }).filter({ visible: true }).click();
      const toggle = a.page.getByRole('switch', { name: /renewal reminders|recordatorios de renovación/i });
      // Turn ON (permission auto-granted via context permissions; see beforeEach if needed).
      await toggle.click();
      await expect(a.page.getByText(/cloud reminders are on|recordatorios en la nube activados/i)).toBeVisible({ timeout: 15_000 });
      // Turn OFF → index deleted.
      await toggle.click();
      await expect(a.page.getByText(/index was deleted|índice se borró/i)).toBeVisible({ timeout: 15_000 });
      await a.context.close();
    });
  });
  ```
  Para el test de reminders, conceder permiso de notificaciones al contexto: añadir en el helper `openDevice` la opción `permissions: ['notifications']` o un `context.grantPermissions(['notifications'])`. Ajustar selectores a la UI real de S10.
- [ ] Correr: `NEXT_PUBLIC_SYNC_ENABLED=true pnpm test:e2e sync` — output esperado: verdes.
- [ ] Confirmar que la suite Phase 1 (`e2e/orbit.spec.ts`) sigue verde sin la flag: `pnpm test:e2e orbit` — output esperado: 3 tests verdes (offline-first intacto, §5.3).
- [ ] Commit: `test(e2e): full encrypted sync flow (link, pull, sign-out, reminders)`.

---

## Task 5: Lighthouse mobile ≥95 + bundle size check

**Files:** `docs/manual-checklists/s12-e2e.md`

- [ ] Build + start de producción: `pnpm build && pnpm start &`.
- [ ] Correr Lighthouse mobile sobre las rutas clave:
  ```bash
  pnpm dlx lighthouse http://localhost:3000/ --preset=desktop --quiet --chrome-flags="--headless" --only-categories=performance,accessibility,best-practices --output=json --output-path=/tmp/lh-home.json
  pnpm dlx lighthouse http://localhost:3000/ --quiet --chrome-flags="--headless" --form-factor=mobile --only-categories=performance,accessibility,best-practices --output=json --output-path=/tmp/lh-mobile.json
  ```
  Output esperado: performance mobile ≥95, accessibility ≥95. Extraer el score:
  ```bash
  node -e "const r=require('/tmp/lh-mobile.json');console.log(Object.fromEntries(Object.entries(r.categories).map(([k,v])=>[k,v.score*100])))"
  ```
- [ ] Si performance < 95: investigar (sync debe estar off del main thread / diferido; la auth screen debe ser ligera). NO bajar el gate; arreglar la regresión.
- [ ] Bundle size check: revisar el output de `pnpm build` (la tabla de First Load JS por ruta). Confirmar que las rutas Phase 1 no crecieron materialmente y que el código de Supabase/sync está en chunks de las rutas de cuenta/settings, no en el bundle compartido base. Registrar el First Load JS de `/`, `/dashboard`, `/settings`.
- [ ] Documentar scores y bundle sizes en `docs/manual-checklists/s12-e2e.md`.
- [ ] Commit (docs): `docs(qa): S12 lighthouse + bundle evidence`.

---

## Task 6: Rollout — flag, preview, smoke, promote a prod

**Files:** (operativo; evidencia en `docs/manual-checklists/s12-e2e.md`)

- [ ] Activar la flag en Vercel para Preview y Production:
  ```bash
  vercel env add NEXT_PUBLIC_SYNC_ENABLED preview     # valor: true
  vercel env add NEXT_PUBLIC_SYNC_ENABLED production  # valor: true
  ```
  Output esperado: `Added Environment Variable NEXT_PUBLIC_SYNC_ENABLED`.
- [ ] Aplicar todas las migraciones pendientes al proyecto linked ANTES de promover:
  ```bash
  supabase db push
  supabase functions deploy send-reminders
  ```
  Output esperado: migraciones al día, función desplegada.
- [ ] Deploy a preview:
  ```bash
  vercel deploy
  ```
  Output esperado: una URL `https://orbit-<hash>-...vercel.app`. Capturarla.
- [ ] Smoke test en preview (origen https real → ejercita OAuth completo):
  - [ ] Abrir la URL de preview, "Continue with Google", completar consent → vuelve autenticado.
  - [ ] Crear/linkear vault, añadir suscripción, recargar, unlock, verque persiste.
  - [ ] En un segundo navegador/perfil, sign-in misma cuenta → pull + unlock → mismos datos (paridad).
  - [ ] Verificar headers en preview: `curl -sI <preview-url> | grep -i content-security-policy` → incluye orígenes Supabase.
  - [ ] Activar cloud reminders → confirmar fila en `push_subscriptions` + `reminders`; desactivar → confirmar borrado.
- [ ] Si el smoke pasa, promover a producción (requiere aprobación explícita del usuario, per plan):
  ```bash
  vercel deploy --prod
  # o promover el deploy de preview ya verificado:
  vercel promote <preview-deployment-url>
  ```
  Output esperado: deploy en el dominio de producción.
- [ ] Smoke test rápido en prod (sign-in + ver datos). Documentar.
- [ ] Plan de rollback documentado: bajar `NEXT_PUBLIC_SYNC_ENABLED` a `false` y redeploy revierte la UI a Phase 1 (sync es aditivo + offline-first). Registrar el comando: `vercel env rm NEXT_PUBLIC_SYNC_ENABLED production` (o setear a `false`) + `vercel deploy --prod`.
- [ ] Commit (docs de evidencia): `docs(rollout): S12 preview→prod smoke evidence + rollback`.

---

## Task 7: Re-chequeo de cuotas post-sync

**Files:** `docs/quota-baseline.md`

- [ ] Leer `docs/quota-baseline.md` (baseline de S2) para conocer el formato y los umbrales de alerta.
- [ ] Medir consumo real post-sync con los CLIs:
  - [ ] Vercel bandwidth / invocaciones / build minutes: `vercel` (revisar el dashboard de uso vía MCP `get_project` / logs, o `vercel inspect`). Registrar GB de bandwidth del periodo, invocaciones de funciones, build minutes usados.
  - [ ] Supabase DB size: `select pg_size_pretty(pg_database_size('postgres'));` — registrar (debe ser KBs/MBs; el blob por usuario es pequeño).
  - [ ] Supabase Realtime: estimar mensajes/mes según el debounce de sync de S6 (push debounced). Registrar la proyección.
  - [ ] Confirmar que el keep-alive cron (S10) está activo: `select jobname from cron.job where jobname = 'keep-alive-daily';` — evita la pausa de 7 días.
- [ ] Actualizar `docs/quota-baseline.md` con una sección "Post-sync (S12)" comparando consumo real vs umbrales:
  - DB size real vs 500 MB.
  - Realtime msgs proyectados vs 2M/mes.
  - Bandwidth vs 100 GB/mes.
  - Invocaciones de funciones (send-reminders es 1/día) — trivial.
  - Veredicto: dentro de free tier con margen documentado (§5.6), o señalar el riesgo principal (Realtime/requests) y el mitigante (debounce).
- [ ] Commit: `docs(quota): post-sync real consumption + thresholds (S12)`.

---

## Task 8: Checklist de cierre de Phase 2 (spec §5)

**Files:** `docs/manual-checklists/s12-e2e.md`

- [ ] Añadir a `docs/manual-checklists/s12-e2e.md` el checklist final verificable con evidencia, mapeado al spec §5:
  ```md
  # Phase 2 — Closure checklist (spec §5)

  - [ ] §5.1 Cada sesión (S10–S12) cerró con gates en verde y commit propio. — evidencia: git log
  - [ ] §5.2 Zero-knowledge intacto: el servidor solo ve ciphertext del vault. Única excepción: reminder index opt-in default OFF. — evidencia: test `zero-knowledge.test.ts` (S11) + grep `send-reminders` sin `encrypted_blob`.
  - [ ] §5.3 Offline-first intacto: sin sesión o sin red == Phase 1. — evidencia: `e2e/orbit.spec.ts` verde sin la flag.
  - [ ] §5.4 Lighthouse mobile ≥95 tras S12. — evidencia: /tmp/lh-mobile.json score.
  - [ ] §5.5 Secrets rotados tras S4; ninguno en repo ni en bundles. — evidencia: grep `sb_secret`/`service_role`/`VAPID_PRIVATE` en `.next` vacío (S11 Task 5).
  - [ ] §5.6 Cuotas: proyección dentro de free tier con margen. — evidencia: docs/quota-baseline.md sección post-sync.
  - [ ] §5.7 Paridad multi-dispositivo: editar en un device y desbloquear en otro → mismo estado descifrado. — evidencia: `e2e/multi-device.spec.ts` verde + manual en ≥1 móvil real (Android/iOS, S10 checklist).
  ```
- [ ] Ejecutar/marcar cada item con su evidencia real (no marcar sin verificar). El manual en móvil real reusa el checklist de S10 más una verificación de convergencia con desktop:
  ```md
  ## Manual mobile parity (≥1 real device)
  - [ ] Instalar PWA en iOS (Añadir a pantalla de inicio) y abrir desde el icono.
  - [ ] Instalar PWA en Android (Chrome → Instalar app).
  - [ ] En el móvil: sign-in misma cuenta → unlock con la master password → ver el mismo vault que en desktop.
  - [ ] Editar en desktop → el móvil converge (focus/reconnect). Editar en móvil → desktop converge.
  - [ ] Conflicto: editar ambos offline → reconectar → prompt de conflicto correcto, resolver sin pérdida de datos.
  ```
- [ ] Limpiar el usuario de prueba E2E si ya no se necesita: `delete from auth.users where email = 'e2e@orbit.test';` (o conservarlo documentado para CI).
- [ ] Commit (docs): `docs(qa): Phase 2 closure checklist with evidence`.

---

## Task 9: Gates y cierre

**Files:** (verificación)

- [ ] Tests unit verdes: `pnpm test` — toda la suite.
- [ ] E2E completa con flag: `NEXT_PUBLIC_SYNC_ENABLED=true pnpm test:e2e` — `multi-device`, `sync` y `orbit` verdes (proyectos mobile + desktop).
- [ ] Typecheck + lint: `pnpm exec tsc --noEmit && pnpm lint` — limpio.
- [ ] Gate `/code-review` sobre el diff de tests + docs.
- [ ] Gate `/security-review`: confirmar que el seeding de sesión de prueba no introduce credenciales reales en el repo, que la flag gatea correctamente, y que el rollout no expone secrets.
- [ ] Gate `database-reviewer` si hubo cambios SQL (creación/limpieza de usuario de prueba no se versiona; sin migración nueva → puede omitirse, documentar).
- [ ] Verificar el output de cierre del plan Phase 2: `✅ CP7: Phase 2 verified` con la evidencia del checklist §5 adjunta.
- [ ] Commit final: `test(s12): e2e multi-device parity + rollout + quota recheck (CP7)`.
- [ ] `/compact`.
