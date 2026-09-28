-- Stage 8 — the offer's own data-layer readiness invariants (pgTAP).
--
-- Run with: pnpm test:db   (supabase test db)
--
-- Stage 8's readiness model says a Founder payment is reachable only when ALL
-- of: offer enabled, destination LIVE, amount 49900, a VPA that is non-empty and
-- shaped like an address, payee present, support CONFIGURED with a contact that
-- is not the shipped placeholder, refund APPROVED with real text, and
-- disclosures APPROVED. The RPCs already enforce that conjunction, but a
-- conjunction over a state no operator can ever store is not a gate — it is an
-- accident. So this file pins the data layer underneath it: the fail-closed
-- delivered row, the price, the destination vocabulary, and the fact that a
-- trusted operator really can express — and really can undo — the LIVE state
-- while the PLACEHOLDER-carries-no-VPA rule keeps holding.
--
-- Sections I to N were added for D-S8-5 and D-S8-6, where the conjunction turned
-- out to be stated three times (client, claim RPC, submit RPC) and the two SQL
-- copies were weaker than the client on exactly the VPA shape and the support
-- placeholder. They pin that the SQL conjunction is now one routine, that it is
-- internal, that it decides every term it claims to, that a malformed address and
-- a placeholder support line are both storable and both refused, that an actual
-- `authenticated` principal gets the readiness refusal rather than a permission
-- error, and that no browser role gained EXECUTE anywhere on that path. A third
-- divergence in the same class was found while writing them and is pinned here too:
-- the character set each boundary trims before it judges a value. JavaScript removes
-- the Unicode space separators and the byte-order mark, PostgreSQL's trim() removes
-- only the space, and an ASCII escape class stops short of both, so every value below
-- is also probed with non-breaking and ideographic spaces, in both directions.
--
-- Each refused write below is pinned to 23514, and where the refusing
-- constraint is unambiguous it is named. That is deliberate: after the stale
-- duplicate destination check is gone, the remaining named guards have to be
-- the ones doing the work, so a rule that silently stopped being enforced would
-- show up here as the wrong constraint name rather than as a false pass.

set search_path = public, extensions, tap, core;
create extension if not exists pgtap with schema extensions;

select plan(99);

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
-- I. The readiness conjunction has exactly one SQL authority (D-S8-5 / D-S8-6),
--    it is internal, and nothing else duplicates it. Before this file the two
--    claim RPCs each restated the conjunction and both drifted from the client,
--    so the authority has to be pinned as a single routine that the two RPCs
--    call, reachable only from inside them.
-- ---------------------------------------------------------------------------
select is(
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'founder_offer_payment_ready'),
    1::bigint,
    'the readiness conjunction lives in one function, so it cannot be stated twice differently');
select is(
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'founder_offer_payment_ready' and not p.prosecdef),
    1::bigint,
    'the readiness function is SECURITY INVOKER, so it borrows no privilege it does not need');
select is(
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'founder_offer_payment_ready'
        and p.proconfig @> array['search_path=public, pg_temp']),
    1::bigint,
    'the readiness function pins its search path, so its regex and column names cannot be shadowed');
select is(
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'founder_offer_payment_ready'
        and p.provolatile = 's'),
    1::bigint,
    'the readiness function is STABLE, so asking whether an offer is ready cannot change it');
select is(has_function_privilege('anon',
    'public.founder_offer_payment_ready(public.founder_offer_config)'::regprocedure, 'EXECUTE'), false,
    'anon cannot execute the readiness function');
select is(has_function_privilege('authenticated',
    'public.founder_offer_payment_ready(public.founder_offer_config)'::regprocedure, 'EXECUTE'), false,
    'an account cannot ask the database whether the offer is payable, so it is not an RPC');
select is(has_function_privilege('public',
    'public.founder_offer_payment_ready(public.founder_offer_config)'::regprocedure, 'EXECUTE'), false,
    'the readiness function does not keep the implicit PUBLIC EXECUTE');
select is(has_function_privilege('postgres',
    'public.founder_offer_payment_ready(public.founder_offer_config)'::regprocedure, 'EXECUTE'), true,
    'the owner can execute the readiness function, which is what these pins are reading');
