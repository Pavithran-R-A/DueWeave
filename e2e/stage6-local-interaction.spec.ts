import { expect, test, type Page } from "@playwright/test";
import { awaitLedger, completeWorkspaceSetup } from "./workspace-setup";

// Stage 6 Phases 29-38 for the parts a browser can actually establish: that a toast
// never sits on a primary action, that a dialog gives focus somewhere useful and
// keeps it reachable, that the queue's cards are real buttons rather than a clickable
// region with buttons inside, that focus is visible in both themes, and that the
// narrowest phone we support still shows whole rows, whole submit buttons and no
// sideways page scrolling.
const localStackEnabled = process.env.STAGE6_LOCAL_E2E === "1";

const token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const account = {
  email: `stage6body-${token}@dueweave.local`,
  password: `Stage6body!${token}aA`,
  displayName: `Stage6 Body Owner ${token.slice(-6)}`,
  businessName: `Stage6 Body Studio ${token.slice(-6)}`,
};
const longClient = `Bhattacharya Communications & Post-Production Private Limited ${token.slice(-6)}`;
const longInvoice = `Interim milestone payment for the second season with the revised scope note ${token.slice(-6)}`;

async function signIn(page: Page) {
  await page.goto("/auth");
  const form = page.getByLabel("Email address");
  const ledger = page.locator(".app-shell");
  // /auth either shows the form or hands an authenticated visitor to the ledger,
  // and the guard decides that a moment after the document loads. Wait for which
  // of the two actually rendered instead of reading the URL mid-redirect.
  await expect(ledger.or(form)).toBeVisible({ timeout: 15_000 });
  if (await ledger.isVisible()) {
    await page.getByRole("button", { name: "More" }).filter({ visible: true }).first().click();
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(form).toBeVisible({ timeout: 15_000 });
  }
  await form.fill(account.email);
  await page.getByLabel("Password").fill(account.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 20_000 });
  await awaitLedger(page);
}

type Box = { x: number; y: number; width: number; height: number };

function overlaps(a: Box, b: Box) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

async function boxOf(locator: ReturnType<Page["locator"]>) {
  const box = await locator.boundingBox();
  if (!box) throw new Error("expected the control to have a box");
  return box;
}

/** Each visible toast is its own list item; that is the surface that could cover a control. */
function toastItems(page: Page) {
  return page.getByRole("region", { name: /Notifications/ }).locator("li");
}

