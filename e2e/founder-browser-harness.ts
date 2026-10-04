import { expect, type Page } from "@playwright/test";
import { awaitLedger, completeWorkspaceSetup } from "./workspace-setup";

// Stage 8's two Founder journeys drive the same real screens: an account is created
// through the sign-up form, a receivable is added through the ledger sheet, and a
// payment claim is opened through the Founder page. The customer spec proves each of
// those steps in detail; the reviewer spec needs to reach the same states without
// re-arguing them. Everything here is interaction plus a settle-the-page assertion, so
// a broken step fails loudly at the step rather than confusingly three screens later.
//
// Accounts keep the `stage8e2e-` prefix the browser purge in `founder-local-fixture.ts`
// deletes, and the run tag keeps a reused database from matching an older run's rows.

export type FounderAccount = {
  email: string;
  password: string;
  displayName: string;
  businessName: string;
};

export function founderAccountFor(runTag: string) {
  // The label also lands in the email local-part, so it is slugged here once rather
  // than depending on every caller to pick an address-safe word.
  const emailFor = (label: string) => `stage8e2e-${label.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${runTag}@dueweave.local`;
  return (label: string): FounderAccount => ({
    email: emailFor(label),
    password: `Stage8e2e-${label}!${runTag}aA`,
    displayName: `Stage8 E2e ${label}`,
    businessName: `Stage8 E2e ${label} Studio`,
  });
}

export async function signUp(page: Page, account: FounderAccount) {
  await page.goto("/auth");
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Your name").fill(account.displayName);
  await page.getByLabel("Email address").fill(account.email);
  await page.getByLabel("Password").fill(account.password);
  await page.getByRole("button", { name: "Create my workspace" }).click();
  await completeWorkspaceSetup(page, account);
}

export async function signIn(page: Page, account: FounderAccount) {
  await page.goto("/auth");
  await page.getByLabel("Email address").fill(account.email);
  await page.getByLabel("Password").fill(account.password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 20_000 });
}

/** Ends the session from the ledger's own menu. Call it while on the ledger. */
export async function signOut(page: Page) {
  await page.getByRole("button", { name: "More" }).first().click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/auth$/, { timeout: 20_000 });
}

/** The topbar control both Founder screens carry, used by the reviewer's `Back` step. */
export async function backToLedger(page: Page) {
  await page.getByLabel("Back to DueWeave").click();
  await expect(page).toHaveURL(/\/$/, { timeout: 20_000 });
  // Arriving at the address is not arriving at the ledger: the screen is a lazily
  // loaded chunk and its first honest read of this account's data can outlast the
  // implicit timeout, which would leave the next step clicking a loader.
  await awaitLedger(page);
}

export function toastTitle(page: Page, title: string) {
  return page.getByRole("region", { name: /Notifications/ }).getByText(title, { exact: true }).first();
}

// Acknowledgements stack, so a journey that reports several in a row waits for the
// stack to empty before its next action rather than matching an older copy.
export async function clearToasts(page: Page) {
  await expect(page.getByRole("region", { name: /Notifications/ }).locator("li"), "the toast stack never cleared").toHaveCount(0, { timeout: 20_000 });
}

export type ToastBox = { x: number; y: number; width: number; height: number };

/** What one frame of the live page says about a refusal card and the control beneath it. */
export type RefusalCoverage = {
  cardBox: ToastBox;
  controlBox: ToastBox;
  overlap: number;
  pointerOwnedByToast: boolean;
};

/**
 * One in-page capture of a refusal card and the control it names, taken in the same frame.
 *
 * Three failures this has to make impossible, each measured rather than imagined. A card box,
 * a control box and a hit test read at three different moments cannot be combined into one
 * claim about a click. "Two consecutive reads agree" is not "at rest in the band": a card that
 * has finished leaving agrees with itself exactly one own-height above it, and run 37202389761
 * measured the refusal at `384,-22 356x130` with the band's own top offset at 108 — 108 - 130 =
 * -22, which is Sonner's `[data-removed=true][data-front=true]` rule of `translateY(-100%)` to
 * the pixel. And a capture that costs seven sequential round trips spent 2583ms of the
 * refusal's 9000ms lifetime on an idle machine, a budget a loaded runner can overrun and did.
 *
 * So the waiting happens inside the page: one `evaluate` that polls on animation frames until
 * a card that is not leaving has stopped moving, then reads both boxes and asks the browser
 * what owns the centre of the control, all in the frame where it stops polling. A card that
 * has already gone cannot answer, so the guard says so instead of measuring its departure.
 */
