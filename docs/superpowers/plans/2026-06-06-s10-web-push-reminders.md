# S10 — Recordatorios cloud opt-in (Web Push + pg_cron) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Research librerías con el **context7 MCP** antes de escribir código; conduce Supabase con el **Supabase CLI** (autenticado como `dux14's Org`) — nunca por la web UI. SIEMPRE `pnpm`.

**Goal:** Implementar la sesión S10 = Checkpoint 5 de `docs/phase-2-plan.md`: recordatorios cloud **opt-in (default OFF)**, única excepción documentada al zero-knowledge. El usuario activa en Settings → se sincroniza un índice mínimo de reminders en plaintext (`service_label`, `next_renewal`, `lead_days`), se registra una Web Push subscription, y una Edge Function disparada por `pg_cron` diario envía notificaciones de renovación. El mismo cron mantiene el proyecto Supabase activo (evita la pausa de 7 días del free tier). Al desactivar, el índice se borra server-side de forma verificable.

**Architecture:** Las tablas `reminders` y `push_subscriptions` ya fueron creadas en S2 (CP1) con RLS `auth.uid() = user_id`. Este plan **las usa**, no las crea. Flujo: (1) UI opt-in en Settings con consentimiento honesto; (2) `lib/reminders/cloud-reminders.ts` hace upsert/delete del índice mínimo derivado del vault descifrado en el cliente; (3) `lib/push/subscribe.ts` hace `PushManager.subscribe` y guarda la subscription; (4) `app/sw.ts` (Serwist) maneja `push` + `notificationclick`; (5) `supabase/functions/send-reminders` (Deno) consulta reminders próximos y envía Web Push firmado con VAPID; (6) `pg_cron` invoca la función a diario. El boundary de cifrado del vault no se mueve: el blob sigue siendo opaco; solo el índice mínimo es plaintext y solo si el usuario lo activa.

**Tech Stack:** Next.js 16.2.7 App Router · Supabase (Postgres + Edge Functions Deno + `pg_cron` + `pg_net`) · Web Push API (VAPID) · Serwist SW (`app/sw.ts`) · i18n dict tipado (`lib/i18n/dict.ts`, `useT()`) · Zustand (`useSettingsStore`) · Vitest · `pnpm`.

---

## 0. Decisiones bloqueadas (no re-litigar)

| Tema | Decisión |
|---|---|
| Default | Recordatorios cloud **OPT-IN, default OFF**. Sin acción del usuario, el comportamiento es Phase 1 (badges in-app). |
| Excepción ZK | Única excepción al zero-knowledge: índice mínimo en plaintext. Disclosure explícito en la UI. Nunca: amounts, emails, cards, credenciales, notas. |
| Payload push | Solo `service_label` + días restantes. Cero datos sensibles. |
| Tablas | `reminders` y `push_subscriptions` YA existen (S2/CP1). Este plan las consume. |
| VAPID privada | Secret de Supabase (`<VAPID_PRIVATE_KEY>`), NUNCA en el repo. Pública en `NEXT_PUBLIC_VAPID_PUBLIC_KEY`. |
| iOS | Web Push solo con PWA instalada en pantalla de inicio (iOS 16.4+). Documentado en la UI. |

---

## Task 1: Verificar prerequisitos de S2 (tablas + RLS)

**Files:** (solo verificación, sin cambios)

- [ ] Confirmar que las tablas existen y tienen RLS: `supabase db dump --linked --schema public | grep -E "reminders|push_subscriptions"` — output esperado: definiciones de ambas tablas con `enable row level security`.
- [ ] Verificar políticas RLS por tabla vía Supabase MCP o SQL:
  ```sql
  select tablename, policyname, cmd
  from pg_policies
  where schemaname = 'public' and tablename in ('reminders', 'push_subscriptions');
  ```
  Output esperado: una política `for all` por tabla con `using (auth.uid() = user_id)`.
- [ ] Si **alguna** tabla o política falta (S2 incompleta), DETENERSE y reportar — este plan asume CP1 cerrado. No re-crear aquí.
- [ ] Confirmar que `pg_cron` y `pg_net` están disponibles: `select * from pg_available_extensions where name in ('pg_cron','pg_net');` — output esperado: ambas listadas.

---

## Task 2: Generar VAPID keys y configurar secrets

**Files:** `.env.local`, Vercel env, Supabase secrets (ningún archivo del repo)

- [ ] Generar el par VAPID:
  ```bash
  pnpm dlx web-push generate-vapid-keys --json
  ```
  Output esperado: JSON `{ "publicKey": "B...", "privateKey": "..." }`. Copiar ambos a un lugar temporal seguro.
