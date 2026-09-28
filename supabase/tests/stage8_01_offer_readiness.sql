-- Stage 8 — the offer's own data-layer readiness invariants (pgTAP).
--
-- Run with: pnpm test:db   (supabase test db)
--
-- Stage 8's readiness model says a Founder payment is reachable only when ALL
-- of: offer enabled, destination LIVE, amount 49900, non-empty VPA, payee
-- present, support CONFIGURED with a contact, refund APPROVED with text, and
-- disclosures APPROVED. The RPCs already enforce that conjunction, but a
-- conjunction over a state no operator can ever store is not a gate — it is an
-- accident. So this file pins the data layer underneath it: the fail-closed
-- delivered row, the price, the destination vocabulary, and the fact that a
-- trusted operator really can express — and really can undo — the LIVE state
-- while the PLACEHOLDER-carries-no-VPA rule keeps holding.
--
-- Each refused write below is pinned to 23514, and where the refusing
-- constraint is unambiguous it is named. That is deliberate: after the stale
-- duplicate destination check is gone, the remaining named guards have to be
-- the ones doing the work, so a rule that silently stopped being enforced would
-- show up here as the wrong constraint name rather than as a false pass.

set search_path = public, extensions, tap, core;
create extension if not exists pgtap with schema extensions;

select plan(32);

-- ---------------------------------------------------------------------------
-- A. There is exactly one offer and it is delivered fail-closed.
-- ---------------------------------------------------------------------------
select has_table('public', 'founder_offer_config',
    'the Founder offer configuration table exists');
select is((select count(*) from public.founder_offer_config), 1::bigint,
    'exactly one offer row is delivered, so no ambiguous second offer can be gate-controlled');
select is((select offer_key from public.founder_offer_config), 'FOUNDER_V1',
    'the delivered offer is keyed FOUNDER_V1');
select is((select payment_destination_status from public.founder_offer_config), 'PLACEHOLDER',
    'the delivered destination is PLACEHOLDER, never TEST or LIVE');
select ok((select upi_id is null from public.founder_offer_config),
    'the delivered row stores no payable VPA at all');
select is((select support_contact_status from public.founder_offer_config), 'PENDING',
    'support ships unconfigured');
select is((select refund_policy_status from public.founder_offer_config), 'PENDING_APPROVAL',
    'the refund policy ships unapproved');
select ok((select refund_policy_text is null from public.founder_offer_config),
    'no refund wording is stored before the owner approves it');
select is((select disclosures_status from public.founder_offer_config), 'PENDING',
    'the customer disclosures ship unapproved');

-- ---------------------------------------------------------------------------
-- B. Phase 7 price contract: 49900 paise is the only authority, stored as an
--    integer and pinned in the database rather than derived from a float.
-- ---------------------------------------------------------------------------
select is((select amount_paise from public.founder_offer_config), 49900::bigint,
    'the canonical Founder price is 49900 paise');
select throws_ok(
    $q$update public.founder_offer_config set amount_paise = 49901 where offer_key = 'FOUNDER_V1'$q$,
    '23514',
    $q$new row for relation "founder_offer_config" violates check constraint "founder_offer_config_amount_paise_check"$q$,
    'a price drift of one paise is refused, so no discount or promotional amount can be stored');
select throws_ok(
    $q$update public.founder_offer_config set founder_cap = 0 where offer_key = 'FOUNDER_V1'$q$,
    '23514',
    $q$new row for relation "founder_offer_config" violates check constraint "founder_offer_config_founder_cap_check"$q$,
    'a zero seat cap cannot be stored, so the offer cannot be silently closed by number games');

