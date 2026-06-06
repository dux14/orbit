# Orbit S4 — Google OAuth + SSR Sessions + Secret Rotation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Research libraries with the **context7 MCP** before writing code; drive Supabase via the **Supabase CLI** + **MCP** and Vercel via the **Vercel CLI** — never the web UI where a CLI exists. Always use **pnpm**. **Requiere que S2 (CP1) esté completo** (clientes `lib/supabase/*`, tipos, env vars, migración aplicada).

**Goal:** Ejecutar el Checkpoint 2 de `docs/phase-2-plan.md` — habilitar Google OAuth en Supabase Auth, implementar el flujo SSR (callback PKCE, refresh de sesión en `proxy.ts`, auth store, botón "Continuar con Google" en Settings detrás de `NEXT_PUBLIC_SYNC_ENABLED`), extender el CSP de `proxy.ts` para permitir el origen Supabase en `connect-src`, y **rotar los secrets expuestos** (service role `sb_secret_*` y client secret de Google) actualizando todas las referencias.

**Architecture:** La cuenta es **opcional** (local-first se preserva): el sign-in se ofrece en Settings, NO en onboarding. El flujo OAuth es PKCE vía Supabase Auth; el callback (`app/auth/callback/route.ts`) intercambia el code por sesión y setea cookies; `proxy.ts` refresca la sesión en cada request usando el patrón middleware de `@supabase/ssr` **sin debilitar el nonce-CSP existente** (merge, no replace). El auth store (Zustand) expone `signInWithGoogle`/`signOut` y escucha `onAuthStateChange`. Toda la UI de cuenta queda gateada por el flag — encenderla es decisión de CP7. El servidor sigue zero-knowledge: OAuth solo identifica *qué* filas RLS puede tocar el usuario, no concede acceso a plaintext.

**Tech Stack:** Supabase Auth (Google provider) · `@supabase/ssr` · Next.js 16.2.7 App Router (Route Handlers + proxy) · Zustand · Vercel CLI · pnpm.

**Datos fijos:** project ref `vmcjkleuetcogqhdnlfx` · URL `https://vmcjkleuetcogqhdnlfx.supabase.co` · Google client ID `457451718899-gp6onihjafeao8ai9cd3m4pb3eppf450.apps.googleusercontent.com` (público) · redirect ya registrado en Google Cloud: `https://vmcjkleuetcogqhdnlfx.supabase.co/auth/v1/callback`. Secrets referenciados como `<SB_SECRET>` (service role) y `<GOOGLE_CLIENT_SECRET>` (formato `GOCSPX-*`): se toman del gestor de secrets del usuario, **nunca** se escriben en el repo ni en estos planes.

---

### Task 1: Research de patrones actuales (context7)
**Files:** ninguno (solo lectura/notas)

- [ ] Consultar context7 por `@supabase/ssr`: patrón vigente de refresh de sesión en middleware/proxy para Next 16 (`createServerClient` con cookies de `NextRequest`/`NextResponse`, `getUser()` para forzar refresh).
- [ ] Consultar context7 por `supabase.auth.signInWithOAuth({ provider: 'google' })` (flujo PKCE, `redirectTo`) y por `exchangeCodeForSession` en un Route Handler.
- [ ] Consultar context7/Supabase docs por la config del provider Google: si se hace vía `supabase/config.toml` (`[auth.external.google]`) + `supabase secrets` o vía dashboard. Anotar la decisión para la Task 2.

---

### Task 2: Configurar el provider Google en Supabase
**Files:** `supabase/config.toml` (posible edición)

- [ ] Configurar el provider Google. Seguir lo que indique phase-2-plan.md (Task 2.2: "In Supabase Auth settings (CLI/dashboard config), enable Google, set client id/secret + redirect"). Preferir CLI/config:
  - En `supabase/config.toml`, añadir/confirmar el bloque:
    ```toml
    [auth.external.google]
    enabled = true
    client_id = "457451718899-gp6onihjafeao8ai9cd3m4pb3eppf450.apps.googleusercontent.com"
    secret = "env(SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET)"
    redirect_uri = "https://vmcjkleuetcogqhdnlfx.supabase.co/auth/v1/callback"
    ```
  - El secret se inyecta por env, **no** se escribe literal. Como el proyecto es remoto (linked, no local), aplicar la config del provider en el dashboard de Supabase Auth → Providers → Google, o vía `supabase secrets set` según lo investigado en Task 1. Pegar el client ID público y el `<GOOGLE_CLIENT_SECRET>` (tomado del gestor de secrets) en el campo de secret.
