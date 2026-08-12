import { expect, test } from "@playwright/test";

const email = process.env.E2E_EMAIL;
const password = process.env.E2E_PASSWORD;
const enabled = Boolean(email && password);

const viewports = [
  { name: "360", width: 360, height: 800 },
  { name: "390", width: 390, height: 844 },
  { name: "430", width: 430, height: 932 },
  { name: "768", width: 768, height: 1024 },
  { name: "1024", width: 1024, height: 768 },
  { name: "1440", width: 1440, height: 900 },
];

test.describe("controlled responsive authenticated dashboard", () => {
  test.skip(!enabled, "Set E2E_EMAIL and E2E_PASSWORD only in a local ignored environment for the disposable QA account.");

  test("keeps the real empty-state Today dashboard usable at every required viewport", async ({ page }, testInfo) => {
    await page.goto("/auth");
    await page.getByLabel("Email address").fill(email!);
    await page.getByLabel("Password").fill(password!);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/$/);

    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
      await expect(page.getByText("Make the next conversation easier.")).toBeVisible();
      await expect(page.getByRole("button", { name: "Add a client first" })).toBeVisible();
      await page.screenshot({
        path: testInfo.outputPath(`authenticated-dashboard-${viewport.name}.png`),
        fullPage: true,
      });
    }
  });
});
