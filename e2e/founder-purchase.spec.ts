import { expect, test } from "@playwright/test";
import { qaWorkspace, reachLedgerAfterSignIn } from "./workspace-setup";

const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;
const enabled = Boolean(email && password);

async function signIn(page: import("@playwright/test").Page) {
  await page.goto("/auth");
  await page.getByLabel("Email address").fill(email!);
  await page.getByLabel("Password").fill(password!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await reachLedgerAfterSignIn(page, qaWorkspace("controlled"));
  await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
}

test.describe("controlled Founder purchase workflow", () => {
  test.skip(!enabled, "Set E2E_EMAIL and E2E_PASSWORD only in a local ignored environment after provisioning a disposable Stage 4 account.");

  test("shows a truthful non-payable placeholder at every required viewport and safe logout", async ({ page }, testInfo) => {
    await signIn(page);
    await page.getByRole("button", { name: "More" }).first().click();
    await page.getByRole("button", { name: "Founder access" }).click();

    await expect(page).toHaveURL(/\/founder$/);
    await expect(page.getByRole("heading", { name: "Keep every follow-up in view." })).toBeVisible();
    await expect(page.getByText("Founder Lifetime", { exact: true }).first()).toBeVisible();
    await expect(page.getByText("Payment instructions are being set up.")).toBeVisible();
    await expect(page.getByText("Do not send money yet.")).toBeVisible();
    await expect(page.getByText("Verified payment instructions")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Start payment claim" })).toHaveCount(0);
    await expect(page.getByRole("img", { name: /UPI QR code for/ })).toHaveCount(0);
    for (const width of [360, 390, 430, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      await expect(page.getByRole("heading", { name: "Keep every follow-up in view." })).toBeVisible();
      await expect(page.getByText("Payment instructions are being set up.")).toBeVisible();
      await expect(page.getByRole("button", { name: "Start payment claim" })).toHaveCount(0);
      await page.screenshot({ path: testInfo.outputPath(`founder-purchase-${width}.png`), fullPage: true });
    }

    await page.getByRole("button", { name: "Return to my ledger" }).click();
    await expect(page).toHaveURL(/\/$/);
    await page.getByRole("button", { name: "More" }).first().click();
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/auth$/);
  });
});
