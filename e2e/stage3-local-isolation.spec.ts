import { expect, test, type Page } from "@playwright/test";
import { completeWorkspaceSetup } from "./workspace-setup";

// Qualified against the repository's own local Supabase Docker stack only.
// Run with STAGE3_LOCAL_E2E=1 after `pnpm supabase:start`, a local db reset,
// and a dev/preview server built against the local browser-safe config.
//
// Every claim below is proven through the paths a real browser uses: two
// isolated contexts, two accounts signed up through the UI, and the app's own
// repositories and routes. No credential, key or service-role request appears
// in this file — tests/stage3-local-rls.test.ts covers the API-shaped probes,
// and this spec covers what a second human being can actually see on screen.
const localStackEnabled = process.env.STAGE3_LOCAL_E2E === "1";

type Account = {
  role: string;
  displayName: string;
  businessName: string;
  email: string;
  password: string;
  token: string;
  clientName: string;
  receivableLabel: string;
  amount: string;
};

function newAccount(role: "alpha" | "beta"): Account {
  const token = `${Date.now().toString(36).slice(-5)}${Math.random().toString(36).slice(2, 6)}`;
  return {
    role,
    displayName: `Stage3 ${role} Reviewer`,
    businessName: `Stage3 ${role} workspace ${token}`,
    email: `stage3-e2e-${role}-${token}@dueweave.local`,
    password: `Stage3-browser-${token}!`,
    token,
    clientName: `Stage3 ${role} client ${token}`,
    receivableLabel: `Stage3 ${role} invoice ${token}`,
    amount: role === "alpha" ? "1500" : "2600",
  };
}

async function signUp(page: Page, account: Account) {
  await page.goto("/auth");
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Your name").fill(account.displayName);
  await page.getByLabel("Email address").fill(account.email);
  await page.getByLabel("Password").fill(account.password);
  await page.getByRole("button", { name: "Create my workspace" }).click();
  await completeWorkspaceSetup(page, account);
  await expect(
    page.getByRole("heading", { name: "Make the next conversation easier." })
  ).toBeVisible();
}

async function seedLedgerThroughUi(page: Page, account: Account) {
  await page.getByRole("button", { name: "Add receivable" }).first().click();
  await expect(page.getByText("DueWeave never merges people by name.")).toBeVisible();
  await page.getByRole("button", { name: "New client" }).click();
  await page.getByLabel("Client name").fill(account.clientName);
  await page.getByLabel("Amount").fill(account.amount);
  await page.getByLabel("Due date").fill("2026-09-30");
  await page.getByLabel("What is this for?").fill(account.receivableLabel);
  await page.getByRole("button", { name: "Save receivable" }).click();
  await expect(page.getByText("Receivable added", { exact: true })).toBeVisible();
}

function visibleLedger(page: Page) {
  // The queue card is the only place an owner's open receivable is named.
  return page.getByRole("article");
}

async function expectNoTrace(page: Page, account: Account) {
  await expect(page.getByText(account.clientName, { exact: false })).toHaveCount(0);
  await expect(page.getByText(account.receivableLabel, { exact: false })).toHaveCount(0);
  await expect(page.getByText(account.email, { exact: false })).toHaveCount(0);
  await expect(page.getByText(account.businessName, { exact: false })).toHaveCount(0);
}

async function openSection(page: Page, section: "Receivables" | "Clients") {
  await page
    .getByLabel("Primary navigation")
    .getByRole("button", { name: section })
    .click();
  await expect(
    page.getByRole("heading", { name: section, exact: true }).first()
  ).toBeVisible();
}

