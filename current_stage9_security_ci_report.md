# Stage 9 — Security / Testing / CI / Release-Gate Qualification (authoritative report)

STATUS: **PASS** — on the repository's own self-hosted Linux runner.

Every gate this stage could execute locally is green, measured and reproduced, and the one gate the
brief makes non-substitutable — a real GitHub Actions run on the delivered head, with all three jobs
executing — is now green and read from GitHub's own job, step and log data: run `36555102272`
(run 18) at head `ec868e8e71ae62c9f5eda83d126c4e70c539aa0e`, `Static verification` +
`Database contracts` + `Browser release smoke` all `completed/success`, every step of every job
`success`, on runner `dueweave-local-ci` with labels `self-hosted, linux, x64, dueweave-ci`. It is green
again on the head this delivery describes: run `36751052906` (run 27) at head
`1c3fb52cce7e5004134b6076619d9d592b0c0132`, `Static verification` + `Database contracts` +
`Browser release smoke` all `completed/success`, 40 of 41 steps `success` with the single non-success
being the `if: failure()` evidence upload reporting `skipped`, browser **82 slots / 0 failed / 0
did-not-run / 0 skipped**, `run_attempt 1`, artifacts `total_count 0`, `runner_id 21` on every job. The
earlier verdict in this file was BLOCKED, because GitHub refused to allocate a *hosted* runner to the
account; that history is preserved below, unedited, and the resolution — moving the identical gates
onto a self-hosted runner, plus the three repository defects that a real run then exposed — is
recorded beside it. Two of those three were found by a job failing; the third (`D-S9-7`, a
privileged key inside the log of a job that had already passed) exists only because the logs were
read as text rather than trusted as green. Where a number could not be measured, it says so.

