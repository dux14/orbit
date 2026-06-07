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

// Constant-time bearer comparison: this string check is the entire authorization
// surface of an RLS-bypassing endpoint, so don't leak prefix length via timing.
async function timingSafeEqual(a: string, b: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [ha, hb] = await Promise.all([
    crypto.subtle.digest("SHA-256", enc.encode(a)),
    crypto.subtle.digest("SHA-256", enc.encode(b)),
  ]);
  const x = new Uint8Array(ha);
  const y = new Uint8Array(hb);
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x[i] ^ y[i];
  return diff === 0;
}

// Server-side date bound for the reminders query. Lead windows beyond this many
// days enter the send window late; default lead is 3, so 60 is a generous cap.
const MAX_LEAD_DAYS = 60;

Deno.serve(async (req) => {
  // Only allow the scheduled invocation (pg_cron passes the service role key).
  const auth = req.headers.get("authorization") ?? "";
  if (!(await timingSafeEqual(auth, `Bearer ${SERVICE_ROLE}`))) {
    return new Response("forbidden", { status: 403 });
  }

  const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
    auth: { persistSession: false },
  });

  const now = new Date();
  const today = now.toISOString().slice(0, 10);

  // Date-bounded query (uses the reminders_next_renewal_idx range index):
  // past renewals are never due, and nothing beyond MAX_LEAD_DAYS can be due.
  // The exact per-row [0, lead_days] window is then applied in code.
  const horizon = new Date(now.getTime() + MAX_LEAD_DAYS * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const { data: reminders, error: rErr } = await supabase
    .from("reminders")
    .select("id, user_id, service_label, next_renewal, lead_days")
    .gte("next_renewal", today)
    .lte("next_renewal", horizon);
  if (rErr) return new Response(`reminders error: ${rErr.message}`, { status: 500 });

  const due = (reminders as ReminderRow[])
    .map((r) => ({ ...r, daysLeft: daysUntil(r.next_renewal, now) }))
    .filter((r) => r.daysLeft >= 0 && r.daysLeft <= r.lead_days);

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

    const payload = JSON.stringify({
      title: "Upcoming renewal",
      body: bodyFor(r.service_label, r.daysLeft),
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
          const { error: delErr } = await supabase
            .from("push_subscriptions")
            .delete()
            .eq("id", s.id);
          if (!delErr) pruned++;
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
