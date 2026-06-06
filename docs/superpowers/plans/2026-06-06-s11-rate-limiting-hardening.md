# S11 — Rate limiting + hardening + auditoría RLS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Research librerías con el **context7 MCP** antes de escribir código; conduce Supabase con el **Supabase CLI** y MCP — nunca por la web UI. SIEMPRE `pnpm`.

**Goal:** Implementar la sesión S11 = Checkpoint 6 de `docs/phase-2-plan.md`: rate limiting en los puntos sensibles (sign-in, `upsert_vault`, función de reminders), auditoría RLS completa contra cada tabla con un segundo usuario de prueba (B no puede leer/escribir el vault de A; anon no puede nada), revisión de grants y `security` de funciones, hardening de headers/CSP en `proxy.ts` tras los cambios de S4, y verificación de que no hay secrets en el bundle de build.

**Architecture:** El servidor sigue siendo zero-knowledge para el vault. El rate limiting se aplica en dos planos: (1) capa de DB para `upsert_vault` (contador por usuario/ventana en una tabla `rate_limits`, chequeado dentro de la función `security definer`), y (2) Supabase Auth ya limita sign-in nativamente (documentar/configurar). La función `send-reminders` solo la dispara `pg_cron` con service role, por lo que su superficie pública es nula (auth `Bearer service_role`). La auditoría RLS usa dos usuarios reales de prueba creados vía CLI y queries cruzadas. El CSP de `proxy.ts` se extiende a los orígenes Supabase (`connect-src` https + `wss://` realtime) sin debilitar el `script-src` nonce-strict.

**Tech Stack:** Next.js 16.2.7 `proxy.ts` (CSP nonce) · Supabase (Postgres RLS + funciones plpgsql) · Supabase Auth rate limits · Vitest · `pnpm`. Sin Upstash (se prefiere rate limiting nativo de DB para mantener el free tier y evitar una dependencia externa).

---

## 0. Decisiones bloqueadas (no re-litigar)

| Tema | Decisión |
|---|---|
| Rate limiting de vault | En DB: contador por usuario+ventana dentro de `upsert_vault` (ahora `security definer`). Evita Upstash y mantiene zero-knowledge. |
| Rate limiting de auth | Supabase Auth nativo (rate limits de OTP/OAuth configurables). Documentar valores. |
| `send-reminders` | Sin superficie pública: solo `pg_cron` con `Bearer service_role`. Ya cubierto en S10. |
| CSP | Extender `connect-src` a `https://vmcjkleuetcogqhdnlfx.supabase.co` y `wss://vmcjkleuetcogqhdnlfx.supabase.co`. `script-src` nonce-strict intacto. |
| Secrets | Solo `NEXT_PUBLIC_*` en el bundle. `sb_secret_*`, service role, VAPID privada nunca en `.next`. |

---

## Task 1: Auditoría RLS con dos usuarios de prueba (SQL completo)

**Files:** `supabase/tests/rls-audit.sql` (nuevo, versionado como evidencia)

- [ ] Crear dos usuarios de prueba vía CLI/SQL (en el proyecto linked). Usar el SQL editor del MCP:
  ```sql
  -- Create two confirmed test users (idempotent).
  -- Run in the Supabase SQL editor / MCP (admin context).
  insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role)
  values
    ('aaaaaaaa-0000-0000-0000-000000000001', 'rls-a@orbit.test', crypt('Passw0rd!A', gen_salt('bf')), now(), 'authenticated', 'authenticated'),
    ('bbbbbbbb-0000-0000-0000-000000000002', 'rls-b@orbit.test', crypt('Passw0rd!B', gen_salt('bf')), now(), 'authenticated', 'authenticated')
  on conflict (id) do nothing;
  ```
- [ ] Sembrar una fila de vault para A (admin context):
  ```sql
  insert into public.vaults (user_id, encrypted_meta, encrypted_blob, version)
  values ('aaaaaaaa-0000-0000-0000-000000000001', '{"meta":"A"}', 'ciphertext-A', 1)
  on conflict (user_id) do update set encrypted_blob = excluded.encrypted_blob;
  ```
