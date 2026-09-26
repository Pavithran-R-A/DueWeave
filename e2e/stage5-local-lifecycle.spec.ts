import { expect, test, type BrowserContext, type Page } from "@playwright/test";

// DUEWEAVE CURRENT ROADMAP STAGE 5 — the money and promise lifecycle a customer
// can watch happen.
//
// Qualified against the repository's own local Supabase Docker stack only. Run
// with STAGE5_LOCAL_E2E=1 after `pnpm supabase:start`, a local db reset, and a
// build served at http://127.0.0.1:3000.
//
// Every record below is created by typing into the app's own sheets: no
// E2E_EMAIL/E2E_PASSWORD fixture, no service-role key, no direct database
// insert, and no React state inspected. The passed deadlines are reached by
// recording a promise whose date has already gone — the same correction a person
// makes when catching up their records — so no production "set the date" surface
// exists, and none is needed.
const localStackEnabled = process.env.STAGE5_LOCAL_E2E === "1";

// The two journeys below are narratives: the second half of the money story is
// only meaningful after the first half happened, on one signed-in page. Playwright's
// default parallelism hands each test its own worker, and a worker runs
// `beforeAll` for itself — so the same "one workspace" story silently became four
// workspaces with three unrelated ledgers each, and every cross-test assertion
// read somebody else's data. Serial mode is what makes the narrative real.

/** The India business date `offset` days from today, in the form the date inputs take. */
function businessDate(offset: number) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(Date.now() + offset * 86_400_000);
  const part = (kind: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === kind)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

const today = businessDate(0);
const yesterday = businessDate(-1);

type Account = {
  displayName: string;
  email: string;
  password: string;
  token: string;
  clientName: string;
  company: string;
};

function newAccount(role: string): Account {
  const token = `${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 6)}`;
  return {
    displayName: `Stage5 ${role} Ledger`,
    email: `stage5-e2e-${role}-${token}@dueweave.local`,
    password: `Stage5-browser-${token}!`,
    token,
    clientName: `Stage5 ${role} contact ${token}`,
    company: `Stage5 ${role} studio ${token}`,
  };
}

async function signUp(page: Page, account: Account) {
  await page.goto("/auth");
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Your name").fill(account.displayName);
  await page.getByLabel("Email address").fill(account.email);
  await page.getByLabel("Password").fill(account.password);
  await page.getByRole("button", { name: "Create my workspace" }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "Make the next conversation easier." })).toBeVisible();
}

async function addClient(page: Page, account: Account) {
  await page.getByRole("button", { name: /Add a client first|Add client$/ }).first().click();
  await expect(page.getByText("A client can come first.")).toBeVisible();
  await page.getByLabel("Client name").fill(account.clientName);
  await page.getByLabel("Company").fill(account.company);
  await page.getByRole("button", { name: "Save client" }).click();
  await expect(toast(page, "Client added")).toBeVisible();
  await clearToasts(page);
}

async function addReceivable(page: Page, account: Account, label: string, amountRupees: string, dueDate: string) {
  await page.getByRole("button", { name: "Add receivable" }).first().click();
  await page.getByRole("button", { name: "Existing client" }).click();
  await page.getByLabel("Search existing clients").fill(account.token);
  await page.getByRole("option", { name: new RegExp(account.token) }).click();
  await page.getByLabel("Amount").fill(amountRupees);
  await page.getByLabel("Due date").fill(dueDate);
  await page.getByLabel("What is this for?").fill(label);
  await page.getByRole("button", { name: "Save receivable" }).click();
  await expect(toast(page, "Receivable added")).toBeVisible();
  await clearToasts(page);
}

/**
 * Record a promise through the sheet. `madeOn` is left out of most calls on
 * purpose: the form has to open on the day the ledger is standing in, and the
 * only origin a normal entry can have is the one the person sees and accepts.
 * Where a date IS passed, the field is typed into — a historical entry, the case
 * the whole repair exists to make possible.
 */