- [ ] Añadir la pública (no es secreto) localmente. En `.env.local`:
  ```
  NEXT_PUBLIC_VAPID_PUBLIC_KEY=<publicKey de arriba>
  ```
- [ ] Añadir la pública a Vercel (Production + Preview):
  ```bash
  vercel env add NEXT_PUBLIC_VAPID_PUBLIC_KEY production
  vercel env add NEXT_PUBLIC_VAPID_PUBLIC_KEY preview
  ```
  Pegar el mismo valor en ambos prompts.
- [ ] Guardar la privada como secret de Supabase (NUNCA en repo ni en bundle del cliente):
  ```bash
  supabase secrets set VAPID_PRIVATE_KEY=<privateKey> VAPID_PUBLIC_KEY=<publicKey> VAPID_SUBJECT=mailto:sduqueporras5@gmail.com
  ```
  Output esperado: `Finished supabase secrets set.`
- [ ] Verificar que la privada NO está en el árbol del repo: `git grep -i "privateKey" || echo "clean"` — output esperado: `clean`.
- [ ] Commit (solo si hubiera cambios versionados; aquí no debería haber ninguno — env y secrets viven fuera del repo). No commitear `.env.local` (ya en `.gitignore`).

---

## Task 3: Strings i18n del opt-in (es/en exactos)

**Files:** `lib/i18n/dict.ts`

- [ ] Leer el bloque `const en = {` y `const es = {` para conocer la convención de namespaces y alineación.
- [ ] Añadir al objeto `en` (junto a otras claves de `settings.`):
  ```ts
  // ── Cloud reminders (opt-in, S10) ──────────────────────────────────────────
  'reminders.section.title':        'Cloud reminders',
  'reminders.toggle.label':         'Send renewal reminders to my devices',
  'reminders.toggle.off':           'Off',
  'reminders.toggle.on':            'On',
  'reminders.disclosure.title':     'What this shares with Orbit’s server',
  'reminders.disclosure.body':      'To send reminders while the app is closed, Orbit stores a minimal index on its server: the service name and the renewal date only. This small subset is NOT end-to-end encrypted. Amounts, emails, card details, passwords and notes are never sent and stay encrypted on your device.',
  'reminders.disclosure.default':   'This is off by default. With it off, reminders stay on this device only.',
  'reminders.ios.note':             'On iPhone and iPad, push notifications require installing Orbit to the Home Screen (iOS 16.4 or later).',
  'reminders.permission.prompt':    'Allow notifications',
  'reminders.permission.denied':    'Notifications are blocked in your browser settings. Enable them to receive reminders.',
  'reminders.enabling':             'Enabling cloud reminders…',
  'reminders.disabling':            'Turning off and deleting your index…',
  'reminders.enabled':              'Cloud reminders are on.',
  'reminders.disabled':             'Cloud reminders are off. Your index was deleted from the server.',
  'reminders.lead.label':           'Notify me this many days before renewal',
  ```
- [ ] Añadir al objeto `es` las mismas claves traducidas:
  ```ts
  // ── Recordatorios cloud (opt-in, S10) ──────────────────────────────────────
  'reminders.section.title':        'Recordatorios en la nube',
  'reminders.toggle.label':         'Enviar recordatorios de renovación a mis dispositivos',
  'reminders.toggle.off':           'Desactivado',
  'reminders.toggle.on':            'Activado',
  'reminders.disclosure.title':     'Qué se comparte con el servidor de Orbit',
  'reminders.disclosure.body':      'Para enviarte recordatorios con la app cerrada, Orbit guarda en su servidor un índice mínimo: solo el nombre del servicio y la fecha de renovación. Este pequeño subconjunto NO está cifrado de extremo a extremo. Los importes, correos, datos de tarjeta, contraseñas y notas nunca se envían y permanecen cifrados en tu dispositivo.',
  'reminders.disclosure.default':   'Esto está desactivado por defecto. Mientras esté desactivado, los recordatorios solo viven en este dispositivo.',
  'reminders.ios.note':             'En iPhone y iPad, las notificaciones push requieren instalar Orbit en la pantalla de inicio (iOS 16.4 o posterior).',
  'reminders.permission.prompt':    'Permitir notificaciones',
  'reminders.permission.denied':    'Las notificaciones están bloqueadas en los ajustes del navegador. Actívalas para recibir recordatorios.',
  'reminders.enabling':             'Activando recordatorios en la nube…',
  'reminders.disabling':            'Desactivando y borrando tu índice…',
  'reminders.enabled':              'Recordatorios en la nube activados.',
  'reminders.disabled':             'Recordatorios en la nube desactivados. Tu índice se borró del servidor.',
  'reminders.lead.label':           'Avisarme estos días antes de la renovación',
  ```
