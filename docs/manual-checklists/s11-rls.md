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

## 2. Rate limiting (se completa en T2/T3)

_Pendiente: límites de `upsert_vault` y de Supabase Auth._

## 3. Secrets en bundle (se completa en T5)

_Pendiente._