test.describe("controlled Stage 3 two-account browser isolation", () => {
  test.skip(
    !localStackEnabled,
    "Set STAGE3_LOCAL_E2E=1 to run against the local Supabase stack."
  );
  // Stage 6 made every account here name its workspace through the setup screen
  // before it can be used, so the hook now drives two sign-ups, two setups and two
  // seeded ledgers. Measured on the local stack that is ~33s of real UI work, and
  // the 30s default was cutting the set-up short rather than the journey.
  test.describe.configure({ timeout: 90_000 });

  const alpha = newAccount("alpha");
  const beta = newAccount("beta");
  let pageAlpha: Page;
  let pageBeta: Page;
  let contextAlpha: import("@playwright/test").BrowserContext;
  let contextBeta: import("@playwright/test").BrowserContext;

  test.beforeAll(async ({ browser }) => {
    contextAlpha = await browser.newContext();
    contextBeta = await browser.newContext();
    pageAlpha = await contextAlpha.newPage();
    pageBeta = await contextBeta.newPage();
    await signUp(pageAlpha, alpha);
    await signUp(pageBeta, beta);
    await seedLedgerThroughUi(pageAlpha, alpha);
    await seedLedgerThroughUi(pageBeta, beta);
  });

  test.afterAll(async () => {
    await contextAlpha?.close();
    await contextBeta?.close();
  });

  test("each account's own ledger shows the record it created", async () => {
    await expect(
      visibleLedger(pageAlpha).getByText(alpha.clientName, { exact: false }).first()
    ).toBeVisible();
    await expect(
      visibleLedger(pageBeta).getByText(beta.clientName, { exact: false }).first()
    ).toBeVisible();
    await expect(visibleLedger(pageAlpha)).toHaveCount(1);
    await expect(visibleLedger(pageBeta)).toHaveCount(1);
  });

  test("the second account sees none of the first account's records on any screen", async () => {
    await expectNoTrace(pageBeta, alpha);
    await expect(visibleLedger(pageBeta)).toHaveCount(1);

    await openSection(pageBeta, "Receivables");
    await expectNoTrace(pageBeta, alpha);
    await expect(
      pageBeta.getByText(beta.clientName, { exact: false }).first()
    ).toBeVisible();

    await openSection(pageBeta, "Clients");
    await expectNoTrace(pageBeta, alpha);
    await expect(
      pageBeta.getByRole("button", { name: beta.clientName, exact: false })
    ).toHaveCount(1);
    await expect(
      pageBeta.getByRole("button", { name: alpha.clientName, exact: false })
    ).toHaveCount(0);

    await expectNoTrace(pageAlpha, beta);
    await openSection(pageAlpha, "Clients");
    await expectNoTrace(pageAlpha, beta);
    await expect(
      pageAlpha.getByRole("button", { name: alpha.clientName, exact: false })
    ).toHaveCount(1);
  });

  test("the client picker cannot even discover the other account's client by name", async () => {
    await pageBeta
      .getByRole("button", { name: "Add receivable" })
      .first()
      .click();
    await pageBeta.getByRole("button", { name: "Existing client" }).click();
    await expect(
      pageBeta.getByRole("option", { name: new RegExp(beta.token) })
    ).toHaveCount(1);

    await pageBeta.getByLabel("Search existing clients").fill(alpha.token);
    await expect(
      pageBeta.getByText("No matching client. Choose New client to add one explicitly.")
    ).toBeVisible();
    await expect(pageBeta.getByRole("option")).toHaveCount(0);
    await pageBeta.getByRole("button", { name: "Cancel" }).click();
  });

  test("the Founder review surface stays closed to both signed-in accounts", async () => {
    for (const [page, account] of [
      [pageAlpha, alpha],
      [pageBeta, beta],
    ] as const) {
      await page.goto("/admin/founder-claims");
      await expect(
        page.getByRole("heading", { name: "Founder review is restricted." })
      ).toBeVisible();
      await expect(
        page.getByText("Founder review access is not available for this account.")
      ).toBeVisible();
      await expect(
        page.getByRole("heading", { name: "Review pending Founder claims." })
      ).toHaveCount(0);
      await expect(page.locator("article")).toHaveCount(0);
      await expect(page.getByText(account.email, { exact: false })).toHaveCount(0);
    }
  });

  test("an unauthenticated browser cannot open a private route, and signing out closes it again", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/auth$/);
    await expect(
      page.getByRole("heading", { name: "Your follow-ups, in one calm place." })
    ).toBeVisible();
    await expectNoTrace(page, alpha);
    await expectNoTrace(page, beta);

    await page.goto("/admin/founder-claims");
    await expect(page).toHaveURL(/\/auth$/);

    await pageBeta.goto("/");
    await expect(pageBeta.getByLabel("Primary navigation")).toBeVisible();
    await expectNoTrace(pageBeta, alpha);
    await pageBeta.getByLabel("Primary navigation").getByRole("button", { name: "More" }).click();
    await expect(
      pageBeta.getByRole("heading", { name: "A private ledger for the awkward middle." })
    ).toBeVisible();
    await pageBeta.getByRole("button", { name: /Sign out/ }).click();
    await expect(pageBeta).toHaveURL(/\/auth$/, { timeout: 15_000 });
    await expectNoTrace(pageBeta, alpha);
    await expectNoTrace(pageBeta, beta);
  });
});
