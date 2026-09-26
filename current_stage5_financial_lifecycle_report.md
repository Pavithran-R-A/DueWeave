# DUEWEAVE CURRENT ROADMAP — STAGE 5: FINANCIAL + PROMISE LIFECYCLE CORRECTNESS

Brief id: (attached brief, `DUEWEAVE — CURRENT ROADMAP STAGE 5`)
Branch: `current-stage-5-lifecycle-correctness` (base `d51df278ae08d3d7c06fe33d84da0a876b9e7e7a`)
STARTING SHA: `d51df278ae08d3d7c06fe33d84da0a876b9e7e7a`
ENDING SHA: _(filled at Phase 46)_
Status: **IN PROGRESS** — §1–§3 are the measured Phase 2 baseline and the Phase 3 current-state map; §4 is the ratified Stage 5 design that the migrations implement. Gate results are appended as they are measured.

---

## 1. Phase 2 baseline — accepted Stage 2–4 functionality, re-measured on this branch

Nothing was trusted from the Stage 4 report; every number below was re-run on
`current-stage-5-lifecycle-correctness` after a zero replay.

| Gate | Measured |
| --- | --- |
| `supabase stop` → `start` → `pnpm db:reset:local` | `Applying migration` × **19**, last one `20260814170000_current_stage4_persistent_edits.sql` |
| `pnpm db:types` twice | both `sha1 eedacce24ab298d73c2d57cba8994a66761915b3`, and `git status` clean afterwards (regeneration matches the committed file) |
| `pnpm test:db` | `Files=3, Tests=143 … Result: PASS` |
| `pnpm test:stage2` | 12 passed |
| `pnpm test:stage3` | 110 passed |
| `pnpm lint` / `pnpm check` | both clean |
| `pnpm build` | built, `Home-*.js` 50.49 kB |
| `pnpm test` (full) | **268 passed \| 1 skipped (269)**, 16 files passed \| 1 skipped |
| `pnpm audit --prod --audit-level=high` | `No known vulnerabilities found` |
| browser Stage 2 / Stage 3 / Stage 4 | **1 passed** / **5 passed** / **10 passed** |

Conclusion: no authorization, persistence or isolation regression was inherited,
so Stage 5 was allowed to begin. `PGRST303` did not strike during the baseline.

## 2. Phase 3 — the current transition map, read from the EXECUTED database

Every definition below is `pg_get_functiondef()` output from the live
19-migration database, not from an old migration file. All 19 migrations replay
without error; later migrations replace earlier definitions of the same
function, so the executed form is authoritative.

### 2.1 Tables, constraints and triggers that police money

* `receivables` — `amount_due_paise > 0`; `receivables_status_check` allows
  `OPEN, PARTIALLY_PAID, PAID, CANCELLED, WRITTEN_OFF`; **two near-duplicate
  row CHECKs coexist**: `receivables_check1` (auto-named, from the original
  `check` clause) and `receivables_financial_state_check`. They **disagree**:
  `check1` has no `WRITTEN_OFF` branch while `financial_state_check` allows
  `status in ('CANCELLED','WRITTEN_OFF') and outstanding_paise >= 0`. Measured
  consequence: a `WRITTEN_OFF` row cannot be stored at all, yet the value is in
  the status CHECK, in `create_promise`'s closed-status test and in the
  frontend union. `CANCELLED`'s invariant is only `outstanding_paise >= 0`, i.e.
  undefined.
  Triggers: `receivables_updated_at`, `receivables_verify_client_owner`,
  `receivables_free_limit`, `receivables_guard_financial_fields`
  (`guard_receivable_financial_fields` raises unless
  `app.ar1_write_context = 'payment'` when `owner_id, client_id,
  amount_due_paise, outstanding_paise, status` move).
* `payments` — `amount_paise > 0`; `method` CHECK `UPI, BANK_TRANSFER, CASH,
  OTHER`; `note ≤ 2000`; **no constraint on `paid_on` whatsoever**.
  `payments_immutable` (BEFORE UPDATE OR DELETE → `raise`) makes every payment
  permanent once written.
* `promises` — `promised_amount_paise > 0`; `sequence_no > 0`;
  `unique (receivable_id, sequence_no)`; status CHECK with the six values.
  `promises_guard_history` → `guard_promise_history()`, whose full rule is:
  facts (`owner_id, receivable_id, sequence_no, promised_amount_paise,
  promised_date, source, note`) may never change; **`if old.status <> 'ACTIVE'
  then raise 'Resolved promises cannot be changed'`**; and any legal change
  still requires `app.ar1_write_context = 'promise'`. There is no transition
  *matrix* — ACTIVE is the only permitted source state.
* `promise_events` — append-only (`promise_events_immutable`), `from_status`
  nullable, `to_status` in the six values, `actor_type in ('USER','SYSTEM')`.
* `activities` — append-only (`activities_immutable`).
* `profiles` — `authenticated` holds a **direct UPDATE** on this table (the only
  table it may update); `profiles_prevent_plan_change` guards plan/entitlement
  drift only. `timezone text not null default 'Asia/Kolkata' check
  (char_length between 1 and 64)` — so the column is freely editable by the
  owner today.

### 2.2 The lifecycle write paths, as executed