async function recordPromise(page: Page, input: { amountRupees: string; promisedDate: string; source: string; note: string; madeOn?: string }) {
  await page.getByRole("button", { name: /Record new promise/ }).click();
  const sheet = page.getByRole("dialog", { name: "Record a new promise" });
  const origin = sheet.getByLabel("Promise made on");
  if (input.madeOn === undefined) {
    await expect(origin, "the form pre-fills an origin the customer never stated").toHaveValue(today);
  } else {
    await origin.fill(input.madeOn);
    await expect(origin).toHaveValue(input.madeOn);
  }
  await sheet.getByLabel("Promised amount").fill(input.amountRupees);
  await sheet.getByLabel("Promised date").fill(input.promisedDate);
  await sheet.getByLabel("Source").selectOption(input.source);
  await sheet.getByLabel("Note").fill(input.note);
  await sheet.getByRole("button", { name: "Keep this promise" }).click();
  await expect(toast(page, "Promise added")).toBeVisible();
  await expect(sheet).toHaveCount(0);
  await clearToasts(page);
}

async function recordPayment(page: Page, input: { amountRupees: string; paidDate: string; method: string; reference?: string; clickTwice?: boolean }) {
  await page.getByRole("button", { name: "Record payment", exact: true }).click();
  const sheet = page.getByRole("dialog", { name: "Record payment" });
  await sheet.getByLabel("Amount").fill(input.amountRupees);
  await sheet.getByLabel("Date").fill(input.paidDate);
  await sheet.getByLabel("Method").selectOption(input.method);
  if (input.reference) await sheet.getByLabel("Reference").fill(input.reference);
  const submit = sheet.getByRole("button", { name: /^Record payment/ });
  await submit.click();
  if (input.clickTwice) {
    // A second submit from the same opened form carries the same request id, so
    // the database must replay the first payment rather than record another.
    await submit.click({ force: true, timeout: 1_500 }).catch(() => undefined);
  }
  await expect(toast(page, "Payment recorded")).toBeVisible();
  await expect(sheet).toHaveCount(0);
  await clearToasts(page);
}

/**
 * An acknowledgement toast, scoped away from the timeline: a recorded payment
 * writes the same words ("Payment recorded") into the activity history, so an
 * unscoped text match is ambiguous. `.first()` because two identical
 * acknowledgements can legitimately be on screen at once when a journey records
 * two promises back to back — every state claim below is read from the panel,
 * which only re-renders after a successful refresh from the database.
 */
function toast(page: Page, title: string) {
  return page.getByRole("region", { name: /Notifications/ }).getByText(title, { exact: true }).first();
}

/**
 * The acknowledgement stack is anchored top-right, which is exactly where the
 * header's "Add receivable" action lives, and sonner holds a toast open while
 * the pointer is over it — so a cursor parked at the previous click point can
 * keep the overlay mounted on top of the next button (observed: the click
 * retried until the hook timed out). Send the pointer somewhere neutral and wait
 * for the acknowledgements to leave before clicking underneath them.
 */
async function clearToasts(page: Page) {
  await page.mouse.move(0, 0);
  await expect(page.getByRole("region", { name: /Notifications/ }).locator("li"), "the toast stack never left the header action").toHaveCount(0, { timeout: 15_000 });
}

function outstanding(page: Page) {
  return page.locator(".detail-amount strong");
}

function promiseStatus(page: Page) {
  return page.locator(".promise-callout strong");
}

function reliability(page: Page) {
  return page.locator(".reliability");
}

async function gotoToday(page: Page) {
  await page.getByLabel("Primary navigation").getByRole("button", { name: "Today" }).click();
  await expect(page.getByRole("heading", { name: "Who needs attention now?" })).toBeVisible();
}

async function receivablePill(page: Page, label: string, tab: "open" | "paid") {
  await page.getByLabel("Primary navigation").getByRole("button", { name: "Receivables" }).click();
  await expect(page.getByRole("heading", { name: "Receivables, without the accounting drag." })).toBeVisible();
  await page.getByRole("tab", { name: new RegExp(tab === "paid" ? "^Paid" : "^Open") }).click();
  const pill = page.locator(".receivable-list-card", { hasText: label }).locator(".status-pill");
  return { pill, back: () => gotoToday(page) };
}

async function gotoClients(page: Page) {
  await page.getByLabel("Primary navigation").getByRole("button", { name: "Clients" }).click();
  await expect(page.getByRole("heading", { name: "Clients", exact: true }).first()).toBeVisible();
}

