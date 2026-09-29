import { expect, test, type Page } from "@playwright/test";
import { awaitLedger, completeWorkspaceSetup } from "./workspace-setup";

// Stage 6 Phase 52 — a targeted keyboard and accessibility qualification, not a WCAG
// certification (Stage 9 owns the broader audit). Every assertion asks the live
// document what assistive technology would actually be told: the accessible name of a
// control, whether focus carries a visible mark, where focus lands when a sheet opens,
// what a refusal sounds like. Nothing here is read off a screenshot or from CSS source.
const localStackEnabled = process.env.STAGE6_LOCAL_E2E === "1";

const token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const suffix = token.slice(-6);
const account = {
  email: `stage6a11y-${suffix}@dueweave.local`,
  password: `Stage6a11y!${suffix}aA`,
  displayName: `Stage6 A11y Owner ${suffix}`,
  businessName: `Stage6 A11y Studio ${suffix}`,
};
const clientName = `Stage6 A11y Client ${suffix}`;
const invoice = `Stage6 a11y retainer ${suffix}`;

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

/** Clicks whichever copy of a workspace tab the current viewport actually shows. */
async function goTo(page: Page, name: RegExp) {
  await page.getByRole("button", { name }).filter({ visible: true }).first().click();
}

/** The name a screen reader would announce, computed the way the spec says to find it. */
async function unnamedControls(page: Page) {
  return page.evaluate(() => {
    const byIds = (ids: string | null) => (ids ?? "").split(/\s+/).filter(Boolean).map((id) => document.getElementById(id)?.textContent ?? "").join(" ").trim();
    // A button whose label is hidden at this width has no name to announce, even
    // though the text is still in the DOM: `textContent` answers "what is written",
    // the accessibility API answers "what is rendered". Compact mobile layouts are
    // exactly where the two disagree, so the walk skips subtrees the browser skips.
    const drawn = (el: Element) => {
      const style = getComputedStyle(el);
      return style.display !== "none" && style.visibility !== "hidden";
    };
    const renderedText = (node: Node): string => {
      if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? "";
      if (node.nodeType !== Node.ELEMENT_NODE || !drawn(node)) return "";
      if ((node as Element).getAttribute("aria-hidden") === "true") return "";
      return Array.from(node.childNodes).map(renderedText).join(" ");
    };
    const nameOf = (el: Element): string => {
      const referenced = byIds(el.getAttribute("aria-labelledby"));
      if (referenced) return referenced;
      const labelled = el.getAttribute("aria-label");
      if (labelled?.trim()) return labelled.trim();
      const implicit = (el as HTMLInputElement).labels;
      if (implicit?.length) return Array.from(implicit).map((label) => label.textContent ?? "").join(" ").replace(/\s+/g, " ").trim();
      if (el.getAttribute("alt")?.trim()) return el.getAttribute("alt")!.trim();
      if ((el as HTMLButtonElement).title?.trim()) return (el as HTMLButtonElement).title.trim();
      return renderedText(el).replace(/\s+/g, " ").trim();
    };
    const shown = (el: Element) => {
      const box = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return box.width > 0 && box.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    const selector = "button, a[href], input, select, textarea, [role='button'], [role='tab'], [role='option'], [role='link'], [role='switch']";
    return Array.from(document.querySelectorAll(selector))
      .filter((el) => shown(el) && !el.hasAttribute("disabled") && el.getAttribute("aria-hidden") !== "true" && !nameOf(el))
      .map((el) => `${el.tagName.toLowerCase()}${el.className ? `.${String(el.className).split(" ")[0]}` : ""} "${(el.textContent ?? "").trim().slice(0, 30)}"`);
  });
}

/** Where Tab landed: its name, and whether the browser is showing it as focused. */
async function focusStop(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return { name: "<nothing>", ring: false, focusVisible: false };
    const style = getComputedStyle(el);
    const outline = style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) > 0;
    const referenced = (el.getAttribute("aria-labelledby") ?? "").split(/\s+/).filter(Boolean).map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
    const name = referenced.trim() || el.getAttribute("aria-label")?.trim() || (el as HTMLInputElement).labels?.[0]?.textContent?.trim() || (el.textContent ?? "").replace(/\s+/g, " ").trim() || el.type || el.tagName.toLowerCase();
    return { name, ring: outline || style.boxShadow !== "none", focusVisible: el.matches(":focus-visible") };
  });
}

