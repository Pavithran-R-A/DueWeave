# Stage 9 PHASE 11 — validation / abuse matrix

The brief for this phase lists twenty public-input abuses and then two rules about how
the product must answer: failures stay in calm product language, and no raw `PGRST`,
`SQLSTATE`, constraint name, table name, policy or stack trace reaches the user.

This page is the ledger for that list. It records, per item, the test that actually
reaches the failure and the classification of where it runs. It is written from the
files as they stand at this commit, with every citation re-opened before being quoted;
a claim with no test behind it is recorded as a gap, not as coverage.

Classifications:

- **LIVE** — a file in `databaseSuites` (`tests/suite-manifest.ts`), run by
  `pnpm test:live` / `pnpm verify:release:local`, against the local Supabase stack over
  the browser role and the anon key. This is the only class that can prove a database
  refusal.
- **UNIT** — run by `pnpm test:unit` with no client and no container.
- **E2E** — a Playwright spec under `e2e/`, driven through the real UI.
- **DB** — a pgTAP file under `supabase/tests/`, run by `pnpm test:db`
  (`supabase test db`), which `verify:release:local` reaches through
  `verify:db:local` after a `db:reset:local`. These assert catalog facts — a `CHECK`
  definition, a routine's source, an ACL — so they pin the *rule*, not the answer a
  browser receives.

## Catalog-level pins, per item

The LIVE column above is what a user sees. These are the pgTAP assertions that hold the
same rules one layer down, so a migration that quietly relaxes a guard fails there even
if no abuse test was changed:

| Item | pgTAP pin |
|---|---|
| 1, 2 (negative / zero paise) | `supabase/tests/stage5_01_lifecycle.sql:124` pins `payments_amount_paise_check` as `CHECK (amount_paise > 0 AND amount_paise <= 900000000000000)` and `:129` the promise twin; `:108` pins `receivables_financial_state_check` as the whole legal balance-versus-status space |
| 6 (promise chronology) | `supabase/tests/stage5_02_promise_chronology.sql:170`, `:174`, `:178` require those three sentences to be inside `create_promise`'s own source, and `:197` that the origin-less signature is dropped rather than left as an overload |
| 10, 19, 20 (foreign id, reviewer RPC, anonymous RPC) | `supabase/tests/stage3_02_privileges.sql:113` ("anon can execute no public function, so no RPC is reachable anonymously") and `:137` ("authenticated can execute exactly the 24 RPCs the application calls"); `supabase/tests/stage3_01_rls_structure.sql:185` anchors every browser-executable writing `SECURITY DEFINER` routine to an owner check |
| 11 (oversized text) | `supabase/tests/stage8_01_offer_readiness.sql:158` refuses an over-long VPA "rather than truncat[ing] [it] into something payable"; `supabase/tests/stage8_02_payment_evidence.sql:43` pins the reference and payer-name length bands into the claim's state `CHECK` |
| 15 (Unicode whitespace) | `supabase/tests/stage8_01_offer_readiness.sql:384`, `:387`, `:390` pad a valid VPA with tab/space and with NBSP and zero-width, the last with the comment that JavaScript keeps U+200B too — "so the class was matched to the client and not widened past it"; `:292` and `:323` prove a tab-only payee name and a tab-only refund policy stay *storable*, which is what makes the readiness layer the only place they can be caught |
| 16, 17 (malformed VPA, placeholder support) | `supabase/tests/stage8_01_offer_readiness.sql:355` onward stores `not-a-vpa`, `a@b`, `merchant@`, `@upi`, `x@y@z` against a `LIVE` destination and refuses them at `create_founder_claim` / `submit_founder_payment`; `:398` onward does the same for the shipped support placeholder; `:478` measures `42501` for a direct call under the same probe |
| 18 (duplicate UTR) | `supabase/tests/stage8_02_payment_evidence.sql:31` pins the five-state claim vocabulary, `:39` that no stored state spells a payment as made, and `:43` that a claim which has reached review carries a real reference and payer name |