-- ---------------------------------------------------------------------------
-- C. The destination vocabulary is exactly PLACEHOLDER / TEST / LIVE. The
--    legacy CONFIGURED value predates the readiness gate and must now be
--    unreachable, otherwise two spellings of "payable" would exist.
-- ---------------------------------------------------------------------------
select is(
    (select pg_get_constraintdef(oid) from pg_constraint
      where conrelid = 'public.founder_offer_config'::regclass
        and conname = 'founder_offer_config_payment_destination_status_check'),
    $q$CHECK ((payment_destination_status = ANY (ARRAY['PLACEHOLDER'::text, 'TEST'::text, 'LIVE'::text])))$q$,
    'the destination vocabulary is exactly PLACEHOLDER / TEST / LIVE');
select throws_ok(
    $q$update public.founder_offer_config set payment_destination_status = 'CONFIGURED' where offer_key = 'FOUNDER_V1'$q$,
    '23514',
    $q$new row for relation "founder_offer_config" violates check constraint "founder_offer_config_payment_destination_ready_check"$q$,
    'the retired CONFIGURED spelling is refused on write by the destination pairing guard');
select is((select payment_destination_status from public.founder_offer_config), 'PLACEHOLDER',
    'the refused CONFIGURED write left the stored destination untouched');
select is(
    (select count(*) from pg_constraint
      where conrelid = 'public.founder_offer_config'::regclass
        and contype = 'c'
        and pg_get_constraintdef(oid) like '%payment_destination_status%'
        and pg_get_constraintdef(oid) like '%CONFIGURED%'),
    0::bigint,
    'no check constraint still admits the retired CONFIGURED destination state');

-- ---------------------------------------------------------------------------
-- D. D-S8-2: the destination/VPA pairing rule must exist exactly once. Two
--    overlapping checks made the same column pair look configurable while only
--    the narrower one actually decided, which is how LIVE became unstorable.
-- ---------------------------------------------------------------------------
select is(
    (select count(*) from pg_constraint
      where conrelid = 'public.founder_offer_config'::regclass
        and contype = 'c'
        and pg_get_constraintdef(oid) like '%payment_destination_status%'
        and pg_get_constraintdef(oid) like '%upi_id%'),
    1::bigint,
    'the destination/VPA pairing rule is a single constraint, not two overlapping checks');

-- ---------------------------------------------------------------------------
-- E. A trusted operator can express the documented PAYMENT-READY destination
--    state, and can undo it. Nothing here makes a payment possible on its own:
--    the claim RPCs still require the whole conjunction, and pg_prove rolls
--    this transaction back.
-- ---------------------------------------------------------------------------
select lives_ok(
    $q$update public.founder_offer_config set payment_destination_status = 'LIVE', upi_id = 'dueweave-test@upi' where offer_key = 'FOUNDER_V1'$q$,
    'the documented LIVE destination state is storable once the owner supplies a VPA');
select is((select payment_destination_status from public.founder_offer_config), 'LIVE',
    'the LIVE transition is read back from the stored row');
select is((select upi_id from public.founder_offer_config), 'dueweave-test@upi',
    'the VPA is stored only after the operator opts in');
select lives_ok(
    $q$update public.founder_offer_config set payment_destination_status = 'PLACEHOLDER', upi_id = null where offer_key = 'FOUNDER_V1'$q$,
    'deactivation is a single reversible write, so a mistaken activation is escapable');

-- ---------------------------------------------------------------------------
-- F. Activating without a real destination is still refused, by the pairing
--    guard alone. These four are the rules that must survive dropping the
--    duplicate, each pinned to the constraint that owns it.
-- ---------------------------------------------------------------------------
select throws_ok(
    $q$update public.founder_offer_config set upi_id = 'dueweave-test@upi' where offer_key = 'FOUNDER_V1'$q$,
    '23514',
    $q$new row for relation "founder_offer_config" violates check constraint "founder_offer_config_payment_destination_ready_check"$q$,
    'a PLACEHOLDER destination can never carry a payable VPA');
select throws_ok(
    $q$update public.founder_offer_config set payment_destination_status = 'LIVE' where offer_key = 'FOUNDER_V1'$q$,
    '23514',
    $q$new row for relation "founder_offer_config" violates check constraint "founder_offer_config_payment_destination_ready_check"$q$,
    'a LIVE destination with no VPA cannot be stored, so LIVE can never mean pay-nothing');
