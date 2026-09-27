import { expect, test, type Page } from "@playwright/test";
import { awaitLedger, completeWorkspaceSetup } from "./workspace-setup";
import { problemsFound, startProblemWatch, type ProblemWatch } from "./problem-watch";

// Stage 6 Phases 21-28 and 48: the journey a real first user takes after the
// workspace exists — add the money, find it again, settle it or close it, change
// what the ledger is called, and make the screen feel like yours. Every record here
// is created through the product's own forms; nothing is written to the database
// from the test, and these tests deliberately run in order against one account so
// that later cases read what earlier cases saved.
const localStackEnabled = process.env.STAGE6_LOCAL_E2E === "1";

const token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const account = {
  email: `stage6first-${token}@dueweave.local`,
  password: `Stage6first!${token}aA`,
  displayName: `Stage6 First Owner ${token.slice(-6)}`,
  businessName: `Stage6 First Studio ${token.slice(-6)}`,
};
const studioClient = `Anita Dey ${token.slice(-6)}`;
const studioCompany = `Dey Films ${token.slice(-6)}`;
const secondClient = `Ravi Couture ${token.slice(-6)}`;
const firstInvoice = `Brand film ${token.slice(-6)}`;
const secondInvoice = `Retainer ${token.slice(-6)}`;
const invoiceRef = `INV-${token.slice(-5, -1)}`;

async function signIn(page: Page) {
  await page.goto("/auth");
  await page.getByLabel("Email address").fill(account.email);
  await page.getByLabel("Password").fill(account.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 20_000 });
  await awaitLedger(page);
}

async function openReceivables(page: Page) {
  await page.getByLabel("Primary navigation").getByRole("button", { name: "Receivables" }).click();
  await expect(page.getByRole("heading", { name: "Receivables, without the accounting drag." })).toBeVisible();
}

function filterTab(page: Page, name: string) {
  return page.getByRole("tab", { name: new RegExp(`^${name}`) });
}

/** One row of the receivable list, found by the text inside it. */
function receivableCard(page: Page, text: string) {
  return page.locator("button.receivable-list-card").filter({ hasText: text });
}

function tabCount(page: Page, name: string) {
  return filterTab(page, name).locator("span");
}

/** A success toast and the timeline entry it just created say the same thing on purpose. */
function toast(page: Page, title: string) {
  return page.getByRole("region", { name: /Notifications/ }).getByText(title, { exact: true });
}

