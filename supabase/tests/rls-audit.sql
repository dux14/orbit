-- ── RLS AUDIT (S11) ─────────────────────────────────────────────────────────
-- Cross-user + anon isolation audit for every public table.
-- Run each block in the SQL editor / Management API (admin context).
-- Each block impersonates a user inside a transaction and rolls back:
--   set local role authenticated;
--   set local request.jwt.claims = '{"sub":"<uid>","role":"authenticated"}';
-- Test users (create before, delete after — see bottom):
--   A = aaaaaaaa-0000-0000-0000-000000000001 (rls-a@orbit.test)
--   B = bbbbbbbb-0000-0000-0000-000000000002 (rls-b@orbit.test)
-- Executed 2026-06-06 against vmcjkleuetcogqhdnlfx; real outputs recorded in
-- docs/manual-checklists/s11-rls.md. ALL assertions passed.

-- ── Setup (admin) ───────────────────────────────────────────────────────────
insert into auth.users (id, email, encrypted_password, email_confirmed_at, aud, role)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'rls-a@orbit.test', extensions.crypt('Passw0rd!A', extensions.gen_salt('bf')), now(), 'authenticated', 'authenticated'),
  ('bbbbbbbb-0000-0000-0000-000000000002', 'rls-b@orbit.test', extensions.crypt('Passw0rd!B', extensions.gen_salt('bf')), now(), 'authenticated', 'authenticated')
on conflict (id) do nothing;

insert into public.vaults (user_id, encrypted_meta, encrypted_blob, version)
values ('aaaaaaaa-0000-0000-0000-000000000001', '{"meta":"A"}', 'ciphertext-A', 1)
on conflict (user_id) do update set encrypted_blob = excluded.encrypted_blob;

insert into public.reminders (user_id, service_label, next_renewal)
values ('aaaaaaaa-0000-0000-0000-000000000001', 'RLS-Test-Service', '2026-07-01');

-- ── vaults ──────────────────────────────────────────────────────────────────

-- 1. User B CANNOT read A's vault.
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';
  select count(*) as b_sees_a_rows
  from public.vaults
  where user_id = 'aaaaaaaa-0000-0000-0000-000000000001';
  -- EXPECTED: b_sees_a_rows = 0
rollback;

-- 2. User B CANNOT update A's vault.
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';
  update public.vaults set encrypted_blob = 'HIJACK'
  where user_id = 'aaaaaaaa-0000-0000-0000-000000000001';
  -- EXPECTED: UPDATE 0 (RLS using-clause filters out A's row)
  select count(*) as hijacked from public.vaults where encrypted_blob = 'HIJACK';
  -- EXPECTED: hijacked = 0
rollback;

-- 3. User B CANNOT insert a row owned by A (with check blocks it).
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';
  insert into public.vaults (user_id, encrypted_meta, encrypted_blob, version)
  values ('aaaaaaaa-0000-0000-0000-000000000001', '{}', 'x', 1);
  -- EXPECTED: ERROR  new row violates row-level security policy
rollback;

-- 4. User A CAN read A's own vault.
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"aaaaaaaa-0000-0000-0000-000000000001","role":"authenticated"}';
  select count(*) as a_sees_own from public.vaults
  where user_id = 'aaaaaaaa-0000-0000-0000-000000000001';
  -- EXPECTED: a_sees_own = 1
rollback;

-- 5. anon role CANNOT read ANY vault.
begin;
  set local role anon;
  set local request.jwt.claims = '{"role":"anon"}';
  select count(*) as anon_sees from public.vaults;
  -- EXPECTED: anon_sees = 0
rollback;

-- ── reminders ───────────────────────────────────────────────────────────────

-- 6a. User B CANNOT read A's reminders.
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';
  select count(*) as b_sees_a_reminders from public.reminders
  where user_id = 'aaaaaaaa-0000-0000-0000-000000000001';
  -- EXPECTED: 0
rollback;

