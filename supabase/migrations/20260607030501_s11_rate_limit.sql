-- S11: per-user rate limiting for vault writes, enforced inside upsert_vault.

create table if not exists public.rate_limits (
  user_id      uuid not null references auth.users(id) on delete cascade,
  bucket       text not null,            -- e.g. 'upsert_vault'
  window_start timestamptz not null,
  count        int not null default 0,
  primary key (user_id, bucket, window_start)
);

alter table public.rate_limits enable row level security;
-- No end-user access: only SECURITY DEFINER functions touch this table.
-- No policy = deny-all under RLS; revoke also strips the grants Supabase's
-- default privileges hand to anon/authenticated on new public tables.
revoke all on table public.rate_limits from public, anon, authenticated;

-- Fixed-window check: max N writes per WINDOW per user+bucket.
create or replace function public.check_rate_limit(
  p_bucket text, p_max int, p_window interval
) returns void language plpgsql security definer
set search_path = public as $$
declare
  v_window timestamptz := date_trunc('minute', now());
  v_count int;
begin
  -- Collapse to one row per (user, bucket, minute-window).
  insert into public.rate_limits (user_id, bucket, window_start, count)
    values (auth.uid(), p_bucket, v_window, 1)
  on conflict (user_id, bucket, window_start)
    do update set count = public.rate_limits.count + 1
    returning count into v_count;

  if v_count > p_max then
    raise exception 'rate limit exceeded for %', p_bucket using errcode = 'P0001';
  end if;

  -- Opportunistic cleanup of stale windows for this user/bucket.
  delete from public.rate_limits
  where user_id = auth.uid() and bucket = p_bucket
    and window_start < now() - (p_window * 2);
end $$;

-- Recreate upsert_vault as SECURITY DEFINER so it can write rate_limits,
-- while STILL scoping every row to auth.uid() (RLS-equivalent in code).
create or replace function public.upsert_vault(
  p_meta text, p_blob text, p_expected_version bigint
) returns public.vaults language plpgsql security definer
set search_path = public as $$
declare result public.vaults;
begin
  if auth.uid() is null then
    raise exception 'not_authenticated' using errcode = '42501';
  end if;

  -- Rate limit: max 30 vault writes per minute per user (covers debounced sync bursts).
  perform public.check_rate_limit('upsert_vault', 30, interval '1 minute');

  insert into public.vaults as v (user_id, encrypted_meta, encrypted_blob, version, updated_at)
    values (auth.uid(), p_meta, p_blob, 1, now())
  on conflict (user_id) do update
    set encrypted_meta = excluded.encrypted_meta,
        encrypted_blob = excluded.encrypted_blob,
        version        = v.version + 1,
        updated_at     = now()
    where v.version = p_expected_version
  returning * into result;

  if result is null then
    raise exception 'version_conflict' using errcode = '40001';
  end if;
  return result;
end $$;

-- Lock down EXECUTE: only authenticated users may call upsert_vault; the
-- rate-limit helper is internal-only (reachable solely through upsert_vault).
revoke all on function public.upsert_vault(text, text, bigint) from public, anon;
grant execute on function public.upsert_vault(text, text, bigint) to authenticated;
revoke all on function public.check_rate_limit(text, int, interval) from public, anon, authenticated;