- [ ] Crear `supabase/tests/rls-audit.sql` con las queries de verificación. Cada bloque simula el JWT de un usuario con `set local role authenticated` + `set local request.jwt.claims`:
  ```sql
  -- ── RLS AUDIT (S11) ─────────────────────────────────────────────────────────
  -- Run each block in the SQL editor. Expected results annotated inline.
  -- Helper to impersonate a user within a transaction:
  --   set local role authenticated;
  --   set local request.jwt.claims = '{"sub":"<uid>","role":"authenticated"}';

  -- 1. User B CANNOT read A's vault.
  begin;
    set local role authenticated;
    set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';
    select count(*) as b_sees_a_rows
    from public.vaults
    where user_id = 'aaaaaaaa-0000-0000-0000-000000000001';
    -- EXPECTED: b_sees_a_rows = 0
  rollback;

  -- 2. User B CANNOT update A's vault.
  begin;
    set local role authenticated;
    set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';
    update public.vaults set encrypted_blob = 'HIJACK'
    where user_id = 'aaaaaaaa-0000-0000-0000-000000000001';
    -- EXPECTED: UPDATE 0 (RLS using-clause filters out A's row)
  rollback;

  -- 3. User B CANNOT insert a row owned by A (with check blocks it).
  begin;
    set local role authenticated;
    set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';
    insert into public.vaults (user_id, encrypted_meta, encrypted_blob, version)
    values ('aaaaaaaa-0000-0000-0000-000000000001', '{}', 'x', 1);
    -- EXPECTED: ERROR  new row violates row-level security policy
  rollback;

  -- 4. User A CAN read A's own vault.
  begin;
    set local role authenticated;
    set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
    select count(*) as a_sees_own from public.vaults where user_id = 'aaaaaaaa-0000-0000-0000-000000000001';
    -- EXPECTED: a_sees_own = 1
  rollback;

  -- 5. anon role CANNOT read ANY vault.
  begin;
    set local role anon;
    set local request.jwt.claims = '{"role":"anon"}';
    select count(*) as anon_sees from public.vaults;
    -- EXPECTED: anon_sees = 0
  rollback;

  -- 6. Repeat 1/2/5 for reminders.
  begin;
    set local role authenticated;
    set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';
    select count(*) as b_sees_a_reminders from public.reminders
    where user_id = 'aaaaaaaa-0000-0000-0000-000000000001';
    -- EXPECTED: 0
  rollback;
  begin;
    set local role anon;
    select count(*) as anon_sees_reminders from public.reminders;
    -- EXPECTED: 0
  rollback;

  -- 7. Repeat for push_subscriptions and sent_reminders.
  begin;
    set local role authenticated;
    set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';
    select count(*) as b_sees_a_subs from public.push_subscriptions
    where user_id = 'aaaaaaaa-0000-0000-0000-000000000001';
    -- EXPECTED: 0
  rollback;
  begin;
    set local role anon;
    select count(*) as anon_sees_sent from public.sent_reminders;
    -- EXPECTED: 0
  rollback;
  ```
- [ ] Ejecutar cada bloque vía Supabase MCP / SQL editor. Registrar el output real de cada `EXPECTED` como comentario o en `docs/manual-checklists/s11-rls.md`.
- [ ] Si CUALQUIER assertion falla (B ve datos de A, anon ve algo, insert cruzado pasa), DETENERSE: hay un fallo de RLS que arreglar antes de seguir.
- [ ] Limpiar usuarios de prueba al terminar la auditoría: `delete from auth.users where email like 'rls-%@orbit.test';`
- [ ] Commit: `test(rls): cross-user + anon RLS audit queries (S11)`.

---

## Task 2: Rate limiting de `upsert_vault` en la DB

**Files:** `supabase/migrations/<timestamp>_s11_rate_limit.sql`