- [ ] Typecheck: `pnpm exec tsc --noEmit` — output esperado: sin errores (el tipo `DictKey` se deriva de las claves; ambos objetos deben tener el mismo set).
- [ ] Commit: `feat(i18n): add cloud-reminders opt-in strings (es/en)`.

---

## Task 4: Lógica pura de la ventana de recordatorio (TDD)

**Files:** `lib/reminders/reminder-window.ts`, `tests/reminders/reminder-window.test.ts`

- [ ] PRIMERO el test. Escribir `tests/reminders/reminder-window.test.ts`:
  ```ts
  import { describe, it, expect } from 'vitest';
  import { isReminderDue, daysUntil, buildReminderIndex } from '@/lib/reminders/reminder-window';
  import type { Subscription } from '@/lib/types';

  describe('daysUntil', () => {
    it('returns 0 for same day', () => {
      expect(daysUntil('2026-06-06', new Date('2026-06-06T12:00:00Z'))).toBe(0);
    });
    it('returns positive for future', () => {
      expect(daysUntil('2026-06-09', new Date('2026-06-06T00:00:00Z'))).toBe(3);
    });
    it('returns negative for past', () => {
      expect(daysUntil('2026-06-04', new Date('2026-06-06T00:00:00Z'))).toBe(-2);
    });
  });

  describe('isReminderDue', () => {
    const today = new Date('2026-06-06T08:00:00Z');
    it('is due when within lead window', () => {
      expect(isReminderDue({ next_renewal: '2026-06-09', lead_days: 3 }, today)).toBe(true);
    });
    it('is due exactly at the lead boundary', () => {
      expect(isReminderDue({ next_renewal: '2026-06-09', lead_days: 3 }, today)).toBe(true);
    });
    it('is NOT due before the window opens', () => {
      expect(isReminderDue({ next_renewal: '2026-06-20', lead_days: 3 }, today)).toBe(false);
    });
    it('is due on renewal day (0 days left)', () => {
      expect(isReminderDue({ next_renewal: '2026-06-06', lead_days: 3 }, today)).toBe(true);
    });
    it('is NOT due after renewal passed', () => {
      expect(isReminderDue({ next_renewal: '2026-06-01', lead_days: 3 }, today)).toBe(false);
    });
  });

  describe('buildReminderIndex', () => {
    const subs: Subscription[] = [
      { id: '1', serviceName: 'Netflix', amount: 15.99, currency: 'USD', billingCycle: 'monthly', nextRenewalDate: '2026-07-01', status: 'active' } as Subscription,
      { id: '2', serviceName: 'Spotify', amount: 9.99, currency: 'USD', billingCycle: 'monthly', nextRenewalDate: '2026-07-05', status: 'paused' } as Subscription,
    ];
    it('maps only active subs to minimal index entries (no amounts)', () => {
      const idx = buildReminderIndex(subs, 3);
      expect(idx).toEqual([
        { service_label: 'Netflix', next_renewal: '2026-07-01', lead_days: 3 },
      ]);
    });
    it('never includes amount/currency/sensitive fields', () => {
      const idx = buildReminderIndex(subs, 5);
      for (const e of idx) {
        expect(Object.keys(e).sort()).toEqual(['lead_days', 'next_renewal', 'service_label']);
      }
    });
  });
  ```
- [ ] Correr el test, confirmar que FALLA (módulo no existe): `pnpm test reminder-window` — output esperado: error de import / tests rojos.
- [ ] Implementar `lib/reminders/reminder-window.ts`:
  ```ts
  import type { Subscription } from '@/lib/types';

  export interface ReminderIndexEntry {
    service_label: string;
    next_renewal: string; // YYYY-MM-DD
    lead_days: number;
  }

  /** Whole-day difference between an ISO date (YYYY-MM-DD) and a reference instant, in UTC. */
  export function daysUntil(isoDate: string, now: Date): number {
    const target = Date.parse(`${isoDate}T00:00:00Z`);
    const ref = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    return Math.round((target - ref) / 86_400_000);
  }

  /** Due when the renewal is within [0, lead_days] days from now (inclusive of renewal day). */
  export function isReminderDue(
    r: { next_renewal: string; lead_days: number },
    now: Date,
  ): boolean {
    const left = daysUntil(r.next_renewal, now);
    return left >= 0 && left <= r.lead_days;
  }

  /** Derive the MINIMAL plaintext index from the decrypted vault. Only active subs. No amounts/cards/emails. */
  export function buildReminderIndex(subs: Subscription[], leadDays: number): ReminderIndexEntry[] {
    return subs
      .filter((s) => s.status === 'active' && !!s.nextRenewalDate)
      .map((s) => ({
        service_label: s.serviceName,
        next_renewal: s.nextRenewalDate,
        lead_days: leadDays,
      }));
  }
  ```
  Ajustar el import de `Subscription` y el campo de estado a los nombres reales de `lib/types.ts` si difieren (leerlo primero; usar `status === 'active'` o el equivalente real).
