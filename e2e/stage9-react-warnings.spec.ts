// DUEWEAVE CURRENT ROADMAP STAGE 9 — PHASE 16, the React-warning half.
//
// The release battery drives the production bundle, and production React does not print
// warnings — it throws minified errors instead, which the watcher already fails on
// (`pageerror` is never excused). So the warning channel the plan asks for is measured
// against `vite dev`, on `playwright.react-warnings.config.ts`, by the same watcher and
// the same rule: any console error, any uncaught error, any request that never got an
// answer fails the run. There is deliberately no allowance regex in this file. If one
// ever appears here, the warning gate has been turned into a mute.
//
// What it covers is the set of React surfaces the release journeys actually render:
// the auth screen, onboarding, every section, every form sheet, the follow-up handoff,
// search with no matches, the profile edit, the fail-closed Founder page, the 404 screen,
// and a full sign-out / sign-in round trip.
//
// The restricted review screen is not visited: an ordinary account loading it has three
// queue reads refused by the database, and Chromium logs each refusal as a console error
// naming the URL. That traffic is proved, and excused by name, in
// `e2e/stage9-account-isolation.spec.ts`; excusing it a second time here would only make
// this gate quieter.

import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { completeWorkspaceSetup } from "./workspace-setup";
import { drainProblems, startProblemWatch, type ProblemWatch } from "./problem-watch";

const localStackEnabled = process.env.STAGE9_LOCAL_E2E === "1";
const runToken = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const tag = `dev${runToken.slice(-6)}`;

const account = {
  email: `stage9warn-${tag}@dueweave.local`,
  password: `Stage9warn!${tag}aA`,
  displayName: `Stage9 Warning Owner ${tag}`,
  businessName: `Stage9 Warning Studio ${tag}`,
  renamedBusiness: `Stage9 Warning Studio ${tag} Ltd`,
};

const client = { name: `Stage9 Warn Client ${tag}`, company: `Stage9 Warn Pictures ${tag}` };
const invoice = { title: `Stage9 warn shoot ${tag}`, reference: `S9W${tag.toUpperCase()}` };
const promiseNote = `Stage9 warn promised half ${tag}`;
const paymentReference = `STAGE9W${tag.toUpperCase()}`;

function businessDate(offset: number) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(Date.now() + offset * 86_400_000);
  const part = (kind: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === kind)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function nav(page: Page) {
  return page.getByLabel("Primary navigation");
}

async function openSection(page: Page, section: "Today" | "Receivables" | "Clients" | "More") {
  await nav(page).getByRole("button", { name: section }).filter({ visible: true }).first().click();
  await expect(page.locator(".app-content")).toBeVisible();
}

async function acknowledge(page: Page, title: string) {
  await expect(page.getByRole("region", { name: /Notifications/ }).getByText(title, { exact: true }).first()).toBeVisible({ timeout: 20_000 });
  await page.mouse.move(0, 0);
  await expect(page.getByRole("region", { name: /Notifications/ }).locator("li"), "the acknowledgement stack never left").toHaveCount(0, { timeout: 20_000 });
}