| RPC | What it actually does with money and promises |
| --- | --- |
| `create_receivable` | validates amount/label/date, locks the client `FOR UPDATE`, inserts `status='OPEN'`, `outstanding = amount_due`, appends a `RECEIVABLE_CREATED` activity. No promise logic. No request/idempotency key. |
| `record_payment` | locks the receivable `FOR UPDATE`; rejects `amount <= 0` and `amount > outstanding_paise`; inserts the payment with `upper(replace(method,' ','_'))` **without validating the method** (a bad method dies on the CHECK and surfaces raw constraint text); recomputes `v_outstanding := outstanding_paise - amount`; sets write context `payment`; updates `outstanding_paise` and `status = case when v_outstanding = 0 then 'PAID' else 'PARTIALLY_PAID' end`; then `select * into v_active from promises where receivable_id = … and status = 'ACTIVE' for update` **with no `ORDER BY`**, and if found: `status = case when v_outstanding = 0 then 'KEPT' else 'PARTIALLY_KEPT' end, resolved_at = now()` plus a `promise_event` and a `PAYMENT_RECORDED` activity. **`promised_amount_paise` and `promised_date` are never read.** |
| `create_promise` | calls `mark_due_promises_broken()` **first**, then locks the receivable `FOR UPDATE`; rejects closed receivables, `amount <= 0`, `amount > outstanding`, null date, invalid source, long notes; renegotiates *the* ACTIVE promise it finds (same unordered `select … for update`) to `RENEGOTIATED` with an event; `sequence_no = coalesce(max(sequence_no),0)+1`; inserts ACTIVE + `null→ACTIVE` event + `PROMISE_CREATED` activity. No request/idempotency key. Accepts a **past** `promised_date` without comment. |
| `mark_due_promises_broken` | owner from `auth.uid()`; business date = `(now() at time zone coalesce(profiles.timezone,'Asia/Kolkata'))::date`; loops `promises join receivables` where `status='ACTIVE' and promised_date < business_date and r.status in ('OPEN','PARTIALLY_PAID')` `FOR UPDATE`; sets each to **`BROKEN`** with the fixed reason `'Promise date passed without a recorded full payment'` and appends event + activity. It never looks at payments, so a promise with partial money on record is reported as though nothing was paid. |
| `snooze_receivable` | derives the same business date from `profiles.timezone`; rejects `until < today`; requires `status in ('OPEN','PARTIALLY_PAID')`; appends a `SNOOZED` activity carrying `snoozed_until`. Append-only — snoozing is history, not state. |
| `record_contacted` | appends a `FOLLOW_UP_RECORDED` activity. No lifecycle effect. |
| `update_client` / `update_receivable_details` | Stage 4's narrow, token-guarded edits. Unchanged by Stage 5. |

### 2.3 The current status transition map (what the executed SQL permits)

```
receivable:  OPEN ──pay──▶ PARTIALLY_PAID ──pay──▶ PAID     (PAID/PARTIALLY_PAID via
            OPEN ─────────────────────────────────▶ PAID      record_payment only)
            (CANCELLED, WRITTEN_OFF: reachable by no code path at all)

promise:     ACTIVE ──any payment on the receivable──▶ KEPT   (only if invoice hits 0)
                     ACTIVE ──any payment on the receivable──▶ PARTIALLY_KEPT (permanent)
                     ACTIVE ──promised_date < today──▶ BROKEN (permanent)
                     ACTIVE ──new promise recorded──▶ RENEGOTIATED (permanent)
                     (CANCELLED: reachable by no code path)
    once status <> ACTIVE: guard_promise_history refuses every further change
```

### 2.4 Frontend state of the same facts

* `receivables.outstanding_paise` is selected and mapped into
  `Receivable.outstandingPaise` (optional in the type) and then **never read**:
  no UI, scoring or queue code consumes it.
* Every money position instead calls `getOutstanding(receivable, payments)` =
  `Math.max(0, amount_due − Σpayments)` — a *second* truth, computed in the
  browser, whose `Math.max(0, …)` clamp silently absorbs a contradictory
  overpayment instead of exposing it.
* `getQueue` includes a receivable iff the recomputed outstanding > 0 and the
  latest snooze is not in the future — due date and promise state are irrelevant,
  so an invoice due next month sits in Today.
* `breakdownFor`/`priorityReasons` invent `contactDays = 30` when nobody has ever
  been contacted, which renders "No contact for 30 days" on an invoice created
  today.
* `getReliability` counts `status !== 'ACTIVE'` into `resolved` (so
  `RENEGOTIATED` and `CANCELLED` inflate the denominator) while `kept/broken/
  partial` ignore them, and computes `delays` with
  `daysBetween(promise.promisedDate, promise.resolvedAt)` where `daysBetween`
  builds `` `${value}T12:00:00Z` `` — an ISO timestamp input yields Invalid Date,
  so `averageDelay` is `NaN` for any client with a resolved promise.
* Neither date input (`AddPromiseSheet`, `PaymentSheet`) has a `min` or `max`;
  only the snooze sheet does. `paymentRepository.record` sends `p_paid_on`
  without any format check.
* No request/idempotency key exists anywhere in `client/src`, and the promise,
  payment, snooze and contact handlers have no in-flight guard (only Stage 4's
  two edit handlers use `savingRef`).

## 3. Defects this stage exists to remove (each measured above, each to be RED before it is fixed)

| id | Defect | Evidence |
| --- | --- | --- |
| D-S5-1 | A fully honored promise cannot be recorded as `KEPT` unless the whole invoice is paid: `record_payment` decides on `v_outstanding = 0`. | executed `record_payment` |
| D-S5-2 | A promise is **finalised on the first payment regardless of the promised date**, so `PARTIALLY_KEPT` can be stamped days before the deadline — and because only `ACTIVE` promises are ever revisited, case B (`₹2,000 + ₹3,000` = the full promised sum, both in time) can **never** reach `KEPT`. | executed `record_payment` + `guard_promise_history` |
| D-S5-3 | `mark_due_promises_broken` stamps `BROKEN` with the text "without a recorded full payment" even when partial money is on record; it never inspects payments. | executed definition |
| D-S5-4 | No receivable cancellation and no promise cancellation exists at all, although `CANCELLED` is in both status CHECKs. | constraint + RPC inventory |
| D-S5-5 | Renegotiation calls any ACTIVE promise `RENEGOTIATED` even if it had already factually broken or been partly kept — the overdue sweep runs first, but a promise that is in-date yet already under-paid is superseded rather than reconciled. | executed `create_promise` |
| D-S5-6 | `record_payment` accepts a future `paid_on` (no constraint anywhere) and an invalid `method` (raw `23514` text to the customer). | constraint dump |
| D-S5-7 | No idempotency: double-click, retry after a lost response, or two identical submissions create two payments, two balance reductions, two activities. | executed definitions + zero `request_id` columns |
| D-S5-8 | Inverted lock order: `create_promise` locks `promises` (inside the sweep) **before** the receivable; `record_payment` locks the receivable **before** promises. Concurrent payment + promise on one receivable can deadlock. | executed definitions |
| D-S5-9 | The ACTIVE-promise pick is unordered and nothing enforces "at most one ACTIVE promise per receivable". | executed `select … for update` without `ORDER BY`; no partial unique index |
| D-S5-10 | Two contradictory row CHECKs on `receivables`, making `WRITTEN_OFF` un-storable while still advertised, and leaving `CANCELLED`'s balance undefined. | constraint dump |
| D-S5-11 | Two competing notions of outstanding; the browser's recomputation clamps away a contradiction and the stored authoritative column is ignored. | `finance.ts:57` + adapter |
| D-S5-12 | `profiles.timezone`, freely updatable by the owner, decides when a promise becomes `BROKEN`, while the frontend is hard-coded to India. | `mark_due_promises_broken` + measured `authenticated` UPDATE on `profiles` |
| D-S5-13 | Today queue includes non-actionable future work. | `getQueue` |
| D-S5-14 | Priority reasons can state a history that never happened (`30` days on a fresh invoice). | `breakdownFor`, `priorityReasons` |
| D-S5-15 | Reliability denominator includes non-outcomes and `averageDelay` is `NaN`. | `getReliability` |

