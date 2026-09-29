import { assertLocalStack } from "../scripts/local-stack-check.mjs";

// Vitest's globalSetup entry for the database half. The rules live in
// scripts/local-stack-check.mjs so the browser half asks the identical question.
export default async function setupEnvironment() {
  const { url, healthStatus } = await assertLocalStack();
  console.log(`[live-stack-guard] qualified against ${url} (Auth health ${healthStatus})`);
}
