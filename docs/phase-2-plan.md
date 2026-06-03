# Orbit 🪐 Phase 2 Implementation Plan — Encrypted Cloud Sync

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Research every library with the **context7 MCP** before writing code, and drive Supabase via the **Supabase CLI** (authenticated as `dux14's Org`) and the **Supabase MCP** — never click through the web UI.

**Goal:** Add optional, **zero-knowledge cloud sync + multi-device** to Orbit on top of Supabase — Google sign-in, end-to-end-encrypted vault blobs synced across devices, Row Level Security, rate limiting, and (opt-in) server-scheduled renewal reminders via Web Push — **without rewriting the Phase 1 UI**.

**Architecture:** Phase 1's five decoupled layers stay intact. Sync slots in as a new **Sync layer** sitting *beside* the existing Dexie Repository (local-first remains the source of truth; the cloud is an encrypted mirror). The server is **zero-knowledge**: it only ever stores ciphertext (`encrypted_blob`) + KDF meta (`salt`, params, `verifier`). The master password and derived key never leave the device. Auth identifies *which* encrypted rows a user may read/write (via RLS); it does **not** grant access to plaintext.

**Stack additions:** Supabase (Postgres + Auth + Edge Functions + `pg_cron`) · `@supabase/supabase-js` · `@supabase/ssr` · Google OAuth · Web Push (VAPID) · Upstash Redis or Supabase-native rate limiting. Everything else from Phase 1 is unchanged.

---

## 0. Locked decisions (from the original spec — do NOT re-litigate)

| Topic | Decision |
|---|---|
| Server knowledge | **Zero-knowledge.** Server stores only `encrypted_blob` + KDF meta + `verifier`. Plaintext, master password, and derived key never leave the device. |
| Auth | **Google OAuth via Supabase Auth.** |
| Local-first | Dexie remains the working source of truth; cloud is an **encrypted mirror**. App stays fully usable offline. |
| Card data | Still **PCI-safe** — only alias + brand + last4 + color, inside the encrypted blob. |
| Scope | Phase 2 = auth + sync + RLS + rate limiting + opt-in server reminders. **Auto-import, shared/family plans, analytics are Phase 3** — out of scope. |

## 1. Decisions to confirm BEFORE building (with recommendations)

These materially change the work — confirm with the user (use `AskUserQuestion`) before Checkpoint 2.

1. **Sync granularity — single blob vs per-record.**
   - **(Recommended) Single encrypted blob + version** — mirrors Phase 1's `VaultData` blob as one row with an integer `version`; conflicts resolved by last-write-wins with a conflict prompt. Simplest; matches today's storage. Risk: two devices editing concurrently overwrite each other (mitigated by version check + "remote is newer, merge?" prompt).
   - **Per-record encrypted rows** — one encrypted row per subscription/credential/payment-method, each with its own `updated_at`. Far better concurrent-edit behavior; more code (per-entity repository + sync). Recommend deferring to Phase 2.5 unless multi-device concurrent editing is a primary use case.
   - **Recommendation:** start single-blob + version (ship fast, preserves ZK), design the Sync interface so per-record can replace it later without UI changes.

2. **Server-side reminders vs full zero-knowledge.** Server-scheduled Web Push needs *some* cleartext: at minimum a renewal **date** + a **label** to put in the notification.
   - **(Recommended) Opt-in minimal reminder index** — if the user enables "cloud reminders," sync a small, separate `reminders` table holding only `{ service_label, next_renewal_date, lead_days }` (no amounts, emails, passwords, cards). Clearly disclosed as *not* zero-knowledge for that subset. Default OFF.
   - **Fully zero-knowledge** — keep reminders client-only (Phase 1 behavior: in-app badges + page-context notifications). No server push.
   - **Recommendation:** ship opt-in minimal index (B), default off, with explicit consent copy.

