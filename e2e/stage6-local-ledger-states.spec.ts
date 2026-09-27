import { expect, test, type Page, type Route } from "@playwright/test";
import { completeWorkspaceSetup } from "./workspace-setup";

// Stage 6 Phases 16-18 and 20: what the ledger does while the network is doing
// something. Each case holds, fails or restores real requests against the local
// Supabase stack, so the assertions are about the screen a first user would see —
// not about a component rendered in isolation.
const localStackEnabled = process.env.STAGE6_LOCAL_E2E === "1";

type Account = { email: string; password: string; displayName: string; businessName: string; token: string };

function newAccount(role: string): Account {
  const token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return {
    token,
    email: `stage6state-${role}-${token}@dueweave.local`,
    password: `Stage6state!${token}aA`,
    displayName: `Stage6 ${role} Owner`,
    businessName: `Stage6 ${role} Studio ${token.slice(-6)}`,
  };
}

const LEDGER_TABLES = "/rest/v1/(receivables|clients|promises|payments|activities)";
const OUTSTANDING = ".money-hero__copy strong";

/** Every read the dashboard performs, plus the settlement write that precedes it. */
function isLedgerRead(url: URL) {
  return new RegExp(`^${LEDGER_TABLES}$`).test(url.pathname) || url.pathname === "/rest/v1/rpc/mark_due_promises_broken";
}

async function signUp(page: Page, account: Account) {
  await page.goto("/auth");
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Your name").fill(account.displayName);
  await page.getByLabel("Email address").fill(account.email);
  await page.getByLabel("Password").fill(account.password);
  await page.getByRole("button", { name: "Create my workspace" }).click();
  await completeWorkspaceSetup(page, account);
}

async function addClient(page: Page, name: string) {
  await page.getByRole("button", { name: /Add a client first|Add another client|Add client$/ }).first().click();
  await page.getByLabel("Client name").fill(name);
  await page.getByRole("button", { name: "Save client" }).click();
  await expect(page.getByText("Client added", { exact: true })).toBeVisible();
}

async function addReceivable(page: Page, account: Account, needle: string, label: string, amount: string) {
  await page.getByRole("button", { name: "Add receivable" }).first().click();
  await page.getByRole("button", { name: "Existing client" }).click();
  await page.getByLabel("Search existing clients").fill(needle);
  await page.getByRole("option", { name: new RegExp(needle) }).click();
  await page.getByLabel("Amount").fill(amount);
  await page.getByLabel("Due date").fill("2026-10-20");
  await page.getByLabel("What is this for?").fill(label);
  await page.getByRole("button", { name: "Save receivable" }).click();
  await expect(page.getByText("Receivable added", { exact: true }).first()).toBeVisible();
}

/**
 * A success toast and the timeline entry it just created deliberately say the same
 * thing, so the toast is asserted where it lives rather than anywhere on the page.
 */
function toast(page: Page, title: string) {
  return page.getByRole("region", { name: /Notifications/ }).getByText(title, { exact: true });
}

