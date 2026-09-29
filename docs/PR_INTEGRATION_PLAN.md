# Integration PR Strategy (designed, not opened)

Stage 9 PHASE 25. **No pull request was created and nothing was merged by this stage.**
Everything below is a read-only measurement taken on 2026-09-29 against
`https://github.com/Pavithran-R-A/project-ar1.git`, plus the design the operator executes
after Stage 9 closes.

## Measured starting position

| Item | Command (read-only) | Measured value |
| --- | --- | --- |
| Base branch | `git ls-remote origin refs/heads/main` | `58f0cc76ca560bdac08bdbd19e237aa4a413686b` |
| Candidate branch | `git branch --show-current` | `current-stage-9-security-ci`, expected start `ccc44382…` (the accepted Stage 8 head) |
| Candidate on remote | `git ls-remote origin refs/heads/current-stage-9-security-ci` | no ref — **not pushed at measurement time** |
| merge-base | `git merge-base main HEAD` | `58f0cc76…` — equal to `main`, so `main` has not moved since the fork point |
| Commits | `git rev-list --left-right --count main...HEAD` | `0  40` → 40 ahead, **0 behind** |
| Files | `git diff --shortstat $(git merge-base main HEAD) HEAD` | 236 files changed, 37141 insertions(+), 12933 deletions(-) |
| Stage 9 work in progress | `git status --porcelain` | 14 modified + 23 untracked paths, not yet in the 236 |
| Repository | `gh api repos/…project-ar1 --jq .private` | `true` (private), `owner.type = User` |

## Conflict risk

`main` is 0 commits ahead of the merge-base, so a PR from this head into `main` is a
one-directional diff: **no merge conflict is possible at the measured SHA.** That is a
property of this moment, not of the branch — re-run the three git commands above
immediately before opening the PR and re-state the numbers if they differ.

The two paths that can still produce conflicts are:

1. **The open PR #1** (`chore: rebaseline DueWeave repository`, head
   `stage-0-rebaseline` at `1bb2f38`, base `main`, `mergeable = MERGEABLE`,
   `mergeStateStatus = UNSTABLE`, last updated 2026-09-24). Measured with
   `git merge-base --is-ancestor 1bb2f38 HEAD` → **true**, and
   `git rev-list --count HEAD..1bb2f38` → **0**: PR #1 contains nothing this branch lacks.
   Merging PR #1 first cannot conflict with this branch, and merging this branch makes
   PR #1 redundant. This stage does not close, comment on, rebase or merge PR #1 — that is
   an operator decision, and leaving it open is the safe state.
2. **Any commit pushed to `main` after `58f0cc7`** while Stage 9 work continues.

**README conflict risk: none at the measured SHA.** `README.md` is modified by this branch
(183 changed lines versus the merge-base) and unmodified on `main` since the fork point, so
it merges cleanly. If `main` moves before the PR is opened, `README.md` is the file most
likely to be touched by both sides and must be re-checked by name.

## Workflow behaviour

`git show main:.github/workflows/ci.yml` fails with *"path exists on disk, but not in
'main'"*: **`main` has no CI workflow file at all.** The workflow described by
`docs/RELEASE_GATE_MATRIX.md` arrives *with* this PR, which has two consequences the
operator must sequence around:

- The required status checks in `docs/RELEASE_PROTECTION.md` cannot be selected in a
  branch-protection rule until a run has published those check names at least once.
  GitHub's check picker lists checks it has seen.
- **Corrected by PHASE 27's measurement, 2026-09-29.** The bullet written here on 2026-09-29
  morning read that run as proof that "Actions itself is working on this account", because its
  failure could be explained by the pre-Stage-9 workflow file. That inference was wrong, and
  reading the run's own job data disproves it: run `36062418596` reports `runner_id = 0`,
  `steps = []`, and its check annotation is *"The job was not started because recent account
  payments have failed or your spending limit needs to be increased. Please check the 'Billing
  & plans' section in your settings"*. A job with no steps never read the workflow file, so its
  conclusion says nothing about the workflow's contents.
- Re-taken across the whole run history, the same measurement gives a sharper picture: the last
  run that executed anything is `31825803438` (`stage-4-2-operator-readiness`, `6d99651`,
  2026-08-14T17:49:47Z, `success`, `runner_id = 1000000214`, 14 steps). Every run after that —
  `36062418596` on 2026-09-24 and Stage 9's own `36533797727` on 2026-09-29 — has
  `runner_id = 0`, zero steps, and the identical billing annotation. **Actions has not allocated
  a runner to this repository since 2026-08-14, and the blocker is account-level, not
  code-level.** `gh api repos/…/actions/permissions` still answers `enabled: true`,
  `allowed_actions: all`, so the repository setting is not the cause. The account's spending
  state itself is **UNKNOWN** from here: `GET /users/Pavithran-R-A/settings/billing/actions`
  needs the `user` scope, which this token does not hold (`gist, read:org, repo, workflow`), and
  no payment setting was changed by this stage.
- Consequence for this plan, stated plainly: the required-check names below cannot be published
  to GitHub's picker by any means available to this stage, because publishing them requires a job
  to execute. `docs/RELEASE_PROTECTION.md` step 1 is therefore not completable, and Stage 9 is
  reported **BLOCKED** rather than PASS even though every local gate is green — the brief's own
  rule ("If GitHub Actions cannot execute: STATUS = BLOCKED even if all local gates pass").

Triggers on the delivered file: `pull_request` (any base), `push` to `main` and
`current-stage-9-security-ci`, and `workflow_dispatch`. Pushing the branch is therefore
itself a CI run (Stage 9 PHASE 27), which is how the head-SHA proof is obtained.

## The eventual PR — design

| Field | Value |
| --- | --- |
| Base | `main` |
| Head | `current-stage-9-security-ci` |
| Title | `test: Stage 9 release, security and CI qualification` |
| Opened only when | every gate in `docs/RELEASE_GATE_MATRIX.md` is green locally **and** a real Actions run for the final head SHA is complete and green (PHASE 27) |
| Body must carry | the Stage 9 report path, the measured per-gate counts and durations, the skip classification (`docs/TEST_SKIP_CLASSIFICATION.md`), the executed security-proof map (`docs/SECURITY_CONTRACT_REQUALIFICATION.md`), and an explicit list of what the release does **not** claim (hosted Supabase, real money, WCAG certification, delivery performance) |
| Merge | a separate decision after review; this stage never merges |
| Labels/milestones | none invented; `v1.0.0` is not created by this stage |

Commit shape for the Stage 9 delivery itself (before the PR): forward-only commits on the
candidate branch — no rewrite of `ccc4438` or earlier, no force-push, and each commit
leaves `pnpm test:unit`, `pnpm lint` and `pnpm check` green.

## Not done in this stage, on purpose

- No PR created (PHASE 25: "DO NOT CREATE IT YET").
- No merge, no close, no comment on PR #1.
- No branch protection or ruleset change (see `docs/RELEASE_PROTECTION.md`).
- No tag, no release, no deploy, no hosted Supabase project.
