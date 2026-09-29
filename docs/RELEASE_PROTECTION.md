# Branch Protection Plan for `main`

Stage 9 PHASE 26. This document **prepares** the rule and proves the named checks exist in
CI; it does **not** enable anything. No repository setting was read-only-probed and then
changed, no ruleset was created, and no access was granted. The repository remains private.

## Current state — measured, not assumed

Read with a token that has `repo` scope (`gh auth status` reported account
`Pavithran-R-A`, scopes `gist, read:org, repo, workflow`):

| Question | Read-only command | Result on 2026-09-29 |
| --- | --- | --- |
| Is `main` protected? | `gh api repos/Pavithran-R-A/project-ar1/branches/main/protection` | HTTP 404 `{"message":"Branch not protected"}` |
| Any ruleset covering it? | `gh api repos/Pavithran-R-A/project-ar1/rulesets` | `[]` |
| Default branch / visibility | `gh api repos/…/project-ar1` | `main`, `private = true`, `owner.type = User` |
| Merge methods | same response | merge commit, squash and rebase all allowed; `delete_branch_on_merge = false` |

The API could read the protection state, so this is **not** the UNKNOWN case: `main` is
authoritatively **unprotected today** — no classic protection rule and no ruleset. Direct
pushes to `main` are currently possible.

One thing the API could *not* establish: whether this account's plan permits protected
branches on a **private** repository. `gh api repos/…/project-ar1 --jq .plan` returns
`null` for this endpoint, and the entitlement is not exposed to a `repo`-scoped token.
**That single fact is UNKNOWN**, and the plan does not assume it either way — the operator
confirms it at the moment of enabling (see "Order of operations").

## The exact desired rule

Create it as a ruleset (or a classic protection rule) targeting `main` only:

| Setting | Value | Reason |
| --- | --- | --- |
| Require a pull request before merge | **on** | Release work arrives through review, not a push. |
| Restrict pushes that create merges / direct pushes | **on** | `main` is currently pushable; this closes the widest gap first. |
| Require approval before merging | **1** review | One approving reviewer is the plan's requirement; block merge on changes requested. |
| Dismiss stale reviews when new commits are pushed | **on** | A security-relevant diff pushed after approval must be re-read. |
| Require conversation resolution | **on** | Outstanding review comments stay visible until answered. |
| Require status checks to pass | **on**, with the three checks below | The gate set is `docs/RELEASE_GATE_MATRIX.md`. |
| Do not allow bypassing the above settings | **on** (applies to administrators) | Emergency privilege must not silently skip the release gate. |
| Require branches to be up to date before merging | **on** if the plan offers it | With `main` at the merge-base today this is free; it prevents a merge that no run tested. |
| Block force pushes | **on** | Release history and tags stay immutable. |
| Branch deletion protection on `main` | **on** | `main` must not be deletable. |
| `delete_branch_on_merge` (repo setting, not a rule) | leave **off** for release candidates | Accepted stage branches are the audit trail; a candidate branch is deleted by hand after its report closes. |

### Required checks — unique job names

Workflow file `.github/workflows/ci.yml`, workflow name `CI`, three jobs. Each job name is
unique and is the check-run name GitHub lists in the picker:

| Check to require | Job key | What a green run of it proves |
| --- | --- | --- |
| `Static verification` | `static` | Production build, `pnpm test:unit` (unit + boundary contracts, no database), ESLint `--max-warnings=0`, `tsc --noEmit`, the secret/privileged-credential scan over source **and** `dist/`, production dependency audit. |
| `Database contracts` | `database` | Generated types match the replayed schema, committed migrations match the applied set, the pgTAP suites inside a real Postgres, schema lint, the database-backed contract suites. |
| `Browser release smoke` | `browser` | The release journeys against a disposable loopback Supabase and the built bundle (`pnpm test:e2e:smoke`), then the React-warning and console-discipline gate against `vite dev` (`pnpm test:e2e:react-warnings`), with `retries: 0`. |

The three names are asserted against `ci.yml` by `tests/ci-gate-manifest.contract.test.ts`,
so renaming a job breaks a test rather than quietly pointing the rule at a check that no
longer exists. Do **not** require the workflow-level check named `CI` alone: a job that runs
four of the five gates looks identical to one that runs five, which is the failure Stage 9
found (defect F8 in `docs/TEST_SKIP_CLASSIFICATION.md`).

Before typing anything into the picker, confirm the exact strings against the checks list of
the first Stage-9 run of this head (PHASE 27). Require *strict* mode so all three must pass
even when not applicable to the commit set.

## Order of operations (operator actions, each a separate decision)

**Status of step 1 as measured on 2026-09-29: done and blocked.** The branch was pushed
(`current-stage-9-security-ci`; executable head `c682827`, documentation heads `99c120f`,
`cfd76fc`, `275e2f5` and `0400610`), and each of those five pushes produced a run —
`36533797727`, `36535054827`, `36535564240`, `36535840587` and `36536245051` — that reached
`completed/failure` in
2-4 seconds with
`runner_id = 0` and zero steps for both `Static verification` and `Database
contracts`, and `Browser release smoke` `skipped`; GitHub's annotation on each failed job
reads *"The job was not started because recent account payments have failed or your spending
limit needs to be increased. Please check the 'Billing & plans' section in your settings"*
(all five messages compared and identical). Any further push produces the same until that account state changes,
so the head this file describes is not special. Steps 2-5 are written for the operator to execute **after** that
account-level blocker is cleared, because step 1 cannot complete without a runner and the three
check names below cannot appear in the picker until a job has actually run. Full measurement:
`current_stage9_security_ci_report.md`.

1. Push `current-stage-9-security-ci` and let `CI` run to completion on the final head SHA;
   record run id, event, head SHA, the three job names, conclusions and durations
   (`docs/PR_INTEGRATION_PLAN.md` PHASE 25 measurements must be re-taken if `main` moved).
2. Confirm the plan permits protected branches on a private repository — the one UNKNOWN.
   If it does not, the rule cannot be created and `main` stays unprotected: that is a
   release-blocking finding to raise, not a reason to weaken the gate list.
3. Create the rule for `main` with the three checks from that run's own check list.
4. Open the Stage 9 PR only after both green local gates and a green Actions run exist.
5. Merge only after review; create an annotated tag only from the merged SHA, after a
   passing verification record.

## Kept from the previous revision

Keep the workflow secret-free: it intentionally receives no Supabase credentials, no
service-role key, no payment credential and no production browser account. Live Supabase
and manual-payment verification remain controlled operator activities, not pull-request
jobs. Never force-push, rewrite earlier release tags, publish automatically, or expose a
real UPI destination in source control.