3. **Conflict UX** — auto last-write-wins silently, or prompt on divergence? **Recommendation:** prompt ("This vault changed on another device — keep local / use remote / view diff") only when versions diverge; otherwise silent fast-forward.

4. **Account model** — is an account *required* (cloud-only) or *optional* (local-first, sign in to enable sync)? **Recommendation:** optional — Phase 1 local vault keeps working; signing in *links* it and turns on sync.

> The rest of this plan assumes the recommended answers (1: single-blob+version; 2: opt-in minimal index; 3: prompt-on-divergence; 4: optional account). Adjust tasks if the user chooses differently.

---

## 2. Architecture — how sync slots into the existing layers

```
UI (unchanged screens) ── new: Account/Sync settings, Sign-in screen, conflict prompt
  │
State (Zustand) ── new: authStore (session), syncStore (status: idle/syncing/error/conflict, lastSyncedAt)
  │
Domain (unchanged) + new: merge/conflict resolution (pure, tested)
  │
Crypto (unchanged) ── SAME deriveKey/encrypt/decrypt; the blob synced is the SAME ciphertext
  │
Persistence:
   ├─ Local: Dexie Repository (unchanged) = working source of truth
   └─ Remote: SyncRepository (NEW) over Supabase = encrypted mirror
  │
Sync service (NEW): push(localBlob,meta,version) / pull() / reconcile(); realtime subscription for cross-device updates
```

Key invariants:
- The **encryption boundary does not move.** `vaultService` still produces the encrypted blob; sync just ships that opaque string to/from Supabase. Server-side code (RLS, Edge Functions) never decrypts.
- **Offline-first preserved:** all reads/writes hit Dexie first; sync is a background reconcile. If offline or signed-out, the app behaves exactly like Phase 1.
- **One master password across devices:** the KDF `salt` lives in synced `meta`, so the same password derives the same key on every device. Server stores the `verifier` to validate unlock; it cannot derive the key.

---

## 3. Data model (Supabase Postgres + RLS)

All tables under schema `public`, RLS enabled, owner = `auth.uid()`.

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

All migrations live in `supabase/migrations/` and are applied with `supabase db push` / `supabase migration up`.

## 4. File structure (additions only — Phase 1 files unchanged)

```
orbit/
├─ supabase/
│  ├─ config.toml
│  ├─ migrations/*.sql            # vaults, reminders, push_subscriptions, RLS, upsert_vault()
│  └─ functions/
│     ├─ schedule-reminders/      # pg_cron-triggered: find due reminders, send Web Push
│     └─ _shared/                 # VAPID signing helpers
├─ lib/
│  ├─ supabase/
│  │  ├─ client.ts                # browser client (@supabase/ssr createBrowserClient)
│  │  ├─ server.ts                # server client (cookies) for route handlers/RSC
│  │  └─ types.ts                 # generated DB types (supabase gen types)
│  ├─ sync/
│  │  ├─ sync-repository.ts       # remote CRUD over supabase (push/pull encrypted blob+meta+version)
│  │  ├─ sync-service.ts          # reconcile(): pull→compare version→push/merge; realtime subscribe
│  │  └─ reconcile.ts             # PURE conflict logic (version compare → fast-forward | conflict)
│  ├─ store/
│  │  ├─ auth-store.ts            # session/user (Zustand), onAuthStateChange
│  │  └─ sync-store.ts            # { status, lastSyncedAt, conflict }  for UI status
│  └─ reminders/
│     └─ cloud-reminders.ts       # opt-in: push minimal index to public.reminders
├─ app/
│  ├─ auth/
│  │  ├─ callback/route.ts        # OAuth code exchange (PKCE)
│  │  └─ sign-in/page.tsx         # Google sign-in screen
│  └─ (vault)/settings/…          # extend: Account section (sign in/out, sync status, cloud-reminders toggle)
├─ proxy.ts                        # extend existing nonce-CSP proxy with Supabase session refresh
└─ public/sw.ts (app/sw.ts)        # extend Serwist SW with 'push' + 'notificationclick' handlers
```

