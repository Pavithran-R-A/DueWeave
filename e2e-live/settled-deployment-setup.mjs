import { chromium } from "@playwright/test";
import { assertDeploymentSettled } from "../scripts/deployment-settled-check.mjs";

// Playwright's entry into the question this suite kept failing to ask: has the site finished
// being rebuilt? Cloudflare builds `release/consumer-live` on the same push that starts this
// workflow, and the specs assert against whatever the hostname answers at that moment — so a
// push could fail on a heading that was already shipped, or pass against a deployment that had
// not moved yet. The wait happens once, here, before any spec runs.
//
// What this does NOT do is raise a single assertion's timeout. Every spec still waits 5s for its
// heading, which is the correct expectation for a deployment that has finished changing; a
// heading that never appears is still a failure. The cause is removed rather than tolerated.
//
// The second half — rendering the settled document once — is what makes that 5s fair in the
// first place. A cold edge has not fetched this build's entry chunks yet, and the first visitor
// pays for that with the very time a spec is not allowed to spend.
const origin = "https://dueweave.pages.dev";

export default async function globalSetup() {
  const settled = await assertDeploymentSettled({ origin, log: (line) => console.log(`[live-settle] ${line}`) });
  console.log(`[live-settle] ${settled.url} served the same build twice (${settled.assets.map((asset) => asset.split("/").pop()).join(" + ")}) after ${settled.reads} reads in ${settled.waitedMs}ms.`);

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(`${origin}/auth`, { waitUntil: "load", timeout: 60_000 });
    await page.waitForFunction(() => document.querySelector("#root")?.children.length > 0, null, { timeout: 60_000 });
    await page.close();
  } finally {
    await browser.close();
  }
  console.log(`[live-settle] ${origin}/auth rendered and its entry assets are warm; running the suite.`);
}
