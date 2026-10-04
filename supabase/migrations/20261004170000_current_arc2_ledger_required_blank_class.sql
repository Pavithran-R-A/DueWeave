-- Arc 2 Phase 2, Task 3F — the ledger's half of the whitespace repair Stage 8 made to
-- the Founder configuration.
--
-- What was measured
-- ----------------
-- `btrim(x)` with no second argument strips the ASCII space and nothing else, while the
-- browser's own blank test is `String.prototype.trim()`, which also strips the ASCII
-- controls, the Unicode space separators and the byte-order mark. The two boundaries
-- therefore did not agree on what "empty" means, and the disagreement ran the unsafe
-- way for the three ledger fields the product calls required:
--
--   select public.assert_stage3_client_input(E'   ', '', '', '');            -- refused
--   select public.assert_stage3_client_input(E'\u00a0\u00a0', '', '', '');   -- accepted
--   select public.assert_stage3_client_input(E'\t\t', '', '', '');           -- accepted
--   select public.assert_stage3_client_input(E'\u3000', '', '', '');         -- accepted
--
-- So `client/src/components/sheets.tsx` refuses a client name, a receivable label and a
-- cancellation reason that `create_client`, `update_client`, `create_receivable`,
-- `update_receivable_details`, `cancel_promise` and `cancel_receivable` would accept from
-- the same person over the RPC surface. A name is untidy; the two reasons are worse,
-- because `cancel_receivable` writes `v_reason` into `activities.note` and passes it to
-- `apply_promise_outcome`, so an invisible reason authorised a cancellation and then
-- entered itself into the owner's own history as the explanation for it.
--
-- The rule this installs
-- ----------------------
-- One rule, stated once: **a ledger field the product requires is blank when it is empty
-- after trimming the characters the browser trims.** Edge-trim only, so the content a
-- person typed between two letters is never rewritten, and never widened past the
-- browser: U+200B stays significant because `"\u200B".trim()` is `"\u200B"`, exactly as
-- Stage 8 decided for `c_ws` in 20260928090000_current_stage8_readiness_parity.sql.
--
-- The class is deliberately not applied to the ledger's optional text — `p_company`,
-- `p_email`, `p_notes`, `p_invoice_ref`, `p_source`, `p_method`, `p_reference`. Those
-- fields store what their owner wrote and nothing reads those bytes: no total, no
-- payment URI, no WhatsApp destination, no comparison. Widening them would rewrite
-- values the product has never claimed to normalise, for no behaviour it claims to
-- enforce. If ledger free text ever becomes machine-consumed — matched, used as a
-- deduplication key, or carried into a payment reference — this class belongs on it too,
-- and `tests/stage9-abuse-matrix.test.ts` will fail loudly rather than quietly when
-- somebody decides that without saying so.
--
-- Security posture, stated so the diff can be checked against it
-- --------------------------------------------------------------
-- Five existing functions are replaced and nothing else changes. Each keeps the posture
-- it had: `assert_stage3_client_input` stays SECURITY INVOKER with
-- `search_path = 'public', 'pg_temp'`; the four write verbs stay SECURITY DEFINER with
-- `search_path = 'public', 'auth', 'pg_temp'`. No function is created, so no new RPC
-- appears in the PostgREST surface and `supabase/tests/stage9_02_release_contracts.sql`
-- re-counts the executable routines so an accidental new public function would show up
-- there. Signatures are unchanged, which is why the generated types do not move.
--
-- The re-grants at the foot of this file are not decoration. Stage 3's fail-closed
-- `ddl_command_end` trigger strips PUBLIC, `anon` and `authenticated` EXECUTE from a
-- routine the moment it is redefined (20260814150000 and 20260814160000, and
-- 20260815090000_current_stage5_lifecycle_correctness.sql:931-936 records the same
-- repair for `snooze_receivable`), so replacing four browser-callable verbs without
-- re-granting them removes them from the application. Measured on this file's first
-- draft, which claimed the trigger "had nothing new to strip": `authenticated` could
-- then execute 20 RPCs instead of 24, `tests/stage9-abuse-matrix.test.ts` died in
-- `beforeAll` with "permission denied for function create_receivable", and
-- `supabase/tests/stage3_02_privileges.sql:108-137` failed on the exact-set assertion.
-- The block below restores precisely the grants the earlier migrations issued, and
-- nothing more: `assert_stage3_client_input` stays ungranted to `authenticated` because
-- it never held that grant — `create_client` and `update_client` are SECURITY DEFINER
-- and call it as the owner.
--
-- Refusals keep their existing wording and code (`P0001`, the product sentence the form
-- already uses), so nothing a user can see changes except that a blank-looking value is
-- now answered as blank at both boundaries.

