import { expect, test, type Page } from "@playwright/test";

const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;
const enabled = Boolean(email && password);

async function signIn(page: Page) {
  await page.goto("/auth");
  await page.getByLabel("Email address").fill(email!);
  await page.getByLabel("Password").fill(password!);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
}

test.describe("controlled accessibility smoke coverage", () => {
  test.skip(!enabled, "Set local ignored E2E_EMAIL and E2E_PASSWORD for the dedicated controlled Supabase QA account.");

  test("keeps auth labels, focus visibility, dialog keyboard behavior, and reduced motion available", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/auth");

    const emailInput = page.getByLabel("Email address");
    await emailInput.focus();
    await expect(emailInput).toBeFocused();
    await expect.poll(() => emailInput.evaluate((element) => getComputedStyle(element).boxShadow)).not.toBe("none");
    await page.keyboard.press("Tab");
    await expect(page.getByLabel("Password")).toBeFocused();
    await expect.poll(() => page.evaluate(() => Number.parseFloat(getComputedStyle(document.body).transitionDuration) * 1000)).toBeLessThanOrEqual(0.001);

    await signIn(page);
    const addClient = page.getByRole("button", { name: "Add a client first" });
    await addClient.focus();
    await expect(addClient).toBeFocused();
    await addClient.click();

    const dialog = page.getByRole("dialog", { name: "Add client" });
    const close = dialog.getByRole("button", { name: "Close" });
    const save = dialog.getByRole("button", { name: "Save client" });
    await expect(dialog).toHaveAttribute("aria-modal", "true");
    await expect(close).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(save).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(close).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(addClient).toBeFocused();
  });
});