## 4. Stage 5 authoritative design (ratified before implementation)

These are the semantics the Stage 5 migrations must implement and the pgTAP /
live / browser suites must pin. Each choice is traceable to a defect above.

### 4.1 PROMISE TRUTH TABLE

`QA(P, D)` — the *qualifying amount* of promise `P` evaluated at business date
`D` — is the sum of `payments.amount_paise` for payments on `P.receivable_id`
that satisfy the attribution rule of §4.2.

| Status | Meaning, as a fact about the record |
| --- | --- |
| `ACTIVE` | The commitment is live and its outcome is not final: `QA < promised_amount` **and** `D ≤ promised_date`. |
| `KEPT` | `QA ≥ promised_amount` — at least the promised sum was paid by the promised business date. Nothing about the invoice's remaining balance. |
| `PARTIALLY_KEPT` | The deadline has passed (`D > promised_date`) and `0 < QA < promised_amount`. |
| `BROKEN` | The deadline has passed and `QA = 0`. |
| `RENEGOTIATED` | A replacement commitment was recorded **while the promise was still factually ACTIVE** (in-date, not yet satisfied). |
| `CANCELLED` | The promise was explicitly withdrawn with a recorded reason, from `ACTIVE` only. The facts stay. |

Terminal by default: `KEPT`, `RENEGOTIATED`, `CANCELLED`. The only exception is
the evidence-driven correction in §4.4.

Two facts stay separate, by construction: **promise fulfilled** (about `QA` vs
`promised_amount`) and **invoice fully paid** (about `outstanding_paise`). A
partially paid invoice can contain a fully kept promise (case E), and a fully
paid invoice can contain a broken promise (case G).

### 4.2 PAYMENT ATTRIBUTION RULE

A payment counts toward promise `P` iff all of:

1. `payment.receivable_id = P.receivable_id`;
2. `payment.created_at > P.created_at` — the money was **recorded after the
   commitment existed**;
3. `payment.paid_on <= P.promised_date` — the money **arrived on or before the
   promised business date**.

Consequences, stated because they are deliberate and each is tested:

* *Payment recorded before the promise existed* → **never counts.** Money from
  last month cannot retroactively discharge a commitment made today; counting it
  would mark a promise `KEPT` the moment it was created.
* *Multiple payments toward one promise* → summed, so `₹2,000 + ₹3,000` against a
  `₹5,000` promise is `KEPT` (case B).
* *Payment after the deadline* → reduces the balance and settles the invoice, but
  does not count toward the promise: the promise stays `BROKEN`/`PARTIALLY_KEPT`
  (case G, and "full invoice payment after a promise deadline" is exactly this).
* *Payment recorded on the deadline* → counts (`<=` on `paid_on`, business dates
  are inclusive days).
* *Same-day promise/payment ambiguity* → resolved by `created_at`, which is a
  persisted microsecond timestamp, not by the calendar day. Recorded before the
  promise in the same calendar day still does not count; that is the
  deterministic reading of rule 2, and it is documented in the migration.
* No proxy on "receivable became `PAID`", no ratio, no first-in-first-out guess,
  no allocation of a payment across promises: the receivable's payments are the
  pool, and `paid_on`/`created_at` decide membership.

`promised_date` is the promise's own fact; `QA` is computed, never stored, and
the reconciliation helper recomputes it on every pass so no cached outcome can go
stale (D-S5-2).

### 4.3 ONE AUTHORITATIVE RECONCILIATION MECHANISM (browser surface stays narrow)

* `public.reconcile_promise_outcome(p_promise_id uuid, p_business_date date)` —
  internal `SECURITY DEFINER`, returns the resulting status. Reads the promise's
  own owner from the locked row, applies §4.1/§4.2, sets
  `app.ar1_write_context = 'promise'` for its own statement, appends
  `promise_events` and activities only when the status actually moves.
  **Not granted to `authenticated`, `anon` or `PUBLIC`** — the Stage 3
  fail-closed `ddl_command_end` trigger strips its implicit EXECUTE, and Stage 5
  adds no explicit grant, so a browser cannot reach it at all. pgTAP asserts
  that.
* `public.settle_owner_promises(p_owner uuid, p_business_date date)` — internal,
  same posture (no browser grant), loops a single owner's promises. This is the
  Phase 36 local-test seam: pgTAP and the psql-driven live suite can evaluate
  any business date, while `authenticated` never can.
* `public.mark_due_promises_broken()` — the existing browser RPC keeps its exact
  name and **zero-argument signature**, and becomes a thin wrapper: owner from
  `auth.uid()`, date from §4.5. It is the only lifecycle entry point a browser
  has, so the exposed RPC count does not grow.
* `record_payment` and `create_promise` stop deciding promise outcomes inline;
  both call `reconcile_promise_outcome` for the receivable's ACTIVE promise(s)
  after their own write, in the same transaction. The frontend keeps no promise
  logic either: `getPromiseStatusLabel` is display-only, and the scoring helpers
  consume statuses rather than assigning them.
* Fixed, truthful event reasons replace the current
  `'Promise date passed without a recorded full payment'` — including one that
  names the qualifying amount when a promise breaks partially.

### 4.4 LATE-RECORDED HISTORICAL PAYMENT (narrow correction, provenance preserved)

Ratified choice: **allow a correction, never erase the original event.**

