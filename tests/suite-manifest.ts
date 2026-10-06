// One list, two configs. The release gate has to be able to say "the static suite is
// green" without that sentence meaning "the suites that need a database quietly
// skipped", so the split between them cannot be left to a naming convention that a
// later file might break. Every suite below is a file that opens a Supabase client or
// reads the local Postgres container; nothing in `databaseSuites` may be relied on by
// `vitest.unit.config.ts`, and `vitest live` runs exactly these files.

export const databaseSuites = [
  "tests/stage2-local-foundation.test.ts",
  "tests/stage3-local-rls.test.ts",
  "tests/stage4-local-edit-workflows.test.ts",
  "tests/stage4-local-repository-edit.test.ts",
  "tests/stage5-local-lifecycle.test.ts",
  "tests/stage6-local-profile.test.ts",
  "tests/stage7-local-export.test.ts",
  "tests/stage8-local-founder-readiness.test.ts",
  "tests/stage9-abuse-matrix.test.ts",
  "tests/arc3c-local-account-erasure.test.ts",
];

// Not a database suite and not a static suite: this one addresses a hosted Supabase
// project, which this stage deliberately does not have. It stays in the whole-battery
// config so it runs the day a hosted project exists, and is excluded from both release
// halves so neither can report it as evidence. See
// docs/TEST_SKIP_CLASSIFICATION.md for the classification this stage agreed to.
export const hostedOnlySuites = ["tests/supabase.public-config.live.test.ts"];