- [ ] Confirmar que el redirect URL autorizado en Google Cloud Console ya incluye `https://vmcjkleuetcogqhdnlfx.supabase.co/auth/v1/callback` (dato fijo: ya registrado).
- [ ] Añadir los redirect URLs de la app en Supabase Auth → URL Configuration: la URL de producción y la(s) de preview de Vercel (`https://*.vercel.app` o el dominio concreto) → ruta `/auth/callback`.
- [ ] Commit (si se editó config.toml, sin secrets): `git add supabase/config.toml && git commit -m "feat(auth): enable Google OAuth provider config"`.

---

### Task 3: Refresh de sesión SSR en `proxy.ts` (merge con el CSP existente)
**Files:** `proxy.ts`

El `proxy.ts` actual genera un nonce y aplica un CSP estricto solo en producción. Hay que **añadir** el refresh de sesión Supabase sin tocar la lógica de nonce/CSP, y extender `connect-src`.

- [ ] Leer el `proxy.ts` actual (ya conocido). El CSP de producción tiene: `connect-src 'self' https://open.er-api.com;`.
- [ ] Diff exacto del CSP — extender `connect-src` con el origen Supabase (HTTPS para REST/Auth y WSS para Realtime de CP3):

```diff
-      connect-src 'self' https://open.er-api.com;
+      connect-src 'self' https://open.er-api.com https://vmcjkleuetcogqhdnlfx.supabase.co wss://vmcjkleuetcogqhdnlfx.supabase.co;
```

- [ ] Reescribir `proxy.ts` para que la función sea `async` y refresque la sesión Supabase en cada request, conservando intacta la lógica de nonce + CSP + headers de seguridad. Resultado completo:

```ts
import { NextRequest, NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";

export async function proxy(request: NextRequest) {
  const isDev = process.env.NODE_ENV === "development";
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);

  // Base response that the Supabase client will attach refreshed cookies to.
  let response = NextResponse.next({ request: { headers: requestHeaders } });

  // Refresh the Supabase session (no-op when signed out). Cookies set here
  // propagate to both the request (for RSC) and the response (for the browser).
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          response = NextResponse.next({ request: { headers: requestHeaders } });
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    }
  );

  // IMPORTANT: getUser() (not getSession()) revalidates the token and triggers refresh.
  await supabase.auth.getUser();

  if (!isDev) {
    // Production-only CSP: wasm-unsafe-eval is required for hash-wasm (argon2id)
    const cspHeader = `
      default-src 'self';
      script-src 'self' 'nonce-${nonce}' 'strict-dynamic' 'wasm-unsafe-eval';
      style-src 'self' 'unsafe-inline';
      connect-src 'self' https://open.er-api.com https://vmcjkleuetcogqhdnlfx.supabase.co wss://vmcjkleuetcogqhdnlfx.supabase.co;
      img-src 'self' data:;
      font-src 'self';
      object-src 'none';
      base-uri 'self';
      form-action 'self';
      frame-ancestors 'none';
      upgrade-insecure-requests;
    `
      .replace(/\s{2,}/g, " ")
      .trim();

    requestHeaders.set("Content-Security-Policy", cspHeader);
    response.headers.set("Content-Security-Policy", cspHeader);
    response.headers.set("X-Content-Type-Options", "nosniff");
    response.headers.set("X-Frame-Options", "DENY");
    response.headers.set("Referrer-Policy", "no-referrer");
    response.headers.set(
      "Strict-Transport-Security",
      "max-age=63072000; includeSubDomains; preload"
    );
    response.headers.set(
      "Permissions-Policy",
      "camera=(), microphone=(), geolocation=()"
    );
  }

  // In development: skip CSP (Next.js dev overlay requires unsafe-eval). The
  // nonce header is still passed so layout.tsx can read it.
  return response;
}

export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
```

- [ ] Typecheck: `pnpm exec tsc --noEmit`. Verificar que el dev overlay sigue funcionando (`pnpm dev`) y que `pnpm build` produce el CSP con el origen Supabase.
- [ ] Verificar el header en una build de producción local o preview: el `Content-Security-Policy` debe contener `https://vmcjkleuetcogqhdnlfx.supabase.co` y `wss://vmcjkleuetcogqhdnlfx.supabase.co`.
- [ ] Commit: `git add proxy.ts && git commit -m "feat(auth): SSR session refresh in proxy + Supabase origins in CSP connect-src"`.

