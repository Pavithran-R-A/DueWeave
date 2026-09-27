import { expect, test, type Page } from "@playwright/test";
import { awaitLedger, completeWorkspaceSetup } from "./workspace-setup";
import { problemsFound, startProblemWatch, type ProblemWatch } from "./problem-watch";

// Stage 6 Phase 53 — the responsive qualification, measured rather than looked at.
// Every assertion reads a number off the live document: the document's own scroll
// width against the viewport it was given, and the box of each control a first user
// has to reach. Screenshots are saved as evidence, never used as the verdict.
const localStackEnabled = process.env.STAGE6_LOCAL_E2E === "1";

const token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const suffix = token.slice(-6);
const account = {
  email: `stage6rwd-${suffix}@dueweave.local`,
  password: `Stage6rwd!${suffix}aA`,
  displayName: `Stage6 Responsive Owner ${suffix}`,
  businessName: `Stage6 Responsive Studio ${suffix}`,
};
const clientName = `Stage6 Responsive Client ${suffix}`;
const invoice = `Stage6 responsive retainer ${suffix}`;

const viewports = [
  { name: "360", width: 360, height: 800 },
  { name: "390", width: 390, height: 844 },
  { name: "430", width: 430, height: 932 },
  { name: "768", width: 768, height: 1024 },
  { name: "1024", width: 1024, height: 768 },
  { name: "1440", width: 1440, height: 900 },
];

const sections = [
  { name: "Today", tab: /^Today/ },
  { name: "Receivables", tab: /^Receivables/ },
  { name: "Clients", tab: /^Clients/ },
  { name: "More", tab: /^More/ },
];

type Box = { left: number; right: number; top: number; bottom: number; width: number; height: number; viewportWidth: number; viewportHeight: number };

async function signIn(page: Page) {
  await page.goto("/auth");
  const form = page.getByLabel("Email address");
  const ledger = page.locator(".app-shell");
  await expect(ledger.or(form)).toBeVisible({ timeout: 15_000 });
  if (await ledger.isVisible()) {
    await page.getByRole("button", { name: "More" }).filter({ visible: true }).first().click();
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(form).toBeVisible({ timeout: 15_000 });
  }
  await form.fill(account.email);
  await page.getByLabel("Password").fill(account.password);
  await page.locator("button.auth-submit").click();
  await expect(page).toHaveURL(/\/$/, { timeout: 20_000 });
  await awaitLedger(page);
}

async function goTo(page: Page, name: RegExp) {
  await page.getByRole("button", { name }).filter({ visible: true }).first().click();
}

/** A bottom sheet rises into place and sections fade in, so a measurement taken
 * mid-flight measures the animation rather than the layout. */
async function settle(page: Page) {
  await page.evaluate(async () => {
    await Promise.all(Array.from(document.getAnimations()).map((animation) => animation.finished.catch(() => undefined)));
  });
}