select is(has_function_privilege('service_role',
    'public.founder_offer_payment_ready(public.founder_offer_config)'::regprocedure, 'EXECUTE'), true,
    'service_role keeps its intended operator access to the readiness function');
select is(
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname in ('create_founder_claim', 'submit_founder_payment')
        and pg_get_functiondef(p.oid) like '%public.founder_offer_payment_ready(%'),
    2::bigint,
    'both claim RPCs consult the single authority, so the customer boundary cannot skip it');
select is(
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.prokind = 'f'
        and pg_get_functiondef(p.oid) like '%founder_offer_payment_ready(%'),
    3::bigint,
    'no routine outside the authority and the two claim RPCs restates the conjunction');

-- ---------------------------------------------------------------------------
-- J. Every term of the conjunction is decided by the database, one at a time.
--    This is what makes the runbook sentence "the database re-checks readiness"
--    true rather than aspirational: each term below is stored, read back through
--    the authority, and refused with only that term wrong.
-- ---------------------------------------------------------------------------
-- Phase 41 forbids authoring binding customer wording, so the policy text here is
-- filler, and the support value is a plain-text handle rather than an invented
-- address. Nothing commits: pg_prove rolls this transaction back.
select lives_ok(
    $q$update public.founder_offer_config
        set enabled = true, payment_destination_status = 'LIVE', upi_id = 'dueweave-test@upi',
            payee_name = 'DueWeave', support_contact_status = 'CONFIGURED',
            support_contact = 'ask from the profile page', refund_policy_status = 'APPROVED',
            refund_policy_text = repeat('x', 40), disclosures_status = 'APPROVED'
      where offer_key = 'FOUNDER_V1'$q$,
    'a fully configured offer is storable, so the ready state below is a real stored row');
select is((select public.founder_offer_payment_ready(c) from public.founder_offer_config c), true,
    'with every term satisfied the authority reports the stored offer ready');

select lives_ok(
    $q$update public.founder_offer_config set enabled = false where offer_key = 'FOUNDER_V1'$q$,
    'a live destination can be disabled without unconfiguring anything else');
select is((select public.founder_offer_payment_ready(c) from public.founder_offer_config c), false,
    'term 1: a disabled offer is never payable');
update public.founder_offer_config set enabled = true where offer_key = 'FOUNDER_V1';

select lives_ok(
    $q$update public.founder_offer_config set payment_destination_status = 'PLACEHOLDER', upi_id = null where offer_key = 'FOUNDER_V1'$q$,
    'every other term can stay configured while the destination is pulled back');
select is((select public.founder_offer_payment_ready(c) from public.founder_offer_config c), false,
    'term 2: only a LIVE destination is payable');
update public.founder_offer_config set payment_destination_status = 'LIVE',
    upi_id = 'dueweave-test@upi' where offer_key = 'FOUNDER_V1';

-- The table check trims spaces only, so a tab-only payee name is storable. That
-- is exactly the class of value the old RPC rule read as configured.
select lives_ok(
    $q$update public.founder_offer_config set payee_name = E'\t' where offer_key = 'FOUNDER_V1'$q$,
    'a whitespace payee name is storable, so the readiness layer is the only place it can be caught');
select is((select public.founder_offer_payment_ready(c) from public.founder_offer_config c), false,
    'term 6: an all-whitespace payee name is not a payee');
update public.founder_offer_config set payee_name = 'DueWeave' where offer_key = 'FOUNDER_V1';
-- The same term one step further. PostgreSQL's own trim() and a plain escape string
-- stop at ASCII, while the customer boundary trims these characters too, so a payee
-- of nothing but spaces could read configured at one boundary and blank at the other.
select lives_ok(
    $q$update public.founder_offer_config set payee_name = E'\u00a0\u2003' where offer_key = 'FOUNDER_V1'$q$,
    'a payee name of non-ASCII spaces is storable, because the table check trims spaces only');
select is((select public.founder_offer_payment_ready(c) from public.founder_offer_config c), false,
    'term 6: characters only JavaScript trims away are still no payee name');
update public.founder_offer_config set payee_name = 'DueWeave' where offer_key = 'FOUNDER_V1';

select lives_ok(
    $q$update public.founder_offer_config set support_contact_status = 'PENDING' where offer_key = 'FOUNDER_V1'$q$,
    'a configured support value can be un-marked as configured again');