export function captureRefusalCoverage(page: Page, cardTitle: string, control: { scope: string; label: string }): Promise<RefusalCoverage> {
  return page.evaluate(
    async ({ cardTitle, scope, label }) => {
      const deadline = performance.now() + 15_000;
      const paintOf = (element: Element): ToastBox => {
        const box = element.getBoundingClientRect();
        return { x: box.x, y: box.y, width: box.width, height: box.height };
      };
      /** A card on its way out is still mounted, and its resting place is off the top edge. */
      const isLeaving = (element: Element) => element.getAttribute("data-removed") === "true" || getComputedStyle(element).opacity === "0";
      let previous: ToastBox | null = null;
      for (;;) {
        const cards = [...document.querySelectorAll("[data-sonner-toast]")].filter((element) => (element.textContent ?? "").includes(cardTitle) && !isLeaving(element));
        if (cards.length !== 1) {
          previous = null;
          if (performance.now() > deadline) {
            throw new Error(`expected exactly one live refusal card reading "${cardTitle}", found ${cards.length} of ${document.querySelectorAll("[data-sonner-toast]").length} card(s) on screen`);
          }
        } else {
          const card = cards[0];
          const controlElement = [...(document.querySelector(scope)?.querySelectorAll("button") ?? [])].find((button) => (button.textContent ?? "").trim().startsWith(label));
          if (!controlElement) throw new Error(`the refusal names a control "${label}" inside ${scope}, and it is not on screen to be pressed`);
          const cardBox = paintOf(card);
          const settled = previous !== null && ["x", "y", "width", "height"].every((key) => Math.abs(cardBox[key as keyof ToastBox] - previous![key as keyof ToastBox]) < 0.5);
          previous = cardBox;
          if (settled) {
            const controlBox = paintOf(controlElement);
            const width = Math.min(cardBox.x + cardBox.width, controlBox.x + controlBox.width) - Math.max(cardBox.x, controlBox.x);
            const height = Math.min(cardBox.y + cardBox.height, controlBox.y + controlBox.height) - Math.max(cardBox.y, controlBox.y);
            const owner = document.elementFromPoint(controlBox.x + controlBox.width / 2, controlBox.y + controlBox.height / 2);
            return { cardBox, controlBox, overlap: width > 0 && height > 0 ? Math.round(width * height) : 0, pointerOwnedByToast: Boolean(owner?.closest("[data-sonner-toast]")) };
          }
        }
        await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
      }
    },
    { cardTitle, scope: control.scope, label: control.label }
  );
}

/**
 * Whether a notification card owns the browser's own hit test at the centre of `box` — which is
 * what decides where a real click lands, as opposed to what the DOM says is there.
 */
export function pointerOwnedByToast(page: Page, box: ToastBox) {
  return page.evaluate((point) => {
    const element = document.elementFromPoint(point.x, point.y);
    return Boolean(element?.closest?.("[data-sonner-toast]"));
  }, { x: box.x + box.width / 2, y: box.y + box.height / 2 });
}

/** Fills the receivable sheet the way a customer does. Asserts nothing about the answer. */
export async function addReceivable(page: Page, clientName: string, label: string) {
  await page.locator("button.floating-add, .page-header__actions button.button-primary").first().click();
  const sheet = page.getByRole("dialog", { name: "Add receivable" });
  await expect(sheet).toBeVisible();
  await sheet.getByRole("button", { name: "New client" }).click();
  await sheet.getByLabel("Client name").fill(clientName);
  await sheet.getByLabel("Amount").fill("12000");
  await sheet.getByLabel("Due date").fill("2026-09-15");
  await sheet.getByLabel("What is this for?").fill(label);
  await sheet.getByRole("button", { name: /Save receivable/ }).click();
}

export async function openFounderPage(page: Page) {
  await page.goto("/founder");
  await expect(page.getByRole("heading", { name: "Keep every follow-up in view." })).toBeVisible({ timeout: 20_000 });
}

/**
 * Reaches PENDING_REVIEW the only route a customer has: start a claim, type the
 * reference, submit. The offer must already be payment-ready, and the caller reads the
 * stored claim back from the database — nothing here claims the state was reached.
 */
export async function submitPaymentReference(page: Page, utr: string, payerName: string) {
  await openFounderPage(page);
  await page.getByRole("button", { name: "Start payment claim" }).click();
  await expect(toastTitle(page, "Payment claim started")).toBeVisible();
  await clearToasts(page);
  await page.getByLabel("UPI reference / UTR").fill(utr);
  await page.getByLabel("Payer name").fill(payerName);
  await page.getByRole("button", { name: "Submit for review" }).click();
  await expect(toastTitle(page, "Payment submitted for review")).toBeVisible();
  await clearToasts(page);
}