test.describe("Stage 6 interaction and responsive body", () => {
  test.skip(!localStackEnabled, "Set STAGE6_LOCAL_E2E=1 to run against the local Supabase stack.");
  test.describe.configure({ mode: "serial" });
  test.describe.configure({ timeout: 120_000 });

  test.beforeAll(async ({ browser }) => {
    // One seeded account serves every case below.
    const page = await browser.newPage();
    await page.goto("/auth");
    await page.getByRole("button", { name: "Create an account" }).click();
    await page.getByLabel("Your name").fill(account.displayName);
    await page.getByLabel("Email address").fill(account.email);
    await page.getByLabel("Password").fill(account.password);
    await page.getByRole("button", { name: "Create my workspace" }).click();
    await completeWorkspaceSetup(page, account);
    await page.getByRole("button", { name: "Add first receivable" }).click();
    const sheet = page.getByRole("dialog", { name: "Add receivable" });
    await sheet.getByLabel("Client name").fill(longClient);
    await sheet.getByLabel("Company").fill(longClient);
    await sheet.getByLabel("Amount").fill("145000");
    await sheet.getByLabel("Due date").fill("2026-10-20");
    await sheet.getByLabel("What is this for?").fill(longInvoice);
    await sheet.getByLabel("Invoice or reference").fill(`INV-${token.slice(-5, -1)}`);
    await sheet.getByRole("button", { name: "Save receivable" }).click();
    await page.close();
  });

  test("leaves the header action clickable while a success toast is on screen", async ({ page }) => {
    await signIn(page);
    // Raise a toast the way the product does, then reach for the primary action
    // underneath where it landed.
    await page.getByRole("button", { name: "Snooze follow-up" }).first().click();
    await page.getByRole("dialog", { name: "Snooze follow-up" }).getByRole("button", { name: "Save snooze" }).click();
    const toast = toastItems(page).filter({ hasText: "Follow-up snoozed" });
    await expect(toast).toBeVisible();

    const add = page.locator(".page-header__actions button.button-primary").first();
    await expect(add).toBeEnabled();
    // A toast slides in from the edge, so the invariant is where it comes to rest:
    // poll until it settles, and fail if it ever parks on top of the action.
    await expect.poll(async () => overlaps(await boxOf(toast), await boxOf(add)), { timeout: 4_000, message: "the toast rests on the header action" }).toBe(false);
    await add.click();
    await expect(page.getByRole("dialog", { name: "Add receivable" })).toBeVisible();
    await page.getByRole("dialog", { name: "Add receivable" }).getByRole("button", { name: "Cancel" }).click();
  });

  test("keeps the toast clear of the mobile navigation, the sheet confirm button and the header", async ({ page }) => {
    test.slow();
    await page.setViewportSize({ width: 360, height: 800 });
    await signIn(page);
    await page.getByRole("button", { name: "Snooze follow-up" }).first().click();
    await page.getByRole("dialog", { name: "Snooze follow-up" }).getByRole("button", { name: "Save snooze" }).click();
    const toast = toastItems(page).filter({ hasText: "Follow-up snoozed" });
    await expect(toast).toBeVisible();

    const nav = page.getByRole("navigation", { name: "Mobile navigation" });
    const header = page.locator(".page-header");
    await expect.poll(async () => overlaps(await boxOf(toast), await boxOf(nav)), { timeout: 4_000, message: "the toast rests on the bottom navigation" }).toBe(false);
    await expect.poll(async () => overlaps(await boxOf(toast), await boxOf(header)), { timeout: 4_000, message: "the toast rests on the header and its primary action" }).toBe(false);

    // The sheet's own submit and its first fields stay visible with the toast showing.
    await page.locator(".page-header__actions button.button-primary").first().click();
    const sheet = page.getByRole("dialog", { name: "Add receivable" });
    const confirm = sheet.getByRole("button", { name: "Save receivable" });
    await expect(confirm).toBeInViewport();
    await expect(sheet.getByLabel("Amount")).toBeVisible();

    // An unusable submission is refused where the field is, not only in a toast.
    await confirm.click();
    await expect(sheet.getByRole("alert")).toHaveText(["Choose an existing client, or switch to New client.", "Enter an amount greater than zero."]);
    await expect(sheet.getByLabel("Search existing clients")).toHaveAttribute("aria-invalid", "true");
    await expect(sheet.getByLabel("Amount")).toHaveAttribute("aria-invalid", "true");
    await sheet.getByLabel("Amount").fill("500");
    await expect(sheet.getByRole("alert")).toHaveText(["Choose an existing client, or switch to New client."]);
    await sheet.getByRole("button", { name: "New client" }).click();
    await confirm.click();
    await expect(sheet.getByRole("alert")).toHaveText(["Add a client name before saving."]);
    await sheet.getByRole("button", { name: "Cancel" }).click();
    await expect(sheet).toBeHidden();
  });

  test("puts initial focus on the field a person came to fill and returns it afterwards", async ({ page }) => {
    await signIn(page);
    const add = page.locator(".page-header__actions button.button-primary").first();
    await add.click();
    const sheet = page.getByRole("dialog", { name: "Add receivable" });
    await expect(sheet.getByLabel("Search existing clients")).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(add).toBeFocused();

    await page.getByLabel("Primary navigation").getByRole("button", { name: "Clients" }).click();
    const edit = page.getByRole("button", { name: /Edit client/ }).first();
    await edit.click();
    const editor = page.getByRole("dialog", { name: "Edit client" });
    await expect(editor.getByLabel("Client name")).toBeFocused();
    await expect(editor.getByRole("button", { name: "Save changes" })).toBeEnabled();
    await editor.getByRole("button", { name: "Close" }).click();
    await expect(edit).toBeFocused();
  });

  test("keeps keyboard focus inside the sheet, in order, and on a visible control", async ({ page }) => {
    await signIn(page);
    await page.getByLabel("Primary navigation").getByRole("button", { name: "Clients" }).click();
    await page.getByRole("button", { name: /Edit client/ }).first().click();
    const editor = page.getByRole("dialog", { name: "Edit client" });
    const close = editor.getByRole("button", { name: "Close" });
    const save = editor.getByRole("button", { name: "Save changes" });

    // Tab from the last control returns to the dialog's first focusable instead of
    // walking out into the page behind it, and Shift+Tab comes back the other way.
    await save.focus();
    await page.keyboard.press("Tab");
    await expect(close).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(save).toBeFocused();
    // The control a keyboard user is on is also the one they can see.
    await expect(save).toBeInViewport();
    await page.keyboard.press("Tab");
    await expect(close).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(editor).toBeHidden();
  });

  test("shows a visible focus indicator on every keyboard stop, in both themes", async ({ page }) => {
    await signIn(page);
    const ringOfFocused = () => page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null;
      if (!element || element === document.body) return null;
      const style = getComputedStyle(element);
      return {
        label: element.getAttribute("aria-label") ?? element.tagName.toLowerCase(),
        outlineWidth: Number.parseFloat(style.outlineWidth) || 0,
        outlineStyle: style.outlineStyle,
        outlineColor: style.outlineColor,
        hasShadow: style.boxShadow !== "none",
      };
    });

    // Give the document focus through the page itself, then walk it by keyboard.
    await page.getByLabel("Primary navigation").getByRole("button", { name: /^Today/ }).click();
    await page.keyboard.press("Tab");
    const stops: { label: string; outlineWidth: number; outlineStyle: string; hasShadow: boolean }[] = [];
    for (let index = 0; index < 14; index += 1) {
      await page.keyboard.press("Tab");
      const ring = await ringOfFocused();
      if (ring) stops.push(ring);
    }
    const walked = stops.map((stop) => `${stop.label}[${stop.outlineStyle} ${stop.outlineWidth}]`).join(" ");
    expect(stops.length, `tab stops found: ${walked}`).toBeGreaterThanOrEqual(6);
    for (const stop of stops) {
      const visible = (stop.outlineStyle !== "none" && stop.outlineWidth >= 3) || stop.hasShadow;
      expect(visible, `focus on ${stop.label}`).toBe(true);
    }

    await page.getByLabel("Primary navigation").getByRole("button", { name: "More" }).click();
    await page.getByRole("button", { name: /Light mode/ }).click();
    await expect(page.locator(".app-shell--dark")).toBeVisible();
    await page.keyboard.press("Tab");
    const dark = await ringOfFocused();
    expect(dark).not.toBeNull();
    expect(dark!.outlineWidth).toBeGreaterThanOrEqual(3);
    // The light theme's ring is rgba(19, 123, 120, .28); on the dark shell it must be
    // the light teal, or a keyboard user is chasing an invisible outline.
    expect(dark!.outlineColor).toBe("rgb(155, 226, 216)");
  });

  test("makes each queue card one honest button rather than a clickable region", async ({ page }) => {
    await signIn(page);
    // Earlier cases snoozed the seeded amount, so raise a follow-up of its own here.
    await page.locator(".page-header__actions button.button-primary").first().click();
    const sheet = page.getByRole("dialog", { name: "Add receivable" });
    await sheet.getByLabel("Search existing clients").fill(token.slice(-6));
    await sheet.getByRole("option", { name: new RegExp(longClient) }).click();
    await sheet.getByLabel("Amount").fill("4000");
    await sheet.getByLabel("What is this for?").fill(`Queue card check ${token.slice(-6)}`);
    await sheet.getByRole("button", { name: "Save receivable" }).click();

    const card = page.getByRole("article").first();
    await expect(card).toBeVisible();
    await expect(card).not.toHaveAttribute("tabindex");
    expect(await card.evaluate((element) => element.tagName.toLowerCase())).toBe("article");
    // Every card carries exactly one named Details and Follow-up button of its own,
    // so nothing is selected by clicking a region that also holds buttons.
    const cardCount = await page.getByRole("article").count();
    await expect(page.getByRole("button", { name: /^Open details for/ })).toHaveCount(cardCount);
    await expect(page.getByRole("button", { name: /^Follow up with/ })).toHaveCount(cardCount);
    await page.getByRole("button", { name: /₹4,000 outstanding/ }).click();
    await expect(page.getByText("Selected receivable")).toBeVisible();
  });

  test("holds its shape at 360 and 390 pixels with the longest real values", async ({ page }) => {
    test.slow();
    for (const viewport of [{ width: 360, height: 800 }, { width: 390, height: 844 }]) {
      await page.setViewportSize(viewport);
      await signIn(page);
      for (const section of ["Today", "Receivables", "Clients", "More"]) {
        await page.getByLabel("Mobile navigation").getByRole("button", { name: new RegExp(section) }).click();
        const overflow = await page.evaluate(() => {
          const limit = document.documentElement.clientWidth;
          const offenders = Array.from(document.querySelectorAll<HTMLElement>("body *"))
            .filter((element) => element.getBoundingClientRect().right > limit + 1)
            .slice(0, 5)
            .map((element) => `${element.tagName.toLowerCase()}.${element.className.toString().split(" ")[0]}→${Math.round(element.getBoundingClientRect().right)}`);
          return `${document.documentElement.scrollWidth - document.documentElement.clientWidth}px past the viewport: ${offenders.join(", ") || "nothing"}`;
        });
        expect(overflow, `horizontal overflow on ${section} at ${viewport.width}px`).toMatch(/^0px|^1px/);
        await expect(page.getByLabel("Mobile navigation")).toBeInViewport();
      }
      // Long names and amounts wrap instead of pushing the card apart.
      await page.getByLabel("Mobile navigation").getByRole("button", { name: /Receivables/ }).click();
      const card = page.locator("button.receivable-list-card").filter({ hasText: longInvoice });
      await expect(card).toBeVisible();
      await expect(card.getByText("₹1,45,000")).toBeVisible();
      const cardBox = await boxOf(card);
      expect(cardBox.width <= viewport.width).toBe(true);
      // Search keeps a usable width at the narrow end.
      await expect(page.getByLabel("Search receivables")).toBeVisible();
      const searchBox = await boxOf(page.getByLabel("Search receivables"));
      expect(searchBox && searchBox.width > 200).toBe(true);
    }
  });

  test("stays a working two-column workspace at tablet and desktop widths", async ({ page }) => {
    test.slow();
    for (const viewport of [{ width: 768, height: 1024 }, { width: 1280, height: 800 }, { width: 1440, height: 900 }]) {
      await page.setViewportSize(viewport);
      await signIn(page);
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, `horizontal overflow at ${viewport.width}px`).toBeLessThanOrEqual(1);
      await expect(page.getByText("Selected receivable")).toBeVisible();
      // At 768px the rail has already become the bottom navigation, so the section is
      // reached through whichever navigation this width actually shows.
      await page.getByRole("button", { name: "Clients", exact: true }).filter({ visible: true }).first().click();
      await expect(page.getByRole("button", { name: /Edit client/ }).first()).toBeVisible();
      await page.getByRole("button", { name: /Edit client/ }).first().click();
      const sheet = page.getByRole("dialog", { name: "Edit client" });
      await expect(sheet).toBeVisible();
      const sheetBox = await boxOf(sheet);
      expect(sheetBox.width <= 561).toBe(true);
      await page.keyboard.press("Escape");
      await page.getByRole("button", { name: "More", exact: true }).filter({ visible: true }).first().click();
      await expect(page.getByRole("heading", { name: "Who this ledger belongs to." })).toBeVisible();
      await expect(page.locator(".settings-panel--identity").getByText(account.businessName)).toBeVisible();
    }
  });
});