select is((select public.founder_offer_payment_ready(c) from public.founder_offer_config c), false,
    'term 7: the owner has to mark the support contact configured; a value alone is not consent');
update public.founder_offer_config set support_contact_status = 'CONFIGURED' where offer_key = 'FOUNDER_V1';

select lives_ok(
    $q$update public.founder_offer_config set refund_policy_status = 'PENDING_APPROVAL', refund_policy_text = null where offer_key = 'FOUNDER_V1'$q$,
    'a published refund policy can be withdrawn again');
select is((select public.founder_offer_payment_ready(c) from public.founder_offer_config c), false,
    'term 10: an unapproved refund policy blocks payment even with the VPA live');
update public.founder_offer_config set refund_policy_status = 'APPROVED',
    refund_policy_text = repeat('x', 40) where offer_key = 'FOUNDER_V1';

select lives_ok(
    $q$update public.founder_offer_config set refund_policy_text = repeat(E'\t', 40) where offer_key = 'FOUNDER_V1'$q$,
    'an all-whitespace refund text is storable, because the plain length check trims spaces only');
select is((select public.founder_offer_payment_ready(c) from public.founder_offer_config c), false,
    'term 11: whitespace refund wording is not published text, so an approval cannot be padded');
update public.founder_offer_config set refund_policy_text = repeat('x', 40) where offer_key = 'FOUNDER_V1';
select lives_ok(
    $q$update public.founder_offer_config set refund_policy_text = repeat(E'\u00a0', 40) where offer_key = 'FOUNDER_V1'$q$,
    'a refund text of forty non-breaking spaces is storable, because the length check counts them');
select is((select public.founder_offer_payment_ready(c) from public.founder_offer_config c), false,
    'term 11: forty spaces the customer surface trims away are not published wording either');
update public.founder_offer_config set refund_policy_text = repeat('x', 40) where offer_key = 'FOUNDER_V1';

select lives_ok(
    $q$update public.founder_offer_config set disclosures_status = 'PENDING' where offer_key = 'FOUNDER_V1'$q$,
    'approved disclosures can be withdrawn again');
select is((select public.founder_offer_payment_ready(c) from public.founder_offer_config c), false,
    'term 12: unapproved disclosures block payment even with everything else configured');
update public.founder_offer_config set disclosures_status = 'APPROVED' where offer_key = 'FOUNDER_V1';

-- Term 3 is the one the authority cannot be tested against, because the table
-- will not store any other price. Pinning that keeps the term honest: it is
-- enforced upstream, not silently dropped.
select is(
    (select count(*) from pg_constraint
      where conrelid = 'public.founder_offer_config'::regclass
        and conname = 'founder_offer_config_amount_paise_check'
        and pg_get_constraintdef(oid) like '%49900%'),
    1::bigint,
    'term 3 is enforced before the readiness function can be asked, so no other price can be stored');
select is((select public.founder_offer_payment_ready(c) from public.founder_offer_config c), true,
    'the offer is back to the fully configured state, so the sections below start from a known baseline');

-- ---------------------------------------------------------------------------
-- K. D-S8-5: the VPA term is the client's term, not a length. A malformed
--    address is deliberately storable on a LIVE destination (that is why the
--    rule is a function rather than a CHECK) and the authority has to refuse it.
-- ---------------------------------------------------------------------------
select lives_ok(
    $q$update public.founder_offer_config set upi_id = 'not-a-vpa' where offer_key = 'FOUNDER_V1'$q$,
    'a malformed VPA is storable on a LIVE destination, so readiness is the only layer that can refuse it');
select is((select public.founder_offer_payment_ready(c) from public.founder_offer_config c), false,
    'three characters that are not an address do not make the offer payable');
update public.founder_offer_config set upi_id = 'a@b' where offer_key = 'FOUNDER_V1';
select is((select public.founder_offer_payment_ready(c) from public.founder_offer_config c), false,
    'a one-character local part and a one-character provider are refused');
update public.founder_offer_config set upi_id = 'merchant@' where offer_key = 'FOUNDER_V1';
select is((select public.founder_offer_payment_ready(c) from public.founder_offer_config c), false,
    'an address with no provider part is refused');
