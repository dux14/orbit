-- S10b: review hardening for the reminders pipeline (database-reviewer findings).

-- The edge function now queries reminders by date range; give it a range index.
create index if not exists reminders_next_renewal_idx
  on public.reminders (next_renewal);

-- Per-user subscription fan-out lookup in the edge function.
create index if not exists push_subscriptions_user_id_idx
  on public.push_subscriptions (user_id);

-- Redundant: the unique constraint (user_id, service_label, sent_on) already
-- provides the dedupe-lookup index, and the weekly prune can use it too.
drop index if exists public.sent_reminders_sent_on_idx;

-- Tighten sent_reminders: only the service role writes this table. FOR ALL
-- would let an authenticated user fabricate dedupe rows and suppress their
-- own notifications; read-own-log is all clients ever need.
drop policy if exists "own sent_reminders" on public.sent_reminders;
create policy "read own sent_reminders" on public.sent_reminders
  for select using (auth.uid() = user_id);