/** Where the focused control actually sits, in the viewport it was given. */
async function focusedElementGeometry(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return null;
    const box = el.getBoundingClientRect();
    return { bottom: box.bottom, right: box.right, width: box.width, height: box.height, viewportHeight: window.innerHeight, viewportWidth: window.innerWidth };
  });
}

/** What the person can actually reach: the top-most element at the focused control's
 * own corners. Two boxes overlapping means nothing on its own — a sheet paints above
 * the phone's bottom bar, so an intersection there is not an obscuring. */
async function focusedControlIsReachable(page: Page) {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el || el === document.body) return { drawn: false, onTop: false, blocked: "nothing is focused" };
    const box = el.getBoundingClientRect();
    const points: [number, number][] = [[box.left + 1, box.top + 1], [box.right - 1, box.top + 1], [box.left + 1, box.bottom - 1], [box.right - 1, box.bottom - 1], [(box.left + box.right) / 2, (box.top + box.bottom) / 2]];
    const label = (node: Element) => `${node.tagName.toLowerCase()}${node.className ? `.${String(node.className).split(" ")[0]}` : ""}`;
    const blocked = points.map((point) => document.elementFromPoint(point[0], point[1])).filter((hit): hit is Element => Boolean(hit) && hit !== el && !el.contains(hit) && !hit.contains(el)).map(label);
    return { drawn: box.width > 0 && box.height > 0, onTop: blocked.length === 0, blocked: Array.from(new Set(blocked)).join(", ") };
  });
}

/** A bottom sheet rises into place, so a measurement taken mid-flight measures the
 * animation rather than the layout. */
async function settle(page: Page) {
  await page.evaluate(async () => {
    await Promise.all(Array.from(document.getAnimations()).map((animation) => animation.finished.catch(() => undefined)));
  });
}

/** Tab until a named control is focused, the way a keyboard user has to. */
async function tabUntilFocused(page: Page, matcher: RegExp, maxStops = 30) {
  for (let index = 0; index < maxStops; index += 1) {
    await page.keyboard.press("Tab");
    const name = await page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return "";
      return el.getAttribute("aria-label")?.trim() || (el.textContent ?? "").replace(/\s+/g, " ").trim();
    });
    if (matcher.test(name)) return name;
  }
  return null;
}

