-- The encrypted vault (one row per user; single-blob model)
create table public.vaults (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  encrypted_meta  text not null,   -- JSON: schemaVersion + kdf{salt,params} + verifier (NO secrets)
  encrypted_blob  text not null,   -- AES-256-GCM ciphertext of VaultData (opaque to server)
  version      bigint not null default 1,
  updated_at   timestamptz not null default now()
);

-- Opt-in, NON-zero-knowledge minimal reminder index (only if cloud reminders enabled)
create table public.reminders (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  service_label text not null,        -- e.g. "Netflix" (no amounts/emails/cards)
  next_renewal  date not null,
  lead_days     int  not null default 3,
  updated_at    timestamptz not null default now()
);

-- Web Push subscriptions (per device)
create table public.push_subscriptions (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users(id) on delete cascade,
  endpoint    text not null unique,
  p256dh      text not null,
  auth        text not null,
  created_at  timestamptz not null default now()
);

alter table public.vaults             enable row level security;
alter table public.reminders          enable row level security;
alter table public.push_subscriptions enable row level security;

-- RLS: a user may only touch their own rows
create policy "own vault"     on public.vaults
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own reminders" on public.reminders
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "own pushsubs"  on public.push_subscriptions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- Optimistic concurrency: only advance if the client's expected version matches
create or replace function public.upsert_vault(
  p_meta text, p_blob text, p_expected_version bigint
) returns public.vaults language plpgsql security invoker as $$
declare result public.vaults;
begin
  insert into public.vaults as v (user_id, encrypted_meta, encrypted_blob, version, updated_at)
    values (auth.uid(), p_meta, p_blob, 1, now())
  on conflict (user_id) do update
    set encrypted_meta = excluded.encrypted_meta,
        encrypted_blob = excluded.encrypted_blob,
        version        = v.version + 1,
        updated_at     = now()
    where v.version = p_expected_version       -- conflict if mismatch
  returning * into result;
  if result is null then
    raise exception 'version_conflict' using errcode = '40001';
  end if;
  return result;
end $$;

-- RLS verification (S2, 2026-06-06):
-- user A cannot SELECT/UPDATE user B's vaults row → denied ✔
-- upsert_vault runs as security invoker, RLS-respecting ✔
-- anon key (no session) reads 0 rows on all three tables ✔
