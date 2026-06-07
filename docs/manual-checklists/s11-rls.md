# S11 — RLS audit + rate limits + secrets: evidencia

Fecha: 2026-06-06 · Proyecto: `vmcjkleuetcogqhdnlfx` · Ejecutado vía Management API (SQL editor equivalente).

## 1. Auditoría RLS (queries en `supabase/tests/rls-audit.sql`)

Usuarios de prueba: A = `aaaaaaaa-…0001` (rls-a@orbit.test), B = `bbbbbbbb-…0002` (rls-b@orbit.test).
Datos sembrados: 1 vault de A, 1 reminder de A. Eliminados al cerrar la auditoría (cascade).

| # | Assertion | Esperado | Resultado real | ✓ |
|---|---|---|---|---|
| 1 | vaults: B lee fila de A | 0 filas | `b_sees_a_rows: 0` | ✅ |
| 2 | vaults: B actualiza fila de A | UPDATE 0 | `hijacked: 0` | ✅ |
| 3 | vaults: B inserta fila como A | ERROR RLS | `42501: new row violates row-level security policy for table "vaults"` | ✅ |
| 4 | vaults: A lee su propia fila | 1 fila | `a_sees_own: 1` | ✅ |
| 5 | vaults: anon lee algo | 0 filas | `anon_sees: 0` | ✅ |
| 6a | reminders: B lee filas de A | 0 | `b_sees_a_reminders: 0` | ✅ |
| 6b | reminders: B actualiza filas de A | UPDATE 0 | `hijacked: 0` | ✅ |
| 6c | reminders: anon lee algo | 0 | `anon_sees_reminders: 0` | ✅ |
| 7a | push_subscriptions: B lee filas de A | 0 | `b_sees_a_subs: 0` | ✅ |
| 7b | push_subscriptions: anon lee algo | 0 | `anon_sees_subs: 0` | ✅ |
| 8a | sent_reminders: B lee filas de A | 0 | `b_sees_a_sent: 0` | ✅ |
| 8b | sent_reminders: authenticated inserta (anti dedupe-forgery, S10b) | ERROR RLS | `42501: new row violates row-level security policy for table "sent_reminders"` | ✅ |
| 8c | sent_reminders: anon lee algo | 0 | `anon_sees_sent: 0` | ✅ |

**Veredicto: 13/13 PASS.** Ninguna fuga cruzada ni acceso anon en ninguna tabla.

## 2. Rate limiting

### 2.1 `upsert_vault` (DB, migración `20260607030501_s11_rate_limit`)

Límite: **30 escrituras/minuto por usuario** (ventana fija por minuto, tabla `rate_limits` deny-all).
`upsert_vault` pasó de `security invoker` a `security definer` con scoping explícito a `auth.uid()`,
`set search_path = public` y check de `auth.uid() is null`.

| Check | Esperado | Resultado real | ✓ |
|---|---|---|---|
| 31 llamadas seguidas como usuario A | #1–30 OK, #31 falla | `failed at call 31: rate limit exceeded for upsert_vault` | ✅ |
| anon ejecuta `upsert_vault` | permission denied | `42501: permission denied for function upsert_vault` | ✅ |
| authenticated ejecuta `check_rate_limit` directo | permission denied | `42501: permission denied for function check_rate_limit` | ✅ |
| authenticated lee `public.rate_limits` | permission denied | `42501: permission denied for table rate_limits` | ✅ |

Desviación del plan: el `raise exception` literal del plan especificaba MESSAGE dos veces
(`raise exception 'rate_limited' using message = …`) → error `RAISE option already specified`.
Corregido a `raise exception 'rate limit exceeded for %', p_bucket using errcode = 'P0001'`.

Usuarios de prueba eliminados tras la verificación (`remaining_test_users = 0`,
`leftover_rate_limit_rows = 0` — el test corrió dentro de una transacción con rollback).

### 2.2 Supabase Auth (nativo, gestionado por Supabase)

Config efectiva del remoto (GET `/v1/projects/<ref>/config/auth`, 2026-06-06).
`supabase/config.toml` `[auth.rate_limit]` queda alineado (solo aplica a dev local).

| Límite | Valor efectivo | Ventana |
|---|---|---|
| `rate_limit_token_refresh` | 150 | 5 min / IP |
| `rate_limit_verify` (OTP/magic link verifications) | 30 | 5 min / IP |
| `rate_limit_otp` | 30 | ventana nativa |
| `rate_limit_email_sent` | 2 | 1 h |
| `rate_limit_sms_sent` | 30 | 1 h |
| `rate_limit_anonymous_users` | 30 | 1 h / IP (anon sign-ins deshabilitados) |
| `rate_limit_web3` | 30 | 5 min / IP (web3 deshabilitado) |
| Sign-in/sign-up | 30 / 5 min / IP | default nativo (no expuesto en el GET de la Management API) |

El sign-in real del producto es Google OAuth (PKCE), también cubierto por los límites
nativos de Auth. `send-reminders` no tiene superficie pública (solo pg_cron con
`Bearer service_role`, comparación constant-time — ver S10).

⚠️ `mailer_autoconfirm: true` sigue activo — lo requiere el harness E2E (S8) para
acuñar sesiones por `/auth/v1/signup`. Riesgo: signups por API sin verificación de
email (la UI solo expone Google OAuth). **Decisión pendiente en S12/pre-producción:**
desactivarlo o compensar (captcha / deshabilitar provider email).

## 3. Secrets en bundle (se completa en T5)

_Pendiente._