test.describe("Stage 6 first-user journey", () => {
  test.skip(!localStackEnabled, "Set STAGE6_LOCAL_E2E=1 to run against the local Supabase stack.");
  test.describe.configure({ mode: "serial" });
  test.describe.configure({ timeout: 120_000 });

  // Phase 54: arriving at the right screen is only half of a clean journey — nothing
  // along the way may have thrown, warned, or gone unanswered. A worker runs one test
  // at a time, so this holder always belongs to the page the current test is driving.
  let watch: ProblemWatch;
  test.beforeEach(async ({ page }) => {
    watch = startProblemWatch(page);
  });
  test.afterEach(() => {
    expect(problemsFound(watch)).toEqual([]);
  });

  test("adds the first two amounts the two ways a first user can", async ({ page }) => {
    await page.goto("/auth");
    await page.getByRole("button", { name: "Create an account" }).click();
    await page.getByLabel("Your name").fill(account.displayName);
    await page.getByLabel("Email address").fill(account.email);
    await page.getByLabel("Password").fill(account.password);
    await page.getByRole("button", { name: "Create my workspace" }).click();
    await completeWorkspaceSetup(page, account);

    // Path one: the empty state's own button, creating the client and the amount
    // together through the real form.
    await page.getByRole("button", { name: "Add first receivable" }).click();
    const together = page.getByRole("dialog", { name: "Add receivable" });
    await expect(together.getByRole("button", { name: "New client" })).toBeVisible();
    await together.getByLabel("Client name").fill(studioClient);
    await together.getByLabel("Company").fill(studioCompany);
    await together.getByLabel("Amount").fill("28000");
    await together.getByLabel("Due date").fill("2026-10-20");
    await together.getByLabel("What is this for?").fill(firstInvoice);
    await together.getByLabel("Invoice or reference").fill(invoiceRef);
    await together.getByRole("button", { name: "Save receivable" }).click();
    await expect(toast(page, "Receivable added")).toBeVisible();
    // The company shows both on the queue card and in the selected-receivable panel.
    await expect(page.getByText(studioCompany).first()).toBeVisible();

    // Path two: the client already exists, so the amount is attached to them.
    await page.getByRole("button", { name: "Add receivable" }).first().click();
    const attached = page.getByRole("dialog", { name: "Add receivable" });
    await attached.getByRole("button", { name: "Existing client" }).click();
    await attached.getByLabel("Search existing clients").fill(token.slice(-6));
    await attached.getByRole("option", { name: new RegExp(studioClient) }).click();
    await attached.getByLabel("Amount").fill("9000");
    await attached.getByLabel("What is this for?").fill(secondInvoice);
    await attached.getByRole("button", { name: "Save receivable" }).click();

    await openReceivables(page);
    await expect(page.getByText(firstInvoice)).toBeVisible();
    await expect(page.getByText(secondInvoice)).toBeVisible();
    await expect(tabCount(page, "All history")).toHaveText("2");
  });

  test("finds an amount from a partial, untidy search across people and papers", async ({ page }) => {
    await signIn(page);
    await openReceivables(page);
    const search = page.getByLabel("Search receivables");

    // The label in the wrong case with stray spaces still finds the row.
    await search.fill(`   ${firstInvoice.toUpperCase()}  `);
    await expect(page.getByText(firstInvoice)).toBeVisible();
    await expect(page.getByText(secondInvoice)).toHaveCount(0);

    // So does the invoice reference, in lower case, and the client's own company.
    await search.fill(invoiceRef.toLowerCase());
    await expect(page.getByText(firstInvoice)).toBeVisible();
    await search.fill(studioCompany.slice(0, 9));
    await expect(page.getByText(firstInvoice)).toBeVisible();
    await expect(page.getByText(secondInvoice)).toBeVisible();

    await search.fill("retainer");
    await expect(page.getByText(secondInvoice)).toBeVisible();
    await expect(page.getByText(firstInvoice)).toHaveCount(0);

    await search.fill("nothing like this " + token);
    await expect(page.getByRole("heading", { name: "No matches in this view." })).toBeVisible();
    await expect(page.getByText(`Nothing in open matches “nothing like this ${token}”.`)).toBeVisible();
    await page.getByRole("button", { name: "Clear search" }).click();
    await expect(search).toHaveValue("");
    await expect(page.getByText(firstInvoice)).toBeVisible();

    // Search composes with the status filter rather than overriding it.
    await filterTab(page, "All history").click();
    await search.fill(studioCompany);
    await filterTab(page, "Paid").click();
    await expect(page.getByRole("heading", { name: "No matches in this view." })).toBeVisible();
    await expect(page.getByText(`Nothing in paid matches “${studioCompany}”.`)).toBeVisible();
    await page.getByRole("button", { name: "Clear search" }).click();
    await expect(tabCount(page, "Paid")).toHaveText("0");
    await expect(tabCount(page, "All history")).toHaveText("2");
  });

  test("keeps open, paid, cancelled and all truthful about what each contains", async ({ page }) => {
    await signIn(page);
    await openReceivables(page);
    await expect(tabCount(page, "Open")).toHaveText("2");
    await expect(tabCount(page, "Cancelled")).toHaveText("0");

    // Settling the smaller amount moves it out of Open and into Paid.
    await page.getByLabel("Search receivables").fill(secondInvoice);
    await receivableCard(page, secondInvoice).click();
    await expect(page).toHaveURL(/\/$/);
    const payment = page.getByRole("dialog", { name: "Record payment" });
    await page.getByRole("button", { name: "Record payment" }).click();
    await payment.getByLabel("Amount").fill("9000");
    await payment.getByRole("button", { name: "Record payment" }).click();
    await expect(page.getByRole("region", { name: /Notifications/ }).getByText("Payment recorded", { exact: true })).toBeVisible();

    await openReceivables(page);
    await expect(tabCount(page, "Open")).toHaveText("1");
    await expect(tabCount(page, "Paid")).toHaveText("1");
    await filterTab(page, "Paid").click();
    await expect(page.getByText(secondInvoice)).toBeVisible();
    await expect(page.getByText(firstInvoice)).toHaveCount(0);

    // Closing the withdrawn invoice must not make it look deleted, and must not
    // count it as paid: it has its own place.
    await filterTab(page, "Open").click();
    await page.getByLabel("Search receivables").fill(firstInvoice);
    await receivableCard(page, firstInvoice).click();
    await page.getByRole("button", { name: /Close this receivable/ }).click();
    const close = page.getByRole("dialog", { name: "Close this receivable" });
    await close.getByLabel(/Why is it being closed/).fill("The client settled it outside DueWeave.");
    await close.getByRole("button", { name: "Close receivable" }).click();
    await expect(page.getByRole("region", { name: /Notifications/ }).getByText("Receivable closed", { exact: true })).toBeVisible();

    await openReceivables(page);
    await page.getByLabel("Search receivables").fill(firstInvoice);
    await expect(tabCount(page, "Open")).toHaveText("0");
    await expect(tabCount(page, "Paid")).toHaveText("1");
    await expect(tabCount(page, "Cancelled")).toHaveText("1");
    await filterTab(page, "Cancelled").click();
    await expect(page.getByText(firstInvoice)).toBeVisible();
    expect(Number(await tabCount(page, "Open").innerText()) + Number(await tabCount(page, "Paid").innerText()) + Number(await tabCount(page, "Cancelled").innerText())).toBe(2);
  });

  test("searches clients without ever showing one the search hid", async ({ page }) => {
    await signIn(page);
    await page.getByLabel("Primary navigation").getByRole("button", { name: "Clients" }).click();
    await page.getByRole("button", { name: /Add client/ }).first().click();
    const sheet = page.getByRole("dialog", { name: "Add client" });
    await sheet.getByLabel("Client name").fill(secondClient);
    await sheet.getByLabel("Company").fill("Couture House");
    await sheet.getByLabel("Email").fill(`ravi.${token.slice(-6)}@example.test`);
    await sheet.getByRole("button", { name: "Save client" }).click();
    await expect(page.getByRole("region", { name: /Notifications/ }).getByText("Client added", { exact: true })).toBeVisible();

    const search = page.getByLabel("Search clients");
    await search.fill("couture house");
    await expect(page.getByRole("button", { name: /Couture House/ }).first()).toBeVisible();
    await expect(page.getByText(studioCompany)).toHaveCount(0);
    // The detail panel follows the visible list instead of quietly keeping the old pick.
    await expect(page.getByRole("heading", { name: secondClient })).toBeVisible();

    await search.fill("email only " + token.slice(-6));
    await expect(search).toBeVisible();
    await page.getByRole("button", { name: "Clear search" }).click();
    await expect(search).toHaveValue("");
    await expect(page.getByText(studioCompany)).toBeVisible();

    await search.fill("nobody here at all");
    await expect(page.getByRole("heading", { name: "No client matches that search." })).toBeVisible();
    await expect(page.getByRole("button", { name: /Couture House/ })).toHaveCount(0);
    await page.getByRole("button", { name: "Clear search" }).click();
    await expect(page.getByText(studioCompany)).toBeVisible();
  });

  test("saves the two workspace names so every device sees them", async ({ page }) => {
    await signIn(page);
    await page.getByLabel("Primary navigation").getByRole("button", { name: "More" }).click();
    await page.getByRole("button", { name: /Edit your name and workspace name/ }).click();

    const sheet = page.getByRole("dialog", { name: "Edit workspace profile" });
    await sheet.getByLabel("Your name").fill("Renamed Owner");
    await sheet.getByLabel("Business or workspace name").fill("Renamed Studio " + token.slice(-6));
    await expect(sheet.getByText("Indian rupee · INR")).toBeVisible();
    await expect(sheet.getByText("India · Asia/Kolkata")).toBeVisible();
    await sheet.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("region", { name: /Notifications/ }).getByText("Workspace details saved", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Primary navigation").getByText("Renamed Studio " + token.slice(-6))).toBeVisible();

    await page.reload();
    await expect(page.getByLabel("Primary navigation").getByText("Renamed Studio " + token.slice(-6))).toBeVisible();

    // A second browser for the same account is the only proof that the answer is on
    // the row, not in this device's memory.
    const elsewhere = await page.context().browser()!.newContext();
    const other = await elsewhere.newPage();
    await other.goto("/auth");
    await other.getByLabel("Email address").fill(account.email);
    await other.getByLabel("Password").fill(account.password);
    await other.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(other).toHaveURL(/\/$/, { timeout: 20_000 });
    await expect(other.getByLabel("Primary navigation").getByText("Renamed Studio " + token.slice(-6))).toBeVisible();
    await expect(other.getByRole("heading", { name: "Set up your private ledger." })).toHaveCount(0);
    await elsewhere.close();

    await page.getByLabel("Primary navigation").getByRole("button", { name: "More" }).click();
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/auth$/, { timeout: 15_000 });

    // Back in, the names are still the stored ones and the profile is still the only
    // place they live: this browser holds a session and a theme, nothing else.
    await signIn(page);
    await expect(page.getByLabel("Primary navigation").getByText("Renamed Studio " + token.slice(-6))).toBeVisible();
    const keys = await page.evaluate(() => Object.keys(window.localStorage));
    expect(keys.filter((key) => key.startsWith("sb-"))).toHaveLength(1);
    expect(keys.filter((key) => !/^sb-[\w.-]*auth-token$|^dueweave-theme$/.test(key))).toEqual([]);
    expect(keys.some((key) => /profile|display|business|client|receivable/i.test(key))).toBe(false);
  });

  test("refuses an older profile edit instead of overwriting the newer one", async ({ browser }) => {
    const first = await browser.newContext();
    const pageA = await first.newPage();
    await signIn(pageA);
    await pageA.getByLabel("Primary navigation").getByRole("button", { name: "More" }).click();
    await pageA.getByRole("button", { name: /Edit your name and workspace name/ }).click();
    await pageA.getByRole("dialog", { name: "Edit workspace profile" }).getByLabel("Business or workspace name").fill("Slower Studio " + token.slice(-6));

    // Another device saves first, so the row A is editing has moved on underneath it.
    const second = await browser.newContext();
    const pageB = await second.newPage();
    await signIn(pageB);
    await pageB.getByLabel("Primary navigation").getByRole("button", { name: "More" }).click();
    await pageB.getByRole("button", { name: /Edit your name and workspace name/ }).click();
    await pageB.getByRole("dialog", { name: "Edit workspace profile" }).getByLabel("Business or workspace name").fill("Faster Studio " + token.slice(-6));
    await pageB.getByRole("button", { name: "Save changes" }).click();
    await expect(pageB.getByLabel("Primary navigation").getByText("Faster Studio " + token.slice(-6))).toBeVisible();

    await pageA.getByRole("button", { name: "Save changes" }).click();
    await expect(pageA.getByRole("alert")).toHaveText(/changed while you were editing/i);
    await expect(pageA.getByRole("dialog", { name: "Edit workspace profile" })).toBeVisible();
    await expect(pageA.getByLabel("Business or workspace name")).toHaveValue("Slower Studio " + token.slice(-6));

    // The newer answer is what the account holds.
    await pageB.reload();
    await expect(pageB.getByLabel("Primary navigation").getByText("Faster Studio " + token.slice(-6))).toBeVisible();
    await first.close();
    await second.close();
  });

  test("keeps one theme choice across a reload and a login, with no ledger data on the device", async ({ page }) => {
    await signIn(page);
    await page.getByLabel("Primary navigation").getByRole("button", { name: "More" }).click();
    await page.getByRole("button", { name: /Light mode/ }).click();
    await expect(page.locator(".app-shell--dark")).toBeVisible();
    await expect(page.getByText("Dark mode")).toBeVisible();

    await page.reload();
    await expect(page.locator(".app-shell--dark")).toBeVisible();

    const stored = await page.evaluate(() => ({
      keys: Object.keys(window.localStorage),
      value: window.localStorage.getItem("dueweave-theme"),
      entries: Object.entries(window.localStorage).filter(([key]) => !key.startsWith("sb-")),
    }));
    expect(stored.value).toBe("dark");
    // The only non-sensitive preference is the theme; the session token is Supabase's
    // own, and no client, amount, or profile text is kept on this device.
    expect(stored.entries.map(([key]) => key)).toEqual(["dueweave-theme"]);
    expect(stored.entries.every(([, value]) => !value.includes(studioCompany) && !value.includes(firstInvoice))).toBe(true);

    await page.getByLabel("Primary navigation").getByRole("button", { name: "More" }).click();
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/auth$/, { timeout: 15_000 });
    await signIn(page);
    await expect(page.locator(".app-shell--dark")).toBeVisible();
  });
});
