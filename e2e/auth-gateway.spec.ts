import { expect, test } from "@playwright/test";

test.describe("DueWeave protected authentication gateway", () => {
  test("redirects signed-out visitors away from the private ledger", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/auth$/);
    await expect(page.getByRole("heading", { name: "Your follow-ups, in one calm place." })).toBeVisible();
    await expect(page.getByText("No client data is loaded until you sign in.")).toBeVisible();
  });

  test("keeps an invalid sign-in failure non-technical", async ({ page }) => {
    await page.goto("/auth");
    await page.getByLabel("Email address").fill("not-a-customer@invalid.example");
    await page.getByLabel("Password").fill("not-a-valid-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    const alert = page.getByRole("alert");
    await expect(alert).toBeVisible();
    await expect(alert).not.toContainText(/postgres|supabase|sql|stack|token/i);
  });

  test("makes password recovery explicit without disclosing account membership", async ({ page }) => {
    await page.goto("/auth");
    await page.getByRole("button", { name: "Forgot password?" }).click();
    await expect(page.getByRole("heading", { name: "Return to your ledger." })).toBeVisible();
    await page.getByLabel("Email address").fill("not-a-customer@invalid.example");
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByText("If that email belongs to a DueWeave account, a reset link is on its way.")).toBeVisible();
  });
});

test.describe("controlled authenticated ledger workflow", () => {
  test.skip(
    "requires a locally supplied confirmed Supabase QA account",
    "The full signup/login, CRUD, payment, persistence, and free-plan journey is deliberately not executed without E2E_EMAIL and E2E_PASSWORD supplied through a local ignored environment. Supabase email confirmation remains enabled.",
    async () => {},
  );
});