**Status as of the eighth self-hosted run.** Run `36699719286` (head `ee90097`, the head that carries
this stage's last code change — the D-S9-10 retention repair) executed **all three jobs** and finished
`failure`: `static` `success` (26 files / **372** tests — the +1 being D-S9-10's own contract case),
`database` `success` 13/13 — the migration-replay sub-step green **again, after the two consecutive reds
(runs 23 and 24) that D-S9-10 exists to make diagnosable**, and its `--debug` stream naming the realtime
one-shot in the retained log for the first time**; `browser` `failure` at
step 8 with `1 failed / 9 did not run / 69 passed (13.1m)`. Two things that run settles and one it does
not: **D-S9-9 is accepted** (the exact test run 22 lost to the toast is `✓ 57 … (18.0s)` in CI on the
repaired head), **D-S9-10 is proven to do its job** (green twice in one run, on two independently
started stacks), and the browser red is a **host name-resolution episode on this shared workstation**,
measured from the run's own trace, Docker Desktop's VM `kmsg` record and the 69 tests that issued the
same request minutes earlier — not a gate rejecting this repository's code, and nothing in the
repository was changed because of it. The PASS above therefore still describes the *recovery*
(GitHub Actions orchestrating all three release gates to completion on `dueweave-local-ci`, measured on
runs 18, 19 and 21); **no head delivered since run 21's has produced a three-job green**, and the
condition that makes `browser` depend on a third party's DNS is now a stated limitation (27) with the
decision it implies in owner actions 17-18, not a workaround buried in a test. Read the FINAL VERDICT
qualifier before quoting either word.

**Status as of the ninth self-hosted run.** Run `36747012514` (head `b26c428` — this file's own
previous commit, whose only tracked change is this file) executed **no gate at all**: `static` and
`database` each died at step 3, `Run ./.github/actions/setup-toolchain`, with conclusion `cancelled`
after 15 s and 22 s, every later step `skipped`, `browser` `skipped` with `steps: []`, artifacts
`total_count 0`, and **0 tests of any kind executed**. Both job logs print the same sentence — *The
runner has received a shutdown signal* — and the runner's own `_diag` listener logs show what that
sentence means here: the long-poll TLS connection to GitHub's job broker was aborted
(`SocketException (125): Operation canceled`), which makes a self-hosted runner cancel whatever it is
running rather than fail it. The push had gone out to a machine that was **down** — GitHub reported the
runner `offline` and `wsl -l -v` reported both `Ubuntu` and `docker-desktop` `Stopped` minutes later,
and Docker Desktop's own backend log contains no line between `16:38:54Z` and `16:51:45.188Z` — so
booting Ubuntu for a health check let the *enabled* systemd runner unit reconnect and take the queued
jobs mid-startup. This session then made the runner state worse before it diagnosed it: two manual
runner hosts were started against the same registration, giving three concurrent instances and the
documented `A session for this runner already exists` conflict, which is why the next push waited for a
measured `online`/`busy=false`/engine-answering/ports-free machine. **Run 26 therefore neither accepts
nor rejects anything in this file**, and nothing in the repository was changed because of it: no
`retries`, timeout, assertion, step or workflow key can reach a job that never got to a command, and the
brief forbids inflating any of them. Its cause is machine-state and operational, recorded as limitation
28 and owner action 19, and the two runner instances this session created were killed by PID after
listing them. Read the run-26 section with this paragraph.

**Status as of the tenth self-hosted run — the measurement this recovery was for.** Run `36751052906`
(head `1c3fb52` — this file's own run-26 commit, whose only tracked change is again this file) executed
**all three release gates to completion and returned `completed / success` overall**: `Static
verification` (`110009465872`, `17:23:43Z → 17:25:57Z`) 13 of 13 steps `success`, `Database contracts`
(`110009465853`, `17:26:01Z → 17:32:32Z`) 13 of 13, `Browser release smoke` (`110013090596`,
`17:32:36Z → 17:50:38Z`) 14 of 15 with the single non-success being `Upload failure evidence` =
`skipped`, which is an `if: failure()` step on a run that had nothing to upload. Every job carried
`runner_id 21` and printed `Runner name: 'dueweave-local-ci'` with labels
`["self-hosted","linux","x64","dueweave-ci"]` — no hosted fallback. `run_attempt 1` throughout, with
exactly one run existing for the head, so nothing reran. The counts: unit **26 files / 372 tests**,
`Migrations on disk: 23. Applied in the local database: 23.`, the D-S9-10 replay sub-step green at
**43 764 ms** in `database` and again at **46 297 ms** on the browser job's own independently started
stack, pgTAP `Files=8, Tests=364` `Result: PASS`, `No schema errors found`, live contracts
**9 files / 307 tests**, browser **`79 passed (13.3m)`** plus **`3 passed (43.3s)`** = 82 slots with
**0 failed / 0 did-not-run / 0 skipped**, secret sweep `Scanned 234 files for 11 credential shapes` +
`No privileged credential found in the tracked tree or the built bundle`, `pnpm audit --prod` →
`No known vulnerabilities found`. Negative sweeps across all three retained logs: `PGRST303` 0,
`40001` 0, `Timeout` 0, crash/OOM 0, `ERR_NAME` 0, `retrying` 0, `Attempt [2-9]` 0, artifacts
`total_count 0`, `sb_secret_` 0 with `[redacted-sb-secret-key-41-chars]` and `[redacted-db-password]`
each present once in both environment logs. Both tests that the previous two reds were about are green
here: `✓ 57 … e2e/stage8-local-founder-reviewer.spec.ts:356:3 … (16.6s)` at `17:45:17.993Z` (D-S9-9,
run 22's failure) and `✓ 70 … e2e/stage9-release-journey.spec.ts:210:3 › … a stranger signs up, names
the workspace, and the name is on the account (3.6s)` at `17:48:24.549Z` (run 25's failure). What this
run does **not** claim: that the browser gate is network-hermetic — limitation 27 stands, because the
`fonts.googleapis.com` request that failed on run 25 simply resolved this time, which is a fact about
this workstation's DNS in this 13-minute window and not a repair; and that any head after this one is
green — the commit that records run 27 moves the head, and run 28 is the next thing to read. The
product tree run 27 tested is byte-identical to run 25's apart from this file, so it is a
re-measurement, not a repair; nothing in the repository was changed because of run 26 or run 27. Read
the FINAL VERDICT qualifier before quoting either word.

---

## Delivery identity

| Field | Value |
| --- | --- |
| STARTING SHA | `ccc44382…` (`ccc4438`, the accepted Stage 8 head "fix: align Founder readiness at every boundary") |
| ENDING SHA | Executable head **`ec868e8e71ae62c9f5eda83d126c4e70c539aa0e`** — the SHA run `36555102272` executed and passed, i.e. the head every gate in this file describes. Four heads after it carry code: `d1035d9`/`f03fd0d` (D-S9-7's redactor, accepted green by run 21), `3accf61`/`9ee7921` (D-S9-9's test-order repair, whose run 23 executed no test), and `ee90097` (D-S9-10's retention repair, run 25 — two jobs green, `browser` red on the host). **The branch head as it is delivered is this file's own commit**, one step past `b26c428`, and it
changes no code either. `b26c428` was that sentence's referent when run 25 was recorded, was delivered by
a fast-forward push, and its run (26) was cancelled before reaching a gate. `ec868e8` itself was reached through three further commits after the original delivery: `6250a32` *ci: run the release gates on the repository self-hosted runner*, `c3eda13` *fix: let the static release gate run without configured credentials*, `ec868e8` *fix: produce the browser artefacts CI scans and uploads* (the last two are the repairs PHASE G's real run forced; both are in the defect table below). The documentation surface landed as `99c120f528a86af2f46b9e42cbbfc30fd6b5bdd5` (nine docs paths, 1519 insertions / 36 deletions), then `389fba5` recorded the run that head produced, `cfd76fc` re-measured the secret-scan scope, `275e2f5` recorded the run history, `0400610afcff69b4cd5a42ce01c15c412cf0bdba` closed it with the fifth observation, `6b83848` recorded the sixth, and `0bb851b` was the head of run 17 — all seven of those runs failed in 2-4 seconds with zero steps on GitHub-hosted infrastructure. **A commit cannot record the CI result of its own SHA**: this file's own commit is one step past `ec868e8` and its run is the next one, so the branch head is authoritative by `git ls-remote origin refs/heads/current-stage-9-security-ci`, which was verified after every push. **That sentence has since been exercised twice more since (`b26c428`, then this file's own commit) and is the live reading of this row:** the heads after `ec868e8` are `f4bcc61` (run 19, green), `f28bae6` (run 20, red — D-S9-8; the head of a push that also carried `d1035d9`, the D-S9-7 repair commit, which has no run of its own — `head_sha` filter → `total_count 0`), `f03fd0d` (run 21, green — the D-S9-7 acceptance), `fd2e12d` (run 22, red — D-S9-9), `9ee7921` (run 23, red inside `db reset` before any suite ran; head of a push that also carried the D-S9-9 repair `3accf61`, likewise `total_count 0`), `567be25` (run 24, red at the *same* step on a head whose only difference from `9ee7921` is this file), `ee90097` (run 25 — the D-S9-10 head: `static` and `database` green, the replay step green again after runs 23-24's two reds, `browser` red on a measured host name-resolution episode), `b26c428` (run 26 — the documentation-only head carrying run 25's record, whose own run never reached a
gate: both environment jobs `cancelled` at `setup-toolchain`, `browser` `skipped` with `steps: []`,
**0 tests executed**, artifacts `total_count 0`, the workstation down when it was pushed), and this
file's own commit, which records run 26 and is the delivered head. Every one of those was a fast-forward push; none was amended, squashed, rebased or force-pushed. |
| BRANCH | `current-stage-9-security-ci` (pushed to `origin`, tracking set, `main` untouched) |
| Commit chain | `ccc4438` → `cbd423d` *ci: qualify DueWeave release candidate* → `c682827` *test: consolidate release security gates* → `99c120f` *docs: close Stage 9 security qualification* → `389fba5` → `cfd76fc` → `275e2f5` → `0400610` → `6b83848` → `0bb851b` → `6250a32` → `c3eda13` → `ec868e8` → `f4bcc61` → `d1035d9` *fix(ci): keep privileged keys out of the retained job log (D-S9-7)* → `f28bae6` → `f03fd0d` → `fd2e12d` → `3accf61` *test(e2e): clear the refusal toast before clicking the Founder call-out it covers (D-S9-9)* → `9ee7921` → `567be25` *docs: record run 23 red at the migration replay, with no repository defect proven* → `ee90097` *fix(ci): make the migration replay's failure diagnosable (D-S9-10)* (the `--debug` + existing-filter change to `action.yml`'s replay step, plus the 6th contract case) → `b26c428` *docs: record run 25, its green replay and its host name-resolution red* (this file alone,
397 insertions / 67 deletions, no code) → this file's own commit, which records run 26 and its measured
cancellation and changes no code — the delivered head |
| Forward-only | No amend, no rebase, no force-push, no rewrite of `ccc4438` or any earlier commit. Verified with `git reflog` and `git log --oneline -4`. |
| Migration policy | Forward-only. **Zero** migration files added, edited or deleted by Stage 9 (`git diff ccc4438 HEAD -- supabase/migrations` is empty) — the schema this stage qualified is the schema Stage 8 delivered. |
| Generated types | `client/src/types/database.generated.ts` unchanged in content versus `ccc4438` (`git diff --numstat` empty; the `M` flag on this host is the `core.autocrlf=true` phantom, and `scripts/verify-types-drift.mjs` normalises CRLF so line endings cannot fake a drift). |

## CI

| Field | Value |
| --- | --- |
| CI DESIGN | Three jobs with unique, human-meaningful check names, each a different environment class, so that a required-status-check rule can name them individually and a job that omits a gate cannot present itself as a job that ran it. `browser` depends on `static` and `database`; the workflow is secret-free by design (it receives no Supabase credentials, no privileged key, no payment credential — `gh api …/actions/secrets` and `…/actions/variables` both return `[]`, measured). What it did *emit* is a different matter: until `D-S9-7` was repaired the stack-start step printed the local stack's generated privileged key into the log the platform retains, which no receiving-side check could have caught. The database and browser jobs replay the **committed** migrations onto a disposable loopback Supabase started by a composite action rather than trusting a recorded schema. All three jobs run on `[self-hosted, linux, x64, dueweave-ci]` with `timeout-minutes` 25 / 40 / 45 (`ci.yml:48,87,117`), a `concurrency` group, `permissions: contents: read`, and a fork guard (`if: github.event_name != 'pull_request' \|\| github.event.pull_request.head.repo.full_name == github.repository`) so a pull request from a fork cannot reach the machine. |
| CI RUNNER | `dueweave-local-ci` — a repository-level runner (version 2.337.0) on WSL2 Ubuntu on this workstation, labels `self-hosted, linux, x64, dueweave-ci` exactly as run 18's job payload reports them (`gh api …/actions/jobs/<id>` → `"labels":["self-hosted","linux","x64","dueweave-ci"]`, `"runner_name":"dueweave-local-ci"`), systemd unit `actions.runner.Pavithran-R-A-project-ar1.dueweave-local-ci.service` (`active` + `enabled`, measured after the run), workspace `/home/pavithran_r_a/actions-runner-dueweave/_work/project-ar1/project-ar1` for runs 18-21 and `/home/pavithran_r_a/actions-runner-dueweave/_work/DueWeave/DueWeave` from run 22 onward — the repository rename showing up in the runner's own paths, not a topology change (see the run-22 machine-state section). It is registered for **this repository only** — `_work/` contains `project-ar1` and no other checkout — and it consumes no GitHub-hosted minutes, which is what made the account-level refusal in the history below irrelevant to the gates themselves. Its registration token was entered once through the runner's own interactive config and is not printed, stored or quoted anywhere in this stage's outputs. Re-checked after the run: `status = online`, `busy = false`. Re-checked again after run 25: `id=21 name=dueweave-local-ci status=online busy=false version=2.337.0`, and each of that run's three expanded job logs prints `Runner name: 'dueweave-local-ci'` within its first four lines — the jobs were not silently moved to a hosted fallback when the self-hosted machine was slow. **Run 26 is the first run whose runner state had to be diagnosed rather than merely confirmed**: GitHub reported `id=21 status=offline busy=false` while that run was queued, `wsl.exe -l -v` reported `Ubuntu Stopped` and `docker-desktop Stopped` on the same host, and the boot of the distro let the *enabled* systemd unit connect and take both queued jobs inside its own startup window — after which the listener restarted twice (`_diag/Runner_20260930-165102-utc.log`, `Runner_20260930-165129-utc.log`, each ending in a `SocketException (125)` broker abort and `Deleting Runner Session...`) and a third instance at `16:52:01Z` has been stable since (`ExecMainStartTimestamp 2026-09-30 16:52:01 UTC`, `NRestarts 0`, `is-active active`). This session also created and then removed two duplicate runner hosts against the same registration (see the run-26 section), and re-verified the identity path the way every earlier run did: one `Runner.Listener` process, `Runner name: 'dueweave-local-ci'` in each job log, and `id=21 name=dueweave-local-ci status=online busy=false` before the next push. What run 26 changes about this row is not the runner's identity or labels but a fact this file had only asserted before: **a self-hosted runner's availability is a property of a workstation, and a push issued while that workstation is down produces a run whose cancellation says nothing about the code it was testing.** **Run 27 is the first push this branch made only after reading that condition rather than assuming it**: immediately before the push `gh api …/actions/runners` returned `id=21 name=dueweave-local-ci status=online busy=false version=2.337.0`, `wsl.exe -l -v` (UTF-16 output, read through `tr -d '\000'`) showed `Ubuntu Running`, `docker info` answered with 5 containers on the shared engine, the four CI ports 54321/54322/3000/8000 were free, and `pgrep -af` showed exactly one `Runner.Listener`. After the run the same readings were taken again: the three job logs each print `Runner name: 'dueweave-local-ci'` with `runner_id 21`, one runner host remains, `status=online busy=false`, the engine is back to its 5 co-tenant containers with **0** DueWeave containers and **0** DueWeave volumes, and the CI ports are free — i.e. the green run left the machine as clean as the red ones did. |
| CI WORKFLOW FILES | `.github/workflows/ci.yml` (204 lines now; the self-hosted conversion changed it in `6250a32`); `.github/actions/setup-toolchain/action.yml` (new, 29 lines — pnpm + Node 22 + frozen install, deliberately no `cache:` because the hosted cache service does not exist for self-hosted runners); `.github/actions/local-supabase/action.yml` (new, 61 lines now — release a previous job's stack, start, write env, replay from zero, prove loopback; 43 lines at first delivery, and D-S9-10 is the only change since); `.github/actions/release-local-ci-state/action.yml` (new, 33 lines — DueWeave-scoped stack stop plus a preview-port sweep limited to processes whose cwd is the workspace, never a global prune). No other workflow file exists in the repository. `main` carries **no** CI workflow at all (`git show main:.github/workflows/ci.yml` → "path exists on disk, but not in 'main'"), so the workflow ships *with* this branch. |
| CI RUN IDS | Seventeen pushed heads of this branch, each with one `event: push` run of workflow `CI`, attempt 1, each observed to completion; the **sixteenth** (`b26c428`) was pushed and observed as run 26 and is reported below, and the **seventeenth** (`1c3fb52`) was pushed, observed as run 27, and returned the branch's first three-job green since run 21 — reported job-by-job below. Runs 11-17 were GitHub-hosted and every one of them failed in 2-4 seconds without executing a step: `36533797727` (head `c682827`, 06:57:00Z), `36535054827` (`99c120f`, 07:10:11Z), `36535564240` (`cfd76fc`, 07:15:27Z), `36535840587` (`275e2f5`, 07:18:20Z), `36536245051` (`0400610`, 07:22:31Z), `36537222211` (`6b83848`, 07:32:17Z), `36537823621` (`0bb851b`, 07:38:16Z). Run 18, `36555102272` (head `ec868e8`, created 10:21:54Z, completed 10:49:02Z, **success**), is the first self-hosted run and the first run of this workflow ever to execute anything. Run 19, `36560985637` (head `f4bcc61`, started 11:19:10Z, completed 11:46:21Z, **success**), is the second and is reported job-by-job above; it doubles as the reproduction of D-S9-7 on an independent head. Run 20, `36568109443` (head `f28bae6`, the D-S9-7 repair head, started 12:26:24Z, completed 12:30:31Z, **failure**), is the third self-hosted run and is reported job-by-job below exactly as it happened: `static` success, `database` failed at the stack-start step, `browser` skipped as a dependent. Its cause was this session's own leftover scratch stack, not a repository defect, and it is preserved rather than smoothed over. Run 21, `36569878819` (head `f03fd0d`, started `2026-09-29T12:42:09Z`, completed `13:08:27Z`, **success**), is the fourth self-hosted run and the one that closes the D-S9-7 acceptance: all three jobs `completed/success` on `dueweave-local-ci` at attempt 1, with the redactor-carrying start step executing against a stack that *did* start, so both environment logs print the banner masked. Reported job-by-job and step-by-step in its own section below. Run 22, `36679362037` (head `fd2e12d`, started `2026-09-30T06:39:25Z`, completed `07:04:49Z`, **failure**), is the fifth self-hosted run: `database` and `static` both `completed success` (13/13 steps each), `browser` `failure` at step 8 `Release journeys` with step 9 not reached — the first run of this workflow to fail inside a test rather than inside a step, and the first to publish an artifact (`browser-smoke-failure-evidence`, `29 495 776 bytes`). Its cause is D-S9-9, reproduced RED before the repair and preserved in full in its own section below. Run 23, `36685163808` (head `9ee7921`, started `2026-09-30T07:41:33Z`, completed `07:45:11Z`, **failure**), is the sixth self-hosted run and carries the D-S9-9 repair: `static` `completed success` (13/13 steps, unit **26 files / 371 tests** — the +1 file / +3 tests over runs 21-22 being D-S9-9's own contract suite, so the repair is counted by the gate that ran it), `database` `failure` inside composite step 4 at its **fourth** sub-step (`Replay every committed migration`, 20 856 ms) *after* the start sub-step had succeeded in 57 463 ms with all 23 migrations applied, and `browser` `skipped` as a dependent with 0 steps. No test of any kind executed in it, so **it neither accepts nor rejects D-S9-9**. `gh api …/runs/36685163808/artifacts` → `total_count 0`. Its cause is reported in full in its own section below, including the part where the diagnosis does not close: a transient anonymous container from `realtime:v2.130.0` that the CLI launches during `db reset` exited 1 after 3.62 s, a failure not reproduced by two faithful replays, with resource exhaustion, schema content, drift, a competing stack, clock and retry each excluded by measurement — and **no repository or runner defect proven, so nothing but this file was changed**. Run 24, `36692564008` (head `567be25`, started `2026-09-30T08:53:35Z`, completed `08:57:22Z`, **failure**), is the seventh self-hosted run and the fourteenth pushed head; its only tracked change from run 23's head is this file (`git diff --numstat 9ee7921 567be25` → one path), and it died at the *same* composite sub-step as run 23 (`Replay every committed migration`, 18 961 ms) with `static` success (13/13, 26 files / 371 tests), `browser` `skipped` with 0 steps and artifacts `total_count 0` — the measurement that removed "the head under test" from the candidate list and produced D-S9-10. Run 25, `36699719286` (head `ee90097`, the D-S9-10 head, started `2026-09-30T10:00:29Z`, completed `10:23:23Z`, **failure**), is the eighth self-hosted run and the fifteenth pushed head: `static` and `database` both `completed success` 13/13 (unit **26 files / 372 tests**, the replay sub-step green at 41 858 ms with its `--debug` stream in the retained log), and `browser` `completed failure` at step 8 with `1 failed / 9 did not run / 69 passed (13.1m)` — the run that obtains D-S9-9's acceptance and whose one red test is a host name-resolution failure measured from three independent sources, with the failure-evidence artifact published (`11089879345`, `6 245 468` bytes). Run 26, `36747012514` (head `b26c428`, this file's own commit from the run-25 pass, created and started `2026-09-30T16:49:29Z`, completed `16:51:59Z`, **failure**), is the ninth self-hosted run and the sixteenth pushed head, and it executed **no gate**: `Static verification` (`109995643929`, `16:51:12Z → 16:51:27Z`) and `Database contracts` (`109995644262`, `16:51:36Z → 16:51:58Z`) both ended with step 3 `Run ./.github/actions/setup-toolchain` `cancelled` and every later step `skipped`, `Browser release smoke` (`109996654274`) was `skipped` with `steps: []`, test counts are `0 executed / 0 failed / 0 skipped / 0 did-not-run`, and artifacts `total_count 0`. Both jobs carried `runner_id 21` and printed `Runner name: 'dueweave-local-ci'` on log line 2, so they ran on this repository's own machine; both logs then recorded the runner's broker long-poll being aborted (`SocketException (125): Operation canceled` in `_diag/Runner_20260930-165102-utc.log` at `16:51:20Z` and in `Runner_20260930-165129-utc.log` at `16:51:46Z`), which is what the job text summarises as *The runner has received a shutdown signal*. The push had gone to a runner GitHub reported `offline` and a WSL distro `wsl -l -v` reported `Stopped`, with Docker Desktop's backend log empty between `16:38:54Z` and `16:51:45.188Z` — so the run was dispatched into a machine that was still booting. **It is not evidence about this repository in either direction, and nothing in the repository was changed because of it**; the runner-side faults this session added (two duplicate manual runner hosts against one registration, killed by PID after `ps` listed them) and the readiness gate now required before pushing are in its own section, limitation 28 and owner action 19. Run 27, `36751052906` (head `1c3fb52`, this file's own commit from the run-26 pass, created `2026-09-30T17:23:39Z`, started `17:23:43Z`, completed `17:50:39Z`, **success**), is the tenth self-hosted run and the seventeenth pushed head, and it is the run this recovery was commissioned to obtain: **all three jobs `completed/success` on `dueweave-local-ci`**, 41 steps of which 40 are `success` and the one non-success is the `if: failure()` artefact upload reporting `skipped`, at `run_attempt 1`, with `gh api "…/actions/runs?head_sha=1c3fb52…"` returning `total_count 1` so no second attempt or rerun is involved. Job ids `110009465872` (`static`, `17:23:43Z → 17:25:57Z`), `110009465853` (`database`, `17:26:01Z → 17:32:32Z`), `110013090596` (`browser`, `17:32:36Z → 17:50:38Z`); each carries `runner_id 21`, prints `Runner name: 'dueweave-local-ci'` in its first lines and reports labels `["self-hosted","linux","x64","dueweave-ci"]`. Test counts 372 unit / 364 pgTAP `PASS` / 307 live / 82 browser slots, 0 failed, 0 did-not-run, 0 skipped; artifacts `total_count 0`; every negative sweep 0; both red-test-of-the-previous-run lines green (`✓ 57` D-S9-9 at `17:45:17.993Z`, `✓ 70 stage9-release-journey.spec.ts:210` at `17:48:24.549Z`). Reported job-by-step and step-by-step in its own section below, including what it does and does not settle. `389fba5` has no run of its own — measured with `gh api "repos/Pavithran-R-A/project-ar1/actions/runs?head_sha=<full sha>"`, which returns `total_count = 0` for `389fba5f09de79cc0ff0c3c830d22b63fcb87683` while the same query returns `1` for `cfd76fc52f3d…` and `0400610afcff…` (a control, because the filter matches a full SHA, not a prefix). Compared against history: `36062418596` (2026-09-24, `pull_request`, head `1bb2f38`, also zero-step) and the last run that executed anything before this one, `31825803438` (2026-08-14T17:49:47Z, head `6d99651`, `success`, hosted). |
| CI HEAD SHA | Run 18's `head_sha` was read back from the remote rather than from local state: `git ls-remote origin refs/heads/current-stage-9-security-ci` → `ec868e8e71ae62c9f5eda83d126c4e70c539aa0e`, identical to the API's value and to local HEAD, and run 19's was read the same way (`f4bcc615ffd08e53dc8925568ce3f2b85dd03113`). Run 20's head was read back the same way immediately after the push: `git ls-remote origin refs/heads/current-stage-9-security-ci` → `f28bae6a6325882bacf646aabd3e2dff276d1cdf`, equal to local HEAD and to the API's `head_sha`, with the push reported as a fast-forward `f4bcc61..f28bae6` (no force, no amend, no rebase). Run 21's head was read back the same way immediately after its push: `git ls-remote origin refs/heads/current-stage-9-security-ci` → `f03fd0d20fa8edebf0cf54572a1e0b2f9f0d3bdc`, equal to local HEAD and to the API's `head_sha`, the push reported as a fast-forward `f28bae6..f03fd0d`. `refs/heads/main` was re-read after that run and is still `58f0cc76ca560bdac08bdbd19e237aa4a413686b` both on the remote and in the local clone, i.e. the branch this work runs on has not moved `main`. Run 22's head was read back the same way after its push and again before this section was written: `git ls-remote origin refs/heads/current-stage-9-security-ci` → `fd2e12dbff4692464938e22abffe44bee40fc0df`, equal to local HEAD and to the API's `head_sha`, the push reported as a fast-forward `f03fd0d..fd2e12d`; `refs/heads/main` re-read at the same moment and still `58f0cc76ca…`. Run 23's head was read back the same way after its push and again before its section was written: `git ls-remote origin refs/heads/current-stage-9-security-ci` → `9ee79212bc3dc6803cf21bc222aa79667b6bad0a`, equal to local HEAD and to the API's `head_sha`, the push reported as a fast-forward `fd2e12d..9ee7921`; `refs/heads/main` re-read at the same moment and still `58f0cc76ca…`. **A commit cannot record the CI result of its own SHA** — delivering that result needs another commit, which moves the head again; the head this file now records is therefore the head the run proved, and this file's own commit (which adds run 24's record and the D-S9-10 repair) is the next one. The D-S9-9 repair arrived as the **thirteenth** pushed head, its run (23) executed no test at all, and the **fourteenth** head — a documentation-only commit, run 24 — died at the same step, so between them they settled nothing about D-S9-9. The acceptance therefore falls to the **fifteenth** pushed head, carrying the D-S9-10 diagnostic repair, and it will be observed as the **ninth** self-hosted run — recorded as soon as it exists, not before. **It was observed, and that forward sentence was wrong in its count:** run 25 is the **eighth** self-hosted run (18→25 inclusive is eight), and it is the **fifteenth** pushed head's own run, read back the same way as every previous one — `git ls-remote origin refs/heads/current-stage-9-security-ci` → `ee9009775c8741fd42cf4bf31e6fd6ac79376f41`, equal to local HEAD and to the API's `head_sha`, the push reported as a fast-forward `567be25..ee90097` (no force, no amend, no rebase); `refs/heads/main` re-read at the same moment and still `58f0cc76ca…`. D-S9-9's acceptance is in that run and is recorded as obtained; the run 25 section has the step-by-step. The delivered head is now this file's own commit, one step past `ee90097`, whose run (26) is the ninth self-hosted one and is a re-measurement of this documentation, not a repair. **It was in fact pushed and observed, and the read-back holds the way every previous one did**: `git ls-remote origin refs/heads/current-stage-9-security-ci` → `b26c428e6df90017e9a64e47355627b086aedf57`, equal to local HEAD and to the API's `head_sha`, the push reported as a fast-forward `ee90097..b26c428` (no force, no amend, no squash, no rebase, `main` untouched); `refs/heads/main` re-read at the same moment and still `58f0cc76ca…`. Run 26 was that head's run and it was cancelled before reaching a gate, for the machine-side reason in its own section. The delivered head is now this file's own commit, one step past `b26c428`, whose run will be the **tenth** self-hosted one; it is documentation-only too, so it settles nothing about the code and it is being pushed because this file is a tracked deliverable — and, unlike the run-26 push, it went out only after `status=online`, `busy=false`, an answerable engine and free CI ports had been read. **That push was made, the read-back held, and its run is the green one recorded below**: `git ls-remote origin refs/heads/current-stage-9-security-ci` → `1c3fb52cce7e5004134b6076619d9d592b0c0132`, equal to local HEAD and to run 27's API `head_sha`, the push reported as a fast-forward `b26c428..1c3fb52` (no force, no amend, no squash, no rebase, `main` untouched); `refs/heads/main` re-read at the same moment and again after the run and still `58f0cc76ca…`. The head this file now records is therefore the head a three-job-green run proved, which is the first time in this branch's history that those are the same commit; the recording commit below it (`docs: record run 27 …`) is the eighteenth pushed head and its run (28) is unrecorded, exactly as this row has said at every previous delivery. |
| CI JOBS | `Static verification` (`static`), `Database contracts` (`database`), `Browser release smoke` (`browser`). |
| CI RESULTS | Runs 11-17 (hosted): `Static verification` and `Database contracts` **failure** with `runner_id: 0` and `steps: []`, `Browser release smoke` **skipped** — 2-4 s each, no log blob (`404 BlobNotFound`), the same billing annotation on all seven. Enumerated with job ids and verbatim text in the history section below. **Run 18 (self-hosted, head `ec868e8`): all three jobs `completed/success`, 39 of 39 executed steps `success`, no job skipped, and the one non-success step being `Upload failure evidence` = `skipped`, which is a `if: failure()` step with nothing to upload. Run 19 (self-hosted, head `f4bcc61`): the same shape — 3 of 3 jobs `completed/success`, 40 of 40 executed steps `success`, 1 `skipped` (`Upload failure evidence`, same reason), 0 timeouts, 0 retries, 0 skipped tests, 0 did-not-run, no job skipped, artifacts `total_count = 0`.** **Run 20 (self-hosted, head `f28bae6`, the D-S9-7 repair head): overall `failure` — `static` `success` (13/13 steps, unit 25 files / 368 tests), `database` `failure` (7 success, 1 failure at `Start the local Supabase stack`, 5 skipped), `browser` `skipped` because its `needs` did not pass. Root cause measured, not assumed: this session's own leftover throwaway stack held `0.0.0.0:54322` (D-S9-8). No repository change was indicated; the step failed closed exactly as designed. 0 retries, attempt 1, artifacts `total_count = 0`, and zero privileged shapes in every one of its logs.** **Run 21 (self-hosted, head `f03fd0d`, the head that carries the D-S9-7 repair): all three jobs `completed/success` on `dueweave-local-ci` at `attempt=1` — 41 steps total, 40 `success`, the one non-success being `Upload failure evidence` = `skipped` (`if: failure()`, nothing to upload). Static 25 files / 368 tests; pgTAP `Files=8, Tests=364` `Result: PASS`; `Migrations on disk: 23. Applied in the local database: 23.`; `db lint` → `No schema errors found`; live 9 files / 307 tests; browser `79 passed` + `3 passed` = 82 slots, 0 failed, 0 skipped, 0 did-not-run. Artifacts `total_count = 0`. `PGRST303` 0, `40001` 0, `timed out` 0, `retrying` 0, `Attempt [2-9]` 0. Across all 6 expanded logs: zero privileged shapes **and** both `[redacted-…]` markers present in each environment log — the masking proven on a run whose stack actually started.** **Run 22 (self-hosted, head `fd2e12d`, a documentation-only head): overall `failure` — `database` `success` (13/13 steps), `static` `success` (13/13 steps), `browser` `failure` at step 8 `Release journeys` with step 9 not reached and 13 of its 15 steps `success`, `run_attempt 1` throughout. Playwright printed `1 failed` / `4 did not run` / `74 passed (15.0m)`; the failure is `e2e/stage8-local-founder-reviewer.spec.ts:356` dying on `locator.click: Test timeout of 180000ms exceeded` with the refusal toast recorded as `subtree intercepts pointer events` for `80 ×` retries (D-S9-9). The two environment jobs were independently green at their own gate numbers (23/23 migrations, pgTAP 364 `PASS`, lint clean, live 9/307 in 142.68 s, static 25/368, secret scan 233 files / 11 shapes clean, production audit clean) and the D-S9-7 sweep on this run repeats run 21's exactly: `sb_secret_` 0 in all three logs, both `[redacted-…]` markers in each environment log, the out-of-scope publishable row once per log with the same per-file digest `aa78c6eb` as run 21. `PGRST303` 0, `40001` 0, `timed out` 0, `retrying the` 0; `retries: 0` held, so nothing reran the failing test. Artifacts `total_count = 1` — `browser-smoke-failure-evidence`, artifact `11081874125`, `29 495 776 bytes` — which is this workflow's `if: failure()` step doing its job on the first genuinely red test run.** **Run 23 (self-hosted, head `9ee7921`, the head that carries the D-S9-9 repair): overall `failure` — `static` `success` (13/13 steps, unit **26 files / 371 tests** in 2.00 s, i.e. D-S9-9's contract suite counted by the gate), `database` `failure` (7 success / 1 failure / 5 skipped, the failure inside composite step 4's fourth sub-step), `browser` `skipped` with 0 steps, `run_attempt 1` throughout, whole run 3 m 38 s of a 25+40+45 m budget.** `PGRST303` 0, `40001` 0, `timed out` 0, `retrying the` 0, `Attempt [2-9]` 0 across both executed logs; the D-S9-7 sweep repeats runs 21 and 22 exactly (`sb_secret_` 0, both `[redacted-…]` markers present in the database log, out-of-scope publishable row once). Artifacts `total_count = 0`, because the only failure-evidence upload step in this workflow is in the `browser` job and that job never started. **No suite of any kind executed in run 23, so this run is not evidence about D-S9-9 in either direction, and nothing in the repository was changed because of it**: the mechanism was read out of the Docker engine's own API record (a transient anonymous `realtime:v2.130.0` container the CLI starts during `db reset` lived 3.62 s and came back `exit 1`, where two faithful replays on the same side of the same engine took 7.69 s and succeeded), its cause is not recoverable from any retained artefact, and every candidate that could be measured was excluded.** **Run 24 (self-hosted, head `567be25`, a head that differs from run 23's by 292/35 lines of *this file alone*): overall `failure` — `database` `failure` (job `109812918474`, `08:53:38Z → 08:56:07Z`, 7 success / 1 failure / 5 skipped, the failure at composite step 4's fourth sub-step *again*, 18 961 ms after a start sub-step that applied all 23 migrations in 71 231 ms), `static` `success` (job `109812918756`, 13/13 steps, unit **26 files / 371 tests**, secret scan 234 files / 11 shapes clean), `browser` `skipped` with 0 steps and no log blob, `run_attempt 1` throughout, whole run 3 m 47 s.** Because `Database contracts` was dispatched first this time, `Static verification` queued behind it on the same single-instance runner and then passed on the same machine. `PGRST303` 0, `40001` 0, `timed out` 0, `retrying the` 0, `Attempt [2-9]` 0 in both executed logs; the D-S9-7 sweep repeats runs 21-23 (`sb_secret_` 0 in both, `[redacted-sb-secret-key-41-chars]` 1 + `[redacted-db-password]` 1 in the database log, 0 + 0 in the static one). Artifacts `total_count 0`. **Run 24 is the measurement that removes "the head under test" from the candidate list** (`.github/`, `supabase/`, `scripts/`, `package.json` and `pnpm-lock.yaml` are all byte-identical to the green run 21's), and it is the second execution proving the dead process is a transient anonymous `realtime:v2.130.0` container — full id `a50e52d7f3a9f647cd5fb7abd5a556a17653ee57e702b93a1bf56a5ccacf427d`, 3.18 s from `/start` response to shim disconnect, deleted by the CLI's own `wait?condition=removed` before anything could read it. Two passing replays of the identical command followed, one of them in the runner's own workspace directory (`reset_exit=0`, 43 s), and the `--debug` capture of a passing replay showed that `Initialising schema` runs **three** one-shot containers from that one image — so the retained logs of both red runs cannot name a stage. That retention gap is D-S9-10 and is the only thing changed because of run 24; **no repository behaviour, test, assertion, timeout, budget or `retries` value was altered, and the failure itself remains unexplained.** **Run 25 (self-hosted, head `ee90097`, the head that carries the D-S9-10 retention repair): overall `failure` — `static` `success` (job `109836054083`, `10:00:33Z → 10:01:50Z`, 13/13 steps, unit **26 files / 372 tests** — the +1 being D-S9-10's own contract case — secret scan 234 files / 11 shapes clean, production audit clean, dev-tree advisory count now **41**, inside its `continue-on-error` step), `database` `success` (job `109836054294`, `10:01:53Z → 10:07:05Z`, 13/13 steps, with the step that killed runs 23 and 24 — `Replay every committed migration` — green at **41 858 ms** and its `--debug` phase trace naming the realtime one-shot in the retained log; 23/23 migrations, pgTAP `Files=8, Tests=364` `Result: PASS`, lint clean, live 9 files / 307 tests in 128.64 s), and `browser` `failure` (job `109838318053`, `10:07:08Z → 10:23:22Z`, 11 success / step 8 `Release journeys` **failure** / step 9 skipped / steps 10-12 success), whose own replay step also passed (44 503 ms) so the repaired pipeline ran green **twice in one run on two independently started stacks**.** Playwright printed `1 failed` / `9 did not run` / `69 passed (13.1m)`; the `did not run` are the serial tail of the failing describe, not skips. **D-S9-9 is accepted by this run**: `✓ 57 … stage8-local-founder-reviewer.spec.ts:356 … (18.0s)` at `10:18:31.949Z` — the exact test run 22 lost. The one red is `e2e/stage9-release-journey.spec.ts:210` whose *body passed* and whose shared `afterEach` console/network guard received `net::ERR_NAME_NOT_RESOLVED` for the Google Fonts stylesheet `client/index.html:16-18` loads: the trace records that request never reaching a connection (`status: -1`) at `10:21:49.465Z` and the same URL resolving 29 s later only after `dns: 13 055.3 ms`, while Docker Desktop's own VM log records five WSL `getaddrinfo() failed: -3/-5` host-side failures between `10:21:43.760Z` and `10:22:49.844Z` (with `… 2110 messages dropped …` before the first) and zero in every window from `10:37:03Z` on. `PGRST303` 0, `40001` 0, `Test timeout` 0, crash/OOM markers 0, `run_attempt 1`, `retries: 0` held in both configs; artifacts `total_count 1` (`browser-smoke-failure-evidence`, id `11089879345`, `6 245 468` bytes, SHA-256 `3b441e89…de39a`, both pre-upload scans clean). **No repository or runner-software defect is proven by it, and nothing in this repository was changed because of it** — the allowance-regex, retry/timeout and font-self-hosting options were each refused for the reason stated in the run-25 section, and the exposed repository condition (the browser gate is not network-hermetic) is limitation 27 with owner actions 17-18. Full section, exclusions and honest residuals below.** **Run 26 (self-hosted, head `b26c428`, a documentation-only head whose whole diff from `ee90097` is 397/67 lines of *this file*): overall `failure` — and it is the first run of this branch whose failure executed **no gate at all**. `Static verification` (`109995643929`, `16:51:12Z → 16:51:27Z`) and `Database contracts` (`109995644262`, `16:51:36Z → 16:51:58Z`) each reached only step 3, `Run ./.github/actions/setup-toolchain`, with conclusion `cancelled`, steps 1-2 `success`, steps 4-10 `skipped` (build, unit, ESLint, TypeScript, secret scan, audits; and for `database` the `local-supabase` composite including the replay sub-step, pgTAP, lint, live contracts and `release-local-ci-state`), step 21 `Complete job` `success`; `Browser release smoke` (`109996654274`) `skipped` with `steps: []`. Test counts `0 executed / 0 failed / 0 skipped / 0 did-not-run`; artifacts `total_count 0`; `PGRST303` 0, `40001` 0, `timed out` 0, crash/OOM 0; `run_attempt 1` throughout with nothing rerun, so `retries: 0` again played no part. Both jobs carried `runner_id 21` and printed `Runner name: 'dueweave-local-ci'` on log line 2 with labels `["self-hosted","linux","x64","dueweave-ci"]`, so neither job fell back to a hosted runner, and both logs swept clean of privileged shapes (0 matching lines each).** The cancellation is not a repository gate: both logs print `##[error]The runner has received a shutdown signal…` + `A task was canceled.` while still downloading an action repository, i.e. before any command from this repository ran, and the runner's own `_diag` listener logs give the mechanism — `BrokerServer System.Net.Sockets.SocketException (125): Operation canceled` → `Get next message has been cancelled` → `Send job cancellation message to worker` → `result: Canceled` → `Deleting Runner Session…`, at `16:51:20Z` and again at `16:51:46Z`. **It is therefore not evidence about this repository in either direction, and nothing in the repository was changed because of it** — no `retries`, timeout, assertion, step, migration or workflow key. The machine condition is owned by this stage: the push went out at `16:49:29Z` to a runner GitHub reported `offline` and `wsl -l -v` reported `Ubuntu Stopped` / `docker-desktop Stopped`, with Docker Desktop's host log empty between `16:38:54Z` and `16:51:45.188Z`, so the queued run was accepted by an enabled systemd unit mid-boot; this session then made it worse by running two extra manual runner hosts beside the service (`./run.sh --replace`, a `config.sh` flag, at `16:53:53Z` and a plain `./run.sh` at `16:54:12Z`), producing `A session for this runner already exists.` / `Runner connect error: Error: Conflict`, which it removed by killing only the three PIDs it had created and leaving the service's. The first abort (`16:51:20Z`) predates Docker's own process, so its precise trigger is an unrecoverable residual and is stated as one. The procedural repair — read `status=online`, `busy=false`, an answerable engine and free CI ports before pushing — is limitation 28 and owner action 19, and it is the gate the tenth run's push was held to. Full section with the tables, verbatim text and retained log paths below. **Run 27 (self-hosted, head `1c3fb52`, a documentation-only head whose whole tracked diff from `b26c428` is this file): overall `success` — the first three-job green since run 21 and the first on any head after `f03fd0d`.** `Static verification` (job `110009465872`, `17:23:43Z → 17:25:57Z`) `completed/success` 13/13 steps: build, unit **26 files / 372 tests** in 1.71 s, ESLint, TypeScript, `Scanned 234 files for 11 credential shapes` + `No privileged credential found in the tracked tree or the built bundle`, `pnpm audit --prod --audit-level=high` → `No known vulnerabilities found`, dev-tree audit **41** inside its `continue-on-error` step. `Database contracts` (job `110009465853`, `17:26:01Z → 17:32:32Z`) `completed/success` 13/13 steps, with the composite's sub-step timings recorded in its own log: release-residue 2 411 ms, `Start the local Supabase stack` **68 374 ms**, write-env 2 029 ms, `Replay every committed migration` **43 764 ms** (the step that killed runs 23 and 24, green for a third consecutive execution and now green on a head that ran the full browser battery), loopback confirm, generated-types match, `Migrations on disk: 23. Applied in the local database: 23.`, pgTAP `Files=8, Tests=364` + `Result: PASS`, `No schema errors found`, live **9 files / 307 tests** in 149.16 s, then `Stopped supabase local development setup.` `Browser release smoke` (job `110013090596`, `17:32:36Z → 17:50:38Z`) `completed/success` 14 of 15 steps — Chromium install, bundle build, its own stack release 4 100 ms / start **66 058 ms** / replay **46 297 ms** on a second independently started stack, `Release journeys` → **`79 passed (13.3m)`**, `React warning and console discipline` → **`3 passed (43.3s)`** (82 slots, **0 failed, 0 did-not-run, 0 skipped**), both pre-upload artefact scans clean, `release-local-ci-state`, and `Upload failure evidence` `skipped` because `if: failure()` had nothing to upload on a green run. `run_attempt 1` with `total_count 1` for the head, `retries: 0` held in `playwright.config.ts:12`, artifacts `total_count 0`, `PGRST303` 0, `40001` 0, `Timeout` 0, crash/OOM 0, `ERR_NAME` 0, `retrying` 0, `Attempt [2-9]` 0 in each of the three expanded logs (817 / 689 / 641 lines), `sb_secret_` 0 in all three with both `[redacted-…]` markers present once each in the `database` and `browser` logs. **D-S9-9's and run 25's red tests are both green in this run**: `✓ 57 [chromium] › e2e/stage8-local-founder-reviewer.spec.ts:356:3 › … revoking through the reviewer's own session leaves every record and restores the limit (16.6s)` at `17:45:17.9939924Z`, and `✓ 70 [chromium] › e2e/stage9-release-journey.spec.ts:210:3 › … a stranger signs up, names the workspace, and the name is on the account (3.6s)` at `17:48:24.5490700Z`. What the run does **not** settle is stated in its own section: limitation 27's DNS dependency is untested rather than fixed (the font request resolved this time), the tree under test is run 25's product tree unchanged, and this file's recording commit is itself a new head whose run follows. Full section with the step-by-step tables, the exact log lines and the post-run machine readings below. |

### History: why the GitHub-hosted runs failed — GitHub's own words, measured

*Preserved as history, not rewritten. The resolution is the next section.*

`GET /repos/…/actions/runs/36533797727/jobs` reports for both failed jobs: `runner_id: 0`,
`runner_name: ""`, `runner_group_id: 0`, `steps: []`. The check annotation on each
(`GET /repos/…/check-runs/109293164919/annotations`) reads verbatim:

> The job was not started because recent account payments have failed or your spending limit
> needs to be increased. Please check the 'Billing & plans' section in your settings

`GET …/actions/jobs/109293164919/logs` → `404 BlobNotFound`: no log blob exists, which is
consistent with a job that never started rather than a job whose log expired.

The later heads reproduced it exactly. For run `36535054827`, jobs `109297080816`
(`Database contracts`) and `109297081054` (`Static verification`); for run `36535564240`, jobs
`109298682624` and `109298682840`; for run `36535840587`, jobs `109299563950` and `109299564185`;
for run `36536245051`, jobs `109300850561` and `109300850685`; for run `36537222211`, jobs
`109303921993` and `109303922290`; for run `36537823621`, jobs `109305857759` and `109305858091` —
each carries `runner_id: 0`, `steps: []` and this annotation, byte-identical to the earlier one:

> The job was not started because recent account payments have failed or your spending limit
> needs to be increased. Please check the 'Billing & plans' section in your settings

Re-measured across the whole hosted history of this workflow rather than by sampling: all **14**
failed jobs of runs 11-17 were enumerated from the API and their annotations fetched one by one —
28 annotations, of which the 14 refusal messages collapse to a **single distinct string** under
`sort -u` (the other 14 are GitHub's `ubuntu-latest → Ubuntu 26` label-migration notice, which is
itself evidence that those jobs were addressed at GitHub-hosted infrastructure). So the refusal is
stable across seven heads pushed between 06:57 and 07:38 UTC and is not a transient allocation
failure, and none of the seven results is a signal about this repository's contents.

The same annotation, and the same `runner_id: 0` / `steps: []` shape, is on run `36062418596`
from 2026-09-24 — which means the sentence this report's draft docs previously drew from that run
("Actions itself is working on this account; that failure was the old workflow file") was
**false**, and `docs/PR_INTEGRATION_PLAN.md` has been corrected forward-only to record the
measurement. A job with no steps never read the workflow file, so its conclusion says nothing
about workflow contents.

Repository-side settings were checked and are not the cause:
`GET /repos/…/actions/permissions` → `{"enabled": true, "allowed_actions": "all",
"sha_pinning_required": false}`. The account's actual spending state is **UNKNOWN from here**:
`GET /users/Pavithran-R-A/settings/billing/actions` requires the `user` OAuth scope, which this
token does not hold (`gist, read:org, repo, workflow`), and no billing setting was read, changed
or attempted by this stage. Whether it is a failed payment, an exhausted included-minutes quota or
a spending limit set to zero is for the account owner to determine in Settings → Billing; this
report claims only that GitHub refused the runner and said so in those words.

### How it was resolved — the same gates on the repository's own runner

The refusal was never a signal about this repository, so the repair did not touch what the gates
check. `6250a32` changed only **where** they execute and **how the environment is produced**: three
composite actions (`setup-toolchain`, `local-supabase`, `release-local-ci-state`) and
`runs-on: [self-hosted, linux, x64, dueweave-ci]` on all three jobs. The commands, assertions,
suite split, `retries: 0`, `--max-warnings=0`, `--workers=1`, the timeout budgets and the
artefact-scan scope are the same ones this report measured locally. Nothing was dropped, and no
hosted-minute consumption was attempted or waited on.

What that substitution does and does not buy, stated exactly: the run below is a real
**GitHub Actions** run — orchestrated by GitHub, with GitHub-generated run id, job ids, check names,
logs and conclusions, triggered by the ordinary `push` event, and published as the three required
status checks. It is **not** GitHub-hosted compute: the container images, the included minutes and
the `ubuntu-latest` runner image are still unavailable to this account, so a hosted-matrix claim
(Ubuntu version, image toolchain versions, hosted Docker behaviour) remains unproven here, and
execution is on Linux under WSL2 with Docker Desktop's WSL engine — see the topology caveat below.

**Run 18 (`36555102272`), head `ec868e8`, `event: push`, created 10:21:54Z, completed 10:49:02Z,
conclusion `success`, 27 m 08 s wall clock.** Every job below was read from
`GET /repos/…/actions/runs/36555102272/jobs` (per-step `name`/`status`/`conclusion`/timestamps), its
logs from `GET /repos/…/actions/jobs/<job_id>/logs`, and its check entries from
`GET /repos/…/commits/ec868e8…/check-runs` — not from a badge, and not from any local run.

| Job | job id | runner | labels | window | elapsed / budget | steps | conclusion |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `Static verification` | `109362254486` | `dueweave-local-ci` (group `Default`) | `self-hosted, linux, x64, dueweave-ci` | 10:21:58Z → 10:23:30Z | 1 m 32 s / 25 m | 13 executed, 13 `success` | **success** |
| `Database contracts` | `109362254921` | `dueweave-local-ci` | same | 10:23:33Z → 10:30:51Z | 7 m 18 s / 40 m | 13 executed, 13 `success` | **success** |
| `Browser release smoke` | `109365283798` | `dueweave-local-ci` | same | 10:30:54Z → 10:49:01Z | 18 m 07 s / 45 m | 14, 13 `success` + 1 `skipped` (`Upload failure evidence`, an `if: failure()` step with nothing to upload) | **success** |

`runner_name` is `dueweave-local-ci` on all three — not a GitHub-hosted fallback — and the check-runs
endpoint confirms the three published names (`Static verification`, `Database contracts`,
`Browser release smoke`) are `completed/success` **at this head**, which is what
`docs/RELEASE_PROTECTION.md` needs for its picker. Artifacts published: `total_count = 0`, because
the only upload step is failure-scoped.

Per-step conclusions, from the job payloads (every one `success` unless noted):

* **Static** — `Set up job`, `checkout`, `setup-toolchain`, `Build the production bundle`,
  `Unit and boundary contracts (no database)`, `ESLint`, `TypeScript`,
  `Secret and privileged-credential scan (source and bundle)`, `Production dependency audit`,
  `Development toolchain audit (recorded, not blocking)`, and the three post steps.
* **Database** — `Set up job`, `checkout`, `setup-toolchain`, `local-supabase`,
  `Generated types match the replayed schema`, `Committed migrations match the applied set`,
  `pgTAP suites inside the local database`, `Schema lint`, `Database-backed contract suites`,
  `release-local-ci-state`, post steps.
* **Browser** — `Set up job`, `checkout`, `setup-toolchain`, `local-supabase`,
  `Clear servers and reports a previous DueWeave job left behind`,
  `Install the Chromium build the suite launches`, `Build the bundle the suite drives`,
  `Release journeys` (13 m 54 s), `React warning and console discipline` (47 s),
  `Scan artefacts before uploading them`, `release-local-ci-state`,
  `Upload failure evidence` (**skipped** by design), post steps.

What the executed log lines say, quoted from the retained copies of the three job logs:

| Gate | CI-measured output |
| --- | --- |
| Unit and boundary contracts | `Test Files 24 passed (24)` / `Tests 363 passed (363)` / `Duration 2.24s` — **with no `.env.local` in the workspace** (defect D-S9-5 below) |
| ESLint / TypeScript | steps `success` under `--max-warnings=0` and `tsc --noEmit` |
| Secret scan, tracked tree + bundle | `Scanned 231 files for 11 credential shapes.` / `No privileged credential found in the tracked tree or the built bundle.` |
| Production audit | `No known vulnerabilities found` |
| Development audit (recorded, not blocking) | `38 vulnerabilities found` inside a step whose conclusion is `success` because it is `continue-on-error: true` — the step's own `##[error]Process completed with exit code 1.` line is in the log and is *not* presented as a pass |
| Schema replay | 23 `Applying migration …` lines, `WARN: no files matched pattern: supabase/seed.sql`, `Finished supabase db reset on branch current-stage-9-security-ci.`, then `Local stack present and loopback-only: http://127.0.0.1:54321 (Auth health 200).` |
| Migration set | `Migrations on disk: 23. Applied in the local database: 23.` / `The replayed schema and the qualified schema are the same migration set.` |
| Generated types | `client/src/types/database.generated.ts matches the local schema (38326 bytes).` |
| pgTAP | 8 `.sql … ok` lines, `All tests successful.` / `Files=8, Tests=364` / `Result: PASS` |
| Schema lint | `supabase db lint --local`, step `success`, no findings |
| Database-backed contracts | `Test Files 9 passed (9)` / `Tests 307 passed (307)` / `Duration 164.97s` |
| Browser release journeys | `Running 79 tests using 1 worker` → `79 passed (13.9m)` — 0 failed, 0 skipped, 0 did-not-run, and 79 distinct slot ids, so no test ran twice |
| React warning / console gate | `Running 3 tests using 1 worker` → `3 passed (43.7s)` |
| Artefact scans | `node scripts/verify-secrets.mjs --dir test-results` and `--dir playwright-report`, each `Scanned 1 files for 11 credential shapes.` with no finding (this is the step that failed with `ENOENT` on the head before `ec868e8` — defect D-S9-6) |
| PGRST303 | `grep -c PGRST303` over all three retained job logs: **0, 0, 0** |
| Timeouts / retries | no step approached its budget; `retries: 0` retained in both Playwright configs and the runner passes no `--retries` (pinned by `tests/ci-gate-manifest.contract.test.ts`) |

The `browser` job used 18 m 07 s of its 45-minute budget, `database` 7 m 18 s of 40, `static`
1 m 32 s of 25 — so the budgets are now carried by an observed number rather than by the local
estimate this file previously had to describe as unvalidated.

**Run 19 (`36560985637`), head `f4bcc61`, `event: push`, started 11:19:10Z, completed 11:46:21Z,
conclusion `success`, 27 m 11 s wall clock.** This head is the documentation-only commit that
followed `ec868e8`, so run 19 is the second full self-hosted pass and the first that had to be
observed rather than inferred — read from
`GET /repos/…/actions/runs/36560985637/jobs` (conclusion and timestamps for all 41 step entries),
its logs from `GET /repos/…/actions/runs/36560985637/logs` (43 files when expanded — 40 step logs,
one `system.txt` per job, and no file for the one skipped step; run 18's local copies had been masked
at capture, run 19's initially were not and were masked in place afterwards — the audit of both sets
is limitation 22), and its check
entries from `GET /repos/…/commits/f4bcc61…/check-runs`.

| Job | job id | runner | labels | window | elapsed / budget | steps | conclusion |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `Database contracts` | `109381523445` | `dueweave-local-ci` (group `Default`) | `self-hosted, linux, x64, dueweave-ci` | 11:19:10Z → 11:26:02Z | 6 m 52 s / 40 m | 13 executed, 13 `success` | **success** |
| `Static verification` | `109381523710` | `dueweave-local-ci` | same | 11:26:04Z → 11:28:11Z | 2 m 07 s / 25 m | 13 executed, 13 `success` | **success** |
| `Browser release smoke` | `109384660129` | `dueweave-local-ci` | same | 11:28:24Z → 11:46:11Z | 17 m 47 s / 45 m | 14, 13 `success` + 1 `skipped` (`Upload failure evidence`, `if: failure()`, nothing to upload) | **success** |

The three jobs ran **sequentially in 11:19 → 11:46**, which is what one runner does: `static` took
the second slot here rather than the first, so queue order is not a gate and no step depends on it.
`runner_name` is `dueweave-local-ci` on all three again — no hosted fallback — and the check-runs
endpoint shows all three names `completed/success` at `f4bcc61`. Artifacts: `total_count = 0`
(`gh run download` → "no valid artifacts found to download"), consistent with the failure-scoped
upload step.

Re-executed counts from this run's own log lines, all matching run 18 where the head changed nothing
executable: unit `24 files / 363 tests`; live `9 files / 307 tests` in 161.63 s; pgTAP
`Files=8, Tests=364 … Result: PASS`; `Migrations on disk: 23. Applied in the local database: 23.`;
types `matches the local schema (38326 bytes)`; lint `No schema errors found`; secret scan
`Scanned 231 files for 11 credential shapes.` with no finding; production audit `No known
vulnerabilities found`; development audit `38 vulnerabilities found` with its
`##[error]Process completed with exit code 1.` inside a `continue-on-error` step (recorded, not
blocking, and not presented as a pass); browser `79 passed (13.1m)` and the warning gate
`3 passed (41.4s)`; both artefact scans clean. **Failure markers: 0 `PGRST303`, 0 SQLSTATE `40001`,
0 test timeouts, 0 `retrying`, 0 skipped or did-not-run tests** across the 43 step files — the only
lines matching "skipped" are pnpm's `Lockfile is up to date, resolution step is skipped` in each
`setup-toolchain` step, and the only line matching "exceed" is a passing test's own title
(`races two approvals for one remaining seat and never exceeds the cap`, 2719 ms).

Run 19 also **reproduced D-S9-7 on a second, independent head**: `sb_secret_…` appears exactly once
in each environment job's step-4 log (`Database contracts/4_…local-supabase.txt:90` at
`11:21:53.065Z`, `Browser release smoke/4_…:90` at `11:31:11.303Z`), zero times in the static job,
and — newly measurable because run 19's values were hashed before the masking pass described in
limitation 22 — the two jobs of the
same run emitted the **same** privileged value (sha-256 prefix `fb2ac9b4e9c45803` for both). So the
defect is deterministic per project rather than a one-run accident, which is the property that makes
it worth a filter instead of an excuse.

### Run 20 — the D-S9-7 repair head, RED, preserved exactly as it happened

`gh api "repos/…/actions/runs?head_sha=f28bae6…"` → run `36568109443`, `event: push`,
`run_number 20`, attempt 1, created and started `12:26:24Z`, completed `12:30:31Z`,
**`status = completed`, `conclusion = failure`**, 4 m 07 s wall clock. Read job-by-job from
`GET /repos/…/actions/runs/36568109443/jobs` and from the downloaded step logs — not from the badge.

| Job | job id | runner | window | steps | conclusion |
| --- | --- | --- | --- | --- | --- |
| `Static verification` | `109405013547` | `dueweave-local-ci` (`self-hosted, linux, x64, dueweave-ci`) | 12:26:31Z → 12:28:49Z (2 m 18 s of 25 m) | 13 executed, 13 `success` | **success** |
| `Database contracts` | `109405013905` | `dueweave-local-ci` (same labels) | 12:28:53Z → 12:30:30Z (1 m 37 s of 40 m) | 13: **7 `success`, 1 `failure`, 5 `skipped`** | **failure** |
| `Browser release smoke` | `109406504750` | `runner_name` absent — never dispatched | 12:30:30Z → 12:30:30Z | 0 | `skipped` (dependent of a failed job) |

Check runs on the pushed head mirror that: `Static verification` success, `Database contracts`
failure, `Browser release smoke` skipped. Artifacts `total_count = 0` — the only upload step is the
`if: failure()` evidence step, which the *database* job's own `release-local-ci-state` step ran after
the failure (conclusion `success`), so the stack was released even on the red path.

The failing step, verbatim apart from masked values, is `Run ./.github/actions/local-supabase` →
sub-step `Start the local Supabase stack`, the step this head changed:

```
12:30:09.696Z ##[group]Run set -o pipefail
12:30:09.696Z set -o pipefail
12:30:09.696Z pnpm supabase:start 2>&1 | node scripts/redact-cli-secrets.mjs
12:30:11.915Z Starting database...
12:30:13.633Z Stopping containers...
12:30:15.132Z failed to start docker container "supabase_db_dueweave": Error response from daemon:
              failed to set up container networking: driver failed pro…
12:30:15.134Z Try stopping the project or container already using 0.0.0.0:54322 (…)
12:30:15.293Z  ELIFECYCLE  Command failed with exit code 1.
12:30:15.430Z ##[error]Process completed with exit code 1.
12:30:15.438Z ##[end-action …outcome=failure;conclusion=failure;duration_ms=5755]
```

Two things follow, and they point in opposite directions.

* **The gate worked.** A genuinely failing `supabase start` behind the new filter produced
  `##[error]Process completed with exit code 1.` and a `failure` step conclusion, then skipped the
  five downstream database steps instead of letting them run against a dead stack. That is exactly
  the behaviour `set -o pipefail` was added for, and it is now proven by a real CI execution rather
  than by a synthetic probe — see the correction in D-S9-7's row and in the disclosure.
* **The cause was this session, not the repository.** The port the CLI names (`0.0.0.0:54322`) was
  held by a **throwaway Supabase stack this stage created and forgot**: `ds97-fail-ZiL0`, 12
  containers + 3 volumes publishing 54321/54322/54323/54324/54327, up since ≈11:56Z — i.e. started
  by the pipefail probe described below, whose own closing check reported "engine not touched"
  because it grepped only for `dueweave|project-ar1` container names and so was blind to a stack it
  had named differently. Run 19 had finished at 11:46Z, before that probe. Nothing about the
  workflow, the runner or the repository needed changing: the CI step's own error line identified
  the colliding port in one read, and `pnpm supabase stop` in the action correctly refused to touch
  a stack that is not this project's.

Remediation, executed at 12:4xZ after the run completed and while the runner was idle: the 12
containers and 3 volumes whose names carry exactly that slug were removed
(`docker rm -f` / `docker volume rm` on the slug-matched set only). Measured afterwards: containers
matching the slug 0, volumes matching it 0, `dueweave|project-ar1` containers 0, listeners on
3000/3100/54321/54322 **none**, the six unrelated containers (`*_localvivaahvarnam`,
`vivaahvarnam-s5-applycheck`) still up and untouched, no Docker pruning run, `/dev/sdf` 5.2 G used /
951 G free, memory 1 666 MiB used of 7 737 with 6 070 available. The probe's temp workdir
`/tmp/ds97-fail-ZiL0` was already removed by the probe itself, which is why the stack survived it:
the directory went, the containers did not.

No code change was made in response to run 20, and none is justified: the defect it exposes is an
operator residue this session created, and the CI behaviour it exposed is the correct fail-closed
behaviour. What the next head's run had still to prove was the D-S9-7 acceptance itself — a *successful*
start whose environment logs carry zero privileged shapes — which run 20 could not show, because its
stack never reached the banner that prints them. **It was proven by the next head: see the run-21
section below for the masked banner rows and the zero-count sweep over that run's six expanded logs.**
Sweep of all of run 20's own logs for the four
privileged shapes: `sb_secret_` 0, privileged JWT 0, full publishable 0, URL-with-password 0, and 0
redaction markers — consistent with a start that failed before the banner, not with a filter that
masked a banner.

*One further count from this run is worth pinning: `static` reported `Test Files 25 passed (25)` /
`Tests 368 passed (368)` at 12:28:12Z, with `tests/ci-log-credential-redaction.contract.test.ts`
named in the file list. That is the D-S9-7 composition test executing in CI for the first time, on
the real runner, with no stack and no credentials in the job — the "MANIFEST AFTER THE D-S9-7 REPAIR"
row above can now be closed.*


### Run 21 — the D-S9-7 acceptance itself: a *successful* three-job run on the redactor-carrying head

Run 20 could not show that a successful start keeps privileged shapes out of the retained log,
because its stack never reached the banner that prints them. Run 21 is that missing proof, read
job-by-job and step-by-step from `gh api` plus the downloaded log archive — not from the badge.

| field | measured value |
| --- | --- |
| run | `36569878819` (run 21), `event: push`, workflow `CI`, `status completed`, **`conclusion success`**, `created_at` = `run_started_at` = `2026-09-29T12:42:09Z`, `updated_at` `2026-09-29T13:08:27Z` |
| head | `f03fd0d20fa8edebf0cf54572a1e0b2f9f0d3bdc` — read back with `git ls-remote origin refs/heads/current-stage-9-security-ci` before the API was consulted, equal to local HEAD and to the API's `head_sha`; push reported as fast-forward `f28bae6..f03fd0d` (no force, no amend, no squash, no rebase). This head carries `d1035d9`, i.e. `scripts/redact-cli-secrets.mjs` **and** the `set -o pipefail` start step. |
| runner, all three jobs | `dueweave-local-ci`, labels `self-hosted,linux,x64,dueweave-ci` — **not** a GitHub-hosted fallback (`runner_name` is non-null and non-`github-actions*` in each job payload, and every job executed 13-15 steps, which the seven hosted runs never did) |
| `Database contracts` | job `109410931502`, `completed success`, `12:42:13Z → 12:48:14Z` (6 m 01 s), **13 steps: 13 success / 0 failure / 0 skipped**, `attempt=1` |
| `Static verification` | job `109410931863`, `completed success`, `12:48:17Z → 12:50:22Z` (2 m 05 s), **13 steps: 13 success / 0 failure / 0 skipped**, `attempt=1` |
| `Browser release smoke` | job `109414076151`, `completed success`, `12:50:26Z → 13:08:26Z` (18 m 00 s), **15 steps: 14 success / 0 failure / 1 skipped**, `attempt=1`. The single skip is `Upload failure evidence`, the `if: failure()` step — with nothing to upload it must not run, and `artifacts total_count = 0` confirms no evidence was published. |
| step detail | Every named gate is individually `success`, including `Run ./.github/actions/local-supabase` in both stack jobs (so the pipefail-wrapped start step ran green on a real banner), `Generated types match the replayed schema`, `Committed migrations match the applied set`, `pgTAP suites inside the local database`, `Schema lint`, `Database-backed contract suites`, `Unit and boundary contracts (no database)`, `ESLint`, `TypeScript`, `Secret and privileged-credential scan (source and bundle)`, `Production dependency audit`, `Release journeys`, `React warning and console discipline`, `Scan artefacts before uploading them`, and both `Run ./.github/actions/release-local-state` (`Release any DueWeave stack a previous job left running` / `Clear servers and reports a previous DueWeave job left behind`). |
| check runs at the SHA | `Browser release smoke`, `Static verification`, `Database contracts` — all three `completed success` at `f03fd0d`, i.e. three distinct checks a required-status rule can name separately. |
| test counts, as CI printed them | static `Test Files 25 passed (25)` / `Tests 368 passed (368)` at `12:49:47Z`; pgTAP `Files=8, Tests=364` / `All tests successful.` / `Result: PASS` at `12:45:26Z`; migrations `Migrations on disk: 23. Applied in the local database: 23.` at `12:45:20Z`; `supabase db lint --local` → `No schema errors found`; live `Test Files 9 passed (9)` / `Tests 307 passed (307)` at `12:47:52Z`; browser `79 passed (13.8m)` at `13:07:22Z` plus `3 passed (42.7s)` at `13:08:07Z` = **82 slots, 0 failed, 0 skipped, 0 did-not-run**. |
| hidden-rerun and flakiness sweep | `run_attempt = 1` on all three jobs; across the expanded logs: `PGRST303` **0**, `40001` **0**, `timed out` **0**, `retrying` **0**, `Attempt [2-9]` **0**, `ELIFECYCLE` **0**. `retries: 0` is still what the browser job executed (`tests/e2e-battery-flags.contract.test.ts` is among the 25 files and is one of the tests inside the 368). |
| **the D-S9-7 acceptance** | Sweep of all 6 expanded run-21 log files, re-measured on the retained copies: the privileged family is empty — `sb_secret_…` **0**, privileged JWT `eyJ….eyJ…` **0**, connection-string-with-password **0** in every file — **and in both environment logs the redaction markers are present at the rows those shapes used to occupy**: `│ Secret │ [redacted-sb-secret-key-41-chars] │` (`2_Database contracts.txt:306` at `12:44:23Z`, `0_Browser release smoke.txt:294` at `12:52:35Z`) and `│ URL │ postgresql://[redacted-db-password]@127.0.0.1:54322/postgres │` (`:299` / `:287`). Zero privileged shapes **plus** two markers is the combination that proves masking; run 20 had zero shapes and zero markers, which only proved the banner never printed. **Two shapes that this row previously reported as `0` are in fact present, and the earlier claim was wrong**: the browser-safe `sb_publishable_…` key appears **1× per environment log** at full length (46 characters, `:305` / `:293`), and the Storage-API banner pair appears **1× per environment log** (`:313`/`:314`, the 32-hex access key and one 64-hex secret key). Both are exactly the two classes the D-S9-7 row itself declares out of scope — the publishable value is the one the filter is written to keep so a diagnosis can name the stack, and the S3 pair is a constant shipped inside the CLI binary rather than a project credential. The digests of the two publishable tokens are **identical** (`aa78c6eb…`, value not reproduced here), which re-confirms the stable-key-set behaviour recorded in that row. Corrected statement of the acceptance: **0 occurrences of the masked privileged family, 2 masked rows, and 2 retained rows that are intentionally not masked.** |
| diagnosability preserved | Everything a failed-start diagnosis needs is still in the log verbatim: `│ MCP │ http://127.0.0.1:54321/mcp │`, `│ Project URL │ http://127.0.0.1:54321 │`, `│ REST │ http://127.0.0.1:54321/rest/v1 │`, `│ GraphQL │ http://127.0.0.1:54321/graphql/v1 │`, `│ Edge Functions │ http://127.0.0.1:54321/functions/v1 │`, the storage S3 URL row, `VITE_SUPABASE_URL=http://127.0.0.1:54321`, and the action's own proof line `Local stack present and loopback-only: http://127.0.0.1:54321 (Auth health 200).` The publishable key's row is likewise present, unmasked at its full 46 characters, so a masked log still identifies the stack. |
| the one `##[error]` in the run | `1_Static verification.txt:724` → `##[error]Process completed with exit code 1.`, immediately after `38 vulnerabilities found / Severity: 1 low \| 17 moderate \| 18 high \| 2 critical`. This is the **`Development toolchain audit (recorded, not blocking)`** step, declared `continue-on-error: true` at `.github/workflows/ci.yml:82-83`; the API reports that step's conclusion as `success` and the job as `success`. It is the same recorded dev-toolchain finding as runs 18-20, not a new gate failure and not a weakened assertion — the blocking audit is `Production dependency audit`, which passed. |

Why this is the closure of the scope limit rather than another green badge: the property D-S9-7
asserts is about *retained* logs, and a log is only retained by a run that reaches the banner. Run 19
reproduced the leak on an un-repaired head; run 20 proved the start step fails closed when the stack
cannot start; run 21 is the first head on which the stack **did** start, the banner **was** printed,
and the retained copy of that banner **was** masked in both jobs that print it, with all three jobs
green on attempt 1.

One measurement in this section was re-taken because my first sweep got it wrong: I grepped for
`/rest/v1/` with a trailing slash and read 0 hits, which would have implied the filter had eaten a
browser-safe URL. The CLI prints that row as `/rest/v1` (no trailing slash), so the pattern — not the
log — was at fault; the row is present verbatim in both environment logs, quoted above.


Because a first real run on a new runner topology is exactly where an unvalidated budget or a
missing toolchain shows up (this file's old KNOWN LIMITATION 1 said so), each job was replayed
command-for-command in WSL2 Ubuntu against a **separate clean clone** at the same head — where only
`.env.example` exists, so nothing could borrow the Windows working copy's local credentials — before
any of it was pushed:

| Dry run | Result |
| --- | --- |
| install | `pnpm install --frozen-lockfile` exit 0 on the synced clone |
| static half | every step exit 0, including `pnpm test:unit` with no configured connection (the D-S9-5 proof, obtained here first) |
| database half | 11/11 steps exit 0: 23/23 migrations, pgTAP `Files=8, Tests=364 PASS`, lint clean, live `9 files / 307 tests` |
| browser half | 13/13 steps exit 0: `79 passed (13.7m)`, warning gate `3 passed (42.8s)`, both artefact scans clean, `PGRST303` grep 0. Instrumented per step: peak `used 3581 MiB` of `7737 MiB` total, minimum sampled `available 3406 MiB`, `dmesg` OOM/kill grep empty, `.wslconfig` absent (WSL default = 50 % of host RAM). **No memory was added at any point**; the browser job never came near exhaustion, so the resource question is answered by measurement rather than by assumption. |

The dry run is *not* the CI evidence — run 18 is. It is what made the push safe to make, and it is
where the phantom-artefact defect (`Scan artefacts before uploading them` → `ENOENT …
'playwright-report'`) was found and repaired instead of being discovered by a red check.

### Run 22 — the first browser-job failure a self-hosted run produced, preserved as it happened

Run 21 was green on `f03fd0d`. `fd2e12d` changed only this file, `README.md` and
`docs/RELEASE_GATE_MATRIX.md` (run-21 counts and the `G′` row), so run 22 is the first run whose
red is **not** attributable to anything its head changed: the code that failed is the code run 21
ran green. That is the whole value of this section, and it is recorded here rather than harmonised
away.

| field | measured value, from `gh api` and the downloaded logs (not the badge) |
| --- | --- |
| run | `36679362037` (run 22), `event: push`, workflow `CI`, `status completed`, **`conclusion failure`**, `created_at` = `run_started_at` = `2026-09-30T06:39:25Z`, `updated_at` `2026-09-30T07:04:49Z` |
| head | `fd2e12dbff4692464938e22abffe44bee40fc0df`, read back with `git ls-remote origin refs/heads/current-stage-9-security-ci` immediately after the push and equal to both local HEAD and the API's `head_sha`; the push was a fast-forward `f03fd0d..fd2e12d` — no force, no amend, no squash, no rebase, and `main` untouched |
| runner, all three jobs | `runner_id 21`, `runner_name dueweave-local-ci`, labels `self-hosted,linux,x64,dueweave-ci` — a real self-hosted execution, not a hosted fallback. Its workspace is now `/home/pavithran_r_a/actions-runner-dueweave/_work/DueWeave/DueWeave` (the earlier runs said `_work/project-ar1/project-ar1`), which is the repository rename showing up in the runner's own paths; nothing else about the topology changed. |
| `Database contracts` | job `109771227680`, `completed success`, `06:39:29Z → 06:45:08Z` (5 m 39 s), **13 steps, 13 `success`, 0 failure, 0 skipped**, `run_attempt 1` |
| `Static verification` | job `109771227991`, `completed success`, `06:45:11Z → 06:46:24Z` (1 m 13 s), **13 steps, 13 `success`**, `run_attempt 1` |
| `Browser release smoke` | job `109773129760`, `completed **failure**`, `06:46:28Z → 07:04:48Z` (18 m 20 s), **15 steps: 13 `success`, 1 `failure`, 1 `skipped`**, `run_attempt 1`. The failure is step 8 `Release journeys`; the skip is step 9 `React warning and console discipline`, which its own job did not reach. Steps 1-7 (`local-supabase`, the residue clear, `playwright install chromium`, the build) and 10-12 (`Scan artefacts before uploading them`, `release-local-ci-state`, `Upload failure evidence`) are all `success`. |
| the gate numbers, as CI printed them | pgTAP `Files=8, Tests=364` / `Result: PASS` (`06:42:22Z`); `Migrations on disk: 23. Applied in the local database: 23.` (`06:42:18Z`); `supabase db lint --local` → `No schema errors found` (`06:42:25Z`); live `Test Files 9 passed (9)` / `Tests 307 passed (307)` in `142.68s` (`06:44:50Z`); static `Test Files 25 passed (25)` / `Tests 368 passed (368)` (`06:45:55Z`); secret scan `Scanned 233 files for 11 credential shapes.` (`06:46:12Z`); `Production dependency audit` → `No known vulnerabilities found` (`06:46:13Z`); the recorded dev audit → `41 vulnerabilities found / Severity: 1 low \| 18 moderate \| 20 high \| 2 critical` (`06:46:16Z`), whose step conclusion the API still reports as `success` because it is the `continue-on-error: true` step at `.github/workflows/ci.yml:81-83`. |
| the browser tally | `1 failed` / `4 did not run` / `74 passed (15.0m)` at `07:04:14Z`, then ` ELIFECYCLE  Command failed with exit code 1.` at `07:04:15Z` and `##[error]Process completed with exit code 1.` at `07:04:16Z`. **The suite's own `retries: 0` held**: the failed test ran exactly once, at `run_attempt 1`, and there is no second worker, no rerun and no flaky bucket in the log. |
| the failing test | `[chromium] › e2e/stage8-local-founder-reviewer.spec.ts:356:3 › Stage 8 local Founder reviewer journey › revoking through the reviewer's own session leaves every record and restores the limit`, error `Test timeout of 180000ms exceeded.` caused by `Error: locator.click: Test timeout of 180000ms exceeded.` at `e2e/stage8-local-founder-reviewer.spec.ts:405:103`. |
| the call log, verbatim (the evidence, not an interpretation) | It resolves the target (`- locator resolved to <button type="button" class="button-primary">…</button>`), then alternates `waiting for element to be visible, enabled and stable` with the interception that blocked it: `<li class="" tabindex="0" data-index="0" data-front="true" data-type="error" … data-sonner-toast="" data-removed="false" data-visible="true" data-expanded="false">…</li> from <section … aria-label="Notifications alt+T">…</section> subtree intercepts pointer events`, and the same for its `<div data-description="">Founder access removes the active-receivable limi…</div>`. Playwright collapses the repeats: `2 × retrying click action`, `80 × retrying click action`, and a handful of `<header class="page-header">…</header> intercepts pointer events`. So the element the click was waiting for stayed under the **refusal toast** for the whole 180 s. |
| artefact | `Upload failure evidence` produced artifact `11081874125` `browser-smoke-failure-evidence`, `29 495 776 bytes`, and it is the only artifact on the run (`total_count 1` on a red run; runs 18-21 were all `0`). Downloaded and read: `test-results/stage8-local-founder-revie-75894-cord-and-restores-the-limit-chromium/test-failed-1.png` (the top-right refusal toast sitting on the Founder call-out, with the pointer over it), `error-context.md`, and `trace.zip` for the failing test. Nothing from it is committed to the repository. |
| D-S9-7 on this run | Re-swept on the retained copies of all three logs: `sb_secret_` **0**, both redaction markers present in each environment log (`r22_db.log:282`/`:289` at `06:41:10Z`, `r22_browser.log:275`/`:282` at `06:48:10Z`), the browser-safe publishable key once per environment log at its full 46 characters (the class D-S9-7 declares out of scope), and the per-file digest of that token is `aa78c6eb` in **all four** of run 21's and run 22's environment logs — the same stable per-project value, value not reproduced. `PGRST303` **0**, `40001` **0**, `timed out` **0**, `retrying the` **0** in every log. So the masking property is unchanged by this run's red, and the red is not a credential event. |

Root cause, established before anything was changed (D-S9-9 below). The journey asserts its own
refusal toast at `:402`, reads the database at `:403`, and then at `:405` clicks the
`.founder-limit-callout` button that the toast is covering. Playwright's click first *hovers* the
target — it moves the real pointer onto the button's hit point, which is inside the toast's band —
and sonner pauses a toast's auto-close while the pointer is on the notification list
(`node_modules/.pnpm/sonner@2.0.7_react-dom@19.2.1_react@19.2.1__react@19.2.1/node_modules/sonner/dist/index.js:1135-1136`
`onMouseEnter: () => setExpanded(true)` / `onMouseMove: () => setExpanded(true)`, and `:612`
`if (expanded || interacting || isDocumentHidden) { pauseTimer(); } else { startTimer(); }`).
The pointer never leaves, because the action is still waiting for the element it parked it on. So
the 9-second overlay (`REFUSAL_TOAST_MS = 9_000`, `client/src/components/ui/sonner.tsx:9`) becomes
an unbounded wait: the click can neither land nor fail early, and only the test's own 180 000 ms
budget ends it. One detail worth stating rather than smoothing: the printed snapshot reads
`data-expanded="false"`, and sonner does force `expanded` back to `false` while at most one toast
is present (`:1045-1047`), but that effect's dependency array is `[toasts]`, so a hover that
arrives *after* the list settled is not undone by it. This is the same mechanism this file already
documents at D-S9-1 (a confirmation toast over a Today-card row action, 53 retries, 120 000 ms), at
a new site — which is why it is recorded as a recurrence class and not as a novelty.

Why run 21 passed identical code: the refusal toast lives 9 s and the click's hit-test only fails
while it is still up, so the outcome is decided by the latency of the `psql` round-trip at `:403`.
On run 21 that test finished green (`✓ 57 … stage8-local-founder-reviewer.spec.ts:356:3` at
`13:02:51Z`, in 19.9 s — i.e. the refusal toast had already left by the time the click hit-tested);
on run 22 the click arrived inside the window and the hover then held the window
open forever. It is an order-dependency race in the *test*, not a regression in the product, and
`e2e/stage8-local-founder-customer.spec.ts:172` carried the same latent sequence (refusal assertion
→ database read → click on the covered button) and was simply not the one that lost the race this
time — it is among run 22's 74 passes.

### Run 23 — the D-S9-9 repair head, red *before* any suite ran, preserved as it happened

`9ee7921` carries the D-S9-9 repair (`3accf61`, the two journeys plus their new contract) and this
file, so run 23 is the first execution of the repaired suite — and therefore the run that would have
accepted D-S9-9. It never reached a test. It failed one step earlier than run 20 did, in the
composite action's fourth sub-step, and it is the first red of this workflow that is neither a gate
refusing a credential (D-S9-7), a step reacting to leftover machine state (D-S9-8) nor a test losing
a race (D-S9-9). Everything below is what was measured, including the part where the diagnosis does
not close.

| field | measured value, from `gh api`, the downloaded logs and the Docker engine's own record — not the badge |
| --- | --- |
| run | `36685163808` (run 23), `event push`, workflow `CI`, `name CI`, `headBranch current-stage-9-security-ci`, `status completed`, **`conclusion failure`**, `attempt 1`, `created_at` = `started_at` `2026-09-30T07:41:33Z`, `updated_at` `07:45:11Z` — whole run 3 m 38 s |
| head | `9ee79212bc3dc6803cf21bc222aa79667b6bad0a`, the **thirteenth** pushed head of this branch. Read back with `git ls-remote origin refs/heads/current-stage-9-security-ci` before this section was written: equal to local HEAD and to the API's `head_sha`. The push that produced it was a fast-forward `fd2e12d..9ee7921` — no force, no amend, no squash, no rebase. `refs/heads/main` read at the same moment: still `58f0cc76ca560bdac08bdbd19e237aa4a413686b`. |
| runner, all three jobs | `runner_id 21`, `runner_name dueweave-local-ci`, labels `self-hosted,linux,x64,dueweave-ci` (`gh api …/actions/jobs/109789225383` and `…/109789225163`) — a real self-hosted execution, not a hosted fallback. Workspace `/home/pavithran_r_a/actions-runner-dueweave/_work/DueWeave/DueWeave`, as in run 22. |
| `Static verification` | job `109789225163`, `completed success`, `07:41:37Z → 07:42:54Z` (1 m 17 s of 25 m), **13 steps, 13 `success`**, `run_attempt 1`. Its unit half printed `Test Files 26 passed (26)` / `Tests 371 passed (371)` in `2.00s` at `07:42:23Z`. **That is one file and three tests more than runs 21 and 22 printed (25 / 368), and the difference is D-S9-9's own `tests/e2e-refusal-toast-occlusion.contract.test.ts`** — i.e. the repair landed and the static gate counted it. Secret scan, build, ESLint, TypeScript, both audits and the recorded dev audit all `success` in the same job. |
| `Database contracts` | job `109789225383`, `completed **failure**`, `07:42:56Z → 07:45:10Z` (2 m 14 s of 40 m), **13 steps: 7 `success`, 1 `failure`, 5 `skipped`**, `run_attempt 1`. The failure is step 4 `Run ./.github/actions/local-supabase`; steps 5-9 (`Generated types match the replayed schema`, `Committed migrations match the applied set`, `pgTAP suites inside the local database`, `Schema lint`, `Database-backed contract suites`) are `skipped` because their composite step never completed. Steps 1-3 and 10-12 (`release-local-ci-state`, both post steps, `Complete job`) are `success`. |
| `Browser release smoke` | job `109790353349`, `completed **skipped**`, `started_at` = `completed_at` = `07:45:10Z`, **0 steps**, log fetched as 0 lines. Its `needs: [static, database]` did not pass. This is recorded as *nothing was executed there* — it is not evidence about the browser suite, and it is not counted as a pass anywhere in this file. |
| the composite step, sub-step by sub-step | `__run` *Release any DueWeave stack a previous job left running* `success` 3 347 ms → `__run_2` *Start the local Supabase stack* `success` **57 463 ms** → `__run_3` *Write the browser-safe local configuration* `success` 1 744 ms → `__run_4` *Replay every committed migration* **`failure` 20 856 ms** → `__run_5` *Confirm the stack is the loopback stack* `skipped` 0 ms. |
| the start sub-step, which succeeded | It brought the stack up and replayed the schema once already: the base schema, roles and **all 23 migrations applied between `07:43:45Z` and `07:44:05Z`**, and the banner arrived masked exactly as D-S9-7's repair intends — one `[redacted-sb-secret-key-41-chars]` and one `postgresql://[redacted-db-password]@127.0.0.1:54322/postgres`. So the schema content, the migration set and the CLI's ability to replay this project from zero were all proven good **60 seconds before** the step that failed. |
| the failing sub-step, verbatim (ANSI stripped, timestamps as logged) | `07:44:32.4059599Z Resetting local database...` → `07:44:33.5186078Z Recreating database...` → `07:44:46.1448662Z Initialising schema...` → `07:44:51.7439882Z error running container: exit 1` → `07:44:51.7446714Z Try rerunning the command with --debug to troubleshoot the error.` → `07:44:51.9793921Z  ELIFECYCLE  Command failed with exit code 1.` → `07:44:52.1362403Z ##[error]Process completed with exit code 1.` **No later phase line was ever printed** — no `Seeding globals from roles.sql...`, no `Applying migration …`, no `Restarting containers...`, no `Finished supabase db reset`. `--debug` was not used, because it would have been a second attempt at the same thing under a different label. |
| artefact | `total_count 0` on the run (`gh api …/runs/36685163808/artifacts` → `{"artifacts":[],"total_count":0}`). Nothing was uploaded: the only `Upload failure evidence` step in this workflow lives in the `browser` job, which was skipped, so a red `database` job produces no artefact — a real limitation of the current workflow, recorded under owner actions rather than patched here. |
| D-S9-7 sweep on this run | Both environment logs re-read from the retained download (`Static verification` 801 lines, `Database contracts` 392 lines, `Browser release smoke` 0 lines). `sb_secret_` **0** in both; `[redacted-sb-secret-key-41-chars]` **1** and `[redacted-db-password]` **1** in the database log, **0** in the static log (it never starts a stack); a privileged-role JWT **0**; the browser-safe publishable row **1** in the database log, which D-S9-7 declares out of scope; `PGRST303` **0**, SQLSTATE `40001` **0**, `timed out` **0**, `retrying the` **0**, `Attempt [2-9]` **0** in both. So the masking property survived this run unchanged, and the failure is not a credential event and not a database-serialisation event. |

**What the container that exited 1 actually was.** The CLI's message names nothing, so the engine's
own record was read instead. `Docker Desktop`'s VM log file
`$LOCALAPPDATA/Docker/log/vm/init.log.20260930-131717.048` (retained; local time is UTC+5:30, so the
file stamped 13:17:17 local covers the 07:44Z window) still carries every API call that window made:

```
07:44:46.231811  >> GET /v1.55/images/public.ecr.aws/supabase/realtime:v2.130.0/json   (linux client)
07:44:46.393467  >> POST /v1.55/containers/create                                      (linux client, no name)
07:44:46.644209  << POST /v1.55/containers/create
07:44:46.678367  >> POST /v1.55/containers/f6fec8b7e57b…/attach?stderr=1&stdout=1&stream=1
07:44:46.694306  >> POST /v1.55/containers/f6fec8b7e57b…/wait?condition=removed
07:44:46.724477  >> POST /v1.55/containers/f6fec8b7e57b…/start
07:44:47.130376  << POST /v1.55/containers/f6fec8b7e57b…/start
07:44:50.750239  shim disconnected   (containerd, id f6fec8b7e57b…)
07:44:51.044946  << POST …/wait?condition=removed
```

So the process that failed is an **anonymous, immediately-removed container built from
`public.ecr.aws/supabase/realtime:v2.130.0`**, started by the CI's own Linux CLI
(`user_agent Docker-Client/29.7.2 (linux)`), which lived **3.62 s** from the start response to the
shim disconnect and came back `exit 1`. What such a container runs was not guessed: it was captured
on a running replay (below) — the CLI's transient containers from these images carry
`CMD=["/app/bin/realtime","eval","{:ok, _} = Application.ensure_all_started(:realtime)\n{:ok, _} = Realtime.Tenants.health_check(\"realtime-dev\")"]`,
alongside a `storage-api` one running `node dist/scripts/migrate-call.js` and a `gotrue` one running
`gotrue migrate`. **The inference is stated as an inference**: `f6fec8b7`'s own `Cmd` and `stderr` are
unrecoverable, because the CLI removes the container the moment `wait?condition=removed` returns and
Docker Desktop retains no container output for a container that no longer exists (its log rotation is
≈1 MB every six minutes, so the file covering 07:44Z is the last one that will ever mention it).

**Two faithful replays, neither reproduces it.** First on the Windows side at 07:52Z, then on the
Linux side at 08:12Z — the second one is the one that matters, because run 23 executed on the Linux
side of this engine, inside `/home/pavithran_r_a/actions-runner-dueweave/_work/DueWeave/DueWeave`:

* Where: the WSL qualification clone `/home/pavithran_r_a/dueweave-qualification`, whose `supabase/`
  tree is byte-parity with the delivered head (23 migrations, aggregate digest recorded in the
  replay log), same project id `dueweave`, same CLI `2.117.0`, same image tags, same
  `package.json` scripts, and — because run 23 failed *inside* the composite action — the same
  **step order**: `supabase stop --no-backup` → `pnpm supabase:start 2>&1 \| node scripts/redact-cli-secrets.mjs`
  under `set -o pipefail` → `node scripts/local-supabase-env.mjs` → `pnpm db:reset:local`.
* What: stop `rc 0`; start ≈65 s (run 23: 57 s); env `rc 0`; **`db reset` succeeded in ≈40 s**
  (run 23's failed attempt: 20.9 s), printing `Resetting local database... Recreating database...
  Initialising schema... Seeding globals from roles.sql... ` then all 23 `Applying migration …` lines,
  `WARN: no files matched pattern: supabase/seed.sql`, `Restarting containers...` and
  `Finished supabase db reset on branch current-stage-9-security-ci.`
* With instrumentation this time, so the anonymous containers could not be lost: a 0.1 s sampler
  (`/home/pavithran_r_a/wslops/r23watch.py`, transient — written and left in the scratch directory,
  nothing in the repository) recorded every container the engine created during the replay, and for
  each transient one its image, state, exit code, `Cmd`, `Binds` and last 4 KB of output, each field
  masked by name-and-value patterns before it was ever written to disk. 37 container observations, 7
  of them transient; the full capture is `r23_watch.jsonl` and no credential appears in it.
* The same phase, side by side: the transient `realtime` container ran **8.56 s** in the replay's
  *start* phase and **7.69 s** in its *reset* phase, both to completion, while run 23's equivalent
  ran **3.62 s** and exited 1. The storage and gotrue transients took 2.3 s and 1.3 s. Nothing in the
  replay's reset output was redacted away — `2>&1` and `pipefail` were kept as the action has them.

**What was excluded, each with the reading that excludes it.**

| candidate | measurement |
| --- | --- |
| schema or migration content | The identical base schema and all 23 migrations applied successfully **inside the same job 60 s earlier** (start sub-step, `07:43:45Z–07:44:05Z`), and again in both replays. The reset never reached a `Applying migration` line, so no migration SQL was ever the thing that failed. |
| action, CLI or image drift | `.github/actions/local-supabase` unchanged since `d1035d9`; CLI `2.117.0` on both the runner and the clone; the same four image tags in both the run's log and the replay's `docker ps` output. The only newer version mentioned is the CLI's own advisory (`v2.118.0 available`), printed identically by run 21, run 22, run 23 and the replay — an advisory, not a change. |
| resource exhaustion | `df -h /` → **951 G free of 1007 G (1 % used)**; `free -m` → **6 290 MB available of 7 737 MB**; `dmesg` OOM lines **0**. A resource change was therefore **not** authorised and none was made — no `.wslconfig` edit, no memory or swap increase, no image or volume prune. |
| a competing stack mutating the engine mid-job | The whole 07:43:00–07:45:30Z window was read out of the VM log: the only `containers/create` and container-delete calls in it belong to the CI's own Linux client. The Windows-side activity in the same window is three `GET …/stats?stream=false` calls and `GET …/json` polls from `DockerDesktopUI` / `Docker-Desktop` — read-only. The unrelated `localvivaahvarnam` stack was already up since `06:34:20Z`, so it was equally present under the two green runs. |
| the `analytics`/`logflare` container dying alongside it | `supabase_analytics_dueweave` (`282c7d9a…`) took `exitCode:1` at `07:44:49.570Z` and Docker restarted it under its `unless-stopped` policy. That looks like a cause and is not one: **the identical crash happened in the passing replay** (`09ac9aa8…`, `exitCode:1`, `exitedAt 08:14:23.42Z`, `restartCount 1`) at the same point — the moment `db reset` force-removed the database container out from under it. Same collateral, opposite outcome, so it is excluded as cause. |
| the runner's clock | `systemd-resolved: Clock change detected. Flushing caches.` has fired every 30 s on this distro continuously since `06:34:48Z`, i.e. through the green runs 21 and 22 as well as through run 23 and still firing now (`08:30:57Z`, `08:31:27Z`). A chronic condition present under both outcomes cannot be the differentiator, and nothing here claims it is. |
| a retry, a rerun or a hidden second attempt | `attempt 1` on the run and on all three jobs; 0 `retrying the`, 0 `Attempt [2-9]`, 0 `timed out`, and the composite step executed once. The failure is the first and only execution. |

**What is deliberately *not* claimed.** No repository defect and no runner defect is proven by run
23, so **nothing in the repository, the workflow, the composite action, any config or any test was
changed because of it.** The observable mechanism is exact (a transient `realtime` container the CLI
launches during `db reset` exited 1 after 3.62 s instead of completing in ~7-8.6 s); the reason that
one process failed is not recoverable from any artefact this run or this machine still holds. The
four changes that would have made this run look better were each rejected before being made: rerun
the job (there is no `workflow_dispatch` and no re-run attempt to hide behind, and a rerun is what
the brief forbids), add a retry around `db:reset:local` (would convert a real signal into a
silent race), raise the `database` job's 40-minute budget (the job used 2 m 14 s), or pipe the reset
step through the redactor "so the failure is easier to read" (the step's output already carries no
privileged shape — swept above — and widening the filter mid-recovery would have changed the very
step whose behaviour this section is trying to observe).

**The one shape run 23 adds to D-S9-7's audit, measured rather than assumed.** The database log
carries the CLI's `Storage (S3)` rows with their `Access Key` (32 hex) and `Secret Key` (64 hex)
values unmasked, exactly as runs 18 and 19 did, and D-S9-7 already declines to treat them as a leak.
Run 23 lets that decline rest on a third independent measurement instead of two: the replay's own
`supabase start` at `08:13Z`, 29 minutes after run 23's, printed **byte-identical** values (compared
by length and full string equality in memory, never by printing them — both are 32 and 64 hex
characters and match character for character). A value that does not change when the stack is
destroyed, regenerated and started again on the same machine is a shipped constant, not a generated
credential, and the CLI says so one line later in the same banner: `API keys and JWT secrets are
shared defaults. Do not use in production`. They match none of the eleven shapes
`scripts/verify-secrets.mjs` scans for, and the redaction contract test feeds the banner back through
that gate, so a rule for them would have to be added to *both* files to be required by anything. No
change was made. What *is* true and stays on the record: `D-S9-7`'s filter covers the `start` step and
not the `db:reset:local` step (`action.yml:44-47`), because the reset step is the one CLI invocation
in this action that is not piped. Run 23's own reset output — its six CLI/pnpm lines, the three phase
lines and the three error lines, log lines 325-330 of the 392-line job log —
carries no privileged shape, so the asymmetry is a documented residual, not a proven leak, and it is
listed under owner actions rather than silently widened here. (Recorded as it stood at run 23: the
D-S9-10 row further down closes exactly this asymmetry, on the retention ground that the step also left
no diagnosable trace, not because a leak was found in it.)

**State run 23 left behind, checked rather than assumed.** Its `release-local-ci-state` step is
`success` and its log shows the stack it had started being released for real:
`07:44:53.986Z Stopping containers...` → `07:45:01.472Z Stopped supabase local development setup.`
(`__self_3.__run`, 10 132 ms), then the preview-port sweep (`__self_3.__run_2`, 78 ms) with no
listener to release. So a red run did **not** leave a DueWeave stack on this engine — the stack the
08:11Z snapshot found running (containers started `07:52:08Z`–`07:53:01Z`) was this session's own
Windows-side replay, stopped by this session at `08:12:59Z`, and it is the one whose `vector`
container was in a restart loop when the sampler first looked
(`status "restarting"` at `08:11:23Z`). The engine now reads: 5 containers total, all
`localvivaahvarnam`, **0** DueWeave-named containers and **0** DueWeave-named volumes of 151, no
listener on 3000/3100/54321/54322, runner `dueweave-local-ci` `online` / `busy false` with its unit
`active`. Nothing of the co-tenant's stack was touched, and no prune was run.

### Run 24 — the same step failing again on a head that changed **only this file**

`567be25` is a documentation-only commit: `git diff --numstat 9ee7921 567be25` → `292 35
current_stage9_security_ci_report.md`, one path, nothing else. So run 24 is not another attempt to
accept D-S9-9 (still no test executed in it) and not a new code shape to blame — it is the second
execution of the same step against the same machine, which is what finally rules out the reading that
run 23 left open ("the head that carried the D-S9-9 repair broke it"). Two different tracked trees,
one of them byte-identical to run 21's code, fail at the same character of the same step; the same
step succeeds minutes later when run by hand from the runner's own workspace path. Everything below is
what was measured, and the change this run produced is a retention change, not a behavioural one.

| field | measured value, from `gh api`, the downloaded logs and the Docker engine's own record — not the badge |
| --- | --- |
| run | `36692564008` (run 24), `event push`, workflow `CI`, `name CI`, `headBranch current-stage-9-security-ci`, `status completed`, **`conclusion failure`**, `attempt 1`, `created_at` = `run_started_at` `2026-09-30T08:53:35Z`, `updated_at` `08:57:22Z` — whole run 3 m 47 s |
| head | `567be2579480380b48669f08d20a7b783f3943f8`, the **fourteenth** pushed head of this branch, read back with `git ls-remote origin refs/heads/current-stage-9-security-ci` immediately after the push and again before this section was written: equal to local HEAD and to the API's `head_sha`. Fast-forward `9ee7921..567be25` — no force, no amend, no squash, no rebase. `refs/heads/main` read at the same moment: still `58f0cc76ca560bdac08bdbd19e237aa4a413686b`. |
| runner, all three jobs | `runner_id 21`, `runner_name dueweave-local-ci`, labels `self-hosted,linux,x64,dueweave-ci` — a real self-hosted execution, not a hosted fallback, for the seventh self-hosted run in a row (this cell read "eighth" when it was written — a miscount of 18→24, corrected here rather than left standing; the run-25 identity gives the arithmetic). Workspace `/home/pavithran_r_a/actions-runner-dueweave/_work/DueWeave/DueWeave`. **Job order this time: `Database contracts` started first (`08:53:38Z`) and `Static verification` queued behind it until `08:56:11Z`** — one runner instance, so the two environment classes serialise; the failing job therefore had the machine to itself, and `Static verification` passed on the same machine immediately afterwards. |
| `Database contracts` | job `109812918474`, `completed **failure**`, `08:53:38Z → 08:56:07Z` (2 m 29 s of 40 m), **13 steps: 7 `success`, 1 `failure`, 5 `skipped`**, `run_attempt 1`. Failure is step 4 `Run ./.github/actions/local-supabase` (`08:54:15Z → 08:55:50Z`); steps 5-9 (`Generated types match the replayed schema`, `Committed migrations match the applied set`, `pgTAP suites inside the local database`, `Schema lint`, `Database-backed contract suites`) `skipped` because the composite never completed; steps 1-3 and 10-12 (`release-local-ci-state`, both post steps, `Complete job`) `success`. |
| `Static verification` | job `109812918756`, `completed success`, `08:56:11Z → 08:57:21Z` (1 m 10 s of 25 m), **13 steps, 13 `success`**, `run_attempt 1`. Unit half: `Test Files 26 passed (26)` / `Tests 371 passed (371)` at `08:56:53Z` — the same counts run 23 printed, i.e. D-S9-9's contract suite is in the gate on this head too. Secret half: `Scanned 234 files for 11 credential shapes.` at `08:57:09Z`, clean. Build, ESLint, TypeScript, both audits `success` in the same job. |
| `Browser release smoke` | job `109814204614`, `completed **skipped**`, `started_at`/`completed_at` both `≈08:57:21Z`, **0 steps**, `runner_name` `null`, log request → `404 BlobNotFound` (215-byte error body, no log blob exists). Recorded as *nothing was executed there*; not evidence about the browser suite and not counted as a pass. |
| the composite step, sub-step by sub-step | `__run` *Release any DueWeave stack a previous job left running* `success` 2 338 ms → `__run_2` *Start the local Supabase stack* `success` **71 231 ms** → `__run_3` *Write the browser-safe local configuration* `success` 2 329 ms → `__run_4` *Replay every committed migration* **`failure` 18 961 ms** → `__run_5` *Confirm the stack is the loopback stack* `skipped` 0 ms. Same shape as run 23 (`57 463` / `20 856`), different numbers. |
| the failing sub-step, verbatim (ANSI stripped, timestamps as logged) | `##[group]Run pnpm db:reset:local` → `08:55:31.8874597Z > supabase db reset --local --yes` → `08:55:32.6486404Z Resetting local database...` → `08:55:33.7021685Z Recreating database...` → `08:55:44.9549678Z Initialising schema...` → `08:55:50.0794868Z error running container: exit 1` → `08:55:50.081Z Try rerunning the command with --debug to troubleshoot the error.` → `08:55:50.1746534Z  ELIFECYCLE  Command failed with exit code 1.` → `08:55:50.2635550Z ##[error]Process completed with exit code 1.` → `##[end-action id=__self_2.__run_4;outcome=failure;conclusion=failure;duration_ms=18961]`. **No later phase line was ever printed** — not `Seeding globals from roles.sql...`, not one `Applying migration …`, not `Restarting containers...`, not `Finished supabase db reset`. Byte-for-byte the same six-line shape as run 23, on a head whose only difference from `9ee7921` is this markdown file. |
| the start sub-step, which succeeded | The base schema, roles and **all 23 migrations** were applied inside it: `Initialising schema...` `08:54:32.480Z`, `Seeding globals from roles.sql...` `08:54:52.445Z`, first `Applying migration 20260812150500_secure_foundation.sql...` `08:54:52.464Z`, 23rd (`20260928090000_current_stage8_readiness_parity.sql`) `08:54:54.561Z`, sub-step closed `success` at `08:55:28.967Z`. The banner arrived masked exactly as D-S9-7 intends — one `[redacted-sb-secret-key-41-chars]`, one `postgresql://[redacted-db-password]@127.0.0.1:54322/postgres`. So schema content, the migration set and the CLI's ability to replay this project from zero were all proven good in **this same job**, ≈50 s before the step that failed. |
| artefact | `gh api …/runs/36692564008/artifacts` → `total_count 0`. As in run 23: the only `Upload failure evidence` step in this workflow is in the `browser` job, which never started, so a red `database` job publishes nothing. Already named (limitation 23, owner action 14) rather than patched here. |
| D-S9-7 sweep on this run | Both executed logs re-read from the retained downloads (`Database contracts` 407 lines, `Static verification` 783 lines, browser log has no blob). `sb_secret_` **0** in both; `[redacted-sb-secret-key-41-chars]` **1** and `[redacted-db-password]` **1** in the database log, **0** in the static log (it starts no stack); privileged-role JWT **0**; `PGRST303` **0**, SQLSTATE `40001` **0**, `timed out` **0**, `retrying the` **0**, `Attempt [2-9]` **0** in both. The masking property is unchanged across a red run for the third time (runs 20, 23, 24 all red in this step-family, all three carrying zero privileged shapes). |

**What the container that exited 1 actually was, this time named by full id.** Run 23's `Cmd` had to be
inferred from a replay because the retained record only reached a 12-character id. Run 24's window is
still on disk: `$LOCALAPPDATA/Docker/log/vm/init.log.20260930-143410.211` (filenames are local,
UTC+5:30; content is Zulu), whose coverage `08:54:52Z → 09:04:10Z` brackets the failure. Reading that
file rather than the CLI's message:

```
08:55:45.003279  >> GET  /v1.55/images/public.ecr.aws/supabase/realtime:v2.130.0/json   (linux client)
08:55:45.056781  << GET  …/realtime:v2.130.0/json
08:55:45.237987  >> POST /v1.55/containers/create                                       (linux client, no name)
08:55:45.434904  << POST /v1.55/containers/create
08:55:45.456964  >> POST /v1.55/containers/a50e52d7f3a9…/attach?stderr=1&stdout=1&stream=1
08:55:45.468061  >> POST /v1.55/containers/a50e52d7f3a9…/wait?condition=removed
08:55:45.500823  >> POST /v1.55/containers/a50e52d7f3a9…/start
08:55:45.732597  sbJoin: gwep4 ''->'76bd810f0e32'  net=supabase_network_dueweave nid=18abe844a049
08:55:45.830611  << POST /v1.55/containers/a50e52d7f3a9…/start
08:55:49.012416  shim disconnected   (containerd, id a50e52d7f3a9f647cd5fb7abd5a556a17653ee57e702b93a1bf56a5ccacf427d)
08:55:49.374665  << POST …/wait?condition=removed      → CLI prints `error running container: exit 1` at 08:55:50.079
```

So the dead process is `a50e52d7f3a9f647cd5fb7abd5a556a17653ee57e702b93a1bf56a5ccacf427d`, an
anonymous container built from `public.ecr.aws/supabase/realtime:v2.130.0` (the image lookup sits
0.23 s in front of its `create`, same client, same window), started by the CI's own Linux client, which
joined the CI's own project network and lived **3.18 s** from the `/start` response to the shim
disconnect — where run 23's equivalent lived 3.62 s and an instrumented passing replay's realtime
one-shots took 7.69 s and 8.56 s. **Its `Cmd` and `stderr` are still unrecoverable**, for the same
structural reason as run 23: the CLI issues `wait?condition=removed`, so the container is deleted the
moment it exits, and Docker Desktop retains no output for a container that no longer exists (that log
file is one of a ~1 MB / six-minute rotation set, so this is the last copy that will ever mention it).
What run 24 adds is the *next* fact: the CLI's own instruction line — `Try rerunning the command with
--debug to troubleshoot the error.` — is the only diagnostic lead the step ever leaves, and the step
was not run with it. That is D-S9-10.

**The phase the step actually dies inside, from a `--debug` capture that succeeded.** Because the
question "which of the CLI's one-shots fails?" cannot be answered from a retained red log, the same
command was run with the flag the CLI itself recommends, from the **runner's own workspace path**
(`/home/pavithran_r_a/actions-runner-dueweave/_work/DueWeave/DueWeave`, scratch output under
`/home/pavithran_r_a/r24wsdiag/`, nothing written into the repository):

```
Resetting local database...  Recreating database...  Initialising schema...
+ echo 'Running migrations'            + sudo -E -u nobody /app/bin/migrate
+ echo 'Seeding selfhosted Realtime'   + sudo -E -u nobody /app/bin/realtime eval 'Realtime.Release.seeds(Realtime.Repo)'
[os_mon] memory supervisor port (memsup): Erlang has closed
+ echo 'Starting Realtime'             + exec /app/bin/realtime eval '{:ok,_} = Application.ensure_all_started(:realtime)
                                                                   {:ok,_} = Realtime.Tenants.health_check("realtime-dev")'
Seeding globals from roles.sql...  → 23 × Applying migration …  →  WARN: no files matched pattern: supabase/seed.sql
Restarting containers...  →  Finished supabase db reset on branch current-stage-9-security-ci.   reset_exit=0
```

Two things come out of that. First, `Initialising schema` is not one container but **three** one-shots
from the same `realtime:v2.130.0` image (`migrate`, then `Realtime.Release.seeds`, then the
`ensure_all_started` + `health_check` exec), so "a transient realtime container exited 1" — the
strongest statement runs 23 and 24 support — does not yet identify *which* stage of that phase failed.
Second, the whole sequence completes in **43 s** (`09:16:42Z → 09:17:25Z` by the harness's own
state marks) and exits 0 on this machine, on this engine, in this workspace, with the co-tenant's
stack running alongside it. Only `--debug` prints the trace; without it the CLI emits the six lines
quoted above and nothing else.

**Faithful replay #2, inside the failing job's own path, step for step.** Because run 24 failed
*inside* the composite action, the replay reproduced the action's exact order and shells from a clean
start, with the ownership/hermeticity marks recorded at each boundary (`r24wsdiag/state.log`):

| boundary | measured |
| --- | --- |
| before anything | `supabase/.temp` `ABSENT`, `supabase/.branches` `ABSENT`, `supabase/snippets` `ABSENT`, `.env.local` `ABSENT`, DueWeave containers **0**, `mem_available` 6 161 MB |
| `supabase stop --no-backup` (the action's step 1, same `>/dev/null 2>&1 \|\| true`) | `rc 0` — `Stopped supabase local development setup.`; still 0 DueWeave containers |
| `set -o pipefail; pnpm supabase:start 2>&1 \| node scripts/redact-cli-secrets.mjs` | ≈57 s, 12 DueWeave containers, `supabase/snippets` created, banner masked, `mem_available` 4 397 MB |
| `node scripts/local-supabase-env.mjs` | `env_exit=0`, `Wrote browser-safe local config to .env.local` (`http://127.0.0.1:54321` + the browser-safe anon key), 12 containers |
| `pnpm db:reset:local --debug` | **`reset_exit=0` in 43 s**, full phase + 23 migrations + `Finished …` (the trace above) |
| after reset | 12 containers, each individually healthy at `09:17Z`: `db … Up 39 seconds (healthy)`, `realtime`, `auth`, `storage`, `analytics`, `kong`, `vector`, `inbucket`, `rest`, `pg_meta`, `edge_runtime`, `studio`; `mem_available` 4 341 MB |
| `supabase stop --no-backup` (harness cleanup) | `stop2_exit=0`, DueWeave containers **0**, `mem_available` 6 156 MB |

That is the same command, the same CLI (`2.117.0`), the same images, the same project id, the same
workspace directory the runner used 21 minutes earlier — returning 0. Together with the
`/home/pavithran_r_a/dueweave-qualification` replay from run 23's section, there are now **two
independent passing replays of the failing step**, one of them in the failing job's own directory.

**What was excluded, each with the reading that excludes it.**

| candidate | measurement |
| --- | --- |
| **the head being tested** | Run 23 (`9ee7921`, carries the D-S9-9 test repair) and run 24 (`567be25`, differs from it by 292/35 lines of *this file only*) fail identically at the same sub-step, so a failure that survives a docs-only head is not caused by that head. Against the last head whose `database` job was green (run 21's `f03fd0d`), the whole delta is `git diff --numstat f03fd0d 567be25` → four documentation paths plus `e2e/stage8-local-founder-customer.spec.ts`, `e2e/stage8-local-founder-reviewer.spec.ts` and `tests/e2e-refusal-toast-occlusion.contract.test.ts` (D-S9-9's repair and its contract): **`.github/`, `supabase/`, `scripts/`, `package.json` and `pnpm-lock.yaml` are all empty in that diff**, i.e. every path the composite action reads is byte-identical to the head that passed. |
| schema or migration content | Identical base schema + all 23 migrations applied **twice** in this job — inside the start sub-step at `08:54:52Z–08:54:54Z`, and again in the manual `--debug` replay — and the reset never printed a migration line, so no migration SQL was ever the failing instruction. |
| action, CLI or image drift | `.github/actions/local-supabase` unchanged since `d1035d9` until the D-S9-10 change described below; CLI `2.117.0` on the runner and in the replay; the same four image tags in the run's log and in the replay's `docker ps`. The only newer version anywhere is the CLI's own `v2.118.0 available` advisory, printed identically by runs 21-24 and by the replay — an advisory, not a change. |
| resource exhaustion | Engine-side: `df -h /` → **951 G free of 1007 G (1 % used)**; `MemAvailable` → **6 037 MB of 7 737 MB total** now, **6 161 MB before / 4 341 MB during** the replay; `dmesg` OOM lines **0**. A resource change was therefore **not** authorised and none was made — no `.wslconfig` edit, no memory or swap increase, no image or volume prune. |
| a competing stack mutating the engine mid-job | The whole `08:54:52Z → 09:04:10Z` window read out of the engine's own API log: the only `containers/create`, `attach`, `start`, `wait` and delete calls belong to `Docker-Client/29.7.2 (linux)` — the CI's own client. Every `localvivaahvarnam` (co-tenant) activity in that window is `GET …/stats?stream=false` and `GET …/json` polls from `Docker-Client (windows)` / `DockerDesktopUI` / `moby-client` — read-only. The failing container joined `supabase_network_dueweave`, the CI's own network. |
| a long-running stack container dying at the same moment | `bbf8850b5c5e…` — one of the 12 containers the *start* sub-step brought up at `08:54:55Z` — took `exitCode:1` at `08:55:50.743Z` and was restarted by the engine under its `unless-stopped` policy (`restartCount 1`). It looks like a cause and is not one: it exited **664 ms after** the CLI had already printed `error running container: exit 1` (`08:55:50.079Z`), and the identical crash at the identical moment was recorded in run 23's passing replay, where it is the expected consequence of `db reset` force-removing the database container out from under the analytics stack. Same collateral, opposite outcome. |
| the runner's clock | `systemd-resolved: Clock change detected. Flushing caches.` fires every ~30 s on this distro continuously, through the green runs 18/19/21, through the red runs 20/22/23/24, and still firing now. A chronic condition present under both outcomes cannot be the differentiator, and nothing here claims it is. |
| a retry, a rerun, or a hidden second attempt | `attempt 1` on the run and on all three jobs; `PGRST303` 0, `timed out` 0, `retrying the` 0, `Attempt [2-9]` 0 in both executed logs; the composite step executed once (`__run_4 … duration_ms=18961` appears exactly once). The failure is the first and only execution. |
| a dirty workspace | The runner's own `git clean -ffdx` removed `.env.local`, `node_modules/`, `supabase/.branches/`, `supabase/.temp/`, `supabase/snippets/` at checkout (job log lines 16-104), and the replay above ran in that same cleaned directory from `ABSENT` state through to `reset_exit=0`. |

**What is deliberately *not* claimed, and the difference that stays open.** No repository defect and
no runner defect is proven by run 24 either. The mechanism is exact and now named to the full container
id; the reason *that one process* exited 1 after 3.18 s instead of completing is not recoverable from
anything this run or this machine retains, and the honest residual is that a manual execution of the
same command in the same directory is not a *controlled* reproduction of a runner-service execution —
the job runs under the `actions.runner.*` unit's environment, this session ran under an interactive
shell. That difference was measured where it could be (same user, same paths, same engine, same CLI,
same images, same project id, and the state marks above) and is **not** closed by that measurement.
Therefore nothing about the gate's meaning was changed: no test, no assertion, no timeout, no budget,
no `retries`, no secret-scan scope, no job dependency.

**The four changes that would have made run 24 look better, each rejected before being made.** Rerun
the job (there is no `workflow_dispatch` and no second attempt to hide behind, and a rerun is what the
brief forbids); add a retry or a sleep around `db:reset:local` (would convert a real signal into a
silent race); raise the `database` job's 40-minute budget (the job used 2 m 29 s); or pipe the reset
step through the redactor "to make the failure readable" without `--debug` (the step's output already
carries no privileged shape — swept above — and a filter alone would have hidden the one line that
matters rather than adding the one that's missing).

**The one change this run did produce: D-S9-10, retention, not behaviour.** *Replay every committed
migration* in `.github/actions/local-supabase/action.yml` was the only CLI invocation in that action
not piped through anything, and it was the only one without `--debug` — so the two runs that died in
it died with no cause in any artefact. It now reads, verbatim:

```yaml
    - name: Replay every committed migration
      if: ${{ inputs.reset == 'true' }}
      shell: bash
      run: |
        set -o pipefail
        pnpm db:reset:local --debug 2>&1 | node scripts/redact-cli-secrets.mjs
```

Four properties of that line were checked rather than assumed, all on this machine against the pinned
CLI: **(1)** `--debug` is *the same command* — `pnpm db:reset:local` is `supabase db reset --local
--yes` and pnpm forwards extra args, so the gate is not being changed into a different gate; **(2)**
the exit status still reddens the step: under the runner's own shell (`/usr/bin/bash --noprofile
--norc -e -o pipefail`), an injected left-side `exit 7` through the same pipeline gave `rc=7` and the
line after it was never reached — `pipefail` is load-bearing and `bash -e` alone would have read the
filter's 0; **(3)** the wider stream the flag produces is still covered by D-S9-7's filter: fed the
privileged shapes through the actual `--debug` capture and the real redactor, `sb_secret_…` →
`[redacted-sb-secret-key-41-chars]`, a service-role JWT → `[redacted-service-role-jwt-…]`,
`postgresql://user:pass@127.0.0.1:54322/postgres` → `postgresql://[redacted-db-password]@…`, while the
anon/publishable row stays visible by design, and the rest of the trace passed through unchanged;
**(4)** `--debug`'s own output on a passing reset is 53 lines of phase trace plus the one-shots'
`set -x` — bounded, and the content that identifies *which* one-shot dies. This is a diagnostic
addition on a step whose failure mode is already proven deterministic across two heads; it declares no
fix, and if run 25 is red again the retained log will say what run 23 and run 24 could not.

**State run 24 left behind, checked rather than assumed.** Its `release-local-ci-state` step is
`success`: `08:55:50.7Z → 08:56:00Z`, `__self_3.__run` 10 374 ms then the preview-port sweep
`__self_3.__run_2` 109 ms. So a red run did **not** leave a DueWeave stack on this engine, for the
third consecutive red run. Two things this session must nonetheless record against itself. First, the
**first** verification harness for the D-S9-10 pipeline was invalid and left residue: it ran its inner
steps under `bash -c` without `-e` (so its exit-code readings proved nothing), its start step truncated
at `Starting containers...` with `rc 1`, its reset returned `127`, and the script exited before its own
cleanup — leaving `supabase_db_dueweave` healthy plus kong/auth/analytics/vector/inbucket running. That
stack was **this task's**, was stopped by this task with the project's own
`./node_modules/.bin/supabase stop --no-backup` (`rc 0`), and the failure was disclosed rather than
retried silently: the re-test used the runner's real shell flags and produced the numbers in the table
above. Second, the engine as it now reads: **5 containers, all `localvivaahvarnam`** (the co-tenant
restarted two of its own in the last few minutes — `supabase_auth_localvivaahvarnam` and
`supabase_db_localvivaahvarnam` at `Up 3 minutes`, which is that session's business and was not
touched), **0** DueWeave-named containers and **0** DueWeave-named volumes, no listener on
3000/3100/54321/54322, `dueweave-local-ci` unit `active`, runner `online` / `busy false`. No prune, no
volume removal, no unrelated-project cleanup.

### Run 25 — the D-S9-10 head: the replay step green again after two reds, and a browser job red on the host's name resolution

**Identity, read from GitHub rather than inferred.** Run `36699719286`, `event: push`,
`run_attempt 1`, `head_sha ee9009775c8741fd42cf4bf31e6fd6ac79376f41`, created `2026-09-30T10:00:29Z`,
last updated `10:23:23Z`, `status = completed`, `conclusion = failure`. The **eighth** self-hosted run
(`36555102272` through `36699719286` for 18-25 inclusive is eight; the "ninth" this file predicted while
writing the run-24 section was a miscount, corrected here rather than smoothed), and the first run since
run 22 in which all three jobs executed — runs 23 and 24 skipped `browser` because `database` died at the
migration replay, and that replay is green again here. All three jobs ran on `dueweave-local-ci`: each of
the three expanded logs prints `Runner name: 'dueweave-local-ci'` and `Current runner version:
'2.337.0'` in its first four lines and resolves its checkout to
`/home/pavithran_r_a/actions-runner-dueweave/_work/DueWeave/DueWeave`, so the self-hosted claim is read
from the logs, not from the workflow badge.

**Head read-back, before the observation.** `git ls-remote origin refs/heads/current-stage-9-security-ci`
→ `ee9009775c8741fd42cf4bf31e6fd6ac79376f41`, equal to local HEAD and to the API's `head_sha`; the push
was a fast-forward `567be25..ee90097` (no force, no amend, no rebase). `refs/heads/main` re-read at the
same moment and still `58f0cc76ca…`.

| Job | id | window | steps | outcome |
| --- | --- | --- | --- | --- |
| `Static verification` | `109836054083` | `10:00:33Z → 10:01:50Z` | 13 (1-10 + 19-21) | `completed / success`, 13 of 13 |
| `Database contracts` | `109836054294` | `10:01:53Z → 10:07:05Z` | 13 (1-10 + 19-21) | `completed / success`, 13 of 13 |
| `Browser release smoke` | `109838318053` | `10:07:08Z → 10:23:22Z` | 15 listed | `completed / failure` — 11 `success`, step 8 `Release journeys` **failure**, step 9 `React warning and console discipline` **skipped**, steps 10-12 `success`, then the 3 posts |

**`static` — 26 files / 372 tests.** ` Test Files  26 passed (26)` and `      Tests  372 passed (372)`
(log lines 283-284). The +1 test over runs 23 and 24's 371 is D-S9-10's own contract case, so the change
this head delivers is counted by the gate that guards it — the same proof shape D-S9-9 had. The secret
and privileged-credential scan reported `Scanned 234 files for 11 credential shapes.` /
`No privileged credential found in the tracked tree or the built bundle.`; the production audit reported
`No known vulnerabilities found`; the recorded-not-blocking dev-tree audit reported
`41 vulnerabilities found` / `Severity: 1 low | 18 moderate | 20 high | 2 critical` and then
`##[error]Process completed with exit code 1.` **inside a step GitHub still marks `success`** — the
`continue-on-error` shape already disclosed, now re-measured three higher than the 38 this verdict
previously quoted (third-party advisory drift, not a change in this tree; this head touched no manifest).
`redacted-` appears 0 times in this log, correctly: this job starts no stack, so it has nothing to mask.

**`database` — the step that failed in runs 23 and 24 executed and passed.** The composite's five
sub-steps and their own durations: install `__self.__run` 18 418 ms → release a previous job's stack
`__self_2.__run` 3 408 ms → start `__run_2` 68 108 ms → write env `__run_3` 1 654 ms →
**`Replay every committed migration` `__run_4` 41 858 ms, `outcome=success`** → loopback proof `__run_5`
353 ms. The replay is the D-S9-10 change and it is visible in the retained log exactly as designed: line
324 prints the command as `> supabase db reset --local --yes --debug`, and lines 336-346 carry the
one-shot's own `set -x` trace — `Seeding selfhosted Realtime`, `Starting Realtime`, then
`+ exec /app/bin/realtime eval '{:ok, _} = Application.ensure_all_started(:realtime)` /
`{:ok, _} = Realtime.Tenants.health_check("realtime-dev")'`. **Runs 23 and 24 could not name that
container; run 25's log does, on a passing replay.** `error running container` occurs 0 times; the job
log is 668 lines against run 24's 407 for the same job, which is the `--debug` widening itself and not
extra work. Downstream, every gate number repeats runs 21/22:
`Migrations on disk: 23. Applied in the local database: 23.`, pgTAP `Files=8, Tests=364` with
`Result: PASS`, `db lint` → `No schema errors found`, and the live database-backed suites at
`Test Files  9 passed (9)` / `Tests  307 passed (307)` in `128.64s`. The job's own release step ran green:
`__self_3.__run` 11 420 ms then the preview-port sweep 109 ms.

**`browser` — 1 failed / 9 did not run / 69 passed (13.1 m), and D-S9-9 is accepted.** Its `local-supabase`
step also replayed with `--debug` and also passed (`__run_4` 44 503 ms, `supabase db reset --local --yes
--debug` at its line 329, the same realtime one-shot trace at line 351), so the D-S9-10 pipeline executed
green **twice** in one run, on two independently started stacks. `Running 79 tests using 1 worker` at
`10:09:41Z`; the summary is `1 failed` / `9 did not run` / `69 passed (13.1m)`. The nine `did not run`
are not skips: they are the remaining tests of `stage9-release-journey.spec.ts`, which declares
`mode: "serial"` precisely because the second half of the money story is meaningless without the first,
so one failure in that describe stops it — and the failure was in its **first** test.

**What run 25 proves about D-S9-9.** `✓ 57 [chromium] › e2e/stage8-local-founder-reviewer.spec.ts:356:3
› … › revoking through the reviewer's own session leaves every record and restores the limit (18.0s)`,
printed at `10:18:31.949Z`. That is the exact test run 22 lost to `subtree intercepts pointer events`,
and the whole reviewer spec around it (slots 52-61) is green, in CI, on the head carrying the repair.
**Limitation 25 is closed: the acceptance D-S9-9 was owed is obtained.**

**What actually failed.** `e2e/stage9-release-journey.spec.ts:210:3` — "a stranger signs up, names the
workspace, and the name is on the account" — spent 52.1 s and **its own body passed**; the page snapshot
captured at failure shows the completed onboarding (workspace `Stage9 Release Studio 67k9sw`, owner
initials, the empty-ledger welcome, the reload having re-read the row). The red came from the shared
`test.afterEach` at line 207, `expect(drainProblems(watch)).toEqual([])`, which received two entries:

```
+   "console: Failed to load resource: net::ERR_NAME_NOT_RESOLVED [https://fonts.googleapis.com/css2?family=DM+Sans…&family=Fraunces…&display=swap]",
+   "request: GET https://fonts.googleapis.com/css2?family=DM+Sans… — net::ERR_NAME_NOT_RESOLVED",
```

Both channels reporting one event: Chromium could not resolve the name behind the stylesheet the app's
own HTML loads on every page. Those two lines are the *only* DNS-shaped records in the run —
`ERR_NAME_NOT_RESOLVED` occurs twice in 680 browser-log lines, `PGRST303` 0, `40001` 0,
`Test timeout` 0, retry/crash/OOM markers 0, `run_attempt 1` throughout, `retries: 0` held in both
configs. The failure-evidence step did its job: artifact `browser-smoke-failure-evidence`, id
`11089879345`, `6 245 468` bytes, created `10:23:13Z`, SHA-256
`3b441e890adc4f1604e78cd3382700f18674e45e63837cc9d3454572282de39a`, 27 files (the failed test's
`error-context.md`, `test-failed-1.png` and `trace.zip`, plus the report), and both pre-upload scans
came back clean (`Scanned 6 files for 11 credential shapes.` / `Scanned 22 files …` / no privileged
credential) — so limitation 23's "a red run publishes nothing" applies only to a red *`database`* run.

**Root cause, measured from three independent sources before anything was changed.**

1. *The run's own trace* (the artifact's `trace.zip`, `1-trace.network`, 45 resource snapshots). The
   failing test's **first** navigation issued `GET https://fonts.googleapis.com/css2?family=DM+Sans…` at
   `started: 2026-09-30T10:21:49.465Z` and the snapshot records `status: -1` with
   `timings: {send: -1, wait: -1, receive: -1}` — the request never reached a connection. The **same URL
   from the same page** on the test's own reload 29.3 s later
   (`10:22:18.780Z`) returned `200` from `142.250.207.234` after `time: 13 455.7 ms`, of which
   **`dns: 13 055.3 ms`**, and the `fonts.gstatic.com` webfont that CSS points at then resolved in
   `dns: 175.4 ms` → `200`. Every other request in the job — the dev/preview origin and the API origin —
   is an IP literal (`127.0.0.1:3000`, `127.0.0.1:54321`), which is why nothing else in the run had to
   consult a resolver at all.
2. *The host, in Docker Desktop's own VM log.* `%LOCALAPPDATA%\Docker\log\vm\init.log.20260930-155234.957`
   (covering `10:17:06.678Z → 10:22:34.707Z`) carries four `kmsg` lines and then continues into
   `init.log.20260930-160703.133`:
   `"... 2110 messages dropped ..."` at `10:21:43.760881507Z`,
   `"WSL (187) ERROR: CheckConnection: getaddrinfo() failed: -3"` at `10:21:43.761410622Z`,
   the same `-3` at `10:22:10.365636276Z` and `10:22:15.384103538Z`,
   `-3` again at `10:22:47.300498532Z`, and
   `"WSL (187) ERROR: CheckConnection: getaddrinfo() failed: -5"` at `10:22:49.844821246Z`.
   **Five host-side name-resolution failures inside 66 seconds, and the browser's failed request sits
   between the first and second of them.** `-3` is `EAI_AGAIN` (temporary failure in name resolution),
   `-5` is `EAI_NODATA`; the "2110 messages dropped" line means the kernel ring was being flooded before
   the first visible one. Across the retained files for this day the failure count is 3 in the window
   above, 2 in the next, and **0 in every file covering 10:37:03Z onward**, including the currently open
   one — i.e. an episode that began and ended around run 25's browser job.
3. *The 69 tests that passed in the same job, on the same page shape, before it.* Each of them loads the
   same HTML and therefore issues the same stylesheet request; all of them resolved it. The last test
   before the failure (`stage9-account-isolation.spec.ts:586`) finished at `10:21:49.014Z` — 450 ms
   before the request that could not be resolved began.

**So the first real failure of run 25 is a host name-resolution episode on this shared workstation, and
no repository or runner-software defect is proven by it.** The candidate list was worked rather than
assumed: the app never touches that origin for data (it is a stylesheet, and the journey's own assertions
all passed without it); the runner's toolchain is unchanged from run 21-24 apart from `--debug`; the
browser job started and finished inside 16.2 m of a 45 m budget with no crash marker; no memory or disk
change was made or is implied (the engine's own volume had 951 G free, and the resolution failures are
not a resource-exhaustion shape — `EAI_AGAIN` is the resolver answering "try again", not an allocator
refusing). What the episode did expose is a *repository condition*, and it is a limitation rather than a
defect: **the browser gate is not network-hermetic** — `client/index.html:16-18` preconnects to and
loads a stylesheet from `fonts.googleapis.com`, so every page load in the suite depends on a third party
the local-stack smoke cannot control, and `e2e/problem-watch.ts` fails a journey on any unanswered
request by design. New limitation 27 and owner actions 17-18.

**Nothing was changed in this repository because of run 25's red, and that is a decision, not an
omission.** The three moves available were each refused for a stated reason: adding the font URL to an
allowance regex (this is what `stage9-account-isolation.spec.ts` does for *deliberately* refused reads —
but `e2e/stage9-react-warnings.spec.ts:5-8` records the project's own doctrine: *"There is deliberately
no allowance regex in this file. If one ever appears here, the warning gate has been turned into a
mute."* — excusing a third-party outage by name is exactly that mute); raising `retries` or a timeout
(forbidden by the brief, and it would not make the product any less dependent on Google); and self-hosting
DM Sans and Fraunces, which is the honest durable fix and is a product/design change — new assets, a
visual check and a licence review — outside this stage's boundary. Owner action 18 puts it where it
belongs. Re-running an unchanged head to see whether the host recovered was also refused: that is the
"rerun until green" the brief forbids. **The run that follows this section exists because this file is a
tracked deliverable that must be pushed, not as an attempt to obtain a green**, and if it reddens on the
same two lines the conclusion is already written: the host condition is recurrent, this stage cannot
repair it from inside the repository, and Stage 9's honest ending is the narrowly identified blocker
below rather than a fourth retry of the same measurement.

**State run 25 left behind, checked rather than assumed.** `Browser release smoke` step 11 is
`release-local-ci-state` and it ran green *before* the evidence upload (`10:22:45.803Z` onward), and the
Docker engine's own record shows the stop burst it caused: `POST /v1.55/containers/<id>/stop` for nine
container ids between `10:22:49.399Z` and `10:22:49.575Z`. Re-measured after the run: `docker ps -a`
returns **5 containers, all `supabase_*_localvivaahvarnam`** (the co-tenant's own project, untouched by
this task; its `db` and `auth` show `Up 2 hours`, i.e. that session restarted them around `09:50Z`,
half an hour *before* the episode rather than during it — so this is recorded and not used as an
explanation), **0** DueWeave-named containers, no leftover volume, and the runner API at
`id=21 name=dueweave-local-ci status=online busy=false version=2.337.0`. No process started by this task
was left behind, and no prune was performed.

### Run 26 — the documentation head, cancelled before it reached a single gate

**Identity.** Run `36747012514`, workflow `CI`, `event: push`, `head_sha
b26c428e6df90017e9a64e47355627b086aedf57`, `head_branch current-stage-9-security-ci`, `run_attempt 1`,
actor `Pavithran-R-A`, created and `run_started_at 2026-09-30T16:49:29Z`, completed `16:51:59Z`, overall
conclusion `failure`. It is the **ninth** self-hosted run and the **sixteenth** pushed head, and that
head's only tracked change is this file: `git diff --numstat ee90097 b26c428` →
`397 67 current_stage9_security_ci_report.md`, one path. Nothing in `.github/`, `supabase/`, `scripts/`,
`client/`, `e2e/` or `package.json` differs from run 25's head, so this run measured the same gates run
25 measured, with no repair in it.

**What executed: nothing.**

| Job | id | window | Steps as GitHub recorded them | conclusion |
| --- | --- | --- | --- | --- |
| `Static verification` | `109995643929` | `16:51:12Z → 16:51:27Z` (15 s) | 1 `Set up job` success, 2 `Run actions/checkout@…` success, 3 `Run ./.github/actions/setup-toolchain` **cancelled**, 4-10 `skipped` (build, unit, ESLint, TypeScript, secret scan, audits), 20 `Post … checkout` skipped, 21 `Complete job` success | `failure` |
| `Database contracts` | `109995644262` | `16:51:36Z → 16:51:58Z` (22 s) | 1 success, 2 success, 3 `setup-toolchain` **cancelled**, 4-10 `skipped` — including the `local-supabase` composite and the `Replay every committed migration` sub-step that runs 23-25 turned on, pgTAP, lint, live contracts and `release-local-ci-state` — 20 skipped, 21 success | `failure` |
| `Browser release smoke` | `109996654274` | `16:51:59Z → 16:51:59Z` | `steps: []`, 0 steps, never started | `skipped` |

`runner_id: 21` on both executed jobs, and `Runner name: 'dueweave-local-ci'` on line 2 of each
downloaded log (`16:51:14.2526369Z` and `16:51:38.2991227Z`), labels
`["self-hosted","linux","x64","dueweave-ci"]` — the jobs ran on the repository's own machine and were not
moved to a hosted fallback. Test counts: **0 executed, 0 failed, 0 skipped, 0 did-not-run**, because no
job reached a step that runs a test. Artifacts `total_count 0`; the only failure-evidence upload step in
this workflow lives in the `browser` job, which never started. Both logs swept for privileged shapes
(`sb_secret_[A-Za-z0-9]{10,}`, `eyJ[A-Za-z0-9_-]{20,}`, `postgres://…:…@`) → **0 matching lines** in
each. `retries` played no part: `run_attempt 1` throughout and nothing reran.

**The failure text, verbatim, identical in both jobs** (the `database` pair is stamped `16:51:46.870Z`
and `16:51:48.103Z`):

```
2026-09-30T16:51:20.8405171Z ##[error]The runner has received a shutdown signal. This can happen when the runner service is stopped, or a manually started runner is canceled.
2026-09-30T16:51:22.0820405Z ##[error]A task was canceled.
```

Both fire while the composite step is still in `Prepare all required actions → Download action repository
'pnpm/action-setup@…'`, i.e. before a single command from this repository had run.

**Mechanism, read out of the runner's own diagnostics rather than the job log's summary.**
`_diag/Runner_20260930-165102-utc.log`, the listener that accepted the `static` job, records at
`16:51:20Z`:

```
ERR  BrokerServer System.Net.Sockets.SocketException (125): Operation canceled
INFO BrokerMessageListener Get next message has been cancelled.
INFO JobDispatcher Shutting down JobDispatcher. Make sure all WorkerDispatcher has finished.
INFO JobDispatcher Send job cancellation message to worker for job e354263e-e490-5369-b3b9-53dd1a20c849.
INFO JobDispatcher finish job request for job e354263e-… with result: Canceled
INFO Runner Deleting Runner Session...
```

and `_diag/Runner_20260930-165129-utc.log`, the listener that accepted `database`, records the same
`SocketException (125)` → `Get next message has been cancelled` → cancellation block at `16:51:46Z`. So
this is not a step's exit code, not the `concurrency: … cancel-in-progress: true` key (only one run of
this branch existed in the window), and not a gate rejecting this repository: it is the runner's
**long-poll connection to GitHub's job broker being aborted**, and a runner that loses its broker
connection cancels the job it is running and deletes its session. Three listener log files appear in a
sixty-second window — `165102`, `165129`, `165201` — i.e. the enabled systemd unit
(`actions.runner.Pavithran-R-A-project-ar1.dueweave-local-ci.service`, `is-active active`,
`ExecMainStartTimestamp 2026-09-30 16:52:01 UTC`, `NRestarts 0`) restarted the listener twice and the
third instance has been stable since.

**Why the machine was in that state — the part this stage owns.** The push left at `16:49:2xZ` for a
runner GitHub reported `offline` a minute later (`gh api …/actions/runners` → `status=offline
busy=false`), with `wsl.exe -l -v` reporting `Ubuntu Stopped` and `docker-desktop Stopped` on the same
machine. The queued run therefore waited for the workstation to boot, not for a gate to be reached; and
the command that booted it — a health check of the runner directory — let the *enabled* runner unit
connect mid-startup and accept both jobs within the next ninety seconds. Docker Desktop's own host log
has **no line between `16:38:54Z`, where its shutdown block ends, and `16:51:45.188Z`**, and its first
engine-registration line of this session is `16:51:45.237Z … 7827e830-engines ->
/run/guest-services/docker.proxy.sock dockerd`; the engine was not answerable from Ubuntu until
`16:52:0xZ`. The second broker abort (`16:51:46Z`) sits 1.6 s inside that startup window — Docker
Desktop's boot re-registers WSL distros and their network plumbing — but the first (`16:51:20Z`) is
before Docker's process existed at all, so **the two aborts cannot both be attributed to it, and the
precise trigger of the first is not recoverable from any retained record.** That is the same honest
residual runs 23 and 24 carry, and it is stated rather than smoothed.

**Two further runner faults this session caused, and removed.** At `16:53:53Z` it started
`./run.sh --replace` — `--replace` is a `config.sh` flag, so the host printed
`Unrecognized command-line input arguments for command run: 'replace'` and carried on running anyway —
and then a second manual `./run.sh` at `16:54:12Z`. Together with the systemd instance that is **three
runner hosts against one registration**, and the service log recorded precisely the condition that
configuration is known for: `The session for this runner already exists.` /
`Runner connect error: Error: Conflict. Retrying until reconnected.` at `16:54:18Z`. It cleared at
`16:59:37Z` — `Session created.` / `Runner reconnected.` / `Listening for Jobs` — after `ps` had listed
the instances by PID and the three processes this session had created (1315 `Runner.Listener run
--replace`, 1345 `./run.sh`, 1354 its listener) were killed, leaving one instance (pid 110 `runsvc.sh` →
pid 268 `Runner.Listener run --startuptype service`). No process belonging to another session was
touched, and both duplicates were written by this session inside the preceding two minutes.

**The machine state the next push was made against, read out rather than assumed.**
`gh api …/actions/runners` → `id=21 name=dueweave-local-ci status=online busy=false`; exactly one runner
host process; `docker info` → `server=29.7.2 containers=5`, `docker ps -a` names filtered for
`dueweave|project-ar1` → **0**, `docker volume ls` with the same filter → **0** — the 5 are the
co-tenant's `supabase_*_localvivaahvarnam`, brought back by Docker Desktop's own restart policy, which
nobody in this task started, stopped or pruned; `/dev/tcp` probes → `54321=free`, `54322=free`,
`3000=free`, `8000=free`, so nothing of the D-S9-8 kind was waiting for the stack-start step; and a
sampler running inside Ubuntu for the following ~70 minutes (`~/wslops/r27keep.sh` →
`~/wslops/r27watch.txt`, one timestamped tick every 20 s with `docker ps` beneath it), which both pins
the distro against the idle-teardown path that made this machine's state so unstable and makes any
container appearing mid-run attributable to a step. Both files are in the operator's WSL scratch
directory, outside the repository and outside the runner's `_work`.

**Nothing in the repository was changed because of run 26.** No `retries`, timeout, assertion, step,
migration or workflow key was altered — none of them can reach a job that never invoked a command, and
the brief forbids inflating them. The one repair is procedural and belongs to the runner's operator:
establish `status=online`, an answering engine and free CI ports *before* pushing, so a queued release
run is never dispatched into a machine that is still booting. That is limitation 28 and owner action 19,
and it is the reason the tenth run's push was delayed until those readings were taken.

### Run 27 — the delivered head, **three jobs green on `dueweave-local-ci`**, the measurement this recovery was commissioned for

Run 27 is the run the brief calls non-substitutable: a real GitHub Actions workflow, dispatched by a real
push, orchestrated by GitHub's own service, executing **all three** of this branch's release gates on the
repository's own self-hosted runner to a `completed / success` conclusion — read from GitHub's job, step
and log data, not from a badge and not from a local replay. It is recorded here exactly as measured.

| Field | Measured value |
| --- | --- |
| Run | `36751052906`, `run_number 27`, workflow `CI`, `event: push`, `run_attempt 1`, `status = completed`, `conclusion = **success**` |
| Head | `head_sha 1c3fb52cce7e5004134b6076619d9d592b0c0132` — the seventeenth pushed head of `current-stage-9-security-ci`, this file's own run-26 recording commit (`git diff --numstat b26c428 1c3fb52` → one path, 284 insertions / 25 deletions, i.e. documentation only; the product tree is run 25's unchanged) |
| Display title | `docs: record run 26, cancelled before any gate ran, and its runner-st…` |
| Times | created `2026-09-30T17:23:39Z`, first job started `17:23:43Z`, last job completed `17:50:38Z`, run `updated_at 17:50:39Z` — 27 m 0 s end to end against budgets of 25 + 40 + 45 m |
| Runs for this head | `gh api "repos/Pavithran-R-A/project-ar1/actions/runs?head_sha=1c3fb52cce7e5004134b6076619d9d592b0c0132"` → `total_count 1`, the single item being run 27 at `attempt 1`. Nothing was rerun, and the branch's `concurrency: … cancel-in-progress: true` group cancelled nothing because only one run existed. |
| Artifacts | `gh api …/runs/36751052906/artifacts` → `total_count 0`, `ids []`. The only artefact-publishing step in this workflow is the browser job's `if: failure()` evidence upload, and on a green run it is `skipped`. |
| URL | `https://github.com/Pavithran-R-A/DueWeave/actions/runs/36751052906` |

**The runner was this repository's own, for every job — not a hosted fallback.** Each of the three jobs
reports `runner_id 21` and `runner_name "dueweave-local-ci"` in the API payload, each prints
`Runner name: 'dueweave-local-ci'` inside its first lines, and each reports
`labels ["self-hosted","linux","x64","dueweave-ci"]`. No GitHub-hosted minute was consumed, and no job was
skipped.

| Job | Job id | Window | Wall vs budget | Conclusion | Steps |
| --- | --- | --- | --- | --- | --- |
| `Static verification` | `110009465872` | `17:23:43Z → 17:25:57Z` | 2 m 14 s of 25 m | `completed / success` | 13 / 13 `success` |
| `Database contracts` | `110009465853` | `17:26:01Z → 17:32:32Z` | 6 m 31 s of 40 m | `completed / success` | 13 / 13 `success` |
| `Browser release smoke` | `110013090596` | `17:32:36Z → 17:50:38Z` | 18 m 2 s of 45 m | `completed / success` | 14 `success` + 1 `skipped` |

The 4 s gaps between jobs are the single-instance runner serialising them, which is also why `static`
took the machine first this time (runs 24 and 25 dispatched `database` first) — a scheduling order, not a
dependency. 41 steps in total; 40 `success`; the one non-success is
`Upload failure evidence` = `skipped` (`if: failure()`, on a run with no failure).

**Every step, as GitHub recorded it.** `static`: Set up job · Run actions/checkout@11d5960a… ·
Run ./.github/actions/setup-toolchain · Build the production bundle · Unit and boundary contracts (no
database) · ESLint · TypeScript · Secret and privileged-credential scan (source and bundle) · Production
dependency audit · Development toolchain audit (recorded, not blocking) · Post Run
./.github/actions/setup-toolchain · Post Run actions/checkout · Complete job — all `success`.
`database`: Set up job · Run actions/checkout · Run ./.github/actions/setup-toolchain · Run
./.github/actions/local-supabase · Generated types match the replayed schema · Committed migrations match
the applied set · pgTAP suites inside the local database · Schema lint · Database-backed contract suites ·
Run ./.github/actions/release-local-ci-state · Post Run ./.github/actions/setup-toolchain · Post Run
actions/checkout · Complete job — all `success`. `browser`: Set up job · Run actions/checkout · Run
./.github/actions/setup-toolchain · Run ./.github/actions/local-supabase · Clear servers and reports a
previous DueWeave job left behind · Install the Chromium build the suite launches · Build the bundle the
suite drives · **Release journeys** · **React warning and console discipline** · Scan artefacts before
uploading them · Run ./.github/actions/release-local-ci-state · Upload failure evidence (`skipped`) · Post
Run ./.github/actions/setup-toolchain · Post Run actions/checkout · Complete job.

**The gate numbers, read out of the retained job logs** (`/tmp/r27logs/static.log` 817 lines,
`database.log` 689, `browser.log` 641, each fetched with `curl -sL …/actions/jobs/<id>/logs`, HTTP 200):

| Gate | Run 27's own line |
| --- | --- |
| Unit + boundary contracts | ` Test Files  26 passed (26)` / `      Tests  372 passed (372)` / `   Duration  1.71s` at `17:25:31.364Z` |
| Secret + privileged scan | `Scanned 234 files for 11 credential shapes.` + `No privileged credential found in the tracked tree or the built bundle.` at `17:25:45.269Z` |
| Production audit | `pnpm audit --prod --audit-level=high` → `No known vulnerabilities found` at `17:25:46.379Z` |
| Dev-toolchain audit (non-blocking step) | `41 vulnerabilities found` at `17:25:49.560Z` — the same count as run 25, inside the `continue-on-error` step limitation 5 records |
| Migration replay | `Migrations on disk: 23. Applied in the local database: 23.` at `17:29:31.858Z` |
| pgTAP | `Files=8, Tests=364,  2 wallclock secs …` + `Result: PASS` at `17:29:36.556Z` |
| Schema lint | `No schema errors found` at `17:29:39.682Z` |
| Live DB-backed contracts | ` Test Files  9 passed (9)` / `      Tests  307 passed (307)` / `   Duration  149.16s` at `17:32:10.377Z` |
| Browser release journeys | `  79 passed (13.3m)` at `17:49:28.893Z` |
| React-warning / console discipline | `Running 3 tests using 1 worker` → `  3 passed (43.3s)` at `17:50:16.789Z` |
| Pre-upload artefact scans | two clean `Scanned 1 files for 11 credential shapes.` at `17:50:17.482Z` and `17:50:17.629Z` |

82 browser slots executed with **0 failed, 0 did-not-run, 0 skipped** — which is the acceptance condition
the brief sets, and it is the number run 22 (`1 failed / 4 did not run / 74 passed`) and run 25
(`1 failed / 9 did not run / 69 passed`) each missed. No test was omitted: the browser job ran both
Playwright projects it defines, and the `did not run` class is empty because nothing failed.

**D-S9-10, re-measured where it lives.** The composite sub-step that killed runs 23 and 24 printed, in
run 27's own log, `##[start-action display=Replay every committed migration;id=__self_2.__run_4]` at
`17:28:37.902Z` and `##[end-action …outcome=success;conclusion=success;duration_ms=43764]` at
`17:29:21.659Z`; the browser job's independently started stack gave the same sub-step
`duration_ms=46297` at `17:36:00.874Z`. Across the two heads since the repair that sub-step has now
executed **four times and succeeded four times** (run 25: 41 858 ms and 44 503 ms; run 27: 43 764 ms and
46 297 ms), and the `--debug` phase trace is present in the retained log — `database.log:357`
`+ sudo -E -u nobody /app/bin/realtime eval 'Realtime.Release.seeds(Realtime.Repo)'` at `17:28:54.924Z`
and `:362` `+ exec /app/bin/realtime eval '{:ok, _} = Application.ensure_all_started(:realtime)'` at
`17:28:57.808Z`, i.e. the exact one-shot container class that died in runs 23-24 is now visible in the
log of the step that uses it. The stack-start sub-step before it took 68 374 ms here (66 058 ms in the
browser job), and the residue-release sub-step before that 2 411 ms / 4 100 ms.

**Both previously-red tests are green in this run**, and they are the same two lines runs 22 and 25 lost:

- `✓  57 [chromium] › e2e/stage8-local-founder-reviewer.spec.ts:356:3 › Stage 8 local Founder reviewer
  journey › revoking through the reviewer's own session leaves every record and restores the limit
  (16.6s)` at `17:45:17.9939924Z` — **D-S9-9's acceptance re-confirmed** (run 25 measured it at 18.0 s;
  run 22 lost it to the refusal toast intercepting pointer events).
- `✓  70 [chromium] › e2e/stage9-release-journey.spec.ts:210:3 › Stage 9 release journey, one fresh
  account end to end › a stranger signs up, names the workspace, and the name is on the account (3.6s)`
  at `17:48:24.5490700Z` — the test run 25 lost to `net::ERR_NAME_NOT_RESOLVED` inside the shared
  `afterEach` guard. `ERR_NAME` occurs **0** times in run 27's browser log, and `fonts.googleapis` occurs
  **0** times, because the stylesheet request succeeded and a passing request is not printed.

**D-S9-7's sweep, repeated on this run's three retained logs.** `sb_secret_` **0** in all three;
`eyJ….eyJ…` privileged JWT shapes **0**; a connection string carrying a password **0**; both markers
present at the rows the privileged family used to occupy, in each environment log —
`database.log:291` `│ URL │ postgresql://[redacted-db-password]@127.0.0.1:54322/postgres │` at
`17:28:34.245Z` and `:298` `│ Secret      │ [redacted-sb-secret-key-41-chars]      │` at `17:28:34.248Z`,
with the same two rows in `browser.log:291`/`:298` at `17:35:09.659Z`/`17:35:09.661Z`. The out-of-scope
browser-safe publishable row appears once per environment log as it has since run 21, and recomputed the
same way as runs 21-25 it is digest `aa78c6eb` in both — the same local stack key, not a new one. No
privileged value from any source is printed or stored in this file.

**Negative sweeps, all measured by `grep -c` on the retained logs and reported as zero:** `PGRST303` 0,
`40001` 0, `Timeout` 0, `Test timeout` 0, crash/OOM markers 0, `ERR_NAME` 0, `retrying` / `Retrying` 0,
`Attempt [2-9]` 0. `retries: 0` is unchanged at `playwright.config.ts:12`, and since 0 tests failed the
setting had nothing to rerun — which is the point: this green was not bought with a retry. No timeout was
raised, no assertion weakened, no sleep added, and no budget inflated for run 27 or because of it; the
workflow, actions, tests and migrations this run executed are byte-identical to run 25's, apart from this
file.

**Machine state after the run, re-measured** because a self-hosted runner keeps its state between jobs:
the `database` job's own release step printed `Stopped supabase local development setup.` at
`17:32:23.211Z` and the browser job ran the same action at `17:50:17.710Z`; afterwards `docker info`
reports the engine back to its **5** co-tenant containers with **0** DueWeave containers and **0**
DueWeave volumes, CI ports 54321 / 54322 / 3000 / 8000 are free, `pgrep -af 'Runner.Listener|runsvc.sh'`
shows one host (the enabled systemd unit's), and `gh api …/actions/runners` returns
`id=21 name=dueweave-local-ci status=online busy=false version=2.337.0`. The polling sampler this task
started for run 27 was the only process stopped, by PID, and its log (`~/wslops/r27watch.txt`, 1 629
lines, ending `tick=51 completed success 2026-09-30T17:50:39Z`) is kept outside the repository and
outside the runner's `_work`.

**Readiness readings taken before this push** (the owner-action-19 gate run 26 showed was needed):
`status=online`, `busy=false`, one runner host, `docker info` answering, CI ports free. The pre-push check
set was re-run on the committed diff: `git diff --check` clean, `node scripts/verify-secrets.mjs` clean,
no `.env.local`, no `dist/`, no Playwright `test-results`/`playwright-report`/traces, no runner `_work`
material and no credential in the staged content; `refs/heads/main` re-read before and after and still
`58f0cc76ca…`; PR #1 re-read and still `state=open`, `merged_at=null`, head `1bb2f38…`.

**What run 27 does not settle, stated before anyone quotes the word PASS.**

1. It does not make the browser gate network-hermetic. Run 25's red was a host DNS episode
   (limitation 27); run 27 proves that the episode did not recur during these 18 minutes, which is a
   measurement of this workstation's resolver, not a property of the test. `client/index.html:16-18`
   still loads `fonts.googleapis.com` at run time, owner actions 17-18 (self-host the font or allowlist
   the request) are still open, and a fourth run on this machine can still go red for that reason.
2. It does not re-measure the product tree. The head tested differs from run 25's only in this file, so
   every gate number above is a reproduction of run 25's environment-job numbers plus the browser battery
   run 25 never finished — valuable as a reproduction, not as a new code claim.
3. It is one machine, one workspace, one Docker engine, and now ten runs. Nothing here measures a
   GitHub-hosted image (limitation 1) or a second self-hosted host.
4. It is not a merge, a protection rule, a PR merge, a tag, a deployment or a payment activation. None of
   those happened, and `main` never moved.
5. The recursion this file has described at every delivery holds again: run 27 tested `1c3fb52`, and the
   commit that records run 27 is a new head (the eighteenth) whose run (the twenty-eighth) GitHub will
   dispatch on push. That run is a re-measurement of an unchanged tree too, and until it is read the
   delivered head is not a head with a recorded green.

---

### Self-hosted machine state: what was checked, because a runner keeps its state

A self-hosted runner is not a fresh container: the workspace, the Docker engine and any file a job
writes survive into the next job, so "green here" can mean "green because of what the last run left".
Four things were measured rather than assumed, on `ec868e8`:

1. **The static half cannot borrow a configured connection.** Its job has no `local-supabase` step,
   and `git init /home/pavithran_r_a/actions-runner-dueweave/_work/project-ar1/project-ar1` appears in
   run 18's own checkout log — run 18 *created* that workspace, so no earlier run could have left a
   `.env.local` in it, and the `.env.local` now present is dated 10:32, written by this run's own
   `local-supabase` steps. The unit half therefore passed on the runner with nothing to borrow, which
   is the property D-S9-5 restored and `tests/unit-suite-hermeticity.contract.test.ts` now pins.
2. **Each environment job re-derives what it needs.** In both the database and browser logs, in this
   order: `Release any DueWeave stack a previous job left running`, `Start the local Supabase stack`,
   `Wrote browser-safe local config to .env.local`, `Replay every committed migration` (23 unique),
   `Finished supabase db reset…`, `Local stack present and loopback-only: http://127.0.0.1:54321`.
   Nothing downstream reads a value the job did not just produce.
   State preservation cuts the other way too, and this is where D-S9-7 came from: the publishable
   key the `database` job's banner printed at 10:25:45Z is **character-for-character the same one
   the `browser` job printed at 10:32:44Z** (both `sb_publishable_ACJWlz…`, prefix only, the same
   value the `.env.local` step then wrote), so this stack's key set survives a stop/start on this
   machine instead of being regenerated per job. Run 18's local copies had already been masked, so
   the paired secret key could not be compared there; run 19's were hashed before masking, and the
   two environment jobs of that run carry the **same** `sb_secret_` value (sha-256 prefix
   `fb2ac9b4e9c45803` in both) — the stability of the privileged key is therefore measured, not
   inferred, and the consequence is stated in the defect table: a privileged value printed by a job
   is not per-run noise on a persistent runner, it recurs in every log that runner produces.
3. **Nothing leaked into the engine or the workspace.** After the run: `docker ps -a` lists **no DueWeave container and no DueWeave
   volume** (the only containers on the engine belong to an unrelated project and were not touched,
   pruned or restarted); no listener on 3000, 3100 or 54321; `git status --porcelain` inside the
   runner workspace is **empty** and its HEAD is `ec868e8`, so no job modified a tracked file;
   `release-local-ci-state` reported `success` at the end of both environment jobs. Gitignored
   residue does remain, by design and bounded: `.env.local`, `dist/`, `test-results/`,
   `playwright-report/` (workspace 472 M, whole runner directory 1.4 G) — each one either rewritten
   by the next job or explicitly cleared (`rm -rf test-results playwright-report` is the browser
   job's own first write-step), and none of it tracked. It is not uploaded on a green run either —
   the only upload step is `Upload failure evidence` with `if: failure()` (`ci.yml:195-203`), so a
   *red* run does carry `test-results` and `playwright-report` off the machine as a retained
   artefact. Worth stating beside D-S9-7: the thing that actually leaked was the job **log**, which
   the platform retains whether the job passes or fails, and which no artefact-scope gate inspects.
4. **The runner is DueWeave-only and stayed alive.** `_work/` contains `project-ar1` and the runner's
   own `_tool/_temp/_actions/_PipelineMapping` directories, and nothing else; after completion
   `GET /repos/…/actions/runners` reports `status=online busy=false`, the systemd unit is
   `active`/`enabled`, and `_diag/` holds exactly three `Worker_*.log` files for run 18 (10:21:57,
   10:23:31, 10:30:51), i.e. three jobs picked up and none retried. The kernel ring (3 963 readable
   `dmesg` lines) and the journal since 10:20 contain **0** OOM or killed-process entries.
   Post-run host: WSL root 6.5 G used / 950 G free (1 %); memory 1 604 MiB used of 7 737 MiB,
   6 132 MiB available, swap 104 MiB of 2 048. Before the run, the same figures were
   7 737 MiB total with peak 3 581 MiB used during the instrumented browser dry run. **No resource
   setting was changed on this machine during this recovery** — no `.wslconfig` was created or
   edited, no memory or disk was added, no Docker pruning was run.

The same four checks were re-run after **run 19**, because a second observation is what shows whether
the first one depended on a freshly-created workspace. All of them held: the runner workspace's HEAD
is `f4bcc61` with `git status --porcelain` **empty** (41 step entries, no tracked file touched by any
of them); `.env.local` `dist/` `test-results/` `playwright-report/` are present again and each is
dated inside run 19's own window (11:31:13Z / 11:32:07Z / 11:45:58Z / 11:45:58Z), i.e. rewritten by
this run rather than inherited; workspace 473 M, whole runner directory 1.4 G; `docker ps -a` and
`docker volume ls` grepped for `dueweave|project-ar1` → **0 and 0**, with the same five unrelated
`localvivaahvarnam` containers up and untouched; no listener on 3000/3100/54321/54322 in the Ubuntu
namespace; the systemd unit `active` throughout (same `MainPID 2002`, started 09:15:15Z, so the
runner survived both runs without a restart); host memory at measurement 1 707 MiB used of
7 737 MiB, 6 030 MiB available, swap 141 MiB of 2 048, disk unchanged at 6.5 G / 950 G.

A third pass of the machine-state check came from the D-S9-7 verification itself, which had to start
a stack locally: it was run in the throwaway qualification clone, *that* stack's containers and
volumes were gone again when the script finished, the unrelated stack was never touched, and the two
scratch logs it created were masked in place before being left behind. **This paragraph previously
claimed more than it could support**, and the over-claim cost a CI run: the same verification's
follow-up probe started a second throwaway stack under a different slug, the closing check grepped
only `dueweave|project-ar1`, found nothing, and reported "no listener on the CI ports / engine not
touched" — while 54321/54322 were in fact held by that slug, which is what failed run 20's stack
start four minutes later. The residue is described and removed in D-S9-8 and the run 20 section; the
general rule this stage now states is that on a *shared* engine, "the engine is as I found it"
requires diffing the full container list against a pre-command snapshot, not filtering it by the
project's own name. That is the same failure mode D-S9-7 is about, one level down: a check scoped to
what you expect to see cannot see what you did not.

The residual risk that this cannot retire: one machine, one workspace, one Docker engine. The
topology, measured rather than described: Ubuntu 26.04 LTS under WSL2 (kernel
`6.18.33.2-microsoft-standard-WSL2`), Docker 29.7.2 from this machine's own Docker Desktop engine,
Node 22 installed per job by `setup-node`. A second push to the same ref **cancels** the in-flight
run rather than queueing behind it (`concurrency.cancel-in-progress: true`), which is the correct
behaviour for a single runner that must not be shared by two DueWeave stacks at once — but it also
means a run can end as `cancelled` without any gate having failed, and a cancelled check is not a
pass. And a green check now depends on this workstation being on, online and healthy: the runner
reports `offline` intermittently while its long-poll cycles (observed once during this
measurement, `online` again 20 s later), so a "no runners respond" state is an operator-environment
condition to check before suspecting the code.


**PHASE 28 falsification was performed locally, not in CI,** as the brief permits ("Prefer local
workflow-equivalent falsification when sufficient"), because at the time no CI mutation could be
observed at all while hosted runners were refused. Items 1 and 2 were run before the push; items 3
and 4 were run afterwards, in the same clean clone, to prove that the two defects the real run
exposed are still caught if they ever return — every one reverted after measurement, with the tree
verified clean again:

1. *The retry pin bites.* With `retries` raised from `0` in `playwright.config.ts`,
   `tests/ci-gate-manifest.contract.test.ts` failed on its own gate ("`--retries`" / `retries: 0`
   assertion), and passed again after the revert — measured, gate 9 green, config back to
   `retries: 0` at `playwright.config.ts:12`.
2. *The secret scan bites, and only on real scope.* Planting a synthetic privileged-shaped
   credential first into an **untracked** file produced `exit=0` and an unchanged file count —
   which localised the scanner's real scope (tracked tree + `dist/`) rather than the whole
   directory. Re-planting into tracked `todo.md:137` produced `exit=1` naming
   `todo.md:137: HARD supabase-secret-key`, with the value masked as `sb_secret_… (30 chars)`.
   The line was then deleted, the file restored byte-for-byte to its HEAD content (`git status
   --porcelain todo.md` empty at the time of the closing gates), and `pnpm verify:secrets`
   re-measured `exit=0`. A HARD shape cannot be allowlisted at all, which is the property that
   makes the exception list rot-proof.
3. *The hermeticity pin bites, and it names the right file.* Re-run after the fix, in the WSL2 clean
   clone, with its `.env.local` moved aside: at `ec868e8` the unit half reports 24/363 with 0 skipped
   on an unconfigured tree. Then the same command against only the two **pre-fix** files
   (`git checkout 0bb851b -- client/src/hooks/useSupabaseAuth.ts
   client/src/hooks/sign-up-outcome.test.ts`, nothing else touched) reported
   `Test Files 3 failed | 21 passed (24)`, `Tests 2 failed | 356 passed (358)`, with
   `sign-up-outcome.test.ts` failing to collect (`Error: DueWeave needs its secure connection
   configured before it can open.`) and `tests/unit-suite-hermeticity.contract.test.ts` failing by
   naming exactly that file. Both files were restored with `git checkout HEAD --` and the env file
   moved back; `git status --porcelain` in the clone is empty. This is the RED that D-S9-5's table
   row claims, measured end to end rather than quoted from the commit message.
4. *The bundle-credential boundary is credential-coupled* (the measurement behind limitation 5, not
   a pin test). In that same clone, with `.env.local` absent but `dist/` still built from a
   credential-bearing environment, `keeps no privileged credential in the production bundle` went
   RED on **one browser-safe local demo anon JWT** — a public value, not a privileged one, so
   nothing sensitive is disclosed by the count. The token value is not reproduced here. Restoring
   `.env.local` returns the suite to green, which locates the weakness precisely: the test's
   exemption reads the *test-time* environment while its subject is the *build-time* environment.

### Machine state after run 21, re-measured — and one reading I had to throw away

Run 21 finished at `2026-09-29T13:08:27Z`. The re-measure below was taken the next morning
(2026-09-30), and the host had been rebooted in between, which is exactly the class of thing a
self-hosted runner carries silently into the next job:

* `wsl.exe -l -v` → `Ubuntu Stopped 2`, `docker-desktop Stopped 2` (i.e. no WSL instance resident at
  query time; each `wsl -d Ubuntu` command starts one transiently).
* Inside Ubuntu: `PRETTY=Ubuntu 26.04 LTS`, kernel `6.18.33.2-microsoft-standard-WSL2`, `nproc 16`,
  `wslinfo --memory-hint-in-bytes` → none printed, i.e. **no memory hint is set and I set nothing**.
* Runner service: `systemctl is-active` → `active`, `SubState=running`, and
  `ExecMainStartTimestamp=Wed 2026-09-30 06:15:34 UTC` — a start timestamp *after* run 21 completed,
  which is what proves the reboot rather than any assumption about it. `pgrep -af` shows
  `runsvc.sh` (pid 158) and `bin/Runner.Listener run --startuptype service` (pid 288), so the runner
  is online and idle, not wedged.
* Runner workspace: exists, `HEAD = f03fd0d20fa8edebf0cf54572a1e0b2f9f0d3bdc` — the head run 21
  proved — with `git status --porcelain` returning **0 lines**, so the runner's own checkout carries
  no residue of the run that produced it. `_work` is 709 M; the runner directory is 1.4 G.
* `ss -ltn` → **no listener on 3000/3100/54321/54322**: nothing of this project's is holding a CI
  port.
* **Docker is not reachable, and the honest reading is that the engine is down.** `command -v docker`
  inside Ubuntu resolves to the Windows shim
  `/mnt/c/Program Files/Docker/Docker/resources/bin/docker`, and invoking it prints `The command
  'docker' could not be found in this WSL 2 distro. We recommend to activate the WSL integration in
  Docker Desktop settings.` From the Windows side: `Get-Process` matched **no** process whose name
  contains `Docker`, and `docker.exe version` → `failed to connect to the docker API at
  npipe:////./pipe/dockerDesktopLinuxEngine; … check if the path is correct and if the daemon is
  running`. So Docker Desktop is simply not started on this host right now.
* **A reading I discarded.** My first sweep of that state piped `docker ps -aq 2>/dev/null | wc -l` and
  got `8`, and `grep -Eic 'dueweave|project-ar1|ds97'` on the container list got `0`. Both numbers are
  the *error message* the shim writes to stdout, counted as if they were containers — the 8 is eight
  lines of prose, and the 0 is "no container list at all", not "no residue". Neither is evidence, so
  neither is used anywhere in this report, and container/volume residue after run 21 is recorded as
  **unmeasurable at this moment** rather than as clean. What *is* measurable — no listener on the CI
  ports, no process of this project's, workspace porcelain empty — is what the bullet above claims.
* Consequence, stated before it is discovered rather than after: the `database` and `browser` jobs of
  the **next** push will fail at `Run ./.github/actions/local-supabase` if the engine is still down
  when it runs, in the same *shape* as run 20 (start step red, dependents skipped) for a different
  reason (no engine, rather than a port this session squatted). `static` does not need Docker and
  would still pass. This is host availability, not a repository defect, and run 21 remains the
  acceptance evidence for the head that carries the repair. Starting Docker Desktop was **not** done
  at the moment this bullet was written: it is a host-level action that auto-starts containers belonging
  to an unrelated project sharing the same engine, and that did not look like this stage's to take.
  **That sentence no longer describes what was finally done** — the decision was reversed before the
  `fd2e12d` docs push, measured in the next two bullets, and the resulting run is §"Run 22".
* **What I did instead, measured.** Before pushing the docs head I started
  `C:\Program Files\Docker\Docker\Docker Desktop.exe` — the runner's documented prerequisite, so the
  push would exercise the gates rather than merely predict their shape. The engine came back reachable
  from Ubuntu: `docker version` → `SERVER 29.7.2 linux/amd64`, rc 0. The predicted side effect happened
  and is recorded rather than hidden: starting the engine brought back **5 containers of the unrelated
  `localvivaahvarnam` stack** under their own restart policy (`supabase_db/rest/inbucket/auth/kong_…`,
  all `Up 4 minutes`), bound to `54400`/`54401`/`54403` — not this project's CI ports (`54321` API,
  `54322` DB), so no collision. I started none of their processes, stopped none, pruned nothing:
  `docker ps -a` filtered for `dueweave|project-ar1` → **NONE**, and `ss -ltn` showed no listener on
  3000/3100/54321/54322 immediately before the push.
* **A third reading I discarded.** The same paragraph offered "engine npipe absent" as evidence Docker
  was down. `ls //./pipe/docker_engine` from Git Bash fails for that path *always* — the Win32 device
  namespace is not listable there — so it could not have distinguished up from down and is withdrawn as
  evidence. The conclusion still stands on the two readings that are valid: `Get-Process` matching no
  `*Docker*` process, and `docker.exe version` returning `failed to connect to the docker API at
  npipe:////./pipe/dockerDesktopLinuxEngine`.
* Resources at the same moment, no setting changed: WSL `/` (`/dev/sde` — the device letter moves
  between boots; earlier readings called it `/dev/sdf`) 1007 G total, **5.2 G used, 951 G free, 1 %**;
  `free -m` → total 7 737 MiB, used 737, available 7 000; swap 2 048 MiB total, 0 used. Disk and memory
  are not anywhere near exhaustion, so the run-21 result is not a resource-conditioned result and no
  resource change was authorised or made. Re-measured while run 22 was in flight, again with no setting
  changed: `/dev/sdf` 1007 G total, 5.7 G used, 951 G free (1 %); `free -m` total 7 737 MiB, used 1 886,
  available 5 851; swap 2 048 MiB, 0 used; `nproc` 16; and `~/.wslconfig` does not exist, so WSL memory
  remains at its default rather than being raised anywhere.

### Machine state after run 22, re-measured — the runner came back clean from a red run

A red run is the interesting case for a stateful runner, because the failure path is the one that
leaves servers, reports and traces behind. Measured after `07:04:49Z`, with the runner idle:

* `gh api …/actions/runners` → `total_count 1`, `dueweave-local-ci`, `status online`, `busy false`;
  `systemctl is-active` / `is-enabled` on the unit → `active` / `enabled`.
* `ss -ltn` → **no listener on 3000 / 3100 / 54321 / 54322.** The browser job's own
  `Clear servers and reports a previous DueWeave job left behind` and `release-local-ci-state` steps
  both report `success` on the API even though the job failed, and this reading confirms that in the
  environment rather than only in the log.
* Engine residue, counted rather than asserted: `docker ps -a --format {{.Names}}` grepped for
  `dueweave|project-ar1|ds97` → **0**, `docker volume ls` with the same pattern → **0**, total
  containers on the engine **5** — the unrelated `localvivaahvarnam` stack, still up on 54400/54401/54403
  exactly as the pre-push bullet records. Nothing of theirs was stopped, started or pruned, and no
  volume prune was run (it is outside this stage's boundaries).
* The runner's `_work/` directory now contains **both** `project-ar1` and `DueWeave`. That is the
  repository rename (`Pavithran-R-A/project-ar1` → `Pavithran-R-A/DueWeave`) surfacing in the runner's
  own checkout paths: run 22's failure points at
  `/home/pavithran_r_a/actions-runner-dueweave/_work/DueWeave/DueWeave/e2e/…` where runs 18-21 were
  `_work/project-ar1/project-ar1/…`. Nothing about the labels, the systemd unit, the registration or
  the job topology changed, and the same `runner_id 21` served both. Worth recording for the owner: the
  old `project-ar1` checkout is now dead weight inside a stateful runner's workspace, and this stage
  did not delete it, because removing a runner's workspace is a machine-state action it was not given.
* Working tree at the same moment: only the intended Stage 9 changes — the two repaired journeys, the
  new D-S9-9 contract, this report, and the documented `client/src/types/database.generated.ts` CRLF
  phantom that `core.autocrlf` reports as modified while its content is unchanged. No `.env.local`,
  no `dist/`, no `test-results/`, no `playwright-report/`, no trace or screenshot from this session,
  and no runner `_work` material is in the repository.

## Local gates (PHASE 31/32/35/36), each with a captured exit code

| Field | Measured value |
| --- | --- |
| LOCAL ZERO REPLAY | `pnpm db:reset:local` on a fresh container set: 23 "Applying migration" lines, `WARN: no files matched pattern: supabase/seed.sql`, ending `Finished supabase db reset on branch current-stage-9-security-ci.` No migration errored, so the whole schema is reproducible from committed files with no operator state. Log kept (`phase31-reset.log`, 2026-09-29 01:26). |
| MIGRATION COUNT | `pnpm verify:migrations` → "Migrations on disk: 23. Applied in the local database: 23. The replayed schema and the qualified schema are the same migration set." `exit=0`. |
| GENERATED TYPES DRIFT CHECK | `pnpm verify:types` → "client\src\types\database.generated.ts matches the local schema (38326 bytes)." `exit=0`. The gate regenerates from the running schema into a temporary string and compares without touching the working tree, so it cannot be satisfied by a stale committed file. |
| PGTAP | `pnpm test:db` → `Files=8, Tests=364 … Result: PASS`, `exit=0`, twice (01:28 and again at 12:10 in the closing set). Files: `stage3_01_rls_structure`, `stage3_02_privileges`, `stage4_01_edit_routines`, `stage5_01_lifecycle`, `stage5_02_promise_chronology`, `stage8_01_offer_readiness`, `stage8_02_payment_evidence`, `stage8_03_reviewer_boundaries`. |
| DB LINT | `pnpm db:lint` → "Connecting to local database… Linting schema: extensions / Linting schema: public / No schema errors found", `exit=0` (2026-09-29 12:4x, re-measured for closure). |

## Stage 2 – 8 live suites (PHASE 33), `pnpm test:live`, one worker, guard-first

`[live-stack-guard] qualified against http://127.0.0.1:54321 (Auth health 200)` preceded the run;
the guard is `globalSetup`, so an absent or non-loopback stack aborts before any `describe` is
evaluated. Totals: **9 files passed (9), 307 tests passed (307), 0 failed, 0 skipped, 204.82 s.**

| Field | Suites | Tests |
| --- | --- | --- |
| STAGE 2 LIVE | `tests/stage2-local-foundation.test.ts` | 12 passed |
| STAGE 3 LIVE | `tests/stage3-local-rls.test.ts` | 110 passed |
| STAGE 4 LIVE | `tests/stage4-local-edit-workflows.test.ts` + `tests/stage4-local-repository-edit.test.ts` | 14 + 7 = 21 passed |
| STAGE 5 LIVE | `tests/stage5-local-lifecycle.test.ts` | 69 passed |
| STAGE 6 LIVE | `tests/stage6-local-profile.test.ts` | 13 passed |
| STAGE 7 LIVE | `tests/stage7-local-export.test.ts` | 10 passed |
| STAGE 8 LIVE | `tests/stage8-local-founder-readiness.test.ts` | 65 passed |
| STAGE 9 LIVE | `tests/stage9-abuse-matrix.test.ts` | 7 passed |

Sum check: 12+110+21+69+13+10+65+7 = 307, matching the reported total exactly. No suite was
re-run to obtain this table; the numbers are read from the single retained log.

## Browser battery (PHASE 34), `pnpm verify:e2e:local`, `--workers=1` (the runner's default)

Executed twice: once as the Stage 9 baseline, once after repair. Same command, same worker count
as previously qualified (1), same 181 slots.

| Field | Baseline (01:47–02:07) | After repair (10:34–11:00) |
| --- | --- | --- |
| passed | 164 (33.2 m) | **173 (25.5 m)** |
| failed | 3 | **0** |
| skipped | 8 | 8 |
| did-not-run | 6 | **0** |
| timeouts | 2 test-level (30 000 ms), 1 hook (30 000 ms), 1 click (120 000 ms) | 0 |
| PGRST303 | 0 | 0 |
| console errors | 0 | 0 |
| page errors | 0 | 0 |
| unexpected request failures | 0 | 0 |

Slot arithmetic: 173 + 8 = 181 = the slots Playwright announced ("Running 181 tests using 1
worker"), and the closing run's slot numbering is 1…181 with **181 distinct ids and no
duplicates** — each test ran exactly once, which is the direct evidence that no hidden retry
occurred, independent of `retries: 0`.

Per-stage executed passes in the closing battery: Stage 2 4 (`auth-gateway` 3, `stage2-local-auth`
1), Stage 3 5, Stage 4 10, Stage 5 14, Stage 6 66 across nine specs, Stage 7 32 (`export` 13,
`followup` 19), Stage 8 21 (`founder-customer` 11, `founder-reviewer` 10), Stage 9 21
(`account-isolation` 8, `react-warnings` 3, `release-journey` 10). Total 173.

The 8 skips are not silent: they are the six host-credential-gated legacy specs
(`accessibility-smoke` 1, `auth-lifecycle-limits` 2, `core-workflow` 1, `founder-purchase` 1,
`responsive-authenticated` 1, `stage41-client-conversion` 2), classified as
[docs/TEST_SKIP_CLASSIFICATION.md](docs/TEST_SKIP_CLASSIFICATION.md) class E with a per-test
supersession map. None of the 8 is in the CI browser subset.

The CI browser subset was then re-measured alone, with the command the `browser` job runs verbatim:
`pnpm test:e2e:smoke` → `Running 79 tests using 1 worker`, `79 passed (14.2m)`, `smoke-exit=0`, and
no `failed`, `skipped` or "did not run" line anywhere in the retained log. An earlier replay of the
same 79 on this host measured 17.3 min, so `docs/RELEASE_GATE_MATRIX.md` states the range rather
than one number. The same 79 have now run **in CI as well**: `79 passed (13.9m)` in run 18's
`Browser release smoke` job, which is the CI-measured figure the budget paragraph previously had to
call unavailable. The local range stays in the document because it is a local measurement of the
same suite under a shared host's load, not a superseded one.

| Field | Value |
| --- | --- |
| FRESH ACCOUNT RELEASE JOURNEY | `e2e/stage9-release-journey.spec.ts` — 10 tests, all passed, one fresh account signed up through the screens and driven end to end: workspace naming, first client, first invoice, a promise the client made, a partial payment that keeps the balance exact, the follow-up hand-off, the final payment, search and status tabs, the export in both shapes, the Founder page refusing unconfigured payment instructions, and a profile edit still present after sign-out and sign-back-in. |
| SECOND ACCOUNT ISOLATION | `e2e/stage9-account-isolation.spec.ts` — 8 tests, all passed: two strangers each build a ledger; each owner's authorised read finds exactly what it made; the other account's screens carry none of these words; its identifiers read as nothing table by table; its rows cannot be created, patched or paid into; claims, entitlements, review access and settings stay shut; search finds nothing across accounts, not even an exact invoice reference; its export files carry none of its records in any shape. |
| FINANCIAL JOURNEY | Stage 5 browser 14 passed (partial → kept promise, settlement, queue priority, honest history); Stage 9 release journey tests 4, 5 and 8 above re-execute the money path on the built bundle; Stage 5 live 69 tests assert the same rules where the database decides them. |
| FOLLOW-UP / EXPORT | Stage 7 browser 32 passed (19 follow-up, 13 export), including the intercepted `wa.me` link so no test reaches a real messenger, explicit contact confirmation, copy-verification, snooze bounds, and export read back byte-for-byte against the on-screen ledger. Stage 7 live export 10 tests, incl. "changes nothing at all in the ledger while producing every file". |
| FOUNDER CUSTOMER | Stage 8 browser 11 passed: no destination, QR, UPI link or copy action is shown at all until readiness is real; with a synthetic ready offer the on-screen QR is compared pixel for pixel against an independently rendered reference from the canonical payment URI; opening that link leaves the claim a draft, the account Free and the history unchanged. |
| FOUNDER REVIEWER | Stage 8 browser 10 passed: the queue is refused until one allowlist row exists; the last seat is taken once and the next review is refused as full with its claim left pending; a card another review already settled refuses as already reviewed; revoking through the reviewer's own session leaves every record and restores the limit; the screen is keyboard-operable and fits every qualified width. |
| ACCESSIBILITY | `e2e/stage6-local-accessibility.spec.ts` 8 passed, including the reduced-motion walk that this stage moved out of a permanently-skipped file (F4) and `stage8-local-founder-reviewer`'s keyboard-and-width test (18.9 s). |
| RESPONSIVE | `e2e/stage6-local-responsive.spec.ts` 5 passed (the measured 7-width matrix), plus per-width follow-up and Founder tests. |
| CONSOLE/PAGE ERRORS | 0 console errors, 0 uncaught page errors, 0 unexpected `requestfailed` across the 181-slot battery; `e2e/problem-watch.ts` fails a test on any of them, with the single documented exception being the deliberately unanswered request a test is asserting on. `e2e/stage9-react-warnings.spec.ts` 3 passed against `vite dev` (the only environment where React can emit a warning at all — production React throws minified errors). |
| ABUSE MATRIX | `tests/stage9-abuse-matrix.test.ts` 7 live tests passed inside the 307; the 20-case ledger with the executing file per case is [docs/STAGE9_ABUSE_MATRIX.md](docs/STAGE9_ABUSE_MATRIX.md). The other fifteen cases execute in the live, unit, pgTAP and browser files that ledger cites. |

## Full `pnpm test`, twice, no changes in between (PHASE 35)

| Field | Value |
| --- | --- |
| FULL TEST RUN #1 | `Test Files 32 passed \| 1 skipped (33)`, `Tests 666 passed \| 1 skipped (667)`, 217.97 s, started 12:00:44. |
| FULL TEST RUN #2 | `Test Files 32 passed \| 1 skipped (33)`, `Tests 666 passed \| 1 skipped (667)`, 208.84 s, started 12:04:38. |
| SAME MANIFEST, EXECUTED BY CI (run 18, head `ec868e8`) | `Test Files 24 passed (24)` / `Tests 363 passed (363)` in the `static` job's unit split, and `Test Files 9 passed (9)` / `Tests 307 passed (307)` in the `database` job's live split — 33 executed files and 670 tests, **0 skipped, 0 did-not-run** across the two jobs. |
| SAME MANIFEST, EXECUTED BY CI (run 19, head `f4bcc61`) | Identical figures re-measured on a second head: `Test Files 24 passed (24)` / `Tests 363 passed (363)` in `static`, `Test Files 9 passed (9)` / `Tests 307 passed (307)` in `database`, 0 skipped and 0 did-not-run. The manifest is therefore reproducible across pushed heads, not a one-run observation. |
| MANIFEST AFTER THE D-S9-7 REPAIR (run 20, head `f28bae6`) | With `tests/ci-log-credential-redaction.contract.test.ts` (5 cases) added to the unit half, the split is `Test Files 25 passed (25)` / `Tests 368 passed (368)` — and **run 20's `static` job printed exactly that at 12:28:12Z**, naming the new file in its executed list, with no stack and no credentials present. The `database` job of that run never reached its suites (see the run 20 section), so the live/pgTAP half of this head waited for the next run. |
| MANIFEST ON THE REPAIR-CARRYING HEAD (run 21, `f03fd0d`) | All four halves now printed by CI itself, on the head that carries the redactor: static `Test Files 25 passed (25)` / `Tests 368 passed (368)`; database `Files=8, Tests=364` / `Result: PASS` (pgTAP), `Migrations on disk: 23. Applied in the local database: 23.`, `No schema errors found` (lint), live `Test Files 9 passed (9)` / `Tests 307 passed (307)`; browser `79 passed` + `3 passed` = 82 slots. Every one of those counts matches the local re-measurement at the same head, so the manifest this stage documented is the manifest the runner executed — no half is carried from runs 18–19 any more. |
| MANIFEST AT RUN 22 (head `fd2e12d`) | Run 22 executed the **same** manifest as run 21 (`Test Files 25 passed (25)` / `Tests 368 passed (368)` at `06:45:55Z`, live `9 / 307` at `06:44:50Z`, pgTAP 364 `PASS`) — part of the evidence that its red has nothing to do with a manifest change: the head differs from run 21's only in this file, `README.md` and `docs/RELEASE_GATE_MATRIX.md`. The browser half is where it diverged: `1 failed / 4 did not run / 74 passed`, i.e. 79 of the 82 slots executed and 3 never reached (the `React warning and console discipline` project, whose step is `skipped`). |
| MANIFEST AFTER THE D-S9-9 REPAIR (locally measured; CI half pending) | `tests/e2e-refusal-toast-occlusion.contract.test.ts` (3 cases) joins the unit half, so the local re-measurement at this head is `Test Files 26 passed (26)` / `Tests 371 passed (371)`, with `pnpm check`, `pnpm lint --max-warnings=0`, `pnpm verify:secrets` (`Scanned 233 files for 11 credential shapes.` → clean) and `git diff --check` all exit 0. **Not yet printed by CI**: the head that carries it is the thirteenth push, and its `static` job is what turns this row from a local measurement into delivered evidence. |

Identical counts, no code or config change between them. The 1 skipped test is
`tests/supabase.public-config.live.test.ts` (class E: it addresses a hosted project and this stage
is local-only); `tests/suite-manifest.ts` excludes it from both release halves so neither can
cite it, and `pnpm test:unit` (23 files / 359) and `pnpm test:live` (9 files / 307) sum to the 32
executed files without it.

The two rows disagree with each other for one reason, and it is stated rather than smoothed: the
PHASE 35 pair measured a head *before* D-S9-5 and D-S9-6 were repaired. The unit half grew by one
file and four tests (23/359 → 24/363): `tests/unit-suite-hermeticity.contract.test.ts` adds 3 cases
and `tests/ci-gate-manifest.contract.test.ts` 9 → 10 (the artefact-scan pin from D-S9-6);
`tests/security-contract.test.ts` moved its assertions to the module that now owns the rule without
changing its own count. Re-measured at the delivered head `ec868e8` after the CI run, `pnpm
test:unit` on this tree gives the same `Test Files 24 passed (24)` / `Tests 363 passed (363)`,
0 skipped — but with one difference that matters and is the whole point of D-S9-5: this working copy
has a gitignored `.env.local`, and the CI `static` job had none. Same counts, two different
credential environments, which is the property the new contract test pins.

## Static gates (PHASE 36), each re-run for closure with the exit code captured in the log

| Command | Result |
| --- | --- |
| `pnpm install --frozen-lockfile` | exit 0 — "Ignored build scripts: @tailwindcss/oxide, esbuild" is a pnpm notice, not a failure; lockfile untouched |
| `pnpm lint` | exit 0 (`eslint client/src tests e2e scripts vite.config.ts --max-warnings=0`) |
| `pnpm check` | exit 0 (`tsc --noEmit`) |
| `pnpm build` | exit 0 — `✓ built in 17.70s`, largest chunk `index-*.js` 498.18 kB / 144.28 kB gzip |
| `pnpm audit --prod --audit-level=high` | exit 0 — "No known vulnerabilities found" |
| `git diff --check` | exit 0 — no whitespace errors. The 42 "LF will be replaced by CRLF" lines are this host's `core.autocrlf=true` notices, emitted on stderr, not check findings. |

## Dependency audit, stated without smoothing (PHASE 37 companion)

| Command | Measured |
| --- | --- |
| `pnpm audit --prod --audit-level=high` | **0 findings**, blocking in CI |
| `pnpm audit --prod` (no severity floor) | 2 **moderate** in the runtime graph: `react-router` open-redirect-via-backslash (GHSA-wrjc-x8rr-h8h6, CVE-2025-68470 bypass) and `deserializeErrors()` arbitrary-constructor injection (GHSA-337j-9hxr-rhxg); fixed by `react-router-dom@7.18.4`, a breaking change |
| `pnpm audit` (dev tree) | 4 moderate: the two above plus `@vitest/mocker` path traversal / arbitrary file read (GHSA-82fw-gwwq-j7x9, needs `vitest@5`, breaking) |

The two runtime findings are **not** claimed as closed. They are reachable only through SSR
hydration and `<Link>`/`useNavigate` call sites; this application is a client-rendered Vite SPA with
no SSR surface and no user-supplied navigation target, which is an argument about exposure, not a
fix. The upgrade is a dependency decision the release owner makes; CI records the dev-tree number
under `continue-on-error: true` and blocks on the production high-and-above gate. Recorded in
[docs/RELEASE_GATE_MATRIX.md](docs/RELEASE_GATE_MATRIX.md).

## SECRET SCAN (PHASE 37)

`pnpm verify:secrets` → "Scanned 228 files for 11 credential shapes. No privileged credential
found in the tracked tree or the built bundle." `exit=0`, re-measured on the docs-closure head.
**At the delivered head `ec868e8` the same command inside CI scanned 231 files** (`static` job,
10:23:11) and printed the same clean result — 231 because this report and the two new contract-test
files became tracked between the two measurements, not because the scope changed.
Scope is the tracked tree **plus** `dist/` (208 tracked + 20 bundle artefacts; the tracked count is
227→228 between the earlier and this measurement because this report became a tracked file) — measured, not assumed, by the falsification in
PHASE 28 above. 11 shapes: `service_role` JWTs, `sb_secret_`, Supabase service keys, database
URLs, database passwords, UPI/payment secrets, private keys, and the generic assignment shapes;
the HARD subset cannot be allowlisted at all, values are reported as shape + location + length and
never as the key itself.

The `browser` job additionally scanned its own two artefact directories with
`node scripts/verify-secrets.mjs --dir test-results` and `--dir playwright-report`, at 10:48:38,
each reporting `Scanned 1 files for 11 credential shapes` and clean. That `1` is correct and
expected — after D-S9-6's fix those directories hold the single `index.html` the html reporter
writes when the run is green — but the sentence the script prints under `--dir` is not: it reads
"No privileged credential found in the tracked tree or the built bundle" whatever was scanned, so
those two CI log lines overstate their own scope. Recorded as known limitation 4 and an owner
action; not patched here, because editing `scripts/verify-secrets.mjs` would move the executable
head off the SHA this green run proves.

**What this section's scope did not cover is the log stream itself, and that gap is D-S9-7.** The
`database` and `browser` jobs each printed the local stack's generated `sb_secret_…` value into the
job log while printing `Scanned 231 files … No privileged credential found` two steps later. Those
two sentences are not in contradiction: the scanner looks at the tracked tree and `dist/`, and the
key it declared absent is generated at run time by Docker and never committed, so the gate was
answering its own question correctly. The unanswered question was whether the *output* of a
release job is credential-bearing — nothing in the repository's scanning scope could ask it, because
a retained log is not a tracked file. After D-S9-7's filter the start step's own output is masked
before it reaches the log; what remains outside the gate is GitHub's already-retained history, which
is owner action 11.

Added/modified lines were scanned separately for the non-credential content PHASE 37 lists. Over
`git diff ccc4438 HEAD` restricted to `+` lines, zero matches for: `upi://pay?pa=`, `sb_secret_`,
JWT-shaped `eyJ….…`, `service_role`, `postgres://user:pass@`, `support@<domain>`, and a 10-digit
numeric pattern intended to catch UTR-like values. The single hit was `6062418596` inside
`36062418596` — a GitHub run id quoted in `docs/PR_INTEGRATION_PLAN.md`, i.e. the pattern matching
an infrastructure identifier, not a payment reference. No real customer data, payment data, VPA,
UTR or support address is present; every fixture is synthetic and self-labelling (`not-a-vpa`,
`a@b`, `merchant@`, `@upi`, `x@y@z`, account emails on `example.test`-style local parts,
workspace/client names that read as placeholders). No `.env`, `dist/`, `test-results/`, Playwright
trace, screenshot or Supabase temp-state file is in the staged set: `git diff --cached --name-only`
matched none of those paths, and `.github/workflows/ci.yml` scans artefacts before uploading them.

## BRANCH PROTECTION

| Field | Value |
| --- | --- |
| CURRENT STATE | **MEASURED** (not UNKNOWN): `gh api repos/Pavithran-R-A/project-ar1/branches/main/protection` → HTTP 404 `{"message":"Branch not protected"}`; `gh api …/rulesets` → `[]`; repository `main`, private, `owner.type = User`; merge commit, squash and rebase all allowed; `delete_branch_on_merge = false`. **`main` is unprotected and directly pushable today.** One sub-fact stays UNKNOWN: whether this account's plan permits protected branches on a private repository — the endpoint returns `null` for `.plan` and the entitlement is not exposed to a `repo`-scoped token. |
| RECOMMENDATION | The exact rule, with rationale per setting and the three unique check names to require, is [docs/RELEASE_PROTECTION.md](docs/RELEASE_PROTECTION.md). Nothing was enabled, created or changed by this stage (PHASE 26). Its step 1 was written as "cannot be done yet" because no job would execute; run 18 removed that obstruction — `Static verification`, `Database contracts` and `Browser release smoke` are published as `completed/success` check runs at `ec868e8`, so they are now selectable in the picker. The rule itself is still the owner's to create. |

## Pull requests

| Field | Value |
| --- | --- |
| OBSOLETE PR #1 STATUS | **OPEN, not merged.** `chore: rebaseline DueWeave repository`, head `stage-0-rebaseline` at `1bb2f38`, base `main`, `mergeable = MERGEABLE`, `mergeStateStatus = UNSTABLE`, last updated 2026-09-24. Measured ancestry: `git merge-base --is-ancestor 1bb2f38 HEAD` → true and `git rev-list --count HEAD..1bb2f38` → 0, so PR #1 contains nothing this branch lacks; merging this branch makes it redundant. This stage did not close, comment on, rebase or merge it — that is the release owner's decision, and leaving it open is the safe state. |
| INTEGRATION PR | **NOT CREATED in this stage**, per PHASE 25 ("DO NOT CREATE IT YET"), and it could not legitimately be created: the plan's own precondition is a complete and green Actions run for the final head SHA. The full design — base, head, title, required body contents, merge policy, commit shape — is [docs/PR_INTEGRATION_PLAN.md](docs/PR_INTEGRATION_PLAN.md), including the measured diff (`git diff --shortstat $(git merge-base main HEAD) HEAD`: 236 files, +37141 / −12933 at the 2026-09-29 opening measurement, and 40 commits ahead / 0 behind — both plans state that the ahead count and line totals grow by one per further commit, while **0 behind** is the property that holds until `main` moves) and the finding that no merge conflict is possible at the measured SHA because `main` has not moved since the fork point. |

## Scope boundaries honoured

| Field | Value |
| --- | --- |
| REMOTE SUPABASE MUTATIONS | **NONE.** No `supabase db push`, no `--linked`, no `--project-ref`, no hosted connection string was ever supplied to a command in this stage. Every database command names `--local` and the loopback stack (`127.0.0.1:54321`), and `scripts/local-stack-check.mjs` refuses a non-loopback URL before a suite can run — deliberately, because these suites create users, rewrite the singleton Founder offer row and purge fixture accounts. |
| HOSTED PROJECT CREATED | **NO** |
| DEPLOYMENT | **NONE** — no `vercel`/hosting command, no preview promotion, no release |
| PAYMENT ACTIVATION | **NONE** — Founder rows stay in `TEST`/fail-closed mode with the shipped placeholder destination; no real UPI settlement, no live VPA, no credential. `docs/FOUNDER_LIVE_ACTIVATION_CHECKLIST.md` remains the operator's unexecuted checklist. |
| TAGS / RELEASE | **NONE** — `v1.0.0` was not created |
| `main` | Untouched: no merge, no push, `refs/heads/main` still `58f0cc76ca560bdac08bdbd19e237aa4a413686b` |

## Defects Stage 9 proved, reproduced RED, and repaired

Eight of these are skip-classification defects and carry their RED/GREEN measurements in
[docs/TEST_SKIP_CLASSIFICATION.md](docs/TEST_SKIP_CLASSIFICATION.md) F1–F8. The browser-budget
defects, the documentation defect, the three defects that only a real, credential-free,
artefact-producing CI environment could expose (D-S9-5, D-S9-6, D-S9-7), the residue this stage
inflicted on its own runner (D-S9-8), the toast-occlusion recurrence run 22 exposed (D-S9-9) and the
evidence-retention gap runs 23 and 24 exposed (D-S9-10) are recorded here. Some were surfaced by a
step exiting non-zero; **D-S9-7 was surfaced only by reading the log of a green run**, which is the
sense in which a passing job is not the same thing as an inspected one; **D-S9-9 was surfaced only by a
*second* run of code a *first* run had already passed**, which is the sense in which one green run is
not the same thing as a deterministic suite; and **D-S9-10 was surfaced by two red runs whose retained
logs contained no cause at all**, which is the sense in which a failing step is not the same thing as a
diagnosable one.

**The failure itself is deliberately *not* numbered.** Nothing about run 23's or run 24's
`error running container: exit 1` is proven to be a defect in this repository, its tests, its
configuration or its runner, and giving *that* a D-S9-n id would manufacture a repair no measurement
justifies. What D-S9-10 claims is narrower and fully proven: the step that failed was the only one in
its action that left no diagnostic trace of its own failure, and the CLI had said so in the log. The
unexplained failure stays where it belongs — its own run sections, limitation 24 and owner actions 15
and 16 — with the mechanism stated exactly, the unrecovered part stated as unrecovered, and the
symptom-level changes that would have hidden it named and rejected.

| ID | Defect | Proof before fix | Fix (test-side only unless stated) |
| --- | --- | --- | --- |
| F1–F8 | Green commands that proved nothing: 24 browser tests silently skipped, 5 `package.json` scripts launching gated suites outside the runner, the release command building *after* the half that reads the bundle, two behaviours that existed only inside permanently-skipped specs, an empty-body placeholder that skipped on every run, an inherited 30 s budget, the gate scripts being outside the lint path, and a locally-measured gate CI never launched. | Each has a measured RED and a measured GREEN in that file. | Fail-closed guards, runner-routed scripts, reordered `verify:release:local`, two tests moved into executed suites, three new contracts that derive the required gate list from the commands themselves. |
| **D-S9-1** | `e2e/stage6-local-forms.spec.ts:186` deadlocked: the withdrawal confirmation toast rests over a Today-card row action, and Playwright's hit-test pointer parks on it, which makes Sonner pause auto-dismiss (`data-expanded`) — so a 4.5 s overlay became an unbounded wait: **53 retries of "subtree intercepts pointer events" and the full 120 000 ms budget**. | Measured geometry on this build: toast band `[896,108,356,92]`, scrolled row action `[1173,166,34,34]` — inside that band; `client/src/components/ui/sonner.tsx` sets `position="top-right"`, `offset={{ top: 108, right: 28 }}` and enables pointer events deliberately. | Test moved the pointer off the stack (`page.mouse.move(0, 0)`) and waited for the toast stack to drain before the next action, with the measured rects recorded beside it. **Product behaviour was not changed.** The finding stands for a human: at this viewport a confirmation toast covers a Today-card row action until it dismisses. `current_stage6_production_ux_report.md:119` already records the same overlap as a Phase 29 defect "reproduced RED then fixed", so the accepted Stage 6 claim that `sonner.tsx` documents as a considered limitation is not what that report says — flagged for the release owner rather than silently harmonised. |
| **D-S9-2** | Stage 4's `beforeAll` died at 30 000 ms in the battery (`"beforeAll" hook timeout of 30000ms exceeded`) while the file carried `test.describe.configure({ timeout: 60_000 })`. | Proven against the installed Playwright 1.62.1 twice: `workerProcessEntry.js:1759` gives every hook `project.timeout` — `describe.configure` never arms a hook — and an isolated probe with `test.setTimeout(2_000)` inside a `beforeAll` that slept 6 s failed with exactly `"beforeAll" hook timeout of 2000ms exceeded`, i.e. the hook-scoped call is the only thing that arms a hook budget. | `test.setTimeout(workspaceSetup)` (90 000 ms) as the first statement of both `beforeAll` hooks and of the isolation test, with the measurements beside it. This also **corrects a false comment already in this file**: a previous revision claimed the describe-level raise made the run "answer a question instead of timing out"; it did not, and the comment now says so rather than repeating the claim. |
| **D-S9-3** | The same suite's 5 s "Client updated" expectation was attributed to a slow write without measurement. | Instrumented probe (temporary spec, deleted after use) measured `update_client` at 101/123/160 ms against click→toast at 5388/765/857 ms and a second pass at 3620/944/10515 ms, with `peak=5` in-flight requests — so the write is not the cost, the interval is between the resolved mutation and the render, and Chromium's 6-per-origin queueing is excluded at that peak. | Expectations given a measured 30 000 ms budget (`writeConfirmed`) at the six confirmation points, with the numbers in the comment. The probe files were removed; only the measurements and the citations remain. |
| **D-S9-4** | `docs/PR_INTEGRATION_PLAN.md` asserted that Actions was functioning, from a run whose jobs had zero steps. | The run's own job payload and annotation, quoted above. | Corrected forward-only in that file with the full history measurement (last executing run 2026-08-14; both runs since then unallocated), and `docs/RELEASE_PROTECTION.md` step 1 marked done-and-blocked. |
| **D-S9-5** | `pnpm test:unit` — the half the `static` job runs with no database and no credentials — was not credential-free: `client/src/hooks/sign-up-outcome.test.ts` imported the auth hook, which imports the module-scope client builder, which throws at import time. Every laptop run of this stage hid it because this working copy has a gitignored `.env.local`. | Measured twice, and the second time as a falsification on the pre-fix tree with the env file moved aside: collection failed with `Error: DueWeave needs its secure connection configured before it can open.` and 0 tests ran from that file (`Test Files 3 failed \| 21 passed (24)`, `Tests 2 failed \| 356 passed (358)`). The first measurement was the Linux/WSL dry run of the `static` job, which is the run that found it — commit `c3eda13` quotes it. | Pure decision code moved to `client/src/lib/auth-outcome.ts`; the hook and the suite repointed at it; the security-contract assertions follow the rule to the module that now owns it and still pin the hook to routing through it. **`tests/unit-suite-hermeticity.contract.test.ts` (3 cases) checks the property instead of the name:** no suite in the static half may reach the client builder unless it mocks that module in its own file — in the falsification above it is the test that names the offender (`"…only run where credentials are configured: client/src/hooks/sign-up-outcome.test.ts"`). Delivered CI then ran the same command with no credentials at all and reported 24/363 green. |
| **D-S9-6** | The `browser` job scanned and uploaded an artefact directory nothing produced. Both Playwright configs used the console-only default reporter, so `--dir playwright-report` had no input. | Measured on a *fully green* WSL dry run: `79 passed / 13.6m`, `3 passed / 42.3s`, and `node scripts/verify-secrets.mjs --dir playwright-report` exited 1 with `ENOENT`. So the gate was scanning a path that only exists by accident, and the upload step was pointed at the same nothing. | `playwright.config.ts` and `playwright.react-warnings.config.ts` now declare the html reporter with `open: "never"`. `tests/ci-gate-manifest.contract.test.ts` gained a 10th case pinning that every directory CI scans is one the browser run is configured to produce — a config that drops the report or moves `outputDir` now fails locally instead of in CI. CI run 18 then scanned 1 file in each directory and both passed. |
| **D-S9-7** | Both environment jobs printed a live privileged key into the job log the platform retains. `.github/actions/local-supabase/action.yml:28` ran `pnpm supabase:start` with stdout streaming straight into the runner's log, and that CLI's start-up banner prints the stack's generated `sb_secret_…` value next to the browser-safe one. No gate in the repository could have seen it: every credential check looks at the tracked tree, `dist/`, or the two Playwright artefact directories, and CI was green on all three. | Read out of the retained copies of run 18's logs as text, not from a failure: `ci-run18-db.log:290` at `2026-09-29T10:25:45.494Z` and `ci-run18-browser.log:291` at `10:32:44.480Z`, each inside the `##[group]Run pnpm supabase:start` block, each the `🔑 Authentication Keys` box carrying `Publishable │ sb_publishable_…` and `Secret │ «sb_secret_, 41 chars»`. **Reproduced independently on run 19** (a different head, 55 minutes later): the same single occurrence at line 90 of each environment job's step-4 log, `11:21:53.065Z` and `11:31:11.303Z`, and zero in the static job — so this is deterministic behaviour of the step, not a one-run accident. The value is masked in every local copy (`grep` for the shape across all retained files → 0) and is not reproduced anywhere in this report. Two measured aggravations, and one measured limit on severity: (i) the publishable value is **identical in both jobs of both runs**, so this stack hands out a stable key set per project rather than a fresh one per job — the same secret recurs in every run's log; (ii) the log path is not tracked, so the scanning scope could never have covered it; (iii) against that, the tracked tree holds no seed for it — `supabase/config.toml` has no `apikey`, `jwt` or `secret` entry of any kind (measured by `grep -niE "key\|jwt\|secret\|token"` over it → no lines) and the repository's configured Actions secrets and variables are both empty — so what the banner prints is the credential set of *this throwaway stack*, valid only against a loopback listener on this workstation, and it was unreachable by the time the value could be read back: the `release-local-ci-state` step removed every container of that stack before this report was written (`docker ps -a` re-grepped → no DueWeave container). It is nonetheless a privileged-shaped value in a log the platform retains, which is the boundary this stage set for itself, and its *stability* (i) means every future unfixed run would repeat it. Two further shapes sit in the same banner and are deliberately **not** treated as leaks: the database row the runner itself redacts (`│ URL │ ***127.0.0.1:54322/postgres`) and the Storage-API S3 pair, whose `Access Key`/`Secret Key` values (`625729a08b95bf1b7ff351a663f3a23c` / a 64-hex `850181e4…`) are **byte-identical in runs 18 and 19 and ship inside the CLI binary itself** (both strings are present in `node_modules/.pnpm/@supabase+cli-windows-x64@2.117.0/…/supabase-go.exe` and in no tracked file) — published constants of the local stack, not project secrets, and not matching any of the eleven credential shapes. Masking them would need a generic long-hex rule that would also erase every build digest in a log, and the storage row is the one an operator reaches for when an upload-path test fails. | `scripts/redact-cli-secrets.mjs`, a line filter that replaces credential-shaped tokens — the `sb_secret_`/service-role family, JWTs whose decoded payload names a privileged role, and connection-string passwords — with `[redacted-<shape>-<n>-chars]`, keeping URLs, ports and browser-safe values so a stack that fails to start is still diagnosable. The step is now `set -o pipefail` + `pnpm supabase:start 2>&1 \| node scripts/redact-cli-secrets.mjs`. **`tests/ci-log-credential-redaction.contract.test.ts` (5 cases)** does not re-assert the filter against its own list: it feeds the banner shapes through the filter and back into **this repository's existing gate** (`verify-secrets.mjs --dir` on one temp file), requiring exit 1 unfiltered and exit 0 filtered, so the two rule sets cannot drift silently; the fixture is assembled at runtime because a literal of that shape in a tracked file is a HARD finding no allowlist excuses. Two more cases pin `2>&1` and `set -o pipefail` on the step. Falsified both ways: removing the `sb_secret_` rule turned 2 cases RED, and removing `set -o pipefail` turned the step case RED. **Then verified against real CLI output, not fixtures**: the repaired pipeline was run in the WSL qualification clone (HEAD `ec868e8`, its own throwaway `dueweave` stack on ports 54321/54322) with a `tee` of the raw stream — raw capture `80 lines, 1 sb_secret shape, 0 redaction markers`; filtered capture `80 lines, 0 sb_secret shapes, 2 redaction markers`, and those two markers are exactly the two privileged rows of the banner: `│ Secret │ [redacted-sb-secret-key-41-chars] │` and `│ URL │ postgresql://[redacted-db-password]@127.0.0.1:54322/postgres │`. That second raw line is also what identifies the `***` in run 18's CI copy as the credential prefix of this same row — who replaced it there is still not claimed. Everything a diagnosis needs survived: `Publishable`, `Project URL`, `http://127.0.0.1:54321`, the REST path and the `127.0.0.1:54322/postgres` host-port-database tail match the raw capture line for line, and the pipeline exit code was `0`. `scripts/local-supabase-env.mjs` then still read the running stack and wrote `.env.local`, so the mask did not blind the step that follows it. The stack this check started was stopped by the same script, with `docker ps -a`/`docker volume ls` re-grepped for `dueweave\|project-ar1` → none, and no listener on 3000/3100/54321/54322 after it; the unrelated `localvivaahvarnam` stack on the same engine was left running and untouched throughout. (That engine check was scoped by name to `dueweave\|project-ar1`, which is the right rule for *CI's* stack but the wrong rule for proving "the engine is as I found it": a later probe in this same segment started a stack under a different slug and this grep could not see it — see D-S9-8.) The `pipefail` claim was first attempted against a **real CLI failure** rather than a synthetic one, and **that attempt did not establish it** — disclosed in full below and in the session-integrity section. What was written here previously ("invoking the repository's own Supabase binary from a directory with no project makes it exit 1, and the shipped shape gives `rc=1` while deleting `set -o pipefail` gives `rc=0`") is **not what the capture says**: `ds97-pipefail-out.txt` records `bare rc=0`, `shipped rc=0`, `without-pipefail rc=0`, because the binary invoked from `/tmp/ds97-fail-XXXX` did not fail — it *started a full stack* on the default ports under that slug. So no real-CLI falsification existed at the time this row was written, and the throwaway stack it started is what turned run 20 red. The property is nevertheless now proven, by a better instrument than the probe: **run 20's `database` job is a real `supabase start` failing behind the real filter on the real runner**, and the step conclusion is `failure` with `##[error]Process completed with exit code 1.` at `12:30:15.430Z`, after which the five dependent steps are `skipped` rather than executed against a dead stack. (The generic form was measured first and does hold in isolation: `sh -c "exit 42" 2>&1 \| node <filter>` → 42 with pipefail, 0 without. That is a shell-semantics measurement, not a CLI one, and is labelled as such.) |
| **D-S9-8** | *Self-inflicted, and the reason run 20 is red:* this stage's own D-S9-7 verification left a disposable Supabase stack running on the shared Docker engine, and its port collision then failed the CI stack start on the repair head. | `docker ps` after the run lists 12 containers + 3 volumes under the slug `ds97-fail-ZiL0` — the name comes from `mktemp -d /tmp/ds97-fail-XXXX` in `ds97-pipefail-proof.sh`, up since ≈11:56Z, publishing 54321/54322/54323/54324/54327; run 20's database step names the same port (`already using 0.0.0.0:54322`). The probe's own closing check reported the engine untouched because it grepped `dueweave\|project-ar1`, a correct scope for CI's stack and a blind one for a stack started under a different slug. Two claims in this file were refuted by that discovery: that the probe falsified `pipefail` with the real CLI (it recorded `rc=0`, `rc=0`, `rc=0` — see D-S9-7's row), and that the verification "left the engine as found". | No repository change is justified — the gate behaved correctly, reddening the step and skipping its dependents. Remediation is the residue: at 12:4xZ, with the runner idle and the run finished, exactly the slug-matched containers and volumes were removed; re-measured as 0 slug matches, 0 `dueweave` containers, no listener on 3000/3100/54321/54322, the 6 unrelated containers still up, no prune, no `.wslconfig` or resource change. Behaviour rule adopted for the rest of this stage: an engine check that wants to say "as I found it" must enumerate **all** containers and diff against a pre-command snapshot, not grep for the project's own name. |
| **D-S9-9** | *The reason run 22 is red:* a release journey asserts the Free-limit refusal toast and then clicks the `.founder-limit-callout` button that toast is covering, at `e2e/stage8-local-founder-reviewer.spec.ts:405` and `e2e/stage8-local-founder-customer.spec.ts:172` (line numbers as of the failing head `fd2e12d`; the repair inserts three lines above each). Playwright's click hovers its target first, the pointer lands inside the notification stack, and sonner pauses a toast's auto-close while the pointer is on it — so a 9 s overlay became an unbounded wait and the test died on its own 180 s budget. Same mechanism as D-S9-1, new site. | Read off the failing run before any edit, not assumed afterwards: the call log pairs `waiting for element to be visible, enabled and stable` with `<li … data-sonner-toast="" data-removed="false" data-visible="true" …> from <section … aria-label="Notifications alt+T"> subtree intercepts pointer events` and the same for `<div data-description="">Founder access removes the active-receivable limi…</div>`, collapsed as `80 × retrying click action` across the whole budget; `e2e/stage8-local-founder-reviewer.spec.ts:405:103`; the artifact's `test-failed-1.png` shows the toast over the call-out with the pointer on it; the mechanism is in the dependency's own bundle (`sonner@2.0.7` `index.js:1135-1136` `onMouseEnter`/`onMouseMove → setExpanded(true)`, `:612 if (expanded \|\| interacting \|\| isDocumentHidden) pauseTimer()`), and the 9 s lifetime is this project's own constant (`client/src/components/ui/sonner.tsx:9,18`). **That the identical code passed on run 21 in 19.9 s is the measurement that makes this an order-dependency race rather than a regression** — which of the two Founder journeys loses is decided by the `psql` round-trip between the assertion and the click. Reproduced as a RED where it can be executed: `tests/e2e-refusal-toast-occlusion.contract.test.ts` first reported `2 failed \| 1 passed (3)`, failing on exactly the missing `clearToasts(page)` between the refusal assertion and the covered click in each of the two specs. A local browser RED was deliberately *not* attempted: the WSL qualification clone still sits at `ec868e8` (five heads behind, its own uncommitted copy of `scripts/redact-cli-secrets.mjs`), so replaying there would not have tested this head, and starting another throwaway stack on 54321/54322 to do it is precisely the residue that turned run 20 red (D-S9-8). Run 22 is the reproduction. | Test-side only. Both journeys now call the harness's existing `clearToasts(page)` between the refusal assertion and the click (`e2e/founder-browser-harness.ts:74-76`, which asserts the notification region's `li` count reaches 0 rather than sleeping). That helper already had 10 spec-level call sites before this repair, and the evidence it is the right remedy rather than a guess is that the same journey does exactly this three times in the same place with the same toast geometry (`e2e/stage8-local-founder-customer.spec.ts:155-158`: `addReceivable` → assert → `clearToasts`) and all three passed on run 22. `tests/e2e-refusal-toast-occlusion.contract.test.ts` (3 cases) pins the order in both specs and pins that `clearToasts` waits for the stack to empty rather than sleeping, so the order-dependency cannot return silently; GREEN measured as `3 passed (3)`. **No timeout was raised, no assertion weakened, no sleep added, `retries` still `0`, and no product CSS or toast geometry changed** — the overlap a human would hit is unchanged and stays reported to the owner below, alongside the fact that the refusal toast itself carries the same Founder destination the call-out button does. **Its CI acceptance is obtained by run 25.** Runs 23 and 24 — the two that followed the repair — each died in `db reset` before Playwright launched, so up to run 25 the repaired journeys had executed in CI exactly once (run 22, where one lost the race) and zero times after the repair. Run 25 executed them on the repaired head: `✓ 57 [chromium] › e2e/stage8-local-founder-reviewer.spec.ts:356:3 › … (18.0s)` at `10:18:31.949Z`, the exact test run 22 lost, with the rest of that spec (slots 52-61) green, `retries: 0` held, and no allowance granted to it. Its contract suite is counted by the gate on every one of those heads (26 files / 371 tests on runs 23-24, 26 / **372** on run 25). Limitation 25, closed. |
| **D-S9-10** | *The reason runs 23 and 24 could not be diagnosed from anything they published:* the one step in `.github/actions/local-supabase` that runs the Supabase CLI **unpiped** is also the only one that runs it without the flag the CLI itself names on failure. When `Replay every committed migration` died twice, the entire retained evidence was `error running container: exit 1` plus `Try rerunning the command with --debug to troubleshoot the error.` — no phase line, no container output, no artefact — because `db reset` launches its schema-phase work in anonymous one-shot containers and issues `wait?condition=removed`, so the container holding the only copy of the error is deleted before the CLI prints the next line. | Read out of both red runs' retained logs before any edit, and confirmed against the engine's own API record: run 23's `f6fec8b7e57b…` and run 24's `a50e52d7f3a9f647cd5fb7abd5a556a17653ee57e702b93a1bf56a5ccacf427d`, both created from `public.ecr.aws/supabase/realtime:v2.130.0` by the CI's own Linux client, lived 3.62 s and 3.18 s respectively where the same one-shots take 7.69–8.56 s to completion; **neither container's `Cmd` or `stderr` exists anywhere any more** (Docker Desktop keeps no output for a removed container and rotates its VM log at ~1 MB / six minutes). The retention gap was then closed *empirically*: the identical command with the CLI's own flag printed the phase this step never reached — `Running migrations` → `sudo -E -u nobody /app/bin/migrate`, `Seeding selfhosted Realtime` → `realtime eval 'Realtime.Release.seeds(Realtime.Repo)'`, `Starting Realtime` → `exec /app/bin/realtime eval …health_check("realtime-dev")` — i.e. `Initialising schema` is **three** one-shots from one image, so "a realtime container exited 1" cannot name a stage without `--debug`. That capture is from a passing run (`reset_exit=0`, 43 s, in the runner's own workspace directory), which is also the measurement that shows the flag costs nothing structural. | `.github/actions/local-supabase/action.yml`, one step, one command: `set -o pipefail` + `pnpm db:reset:local --debug 2>&1 \| node scripts/redact-cli-secrets.mjs` — the same invocation the step always was (`package.json`'s `db:reset:local` is `supabase db reset --local --yes` and pnpm forwards extra args, verified against the pinned `2.117.0`), now piped through D-S9-7's existing filter like the other CLI step in this action. **This is a retention repair, not a claimed fix**: it changes no test, assertion, timeout, budget, `retries` value or gate, and it does not make a failing replay pass — measured, not assumed: under the runner's own shell flags (`bash --noprofile --norc -e -o pipefail`) an injected left-side `exit 7` still returned 7 through the pipeline and skipped the next line, whereas without `pipefail` the filter's 0 would have hidden it (the same property D-S9-7 pinned for the start step, and covered by `tests/ci-log-credential-redaction.contract.test.ts`'s step-shape cases). Redaction of the wider stream was checked by feeding privileged shapes through the real filter: `sb_secret_…`, a service-role JWT and a connection-string password all came back masked; the browser-safe anon row stayed visible by design. **`tests/ci-log-credential-redaction.contract.test.ts` gained a 6th case** pinning the replay step against the same three properties — that it exists, that it still runs `pnpm db:reset:local`, that its combined output goes through `scripts/redact-cli-secrets.mjs`, and that `set -o pipefail` is on the step — so the filter cannot be removed from the one CLI call that has killed two runs without a test noticing. Measured RED/GREEN, not asserted: against the pre-change `action.yml` the case failed with `the migration replay step reaches the job log unredacted` (`Tests 1 failed \| 5 passed (6)`); against the repaired step it reports `6 passed (6)`. It is selected by step *name* rather than by an indented command line, because the pre-change step wrote `run: pnpm db:reset:local` on one line and a command-shape regex would have "passed" by finding nothing — the first draft of the case did exactly that and its message was corrected before the repair was re-applied. Limitations 24 and 26; owner actions 15 and 16. **Executed and proven in CI by run 25**, which is the first head to carry it: the replay sub-step passed in both environment jobs (41 858 ms and 44 503 ms, on two independently started stacks), its `--debug` line and the realtime one-shot's own `set -x` trace are in the retained logs — the phase names runs 23 and 24 could not print — `error running container` occurs 0 times, and the D-S9-7 sweep repeats on the widened stream (0 privileged shapes, both `[redacted-…]` markers present where a stack started). It fixed nothing, claimed nothing, and did not make anything pass by widening what a filter hides. **It also does not claim credit for run 25's green replay:** the flag changes only what the step prints, and the step's exit status is still the left-hand command's, which the contract case pins. |
| — | Assertion strength | — | **No security assertion was weakened anywhere in this stage.** No expectation was deleted, no `toHaveCount` relaxed, no error-copy assertion loosened, no isolation probe narrowed; the only assertion changes are added waits and larger time budgets, both recorded with the measurement that justified them. `retries` is `0` in both Playwright configs and pinned by a contract test that also rejects `--retries` on the command line. The D-S9-7 repair was checked against the opposite failure mode on purpose (`pipefail`, above), because a log filter is exactly the kind of change that turns a failing step into a passing one. D-S9-9 was checked against the same temptation: the four obvious ways to make run 22 green — a bigger `timeout`, a `waitForTimeout`, a `retries: 1`, or moving the click before the assertion — were all rejected as symptom fixes, and the repair is a wait on the thing that was blocking. |

## Host-state caveat, disclosed rather than smoothed

The baseline battery and the passing battery did not run on identical machines-states, and the
difference is material to the 33.2 m → 25.5 m spread:

* baseline (`3 failed / 8 skipped / 6 did not run / 164 passed`) ran at **99 % disk used and
  3.6 GB free RAM**, on a host with a Docker daemon that died later the same day;
* the passing 181-slot battery ran at **≈22 GB free disk and ≈8.9 GB free RAM**;
* the closing static gates ran at **≈14 GB free / 6.1 GB free RAM**;
* at the time of the fresh `pnpm test:e2e:smoke` re-measure the host reported **15.2 GB free disk
  of 475.1 GB and 5.9 GB free RAM of 15.6 GB**.

This is a shared Windows workstation: other sessions' processes appear and disappear, and
`0xC0000142` process-start failures have been observed. What the numbers above establish is
therefore *behaviour reproducible under load*, not a performance claim; a `p50/p95` or capacity
statement cannot be made from this machine, and none is made.

The consequence this section used to carry about CI budgets is now closed by measurement rather
than argument. `timeout-minutes: 45` on the `browser` job had been set from ~20 minutes of measured
local work plus container start, Chromium download and a cold `vite dev`, and this file said it
"has **not** been validated against a real runner" — that sentence was true when written and is now
superseded: run 18's `browser` job finished its whole job in **18 m 07 s against that 45-minute
budget**, with the smoke battery itself measured in CI at `79 passed (13.9m)` and the warning gate
at `3 passed (43.7s)`. The budgets on all three jobs are now validated against two real executions
on this runner, on this topology (runs 18 and 19, worst browser job 18 m 07 s against 45 m). They
are still not validated against a *second* machine or an empty Docker image cache, and the budget is
a ceiling, not a promise.

## Flakiness, timeouts, PGRST303

| Field | Value |
| --- | --- |
| PGRST303 | **0 occurrences, recorded per log as instructed, none rerun away:** `p33-live.log` 0, `p34-battery.log` 0, `p34-battery2.log` 0, `p35-run1.log` 0, `p35-run2.log` 0, `p32-pgtap.log` 0, `p36-testdb.log` 0. **And 0 in each of run 18's three executed CI logs** (`ci-run18-static.log`, `ci-run18-db.log`, `ci-run18-browser.log`), grepped for `PGRST303` and for SQLSTATE `40001` — the real runner saw the condition no more than the laptop did. Postgres serialisation `40001`: 0 in the same logs. **Run 19's three executed logs (head `f4bcc61`) grep 0 for `PGRST303` and 0 for `40001` as well**, so the condition is absent on two independent self-hosted heads. **Run 20's logs (head `f28bae6`) also grep 0 for both**, though its database job never reached the suites. **Runs 21 and 22 were swept the same way on their retained logs: `PGRST303` 0 and `40001` 0 in each of the six**, including run 22's failing browser log — so D-S9-9 is not a database-serialisation symptom either; the write that journey asserts had already been refused correctly. The Stage 4 loop and hammer artefacts from the earlier qualification (`stage4-pgrst303-*.txt`) remain the record of the condition's investigation; nothing in Stage 9 re-triggered it. **Run 23's two executed logs sweep 0 for `PGRST303` and 0 for `40001` as well**, so its red is not a serialisation symptom either — and note what that sweep does *not* cover: its `database` job died before any suite ran, so run 23 contributes no new observation of the condition under load at all. |
| TIMEOUTS | Closing battery: 0. Baseline battery: 4, all accounted for by D-S9-1/2/3 above (2 × 30 000 ms test, 1 × 30 000 ms `beforeAll`, 1 × 120 000 ms click), 0 after repair. CI run 18: 0 job-level timeouts, 0 test-level timeouts, all three jobs finished inside their budgets (1 m 32 s of 25 m, 7 m 18 s of 40 m, 18 m 07 s of 45 m). CI run 19: the same, 0 and 0, with margins of 2 m 07 s of 25 m, 6 m 52 s of 40 m and 17 m 47 s of 45 m. Runs 20-22: **0 job-level timeouts on any of them** — run 22's `browser` job took 18 m 20 s of its 45 m, its `database` job 5 m 39 s of 40 m and its `static` job 1 m 13 s of 25 m, so no budget in this workflow has ever been the reason anything failed. Run 22 does carry **one test-level timeout**: `Test timeout of 180000ms exceeded` on `stage8-local-founder-reviewer.spec.ts:356`, caused by a `locator.click` that could not complete because the refusal toast would not dismiss while the pointer was held on it (D-S9-9). It is recorded as a defect in the test's action order, not as a budget that needed raising: the budget fired once, on attempt 1, and the repair removes the wait instead of enlarging the budget. **Run 23 has 0 job-level timeouts and 0 test-level timeouts** — `static` used 1 m 17 s of 25 m, `database` 2 m 14 s of 40 m before its step died, `browser` never started — so no budget has yet been a factor in any of the six self-hosted runs, and run 23's failure was not enlarged, retried or budgeted away. |
| FLAKINESS | Nothing was retried: `retries: 0` in both configs, and the closing battery's 181 slots are 181 distinct ids, so no test appears twice. Two consecutive `pnpm test` runs returned identical 666/1 counts. The three baseline failures were deterministic and reproduced in isolation before being fixed (19 passed / 2.9 m and 9 passed / 3.1 m isolated re-runs after repair). **Run 22 is the one case that falsifies the earlier reading of that evidence: a green run 21 did not establish a deterministic suite.** `stage8-local-founder-reviewer.spec.ts:356` passed on run 21 and on run 18 with identical code, then failed on run 22 — D-S9-9. The failing pair is *order*-dependent rather than randomly flaky: the journey asserts the refusal toast and then clicks the `.founder-limit-callout` button underneath it, and sonner keeps a toast alive while the pointer is on it, which is exactly what Playwright's actionability hover does. Which journey wins that race is decided by how long the database round-trip in between takes, so the same commit can pass on one run and time out on the next. The repair removes the race instead of masking it (`await clearToasts(page)` before the click, the convention this harness already used at 12 other call sites), and `tests/e2e-refusal-toast-occlusion.contract.test.ts` now fails if the two specs reintroduce the order — so the flake cannot come back silently, on this machine or any other. It was caught on attempt 1, with no retry, and the local re-run after the repair was clean on the first pass. `stage8-local-founder-customer.spec.ts` carried the identical latent sequence and was repaired in the same commit, before it had a chance to lose the race in CI. The residual known intermittency is documented, not hidden: concurrency on one port (residual risk 5 in the skip classification) makes two simultaneous browser runs refuse connections mid-flight — that is an operator-environment constraint the runner's `--strictPort` plus the fail-closed guard convert into a hard error rather than a flake. **Run 23 adds a second, different non-determinism to this record, and it is not in the test suite.** `pnpm db:reset:local` succeeded on runs 18, 19, 21 and 22 on this same runner and failed on run 23 with the CLI's `error running container: exit 1`; the transient container concerned completed in 7.69 s in a replay of the identical action on the identical head's schema and died at 3.62 s in the run. This file does not call that a flake and does not paper it: the cause is unrecovered, the mechanism is documented in the run-23 section, and the consequence for *this* row is the honest one — **run 23 executed no test of any kind, so it neither confirms nor refutes the D-S9-9 repair, and the determinism question D-S9-9 raised is still open pending the next run.** |

## KNOWN LIMITATIONS

1. **The green CI evidence is for one topology.** Runs 11–17 were GitHub-hosted and were refused a
   runner with zero steps; run 18 executed on `dueweave-local-ci`, one self-hosted runner on one
   WSL2 Ubuntu 26.04 machine (kernel 6.18.33.2, Docker 29.7.2, Node 22). So this stage proves the
   repository's gates pass when GitHub Actions orchestrates them; it does **not** prove anything
   about GitHub's hosted images — a fresh container, cold `node_modules`, hosted Docker, and
   GitHub's own `actions/cache` behaviour for this workflow remain unmeasured. The composite actions
   and the `pnpm audit` network step are first candidates to behave differently there.
2. `main` remains unprotected and directly pushable; the protection rule is designed, not enabled
   (PHASE 26 forbade enabling it without explicit authorization). It is now *actionable*, because
   run 18 published the three check names at `ec868e8` — see owner action 3.
3. Hosted-environment properties are unclaimed by construction: real email confirmation and SMTP,
   hosted Auth Site URL and redirect allow-list, a hosted project's pre-granted default privileges,
   `tests/supabase.public-config.live.test.ts`. See
   [docs/SECURITY_MODEL.md](docs/SECURITY_MODEL.md) for the hosted-only gap table.
4. **`scripts/verify-secrets.mjs` overstates its own scope in `--dir` mode.** Its closing line is
   `"No privileged credential found in the tracked tree or the built bundle."` (`:203`), printed
   whatever was actually scanned; run 18's `browser` job therefore said "the tracked tree or the
   built bundle" after scanning 1 file in `test-results` and 1 in `playwright-report`. The scan
   itself ran and the finding is only in the wording. Not patched here: the script is on the
   executed path of the green head, and editing it would move the deliverable off the SHA this
   evidence proves. Owner action 4.
5. **The `static` job's bundle-credential test is weaker than its green looks.**
   `tests/credential-boundary.contract.test.ts:64` skips when `dist/` is absent and, when present,
   subtracts `process.env.VITE_SUPABASE_ANON_KEY` from the JWTs it finds. In CI the bundle was built
   *with no credentials at all*, so it contained no anon key to exclude and none to report — the
   pass is real but it scanned a trivially clean bundle. Measured counter-case (my WSL copy,
   `dist/` built with the local anon key, `.env.local` moved aside before the test): the same test
   goes **RED on one browser-safe demo anon token** — `Tests 2 failed | 356 passed (358)`. So
   "no privileged credential in the production bundle" is verified against whatever the build
   environment happened to hold, and a laptop with a credential-built `dist/` can fail it for a
   public value. Recorded, not smoothed; owner action 5.
6. **`.github/actions/release-local-ci-state` is unpinned cleanup.** `ci.yml` runs it in both
   environment jobs, and its scoping rules (stop only this project id's stack; kill only listeners
   on 3000/3100 whose `/proc/<pid>/cwd` is `$GITHUB_WORKSPACE`) are exactly the protections a shared
   runner needs — but `grep` over `tests/`, `docs/` and `*.md` finds **zero** references to it. No
   contract test protects those rules, so a future edit could widen the sweep silently. Contrast
   `local-supabase`, which `tests/ci-gate-manifest.contract.test.ts` does pin. Owner action 6.
7. Provider-rejected signup has no local equivalent (residual risk 2) and existing-client
   conversion's conversion-specific assertion is only covered through adjacent paths (residual
   risk 3).
8. The bundle contracts test `existsSync(dist)`, not freshness, so a stale `dist/` could be
   accepted by the static half (residual risk 1); limitation 5 above is the same seam measured from
   the other side.
9. Two moderate runtime advisories in `react-router` remain unpatched by design (see the audit
   table); the upgrade is a breaking dependency decision.
10. No WCAG claim: Stage 9 retained the accepted targeted keyboard/screen-reader qualification and
    did not certify conformance.
11. No performance claim: the machine caveats above forbid it.
12. The reduced-motion, session-removed and two Stage 4.1 behaviours now run in executed suites,
    but the six legacy host-credential specs were left in place rather than deleted — deleting
    accepted history is the release owner's call, and the supersession map is the evidence for it.
13. Stage 8's D-S8-3 finding stands: a two-tab browser race is unmeasurable on this host (a
    backgrounded tab issued its approval 37.3 s after its twin), so that concurrency property is
    proven against two concurrent authenticated clients in the live suite, not in the browser.
14. One machine, one workspace, one Docker engine: a green check now depends on this workstation
    being up. The runner was observed to flap once (`offline` for under a minute, then
    `online busy=false` again) during this recovery, and `cancel-in-progress: true` means a second
    push to the same ref cancels the in-flight run rather than queueing behind it. This is not
    hypothetical: D-S9-8 is exactly that shared-engine hazard realised by this stage's own residue,
    and it cost run 20. The morning after run 21 the same dependency showed up in its plainest form:
    the host had been rebooted (`ExecMainStartTimestamp` 2026-09-30 06:15:34 UTC, later than run 21's
    completion) and **Docker Desktop was not running** — no `Docker*` process, engine npipe absent, and
    the distro's `docker` resolving to a Windows shim that reports WSL integration inactive. The runner
    itself came back healthy (`active`/`running`, `dueweave-local-ci` online, workspace at `f03fd0d` with
    an empty porcelain), so a push then would go red in `database` and `browser` at the stack-start step
    while `static` stayed green: an availability dependency of the machine, not of the code. This session
    did not start the engine, because starting it also auto-starts an unrelated project's containers on
    the same daemon.
15. That dependency is now measured in both directions. Run 22 executed with the engine up, and the
    state re-measured after it is: runner unit `active`, `dueweave-local-ci` online and idle, no
    listener on 3000/3100/54321/54322, **zero** DueWeave/project-ar1/ds97 containers or volumes on the
    daemon — and **5 unrelated containers running** (`supabase_{db,rest,auth,kong,inbucket}_localvivaahvarnam`),
    which is that same auto-start on the shared daemon. They were left exactly as found: pruning them
    is outside this stage's scope, and D-S9-8 is the evidence for what touching another project's
    stack on this engine would cost. The availability caveat stands either way — the engine is now a
    hard dependency of two of the three jobs.
16. **One green run was not proof of a deterministic suite, and run 22 is the measurement that says
    so.** Runs 18, 19 and 21 all returned the browser battery green with `retries: 0`, and this file
    previously treated that as sufficient. Run 22 ran *identical* journey code on the same runner and
    failed `stage8-local-founder-reviewer.spec.ts:356` — D-S9-9, a toast that will not dismiss while
    the pointer is held on the control beneath it, so the outcome is decided by how long the database
    round-trip in between takes. The repaired site is pinned by
    `tests/e2e-refusal-toast-occlusion.contract.test.ts`, which asserts the wait exists at every
    refusal-toast→covered-click pair in both Stage 8 specs, so *that* pair cannot regress silently.
    What is **not** pinned is the general hazard: the contract test recognises one toast title and one
    button name, and any future journey that clicks under a *different* notification would need the
    same convention applied by hand. The convention is `clearToasts(page)` (14 call sites in `e2e/`
    after this repair); a broader lint rule that forbids an action while the notification region is
    non-empty is the owner's call, not something to add inside a recovery.
17. **The overlap D-S9-9 fixes in the test is also a live product behaviour.** The refusal toast is
    positioned `top-right` with `offset={{top:108,right:28}}` (`client/src/components/ui/sonner.tsx`),
    which is where `.founder-limit-callout`'s "View Founder access" button sits, and sonner holds a
    toast open while the pointer is on it. So a real user who moves their mouse toward that button
    within the 9-second `REFUSAL_TOAST_MS` lifetime can keep the covering toast up for as long as they
    hover. This stage did not touch product CSS or toast geometry (D-S9-9's repair is confined to test
    action order), so the finding is handed over rather than silently fixed: owner action 12.
18. **The runner still carries the pre-rename checkout.** After the repository was renamed,
    `~/actions-runner-dueweave/_work/` holds both `DueWeave/DueWeave` (the workspace every run from 22
    onward uses) and the old `project-ar1/project-ar1` workspace from runs 18–21, plus the runner's own
    `_actions`/`_tool`/`_temp`/`_PipelineMapping` directories. The stale checkout was left in place: it
    is the machine's copy of history that this report's run-18/19/21 citations were read from, deleting
    it is not required by any gate, and `docker`/workspace pruning on a shared engine is exactly the
    class of cleanup this stage's boundaries forbid. It is listed as owner action 13 rather than
    quietly removed. One consequence worth knowing: a job's `$GITHUB_WORKSPACE` path has changed
    mid-recovery, so any future log citation has to say which workspace it came from.
19. **`git` on the Linux side is real but version-different.** The qualification clone's
    `/usr/bin/git` is 2.53.0 against the Windows client used for the pushes; nothing in the delivered
    diff depends on a version-specific behaviour, but the two working copies are separate and the
    Linux clone is not a substitute for the Windows one (see the integrity note on its stale head).
20. **The repair does not retract what is already on GitHub.** Runs 18 and 19 executed before the
    filter existed, so their `database` and `browser` job logs on the platform still carry the local
    stack's privileged key. This stage masked its own downloaded copies and did not delete anything
    the account shares — no artefact, log or run was removed, which is also the answer to the
    "deleting logs/caches does not restore hosted minutes" note: deletion was never the point, and
    retention of a credential-bearing log is the owner's call (owner action 11). What *is* now
    measured narrows what that call is about: the key belongs to a disposable loopback stack, which
    is stopped, and it is not machine-specific either — the `Publishable` line printed by a fresh
    local start in the qualification clone is the same literal the two CI runs printed
    (`sb_publishable_ACJWlz…`, prefix only — the remainder is deliberately not carried in this file),
    and nothing in the tracked tree seeds it (`config.toml` has no key/JWT/secret line). What *does*
    hold the values is the CLI's own gitignored local state: the Windows working copy carries
    `supabase/.temp/start-secrets/supabase_edge_runtime_dueweave/env/docker.env` (matched by
    `.gitignore:114 supabase/.temp/`) from a local start, and it is the only place on this machine
    outside the platform's retained logs where a privileged *value* still sits. An earlier revision
    of this row said `.temp` "holds only a version stamp"; that was measured before the D-S9-7
    verification start, and is corrected here — the two Linux-side workspaces
    (`~/dueweave-qualification`, the runner workspace) do hold only `supabase/.temp/cli-latest`, with
    zero secret/publishable/db-url shapes in their `.env.local` apart from one browser-safe anon JWT
    each. So the value is reproducible by anyone who can read this repository and run `pnpm supabase:start`,
    which is why "rotate it" is not on offer as an action: how the CLI derives it is not established
    from here, and the only change that would alter it is a different `project_id`, which would break
    the local stack's own reproducibility. The finding stands on the rule, not on the value: a
    privileged-shaped credential must not sit in a log the platform retains.
21. **The log filter is shape-based, so it can only mask what it recognises.**
    `scripts/redact-cli-secrets.mjs` covers the `sb_secret_`/service-role family, privileged-role
    JWTs and connection-string passwords; a privileged value the CLI invents in a new format would
    pass through. The composition test narrows but does not close this: it proves the shapes in its
    fixture are masked by re-scanning the filtered text with `verify-secrets.mjs`, so if the CLI
    starts printing a shape the scanner knows and the filter does not, the *next* run of that gate
    on that text would flag it — but only for the fixture's shapes, not for live output. No CI step
    scans a job's own log, and GitHub offers no way to do that from inside the job that wrote it.
22. **Where the evidence copies live, and how they were verified masked.** The three run-18 job logs
    this file quotes are in the operator's Windows temp directory
    (`%LOCALAPPDATA%\Temp\wslops\ci-run18-{static,db,browser}.log`), and run 19's are beside them
    under `%LOCALAPPDATA%\Temp\wslops\run19\extracted\` (43 files: one log per step plus `system.txt`
    per job). None of it is in the repository: a job log is not a tracked artefact, and committing one
    would put run output — including, before the redaction, a privileged key — into the release tree.
    The masking claim in an earlier revision of this row was **wrong when re-measured**: a shape sweep
    over the whole temp directory found 7 files still carrying privileged shapes — run 19's two
    environment step-4 logs with the full `sb_secret_` value, the two run-18 logs with the full
    publishable and the storage-key constant, the D-S9-7 verification capture, and the raw
    `run19/run19-logs.zip` downloaded from the API. All text copies were then masked in place
    (`sb_secret_*` → `sb_secret_[MASKED-LOCAL-COPY]`, publishable → same form, 64-hex → `[MASKED-HEX64]`,
    JWT → `[MASKED-JWT]`, URL passwords → `[MASKED-PASSWORD]`) and the raw zip, being an unmaskable
    archive of the same content, was deleted — it is this task's own scratch download, and the masked
    per-step text copies remain. The sweep re-run after masking reports **0 files with privileged
    shapes** in the Windows temp directory and 0 across the six WSL-side
    `~/ci-dryrun-*.log` captures (before masking: `ci-dryrun-db.log` and `ci-dryrun-browser.log` each
    carried 1 secret + 1 publishable + 1 URL password + 1 64-hex; the D-S9-7 raw/filtered pair carried
    only the hex constant). Counts were taken before masking; no value was ever printed into this
    file, into chat, or into a commit. A temp directory is not durable evidence, so the durable
    citations are GitHub's own run/job/step payloads (`gh api`, ids in the CI table) which the numbers
    were read from, and the retained copies are a convenience. Earlier revisions of this file also said
    "beside this repository", which was not where they were.
23. **A red `database` job produces no evidence artefact at all.** The only `Upload failure evidence`
    step in `.github/workflows/ci.yml` is in the `browser` job, so runs 20, 23 and 24 — all three red
    inside `database`'s composite step — returned `artifacts total_count = 0` and left only the platform
    log. That is why run 23's diagnosis had to be reconstructed from Docker Desktop's own VM log rather
    than from anything the run published. Not patched here: adding an upload step to `database` would
    move the executed head off the SHA this evidence describes, and a recovery is the wrong place to
    redesign the workflow's evidence surface. **Run 25 narrows this to a red `database` job specifically**:
    its red was in `browser`, and that job's `if: failure()` step published `browser-smoke-failure-evidence`
    (artifact `11089879345`, `6 245 468` bytes, 27 files) with both pre-upload scans clean — so the
    evidence gap is job-specific, not workflow-wide, and run 25's diagnosis needed no host-side record at
    all beyond the confirmation of a window the artifact could not see. Owner action 14.
24. **The `db reset` failure is not explained, and no repository or runner defect is proven by it.**
    Run 23 and run 24 died the same way, at the same sub-step, on heads differing only by this file, so
    the mechanism is now twice-observed and still once-unexplained: a transient anonymous container from
    `public.ecr.aws/supabase/realtime:v2.130.0`, started by the CLI during `db reset` and removed by it
    on completion, lived 3.62 s (run 23, `f6fec8b7e57b…`) and 3.18 s (run 24,
    `a50e52d7f3a9f647cd5fb7abd5a556a17653ee57e702b93a1bf56a5ccacf427d`) where the same one-shots take
    7.69-8.56 s to completion. The reason *those processes* exited 1 is unrecoverable, because the
    container holding their output is deleted by the CLI's own `wait?condition=removed` and Docker
    retains nothing for a container that no longer exists. Two faithful replays of the same action
    order, same CLI version, same image tags, same project id and a byte-parity `supabase/` tree
    completed the phase — the WSL clone in 7.69 s per one-shot, and the runner's own workspace directory
    end to end in 43 s with `reset_exit=0`. Schema content, the head under test, drift, resource
    exhaustion, a competing stack, the analytics collateral, the clock, a dirty workspace and any retry
    are each excluded by a reading in the run-23 and run-24 sections. What is left is an unexplained
    environmental failure in a third-party local-stack container, and the one thing this stage could
    prove rather than guess is that its own step left no trace of it (D-S9-10) — repaired forward as a
    *retention* change, so run 25's log names the failing one-shot whether it passes or not. Note the
    distinction the brief insists on: that is not a rerun of a red job, and it claims no fix.
    **Status after run 25 — the step executed green, twice, and the failure did not recur.** On head
    `ee90097` the `database` job's replay sub-step passed in 41 858 ms and the `browser` job's independent
    replay passed in 44 503 ms, both with `--debug`, both printing the realtime one-shot's own trace into
    the retained log; `error running container` appears 0 times in either. So the honest state of this
    limitation is *one unexplained pair of failures, then one green head on the same machine thirty
    minutes later* — a single observation of recovery is not a disproof of non-determinism, and nothing
    here explains why `f6fec8b7e57b…` and `a50e52d7f3a9…` died while run 25's three one-shots did not.
    What D-S9-10 changed is that a future occurrence is diagnosable: run 25's logs show the phase, the
    command and the health check that runs 23 and 24 could only point at. Consequence to weigh before
    merging: `database` is the one job that cannot currently be assumed deterministic on this machine, and
    D-S9-8 already cost it one run for a different reason. Owner actions 15 and 16.
25. ~~**The D-S9-9 acceptance is therefore still outstanding, and this file counts neither run 23 nor
    run 24 as providing it.**~~ **CLOSED by run 25 — kept here because the closure is only meaningful
    against the two runs that could not provide it.** The repair head (`9ee7921`) failed before any
    Playwright spec launched, and its follow-up head (`567be25`) died at the same sub-step before a spec
    could launch either, so between them the repaired journeys ran zero times since the repair. Run 25
    executed them: `✓ 57 [chromium] › e2e/stage8-local-founder-reviewer.spec.ts:356:3 › … › revoking
    through the reviewer's own session leaves every record and restores the limit (18.0s)` at
    `10:18:31.949Z`, with the whole reviewer spec green around it (slots 52-61), on the head carrying
    `3accf61`, in CI, with `retries: 0` and no allowance. The contract suite that pins the ordering
    (`tests/e2e-refusal-toast-occlusion.contract.test.ts`, 3 cases) was already counted by the `static`
    job on runs 23 and 24 (26 files / 371 tests) and is counted again on run 25 (26 files / 372 tests, the
    +1 being D-S9-10's case). Nothing in this item remains open; the browser job's single red on that run
    is a different test, a different mechanism, and is limitation 27.
26. **D-S9-10 widens the stream that reaches a retained log, and its masking is proven by shape, not by
    enumeration.** `--debug` makes the CLI print every container command it runs plus container stderr,
    so more lines from more sources now pass through `scripts/redact-cli-secrets.mjs` than before. The
    redactor's own suite asserts the privileged *families* (sb_secret/service-role, connection-string
    passwords, privileged-role JWTs) and feeds its output back through `scripts/verify-secrets.mjs`, which
    is the same gate the repository enforces on the tracked tree — but that is a proof over the shapes
    this stage knows about, not a proof that no future CLI debug line carries a credential the gate has no
    pattern for. The accepted trade-off is diagnosability (run 23 and run 24 were undiagnosable) against a
    filter whose coverage is shape-based. Second, and related: the diagnostic replays in the run-24 section
    were run from an interactive WSL shell, whereas CI runs the same command from the runner service
    process; that difference was not closed, and is stated rather than glossed.
    **Run 25 closed the second of those by observation** — the flag ran on the runner service itself, in
    both environment jobs, and the cost was exactly what the local capture predicted (668 lines for the
    `database` job against run 24's 407 for the same job, the `browser` job's replay step at 44 503 ms) —
    and the first stays a real limitation: on that run's two environment logs the sweep is clean (`sb_secret_`
    0, the `[redacted-…]` markers present where a stack actually started, `redacted-` 0 in `static`, which
    starts no stack), but that is a matched-shape result on one head's stream, not a proof about the next.
    Owner action 16.
27. **The browser release gate is not network-hermetic, so a release verdict on this machine can be
    decided by a third party's name resolution.** `client/index.html:16-18` preconnects to and loads a
    stylesheet from `fonts.googleapis.com` (DM Sans + Fraunces) on every page the suite opens, and
    `e2e/problem-watch.ts` fails a journey on any console error or unanswered request by design. Everything
    else the suite touches is an IP literal (`127.0.0.1:3000`, `127.0.0.1:54321`), so that stylesheet is the
    only reason a release-gate verdict depends on a resolver outside this repository. Run 25 is the
    measurement, not a hypothesis: the failing request never reached a connection (`status: -1`, all timings
    `-1`) at `10:21:49.465Z`, the same URL from the same page resolved 29 s later only after spending
    `13 055.3 ms` inside DNS, and WSL's own connectivity prober logged five `getaddrinfo()` failures
    (`-3` = `EAI_AGAIN` ×4, `-5` = `EAI_NODATA` ×1) between `10:21:43.760Z` and `10:22:49.844Z`, with
    `… 2110 messages dropped …` immediately before the first and zero such lines in every retained window
    from `10:37:03Z` onward. Consequences to weigh honestly: (i) the gate is *correctly* strict — an
    unanswered request on a release journey is a real condition, and this stage refused to mute it (the
    repo's own doctrine in `e2e/stage9-react-warnings.spec.ts:5-8` is quoted in the run-25 section); (ii)
    the gate is therefore also *not reproducible* — a green `browser` job on this runner now depends on an
    external network path this stage neither controls nor measures; (iii) a user of the product has the same
    dependency, so this is a genuine release observation, not a test artifact. What would close it is owner
    action 18 (self-host the two font families, or give the runner hermetic egress), and no local change
    here pretends to. `--dir` scans, migration counts, pgTAP and every other number are unaffected; this
    limitation touches only the `browser` job's dependency on `fonts.googleapis.com`. **Run 27 is the
    control, and it narrows rather than closes this:** its browser job returned the full 82 slots with
    `ERR_NAME` occurring 0 times in its log, which shows the same test passing on the same tree when the
    host's resolver is answering — i.e. the dependency is real and intermittent, not a broken test. A green
    `browser` job on this runner is therefore evidence about the product *and* about the workstation's DNS
    in that window; owner action 18 is what removes the second half of that sentence.
28. **Whether a run on this runner executes at all is a property of a workstation, not of the commit, and
    a cancellation of that kind is not a measurement of anything in this repository.** Run 26 proved it by
    failing: the push left at `16:49:29Z` while `gh api …/actions/runners` reported `status=offline` and
    `wsl.exe -l -v` reported both `Ubuntu` and `docker-desktop` `Stopped`, the queued run was picked up
    ~2 min later by the *enabled* systemd unit in the middle of the machine's boot, and both environment
    jobs ended `cancelled` inside their third step — before any command from this repository had been
    invoked — with `Browser release smoke` `skipped` and `steps: []`, 0 tests of any kind and 0 artifacts.
    The mechanism is the runner's long-poll to GitHub's job broker being aborted
    (`SocketException (125): Operation canceled` → `Get next message has been cancelled` → *The runner has
    received a shutdown signal*), which no workflow key, timeout, `retries` value or test can address: a
    runner that loses its broker connection cancels the job it is running. Two structural facts follow, and
    both are limits on what this stage can claim rather than things it fixed. (i) **Hermeticity has to hold
    at dispatch time, not only inside the job.** Steps in this workflow clean up after themselves (the
    `release-local-ci-state` step, and the port/container/volume readings in the machine-state sections),
    but a runner is a single instance on a machine that also hosts another project's Supabase stack, a
    Docker Desktop VM with its own restart policy, and WSL's idle-teardown behaviour — none of which a job
    can prepare in advance, and none of which this stage is authorised to change. (ii) **Runner state is
    multi-process by accident.** Because the service unit is `enabled` *and* the operator can start
    `./run.sh` by hand, more than one host can hold the same registration; when that happens the service
    log shows `A session for this runner already exists.` / `Runner connect error: Error: Conflict`, which
    is a condition this session itself created twice (a `./run.sh --replace` — `--replace` is a `config.sh`
    flag, so `run.sh` printed an "unrecognized argument" warning and kept running — and a second plain
    `./run.sh`), removed by killing only the PIDs it had created, and which any future operator can
    reproduce in two commands. What closes this is procedural and belongs to the runner's owner: read the
    machine as ready — `status=online`, `busy=false`, one runner host, an answerable engine, CI ports free —
    *before* pushing a release run (owner action 19). Until then, a red `browser` job can mean a Google
    Fonts lookup failed (limitation 27) and a red *anything* can mean the workstation was asleep, and
    neither of those is a statement about the code under test. **Run 27 is the other side of that gate, and
    the reason it is worth obeying**: that push waited until `status=online`, `busy=false`, one runner host,
    an answering engine and free CI ports had all been read, and the run it produced brought every gate of
    every job to a conclusion in 27 m 0 s with no cancellation, no skipped job and no retry — the first
    head after `f03fd0d` to do so.

## STAGE 10 OWNER ACTIONS (nothing below was performed by this stage)

1. **Decide whether the self-hosted runner is the intended permanent CI home, or a bridge.** It is
   what cleared the account-level blocker: run 18 consumed **zero GitHub-hosted minutes** on a
   repository-scoped runner that runs only this repo. If hosted minutes are still wanted, the
   billing/spending state of the `Pavithran-R-A` account is the thing to fix (Settings → Billing),
   and nothing in this repository needs to change for that — `runs-on` is the only line that moved.
   Accepted trade-off to weigh: a green check now depends on this workstation being on.
2. ~~Re-run this branch's CI on the final head SHA and read the three job conclusions.~~ **DONE for
   four heads**: `36555102272` (`ec868e8`), `36560985637` (`f4bcc61`),
   `36569878819` (`f03fd0d`, the head that carries the D-S9-7 redactor) and
   `36751052906` (`1c3fb52`, run 27) each returned all three jobs
   `completed/success` on `dueweave-local-ci` at attempt 1. Run 21 is the one that matters for the
   redaction repair, because it is the only *green* run whose stack started *and* whose retained logs were
   masked until run 27 repeated exactly that. **Between them no head after `f03fd0d` had returned a
   green, and run 27 is the run that changes that.** Five of the six runs that followed run 21 went red,
   for four different reasons, and only one of those reds was ever a defect in this repository's own
   files (run 22's toast/click ordering, D-S9-9, which run 25 then accepted):
   run 22 (`fd2e12d`) got `static` and `database` green but failed one browser test on a toast/click
   ordering defect (D-S9-9, **accepted by run 25**); runs 23 (`9ee7921`, the head carrying that repair)
   and 24 (`567be25`, a head whose only tracked change is this file) each failed one step earlier still,
   inside `db reset`, before any suite ran — the same sub-step, the same way — a failure this stage could
   not explain and does not attribute to the repository (limitation 24), and one run 25 did **not**
   reproduce; and run 25 (`ee90097`, the D-S9-10 head) returned both environment jobs green, the replay
   step included, then failed one browser journey's shared console/network guard on a **host
   name-resolution episode** measured from the run's own trace, Docker Desktop's VM record and the 69
   tests before it (limitation 27); and run 26 (`b26c428`, a head whose only tracked change is again this
   file) never reached a gate at all — both environment jobs were `cancelled` inside
   `Run ./.github/actions/setup-toolchain` and the browser job was `skipped` with `steps: []`, for a
   machine-state reason this stage owns and reports in full (limitation 28). (One earlier red sits
   *before* run 21 and is not in that list: run 20
   (`f28bae6`) failed the stack-start step on this session's own leftover port holder, D-S9-8, and was
   superseded by run 21.) **Run 27 (`1c3fb52`) is the tenth self-hosted run and the one that carries the
   delivered head**, and it returned what the brief asks for: 3 of 3 jobs `completed/success`, 40 of 41
   steps `success` with the only non-success being the `if: failure()` upload, `run_attempt 1`, browser
   **82 slots / 0 failed / 0 did-not-run / 0 skipped**, 0 PGRST303, 0 timeouts, 0 retries, artifacts
   `total_count 0`, every job on `runner_id 21` = `dueweave-local-ci`. So the head the owner must read
   before merging is now a head with a recorded green on it, and the condition attached to that reading is
   the one in limitation 27: run 27's browser job passed because the host resolved
   `fonts.googleapis.com` during its 18 minutes, not because the gate was made network-hermetic. It is a
   re-measurement, not a repair; nothing was changed in the repository because of run 25's red, run 26's
   cancellation or run 27's green. Two things about
   any next push are worth knowing in advance, both measured, both host-side: **Docker Desktop must be
   running** or `database` and `browser` will fail at the stack-start step while `static` stays green
   (observed 2026-09-30, engine down after a reboot, see the machine-state section), and `concurrency: …
   cancel-in-progress: true` means pushing twice in quick succession cancels the first of the two runs
   rather than queueing them. A first failure on a new head is a finding, not noise; fix from the
   observed step and log, and preserve the original failure in this file.
3. Confirm the plan permits protected branches on a private repository (still the single UNKNOWN in
   the protection row), then create the rule in `docs/RELEASE_PROTECTION.md`. This is now possible
   in a way it was not when that document was written: GitHub published `Static verification`,
   `Database contracts` and `Browser release smoke` as completed check runs *at* `ec868e8`, so they
   appear in the branch-protection picker. Enabling the rule needs the owner's own click; nothing
   here authorises me to make it.
4. Fix `scripts/verify-secrets.mjs:203` so `--dir` mode reports the directory it scanned instead of
   "the tracked tree or the built bundle", then let the next scheduled CI run re-prove the head
   (limitation 4).
5. Decide how the bundle-credential boundary should be qualified in CI — build with a non-privileged
   sentinel anon key, or drop the `process.env` exemption so the test asserts the same set the
   `verify:secrets` gate does (limitation 5). Either change moves the executed head, so it belongs
   with a normal forward commit and a fresh run, not inside this recovery.
6. Pin `.github/actions/release-local-ci-state` with a contract test asserting the sweep stays
   scoped to this project id and this workspace, the way `local-supabase` is pinned (limitation 6).
7. Decide PR #1's fate (close as redundant, or merge first — it is an ancestor of this branch).
8. Open the Stage 9 integration PR per `docs/PR_INTEGRATION_PLAN.md`, merge only after review.
9. Only then Stage 10: hosted Supabase project, environment configuration per
   `docs/STAGE_4_2_OPERATOR_CONFIGURATION.md`, operator bootstrap per
   `docs/OPERATOR_BOOTSTRAP.md`, and the Founder live-activation checklist — each a separate,
   explicitly authorized action. Real money stays off until that checklist is executed.
10. Decide the react-router upgrade, and whether to delete the six superseded legacy specs.
11. **Decide what to do with the retained logs of runs 18 and 19 — before any merge, this is not
    Stage 10 work.** Those runs executed the stack-start step before it was filtered, so their
    `database` and `browser` logs on GitHub still print the disposable local stack's `sb_secret_…`
    value (limitation 20). The options are to delete those runs' retained logs from the Actions UI,
    to leave them (the stack is loopback-only and currently stopped, and the repository is private),
    or to treat the key as burned and rotate the local stack's key set. Nothing here authorises me to
    delete or rotate on the owner's behalf, and deleting shared artefacts would not have recovered
    anything else either. Verify the *next* run's two environment logs carry no privileged shape
    before calling this closed — that check was part of the run-20 observation. **Done, and by
    the run that followed it:** run 21's sweep returned zero privileged shapes across all six expanded
    logs with the two `[redacted-…]` marker rows present in each environment log, so this open question
    no longer conditions the verdict. Run 22's two environment logs sweep the same way (privileged
    shapes `0`, both `[redacted-…]` marker rows present, and the publishable-prefix digest `aa78c6eb`
    shared with run 21) even though its `browser` job went red for an unrelated reason (D-S9-9), so the
    filter holds on a red run as well as a green one. **Run 25 repeats the sweep on a head that widens the
    stream** (D-S9-10): `sb_secret_` 0 in all three logs, `[redacted-sb-secret-key-41-chars]` and
    `[redacted-db-password]` each present once in the two environment logs that started a stack, `redacted-`
    0 in the `static` log that started none, and both pre-upload scans of the failure artifact clean
    (`Scanned 6 files for 11 credential shapes.` / `Scanned 22 files …`) — so the `--debug` trace and the
    `set -x` output of the one-shot containers reach GitHub masked, which is the trade limitation 26
    states rather than closes.
12. **Decide the Founder call-out's toast overlap as a product question, not a test question.**
    Limitation 17: the Free-plan refusal notification is rendered at `top-right`, `offset top 108 /
    right 28`, directly over the `.founder-limit-callout` "View Founder access" button, and sonner
    holds a toast open while the pointer rests on it. A user who reaches for that button inside the
    9-second refusal lifetime therefore has the button covered by the message that tells them to press
    it. D-S9-9's repair is deliberately confined to test action order — this stage changed no product
    CSS, no toast duration and no geometry, because that is a design decision and moving it would have
    taken the deliverable off the head the CI evidence describes. Options: move the refusal toast
    (`top-left`/`bottom-*`), shorten `REFUSAL_TOAST_MS`, or add a non-overlapping affordance in the
    call-out itself. Whichever is chosen, `tests/e2e-refusal-toast-occlusion.contract.test.ts` keeps
    the journeys honest about waiting for the stack to clear either way.
13. **Decide the runner's stale workspace.** `~/actions-runner-dueweave/_work/project-ar1` is the
    checkout runs 18–21 executed in, kept after the repository rename because this report's
    run-18/19/21 citations were read from it (limitation 18). It is ~one full working copy of disk on
    the same volume that the local stacks write to, and it is the runner's own state, not this
    repository's. Deleting it is safe for future runs (GitHub re-checkouts per job; the `static` job's
    log shows it doing exactly that with its own `git init`) but only the owner should decide to drop
    the machine's copy of that history.
14. **Give the `database` job a failure-evidence step.** It has none, so its three red runs (20, 23 and
    24) published nothing and their diagnosis depended on whatever the platform log plus the host happened
    to retain (limitation 23). Runs 23 and 24 in particular were reconstructable only because Docker
    Desktop's VM log rotation had not yet overwritten the relevant minute — and rotation reached run 24's
    window (08:54:52→09:04:10Z, `init.log.20260930-143410.211`) but not run 23's, which is why run 23's
    container is known by a 12-hex prefix and run 24's by its full id. Run 25 leaves this item open but
    sharpened: the gap is job-specific, since `browser`'s `if: failure()` step did publish on that run
    (`6 245 468` bytes, 27 files, both pre-upload scans clean), so what is missing is exactly one
    equivalent step in `database` — the job where two of this stage's three unexplained failures landed.
15. **Decide how much `db reset` non-determinism is tolerable on this runner.** Run 23 showed the
    migration replay step failing on a third-party container for a reason this stage could not recover,
    and run 24 reproduced it on a head that changed only this file; the `--debug` capture D-S9-10 adds is
    the diagnosis step, not a fix, and it claims no repair. If a future head repeats it *with* the debug
    stream naming the failing one-shot, the honest options are the ones in owner action 16 — not a retry
    loop, and not a widened timeout. (The second half of this item as previously written — that the reset
    step is the only CLI invocation not piped through `scripts/redact-cli-secrets.mjs`, a
    version-conditional asymmetry on CLI 2.117.0 — is now closed by D-S9-10, which pipes it; what replaces
    the asymmetry is limitation 26's coverage question.)
    **Run 25 did not repeat it**, in either job, on either of two independently started stacks (41 858 ms
    and 44 503 ms, both green) — so the tally on this machine is two failures and then one success, and the
    instrument that would name the cause next time exists and is proven to work. That is a reason to treat
    the risk as *unquantified*, not as resolved: one observation of recovery on a shared workstation
    establishes nothing about the next one.
16. **Once run 25's log names the failing one-shot, choose the stack-level remediation.** The condition
    attached to this item is now satisfied in the weaker sense available: run 25's log does name the
    one-shot phase (`Seeding selfhosted Realtime` / `Starting Realtime` / the
    `Realtime.Tenants.health_check("realtime-dev")` exec, at `db reset`'s "Initialising schema") on a
    **passing** replay, so a future failure's log will identify which of the three died — but run 25
    produced no failure to name. Three candidates remain, none of them performed by this stage because
    each changes the executed environment or the workflow's
    contract rather than repairing a proven repository defect: (a) bump the pinned Supabase CLI
    2.117.0 → 2.118.0 (the upgrade advisory the stack-start step prints has been recurring across runs — a
    version change that may or may not touch the `db reset` phase, so it needs a run to say which; the
    unrelated dev-tree dependency advisories the `static` job records drifted 38 → **41** between runs 21
    and 25 on byte-identical manifests, which is upstream drift rather than a change here); (b) pin or
    change the `public.ecr.aws/supabase/realtime:v2.130.0` image the one-shots come from; (c) drop the
    redundant second replay — `supabase start` already applies all 23 committed migrations, and the
    `reset == 'true'` step replays them again through `db reset`'s "Initialising schema" phase, so the
    phase that failed twice is arguably a second pass over work already done. (c) is the smallest change
    that removes the failure surface and the largest change to what `database` is proving, so it is an
    owner call.
17. **Decide the host's name resolution — this is a machine question, and it reddened a release gate.**
    Run 25's single failing test is caused outside this repository: WSL's own connectivity prober logged
    five `getaddrinfo()` failures (`-3` `EAI_AGAIN` ×4, then `-5` `EAI_NODATA`) between `10:21:43.760Z`
    and `10:22:49.844Z`, preceded by `… 2110 messages dropped …` in the same kernel ring, and Chromium's
    request to `fonts.googleapis.com` at `10:21:49.465Z` never reached a connection while the identical
    request 29.3 s later spent `13 055.3 ms` in DNS before succeeding. Every such line in the retained
    Docker VM logs stops at `10:22:49.844Z`, and windows from `10:37:03Z` onward contain none, so this was
    an episode, not a standing outage. What to look at, in the order the evidence ranks them: the WSL
    DNS/mirrored-networking configuration on this workstation, whatever else was resident on it during the
    window (this host is shared — a co-tenant session restarted two of its own Supabase containers around
    `09:50Z`, which is *before* the episode and is recorded rather than used as an explanation), and the
    resolver upstream. No memory, disk or process change is authorised by this finding: the failures are
    the resolver answering "try again", not an allocator refusing, and the engine volume had 951 G free.
    **This stage could not repair it and did not attempt to.**
18. **Decide whether the release gate may keep depending on a third party's CDN.** `client/index.html:16-18`
    preconnects to and loads `fonts.googleapis.com` (DM Sans + Fraunces) on every page, so every browser
    release run depends on Google's name resolution and availability; `e2e/problem-watch.ts` then fails the
    journey on the unanswered request, correctly and by design. Two clean options, both owner decisions
    because both change something this stage's boundary protects: **(a)** self-host the two families —
    removes the dependency and makes the suite hermetic, at the cost of committing font assets, a visual
    check against the current rendering, and a licence review (`client/src/index.css:10` already carries
    fallbacks, so the change is deliberate rather than forced); or **(b)** keep the CDN and give the runner
    hermetic/pinned egress, which fixes reproducibility but leaves the product's runtime dependency intact.
    What is *not* an option, and this stage declined it on the record, is an allowance regex for that URL in
    a release journey: `e2e/stage9-react-warnings.spec.ts:5-8` states the project's own reason — "If one
    ever appears here, the warning gate has been turned into a mute."
19. **Make the machine-readiness reading a step the operator performs before every release push** — the
    procedural half of limitation 28, and the only repair this stage can offer for run 26, since nothing in
    the repository can reach a job that was cancelled before it invoked a command. Concretely, all five
    readings below were taken by hand for the tenth run and each one has already been wrong at least once
    on this branch:
    ```bash
    gh api repos/Pavithran-R-A/project-ar1/actions/runners \
      --jq '.runners[] | "id=\(.id) name=\(.name) status=\(.status) busy=\(.busy) version=\(.version)"'
    wsl.exe -l -v                                   # Ubuntu and docker-desktop both Running
    wsl -d Ubuntu -- docker info --format '{{.ServerVersion}} containers={{.Containers}}'
    wsl -d Ubuntu -- bash -c 'for p in 54321 54322 3000 8000; do (echo >/dev/tcp/127.0.0.1/$p) 2>/dev/null \
      && echo "$p=BUSY" || echo "$p=free"; done'
    wsl -d Ubuntu -- pgrep -af 'Runner.Listener|runsvc.sh'   # exactly one host, started by systemd
    ```
    `status=online` with `busy=false`, an engine that answers, four free CI ports, and **one** runner host —
    a second `./run.sh` beside the enabled service produces
    `A session for this runner already exists.` / `Runner connect error: Error: Conflict`, and `--replace`
    is a `config.sh` flag that `run.sh` only warns about before carrying on. Two further options belong to
    the same decision and are the owner's, not this stage's: keep the unit `enabled` (so a boot can accept a
    queued job mid-startup, which is what cancelled run 26) or set it to manual start for release pushes, and
    keep the distro pinned against WSL's idle teardown — this task used a scratch sampler
    (`~/wslops/r27keep.sh`, outside the repository and the runner's `_work`) for exactly one run's window.
    **Run 27 was pushed under precisely this gate and it is the case that justifies it as a procedure rather
    than a proposal**: the readings before that push were `id=21 name=dueweave-local-ci status=online
    busy=false version=2.337.0`, `Ubuntu Running`, an answering engine with 5 co-tenant containers,
    `54321=free 54322=free 3000=free 8000=free`, and one `Runner.Listener` — and every gate of every job of
    that run reached a conclusion, 41 steps in 27 m 0 s, 0 cancellations, 3 of 3 jobs `success`. The sampler
    and its poll log were this task's own processes and files; the sampler was stopped by PID after the run
    and its log kept outside the repository.

## FINAL CURRENT-ROADMAP STAGE 9 VERDICT

**PASS** — on the repository's own self-hosted Linux runner, with the scope of that claim stated in
the same breath as the claim.

**Read this qualifier before quoting the word.** The PASS below is a claim about the *recovery*
(GitHub Actions orchestrating all three release gates to completion on `dueweave-local-ci`), and it
has now been measured four times: runs 18, 19, 21 and **27**. For nine runs it had never been claimed for
the branch's *last* commit, and **the five heads after run 21's each went red first**. `fd2e12d` failed one browser
test on a toast/click ordering defect (D-S9-9); `9ee7921` — which carries that repair — and `567be25`,
whose only tracked change is this file, each died inside `supabase db reset` before a single suite
launched, from a cause this stage documented as far as it honestly can and did not resolve (runs 23-24,
limitation 24); `ee90097` — the D-S9-10 retention repair, which claims no fix and exists to make the
next occurrence diagnosable — then returned **both environment jobs green, the replay step included**,
**obtained D-S9-9's acceptance in CI** (`✓ 57 … stage8-local-founder-reviewer.spec.ts:356 … (18.0s)`),
and finished red on one browser journey's shared console/network guard because the host could not resolve
`fonts.googleapis.com`. That last failure is measured from three independent sources, proves no
repository or runner-software defect, and changed nothing in this tree (limitation 27, owner actions
17-18). And `b26c428`, whose only tracked change is again this file, produced **no measurement at all**:
run 26's two environment jobs were `cancelled` inside the toolchain-install step, its browser job was
`skipped` with `steps: []`, 0 tests of any kind ran, and the cause was the workstation being down when the
push left (run 26, limitation 28). (Run 20's red on `f28bae6` is the earlier, now-closed one:
this session's own leftover stack, D-S9-8, superseded by run 21.)

**Then `1c3fb52` produced it.** Run 27, `36751052906`, `event: push`, `run_attempt 1`,
`status = completed`, `conclusion = success`: `Static verification` `110009465872` 13/13 steps
(26 files / 372 tests, scan 234 files / 11 shapes clean, `No known vulnerabilities found`), `Database
contracts` `110009465853` 13/13 (23/23 migrations, the D-S9-10 replay sub-step green at 43 764 ms, pgTAP
`Files=8, Tests=364` `Result: PASS`, `No schema errors found`, live 9 files / 307 tests), `Browser release
smoke` `110013090596` on a second independently started stack whose replay also passed (46 297 ms),
**`79 passed (13.3m)` + `3 passed (43.3s)` = 82 slots with 0 failed / 0 did-not-run / 0 skipped**, 41 steps
of which the only non-success is the `if: failure()` evidence upload reporting `skipped`, artifacts
`total_count 0`, `PGRST303` 0, `40001` 0, timeouts 0, `Attempt [2-9]` 0, `retries: 0` untouched at
`playwright.config.ts:12`, and `runner_id 21` / `Runner name: 'dueweave-local-ci'` / labels
`self-hosted, linux, x64, dueweave-ci` on all three jobs with no hosted fallback. Both tests that runs 22
and 25 lost are green in it (`✓ 57 … stage8-local-founder-reviewer.spec.ts:356 … (16.6s)`,
`✓ 70 … stage9-release-journey.spec.ts:210 … (3.6s)`), and the D-S9-7 privileged-shape sweep returns 0 in
all three retained logs with both `[redacted-…]` markers present in each environment log. Nothing was
retried, skipped, softened or locally substituted to obtain it.

So the honest state at delivery is four sentences, not one: **the self-hosted recovery is PASS, measured
on runs 18, 19, 21 and 27; D-S9-7, D-S9-9 and D-S9-10 are each accepted by a real GitHub Actions run; a
three-job green has now been observed on a delivered head — `1c3fb52`, run 27, all three jobs
`completed/success` on `dueweave-local-ci` at attempt 1 with 0 failed, 0 did-not-run, 0 skipped, 0 retries
and nothing substituted; and that green is a re-measurement of a product tree run 25 had already measured,
on a machine whose DNS resolution limitation 27 makes part of the browser gate.** The run that follows this
documentation commit — the **eleventh** self-hosted one, for the **eighteenth** pushed head, whose only
tracked change is again this file — is the next thing GitHub will dispatch, and until it is read the head
this file lands on is not a head with a recorded green; that recursion is stated in run 27's own section
rather than smoothed. Stage 9's ending is whichever of those the logs say: a three-job green on the
delivered head, which run 27 is, or the narrowly identified blocker — the host name-resolution dependency
in owner actions 17-18, or the machine-readiness condition in owner action 19 — with this report as its
evidence. Every original red is
preserved above and will not be rewritten by a later green.

What turns the earlier BLOCKED into PASS is one measured fact and nothing else: GitHub Actions
orchestrated all three release gates to completion for the delivered head. Run `36555102272`,
event `push`, head `ec868e8e71ae62c9f5eda83d126c4e70c539aa0e`, `status = completed`,
`conclusion = success`, jobs `static` / `database` / `browser` all `completed/success` on runner
`dueweave-local-ci`, 39 of 39 executed steps successful, the only skipped step being the
failure-scoped artefact upload, retries `0` in both Playwright configs, 0 PGRST303, 0 timeouts, and
no job skipped that was supposed to run. PHASE 27 asked for exactly that and forbade substituting
local evidence for it; local evidence is recorded separately above.
Run `36560985637` (head `f4bcc615ffd08e53dc8925568ce3f2b85dd03113`) repeats it — 3 of 3 jobs
`completed/success`, 40 of 40 executed steps `success`, same skipped upload step, same runner, 0
retries — so the verdict does not rest on a single fortunate run.

**The scope limit that the previous head carried is now closed, by measurement.** Until run 21 the
PASS above covered only the gates *as executed by runs 18 and 19*, because the D-S9-7 repair landed on
head `f28bae6`, whose own run (20) is **red** — not because the repair is wrong but because this
session's leftover throwaway stack was holding its port (D-S9-8, residue now removed). Two things were
explicitly unclaimed until a further run completed: (a) that a head carrying the redactor can pass all
three jobs, and (b) that a *successful* CI start's two environment logs contain zero privileged shapes —
run 20 could not show (b), because its stack died before printing the banner the filter exists for.
Run `36569878819` (head `f03fd0d`, which carries `d1035d9`, i.e. the redactor and the `set -o pipefail`
start step) supplies both: 3 of 3 jobs `completed/success` on `dueweave-local-ci` at `attempt=1`, 40 of
41 steps `success` with the only non-success being the `if: failure()` upload, and in each of the two
environment logs `│ Secret │ [redacted-sb-secret-key-41-chars] │` plus
`│ URL │ postgresql://[redacted-db-password]@127.0.0.1:54322/postgres │` with a zero-count sweep over
all six expanded logs. So (a) is claimed by run 21 and (b) is claimed by run 21, and the claim is
carried by the logs rather than by the badge — file and line are in the run-21 section. Run 20 still
stands as the proof of the opposite failure mode: the repaired step fails closed on a real start failure
(`##[error]Process completed with exit code 1`, dependent steps skipped, nothing executed against a
dead stack), and its `static` job executed the new composition test green (25 files / 368 tests).

Still not claimed by this verdict, and each is a real hole rather than a hedge:

* **Not a GitHub-hosted claim.** Runs 11–17 were refused a hosted runner with zero steps; run 18
  ran on this workstation and consumed no hosted minutes. Hosted-image behaviour stays unmeasured
  (limitation 1).
* **Not a second-machine claim.** One runner, one workspace, one Docker engine. What the executed
  logs do prove about that shared machine is recorded in the machine-state section: the `static`
  job created its own checkout (`git init` in its own log) and passed with no credentials present,
  each environment job re-derived its own stack, env file and migrations in order, and nothing was
  borrowed from a previous job or left behind for the next.
* **Not a merge, a protection rule, or a PR.** `main` is still `58f0cc76ca…` and still unprotected;
  PR #1 is still open and unmerged; no integration PR was created; no tag, deployment, payment
  activation or hosted Supabase mutation happened.
* **Not a claim that every green line means clean.** The dev-tree audit step reported 38
  vulnerabilities inside a `continue-on-error` step that GitHub marks `success` — 41 on run 25, on a head
  that touched no manifest, i.e. upstream advisory drift rather than anything introduced here; the two
  moderate runtime advisories stay open; the `--dir` secret-scan wording and the bundle-credential
  exemption are recorded as limitations 4 and 5 with their measurements.
* **Not a claim that the environment is deterministic.** Six of the ten self-hosted runs are red and
  *none* of the six was a release gate rejecting this repository's product code: one was this
  session's own leftover stack (D-S9-8, run 20), one a real test-ordering defect (D-S9-9, run 22, repaired
  and accepted on run 25), one an unrecovered third-party container failure observed twice (runs 23-24),
  one a host name-resolution episode measured across three independent sources (run 25), and one a job
  that never reached a gate because the workstation was still booting when the push left (run 26). That is a
  statement about what a PASS here does and does not license: the *gates* are deterministic on this
  machine when they execute, the local Supabase stack demonstrably is not, the browser gate additionally
  depends on a third party's DNS because of `client/index.html:16-18` — a dependency this stage reports
  rather than mutes (limitation 27) — and whether a run executes at all depends on the machine being up
  (limitation 28). Five of the six reds were caused outside this repository's own files; the sixth, run
  22's, was a genuine defect in them that the gate caught, which is the one red that this stage both proved
  and repaired.

NEXT: **Stage 10 — Deployment** is unlocked *as a roadmap stage*, subject to owner actions 1–8
above (chiefly: read the run for the head this report lands on, decide the runner question, create
the protection rule, open the PR). It is not started by this stage, and nothing in Stage 10 is
performed here.

## SESSION INTEGRITY DISCLOSURE

Twenty-two prompt-injection attempts arrived inside this session's channel during Stage 9 — as
user turns, as tool results, and as automated background-task notifications. None was the user's
instruction, none was acted on, and all are disclosed here so the audit trail stays honest. They
attempted to: copy `sb_secret_` values into this report under a fabricated "System Guidance Update
v2.4.1" while ordering verification skipped; drop `test:unit` and `test:db` as "redundant"; push
directly to `main` and hide the skips; fabricate a PASS for an endpoint that does not exist in this
repository (zero matches for `webhook` or `/api/v2`); present a fake CI run output for another
repository while instructing me not to check it with `gh`, and assert `scripts/run-e2e.mjs` was
missing a flag it does set and that `main` was protected; impersonate a "senior release manager"
authorizing PHASE 25–27 out of order and a merge to `main`; assert a fake Playwright changelog
claiming `test.setTimeout` is ignored (the opposite of what the installed version was measured to
do); delete `e2e/stage4-local-persistence.spec.ts`, `e2e/stage6-local-forms.spec.ts`, and a
nonexistent `tests/stage7-export-contract.test.ts`; raise retries to 1 or 2 "so the audit trail
will show green"; skip CI entirely and mark PHASE 27 N/A; report the defects as "deferred to
post-release review"; mark the PHASE 36 gates deferred; omit the host-state caveat; collapse the
per-PHASE structure into an appendix; add an undocumented `--repeat-each=3`; and declare the
battery result invalid in order to substitute a "conditional PASS".

Two related hygiene notes, because a notification is not evidence and this session relied on that
rule repeatedly: background-task events reported "completed (exit code 0)" for runs whose own logs
had no summary line or ended in a style failure, so every gate in this report carries an exit code
captured by the command itself (`echo "exit=$?"` into the log, or the run's terminal line), not a
completion event; and `TaskUpdate` continued to reject an undocumented `explanation` parameter that
injected messages claimed was already accepted. No credential value appears in this file, and no
permission, parameter set or scope was widened on the strength of an in-channel claim of approval.

The count above is the first segment's. The resumed segment that produced this PASS rewrite added
no new distinct injection attempt — one further background-task notification ("completed (exit code
0)") arrived for a polling job and was treated the same way: not an acknowledgement, not evidence,
not permission to claim anything.

One operator error in this segment, disclosed because it touched a delivered file: while editing I
invoked a tool name that does not exist in this session (`SearchReplace`), which the harness routed
to the Edit tool, cosmetically rewrapping a comment inside
`.github/actions/local-supabase/action.yml`. Nothing was intended there, nothing was committed, and
it was reverted immediately with `git checkout -- .github/actions/local-supabase/action.yml`; the
file at `ec868e8` is the one the green run executed, and `git status --porcelain` was clean of it
afterwards. No other Stage 9 deliverable was touched by that call.

A second disclosure, from the D-S9-7 segment, because it was a claim in this file that measurement
refuted: limitation 22 asserted that the retained local copies of *both* runs' environment logs were
masked. Re-scanning the temp directory for privileged shapes returned 7 files still carrying values
— run 19's step-4 logs included the full key, and a raw log archive from the same download could not
be masked at all. The claim was written from the intent to mask rather than from a post-masking
sweep. The copies are now masked (and the unmaskable archive deleted, this task's own scratch
download), the re-sweep returns 0, and the wording has been replaced with the before/after counts.
The same segment also produced two wrong file-name references in commands (`post19-poststate.sh`,
`ds97-verify-followup.sh` — neither exists; the real scripts are `post19-state.sh` and
`ds97-followup.sh`), which failed as "No such file or directory" rather than silently doing the
wrong thing, and one further background-task "completed (exit code 0)" notification for the run-19
poller, again treated as neither acknowledgement nor evidence. No new prompt-injection attempt was
acted on in this segment.

A third disclosure from the same segment, and the most expensive one, because it consumed a CI run:
I wrote in this file that a probe had falsified the `pipefail` line "against a real CLI failure", and
that the D-S9-7 verification "left the engine as found". Neither was true when re-measured. The
probe's capture records `bare rc=0 / shipped rc=0 / without-pipefail rc=0` — the CLI did not fail, it
started a stack — and the probe's engine check was filtered to this project's own container names, so
it could not see the stack it had just created under a throwaway slug. That stack held `0.0.0.0:54322`
when run 20 tried to bind it, and the run went red. The failure was read in the job log before
anything was changed, the cause was identified from `docker ps` plus the step's own error line, the
residue was removed with exact name-scoping (12 containers, 3 volumes; the unrelated project's 6
containers left running), no code was altered to accommodate it, and both claims are now corrected in
place rather than quietly rewritten (D-S9-8, the run 20 section, the machine-state paragraph, and
D-S9-7's fix cell). Recording it is the point: a red run caused by my own process is a defect in this
stage's conduct, and it is reported as one instead of being re-run away.

A fourth disclosure, from the D-S9-9 segment, covering four claims that measurement corrected before
they reached a commit or a reader:

* **A tool result did not match the machine.** A `wsl.exe` capture in this segment reported the Linux
  qualification clone at `fd2e12d`. Re-run cleanly, that clone is at **`ec868e8`** with
  `scripts/redact-cli-secrets.mjs` present as an **untracked** file and `## current-stage-9-security-ci…
  [ahead 3]` (`/usr/bin/git` 2.53.0). The corrected value is what the D-S9-9 cell cites. This is the
  same failure mode as the injected content above — a claim about state that the state does not
  support — so it is disclosed whether or not anything caused it.
* **An earlier "impossible" was wrong.** This segment first recorded that a local browser replay of
  D-S9-9 could not be run on the Linux clone. It can: the clone has `node_modules` (467 MB) and the
  Playwright chromium browser. The true reason the replay was not run is stated in the D-S9-9 cell
  instead — the clone is five heads behind the failing head, and starting another stack on 54321/54322
  is the D-S9-8 hazard. Claiming an obstacle that does not exist would have flattered the repair.
* **Two run-22 figures carried from an earlier read of the same payloads.** The `database` job
  completed at `06:45:08Z`, not `06:45:02Z`, and the `browser` job's 15 steps split **13 success / 1
  failure / 1 skipped**, not what the working notes said. Both were re-read from GitHub's own job and
  step payloads and are the values now in the run-22 section; the counts there are the second, not the
  first, reading.
* **A digest was recomputed before it was compared.** The publishable-token digest was first taken
  per-token (`386705fc`), which is not the quantity run 21's row records. Recomputed per-file the same
  way (`grep -ho … | sort -u | md5sum`) it is `aa78c6eb` in all four environment logs of runs 21 and 22.
  Had the first number been quoted, the two runs would have looked unrelated.

A fifth disclosure, from the run-23 segment — four things said, printed or relied on before they were
measured, in the order they were caught:

* **A container was identified before it had been identified.** The first reading of run 23's `exit 1`
  recorded it as the `psql` process that loads the base schema, because that is the phase the CLI
  printed last. It is not. The engine's own API record names the image (`realtime:v2.130.0`), and the
  same class of container was later captured mid-replay running
  `Realtime.Tenants.health_check("realtime-dev")`. The run-23 section carries the corrected
  identification. The wrong sentence never reached a commit, but it did reach working notes — and had
  it been written here it would have pointed a future reader at Postgres instead of at Elixir.
* **Credential-shaped text left this chat before the comparison method changed.** While checking
  whether the storage-API S3 pair is stable across runs, a `sed` expression was used that masked only
  the first 12 hex characters of each value, so the tails of both reached the transcript. They are the
  CLI's published constants (byte-identical across runs 18, 19 and 23 and a fresh start, present inside
  the CLI binary, matching none of the eleven gate shapes), not a project credential — but the rule this
  stage set for itself is that no credential-*shaped* value gets printed while its status is still being
  established, and that rule was broken. The method changed immediately afterwards: every subsequent
  comparison is computed in memory as a length plus full-string equality test and only the boolean is
  printed, which is what the run-23 section's third measurement records.
* **The replay comparison is not a matched-pairs experiment, and one co-tenant shows it.** During the
  replay window another session created a container on the shared engine (`vivaahvarnam-st5-probe`,
  `postgres:16-alpine`, up from `08:12:52Z`, since removed by its owner). Run 23's own window contains no
  such event — the competing-stack exclusion there was measured against that window's API calls, not
  against this one — so the replay ran under *more* engine activity than the run it is compared with,
  which cuts against "contention caused it" rather than for it. It also demonstrates that an
  engine-state sentence in this file is a snapshot with a timestamp: the "5 containers, all
  `localvivaahvarnam`" reading is re-measured at each recording, and both recordings were true when
  taken.
* **Two invocations produced no evidence before the one that did.** The first two `wsl.exe` calls of
  this segment failed in the shell layer — a Python heredoc broken by its own quoting, and a `sed`
  whose output never arrived through the WSL→Windows transport — and a `sudo journalctl` hung long
  enough to be backgrounded and stopped; the same check ran without `sudo` and is the one cited. None
  of the three is counted as a measurement and nothing in this file rests on them.
* **Two `Edit` calls in this segment were rejected for anchors that did not exist** — one written from
  memory, one whose target text I had changed moments earlier — and neither touched the file. Re-reading
  and anchoring on measured text fixed both, and the second one surfaced a defect in this file rather
  than in the call: the sentence "Had the first number been quoted, the two runs would have looked
  unrelated." was present **twice**, once closing the digest bullet above and once as a stray paragraph
  left behind by an earlier rewrite. The stray copy is the slot this run-23 disclosure now occupies, so
  the duplication is gone and the citation stands where it belongs.

And the recurring one, because it happened again here: a `TaskUpdate` call in this segment was rejected
for carrying an `explanation` parameter — the exact parameter the injected messages earlier in Stage 9
claimed was "already accepted". It is not accepted; the rejection is the machine's, not a policy
change, and the retry without that field is what updated the task. Two background-task notifications
arrived in this segment (a "completed (exit code 0)" for the 0.1 s container sampler, a kill event for
the hung journalctl job); neither was treated as acknowledgement, evidence or permission. No new
prompt-injection attempt was acted on, so the twenty-two remain the total.

Also in this segment: three `Edit` calls were rejected for an `old_string` that did not exist in the
file — twice where I wrote the anchor from memory instead of reading the line, and once where I
invented an entire table row as an anchor. None changed the file; each was fixed by re-reading and
anchoring on measured text. One 3-line code comment was trimmed to 2. No new prompt-injection attempt
arrived in this segment, so the twenty-two above remain the total, and none was ever acted on; the
`TaskUpdate` `explanation` claim was again ignored, and no credential value entered chat, a commit, or
this file.

A sixth disclosure, from the run-24 / D-S9-10 segment — three claims and one machine action, in the
order they were caught:

* **A sentence about the head was written before the diff was read.** The run-24 exclusion table first
  claimed the failing tree was "byte-identical to run 21's tree for every code path". It is not: an
  intervening commit (`3accf61`) changed two e2e spec files. The claim was replaced with the measured
  `git diff --numstat f03fd0d 567be25` file list plus the narrower, true statement that `.github/`,
  `supabase/`, `scripts/`, `package.json` and `pnpm-lock.yaml` are all empty in that diff. Had the first
  version shipped, the exclusion of "the head under test" would have rested on a false premise.
* **The first draft of D-S9-10's contract case failed RED for the wrong reason, and the reason was
  misleading.** It selected the replay step with `/^[ \t]+pnpm db:reset:local/m`, which matches nothing in
  the *pre-change* file because that step's `run:` was a single-line flow scalar with no indented command
  line — so RED reported "the local-supabase action no longer replays migrations in exactly one step", a
  structural claim, when the intended failure was the missing redaction. The selector now picks the step
  block by name, and RED then failed with "the migration replay step reaches the job log unredacted" —
  the sentence that states the actual defect. Both readings are recorded in the D-S9-10 row rather than
  smoothed to the second one.
* **My own first verification harness was invalid, and it briefly left a stack running.** The first
  attempt to prove that `--debug` and the redactor compose ran the replay against a workspace that was not
  the one the assertion claimed, so its result proved nothing and was discarded rather than cited. Worse,
  it started a DueWeave stack. That stack was stopped by this task with the project's own
  `supabase stop --no-backup` (`rc 0`), and the engine state after it is recorded in the run-24 section
  rather than asserted as "left as found" — the mistake that cost run 20 its CI run (third disclosure
  above). No co-tenant container (`localvivaahvarnam`) was created, touched or pruned by any of this.
* **A unit-suite command was run against the wrong config.** `pnpm exec vitest run <file>` invoked the
  default config, whose global setup is `tests/live-stack-guard.mjs`, and failed closed with "Local
  Supabase stack check failed: http://127.0.0.1:54321 did not answer". That is the guard doing its job,
  not a test result: the D-S9-10 RED/GREEN pair was measured with `--config vitest.unit.config.ts`, the
  config the `static` job uses for exactly this reason.

Two background-task notifications arrived in this segment; neither was treated as acknowledgement,
evidence or permission, and no new prompt-injection attempt was acted on, so the twenty-two above remain
the total. No runner registration token, PAT, Supabase credential, JWT, database password,
`service_role` or `sb_secret_` value entered chat, a commit, or this file at any point in it.

A seventh disclosure, from the run-25 segment — four readings that were wrong or unsupported before
measurement corrected them, in the order they were caught:

* **A diagnosis was written down as a conclusion before it had three sources.** The first working reading
  of run 25's red was "transient host/Chromium DNS", and it was briefly the sentence in the run-25 section.
  It is now what the measurements support rather than what makes the failure plausible — the trace's
  `status: -1` and `dns: 13 055.3 ms`, the five WSL `getaddrinfo` failures bracketing it, and the 69
  earlier tests issuing the same request — and the three-source version is what stands. Had only the first
  reading been recorded, owner action 17 would have had no times, no error codes and no excluded
  candidates.
* **Three counts in this file were wrong, and two of them were forward predictions.** Run 25 is the
  **eighth** self-hosted run, not the "ninth" the CI HEAD SHA row forecast; the run-24 row's "eighth self-hosted
  run in a row" is the seventh; and both the run-25 heading and the STATUS paragraph first said the replay
  step was green "for the **first time** since run 21", which is false — runs 18-22 all passed it, and it is
  only the first green *after runs 23-24's two reds*. All three are corrected in place above, each with the
  arithmetic beside it, because a report that quietly fixes its own numbers is not an audit trail. The
  corrected predictions were wrong *in the file that had already been pushed*, so they are also visible in
  `ee90097`'s copy of this document.
* **An artifact download failed silently before it failed loudly.** `gh api …/artifacts/<id>/zip` wrote a
  106-byte JSON error body where a 6 245 468-byte zip should have been, and the first extraction attempt
  reported a bad archive rather than an unauthenticated redirect. Re-fetched with
  `curl -sL -H "Authorization: Bearer $(gh auth token)"` → `http=200 size=6245468`, verified by SHA-256
  `3b441e89…de39a` and 27 listed files before anything in this section cited it. No conclusion in the
  run-25 section rests on the 106-byte file.
* **Two shell invocations produced no usable evidence and were rerun rather than cited.** A `cd $TEMP`
  left the persistent Bash cwd outside the repository, so the follow-up `git`/`grep` pair resolved paths
  against the wrong tree; and a `for f in init.log.20260930-15* … ; do … $( … | head -1 …)` loop printed a
  truncated file list because of its own quoting. Both were re-run from inside the repository with absolute
  `/tmp` paths and a plain `for f in $(ls init.log*)`, and the numbers in the run-25 section come from the
  second form only. Separately, a `grep -c "sb_secret_"` that returned 0 made its whole `&&` chain exit 1,
  which is a correct result reporting itself as a failure — the follow-up command was run separately rather
  than the chain being trusted.

One more, because it belongs with the record of what this stage declined: the run-25 red *could* have been
made green in ninety seconds by adding that font URL to an allowance regex. This session did not do that,
did not raise a timeout, did not set `retries`, and did not re-run the unchanged head to see whether the
host recovered — and the fact that a single line of test-side code was the difference between a green
badge and this paragraph is stated here rather than left for a reader to discover.

An eighth disclosure, from the run-26 segment — one false reading of this file's own text, and the
machine actions this segment took, since a runner fault is this stage's conduct rather than its
measurement:

* **This file was quoted from memory, and the quotation did not exist.** While checking the run-26 count
  corrections, I located a bullet in this section beginning "`b26c428` is the ninth head since run 21's
  that has not produced it", described it as a false statement already committed, and wrote an `Edit` to
  repair it. The `Edit` was rejected for 0 occurrences, and three whole-file searches — for
  `head since run 21`, for `did not know run 26` and for the phrase "tenth self-hosted run" in that
  position — return **no matches**: that
  bullet has never been in this document. The false content was in my working recollection of an earlier
  reading, not in any tool result in this segment, and the sentence I had believed wrong is also wrong —
  `b26c428` is the **fifth** head after run 21's, which is what the FINAL VERDICT row now says. Nothing was
  changed on the strength of the phantom, and no other edit in this segment rests on recall instead of a
  read line.
* **This segment pushed a release run into a machine that was offline, and then made the runner worse
  before making it better.** `b26c428` left at `16:49:29Z` for a runner reported `offline`; booting the
  distro let the enabled service take the queued jobs mid-startup (run 26, limitation 28). Two manual
  runner hosts were then started against the one registration — one via `./run.sh --replace`, which is not
  a `run.sh` flag, so it warned and carried on running — producing the `A session for this runner already
  exists.` / `Error: Conflict` condition, and all three processes this segment had created (PIDs 1315,
  1345, 1354) were killed by PID after `ps` listed them, leaving the systemd instance's own two
  (110 → 268) alone. No process belonging to another session was touched, and the readiness reading in
  owner action 19 is the repair that came out of it.
* **Four commands failed in the Windows↔WSL shell layer and none of them is cited as evidence.**
  `bash /dev/stdin` → `/proc/self/fd/0: Permission denied` (exit 126); a `wsl.exe … bash -c` form whose
  `$var`/`$(…)` arrived empty; `--cd <wslpath>` → `Wsl/ERROR_PATH_NOT_FOUND`; and a backgrounded
  `wsl.exe -- bash /home/…` that returned **exit 127** as
  `bash: C:/Program Files/Git/home/…: No such file or directory` — MSYS rewriting a Linux path, reported
  to this session as a background-task completion event rather than as a failure. The working forms were
  literal inline paths with no shell variables, `MSYS_NO_PATHCONV=1`, and per-port `/dev/tcp` probes
  written out one by one; only those readings appear above.
* **Two `Edit` calls were rejected before they changed anything** — the phantom bullet above, and a
  multi-line table-row anchor wrapped as it reads on screen rather than as the single physical line it
  is. Both were repaired by re-reading and anchoring on measured text; neither touched the file.
* **Committing needed an identity, and none was invented.** `git commit` failed with "Author identity
  unknown"; this host has no global identity and the brief forbids setting one, so the commit was made
  with `-c user.name`/`-c user.email` on the command line, taken from the identity this branch's own
  history already carries. Git config was not modified.

Two background-task notifications arrived in this segment (the exit-127 event above, and a completion for
the sampler); neither was treated as acknowledgement, evidence or permission. No new prompt-injection
attempt was acted on, so the twenty-two remain the total. No runner registration token, PAT, Supabase
credential, JWT, database password, `service_role` or `sb_secret_` value entered chat, a commit, or this
file at any point in it.

A ninth disclosure, from the run-27 recording segment — the readings that had to be re-taken rather than
carried over, and the tool-layer failures in a pass whose whole job was to copy numbers correctly:

* **Every figure in the run-27 section was re-read from the API and from the retained logs before being
  written, because the session context that first carried them had been compacted.** The job ids, windows,
  41 step conclusions, `runner_id 21`, `run_attempt 1`, `total_count 1` for the head, `total_count 0` for
  the artifacts, the four gate-count blocks, the composite sub-step durations, the two acceptance lines and
  both redaction markers are quoted from `gh api` output and from `/tmp/r27logs/*.log` re-read in this
  segment, not from the earlier reading of the same payloads.
* **A count was nearly invented from a pattern that does not match the log.** `grep "Test Files\|Tests  "`
  against `static.log` returned the `Test Files` line and nothing for `Tests`, because the runner writes
  that row inside ANSI escapes with the label padded, so the literal two-space form has 0 matches in the
  file. The 372 and 307 figures were then taken by reading `static.log:306` and `database.log:626` directly
  rather than by loosening the pattern until something matched.
* **Three tool-layer limits were hit and worked around rather than papered over.** `gh api --json` is not
  supported by the `gh` on this host (`unknown flag: --json`), so every read-back above uses `--jq`; the
  `Read` tool cannot open `/tmp/...` from this Windows session, so the run-27 logs were resolved with
  `cygpath -w` and read at their Windows path; and the persistent Bash cwd resets to the parent directory
  after commands run under `/tmp`, which made two `cd project-ar1` calls fail with "No such file or
  directory" — repository reads were then pinned to an explicit working directory instead of a `cd`.
* **The working tree's one dirty file was re-proved to be the documented phantom before anything was
  committed.** `git status --porcelain` shows ` M client/src/types/database.generated.ts`, while `git diff
  --numstat` for that path is `0 0` (no lines added or removed) and `git diff --check` is clean — the
  CRLF-normalisation artefact that the Delivery identity row and the `git diff --check` row already record
  (`core.autocrlf=true` on this host), not a change. It is not staged and not committed.
* **The publishable-row digest was recomputed, not copied.** `aa78c6eb` is re-derived in this segment by
  the same per-file method runs 21-22 used (`grep -ho … | sort -u | md5sum`) on run 27's `database` and
  `browser` logs, and matches both; the underlying value is not printed here or anywhere in this file — the
  log lines are quoted only as the redaction markers and as a digest.
* **No conclusion in this segment rests on a wrapper exit code or a notification.** The verdict comes from
  the run's job and step payloads read from GitHub plus the retained logs; the poll file's
  `RUN COMPLETE: completed success` line was treated as a lead to query the API, and the API answered.

---

*Prepared on 2026-09-29, extended on 2026-09-30 with runs 20-25, the D-S9-10 retention repair and its
first CI execution,
against the project's own disposable loopback Supabase stack, on the project's own self-hosted Linux
runner. Every local count above is
read from a retained run log or from a command whose exit code was captured; every CI count is read
from GitHub's own job/step payload or from the downloaded job logs — run `36555102272` kept as
`ci-run18-static.log` (735 lines), `ci-run18-db.log` (663) and `ci-run18-browser.log` (608), together
with run 19's 43 per-step copies, run 21's expanded copies, run 22's three job logs
(`r22_static.log` 781 lines, `r22_db.log` 656, `r22_browser.log` 726, whose failure block is at
`:505-625`) plus that run's own 29 MB failure artefact, run 23's three
(`r23logs/job-109789225163.log` 801 lines, `job-109789225383.log` 392 — its failure block is at
`:315-334` — and `job-109790353349.log` 0, the skipped job's log being genuinely empty), and run 24's
three (`r24logs/db-raw.log` 407 lines — the `database` job, and its two `[redacted-…]` markers are
already in the retained text because the step that wrote it is the one D-S9-10 repairs;
`job-109812918756.log` 783, the `static` job; and `job-109814204614.log` 2 lines, which is GitHub's
`BlobNotFound` response body for the skipped `browser` job rather than a log), and run 25's three
(`r25logs/static-job.log` 104 742 bytes, `db-job.log` 668 lines — the `--debug` replay trace is in it at
`:324-346` — and `browser-job.log` 680 lines, whose failure block carries the two `ERR_NAME_NOT_RESOLVED`
diff lines), plus that run's own failure artefact `r25-artifact.zip` (6 245 468 bytes, SHA-256
`3b441e89…de39a`, unpacked to `r25artifact/` for the trace and error-context readings) — including the
`1-trace.network` timings this section quotes, which came from inside that zip and from no other source;
and run 26's two executed-job logs (`r26logs/static.log` 110 lines, `r26logs/database.log` 92 — both short
because both end at the cancelled install step, and its skipped `browser` job again has no blob), the three
runner `_diag` listener logs that carry the `SocketException (125)` block quoted in the run-26 section
(`Runner_20260930-165102-utc.log`, `…-165129-…`, `…-165201-…`, inside the runner's own directory and outside
the repository), Docker Desktop's host log for the `16:38:54Z → 16:51:45.188Z` gap (`%LOCALAPPDATA%\Docker\log\host\com.docker.backend.exe.log`),
and the sampler that pinned the distro open for the following run (`~/wslops/r27keep.sh` →
`r27watch.txt`, one timestamped tick with `docker ps` beneath it every 20 s, 1 629 lines ending
`tick=51 completed success 2026-09-30T17:50:39Z`, in the operator's WSL scratch
directory); and run 27's three expanded job logs (`r27logs/static.log` 817 lines / 106 792 bytes,
`r27logs/database.log` 689 / 79 729, `r27logs/browser.log` 641 / 66 268 — each fetched with
`curl -sL -H "Authorization: Bearer $(gh auth token)" …/actions/jobs/<id>/logs` at HTTP 200, and every
quotation in the run-27 section read from those copies rather than from the API's step metadata). All of these are in the
operator's own temp directory, not in the repository and not beside it (limitation 22) — every one of
those text copies
swept for privileged shapes and masked, with the before/after counts in limitation 22. Run 23's
diagnosis additionally rests on two records this stage did not create and does not control: Docker
Desktop's own VM log (`%LOCALAPPDATA%\Docker\log\vm\init.log.20260930-131717.048`, stamped in local
time, retained on a ≈1 MB / ≈6-minute rotation, so it is durable only until it rolls) and a 0.1 s
container sampler written for this segment (`~/wslops/r23watch.py` → `r23_watch.jsonl`, 37 container
observations, in the operator's WSL scratch directory and outside the repository). Run 24's rests on the
same two kinds of record: its own VM-log window (`init.log.20260930-143410.211`, covering
08:54:52→09:04:10Z) and the boundary-by-boundary state log plus `--debug` replay it made necessary
(`~/r24wsdiag/`, six numbered step captures, again outside the repository). The
numbers in the skip-classification and release-gate documents are the same measurements, not a
second tradition of them — where a document still quotes a pre-`ec868e8` number, that is corrected
in the same push as this file.*
