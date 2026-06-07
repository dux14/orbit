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
