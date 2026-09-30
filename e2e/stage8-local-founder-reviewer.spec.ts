// Stage 8's reviewer journey covers the only half of the payment story that can make
// Founder access real: a person, in a queue, comparing a customer's reference against a
// business bank history DueWeave never sees. Each step runs in a real browser against the
// built bundle, and after each one the claim, the entitlement and the audit trail are read
// back from the database rather than from anything the page says about itself.
//
// Revocation is the one reviewer power these screens do not carry. It is exercised here
// through the reviewer's own authenticated session — the browser's anon key and that
// account's bearer token, captured from a request the app made for them, never a service
// role — and the missing control is asserted and reported as a gap rather than hidden.

import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import {
  addReceivable,
  backToLedger,
  clearToasts,
  founderAccountFor,
  openFounderPage,
  signIn,
  signOut,
  signUp,
  submitPaymentReference,
  toastTitle,
} from "./founder-browser-harness";
import { problemsFound, startProblemWatch, type ProblemWatch } from "./problem-watch";
import {
  FIXTURE_SUPPORT,
  FIXTURE_VPA,
  PRICE_DISPLAY,
  activeFounderCount,
  activeReceivableCount,
  analyticsEventCount,
  applyReadyOffer,
  auditEventsFor,
  claimFor,
  claimIdFor,
  markReviewer,
  planFor,
  purgeBrowserFixtures,
  readOffer,
  restoreOffer,
  reviewNoteFor,
  setFounderCap,
  userIdFor,
  type OfferSnapshot,
} from "./founder-local-fixture";

const localStackEnabled = process.env.STAGE8_LOCAL_E2E === "1";
const runTag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const accountFor = founderAccountFor(runTag);

const reviewer = accountFor("reviewer");
const buyer = accountFor("buyer");
const latecomer = accountFor("latecomer");

// A reference that is uppercase, hyphenated and long enough for the database shape rule,
// so what reaches the queue is something a reviewer could genuinely look for in a bank
// statement. The racers get a per-account suffix, because a repeated UTR is refused.
const UTR = `9${runTag.slice(0, 7)}-4471`.toUpperCase();
const racerA = { account: accountFor("racer-a"), utr: `${UTR}A`, payer: "Stage8 Racer A" };
const racerB = { account: accountFor("racer-b"), utr: `${UTR}B`, payer: "Stage8 Racer B" };

// Chromium logs a refused request as a console error. Where a refusal is the point of a
// case it is allowed by name — one RPC path, never a status code — so an unexpected
// failure anywhere else still fails the journey.
const REFUSED_REVIEWER_READS = /\/rest\/v1\/rpc\/(list_pending_founder_claims|list_rejected_founder_claims|get_founder_funnel)/;
const REFUSED_APPROVAL_WRITE = /\/rest\/v1\/rpc\/approve_founder_claim/;
const REFUSED_RECEIVABLE_WRITE = /\/rest\/v1\/rpc\/create_client_and_receivable/;

const FUNNEL_EVENTS = ["upgrade_viewed", "founder_claim_created", "founder_payment_submitted", "founder_activated", "founder_rejected"];

const evidence: Array<{ label: string; detail: string }> = [];
function observed(label: string, detail: string) {
  evidence.push({ label, detail });
}

/** The `role` claim of a JWT, read without a library, to prove what was captured. */
function tokenRole(token: string) {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1] ?? "", "base64url").toString("utf8")) as { role?: unknown };
    return String(payload.role ?? "absent");
  } catch {
    return "unreadable";
  }
}