update public.founder_offer_config set upi_id = '@upi' where offer_key = 'FOUNDER_V1';
select is((select public.founder_offer_payment_ready(c) from public.founder_offer_config c), false,
    'an address with no payee part is refused');
update public.founder_offer_config set upi_id = 'x@y@z' where offer_key = 'FOUNDER_V1';
select is((select public.founder_offer_payment_ready(c) from public.founder_offer_config c), false,
    'two at-signs are refused rather than split into something payable');
update public.founder_offer_config set upi_id = 'https://dueweave.invalid/pay' where offer_key = 'FOUNDER_V1';
select is((select public.founder_offer_payment_ready(c) from public.founder_offer_config c), false,
    'a stored URL is refused, so a copy-pasted payment link cannot become a destination');
-- Parity, not extra strictness: what the client accepts the authority accepts,
-- including surrounding tabs that PostgreSQL's own trim() would leave in place.
update public.founder_offer_config set upi_id = 'DUEWEAVE-TEST@UPI' where offer_key = 'FOUNDER_V1';
select is((select public.founder_offer_payment_ready(c) from public.founder_offer_config c), true,
    'an upper-case address is accepted, because neither boundary made itself stricter than the other');
update public.founder_offer_config set upi_id = E'\t dueweave-test@upi \t' where offer_key = 'FOUNDER_V1';
select is((select public.founder_offer_payment_ready(c) from public.founder_offer_config c), true,
    'surrounding tabs and spaces are trimmed by the same character class the client trims with');
update public.founder_offer_config set upi_id = E'\u00a0dueweave-test@upi\u00a0' where offer_key = 'FOUNDER_V1';
select is((select public.founder_offer_payment_ready(c) from public.founder_offer_config c), true,
    'a non-breaking space is padding the customer boundary removes, so the authority removes it too');
update public.founder_offer_config set upi_id = E'\u200bdueweave-test@upi' where offer_key = 'FOUNDER_V1';
select is((select public.founder_offer_payment_ready(c) from public.founder_offer_config c), false,
    'a zero-width space is kept by JavaScript as well, so the class was matched to the client and not widened past it');
update public.founder_offer_config set upi_id = 'dueweave-test@upi' where offer_key = 'FOUNDER_V1';
select is((select public.founder_offer_payment_ready(c) from public.founder_offer_config c), true,
    'the synthetic fixture address is accepted, so the refusal above was about shape');

-- ---------------------------------------------------------------------------
-- L. D-S8-6: the shipped placeholder sentence is not a configured contact. The
--    column default is a non-sentence, and status alone used to promote it.
-- ---------------------------------------------------------------------------
update public.founder_offer_config set support_contact = 'Support contact not configured' where offer_key = 'FOUNDER_V1';
select is((select public.founder_offer_payment_ready(c) from public.founder_offer_config c), false,
    'the shipped placeholder sentence is not a support contact, even marked CONFIGURED');
update public.founder_offer_config set support_contact = '  Support contact not configured  ' where offer_key = 'FOUNDER_V1';
select is((select public.founder_offer_payment_ready(c) from public.founder_offer_config c), false,
    'padding the placeholder does not turn it into a contact address');
select lives_ok(
    $q$update public.founder_offer_config set support_contact = E'\t\t\t' where offer_key = 'FOUNDER_V1'$q$,
    'a tab-only support value is storable, because the plain length check trims spaces only');
select is((select public.founder_offer_payment_ready(c) from public.founder_offer_config c), false,
    'a whitespace support value is not a contact');
update public.founder_offer_config set support_contact = 'ab' where offer_key = 'FOUNDER_V1';
select is((select public.founder_offer_payment_ready(c) from public.founder_offer_config c), false,
    'a two-character support value is below the stated usable length');
update public.founder_offer_config set support_contact = 'ask from the profile page' where offer_key = 'FOUNDER_V1';
select is((select public.founder_offer_payment_ready(c) from public.founder_offer_config c), true,
    'a plain-text support handle is accepted, because the product contract does not require an email');
select lives_ok(
    $q$update public.founder_offer_config set support_contact = repeat(E'\u00a0', 5) where offer_key = 'FOUNDER_V1'$q$,
    'a support value of non-breaking spaces is storable, because the plain length check trims spaces only');