## The matrix

| # | Public input | Where it is proven | Class |
|---|---|---|---|
| 1 | negative paise | `tests/stage5-local-lifecycle.test.ts:499` (row "negative amount", inside "refuses every invalid payment payload and writes nothing (phase 10)" at `:493`); `tests/stage2-local-foundation.test.ts:105` (direct browser write) | LIVE |
| 2 | zero paise where invalid | `tests/stage5-local-lifecycle.test.ts:498` and `:500` (rows "zero amount", "no amount"); `tests/stage2-local-foundation.test.ts:91` ("rejects a non-positive receivable amount at the database boundary") | LIVE |
| 3 | overpayment | `tests/stage5-local-lifecycle.test.ts:506` (row "more than the remaining balance"); `tests/stage5-local-lifecycle.test.ts:541` ("settles an invoice exactly and then refuses further money (phase 10, phase 12)") | LIVE |
| 4 | future payment date | `tests/stage5-local-lifecycle.test.ts:504` (row "payment dated in the future"), `:505` (row "no payment date"); the date-shaped refusals are also measured on the wire in `tests/stage9-abuse-matrix.test.ts:387` | LIVE |
| 5 | invalid payment method | `tests/stage5-local-lifecycle.test.ts:502` and `:503` (rows "unknown payment channel", "no channel at all") | LIVE |
| 6 | invalid promise chronology | `tests/stage9-abuse-matrix.test.ts:387` ("holds the promise window open on the server, not only in the form"); `tests/stage5-local-lifecycle.test.ts:1360` ("phase 10: refuses a replacement promise dated before the promise it replaces"); per-case UI wording `e2e/stage6-local-forms.spec.ts:129` ("puts every promise refusal on the field it belongs to") | LIVE + E2E |
| 7 | malformed UUID / request id | `tests/stage9-abuse-matrix.test.ts:281` ("refuses every malformed id on the ledger's write surface, without naming internals") — 14 literal shapes driven into 11 id slots; `tests/stage9-abuse-matrix.test.ts:328` (the same shapes inside a REST filter) | LIVE |
| 8 | idempotency conflict | `tests/stage5-local-lifecycle.test.ts:786`, `:810` (same request id re-used for a different payload), `:838` (through the repository the browser uses), `:937` (one id submitted twice concurrently replays to one payment); `tests/stage9-abuse-matrix.test.ts:316` (a rejected payment does not consume the next key), `tests/stage9-abuse-matrix.test.ts:367` (a nil request id is refused as the owner-scoped token it is) | LIVE |
| 9 | stale edit token | `tests/stage4-local-edit-workflows.test.ts:244`, `:382`, `:401` (no token at all); `tests/stage4-local-repository-edit.test.ts:148`; `tests/stage6-local-profile.test.ts:134` | LIVE |
| 10 | foreign record id | `tests/stage9-abuse-matrix.test.ts:296` ("answers a neighbour's real id with the same words as an id that exists nowhere"); `tests/stage5-local-lifecycle.test.ts:509` (row "a receivable that is not this account's"); `tests/stage3-local-rls.test.ts:951`, `:1072`, `:1179`, `:1418`, `:1456`, `:1504`; `e2e/stage9-account-isolation.spec.ts:454` ("the other account's rows cannot be created, patched, or paid into") | LIVE + E2E |
| 11 | oversized text | `tests/stage5-local-lifecycle.test.ts:507` and `:508` (rows "reference over 160 characters", "note over 2,000 characters"); `tests/stage4-local-edit-workflows.test.ts:296` (161-character name, 2,001-character notes); `tests/stage6-local-profile.test.ts:152` (business name beyond the real column CHECK); `tests/stage8-local-founder-readiness.test.ts:755` (65-character reference, 121-character payer name); `tests/ledger-search.unit.test.ts:148` (a 10,000-character query) | LIVE + UNIT |
| 12 | malformed phone | `tests/stage4-local-edit-workflows.test.ts:296` ("a five-digit phone is refused" via `update_client`); `tests/stage9-abuse-matrix.test.ts:444` drives the create verbs live — three refused shapes, an accepted digit-free control, and the composite verb the Add-receivable form calls | LIVE |
| 13 | search abuse strings | `tests/ledger-search.unit.test.ts:148`, `:158`, `:169` (the control that keeps the first two from being vacuous); `e2e/stage9-account-isolation.spec.ts:562`; `e2e/stage9-release-journey.spec.ts:347` | UNIT + E2E |
| 14 | formula-like CSV text | `tests/stage7-data-export.unit.test.ts:261` (`=`, `+`, `-`, `@`, whitespace-prefixed), `:270` (quoted `=HYPERLINK`), `:274` (tab/newline-hidden marker), `:281` (text that merely contains a marker is left alone); `:235` (a typed leading space is kept rather than stripped); `tests/stage7-local-export.test.ts:292` reads the sheets back from live rows | UNIT + LIVE |
| 15 | Unicode whitespace edge cases | `tests/stage8-local-founder-readiness.test.ts:619` and `:635` (thirteen padding classes — tab, space, newline, NBSP, Ogham, en-quad, hair space, U+2028/29, narrow no-break, medium mathematical, ideographic, BOM — each padded around a valid Founder config that must still read ready); `:530` (zero-width space welded to a VPA is malformed at both boundaries); `:572` (five NBSPs as a support contact → unusable, not a published contact); `tests/stage6-local-profile.test.ts:159` (ledger names are trimmed); `tests/stage7-data-export.unit.test.ts:243` (Tamil, Hindi, accented names survive); `tests/stage9-abuse-matrix.test.ts:488` (the ledger's six required-field verbs, each blank-tested live against all twenty-five characters `trim()` removes, plus the composite verb the Add-receivable form calls); `tests/ledger-blank-class.contract.test.ts` (the two boundaries hold one class, and it is the browser's class no wider) | LIVE + UNIT |
| 16 | malformed Founder VPA | `tests/stage8-local-founder-readiness.test.ts:530` (eight shapes, each stored and then refused by `create_founder_claim` / `submit_founder_payment`, not only in the client) | LIVE |
| 17 | Founder placeholder support | `tests/stage8-local-founder-readiness.test.ts:572` (the shipped column default, padded, tabs, two characters, NBSPs — refused while its status reads `CONFIGURED`); `tests/stage8-local-founder-readiness.test.ts:444` ("opens the gate only through the trusted local configuration path") | LIVE |
| 18 | duplicate UTR | `tests/stage8-local-founder-readiness.test.ts:820` ("races two accounts on one reference and accepts exactly one"), `:843` (refused across accounts and after a rejection); `tests/stage8-founder-contracts.test.ts:225` (the duplicate-reference rule as a contract) | LIVE + UNIT |
| 19 | customer calling reviewer RPC | `tests/stage3-local-rls.test.ts:1383` ("a signed-in non-admin cannot reach the review RPC ${probe.fn}"), `:1418` (cannot enroll itself as reviewer); `tests/stage8-local-founder-readiness.test.ts:974` ("refuses every reviewer RPC to an ordinary account and leaks nothing"); `:1004` (the reviewer sees the pending fields and nothing else); `e2e/stage9-account-isolation.spec.ts:531` | LIVE + E2E |
| 20 | unauthenticated direct RPC | `tests/stage3-local-rls.test.ts:1737`, `:1859`, `:1880` (internal helpers are not callable); `tests/stage4-local-edit-workflows.test.ts:282`, `:464`; `tests/stage2-local-foundation.test.ts:142`; `tests/stage5-local-lifecycle.test.ts:448` (the internal calendar helper is out of the browser's reach); `tests/stage7-local-export.test.ts:396` ("asks for a live session before it reads a single row") | LIVE |

## The two rules about answers, not requests

**Calm product language.** `tests/stage6-error-copy.test.ts:109` feeds the provider's
own measured strings through the repository layer and asserts the reader gets the
product's sentence. Three of the strings in that list were measured by this phase's own
battery rather than transcribed:

- `22P02` — `invalid input syntax for type uuid: "'); DROP TABLE payments; --"`
- `42883` — `operator does not exist: uuid ~~ unknown`
- `42501` — `permission denied for table receivables`, whose hint reads `Grant the
  required privileges to the current role with: GRANT INSERT ON public.receivables TO
  authenticated;`

The third is the case that makes the assertion worth having: it is the only refusal in
this phase's battery whose text is addressed to an operator, and `hint` is what carries
it. `userFacingDataError(message?: string, code?: string)`
(`client/src/data/supabase-adapters.ts:77`) structurally cannot receive `details` or
`hint` — every repository call site passes `error.message` and `error.code` and nothing
else — and an unrecognised message falls back to "We could not save that change. Please
try again." (`:143`). That the fallback actually fires for this class of refusal is
already proven at the unit level: `client/src/data/supabase-adapters.test.ts:165` ("keeps
a server-side refusal in the calm fallback instead of quoting it") feeds it
`permission denied for table clients`, an RLS-violation sentence and a duplicate-key
constraint, each with code `42501`. What this phase added is the live-measured strings, so
the unit test is asserting sentences the database really says rather than invented ones.

The drop was falsified, not assumed: the mapping was temporarily widened to pass `details`
and `hint` through as well, `pnpm test:unit` reported 9 failures in
`tests/stage6-error-copy.test.ts`, and the change was reverted.

**No internal language.** `tests/stage9-abuse-matrix.test.ts` scans every refusal it
books against `/receivables|payments|promises|clients|activities|profiles|founder_|
owner_id|request_id|client_id|promise_id|row-level|policy|constraint|relation|GRANT|
PGRST|SQLSTATE|schema cache|stack|traceback|at line|near line|datestyle/i`, after
removing the caller's own literal (a parse error quotes it, so without that step the
SQLi payload would fail the scan for the wrong reason).

One exception is declared rather than smoothed over: `2026-13-45` is refused with
`22008` and the Postgres hint `Perhaps you need a different "datestyle" setting.` That
sentence is provider advice, it is measured, and the scan asserts it is *present* before
excluding it — so the exclusion cannot survive the change that removed it. It is excluded
from the wire-level scan only; `tests/stage6-error-copy.test.ts` still proves the reader
never sees it.

## What this phase added, and what it corrected

- `tests/stage9-abuse-matrix.test.ts:387` — the promise-window guard in the Stage 5
  migration (`supabase/migrations/20260815100000_current_stage5_promise_chronology.sql:468`,
  `:471`) had never been reached over the wire. Two accepted controls (a same-day promise,
  because the guard compares with `>`; and `+3 days`) precede two refused shapes and a
  five-shape date-literal table.
- Date refusals were measured, not assumed: `not-a-date`, `""` and `" "` are `22007`;
  `2026-13-45` and `2026-02-30` are `22008`. Folding them into one expected code was
  rejected — it would let a genuine parse change hide behind a passing suite.
- `tests/stage2-local-foundation.test.ts:105` was renamed. Its title claimed a rejection
  of a negative receivable amount; what it now measures — and says it measures — is the
  Stage 3 privilege wall (`42501`, pinned in the assertion). The amount rule is proven
  once, from `:91`, through the RPC the product actually uses.
- `tests/stage6-error-copy.test.ts` gained the three measured strings above and a wider
  `technicalLanguage` list (`permission denied|operator does not exist|invalid input
  syntax|uuid|\b22P02\b|\b42883\b`), because `not.toContain(message)` only proves the
  whole sentence is absent while a reader is equally leaked to by half of it.
- `e2e/stage9-release-journey.spec.ts` lost two helpers that no test called.

## Residual gaps, recorded rather than papered over

1. ~~**Malformed phone is proven on the edit path only.**~~ **Closed in Arc 2 Phase 2.**
   `tests/stage4-local-edit-workflows.test.ts:296` applies the create-path rules to
   `update_client`, including the five-digit phone, but no LIVE test drove
   `create_client` with a malformed phone. The client-side form is covered by
   `e2e/stage6-local-forms.spec.ts`; the database path for the create verb is not.
   `tests/stage9-abuse-matrix.test.ts` now drives the create verbs live, with the rule
   read out of `assert_stage3_client_input`
   (`supabase/migrations/20260812170000_stage3_core_workflows.sql`) rather than
   invented: strip to digits and a leading plus, then require 10 to 15 digits to be a
   phone at all. Measured against the local stack, that rule already holds on creation,
   so no product change was needed and none was made — the gap was evidence, not a
   defect. Two consequences the suite pins because a reader would not guess them: input
   carrying no digits (`"call me later"`) is treated as "leave it blank" and is stored
   as NULL, while a lone `"+"` is phone-shaped input with too few digits and is refused.
   `12345`, `1234567890123456`, `"+"` and the same five-digit phone through the
   composite verb the Add-receivable form calls are all refused with `P0001` and the
   words "Add a valid phone number or leave it blank"; the refused composite left no
   receivable, and the two accepted controls left exactly two client rows.
2. ~~**Unicode whitespace is proven on Founder fields, not on free-text ledger fields.**~~
   **Closed in Arc 2 Phase 2, with a product change.** The Founder padding matrix
   (`tests/stage8-local-founder-readiness.test.ts:619`, `:635`) covered `upi_id`,
   `payee_name` and `support_contact`; `tests/stage6-local-profile.test.ts:159` proved
   ledger names are trimmed only against ASCII spaces. Reading the ledger's own verbs
   showed why that mattered: `btrim(x)` with no second argument strips the ASCII space and
   nothing else, so `assert_stage3_client_input(E'   ', …)` refused while
   `E'\t\t'`, `E'\u00a0\u00a0'` and `E'\u3000'` were accepted — every character the form's
   own `!value.trim()` guard refuses. The load-bearing fields were not the names but the
   reasons: `cancel_receivable` writes its reason into `activities.note` and into the
   promise outcome, so an invisible reason authorised a cancellation and then entered
   itself into the owner's history as the explanation for it.
   One rule now holds at both boundaries, in
   `supabase/migrations/20261004170000_current_arc2_ledger_required_blank_class.sql`:
   **a ledger field the product requires is blank when it is empty after trimming the
   characters the browser trims.** Edge-trim only, matched to `trim()` rather than widened
   (U+200B stays significant at both boundaries), on the five required sites — client name
   on both verbs, receivable label on both verbs, both cancellation reasons. The optional
   ledger text (`p_company`, `p_email`, `p_notes`, `p_invoice_ref`, `p_source`, `p_method`,
   `p_reference`) is deliberately unchanged: nothing reads those bytes, so widening them
   would rewrite values the product never claimed to normalise. `create_client`,
   `update_client` and the composite verb delegate to `assert_stage3_client_input`, so no
   separate edit was needed and the composite inherits the rule — which the suite proves
   rather than assumes. `tests/stage9-abuse-matrix.test.ts:488` drives 160 blank probes
   live (25 classes × 6 verbs, plus the composite) against real-content controls, and
   `tests/ledger-blank-class.contract.test.ts` pins the class equality in both directions
   so one boundary cannot be edited without the other again.
   Writing the migration produced a second finding, recorded here because it will bite the
   next one too: Stage 3's fail-closed `ddl_command_end` trigger strips `authenticated`
   EXECUTE from any routine the moment it is redefined, so replacing four browser-callable
   verbs without re-granting them took those RPCs away from the application — measured as
   `permission denied for function create_receivable` in the live suite and as the 24-RPC
   set assertion in `supabase/tests/stage3_02_privileges.sql:137`. The migration now
   re-grants explicitly, the way Stages 4, 5 and 8 each had to.
3. **The abuse battery does not attack the Founder reviewer RPCs.** Their arguments are
   checked against the caller's authority before their shape, so a refusal there would
   be indistinguishable from a format refusal. Stage 3 `:1383` and Stage 8 `:974` own
   that surface, and this split is stated in the suite's own comment rather than left to
   inference.
4. **`scripts/*.mjs` are outside the lint path** — recorded under the release-gate
   work (`tests/suite-manifest.ts` split), not fixed here.

## Measured, this commit

- `tests/stage9-abuse-matrix.test.ts`: 7 tests, all passing; 216 probes booked in the
  ledger the suite writes to `test-results/stage9-abuse-matrix.json` — 194 refused,
  8 accepted (the controls), 2 unchanged, 12 observed. Codes: `22P02` ×152,
  `P0001` ×25, `P0002` ×6, `22007` ×6, `22008` ×4, `42883` ×1, plus the identity and
  wording assertions.
- Re-measured in Arc 2 Phase 2, after gap 1 closed: the same file is 8 tests, all
  passing, and the ledger it writes now books 222 probes — 198 refused, 10 accepted,
  2 unchanged, 12 observed, with `P0001` at ×29. The 6 probes gap 1 added are 2 accepted
  controls and 4 `P0001` refusals, all worded "Add a valid phone number or leave it
  blank".
- Re-measured again in Arc 2 Phase 2, after gap 2 closed: the file is 9 tests, all
  passing, and the ledger books 392 probes — 358 refused, 20 accepted, 2 unchanged,
  12 observed. Codes: `22P02` ×152, `P0001` ×189, `P0002` ×6, `22007` ×6, `22008` ×4,
  `42883` ×1. Gap 2 accounts for the 170 new probes exactly: 160 refusals (the 25
  whitespace classes driven into each of the six required-field verbs — 150 — plus 10
  through `create_client_and_receivable`) and 10 accepted probes (the six
  "takes real content" controls, the composite control, and the three boundary pins that
  a zero-width pad, an NBSP-padded name and NBSP notes are still stored). `P0001`
  therefore rose from ×29 to ×189; nothing else moved.
- `tests/ledger-blank-class.contract.test.ts`: 5 tests, all passing, with no client and
  no container — it compares the trimmed class between the two migration boundaries and
  against the JavaScript `trim()` set, and pins the four re-grants.
- `tests/stage2-local-foundation.test.ts`: 12 tests passing after the rename and the
  `42501` pin (2.10 s).
- `tests/stage6-error-copy.test.ts`: 14 tests passing.
- `pnpm test:db` (pgTAP, 8 files): 364 assertions, `Result: PASS`.
- Full gate set after these changes: `pnpm check` clean, `pnpm lint` clean, `pnpm
  test:unit` 20 files / 337 tests, `pnpm test:live` 9 files / 307 tests (188.55 s).
  Those are the Stage 9 phase-11 figures, kept as the record for that commit; the same
  gates re-measured at the Arc 2 Phase 2 gap-2 head are wider because the suites grew:
  `pnpm check` clean, `pnpm lint` clean, `pnpm test:unit` 30 files / 409 tests (27.98 s),
  `pnpm test:live` 9 files / 309 tests (201.29 s), `pnpm test:db` 8 files / 364
  assertions `Result: PASS`, `pnpm db:lint` "No schema errors found", `pnpm verify:types`
  "matches the local schema (38326 bytes)", `pnpm verify:migrations` 24 on disk and 24
  applied, and `pnpm verify:secrets` clean.
