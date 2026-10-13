import { expect, test, type Page } from "@playwright/test";

// Found on the deployed sign-in screen during hosted acceptance: the email and password controls
// typed at 11px/700 — the size and weight of their own field labels — while every other control in
// the app types at the body's 14px. `index.css` styles a field label as `.field>span`, and
// `Auth.tsx` wraps those two inputs in `<span className="auth-input">` inside the same `.field`, so
// the wrapper was read as a label and `input { font: inherit; }` passed its typography down to the
// keystrokes. 11px is also below the size iOS auto-zooms to on focus, which is what a person on a
// phone signing in for the first time hits.
//
// The repair has two halves, and the second is a decision rather than a bug: text controls type at
// 16px, deliberately larger than the 14px body, because that is the size below which iOS rescales
// the page on focus. So this gate asks that a control not be its label's size *and* that it clear
// 16px — matching the body would have been the wrong standard.
//
// This runs against `dist-paused` for the reason `release-flags.spec.ts` does: a stylesheet does not
// care which release flags were compiled in, and this is the only browser gate in the repository
// that needs no local Supabase stack — so the fix is measured on the artifact production serves
// without waiting for a deploy that no workflow triggers.

/** Everything outside the loopback server is aborted and named, so a leak fails the run. */
async function stayOnLoopback(page: Page): Promise<string[]> {
  const offsiteRequests: string[] = [];
  const fontHosts = new Set(["fonts.googleapis.com", "fonts.gstatic.com"]);
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") return route.continue();
    // A webfont is not a backend call, and the sizes this spec reads come from the stylesheet,
    // not from the font file — so it is dropped without being counted, as `release-flags.spec.ts`
    // drops it.
    if (fontHosts.has(url.hostname)) return route.abort();
    offsiteRequests.push(url.href);
    return route.abort();
  });
  return offsiteRequests;
}

/** The typography of a control, of the label that names it, and of the document it sits in. */
async function fieldTypography(page: Page, label: string) {
  return page.getByLabel(label).evaluate((control) => {
    const of = (element: Element) => {
      const style = getComputedStyle(element);
      return { px: Number.parseFloat(style.fontSize), text: `${style.fontSize}/${style.fontWeight}` };
    };
    const fieldLabel = control.closest(".field")?.querySelector("label");
    return { control: of(control), fieldLabel: fieldLabel ? of(fieldLabel) : null, body: of(document.body) };
  });
}

test("a sign-in control types its own text, at a size iOS will not zoom to", async ({ page }) => {
  const offsiteRequests = await stayOnLoopback(page);

  await page.goto("/auth");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();

  for (const label of ["Email address", "Password"]) {
    const { control, fieldLabel } = await fieldTypography(page, label);
    expect(
      control.text,
      `"${label}" typed at ${control.text}${fieldLabel ? `, which is its label's ${fieldLabel.text}` : ""} — a control that inherits its label's typography renders keystrokes as caption text`,
    ).not.toBe(fieldLabel?.text);
    expect(
      control.px,
      `"${label}" typed at ${control.px}px. iOS Safari zooms the whole page to reach 16px when a text control is smaller, so the first thing a new customer does on a phone pushes the screen in and off again`,
    ).toBeGreaterThanOrEqual(16);
  }

  expect(offsiteRequests, "the typography gate reached outside its own loopback server").toEqual([]);
});