- [ ] Correr: `pnpm test reminder-window` — output esperado: todos verdes.
- [ ] Commit: `feat(reminders): pure reminder-window logic + minimal index builder (TDD)`.

---

## Task 5: Cliente — sync del índice y suscripción Web Push

**Files:** `lib/reminders/cloud-reminders.ts`, `lib/push/subscribe.ts`

- [ ] Leer `lib/supabase/client.ts` (creado en S4) para reusar `createBrowserClient`. Si no existe el helper esperado, leer cómo se instancia el client en el código de sync de S6.
- [ ] Implementar `lib/push/subscribe.ts`:
  ```ts
  'use client';

  import { createClient } from '@/lib/supabase/client';

  /** Decode a base64url VAPID public key to the Uint8Array PushManager expects. */
  function urlBase64ToUint8Array(base64: string): Uint8Array {
    const padding = '='.repeat((4 - (base64.length % 4)) % 4);
    const b64 = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
    const raw = atob(b64);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  }

  export type PushSupport =
    | { supported: true }
    | { supported: false; reason: 'no-sw' | 'no-push' | 'no-permission-api' };

  export function detectPushSupport(): PushSupport {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      return { supported: false, reason: 'no-sw' };
    }
    if (!('PushManager' in window)) return { supported: false, reason: 'no-push' };
    if (!('Notification' in window)) return { supported: false, reason: 'no-permission-api' };
    return { supported: true };
  }

  /** Request permission, subscribe via PushManager, and persist the subscription in Supabase. */
  export async function enablePush(): Promise<{ ok: true } | { ok: false; reason: string }> {
    const support = detectPushSupport();
    if (!support.supported) return { ok: false, reason: support.reason };

    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return { ok: false, reason: 'permission-denied' };

    const reg = await navigator.serviceWorker.ready;
    const vapid = process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY;
    if (!vapid) return { ok: false, reason: 'missing-vapid-key' };

    const sub = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapid),
    });

    const json = sub.toJSON();
    const supabase = createClient();
    const { error } = await supabase.from('push_subscriptions').upsert(
      {
        endpoint: json.endpoint!,
        p256dh: json.keys!.p256dh,
        auth: json.keys!.auth,
      },
      { onConflict: 'endpoint' },
    );
    if (error) return { ok: false, reason: error.message };
    return { ok: true };
  }

  /** Unsubscribe locally and delete this device's subscription server-side. */
  export async function disablePush(): Promise<void> {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (!sub) return;
    const endpoint = sub.endpoint;
    await sub.unsubscribe();
    const supabase = createClient();
    await supabase.from('push_subscriptions').delete().eq('endpoint', endpoint);
  }
  ```
  Nota: el RLS de `push_subscriptions` setea `user_id = auth.uid()` vía `with check`; añadir `user_id` no es necesario si hay un default/trigger, pero si la inserción falla por `user_id null`, añadir `user_id: (await supabase.auth.getUser()).data.user!.id` al payload del upsert. Verificar al probar (Task 9).
- [ ] Implementar `lib/reminders/cloud-reminders.ts`:
  ```ts
  'use client';

  import { createClient } from '@/lib/supabase/client';
  import { buildReminderIndex } from './reminder-window';
  import type { Subscription } from '@/lib/types';

  /** Push the minimal plaintext index to public.reminders. Idempotent: replace-all per user. */
  export async function syncReminderIndex(subs: Subscription[], leadDays: number): Promise<void> {
    const supabase = createClient();
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) throw new Error('not-signed-in');

    const index = buildReminderIndex(subs, leadDays);

    // Replace-all: delete the user's existing rows, then insert the fresh index.
    // Keeps the server index a faithful, minimal mirror without stale entries.
    const del = await supabase.from('reminders').delete().eq('user_id', userId);
    if (del.error) throw del.error;

    if (index.length > 0) {
      const rows = index.map((e) => ({ ...e, user_id: userId }));
      const ins = await supabase.from('reminders').insert(rows);
      if (ins.error) throw ins.error;
    }
  }

  /** OFF path: delete EVERY reminder row for the user. Verifiable server-side deletion. */
  export async function clearReminderIndex(): Promise<void> {
    const supabase = createClient();
    const { data: userData } = await supabase.auth.getUser();
    const userId = userData.user?.id;
    if (!userId) return;
    const { error } = await supabase.from('reminders').delete().eq('user_id', userId);
    if (error) throw error;
  }
  ```
