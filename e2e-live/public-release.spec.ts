import { expect, test } from "@playwright/test";

test("production login, PWA mark and browser errors", async ({ page, request }) => {
  const uncaught: string[] = [];
  page.on("pageerror", (error) => uncaught.push(error.message));
  const response = await page.goto("/auth");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: /your follow-ups, in one calm place/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
  await expect(page.locator(".auth-brand img")).toHaveAttribute("src", "/brand/mark.svg");

  const [favicon, manifest] = await Promise.all([request.get("/icon.svg"), request.get("/manifest.json")]);
  expect(favicon.status()).toBe(200);
  expect(favicon.headers()["content-type"]).toMatch(/image\/svg\+xml/);
  expect(await favicon.text()).toContain("<svg");
  expect(manifest.status()).toBe(200);
  expect((await manifest.json()).name).toContain("DueWeave");
  expect(uncaught).toEqual([]);
});

test("signup and password-recovery forms validate without sending email", async ({ page }) => {
  await page.goto("/auth");
  await page.getByRole("button", { name: /create an account/i }).click();
  await expect(page.getByRole("heading", { name: /keep the promise/i })).toBeVisible();
  await page.getByRole("button", { name: /create my workspace/i }).click();
  await expect(page.getByText("Enter your email address.")).toBeVisible();
  await expect(page.getByText("Add your name so we know who to greet.")).toBeVisible();
  await page.getByRole("button", { name: /sign in/i }).click();
  await page.getByRole("button", { name: /forgot password/i }).click();
  await expect(page.getByRole("heading", { name: /return to your ledger/i })).toBeVisible();
  // No real email is sent by this smoke test.
});

test("protected routes and unauthenticated recovery cannot reveal a ledger", async ({ page }) => {
  for (const path of ["/", "/onboarding", "/founder", "/admin/founder-claims"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/auth$/);
    await expect(page.getByRole("heading", { name: /your follow-ups/i })).toBeVisible();
  }
  await page.goto("/auth/update-password");
  await expect(page.getByRole("heading", { name: /recovery link is not active/i })).toBeVisible();
});

test("mobile login stays usable without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/auth");
  await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
  expect(overflow).toBe(false);
});
