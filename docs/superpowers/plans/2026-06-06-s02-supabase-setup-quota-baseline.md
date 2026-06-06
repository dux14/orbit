# Orbit S2 — Supabase Setup + Quota Baseline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Research libraries with the **context7 MCP** before writing code; drive Supabase via the **Supabase CLI** (authenticated as `dux14's Org`) and the **Supabase MCP** — never the web UI. Always use **pnpm**.

**Goal:** Ejecutar el Checkpoint 1 de `docs/phase-2-plan.md` — enlazar el proyecto Supabase `vmcjkleuetcogqhdnlfx`, migrar el schema zero-knowledge (vaults, reminders, push_subscriptions) con RLS por `auth.uid()` y la función `upsert_vault` de concurrencia optimista, generar los tipos TypeScript, crear los clientes `@supabase/ssr` (browser + SSR), cablear las env vars (local + Vercel Prod/Preview) tras el feature flag `NEXT_PUBLIC_SYNC_ENABLED=false`, y producir `docs/quota-baseline.md` con el uso actual medido y la proyección del modelo single-blob (spec §3.7).

**Architecture:** No se toca ninguna pantalla de Phase 1. Esta sesión añade la capa de persistencia remota *al lado* de Dexie: el directorio `supabase/` (migraciones + config) y `lib/supabase/` (clientes + tipos). El servidor es zero-knowledge: las tablas almacenan solo ciphertext + meta KDF + verifier. Ningún secret entra al repo ni a los bundles del cliente — solo `NEXT_PUBLIC_*` son públicas. La UI de cuenta/sync queda gateada por `NEXT_PUBLIC_SYNC_ENABLED=false`; esta sesión no enciende nada visible.

**Tech Stack:** Supabase CLI · Postgres + RLS · `@supabase/supabase-js` · `@supabase/ssr` · Next.js 16.2.7 App Router · Vercel CLI · pnpm.

**Datos fijos:** project ref `vmcjkleuetcogqhdnlfx` · URL `https://vmcjkleuetcogqhdnlfx.supabase.co` · publishable (anon) key `sb_publishable_A08tDzURf4HPToHefN_P0g_B8_6Dv-P` (pública, puede ir en el repo/env). El `sb_secret_*` (service role) **nunca** se escribe aquí: se referencia como `<SB_SECRET>` y se toma del gestor de secrets del usuario solo donde sea estrictamente necesario (no en esta sesión).

---

### Task 1: Research de patrones actuales (context7)
**Files:** ninguno (solo lectura/notas)

- [ ] Consultar context7 por `@supabase/ssr` Next.js App Router (Next 16): patrón vigente de `createBrowserClient` / `createServerClient` y manejo de cookies (`getAll`/`setAll`) — la API de cookies cambió entre versiones.
- [ ] Consultar context7 por Supabase CLI: comandos `init`, `link`, `db push`, `gen types typescript --linked`.
- [ ] Anotar en el scratchpad de la sesión la firma exacta de `createServerClient` cookies para validar el código de la Task 6 antes de escribirlo.

---

### Task 2: `supabase init` + link al proyecto
**Files:** `supabase/config.toml` (generado)

- [ ] Verificar la versión del CLI: `supabase --version` (esperado: ≥ 1.x; si falla, está autenticado en `dux14's Org`).
- [ ] Inicializar el directorio Supabase en la raíz del repo: `supabase init`. Output esperado: crea `supabase/config.toml` y `supabase/.gitignore`. Si pregunta por VS Code/Deno settings, responder no.
- [ ] Enlazar el proyecto remoto: `supabase link --project-ref vmcjkleuetcogqhdnlfx`. Si pide la DB password, tomarla del gestor de secrets del usuario (no escribirla aquí). Output esperado: `Finished supabase link.`
- [ ] Confirmar el link: `supabase projects list` muscle el ref `vmcjkleuetcogqhdnlfx` marcado como linked (`●`).
- [ ] Commit: `git add supabase/config.toml supabase/.gitignore && git commit -m "chore(supabase): init + link project vmcjkleuetcogqhdnlfx"` (crear rama primero si estás en `main`).

---

### Task 3: Migración del schema (vaults, reminders, push_subscriptions, RLS, upsert_vault)
**Files:** `supabase/migrations/0001_init.sql`

- [ ] Crear el archivo de migración con timestamp: `supabase migration new init` (genera `supabase/migrations/<ts>_init.sql`). Si prefieres nombre fijo, crea `supabase/migrations/0001_init.sql` manualmente.
- [ ] Escribir el SQL **completo** (copiado tal cual del phase-2-plan §3):

