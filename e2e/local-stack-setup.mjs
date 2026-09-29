import { assertLocalStack } from "../scripts/local-stack-check.mjs";

// Playwright's entry into the same question the vitest database half asks: is there a
// disposable local stack to mutate? Without it a browser run against a machine with no
// stack reported every Stage 2-8 journey as skipped and still exited 0, which is the
// result a release gate must not be able to produce.
export default async function globalSetup() {
  const { url, healthStatus } = await assertLocalStack();
  console.log(`[browser-stack-setup] qualified against ${url} (Auth health ${healthStatus})`);
}
