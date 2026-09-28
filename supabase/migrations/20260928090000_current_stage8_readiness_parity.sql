-- Stage 8 (current roadmap) — D-S8-5 / D-S8-6: make the stored payment-readiness
-- decision mean the same thing at every boundary that claims to enforce it.
--
-- Forward-only. Creates one internal function, replaces two existing functions,
-- changes no table, no column, no constraint, no policy, no RLS setting, no row,
-- and no default. Grants are recorded so the delivered state is provably unchanged
-- for the browser roles.
--
-- The defect, measured before this file was written
-- --------------------------------------------------
-- `client/src/lib/founder-readiness.ts` documents itself as the written-down
-- conjunction and says the database "re-checks every term inside the claim RPCs and
-- stays authoritative". Two of its twelve terms are not the terms the RPCs check, so
-- the sentence is false for exactly those two, and the false direction is the unsafe
-- one: the client is stricter than the authority it claims to defer to.
--
--   1. VPA shape. The client requires a structurally parseable address
--      (`VPA_PATTERN`, gap `vpa-malformed`). Both RPCs required only
--      `char_length(trim(coalesce(upi_id, ''))) >= 3` — the same test the table
--      check makes — so any three characters satisfied the authority.
--      Executed against the delivered database, inside a transaction that was
--      rolled back, with every other precondition configured and LIVE:
--
--        update public.founder_offer_config set upi_id = 'not-a-vpa'
--          -> UPDATE 1                        (storable: the check measures length)
--        select public.create_founder_claim()
--          -> returned a DRAFT claim row      (the authority accepted it)
--        founderReadinessGaps(row)
--          -> ["vpa-malformed"]               (the client refused it)
--
--      Reproduced as a failing test in
--      `tests/stage8-local-founder-readiness.test.ts`, "refuses a stored malformed
--      VPA identically on the client and in the claim RPCs".
--
--   2. Support placeholder. `support_contact` ships with the column default
--      `Support contact not configured` (20260813030000, line 12). The client and
--      both RPCs tested only "at least three characters", so the moment an operator
--      set `support_contact_status = 'CONFIGURED'` the shipped non-sentence became
--      a configured contact, and `FounderPurchase.tsx` printed it to the customer as
--      the contact address.
--      Executed, rolled back:
--
--        update ... set support_contact_status = 'CONFIGURED'
--          -> UPDATE 1
--        select public.create_founder_claim()
--          -> returned a DRAFT claim row      (no gap reported anywhere)
--
--      Reproduced as the failing test "refuses the shipped support placeholder
--      identically on the client and in the claim RPCs".
--
-- The gate failing open matters more than the checklist says: `LIVE` is reachable
-- only by a person writing this table directly, so a typo in the VPA or a forgotten
-- support address was precisely the error the authority was supposed to catch, and
-- it caught neither.
--
-- The contract both boundaries now share
-- --------------------------------------
-- One conjunction, twelve terms, in the operator order the checklist already uses.
-- Every term is a fact the database can determine from stored columns; none of them
-- is a fact about the world outside this schema.
--
--   enabled                                    offer is enabled
--   payment_destination_status = 'LIVE'         destination is marked live
--   amount_paise = 49900                        price is the approved amount
--   upi_id, whitespace-trimmed, non-empty        a VPA is configured
--   upi_id matches ^[a-z0-9._-]{2,}@[a-z0-9.-]{2,}$   it parses as an address
--   payee_name, whitespace-trimmed, non-empty    a payee name is configured
--   support_contact_status = 'CONFIGURED'        the owner says it is configured
--   support contact >= 3 chars and not the shipped placeholder
--   refund_policy_status = 'APPROVED'            policy approved for publication
--   refund text >= 40 chars                      the approved text is published
--   disclosures_status = 'APPROVED'              disclosures approved
--
-- Deliberately absent, because no column can prove them and this repository must not
-- imply that it does: that the VPA routes to a bank account the business owns, that
-- the payee name matches a bank statement, that the support address is monitored or
-- even deliverable, that the refund wording or disclosures are lawful. The checklist
-- keeps those as independent human verifications. Support is checked for
-- "unusable", not for "is an email", because nothing in the product contract
-- requires an email specifically — the value is rendered as plain text.
--
-- Shape chosen: one internal function holding the conjunction, called by both claim
-- RPCs, rather than a table CHECK (option B). A CHECK would refuse a malformed VPA
-- at write time, which means the state could never be stored, which means the gate
-- could never be tested against a stored malformed destination — and the operator
-- would get a raw constraint error mid-configuration instead of a readiness report
-- naming the term. Keeping it storable and refusing it at the decision point is what
-- makes `vpa-malformed` a *gap* rather than a write failure, which is what the
-- checklist is built to enumerate.
--
-- Why one helper instead of a second copy of the conjunction
-- ---------------------------------------------------------
-- The two RPCs previously stated the conjunction twice, already drifting (one folded
-- `enabled` into it, the other tested it separately). Both now call the same
-- function, so a future term can only be added in one place, and
-- `supabase/tests/stage8_01_offer_readiness.sql` pins the refusal of every term
-- through the RPCs rather than through text that resembles them.
--
-- Whitespace, measured at both boundaries
-- ---------------------------------------
-- "Whitespace-trimmed" has to denote one character set or the two boundaries are
-- still stating different rules. Executed on this stack (node against
-- `String.prototype.trim()`, psql against `btrim`, both on repeated characters,
-- and the round trip was checked by md5 of `convert_to(...,'UTF8')` so a failure
-- below could not be an encoding artifact):
--
--   btrim(E'\t dueweave-test@upi \t')                 ~ PATTERN -> false
--   btrim(E'\t dueweave-test@upi \t', E' \t\n\r\f\v') ~ PATTERN -> true
--   ('x1@aa' || chr(10) || 'bad') ~ PATTERN           -> false
--
-- That first measurement is what a class of ` \t\n\r\f\v` buys, and it is not
-- enough. JavaScript trims the Unicode space separators and the byte-order mark
-- too, PostgreSQL's `trim()` sees only the space, and an ASCII escape class stops
-- one step further short:
--
--   character          JS trim   char_length(btrim(x, E' \t\n\r\f\v'))
--   U+0020 space       removes   0
--   U+0009/0A/0B/0C/0D removes   0
--   U+00A0 NBSP        removes   3
--   U+1680 ogham       removes   3
--   U+2000 en quad     removes   3
--   U+200A hair space  removes   3
--   U+2028/2029        removes   3
--   U+202F NNBSP       removes   3
--   U+205F medium math removes   3
--   U+3000 ideographic removes   3
--   U+FEFF BOM         removes   3
--   U+200B zero width  KEEPS     3
--
-- So the first draft of this file still disagreed with the client in both
-- directions, and the unsafe one was live: `support_contact` of five non-breaking
-- spaces passed the length check, was not the placeholder string, and made the
-- authority report a stored offer payment-ready while the customer surface
-- reported `support-contact-unusable` — the identical fail-open shape as D-S8-6
-- above, reached by a different character. In the other direction a valid address
-- padded with a non-breaking space was ready for the client and refused by the
-- authority, which is parity failing as extra strictness.
--
-- The function now normalises with `c_ws`, the class JavaScript removes, listed
-- explicitly because `btrim` takes characters and not ranges. U+200B is absent on
-- purpose: JavaScript keeps it, so a value carrying it stays malformed at both
-- boundaries. `supabase/tests/stage8_01_offer_readiness.sql` pins one case in each
-- direction (sections J, K and L), and the pattern text is the same string in
-- `client/src/lib/founder-readiness.ts`, this function, and the two operator
-- runbooks; `tests/stage8-founder-contracts.test.ts` pins both identities so no
-- copy can drift silently.
--
-- Security posture, stated so the diff can be checked against it
-- --------------------------------------------------------------
-- `founder_offer_payment_ready` takes the offer row and is internal: Stage 3's
-- `ddl_command_end` trigger strips PUBLIC/`anon`/`authenticated` EXECUTE from every
-- new public function, and the explicit revoke below repeats that in this file so a
-- reader does not have to trust the trigger. `service_role` retains EXECUTE, the same
-- posture already measured on `is_founder_admin` and `assert_founder_admin`.
--
-- The two replaced RPCs keep the posture they had: owner `postgres`, SECURITY
-- DEFINER, fixed `search_path`, `anon` with none, `authenticated` and `service_role`
-- with EXECUTE. Nothing is revoked from a browser role that it held, and nothing is
-- granted to one it did not.
--
-- Being called from inside a SECURITY DEFINER function does not require the caller
-- role to hold EXECUTE on this helper — the privilege check is made as the definer —
-- and `supabase/tests/stage8_01_offer_readiness.sql` proves that behaviourally: as
-- `authenticated` the RPCs still answer with their readiness refusals rather than a
-- permission error, while a direct call to the helper is denied.
--
-- This migration turns nothing on. The delivered row still holds `PLACEHOLDER` with
-- no VPA, `PENDING` support with the placeholder sentence, `PENDING_APPROVAL` refund
-- with no text, and `PENDING` disclosures. It now reports seven readiness gaps
-- instead of six: the placeholder sentence was always a gap, and the length-only
-- rule was too weak to see it.