test.describe("Stage 6 loading, refresh and failure behaviour", () => {
  test.skip(!localStackEnabled, "Set STAGE6_LOCAL_E2E=1 to run against the local Supabase stack.");

  test("keeps the workspace on screen while a post-save refresh is on the wire", async ({ page }) => {
    test.slow();
    const account = newAccount("refresh");
    await signUp(page, account);
    await addClient(page, `Stage6 Refresh client ${account.token.slice(-6)}`);
    await addReceivable(page, account, account.token.slice(-6), `Stage6 Refresh invoice ${account.token.slice(-6)}`, "1800");

    const outstanding = page.locator(OUTSTANDING);
    await expect(outstanding).toHaveText("₹1,800");

    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const reads: string[] = [];
    const writes: string[] = [];
    // Holding only the reads is what proves the point: the payment itself has
    // already been accepted, and what follows must not empty the screen.
    await page.route("**/rest/v1/rpc/record_payment", (route) => {
      writes.push(route.request().url());
      return route.continue();
    });
    await page.route(new RegExp(`^http://127\\.0\\.0\\.1:54321${LEDGER_TABLES}(\\?.*)?$`), async (route: Route) => {
      reads.push(route.request().url());
      await held;
      await route.continue();
    });

    await page.getByRole("button", { name: "Record payment" }).click();
    const sheet = page.getByRole("dialog", { name: "Record payment" });
    await sheet.getByLabel("Amount").fill("800");
    await sheet.getByRole("button", { name: "Record payment" }).click();

    await expect.poll(() => writes.length).toBe(1);
    await expect.poll(() => reads.length).toBeGreaterThan(0);
    // The re-read is still on the wire and the workspace is intact: no structural
    // loading screen, and the region announces that it is busy rather than gone.
    await expect(outstanding).toHaveText("₹1,800");
    await expect(page.getByRole("heading", { name: "Preparing your follow-up brief" })).toHaveCount(0);
    await expect(page.locator('main[aria-busy="true"]')).toBeVisible();

    release();
    await expect(toast(page, "Payment recorded")).toBeVisible({ timeout: 20_000 });
    await expect(outstanding).toHaveText("₹1,000", { timeout: 20_000 });
    await expect(page.locator('main[aria-busy="true"]')).toHaveCount(0);
  });

  test("waits quietly for a slow first ledger read, then shows the real data", async ({ page }) => {
    const account = newAccount("initial");
    await signUp(page, account);

    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route(new RegExp(`^http://127\\.0\\.0\\.1:54321${LEDGER_TABLES}(\\?.*)?$`), async (route) => {
      await held;
      await route.continue();
    });

    await page.reload();
    const loading = page.getByRole("status");
    await expect(loading.getByText("Preparing your follow-up brief")).toBeVisible();
    await expect(page.getByRole("button", { name: "Add first receivable" })).toHaveCount(0);

    release();
    await expect(page.getByText("Preparing your follow-up brief")).toBeHidden({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Add first receivable" })).toBeVisible();
  });

  test("holds the gate, not the ledger, while a slow profile read is in flight", async ({ page }) => {
    const account = newAccount("profile");
    await signUp(page, account);
    await page.getByLabel("Primary navigation").getByRole("button", { name: "More" }).click();
    await page.getByRole("button", { name: /Sign out/ }).click();
    await expect(page).toHaveURL(/\/auth$/, { timeout: 15_000 });

    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const profileReads: string[] = [];
    await page.route("**/rest/v1/profiles?*", async (route) => {
      profileReads.push(route.request().url());
      await held;
      await route.continue();
    });

    await page.goto("/auth");
    await page.getByLabel("Email address").fill(account.email);
    await page.getByLabel("Password").fill(account.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();

    // The wait belongs to the gate: no ledger chrome and no onboarding form until the
    // profile answer arrives, and no error for simply being slow.
    await expect.poll(() => profileReads.length).toBeGreaterThan(0);
    await expect(page.getByText("Opening your private ledger…")).toBeVisible();
    await expect(page.getByLabel("Primary navigation")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Set up your private ledger." })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Your private ledger remains protected." })).toHaveCount(0);

    release();
    await expect(page).toHaveURL(/\/$/, { timeout: 20_000 });
    await expect(page.getByLabel("Primary navigation")).toBeVisible();
  });

  test("recovers a real ledger through the retry control without reloading the page", async ({ page }) => {
    test.slow();
    const account = newAccount("retry");
    await signUp(page, account);
    await addClient(page, `Stage6 Retry client ${account.token.slice(-6)}`);
    await addReceivable(page, account, account.token.slice(-6), `Stage6 Retry invoice ${account.token.slice(-6)}`, "2500");

    await page.route("**/rest/v1/**", (route) => (isLedgerRead(new URL(route.request().url())) ? route.abort() : route.continue()));
    await page.reload();

    await expect(page.getByRole("heading", { name: "Your private ledger remains protected." })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
    await expect(page.getByText("Stage6 Retry invoice")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText(/PGRST|SQLSTATE|failed to fetch|policy|constraint/i);

    // Set after the failed load, so the value can only survive if the retry re-reads
    // inside this same document instead of quietly reloading the page.
    await page.evaluate(() => {
      (window as unknown as { stage6Document?: string }).stage6Document = "this document";
    });

    await page.unroute("**/rest/v1/**");
    await page.getByRole("button", { name: "Try again" }).click();

    await expect(page.getByText("Stage6 Retry invoice", { exact: false }).first()).toBeVisible({ timeout: 20_000 });
    await expect(page.locator(OUTSTANDING)).toHaveText("₹2,500");
    // Retry is a re-read inside the same document, not a page reload in disguise.
    expect(await page.evaluate(() => (window as unknown as { stage6Document?: string }).stage6Document)).toBe("this document");
  });
});

test.describe("Stage 6 empty and filtered states", () => {
  test.skip(!localStackEnabled, "Set STAGE6_LOCAL_E2E=1 to run against the local Supabase stack.");

  test("says what is missing instead of repeating the first-run card", async ({ page }) => {
    test.slow();
    const account = newAccount("empty");
    const needle = account.token.slice(-6);

    // A: nothing at all yet.
    await signUp(page, account);
    await expect(page.getByRole("heading", { name: "Make the next conversation easier." })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add a client first" })).toBeVisible();

    // B: the people are saved, the amounts are not, so the card stops pretending.
    await addClient(page, `Stage6 Empty client ${needle}`);
    await page.getByLabel("Primary navigation").getByRole("button", { name: /^Today/ }).click();
    await expect(page.getByRole("heading", { name: "Now add the amount you are waiting on." })).toBeVisible();
    await expect(page.getByText("One client is already saved.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Make the next conversation easier." })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Add a client first" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Add another client" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Add first receivable" })).toBeVisible();

    // C: work exists but nothing is due for attention today.
    await addReceivable(page, account, needle, `Stage6 Empty invoice ${needle}`, "1800");
    await page.getByRole("button", { name: "Snooze follow-up" }).first().click();
    await page.getByRole("dialog", { name: "Snooze follow-up" }).getByRole("button", { name: "Save snooze" }).click();
    await expect(toast(page, "Follow-up snoozed")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Nothing needs your attention today." })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Make the next conversation easier." })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Now add the amount you are waiting on." })).toHaveCount(0);

    // D: a filter with nothing in it is not an empty ledger.
    await page.getByLabel("Primary navigation").getByRole("button", { name: "Receivables" }).click();
    await page.getByRole("tab", { name: "Paid" }).click();
    await expect(page.getByRole("heading", { name: "No matches in this view." })).toBeVisible();
    await expect(page.getByText("No amount has been settled in full yet.")).toBeVisible();
    await page.getByRole("button", { name: /Show all history/ }).click();
    await expect(page.getByText(`Stage6 Empty invoice ${needle}`, { exact: false }).first()).toBeVisible();
  });
});
