# Orbit — Quota Baseline (Phase 2, S2)

**Fecha de medición:** 2026-06-06
**Medido por:** S2 (Supabase setup)
**Re-chequeo programado:** S12 (CP7) — ✅ hecho, ver §6

## 1. Vercel (plan Hobby)

| Métrica | Límite Hobby | Uso actual (medido) | Fuente |
|---|---|---|---|
| Bandwidth | 100 GB / mes | no expuesto por CLI — revisar dashboard | dashboard (pendiente) |
| Invocaciones de función (Fluid Compute) | ver plan | no expuesto por CLI — revisar dashboard | dashboard (pendiente) |
| Build minutes | ver plan | no expuesto por CLI — revisar dashboard | dashboard (pendiente) |
| Edge requests | ver plan | no expuesto por CLI — revisar dashboard | dashboard (pendiente) |

> Nota: la CLI de Vercel (`vercel ls`, `vercel project ls`) y el MCP (`get_project`, `list_deployments`) no exponen bandwidth, invocaciones, build minutes ni edge requests. Solo confirman que el proyecto `dux14s-projects/orbit` (`prj_Cos4jfkdwjbMoarnJSx3rLxzBhAP`) tiene 4 deployments de producción (~4 días, builds de 33–44s), `live: false`. Las métricas de consumo deben leerse en el dashboard de Vercel (Usage). Proyecto recién desplegado: uso esperado ≈ trivial.

## 2. Supabase (plan Free)

| Métrica | Límite Free | Uso actual (medido) | Fuente |
|---|---|---|---|
| DB size | 500 MB | 10 MB (proyecto nuevo, solo schema) | `supabase` Management API (`pg_database_size`) |
| MAU | 50.000 | 0 | `supabase` Management API (`count(*) from auth.users`) |
| Realtime msgs | 2.000.000 / mes | ≈ 0 (sin clientes conectados) | dashboard |
| Pausa por inactividad | 7 días sin actividad | N/A — pg_cron de CP5 mantiene actividad | spec §3.7 |

> DB size = 10 MB corresponde al overhead base de Postgres 17.6 + schema migrado (extensiones, catálogos del sistema, tabla `vaults` vacía). 0 usuarios: proyecto creado hoy (2026-06-06T13:50:15Z). Baseline limpio confirmado.

## 3. Proyección — modelo single-blob

| Concepto | Estimación | Notas |
|---|---|---|
| Plaintext VaultData / usuario típico | ~12 KB | ~20 subs + credenciales + payment methods (≈0,5 KB/sub con credenciales → 10 KB; +2 KB metadata/payment methods) |
| Blob cifrado / usuario (base64, ~1.35×) | ~16 KB | AES-256-GCM + overhead base64 (12 KB × 1,35 ≈ 16,2 KB) |
| Filas en `vaults` por usuario | 1 | single-blob |
| DB usada con 1.000 usuarios | ~16 MB (+ 10 MB base ≈ 26 MB) | 16 KB × 1.000 ≈ 16 MB de datos; << 500 MB → DB **no** es riesgo |
| Realtime msgs / usuario activo / día | ~10–50 | depende del debounce de sync (push por cambio debounceado + reconcile en focus/unlock) |

**Riesgo principal:** Realtime + requests, no almacenamiento. Mitigación: debounce agresivo del push de sync (CP3, ya contemplado en el plan) + reconcile en focus/unlock, no por keystroke.

## 4. Umbrales de alerta

| Recurso | Umbral amarillo | Umbral rojo | Acción |
|---|---|---|---|
| Vercel bandwidth | 70 GB/mes (70%) | 90 GB/mes (90%) | revisar assets/SSR; considerar plan Pro |
| Supabase DB | 350 MB (70%) | 450 MB (90%) | revisar tamaño de blobs; per-record sync (Phase 2.5) |
| Supabase Realtime | 1.4M/mes (70%) | 1.8M/mes (90%) | endurecer debounce; reducir suscripciones |
| Supabase MAU | 35.000 (70%) | 45.000 (90%) | evaluar plan Pro |

## 5. Conclusión

La proyección **cabe en el free tier con amplio margen**. Almacenamiento: con 1.000 usuarios la DB usaría ≈ 26 MB (10 MB base + ~16 MB de blobs), es decir ~5% del límite de 500 MB de Supabase Free; incluso con 10.000 usuarios serían ≈ 170 MB (~34%), aún por debajo del límite. El cuello de botella no es el almacenamiento sino Realtime y requests: a ~10–50 msgs/usuario/día, el límite de 2.000.000 msgs/mes soporta del orden de 1.300–6.600 usuarios activos diarios antes de tocar el umbral amarillo, por lo que el debounce agresivo de sync (CP3) es la mitigación crítica. Conclusión: el modelo single-blob satisface el criterio de éxito global #6 (cabe en free tier con margen documentado); el seguimiento se centra en Realtime/requests, no en DB.

## 6. Post-sync (S12, re-chequeo CP7)

**Fecha:** 2026-06-06 (mismo día — Phase 2 completa se construyó en una jornada;
el consumo "real" refleja desarrollo + suites E2E, no tráfico de usuarios).

### Supabase (Management API, medido)

| Métrica | Límite Free | Medido S12 | vs umbral amarillo |
|---|---|---|---|
| DB size | 500 MB | **11 MB** (+1 MB vs baseline: tablas S10/S11 + residuos E2E) | 2,2% — sin riesgo |
| MAU | 50.000 | 5 (todos usuarios throwaway E2E; se limpian en el cierre S12) | ~0% |
| Filas `vaults` | — | 2 (residuos E2E) | blob/usuario confirmado pequeño |
| `rate_limits` residuales | — | 3 filas (ventanas viejas; cleanup oportunista al próximo push del mismo usuario) | sin acción |

### Crons (deben seguir activos — evitan la pausa de 7 días)

| Job | Schedule | Activo |
|---|---|---|
| `keep-alive-daily` | `17 4 * * *` | ✅ |
| `send-reminders-daily` | `0 13 * * *` | ✅ |
| `prune-sent-reminders` | `0 3 * * 0` | ✅ |

### Vercel

CLI/MCP siguen sin exponer bandwidth/invocaciones/build minutes (limitación
documentada en §1). Observable: 6 deployments totales, builds de 33–44s
(≈ 4 min de build acumulados — trivial). `send-reminders` corre en Supabase
Edge (no consume invocaciones Vercel). Bandwidth real: revisar dashboard Usage
tras el rollout; con 0 usuarios reales es ≈ 0.

### Realtime (proyección, sin cambio de modelo)

El sync NO usa canales Realtime: pull por reconcile en unlock/focus/online +
push debounced (4 s) vía `upsert_vault`. Consumo Realtime = 0 msgs. El riesgo
proyectado en §3 se desplaza íntegramente a **requests REST/RPC**, acotados por
el rate limit de S11 (30 escrituras/min/usuario) y el debounce: techo práctico
~10–50 requests/usuario activo/día — muy por debajo de cualquier límite Free.

### Veredicto §5.6

**Dentro del free tier con margen amplio.** DB 2,2% del límite con todo el
overhead de desarrollo incluido; MAU y Realtime ≈ 0; el único punto ciego es
bandwidth de Vercel (solo dashboard), trivial pre-rollout. Mitigantes ya
desplegados: debounce 4 s (S6), rate limit DB (S11), crons de keep-alive y
poda (S10). Sin acción requerida.
