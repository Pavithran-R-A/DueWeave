import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { completeWorkspaceSetup, setupHeading } from "./workspace-setup";

// DUEWEAVE CURRENT ROADMAP STAGE 6 — the workspace gate, the one setup screen, and
// the validation behind it.
//
// Qualified against the repository's own local Supabase Docker stack only. Run
// with STAGE6_LOCAL_E2E=1 after `pnpm supabase:start`, a local db reset, and a
// build served at http://127.0.0.1:3000.
//
// Every account here is created by typing into the app's own sheets, and setup is
// completed by typing into the setup screen. Nothing writes to the database from
// the test, nothing flips a feature flag, and the "is this workspace set up?"
// question is answered by the server on every one of these journeys.
const localStackEnabled = process.env.STAGE6_LOCAL_E2E === "1";

// The gate is a narrative: a new account is created, refused, named, and then
// re-opened from a browser that has never seen it. Splitting that across parallel
// workers would hand each test its own half-finished story.
test.describe.configure({ mode: "serial" });

type Account = {
  email: string;
  password: string;
  /** What Auth metadata is seeded with at signup — Stage 6 must not render this. */
  seedName: string;
  displayName: string;
  businessName: string;
};

function newAccount(role: string): Account {
  const token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return {
    email: `stage6gate-${role}-${token}@dueweave.local`,
    password: `Stage6gate!${token}aA`,
    seedName: `Stage6 Seed ${token.slice(-6)}`,
    displayName: `Stage6 Owner ${token.slice(-6)}`,
    businessName: `Stage6 ${role} Studio ${token.slice(-6)}`,
  };
}

async function signUp(page: Page, account: Account) {
  await page.goto("/auth");
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Your name").fill(account.seedName);
  await page.getByLabel("Email address").fill(account.email);
  await page.getByLabel("Password").fill(account.password);
  await page.getByRole("button", { name: "Create my workspace" }).click();
}

async function signIn(page: Page, account: Account) {
  await page.goto("/auth");
  await page.getByLabel("Email address").fill(account.email);
  await page.getByLabel("Password").fill(account.password);
  await page.getByRole("button", { name: "Sign in" }).click();
}

/** The only browser-storage keys the product is allowed to own. */
async function storageKeys(page: Page) {
  return page.evaluate(() => Object.keys(window.localStorage));
}

/** The value the settings screen shows for one labelled fact about this account. */
function identityValue(page: Page, label: string) {
  return page.locator(".identity-row").filter({ has: page.getByText(label, { exact: true }) }).locator("strong");
}