/** The document's own horizontal overflow, with the widest things causing it. */
async function measureOverflow(page: Page) {
  await settle(page);
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const scrollWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
    const offenders = scrollWidth > width + 1
      ? Array.from(document.querySelectorAll<HTMLElement>("body *"))
        .filter((el) => {
          const box = el.getBoundingClientRect();
          return box.width > 0 && box.right > width + 1 && getComputedStyle(el).position !== "fixed";
        })
        .slice(0, 4)
        .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0] || "-"}→${Math.round(el.getBoundingClientRect().right)}`)
      : [];
    return { width, scrollWidth, offenders };
  });
}

/** One control's box against the viewport it was given, or null when absent. */
async function measureBox(page: Page, selector: string): Promise<Box | null> {
  await settle(page);
  return page.evaluate((css) => {
    const el = document.querySelector<HTMLElement>(css);
    if (!el) return null;
    const box = el.getBoundingClientRect();
    return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height, viewportWidth: document.documentElement.clientWidth, viewportHeight: document.documentElement.clientHeight };
  }, selector);
}

async function expectWithinWidth(box: Box, label: string) {
  expect(box.left, `${label}: starts past the left edge`).toBeGreaterThanOrEqual(-1);
  expect(box.right, `${label}: ends past the right edge`).toBeLessThanOrEqual(box.viewportWidth + 1);
}

async function isDarkTheme(page: Page) {
  return page.evaluate(() => Boolean(document.querySelector(".app-shell")?.classList.contains("app-shell--dark")));
}

test.describe("Stage 6 responsive measurement matrix", () => {
  test.skip(!localStackEnabled, "Set STAGE6_LOCAL_E2E=1 to run against the local Supabase stack.");
  test.describe.configure({ mode: "serial" });
  test.describe.configure({ timeout: 180_000 });

  test.beforeAll(async ({ browser }) => {
    const page = await browser.newPage();
    await page.goto("/auth");
    await page.getByRole("button", { name: "Create an account" }).click();
    await page.getByLabel("Your name").fill(account.displayName);
    await page.getByLabel("Email address").fill(account.email);
    await page.getByLabel("Password").fill(account.password);
    await page.getByRole("button", { name: "Create my workspace" }).click();
    await completeWorkspaceSetup(page, account);
    await page.getByLabel("Primary navigation").getByRole("button", { name: "Clients" }).click();
    await page.getByRole("button", { name: "Add client" }).click();
    await page.getByRole("dialog", { name: "Add client" }).getByLabel("Client name").fill(clientName);
    await page.getByRole("button", { name: "Save client" }).click();
    await expect(page.getByText(clientName).first()).toBeVisible();
    await page.locator(".page-header__actions button.button-primary").first().click();
    const receivable = page.getByRole("dialog", { name: "Add receivable" });
    await receivable.getByLabel("Search existing clients").fill(suffix);
    await receivable.getByRole("option", { name: new RegExp(clientName) }).click();
    await receivable.getByLabel("Amount").fill("6100");
    await receivable.getByLabel("What is this for?").fill(invoice);
    await receivable.getByRole("button", { name: "Save receivable" }).click();
    await expect(receivable).toBeHidden({ timeout: 20_000 });
    await page.close();
  });

  // Phase 54: measuring the layout at six widths is worth nothing if the page threw
  // its way through them. A worker runs one test at a time, so this holder always
  // belongs to the page the current measurement is driving.
  let watch: ProblemWatch;
  test.beforeEach(async ({ page }) => {
    watch = startProblemWatch(page);
  });
  test.afterEach(() => {
    expect(problemsFound(watch)).toEqual([]);
  });

  test("keeps the signed-out first screen inside every width", async ({ page }) => {
    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto("/auth");
      const form = page.getByLabel("Email address");
      await expect(form).toBeVisible({ timeout: 20_000 });
      const overflow = await measureOverflow(page);
      expect(overflow.scrollWidth, `/auth overflows at ${viewport.name}px: ${overflow.offenders.join(", ")}`).toBeLessThanOrEqual(overflow.width + 1);
      const submit = await measureBox(page, "button.auth-submit");
      expect(submit, `${viewport.name}px: the sign-in button is gone`).not.toBeNull();
      await expectWithinWidth(submit!, `sign-in button at ${viewport.name}px`);
      const createAccount = page.getByRole("button", { name: "Create an account" });
      await createAccount.click();
      await expect(page.getByLabel("Business or workspace name")).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Create my workspace" })).toBeVisible();
      const again = await measureOverflow(page);
      expect(again.scrollWidth, `/auth sign-up overflows at ${viewport.name}px: ${again.offenders.join(", ")}`).toBeLessThanOrEqual(again.width + 1);
    }
  });

  test("keeps every principal page inside the width it was given", async ({ page }) => {
    await signIn(page);
    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      for (const section of sections) {
        await goTo(page, section.tab);
        await expect(page.locator(".app-content")).toBeVisible();
        const heading = await measureBox(page, ".page-header h1");
        expect(heading, `${viewport.name}px / ${section.name}: the page lost its own heading`).not.toBeNull();
        await expectWithinWidth(heading!, `${viewport.name}px / ${section.name} heading`);
        const overflow = await measureOverflow(page);
        expect(overflow.scrollWidth, `${viewport.name}px / ${section.name} overflows horizontally: ${overflow.offenders.join(", ")}`).toBeLessThanOrEqual(overflow.width + 1);
      }
    }
  });

  test("keeps the controls a person needs inside the viewport at every width", async ({ page }) => {
    await signIn(page);
    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      const label = `${viewport.name}px`;

      // One add affordance, never two competing for the same thumb.
      const floating = await measureBox(page, "button.floating-add");
      const header = await measureBox(page, ".page-header__actions button.button-primary");
      const drawn = [floating, header].filter((box): box is Box => Boolean(box && box.width > 0 && box.height > 0));
      expect(drawn, `${label} drew ${drawn.length} add affordances at once`).toHaveLength(1);
      await expectWithinWidth(drawn[0]!, `${label} add control`);
      expect(drawn[0]!.top, `${label}: the add control sits above the viewport`).toBeGreaterThanOrEqual(-1);
      // 24x24 CSS pixels is the smallest target this stage treats as acceptable; the
      // broader touch-target audit belongs to Stage 9.
      expect(Math.min(drawn[0]!.width, drawn[0]!.height), `${label}: the add control is a ${(Math.min(drawn[0]!.width, drawn[0]!.height)).toFixed(0)}px touch target`).toBeGreaterThanOrEqual(24);

      // Navigation is reachable in whichever shape the app is wearing.
      const nav = await measureBox(page, viewport.width <= 820 ? ".bottom-nav" : ".app-rail");
      expect(nav, `${label}: no navigation is drawn`).not.toBeNull();
      expect(nav!.height, `${label}: the navigation has no height`).toBeGreaterThan(0);
      await expectWithinWidth(nav!, `${label} navigation`);

      await goTo(page, /^Receivables/);
      const search = await measureBox(page, ".search-field input");
      expect(search, `${label}: the receivables search vanished`).not.toBeNull();
      expect(search!.width, `${label}: the search control is not drawn`).toBeGreaterThan(0);
      await expectWithinWidth(search!, `${label} search control`);
    }
  });

  test("keeps a sheet and its confirm action inside the screen at every width", async ({ page }) => {
    await signIn(page);
    for (const viewport of viewports) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await goTo(page, /^Today/);
      await page.locator(".page-header__actions button.button-primary").first().click();
      const sheet = page.getByRole("dialog", { name: "Add receivable" });
      await expect(sheet).toBeVisible({ timeout: 15_000 });
      // The sheet starts on the field the person came for at every width.
      await expect(sheet.getByLabel("Search existing clients")).toBeFocused();

      await settle(page);
      const panel = await sheet.evaluate((node) => {
        const box = node.getBoundingClientRect();
        return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, viewportWidth: document.documentElement.clientWidth, viewportHeight: document.documentElement.clientHeight };
      });
      await expectWithinWidth({ ...panel, width: panel.right - panel.left, height: panel.bottom - panel.top }, `${viewport.name}px sheet`);
      expect(panel.top, `${viewport.name}px: the sheet starts above the screen`).toBeGreaterThanOrEqual(-1);
      expect(panel.bottom, `${viewport.name}px: the sheet runs past the bottom of the screen`).toBeLessThanOrEqual(panel.viewportHeight + 1);

      // The footer holds the confirmation: it must be on screen, not merely present.
      const footer = await measureBox(page, ".sheet-footer");
      expect(footer, `${viewport.name}px: the sheet lost its footer`).not.toBeNull();
      expect(footer!.height, `${viewport.name}px: the sheet footer is not drawn`).toBeGreaterThan(0);
      await expectWithinWidth(footer!, `${viewport.name}px sheet footer`);
      expect(footer!.bottom, `${viewport.name}px: the sheet footer is below the screen`).toBeLessThanOrEqual(footer!.viewportHeight + 1);
      await expect(sheet.getByRole("button", { name: "Save receivable" })).toBeInViewport();
      await page.keyboard.press("Escape");
      await expect(sheet).toBeHidden();
    }
  });

  test("holds both themes to the same measurements, on a phone and on a desktop", async ({ page, context }, testInfo) => {
    await signIn(page);
    const painted: Record<string, string> = {};
    for (const viewport of [{ name: "390", width: 390, height: 844 }, { name: "1440", width: 1440, height: 900 }]) {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      for (const theme of ["light", "dark"] as const) {
        if ((await isDarkTheme(page)) !== (theme === "dark")) {
          await page.getByRole("button", { name: `Switch to ${theme} mode` }).first().click();
          await expect.poll(() => isDarkTheme(page)).toBe(theme === "dark");
        }
        const label = `${viewport.name}px ${theme}`;
        // The theme has to be a painted difference, not only a class on the shell.
        painted[theme] = await page.evaluate(() => getComputedStyle(document.querySelector<HTMLElement>(".app-shell")!).backgroundColor);
        for (const section of sections) {
          await goTo(page, section.tab);
          const overflow = await measureOverflow(page);
          expect(overflow.scrollWidth, `${label} / ${section.name} overflows: ${overflow.offenders.join(", ")}`).toBeLessThanOrEqual(overflow.width + 1);
          const heading = await measureBox(page, ".page-header h1");
          await expectWithinWidth(heading!, `${label} / ${section.name} heading`);
        }
        await page.screenshot({ path: testInfo.outputPath(`responsive-${viewport.name}-${theme}.png`) });
      }
    }
    expect(painted.dark).toBeTruthy();
    expect(painted.dark, "the dark theme painted the same surface as light").not.toBe(painted.light);
    // A reload has to come back in the theme that was chosen, on either shape.
    await page.reload();
    await expect.poll(() => isDarkTheme(page)).toBe(true);
    const restored = await measureOverflow(page);
    expect(restored.scrollWidth).toBeLessThanOrEqual(restored.width + 1);
    expect(await context.pages().length).toBeGreaterThan(0);
  });
});
