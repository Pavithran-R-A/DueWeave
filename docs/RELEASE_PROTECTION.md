# Recommended Repository Protections

This repository remains private. The recommendations below are operational instructions only; this change **does not** merge a branch, modify repository settings, or grant access to any account.

| Setting | Recommendation | Reason |
| --- | --- | --- |
| Default branch | Keep `main` protected. | Release work should arrive through reviewed pull requests. |
| Pull requests | Require at least one approving review before merge. | A second reviewer reduces accidental security regressions. |
| Required checks | Require the `CI / Static verification` check. | It gates lint, type-checking, tests, production build, and production dependency audit. |
| Pushes | Block direct pushes and force pushes to `main`. | It preserves the review trail and immutable release history. |
| Conversations | Require resolution before merge. | Outstanding review comments remain visible until addressed. |
| Administrators | Apply rules to administrators where the platform permits. | Emergency privilege should not silently bypass ordinary protection. |

Configure these controls in GitHub under **Settings → Branches → Add branch protection rule** for `main`. Keep the workflow secret-free: it intentionally does not receive Supabase credentials, service-role keys, payment credentials, or a production browser account. Live Supabase and manual-payment verification remain controlled operator activities, not pull-request jobs.

## Release discipline

Use an isolated branch for a release candidate, run the documented verification matrix, obtain review, and then decide separately whether to merge. Annotated release tags must be created only after a passing verification record. Never force-push, rewrite earlier release tags, publish automatically, or expose a real UPI destination in source control.