- [ ] Crear migración: `supabase migration new s11_rate_limit`. Editar:
  ```sql
  -- S11: per-user rate limiting for vault writes, enforced inside upsert_vault.

  create table if not exists public.rate_limits (
    user_id      uuid not null references auth.users(id) on delete cascade,
    bucket       text not null,            -- e.g. 'upsert_vault'
    window_start timestamptz not null,
    count        int not null default 0,
    primary key (user_id, bucket, window_start)
  );

  alter table public.rate_limits enable row level security;
  -- No end-user access: only SECURITY DEFINER functions touch this table.
  -- (No policy = deny-all for authenticated/anon, which is what we want.)

  -- Sliding fixed-window check: max N writes per WINDOW per user+bucket.
  create or replace function public.check_rate_limit(
    p_bucket text, p_max int, p_window interval
  ) returns void language plpgsql security definer
  set search_path = public as $$
  declare
    v_window timestamptz := date_trunc('minute', now());
    v_count int;
  begin
    -- Collapse to one row per (user, bucket, minute-window).
    insert into public.rate_limits (user_id, bucket, window_start, count)
      values (auth.uid(), p_bucket, v_window, 1)
    on conflict (user_id, bucket, window_start)
      do update set count = public.rate_limits.count + 1
      returning count into v_count;

    if v_count > p_max then
      raise exception 'rate_limited' using errcode = 'P0001',
        message = format('rate limit exceeded for %s', p_bucket);
    end if;

    -- Opportunistic cleanup of stale windows for this user/bucket.
    delete from public.rate_limits
    where user_id = auth.uid() and bucket = p_bucket
      and window_start < now() - (p_window * 2);
  end $$;

  -- Recreate upsert_vault as SECURITY DEFINER so it can write rate_limits,
  -- while STILL scoping every row to auth.uid() (RLS-equivalent in code).
  create or replace function public.upsert_vault(
    p_meta text, p_blob text, p_expected_version bigint
  ) returns public.vaults language plpgsql security definer
  set search_path = public as $$
  declare result public.vaults;
  begin
    if auth.uid() is null then
      raise exception 'not_authenticated' using errcode = '42501';
    end if;

    -- Rate limit: max 30 vault writes per minute per user (covers debounced sync bursts).
    perform public.check_rate_limit('upsert_vault', 30, interval '1 minute');

    insert into public.vaults as v (user_id, encrypted_meta, encrypted_blob, version, updated_at)
      values (auth.uid(), p_meta, p_blob, 1, now())
    on conflict (user_id) do update
      set encrypted_meta = excluded.encrypted_meta,
          encrypted_blob = excluded.encrypted_blob,
          version        = v.version + 1,
          updated_at     = now()
      where v.version = p_expected_version
    returning * into result;

    if result is null then
      raise exception 'version_conflict' using errcode = '40001';
    end if;
    return result;
  end $$;

  -- Lock down EXECUTE: only authenticated users may call it; anon cannot.
  revoke all on function public.upsert_vault(text, text, bigint) from public, anon;
  grant execute on function public.upsert_vault(text, text, bigint) to authenticated;
  revoke all on function public.check_rate_limit(text, int, interval) from public, anon, authenticated;
  ```
  IMPORTANTE: `upsert_vault` pasa de `security invoker` (S2) a `security definer`. Con definer, RLS NO se aplica automáticamente, por eso scopeamos cada operación a `auth.uid()` explícitamente en el cuerpo. El `set search_path = public` previene secuestro de search_path (gate de seguridad).
- [ ] Aplicar: `supabase db push` — output esperado: migración aplicada.
- [ ] Verificar que el rate limit dispara: en el SQL editor, simular >30 llamadas con el JWT de A — la #31 debe lanzar `rate_limited`. Documentar.
- [ ] Verificar que anon no puede ejecutar `upsert_vault`:
  ```sql
  begin; set local role anon;
  select public.upsert_vault('{}', 'x', 1);
  rollback;
  -- EXPECTED: ERROR permission denied for function upsert_vault
  ```
