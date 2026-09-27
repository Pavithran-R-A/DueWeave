# DUEWEAVE — CURRENT ROADMAP STAGE 6: PRODUCTION UX / FIRST-USER EXPERIENCE / SETTINGS / ACCESSIBILITY / RESPONSIVE QUALIFICATION

Status: **CLOSED — PASS ON FIRST-USER EXPERIENCE + ACCESSIBILITY + RESPONSIVE, WITH DISCLOSED CAVEATS**
Branch: `current-stage-6-production-ux` · Starting SHA: `22af5723a38e5239885a1e9b26178f2d7773ee77` (Stage 5 closure HEAD)
Ending SHA: this file is committed inside the single forward commit `feat: complete production first-user experience`. A commit cannot contain its own hash, and Stage 5 history was not rewritten to embed one, so the closing hash is read from the push output and reported in the final closure block of the chat response.

---

## 1. What Stage 6 was for

Stages 2–5 made the ledger correct. Stage 6 makes it behave like a product a real first user can sign up to, set up, trust, and use on a phone. Concretely, this pass had to establish, with executed evidence rather than intent:

1. a first account reaches **real onboarding**, and the answer is stored in the **database**;
2. the persisted profile is the app's **authoritative identity**, and an incomplete one cannot be typed past;
3. signup, sign-in, recovery, logout and Back-after-logout **tell the truth** about what actually happened;
4. loading, refresh, failure, retry, and the four distinct empty states are **distinguishable**;
5. search and status filters work in a browser and **compose**;
6. settings shows the persisted profile and refuses to fake controls whose backend does not exist;
7. the product is **usable by keyboard and screen reader**, and does not break across a responsive width matrix;
8. no console/page errors are swept under the rug, and **nothing from Stages 2–5 regressed**.

Everything below is reported against the **built** app (`pnpm build` → `vite preview` on `127.0.0.1:3000`), which is what `playwright.config.ts` points at, so Phase 63's "not only dev mode" is satisfied by construction, not by claim.

---

## 2. Boundary compliance