select is((select public.founder_offer_payment_ready(c) from public.founder_offer_config c), false,
    'five non-breaking spaces reach nobody, which is how the customer surface already reads them');
update public.founder_offer_config set support_contact = E'\u3000ask from the profile page\u3000' where offer_key = 'FOUNDER_V1';
select is((select public.founder_offer_payment_ready(c) from public.founder_offer_config c), true,
    'a real handle padded with ideographic spaces is still a handle, so parity did not become extra strictness');
select is((select count(*) from pg_constraint
      where conrelid = 'public.founder_offer_config'::regclass
        and contype = 'c'
        and pg_get_constraintdef(oid) like '%support_contact%'
        and pg_get_constraintdef(oid) like '%@%'),
    0::bigint,
    'no constraint demands an address format, so support validation stops where the database can actually decide');

-- ---------------------------------------------------------------------------
-- M. The refusal is the RPCs', made to a genuine `authenticated` principal, and
--    it is a readiness refusal rather than a permission error. The helper is not
--    callable by that role, yet the RPC that calls it still is, which is the
--    only way the authority can be reached from the browser at all.
-- ---------------------------------------------------------------------------
create temp table pg_temp.founder_gate_probe (probe text, state text, message text);

update public.founder_offer_config set upi_id = 'not-a-vpa' where offer_key = 'FOUNDER_V1';
do $rpc$
declare v_claim_state text; v_claim_msg text; v_submit_state text; v_submit_msg text;
          v_direct_state text; v_direct_msg text;
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',
                     json_build_object('role', 'authenticated',
                                       'sub', '11111111-1111-1111-1111-111111111111')::text, true);
  begin
    perform public.create_founder_claim();
  exception when others then
    get stacked diagnostics v_claim_state = returned_sqlstate, v_claim_msg = message_text;
  end;
  begin
    perform public.submit_founder_payment('DW-F-PROBE000000', '429381005219', 'Fixture Payer');
  exception when others then
    get stacked diagnostics v_submit_state = returned_sqlstate, v_submit_msg = message_text;
  end;
  begin
    perform public.founder_offer_payment_ready(c) from public.founder_offer_config c;
  exception when others then
    get stacked diagnostics v_direct_state = returned_sqlstate, v_direct_msg = message_text;
  end;
  reset role;
  insert into pg_temp.founder_gate_probe values
      ('malformed-claim', v_claim_state, v_claim_msg),
      ('malformed-submit', v_submit_state, v_submit_msg),
      ('malformed-direct', v_direct_state, v_direct_msg);
end $rpc$;
select is((select message from pg_temp.founder_gate_probe where probe = 'malformed-claim'),
    'Founder payment instructions are not ready yet',
    'as authenticated, starting a claim on a stored malformed VPA is refused as not ready, not accepted');
select is((select message from pg_temp.founder_gate_probe where probe = 'malformed-submit'),
    'Payment instructions are not ready for submission',
    'as authenticated, submitting against a stored malformed VPA is refused as not ready');
select is((select state from pg_temp.founder_gate_probe where probe = 'malformed-direct'), '42501',
    'the same principal is denied the readiness function directly, so it stays internal');

update public.founder_offer_config set upi_id = 'dueweave-test@upi',
    support_contact = 'Support contact not configured' where offer_key = 'FOUNDER_V1';
do $rpc$
declare v_claim_state text; v_claim_msg text; v_submit_state text; v_submit_msg text;
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',
                     json_build_object('role', 'authenticated',
                                       'sub', '11111111-1111-1111-1111-111111111111')::text, true);
  begin
    perform public.create_founder_claim();
  exception when others then
    get stacked diagnostics v_claim_state = returned_sqlstate, v_claim_msg = message_text;
  end;
  begin
    perform public.submit_founder_payment('DW-F-PROBE000000', '429381005219', 'Fixture Payer');
  exception when others then
    get stacked diagnostics v_submit_state = returned_sqlstate, v_submit_msg = message_text;
  end;
  reset role;
  insert into pg_temp.founder_gate_probe values
      ('placeholder-claim', v_claim_state, v_claim_msg),
      ('placeholder-submit', v_submit_state, v_submit_msg);
end $rpc$;
select is((select message from pg_temp.founder_gate_probe where probe = 'placeholder-claim'),
    'Founder payment instructions are not ready yet',
    'the shipped support placeholder no longer reads as a configured contact to the claim RPC');