- [ ] Commit: `feat(db): per-user rate limiting on upsert_vault (security definer)`.

---

## Task 3: Configurar y documentar rate limits de Supabase Auth

**Files:** `supabase/config.toml`, `docs/manual-checklists/s11-rls.md`

- [ ] Leer `supabase/config.toml` (creado en S2). Confirmar/ajustar los rate limits de auth bajo `[auth.rate_limit]` (research vía la skill `supabase` por los nombres de clave actuales):
  ```toml
  [auth.rate_limit]
  # Token refreshes per IP per 5 minutes.
  token_refresh = 150
  # Sign-in / sign-up attempts per IP per 5 minutes.
  sign_in_sign_ups = 30
  ```
- [ ] Aplicar la config: `supabase config push` (o `supabase db push` según versión del CLI) — output esperado: config aplicada.
- [ ] Documentar en `docs/manual-checklists/s11-rls.md` los límites efectivos (auth + `upsert_vault`) y el resultado de la auditoría de Task 1.
- [ ] Commit: `chore(supabase): document + set auth rate limits`.

---

## Task 4: Hardening de CSP/headers en proxy.ts

**Files:** `proxy.ts`

- [ ] Leer `proxy.ts` (estado actual: `connect-src 'self' https://open.er-api.com;`). Tras S4, sync usa Supabase, así que `connect-src` debe incluir el origen REST/Auth (https) y el de Realtime (wss).
- [ ] Editar el `cspHeader` en `proxy.ts`, línea `connect-src`:
  ```ts
        connect-src 'self' https://open.er-api.com https://vmcjkleuetcogqhdnlfx.supabase.co wss://vmcjkleuetcogqhdnlfx.supabase.co;
  ```
  No tocar `script-src` (sigue `'self' 'nonce-...' 'strict-dynamic' 'wasm-unsafe-eval'`). No añadir `unsafe-eval` ni `unsafe-inline` a scripts.
- [ ] Si S4 ya añadió el origen Supabase, verificar que incluye AMBOS (https + wss); el wss es necesario para la suscripción Realtime de sync. Si falta wss, añadirlo.
- [ ] Verificar el header en una build de producción local:
  ```bash
  pnpm build && pnpm start &
  sleep 8 && curl -sI http://localhost:3000/ | grep -i content-security-policy
  ```
  Output esperado: el header CSP incluye `connect-src` con `https://vmcjkleuetcogqhdnlfx.supabase.co` y `wss://vmcjkleuetcogqhdnlfx.supabase.co`, y `script-src` con nonce + `wasm-unsafe-eval`.
- [ ] Verificar que NO hay regresión: la página carga, no hay violaciones de CSP en consola (abrir en Playwright o navegador, revisar console). El unlock con argon2id (`wasm-unsafe-eval`) sigue funcionando.
- [ ] Commit: `fix(csp): allow supabase https + wss origins in connect-src (S11)`.

---

## Task 5: Verificación de secrets en el bundle

**Files:** (verificación; opcional `docs/manual-checklists/s11-rls.md`)

- [ ] Build de producción limpia: `pnpm build` — output esperado: build exitoso.
- [ ] Grep del output por el patrón de secret de Supabase:
  ```bash
  grep -rl "sb_secret" .next || echo "NO sb_secret in bundle"
  ```
  Output esperado: `NO sb_secret in bundle`.
- [ ] Grep por service role key y VAPID privada (no deben aparecer):
  ```bash
  grep -rl "service_role" .next/static 2>/dev/null || echo "NO service_role in client bundle"
  grep -rl "VAPID_PRIVATE" .next 2>/dev/null || echo "NO VAPID_PRIVATE in bundle"
  ```
  Output esperado: ambos "NO ... in bundle".