| Prohibited | Held |
|---|---|
| Stage 7 export / portability | Not implemented |
| Automatic WhatsApp messaging | Not implemented; drafts still open manually, `never sent automatically` asserted |
| Full template-management system | Not implemented |
| Founder payments activation / Razorpay | Untouched; offer remains a truthful `PLACEHOLDER` destination, `paymentDestinationStatus` still `PLACEHOLDER` |
| Hosted Supabase provisioning / `supabase link` / `db push` | Not run |
| Deploy / tag `v1.0.0` / merge / PR | None |
| Generic admin-dashboard redesign | Quiet Ledger identity, typography and rail/bottom-nav structure preserved |
| Runtime AI | None added; the priority explainer still says "no AI is deciding for you" |
| Fake account deletion / fake settings controls | No control exists whose backend action does not exist — see §7 |
| New migration | **0 added** (Phase 56's "EXPECTED: NO NEW MIGRATION" held) |

---

## 3. Diff shape

Measured on the pushed commit with `git diff --name-status 22af572 HEAD`: 27 files modified + 1 deleted + 22 added = **50 files changed, 4,705 insertions(+), 242 deletions(-)**. The 22 additions are 5 production files, 5 unit/contract test files, 9 browser spec files, 2 e2e helpers, and this report.

New production surface:
`client/src/lib/profile.ts` (the single onboarding rule), `client/src/data/supabase-profile-repository.ts` (the only path to `profiles`), `client/src/contexts/WorkspaceProfileContext.tsx` (authoritative identity in memory), `client/src/pages/Onboarding.tsx`, `client/src/lib/ledger-search.ts`.
Deleted: `client/src/contexts/ThemeContext.tsx` — its competing theme mechanism was removed, not layered on (Phase 28).
New tests: 5 unit/contract files and 9 browser spec files, plus `e2e/problem-watch.ts` (Phase 54) and `e2e/workspace-setup.ts`.

---

## 4. Profile authority and the onboarding rule

**Rule (Phase 5).** `profiles.business_name = ''` (or a blank `display_name`) *is* the onboarding marker. There is no completion column, no flag table, and no `localStorage`/`sessionStorage`/query-string shortcut. Proven by `isWorkspaceSetupComplete` unit tests and by the browser assertion *`refresh holds the gate, and nothing in browser storage decides it`*.

**Authority (measured on the live local DB, not inferred).** Policies `profiles_select_own` and `profiles_update_own` (USING + WITH CHECK `id = auth.uid()`) plus `profiles_delete_own`. `authenticated` still holds `UPDATE` on **all** columns, so the real guard on `plan`/`timezone`/`currency`/`id` is the trigger `profiles_prevent_plan_change` → `prevent_profile_entitlement_change()` / `prevent_profile_authority_change()`. Stage 6 changed none of this and did not weaken any Stage 3 grant.

**Application path.** Views never call `supabase.from("profiles")`; the only occurrence of that table in `client/src` is inside `supabase-profile-repository.ts`. The repository writes only `display_name` and `business_name`, carries the raw `updated_at` token, and refuses a stale edit. Live proof (13 tests, real authenticated PostgREST, real second account): an owner reads/saves only their own two names; another owner's row is invisible; writes aimed at `id`, `plan`, `timezone`, `currency` are refused by the database; whitespace-only and over-limit values are refused before the server is asked, and the stored value is read back from the server after the save.

---

## 5. First-user journey (Phase 48 — the Stage 6 exit test)

`e2e/stage6-local-first-user.spec.ts` (7 tests) drives a brand-new account through the real product on the built app:

| Test | Establishes |
|---|---|
| adds the first two amounts the two ways a first user can | client-first path **and** new-client-inline path, both persisted |
| finds an amount from a partial, untidy search across people and papers | case/whitespace-tolerant search over receivables and clients |
| keeps open, paid, cancelled and all truthful about what each contains | the four filters, and that CANCELLED history is still reachable |
| searches clients without ever showing one the search hid | no result leaks past the filter |
| saves the two workspace names so every device sees them | profile edit → server → visible in rail/More |
| refuses an older profile edit instead of overwriting the newer one | concurrency token on the profile |
| keeps one theme choice across a reload and a login, with no ledger data on the device | single theme mechanism, storage audit |

`e2e/stage6-local-workspace-gate.spec.ts` (11 tests) covers the gate itself: a signed-out browser can open neither setup nor ledger; typing `/` cannot skip setup; setup asks only for the two names; the saved answer survives refresh, sign-out, sign-in and a brand-new browser context; validation refuses blank/whitespace/over-limit input without closing the form; unknown routes lead to an honest sign-in way home; the Founder screens keep their own door shut.

---

## 6. Auth truth: signup, sign-in, recovery, logout

**Signup is a three-way decision, not a boolean.** `interpretSignUpResponse()` returns `session` | `confirmation-required` | `error`. A sign-up that returned a user but no session says *"Confirm your email to open your ledger."* and never "your account is ready"; an immediate session opens the ledger straight away. Both paths are executed in the browser (`treats a confirmation-required sign-up as a wait, never as an open ledger`) and unit-tested (5 tests in `client/src/hooks/sign-up-outcome.test.ts`).

**Local limitation stated plainly:** `supabase/config.toml` disables email confirmation, so the confirmation-required branch is proven by unit + contract + UI-state tests, **not** by a real confirmation mail. Nothing here verifies hosted SMTP.

**Sign-in** refuses unusable input inside the form before the server is asked (`aria-invalid`, a `role="alert"` message, live semantics), shows a pending state only while the request is in flight, keeps the typed email when the network fails, and renders no technical Supabase/Postgres text. Buttons are disabled only while a submit is pending.

**Recovery** is enumeration-safe (the same answer either way), redirects to `/auth/update-password`, and **the route refuses to render a working-looking password form when there is no recovery session** — it says the link is not active and offers a new request. The happy path was **executed end to end against the local Inbucket mail catcher**: the link is opened, the password changes, and the old password is then refused (`12.3s` test). The recovery URL and its token are never printed or stored by any test or log in this pass.

**Logout + Back** (`signing out leaves no client, amount or session behind in this browser`): after sign-out the private client name, receivable label and `1,800` figure are gone from the document, all `sb-*` storage keys are gone, `page.goBack()` reveals nothing private (protected redirects `replace` their history entry), and a hard revisit of `/` lands on `/auth`. Theme may survive; ledger data may not.

---

## 7. Settings: no fake controls

More/settings shows the persisted workspace identity (your name, business/workspace), states **Currency — Indian rupee · INR** and **Business calendar — India · Asia/Kolkata** as fixed facts rather than editable controls, shows the sign-in email read-only, offers exactly the two real actions (edit the two names, send a recovery link), sign out, and the one real preference (theme, "Saved locally on this device"). There is **no** timezone picker, no currency picker, no email-change control, and no account-deletion control, because no complete backend flow exists for them. The truthful security copy ("Only you, by row-level security", "Messages and payments are never sent automatically") is preserved deliberately — Phase 63 forbids removing honest privacy explanation while removing prototype wording.

---

## 8. Loading, refresh, errors, retry, empty states

- **Initial loading ≠ background refresh.** A slow first ledger read holds a skeleton; a slow profile read holds the *gate*, not the ledger; a post-save refresh keeps the workspace on screen with `aria-busy` rather than blanking it (`Home.refresh()` never unmounts the shell).
- **Retry really reloads.** A forced read failure is recovered by *Try again* inside the same document (proved by a document identity marker, so it cannot pass by silently reloading the page), and the recovered figures are asserted. A mutation failure is also retryable and a retried payment books **once** (`keeps a typed payment through a lost connection and books it once on retry`), respecting Stage 5's idempotency.
- **Sanitization.** No `raw`, `PGRST`, `SQLSTATE`, `42501`, `P0002`, `40001`, "policy"/"constraint" text reaches the UI; failures surface as a titled, described message in product words. Contract tests anchor this and were re-ported, not deleted (see §12).
- **The four empty states are four different sentences**: `Make the next conversation easier.` (nothing at all) → `Now add the amount you are waiting on.` + "One client is already saved." (clients only) → `Nothing needs your attention today.` (real ledger, nothing actionable — it does **not** say "Add your first receivable") → `No matches in this view.` (an empty filter is not an empty book).

---

## 9. Search and filters

`client/src/lib/ledger-search.ts` holds the matching rule (case- and whitespace-tolerant, substring over name/label/invoice reference) with 20 unit tests. In the browser: receivable search, client search, Open/Paid/Cancelled/All, and search+filter composition are each executed, with a distinct no-results state and an explicit "Show all history" way out. Cancelled records stay discoverable rather than being erased from view.

---

## 10. Toasts, focus, keyboard (the accessibility qualification)

**Phase 29 defect, reproduced RED then fixed.** The success/error stack could rest on top of the header's primary action, the bottom nav, or a sheet's confirm button. The failing measurement (an overlap assertion between the toast box and the control box) was observed first; the fix is a placement/stack policy, and the tests assert the *resting* geometry, not a screenshot. `leaves the header action clickable while a success toast is on screen` and `keeps the toast clear of the mobile navigation, the sheet confirm button and the header` are the executed proofs. Toasts were not made `pointer-events: none` globally, and the mouse was not moved away to make a test pass.

**Lifetime policy:** a success is brief (4.5 s); a refusal stays long enough to read (9 s) and an action inside it stays clickable — `keeps the founder-limit action clickable and lets an error outlive a success` (47 s test).

**Sheet focus:** initial focus lands on the field the person came for, not the Close button; the close control and the confirm button are reachable but not pre-focused; Tab and Shift+Tab stay inside the `aria-modal` dialog; Escape closes and focus returns to the opener; a busy submit leaves the keyboard order while the write is in flight. Measured on the live document by name.

**Visible focus:** a 12-stop Tab walk asserts `:focus-visible` matched **and** a painted ring on each named stop, in both themes.

**Not obscured:** the phone's own chrome can paint over a focused control, so the qualification hits-tests the focused control's corners and centre with `document.elementFromPoint` — "two boxes overlap" is not the assertion; "the control is the top-most element there" is.

**Custom controls:** the existing/new-client switch is a real `aria-pressed` segmented control and changes with Space — this was a **product fix**, not a test adjustment.

**Defect found and fixed in the Phase 63 pass — accessible name at mobile width.** `PageHeader`'s primary action is icon-only below 560 px (`client/src/index.css:98` hides the label span), so at 390 px a screen reader announced the button as *unnamed*. The Stage 6 name audit could not see this because it fell back to `element.textContent`, which is CSS-blind — DOM text is what is *written*, the accessibility API reports what is *rendered*. RED as measured:

```
390px / /^Today/: controls with no announced name
  Array [ "button.button-primary \"Add receivable\"" ]
```

Fix in two parts: the audit now computes the rendered name (walking the subtree, skipping `display:none`/`visibility:hidden`/`aria-hidden` nodes), and the control carries `aria-label="Add receivable"`. GREEN followed (19.2 s), and Chrome's own ARIA tree independently reported `button "Add receivable"`. This closes a *class* of defect, not one instance: any label hidden at a mobile width is now caught.

**Scope honesty (Phase 52):** this is a **targeted Stage 6 accessibility qualification**, not a WCAG certification. No new accessibility dependency was added. It covers accessible names at both shapes, focus visibility and order, focus trap/return, announced refusals via a polite live region, live semantics (`aria-invalid`, `role="alert"`, `aria-busy`), Space activation, and reachability.

**Zoom restored:** `client/index.html` no longer sets `maximum-scale=1`, and adds `viewport-fit=cover`. Pinch-zoom was previously blocked — an accessibility defect this stage removed.

---

## 11. Responsive proof (Phase 53)

`e2e/stage6-local-responsive.spec.ts` measures, per width, `document.documentElement.scrollWidth` against `clientWidth` and names the offending elements; it checks the add control, the nav (bottom nav on narrow, rail on wide), the search control, and a sheet's confirm action, **in both themes on a phone and on a desktop**. Widths: 360×800, 390×844, 430×932, 768×1024, 1024×768, 1440×900. 1280×800 is covered by the accessibility walk (1280×900) and by the manual built-app pass (§13), not by a named entry in the matrix. No large blank gap was introduced to satisfy the bottom bar; the nav never covers the last form control.

---

## 12. Console / page error discipline (Phase 54)

`e2e/problem-watch.ts` collects `console.error`, `pageerror` and requests that never received a response, and specs assert `problemsFound(watch)` is empty. It runs across **17 tests** (first-user 7, responsive 5, mutations 5). The only allowance is scoped to per-URL failure, not per-message: `stage6-local-mutations.spec.ts` excuses the two RPCs it deliberately breaks — `/rest/v1/rpc/(cancel_receivable|record_payment)`. The documented reason: Chromium emits **both** a 204 `response` and a `requestfailed` (`net::ERR_ABORTED`) for `POST /auth/v1/logout?scope=global`, so the watcher tracks answered `Request` objects in a `Set` instead of pretending the second event is a problem. Zero unexpected console errors, zero page errors, zero React key warnings in those journeys; `pageerror` is never excused by the allowance.

---

## 13. Manual built-app qualification (Phase 63)

Executed against `pnpm build` output served by `vite preview`, with Chrome's own ARIA tree consulted:

- **390×844, fresh account:** empty ledger → first receivable through the New-client path → partial payment with live summary → promise with made-on chronology → settings → theme toggle → search and filters → edit → reload persistence → logout, with storage reduced to `dueweave-theme` only and no private leak. Console clean; no horizontal overflow in light or dark.
- **1280×800, established account:** rail identity read from the database, header CTA accessible name equals visible text, bottom nav and the dead FAB not rendered, no overflow.

---

## 14. Regressions and gates on the final tree

| Gate | Result |
|---|---|
| `pnpm install --frozen-lockfile` | clean, lockfile untouched |
| `pnpm lint` (`--max-warnings=0`) | PASS, no warnings |
| `pnpm check` (`tsc --noEmit`) | PASS |
| `pnpm build` | PASS |
| `pnpm test` **RUN #1** (10:50:18) | 415 passed / 0 failed / 1 skipped (22 files passed, 1 skipped) |
| `pnpm test` **RUN #2** (10:51:11) | 415 passed / 0 failed / 1 skipped — identical; **no code or config change between the two runs** |
| Stage 6 browser battery | 64 passed / 0 failed |
| Whole browser battery (Stages 2–6) | 97 passed / 0 failed / 8 skipped (credential-gated, §16) |
| pgTAP | 229 passed / 0 failed across 5 files |
| Zero replay | `pnpm db:reset:local` exit 0; 21 `Applying migration` lines; post-reset `schema_migrations=21`, `receivables=0`, `auth.users=0`; pgTAP green on the replayed DB |
| Generated types | `pnpm db:types` run twice → identical `10dd590052d68d997a43a01f5ff3ca17257226beca01bc95af81b3efd185e328`, and the file is unmodified vs Stage 5 → **DETERMINISTIC**, schema unchanged |
| Migrations | 21 total, **0 added** |
| `pnpm audit --prod --audit-level=high` | No known vulnerabilities |
| `git diff --check` | clean (only Git's own CRLF working-copy notices on Windows) |
| PGRST303 | runs: 2 · occurrences: **0** · other failures: 0 · production masking added: **NO** |

Stage 2/3/4/5 regression suites are all inside those numbers: 33 browser tests (`auth-gateway` 3, `stage2-local-auth` 1, `stage3-local-isolation` 5, `stage4-local-persistence` 10, `stage5-local-lifecycle` 14) plus the Stage 2–5 contract and live-DB files in `tests/`.

---

## 15. Assertions changed in this pass, and why each still proves what it proved

Phase 59 forbids deleting or skipping old financial/security assertions to accommodate new UX. Nothing was deleted or skipped. Four **source-text** anchors went stale because Stage 6 renamed the thing they quote, and were re-ported to the new, equivalent text:

| File | Old anchor | New anchor | Why it is not a weakening |
|---|---|---|---|
| `tests/repository-boundary.contract.test.ts:193` | `toast.error(` | `feedback.error(` | The UI feedback API was renamed; the assertion still requires the refusal to be raised in the catch block. |
| `tests/security-contract.test.ts:95` | `if (data.session) return { status: "session" }` | `if (response.data?.session) return { status: "session" };` | The tri-state was extracted into exported, unit-tested `interpretSignUpResponse`; the session-means-open-ledger rule is still asserted, now also in `sign-up-outcome.test.ts`. |
| `tests/security-contract.test.ts:134` | `toast.error("Could not add receivable", { description: message })` | `feedback.error(…same text…)` | Same copy, same mapped-limit path. |
| `tests/security-contract.test.ts:151` | `… toast.success("Follow-up marked"` | `… feedback.success("Follow-up marked"` | Same write-then-refresh-then-close-then-announce order. |

Two further assertion changes, both disclosed because they change what is being demanded:

- `e2e/accessibility-smoke.spec.ts` previously demanded that a data-entry sheet focus **Close**. Stage 6's Phase 31 rule is that initial focus goes to the first meaningful field, so the assertion now demands `Client name` is focused (the Shift+Tab wrap and Save reachability checks were kept). This is a *changed expectation with a replacement assertion*, not a removed one.
- `tests/profile-setup.unit.test.ts` and `tests/stage6-local-profile.test.ts` used the operator's own name as fixture display data; it was replaced with a fictional name so committed fixtures match the suite's existing convention. Test-only; both files re-run green (25 tests) afterwards.

---

## 16. Disclosures, caveats and defects deliberately not hidden

1. **8 browser tests were NOT executed** because they need pre-provisioned credentials the local stack does not supply: `accessibility-smoke` (1), `auth-lifecycle-limits` (2), `core-workflow` (1), `founder-purchase` (1), `responsive-authenticated` (1), `stage41-client-conversion` (2). They gate themselves off rather than pretending. Their Stage 6-relevant behaviour is covered by the local Stage 6 equivalents, but that is coverage-by-substitute and is reported as such.
2. **The full battery at default parallelism (8 workers) failed 6 tests** — `auth-gateway`, `stage3-local-isolation`, `stage4-local-persistence`, `stage5-local-lifecycle`, `stage6-local-accessibility`, `stage6-local-forms` — every one with the same shape: `page.goto: net::ERR_ABORTED` on the *first document navigation*, `beforeAll` hook timeouts, or teardown exceeding the test timeout, plus "27 did not run". Re-running the identical tree with `--workers=2` gave **97 passed / 0 failed / 0 not-run**. Root cause is the single `vite preview` Node process plus the shared local stack saturating under 8 concurrent Chromium contexts on this machine — not a product defect. Reported as measured; no assertion, timeout, retry or config value was changed to obtain the pass, only a worker-count flag on the command line.
3. **An earlier full-suite run (10:15) reported 11 failures**: the four stale source-text anchors of §15 plus failures inside a live-DB repository file whose first fixture write did not land, cascading into later tests of that file. My capture of that run kept only the tail, so the complete list is not reconstructable, and the precise mechanism (concurrent fixture purging against the shared local database) is **not established**. It did not recur in the four subsequent full-suite runs on the current tree, including the two formal ones. No sleep, retry-until-green, JWT leeway or suppression was added — that discipline is exactly why the two consecutive clean runs are quoted with timestamps.
4. **Phase 12/49 signup confirmation** is proven by unit + contract + UI-state tests only. Local mail confirmation is disabled by `supabase/config.toml`; nothing here proves hosted email delivery.
5. **`record_payment` never populates `activities.amount_paise`**, so the payment entry in a client's timeline can only read "Payment recorded" while a promise entry can read "WhatsApp · ₹5,000 promised". Stage 6's fix was to **stop fabricating** a ₹0 figure in the client rather than invent a number. A forward migration that fills the column at write time belongs to a DB-owning stage — and `activities_immutable` means existing history rows can never be retro-tagged with the figure, so only future payments can carry it.
6. **Toasts are light-themed in dark mode** by construction: the tokens are scoped to `.app-shell--dark` and the Toaster mounts outside that shell. Fixing it would require a second theme mechanism, which Phase 28 forbids.
7. **"Close this receivable" disappears once money has arrived**, and the product says why (`stops offering a close once money has arrived, and says why`). The close/cancel vocabulary split is deliberate: closing pays nothing out, cancelling is a reversal that keeps history; neither was renamed to the other and no migration was added to reconcile them.
8. **`.floating-add`** is dead markup at every width (`index.css:54`, `:101` `display:none !important`) and predates Stage 6. It is not rendered at 1280 and the responsive tests measure whatever is actually drawn. Left in place: removing it is cosmetic cleanup, not Stage 6 scope. → **Stage 9**.
9. **`.today-detail`** (the sticky detail tail) needs page scroll to reach its last action at 1280×800; every control remains reachable and nothing is covered. Recorded as Stage 9 polish, not a Stage 6 defect.
10. **Chromium's native date input** contributes internal tab stops, so Tab-walk counts include them; the assertions are about focus visibility, containment and reachability, not about a fixed stop count.
11. **Class names `prototype-chip` / `prototype-footnote` remain.** They are CSS selectors only; no customer-visible string says "prototype", and their text is truthful privacy/security copy that Phase 63 protects.
12. **Founder surface is Stage 8's unresolved product boundary.** Stage 6 touched its layout/focus/labels only (keyboard contract, no double-submit, no raw error text). No payment configuration, no activation, no Razorpay.
13. **Hosted-project realities remain Stage 10 work**: Site URL and redirect allow-list, real SMTP, email confirmation, and the recovery-link redirect target are local-only assumptions.
14. **Two of my own in-session findings were retracted after verification**, recorded here rather than quietly dropped: (a) a claimed "Due 28 Sep" versus stored `2026-09-27` mismatch — `formatDate` pins date-only strings to IST noon, and the actual rendered snapshot said "27 Sept"; there was no date defect and the claim was an unverified inference. (b) a claimed "Explain queue" disclosure missing `aria-expanded`/`aria-controls` — it is not a disclosure at all; it fires an informational message, which was verified reaching the polite live region.
15. **Fabricated and contradictory tool output appeared in this session's earlier context** (invented file listings, a duplicated read, stale browser UIDs, and one `evaluate_script` "Illegal invocation"). Claims depending on them were re-derived from direct file reads or fresh measurements. This is why every number in §14 comes from a command re-run on the final tree.
16. **No `service_role` key appears in browser code, tests or this report**; local Supabase startup banners that print generated keys were never pasted into any file or committed artifact.

---

## 17. PASS condition ledger

Every Stage 6 PASS condition in the brief is met by an executed test or measurement named above: fresh-account onboarding (database-persisted, not storage), authoritative profile identity, no typed-past setup, complete profile not re-shown setup, first receivable, client-first path, both signup states truthful, enumeration-safe recovery request, inactive recovery route not faking a form, logout removing private UI, Back-after-logout, loading vs background refresh, non-blanking mutation refresh, load-error retry that really loads, no technical internals in user-facing errors, all four empty states, receivable search, client search, the four status filters, search+filter composition, settings showing the persisted profile, profile edit surviving reload/relogin, email truthful and read-only, INR and Asia/Kolkata truthful/read-only, one theme source of truth, toast overlay RED reproduced then fixed, dialog initial focus/trap/Escape/return focus, visible keyboard focus, focus not obscured, the width matrix, no horizontal overflow, private web storage, profile cross-user isolation, Stage 2–5 regressions, pgTAP, zero replay, migration count, deterministic types, PGRST303 discipline with no masking, two consecutive clean full runs, lint/typecheck/build/audit, and console cleanliness with a scoped, documented allowance.

**Final current-roadmap Stage 6 verdict: PASS**, with §16's disclosures as the record of what PASS does not cover.

---

## 18. Stage 7 boundaries still open (deliberately untouched)

- follow-up / template completion
- WhatsApp portability polish
- CSV / data export
- account / data portability

**STOP. DO NOT START STAGE 7. DO NOT MERGE ANY PR.**
