# DUEWEAVE CURRENT ROADMAP — STAGE 5: FINANCIAL + PROMISE LIFECYCLE CORRECTNESS

Brief id: (attached brief, `DUEWEAVE — CURRENT ROADMAP STAGE 5`, plus the attached
`FINAL PROMISE-CHRONOLOGY + EVIDENCE CLOSURE` continuation brief)
Branch: `current-stage-5-lifecycle-correctness` (base `d51df278ae08d3d7c06fe33d84da0a876b9e7e7a`)
STARTING SHA (Stage 5 as a whole): `d51df278ae08d3d7c06fe33d84da0a876b9e7e7a`
STARTING SHA (this closure pass): `ee4a5894e8ca0938e1b5589c84ee6b0a88121ae9` — the pushed Stage 5 HEAD, continued, never restarted or amended
ENDING SHA: the single forward commit this pass pushes on top of `ee4a589`. A commit cannot contain its own hash, and Stage 5 history was not rewritten to embed one, so the closing hash is read from the push output and reported in the final closure block rather than back-poked into this line.
Status: **CLOSED — PASS ON ATTRIBUTION + EVIDENCE, WITH DISCLOSED CAVEATS** — §1–§3 are the measured Phase 2 baseline and the Phase 3 current-state map; §4 is the ratified Stage 5 design; §5–§7 are the original Stage 5 pass; §8 is the chronology/evidence closure. §4.2 was **wrong as first written** and has been corrected in place, with the wrong rule quoted below it so the error remains auditable; §7's verdict is marked superseded by §8 rather than erased.

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
| D-S5-16 | **Found in the closure pass.** Attribution used *database recording chronology* (`payment.created_at > promise.created_at`) instead of *business chronology* (`payment.paid_on >= promise.made_on`), and `promises` had no field recording when a commitment was actually made — so the row's insert timestamp stood in for a fact about the world. | executed §4.2 as shipped in migration 20 |
| D-S5-17 | **Found in the closure pass.** A correction event carried only free text in `promise_events.reason`; no column durably identified *which payments* caused a `BROKEN → KEPT`/`PARTIALLY_KEPT` change, so the evidence could not be re-checked after the text was read. | column inventory of `promise_events` before this pass (no `metadata` column existed; provenance was `reason text` alone) |
| D-S5-18 | **Found in the closure pass.** This report's header declared Stage 5 `IN PROGRESS` with an `ENDING SHA: _(filled at Phase 46)_` placeholder — the authoritative artifact of a delivered stage still said the stage was open, and pointed at a phase number that does not exist in any brief. | lines 5–7 of this file as committed at `ee4a589` |

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

### 4.2 PAYMENT ATTRIBUTION RULE — CORRECTED IN THE CLOSURE PASS

A payment counts toward promise `P` iff all of:

1. `payment.receivable_id = P.receivable_id`;
2. `payment.paid_on >= P.made_on` — the money is dated **on or after the business
   day the customer made the commitment**;
3. `payment.paid_on <= P.promised_date` — the money is dated **on or before the
   promised business date**.

`P.made_on` is a column on the promise, added by migration 21, supplied
explicitly by `create_promise(p_made_on)`, frozen by the history guard, and
checked `made_on <= promised_date` and not-in-the-future. Both bounds are
business dates, so the rule is a closed interval `[made_on, promised_date]` over
days. **`created_at` appears nowhere in attribution** — neither the payment's nor
the promise's. Recording order is not a fact about money or promises; it is a
fact about when a keyboard was used.

Consequences, stated because they are deliberate and each is tested:

* *Payment dated before the commitment was made* → **never counts**, no matter
  when it was typed. Money from last month cannot discharge a commitment made
  this week, and re-typing an old receipt after a promise is created does not
  make the promise `KEPT`.
