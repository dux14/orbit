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

-- The function URL + service-role key live in Supabase Vault (NOT in the repo):
--   select vault.create_secret('<url>',  'send_reminders_url');
--   select vault.create_secret('<key>',  'service_role_key');
-- (created once during S10 setup; `alter database ... set` is not permitted on
-- Supabase managed Postgres, so Vault is the supported pattern for cron secrets).

-- Daily reminder send at 13:00 UTC (08:00 GMT-5). Invokes the edge function via pg_net.
select cron.schedule(
  'send-reminders-daily',
  '0 13 * * *',
  $$
  select net.http_post(
    url     := (select decrypted_secret from vault.decrypted_secrets where name = 'send_reminders_url'),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'service_role_key')
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