```sql
-- The encrypted vault (one row per user; single-blob model)
create table public.vaults (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  encrypted_meta  text not null,   -- JSON: schemaVersion + kdf{salt,params} + verifier (NO secrets)
  encrypted_blob  text not null,   -- AES-256-GCM ciphertext of VaultData (opaque to server)
  version      bigint not null default 1,
  updated_at   timestamptz not null default now()
);

-- Opt-in, NON-zero-knowledge minimal reminder index (only if cloud reminders enabled)
create table public.reminders (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  service_label text not null,        -- e.g. "Netflix" (no amounts/emails/cards)
  next_renewal  date not null,
  lead_days     int  not null default 3,
  updated_at    timestamptz not null default now()
);

-- Web Push subscriptions (per device)
create table public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  created_at  timestamptz not null default now()
);

alter table public.vaults             enable row level security;
alter table public.reminders          enable row level security;
alter table public.push_subscriptions enable row level security;

-- RLS: a user may only touch their own rows
create policy "own vault"     on public.vaults
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own reminders" on public.reminders
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own pushsubs"  on public.push_subscriptions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Optimistic concurrency: only advance if the client's expected version matches
create or replace function public.upsert_vault(
  p_meta text, p_blob text, p_expected_version bigint
) returns public.vaults language plpgsql security invoker as $$
declare result public.vaults;
begin
  insert into public.vaults as v (user_id, encrypted_meta, encrypted_blob, version, updated_at)
    values (auth.uid(), p_meta, p_blob, 1, now())
  on conflict (user_id) do update
    set encrypted_meta = excluded.encrypted_meta,
        encrypted_blob = excluded.encrypted_blob,
        version        = v.version + 1,
        updated_at     = now()
    where v.version = p_expected_version       -- conflict if mismatch
  returning * into result;
  if result is null then
    raise exception 'version_conflict' using errcode = '40001';
  end if;
  return result;
end $$;
```

- [ ] Aplicar la migración al proyecto enlazado: `supabase db push`. Output esperado: lista la migración `<ts>_init` como `Applying migration ...` y termina con `Finished supabase db push.`
- [ ] Verificar las tablas creadas: `supabase db remote commit` no es necesario; en su lugar comprobar vía MCP/SQL que existen `public.vaults`, `public.reminders`, `public.push_subscriptions` y la función `public.upsert_vault`.
- [ ] Commit: `git add supabase/migrations && git commit -m "feat(supabase): init migration — vaults/reminders/push_subscriptions + RLS + upsert_vault"`.

---

### Task 4: Verificar RLS (denegación cross-user)
**Files:** `supabase/migrations/0001_init.sql` (sin cambios; solo verificación documentada)

- [ ] Vía Supabase MCP / SQL editor, crear dos usuarios de prueba (o usar dos JWT de prueba `auth.uid()` distintos). Confirmar que con el JWT del usuario A **no** se puede `select` ni `update` la fila `vaults` del usuario B.
- [ ] Confirmar que `upsert_vault` corre con `security invoker` (respeta RLS del llamante, no la del owner de la función).
- [ ] Confirmar que la anon key (`sb_publishable_...`) sin sesión no puede leer ninguna fila de las tres tablas (RLS niega por defecto sin `auth.uid()`).
- [ ] Documentar el resultado de la verificación como bloque de comentario al final de `0001_init.sql`:

```sql
-- RLS verification (S2, 2026-06-06):
-- user A cannot SELECT/UPDATE user B's vaults row → denied ✔
-- upsert_vault runs as security invoker, RLS-respecting ✔
-- anon key (no session) reads 0 rows on all three tables ✔
```

- [ ] Commit: `git add supabase/migrations && git commit -m "test(supabase): document RLS cross-user denial verification"`.

---

### Task 5: Generar tipos TypeScript
**Files:** `lib/supabase/database.types.ts`

- [ ] Generar los tipos desde el proyecto enlazado: `supabase gen types typescript --linked > lib/supabase/database.types.ts`. Output esperado: el archivo contiene `export type Database = { public: { Tables: { vaults: ..., reminders: ..., push_subscriptions: ... }, Functions: { upsert_vault: ... } } }`.
- [ ] Typecheck limpio: `pnpm exec tsc --noEmit` (o `pnpm lint`). Output esperado: sin errores.
- [ ] Commit: `git add lib/supabase/database.types.ts && git commit -m "feat(supabase): generated DB types"`.

---

### Task 6: Instalar SDK + clientes browser/SSR
**Files:** `lib/supabase/client.ts`, `lib/supabase/server.ts`, `package.json`

