import { expect, test, type Page } from "@playwright/test";
import { todayInIndia } from "../client/src/lib/business-clock";
import { addIndiaBusinessDays } from "../client/src/lib/finance";
import { awaitLedger, completeWorkspaceSetup } from "./workspace-setup";

// Stage 6 Phases 30, 32 and 36 for the sheets the earlier specs had not reached.
// The rules these cases hold the product to are narrow: a form that refuses a
// submission says so where the person is looking, a sheet keeps keyboard focus and
// gives it back, a control that cannot be used is not a keyboard stop, and a toast
// stays long enough to read without ever being the only place a reason exists.
const localStackEnabled = process.env.STAGE6_LOCAL_E2E === "1";

const token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const account = {
  email: `stage6forms-${token}@dueweave.local`,
  password: `Stage6forms!${token}aA`,
  displayName: `Stage6 Forms Owner ${token.slice(-6)}`,
  businessName: `Stage6 Forms Studio ${token.slice(-6)}`,
};
const clientName = `Stage6 Forms Client ${token.slice(-6)}`;

// The withdrawal case below only has a control to press while the promise it made
// earlier is still graded ACTIVE: once the promised date passes with nothing paid, the
// product grades it BROKEN and the withdraw action disappears from the panel. So the
// date is derived from the business clock instead of frozen, and stays live on the day
// the run happens.
const activePromisedDate = addIndiaBusinessDays(todayInIndia(), 6);

async function signIn(page: Page) {
  await page.goto("/auth");
  const form = page.getByLabel("Email address");
  const ledger = page.locator(".app-shell");
  // The guard decides a moment after the document loads whether /auth shows the
  // form or hands an authenticated visitor to the ledger, so wait for that answer
  // instead of reading a URL captured mid-redirect.
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

function toastItems(page: Page) {
  return page.getByRole("region", { name: /Notifications/ }).locator("li");
}

async function openSheet(page: Page, title: string) {
  const sheet = page.getByRole("dialog", { name: title });
  await expect(sheet).toBeVisible();
  return sheet;
}

/** Where each Tab lands, and whether it is still inside the open sheet. */
async function tabWalk(page: Page, count: number) {
  const stops: { label: string; inSheet: boolean }[] = [];
  for (let index = 0; index < count; index += 1) {
    await page.keyboard.press("Tab");
    stops.push(await page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null;
      if (!element || element === document.body) return { label: "<none>", inSheet: false };
      const label = element.getAttribute("aria-label") || element.id || element.textContent?.trim() || element.tagName.toLowerCase();
      return { label: label.slice(0, 30), inSheet: element.closest(".sheet") !== null };
    }));
  }
  return stops;
}

const labelOf = (stop: { label: string }) => stop.label;