- [ ] Confirmar que solo `NEXT_PUBLIC_*` quedan inlineados:
  ```bash
  grep -rho "NEXT_PUBLIC_[A-Z_]*" .next/static 2>/dev/null | sort -u
  ```
  Output esperado: solo `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `NEXT_PUBLIC_SYNC_ENABLED` (los publicables esperados). Si aparece algo inesperado, investigar.
- [ ] Registrar la evidencia (los outputs) en `docs/manual-checklists/s11-rls.md`.
- [ ] Commit (si hubo cambios de docs): `docs(qa): S11 secret-in-bundle verification evidence`.

---

## Task 6: Test de zero-knowledge assertion

**Files:** `tests/sync/zero-knowledge.test.ts`

- [ ] Leer `lib/sync/sync-repository.ts` (de S6) para conocer la firma real de `pushVault`/`pullVault`.
- [ ] Escribir `tests/sync/zero-knowledge.test.ts` que pruebe que el repositorio de sync solo mueve ciphertext y nunca descifra:
  ```ts
  import { describe, it, expect, vi } from 'vitest';

  // Mock the supabase client so we can capture exactly what is sent over the wire.
  const rpcCalls: unknown[][] = [];
  vi.mock('@/lib/supabase/client', () => ({
    createClient: () => ({
      rpc: (fn: string, args: unknown) => {
        rpcCalls.push([fn, args]);
        return Promise.resolve({ data: { version: 2 }, error: null });
      },
      from: () => ({
        select: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }),
      }),
    }),
  }));

  import { pushVault } from '@/lib/sync/sync-repository';

  describe('zero-knowledge sync boundary', () => {
    it('sends only opaque ciphertext + meta + version — never plaintext', async () => {
      const meta = '{"kdf":{"salt":"abc"},"verifier":"v"}';
      const blob = 'OPAQUE_CIPHERTEXT_BASE64==';
      await pushVault(meta, blob, 1);

      const [, args] = rpcCalls.at(-1) as [string, Record<string, unknown>];
      const serialized = JSON.stringify(args);
      // The blob argument is passed through verbatim (no transformation/decryption).
      expect(serialized).toContain(blob);
      // No decrypted vault shape leaks (e.g. a known plaintext field name).
      expect(serialized).not.toMatch(/serviceName|cardNumber|password/i);
    });
  });
  ```
  Ajustar los nombres de RPC/argumentos a la implementación real de `pushVault` (puede usar `.rpc('upsert_vault', { p_meta, p_blob, p_expected_version })`).
- [ ] Correr: `pnpm test zero-knowledge` — output esperado: verde.
- [ ] Commit: `test(sync): assert zero-knowledge boundary (ciphertext only)`.

---

## Task 7: Gates y cierre

**Files:** (verificación)

- [ ] Tests verdes: `pnpm test` — toda la suite verde.
- [ ] Typecheck + lint: `pnpm exec tsc --noEmit && pnpm lint` — limpio.
- [ ] Build limpio con verificación de secrets (Task 5) re-corrida: sin secrets en `.next`.
- [ ] Gate `database-reviewer` (OBLIGATORIO): revisar migración `s11_rate_limit` — el cambio de `upsert_vault` a `security definer` con scoping explícito a `auth.uid()`, `set search_path`, grants `revoke from anon` + `grant to authenticated`, y la tabla `rate_limits` deny-all. Adjuntar veredicto.
- [ ] Gate `/security-review` (OBLIGATORIO): cubrir RLS audit (evidencia de denegación cruzada), rate limiting, CSP `connect-src` extendido sin debilitar script-src, ausencia de secrets en bundle, y el test de zero-knowledge. Adjuntar veredicto.
- [ ] Gate `/code-review` sobre el diff completo.
- [ ] Confirmar criterios del spec §5: zero-knowledge intacto (excepción reminders documentada), secrets ninguno en bundle (§5.5). Registrar evidencia.
- [ ] Commit final: `feat(s11): rate limiting + RLS audit + CSP hardening (CP6)`.
- [ ] `/compact`.
