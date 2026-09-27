import { expect, test, type Page } from "@playwright/test";
import { awaitLedger, completeWorkspaceSetup } from "./workspace-setup";
import { problemsFound, startProblemWatch, type ProblemWatch } from "./problem-watch";

// Stage 6 Phases 41, 43 and 44: what a person sees while a write is happening, when
// a destructive action is refused by the server rather than by a form, and when the
// session ends somewhere else. Everything here goes through the real UI against the
// local stack — no database writes from the test, no fabricated responses.
const localStackEnabled = process.env.STAGE6_LOCAL_E2E === "1";

const token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const suffix = token.slice(-6);
const account = {
  email: `stage6writes-${suffix}@dueweave.local`,
  password: `Stage6writes!${suffix}aA`,
  displayName: `Stage6 Writes Owner ${suffix}`,
  businessName: `Stage6 Writes Studio ${suffix}`,
};
const clientName = `Stage6 Writes Client ${suffix}`;
const payable = `Stage6 payable ${suffix}`;
const cancellable = `Stage6 cancellable ${suffix}`;
const retryable = `Stage6 retryable ${suffix}`;

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

function toastItems(page: Page) {
  return page.getByRole("region", { name: /Notifications/ }).locator("li");
}

async function openSheet(page: Page, title: string) {
  const sheet = page.getByRole("dialog", { name: title });
  await expect(sheet).toBeVisible({ timeout: 10_000 });
  return sheet;
}

async function selectReceivable(page: Page, amount: string, title: string) {
  await page.getByLabel("Primary navigation").getByRole("button", { name: /^Today/ }).click();
  // The queue card names the client, and both amounts belong to the same client, so
  // the figure is what tells the two cards apart.
  await page.getByRole("button", { name: new RegExp(`Open details for [^,]*, ${amount} outstanding`) }).click();
  await expect(page.locator(".detail-amount").getByText(title)).toBeVisible();
}

/** Adds a receivable for the seeded client through the sheet a first user would use. */
async function addReceivable(page: Page, title: string, amount: string) {
  await page.locator(".page-header__actions button.button-primary").first().click();
  const sheet = await openSheet(page, "Add receivable");
  await sheet.getByLabel("Search existing clients").fill(clientName);
  await sheet.getByRole("option", { name: new RegExp(clientName) }).click();
  await sheet.getByLabel("Amount").fill(amount);
  await sheet.getByLabel("What is this for?").fill(title);
  await sheet.getByRole("button", { name: "Save receivable" }).click();
  await expect(sheet).toBeHidden({ timeout: 15_000 });
}