* Permitted corrections, and only these, from `BROKEN` or `PARTIALLY_KEPT`:
  * `BROKEN → KEPT` when a later-recorded payment brings `QA ≥ promised_amount`;
  * `BROKEN → PARTIALLY_KEPT` when it brings `0 < QA < promised_amount`;
  * `PARTIALLY_KEPT → KEPT` when it brings `QA ≥ promised_amount`.
* Trigger of the correction: the payment's `created_at` is after the promise was
  resolved while its `paid_on` is `≤ promised_date` — i.e. the user is recording
  money that in fact arrived in time. Rule §4.2 still decides membership; the
  correction is not a separate notion of truth.
* The original event row stays exactly as written; a **new** `promise_events`
  row is appended carrying `from_status`, `to_status`, an actor of `SYSTEM`, and
  a reason that names the payment id and its `paid_on`
  ("Historical payment recorded for a date on or before the promise deadline").
  Activity timeline gets the matching entry. Both rows are then visible, which is
  the whole point: the ledger shows that it once said `BROKEN` and why it no
  longer does.
* `RENEGOTIATED` and `CANCELLED` are never corrected (they carry no financial
  outcome claim), and nothing may move *backwards* out of `KEPT`. Any other
  resolved-state change still raises, and pgTAP proves that.
* Why `PARTIALLY_KEPT → KEPT` is included even though the brief lists only the
  two `BROKEN →` forms: with only those, a promise that broke partially and is
  then shown to have been fully paid in time stays permanently `PARTIALLY_KEPT`
  next to payment evidence contradicting it — the exact contradiction this phase
  exists to remove. Widening is therefore kept to one additional, monotone
  (never downward) transition and documented here and in the migration.
* The UI does not hide backdating: the payment date input gains `max = today`
  (§4.9), and a backdated payment's effect on a resolved promise is stated in the
  activity entry, so the customer sees the correction rather than a rewrite.

### 4.5 BUSINESS DATE RULE, and the timezone invariant