test.describe("Stage 5 settles money against a promise without erasing either", () => {
  // Each step is a real write through a real sheet, acknowledged by a toast that
  // then has to leave the screen; 30 s is not enough for a whole journey.
  test.describe.configure({ mode: "serial", timeout: 90_000 });
  test.skip(!localStackEnabled, "Set STAGE5_LOCAL_E2E=1 to run against the local Supabase stack.");

  const account = newAccount("settlement");
  const label = `Stage5 settlement invoice ${account.token}`;
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext();
    page = await context.newPage();
    await signUp(page, account);
    await addClient(page, account);
    await addReceivable(page, account, label, "10000", businessDate(10));
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test("the receivable this journey settles really was created", async () => {
    await expect(outstanding(page)).toHaveText("₹10,000");
    await expect(page.getByText(label, { exact: false }).first()).toBeVisible();
    const { pill, back } = await receivablePill(page, label, "open");
    await expect(pill).toHaveText("Open");
    await back();
  });

  test("a ₹5,000 promise kept by a ₹5,000 payment reads Kept while ₹5,000 is still outstanding", async () => {
    await recordPromise(page, { amountRupees: "5000", promisedDate: today, source: "WhatsApp", note: "Client said half today." });
    await expect(promiseStatus(page)).toHaveText("Active promise");
    await expect(outstanding(page)).toHaveText("₹10,000");

    await recordPayment(page, { amountRupees: "5000", paidDate: today, method: "UPI", reference: `S5E-${account.token.slice(0, 6)}` });
    await expect(promiseStatus(page)).toHaveText("Kept");
    await expect(outstanding(page)).toHaveText("₹5,000");
    const { pill, back } = await receivablePill(page, label, "open");
    await expect(pill, "a half-paid invoice is not settled and not still open").toHaveText("Partially paid");
    await back();
  });

  test("a reload re-reads the same settled state from the database", async () => {
    await page.reload();
    await expect(page.getByLabel("Primary navigation")).toBeVisible();
    await expect(outstanding(page)).toHaveText("₹5,000");
    await expect(promiseStatus(page)).toHaveText("Kept");
  });

  test("the final ₹5,000 settles the invoice and leaves the earlier promise in the timeline", async () => {
    await recordPayment(page, { amountRupees: "5000", paidDate: today, method: "UPI", clickTwice: true });
    await expect(outstanding(page)).toHaveText("₹0");
    await expect(page.locator(".timeline .timeline-amount"), "a retried submit must not record a third receipt").toHaveCount(2);
    await expect(page.locator(".timeline").getByText("WhatsApp · ₹5,000 promised").first()).toBeVisible();
    const { pill, back } = await receivablePill(page, label, "paid");
    await expect(pill).toHaveText("Paid");
    await back();
  });

  test("the browser stores the session and the theme, never the ledger", async () => {
    const stored = await page.evaluate(() => ({ local: Object.entries(localStorage), session: Object.entries(sessionStorage) }));
    // Supabase's own client persists the auth session in localStorage, and that
    // blob carries the signed-in address and display name inside its JWT. That is
    // the Stage 4 baseline, untouched by this stage; the claim worth proving is
    // that nothing *else* is stored and that no ledger fact is stored at all.
    for (const [key] of stored.local) {
      expect(key, "an unexpected entry was written to localStorage").toMatch(/^(sb-[\w.-]*auth-token|dueweave-theme)$/);
    }
    expect(stored.session, "session storage must stay empty").toHaveLength(0);
    const haystack = JSON.stringify(stored.local.filter(([key]) => !key.includes("auth-token")));
    for (const fact of [account.clientName, account.company, label, "1000000", "10,000", "5,000", `S5E-${account.token.slice(0, 6)}`]) {
      expect(haystack, `ledger content leaked into web storage: ${fact}`).not.toContain(fact);
    }
  });
});

