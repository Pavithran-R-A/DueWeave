import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// D-S9-9: run 36679362037's `browser` job failed `stage8-local-founder-reviewer.spec.ts:356` with
// `locator.click: Test timeout of 180000ms exceeded`, and its call log names the intercepting
// element as the refusal toast Sonner renders over the `.founder-limit-callout` button. Sonner
// expands its stack on pointer enter and holds a toast's dismissal timer while it is expanded, so
// Playwright parking the pointer on the covered button kept the covering toast alive: the click
// could never land and could never time out early. Which journey loses that race against the
// 9-second refusal lifetime is decided by the database round-trip in between — which is why the
// identical code passed on run 36569878819 and failed here.
//
// The repair is the convention this harness already uses elsewhere: let the notification stack
// empty before acting on what sits beneath it (`clearToasts`, e2e/founder-browser-harness.ts).
const root = path.resolve(import.meta.dirname, "..");

const REFUSAL_TOAST = 'toastTitle(page, "Your Free plan limit is reached.")';
const COVERED_CONTROL = 'getByRole("button", { name: /View Founder access/ })';

/** Every `refusal assertion -> click on the control it covers` pair in the file. */
function clickUnderToast(specFile: string) {
  const source = readFileSync(path.join(root, "e2e", specFile), "utf8");
  const pairs: { assertion: number; click: number; gap: string }[] = [];
  let from = 0;
  for (;;) {
    const assertion = source.indexOf(REFUSAL_TOAST, from);
    if (assertion < 0) return pairs;
    const click = source.indexOf(COVERED_CONTROL, assertion);
    if (click < 0) return pairs;
    pairs.push({ assertion, click, gap: source.slice(assertion + REFUSAL_TOAST.length, click) });
    from = click + COVERED_CONTROL.length;
  }
}

describe("a release journey does not click a control while the toast covering it is still up", () => {
  it.each(["stage8-local-founder-reviewer.spec.ts", "stage8-local-founder-customer.spec.ts"])(
    "%s waits for the refusal toast to leave before clicking the Founder call-out it overlaps",
    (specFile) => {
      const pairs = clickUnderToast(specFile);
      expect(pairs.length, `${specFile} no longer drives the refusal path into the call-out`).toBeGreaterThan(0);
      for (const { gap } of pairs) {
        expect(
          gap.includes("clearToasts(page)"),
          `${specFile} clicks .founder-limit-callout's button while the refusal toast it just asserted can still be covering it; a pointer parked on the covered control holds that toast open forever`,
        ).toBe(true);
      }
    },
  );

  it("clearToasts waits for the notification stack to empty rather than for a fixed delay", () => {
    const harness = readFileSync(path.join(root, "e2e", "founder-browser-harness.ts"), "utf8");
    const helper = harness.slice(harness.indexOf("export async function clearToasts"));
    expect(helper, "clearToasts must keep asserting on the stack itself").toContain('locator("li")');
    expect(helper, "clearToasts must wait for the stack to empty, not sleep").toContain("toHaveCount(0");
  });
});
