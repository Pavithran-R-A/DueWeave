import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { completeWorkspaceSetup, reachLedgerAfterSignIn } from "./workspace-setup";

// DUEWEAVE CURRENT ROADMAP STAGE 4 — the persistence claim a customer can see.
//
// Qualified against the repository's own local Supabase Docker stack only.
// Run with STAGE4_LOCAL_E2E=1 after `pnpm supabase:start`, a local db reset,
// and a build served at http://127.0.0.1:3000.
//
// Everything here is provisioned through the sign-up form and the app's own
// screens: no E2E_EMAIL / E2E_PASSWORD fixture, no service-role key, no direct
// database insert, and no inspection of React state. A reload and a full
// sign-out/sign-in are what make "it persisted" mean something.
const localStackEnabled = process.env.STAGE4_LOCAL_E2E === "1";

type Account = {
  displayName: string;
  businessName: string;
  email: string;
  password: string;
  token: string;
  clientName: string;
  editedClientName: string;
  receivableLabel: string;
  editedLabel: string;
  amount: string;
};

function newAccount(role: "owner" | "stranger"): Account {
  const token = `${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 6)}`;
  return {
    displayName: `Stage4 ${role} Ledger`,
    businessName: `Stage4 ${role} workspace ${token}`,
    email: `stage4-e2e-${role}-${token}@dueweave.local`,
    password: `Stage4-browser-${token}!`,
    token,
    clientName: `Stage4 ${role} client ${token}`,
    editedClientName: `Stage4 ${role} client edited ${token}`,
    receivableLabel: `Stage4 ${role} invoice ${token}`,
    editedLabel: `Stage4 ${role} invoice revised ${token}`,
    amount: role === "owner" ? "1800" : "2400",
  };
}

// A write's confirmation toast is how this suite learns the database accepted it. The default
// 5s expect was measured failing on a healthy local stack: across eight two-tab samples the
// `update_client` RPC itself answered in 101-160ms every single time, while click -> toast
// ranged from 765ms to 14.4s. Instrumenting request-start times placed the gap between the
// resolved mutation and the render, not in Postgres or PostgREST, and peak same-origin
// in-flight requests stayed at 5, so the write was never queued behind a read burst. 30s is
// about twice the worst observation and still inside every budget in this file, so a write
// that genuinely never settles is still distinguishable from this machine's jitter. The add
// flows below get the same budget: same shape (one mutation, one toast, five refresh reads).
const writeConfirmed = { timeout: 30_000 };

// Worker setup is once per suite and does the whole sign-up journey, so it is budgeted where
// it is actually spent. `test.describe.configure({ timeout })` cannot reach a `beforeAll`:
// proven twice on this branch — the battery reported `"beforeAll" hook timeout of 30000ms
// exceeded` with a 60s describe configured, and a probe hook that called
// `test.setTimeout(2_000)` then slept reported `"beforeAll" hook timeout of 2000ms exceeded`.
// Isolated setup measured 5.8-7.1s; in-battery it overran 30s. 90s is deliberate headroom for
// a setup step that masks nothing — if it cannot finish, the suite reports failure either way.
const workspaceSetup = 90_000;

async function signUp(page: Page, account: Account) {
  await page.goto("/auth");
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Your name").fill(account.displayName);
  await page.getByLabel("Email address").fill(account.email);
  await page.getByLabel("Password").fill(account.password);
  await page.getByRole("button", { name: "Create my workspace" }).click();
  await completeWorkspaceSetup(page, account);
  await expect(page.getByRole("heading", { name: "Make the next conversation easier." })).toBeVisible();
}