---

### Task 4: Callback route (PKCE code exchange)
**Files:** `app/auth/callback/route.ts`

- [ ] Crear `app/auth/callback/route.ts`:

```ts
import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';

/**
 * OAuth callback: exchanges the PKCE `code` for a session (cookies set via the
 * SSR client), then redirects to `next` (default the settings/account screen).
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  const next = searchParams.get('next') ?? '/settings';

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  // On failure, send the user back to settings with an error flag.
  return NextResponse.redirect(`${origin}/settings?auth_error=1`);
}
```

- [ ] Typecheck: `pnpm exec tsc --noEmit`.
- [ ] Commit: `git add app/auth/callback/route.ts && git commit -m "feat(auth): OAuth callback route (PKCE exchange)"`.

---

### Task 5: Auth store + hook de sesión (con tests)
**Files:** `lib/store/auth-store.ts`, `lib/store/auth-store.test.ts`

- [ ] Crear `lib/store/auth-store.ts` (Zustand) — sesión/usuario, `signInWithGoogle`, `signOut`, suscripción a `onAuthStateChange`:

```ts
import { create } from 'zustand';
import type { Session, User } from '@supabase/supabase-js';
import { createClient } from '@/lib/supabase/client';

interface AuthState {
  user: User | null;
  session: Session | null;
  initialized: boolean;
  init: () => () => void;
  signInWithGoogle: () => Promise<void>;
  signOut: () => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  session: null,
  initialized: false,

  /** Hydrate from the current session and subscribe to auth changes.
   *  Returns an unsubscribe fn (call from an effect cleanup). */
  init: () => {
    const supabase = createClient();
    void supabase.auth.getSession().then(({ data }) => {
      set({ session: data.session, user: data.session?.user ?? null, initialized: true });
    });
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      set({ session, user: session?.user ?? null, initialized: true });
    });
    return () => sub.subscription.unsubscribe();
  },

  signInWithGoogle: async () => {
    const supabase = createClient();
    await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: `${window.location.origin}/auth/callback?next=/settings` },
    });
  },

  signOut: async () => {
    const supabase = createClient();
    await supabase.auth.signOut();
    set({ session: null, user: null });
  },
}));
```

- [ ] Crear `lib/store/auth-store.test.ts` — test del helper con el cliente Supabase mockeado (TDD: escribir test, ver fallar, implementar/ajustar):

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';

const signOut = vi.fn().mockResolvedValue({ error: null });
const getSession = vi.fn().mockResolvedValue({ data: { session: null } });
const onAuthStateChange = vi.fn().mockReturnValue({
  data: { subscription: { unsubscribe: vi.fn() } },
});
const signInWithOAuth = vi.fn().mockResolvedValue({ data: {}, error: null });

vi.mock('@/lib/supabase/client', () => ({
  createClient: () => ({
    auth: { signOut, getSession, onAuthStateChange, signInWithOAuth },
  }),
}));

import { useAuthStore } from './auth-store';

describe('auth-store', () => {
  beforeEach(() => {
    useAuthStore.setState({ user: null, session: null, initialized: false });
    vi.clearAllMocks();
  });

  it('init subscribes and returns an unsubscribe fn', () => {
    const unsub = useAuthStore.getState().init();
    expect(onAuthStateChange).toHaveBeenCalledOnce();
    expect(typeof unsub).toBe('function');
  });

  it('signInWithGoogle calls signInWithOAuth with the google provider', async () => {
    // jsdom provides window.location.origin
    await useAuthStore.getState().signInWithGoogle();
    expect(signInWithOAuth).toHaveBeenCalledWith(
      expect.objectContaining({ provider: 'google' }),
    );
  });

  it('signOut clears the session', async () => {
    useAuthStore.setState({ session: {} as never, user: {} as never });
    await useAuthStore.getState().signOut();
    expect(signOut).toHaveBeenCalledOnce();
    expect(useAuthStore.getState().user).toBeNull();
  });
});
```

- [ ] Ejecutar: `pnpm test auth-store`. Output esperado: 3 tests verdes.
- [ ] Commit: `git add lib/store/auth-store.ts lib/store/auth-store.test.ts && git commit -m "feat(auth): auth store + unit tests"`.

---

### Task 6: Botón "Continuar con Google" en Settings (detrás del flag, NO en onboarding)
**Files:** `app/(vault)/settings/page.tsx`, `lib/i18n/dict.ts`

- [ ] Añadir claves i18n a `lib/i18n/dict.ts` (es + en), por ejemplo:
  - `settings.account` → "Cuenta" / "Account"
  - `settings.signInGoogle` → "Continuar con Google" / "Continue with Google"
  - `settings.signOut` → "Cerrar sesión" / "Sign out"
  - `settings.signedInAs` → "Sesión iniciada como {email}" / "Signed in as {email}"
  - `settings.syncDisabledHint` → "Inicia sesión para sincronizar tu bóveda entre dispositivos (opcional)." / "Sign in to sync your vault across devices (optional)."
- [ ] En `app/(vault)/settings/page.tsx`, añadir una sección **Account** gateada por el flag. La cuenta es opcional: vive en Settings, nunca en onboarding. Patrón:

```tsx
'use client';