test.describe("Stage 5 keeps a promise's own dates in charge of its outcome", () => {
  // The journey above shows a promise being kept. This one shows the case that
  // used to be decided wrongly: money that arrived BEFORE the customer ever made
  // a commitment, typed into the app afterwards. Recording order is not a fact
  // about the customer, so the ledger must not treat it as one — and the only way
  // to see that from the browser is to enter the two in the awkward order and
  // watch the promise stay open.
  test.describe.configure({ mode: "serial", timeout: 90_000 });
  test.skip(!localStackEnabled, "Set STAGE5_LOCAL_E2E=1 to run against the local Supabase stack.");

  const account = newAccount("chronology");
  const label = `Stage5 chronology invoice ${account.token}`;
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext();
    page = await context.newPage();
    await signUp(page, account);
    await addClient(page, account);
    await addReceivable(page, account, label, "10000", businessDate(10));
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test("yesterday's receipt is entered first and changes nothing about tomorrow's promise", async () => {
    await recordPayment(page, { amountRupees: "5000", paidDate: yesterday, method: "UPI", reference: `S5C-${account.token.slice(0, 6)}` });
    await expect(outstanding(page)).toHaveText("₹5,000");

    // The origin is typed as today, so the money dated yesterday sits outside the
    // window by a full day — the exact shape of the mistake this stage repairs.
    await recordPromise(page, { amountRupees: "5000", madeOn: today, promisedDate: businessDate(1), source: "Call", note: "Will pay tomorrow, said today." });
    await expect(promiseStatus(page)).toHaveText("Active promise");
    await expect(outstanding(page)).toHaveText("₹5,000");
  });

  test("a reload re-reads the same uncredited promise, so the state was never a recording accident", async () => {
    await page.reload();
    await expect(page.getByLabel("Primary navigation")).toBeVisible();
    await expect(promiseStatus(page)).toHaveText("Active promise");
    await expect(outstanding(page)).toHaveText("₹5,000");
  });

  test("money dated inside the window keeps the promise and settles the invoice", async () => {
    await recordPayment(page, { amountRupees: "5000", paidDate: today, method: "UPI" });
    await expect(promiseStatus(page)).toHaveText("Kept");
    await expect(outstanding(page)).toHaveText("₹0");
    const { pill, back } = await receivablePill(page, label, "paid");
    await expect(pill).toHaveText("Paid");
    await back();
  });

  test("an older promise entered late still keeps the day it was actually made", async () => {
    // Catching up on paperwork is the normal case: a commitment made three days
    // ago for two days ago, typed in today. Its origin has to survive the form,
    // the request and the reload, because the window it opens is what decides
    // whether later money counts toward it.
    await addReceivable(page, account, `Stage5 late entry ${account.token}`, "4000", businessDate(8));
    const madeThreeDaysAgo = businessDate(-3);
    const promisedTwoDaysAgo = businessDate(-2);
    await recordPromise(page, { amountRupees: "2000", madeOn: madeThreeDaysAgo, promisedDate: promisedTwoDaysAgo, source: "Meeting", note: "Said it three days ago; typed it now." });
    await expect(promiseStatus(page)).toHaveText("Promise broken");

    // A receipt dated the day before the promise was made cannot be its evidence,
    // however recently it was entered.
    await recordPayment(page, { amountRupees: "2000", paidDate: businessDate(-4), method: "Cash" });
    await expect(promiseStatus(page), "money from before the promise was made did not keep it").toHaveText("Promise broken");

    await page.reload();
    await expect(page.getByLabel("Primary navigation")).toBeVisible();
    await expect(promiseStatus(page)).toHaveText("Promise broken");

    // The same money, moved into the window, is what rescues it — and the outcome
    // is recorded as a correction rather than a rewritten history.
    await recordPayment(page, { amountRupees: "2000", paidDate: promisedTwoDaysAgo, method: "Bank transfer" });
    await expect(promiseStatus(page)).toHaveText("Kept");
    await expect(outstanding(page)).toHaveText("₹0");
  });
});