test.describe("Stage 6 writes, refusals and the end of a session", () => {
  test.skip(!localStackEnabled, "Set STAGE6_LOCAL_E2E=1 to run against the local Supabase stack.");
  test.describe.configure({ mode: "serial" });
  test.describe.configure({ timeout: 180_000 });

  // Phase 54: two requests in this file are broken deliberately, and each one *is* the
  // point of its case — the close the database refuses (HTTP 400, logged by Chromium
  // against /rpc/cancel_receivable) and the payment write whose answer never arrives.
  // Nothing else is excused: an unexpected console error, thrown render or unanswered
  // request still fails the run.
  const deliberateFailures = /\/rest\/v1\/rpc\/(cancel_receivable|record_payment)/;
  let watch: ProblemWatch;
  test.beforeEach(async ({ page }) => {
    watch = startProblemWatch(page);
  });
  test.afterEach(() => {
    expect(problemsFound(watch, deliberateFailures)).toEqual([]);
  });

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
    await addReceivable(page, payable, "5000");
    await addReceivable(page, cancellable, "2000");
    // Left untouched by every other case here, so the money this one writes can only
    // have come from this test.
    await addReceivable(page, retryable, "2400");
    await page.close();
  });

  test("keeps the screen, the money and the selection honest through one payment", async ({ page }) => {
    await signIn(page);
    await selectReceivable(page, "₹5,000", payable);
    await page.getByRole("button", { name: "Record payment" }).first().click();
    const sheet = await openSheet(page, "Record payment");
    const submit = sheet.getByRole("button", { name: "Record payment" });
    await sheet.getByLabel("Amount").fill("1500");

    let writes = 0;
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => { release = resolve; });
    await page.route(/\/rest\/v1\/rpc\/record_payment/, async (route) => {
      writes += 1;
      await held;
      await route.continue();
    });

    await submit.dblclick();
    await expect(submit).toBeDisabled();
    await expect(submit).toHaveAttribute("aria-busy", "true");
    // The workspace a person was reading stays readable while the write is on the
    // wire: no full-screen skeleton, and the typed figure is not lost.
    await expect(page.getByRole("heading", { name: "Today", exact: true })).toBeVisible();
    await expect(page.locator(".detail-panel")).toBeVisible();
    expect(writes, `a double click issued ${writes} writes`).toBe(1);

    release();
    await expect(sheet).toBeHidden({ timeout: 20_000 });
    await expect(toastItems(page).filter({ hasText: "Payment recorded" })).toBeVisible();
    // What appears afterwards is the server's figure, not a hopeful local one.
    await expect(page.locator(".detail-amount strong")).toHaveText("₹3,500");
    await expect(page.getByText(payable).first()).toBeVisible();
    // Closing the sheet hands focus back to the control that opened it.
    await expect(page.getByRole("button", { name: "Record payment" }).first()).toBeFocused();
    await page.unroute(/\/rest\/v1\/rpc\/record_payment/);
  });

  test("stops offering a close once money has arrived, and says why", async ({ page }) => {
    await signIn(page);
    await selectReceivable(page, "₹3,500", payable);
    await expect(page.locator(".detail-amount strong")).toHaveText("₹3,500");
    await expect(page.getByRole("button", { name: /Close this receivable/ })).toHaveCount(0);
    // The amount is still very much open, so the actions that remain are the true ones.
    await expect(page.getByRole("button", { name: "Record payment" }).first()).toBeEnabled();

    await selectReceivable(page, "₹2,000", cancellable);
    await expect(page.getByRole("button", { name: /Close this receivable/ })).toBeVisible();
  });

  test("refuses a stale close with the product's own words and keeps the sheet usable", async ({ page, context }) => {
    await signIn(page);
    await selectReceivable(page, "₹2,000", cancellable);
    await page.getByRole("button", { name: /Close this receivable/ }).click();
    const sheet = await openSheet(page, "Close this receivable");
    const reason = sheet.getByLabel(/Why is it being closed/);
    await reason.fill("Settled by the client in cash last week.");

    // A second window on the same account closes it first, so this sheet is now
    // working from a picture of the ledger that is no longer true.
    const other = await context.newPage();
    await other.goto("/");
    await expect(other.locator(".app-shell")).toBeVisible();
    await selectReceivable(other, "₹2,000", cancellable);
    await other.getByRole("button", { name: /Close this receivable/ }).click();
    const earlier = await openSheet(other, "Close this receivable");
    await earlier.getByLabel(/Why is it being closed/).fill("Closed from the other window first.");
    await earlier.getByRole("button", { name: "Close receivable" }).click();
    await expect(earlier).toBeHidden({ timeout: 20_000 });
    await other.close();

    await sheet.getByRole("button", { name: "Close receivable" }).click();
    const refusal = toastItems(page).filter({ hasText: "Could not close receivable" });
    await expect(refusal).toBeVisible({ timeout: 20_000 });
    const shown = (await refusal.allInnerTexts()).join(" ");
    expect(shown).toContain("This receivable is already closed.");
    expect(shown, "a refusal must not read as a database report").not.toMatch(/PGRST|23505|42501|duplicate|constraint|policy|rpc/i);
    // Nothing is thrown away by the refusal: the sheet and the reason in it remain.
    await expect(sheet).toBeVisible();
    await expect(reason).toHaveValue("Settled by the client in cash last week.");
    await sheet.getByRole("button", { name: "Close", exact: true }).click();
    await expect(sheet).toBeHidden();
  });

  test("takes the ledger with the session when it ends in another window", async ({ page, context }) => {
    await signIn(page);
    await selectReceivable(page, "₹3,500", payable);
    const other = await context.newPage();
    await other.goto("/");
    await expect(other.locator(".app-shell")).toBeVisible();
    await other.getByRole("button", { name: "More" }).filter({ visible: true }).first().click();
    await other.getByRole("button", { name: "Sign out" }).click();
    await expect(other.getByLabel("Email address")).toBeVisible({ timeout: 20_000 });

    // The window still open has to notice the session is gone rather than keep
    // showing private amounts, and must not stall on repeated failures.
    await expect(page).toHaveURL(/\/auth$/, { timeout: 20_000 });
    await expect(page.getByLabel("Email address")).toBeVisible();
    await expect(page.locator(".app-shell")).toHaveCount(0);
    await expect(page.getByText(clientName)).toHaveCount(0);
    await expect(page.getByText(payable)).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "We could not reach DueWeave" })).toHaveCount(0);
    await other.close();

    // Signing in again returns the same ledger, untouched by the window that lost it.
    await page.getByLabel("Email address").fill(account.email);
    await page.getByLabel("Password").fill(account.password);
    await page.locator("button.auth-submit").click();
    await expect(page).toHaveURL(/\/$/, { timeout: 20_000 });
    await selectReceivable(page, "₹3,500", payable);
    await expect(page.locator(".detail-amount strong")).toHaveText("₹3,500");
  });

  test("keeps a typed payment through a lost connection and books it once on retry", async ({ page }) => {
    await signIn(page);
    await selectReceivable(page, "₹2,400", retryable);
    await page.getByRole("button", { name: "Record payment" }).first().click();
    const sheet = await openSheet(page, "Record payment");
    const amount = sheet.getByLabel("Amount");
    const reference = sheet.getByLabel("Reference");
    await amount.fill("600");
    await reference.fill(`UTR ${suffix}`);

    const requestIds: string[] = [];
    let attempts = 0;
    await page.route(/\/rest\/v1\/rpc\/record_payment/, async (route) => {
      attempts += 1;
      const body = route.request().postDataJSON() as { p_request_id?: string };
      requestIds.push(String(body.p_request_id));
      if (attempts === 1) {
        await route.abort();
        return;
      }
      await route.continue();
    });

    const submit = sheet.getByRole("button", { name: "Record payment" });
    await submit.click();
    const failure = toastItems(page).filter({ hasText: "Could not record payment" });
    await expect(failure).toBeVisible({ timeout: 20_000 });
    const shown = (await failure.allInnerTexts()).join(" ");
    expect(shown).toMatch(/could not reach dueweave/i);
    expect(shown, "a dropped connection is not the reader's problem to decode").not.toMatch(/fetch|PGRST|TypeError|net::|constraint|policy/i);

    // The failure loses nothing: the same sheet, the same figures, still submittable,
    // and the ledger the server holds has not moved.
    await expect(sheet).toBeVisible();
    await expect(amount).toHaveValue("600");
    await expect(reference).toHaveValue(`UTR ${suffix}`);
    await expect(submit).toBeEnabled();
    await expect(submit).toHaveAttribute("aria-busy", "false");
    await expect(page.locator(".detail-amount strong")).toHaveText("₹2,400");
    const paymentEntries = page.locator(".timeline-item").filter({ hasText: "Payment recorded" });
    await expect(paymentEntries).toHaveCount(0);

    await submit.click();
    await expect(sheet).toBeHidden({ timeout: 20_000 });
    await expect(toastItems(page).filter({ hasText: "Payment recorded" })).toBeVisible();
    await expect(page.locator(".detail-amount strong")).toHaveText("₹1,800");

    expect(attempts, "the failure and its retry are the only two requests").toBe(2);
    // The retry carries the same request id, which is what lets the database answer
    // with the original receipt if the first attempt had in fact landed.
    expect(new Set(requestIds).size, "a retry must not become a second payment").toBe(1);
    // The server's own history is the last word: one entry, and it never reports a
    // figure the ledger did not give it.
    await expect(paymentEntries).toHaveCount(1);
    expect(await paymentEntries.innerText()).not.toMatch(/₹0/);
    await page.unroute(/\/rest\/v1\/rpc\/record_payment/);
  });
});