import { useEffect } from 'react';
import { useT } from '@/lib/i18n/use-t';
import { useAuthStore } from '@/lib/store/auth-store';

const SYNC_ENABLED = process.env.NEXT_PUBLIC_SYNC_ENABLED === 'true';

function AccountSection() {
  const t = useT();
  const { user, signInWithGoogle, signOut, init } = useAuthStore();

  useEffect(() => {
    const unsub = init();
    return unsub;
  }, [init]);

  if (!SYNC_ENABLED) return null; // flag OFF → account UI hidden entirely

  return (
    <section aria-labelledby="account-heading">
      <h2 id="account-heading">{t('settings.account')}</h2>
      {user ? (
        <div>
          <p>{t('settings.signedInAs', { email: user.email ?? '' })}</p>
          <button type="button" onClick={() => void signOut()}>
            {t('settings.signOut')}
          </button>
        </div>
      ) : (
        <div>
          <p>{t('settings.syncDisabledHint')}</p>
          <button type="button" onClick={() => void signInWithGoogle()}>
            {t('settings.signInGoogle')}
          </button>
        </div>
      )}
    </section>
  );
}
```

  - Integrar `<AccountSection />` en el render de la página de Settings, respetando los componentes/estilos existentes (botones con target ≥44px, i18n vía `useT`). Adaptar el JSX a los componentes UI reales del proyecto al implementar.
- [ ] Verificar que con `NEXT_PUBLIC_SYNC_ENABLED=false` (estado actual) la sección NO se renderiza, y que onboarding sigue sin mención de cuenta.
- [ ] Typecheck + tests: `pnpm exec tsc --noEmit` y `pnpm test`.
- [ ] Commit: `git add app lib/i18n/dict.ts && git commit -m "feat(auth): optional Account section in Settings (flag-gated)"`.

---

### Task 7: Verificación E2E manual del login Google (checklist documentado)
**Files:** ninguno (verificación; documentar resultado en el PR/commit message)

El login Google **no es automatizable** sin una cuenta de prueba real con consentimiento OAuth, y OAuth necesita un origen HTTPS real (no localhost para el flujo completo). Por eso este paso es un checklist manual sobre un preview de Vercel con el flag temporalmente en `true`.

- [ ] Desplegar un preview de Vercel con `NEXT_PUBLIC_SYNC_ENABLED=true` (override temporal solo para validar; NO promover a prod con el flag ON — eso es decisión de CP7).
- [ ] Checklist manual (ejecutar en el preview, anotar OK/FALLO):
  - [ ] Abrir `/settings` → la sección **Account** aparece con "Continuar con Google".
  - [ ] Click → redirige a Google → consentimiento → vuelve a `/auth/callback` → aterriza en `/settings` con sesión iniciada (muestra el email).
  - [ ] Recargar la página → la sesión persiste (cookies SSR refrescadas por `proxy.ts`).
  - [ ] Click "Cerrar sesión" → la sesión se limpia, vuelve a mostrar el botón de sign-in.
  - [ ] Abrir DevTools → Network: no hay errores de CSP contra `vmcjkleuetcogqhdnlfx.supabase.co` (REST/Auth permitidos por `connect-src`).
  - [ ] Onboarding (`/onboarding`) NO menciona cuenta (sigue siendo local-first).
- [ ] Restaurar el flag del preview a `false` tras validar.
- [ ] Documentar el resultado del checklist en el commit/PR de cierre.

---

### Task 8: ROTACIÓN DE SECRETS (obligatoria — los anteriores quedaron expuestos en un chat)
**Files:** ninguno en repo (solo dashboards + env)

Tanto el `sb_secret_*` (service role) como el `<GOOGLE_CLIENT_SECRET>` (`GOCSPX-*`) fueron expuestos en el chat de planificación. Hay que rotarlos tras configurar OAuth y actualizar todas las referencias.

- [ ] **Rotar el service role key de Supabase:** Dashboard Supabase → Project Settings → API → Service role / secret keys → "Roll" / "Generate new secret key". Esto invalida el `sb_secret_*` anterior. Guardar el nuevo `<SB_SECRET>` en el gestor de secrets del usuario.
  - [ ] Actualizar las referencias del service role allí donde se use. En S4 aún no se consume en runtime (Edge Functions llegan en S10), así que: confirmar que NO está en ninguna `NEXT_PUBLIC_*`, ni en `.env.local`, ni en Vercel env de cliente. Si existe un secret de Supabase Edge Functions, actualizarlo con `supabase secrets set <NAME>=<SB_SECRET>` (sin escribir el valor en el repo).
- [ ] **Rotar el client secret de Google:** Google Cloud Console → APIs & Services → Credentials → el OAuth 2.0 Client ID `457451718899-...` → "Add secret" (rotación sin downtime: crear el nuevo, dejar el viejo activo temporalmente) → guardar `<GOOGLE_CLIENT_SECRET>` nuevo en el gestor de secrets.
  - [ ] Actualizar el secret del provider Google en Supabase Auth (Dashboard → Auth → Providers → Google, o `supabase secrets`/config según Task 2) con el `<GOOGLE_CLIENT_SECRET>` nuevo.
  - [ ] Verificar que el login sigue funcionando (re-correr el checklist de la Task 7, al menos el flujo sign-in → callback → sesión).
  - [ ] Tras confirmar que el nuevo secret funciona, **eliminar el client secret antiguo** en Google Cloud Console (Disable/Delete del secret expuesto).
- [ ] **Verificación final de exposición:** `git grep -nE 'GOCSPX-|sb_secret_' -- ':!docs/'` (se excluye `docs/` porque los planes mencionan los patrones como texto) → sin resultados. Confirmar que el client ID público y la `sb_publishable_*` son lo único presente.
- [ ] Documentar en el commit/PR de cierre: "secrets rotados (Supabase service role + Google client secret); anteriores revocados; flujo verificado".

---

### Task 9: Gates y cierre
**Files:** todos los de la sesión

- [ ] Gate **/security-review** (auth + secrets): revisar el flujo OAuth (PKCE, callback, cookies SSR), el CSP extendido, y la rotación de secrets. Confirmar que ningún secret entra al repo ni a bundles cliente; que `connect-src` solo añade el origen Supabase necesario; que la cuenta es opcional y el flag gatea la UI.
- [ ] Gate **typescript-reviewer** (diffs .ts/.tsx sustanciales): `proxy.ts`, `lib/supabase/*`, `lib/store/auth-store.ts`, callback route, Settings.
- [ ] Gate **/code-review**: diff completo de la sesión.
- [ ] Verificación final: `pnpm test` verde (incl. `auth-store.test.ts`), `pnpm exec tsc --noEmit` limpio, `pnpm build` exitoso, `git grep -nE 'GOCSPX-|sb_secret_' -- ':!docs/'` vacío.
- [ ] Confirmar el output de checkpoint: `✅ CP2: Google sign-in + SSR session + sign-out` + secrets rotados.
- [ ] Commit final de cualquier cambio de los gates, luego `/compact`.

---

**Notas de seguridad de esta sesión:**
- Cuenta **opcional**: sign-in en Settings, nunca en onboarding. Local-first intacto.
- UI de cuenta gateada por `NEXT_PUBLIC_SYNC_ENABLED` (sigue en `false` tras esta sesión; encenderlo es CP7).
- CSP: merge, no replace — el nonce + `strict-dynamic` + `wasm-unsafe-eval` se conservan; solo se añade el origen Supabase a `connect-src` (HTTPS + WSS).
- Rotación obligatoria de `<SB_SECRET>` y `<GOOGLE_CLIENT_SECRET>` con verificación de que los anteriores quedan revocados y ausentes del repo.