- [ ] Typecheck: `pnpm exec tsc --noEmit` — output esperado: sin errores.
- [ ] Commit: `feat(reminders): cloud index sync + web push subscribe/unsubscribe`.

---

## Task 6: Handler `push` + `notificationclick` en el service worker

**Files:** `app/sw.ts`

- [ ] Leer el `app/sw.ts` actual (Serwist: instancia `serwist`, llama `serwist.addEventListeners()`). Los listeners de push deben registrarse **además** de los de Serwist, sin romper el precache.
- [ ] Editar `app/sw.ts` para añadir, **antes** de `serwist.addEventListeners();`, los listeners de push:
  ```ts
  // ── Web Push (S10): opt-in cloud reminders ────────────────────────────────
  // Payload shape (set by supabase/functions/send-reminders): { title, body, url }
  // NEVER contains amounts, emails, card data, passwords or notes.
  self.addEventListener("push", (event: PushEvent) => {
    const data = (() => {
      try {
        return event.data?.json() as { title?: string; body?: string; url?: string };
      } catch {
        return { body: event.data?.text() };
      }
    })();

    const title = data.title ?? "Orbit";
    const options: NotificationOptions = {
      body: data.body ?? "",
      icon: "/icon-192.png",
      badge: "/icon-192.png",
      data: { url: data.url ?? "/subscriptions" },
      tag: "orbit-reminder",
    };
    event.waitUntil(self.registration.showNotification(title, options));
  });

  self.addEventListener("notificationclick", (event: NotificationEvent) => {
    event.notification.close();
    const url = (event.notification.data as { url?: string })?.url ?? "/subscriptions";
    event.waitUntil(
      self.clients
        .matchAll({ type: "window", includeUncontrolled: true })
        .then((clients) => {
          for (const client of clients) {
            if ("focus" in client) {
              (client as WindowClient).navigate(url);
              return (client as WindowClient).focus();
            }
          }
          return self.clients.openWindow(url);
        }),
    );
  });
  ```
- [ ] Verificar tipos del SW: `pnpm exec tsc --noEmit` — output esperado: sin errores (el `/// <reference lib="webworker" />` y `declare const self: ServiceWorkerGlobalScope` ya dan `PushEvent`/`NotificationEvent`).
- [ ] Verificar que el build genera el SW con los handlers: `pnpm build` y luego confirmar que `public/sw.js` contiene `"push"`: `git grep -c "addEventListener" public/sw.js 2>/dev/null || grep -c push public/sw.js`. Output esperado: el `sw.js` compilado incluye el handler push (no vacío).
- [ ] Commit: `feat(sw): push + notificationclick handlers for cloud reminders`.

---

## Task 7: Edge Function `send-reminders` (Deno completo)

**Files:** `supabase/functions/send-reminders/index.ts`, `supabase/functions/send-reminders/deno.json`

- [ ] Research vía context7: API actual de `web-push` para Deno o el patrón de firma VAPID JWT manual. Usaremos `npm:web-push` (Supabase Edge runtime soporta `npm:` specifiers).
- [ ] Crear `supabase/functions/send-reminders/deno.json`:
  ```json
  {
    "imports": {
      "@supabase/supabase-js": "npm:@supabase/supabase-js@2",
      "web-push": "npm:web-push@3.6.7"
    }
  }
  ```