* *Payment dated after `promised_date`* → reduces the balance and settles the
  invoice, but the promise stays `BROKEN`/`PARTIALLY_KEPT` (case G, and "full
  invoice payment after a promise deadline").
* *Payment dated on either bound* → counts. Days are inclusive. When
  `paid_on = made_on` the ledger genuinely cannot know the intra-day order, and
  no time-of-day column was invented for this repair; the ledger reads the
  customer's own date as saying "this is for that commitment". This is a stated
  tie-break, not a leftover ambiguity.
* *Multiple payments toward one promise* → summed, so `₹2,000 + ₹3,000` against a
  `₹5,000` promise is `KEPT` (case B).
* *Two promises whose intervals overlap* → a receipt inside both windows is
  credited to **both**. There is still no payment-allocation engine (§6), and the
  browser journey now uses non-overlapping days rather than relying on the
  accident of insert order.
* *A promise entered later, about a commitment made earlier* → graded from its
  own `made_on`, so back-dating a promise is impossible without the customer's
  actual date, and a late data-entry session cannot manufacture a `KEPT` from
  money that predates the commitment.
* No proxy on "receivable became `PAID`", no ratio, no first-in-first-out guess,
  no allocation of a payment across promises: the receivable's payments are the
  pool, and `paid_on` against `[made_on, promised_date]` decides membership.

`promised_date` and `made_on` are the promise's own facts; `QA` is computed,
never stored, and the reconciliation helper recomputes it on every pass so no
cached outcome can go stale (D-S5-2).

> **RETIRED — what this section said before the closure pass, and why it was
> wrong.** The rule as ratified and shipped in migration 20 was:
> `payment.created_at > P.created_at` **and** `payment.paid_on <= P.promised_date`,
> and same-day cases were said to be "resolved by `created_at`, which is a
> persisted microsecond timestamp, not by the calendar day". That made database
> recording chronology decide a business outcome (D-S5-16): the promise's
> `created_at` is the instant DueWeave happened to write the row, not the day the
> customer promised. Measured on the live 20-migration database, an ₹5,000
> receipt dated `2026-09-25` and recorded first, followed by a promise *made
> today* promising that same day, came back
> `EVIDENCE D-S5-16 yesterday: promise made today KEPT credit=500000 paid_on=2026-09-25`
> — a promise `KEPT` by money that existed before it was promised — and two
> promises created after one receipt both read
> `1:KEPT:credit=500000 2:KEPT:credit=500000`. Migration 20's file text is
> unmodified (historical migrations are never edited); migration 21 replaces the
> definitions, and the live/browser suites that had pinned the old reading were
> corrected alongside the SQL rather than left pinning a false rule.


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
| D | `pnpm test`, closure-pass tree | `352 passed \| 1 skipped (353)`, `17 passed \| 1 skipped (18)`, 49.17 s | none | clean |
| E | `pnpm test`, tree unchanged since D | `352 passed \| 1 skipped (353)`, `17 passed \| 1 skipped (18)`, 51.26 s | none | clean — **two consecutive full-suite clean runs on the final tree, no code or config change between them** |
| F | `pnpm test:e2e:eval e2e/stage3-local-isolation.spec.ts` (first attempt) | 3 of 5 failed: `stage3-local-isolation.spec.ts:114`, and `stage4-local-persistence.spec.ts:152` in the same battery | not PGRST303-from-the-API-client: the browser's `POST /rest/v1/rpc/mark_due_promises_broken` returned **401 `invalid_token`, `JWT issued at future`** from `postgrest/16.2`, 0.73 s after its own `POST /auth/v1/signup` → 200 | **Same infrastructure class as run A, observed through the browser path.** See the reconstruction below. |
| G | re-runs of the affected specs and the whole battery, unchanged tree | `stage3` 5 passed; battery `30 passed \| 2 skipped \| 0 failed` | none | clean — no retry, sleep, leeway or suppression was added between F and G beyond simply re-running |
| H | four Stage-family live files in one `vitest run`, immediately after the §8.6 zero replay | `2 failed \| 93 passed \| 110 skipped (205)` | `PGRST303 — JWT issued at future` at `tests/stage2-local-foundation.test.ts:52` (`:161` downstream), and `profile row missing for alpha: JWT issued at future` aborting Stage 3's bootstrap | **same class as A**, provoked by the container restart the replay required; Stage 4's and Stage 5's suites passed in this run (14 and 69) |
| I | `pnpm test` (full), post-replay, run 1 | `338 passed \| 15 skipped (353)`, `1 failed \| 16 passed \| 1 skipped (18)` | `AssertionError: alpha create_client failed: expected { code: 'PGRST303' … } to be null` at `tests/stage4-local-edit-workflows.test.ts:153` (the file's 14 tests then report as skipped) | **same class as A** — the first REST call after a minted token is rejected before any policy is consulted |
| J | `pnpm test` (full), post-replay, run 2, tree unchanged | `352 passed \| 1 skipped (353)`, `17 passed \| 1 skipped (18)`, exit 0 | none | clean |

Run F was investigated rather than re-run-and-forgotten, because "it passed the
second time" is not evidence. From the Playwright `trace.zip`, whose
`*.network` file was parsed by `_resourceType ∈ {fetch, xhr}`: the failing
request carried a token decoding to `iat = 1790414238` (`09:17:18` UTC),
`exp = iat + 3600`, `role = authenticated`, ES256. Kong logged the 401 at
`09:17:19.118`, and a *second* browser context's byte-identical POST at
`09:17:19.217` returned 200. Clocks measured immediately afterwards: host
`1790414394.49`, auth container `1790414395`, database container `1790414395`
(agreeing within `docker exec` latency), while `pg now()` read `1790414374.76`.
So this is sub-second jitter between the token-issuing and token-validating
clocks inside the local Docker VM — the identical rejection reason already
classified in run A — not a Stage 5 attribution, lifecycle or authorization
fault. It **fails closed**: the ledger never saw the request, no row moved, and
the RLS/authorization assertions were not exercised by it. Per this stage's
standing instruction, nothing was retried inside the test, no JWT leeway was
changed, no sleep or retry loop was added, and no production code masks it.

Nothing in the Stage 5 lifecycle families (cases A–G2, attribution and
chronology matrix, correction and its evidence, payment matrix, cancellation,
idempotency, parallel attacks, audit, browser journeys) ever failed for a reason
other than a genuine in-flight defect listed in §5.2 — including in runs H and I,
where the neighbouring Stage 2/3/4 files were the ones the token clock rejected
and Stage 5's 69 assertions still all passed.

Frequency, stated plainly because the last four rows might otherwise read as one
long clean streak: the class appeared in run A and again in runs F, H and I —
four occurrences across the stage. Every one of them coincided with an execution
that performs many signups within seconds (a full-suite run, a four-file live
run, or a multi-context browser battery), and the two most recent (H and I) were
taken immediately after the stack had been restarted for the §8.6 replay.
Nothing in a single-file, single-signup Stage 5 execution ever hit it.

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
   and the later one must be refused rather than serialised. The gap this left
   **was measured in the closure pass**: four live two-request races now exist —
   `cancel_receivable` against `record_payment` fired together (exactly one
   lands), money-first then cancellation, cancellation-first then money, and
   `cancel_promise` against `record_payment` — so the claim above rests on the
   lock, the executed refusals **and** those races, and §6 no longer lists the
   race as untested.
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
11. **`supabase db advisors --local` ran and its result is vacuous, so it is
    reported as "ran, nothing proven" rather than as a clean pass.** The command
    printed "No issues found", but `pg_extension` in this stack lists only
    `pg_stat_statements, pgcrypto, plpgsql, supabase_vault, uuid-ossp` — no
    advisor extension is installed — and every one of the 21 catalog matches for
    `%advisor%` is a `pg_catalog.pg_advisory_*` lock builtin. `-o json` emitted no
    JSON at all. There is therefore no local advisor engine to disagree with the
    "no issues" line, and no performance or security advice was actually
    collected. `supabase db lint --local`, which does inspect the schema,
    reported "No schema errors found" on the 21-migration database.
12. **The Stage 5 deadline browser journey was re-dated to non-overlapping
    business days (‑3, ‑2, ‑1) instead of stacking commitments on one day.**
    Root cause first: the spec failed with `Expected: "Promise broken" Received:
    "Partially kept"`, and the ledger was right — a ₹2,000 receipt dated the same
    day as a second promise sits inside that promise's `[made_on, promised_date]`
    window and is legitimately credited to it (§4.2). The SQL was not bent and no
    allocation heuristic was invented; the test's expectation encoded the retired
    recording-order rule, so the test was fixed. The brief for this pass asked
    for exactly that ("fix the implementation **and** the tests").
13. **Two live assertions and one browser assertion changed their expected
    values, and each changed toward less credit, not more.** `money paid before
    B was made cannot be credited to B` and `money dated before the promise was
    made is not that promise's money` now demand `0` where the old rule returned
    `500000`; the browser now expects `Promise broken` where the old rule said
    `Partially kept`. No denial, no status and no assertion was loosened to
    reach green, and Stage 3's isolation assertions were not touched.
14. **D-S5-17 has no captured live RED assertion, and is not presented as if it
    did.** Its evidence is structural and catalog-measured: before this pass
    `promise_events` had no `metadata` column at all (the only provenance on a
    correction was free text in `reason`), which is not something a behavioural
    test can assert against a database that lacks the column. The pgTAP file for
    the chronology contract did fail while being authored (`Failed test 19` in a
    229-assertion run, then a `Bad plan`, then `function is(information_schema.
    yes_or_no, text, unknown) does not exist` — all three are test-authoring
    errors against `information_schema` domain types, fixed by `::text` casts,
    not defects in the ledger). The green evidence for D-S5-17 is the executed
    metadata read-back in `phase 11: a correction event names the in-window
    receipts and nothing outside the window` plus its pgTAP column/constraint
    pins.

## 6. KNOWN LIMITATIONS

* The business date is `Asia/Kolkata` for every account, by design (§4.5), and
  `profiles.timezone` is now refused at the trigger. Multi-timezone tenants are
  therefore not supported; that is a product decision this stage makes
  explicit, not an oversight.
* `record_payment` attributing to the receivable's payment history (not to a
  specific promise row) means a customer who pays across two promises on one
  invoice cannot have those two promises graded against separate pots of money.
  §4.2's rule is honest about that and the alternative — inventing a per-promise
  split — was rejected as an untestable heuristic. The closure pass made the
  consequence of that choice explicit rather than accidental: **when two
  promises' `[made_on, promised_date]` windows overlap, one receipt inside both
  is credited to both**, and both can reach `KEPT` on the same money. That is
  why the browser journey dates its commitments on separate days, and why an
  owner who wants two promises graded independently must make them date
  independently. A payment-allocation engine remains out of scope for this
  stage.
* Every `promises.made_on` on a pre-closure row was backfilled as
  `least((created_at at time zone 'Asia/Kolkata')::date, promised_date)`. That
  is **compatibility metadata, not proof**: it is the day the row happened to be
  typed, clipped so no legacy promise's window starts after its own deadline
  (which would have silently turned old `KEPT` rows into `BROKEN`). New promises
  carry a customer-stated date. Anyone reading reliability on a ledger that
  mixes both must treat the pre-closure rows' windows as recorded dates, not as
  asserted history.
* Cancellation carries no client-supplied concurrency token (§5.7 item 2). Its
  safety rests on the receivable row lock, the executed state refusals, and — as
  of the closure pass — four measured two-request races against
  `record_payment` and `cancel_promise`, each ending in exactly one recorded
  outcome. What is *not* claimed is a client-visible conflict prompt: a losing
  caller receives a refusal, not a merge dialog.
* Reliability needs at least one outcome-bearing promise. The empty case reads
  "Not enough history" instead of `0 of 0`.
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
* pgTAP's `plan(37)` covers catalog facts plus a bounded executed sample; the
  exhaustive behaviour matrix lives in the live suite, which requires the local
  stack. `pnpm test:db` alone does not prove §4.1's table.
* The concurrency proofs are two-writer attacks on a local single-node Postgres.
  They pin lock order and outcome determinism; they are not a claim about
  multi-region or connection-pool-retry behaviour, which this project does not
  have.
* `created_at` was removed from the money rule, not from the product: it is still
  written, still frozen with the rest of a promise's history, and still the
  honest answer to "when did I type this in". What it can no longer answer is
  "when did the customer promise" and "was this receipt that promise's money" —
  which is what D-S5-16 was.
* No Supabase performance or security advisor engine exists in the local stack
  (§5.7 item 11), so this stage has **no** advisor-derived evidence in either
  direction. `db lint` is the only static schema check that actually ran with
  something to inspect; a hosted-project advisor pass, if one is ever wanted, is
  a remote action this stage was explicitly forbidden from taking.

## 7. FINAL CURRENT-ROADMAP STAGE 5 VERDICT

> **SUPERSEDED by §8 — kept in place because it is the record of what was
> believed at `ee4a589`, not evidence.** Three of this section's claims did not
> survive the closure pass. (a) "attribution … removed with a measured
> RED→GREEN" was **premature**: the rule that replaced Stage 4's was itself wrong
> (D-S5-16, §4.2 as-retired), so Stage 5's attribution is only true as of §8.
> (b) "advisors are clean" overstates a command that ran against a stack with no
> advisor engine (§5.7 item 11). (c) "replays from zero through 20 migrations"
> and the Stage 4 live count "(12 / 110 / 16 browser)" are the counts of the
> previous tree; §8 carries the current ones (21 migrations, and a larger
> browser set). Everything else in this section still reads true.

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

## 8. CLOSURE PASS — PROMISE CHRONOLOGY + EVIDENCE (continuation of Stage 5, from `ee4a589`)

This section is the record of the closure pass, which continued from the pushed
Stage 5 HEAD `ee4a5894e8ca0938e1b5589c84ee6b0a88121ae9` instead of restarting the
stage. Nothing in §1–§7 was rewritten except where a claim was demonstrably
false (§4.2, §5.7 item 2's unmeasured gap, §7's superseded verdict), and no
earlier RED evidence was erased.

### 8.1 What was actually wrong, and what replaced it

| id | Reproduced before fixing | Replacement |
| --- | --- | --- |
| D-S5-16 | Attribution keyed on `payment.created_at > promise.created_at`, and `promises` had **no** column for the day the commitment was made. Two live tests failed on the 20-migration database with `AssertionError: money paid before B was made cannot be credited to B: expected 500000 to be +0` and `money dated before the promise was made is not that promise's money: expected 500000 to be +0`, printed as `EVIDENCE D-S5-16 cross: 1:KEPT:credit=500000 2:KEPT:credit=500000` and `EVIDENCE D-S5-16 yesterday: promise made today KEPT credit=500000 paid_on=2026-09-25` (`Tests 2 failed \| 48 skipped (50)`). | `promises.made_on date not null` + CHECK `made_on <= promised_date`, an explicit `p_made_on` parameter on a 7-argument `create_promise`, and `promise_settled_amount` / every reconciliation branch reading `payment.paid_on between promise.made_on and promise.promised_date`. `created_at` is used nowhere for attribution. |
| D-S5-17 | `promise_events` had no column that could name the evidence; a correction's entire provenance was one free-text `reason`. (Structural evidence — see §5.7 item 14, which is explicit that no live RED assertion exists for this id.) | `promise_events.metadata jsonb` (CHECK `jsonb_typeof = 'object'`) written only by the correction path as `{reason_type: 'historical_payment_evidence', payment_ids: […], payments: [{id, paid_on}, …]}`, frozen by the same history guard that freezes status, and read back by a live test that asserts the named ids are exactly the in-window receipts and excludes the out-of-window one. |
| D-S5-18 | This file's own header: `Status: **IN PROGRESS**` and `ENDING SHA: _(filled at Phase 46)_`, pointing at a phase number no brief contains. | Header rewritten with both starting SHAs (stage base and this pass), a status line, and an honest ENDING-SHA treatment (§8.5). |

Two further defects the closure pass found while it was in the file, and closed:

* `cancel_receivable` / `cancel_promise` were never raced against
  `record_payment` (§5.7 item 2's admitted gap). Four live races now exist and
  all end in exactly one recorded outcome: fired simultaneously (one lands, the
  other is refused), money-first, cancellation-first, and promise-withdrawal
  against a payment.
* Tests that had pinned the retired recording-order rule. Two live assertions and
  one browser journey expectation were corrected (§5.7 items 12–13). The
  browser's deadline story now dates its three commitments on days ‑3, ‑2 and
  ‑1, because overlapping windows legitimately double-credit one receipt and the
  story is about dates, not about allocation.

### 8.2 Gate results on the final tree

| Gate | Measured |
| --- | --- |
| Zero replay `supabase stop` → `start` → `pnpm db:reset:local` | 21 × `Applying migration`, zero error lines — full detail in §8.6 |
| Migration count on the executed database | **21** files in `supabase/migrations/`, last one `20260815100000_current_stage5_promise_chronology.sql`; **0 historical migrations modified** |
| `pnpm test:db` | `Files=5, Tests=229 … Result: PASS` — up from `Files=3, Tests=143` at the §1 baseline; the new file is `supabase/tests/stage5_02_promise_chronology.sql` |
| Stage 5 live (`tests/stage5-local-lifecycle.test.ts`) | **69 passed** (1 file, 48.12 s) — 50 before this pass |
| Stage 2 / Stage 3 / Stage 4 live | **12** / **110** / **21** passed (Stage 4 is 2 files) — Stage 4 went 16 → 21 as its fixtures followed the new `create_promise` signature |
| `pnpm test` (full), run 1 | `17 passed \| 1 skipped (18 files)`, **352 passed \| 1 skipped (353)**, 49.17 s |
| `pnpm test` (full), run 2, tree unchanged | same counts, 51.26 s — **two consecutive clean full-suite runs with no change between them** |
| `pnpm test` (full), re-run after the §8.6 replay | run 1 `338 passed \| 15 skipped (353)` with one `PGRST303` bootstrap failure (§5.6 run I); run 2 on the unchanged tree **`352 passed \| 1 skipped (353)`**, exit 0. The two clean runs above were measured before the replay; after it the suite is one-failed-then-clean, and the failure is the token-clock class, not a lifecycle assertion. |
| Stage 5 browser | **14 passed** (2.3 m) |
| Browser battery Stage 2 / 3 / 4 / 4.1 / 5 | **30 passed, 2 skipped, 0 failed** (2.9 m); the 2 skips are Stage 4.1's fixture-gated spec |
| Generated types | `pnpm db:types` twice → identical `sha1 2bbc574a55156be08d1649a2f74fce6c1643e362`, and the file differs from HEAD only by the new `made_on` / `metadata` / 7-arg `create_promise` surface |
| `pnpm install --frozen-lockfile` | clean, lockfile untouched |
| `pnpm lint` / `pnpm check` | clean, `--max-warnings=0` |
| `pnpm build` | built (5.01 s, 4.48 s) |
| `pnpm audit --prod --audit-level=high` | `No known vulnerabilities found` |
| `supabase db lint --local` | `No schema errors found` |
| `supabase db advisors --local` | **ran, result vacuous** — no advisor extension installed; see §5.7 item 11 |
| Secret / artifact audit | only `.env.example` is tracked; `.env.local`, `dist/`, `node_modules/`, `supabase/.branches/`, `supabase/.temp/`, `test-results/` are ignored; no secret patterns in the diff; the two new files are clean |

Measurement order, so no row reads as stronger than it is: the browser rows and
the first two full-suite rows were taken on the pre-replay database, which was
built from the same 21 migrations and the same tree (only this file changed
afterwards); §8.6 re-measured types, pgTAP, the four live families and the full
suite on a from-zero database.

### 8.3 RPC and security posture delta

`create_promise` went from six arguments to seven (`p_made_on date` added). It
keeps `SECURITY DEFINER`, `SET search_path = public, auth, pg_temp` on the
browser-facing routines and `search_path = ''` on the internals, and the
`authenticated`/`anon` EXECUTE grants are unchanged in kind: the browser can call
the same lifecycle surface it could before, and `reconcile_promise_outcome`,
`settle_owner_promises`, `apply_promise_outcome` and
`promise_settled_amount` remain ungranted and unreachable from PostgREST. pgTAP
pins the signatures, the definer/transform-flags shape and the absence of
grants rather than trusting the migration text, so a silent widening of any of
these fails `pnpm test:db`. Stage 3 isolation was not touched and still passes
(5 browser journeys, 110 live assertions).

### 8.4 What this pass deliberately did not do

No Stage 6 work, no new product feature, no hosted Supabase project, no
`supabase link`, no `db push`, no `--linked`, no deployment, no payment
activation, no PR created, no merge, no change to `main`, no edit to any
historical migration, no `service_role` in any browser test, no weakened
denial, no PGRST303 masking (no retry, sleep, leeway or suppression), no amend
of `ee4a589`, no force-push.

### 8.5 On the ENDING SHA

The closing commit is one forward commit on top of `ee4a589` containing the 16
paths this pass touched. A commit cannot record its own hash, and Stage 5
history was not rewritten to embed one, so the ending SHA is reported from the
push output in the final block and is the value of `git rev-parse HEAD` on
`current-stage-5-lifecycle-correctness` at delivery.

### 8.6 Zero replay, measured for this section

`pnpm supabase:stop` → `pnpm supabase:start` → `pnpm db:reset:local` on the final
tree printed `Applying migration` exactly **21** times, the last one
`20260815100000_current_stage5_promise_chronology.sql`, with **no** error or
failure line in the reset log. Against that freshly built database:

* `pnpm db:types` produced `sha1 2bbc574a55156be08d1649a2f74fce6c1643e362` —
  identical to the value recorded in §8.2, which was taken before the replay, so
  the generated types are reproducible across a from-zero build and not just
  within one container lifetime;
* `pnpm test:db` re-ran as `Files=5, Tests=229 … Result: PASS`;
* each Stage-family live suite re-ran individually green: **12** (Stage 2),
  **110** (Stage 3), **14** (`tests/stage4-local-edit-workflows.test.ts`; Stage
  4's second live file, `stage4-local-repository-edit.test.ts`, carries the
  other 7 of the 21 in §8.2) and **69** (Stage 5).

Re-running the four live files *together* in one `vitest run` immediately
afterwards failed with `2 failed | 93 passed | 110 skipped (205)` — and the two
failures were the documented infrastructure class, verbatim:
`AssertionError: expected { code: 'PGRST303', …(3) } to be null` /
`"message": "JWT issued at future"` at `tests/stage2-local-foundation.test.ts:52`
with `:161` downstream of it, and `Error: profile row missing for alpha: JWT
issued at future` aborting Stage 3's bootstrap (which is why its 110 tests
report as skipped rather than failed). Stage 4's and Stage 5's suites — the ones
this pass exists for — passed in that same run, 14 and 69. This is §5.6's
recurring local-VM token-clock skew, newly provoked by the container restart the
replay required, and it is reported rather than re-run away: §8.7 records the
full-suite re-runs performed after it.

### 8.7 VERDICT — CURRENT ROADMAP STAGE 5, AFTER THE CLOSURE PASS

**PASS, with the caveats below stated as part of the verdict rather than after
it.** Every defect §3 lists — D-S5-1 … D-S5-15 from the original pass, and
D-S5-16/17/18 from this one — is closed against the executed 21-migration
database, with a measured before/after where a behavioural reproduction was
possible (D-S5-16) and a catalog/structural proof where it was not (D-S5-17).
Money is now attributed by what the customer said with dates — the receipt's
`paid_on` against the commitment's own `[made_on, promised_date]` interval — and
never by the accident of when a row was typed; a correction carries the ids of
the receipts that caused it; and both are pinned at the database, in the live
suite, in the domain layer and in the browser.

This is a **stronger** claim than §7's, in one respect and a weaker claim in
another, and both directions are disclosed: stronger because §7's "attribution"
bullet was resting on a rule this pass proved false; weaker because §7 said
"advisors are clean" on the strength of a command that had no engine behind it
(§5.7 item 11), and nothing in this pass gave that claim an engine.

Caveats that travel with the PASS, all of them in §6 or §5.7: overlapping
promise windows double-credit one receipt (no allocation engine, by design);
legacy `made_on` values are compatibility metadata, not asserted history;
`supabase db advisors` is vacuous locally; the local Docker VM's token-clock skew
is **not** cured — it rejected freshly minted tokens four times across the stage
(§5.6 runs A, F, H, I), twice in the executions taken straight after the §8.6
replay, and in every one of those runs the ledger never saw the request, no row
moved, and nothing was retried, slept, leewayed or masked to get past it; and one
real UI defect (sonner's toast stack covering the header's primary action) was
found and deliberately left for Stage 6.

**NEXT RECOMMENDED ROADMAP STAGE: Stage 6 — Production UX. Not started.**