async function signIn(page: Page, account: Account) {
  await page.goto("/auth");
  await expect(page.getByRole("heading", { name: "Your follow-ups, in one calm place." })).toBeVisible();
  await page.getByLabel("Email address").fill(account.email);
  await page.getByLabel("Password").fill(account.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await reachLedgerAfterSignIn(page, account);
}

async function signOut(page: Page) {
  await page.getByLabel("Primary navigation").getByRole("button", { name: "More" }).click();
  await page.getByRole("button", { name: /Sign out/ }).click();
  await expect(page).toHaveURL(/\/auth$/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Your follow-ups, in one calm place." })).toBeVisible();
}

async function addClientThroughUi(page: Page, account: Account) {
  // A brand-new workspace has no receivables, so the empty state offers the
  // client-first entry point; the Clients screen offers the same sheet later.
  await page.getByRole("button", { name: /Add a client first|Add client$/ }).first().click();
  await expect(page.getByText("A client can come first.")).toBeVisible();
  await page.getByLabel("Client name").fill(account.clientName);
  await page.getByLabel("Company").fill("Stage4 Studio");
  await page.getByLabel("Phone").fill("919876543210");
  await page.getByLabel("Email").fill(`ap${account.token}@stage4.example`);
  await page.getByLabel("Note").fill("Opened through the Stage 4 browser journey.");
  await page.getByRole("button", { name: "Save client" }).click();
  await expect(page.getByText("Client added", { exact: true })).toBeVisible(writeConfirmed);
}

async function addReceivableThroughUi(page: Page, account: Account) {
  await page.getByRole("button", { name: "Add receivable" }).first().click();
  await page.getByRole("button", { name: "Existing client" }).click();
  await page.getByLabel("Search existing clients").fill(account.token);
  await page.getByRole("option", { name: new RegExp(account.token) }).click();
  await page.getByLabel("Amount").fill(account.amount);
  await page.getByLabel("Due date").fill("2026-10-20");
  await page.getByLabel("What is this for?").fill(account.receivableLabel);
  await page.getByLabel("Invoice or reference").fill(`S4E-${account.token.slice(0, 6)}`);
  await page.getByRole("button", { name: "Save receivable" }).click();
  await expect(page.getByText("Receivable added", { exact: true })).toBeVisible(writeConfirmed);
}

async function openSection(page: Page, section: "Today" | "Clients") {
  await page.getByLabel("Primary navigation").getByRole("button", { name: section }).click();
  await expect(page.getByRole("heading", { name: section, exact: true }).first()).toBeVisible();
}

async function editClientThroughUi(page: Page, account: Account) {
  await openSection(page, "Clients");
  await page.getByRole("button", { name: /Edit client/ }).click();
  const sheet = page.getByRole("dialog", { name: "Edit client" });
  await expect(sheet.getByRole("heading", { name: "Edit client" })).toBeVisible();
  await sheet.getByLabel("Client name").fill(account.editedClientName);
  await sheet.getByLabel("Company").fill("Stage4 Studio revised");
  await sheet.getByLabel("Note").fill("Renamed through the browser, then reloaded.");
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByText("Client updated", { exact: true })).toBeVisible(writeConfirmed);
}

async function editReceivableThroughUi(page: Page, account: Account) {
  await openSection(page, "Today");
  await page.getByRole("button", { name: /Edit details/ }).click();
  const sheet = page.getByRole("dialog", { name: "Edit receivable details" });
  await expect(sheet.getByRole("heading", { name: "Edit receivable details" })).toBeVisible();
  await sheet.getByLabel("What is this for?").fill(account.editedLabel);
  await sheet.getByLabel("Note").fill("Reference corrected after the client asked for it.");
  await page.getByRole("button", { name: "Save details" }).click();
  await expect(page.getByText("Details updated", { exact: true })).toBeVisible(writeConfirmed);
}

function ledgerCard(page: Page) {
  return page.getByRole("article");
}

function clientRows(page: Page) {
  return page.locator(".client-row");
}

test.describe("Stage 4 persistence and safe editing in a real browser", () => {
  test.skip(!localStackEnabled, "Set STAGE4_LOCAL_E2E=1 to run against the local Supabase stack.");

  const owner = newAccount("owner");
  const stranger = newAccount("stranger");
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(workspaceSetup);
    context = await browser.newContext();
    page = await context.newPage();
    await signUp(page, owner);
    await addClientThroughUi(page, owner);
    await addReceivableThroughUi(page, owner);
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test("the journey really created the record it goes on to edit", async () => {
    await expect(ledgerCard(page).getByText(owner.receivableLabel, { exact: false }).first()).toBeVisible();
  });

  test("editing a client keeps its money and history context untouched", async () => {
    await editClientThroughUi(page, owner);
    await expect(page.getByText(owner.editedClientName, { exact: false }).first()).toBeVisible();
    await expect(page.getByText(owner.clientName, { exact: false })).toHaveCount(0);
    // The relationship's money facts survive a wording edit.
    await expect(page.getByText("₹1,800", { exact: false }).first()).toBeVisible();
    await expect(clientRows(page)).toHaveCount(1);
  });

  test("the receivable edit sheet offers wording fields and refuses to offer money fields", async () => {
    await openSection(page, "Today");
    await page.getByRole("button", { name: /Edit details/ }).click();
    const sheet = page.getByRole("dialog", { name: "Edit receivable details" });
    await expect(sheet.getByRole("heading", { name: "Edit receivable details" })).toBeVisible();

    await expect(sheet.getByLabel("What is this for?")).toBeVisible();
    await expect(sheet.getByLabel("Invoice or reference")).toBeVisible();
    await expect(sheet.getByLabel("Note")).toBeVisible();
    // The money, the date, and the owning client are shown for context and are
    // not inputs at all — a customer cannot rewrite financial history here.
    await expect(sheet.getByText("Amount due", { exact: true })).toBeVisible();
    await expect(sheet.getByText("₹1,800", { exact: true })).toBeVisible();
    await expect(sheet.getByText("Due date", { exact: true })).toBeVisible();
    await expect(sheet.getByText("Client", { exact: true })).toBeVisible();
    await expect(sheet.getByText(/stay exactly as they were/i)).toBeVisible();
    await expect(sheet.locator("input[type='number'], input[type='date'], select")).toHaveCount(0);
    await expect(sheet.locator("input, textarea, select")).toHaveCount(3);
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(sheet).toHaveCount(0);
  });

  test("editing receivable details leaves the amount and due date intact", async () => {
    await editReceivableThroughUi(page, owner);
    await expect(page.getByText(owner.editedLabel, { exact: false }).first()).toBeVisible();
    await expect(page.getByText("₹1,800", { exact: false }).first()).toBeVisible();
    await expect(page.getByText(owner.receivableLabel, { exact: false })).toHaveCount(0);
  });

  test("a reload re-reads both edits from the database", async () => {
    await page.reload();
    await expect(page.getByLabel("Primary navigation")).toBeVisible();
    await expect(page.getByText(owner.editedClientName, { exact: false }).first()).toBeVisible();
    await expect(page.getByText(owner.editedLabel, { exact: false }).first()).toBeVisible();
  });

  test("signing out and back in returns the same persisted records", async () => {
    await signOut(page);
    await signIn(page, owner);
    await expect(page.getByText(owner.editedClientName, { exact: false }).first()).toBeVisible();
    await expect(page.getByText(owner.editedLabel, { exact: false }).first()).toBeVisible();
    await expect(ledgerCard(page)).toHaveCount(1);
  });

  test("no private ledger data is kept in browser storage", async () => {
    const stored = await page.evaluate(() => ({
      local: Object.entries(localStorage),
      session: Object.entries(sessionStorage),
    }));
    const haystack = JSON.stringify(stored);
    for (const secret of [owner.editedClientName, owner.editedLabel, owner.clientName, owner.receivableLabel]) {
      expect(haystack, `ledger content leaked into web storage: ${secret}`).not.toContain(secret);
    }
    expect(stored.session).toHaveLength(0);
  });

  test("a second account never sees the edit surface or the edited names", async () => {
    // This test signs a whole second workspace up through the form, so it carries the
    // setup budget the suite's 30s global could not hold: measured 32.2s under battery load
    // against 5.8-7.1s in isolation.
    test.setTimeout(workspaceSetup);
    const other = await context.browser()!.newContext();
    const otherPage = await other.newPage();
    await signUp(otherPage, stranger);
    await expect(otherPage.getByText(owner.editedClientName, { exact: false })).toHaveCount(0);
    await expect(otherPage.getByText(owner.editedLabel, { exact: false })).toHaveCount(0);
    await openSection(otherPage, "Clients");
    await expect(otherPage.getByRole("button", { name: /Edit client/ })).toHaveCount(0);
    await openSection(otherPage, "Today");
    await expect(otherPage.getByRole("button", { name: /Edit details/ })).toHaveCount(0);
    await other.close();
  });
});

test.describe("Stage 4 concurrent edits through the real screens", () => {
  test.skip(!localStackEnabled, "Set STAGE4_LOCAL_E2E=1 to run against the local Supabase stack.");
  // Stated rather than inherited, and measured twice: these two tests reload four
  // times across two tabs of one browser context, and they came in at 9.9s then 28.3s
  // and 6.3s then 16.2s on the same machine with nothing else running. The 30s global
  // was therefore a coin toss once the battery put Stage 5's suites in front of them on
  // the same worker. The retry count stays at zero, because a timeout that clears on a
  // second attempt would hide exactly the stall this suite is here to catch.
  //
  // This 60s covers the test bodies only. It provably never reached the setup below:
  // the battery killed this suite with `"beforeAll" hook timeout of 30000ms exceeded`,
  // because Playwright arms every `beforeAll` with `project.timeout`
  // (playwright@1.62.1 workerProcessEntry.js:1759, `const timeSlot = { timeout:
  // this._project.project.timeout, elapsed: 0 }`). A previous revision of this comment
  // claimed the raise made the run "answer a question instead of timing out"; it did not,
  // and the claim is corrected here rather than repeated. The hook gets its own budget via
  // `test.setTimeout` inside its body, which the same source line shows is what arms a hook.
  test.describe.configure({ timeout: 60_000 });

  const account = newAccount("owner");
  let context: BrowserContext;
  let first: Page;
  let second: Page;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(workspaceSetup);
    context = await browser.newContext();
    first = await context.newPage();
    await signUp(first, account);
    await addClientThroughUi(first, account);
    // A second tab on the same account is the ordinary way a person ends up
    // holding a copy of a record that has already moved on.
    second = await context.newPage();
    await second.goto("/");
    await expect(second.getByLabel("Primary navigation")).toBeVisible();
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test("the stale tab is refused, keeps its typed text, and never overwrites or duplicates", async () => {
    for (const tab of [first, second]) {
      await openSection(tab, "Clients");
      await expect(tab.getByRole("button", { name: /Edit client/ })).toBeVisible();
    }
    await first.getByRole("button", { name: /Edit client/ }).click();
    await first.getByRole("dialog", { name: "Edit client" }).getByLabel("Client name").fill(`${account.clientName} (tab one)`);
    await first.getByRole("button", { name: "Save changes" }).click();
    await expect(first.getByText("Client updated", { exact: true })).toBeVisible(writeConfirmed);

    await second.getByRole("button", { name: /Edit client/ }).click();
    const sheet = second.getByRole("dialog", { name: "Edit client" });
    await expect(sheet.getByLabel("Client name")).not.toHaveValue(`${account.clientName} (tab one)`);
    await sheet.getByLabel("Client name").fill(`${account.clientName} (tab two)`);
    await second.getByRole("button", { name: "Save changes" }).click();

    // Both tabs were opened from the same read, so the second save carries the
    // older token. The refusal must be calm, must keep the form open with the
    // text intact, and must not silently take the newer value down.
    await expect(second.getByText(/changed while you were editing/i)).toBeVisible();
    await expect(sheet.getByRole("heading", { name: "Edit client" })).toBeVisible();
    await expect(sheet.getByLabel("Client name")).toHaveValue(`${account.clientName} (tab two)`);
    await expect(second.getByText(/row-level security|permission denied|SQLSTATE|40001|P0002/i)).toHaveCount(0);

    await second.reload();
    await openSection(second, "Clients");
    await expect(clientRows(second), "a refused edit must not create a second client").toHaveCount(1);
    await expect(second.getByText(`${account.clientName} (tab two)`, { exact: false })).toHaveCount(0);
    await expect(second.getByText(`${account.clientName} (tab one)`, { exact: false }).first()).toBeVisible();
  });

  test("resubmitting the same form after a refusal saves once and duplicates nothing", async () => {
    await second.getByRole("button", { name: /Edit client/ }).click();
    await second.getByRole("dialog", { name: "Edit client" }).getByLabel("Client name").fill(`${account.clientName} settled`);
    await second.getByRole("button", { name: "Save changes" }).click();
    await expect(second.getByText("Client updated", { exact: true })).toBeVisible(writeConfirmed);

    await second.reload();
    await openSection(second, "Clients");
    await expect(clientRows(second)).toHaveCount(1);
    await expect(second.getByText(`${account.clientName} settled`, { exact: false }).first()).toBeVisible();

    await first.reload();
    await openSection(first, "Clients");
    await expect(clientRows(first)).toHaveCount(1);
    await expect(first.getByText(`${account.clientName} settled`, { exact: false }).first()).toBeVisible();
  });
});
