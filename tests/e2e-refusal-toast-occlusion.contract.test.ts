import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// D-S9-9 was recorded as a race between a Sonner refusal card and the `.founder-limit-callout`
// button underneath it, and was closed by making the journey empty the notification stack before
// clicking. That was a rule about test order, and it hid the defect. Measured at rest, the Free-limit
// refusal card lands on the very control it names: 7953px^2 of its 8443px^2 box at 1280x720 (94%)
// and the whole 8443px^2 at 768x1024, and a pointer parked on a covered control holds that card open
// so the click can neither land nor fail early. The product rule is that an announcement must not
// be a wall: the card stays visible for its full lifetime, keeps its own action, and stops being a
// hit target for anything that is not its own button.
const root = path.resolve(import.meta.dirname, "..");

/** Read a source file with the checkout's CRLF removed, so rules are written once. */
function source(...segments: string[]) {
  return readFileSync(path.join(root, ...segments), "utf8").replace(/\r\n/g, "\n");
}

const PASSTHROUGH_CARD = "[data-sonner-toast].toast--passthrough { pointer-events: none; }";
const PASSTHROUGH_ACTION = "[data-sonner-toast].toast--passthrough [data-button] { pointer-events: auto; }";

describe("the refusal announcement lets the control it names take the click", () => {
  it("the shipped stylesheet makes a passthrough card transparent and its own action not", () => {
    const css = source("client", "src", "index.css");
    expect(css, "a refusal card that names a control must not intercept the pointer over it").toContain(PASSTHROUGH_CARD);
    expect(css, "the card's own action is a real control and must stay clickable").toContain(PASSTHROUGH_ACTION);
  });

  it("`feedback.error` turns the `passthrough` option into that card class and keeps the refusal lifetime", () => {
    const sonner = source("client", "src", "components", "ui", "sonner.tsx");
    expect(sonner, "the option has to map onto the class the stylesheet declares").toContain('"toast--passthrough"');
    expect(sonner).toContain("passthrough ? { className: PASSTHROUGH_TOAST_CLASS }");
    expect(sonner, "transparency must not become a shorter message: a refusal still stays 9 seconds").toContain("{ duration: REFUSAL_TOAST_MS");
    expect(sonner.match(/const REFUSAL_TOAST_MS = 9_000;/), "the refusal lifetime is part of this contract").toBeTruthy();
  });

  it("the Free-limit refusal opts in and still carries its own route to Founder", () => {
    const home = source("client", "src", "pages", "Home.tsx");
    const start = home.indexOf('feedback.error("Your Free plan limit is reached."');
    expect(start, "the ledger still refuses the fourth receivable with this announcement").toBeGreaterThanOrEqual(0);
    const refusal = home.slice(start, home.indexOf("\n", start));
    expect(refusal, "this is the refusal that raises the call-out under itself, so it must pass the pointer through").toContain("passthrough: true");
    expect(refusal, "the card keeps its own Founder action; the journey that clicks it depends on it").toContain('action: { label: "View Founder"');
    expect(
      refusal,
      "transparency is not an excuse to shorten the refusal: the reason it gives stays on screen",
    ).toContain('description: "Founder access removes the active-receivable limit after manual approval."');
  });

  it.each([
    {
      file: "stage8-local-founder-reviewer.spec.ts",
      from: 'toastTitle(page, "Your Free plan limit is reached.")',
      to: "viewFounder.click(",
    },
    {
      file: "stage8-local-founder-customer.spec.ts",
      from: "const cardBox = await restingToastBox(card)",
      to: "await cta.click(",
    },
  ])("%s presses the covered control while the card is still up", ({ file, from, to }) => {
    const spec = source("e2e", file);
    const start = spec.indexOf(from);
    const end = spec.indexOf(to, start);
    expect(start, `${file} no longer drives the refusal into the call-out`).toBeGreaterThanOrEqual(0);
    expect(end, `${file} no longer clicks the control the refusal names`).toBeGreaterThanOrEqual(0);
    const gap = spec.slice(start, end);
    expect(gap, `${file} waits the notification stack out instead of testing the card where it stands`).not.toContain("clearToasts(page)");
    expect(gap, `${file} clicks blind: it never measures whether the card owns the pointer`).toContain("pointerOwnedByToast(page");
  });

  it("the pointer probe reads the hit test and the box at rest, never a sleep", () => {
    const harness = source("e2e", "founder-browser-harness.ts");
    const probe = harness.slice(harness.indexOf("export function pointerOwnedByToast"), harness.indexOf("export async function addReceivable"));
    expect(probe, "the probe must ask the browser what owns the point").toContain("document.elementFromPoint");
    expect(probe, "ownership means the notification card, not a sibling").toContain("[data-sonner-toast]");
    const resting = harness.slice(harness.indexOf("export async function restingToastBox"), harness.indexOf("export function boxOverlap"));
    expect(resting, "a box read mid-animation describes the animation, not the geometry a pointer meets").toContain(".poll(");
    expect(resting, "restingToastBox must settle on a condition, not on a delay").not.toContain("waitForTimeout");
  });

  it("clearToasts still waits for the notification stack to empty rather than for a fixed delay", () => {
    const harness = source("e2e", "founder-browser-harness.ts");
    const helper = harness.slice(harness.indexOf("export async function clearToasts"));
    expect(helper, "clearToasts must keep asserting on the stack itself").toContain('locator("li")');
    expect(helper, "clearToasts must wait for the stack to empty, not sleep").toContain("toHaveCount(0");
  });
});
