# Orbit — Quota Baseline (Phase 2, S2)

**Fecha de medición:** 2026-06-06
**Medido por:** S2 (Supabase setup)
**Re-chequeo programado:** S12 (CP7)

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
