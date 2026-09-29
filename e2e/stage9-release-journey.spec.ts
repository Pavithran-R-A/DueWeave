// DUEWEAVE CURRENT ROADMAP STAGE 9 — PHASE 12, the one release journey a stranger
// actually walks.
//
// Stages 2-8 each proved their own slice in its own spec, which is how the defects
// got found. It also means no single test has ever taken one fresh account from
// "Create an account" to a signed-out, signed-back-in, exported, fully settled
// ledger. This file consolidates that path, in order, through the real UI:
//
//   no direct database insert, no fixture email, no service-role key, no operator
//   configuration. Everything present was typed by this page into this build.
//
// The one place that genuinely needs a state the product refuses to be configured
// into is the Founder payment surface, and here the absence is the assertion: the
// delivered offer is fail-closed, so a fresh account must NOT be able to start a
// claim (see the Founder step below). Stage 8's customer and reviewer journeys cover
// the ready state, using an operator-side fixture they restore afterwards.
//
// Qualified against the repository's own local Supabase Docker stack only. Run with
// STAGE9_LOCAL_E2E=1 (which `pnpm verify:e2e:local` sets) against a built preview
// server; the guard in e2e/local-stack-setup.mjs fails the run rather than skipping
// it if the stack is absent.

import { readFileSync } from "node:fs";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { completeWorkspaceSetup } from "./workspace-setup";
import { drainProblems, startProblemWatch, type ProblemWatch } from "./problem-watch";

const localStackEnabled = process.env.STAGE9_LOCAL_E2E === "1";

const token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

/** The India business date `offset` days from today, as the date inputs take it. */
function businessDate(offset: number) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(Date.now() + offset * 86_400_000);
  const part = (kind: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === kind)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

const account = {
  email: `stage9release-${token}@dueweave.local`,
  password: `Stage9release!${token}aA`,
  displayName: `Stage9 Release Owner ${token.slice(-6)}`,
  businessName: `Stage9 Release Studio ${token.slice(-6)}`,
  renamedBusiness: `Stage9 Renamed Studio ${token.slice(-6)}`,
};

const client = {
  name: `Meera Nair ${token.slice(-6)}`,
  company: `Rangam Films ${token.slice(-6)}`,
  phone: "+91 98765 43210",
};

const invoice = {
  title: `Wedding teaser ${token.slice(-6)}`,
  reference: `INV-S9-${token.slice(-6)}`,
};

const paymentReference = `NEFT ${token.slice(-6).toUpperCase()}`;

/** What the export envelope is typed as far as this file reads it. */
type ExportedBundle = {
  format: string;
  version: number;
  account: { email: string | null; businessName: string | null };
  clients: { name: string; phone: string | null }[];
  receivables: { label: string; invoice_ref: string | null; amount_due_paise: number; outstanding_paise: number; status: string }[];
  promises: { promised_amount_paise: number; made_on: string; promised_date: string }[];
  payments: { amount_paise: number; reference: string | null }[];
  activities: { type: string; note: string | null }[];
};

function toastTitle(page: Page, title: string) {
  return page.getByRole("region", { name: /Notifications/ }).getByText(title, { exact: true }).first();
}

/**
 * Sonner holds a toast while the pointer rests on it, and the stack sits over the
 * header action the next step clicks. Park the cursor and wait for the stack to
 * leave before pressing anything underneath it.
 */
async function clearToasts(page: Page) {
  await page.mouse.move(0, 0);
  await expect(page.getByRole("region", { name: /Notifications/ }).locator("li"), "the acknowledgement stack never left").toHaveCount(0, { timeout: 15_000 });
}

async function acknowledge(page: Page, title: string) {
  await expect(toastTitle(page, title)).toBeVisible({ timeout: 15_000 });
  await clearToasts(page);
}

/**
 * wa.me is a third party and an automated run must never reach it. The listener
 * cancels only the navigation, so the click still lands on the app's own link and
 * the handoff is exercised the way a person uses it.
 */