test.describe("Stage 5 tells the truth about a deadline that passed", () => {
  // Each step is a real write through a real sheet, acknowledged by a toast that
  // then has to leave the screen; 30 s is not enough for a whole journey.
  test.describe.configure({ mode: "serial", timeout: 90_000 });
  test.skip(!localStackEnabled, "Set STAGE5_LOCAL_E2E=1 to run against the local Supabase stack.");

  const account = newAccount("deadline");
  const label = `Stage5 deadline invoice ${account.token}`;
  // A receipt that falls inside two promises' windows credits both: there is no
  // payment-allocation engine. So each commitment here gets a day of its own.
  const threeDaysAgo = businessDate(-3);
  const twoDaysAgo = businessDate(-2);
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext();
    page = await context.newPage();
    await signUp(page, account);
    await addClient(page, account);
    await addReceivable(page, account, label, "20000", businessDate(-3));
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test("an invoice recorded today is queued on facts, never on counted-down silence", async () => {
    await gotoToday(page);
    const card = page.getByRole("article").filter({ hasText: account.company }).first();
    await expect(card).toBeVisible();
    const shown = (await card.locator(".queue-card__why").innerText()).toLowerCase();
    expect(shown, `the queue said "${shown}" about an invoice created today`).not.toMatch(/no contact for \d+ days|\d+ days since it was recorded/);
    expect(shown).toContain("3 days overdue");
    await gotoClients(page);
    await expect(reliability(page)).toContainText("Not enough history");
  });

  test("a promise whose day passed is broken, and the queue states it as a fact", async () => {
    await gotoToday(page);
    await recordPromise(page, { amountRupees: "5000", madeOn: threeDaysAgo, promisedDate: threeDaysAgo, source: "Call", note: "Three days ago, and nothing arrived." });
    await expect(promiseStatus(page)).toHaveText("Promise broken");
    await expect(outstanding(page)).toHaveText("₹20,000");
    await expect(page.getByRole("article").filter({ hasText: account.company }).first().locator(".queue-card__why")).toContainText("1 promise broken");
  });

  test("money recorded later against the passed date is partially kept, not rewritten", async () => {
    await recordPayment(page, { amountRupees: "2000", paidDate: threeDaysAgo, method: "Cash" });
    await expect(promiseStatus(page)).toHaveText("Partially kept");
    await expect(outstanding(page)).toHaveText("₹18,000");
    await page.reload();
    await expect(page.getByLabel("Primary navigation")).toBeVisible();
    await expect(promiseStatus(page)).toHaveText("Partially kept");
  });

  test("reliability counts only the promises the customer answered", async () => {
    await gotoToday(page);
    await recordPromise(page, { amountRupees: "3000", madeOn: twoDaysAgo, promisedDate: twoDaysAgo, source: "WhatsApp", note: "A second date was missed too." });
    await expect(promiseStatus(page)).toHaveText("Promise broken");
    await recordPromise(page, { amountRupees: "4000", madeOn: yesterday, promisedDate: yesterday, source: "Email", note: "Third attempt, kept." });
    await recordPayment(page, { amountRupees: "4000", paidDate: yesterday, method: "UPI" });
    await expect(promiseStatus(page)).toHaveText("Kept");

    await gotoClients(page);
    await expect(reliability(page)).toContainText("1 of 3 promises kept");
    await expect(reliability(page)).toContainText("1 broken · 1 partial");
  });

  test("a renegotiated or withdrawn promise counts as neither kept nor broken", async () => {
    await gotoToday(page);
    await recordPromise(page, { amountRupees: "1500", promisedDate: businessDate(6), source: "Call", note: "Promised for next week." });
    await recordPromise(page, { amountRupees: "1500", promisedDate: businessDate(9), source: "WhatsApp", note: "Moved it again before the day." });
    await expect(promiseStatus(page)).toHaveText("Active promise");

    await gotoClients(page);
    await expect(reliability(page), "a replaced commitment must not read as broken").toContainText("1 of 3 promises kept");

    await gotoToday(page);
    await page.getByRole("button", { name: /Withdraw active promise/ }).click();
    const sheet = page.getByRole("dialog", { name: "Withdraw this promise" });
    await sheet.getByLabel("Why is it being withdrawn?").fill("The client asked to drop this date.");
    await sheet.getByRole("button", { name: "Withdraw promise" }).click();
    await expect(toast(page, "Promise withdrawn")).toBeVisible();

    await gotoClients(page);
    await expect(reliability(page), "a withdrawn commitment must not change the count either").toContainText("1 of 3 promises kept");
    await expect(page.locator(".metric", { hasText: "Promises" }).locator("strong"), "nothing was deleted on the way here").toHaveText("5");
  });
});