* One database-side definition: `(now() at time zone 'Asia/Kolkata')::date`, in
  exactly one internal helper, used by reconciliation, `snooze_receivable`'s
  guard, and promise settlement. The `profiles.timezone` lookup disappears from
  the lifecycle path (D-S5-12's mechanism).
* `profiles.timezone` gains the invariant `check (timezone = 'Asia/Kolkata')`,
  which refuses an owner's direct `UPDATE` drift at the column itself — measured
  prerequisite: all 10 profile rows already satisfy it, so the constraint is
  added validated, with no `not valid` escape and no backfill.
* `currency` stays `INR`. The frontend's `todayInIndia()` remains the mirror of
  the same rule, and `business-clock.test.ts` plus a new cross-check keep the two
  definitions pinned to one another.
* Chosen model, stated plainly: **DueWeave v1 is India-only, and both sides say
  so.** Arbitrary timezones are not silently half-supported.

### 4.6 OUTSTANDING AUTHORITY, and RECEIVABLE STATUS INVARIANTS

* `receivables.outstanding_paise` is the one authoritative current balance. It is
  written only inside the protected payment/cancellation workflows
  (`app.ar1_write_context`), and read everywhere else.
* `Receivable.outstandingPaise` becomes **required** in the domain type, and every
  UI/scoring position consumes the stored value. `getOutstanding` survives only
  as a *test-side* derived-sum auditor (Phase 25) — never in a production path —
  and its `Math.max(0, …)` clamp is gone from the app, because a contradiction
  must fail loudly rather than render as zero. A static contract test asserts no
  production module recomputes outstanding.
* For financially live statuses the executed audit proves
  `outstanding_paise = amount_due_paise − Σpayments`, with `PAID ⇒ 0`.
* One authoritative row CHECK replaces the two contradictory ones
  (D-S5-10), and `WRITTEN_OFF` is dropped from the status CHECK, the frontend
  union, and every code path, because nothing in v1 implements write-off
  accounting and an advertised-but-unstorable status is a lie in the schema:
  ```
  (status = 'OPEN'            and outstanding_paise =  amount_due_paise) or
  (status = 'PARTIALLY_PAID'  and outstanding_paise >  0
                               and outstanding_paise <  amount_due_paise) or
  (status = 'PAID'            and outstanding_paise = 0) or
  (status = 'CANCELLED'       and outstanding_paise = 0)
  ```
  plus `outstanding_paise >= 0` and `amount_due_paise > 0`. `CANCELLED` therefore
  means "nothing is collectible" while `amount_due_paise` keeps the invoiced
  fact; the two zero-outstanding states stay distinguishable because a cancelled
  receivable has, by §4.7, no payments at all.
* Cross-row invariants (payment sums, one-ACTIVE-promise) stay in triggers and
  RPCs, where they belong; PostgreSQL row CHECKs are not used for them.

### 4.7 CANCELLATION RULES

* `cancel_receivable(p_receivable_id, p_reason, p_expected_updated_at)` — allowed
  only when the row belongs to `auth.uid()`, `status in ('OPEN','PARTIALLY_PAID')`
  i.e. not already closed, **and it has no payment rows at all**. It never
  deletes: `amount_due_paise` and every historical row are preserved,
  `outstanding_paise` goes to `0`, `status` → `CANCELLED`, any `ACTIVE` promise
  → `CANCELLED` through the guarded workflow with a `promise_event`, an activity
  is appended, and a short user-visible reason is required. Any payment history
  at all → refused, with the reason stated in calm copy. Optimistic-concurrency
  token, as in Stage 4.
* `cancel_promise(p_promise_id, p_reason, p_expected_updated_at)` — `ACTIVE →
  CANCELLED` only, reason required, `resolved_at` recorded, promise facts
  immutable, event + activity appended, resolved promises refused, and a repeated
  cancellation answers predictably rather than corrupting anything. No promise is
  ever deleted.
* Refunds, credit notes and write-offs are explicitly **out of scope** for
  Stage 5, and the report says so rather than leaving the reader to infer it.

### 4.8 RENEGOTIATION HONESTY

Recording promise `B` while `A` is ACTIVE first **reconciles `A` at today's
business date** (§4.3). Only if `A` is still `ACTIVE` afterwards — genuinely
in-date and not yet satisfied — does `A → RENEGOTIATED`. A promise that has
factually broken or been partially kept at the moment `B` is recorded keeps that
outcome and is never relabelled as a renegotiation (D-S5-5). Sequence numbers
keep their existing `unique (receivable_id, sequence_no)` guarantee under the
receivable row lock.

### 4.9 IDEMPOTENCY AND VALIDATION DESIGN

* `payments.request_id uuid null` and `promises.request_id uuid null`, each with
  `create unique index … on (owner_id, request_id) where request_id is not null`.
  Legacy rows keep `null` and are unaffected (measured: 0 payments today).
* `record_payment` and `create_promise` gain a `p_request_id uuid` parameter.
  * Same id + same payload → the existing row is returned. No second payment, no
    second balance reduction, no duplicate activity or promise event, no extra
    renegotiation. Implemented as insert-`on conflict (owner_id, request_id)
    where request_id is not null do nothing` + re-select, so the *race* between
    two concurrent retries also resolves to one row rather than a raw
    `23505`.
  * Same id + different payload → refused explicitly, with copy that says the
    save was already recorded with different details.
  * `reference`/UTR is **not** the key: it is optional and many methods have
    none (measured: `reference` is nullable and `nullif`-ed on insert).
* Receivable/client creation: **no database request id in v1.** Two identical
  invoices are legitimately distinct rows, so a key would add a column and a
  parameter without a proven invariant to protect; instead the UI gains the
  Stage 4 in-flight guard (`savingRef`-style, disabled submit, no double POST),
  which Phase 32 asks for as the minimum. This decision is recorded here so the
  omission is reviewed, not missed.
* Money validation becomes DB-authoritative: `amount <= 0`, `amount >`
  outstanding, above the 900,000,000,000,000 paise ceiling, non-integer paise,
  unknown method (refused with mapped copy, never raw `23514`), null or
  malformed `paid_on`, `paid_on > today` in Asia/Kolkata, foreign receivable,
  `PAID`/`CANCELLED` receivable. `bigint` paise end to end, no floating point
  arithmetic on money anywhere in the path.
* `promised_date` may be **in the past** — that is how a user records a
  commitment that already failed, and it is the honest mechanism the browser
  deadline journey uses; the form explains it. `paid_on` may be in the past but
  never the future.

### 4.10 TODAY QUEUE, PRIORITY REASONS, DETERMINISM, RELIABILITY

* Actionable-today eligibility, evaluated per receivable at business date `D`:
  `status in ('OPEN','PARTIALLY_PAID')` **and** `outstanding_paise > 0` **and**
  `latest snooze is null or ≤ D`, **and at least one of**
  — a `BROKEN` outcome that still needs follow-up;
  — an `ACTIVE` promise whose `promised_date ≤ D` (due today, or in-date and
    being reconciled);
  — no `ACTIVE` promise at all and `due_date ≤ D`.
  So a future-dated invoice no longer appears merely because money is owed, and a
  future `ACTIVE` promise suppresses collection nagging until its own date, which
  is what a promise is for. The exact rule is mirrored in one documented
  predicate, not scattered.
* Priority reasons must be quotable facts: the invented `contactDays = 30`
  baseline is replaced by staleness measured from a truthful anchor —
  `min(created business date, due_date)` — so an invoice created today can never
  claim "No contact for 30 days". Every rendered reason is asserted against its
  source facts.
* **Scoring weights are unchanged.** Phases 21–22 correct *which rows are
  eligible*, *what the reasons say*, and *what reliability counts*; the
  `brokenPromises / promiseUrgency / daysOverdue / outstandingPoints /
  contactStaleness / recentPartialAdjustment` weights stay as Stage 4 left them,
  because no failing correctness test proves a weight itself is wrong. If any
  weight does move, it will be listed with the test that forced it.
* Reliability counts only outcome-bearing promises — `KEPT`,
  `PARTIALLY_KEPT`, `BROKEN` — and excludes `RENEGOTIATED` and `CANCELLED` from
  the denominator; `resolvedAt` is converted to a business date deliberately
  where a calendar difference is needed, so `averageDelay` stops being `NaN`;
  if a defensible delay metric cannot be computed from persisted facts it is
  replaced by one that can, rather than kept for UI compatibility. Quiet Ledger
  language stays factual — no good/bad payer labels.

### 4.11 MIGRATION AND SECURITY POSTURE

* Forward-only. The existing 19 migrations are not edited. Stage 5 adds a small
  set of separately-dated migrations split by concern (constraints/invariant,
  reconciliation + correction, cancellation, idempotency) so a reviewer can
  reason about each.
* Every replaced browser RPC must be **explicitly re-`GRANT`ed to
  `authenticated`** — replacing an exposed routine strips browser EXECUTE by
  design under the Stage 3 fail-closed default-privilege trigger. No
  `PUBLIC`/`anon` execution anywhere, and pgTAP pins the exact EXECUTE set, which
  is intentionally updated (from 22) rather than loosened.
* New `SECURITY DEFINER` functions follow the repository's existing pinned
  `search_path` convention **deliberately, not mechanically**: Stage 4's
  routines pin `search_path = 'public','auth','pg_temp'` and every relation they
  touch is schema-qualified anyway, which keeps `auth.uid()` usable without a
  qualifier. Stage 5's internal helpers, which need no `auth` access at all,
  pin `search_path = 'pg_temp'` and schema-qualify every relation and function —
  the strictest posture — and the difference between the two shapes is asserted
  in pgTAP rather than left to convention.
* No grant of `UPDATE` on `receivables`/`payments`/`promises` to
  `authenticated`: lifecycle moves happen only inside SECURITY DEFINER routines,
  and the immutability guards stay armed.

## 5. Gates and results

Everything below is a measured run on this branch, not a restatement of the
design. Where a run was invalid, it is listed as invalid.

### 5.1 Phase 4 — the promise-settlement RED, captured before any SQL changed

`tests/stage5-local-lifecycle.test.ts` was written first and executed against
the **Stage 4 executed database** (19 migrations, no Stage 5 objects), through
the same repositories and RPCs the browser uses. `Start at 08:47:10`,
`Tests 4 failed | 4 passed (8)`:

| Case | Measured RED failure text | Defect proven |
| --- | --- | --- |
| A — part-paid, in-date promise | `a part-paid in-date promise must still be ACTIVE: expected 'PARTIALLY_KEPT' to be 'ACTIVE'` | D-S5-2 |
| B — ₹2,000 + ₹3,000 against a ₹5,000 promise | `₹2,000 + ₹3,000 against a ₹5,000 promise is the whole promise: expected 'PARTIALLY_KEPT' to be 'KEPT'` | D-S5-2 |
| E — honoured promise, invoice still part-paid | `the customer paid everything they promised: expected 'PARTIALLY_KEPT' to be 'KEPT'` | D-S5-1 |
| G2 — invoice paid in full *after* the promised date | `money that arrived after the promised date did not keep that promise: expected 'KEPT' to be 'BROKEN'` | D-S5-3 |

An earlier execution of the same file (`Start at 08:43:00`,
`Tests 7 failed (7)`) is recorded as an **invalid RED**: four of its seven
failures were `Error: Your Free plan allows up to three active receivables.`
raised from `seedInvoice` — a fixture-quota artifact, not the ledger refusing a
claim. It was not counted, and the fixtures were rewritten before 08:47:10.

Cases C, D, F and G1 passed against Stage 4. That is not evidence they were
correct: the old code stamps `PARTIALLY_KEPT`/`BROKEN` on the first payment and
never revisits a non-`ACTIVE` row, so those four outcomes matched the truth by
coincidence of the seeded amounts. The full A–G2 matrix is pinned anyway, which
is the only way a case that passes "by accident" today cannot silently start
passing for the wrong reason tomorrow.

### 5.2 In-flight REDs for the non-settlement defects

Each of these was observed failing on this branch before its fix, then closed.
Counts are from the runs themselves.

| Time | Measured | Defect closed by |
| --- | --- | --- |
| 09:11 (`11 failed \| 44 passed (55)`, 3 files) | `reliability … measures delay in India business days from a database time`, `finance helpers > keeps partial payments visible as an outstanding balance`, `finance helpers > recognizes a fully paid receivable` | D-S5-11, D-S5-12, D-S5-15 (frontend recomputed a second truth) |
| 09:47 (`5 failed \| 52 passed (57)`) | four `Supabase domain adapters` date/outcome filings + the reliability pin | D-S5-11, D-S5-14 |
| 10:00 (`2 failed \| 36 passed (38)`) | `refuses a browser that tries to write the balance or the status itself`, `keeps money out of the tables the browser has no business writing` | D-S5-10, D-S5-12 |
| 10:20 (`5 failed \| 2 passed \| 41 skipped (48)`) | `Stage 5 honours a promise to the last paisa` — `'KEPT' for 'a single payment for the whole promise'`, `'two payments that add up to it'`, `'one paisa and then the rest'`, `'more money than was promised'`, and the invoice-stays-partly-settled claim | D-S5-1, D-S5-2, D-S5-6 (property matrix over amounts) |
| pgTAP `Files=4, Tests=179 … Failed test 29: "the audit accepts every legal balance-and-status combination"` | the executed reconciliation audit cried wolf on a *cancelled* receivable (cancellation zeroes the balance with no payments behind it, so `outstanding = due − paid` is false for that one legal state) | D-S5-10 — the audit was scoped, not the row, and `CANCELLED` is now asserted as its own case |
| 04:16 (`Files=3, Tests=144, Result: FAIL`, `Failed test: 33`) | the Stage 3 privilege inventory rejected the widened browser routine set before it was updated | §4.11 grant posture (intentional update, not loosening) |

### 5.3 What Stage 5 added

| Artifact | Size | Content |
| --- | --- | --- |
| `supabase/migrations/20260815090000_current_stage5_lifecycle_correctness.sql` | 1,003 lines, 13 numbered sections, 16 routines | business date, attribution, truth table, one status writer, reconciliation, history guards, money invariants, request identity, `record_payment`, `create_promise`, overdue sweep, cancellation ×2, snooze, grants |
| `supabase/tests/stage5_01_lifecycle.sql` | 312 lines, `plan(37)` | pins §4 as catalog + executed-behaviour facts |
| `tests/stage5-local-lifecycle.test.ts` | 1,190 lines, 42 `it()` | cases A–G2, late-payment correction, calendar/timezone, payment matrix, outstanding authority, cancellation, renegotiation honesty, idempotency, parallel attacks, history provenance, executed audit, queue/priority/reliability |
| `e2e/stage5-local-lifecycle.spec.ts` | 339 lines, 10 tests, 2 serial journeys | the money journey and the deadline journey, UI only |
| `client/src/lib/request-id.ts` | 10 lines | one id per opened form, reused on retry |
| 22 modified files | — | domain, adapters, three repositories, `Home.tsx`, sheets/finance-ui, business clock, Stage 3 pgTAP + live pins, Stage 4 live suites |

### 5.4 Phases 39–44 closure battery, on the final tree

| Gate | Command | Measured result |
| --- | --- | --- |
| Zero replay | `pnpm db:reset:local` from an empty volume | 20 migrations applied in order, no errors, no `ALTER`-style repair; `database at local DB is ready for use` |
| Types determinism | `pnpm db:types`, twice, nothing else between | two byte-identical outputs, `sha256 f066f8249a021efd7f8f0bd149ae716757409dc90a091f4d0d10812cb2089b4c`; file remains `M` vs Stage 4 HEAD because Stage 5 changed the schema |
| pgTAP | `pnpm test:db` | `Files=4, Tests=181 … Result: PASS` — twice independently |
| Schema lint | `supabase db lint --local` | `No schema errors found` (one `never read variable` warning in the draft `cancel_promise` was fixed, then the whole reset/lint/pgTAP chain was re-run) |
| Advisors | `supabase db advisors --local --type all` | `No issues found`, exit 0 |
| Static + build | `pnpm lint`, `pnpm check`, `pnpm build` | all exit 0 (`Home-WE-8aciR.js` 57.08 kB, `index` 462.11 kB) |
| Stage 2 live | `pnpm test:stage2` | `12 passed (12)` |
| Stage 3 live | `pnpm test:stage3` | `110 passed (110)` |
| Stage 2/3/4 browser regression | `npx playwright test e2e/stage2… e2e/stage3… e2e/stage4…` | `16 passed (1.9m)`, exit 0 — identical to the §1 baseline (1 / 5 / 10) |
| Stage 5 browser | `npx playwright test e2e/stage5-local-lifecycle.spec.ts` | `10 passed (1.8m)`, then **re-run after the final migration edit**: `10 passed (2.3m)`, 1 worker, serial — followed by a fixture purge that read back `residue=0 guards=4/4` |
| Dependency audit | `pnpm audit --prod --audit-level=high` | `No known vulnerabilities found` |
| Diff hygiene | `git diff --check` | exit 0 |
| Secret/artifact scan | over the ~3,900-line change set | only false positives; `test-results/`, `dist/`, `.env`, `.env.local` confirmed gitignored; no service-role key, DB password or `.env` content in any committed file |
| Web-storage audit | inside the browser journey | only `sb-*-auth-token` and `dueweave-theme` in `localStorage`, session storage empty, and no ledger fact (client name, company, notes, amounts, reference) present in web storage |

The auth blob is disclosed rather than hidden: Supabase's own session entry
contains the signed-in email and display name, which is the *session*, not the
ledger. The scan therefore allowlists that key by name instead of loosening the
assertion, and the browser suite passes either way.

### 5.5 Concurrency and idempotency, executed not reasoned about

Four attacks ran against the real database with `Promise.all` over independent
PostgREST clients:

* two parallel payments that together over-subscribe the invoice → exactly one
  settles it, `outstanding_paise = 0`, `status = 'PAID'`, never negative and
  never a second full balance reduction, in either arrival order;
* two parallel payments that both fit → both recorded, promise settled once;
* the same `request_id` submitted twice **simultaneously** → one payment row,
  the second caller receives the original payment, not an error;
* parallel `create_promise` → `promise_number` stays unique (the sequence is
  taken inside the receivable lock), no duplicate `ACTIVE`.

`record_payment` and `create_promise` now take the receivable before the
promises, matching every other write path, and the overdue sweep runs inside
that order. No deadlock was observed across these runs; the earlier inverted
order (D-S5-8) is what made the payment/promise pair a deadlock candidate.

`request_id` is a `uuid` column on both `payments` and `promises`, unique per
owner and partial (`WHERE request_id IS NOT NULL`), so pre-Stage-5 rows cannot
collide with each other and one customer's key can never swallow another's
write. pgTAP pins that shape rather than trusting the migration text.

### 5.6 PGRST303 STATUS

No retry, no sleep, no JWT-leeway change, no rerun-away was used anywhere in
Stage 5. Run-by-run on the final tree:

| Run | Command | Result | First actual failure | Classification |
| --- | --- | --- | --- | --- |
| A | `pnpm test` (full) | `2 failed \| 325 passed \| 1 skipped (328)`, `Test Files 1 failed \| 16 passed \| 1 skipped (18)` | `PGRST303 — JWT issued at future` at `tests/stage2-local-foundation.test.ts:52`; `:161` (`expected '0672319b-…' to be undefined`) is downstream of it | **PGRST303 — infrastructure, not a Stage 5 lifecycle defect.** Pre-existing since Stage 4; PostgREST rejects a freshly minted GoTrue token whose `iat` is ahead of the container clock, before any table, policy or grant is consulted. |
| B | `pnpm test`, unchanged tree | `327 passed \| 1 skipped (328)`, `17 passed \| 1 skipped (18)` | none | clean |
| C | `pnpm test`, unchanged tree | `327 passed \| 1 skipped (328)`, `17 passed \| 1 skipped (18)` | none | clean — **two consecutive full-suite clean runs with no code or config change between them** |

Nothing in the Stage 5 lifecycle families (cases A–G2, correction, payment
matrix, cancellation, idempotency, parallel attacks, audit, browser journeys)
ever failed for a reason other than a genuine in-flight defect listed in §5.2.

### 5.7 Deviations from §4, and environment disclosures

1. **§4.11 promised "a small set of separately-dated migrations split by
   concern"; Stage 5 shipped as one migration.** The split was abandoned for a
   testable reason, recorded here rather than silently: the concerns are
   mutually dependent — the truth table needs the attribution function, the
   history guard needs the outcome columns the reconciliation writes, and the
   grants need the final signatures. Any intermediate replay would leave the
   executed schema in a state its own pgTAP pins reject, which is a migration
   that cannot be qualified. The single file is instead sectioned 1–13 in the
   same order as §4, so the review unit is a section.
2. **§4.7 promised an optimistic-concurrency token on both cancellation
   routines; the shipped signatures are `cancel_receivable(uuid, text)` and
   `cancel_promise(uuid, text)`, with none.** Disclosed, not glossed: both
   routines take the receivable `for update` before they decide anything, and
   both are guarded by state preconditions that make a blind overwrite
   impossible — a second cancellation meets `This … is already cancelled`, a
   concurrent money write meets `A receivable with recorded payments cannot be
   cancelled` under that same lock, and a concurrent promise write queues behind
   it. The token's purpose (never clobber a row someone else moved) is therefore
   met by the lock plus the state machine. Stage 4's edit RPCs keep their token
   because they write free text, where two simultaneous edits genuinely conflict
   and the later one must be refused rather than serialised. The one gap this
   leaves is unmeasured: no test in this stage races a cancellation against a
   payment, so the claim above rests on the lock and the executed refusals, and
   is listed under §6 rather than presented as proven.
3. **Test teardown no longer runs DDL.** Fixtures are purged with a
   transaction-scoped `set local session_replication_role = replica`,
   explicit child→parent deletes, `delete from auth.users`, and a read-back
   asserting `residue=0` and `guards=4/4`. No `drop`, no `truncate`, so a test
   run can no longer disarm an immutability guard — the failure mode that made
   earlier Stage 5 readings non-reproducible. Every suite in the file prints
   that read-back and warns if it is not clean.
4. **The Stage 5 browser spec is `mode: "serial"`.** Playwright's default
   `fullyParallel` (~8 workers here) turned one narrative journey into four
   settlement and three deadline workspaces, and those extra workspaces are
   exactly what produced the false `₹10,000` after reload and the `Not enough
   history` reading. Three executions were declared invalid for this and the
   environmental causes below before the 10-passed run; no product assertion
   was weakened to get there.
5. **Two e2e executions were voided for a shell-cwd drift** (`page.goto:
   Cannot navigate to invalid URL` — the persistent cwd had moved into `e2e/`,
   so no config and no `baseURL` were loaded, and the path argument then matched
   as a substring filter, making the run look valid). Re-ran from the repo root.
6. **A Playwright browser cache disappeared between runs**
   (`chromium_headless_shell-1234` gone; 33 GB free, so not disk pressure).
   Repaired with `npx playwright install chromium` — a cache download, no
   repository, config or lockfile change.
7. **Toast locators are region-scoped, and the cursor is parked.** The
   timeline legitimately contains the words `Payment recorded`, so an
   unscoped text match is ambiguous; and sonner pauses a toast's dismissal
   while the pointer is over it, which held the stack on top of the header's
   "Add receivable" button for 52 retried clicks. Both are spec-side fixes.
8. **A real UI defect was found and deliberately NOT changed:** sonner's toast
   stack overlays the header's primary action, and hover-pause can hold it
   there indefinitely. Fixing it is a layout/interaction change, and UI
   redesign is outside this stage. **Carry to Stage 6.**
9. `supabase_vector_dueweave` crash-loops in this local stack, unchanged from
   the Stage 2–4 baseline. It is the telemetry container, was not touched, and
   has no bearing on the ledger or on any gate above.
10. `git diff` prints `LF will be replaced by CRLF` for 14 files.
   `git ls-files --eol` shows `i/lf w/lf` and `git diff --check` exits 0, so
   these are warnings from the local Git configuration, not line-ending churn
   introduced by this stage.

## 6. KNOWN LIMITATIONS

* The business date is `Asia/Kolkata` for every account, by design (§4.5), and
  `profiles.timezone` is now refused at the trigger. Multi-timezone tenants are
  therefore not supported; that is a product decision this stage makes
  explicit, not an oversight.
* `record_payment` attributing to the receivable's payment history (not to a
  specific promise row) means a customer who pays across two promises on one
  invoice cannot have those two promises graded against separate pots of money.
  §4.2's rule is honest about that and the alternative — inventing a per-promise
  split — was rejected as an untestable heuristic.