test.describe("Stage 8 local Founder reviewer journey", () => {
  test.skip(!localStackEnabled, "Set STAGE8_LOCAL_E2E=1 to run against the local Supabase stack and a built bundle.");
  test.describe.configure({ mode: "serial" });
  test.describe.configure({ timeout: 180_000 });

  let delivered: OfferSnapshot;
  let watches: ProblemWatch[] = [];
  let allowed: RegExp[] = [];

  test.beforeAll(() => {
    delivered = readOffer();
  });

  test.beforeEach(() => {
    watches = [];
    allowed = [];
  });

  // The stale-card journey holds two reviewer tabs at once, so every page a test opens
  // registers its own watch and the whole set is asserted together afterwards.
  function track(page: Page) {
    watches.push(startProblemWatch(page));
    return page;
  }

  function allow(pattern: RegExp) {
    allowed.push(pattern);
  }

  test.afterEach(() => {
    const excuse = allowed.length ? new RegExp(allowed.map((pattern) => pattern.source).join("|")) : undefined;
    for (const watch of watches) expect(problemsFound(watch, excuse)).toEqual([]);
  });

  test.afterAll(() => {
    // Restored before the purge and unconditionally, so a failure in the middle of the
    // run cannot leave a payment-ready offer or a narrowed seat cap on the machine that
    // serves the production bundle.
    if (delivered) restoreOffer(delivered);
    purgeBrowserFixtures();
    mkdirSync(path.resolve("test-results"), { recursive: true });
    writeFileSync(
      path.resolve("test-results", "stage8-browser-reviewer.json"),
      JSON.stringify({ runTag, generatedAt: new Date().toISOString(), entries: evidence }, null, 2)
    );
  });

  function card(page: Page, claimId: string) {
    return page.locator(".admin-claim-card").filter({ hasText: claimId }).first();
  }

  async function openQueue(page: Page) {
    await page.goto("/admin/founder-claims");
    await expect(page.getByRole("heading", { name: "Review pending Founder claims." })).toBeVisible({ timeout: 20_000 });
  }

  // Read the live toast region rather than waiting on a locator: a locator's wait parks in
  // that page's action queue, and on a tab this machine has frozen the queue can hold for
  // tens of seconds. Call it after the acknowledgement has been seen on screen.
  async function regionText(page: Page) {
    return page.evaluate(() => document.querySelector('[aria-label*="Notifications" i]')?.textContent ?? "");
  }

  // A tab on this machine can stall for tens of seconds, and anything that only looks
  // while a toast happens to be on screen then reports a silence that never happened —
  // neither the acknowledgement nor the refusal outlives the wait. So what a tab was told
  // is recorded inside that tab, in arrival order, from before any review is clicked. The
  // recorder is installed with the tab in front, since a frozen tab runs no script at all.
  async function recordToasts(page: Page) {
    await page.bringToFront();
    await page.evaluate(() => {
      const heard: string[] = [];
      (window as unknown as { __founderToastLog?: string[] }).__founderToastLog = heard;
      const region = () => document.querySelector('[aria-label*="Notifications" i]')?.textContent ?? "";
      const capture = () => {
        const text = region();
        if (text && heard.at(-1) !== text) heard.push(text);
      };
      capture();
      new MutationObserver(capture).observe(document.body, { childList: true, subtree: true, characterData: true });
    });
  }

  // The record is read back with the tab woken first, since a backgrounded tab is frozen
  // rather than slow: one was measured answering an action 43.9s late and then refusing
  // every read for the following 10s. Each attempt therefore gets a short deadline while the
  // wait gets the whole budget, and reading late costs nothing — the answer was already
  // written down inside the tab that received it.
  async function heardBy(page: Page, budgetMs = 60_000) {
    await page.bringToFront();
    const until = Date.now() + budgetMs;
    let last: string[] = [];
    while (Date.now() < until) {
      const read = await Promise.race([
        page.evaluate(() => (window as unknown as { __founderToastLog?: string[] }).__founderToastLog ?? []).catch(() => null),
        new Promise<null>((resolve) => setTimeout(() => resolve(null), 3_000)),
      ]);
      if (read === null) continue;
      last = read;
      if (last.length > 0) break;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return last.join("\n");
  }

  async function expectFunnelToCarryStoredCounts(page: Page) {
    for (const event of FUNNEL_EVENTS) {
      const cell = page.locator(".admin-funnel div").filter({ hasText: event.replaceAll("_", " ") });
      await expect(cell, `the review screen renders no counter for ${event}`).toHaveCount(1);
      await expect(cell.locator("strong"), `${event} is not the number stored for it`).toHaveText(String(analyticsEventCount(event)));
    }
  }

  test("an account with no allowlist row is refused the queue, and one database row opens it", async ({ page }) => {
    track(page);
    await signUp(page, reviewer);

    allow(REFUSED_REVIEWER_READS);
    await page.goto("/admin/founder-claims");
    await expect(page.getByRole("heading", { name: "Founder review is restricted." })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("Founder review access is not available for this account.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Approve after bank check" })).toHaveCount(0);
    const denied = await page.locator("body").innerText();
    expect(denied, "the reviewer denial leaked internal vocabulary").not.toMatch(/PGRST|SQLSTATE|constraint|policy|founder_admins|rolname|uuid|owner_id/i);

    markReviewer(reviewer.email);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Review pending Founder claims." })).toBeVisible({ timeout: 20_000 });
    await expect(page.getByText("No pending claims")).toBeVisible();
    await expect(page.getByText("Nothing needs manual review.")).toBeVisible();
    await expect(page.getByText("No rejected claims need reconsideration.")).toBeVisible();
    await expect(page.getByText(/Never ask for the customer.s PIN, OTP, password, card details, or banking credentials\./)).toBeVisible();
    observed("allowlist", "the same account was refused before the allowlist row existed and served the empty queue after it; the denial named no internal vocabulary");
  });

  test("a submitted reference reaches the queue as bank-check fields and stored funnel counts", async ({ page }) => {
    track(page);
    applyReadyOffer();

    await signUp(page, buyer);
    await submitPaymentReference(page, UTR, "Stage8 Reviewed Buyer");
    expect(claimFor(buyer.email)?.status, "the customer's reference never reached review").toBe("PENDING_REVIEW");
    const claimId = claimIdFor(buyer.email);

    await backToLedger(page);
    await signOut(page);
    await signIn(page, reviewer);
    await openQueue(page);

    await expect(page.getByText("1 claim to review")).toBeVisible();
    await expect(page.locator(".admin-claim-card")).toHaveCount(1);
    const item = card(page, claimId);
    await expect(item.getByText("Awaiting bank check")).toBeVisible();
    await expect(item.getByText(buyer.email, { exact: true })).toBeVisible();
    await expect(item.getByText(claimId, { exact: true })).toBeVisible();
    await expect(item.getByText(PRICE_DISPLAY, { exact: true })).toBeVisible();
    await expect(item.getByText("Stage8 Reviewed Buyer", { exact: true })).toBeVisible();
    await expect(item.locator(".admin-utr")).toHaveText(UTR);

    // A bank check needs the account, the claim, the amount, the payer and the reference.
    // It needs neither the payment destination nor anybody else's row.
    const queue = await page.locator("body").innerText();
    expect(queue, "the queue carried a destination the bank check does not need").not.toContain(FIXTURE_VPA);
    expect(queue).not.toContain("upi://pay");
    expect(queue, "an account with no claim of its own appeared in the queue").not.toContain(latecomer.email);

    expect(planFor(buyer.email), "the queue listed an account that had already been activated").toBe("FREE:ACTIVE");
    await expectFunnelToCarryStoredCounts(page);
    observed("queue", `${claimId} listed with ${UTR}, ${PRICE_DISPLAY} and the payer name; no destination shown; all five funnel counters equalled the stored analytics counts`);
  });

  test("rejecting keeps the reference, leaves the account Free, and tells the customer", async ({ page }) => {
    track(page);
    const claimId = claimIdFor(buyer.email);
    await signIn(page, reviewer);
    await openQueue(page);

    const item = card(page, claimId);
    await item.getByLabel("Optional review note").fill("Not matched in the business bank history for this window");
    await item.getByRole("button", { name: "Reject" }).click();
    await expect(toastTitle(page, "Founder claim rejected")).toBeVisible();
    await clearToasts(page);

    await expect(page.getByText("No pending claims")).toBeVisible();
    const rejected = card(page, claimId);
    await expect(rejected.getByText("Previously rejected")).toBeVisible();
    await expect(rejected.locator(".admin-utr")).toHaveText(UTR);
    await expect(page.getByText(/Original review note: Not matched in the business bank history/)).toBeVisible();

    expect(claimFor(buyer.email)?.status, "the reviewer's decision was not stored").toBe("REJECTED");
    expect(claimFor(buyer.email)?.utr, "rejection changed the stored reference").toBe(UTR);
    expect(planFor(buyer.email), "a rejection still granted Founder access").toBe("FREE:ACTIVE");
    expect(auditEventsFor(buyer.email)).toEqual(["CLAIM_CREATED", "CLAIM_REJECTED", "CLAIM_SUBMITTED"]);

    // The customer reads the same decision, with a support route and no false hope.
    await backToLedger(page);
    await signOut(page);
    await signIn(page, buyer);
    await openFounderPage(page);
    const refused = page.locator(".founder-claim-status--rejected");
    await expect(refused.getByText("Payment could not be verified")).toBeVisible();
    await expect(refused.getByText(/Do not submit the same UTR again\./)).toBeVisible();
    await expect(refused.getByText(FIXTURE_SUPPORT)).toBeVisible();
    await expect(page.getByText("Founder Lifetime is active")).toHaveCount(0);
    observed("rejection", `${claimId} rejected with the reviewer's note; UTR, amount and payer name unchanged and the account still FREE`);
  });

  test("reconsideration unlocks only behind the explicit bank-verification tick", async ({ page }) => {
    track(page);
    const claimId = claimIdFor(buyer.email);
    await signIn(page, reviewer);
    await openQueue(page);

    const item = card(page, claimId);
    const approveAfterRecheck = item.getByRole("button", { name: "Approve after recheck" });
    await expect(approveAfterRecheck, "a rejected claim could be re-approved without any confirmation").toBeDisabled();

    await item.getByLabel("Concise reconsideration note (optional)").fill("Rechecked against the bank export for this window");
    await expect(approveAfterRecheck, "a review note alone counted as verification").toBeDisabled();

    await item.getByRole("checkbox", { name: /I independently verified this payment in business bank history\./ }).check();
    await expect(approveAfterRecheck).toBeEnabled();
    await approveAfterRecheck.click();
    await expect(toastTitle(page, "Founder access approved after recheck")).toBeVisible();
    await clearToasts(page);

    expect(claimFor(buyer.email)?.status, "reconsideration did not approve the claim").toBe("APPROVED");
    expect(claimFor(buyer.email)?.utr, "reconsideration rewrote the original reference").toBe(UTR);
    expect(planFor(buyer.email), "the reviewer's recheck did not activate the entitlement").toBe("FOUNDER:ACTIVE");
    expect(activeFounderCount(), "the recheck took more than one seat").toBe(1);
    expect(auditEventsFor(buyer.email), "the rejection history disappeared with the reconsideration").toEqual([
      "CLAIM_APPROVED_AFTER_REVIEW",
      "CLAIM_CREATED",
      "CLAIM_RECONSIDERED",
      "CLAIM_REJECTED",
      "CLAIM_SUBMITTED",
    ]);
    observed("reconsideration", `${claimId} re-approved only after the tick; original UTR kept and the rejection record still in the audit trail`);
  });

  test("active Founder access lifts the ledger limit and leaves both queues", async ({ page }) => {
    track(page);
    await signIn(page, reviewer);
    await openQueue(page);
    // The truthful "already reviewed" state is the absence of a second chance: an
    // approved claim is offered to no button, so it cannot be approved twice here.
    await expect(page.getByText("No pending claims")).toBeVisible();
    await expect(page.getByText("No rejected claims need reconsideration.")).toBeVisible();
    await expect(page.locator(".admin-claim-card")).toHaveCount(0);
    await backToLedger(page);
    await signOut(page);

    await signIn(page, buyer);
    for (const index of [1, 2, 3, 4, 5]) {
      await addReceivable(page, `Stage8 Founder Client ${index} ${runTag.slice(-4)}`, `Stage8 founder invoice ${index}`);
      await expect(toastTitle(page, "Receivable added")).toBeVisible();
      await clearToasts(page);
    }
    expect(activeReceivableCount(buyer.email), "an active Founder could not pass three active receivables").toBe(5);

    await openFounderPage(page);
    await expect(page.getByText("Founder Lifetime is active")).toBeVisible();
    await expect(page.getByRole("button", { name: "Start payment claim" })).toHaveCount(0);
    await expect(page.getByRole("img", { name: /UPI QR code/ })).toHaveCount(0);
    observed("entitlement-limit", "five active receivables stored for an active Founder; the approved claim offered no second review action");
  });

  test("revoking through the reviewer's own session leaves every record and restores the limit", async ({ page }) => {
    track(page);
    await signIn(page, reviewer);

    const queuedRead = page.waitForRequest((request) => request.method() === "POST" && request.url().includes("/rest/v1/rpc/list_pending_founder_claims"), { timeout: 20_000 });
    await openQueue(page);
    const captured = await queuedRead;
    const apikey = captured.headers().apikey ?? "";
    const authorization = captured.headers().authorization ?? "";
    expect(apikey, "the reviewer's own request carried no browser key, so nothing could be replayed as them").not.toBe("");
    expect(authorization.startsWith("Bearer "), "the reviewer's own request carried no session token").toBe(true);
    expect(tokenRole(apikey), "the captured browser key is not the anon role").toBe("anon");
    expect(tokenRole(authorization.replace(/^Bearer /, "")), "the captured session token is not an ordinary authenticated role").toBe("authenticated");

    // The gap, asserted rather than assumed: this screen offers approve, reject and
    // reconsider, and no way to take access back.
    await expect(page.getByRole("button", { name: /revoke/i })).toHaveCount(0);
    await expect(page.getByText(/revoke/i)).toHaveCount(0);

    const response = await fetch(new URL("/rest/v1/rpc/revoke_founder_entitlement", new URL(captured.url())).toString(), {
      method: "POST",
      headers: { apikey, authorization, "content-type": "application/json" },
      body: JSON.stringify({ p_user_id: userIdFor(buyer.email), p_reason: "Fixture revocation for local Stage 8 verification" }),
    });
    expect([200, 204], `revocation as the reviewer was refused: ${await response.text()}`).toContain(response.status);

    expect(planFor(buyer.email), "the entitlement was not revoked").toBe("FOUNDER:REVOKED");
    expect(activeFounderCount(), "a revoked Founder still holds a seat").toBe(0);
    expect(claimFor(buyer.email)?.status, "revocation rewrote the approved claim's history").toBe("APPROVED");
    expect(claimFor(buyer.email)?.utr).toBe(UTR);
    expect(activeReceivableCount(buyer.email), "revocation deleted ledger records").toBe(5);
    expect(auditEventsFor(buyer.email)).toEqual([
      "CLAIM_APPROVED_AFTER_REVIEW",
      "CLAIM_CREATED",
      "CLAIM_RECONSIDERED",
      "CLAIM_REJECTED",
      "CLAIM_SUBMITTED",
      "ENTITLEMENT_REVOKED",
    ]);

    // And the database limit the entitlement had lifted comes back for the customer.
    await backToLedger(page);
    await signOut(page);
    await signIn(page, buyer);
    allow(REFUSED_RECEIVABLE_WRITE);
    await addReceivable(page, `Stage8 Revoked Client ${runTag.slice(-4)}`, "Stage8 invoice after revocation");
    await expect(toastTitle(page, "Your Free plan limit is reached.")).toBeVisible();
    expect(activeReceivableCount(buyer.email), "a sixth receivable was stored against a revoked account").toBe(5);

    // The refusal toast overlaps this button, and sonner holds a toast open while the pointer is
    // on it — which is exactly what Playwright's actionability hover does. D-S9-9.
    await clearToasts(page);
    await page.locator(".founder-limit-callout").getByRole("button", { name: /View Founder access/ }).click();
    await expect(page.getByText("Founder Lifetime is active")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Start payment claim" })).toHaveCount(0);
    observed("revocation", "revoked with the anon key plus this reviewer's own bearer token (no service role); 5 receivables, claim and audit history intact, sixth write refused; the review screen carries no revoke control");
  });

  test("the last seat is taken once, and the queue says so in its own words", async ({ page }) => {
    // Two reviews arriving at the same instant is what the seat cap exists for, and that is
    // proven against two concurrent authenticated clients in
    // tests/stage8-local-founder-readiness.test.ts. A browser on this machine cannot stage
    // the moment: with both clicks dispatched together, the backgrounded tab's approval
    // request was measured leaving 37.3s after the other one, and Playwright already turns
    // off Chromium's own background throttling. So this journey asks the question a single
    // tab can answer honestly — what a reviewer is told once the last seat is gone — and
    // leaves the simultaneity claim where it is actually measured.
    track(page);
    applyReadyOffer();
    const seatsBefore = activeFounderCount();
    const cap = seatsBefore + 1;
    setFounderCap(cap);

    for (const racer of [racerA, racerB]) {
      await signUp(page, racer.account);
      await submitPaymentReference(page, racer.utr, racer.payer);
      await backToLedger(page);
      await signOut(page);
    }
    expect(claimFor(racerA.account.email)?.status, "racer A never reached review").toBe("PENDING_REVIEW");
    expect(claimFor(racerB.account.email)?.status, "racer B never reached review").toBe("PENDING_REVIEW");
    const idA = claimIdFor(racerA.account.email);
    const idB = claimIdFor(racerB.account.email);

    await signIn(page, reviewer);
    await openQueue(page);
    await expect(page.locator(".admin-claim-card")).toHaveCount(2);

    allow(REFUSED_APPROVAL_WRITE);

    await card(page, idA).getByRole("button", { name: "Approve after bank check" }).click();
    await expect(toastTitle(page, "Founder access approved")).toBeVisible({ timeout: 30_000 });
    expect(claimFor(racerA.account.email)?.status, "the approval never reached the database").toBe("APPROVED");
    expect(planFor(racerA.account.email)).toBe("FOUNDER:ACTIVE");
    expect(activeFounderCount(), `the cap of ${cap} was exceeded`).toBe(cap);

    // The second card is still on screen still saying "Awaiting bank check", and the seat
    // it would fill is already taken. The reviewer has to be told that, not that saving
    // failed, and the claim must be left exactly as it was.
    await card(page, idB).getByRole("button", { name: "Approve after bank check" }).click();
    await expect(toastTitle(page, "Could not approve claim")).toBeVisible({ timeout: 30_000 });
    const refusal = await regionText(page);
    expect(refusal, "the seat refusal said something other than the offer being full").toContain("The verified Founder offer is currently full.");
    expect(refusal, "the seat refusal leaked internal vocabulary").not.toMatch(/P0001|PGRST|SQLSTATE|constraint|policy|function|founder_admins|advisory|lock/i);
    expect(claimFor(racerB.account.email)?.status, "the refused review changed the claim anyway").toBe("PENDING_REVIEW");
    expect(auditEventsFor(racerB.account.email), "the refused review wrote an audit event").toEqual(["CLAIM_CREATED", "CLAIM_SUBMITTED"]);
    expect(planFor(racerB.account.email)).toBe("FREE:ACTIVE");
    expect(activeFounderCount(), "the refused review took a second seat").toBe(cap);

    // A refused claim is not a lost one: it stays in the queue for the same bank check.
    await page.getByRole("button", { name: "Refresh" }).click();
    await expect(card(page, idB)).toBeVisible();
    await expect(card(page, idB).getByText("Awaiting bank check")).toBeVisible();

    await backToLedger(page);
    await signOut(page);

    // A third customer sees the same seat arithmetic from the other side.
    await signUp(page, latecomer);
    await openFounderPage(page);
    await expect(page.getByText(`${cap - activeFounderCount()} of ${cap} spots available`)).toBeVisible();
    await expect(page.getByRole("button", { name: "Founder offer full" })).toBeDisabled();
    await backToLedger(page);
    await signOut(page);

    await signIn(page, racerA.account);
    await openFounderPage(page);
    await expect(page.getByText("Founder Lifetime is active")).toBeVisible();

    setFounderCap(delivered.founderCap);
    observed("seat-cap-queue", `one seat, cap ${cap}: ${idA} approved and ${idB} refused with "The verified Founder offer is currently full." in product language, leaving ${idB} pending with no audit event and no entitlement; active founders ${activeFounderCount()}; a third customer saw 0 of ${cap} spots and a disabled "Founder offer full"`);
  });

  test("a card another review already settled refuses with its own state", async ({ page }) => {
    // The reviewer who holds the stale card is the tab in the background, and a background
    // tab on this machine freezes rather than runs slowly, so each tab records its own
    // acknowledgement and is woken before it is read.
    test.setTimeout(300_000);
    track(page);
    // The seat-cap journey leaves exactly one claim still pending: racer B, refused because
    // the last seat had gone. Two reviewer tabs open the same queue, one settles that claim,
    // and the other is left holding a card that no longer describes reality. The queue is
    // shared, so this is the ordinary way a review goes stale, and the answer must name the
    // state rather than a save failure.
    const stale = [racerA, racerB].find((racer) => claimFor(racer.account.email)?.status === "PENDING_REVIEW");
    expect(stale, "the seat-cap journey left no pending claim to re-review").toBeDefined();
    const claimId = claimIdFor(stale!.account.email);

    await signIn(page, reviewer);
    await openQueue(page);
    const second = track(await page.context().newPage());
    await second.goto("/admin/founder-claims");
    await expect(card(second, claimId)).toBeVisible();
    const seatsBefore = activeFounderCount();

    allow(REFUSED_APPROVAL_WRITE);
    await recordToasts(page);
    await recordToasts(second);

    // Settled with a rejection rather than an approval, because that is the settlement the
    // stale review can actually be refused for. A second approval of an approved claim is a
    // deliberate no-op in the database (the function returns the claim unchanged), so it
    // answers 200 and the queue reports a success — see the report's open gaps. A rejected
    // claim is the state that has to say no.
    const item = card(second, claimId);
    const rejectionNote = "Not matched in the business bank history for this window";
    await item.getByLabel("Optional review note").fill(rejectionNote);
    await item.getByRole("button", { name: "Reject" }).click();
    expect(await heardBy(second, 30_000), "the rejection was never acknowledged").toContain("Founder claim rejected");
    expect(claimFor(stale!.account.email)?.status, "the rejection never reached the database").toBe("REJECTED");
    expect(reviewNoteFor(stale!.account.email)).toBe(rejectionNote);
    const settled = auditEventsFor(stale!.account.email);
    expect(settled).toEqual(["CLAIM_CREATED", "CLAIM_REJECTED", "CLAIM_SUBMITTED"]);

    // The claim is already settled in the database, so waking the stale tab cannot put
    // its review first: there is nothing left for it to win.
    await page.bringToFront();
    await card(page, claimId).getByRole("button", { name: "Approve after bank check" }).click();
    const heard = await heardBy(page);
    expect(heard, "the stale card gave no refusal").toContain("Could not approve claim");
    expect(heard).toContain("That claim has already been reviewed. Refresh to see its current state.");
    expect(heard, "the stale-card refusal leaked internal vocabulary").not.toMatch(/P0001|PGRST|SQLSTATE|constraint|policy|function|founder_admins|pending founder claim/i);

    // The refusal changed nothing: no seat, no entitlement, no note overwrite, no audit row.
    expect(activeFounderCount(), "the refused review took a seat").toBe(seatsBefore);
    expect(planFor(stale!.account.email), "a refused review granted Founder access").toBe("FREE:ACTIVE");
    const stored = claimFor(stale!.account.email);
    expect(stored?.status, "the refused review rewrote the claim state").toBe("REJECTED");
    expect(stored?.utr, "the refused review rewrote the stored reference").toBe(stale!.utr);
    expect(reviewNoteFor(stale!.account.email), "the refused review rewrote the other reviewer's note").toBe(rejectionNote);
    expect(auditEventsFor(stale!.account.email), "the refused review wrote an audit event").toEqual(settled);

    // Refreshing shows the truth the stale card was hiding: the claim is in the rejected
    // queue now, with the other reviewer's note attached, and no approve action on it.
    await page.getByRole("button", { name: "Refresh" }).click();
    await expect(page.getByText("No pending claims")).toBeVisible();
    const refreshed = card(page, claimId);
    await expect(refreshed.getByText("Previously rejected")).toBeVisible();
    await expect(refreshed.getByRole("button", { name: "Approve after bank check" })).toHaveCount(0);
    await expect(refreshed.getByRole("button", { name: "Approve after recheck" })).toBeDisabled();
    observed("stale-card", `the rejection made ${claimId} REJECTED; the stale tab's approval was refused as "already reviewed" in product language, took no seat, wrote no audit event and left the note and reference untouched, and the card refreshed to "Previously rejected" with no approve action`);
  });

  test("signing out, going Back, and a customer at the review address all leave no queue", async ({ page }) => {
    track(page);
    await signIn(page, reviewer);
    await openQueue(page);
    await backToLedger(page);
    await expect(page.locator(".admin-claim-card")).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Review pending Founder claims." })).toHaveCount(0);

    await signOut(page);
    await page.goto("/admin/founder-claims");
    await expect(page, "the review screen stayed reachable after sign-out").not.toHaveURL(/\/admin\/founder-claims$/, { timeout: 20_000 });
    await expect(page.getByRole("heading", { name: "Review pending Founder claims." })).toHaveCount(0);

    // A customer who is not on the allowlist, with a real claim of their own in review.
    allow(REFUSED_REVIEWER_READS);
    await signIn(page, racerB.account);
    await page.goto("/admin/founder-claims");
    await expect(page.getByRole("heading", { name: "Founder review is restricted." })).toBeVisible();
    const denied = await page.locator("body").innerText();
    expect(denied).not.toMatch(/PGRST|SQLSTATE|constraint|policy|founder_admins|rolname|uuid/i);
    expect(denied, "the denial leaked the signed-in customer's own reference").not.toContain(racerB.utr);
    observed("reviewer-session", "Back and sign-out both left the queue unreachable, and an account outside the allowlist was refused without internal vocabulary");
  });

  test("the review screen is keyboard-operable and fits every qualified width", async ({ page }) => {
    track(page);
    applyReadyOffer();
    await signIn(page, latecomer);
    await submitPaymentReference(page, `${UTR}C`, "Stage8 Late Buyer");
    const claimId = claimIdFor(latecomer.email);
    await backToLedger(page);
    await signOut(page);
    await signIn(page, reviewer);
    await openQueue(page);
    // Every claim earlier in this journey has already been settled or refused, so this
    // journey measures the card it creates rather than a queue size.
    await expect(card(page, claimId)).toBeVisible();

    for (const size of [
      { name: "360×800", width: 360, height: 800 },
      { name: "390×844", width: 390, height: 844 },
      { name: "768×1024", width: 768, height: 1024 },
      { name: "1280×800", width: 1280, height: 800 },
      { name: "1440×900", width: 1440, height: 900 },
    ]) {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.evaluate(async () => {
        await Promise.all(Array.from(document.getAnimations()).map((animation) => animation.finished.catch(() => undefined)));
      });
      const overflow = await page.evaluate(() => {
        const width = document.documentElement.clientWidth;
        const scrollWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
        const offenders = scrollWidth > width + 1
          ? Array.from(document.querySelectorAll<HTMLElement>("body *"))
            .filter((element) => {
              const box = element.getBoundingClientRect();
              return box.width > 0 && box.right > width + 1 && getComputedStyle(element).position !== "fixed";
            })
            .slice(0, 4)
            .map((element) => `${element.tagName.toLowerCase()}.${String(element.className).split(" ")[0] || "-"}→${Math.round(element.getBoundingClientRect().right)}`)
          : [];
        return { width, scrollWidth, offenders };
      });
      expect(overflow.offenders, `${size.name} overflowed sideways (${overflow.scrollWidth} against ${overflow.width})`).toEqual([]);

      // The fields a bank check is made of have to be reachable at this width.
      const item = card(page, claimId);
      for (const part of [
        item.locator(".admin-utr"),
        item.getByRole("button", { name: "Approve after bank check" }),
        item.getByRole("button", { name: "Reject" }),
      ]) {
        await part.scrollIntoViewIfNeeded();
        await expect(part).toBeInViewport();
      }
    }

    await page.setViewportSize({ width: 1280, height: 800 });
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("region", { name: "Founder funnel summary" })).toBeVisible();

    const stops: { name: string; marked: boolean }[] = [];
    const seen = new Set<string>();
    for (let step = 0; step < 20; step += 1) {
      const stop = await page.evaluate(() => {
        const element = document.activeElement as HTMLElement | null;
        if (!element) return { name: "", marked: false };
        const style = getComputedStyle(element);
        const labelled = element as HTMLElement & { labels?: ArrayLike<HTMLLabelElement> | null };
        const fromLabel = labelled.labels ? Array.from(labelled.labels, (label) => label.textContent ?? "").join(" ") : "";
        const name = (element.getAttribute("aria-label") || fromLabel || element.textContent || "").replace(/\s+/g, " ").trim();
        const ring = (style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) > 0) || style.boxShadow !== "none";
        return { name, marked: element.matches(":focus-visible") && ring };
      });
      expect(stop.name, "a keyboard stop on the review screen had no name to announce").not.toBe("");
      if (seen.has(stop.name)) break;
      seen.add(stop.name);
      stops.push(stop);
      await page.keyboard.press("Tab");
    }
    expect(stops.slice(1).filter((stop) => !stop.marked).map((stop) => stop.name), "a focused control on the review screen carried no visible mark").toEqual([]);
    const reached = stops.map((stop) => stop.name).join(" | ");
    for (const part of ["Back to DueWeave", "Optional review note", "Reject", "Approve after bank check"]) {
      expect(reached, `the Tab key never reached ${part}`).toContain(part);
    }
    observed("review-accessibility", `five widths with no sideways overflow; ${stops.length} named keyboard stops including both review actions`);
  });
});
