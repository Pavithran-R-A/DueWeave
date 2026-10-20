import { expect, test, type Page } from "@playwright/test";
import { awaitLedger, completeWorkspaceSetup } from "./workspace-setup";
import { problemsFound, startProblemWatch, type ProblemWatch } from "./problem-watch";

// CL-7 Stage C item 11, the rendering half. `tests/trust-surface.contract.test.ts` proves the
// source says the right thing; this file proves a browser can actually read it — that the three
// documents answer with no session, that the accessibility tree reports one `main` and one `h1`
// per document, that the links a locked-out customer needs are on the sign-in screen itself, and
// that none of it breaks at the width of the phone the product is aimed at. Every verdict is a
// number read off the live document, never a screenshot.
const localStackEnabled = process.env.STAGE6_LOCAL_E2E === "1";

const documents = [
  { route: "/privacy", heading: "What your ledger holds, and where it sits." },
  { route: "/terms", heading: "The rules for using DueWeave." },
  { route: "/support", heading: "When something goes wrong, here is where to look." },
] as const;

const widths = [360, 390, 430, 768, 1024, 1440];

/** The label each document is offered by, in the nav and on the sign-in row alike. */
const labels: Record<string, string> = { "/privacy": "Privacy Policy", "/terms": "Terms of Use", "/support": "Support" };

const token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const suffix = token.slice(-6);
const account = {
  email: `stage7legal-${suffix}@dueweave.local`,
  password: `Stage7legal!${suffix}aA`,
  displayName: `Stage7 Legal Owner ${suffix}`,
  businessName: `Stage7 Legal Studio ${suffix}`,
};

/** A page can still be animating its lazy chunk in when the first measurement lands. */
async function settle(page: Page) {
  await page.evaluate(async () => {
    await Promise.all(Array.from(document.getAnimations()).map((animation) => animation.finished.catch(() => undefined)));
  });
}

async function openDocument(page: Page, route: string) {
  await page.goto(route);
  await expect(page.locator(".legal-shell")).toBeVisible({ timeout: 20_000 });
  await settle(page);
}

/** The document's own horizontal overflow, named by whatever causes it. */
async function overflow(page: Page) {
  await settle(page);
  return page.evaluate(() => {
    const width = document.documentElement.clientWidth;
    const scrollWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
    const offenders = scrollWidth > width + 1
      ? Array.from(document.querySelectorAll<HTMLElement>("body *"))
        .filter((el) => {
          const box = el.getBoundingClientRect();
          return box.width > 0 && box.right > width + 1 && getComputedStyle(el).position !== "fixed";
        })
        .slice(0, 4)
        .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0] || "-"}→${Math.round(el.getBoundingClientRect().right)}`)
      : [];
    return { width, scrollWidth, offenders };
  });
}

test.describe("trust surface as a stranger sees it", () => {
  test.skip(!localStackEnabled, "Set STAGE6_LOCAL_E2E=1 to run against the local Supabase stack.");
  test.describe.configure({ mode: "serial" });

  let watch: ProblemWatch;
  test.beforeEach(async ({ page }) => {
    watch = startProblemWatch(page);
  });
  test.afterEach(() => {
    expect(problemsFound(watch), "the documents broke in ways the page does not show").toEqual([]);
  });

  for (const document_ of documents) {
    test(`serves ${document_.route} to a browser that signs in as nobody`, async ({ page }) => {
      await openDocument(page, document_.route);
      await expect(page).toHaveURL(new RegExp(`${document_.route}$`));

      await expect(page.getByRole("main")).toHaveCount(1);
      const title = page.getByRole("heading", { level: 1 });
      await expect(title).toHaveCount(1);
      await expect(title).toHaveText(document_.heading);
      expect(await page.getByRole("heading", { level: 2 }).count(), "a document with no sections is not a document").toBeGreaterThanOrEqual(5);
      // Reading the policy must not open a session: no cookie, and no auth token in storage.
      expect(await page.evaluate(() => document.cookie), "the trust pages set a cookie").toBe("");
      expect(await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("sb-"))), "reading a policy signed the browser in").toEqual([]);
      await expect(page.getByText(/^Last updated: /)).toBeVisible();
    });

    test(`switches ${document_.route} to the other two without leaving the page set`, async ({ page }) => {
      await openDocument(page, document_.route);
      const others = documents.filter((item) => item.route !== document_.route);
      const nav = page.getByRole("navigation", { name: "Other DueWeave documents" });
      await expect(nav.getByRole("link")).toHaveCount(others.length);
      for (const other of others) {
        await nav.getByRole("link", { name: labels[other.route] }).click();
        await expect(page).toHaveURL(new RegExp(`${other.route}$`));
        await expect(page.getByRole("heading", { level: 1 })).toHaveText(other.heading);
      }
    });

    test(`carries ${document_.route} back to the screen that can sign in`, async ({ page }) => {
      await openDocument(page, document_.route);
      await page.getByRole("link", { name: "Return to sign in" }).click();
      await expect(page).toHaveURL(/\/auth$/);
      await expect(page.getByLabel("Email address")).toBeVisible({ timeout: 20_000 });
    });
  }

  test("links all three from the sign-in screen, before a credential is typed", async ({ page }) => {
    await page.goto("/auth");
    const links = page.locator(".auth-legal-links");
    await expect(links).toBeVisible({ timeout: 20_000 });
    await expect(links.getByRole("link")).toHaveCount(3);
    for (const document_ of documents) {
      await expect(links.getByRole("link", { name: labels[document_.route] })).toHaveAttribute("href", document_.route);
    }
    await links.getByRole("link", { name: "Privacy Policy" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(documents[0].heading);
    // Nothing was entered, so nothing was stored.
    expect(await page.evaluate(() => Object.keys(localStorage).filter((key) => key.startsWith("sb-")))).toEqual([]);
  });

  for (const width of widths) {
    test(`keeps all three documents inside a ${width}px viewport`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 });
      for (const document_ of documents) {
        await openDocument(page, document_.route);
        const measured = await overflow(page);
        expect(measured.scrollWidth, `${document_.route} at ${width}px overflows horizontally: ${measured.offenders.join(", ")}`).toBeLessThanOrEqual(measured.width + 1);
        // A reading column that runs to the edge of a 1440px screen is the other half of
        // "readable": the body text has to keep a measure a person can track back.
        const measure = await page.locator(".legal-body").evaluate((el) => el.getBoundingClientRect().width);
        expect(measure, `${document_.route} at ${width}px has no reading measure`).toBeLessThanOrEqual(780);
      }
    });
  }

  test("links all three from the signed-in screen that holds the data controls", async ({ page }) => {
    test.info().timeout = 180_000;
    await page.goto("/auth");
    await page.getByRole("button", { name: "Create an account" }).click();
    await page.getByLabel("Your name").fill(account.displayName);
    await page.getByLabel("Email address").fill(account.email);
    await page.getByLabel("Password").fill(account.password);
    await page.getByRole("button", { name: "Create my workspace" }).click();
    await completeWorkspaceSetup(page, account);
    await awaitLedger(page);

    await page.getByRole("button", { name: "More" }).filter({ visible: true }).first().click();
    const links = page.locator(".more-legal-links");
    await expect(links).toBeVisible();
    await expect(links.getByRole("link")).toHaveCount(3);
    // The links belong on the same screen as the export and the erasure control, so a
    // customer reading "what happens to my data" does not have to sign out to find out.
    await expect(page.getByRole("heading", { name: "Take the ledger with you." })).toBeVisible();
    await links.getByRole("link", { name: "Support" }).click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(documents[2].heading);
  });
});