* The §4.4 correction only narrows `BROKEN → KEPT`/`PARTIALLY_KEPT` on later
  evidence. A promise that reached `CANCELLED` or `RENEGOTIATED` is never
  reopened, by design; money that arrives after a withdrawal is recorded and
  changes the balance, but not that outcome.
* No refund, credit-note or write-off accounting exists. `WRITTEN_OFF` was
  removed from the storage vocabulary precisely because nothing in this stage
  can produce its facts honestly; money that has already been received is never
  reversed by `cancel_receivable`.
* Idempotency is per opened form. A retry after the form is closed and reopened
  is a new intent with a new key, and is recorded as a second payment — which is
  the intended behaviour for a genuine second receipt, and the reason the
  reference/UTR is deliberately *not* the key.
* "At most one `ACTIVE` promise per receivable" (D-S5-9) is enforced by the
  write path, not by the catalog: every promise writer takes the receivable lock
  first, reconciles inside it, and supersedes the `ACTIVE` row found with a
  deterministic `order by sequence_no` pick — the parallel `create_promise`
  attack measures the result (sequences `[1, 2]`, exactly one `RENEGOTIATED`,
  one still-open commitment). A partial unique index
  (`… where status = 'ACTIVE'`) would belt that at the catalog level too; it was
  not added, because §4.12 ratifies cross-row invariants as trigger/RPC
  responsibilities and a status-valued index would make every honest
  reconciliation a constraint-touching write. Recorded as a deliberate
  limitation, not as work that was claimed.