test.describe("Stage 6 targeted accessibility qualification", () => {
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
    // The qualification needs a ledger with real controls in it, not an empty state,
    // so one client and one amount are added through the product's own forms.
    await page.getByLabel("Primary navigation").getByRole("button", { name: "Clients" }).click();
    await page.getByRole("button", { name: "Add client" }).click();
    const clientSheet = page.getByRole("dialog", { name: "Add client" });
    await clientSheet.getByLabel("Client name").fill(clientName);
    await page.getByRole("button", { name: "Save client" }).click();
    await expect(page.getByText(clientName).first()).toBeVisible();
    await page.locator(".page-header__actions button.button-primary").first().click();
    const receivable = page.getByRole("dialog", { name: "Add receivable" });
    await receivable.getByLabel("Search existing clients").fill(suffix);
    await receivable.getByRole("option", { name: new RegExp(clientName) }).click();
    await receivable.getByLabel("Amount").fill("4200");
    await receivable.getByLabel("What is this for?").fill(invoice);
    await receivable.getByRole("button", { name: "Save receivable" }).click();
    await expect(receivable).toBeHidden({ timeout: 20_000 });
    await page.close();
  });

  test("gives every visible control an accessible name on every section, at both shapes", async ({ page }) => {
    await signIn(page);
    for (const width of [1280, 390]) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });
      for (const section of [/^Today/, /^Receivables/, /^Clients/, /^More/]) {
        await goTo(page, section);
        await expect(page.locator(".app-content")).toBeVisible();
        const unnamed = await unnamedControls(page);
        expect(unnamed, `${width}px / ${section}: controls with no announced name`).toEqual([]);
      }
    }
  });

  test("marks every keyboard stop as focused, by name, across the whole page", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await signIn(page);
    await goTo(page, /^Receivables/);
    await page.locator("body").click({ position: { x: 2, y: 2 } });
    const stops: { name: string; ring: boolean; focusVisible: boolean }[] = [];
    for (let index = 0; index < 12; index += 1) {
      await page.keyboard.press("Tab");
      stops.push(await focusStop(page));
    }
    expect(stops.length).toBe(12);
    expect(stops.map((stop) => stop.name).join(" "), "a Tab walk must never land on nothing").not.toContain("<nothing>");
    for (const stop of stops) expect(stop.focusVisible, `"${stop.name}" received no :focus-visible match`).toBe(true);
    for (const stop of stops) expect(stop.ring, `"${stop.name}" has no visible focus ring`).toBe(true);
    // Traversal actually moves instead of sticking to one control.
    expect(new Set(stops.map((stop) => stop.name)).size).toBeGreaterThan(3);
  });

  test("opens a data-entry sheet on the field the person came for", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await signIn(page);
    await goTo(page, /^Clients/);
    const opener = page.getByRole("button", { name: "Add client" });
    await opener.click();
    const sheet = page.getByRole("dialog", { name: "Add client" });
    await expect(sheet).toBeVisible();
    await expect(sheet.getByLabel("Client name")).toBeFocused();
    const stop = await focusStop(page);
    expect(stop.name).toContain("Client name");
    expect(stop.focusVisible, "the first field must show its own focus mark").toBe(true);
    // The close control and the confirmation are both reachable, neither is pre-focused.
    await expect(sheet.getByRole("button", { name: "Close", exact: true })).not.toBeFocused();
    await expect(sheet.getByRole("button", { name: "Save client" })).not.toBeFocused();
  });

  test("holds a keyboard user inside an open sheet and hands focus back on the way out", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await signIn(page);
    await goTo(page, /^Clients/);
    const opener = page.getByRole("button", { name: "Add client" });
    await opener.click();
    const sheet = page.getByRole("dialog", { name: "Add client" });
    await expect(sheet.getByLabel("Client name")).toBeFocused();

    // Forward: whatever the walk, nothing may land outside the dialog, and the way out
    // has to be reachable by Tab alone.
    const forward: boolean[] = [];
    for (let index = 0; index < 16; index += 1) {
      await page.keyboard.press("Tab");
      forward.push(await page.evaluate(() => Boolean(document.activeElement?.closest(".sheet"))));
    }
    expect(forward.every(Boolean), "forward Tab left the sheet").toBe(true);

    // Backward from the first field has to wrap, not escape into the page behind.
    await sheet.getByLabel("Client name").focus();
    await page.keyboard.press("Shift+Tab");
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest(".sheet"))), "Shift+Tab escaped the sheet").toBe(true);

    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test("announces a refusal at the field it refuses, politely and with the field marked", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await signIn(page);
    await goTo(page, /^Clients/);
    await page.getByRole("button", { name: "Add client" }).click();
    const sheet = page.getByRole("dialog", { name: "Add client" });
    await expect(sheet.getByLabel("Client name")).toBeFocused();

    // Enter on an empty required field is a real way to try to save, and the answer
    // has to arrive where the field is being read, not only as a passing toast.
    await page.keyboard.press("Enter");
    const alert = page.getByRole("alert").filter({ hasText: "Add a client name before saving." });
    await expect(alert).toBeVisible();
    await expect(sheet.getByLabel("Client name")).toHaveAttribute("aria-invalid", "true");
    await expect(sheet).toBeVisible();
    // Correcting the field clears the refusal rather than leaving a stale warning up.
    await sheet.getByLabel("Client name").fill("Named Client");
    await expect(page.getByRole("alert").filter({ hasText: "Add a client name before saving." })).toHaveCount(0);
    await expect(sheet.getByLabel("Client name")).toHaveAttribute("aria-invalid", "false");
    await page.keyboard.press("Escape");
  });

  test("treats a saved result as an announcement, not a visual surprise", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    await signIn(page);
    await goTo(page, /^Clients/);
    await page.getByRole("button", { name: "Add client" }).click();
    const sheet = page.getByRole("dialog", { name: "Add client" });
    await sheet.getByLabel("Client name").fill(`Announced Client ${suffix}`);
    await sheet.getByRole("button", { name: "Save client" }).click();
    const live = page.getByRole("region", { name: /Notifications/ });
    // The carrier is a polite live region that only reveals itself through its items,
    // so what is measured is its semantics plus the announcement that arrives inside it.
    await expect(live.locator("li").filter({ hasText: "Client added" }).first()).toBeVisible();
    expect(await live.getAttribute("aria-live"), "a result must reach a screen reader").toBe("polite");
    expect(await live.getAttribute("aria-relevant")).toBe("additions text");
    expect(await live.getAttribute("aria-atomic")).toBe("false");
  });

  test("activates custom controls with Space and keeps focus clear of the phone chrome", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signIn(page);

    // The client-choice switch is a segmented control of the product's own making:
    // Space has to change the mode, and the mode has to be announced.
    await page.locator(".page-header__actions button.button-primary").click();
    const sheet = page.getByRole("dialog", { name: "Add receivable" });
    await expect(sheet).toBeVisible();
    const existing = sheet.getByRole("button", { name: "Existing client" });
    const newClient = sheet.getByRole("button", { name: "New client" });
    await expect(existing).toHaveAttribute("aria-pressed", "true");
    await newClient.focus();
    await page.keyboard.press("Space");
    await expect(newClient).toHaveAttribute("aria-pressed", "true");
    await expect(existing).toHaveAttribute("aria-pressed", "false");
    await expect(sheet.getByLabel("Client name")).toBeVisible();
    await expect(sheet.getByLabel("Search existing clients")).toHaveCount(0);

    // Tab to the end of the form the way a keyboard user must, then measure what they
    // actually get: the confirm action on screen, and not hidden behind other chrome.
    const reached = await tabUntilFocused(page, /^Save receivable/);
    expect(reached, "no amount of Tabbing reached the confirm action").toBe("Save receivable");
    await settle(page);
    const geometry = await focusedElementGeometry(page);
    expect(geometry, "the confirm control lost focus").not.toBeNull();
    expect(geometry!.bottom, "the confirm control is past the bottom of the screen").toBeLessThanOrEqual(geometry!.viewportHeight + 1);
    const reachable = await focusedControlIsReachable(page);
    expect(reachable.drawn, "the confirm control is not drawn").toBe(true);
    expect(reachable.onTop, `the confirm control is covered by ${reachable.blocked}`).toBe(true);
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
  });

  test("still marks the keyboard stop when the browser asks for reduced motion", async ({ page }) => {
    // The only accessibility behaviour that existed solely in a suite no gate ever ran:
    // e2e/accessibility-smoke.spec.ts is gated on a hosted E2E_EMAIL/E2E_PASSWORD pair,
    // so its reduced-motion walk has been reporting "skipped" for every stage of this
    // roadmap. PHASE 14 asks Stage 9 to retain the accepted Stage 6 coverage, and a
    // retained claim cannot rest on a test that always skips — so the walk now runs
    // against the local stack, in the suite CI already executes.
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.goto("/auth");
    const emailInput = page.getByLabel("Email address");
    await emailInput.focus();
    await expect(emailInput).toBeFocused();
    await expect.poll(() => emailInput.evaluate((element) => getComputedStyle(element).boxShadow)).not.toBe("none");
    await expect
      .poll(() => page.evaluate(() => Number.parseFloat(getComputedStyle(document.body).transitionDuration) * 1000))
      .toBeLessThanOrEqual(0.001);

    await signIn(page);
    await expect
      .poll(() => page.evaluate(() => Number.parseFloat(getComputedStyle(document.body).transitionDuration) * 1000))
      .toBeLessThanOrEqual(0.001);
    const action = page.locator(".page-header__actions button.button-primary").first();
    await action.focus();
    await expect(action).toBeFocused();
    await expect.poll(() => action.evaluate((element) => getComputedStyle(element).boxShadow)).not.toBe("none");
  });
});