create or replace function public.assert_stage3_client_input(p_name text, p_phone text, p_email text, p_notes text)
    returns table(name text, phone text, email text, notes text)
    language plpgsql
    set search_path to 'public', 'pg_temp'
as $assert$
declare
    -- The class JavaScript's trim() removes, spelled out because btrim takes characters
    -- and not ranges. Applied to the required field only: email and notes below keep
    -- their existing edge handling, and the phone never needed it because its own strip
    -- already discards every character that is not a digit or a leading plus.
    c_ws constant text := E' \t\n\r\f\v'
        || E'\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a'
        || E'\u2028\u2029\u202f\u205f\u3000\ufeff';
    v_name text := nullif(btrim(coalesce(p_name, ''), c_ws), '');
    v_phone text := nullif(regexp_replace(btrim(coalesce(p_phone, '')), '[^0-9+]', '', 'g'), '');
    v_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
    v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
    v_digits text;
begin
    if v_name is null or char_length(v_name) > 160 then
        raise exception 'Add a client name of up to 160 characters';
    end if;
    if v_email is not null and (char_length(v_email) > 254 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then
        raise exception 'Add a valid email address or leave it blank';
    end if;
    if v_phone is not null then
        v_digits := regexp_replace(v_phone, '[^0-9]', '', 'g');
        if char_length(v_digits) < 10 or char_length(v_digits) > 15 then
            raise exception 'Add a valid phone number or leave it blank';
        end if;
    end if;
    if v_notes is not null and char_length(v_notes) > 2000 then
        raise exception 'Notes can be up to 2,000 characters';
    end if;
    return query select v_name, v_phone, v_email, v_notes;
end;
$assert$;

create or replace function public.create_receivable(p_client_id uuid, p_label text, p_invoice_ref text, p_amount_due_paise bigint, p_due_date date, p_notes text default '')
    returns public.receivables
    language plpgsql
    security definer
    set search_path to 'public', 'auth', 'pg_temp'
as $create_receivable$
declare
  v_owner uuid := auth.uid();
  v_client public.clients;
  v_receivable public.receivables;
  -- The label is required, so its blank is the browser's blank. Reference and notes are
  -- optional and keep the edge handling they have always had.
  c_ws constant text := E' \t\n\r\f\v'
      || E'\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a'
      || E'\u2028\u2029\u202f\u205f\u3000\ufeff';
  v_label text := nullif(btrim(coalesce(p_label, ''), c_ws), '');
  v_reference text := nullif(btrim(coalesce(p_invoice_ref, '')), '');
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
begin
  if v_owner is null then raise exception 'Authentication is required'; end if;
  if p_amount_due_paise is null or p_amount_due_paise <= 0 or p_amount_due_paise > 900000000000000 then
    raise exception 'Add a valid positive receivable amount';
  end if;
  if p_due_date is null then raise exception 'Add a due date'; end if;
  if v_label is null or char_length(v_label) > 240 then raise exception 'Add a receivable label of up to 240 characters'; end if;
  if v_reference is not null and char_length(v_reference) > 160 then raise exception 'Reference can be up to 160 characters'; end if;
  if v_notes is not null and char_length(v_notes) > 2000 then raise exception 'Notes can be up to 2,000 characters'; end if;
  select * into v_client from public.clients where id = p_client_id and owner_id = v_owner and archived_at is null for update;
  if not found then raise exception 'Client is not available for this account'; end if;
  insert into public.receivables(owner_id, client_id, label, invoice_ref, amount_due_paise, outstanding_paise, due_date, notes, status)
    values(v_owner, v_client.id, v_label, v_reference, p_amount_due_paise, p_amount_due_paise, p_due_date, v_notes, 'OPEN')
    returning * into v_receivable;
  insert into public.activities(owner_id, client_id, receivable_id, type, note, metadata)
    values(v_owner, v_client.id, v_receivable.id, 'RECEIVABLE_CREATED', 'Receivable created', jsonb_build_object('surface', 'receivable'));
  return v_receivable;
end;
$create_receivable$;

create or replace function public.update_receivable_details(p_receivable_id uuid, p_label text, p_invoice_ref text default '', p_notes text default '', p_expected_updated_at timestamptz default null)
    returns public.receivables
    language plpgsql
    security definer
    set search_path to 'public', 'auth', 'pg_temp'
as $update_receivable$
declare
  v_owner uuid := auth.uid();
  v_row public.receivables;
  c_ws constant text := E' \t\n\r\f\v'
      || E'\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a'
      || E'\u2028\u2029\u202f\u205f\u3000\ufeff';
  v_label text := nullif(btrim(coalesce(p_label, ''), c_ws), '');
  v_invoice_ref text := nullif(btrim(coalesce(p_invoice_ref, '')), '');
  v_notes text := nullif(btrim(coalesce(p_notes, '')), '');
begin
  if v_owner is null then
    raise exception 'Authentication is required';
  end if;
  if p_receivable_id is null then
    raise exception 'A receivable id is required' using errcode = 'P0002';
  end if;

  select * into v_row from public.receivables where id = p_receivable_id and owner_id = v_owner for update;
  if not found then
    raise exception 'That receivable is not available in this private ledger' using errcode = 'P0002';
  end if;

  if p_expected_updated_at is null or v_row.updated_at <> p_expected_updated_at then
    raise exception 'This receivable changed in another session' using errcode = '40001';
  end if;

  -- Identical limits and wording to create_receivable, so an edit can never be
  -- stricter or looser than the path that created the row.
  if v_label is null or char_length(v_label) > 240 then
    raise exception 'Add a receivable label of up to 240 characters';
  end if;
  if v_invoice_ref is not null and char_length(v_invoice_ref) > 160 then
    raise exception 'Reference can be up to 160 characters';
  end if;
  if v_notes is not null and char_length(v_notes) > 2000 then
    raise exception 'Notes can be up to 2,000 characters';
  end if;

  update public.receivables
     set label = v_label,
         invoice_ref = v_invoice_ref,
         notes = v_notes
   where id = v_row.id
  returning * into v_row;

  return v_row;
end;
$update_receivable$;

create or replace function public.cancel_promise(p_promise_id uuid, p_reason text)
    returns public.promises
    language plpgsql
    security definer
    set search_path to 'public', 'auth', 'pg_temp'
as $cancel_promise$
declare
  v_owner uuid := auth.uid();
  v_promise public.promises;
  -- The reason is required, and it is written into the record of what happened, so a
  -- blank here is decided with the browser's class rather than the ASCII one.
  c_ws constant text := E' \t\n\r\f\v'
      || E'\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a'
      || E'\u2028\u2029\u202f\u205f\u3000\ufeff';
  v_reason text := nullif(btrim(coalesce(p_reason, ''), c_ws), '');
begin
  if v_owner is null then
    raise exception 'Authentication is required';
  end if;
  if v_reason is null or char_length(v_reason) > 200 then
    raise exception 'Add a short reason for withdrawing this promise (up to 200 characters)';
  end if;

  -- Receivable before promise, as everywhere else in this file. The row is
  -- locked and proven to belong to this account; no column of it is read, so the
  -- statement performs the lock rather than filling a record nobody uses.
  perform r.id
    from public.receivables r
    join public.promises p on p.receivable_id = r.id
   where p.id = p_promise_id and p.owner_id = v_owner
     for update of r;
  if not found then
    raise exception 'Promise is not available for this account';
  end if;

  select * into v_promise from public.promises where id = p_promise_id and owner_id = v_owner for update;
  if v_promise.status = 'CANCELLED' then
    raise exception 'This promise is already cancelled';
  end if;
  if v_promise.status <> 'ACTIVE' then
    raise exception 'Only a promise that has not reached its outcome can be withdrawn';
  end if;

  perform public.apply_promise_outcome(v_promise, 'CANCELLED', v_reason, 'USER');

  select * into v_promise from public.promises where id = p_promise_id;
  return v_promise;
end;
$cancel_promise$;

create or replace function public.cancel_receivable(p_receivable_id uuid, p_reason text)
    returns public.receivables
    language plpgsql
    security definer
    set search_path to 'public', 'auth', 'pg_temp'
as $cancel_receivable$
declare
  v_owner uuid := auth.uid();
  v_receivable public.receivables;
  c_ws constant text := E' \t\n\r\f\v'
      || E'\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a'
      || E'\u2028\u2029\u202f\u205f\u3000\ufeff';
  v_reason text := nullif(btrim(coalesce(p_reason, ''), c_ws), '');
  v_paid bigint;
  v_active public.promises;
begin
  if v_owner is null then
    raise exception 'Authentication is required';
  end if;
  if v_reason is null or char_length(v_reason) > 200 then
    raise exception 'Add a short reason for closing this receivable (up to 200 characters)';
  end if;

  select * into v_receivable from public.receivables where id = p_receivable_id and owner_id = v_owner for update;
  if not found then
    raise exception 'Receivable is not available for this account';
  end if;
  if v_receivable.status = 'CANCELLED' then
    raise exception 'This receivable is already cancelled';
  end if;
  if v_receivable.status = 'PAID' then
    raise exception 'A settled receivable cannot be cancelled — cancel the promise instead, or record a correction';
  end if;

  -- The boundary this stage refuses to cross: money that arrived is a fact, and
  -- closing the invoice would have to reinterpret it. There is no refund,
  -- credit-note or write-off accounting in v1, so an invoice with any history
  -- of payments simply cannot be cancelled here.
  select coalesce(sum(py.amount_paise), 0)::bigint into v_paid from public.payments py where py.receivable_id = p_receivable_id;
  if v_paid > 0 then
    raise exception 'A receivable with recorded payments cannot be cancelled';
  end if;

  perform set_config('app.ar1_write_context', 'receivable_cancel', true);
  update public.receivables
     set status = 'CANCELLED',
         outstanding_paise = 0
   where id = p_receivable_id
  returning * into v_receivable;

  select * into v_active
    from public.promises
   where receivable_id = p_receivable_id and status = 'ACTIVE'
   order by sequence_no
   for update;
  if found then
    perform public.apply_promise_outcome(v_active, 'CANCELLED', v_reason, 'USER');
  end if;

  insert into public.activities(owner_id, client_id, receivable_id, type, note, metadata)
    values(v_owner, v_receivable.client_id, p_receivable_id, 'RECEIVABLE_CANCELLED', v_reason, jsonb_build_object('reason', v_reason));

  return v_receivable;
end;
$cancel_receivable$;

-- The browser's ledger verbs, restored verbatim from the grants the earlier migrations
-- issued for these same signatures: 20260812170000_stage3_core_workflows.sql:218,
-- 20260814170000_current_stage4_persistent_edits.sql:184, and
-- 20260815100000_current_stage5_promise_chronology.sql:582-583. The revoke that follows
-- each grant repeats, in this file, what the trigger already did, so a reader can check
-- the posture without trusting the trigger — the same convention Stage 8
-- (20260928090000_current_stage8_readiness_parity.sql:299-302) and Stage 4 use.
grant execute on function public.create_receivable(uuid, text, text, bigint, date, text) to authenticated;
grant execute on function public.update_receivable_details(uuid, text, text, text, timestamptz) to authenticated;
grant execute on function public.cancel_receivable(uuid, text) to authenticated;
grant execute on function public.cancel_promise(uuid, text) to authenticated;

revoke all on function public.create_receivable(uuid, text, text, bigint, date, text) from public, anon;
revoke all on function public.update_receivable_details(uuid, text, text, text, timestamptz) from public, anon;
revoke all on function public.cancel_receivable(uuid, text) from public, anon;
revoke all on function public.cancel_promise(uuid, text) from public, anon;
