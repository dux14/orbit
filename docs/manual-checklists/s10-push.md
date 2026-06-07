# S10 — Web Push manual verification

Requiere un deploy con `NEXT_PUBLIC_SYNC_ENABLED=true` y sesión iniciada.

> Estado: PENDIENTE de ejecución en dispositivo real (usuario). El camino
> server-side ya quedó verificado en S10: cron → pg_net (Vault secrets) →
> Edge Function → 200 `{ok:true}`; auth 403 sin service role.

## Android (Chrome) — PWA instalada o pestaña
- [ ] Sign in con Google.
- [ ] Settings → Cloud reminders → toggle ON → aceptar el prompt de notificaciones.
- [ ] Confirmar fila en `push_subscriptions` para el usuario (Supabase MCP / SQL).
- [ ] Crear una suscripción con `nextRenewalDate` = hoy + 1 día y `status` active.
- [ ] Re-activar el toggle (OFF→ON) para refrescar el índice, o esperar al próximo sync del índice.
- [ ] Forzar el envío: `curl -X POST https://vmcjkleuetcogqhdnlfx.supabase.co/functions/v1/send-reminders -H "Authorization: Bearer <sb_secret>"`, o esperar al cron 13:00 UTC.
- [ ] Llega la notificación: título "Upcoming renewal", body "<servicio> renews tomorrow." Sin importes ni datos sensibles.
- [ ] Tap en la notificación → abre /subscriptions.

## iOS (Safari 16.4+) — REQUIERE PWA en Home Screen
- [ ] Abrir en Safari → Compartir → "Añadir a pantalla de inicio".
- [ ] Abrir Orbit DESDE el icono de la pantalla de inicio (no en Safari).
- [ ] Settings → Cloud reminders → ON → aceptar permiso.
- [ ] Repetir el envío forzado y verificar la notificación.
- [ ] Documentar: en Safari (no instalada) el toggle de push no debe poder activarse / no llega push — comportamiento esperado.

## OFF path (borrado verificable)
- [ ] Toggle OFF → confirmar `select count(*) from reminders where user_id = '<uid>'` = 0.
- [ ] Confirmar que la subscription de este device se borró de `push_subscriptions`.

## Limitación conocida (backlog S11/S12)
- El índice se sincroniza al activar el toggle; ediciones posteriores del vault
  no lo refrescan automáticamente todavía (re-activar el toggle lo refresca).
  Wiring de re-sync continuo pendiente.
