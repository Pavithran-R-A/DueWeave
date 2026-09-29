# Security contract requalification (Stage 9, PHASE 10)

PHASE 10 asks for one thing beyond re-running the authorization suites: **no source-text-only
claim may stand where the behaviour can be executed**. `tests/security-contract.test.ts` holds 24
assertions that read the migration SQL; they are a cheap regression net on the text a reviewer
diffs, and they are not proof that a running Postgres enforces anything. This file is the map of
the executed proofs, and the last three tests in `tests/security-contract.test.ts` fail the
release if it drifts: a cited test that is renamed, deleted, or moved out of a command the gate
runs is a finding, not a stale sentence.

Executed by: `pnpm test:live` (the nine-suite database half, guard-first, one worker),
`pnpm test:db` (pgTAP inside the same Postgres), `pnpm test:e2e:smoke` (the CI browser journeys
against the built bundle). All three ran against the project's disposable loopback Supabase;
nothing here was run against a hosted project.

## The nine properties

| # | Property PHASE 10 requires | Executed proof | What the executing test actually observes | Measured |
| --- | --- | --- | --- | --- |
| 1 | Anonymous private-data read is denied | `tests/stage3-local-rls.test.ts:1737` "the anonymous role gets nothing from", `supabase/tests/stage3_02_privileges.sql:243` "has_table_privilege('anon', 'public.stage3_acl_probe_table', 'SELECT'), false" | A client built with only the anon key selects from every private business table and gets zero rows, and the role's real ACL on a freshly created table carries no `SELECT` | pgTAP 8 files / 364 assertions PASS, 2026-09-29 |
| 2 | User A cannot read User B | `tests/stage3-local-rls.test.ts:572` "user B cannot read", `e2e/stage9-account-isolation.spec.ts:432` "the other account's identifiers read as nothing, table by table" | Two real accounts each own rows; the second account's authorised select, search and export find none of the first account's identifiers, table by table | live suite 307 tests; browser 79 passed / 14.2 min, 2026-09-29 |
| 3 | User A cannot update User B | `tests/stage3-local-rls.test.ts:709` "user B cannot update A's", `:744` "a cross-user write that reports no error still changes no stored row" | The cross-user update is refused, and the stored row is re-read to prove nothing changed — including the case where the API reports success | live suite, 307 tests |
| 4 | User A cannot delete User B | `tests/stage3-local-rls.test.ts:769` "user B cannot delete A's", `:1662` "the owner cannot rewrite or destroy its own" | A foreign delete removes nothing (row re-read), and even the owner cannot destroy history rows directly | live suite, 307 tests |
| 5 | Foreign-key manipulation cannot cross ownership | `tests/stage3-local-rls.test.ts:895` "user A cannot insert a", `:989` "a receivable cannot be pointed at another owner's client through the table", `:1009` "child rows cannot reference another owner's parent" | Inserts and reparenting that name another owner's parent are refused at the policy/RPC boundary, through both the table and the workflow RPCs | live suite, 307 tests |
| 6 | Reviewer privileges do not become general ledger privileges | `tests/stage3-local-rls.test.ts:1383` "a signed-in non-admin cannot reach the review RPC", `:1560` "an enrolled reviewer can run the review RPCs and still sees no foreign rows" | An enrolled reviewer executes the review RPCs and *still* reads no other account's ledger rows; a non-admin cannot reach the review RPCs at all | live suite, 307 tests |
| 7 | Internal Founder helpers are not browser-executable | `tests/stage3-local-rls.test.ts:602` "the founder admin table", `:1859` "the anonymous role cannot call", `:1880` "the internal helper" | Admin tables are unreachable from a browser role and the internal helpers are not callable RPCs over `/rpc` — the call is attempted, and it fails | live suite, 307 tests; pgTAP 364 assertions |
| 8 | `service_role` is never required by the browser | `e2e/stage9-release-journey.spec.ts:210` "a stranger signs up, names the workspace, and the name is on the account", `:452` "a profile edit, a sign out and a sign in leave the ledger exactly as large as it is" | The whole money lifecycle, including relogin, completes with only the anon key plus the user's own session token; the stack the run requires is checked by `scripts/local-stack-check.mjs`, which asks for no privileged key | 79 passed / 14.2 min, 2026-09-29 |
| 9 | Default privileges remain fail-closed | `supabase/tests/stage3_02_privileges.sql:184` "default privileges for the migration role never target the PUBLIC pseudo-role", `:261` "has_function_privilege('anon', 'public.stage3_acl_probe_function()', 'EXECUTE'), false", `:265` "has_function_privilege('public', 'public.stage3_acl_probe_function()', 'EXECUTE'), false" | Not the recorded `pg_default_acl` but the ACL an object created *afterwards* really carries: a probe table, sequence and function are created with no GRANT and the browser roles and PUBLIC hold nothing — while owner and `service_role` still work, so closed is not broken | pgTAP 364 assertions PASS; this section is what caught D11 and D12 |

Row 8 is executed rather than argued: the browser suites are handed only
`VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY`, so a `service_role` dependency would be a hard
failure of the run, not a code-reading judgement. The complementary static proof — that no
privileged key reaches the shipped bundle — is `tests/credential-boundary.contract.test.ts` plus
`pnpm verify:secrets`, which measured 227 files (207 tracked + 20 bundle artefacts) against 11 credential
shapes with no finding, and whose HARD rules cannot be allowlisted away.

## What this stage did **not** execute

- **Real email confirmation.** Sign-up confirmation is exercised through the local Auth service;
  delivery to a real mailbox needs a hosted project's SMTP credentials. The eight
  host-credential-gated legacy specs and `tests/supabase.public-config.live.test.ts` are excluded
  from both release halves so neither can cite them; their supersession is mapped in
  `docs/TEST_SKIP_CLASSIFICATION.md`.
- **Live money.** Founder rows are proved in `TEST`/fail-closed mode: claim, UTR, review, cap and
  revocation are executed, no real UPI settlement is. See
  `docs/FOUNDER_LIVE_ACTIVATION_CHECKLIST.md`.
- **A hosted database's own defaults.** Row 9 is about this repository's migration role on the
  loopback stack; a hosted project's pre-granted privileges are a different environment and are
  not claimed here.

## Reproducing

```sh
pnpm test:live            # rows 1-7, nine suites, guard fails closed with no stack
pnpm test:db              # rows 1, 7, 9 inside Postgres (pgTAP)
pnpm test:e2e:smoke       # rows 2, 8, and the Stage 7/8 money + review journeys
node scripts/local-stack-check.mjs   # proves the run needed no privileged key
```