-- The conjunction. `stable` because it reads nothing but its argument; `security
-- invoker` because it has no privileged data access to justify a definer.
create or replace function public.founder_offer_payment_ready(c public.founder_offer_config)
    returns boolean
    language plpgsql
    stable
    set search_path to 'public', 'pg_temp'
as $ready$
declare
    -- One normalisation per stored value, matching the client's String.trim(). The
    -- class is spelled out rather than assumed: PostgreSQL's own trim() removes only
    -- the space, and E' \t\n\r\f\v' stops at the ASCII controls, while JavaScript also
    -- removes the Unicode space separators and the byte-order mark. Anything narrower
    -- makes "blank" mean two different things at the two boundaries. U+200B ZERO WIDTH
    -- SPACE is deliberately absent because JavaScript keeps it — the class is matched
    -- to the client, not widened past it.
    c_ws constant text := E' \t\n\r\f\v'
        || E'\u00a0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200a'
        || E'\u2028\u2029\u202f\u205f\u3000\ufeff';
    v_upi      text := btrim(coalesce(c.upi_id, ''),             c_ws);
    v_payee    text := btrim(coalesce(c.payee_name, ''),         c_ws);
    v_support  text := btrim(coalesce(c.support_contact, ''),    c_ws);
    v_refund   text := btrim(coalesce(c.refund_policy_text, ''), c_ws);
