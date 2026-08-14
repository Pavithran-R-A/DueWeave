import { expect, test } from "@playwright/test";

type Credentials = { email?: string; password?: string };

async function signIn(page: import("@playwright/test").Page, credentials: Credentials) {
  await page.goto("/auth");
  await page.getByLabel("Email address").fill(credentials.email!);
  await page.getByLabel("Password").fill(credentials.password!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/$/);
}

async function openExistingClientReceivable(page: import("@playwright/test").Page, clientName: string) {
  await page.getByRole("button", { name: "Add receivable" }).first().click();
  await expect(page.getByText("DueWeave never merges people by name.")).toBeVisible();
  await page.getByRole("button", { name: "Existing client" }).click();
  await page.getByLabel("Search existing clients").fill(clientName);
  await page.getByRole("option", { name: new RegExp(clientName) }).click();
  await expect(page.getByRole("option", { name: new RegExp(clientName) })).toHaveAttribute("aria-selected", "true");
  await page.getByLabel("Amount").fill("1250");
  await page.getByLabel("Due date").fill("2026-09-30");
  await page.getByLabel("What is this for?").fill("Stage 4.1 existing-client validation");
}

test.describe("controlled Stage 4.1 existing-client and Founder conversion workflows", () => {
  const existing = { email: process.env.E2E_EXISTING_EMAIL, password: process.env.E2E_EXISTING_PASSWORD };
  const limited = { email: process.env.E2E_LIMIT_EMAIL, password: process.env.E2E_LIMIT_PASSWORD };
  test.skip(!existing.email || !existing.password || !limited.email || !limited.password, "Set only local ignored Stage 4.1 E2E fixture credentials.");

  test("uses a deliberately selected existing client without creating a duplicate", async ({ page }) => {
    await signIn(page, existing);
    await openExistingClientReceivable(page, "Stage 4.1 Existing Client");
    await page.getByRole("button", { name: "Save receivable" }).click();
    await expect(page.getByText("Receivable added", { exact: true })).toBeVisible();
    await expect(page.getByText("Stage 4.1 Existing Client", { exact: true }).first()).toBeVisible();
  });

  test("converts the authoritative fourth-receivable denial into the real Founder route", async ({ page }) => {
    await signIn(page, limited);
    await openExistingClientReceivable(page, "Stage 4.1 Limit Client");
    await page.getByRole("button", { name: "Save receivable" }).click();
    await expect(page.getByRole("status")).toContainText("Free plan limit reached");
    await page.getByRole("button", { name: "View Founder access" }).click();
    await expect(page).toHaveURL(/\/founder$/);
    await expect(page.getByRole("heading", { name: "Keep every follow-up in view." })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Pay with your UPI app" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Start payment claim" })).toBeVisible();
  });
});