test.describe("Stage 6 workspace gate for a first user", () => {
  test.skip(!localStackEnabled, "Set STAGE6_LOCAL_E2E=1 to run against the local Supabase stack.");

  const account = newAccount("gate");
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext();
    page = await context.newPage();
    await signUp(page, account);
    // A fresh signup is the legacy shape Stage 6 has to catch: Auth has a display
    // name, the profile row has no business name. That account must be asked.
    await expect(page.getByRole("heading", { name: setupHeading })).toBeVisible({ timeout: 20_000 });
    await expect(page).toHaveURL(/\/onboarding$/);
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test("a signed-out browser can open neither the setup screen nor the ledger", async ({ page: fresh }) => {
    await fresh.goto("/onboarding");
    await expect(fresh).toHaveURL(/\/auth$/);
    await expect(fresh.getByRole("heading", { name: setupHeading })).toHaveCount(0);
    await expect(fresh.getByRole("heading", { name: "Your follow-ups, in one calm place." })).toBeVisible();

    await fresh.goto("/");
    await expect(fresh).toHaveURL(/\/auth$/);
    await expect(fresh.getByRole("heading", { name: setupHeading })).toHaveCount(0);
  });

  test("navigating straight to the ledger address does not skip setup", async () => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/onboarding$/);
    await expect(page.getByRole("heading", { name: setupHeading })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Today", exact: true })).toHaveCount(0);
  });

  test("refresh holds the gate, and nothing in browser storage decides it", async () => {
    await page.reload();
    await expect(page.getByRole("heading", { name: setupHeading })).toBeVisible();
    await expect(page).toHaveURL(/\/onboarding$/);

    // The setup answer lives in the profile row. The only thing this browser holds
    // is its own session token, so a "done" flag could not exist here even by accident.
    const keys = await storageKeys(page);
    for (const key of keys) {
      expect(key, `unexpected browser-storage key: ${key}`).toMatch(/^(sb-[\w.-]*auth-token|dueweave-theme)$/);
    }
    expect(keys.some((key) => /onboard|setup|complete|welcome/i.test(key))).toBe(false);
  });

  test("setup asks only for the two names it saves and shows the rest as fixed facts", async () => {
    await expect(page.getByLabel("Your name")).toBeVisible();
    await expect(page.getByLabel("Business or workspace name")).toBeVisible();
    await expect(page.getByRole("textbox")).toHaveCount(2);
    await expect(page.getByRole("combobox")).toHaveCount(0);
    await expect(page.getByRole("spinbutton")).toHaveCount(0);
    await expect(page.getByRole("region", { name: "Defaults DueWeave has already chosen" })).toBeVisible();
    await expect(page.getByText("Indian rupee · INR")).toBeVisible();
    await expect(page.getByText("India · Asia/Kolkata")).toBeVisible();

    await completeWorkspaceSetup(page, account);

    // The persisted profile is now the only name source in the product: the value
    // Auth was seeded with at signup appears nowhere.
    await expect(page.getByLabel("Primary navigation").getByText(account.displayName)).toBeVisible();
    await expect(page.getByLabel("Primary navigation").getByText(account.businessName)).toBeVisible();
    await expect(page.getByText(account.seedName, { exact: false })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Make the next conversation easier." })).toBeVisible();

    // The same two names, read from the row, are what the settings screen reports —
    // paired with their labels, so a name shown in the wrong row would fail here.
    await page.getByLabel("Primary navigation").getByRole("button", { name: "More" }).click();
    await expect(page.getByRole("heading", { name: "Who this ledger belongs to." })).toBeVisible();
    await expect(identityValue(page, "Your name")).toHaveText(account.displayName);
    await expect(identityValue(page, "Business or workspace")).toHaveText(account.businessName);
    await expect(identityValue(page, "Sign-in email")).toHaveText(account.email);
    await expect(page.getByText(account.seedName, { exact: false })).toHaveCount(0);
    await page.getByLabel("Primary navigation").getByRole("button", { name: "Today" }).click();
  });

  test("the saved answer survives refresh, sign-out, sign-in and a brand-new browser", async () => {
    await page.reload();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole("heading", { name: setupHeading })).toHaveCount(0);
    await expect(page.getByLabel("Primary navigation").getByText(account.businessName)).toBeVisible();

    await page.getByLabel("Primary navigation").getByRole("button", { name: "More" }).click();
    await page.getByRole("button", { name: /Sign out/ }).click();
    await expect(page).toHaveURL(/\/auth$/, { timeout: 15_000 });

    await signIn(page, account);
    await expect(page).toHaveURL(/\/$/, { timeout: 20_000 });
    await expect(page.getByRole("heading", { name: setupHeading })).toHaveCount(0);
    await expect(page.getByLabel("Primary navigation").getByText(account.displayName)).toBeVisible();

    // A context with no cookies, no storage and no cache is the only honest proof
    // that completion is a server fact rather than something this device remembered.
    const elsewhere = await context.browser()!.newContext();
    const secondDevice = await elsewhere.newPage();
    await signIn(secondDevice, account);
    await expect(secondDevice).toHaveURL(/\/$/, { timeout: 20_000 });
    await expect(secondDevice.getByRole("heading", { name: setupHeading })).toHaveCount(0);
    await expect(secondDevice.getByLabel("Primary navigation").getByText(account.businessName)).toBeVisible();
    for (const key of await storageKeys(secondDevice)) {
      expect(key, `unexpected browser-storage key: ${key}`).toMatch(/^(sb-[\w.-]*auth-token|dueweave-theme)$/);
    }
    await elsewhere.close();
  });
});