---

## CHECKPOINT 1 — Supabase project, schema, RLS, generated types

After this checkpoint output `✅ CP1: Supabase project linked, schema + RLS migrated, types generated` and pause.

### Task 1.1 — Provision & link the Supabase project (CLI)
- [ ] Research current Supabase CLI + `@supabase/ssr` Next 16 App Router patterns via context7 and the `supabase` skill.
- [ ] `supabase init` in `orbit/`; create/link the project: `supabase link --project-ref <ref>` (or `supabase projects create orbit`). Capture project URL + anon key.
- [ ] Add env vars (NEVER commit secrets): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` locally (`.env.local`) and on Vercel via `vercel env add` (Production + Preview). `SUPABASE_SERVICE_ROLE_KEY` only where strictly needed (Edge Functions), never in client bundles.
- [ ] Commit `supabase/config.toml`.

### Task 1.2 — Migrations: tables + RLS + `upsert_vault`
- [ ] Write `supabase/migrations/0001_init.sql` with the schema from §3 (vaults, reminders, push_subscriptions, RLS policies, `upsert_vault`). Apply with `supabase db push`.
- [ ] **Verify RLS** with the Supabase MCP / SQL: as user A, confirm you cannot select/update user B's `vaults` row. Add a test note documenting the check.
- [ ] Commit migration.

### Task 1.3 — Generated DB types
- [ ] `supabase gen types typescript --linked > lib/supabase/types.ts`. Typecheck clean. Commit.

---

## CHECKPOINT 2 — Auth (Google OAuth, SSR sessions)

After this checkpoint output `✅ CP2: Google sign-in + SSR session + sign-out` and pause.

### Task 2.1 — Supabase clients (browser + server)
- [ ] Implement `lib/supabase/client.ts` (`createBrowserClient`) and `lib/supabase/server.ts` (`createServerClient` with Next `cookies()`), per the current `@supabase/ssr` guide (research via context7 first — cookie handling changed across versions).
- [ ] Extend `proxy.ts` to refresh the Supabase session on each request (the `@supabase/ssr` middleware pattern) **without weakening the existing nonce CSP** — merge, don't replace.

### Task 2.2 — Google OAuth provider
- [ ] In Supabase Auth settings (CLI/dashboard config), enable Google, set client id/secret + redirect `https://<domain>/auth/callback`. Document required Google Cloud OAuth consent setup.
- [ ] Implement `app/auth/callback/route.ts` (PKCE code exchange → set session cookies → redirect to `/`).
- [ ] Implement `app/auth/sign-in/page.tsx` — "Continue with Google" (uses OrbitLogo + pastel theme; i18n via existing `useT`).

### Task 2.3 — Auth store + Account UI
- [ ] `lib/store/auth-store.ts` — holds `user/session`, subscribes to `supabase.auth.onAuthStateChange`, exposes `signInWithGoogle()`, `signOut()`.
- [ ] Extend Settings with an **Account** section: signed-out → "Sign in to sync"; signed-in → email + "Sign out" + sync status placeholder.
- [ ] Verify end-to-end sign-in on a Vercel **preview** deploy (OAuth needs a real https origin). Confirm session persists across reload; sign-out clears it.

---

## CHECKPOINT 3 — Encrypted sync (push/pull/reconcile)

After this checkpoint output `✅ CP3: zero-knowledge sync with version-based conflict handling` and pause.

### Task 3.1 — Reconcile logic (PURE, TDD)
- [ ] `lib/sync/reconcile.ts` — pure function `reconcile({ local, remote })` over `{ version, updatedAt }` returning one of `up-to-date | push(localWins) | pull(remoteWins) | conflict`. Unit-test all branches (no I/O). This is the brain of sync; test it hard (equal versions+different content = conflict; remote ahead = pull; local ahead = push; no-remote = push initial).

