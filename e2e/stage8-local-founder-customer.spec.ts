// Stage 8's customer journey is one claim repeated until it is proved: opening UPI
// is not paying. Every step here runs in a real browser against the built bundle and
// the local stack, and after each step the payment claim is read back from the
// database rather than from anything the page says about itself. The fixture that
// makes payment instructions visible is synthetic, is applied only for the tests that
// need it, and is restored in teardown — the delivered build stays fail-closed.

import { expect, test, type Page } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import QRCode from "qrcode";
import {
  addReceivable,
  clearToasts,
  founderAccountFor,
  openFounderPage,
  signIn,
  signOut,
  signUp,
  toastTitle,
} from "./founder-browser-harness";
import { problemsFound, startProblemWatch, type ProblemWatch } from "./problem-watch";
import {
  CANONICAL_UPI_URI,
  FIXTURE_PAYEE,
  FIXTURE_SUPPORT,
  FIXTURE_VPA,
  PRICE_DISPLAY,
  UPI_PRICE_TEXT,
  activeFounderCount,
  activeReceivableCount,
  applyReadyOffer,
  auditEventsFor,
  claimCountFor,
  claimFor,
  claimIdFor,
  planFor,
  purgeBrowserFixtures,
  readOffer,
  restoreOffer,
  type OfferSnapshot,
} from "./founder-local-fixture";

const localStackEnabled = process.env.STAGE8_LOCAL_E2E === "1";
const runTag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

const accountFor = founderAccountFor(runTag);

const owner = accountFor("buyer");
const outsider = accountFor("outsider");
const walker = accountFor("walker");

const MONEY_RPC = /\/rpc\/(create_founder_claim|submit_founder_payment|cancel_founder_claim|approve_founder_claim|reject_founder_claim|reconsider_founder_claim|revoke_founder_entitlement)(\?|$)/;

// A hand-off to a UPI app leaves the browser entirely, so the only honest way to
// watch it is to cancel the navigation and read the address that was asked for. The
// allowance below excuses that one scheme and nothing else: an uncaught error or any
// other failed request still fails the journey.
const EXTERNAL_UPI_ALLOWANCE = /upi:|custom protocol|ERR_UNKNOWN_URL_SCHEME/;

// Chromium logs a refused write as a console error, and in the Free-limit case the
// refusal is the point. The allowance names that one RPC rather than a status code,
// so an unexpected 400 anywhere else still fails the journey.
const REFUSED_RECEIVABLE_WRITE = /\/rest\/v1\/rpc\/create_client_and_receivable/;

// A reference the database shape-rule refuses is also the point of its own case, so
// that one refusal is excused by name and nothing else is.
const REFUSED_PAYMENT_WRITE = /\/rest\/v1\/rpc\/submit_founder_payment/;

// An ordinary account that opens the review screen has all three queue reads refused by
// the database. That refusal is what the isolation case is proving, so it is excused by
// name; a refusal anywhere else still fails the journey.
const REFUSED_REVIEWER_READS = /\/rest\/v1\/rpc\/(list_pending_founder_claims|list_rejected_founder_claims|get_founder_funnel)/;

const evidence: Array<{ label: string; detail: string }> = [];
function observed(label: string, detail: string) {
  evidence.push({ label, detail });
}