test.describe("Stage 9 React warnings, measured on the development build", () => {
  // Serial because the walk needs the account the first step created, on one page. The
  // timeout is declared before the conditional skip, which is the order this runner
  // honours it in — see e2e/stage9-account-isolation.spec.ts.
  test.describe.configure({ mode: "serial", timeout: 240_000 });
  test.skip(!localStackEnabled, "Set STAGE9_LOCAL_E2E=1 to run against the local Supabase stack.");

  let context: BrowserContext;
  let page: Page;
  let watch: ProblemWatch;

  test.beforeAll(async ({ browser }) => {
    context = await browser.newContext();
    page = await context.newPage();
    // wa.me is a third party an automated run must never reach.
    await page.addInitScript(() => {
      document.addEventListener(
        "click",
        (event) => {
          const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href^="https://wa.me/"]') : null;
          if (anchor) event.preventDefault();
        },
        true,
      );
    });
    watch = startProblemWatch(page);
  });

  test.afterAll(async () => {
    await context?.close();
  });

  // Draining per step keeps a warning attached to the screen that printed it.
  test.afterEach(() => {
    expect(drainProblems(watch)).toEqual([]);
  });

  test("the auth screen, an unknown route and signup render without a warning", async () => {
    await page.goto("/auth");
    await expect(page.getByRole("heading", { name: "Your follow-ups, in one calm place." })).toBeVisible({ timeout: 30_000 });
    await page.getByLabel("Email address").fill("not an address");
    await page.getByLabel("Password").fill(account.password);
    // Rejected before the server, on purpose: the field-error branch is conditional
    // markup that no other release step renders, and its copy is fixed in the product.
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("alert").getByText("That does not look like an email address yet.")).toBeVisible();
    await expect(page.getByLabel("Email address")).toHaveAttribute("aria-invalid", "true");

    await page.getByRole("button", { name: "Create an account" }).click();
    await page.getByLabel("Your name").fill(account.displayName);
    await page.getByLabel("Email address").fill(account.email);
    await page.getByLabel("Password").fill(account.password);
    await page.getByRole("button", { name: "Create my workspace" }).click();
    await completeWorkspaceSetup(page, account);
    // 30 s, not the default 5 s, for the same reason as the two other first paints here:
    // this is the first time the dev server resolves the lazily imported ledger screen, so
    // the wait covers unbundled module traffic as well as the profile read. Measured on one
    // code state: 1 of 4 runs sat on "Opening your private ledger…" past 5 s and 3 did not,
    // and CI cannot reuse a warm dev server (`reuseExistingServer: !process.env.CI`), so a
    // budget that only holds when the module graph is warm would report a defect that is not
    // there. A screen that genuinely never renders still fails — after 30 s.
    await expect(page.getByRole("heading", { name: "Make the next conversation easier." })).toBeVisible({ timeout: 30_000 });

    // The catch-all screen is React too, and it is the one screen no journey visits.
    await page.goto("/no-such-page");
    await expect(page.getByRole("heading", { name: "Page not found" })).toBeVisible();
    await page.getByRole("button", { name: "Return to DueWeave" }).click();
    await expect(nav(page)).toBeVisible();
  });

  test("every ledger screen, form sheet and quiet state renders without a warning", async () => {
    await openSection(page, "Today");
    await page.getByRole("button", { name: "Add first receivable" }).click();
    const receivable = page.getByRole("dialog", { name: "Add receivable" });
    await receivable.getByLabel("Client name").fill(client.name);
    await receivable.getByLabel("Company").fill(client.company);
    await receivable.getByLabel("Phone").fill("+91 90000 11111");
    await receivable.getByLabel("Amount").fill("7000");
    await receivable.getByLabel("Due date").fill(businessDate(-2));
    await receivable.getByLabel("What is this for?").fill(invoice.title);
    await receivable.getByLabel("Invoice or reference").fill(invoice.reference);
    await receivable.getByRole("button", { name: "Save receivable" }).click();
    await acknowledge(page, "Receivable added");

    await page.getByRole("button", { name: /Record new promise/ }).click();
    const promise = page.getByRole("dialog", { name: "Record a new promise" });
    await promise.getByLabel("Promised amount").fill("1000");
    await promise.getByLabel("Promised date").fill(businessDate(0));
    await promise.getByLabel("Source").selectOption("Call");
    await promise.getByLabel("Note").fill(promiseNote);
    await promise.getByRole("button", { name: "Keep this promise" }).click();
    await acknowledge(page, "Promise added");

    await page.getByRole("button", { name: "Record payment", exact: true }).click();
    const payment = page.getByRole("dialog", { name: "Record payment" });
    await payment.getByLabel("Amount").fill("1000");
    await payment.getByLabel("Date").fill(businessDate(0));
    await payment.getByLabel("Method").selectOption("UPI");
    await payment.getByLabel("Reference").fill(paymentReference);
    await payment.getByRole("button", { name: /^Record payment/ }).click();
    await acknowledge(page, "Payment recorded");

    // The follow-up sheet and its Escape dismissal, without the copy buttons: a
    // clipboard write needs a permission grant this context does not carry, and an
    // ungranted rejection would be a transport artefact rather than a React warning.
    await page.getByRole("button", { name: /^Follow up with / }).click();
    const handoff = page.getByRole("dialog", { name: "Choose the next message" });
    await expect(handoff).toBeVisible();
    const tone = handoff.getByRole("radiogroup", { name: "Message tone" });
    await tone.locator(".template-choice__option").nth(1).click();
    await expect(tone.locator(".template-choice__option").nth(1)).toHaveClass(/is-active/);
    await handoff.getByLabel(/Message to send/).fill(`Stage9 warn edited draft ${tag}`);
    await handoff.getByRole("button", { name: /Reset to suggested/ }).click();
    await expect(handoff.getByLabel(/Message to send/)).not.toHaveValue(`Stage9 warn edited draft ${tag}`);
    await expect(handoff.getByRole("link", { name: /WhatsApp/ })).toHaveAttribute("href", /^https:\/\/wa\.me\//);
    await page.keyboard.press("Escape");
    await expect(handoff).toHaveCount(0);

    await openSection(page, "Receivables");
    await page.getByRole("tab", { name: /^Open/ }).click();
    const search = page.getByLabel("Search receivables");
    await search.fill(`zz${invoice.reference}`);
    await expect(page.getByRole("heading", { name: "No matches in this view." })).toBeVisible();
    await page.getByRole("button", { name: "Clear search" }).click();
    await expect(page.locator(".receivable-list-card")).toHaveCount(1);

    await openSection(page, "Clients");
    await page.getByLabel("Search clients").fill(client.company.slice(0, 10));
    await expect(nav(page).getByRole("button", { name: "Clients" })).toBeVisible();

    await openSection(page, "More");
    await expect(page.getByRole("region", { name: "Take the ledger with you." })).toBeVisible();
    await page.getByRole("button", { name: /Edit your name and workspace name/ }).click();
    const profile = page.getByRole("dialog", { name: "Edit workspace profile" });
    await profile.getByLabel("Business or workspace name").fill(account.renamedBusiness);
    await profile.getByRole("button", { name: "Save changes" }).click();
    await acknowledge(page, "Workspace details saved");
    await expect(nav(page).getByText(account.renamedBusiness)).toBeVisible();

    // Fail-closed Founder page: the readiness matrix renders a different branch of the
    // same component tree depending on server state, so it is a warning candidate the
    // ledger walk cannot reach.
    await openSection(page, "More");
    await page.getByRole("button", { name: /Founder access/ }).click();
    await expect(page).toHaveURL(/\/founder$/);
    await expect(page.locator(".founder-not-ready")).toBeVisible();
    await page.getByRole("button", { name: "Return to my ledger" }).click();
    await expect(nav(page)).toBeVisible();

    await page.reload();
    await expect(nav(page)).toBeVisible();
  });

  test("a sign out and a sign in come back warning-free", async () => {
    await openSection(page, "More");
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(page).toHaveURL(/\/auth$/, { timeout: 20_000 });
    await page.getByLabel("Email address").fill(account.email);
    await page.getByLabel("Password").fill(account.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(nav(page)).toBeVisible({ timeout: 30_000 });
    await openSection(page, "Receivables");
    await expect(page.locator(".receivable-list-card", { hasText: invoice.title })).toHaveCount(1);
  });
});