select throws_ok(
    $q$update public.founder_offer_config set payment_destination_status = 'LIVE', upi_id = '   ' where offer_key = 'FOUNDER_V1'$q$,
    '23514',
    $q$new row for relation "founder_offer_config" violates check constraint "founder_offer_config_payment_destination_ready_check"$q$,
    'a whitespace VPA is refused even when the status claims LIVE');
select throws_ok(
    $q$update public.founder_offer_config set payment_destination_status = 'LIVE', upi_id = repeat('x', 161) where offer_key = 'FOUNDER_V1'$q$,
    '23514',
    $q$new row for relation "founder_offer_config" violates check constraint "founder_offer_config_payment_destination_ready_check"$q$,
    'an over-long VPA is refused rather than truncated into something payable');

-- ---------------------------------------------------------------------------
-- G. The refund gate is a pair, not a flag, and its length is a real boundary.
--    Phase 41 forbids authoring binding refund promises, so every policy value
--    below is filler inside a transaction that never commits; this pins only
--    the shape of the rule.
-- ---------------------------------------------------------------------------
-- The pair rule is owned end to end by the readiness check: the plain
-- length check never gets to report, because readiness is evaluated first. So
-- every refusal below names the readiness check, and the boundary is pinned by
-- proving where it starts.
select throws_ok(
    $q$update public.founder_offer_config set refund_policy_status = 'APPROVED' where offer_key = 'FOUNDER_V1'$q$,
    '23514',
    $q$new row for relation "founder_offer_config" violates check constraint "founder_offer_config_refund_policy_ready_check"$q$,
    'a refund policy cannot be approved while its text is absent');
select throws_ok(
    $q$update public.founder_offer_config set refund_policy_text = repeat('x', 40) where offer_key = 'FOUNDER_V1'$q$,
    '23514',
    $q$new row for relation "founder_offer_config" violates check constraint "founder_offer_config_refund_policy_ready_check"$q$,
    'refund wording cannot be stored while approval is still pending');
select throws_ok(
    $q$update public.founder_offer_config set refund_policy_status = 'APPROVED', refund_policy_text = repeat('x', 39) where offer_key = 'FOUNDER_V1'$q$,
    '23514',
    $q$new row for relation "founder_offer_config" violates check constraint "founder_offer_config_refund_policy_ready_check"$q$,
    'a 39-character policy is refused, so an approval cannot be satisfied by a stub');
select lives_ok(
    $q$update public.founder_offer_config set refund_policy_status = 'APPROVED', refund_policy_text = repeat('x', 40) where offer_key = 'FOUNDER_V1'$q$,
    'a 40-character policy is accepted, so the stated minimum really is the boundary');
select lives_ok(
    $q$update public.founder_offer_config set refund_policy_status = 'PENDING_APPROVAL', refund_policy_text = null where offer_key = 'FOUNDER_V1'$q$,
    'an owner can withdraw a policy approval and its text again');

-- ---------------------------------------------------------------------------
-- H. Leave the row in its delivered state and prove it by reading it back.
-- ---------------------------------------------------------------------------
select lives_ok(
    $q$update public.founder_offer_config set payment_destination_status = 'PLACEHOLDER', upi_id = null, amount_paise = 49900, founder_cap = 50 where offer_key = 'FOUNDER_V1'$q$,
    'the delivered fail-closed row can always be restored');
select ok((select payment_destination_status = 'PLACEHOLDER' and upi_id is null
             and amount_paise = 49900 and founder_cap = 50
             and refund_policy_status = 'PENDING_APPROVAL' and refund_policy_text is null
             and support_contact_status = 'PENDING' and disclosures_status = 'PENDING'
           from public.founder_offer_config),
    'the offer row is back in its documented delivered state with no residue');