test.describe("Stage 8 local Founder customer journey", () => {
  test.skip(!localStackEnabled, "Set STAGE8_LOCAL_E2E=1 to run against the local Supabase stack and a built bundle.");
  test.describe.configure({ mode: "serial" });
  test.describe.configure({ timeout: 120_000 });

  let watch: ProblemWatch;
  let expectedFailure: RegExp | undefined;
  let delivered: OfferSnapshot;

  test.beforeAll(() => {
    delivered = readOffer();
  });

  test.beforeEach(async ({ page }) => {
    watch = startProblemWatch(page);
    expectedFailure = undefined;
  });

  test.afterEach(() => {
    expect(problemsFound(watch, expectedFailure)).toEqual([]);
  });

  test.afterAll(() => {
    // Restored before the purge and unconditionally, so a failure in the middle of
    // the run cannot leave a payment-ready offer on the machine that serves the
    // production bundle.
    if (delivered) restoreOffer(delivered);
    purgeBrowserFixtures();
    mkdirSync(path.resolve("test-results"), { recursive: true });
    writeFileSync(
      path.resolve("test-results", "stage8-browser-customer.json"),
      JSON.stringify({ runTag, generatedAt: new Date().toISOString(), entries: evidence }, null, 2)
    );
  });

  function moneyWrites(page: Page) {
    const seen: string[] = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && MONEY_RPC.test(request.url())) seen.push(request.url().replace(/^.*\/rpc\//, "rpc/").split("?")[0]);
    });
    return seen;
  }

  async function expectNoWayToPay(page: Page) {
    await expect(page.getByText("Payment instructions are being set up.")).toBeVisible();
    await expect(page.getByText("Do not send money yet.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Start payment claim" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Open UPI" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Copy UPI link" })).toHaveCount(0);
    await expect(page.getByRole("img", { name: /UPI QR code/ })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Pay with your UPI app" })).toHaveCount(0);
  }

  test("the delivered build shows a non-payable placeholder with no destination at all", async ({ page }) => {
    await signUp(page, owner);
    await openFounderPage(page);
    await expectNoWayToPay(page);

    // The price is on screen even while nothing is payable, because the offer the
    // customer is reading is the same ₹499 contract the database pins.
    await expect(page.locator(".founder-price strong")).toHaveText(PRICE_DISPLAY);
    await expect(page.getByText("One-time, manually verified")).toBeVisible();

    const html = await page.content();
    expect(html, "the delivered page leaked the synthetic fixture destination").not.toContain(FIXTURE_VPA);
    expect(html).not.toContain("upi://pay");
    expect(html, "the delivered page leaked any destination at all").not.toMatch(/pa=[^&]+&pn=/);

    // The privacy promise sits on the same screen as the refusal.
    await expect(page.getByText(/UPI PIN, OTP, banking password, card details/)).toBeVisible();
    observed("fail-closed", "the delivered build rendered no destination, no QR and no claim action");
  });

  test("hitting the Free limit routes to Founder without opening a payment", async ({ page }) => {
    await signIn(page, owner);
    for (const index of [1, 2, 3]) {
      await addReceivable(page, `Stage8 Client ${index} ${runTag.slice(-4)}`, `Stage8 invoice ${index}`);
      await expect(toastTitle(page, "Receivable added")).toBeVisible();
      await clearToasts(page);
      expect(activeReceivableCount(owner.email), `receivable ${index} was not stored as active`).toBe(index);
    }

    expectedFailure = REFUSED_RECEIVABLE_WRITE;
    await addReceivable(page, `Stage8 Client 4 ${runTag.slice(-4)}`, "Stage8 invoice 4");
    await expect(toastTitle(page, "Your Free plan limit is reached.")).toBeVisible();
    const callout = page.locator(".founder-limit-callout");
    await expect(callout.getByText("You have three active receivables.")).toBeVisible();
    expect(activeReceivableCount(owner.email), "the fourth receivable was stored despite the refusal").toBe(3);

    // The refusal names itself in product language, not as a database error.
    await expect(page.getByRole("region", { name: /Notifications/ })).not.toContainText(/PGRST|SQLSTATE|constraint|policy|row-level/i);

    await callout.getByRole("button", { name: /View Founder access/ }).click();
    await expect(page).toHaveURL(/\/founder$/);
    await expectNoWayToPay(page);
    observed("free-limit", "the fourth active receivable was refused by the database and routed to a still-closed Founder page");
  });

  test("the synthetic-ready fixture reveals the pinned price, payee and seats", async ({ page }) => {
    applyReadyOffer();
    await signIn(page, owner);
    await openFounderPage(page);

    const seats = delivered.founderCap - activeFounderCount();
    await expect(page.getByRole("heading", { name: "Pay with your UPI app" })).toBeVisible();
    await expect(page.getByText(`Founder Lifetime · ${PRICE_DISPLAY} once`)).toBeVisible();
    await expect(page.getByText(`${seats} of ${delivered.founderCap} spots available`)).toBeVisible();
    await expect(page.getByRole("button", { name: "Start payment claim" })).toBeEnabled();

    // Nothing about the destination is shown before the customer asks for a claim.
    await expect(page.getByRole("img", { name: /UPI QR code/ })).toHaveCount(0);
    await expect(page.getByText(`Payee: ${FIXTURE_PAYEE}`)).toHaveCount(0);

    // The support address the gate requires and the refund terms the gate approves
    // are both the fixture values — obviously synthetic, and neither is real. The
    // address is named twice on a payable page (payment card and disclosures), so the
    // check is that a customer can read it, not that it appears once.
    await expect(page.getByText(FIXTURE_SUPPORT).first()).toBeVisible();
    await expect(page.locator(".founder-disclosures").getByText(FIXTURE_SUPPORT)).toBeVisible();
    await expect(page.getByText(/Fixture refund terms for local Stage 8 verification only/)).toBeVisible();
    observed("ready-fixture", `destination LIVE with the synthetic ${FIXTURE_VPA}; ${seats} seats free of ${delivered.founderCap}`);
  });

  test("starting a claim is idempotent and renders a QR that matches the UPI link exactly", async ({ page }) => {
    await signIn(page, owner);
    await openFounderPage(page);

    const writes = moneyWrites(page);
    await page.getByRole("button", { name: "Start payment claim" }).dblclick();
    await expect(toastTitle(page, "Payment claim started")).toBeVisible();
    await expect(page.getByRole("button", { name: "Open UPI" })).toBeVisible();

    const stored = claimFor(owner.email);
    expect(claimCountFor(owner.email), `a double-click created ${claimCountFor(owner.email)} claims`).toBe(1);
    expect(stored?.status, "a created claim is not a draft").toBe("DRAFT");
    expect(stored?.amount, "the claim did not snapshot the pinned offer price").toBe(49_900);
    expect(writes, `a double-click reached the server ${writes.length} times`).toHaveLength(1);

    // The QR and the Open-UPI link must describe the same payment. Two encoders that
    // agree with each other prove nothing, so each is checked against the canonical URI
    // written down from the stored fixture facts: the link through the navigation the
    // app actually asked for, the QR by re-encoding that canonical string with the same
    // options the page uses and comparing the bytes.
    expectedFailure = EXTERNAL_UPI_ALLOWANCE;
    const attempted = page.waitForRequest((request) => request.url().startsWith("upi:"), { timeout: 5_000 }).catch(() => null);
    await page.getByRole("button", { name: "Open UPI" }).click();
    const request = await attempted;
    const payload = request?.url() ?? "";
    expect(payload, "Open UPI attempted no navigation, so the link and the QR cannot be compared").not.toBe("");

    const parameters = new URL(payload.replace(/^upi:/, "https:")).searchParams;
    const canonicalParameters = new URL(CANONICAL_UPI_URI.replace(/^upi:/, "https:")).searchParams;
    expect([...parameters.entries()].sort(), `the UPI link the app opened is not the canonical payment: ${payload}`).toEqual([...canonicalParameters.entries()].sort());
    expect(payload, "the URI leaked paise where rupees belong").not.toContain("49900");
    expect(CANONICAL_UPI_URI, "the amount in the canonical URI must be rupees text").toContain(`am=${UPI_PRICE_TEXT}`);

    const qr = page.getByRole("img", { name: /UPI QR code/ });
    await expect(qr).toHaveAttribute("alt", `UPI QR code for ${PRICE_DISPLAY} payable to ${FIXTURE_PAYEE}`);
    const rendered = await qr.evaluate((element) => element.getAttribute("src") ?? "");
    const expectedPng = await QRCode.toDataURL(CANONICAL_UPI_URI, { width: 280, margin: 1, color: { dark: "#162823", light: "#fbfaf5" } });

    // Byte equality of two PNGs would compare encoders, not pictures: the node build of
    // the QR library compresses differently from the browser build the app bundled. So
    // both images are rasterised in the page and compared pixel by pixel — same size and
    // same picture means the QR on screen carries the canonical payment and nothing else.
    const comparison = await page.evaluate(async ([onScreen, reference]: string[]) => {
      const pixels = (src: string) => new Promise<{ width: number; height: number; data: Uint8ClampedArray }>((resolve, reject) => {
        const image = new Image();
        image.onload = () => {
          const canvas = document.createElement("canvas");
          canvas.width = image.width;
          canvas.height = image.height;
          const context = canvas.getContext("2d");
          if (!context) return reject(new Error("no 2d context"));
          context.drawImage(image, 0, 0);
          resolve({ width: image.width, height: image.height, data: context.getImageData(0, 0, image.width, image.height).data });
        };
        image.onerror = () => reject(new Error("a QR image could not be rasterised"));
        image.src = src;
      });
      const [first, second] = await Promise.all([pixels(onScreen), pixels(reference)]);
      let differing = 0;
      let worstChannelGap = 0;
      if (first.width === second.width && first.height === second.height) {
        for (let index = 0; index < first.data.length; index += 4) {
          const gap = Math.max(
            Math.abs(first.data[index] - second.data[index]),
            Math.abs(first.data[index + 1] - second.data[index + 1]),
            Math.abs(first.data[index + 2] - second.data[index + 2])
          );
          if (gap > 0) differing += 1;
          worstChannelGap = Math.max(worstChannelGap, gap);
        }
      }
      return {
        onScreen: [first.width, first.height],
        reference: [second.width, second.height],
        sameSize: first.width === second.width && first.height === second.height,
        differing,
        worstChannelGap,
      };
    }, [rendered, expectedPng]);

    expect(comparison.sameSize, `the QR on screen (${comparison.onScreen}) and the canonical payment (${comparison.reference}) are different pictures`).toBe(true);
    expect(comparison.differing, `the QR on screen differs from the canonical payment in ${comparison.differing} pixels (largest channel gap ${comparison.worstChannelGap})`).toBe(0);
    observed("upi-payload", `link ${payload} decodes to the canonical ${CANONICAL_UPI_URI}; the rendered QR matches it pixel for pixel`);
  });

  test("D-S8-1: opening UPI leaves the claim a draft, the account Free, and the history unchanged", async ({ page }) => {
    await signIn(page, owner);
    await openFounderPage(page);
    expectedFailure = EXTERNAL_UPI_ALLOWANCE;

    const writes = moneyWrites(page);
    const claimBefore = claimIdFor(owner.email);
    await page.getByRole("button", { name: "Open UPI" }).click();
    await page.waitForTimeout(1_500);

    expect(writes, `opening UPI reached the payment state machine: ${writes.join(", ")}`).toEqual([]);
    expect(claimFor(owner.email)?.status, "the claim moved on from DRAFT after opening UPI").toBe("DRAFT");
    expect(claimIdFor(owner.email), "opening UPI replaced the claim").toBe(claimBefore);
    expect(planFor(owner.email), "opening UPI granted Founder access").toBe("FREE:ACTIVE");
    expect(auditEventsFor(owner.email), "opening UPI wrote audit history").toEqual(["CLAIM_CREATED"]);

    // A hand-back from the UPI app is the other half of the same lie, so every return
    // path the browser offers is poked directly. None of them may move the claim.
    const returnWrites = moneyWrites(page);
    await page.evaluate(() => {
      Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" });
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("focus"));
      window.dispatchEvent(new Event("pageshow"));
      window.dispatchEvent(new Event("focusin"));
    });
    await page.waitForTimeout(1_000);
    expect(returnWrites, "a simulated return to the tab moved the payment claim").toEqual([]);
    expect(claimFor(owner.email)?.status, "the claim moved on after a simulated return").toBe("DRAFT");

    await page.reload();
    await expect(page.getByRole("heading", { name: "Submit your payment reference" })).toBeVisible();
    await expect(page.getByText("Payment submitted for review")).toHaveCount(0);
    await expect(page.getByText("Founder Lifetime is active")).toHaveCount(0);
    observed("d-s8-1", "open UPI plus visibilitychange, focus and pageshow: DRAFT, FREE, audit still CLAIM_CREATED only");
  });

  test("a reference only the database can reject is refused in product language", async ({ page }) => {
    await signIn(page, owner);
    await openFounderPage(page);
    const before = claimFor(owner.email);

    await page.getByLabel("UPI reference / UTR").fill("BAD_REF!12");
    await page.getByLabel("Payer name").fill("Stage8 Buyer");
    expectedFailure = REFUSED_PAYMENT_WRITE;
    await page.getByRole("button", { name: "Submit for review" }).click();
    await expect(toastTitle(page, "Could not submit payment")).toBeVisible();
    await expect(page.getByRole("region", { name: /Notifications/ })).toContainText("Enter a valid UTR or payment reference.");

    expect(claimFor(owner.email), "a refused submission still changed the claim").toEqual(before);
    expect(claimFor(owner.email)?.status).toBe("DRAFT");
    expect(claimFor(owner.email)?.utr ?? "", "a refused reference was stored anyway").toBe("");
    expect(planFor(owner.email)).toBe("FREE:ACTIVE");
    expect(auditEventsFor(owner.email), "a refused submission wrote audit history").toEqual(["CLAIM_CREATED"]);
    observed("validation", "the shape rule refused the reference and the draft kept its stored facts");
  });

  test("submitting a reference lands in manual review and never claims payment succeeded", async ({ page }) => {
    await signIn(page, owner);
    await openFounderPage(page);

    const typed = ` utr ${runTag.slice(0, 6)}-9988 `;
    const normalized = typed.toUpperCase().replace(/\s+/g, "");
    await page.getByLabel("UPI reference / UTR").fill(typed);
    await page.getByLabel("Payer name").fill("Stage8 Buyer");
    await page.getByRole("button", { name: "Submit for review" }).dblclick();
    await expect(toastTitle(page, "Payment submitted for review")).toBeVisible();

    const status = page.locator(".founder-claim-status--pending");
    await expect(status.getByText("Payment submitted for review")).toBeVisible();
    await expect(status.getByText(/manual bank-history verification/)).toBeVisible();

    // The stored truth, read back from the database rather than from the page.
    const claim = claimFor(owner.email);
    expect(claim?.status, "the submitted claim is not pending review").toBe("PENDING_REVIEW");
    expect(claim?.utr, "the reference was not normalised to trimmed, upper-case, space-free form").toBe(normalized);
    expect(claim?.payer).toBe("Stage8 Buyer");
    expect(claim?.amount, "submission changed the snapshot price").toBe(49_900);
    expect(planFor(owner.email), "a submitted reference granted Founder access before any review").toBe("FREE:ACTIVE");
    expect(auditEventsFor(owner.email)).toEqual(["CLAIM_CREATED", "CLAIM_SUBMITTED"]);
    expect(claimCountFor(owner.email), "a double-click submitted twice").toBe(1);

    // And nothing on the screen says the money arrived.
    const body = await page.locator("body").innerText();
    expect(body).not.toMatch(/payment (was )?successful|thank you for your payment|access (is )?(now )?activated/i);
    await expect(page.getByText("Founder Lifetime is active")).toHaveCount(0);
    observed("pending-review", `stored ${claim?.utr} as PENDING_REVIEW with the plan still FREE`);
  });

  test("reload, sign out and sign in again leave the claim pending", async ({ page }) => {
    await signIn(page, owner);
    await openFounderPage(page);
    await expect(page.locator(".founder-claim-status--pending")).toBeVisible();

    const utrBefore = claimFor(owner.email)?.utr;
    // The Founder screen has no navigation of its own; the session ends from the ledger.
    await page.getByRole("button", { name: "Return to my ledger" }).click();
    await expect(page).toHaveURL(/\/$/, { timeout: 20_000 });
    await signOut(page);

    // A signed-out browser must not keep the Founder screen up.
    await page.goto("/founder");
    await expect(page, "the Founder page stayed reachable after sign-out").not.toHaveURL(/\/founder$/, { timeout: 20_000 });

    await signIn(page, owner);
    await openFounderPage(page);
    await expect(page.locator(".founder-claim-status--pending")).toBeVisible();
    expect(claimFor(owner.email)?.status).toBe("PENDING_REVIEW");
    expect(claimFor(owner.email)?.utr, "the stored reference changed across a session").toBe(utrBefore);
    expect(planFor(owner.email)).toBe("FREE:ACTIVE");
    observed("persistence", "the claim survived a sign-out and a fresh session as PENDING_REVIEW");
  });

  test("another customer sees no claim, no reference and no payer name", async ({ page }) => {
    const claim = claimFor(owner.email);
    expect(claim?.utr, "the owner's reference vanished before the isolation check").toBeTruthy();

    await signUp(page, outsider);
    await openFounderPage(page);

    // The outsider is a real customer whose own offer is payable, so the screen is
    // not hidden from them — what they cannot see is anybody else's payment.
    await expect(page.getByRole("button", { name: "Start payment claim" })).toBeVisible();
    const body = await page.locator("body").innerText();
    expect(body, "another account's payment reference was readable").not.toContain(claim?.utr ?? "absent");
    expect(body, "another account's payer name was readable").not.toContain("Stage8 Buyer");
    expect(claimCountFor(outsider.email), "browsing picked up somebody else's claim").toBe(0);
    expect(planFor(outsider.email)).toBe("FREE:ACTIVE");

    // A reviewer screen reached by an ordinary account answers with a refusal, not a
    // queue — and the refusal carries no allowlist or database vocabulary.
    await page.goto("/admin/founder-claims");
    expectedFailure = REFUSED_REVIEWER_READS;
    await expect(page.getByRole("heading", { name: "Founder review is restricted." })).toBeVisible();
    const denied = await page.locator("body").innerText();
    expect(denied, "the reviewer denial leaked internal vocabulary").not.toMatch(/PGRST|SQLSTATE|constraint|policy|founder_admins|rolname|uuid/i);
    observed("isolation", "a second account saw neither the reference nor the payer name, and was refused the review screen");
  });

  test("the Founder customer page is keyboard-operable and fits every qualified width", async ({ page }) => {
    applyReadyOffer();
    await signUp(page, walker);
    await openFounderPage(page);
    await page.getByRole("button", { name: "Start payment claim" }).click();
    await expect(page.getByRole("img", { name: /UPI QR code/ })).toBeVisible();

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

      // The parts that carry the payment truth have to be reachable at this width,
      // not merely present in the document.
      for (const part of [
        page.getByRole("img", { name: /UPI QR code/ }),
        page.getByRole("button", { name: "Open UPI" }),
        page.getByLabel("UPI reference / UTR"),
        page.getByLabel("Payer name"),
        page.getByRole("button", { name: "Submit for review" }),
        page.getByRole("button", { name: "Return to my ledger" }),
      ]) {
        await part.scrollIntoViewIfNeeded();
        await expect(part).toBeInViewport();
      }
      await expect(page.getByText(/Fixture refund terms for local Stage 8 verification only/)).toBeVisible();
    }

    await page.setViewportSize({ width: 1280, height: 800 });

    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    await expect(page.getByRole("region", { name: /Founder benefits/ })).toBeVisible();
    await expect(page.getByRole("region", { name: /Founder terms, privacy, and support/ })).toBeVisible();
    await expect(page.getByRole("img", { name: /UPI QR code/ })).toHaveCount(1);

    const stops: { name: string; marked: boolean; tag: string }[] = [];
    const seen = new Set<string>();
    for (let step = 0; step < 20; step += 1) {
      const stop = await page.evaluate(() => {
        const element = document.activeElement as HTMLElement | null;
        if (!element) return { name: "", marked: false, tag: "none" };
        const style = getComputedStyle(element);
        const labelled = element as HTMLElement & { labels?: ArrayLike<HTMLLabelElement> | null };
        const fromLabel = labelled.labels ? Array.from(labelled.labels, (label) => label.textContent ?? "").join(" ") : "";
        const name = (element.getAttribute("aria-label") || fromLabel || element.textContent || "").replace(/\s+/g, " ").trim();
        const ring = (style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) > 0) || style.boxShadow !== "none";
        return { name, marked: element.matches(":focus-visible") && ring, tag: element.tagName.toLowerCase() };
      });
      expect(stop.name, "a keyboard stop on the Founder page had no name to announce").not.toBe("");
      if (seen.has(stop.name)) break;
      seen.add(stop.name);
      stops.push(stop);
      await page.keyboard.press("Tab");
    }
    // The document body is not a control, so it carries no focus ring and is not judged
    // for one, and its text would make every control look reached. Falling to it is only
    // harmless as the last stop: from the body the next Tab returns to the first control,
    // which the walk has already seen. A fall anywhere else means the page took the
    // element away from under the keyboard, and the control it was holding names it.
    const controls = stops.filter((stop) => stop.tag !== "body");
    const bodyStops = stops.map((stop, position) => ({ stop, position })).filter(({ stop, position }) => position > 0 && stop.tag === "body").map(({ position }) => position);
    const midWalkDrops = bodyStops.filter((position) => position !== stops.length - 1);
    const droppedAfter = midWalkDrops.length ? stops[midWalkDrops[0] - 1] : undefined;
    expect(midWalkDrops, `focus fell to the page body mid-walk after "${droppedAfter?.name.slice(0, 40) ?? "the first stop"}"`).toEqual([]);

    const unmarked = controls.slice(1).filter((stop) => !stop.marked).map((stop) => `${stop.tag} "${stop.name.slice(0, 40)}"`);
    expect(unmarked, "a focused control on the Founder page carried no visible mark").toEqual([]);
    const reached = controls.map((stop) => stop.name).join(" | ");
    for (const part of ["Open UPI", "UPI reference / UTR", "Payer name", "Submit for review"]) {
      expect(reached, `the Tab key never reached ${part}`).toContain(part);
    }
    observed(
      "responsive-accessibility",
      `five widths with no sideways overflow; ${controls.length} named keyboard stops, every one carrying a visible mark${bodyStops.length ? " and ending on the document body as expected" : ""}; QR carries alt text`
    );
  });

  test("the journey leaves no payment facts in browser storage", async ({ page }) => {
    const utr = claimFor(owner.email)?.utr ?? "";
    expect(utr, "the owner's stored reference disappeared before the storage audit").not.toBe("");

    await signIn(page, owner);
    await openFounderPage(page);

    const needles = [FIXTURE_VPA, utr, "Stage8 Buyer", "upi://pay"];
    const audit = await page.evaluate(async (needles: string[]) => {
      const scan = (storage: Storage) => Object.keys(storage).filter((key) => needles.some((needle) => `${key}${storage.getItem(key)}`.includes(needle)));
      const names = (await indexedDB.databases()).map((entry) => entry.name).filter((name): name is string => Boolean(name));
      const bodies: string[] = [];
      for (const name of names) {
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
          const open = indexedDB.open(name);
          open.onsuccess = () => resolve(open.result);
          open.onerror = () => reject(open.error);
          open.onblocked = () => reject(new Error(`${name} is blocked`));
        });
        for (const storeName of Array.from(database.objectStoreNames)) {
          const records = await new Promise<unknown[]>((resolve, reject) => {
            const request = database.transaction(storeName, "readonly").objectStore(storeName).getAll();
            request.onsuccess = () => resolve(request.result as unknown[]);
            request.onerror = () => reject(request.error);
          });
          bodies.push(`${name}.${storeName}:${JSON.stringify(records)}`);
        }
        database.close();
      }
      return {
        local: scan(window.localStorage),
        session: scan(window.sessionStorage),
        databases: names.length,
        storageKeys: Object.keys(window.localStorage),
        hits: bodies.filter((dump) => needles.some((needle) => dump.includes(needle))),
      };
    }, needles);

    expect(
      { local: audit.local, session: audit.session, hits: audit.hits },
      `a payment fact was parked in browser storage (localStorage keys: ${audit.storageKeys.join(", ")})`
    ).toEqual({ local: [], session: [], hits: [] });
    observed("browser-storage", `no fixture destination, reference or payer name in web storage; ${audit.databases} IndexedDB database(s) read`);
  });
});