begin
    return coalesce(
        c.enabled
        and c.payment_destination_status = 'LIVE'
        and c.amount_paise = 49900
        and char_length(v_upi) > 0
        and v_upi ~* '^[a-z0-9._-]{2,}@[a-z0-9.-]{2,}$'
        and char_length(v_payee) > 0
        and c.support_contact_status = 'CONFIGURED'
        and char_length(v_support) >= 3
        and v_support is distinct from 'Support contact not configured'
        and c.refund_policy_status = 'APPROVED'
        and char_length(v_refund) >= 40
        and c.disclosures_status = 'APPROVED',
        false);
end;
$ready$;

-- Internal by the Stage 3 default, repeated here so the intent is in this file.
revoke all on function public.founder_offer_payment_ready(public.founder_offer_config)
    from public, anon, authenticated;

-- create_founder_claim: unchanged except that the conjunction is now one call.
-- The row lock, the "already active" and "already open" branches, the claim-id
-- shape, the `app.dueweave_claim_context` setting and all three audit/analytics
-- writes are byte-for-byte what Stage 4.2A installed.
create or replace function public.create_founder_claim()
    returns purchase_claims
    language plpgsql
    security definer
    set search_path to 'public', 'auth', 'pg_temp'
as $create$
declare v_owner uuid := auth.uid(); v_offer public.founder_offer_config; v_claim public.purchase_claims;
begin
  if v_owner is null then raise exception 'Authentication is required'; end if;
  select * into v_offer from public.founder_offer_config where offer_key = 'FOUNDER_V1' for update;
  if not found or not v_offer.enabled then raise exception 'Founder access is not available right now'; end if;
  if not public.founder_offer_payment_ready(v_offer) then
    raise exception 'Founder payment instructions are not ready yet';
  end if;
  if exists (select 1 from public.entitlements where user_id = v_owner and plan = 'FOUNDER' and status = 'ACTIVE') then
    raise exception 'Founder access is already active for this account';
  end if;
  if exists (select 1 from public.purchase_claims where owner_id = v_owner and status in ('DRAFT', 'PENDING_REVIEW')) then
    select * into v_claim from public.purchase_claims where owner_id = v_owner and status in ('DRAFT', 'PENDING_REVIEW') order by created_at desc limit 1;
    return v_claim;
  end if;
  perform set_config('app.dueweave_claim_context', 'CREATE', true);
  insert into public.purchase_claims(owner_id, claim_id, plan, amount_paise, utr_reference, payer_name, status)
    values(v_owner, 'DW-F-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 12)), 'FOUNDER', v_offer.amount_paise, '', '', 'DRAFT')
    returning * into v_claim;
  insert into public.founder_audit_events(claim_id, target_user_id, actor_user_id, event_type, metadata)
    values(v_claim.id, v_owner, v_owner, 'CLAIM_CREATED', jsonb_build_object('source', 'user'));
  insert into public.analytics_events(owner_id, event_name, metadata, entity_type, entity_id)
    values(v_owner, 'founder_claim_created', jsonb_build_object('surface', 'founder'), 'purchase_claim', v_claim.id);
  return v_claim;
end;
$create$;

-- submit_founder_payment: unchanged except for the same single conjunction call.
-- UTR and payer-name validation, the claim lookup and its status/plan/amount
-- checks, the duplicate-UTR refusal, the lock ordering, the `SUBMIT` context and
-- the unique-violation handler are byte-for-byte what Stage 4.2A installed.
create or replace function public.submit_founder_payment(p_claim_id text, p_utr_reference text, p_payer_name text)
    returns purchase_claims
    language plpgsql
    security definer
    set search_path to 'public', 'auth', 'pg_temp'
as $submit$
declare v_owner uuid := auth.uid(); v_offer public.founder_offer_config; v_claim public.purchase_claims; v_utr text; v_payer text;
begin
  if v_owner is null then raise exception 'Authentication is required'; end if;
  v_utr := upper(regexp_replace(trim(coalesce(p_utr_reference, '')), '\s+', '', 'g'));
  v_payer := trim(coalesce(p_payer_name, ''));
  if char_length(v_utr) < 6 or char_length(v_utr) > 64 or v_utr !~ '^[A-Z0-9-]+$' then raise exception 'Enter a payment reference with letters, numbers, or hyphens only'; end if;
  if char_length(v_payer) < 2 or char_length(v_payer) > 120 then raise exception 'Enter the payer name used for the payment'; end if;
  select * into v_offer from public.founder_offer_config where offer_key = 'FOUNDER_V1';
  if not found or not public.founder_offer_payment_ready(v_offer) then
    raise exception 'Payment instructions are not ready for submission';
  end if;
  select * into v_claim from public.purchase_claims where claim_id = p_claim_id and owner_id = v_owner for update;
  if not found then raise exception 'This payment claim is not available for this account'; end if;
  if v_claim.status <> 'DRAFT' then raise exception 'This payment claim has already been submitted or closed'; end if;
  if v_claim.plan <> 'FOUNDER' or v_claim.amount_paise <> v_offer.amount_paise then raise exception 'This payment claim no longer matches the Founder offer'; end if;
  if exists (select 1 from public.purchase_claims where upper(utr_reference) = v_utr and status in ('PENDING_REVIEW', 'APPROVED', 'REJECTED')) then
    raise exception 'That payment reference has already been submitted';
  end if;
  perform set_config('app.dueweave_claim_context', 'SUBMIT', true);
  update public.purchase_claims set utr_reference = v_utr, payer_name = v_payer, status = 'PENDING_REVIEW', submitted_at = now()
    where id = v_claim.id returning * into v_claim;
  insert into public.founder_audit_events(claim_id, target_user_id, actor_user_id, event_type, metadata)
    values(v_claim.id, v_owner, v_owner, 'CLAIM_SUBMITTED', jsonb_build_object('source', 'user'));
  insert into public.analytics_events(owner_id, event_name, metadata, entity_type, entity_id)
    values(v_owner, 'founder_payment_submitted', jsonb_build_object('surface', 'founder'), 'purchase_claim', v_claim.id);
  return v_claim;
exception when unique_violation then
  raise exception 'That payment reference has already been submitted';
end;
$submit$;

-- Re-asserting the posture the two RPCs already had. `revoke … from public` is the
-- form Stage 4.2A used; the `authenticated` grant is the browser role's existing
-- reach and `anon` is deliberately absent from both statements.
revoke all on function public.create_founder_claim() from public;
revoke all on function public.submit_founder_payment(text, text, text) from public;
grant execute on function public.create_founder_claim() to authenticated;
grant execute on function public.submit_founder_payment(text, text, text) to authenticated;
