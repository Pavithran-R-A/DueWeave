import { expect, test, type Page } from "@playwright/test";

const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;
const signupEmail = process.env.E2E_SIGNUP_EMAIL;
const signupPassword = process.env.E2E_SIGNUP_PASSWORD;
const enabled = Boolean(email && password && signupEmail && signupPassword);

async function signIn(page: Page) {
  await page.goto("/auth");
  await page.getByLabel("Email address").fill(email!);
  await page.getByLabel("Password").fill(password!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
}

test.describe("controlled auth lifecycle limits", () => {
  test.skip(!enabled, "Set local ignored E2E_EMAIL, E2E_PASSWORD, E2E_SIGNUP_EMAIL, and E2E_SIGNUP_PASSWORD for the temporary controlled accounts.");

  test("keeps an unavailable signup safely at the auth gateway without raw provider detail", async ({ page }) => {
    await page.goto("/auth");
    await page.getByRole("button", { name: "Create an account" }).click();
    await page.getByLabel("Your name").fill("Stage 3 signup check");
    await page.getByLabel("Email address").fill(signupEmail!);
    await page.getByLabel("Password").fill(signupPassword!);
    await page.getByRole("button", { name: "Create my workspace" }).click();
    await expect(page).toHaveURL(/\/auth$/);
    await expect(page.getByRole("alert")).toHaveText(/^(We could not complete that request\. Please try again\.|Please wait a moment before trying again\.)$/);
  });

  test("fails safely back to the auth gateway after the browser session is removed", async ({ page }) => {
    await signIn(page);
    await page.evaluate(() => {
      for (const key of Object.keys(window.localStorage)) {
        if (key.startsWith("sb-") && key.endsWith("-auth-token")) window.localStorage.removeItem(key);
      }
    });
    await page.reload();
    await expect(page).toHaveURL(/\/auth$/);
    await expect(page.getByRole("heading", { name: "Your follow-ups, in one calm place." })).toBeVisible();
  });
});