async function cancelWhatsAppNavigation(page: Page) {
  await page.addInitScript(() => {
    (window as unknown as { __waLinks: string[] }).__waLinks = [];
    document.addEventListener("click", (event) => {
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href^="https://wa.me/"]') : null;
      if (!anchor) return;
      event.preventDefault();
      (window as unknown as { __waLinks: string[] }).__waLinks.push(anchor.href);
    }, true);
  });
}

async function openedWhatsAppLinks(page: Page) {
  return page.evaluate(() => (window as unknown as { __waLinks?: string[] }).__waLinks ?? []);
}

function nav(page: Page) {
  return page.getByLabel("Primary navigation");
}

/**
 * Switch tab and wait for the content area this build renders for it. The section
 * headings are asserted where a step depends on them, because the Today screen
 * legitimately has two shapes — an empty workspace shows a welcome instead of a
 * queue, and a journey that demanded the queue heading there would be testing its
 * own assumption rather than the product.
 */
async function openSection(page: Page, section: "Today" | "Receivables" | "Clients" | "More") {
  await nav(page).getByRole("button", { name: section }).filter({ visible: true }).first().click();
  await expect(page.locator(".app-content")).toBeVisible();
}

async function expectMoreScreen(page: Page) {
  await expect(page.getByRole("heading", { name: "A private ledger for the awkward middle." })).toBeVisible();
}

function outstanding(page: Page) {
  return page.locator(".detail-amount strong");
}

function promiseStatus(page: Page) {
  return page.locator(".promise-callout strong");
}

function queueCard(page: Page) {
  return page.getByRole("article").filter({ hasText: client.company }).first();
}

async function signIn(page: Page) {
  await page.goto("/auth");
  const form = page.getByLabel("Email address");
  const shell = page.locator(".app-shell");
  await expect(form.or(shell)).toBeVisible({ timeout: 15_000 });
  if (await shell.isVisible()) {
    await openSection(page, "More");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(form).toBeVisible({ timeout: 15_000 });
  }
  await form.fill(account.email);
  await page.getByLabel("Password").fill(account.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 20_000 });
  await expect(page.getByLabel("Primary navigation")).toBeVisible({ timeout: 20_000 });
}

/** The exports live in a named group, so nothing below measures the whole page. */
async function openYourData(page: Page) {
  await openSection(page, "More");
  await expectMoreScreen(page);
  const panel = page.getByRole("region", { name: "Take the ledger with you." });
  await expect(panel).toBeVisible();
  return panel;
}

async function download(page: Page, panel: ReturnType<Page["getByRole"]>, control: RegExp) {
  const announced = page.waitForEvent("download", { timeout: 30_000 });
  await panel.getByRole("button", { name: control }).first().click();
  const file = await announced;
  const localPath = await file.path();
  expect(localPath, `${file.suggestedFilename()} produced no readable file`).not.toBeNull();
  await acknowledge(page, "Download started");
  return { filename: file.suggestedFilename(), text: readFileSync(localPath as string, "utf8") };
}