* Cancellation carries no client-supplied concurrency token (§5.7 item 2). Its
  safety rests on the receivable row lock and the executed state refusals,
  which were tested singly (double cancel, cancel after payment, cancel after
  settlement) but never as a two-client race against `record_payment`. If a
  future stage makes cancellation reachable from two devices at once, that race
  is the first thing to measure.
* Reliability needs at least one outcome-bearing promise. The empty case reads
  "Not enough history" instead of `0 of 0`.
* pgTAP's `plan(37)` covers catalog facts plus a bounded executed sample; the
  exhaustive behaviour matrix lives in the live suite, which requires the local
  stack. `pnpm test:db` alone does not prove §4.1's table.
* The concurrency proofs are two-writer attacks on a local single-node Postgres.
  They pin lock order and outcome determinism; they are not a claim about
  multi-region or connection-pool-retry behaviour, which this project does not
  have.

## 7. FINAL CURRENT-ROADMAP STAGE 5 VERDICT

**PASS.**

Every defect D-S5-1 … D-S5-15 that §3 proved from the executed Stage 4 database
is either removed with a measured RED→GREEN (settlement, attribution, overdue
text, validation, outstanding authority, status vocabulary, timezone, queue,
priority reasons, reliability), or removed by a new capability that did not
exist and could not be exercised before (cancellation ×2, a deterministic
`ACTIVE` pick under the receivable lock measured to yield exactly one open
commitment, request identity, lock ordering, durable-history guards, an
executed reconciliation audit that fails loudly on planted contradictions).

Money and promise state are now decided in one place, by one mechanism, from
facts that are true of the row: `promise fulfilled` and `invoice fully paid`
are separate columns of separate truths, and the browser reads the
database's answer instead of recomputing its own. The browser journey proves it
end to end — ₹10,000 due, ₹5,000 promised, ₹5,000 paid, `Kept`, ₹5,000 still
outstanding, `PARTIALLY_PAID`, reload re-reads the same state, final ₹5,000 →
`PAID` at ₹0 with the earlier `KEPT` promise still visible in the timeline —
and the deadline journey proves `PARTIALLY_KEPT`, `BROKEN`, `KEPT`,
`RENEGOTIATED` and `CANCELLED` coexisting on one ledger with reliability
counting only the three promises that actually reached an outcome.

Stage 2/3/4 regression is unchanged from the §1 baseline (12 / 110 / 16
browser), the schema replays from zero through 20 migrations, generated types
are reproducible, lint/advisors/audit are clean, and two consecutive full-suite
runs are clean with only the pre-existing PGRST303 infrastructure failure
classified separately.

**NEXT RECOMMENDED ROADMAP STAGE: Stage 6 — Production UX ONLY IF PASS.**