- [ ] Instalar dependencias: `pnpm add @supabase/supabase-js @supabase/ssr`. Output esperado: ambas añadidas a `dependencies`.
- [ ] Crear `lib/supabase/client.ts` (cliente de navegador):

```ts
'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { Database } from './database.types';

/**
 * Browser Supabase client (singleton-friendly: createBrowserClient memoizes
 * internally per env-var pair). Uses only the public anon/publishable key.
 */
export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
```

- [ ] Crear `lib/supabase/server.ts` (cliente SSR con cookies de Next):

```ts
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import type { Database } from './database.types';

/**
 * Server Supabase client for Route Handlers / Server Components.
 * Reads & writes the session via Next's cookie store. The setAll try/catch
 * guards the RSC case where cookies are read-only (refresh is handled by proxy.ts).
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Called from a Server Component — cookies are read-only here.
            // Session refresh happens in proxy.ts, so this is safe to ignore.
          }
        },
      },
    },
  );
}
```

- [ ] Validar el código contra la firma de cookies anotada en la Task 1 (si context7 indicó una API distinta para Next 16, ajustar `getAll`/`setAll`).
- [ ] Typecheck: `pnpm exec tsc --noEmit`. Output esperado: sin errores (las env vars `!` son intencionales; existen en runtime).
- [ ] Commit: `git add lib/supabase package.json pnpm-lock.yaml && git commit -m "feat(supabase): browser + SSR clients (@supabase/ssr)"`.

---

### Task 7: Env vars locales + Vercel + feature flag
**Files:** `.env.local` (NO commiteado — `.gitignore` ya cubre `.env*`)

- [ ] Confirmar que `.gitignore` ignora `.env*` (ya verificado: línea `# env files` → `.env*`). No tocar `.gitignore`.
- [ ] Crear `.env.local` con las vars públicas y el flag OFF:

```
NEXT_PUBLIC_SUPABASE_URL=https://vmcjkleuetcogqhdnlfx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=sb_publishable_A08tDzURf4HPToHefN_P0g_B8_6Dv-P
NEXT_PUBLIC_SYNC_ENABLED=false
```

- [ ] Verificar que `.env.local` NO aparece en `git status` (debe estar ignorado): `git status --porcelain | grep env.local` → sin salida.
- [ ] Añadir las vars en Vercel para Production y Preview (3 vars × 2 entornos). Usar el CLI:
  - `printf 'https://vmcjkleuetcogqhdnlfx.supabase.co' | vercel env add NEXT_PUBLIC_SUPABASE_URL production`
  - `printf 'https://vmcjkleuetcogqhdnlfx.supabase.co' | vercel env add NEXT_PUBLIC_SUPABASE_URL preview`
  - `printf 'sb_publishable_A08tDzURf4HPToHefN_P0g_B8_6Dv-P' | vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY production`
  - `printf 'sb_publishable_A08tDzURf4HPToHefN_P0g_B8_6Dv-P' | vercel env add NEXT_PUBLIC_SUPABASE_ANON_KEY preview`
  - `printf 'false' | vercel env add NEXT_PUBLIC_SYNC_ENABLED production`
  - `printf 'false' | vercel env add NEXT_PUBLIC_SYNC_ENABLED preview`
- [ ] Verificar: `vercel env ls` lista las 3 vars en Production y Preview. Output esperado: 6 entradas.
- [ ] **No** añadir el service role key (`<SB_SECRET>`) en esta sesión — no se usa aún (Edge Functions llegan en S10). Cuando se necesite, irá solo como secret de la Edge Function vía `supabase secrets set`, nunca como `NEXT_PUBLIC_*`.

---

### Task 8: Baseline de cuotas → `docs/quota-baseline.md`
**Files:** `docs/quota-baseline.md`

- [ ] Medir el uso actual de Vercel: `vercel` CLI / MCP. Capturar bandwidth del mes en curso, invocaciones de funciones y build minutes del proyecto Orbit. (Si el CLI no expone bandwidth, anotarlo desde el dashboard y marcar la fuente.)
- [ ] Medir el uso actual de Supabase: tamaño de DB (`supabase db remote` / dashboard → Database size), MAU (Auth → Users), mensajes Realtime del mes. El proyecto está recién creado, así que los valores serán ~0; documentarlo como baseline limpio.
- [ ] Calcular la proyección del modelo single-blob: tamaño típico del blob cifrado por usuario en KB (estimar: VaultData con ~20 suscripciones + credenciales ≈ unos pocos KB de plaintext → +overhead AES-GCM/base64 ≈ ~1.35×). DB no es riesgo; el riesgo es Realtime/requests → confirmar que el debounce de sync (CP3) mitiga.
- [ ] Escribir `docs/quota-baseline.md` con esta estructura exacta (rellenar las celdas `<medir>` con los valores reales):

