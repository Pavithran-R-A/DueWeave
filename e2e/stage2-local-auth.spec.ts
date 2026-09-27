import { expect, test } from "@playwright/test";
import { completeWorkspaceSetup } from "./workspace-setup";

// Qualified against the repository's own local Supabase Docker stack only.
// Run with STAGE2_LOCAL_E2E=1 after `pnpm supabase:start`, a local db reset,
// and a dev/preview server built against the local browser-safe config.
//
// Local email confirmation is disabled in supabase/config.toml so this journey
// can sign up and receive a session without external SMTP. That is a local
// development setting only and proves nothing about production confirmation.
const localStackEnabled = process.env.STAGE2_LOCAL_E2E === "1";

const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const account = {
  displayName: `Stage2 Fixture ${suffix.slice(-6)}`,
  businessName: `Stage2 Fixture Studio ${suffix.slice(-6)}`,
  email: `stage2-${suffix}@dueweave.local`,
  password: `Stage2-local-${suffix}!`,
};

const demoMarkers = ["Nova Media", "Arjun Mehta", "PixelMint Studio", "Brand film", "Rajesh Studio"];

test.describe("Stage 2 local browser auth journey", () => {
  test.skip(!localStackEnabled, "Set STAGE2_LOCAL_E2E=1 to run against the local Supabase stack.");

  test("signs up, reaches the private ledger, signs out, and signs back in", async ({ page }) => {
    await page.goto("/auth");
    await expect(page.getByRole("heading", { name: "Your follow-ups, in one calm place." })).toBeVisible();

    await page.getByRole("button", { name: "Create an account" }).click();
    await expect(page.getByRole("heading", { name: "Keep the promise, not the pressure." })).toBeVisible();

    await page.getByLabel("Your name").fill(account.displayName);
    await page.getByLabel("Email address").fill(account.email);
    await page.getByLabel("Password").fill(account.password);
    await page.getByRole("button", { name: "Create my workspace" }).click();

    await completeWorkspaceSetup(page, account);
    await expect(page.getByRole("heading", { name: "Make the next conversation easier." })).toBeVisible();
    await expect(page.getByText("Still outstanding")).toBeHidden();
    for (const marker of demoMarkers) {
      await expect(page.getByText(marker, { exact: false })).toHaveCount(0);
    }

    await page.getByLabel("Primary navigation").getByRole("button", { name: "More" }).click();
    await expect(page.getByRole("heading", { name: "A private ledger for the awkward middle." })).toBeVisible();
    await page.getByRole("button", { name: /Sign out/ }).click();

    await expect(page).toHaveURL(/\/auth$/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "Your follow-ups, in one calm place." })).toBeVisible();

    await page.getByLabel("Email address").fill(account.email);
    await page.getByLabel("Password").fill(account.password);
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page).toHaveURL(/\/$/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: "Make the next conversation easier." })).toBeVisible();
    for (const marker of demoMarkers) {
      await expect(page.getByText(marker, { exact: false })).toHaveCount(0);
    }
    await expect(page.getByLabel("Primary navigation").getByText(account.displayName)).toBeVisible();
  });
});