test.describe("Stage 9 release journey, one fresh account end to end", () => {
  // The narrative is the product proof: the second half of the money story means
  // nothing unless it happened to the same signed-in workspace as the first half.
  // Serial mode is what makes one account, one page and one ledger real. Declared
  // before the conditional skip, which is the order this runner honours the timeout
  // in — see e2e/stage9-account-isolation.spec.ts.
  test.describe.configure({ mode: "serial", timeout: 150_000 });
  test.skip(!localStackEnabled, "Set STAGE9_LOCAL_E2E=1 to run against the local Supabase stack.");

  let context: BrowserContext;
  let page: Page;
  let watch: ProblemWatch;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext();
    page = await context.newPage();
    await cancelWhatsAppNavigation(page);
    watch = startProblemWatch(page);
  });

  test.afterAll(async () => {
    await context?.close();
  });

  // One watcher spans the journey because one page does; draining keeps the failure
  // attached to the step that caused it instead of the whole narrative.
  test.afterEach(() => {
    expect(drainProblems(watch)).toEqual([]);
  });

  test("a stranger signs up, names the workspace, and the name is on the account", async () => {
    await page.goto("/auth");
    await expect(page.getByRole("heading", { name: "Your follow-ups, in one calm place." })).toBeVisible();
    await page.getByRole("button", { name: "Create an account" }).click();
    await page.getByLabel("Your name").fill(account.displayName);
    await page.getByLabel("Email address").fill(account.email);
    await page.getByLabel("Password").fill(account.password);
    await page.getByRole("button", { name: "Create my workspace" }).click();

    // Onboarding is a gate, not a suggestion: the ledger is unreachable until it is
    // answered, and answering it lands on a workspace carrying those names.
    await completeWorkspaceSetup(page, account);
    await expect(page.getByRole("heading", { name: "Make the next conversation easier." })).toBeVisible();

    await openSection(page, "More");
    await expect(page.locator(".identity-row", { hasText: "Business or workspace" })).toContainText(account.businessName);
    await expect(page.locator(".identity-row", { hasText: "Your name" })).toContainText(account.displayName);
    await expect(page.locator(".identity-row", { hasText: "Sign-in email" })).toContainText(account.email);

    // A reload re-reads the row, so the name is the account's, not this device's.
    await page.reload();
    await expect(page.getByLabel("Primary navigation")).toBeVisible();
    await expect(nav(page).getByText(account.businessName)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Set up your private ledger." })).toHaveCount(0);
  });

  test("the first client and the first invoice become a real open amount", async () => {
    await openSection(page, "Today");
    await page.getByRole("button", { name: /Add a client first|Add client$/ }).first().click();
    const clientSheet = page.getByRole("dialog", { name: "Add client" });
    await clientSheet.getByLabel("Client name").fill(client.name);
    await clientSheet.getByLabel("Company").fill(client.company);
    await clientSheet.getByLabel("Phone").fill(client.phone);
    await clientSheet.getByRole("button", { name: "Save client" }).click();
    await acknowledge(page, "Client added");

    await page.getByRole("button", { name: "Add receivable" }).first().click();
    const receivableSheet = page.getByRole("dialog", { name: "Add receivable" });
    await receivableSheet.getByRole("button", { name: "Existing client" }).click();
    await receivableSheet.getByLabel("Search existing clients").fill(token.slice(-6));
    await receivableSheet.getByRole("option", { name: new RegExp(client.name) }).click();
    await receivableSheet.getByLabel("Amount").fill("10000");
    // Overdue on purpose: a day already gone is what puts the invoice in the queue
    // with a reason a person can read, which the next steps then change.
    await receivableSheet.getByLabel("Due date").fill(businessDate(-3));
    await receivableSheet.getByLabel("What is this for?").fill(invoice.title);
    await receivableSheet.getByLabel("Invoice or reference").fill(invoice.reference);
    await receivableSheet.getByRole("button", { name: "Save receivable" }).click();
    await acknowledge(page, "Receivable added");

    await expect(outstanding(page)).toHaveText("₹10,000");
    await openSection(page, "Receivables");
    const openPill = page.locator(".receivable-list-card", { hasText: invoice.title }).locator(".status-pill");
    await expect(openPill).toHaveText("Open");
  });

  test("a promise the client actually made changes what today asks for", async () => {
    await openSection(page, "Today");
    await expect(queueCard(page)).toBeVisible();
    await expect(queueCard(page).locator(".queue-card__why")).toContainText("3 days overdue");
    await expect(queueCard(page).locator(".queue-card__promise")).toHaveCount(0);

    await page.getByRole("button", { name: /Record new promise/ }).click();
    const sheet = page.getByRole("dialog", { name: "Record a new promise" });
    await sheet.getByLabel("Promised amount").fill("5000");
    await sheet.getByLabel("Promise made on").fill(businessDate(-1));
    await sheet.getByLabel("Promised date").fill(businessDate(0));
    await sheet.getByLabel("Source").selectOption("WhatsApp");
    await sheet.getByLabel("Note").fill("Client said half of it lands today.");
    await sheet.getByRole("button", { name: "Keep this promise" }).click();
    await acknowledge(page, "Promise added");

    await expect(promiseStatus(page)).toHaveText("Active promise");
    // The queue reacts to the commitment, not to the click: the promise date is now
    // part of the card a person triages from.
    await expect(queueCard(page).locator(".queue-card__promise")).toContainText("Promised");
    await expect(outstanding(page)).toHaveText("₹10,000");
  });

  test("part of the money arrives, the promise is kept, and the balance stays exact", async () => {
    await page.getByRole("button", { name: "Record payment", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "Record payment" });
    await sheet.getByLabel("Amount").fill("5000");
    await sheet.getByLabel("Date").fill(businessDate(0));
    await sheet.getByLabel("Method").selectOption("UPI");
    await sheet.getByLabel("Reference").fill(paymentReference);
    await sheet.getByRole("button", { name: /^Record payment/ }).click();
    await acknowledge(page, "Payment recorded");

    // Money dated inside the promise's window keeps it; the amount it still owes is
    // arithmetic, not a status word.
    await expect(promiseStatus(page)).toHaveText("Kept");
    await expect(outstanding(page)).toHaveText("₹5,000");
    await openSection(page, "Today");
    await expect(queueCard(page).locator(".queue-card__amount strong")).toHaveText("₹5,000");
    await openSection(page, "Receivables");
    await expect(page.locator(".receivable-list-card", { hasText: invoice.title }).locator(".status-pill")).toHaveText("Partially paid");
  });

  test("the follow-up hands off to WhatsApp and only the person marks it sent", async () => {
    await openSection(page, "Today");
    await page.getByRole("button", { name: /^Follow up with / }).click();
    const sheet = page.getByRole("dialog", { name: "Choose the next message" });
    await expect(sheet).toBeVisible();

    const link = sheet.getByRole("link", { name: /WhatsApp/ });
    await expect(link).toHaveAttribute("href", new RegExp(`^https://wa\\.me/\\d*\\?text=`));
    await link.click();
    // The handoff happened and nothing was written: opening a tab is not a contact.
    await expect.poll(() => openedWhatsAppLinks(page)).toHaveLength(1);
    await expect(page.locator(".timeline .timeline-item strong", { hasText: /follow-up sent|WhatsApp sent|contacted/i })).toHaveCount(0);

    await sheet.getByRole("button", { name: /I sent it/ }).click();
    await acknowledge(page, "Follow-up marked");
    await expect(page.locator(".timeline .timeline-item strong", { hasText: /^WhatsApp follow-up sent ·/ })).toHaveCount(1);
  });

  test("the last payment settles it and the history keeps every step", async () => {
    await page.getByRole("button", { name: "Record payment", exact: true }).click();
    const sheet = page.getByRole("dialog", { name: "Record payment" });
    await sheet.getByLabel("Amount").fill("5000");
    await sheet.getByLabel("Date").fill(businessDate(0));
    await sheet.getByLabel("Method").selectOption("Bank transfer");
    await sheet.getByRole("button", { name: /^Record payment/ }).click();
    await acknowledge(page, "Payment recorded");

    await expect(outstanding(page)).toHaveText("₹0");
    // Settlement is not deletion: what happened earlier is still on the record.
    await expect(page.locator(".timeline .timeline-item").filter({ hasText: "Payment recorded" })).toHaveCount(2);
    await expect(page.locator(".timeline").getByText("WhatsApp · ₹5,000 promised").first()).toBeVisible();
    await expect(page.locator(".timeline .timeline-item").filter({ hasText: "WhatsApp follow-up sent" })).toHaveCount(1);

    await openSection(page, "Receivables");
    await page.getByRole("tab", { name: /^Paid/ }).click();
    await expect(page.locator(".receivable-list-card", { hasText: invoice.title }).locator(".status-pill")).toHaveText("Paid");
  });

  test("search and the status tabs find the settled invoice without hiding anything", async () => {
    await openSection(page, "Receivables");
    // Set the view explicitly instead of inheriting whichever tab the previous step
    // left: a settled amount is invisible under "Open", and a search measured there
    // would be measuring the tab, not the filter.
    await page.getByRole("tab", { name: /^All history/ }).click();
    const search = page.getByLabel("Search receivables");
    const card = page.locator(".receivable-list-card", { hasText: invoice.title });
    const needle = token.slice(-6);

    // Search is case-insensitive on purpose, so the same letters typed either way
    // have to find the same amount.
    await search.fill(needle.toUpperCase());
    await expect(card).toHaveCount(1);
    await search.fill(needle.toLowerCase());
    await expect(card).toHaveCount(1);

    // The reference is searchable even though no card ever prints it — the field the
    // placeholder promises is the field the filter reads.
    await search.fill(invoice.reference);
    await expect(card).toHaveCount(1);

    // A needle that is truly absent empties the list and says which of the three
    // quiet situations this is.
    await search.fill(`zz${needle}`);
    await expect(card).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "No matches in this view." })).toBeVisible();
    await expect(page.getByText(`Nothing in all history matches “zz${needle}”.`)).toBeVisible();
    await page.getByRole("button", { name: "Clear search" }).click();

    await expect(card).toHaveCount(1);
    await expect(page.getByRole("tab", { name: /^Open/ }).locator("span")).toHaveText("0");
    await expect(page.getByRole("tab", { name: /^All history/ }).locator("span")).toHaveText("1");

    await openSection(page, "Clients");
    await page.getByLabel("Search clients").fill(client.company.slice(0, 10));
    await expect(page.getByRole("button", { name: new RegExp(client.name) })).toHaveCount(1);
  });

  test("the export is the ledger this journey typed, in both shapes", async () => {
    const panel = await openYourData(page);
    const archive = await download(page, panel, /Full data archive/);
    expect(archive.filename).toMatch(/^dueweave-data-\d{4}-\d{2}-\d{2}\.json$/);
    const bundle = JSON.parse(archive.text) as ExportedBundle;
    expect(bundle.format).toBe("dueweave-export");
    expect(bundle.version).toBe(1);
    expect(bundle.account.email).toBe(account.email);
    expect(bundle.account.businessName).toBe(account.businessName);
    expect(bundle.clients).toHaveLength(1);
    expect(bundle.clients[0].name).toBe(client.name);
    expect(bundle.clients[0].phone).toContain("9876543210");
    expect(bundle.receivables).toHaveLength(1);
    expect(bundle.receivables[0].label).toBe(invoice.title);
    expect(bundle.receivables[0].invoice_ref).toBe(invoice.reference);
    expect(bundle.receivables[0].amount_due_paise).toBe(1000000);
    // Two ₹5,000 payments happened, so the account is settled in the file too.
    expect(bundle.receivables[0].outstanding_paise).toBe(0);
    expect(bundle.receivables[0].status).toBe("PAID");
    expect(bundle.promises).toHaveLength(1);
    expect(bundle.promises[0].promised_amount_paise).toBe(500000);
    expect(bundle.payments).toHaveLength(2);
    expect(bundle.payments.reduce((total, row) => total + row.amount_paise, 0)).toBe(1000000);
    expect(bundle.payments.some((row) => row.reference === paymentReference)).toBe(true);
    expect(bundle.activities.some((row) => row.type === "FOLLOW_UP_RECORDED")).toBe(true);

    // Money leaves as integer paise, and no credential or session material rides along.
    expect(archive.text).not.toContain("₹");
    for (const secret of ["service_role", "eyJ", account.password, "apikey", "Bearer "]) {
      expect(archive.text, `the archive carried ${secret}`).not.toContain(secret);
    }

    const payments = await download(page, panel, /^Payments CSV$/);
    const rows = payments.text.replace(/^/, "").trimEnd().split("\r\n");
    expect(rows.length, "the payments sheet exported no rows").toBeGreaterThanOrEqual(3);
    expect(payments.text).toContain(paymentReference);
    expect(payments.text).toContain(",500000,");
    expect(payments.text).not.toContain(account.password);
  });

  test("the founder page refuses payment instructions nobody configured", async () => {
    await openSection(page, "More");
    await page.getByRole("button", { name: /Founder access/ }).click();
    await expect(page).toHaveURL(/\/founder$/);

    // Nothing in this run configured a destination, so the only honest answer is that
    // payment is not open. A fresh account reaching a claim button here would mean the
    // fail-closed rule has a client-side hole.
    await expect(page.locator(".founder-not-ready")).toBeVisible();
    await expect(page.getByText("Payment instructions are being set up.")).toBeVisible();
    await expect(page.getByText(/Do not send money yet\./)).toBeVisible();
    await expect(page.getByRole("button", { name: "Start payment claim" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Open UPI/ })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /Copy UPI link/ })).toHaveCount(0);
    await expect(page.locator(".founder-qr-wrap img")).toHaveCount(0);
    // The shipped placeholder address never reaches the customer surface either.
    await expect(page.getByText("Support contact will be available before payments open.")).toBeVisible();
    await expect(page.getByText(/Support contact not configured/)).toHaveCount(0);
    // And the price is the approved authority, not a display value picked at render.
    await expect(page.locator(".founder-price strong")).toHaveText("₹499");

    await expect(page.getByRole("heading", { name: "Keep every follow-up in view." })).toBeVisible();
    await page.getByRole("button", { name: "Return to my ledger" }).click();
    await expect(page.getByLabel("Primary navigation")).toBeVisible();
  });

  test("a profile edit, a sign out and a sign in leave the ledger exactly as large as it is", async () => {
    await openSection(page, "More");
    await page.getByRole("button", { name: /Edit your name and workspace name/ }).click();
    const sheet = page.getByRole("dialog", { name: "Edit workspace profile" });
    await sheet.getByLabel("Business or workspace name").fill(account.renamedBusiness);
    await sheet.getByRole("button", { name: "Save changes" }).click();
    await acknowledge(page, "Workspace details saved");
    await expect(nav(page).getByText(account.renamedBusiness)).toBeVisible();

    await openSection(page, "More");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/auth$/, { timeout: 15_000 });

    await signIn(page);
    await expect(nav(page).getByText(account.renamedBusiness)).toBeVisible();
    await openSection(page, "Receivables");
    await page.getByRole("tab", { name: /^Paid/ }).click();
    await expect(page.locator(".receivable-list-card", { hasText: invoice.title })).toHaveCount(1);

    // This device holds a session and a theme. The ledger lives on the row.
    const stored = await page.evaluate(() => ({
      local: Object.keys(window.localStorage).sort(),
      session: Object.keys(window.sessionStorage).sort(),
      text: Object.keys(window.localStorage).map((key) => `${key}=${window.localStorage.getItem(key)}`).join("|"),
    }));
    for (const key of stored.local) {
      expect(key, `an unexpected key was stored: ${key}`).toMatch(/^(sb-[\w.-]*auth-token|dueweave-theme)$/);
    }
    expect(stored.session).toEqual([]);
    for (const fact of [client.name, client.company, invoice.title, invoice.reference, paymentReference, "1000000"]) {
      expect(stored.text, `the ledger was cached on the device: ${fact}`).not.toContain(fact);
    }
  });
});
