import { expect, test } from "@playwright/test";

const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;
const enabled = Boolean(email && password);
const suffix = `${Date.now()}`;
const clientName = `E2E Client ${suffix}`;
const company = `E2E Studio ${suffix}`;
const description = `E2E design retainer ${suffix}`;

async function signIn(page: import("@playwright/test").Page) {
  await page.goto("/auth");
  await page.getByLabel("Email address").fill(email!);
  await page.getByLabel("Password").fill(password!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/$/);
  await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
}

test.describe("controlled authenticated receivables workflow", () => {
  test.skip(!enabled, "Set E2E_EMAIL and E2E_PASSWORD only in a local ignored environment after confirming one dedicated Supabase QA account.");

  test("persists a client, receivable, promise history, payments, session, and logout", async ({ page }) => {
    await signIn(page);
    await expect(page.getByText("Make the next conversation easier.")).toBeVisible();

    await page.getByRole("button", { name: "Add a client first" }).click();
    await page.getByLabel("Client name").fill(clientName);
    await page.getByLabel("Company").fill(company);
    await page.getByRole("button", { name: "Save client" }).click();
    await expect(page.getByRole("heading", { name: clientName, exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Add receivable" }).first().click();
    await page.getByLabel("Client name").fill(clientName);
    await page.getByLabel("Company").fill(company);
    await page.getByLabel("Amount").fill("10,000");
    await page.getByLabel("What is this for?").fill(description);
    await page.getByRole("button", { name: "Save receivable" }).click();
    await expect(page.getByText(description, { exact: true })).toBeVisible();
    await expect(page.getByText("₹10,000", { exact: true }).first()).toBeVisible();

    await page.getByRole("button", { name: /Record new promise/ }).click();
    await page.getByRole("button", { name: "Keep this promise" }).click();
    await expect(page.getByText("Promise added")).toBeVisible();

    await page.getByRole("button", { name: /Record new promise/ }).click();
    await page.getByRole("button", { name: "Keep this promise" }).click();
    await expect(page.getByText("Promise added")).toBeVisible();

    await page.getByRole("button", { name: "Record payment" }).click();
    await page.getByLabel("Amount").fill("2,500");
    await page.getByRole("button", { name: "Record payment" }).last().click();
    await expect(page.getByLabel("Notifications alt+T").getByText("Payment recorded")).toBeVisible();
    await expect(page.getByText("₹7,500", { exact: true }).first()).toBeVisible();

    await page.reload();
    await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
    await expect(page.getByText("₹7,500", { exact: true }).first()).toBeVisible();

    await page.getByRole("button", { name: "Record payment" }).click();
    await page.getByRole("button", { name: "Record payment" }).last().click();
    await expect(page.getByLabel("Notifications alt+T").getByText("Payment recorded")).toBeVisible();
    await expect(page.getByText("₹0", { exact: true }).first()).toBeVisible();

    await page.getByRole("button", { name: "More" }).first().click();
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/auth$/);
    await signIn(page);
    await page.getByRole("button", { name: "Receivables" }).first().click();
    await page.getByRole("tab", { name: /All history/ }).click();
    await expect(page.getByText(description, { exact: true })).toBeVisible();
  });
});