test.describe("Stage 6 workspace setup validation", () => {
  test.skip(!localStackEnabled, "Set STAGE6_LOCAL_E2E=1 to run against the local Supabase stack.");

  const account = newAccount("guard");
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext();
    page = await context.newPage();
    await signUp(page, account);
    await expect(page.getByRole("heading", { name: setupHeading })).toBeVisible({ timeout: 20_000 });
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test("refuses blank and whitespace-only names without closing the form", async () => {
    const submit = page.getByRole("button", { name: "Continue to your ledger" });
    await submit.click();

    await expect(page.getByRole("alert")).toHaveText([
      "Add your name so the ledger knows who it is greeting.",
      "Add a business or workspace name.",
    ]);
    await expect(page).toHaveURL(/\/onboarding$/);
    await expect(page.getByLabel("Your name")).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByLabel("Business or workspace name")).toHaveAttribute("aria-invalid", "true");

    await page.getByLabel("Your name").fill("   ");
    await page.getByLabel("Business or workspace name").fill("   ");
    await submit.click();
    await expect(page.getByRole("alert")).toHaveText([
      "Add your name so the ledger knows who it is greeting.",
      "Add a business or workspace name.",
    ]);
  });

  test("refuses a business name past the real database limit and keeps what was typed", async () => {
    const tooLong = `${account.businessName}${"x".repeat(160)}`;
    await page.getByLabel("Your name").fill(account.displayName);
    await page.getByLabel("Business or workspace name").fill(tooLong);
    await page.getByRole("button", { name: "Continue to your ledger" }).click();

    await expect(page.getByRole("alert")).toHaveText([`Keep your business name under 160 characters.`]);
    await expect(page.getByLabel("Business or workspace name")).toHaveValue(tooLong);
    await expect(page.getByLabel("Your name")).toHaveValue(account.displayName);
    await expect(page).toHaveURL(/\/onboarding$/);
    await expect(page.locator("body")).not.toContainText(/PGRST|postgrest|SQLSTATE|permission denied|23505|42501|40001|P0002/i);
  });

  test("saves exactly once, then reads the stored names back from the server", async ({ browser }) => {
    const patches: string[] = [];
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    // Holding the write open is what makes the double-submit proof deterministic:
    // the second click has to be refused while the first is still in flight, not
    // by luck of how fast the local stack answers.
    await page.route((url) => url.pathname.endsWith("/rest/v1/profiles"), async (route) => {
      if (route.request().method() === "PATCH") {
        patches.push(route.request().postData() ?? "");
        await held;
      }
      await route.continue();
    });

    // The control changes its own label while the write is in flight, so it is
    // located by its identity in the form rather than by its momentary text.
    const submit = page.locator("button.onboarding-submit");
    await page.getByLabel("Your name").fill(account.displayName);
    await page.getByLabel("Business or workspace name").fill(account.businessName);
    await expect(submit).toHaveText("Continue to your ledger");
    await submit.click();
    await expect(submit).toHaveText("Saving…");
    await expect(submit).toBeDisabled();
    await submit.click({ force: true });
    await expect.poll(() => patches.length).toBe(1);
    expect(JSON.parse(patches[0]!)).toEqual({ display_name: account.displayName, business_name: account.businessName });
    release();

    await expect(page).toHaveURL(/\/$/, { timeout: 20_000 });
    await expect(page.getByLabel("Primary navigation").getByText(account.businessName)).toBeVisible();
    await page.unroute((url) => url.pathname.endsWith("/rest/v1/profiles"));

    // "It saved" is only proven by a fresh read: a reload re-queries the row, and a
    // browser that never had this session gets the same two names.
    await page.reload();
    await expect(page.getByLabel("Primary navigation").getByText(account.displayName)).toBeVisible();
    await expect(page.getByLabel("Primary navigation").getByText(account.businessName)).toBeVisible();
    await expect(page.getByRole("heading", { name: setupHeading })).toHaveCount(0);

    const elsewhere = await browser.newContext();
    const reader = await elsewhere.newPage();
    await signIn(reader, account);
    await expect(reader).toHaveURL(/\/$/, { timeout: 20_000 });
    await expect(reader.getByLabel("Primary navigation").getByText(account.displayName)).toBeVisible();
    await elsewhere.close();
  });
});

test.describe("Stage 6 routes that lead nowhere still lead somewhere honest", () => {
  test.skip(!localStackEnabled, "Set STAGE6_LOCAL_E2E=1 to run against the local Supabase stack.");

  const account = newAccount("route");
  let context: BrowserContext;
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext();
    page = await context.newPage();
    await signUp(page, account);
    await expect(page.getByRole("heading", { name: setupHeading })).toBeVisible({ timeout: 20_000 });
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test("an unknown address says so, and its way home is the sign-in screen", async ({ page: fresh }) => {
    await fresh.goto("/this-page-does-not-exist");
    await expect(fresh.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await expect(fresh.getByText("404")).toBeVisible();
    // The 404 is the only thing on the screen: no navigation, no amounts, no names.
    await expect(fresh.getByLabel("Primary navigation")).toHaveCount(0);

    await fresh.getByRole("button", { name: "Return to DueWeave" }).click();
    // One hop, to the sign-in screen, and it stays there: the guard moves an
    // unauthenticated browser off "/" and nothing sends it back again.
    await expect(fresh).toHaveURL(/\/auth$/, { timeout: 15_000 });
    await expect(fresh.getByRole("heading", { name: "Your follow-ups, in one calm place." })).toBeVisible();
    await fresh.waitForTimeout(1_500);
    await expect(fresh).toHaveURL(/\/auth$/);
  });

  test("a typed path cannot walk past the setup gate", async () => {
    await page.goto("/today/receivables/secret");
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await expect(page.getByLabel("Primary navigation")).toHaveCount(0);
    await expect(page.getByText(account.seedName, { exact: false })).toHaveCount(0);

    await page.getByRole("button", { name: "Return to DueWeave" }).click();
    // Home for this signed-in account is the setup screen it has not finished,
    // which is the gate doing its job rather than a ledger appearing by accident.
    await expect(page).toHaveURL(/\/onboarding$/, { timeout: 15_000 });
    await expect(page.getByRole("heading", { name: setupHeading })).toBeVisible();
  });

  test("the founder screens keep their own door shut for a signed-out browser", async ({ page: fresh }) => {
    for (const path of ["/founder", "/admin/founder-claims"]) {
      await fresh.goto(path);
      await expect(fresh).toHaveURL(/\/auth$/, { timeout: 15_000 });
      await expect(fresh.getByRole("heading", { name: "Your follow-ups, in one calm place." })).toBeVisible();
      await expect(fresh.getByLabel("Primary navigation")).toHaveCount(0);
      await expect(fresh.locator("body")).not.toContainText(/PGRST|postgrest|SQLSTATE|permission denied|42501|40001/i);
    }
  });
});