-- 6b. User B CANNOT update A's reminders.
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';
  update public.reminders set service_label = 'HIJACK'
  where user_id = 'aaaaaaaa-0000-0000-0000-000000000001';
  select count(*) as hijacked from public.reminders where service_label = 'HIJACK';
  -- EXPECTED: hijacked = 0
rollback;

-- 6c. User B CANNOT insert a reminder owned by A (with check blocks it).
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';
  insert into public.reminders (user_id, service_label, next_renewal)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'forged', '2026-07-01');
  -- EXPECTED: ERROR  new row violates row-level security policy
rollback;

-- 6d. anon CANNOT read any reminders.
begin;
  set local role anon;
  set local request.jwt.claims = '{"role":"anon"}';
  select count(*) as anon_sees_reminders from public.reminders;
  -- EXPECTED: 0
rollback;

-- ── push_subscriptions ──────────────────────────────────────────────────────

-- 7a. User B CANNOT read A's push subscriptions.
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';
  select count(*) as b_sees_a_subs from public.push_subscriptions
  where user_id = 'aaaaaaaa-0000-0000-0000-000000000001';
  -- EXPECTED: 0
rollback;

-- 7b. User B CANNOT insert a push subscription owned by A.
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';
  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth)
  values ('aaaaaaaa-0000-0000-0000-000000000001', 'https://example.test/forged', 'k', 'a');
  -- EXPECTED: ERROR  new row violates row-level security policy
rollback;

-- 7c. User B CANNOT update A's push subscriptions.
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';
  update public.push_subscriptions set endpoint = 'https://example.test/hijack'
  where user_id = 'aaaaaaaa-0000-0000-0000-000000000001';
  select count(*) as hijacked from public.push_subscriptions
  where endpoint = 'https://example.test/hijack';
  -- EXPECTED: hijacked = 0
rollback;

-- 7d. anon CANNOT read any push subscriptions.
begin;
  set local role anon;
  set local request.jwt.claims = '{"role":"anon"}';
  select count(*) as anon_sees_subs from public.push_subscriptions;
  -- EXPECTED: 0
rollback;

-- ── sent_reminders (S10b: SELECT-only policy) ───────────────────────────────

-- 8a. User B CANNOT read A's sent_reminders.
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';
  select count(*) as b_sees_a_sent from public.sent_reminders
  where user_id = 'aaaaaaaa-0000-0000-0000-000000000001';
  -- EXPECTED: 0
rollback;

-- 8b. Authenticated user CANNOT insert into sent_reminders (no insert policy
--     after S10b hardening — would let users fabricate dedupe rows).
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';
  insert into public.sent_reminders (user_id, service_label, sent_on)
  values ('bbbbbbbb-0000-0000-0000-000000000002', 'self-suppress', current_date);
  -- EXPECTED: ERROR  new row violates row-level security policy
rollback;

-- 8c. Authenticated user CANNOT update sent_reminders (SELECT-only policy).
begin;
  set local role authenticated;
  set local request.jwt.claims = '{"sub":"bbbbbbbb-0000-0000-0000-000000000002","role":"authenticated"}';
  update public.sent_reminders set sent_on = current_date
  where user_id = 'bbbbbbbb-0000-0000-0000-000000000002';
  select count(*) as updated_rows from public.sent_reminders
  where user_id = 'bbbbbbbb-0000-0000-0000-000000000002' and sent_on = current_date;
  -- EXPECTED: updated_rows = 0 (no UPDATE policy → 0 rows visible to update)
rollback;

-- 8d. anon CANNOT read any sent_reminders.
begin;
  set local role anon;
  set local request.jwt.claims = '{"role":"anon"}';
  select count(*) as anon_sees_sent from public.sent_reminders;
  -- EXPECTED: 0
rollback;

-- ── Cleanup (admin) ─────────────────────────────────────────────────────────
-- Cascades to vaults/reminders/push_subscriptions/sent_reminders via FK.
delete from auth.users where email like 'rls-%@orbit.test';