````markdown
# Orbit — Quota Baseline (Phase 2, S2)

**Fecha de medición:** 2026-06-06
**Medido por:** S2 (Supabase setup)
**Re-chequeo programado:** S12 (CP7)

## 1. Vercel (plan Hobby)

| Métrica | Límite Hobby | Uso actual (medido) | Fuente |
|---|---|---|---|
| Bandwidth | 100 GB / mes | `<medir>` | `vercel` CLI/MCP |
| Invocaciones de función (Fluid Compute) | ver plan | `<medir>` | `vercel` CLI/MCP |
| Build minutes | ver plan | `<medir>` | dashboard |
| Edge requests | ver plan | `<medir>` | dashboard |

## 2. Supabase (plan Free)

| Métrica | Límite Free | Uso actual (medido) | Fuente |
|---|---|---|---|
| DB size | 500 MB | `<medir>` (proyecto nuevo ≈ 0) | `supabase` / dashboard |
| MAU | 50.000 | `<medir>` (≈ 0) | Auth → Users |
| Realtime msgs | 2.000.000 / mes | `<medir>` (≈ 0) | dashboard |
| Pausa por inactividad | 7 días sin actividad | N/A — pg_cron de CP5 mantiene actividad | spec §3.7 |

## 3. Proyección — modelo single-blob

| Concepto | Estimación | Notas |
|---|---|---|
| Plaintext VaultData / usuario típico | `<medir>` KB | ~20 subs + credenciales + payment methods |
| Blob cifrado / usuario (base64, ~1.35×) | `<medir>` KB | AES-256-GCM + overhead base64 |
| Filas en `vaults` por usuario | 1 | single-blob |
| DB usada con 1.000 usuarios | `<calcular>` MB | << 500 MB → DB **no** es riesgo |
| Realtime msgs / usuario activo / día | `<estimar>` | depende del debounce de sync |

**Riesgo principal:** Realtime + requests, no almacenamiento. Mitigación: debounce agresivo del push de sync (CP3, ya contemplado en el plan) + reconcile en focus/unlock, no por keystroke.

## 4. Umbrales de alerta

| Recurso | Umbral amarillo | Umbral rojo | Acción |
|---|---|---|---|
| Vercel bandwidth | 70 GB/mes (70%) | 90 GB/mes (90%) | revisar assets/SSR; considerar plan Pro |
| Supabase DB | 350 MB (70%) | 450 MB (90%) | revisar tamaño de blobs; per-record sync (Phase 2.5) |
| Supabase Realtime | 1.4M/mes (70%) | 1.8M/mes (90%) | endurecer debounce; reducir suscripciones |
| Supabase MAU | 35.000 (70%) | 45.000 (90%) | evaluar plan Pro |

## 5. Conclusión

`<rellenar tras medir>` — confirmar que la proyección cabe en free tier con margen documentado (criterio de éxito global #6).
````

- [ ] Commit: `git add docs/quota-baseline.md && git commit -m "docs: quota baseline (Vercel + Supabase) for Phase 2"`.

---

### Task 9: Gates y cierre
**Files:** todos los de la sesión

- [ ] Gate **database-reviewer**: revisar la migración `0001_init.sql` (tablas, RLS `with check` en writes, `upsert_vault` con `security invoker` + errcode `40001`). Atender feedback.
- [ ] Gate **/code-review**: revisar el diff completo de la sesión (clientes Supabase, tipos, env handling). Atender hallazgos.
- [ ] Verificación final: `pnpm test` verde, `pnpm exec tsc --noEmit` limpio, `pnpm build` exitoso (las env vars públicas existen en local).
- [ ] Confirmar el output de checkpoint: `✅ CP1: Supabase project linked, schema + RLS migrated, types generated` + baseline de cuotas escrito.
- [ ] Commit final si quedaron cambios de los gates, luego `/compact`.

---

**Notas de seguridad de esta sesión:**
- Ningún secret en el repo: solo `sb_publishable_*` (pública) y el flag. El `<SB_SECRET>` (service role) NO se usa ni se escribe en S2.
- La rotación de secrets expuestos en el chat ocurre en **S4** (CP2), no aquí.
- `.env.local` confirmado ignorado por `.gitignore` (`.env*`).