### Task 3.2 — Sync repository (remote, encrypted only)
- [ ] `lib/sync/sync-repository.ts` — `pullVault()` (`select` the user's row) and `pushVault(meta, blob, expectedVersion)` (call `upsert_vault` RPC; surface `version_conflict`). It moves **only ciphertext** — assert in code/tests that no decrypt happens here.

### Task 3.3 — Sync service + store
- [ ] `lib/sync/sync-service.ts` — `reconcileNow()`: read local encrypted blob+meta+version from Dexie, `pullVault()`, run `reconcile`, then push or apply-remote (decrypt remote → load into vault store → re-persist locally) or raise `conflict`. Subscribe to Supabase **Realtime** on the user's `vaults` row to trigger reconcile on remote change.
- [ ] `lib/store/sync-store.ts` — `{ status, lastSyncedAt, conflict }`. Trigger `reconcileNow()` on: unlock, app focus, after each local mutation (debounced), and realtime events.
- [ ] Persist a local `version` alongside the Dexie blob (extend the repository's `meta`/a small `sync` table) so the client can do optimistic concurrency.

### Task 3.4 — Conflict UX
- [ ] A non-destructive conflict prompt (keep local / use remote / cancel). Default to **no data loss** — never silently overwrite on a true conflict. Show sync status in Settings (last synced, syncing spinner, error).
- [ ] Verify multi-device: sign in on two browsers, edit on A → B reconciles; force a conflict (edit both offline) → prompt appears; choosing a side resolves cleanly.

---

## CHECKPOINT 4 — Account linking & multi-device onboarding

After this checkpoint output `✅ CP4: link local vault to account; new-device pull+unlock` and pause.

### Task 4.1 — Link an existing local vault
- [ ] When a signed-in user has a local vault but no remote row → push it (upload `meta` + `blob` as version 1). Surface "Sync enabled."
- [ ] When a signed-in user has a remote row but **no** local vault (new device) → pull `meta`, prompt for master password, `deriveKey` from synced salt, `checkVerifier`, decrypt blob, hydrate local Dexie. (Reuses Phase 1 `vaultService.unlock` path, pointed at remote meta/blob.)
- [ ] Edge cases: signed-in user with **both** local and remote (different) vaults → run reconcile/conflict; document the "which master password" assumption (must be the same; if salts differ, the vaults are genuinely different — warn).

### Task 4.2 — Sign-out hygiene
- [ ] On sign-out: stop realtime, clear sync store, **lock** the vault (wipe key+data from memory). Local encrypted Dexie data may remain (offline use) — offer "sign out & keep local" vs "sign out & wipe this device."

---

## CHECKPOINT 5 — (Opt-in) server reminders via Web Push

Only if decision §1.2 = opt-in index. After this checkpoint output `✅ CP5: opt-in cloud reminders via Web Push` and pause.

### Task 5.1 — Consent + minimal index sync
- [ ] Settings toggle "Cloud reminders (sends service name + renewal date to Orbit's server)" — default OFF, explicit copy that this subset is **not** end-to-end encrypted. When ON, `lib/reminders/cloud-reminders.ts` upserts `{ service_label, next_renewal_date, lead_days }` to `public.reminders` on vault changes; when OFF, deletes the user's rows.

### Task 5.2 — Web Push subscription
- [ ] Generate VAPID keys (store public in env, private as a Supabase function secret). Extend `app/sw.ts` (Serwist) with `push` + `notificationclick` handlers. On enabling cloud reminders, register a push subscription and store it in `public.push_subscriptions`.

### Task 5.3 — Scheduled sender (Edge Function + pg_cron)
- [ ] `supabase/functions/schedule-reminders/` — daily `pg_cron` job invokes it; it queries `reminders` where `next_renewal - lead_days <= today`, looks up the user's push subscriptions, and sends Web Push (title/body = service + days left; **no** amounts/credentials). Dedupe per day server-side.
- [ ] Verify a real push arrives on a device for a due renewal; verify nothing sensitive is in the payload.

---

## CHECKPOINT 6 — Rate limiting, hardening, RLS audit

After this checkpoint output `✅ CP6: rate limiting + security hardening + RLS audit` and pause.

- [ ] **Rate limit** auth + sync + function endpoints (Upstash Redis sliding-window via middleware, or Supabase edge rate limiting). Sensible per-user/IP limits on `upsert_vault`, sign-in, and the reminder function.
- [ ] **RLS audit** (Supabase MCP): attempt cross-user reads/writes on every table; confirm all denied. Verify `security invoker` on `upsert_vault` respects RLS. Confirm anon key cannot read others' rows.
- [ ] **CSP update**: add the Supabase project origin to `connect-src` (and the realtime `wss://` origin) in `proxy.ts`; keep script-src nonce-strict. Re-verify headers in production.
- [ ] **Secrets**: confirm service-role key is never in a client bundle; only `NEXT_PUBLIC_*` are public. Review Vercel env scoping (Production vs Preview).
- [ ] **Zero-knowledge assertion test**: a test/inspection proving the server only ever receives ciphertext for the vault (decrypt happens only client-side); the `reminders` table is the sole, opt-in, disclosed exception.

---

## CHECKPOINT 7 — Verification & rollout

After this checkpoint output `✅ CP7: Phase 2 verified` and STOP. Report honestly with evidence.

- [ ] **Unit/component**: reconcile logic, sync repository (mocked supabase), auth store, cloud-reminders index builder — all green (`pnpm test`).
- [ ] **E2E (Playwright, requires Chrome)**: sign in → local vault links/uploads → sign in on a second context → pull → unlock with same master password → see data; edit on one → other reconciles; conflict prompt path; sign-out locks; (if enabled) cloud-reminder toggle writes/deletes the index.
- [ ] **Security**: RLS cross-user denial evidence; CSP/headers present in prod; no secrets in client bundle; payloads inspected.
- [ ] **Lighthouse** mobile still ≥ 95 (sync work is off the main thread / deferred; auth screen is light).
- [ ] **Deploy**: Vercel **preview** green first (OAuth + sync exercised on a real origin); promote to **production only after explicit user approval**. Apply Supabase migrations to the linked project before promoting.
- [ ] **Rollback plan**: sync is additive + offline-first — if disabled, the app reverts to Phase 1 local behavior. Document a feature flag (`NEXT_PUBLIC_SYNC_ENABLED`) to gate the account/sync UI for a safe rollout.

---

## Security / QA checklist (carry through every checkpoint)

- Server is zero-knowledge for the vault: only `encrypted_blob` + KDF meta + `verifier` are stored; the derived key/master password never transmitted. Decryption is client-only.
- RLS on every table; `with check` on writes; cross-user access proven denied.
- Same master password derives the same key across devices via synced salt; wrong password fails via `verifier` (server can't validate, only the client can).
- Conflict resolution never silently destroys data.
- Opt-in reminder index is the *only* disclosed cleartext, default OFF, with explicit consent.
- Web Push payloads contain no amounts, emails, card data, or credentials.
- Rate limiting on auth + sync + functions; secrets correctly scoped; CSP extended to Supabase origins only.
- Offline-first preserved end to end: signed-out or offline == Phase 1 behavior.

## Out of scope (Phase 3+)

Auto-import (bank CSV / email parsing), shared/family plans, analytics, TOTP, web-of-trust key sharing. Per-record encrypted sync may be promoted from "future option" to a Phase 2.5 if concurrent multi-device editing becomes a primary need.

---

*Phase 1 (shipped): local-first, zero-knowledge, deployed. This plan extends it to encrypted multi-device sync while preserving the zero-knowledge guarantee and the offline-first experience.*
