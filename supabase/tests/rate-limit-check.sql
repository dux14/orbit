-- ── RATE LIMIT CHECK (S11) ──────────────────────────────────────────────────
-- Reproducible harness for the upsert_vault rate limit (30 writes/min/user).
-- Requires the rls-% test users + seeded vault from rls-audit.sql (setup
-- section). Run in the SQL editor / Management API (admin context).
-- Executed 2026-06-06 against vmcjkleuetcogqhdnlfx; outputs recorded in
-- docs/manual-checklists/s11-rls.md §2.1. ALL checks passed.

-- 1. 31 consecutive writes as user A: #1–30 succeed, #31 raises.
--    Runs inside one transaction and rolls back (no leftover rate_limits rows).
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
  do $$
  declare v bigint; i int;
  begin
    select version into v from public.vaults where user_id = auth.uid();
    for i in 1..31 loop
      begin
        perform public.upsert_vault('{"meta":"A"}', 'ct-rl-test', v);
        v := v + 1;
      exception when others then
        raise exception 'failed at call %: %', i, sqlerrm;
      end;
    end loop;
  end $$;
  -- EXPECTED: ERROR  failed at call 31: rate limit exceeded for upsert_vault
rollback;

-- 2. anon cannot execute upsert_vault at all.
begin;
  set local role anon;
  select public.upsert_vault('{}', 'x', 1);
  -- EXPECTED: ERROR  42501 permission denied for function upsert_vault
rollback;

-- 3. authenticated cannot call the internal helper directly.
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
  select public.check_rate_limit('upsert_vault', 30, interval '1 minute');
  -- EXPECTED: ERROR  42501 permission denied for function check_rate_limit
rollback;

-- 4. authenticated cannot read the rate_limits table.
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
  select count(*) from public.rate_limits;
  -- EXPECTED: ERROR  42501 permission denied for table rate_limits
rollback;

-- 5. No leftover state after the harness (the 31-call test rolled back).
select count(*) as leftover_rate_limit_rows from public.rate_limits
where user_id = 'aaaaaaaa-0000-0000-0000-000000000001';
-- EXPECTED: 0