test.describe("Stage 6 forms, keyboard and toast lifetime", () => {
  test.skip(!localStackEnabled, "Set STAGE6_LOCAL_E2E=1 to run against the local Supabase stack.");
  test.describe.configure({ mode: "serial" });
  test.describe.configure({ timeout: 120_000 });

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
    await (await openSheet(page, "Add client")).getByLabel("Client name").fill(clientName);
    await page.getByRole("button", { name: "Save client" }).click();
    await expect(page.getByText(clientName).first()).toBeVisible();
    await page.close();
  });

  test("refuses an empty client name at the field instead of only in a toast", async ({ page }) => {
    await signIn(page);
    await page.getByLabel("Primary navigation").getByRole("button", { name: "Clients" }).click();
    await page.getByRole("button", { name: "Add client" }).click();
    const sheet = await openSheet(page, "Add client");
    await expect(sheet.getByLabel("Client name")).toBeFocused();

    await sheet.getByRole("button", { name: "Save client" }).click();
    await expect(sheet.getByRole("alert")).toContainText("Add a client name before saving.");
    await expect(sheet.getByLabel("Client name")).toHaveAttribute("aria-invalid", "true");
    const shown = (await toastItems(page).allInnerTexts()).join(" ");
    expect(shown, "a refusal must not live only in a toast").not.toContain("client name before saving");

    await sheet.getByLabel("Client name").fill("Stage6 Forms Second Client");
    await expect(sheet.getByRole("alert")).toHaveCount(0);
    await sheet.getByRole("button", { name: "Save client" }).click();
    await expect(sheet).toBeHidden();
    await expect(page.getByText("Stage6 Forms Second Client").first()).toBeVisible();
  });

  test("keeps a client name when a client is edited", async ({ page }) => {
    await signIn(page);
    await page.getByLabel("Primary navigation").getByRole("button", { name: "Clients" }).click();
    await page.getByRole("button", { name: /Edit client/ }).first().click();
    const sheet = await openSheet(page, "Edit client");
    await sheet.getByLabel("Client name").fill("");
    await sheet.getByRole("button", { name: "Save changes" }).click();
    await expect(sheet.getByRole("alert")).toContainText("Keep a client name before saving.");
    await expect(sheet.getByLabel("Client name")).toHaveAttribute("aria-invalid", "true");

    // Whatever was typed alongside the refusal stays put.
    await sheet.getByLabel("Company").fill("Stage6 Forms Company");
    await sheet.getByLabel("Client name").fill(`Stage6 Forms Renamed ${token.slice(-6)}`);
    await expect(sheet.getByRole("alert")).toHaveCount(0);
    await expect(sheet.getByLabel("Company")).toHaveValue("Stage6 Forms Company");
    await sheet.getByRole("button", { name: "Save changes" }).click();
    await expect(sheet).toBeHidden();
    await expect(page.getByText("Stage6 Forms Company").first()).toBeVisible();
  });

  test("puts every promise refusal on the field it belongs to", async ({ page }) => {
    await signIn(page);
    await page.getByLabel("Primary navigation").getByRole("button", { name: /^Today/ }).click();
    await page.locator(".page-header__actions button.button-primary").first().click();
    const add = await openSheet(page, "Add receivable");
    await add.getByLabel("Search existing clients").fill(token.slice(-6));
    await add.getByRole("option", { name: new RegExp(clientName) }).click();
    await add.getByLabel("Amount").fill("9000");
    await add.getByRole("button", { name: "Save receivable" }).click();
    await expect(add).toBeHidden();

    await page.getByRole("button", { name: /Record new promise/ }).click();
    const promise = await openSheet(page, "Record a new promise");
    await expect(promise.getByLabel("Promised amount")).toBeFocused();

    await promise.getByLabel("Promised amount").fill("25000");
    await promise.getByRole("button", { name: "Keep this promise" }).click();
    await expect(promise.getByRole("alert")).toContainText(["That is more than the ₹9,000 still outstanding."]);
    await expect(promise.getByLabel("Promised amount")).toHaveAttribute("aria-invalid", "true");

    await promise.getByLabel("Promised amount").fill("4000");
    await promise.getByLabel("Promised date").fill("2026-09-10");
    await promise.getByLabel("Promise made on").fill("2026-09-20");
    await promise.getByRole("button", { name: "Keep this promise" }).click();
    await expect(promise.getByRole("alert")).toContainText(["Promise date cannot be earlier than when the promise was made."]);
    await expect(promise.getByLabel("Promised date")).toHaveAttribute("aria-invalid", "true");

    await promise.getByLabel("Promise made on").fill("2999-01-01");
    await promise.getByLabel("Promised date").fill(activePromisedDate);
    await promise.getByRole("button", { name: "Keep this promise" }).click();
    await expect(promise.getByRole("alert")).toContainText(["A promise cannot be dated as made in the future."]);
    await expect(promise.getByLabel("Promise made on")).toHaveAttribute("aria-invalid", "true");

    await promise.getByLabel("Promise made on").fill("2026-09-24");
    await expect(promise.getByRole("alert")).toHaveCount(0);
    await promise.getByRole("button", { name: "Keep this promise" }).click();
    await expect(promise).toBeHidden();
    await expect(toastItems(page).filter({ hasText: "Promise added" })).toBeVisible();
  });

  test("keeps the withdraw reason and the snooze date honest inside their sheets", async ({ page }) => {
    await signIn(page);
    await page.getByLabel("Primary navigation").getByRole("button", { name: /^Today/ }).click();
    const trigger = page.getByRole("button", { name: /Withdraw active promise/ });
    await expect(trigger).toBeVisible();
    await trigger.click();
    const withdraw = await openSheet(page, "Withdraw this promise");
    await expect(withdraw.getByLabel("Why is it being withdrawn?")).toBeFocused();
    await withdraw.getByRole("button", { name: "Withdraw promise" }).click();
    await expect(withdraw.getByRole("alert")).toContainText("Add a short reason before withdrawing this promise.");
    await expect(withdraw.getByLabel("Why is it being withdrawn?")).toHaveAttribute("aria-invalid", "true");
    await withdraw.getByLabel("Why is it being withdrawn?").fill("Client asked to drop this date and will confirm a new one.");
    await expect(withdraw.getByRole("alert")).toHaveCount(0);
    await withdraw.getByRole("button", { name: "Withdraw promise" }).click();
    await expect(withdraw).toBeHidden();
    await expect(page.getByRole("button", { name: /Withdraw active promise/ })).toBeHidden();

    // Measured on this build: the withdrawal confirmation rests at [896,108,356,92] and the
    // first row action scrolls into view at [1173,166,34,34] — inside that band. A click
    // hit-tests the control's centre, so this one retried for the whole 4.5s success lifetime
    // (5552ms and 4547ms observed), and once the retrying pointer landed on the toast sonner
    // paused its dismiss (data-expanded false -> true) and the wait stopped being bounded:
    // 53 retries and a 120s timeout in the battery. Park the pointer clear of the stack and
    // let it drain first, which is what the accepted Stage 9 warnings suite already does.
    await page.mouse.move(0, 0);
    await expect(toastItems(page)).toHaveCount(0, { timeout: 10_000 });

    await page.getByRole("button", { name: "Snooze follow-up" }).first().click();
    const snooze = await openSheet(page, "Snooze follow-up");
    await snooze.getByLabel("Bring this back on").fill("2020-01-01");
    await snooze.getByRole("button", { name: "Save snooze" }).click();
    await expect(snooze.getByRole("alert")).toContainText("Choose today or a future date.");
    await expect(snooze.getByLabel("Bring this back on")).toHaveAttribute("aria-invalid", "true");
    // The valid half of this pair has to be a date the product's own rule accepts on
    // the day the run happens: "today" is that date forever, a literal is not.
    await snooze.getByLabel("Bring this back on").fill(todayInIndia());
    await expect(snooze.getByRole("alert")).toHaveCount(0);
    await snooze.getByRole("button", { name: "Save snooze" }).click();
    await expect(snooze).toBeHidden();
    await expect(toastItems(page).filter({ hasText: "Follow-up snoozed" })).toBeVisible();
  });

  test("refuses an empty receivable label at the field", async ({ page }) => {
    await signIn(page);
    await page.getByLabel("Primary navigation").getByRole("button", { name: /^Today/ }).click();
    await page.getByRole("button", { name: /Edit details/ }).click();
    const sheet = await openSheet(page, "Edit receivable details");
    await expect(sheet.getByLabel("What is this for?")).toBeFocused();
    await sheet.getByLabel("What is this for?").fill("");
    await sheet.getByRole("button", { name: "Save details" }).click();
    await expect(sheet.getByRole("alert")).toContainText("Keep a short label for this receivable.");
    await expect(sheet.getByLabel("What is this for?")).toHaveAttribute("aria-invalid", "true");
    await sheet.getByLabel("What is this for?").fill("Stage6 forms receivable");
    await expect(sheet.getByRole("alert")).toHaveCount(0);
    await sheet.getByRole("button", { name: "Save details" }).click();
    await expect(sheet).toBeHidden();
    await expect(page.getByText("Stage6 forms receivable").first()).toBeVisible();
  });

  test("holds the keyboard contract for Record payment", async ({ page }) => {
    await signIn(page);
    await page.getByLabel("Primary navigation").getByRole("button", { name: /^Today/ }).click();
    const trigger = page.getByRole("button", { name: "Record payment" }).first();
    await trigger.click();
    const sheet = await openSheet(page, "Record payment");
    const close = sheet.getByRole("button", { name: "Close" });
    const submit = sheet.getByRole("button", { name: "Record payment" });
    await expect(sheet.getByLabel("Amount")).toBeFocused();

    // Backward and forward wrapping both stay inside the sheet, and Close is one
    // keystroke away in either direction from the first field.
    await page.keyboard.press("Shift+Tab");
    await expect(close).toBeFocused();
    await page.keyboard.press("Shift+Tab");
    await expect(submit).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(close).toBeFocused();
    await expect(sheet.getByLabel("Amount")).toBeVisible();

    // Enough stops for a full cycle plus Chromium's internal segments inside the
    // date field: whatever the length, nothing may land outside the sheet, every
    // stop must be a real control, and Close must be reachable by Tab alone.
    const walk = await tabWalk(page, 16);
    expect(walk.every((stop) => stop.inSheet), `focus left the sheet: ${walk.map(labelOf).join(" | ")}`).toBe(true);
    expect(walk.map(labelOf).join(" "), "a Tab walk must never land on nothing").not.toContain("<none>");
    expect(walk.map(labelOf).join(" "), "a keyboard user must be able to leave a sheet").toContain("Close");

    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();
    await expect(trigger).toBeFocused();
  });

  test("takes a busy submit out of the keyboard order while the write is in flight", async ({ page }) => {
    await signIn(page);
    await page.getByLabel("Primary navigation").getByRole("button", { name: /^Today/ }).click();
    await page.getByRole("button", { name: "Record payment" }).first().click();
    const sheet = await openSheet(page, "Record payment");
    await sheet.getByLabel("Amount").fill("500");

    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => { release = resolve; });
    await page.route(/\/rest\/v1\/rpc\/record_payment/, async (route) => {
      await held;
      await route.continue();
    });
    await sheet.getByRole("button", { name: "Record payment" }).click();
    const submit = sheet.getByRole("button", { name: "Record payment" });
    await expect(submit).toBeDisabled();
    await expect(submit).toHaveAttribute("aria-busy", "true");
    await expect(sheet.getByLabel("Amount")).toHaveValue("500");

    // The control that cannot be used again is not a stop anywhere in a full cycle,
    // and the sheet's own Cancel and Close still are.
    await sheet.getByLabel("Amount").focus();
    const walk = await tabWalk(page, 12);
    expect(walk.map(labelOf).join(" "), `a busy submit must not be a stop: ${walk.map(labelOf).join(" | ")}`).not.toContain("Record payment");
    expect(walk.map(labelOf).join(" "), "Close must stay reachable while a write is in flight").toContain("Close");
    expect(walk.every((stop) => stop.inSheet), `focus left the sheet: ${walk.map(labelOf).join(" | ")}`).toBe(true);
    await expect(submit).toBeDisabled();

    release();
    await expect(sheet).toBeHidden({ timeout: 20_000 });
    await expect(toastItems(page).filter({ hasText: "Payment recorded" })).toBeVisible();
    await page.unroute(/\/rest\/v1\/rpc\/record_payment/);
  });

  test("keeps the founder-limit action clickable and lets an error outlive a success", async ({ page }) => {
    test.slow();
    await signIn(page);
    // The Free plan allows three active receivables, so the next write past that
    // ceiling is the product's own refusal with its action attached.
    let limited = false;
    for (let attempt = 1; attempt <= 5 && !limited; attempt += 1) {
      await page.locator("button.floating-add, .page-header__actions button.button-primary").first().click();
      const sheet = await openSheet(page, "Add receivable");
      await sheet.getByLabel("Search existing clients").fill(token.slice(-6));
      await sheet.getByRole("option", { name: new RegExp(clientName) }).click();
      await sheet.getByLabel("Amount").fill("1000");
      await sheet.getByLabel("What is this for?").fill(`Stage6 limit probe ${attempt}`);
      await sheet.getByRole("button", { name: "Save receivable" }).click();
      const refusal = toastItems(page).filter({ hasText: "Your Free plan limit is reached." });
      // Either outcome is legitimate until the ceiling is reached, and a success
      // toast can stack, so wait for the refusal itself rather than for "either".
      const reached = await refusal.waitFor({ state: "visible", timeout: 15_000 }).then(() => true).catch(() => false);
      if (!reached) {
        await expect(sheet).toBeHidden({ timeout: 15_000 });
        continue;
      }
      limited = true;
      const action = refusal.getByRole("button", { name: "View Founder" });
      await expect(action).toBeEnabled();
      // A refusal that disappears mid-read is the failure Phase 30 names: it has
      // to still be here, with its action pressable, after a success would have gone.
      await page.waitForTimeout(6_000);
      await expect(refusal).toBeVisible();
      await action.click();
      await expect(page).toHaveURL(/\/founder$/, { timeout: 15_000 });
    }
    expect(limited, "the Free plan ceiling was never reached, so the action toast was not exercised").toBe(true);
    await page.goto("/");
    await expect(page.getByLabel("Primary navigation")).toBeVisible();
  });

  test("does not leave a success toast sitting on the ledger", async ({ page }) => {
    await signIn(page);
    await page.getByLabel("Primary navigation").getByRole("button", { name: /^Today/ }).click();
    await page.getByRole("button", { name: "Snooze follow-up" }).first().click();
    const sheet = await openSheet(page, "Snooze follow-up");
    await sheet.getByRole("button", { name: "Save snooze" }).click();
    const success = toastItems(page).filter({ hasText: "Follow-up snoozed" });
    await expect(success).toBeVisible();
    await expect(success).toBeHidden({ timeout: 6_000 });
  });
});