select is((select message from pg_temp.founder_gate_probe where probe = 'placeholder-submit'),
    'Payment instructions are not ready for submission',
    'and the same placeholder is refused at submission');
select is((select count(*) from public.purchase_claims
            where owner_id = '11111111-1111-1111-1111-111111111111'), 0::bigint,
    'none of those refusals left a claim behind');

-- The control that makes the four messages above mean something: with every term
-- satisfied the same principal does not get a readiness refusal. Its attempt then
-- fails on the missing profile row, which is a different fact entirely.
update public.founder_offer_config set support_contact = 'ask from the profile page' where offer_key = 'FOUNDER_V1';
do $rpc$
declare v_claim_state text; v_claim_msg text;
begin
  execute 'set local role authenticated';
  perform set_config('request.jwt.claims',
                     json_build_object('role', 'authenticated',
                                       'sub', '11111111-1111-1111-1111-111111111111')::text, true);
  begin
    perform public.create_founder_claim();
  exception when others then
    get stacked diagnostics v_claim_state = returned_sqlstate, v_claim_msg = message_text;
  end;
  reset role;
  insert into pg_temp.founder_gate_probe values ('ready-claim', v_claim_state, v_claim_msg);
end $rpc$;
select isnt((select message from pg_temp.founder_gate_probe where probe = 'ready-claim'),
    'Founder payment instructions are not ready yet',
    'with the offer fully configured the same principal gets past the readiness gate, so the refusals above were the gate and not the fake account');

-- ---------------------------------------------------------------------------
-- N. No browser role gained anything. The two RPCs keep the reach Stage 4.2A
--    gave them and the new helper keeps none of it.
-- ---------------------------------------------------------------------------
select is(
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('create_founder_claim', 'submit_founder_payment', 'founder_offer_payment_ready')
        and has_function_privilege('anon', p.oid, 'EXECUTE')),
    0::bigint,
    'anon gained no EXECUTE on any part of the readiness path');
select is(
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('create_founder_claim', 'submit_founder_payment', 'founder_offer_payment_ready')
        and (has_function_privilege('authenticated', p.oid, 'EXECUTE')
             or has_function_privilege('public', p.oid, 'EXECUTE'))),
    2::bigint,
    'exactly the two claim RPCs stay callable by an account, which is the reach they had before');
select is(
    (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname in ('create_founder_claim', 'submit_founder_payment', 'founder_offer_payment_ready')
        and has_function_privilege('service_role', p.oid, 'EXECUTE')),
    3::bigint,
    'service_role reaches all three, so the operator path did not narrow');
select is(
    (select count(*) from pg_proc p
      cross join lateral aclexplode(p.proacl) a
      where p.proname = 'founder_offer_payment_ready' and a.grantee = 0),
    0::bigint,
    'the readiness function carries no PUBLIC entry in its own ACL');

-- ---------------------------------------------------------------------------
-- H. Leave the row in its delivered state and prove it by reading it back.
-- ---------------------------------------------------------------------------
select lives_ok(
    $q$update public.founder_offer_config
        set payment_destination_status = 'PLACEHOLDER', upi_id = null, amount_paise = 49900,
            founder_cap = 50, payee_name = 'DueWeave',
            support_contact = 'Support contact not configured', support_contact_status = 'PENDING',
            refund_policy_status = 'PENDING_APPROVAL', refund_policy_text = null,
            disclosures_status = 'PENDING', enabled = true
      where offer_key = 'FOUNDER_V1'$q$,
    'the delivered fail-closed row can always be restored');
select ok((select payment_destination_status = 'PLACEHOLDER' and upi_id is null
             and amount_paise = 49900 and founder_cap = 50
             and payee_name = 'DueWeave'
             and support_contact = 'Support contact not configured'
             and refund_policy_status = 'PENDING_APPROVAL' and refund_policy_text is null
             and support_contact_status = 'PENDING' and disclosures_status = 'PENDING'
           from public.founder_offer_config),
    'the offer row is back in its documented delivered state with no residue');
select is((select public.founder_offer_payment_ready(c) from public.founder_offer_config c), false,
    'and the restored delivered row is still NOT payment-ready');