- [ ] Crear `supabase/functions/send-reminders/index.ts` (Deno completo):
  ```ts
  // send-reminders — invoked daily by pg_cron.
  // Finds due reminders (next_renewal - lead_days <= today <= next_renewal),
  // looks up each user's push subscriptions, and sends a minimal Web Push.
  // Payload carries ONLY service label + days left. No sensitive vault data.
  // Dedupe per (user, service_label, day) via the sent_reminders log table.

  import { createClient } from "@supabase/supabase-js";
  import webpush from "web-push";

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const VAPID_PUBLIC = Deno.env.get("VAPID_PUBLIC_KEY")!;
  const VAPID_PRIVATE = Deno.env.get("VAPID_PRIVATE_KEY")!;
  const VAPID_SUBJECT = Deno.env.get("VAPID_SUBJECT") ?? "mailto:sduqueporras5@gmail.com";

  webpush.setVapidDetails(VAPID_SUBJECT, VAPID_PUBLIC, VAPID_PRIVATE);

  interface ReminderRow {
    id: string;
    user_id: string;
    service_label: string;
    next_renewal: string; // YYYY-MM-DD
    lead_days: number;
  }
  interface PushSub {
    id: string;
    user_id: string;
    endpoint: string;
    p256dh: string;
    auth: string;
  }

  function daysUntil(isoDate: string, now: Date): number {
    const target = Date.parse(`${isoDate}T00:00:00Z`);
    const ref = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
    return Math.round((target - ref) / 86_400_000);
  }

  function bodyFor(label: string, daysLeft: number): string {
    if (daysLeft <= 0) return `${label} renews today.`;
    if (daysLeft === 1) return `${label} renews tomorrow.`;
    return `${label} renews in ${daysLeft} days.`;
  }

  Deno.serve(async (req) => {
    // Only allow the scheduled invocation (pg_cron passes the service role key).
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${SERVICE_ROLE}`) {
      return new Response("forbidden", { status: 403 });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { persistSession: false },
    });

    const now = new Date();
    const today = now.toISOString().slice(0, 10);

    // Pull all reminders; filter due ones in code (small table; index is per-user minimal).
    const { data: reminders, error: rErr } = await supabase
      .from("reminders")
      .select("id, user_id, service_label, next_renewal, lead_days");
    if (rErr) return new Response(`reminders error: ${rErr.message}`, { status: 500 });

    const due = (reminders as ReminderRow[]).filter((r) => {
      const left = daysUntil(r.next_renewal, now);
      return left >= 0 && left <= r.lead_days;
    });

    let sent = 0;
    let pruned = 0;

    for (const r of due) {
      // Dedupe: skip if we already logged a send today for this user+label.
      const { data: already } = await supabase
        .from("sent_reminders")
        .select("id")
        .eq("user_id", r.user_id)
        .eq("service_label", r.service_label)
        .eq("sent_on", today)
        .maybeSingle();
      if (already) continue;

      const { data: subs } = await supabase
        .from("push_subscriptions")
        .select("id, user_id, endpoint, p256dh, auth")
        .eq("user_id", r.user_id);
      if (!subs || subs.length === 0) continue;

      const daysLeft = daysUntil(r.next_renewal, now);
      const payload = JSON.stringify({
        title: "Upcoming renewal",
        body: bodyFor(r.service_label, daysLeft),
        url: "/subscriptions",
      });

      let deliveredAny = false;
      for (const s of subs as PushSub[]) {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            payload,
          );
          deliveredAny = true;
          sent++;
        } catch (err) {
          // 404/410 => subscription expired; prune it.
          const status = (err as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) {
            await supabase.from("push_subscriptions").delete().eq("id", s.id);
            pruned++;
          }
        }
      }

      if (deliveredAny) {
        await supabase
          .from("sent_reminders")
          .insert({ user_id: r.user_id, service_label: r.service_label, sent_on: today });
      }
    }

    return new Response(JSON.stringify({ ok: true, due: due.length, sent, pruned }), {
      headers: { "content-type": "application/json" },
    });
  });
  ```
- [ ] Commit: `feat(functions): send-reminders edge function (deno, vapid web push)`.

---

## Task 8: Migración — tabla `sent_reminders`, cron diario, keep-alive

**Files:** `supabase/migrations/<timestamp>_s10_reminders_cron.sql`

- [ ] Crear la migración con timestamp: `supabase migration new s10_reminders_cron`. Editar el archivo generado:
  ```sql
  -- S10: dedupe log for sent reminders + daily pg_cron sender + keep-alive ping.

  -- Per-day dedupe log so a user never gets the same reminder twice in one day.
  create table if not exists public.sent_reminders (
    id            uuid primary key default gen_random_uuid(),
    user_id       uuid not null references auth.users(id) on delete cascade,
    service_label text not null,
    sent_on       date not null default current_date,
    created_at    timestamptz not null default now(),
    unique (user_id, service_label, sent_on)
  );

  alter table public.sent_reminders enable row level security;

  -- The Edge Function uses the service role (bypasses RLS). End users never read this table,
  -- but lock it down anyway: a user may only see their own send log.
  create policy "own sent_reminders" on public.sent_reminders
    for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

  -- Prune old dedupe rows weekly to keep the table tiny.
  create index if not exists sent_reminders_sent_on_idx on public.sent_reminders (sent_on);

  -- Extensions for scheduling + outbound HTTP.
  create extension if not exists pg_cron;
  create extension if not exists pg_net;

  -- Store the service-role key + function URL as DB-level settings the cron job reads.
  -- Set these once via: alter database postgres set "app.send_reminders_url" = '...';
  --                      alter database postgres set "app.service_role_key"  = '...';
  -- (done in Task 8 verification steps below, not committed to the repo).

  -- Daily reminder send at 13:00 UTC (08:00 GMT-5). Invokes the edge function via pg_net.
  select cron.schedule(
    'send-reminders-daily',
    '0 13 * * *',
    $$
    select net.http_post(
      url     := current_setting('app.send_reminders_url'),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || current_setting('app.service_role_key')
      ),
      body    := '{}'::jsonb
    );
    $$
  );

  -- Keep-alive: a trivial daily query so the Supabase free-tier project never hits the
  -- 7-day inactivity pause. Cheap, no external call.
  select cron.schedule(
    'keep-alive-daily',
    '17 4 * * *',
    $$ select 1; $$
  );

  -- Weekly cleanup of dedupe log older than 14 days.
  select cron.schedule(
    'prune-sent-reminders',
    '0 3 * * 0',
    $$ delete from public.sent_reminders where sent_on < current_date - interval '14 days'; $$
  );
  ```
- [ ] Setear los settings de DB (NO en el repo) — usar el SQL editor del MCP o `psql`:
  ```sql
  alter database postgres set "app.send_reminders_url" = 'https://vmcjkleuetcogqhdnlfx.supabase.co/functions/v1/send-reminders';
  alter database postgres set "app.service_role_key" = '<SERVICE_ROLE_KEY>';
  ```
  El service role key vive solo en Supabase (es el del proyecto). NUNCA en el repo.
- [ ] Aplicar la migración: `supabase db push` — output esperado: migración aplicada sin error.
- [ ] Desplegar la función: `supabase functions deploy send-reminders` — output esperado: `Deployed Function send-reminders`.
- [ ] Verificar los cron jobs: `select jobname, schedule from cron.job;` — output esperado: `send-reminders-daily`, `keep-alive-daily`, `prune-sent-reminders`.
- [ ] Commit: `feat(db): sent_reminders dedupe + daily reminder cron + keep-alive`.

---

## Task 9: UI del opt-in en Settings

**Files:** `app/(vault)/settings/page.tsx` (o un sub-componente `components/settings/CloudRemindersSection.tsx`)

- [ ] Leer `app/(vault)/settings/page.tsx` para conocer el patrón de secciones, el uso de `useT()` y de `useSettingsStore`.
- [ ] Si `useSettingsStore` no tiene `cloudReminders`/`reminderLeadDays`, añadirlos al store de settings (leer `lib/store/settings-store.ts` y extender el shape + el persist). Default: `cloudReminders: false`, `reminderLeadDays: 3`.
- [ ] Crear `components/settings/CloudRemindersSection.tsx`:
  ```tsx
  'use client';

  import { useState } from 'react';
  import { useT } from '@/lib/i18n/use-t';
  import { useSettingsStore } from '@/lib/store/settings-store';
  import { useVaultStore } from '@/lib/store/vault-store';
  import { enablePush, disablePush, detectPushSupport } from '@/lib/push/subscribe';
  import { syncReminderIndex, clearReminderIndex } from '@/lib/reminders/cloud-reminders';

  export function CloudRemindersSection() {
    const t = useT();
    const enabled = useSettingsStore((s) => s.settings.cloudReminders);
    const leadDays = useSettingsStore((s) => s.settings.reminderLeadDays);
    const setSettings = useSettingsStore((s) => s.update);
    const subscriptions = useVaultStore((s) => s.data?.subscriptions ?? []);
    const [busy, setBusy] = useState(false);
    const [msg, setMsg] = useState<string | null>(null);

    const support = detectPushSupport();

    async function turnOn() {
      setBusy(true);
      setMsg(t('reminders.enabling'));
      try {
        const res = await enablePush();
        if (!res.ok) {
          setMsg(res.reason === 'permission-denied' ? t('reminders.permission.denied') : res.reason);
          setBusy(false);
          return;
        }
        await syncReminderIndex(subscriptions, leadDays);
        setSettings({ cloudReminders: true });
        setMsg(t('reminders.enabled'));
      } catch (e) {
        setMsg(String(e));
      } finally {
        setBusy(false);
      }
    }

    async function turnOff() {
      setBusy(true);
      setMsg(t('reminders.disabling'));
      try {
        await disablePush();
        await clearReminderIndex();
        setSettings({ cloudReminders: false });
        setMsg(t('reminders.disabled'));
      } catch (e) {
        setMsg(String(e));
      } finally {
        setBusy(false);
      }
    }

    return (
      <section aria-labelledby="cloud-reminders-heading" className="space-y-4">
        <h2 id="cloud-reminders-heading" className="text-lg font-heading">
          {t('reminders.section.title')}
        </h2>

        {/* Honest disclosure — always visible, even when off. */}
        <div className="rounded-lg border border-border bg-muted/40 p-4 text-sm space-y-2">
          <p className="font-medium">{t('reminders.disclosure.title')}</p>
          <p className="text-muted-foreground">{t('reminders.disclosure.body')}</p>
          <p className="text-muted-foreground">{t('reminders.disclosure.default')}</p>
          <p className="text-muted-foreground">{t('reminders.ios.note')}</p>
        </div>

        <div className="flex items-center justify-between gap-4">
          <label htmlFor="cloud-reminders-toggle" className="text-sm">
            {t('reminders.toggle.label')}
          </label>
          <button
            id="cloud-reminders-toggle"
            type="button"
            role="switch"
            aria-checked={enabled}
            disabled={busy || !support.supported}
            onClick={enabled ? turnOff : turnOn}
            className="min-h-[44px] min-w-[44px] rounded-md border border-border px-4"
          >
            {enabled ? t('reminders.toggle.on') : t('reminders.toggle.off')}
          </button>
        </div>

        {msg && <p className="text-sm text-muted-foreground" role="status">{msg}</p>}
      </section>
    );
  }
  ```
  Ajustar selectores del store (`useVaultStore`, nombre de la colección de subs, `update`) a los nombres reales tras leer los stores. Mantener targets ≥44px y la sección oculta el toggle (disabled) cuando no hay soporte de push.
- [ ] Montar `<CloudRemindersSection />` en `app/(vault)/settings/page.tsx`, gateado por la feature flag y la sesión: solo renderizar si `process.env.NEXT_PUBLIC_SYNC_ENABLED === 'true'` y hay usuario autenticado (reusar `useAuthStore` de S4).
- [ ] Typecheck + lint: `pnpm exec tsc --noEmit && pnpm lint` — output esperado: limpio.
- [ ] Commit: `feat(settings): cloud reminders opt-in UI with honest disclosure`.

---

## Task 10: Checklist manual de push real en dispositivo

**Files:** `docs/manual-checklists/s10-push.md` (nuevo)

- [ ] Crear `docs/manual-checklists/s10-push.md` con el checklist (este archivo SÍ es entregable de QA):
  ```md
  # S10 — Web Push manual verification

  Requiere un deploy con `NEXT_PUBLIC_SYNC_ENABLED=true` y sesión iniciada.

  ## Android (Chrome) — PWA instalada o pestaña
  - [ ] Sign in con Google.
  - [ ] Settings → Cloud reminders → toggle ON → aceptar el prompt de notificaciones.
  - [ ] Confirmar fila en `push_subscriptions` para el usuario (Supabase MCP / SQL).
  - [ ] Crear una suscripción con `nextRenewalDate` = hoy + 1 día y `status` active.
  - [ ] Forzar el envío: `supabase functions invoke send-reminders --no-verify-jwt` con header de service role, o esperar al cron 13:00 UTC.
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
  ```
- [ ] Ejecutar el checklist en al menos un dispositivo real (Android es suficiente para el gate automático; iOS documentar resultado). Marcar resultados.
- [ ] Commit: `docs(qa): S10 web push manual checklist`.

---

## Task 11: Gates y cierre

**Files:** (verificación)

- [ ] Tests unit verdes: `pnpm test` — output esperado: toda la suite verde, incluido `reminder-window`.
- [ ] Typecheck + lint: `pnpm exec tsc --noEmit && pnpm lint` — limpio.
- [ ] Build: `pnpm build` — output esperado: build exitoso; `public/sw.js` con los handlers push.
- [ ] Gate `database-reviewer`: revisar la migración `s10_reminders_cron` (RLS de `sent_reminders`, cron jobs, `security` de funciones). Adjuntar veredicto.
- [ ] Gate `/security-review`: cubre VAPID secret handling (privada solo en Supabase secrets), payload sin datos sensibles, auth de la Edge Function (`Bearer service_role`), disclosure honesto. Adjuntar veredicto.
- [ ] Gate `/code-review` sobre el diff completo.
- [ ] Verificar zero-knowledge intacto: el blob del vault sigue opaco; solo `reminders` (opt-in) y `sent_reminders` son plaintext, ambos documentados. `git grep -i "encrypted_blob" supabase/functions/send-reminders` — output esperado: vacío (la función nunca toca el blob).
- [ ] Commit final: `feat(s10): opt-in cloud reminders via web push + pg_cron (CP5)`.
- [ ] `/compact`.
