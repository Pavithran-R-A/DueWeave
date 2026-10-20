import { expect, test, type Page } from "@playwright/test";

// Item 14 (CL-7 Stage C) asked for the sign-in screen to be reassessed for mobile behavior and
// accessibility after item 11 put a trust row underneath it. The row is the only route to a
// Privacy Policy for a visitor who does not have an account yet, and it is the smallest thing on
// the screen a customer is asked to hit — on a phone, with a thumb.
//
// The repository already measures 24px targets and horizontal overflow, but only in
// `e2e/stage6-local-responsive.spec.ts`, which signs in against the local stack and walks the
// ledger. A signed-out visitor on the deployed artifact is the part of the product that gets the
// most phone traffic and had the least measurement, so this is the gate for it.
//
// It runs against `dist-paused` for the reason given in `release-flags.spec.ts`: that build is
// the one production serves today, it needs no Supabase stack, and nothing here may leave the
// loopback server — every request outside it is named and fails the run, as in
// `auth-field-typography.spec.ts`.
//
// The bar is the repository's own: 24x24 CSS pixels is what `stage6-local-responsive.spec.ts`
// already treats as the smallest acceptable target, and 4.5:1 is the text-contrast floor this
// release line retinted its tokens to reach (CL-16, CL-17).

const DOCUMENTS = [
  { name: "Privacy Policy", route: "/privacy" },
  { name: "Terms of Use", route: "/terms" },
  { name: "Support", route: "/support" },
] as const;

/** The phone this product was designed on, and the narrowest screen it is asked to support. */
const PHONE = { width: 390, height: 844 };
const NARROWEST = { width: 360, height: 800 };

/** Everything outside the loopback server is aborted and named, so a leak fails the run. */
async function stayOnLoopback(page: Page): Promise<string[]> {
  const offsiteRequests: string[] = [];
  const fontHosts = new Set(["fonts.googleapis.com", "fonts.gstatic.com"]);
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") return route.continue();
    // A webfont is not a backend call, and neither the geometry nor the colors read below come
    // from the font file — so it is dropped without being counted, as the other two gates do.
    if (fontHosts.has(url.hostname)) return route.abort();
    offsiteRequests.push(url.href);
    return route.abort();
  });
  return offsiteRequests;
}

/**
 * A link's hit box and its text against the background the browser actually paints behind it —
 * the panel's solid colour, walked up from the link, since the tint that fades in from the
 * top-right corner has faded out by the time the eye reaches this row at the bottom.
 */
async function measureTrustLink(page: Page, name: string) {
  return page.getByRole("link", { name, exact: true }).evaluate((link) => {
    const parse = (color: string) => {
      const numbers = color.match(/[\d.]+/g)?.map(Number) ?? [];
      return { r: numbers[0] ?? 0, g: numbers[1] ?? 0, b: numbers[2] ?? 0, a: numbers.length > 3 ? numbers[3] : 1 };
    };
    const channel = (value: number) => (value / 255 <= 0.03928 ? value / 255 / 12.92 : ((value / 255 + 0.055) / 1.055) ** 2.4);
    const luminance = (color: { r: number; g: number; b: number }) =>
      0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);

    const layers: Array<{ r: number; g: number; b: number; a: number }> = [];
    for (let node: Element | null = link; node; node = node.parentElement) {
      const background = parse(getComputedStyle(node).backgroundColor);
      if (background.a === 0) continue;
      layers.push(background);
      if (background.a === 1) break;
    }
    if (layers.length === 0) throw new Error("no painted background below the trust row");
    let painted = { ...layers[layers.length - 1]!, a: 1 };
    for (let index = layers.length - 2; index >= 0; index -= 1) {
      const layer = layers[index]!;
      painted = {
        r: layer.r * layer.a + painted.r * (1 - layer.a),
        g: layer.g * layer.a + painted.g * (1 - layer.a),
        b: layer.b * layer.a + painted.b * (1 - layer.a),
        a: 1,
      };
    }

    const text = parse(getComputedStyle(link).color);
    const first = luminance(text);
    const second = luminance(painted);
    const box = link.getBoundingClientRect();
    return {
      width: box.width,
      height: box.height,
      fontSize: Number.parseFloat(getComputedStyle(link).fontSize),
      contrast: (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05),
    };
  });
}

test("hands a phone customer three documents whose targets a thumb can hit", async ({ page }) => {
  const offsiteRequests = await stayOnLoopback(page);
  await page.setViewportSize(PHONE);
  await page.goto("/auth");

  for (const { name } of DOCUMENTS) {
    const link = page.getByRole("link", { name, exact: true });
    await expect(link, `the sign-in screen offers no link named "${name}"`).toBeVisible();
    const { width, height, fontSize } = await measureTrustLink(page, name);
    expect(
      Math.min(width, height),
      `"${name}" is a ${width.toFixed(1)}x${height.toFixed(1)}px target of ${fontSize}px type. A customer signing in on a phone has to hit it with a thumb, and 24px is the floor every other touch target in this app is already measured against`,
    ).toBeGreaterThanOrEqual(24);
  }

  expect(offsiteRequests, "the target-size gate reached outside its own loopback server").toEqual([]);
});

test("keeps the trust row inside the narrowest phone and readable on it", async ({ page }) => {
  const offsiteRequests = await stayOnLoopback(page);
  await page.setViewportSize(NARROWEST);
  await page.goto("/auth");
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();

  for (const { name } of DOCUMENTS) {
    const { contrast } = await measureTrustLink(page, name);
    expect(
      contrast,
      `"${name}" is ${contrast.toFixed(2)}:1 against the background it sits on — a customer who needs to read what happens to their ledger before they trust it to it`,
    ).toBeGreaterThanOrEqual(4.5);
  }

  const overflow = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
  }));
  expect(
    overflow.scrollWidth,
    `the sign-in screen scrolls sideways at ${NARROWEST.width}px (${overflow.scrollWidth} inside ${overflow.clientWidth})`,
  ).toBeLessThanOrEqual(overflow.clientWidth + 1);

  expect(offsiteRequests, "the narrow-phone gate reached outside its own loopback server").toEqual([]);
});

test("lets a keyboard reach every document from the sign-in screen, and says where it is", async ({ page }) => {
  const offsiteRequests = await stayOnLoopback(page);
  await page.setViewportSize(PHONE);
  await page.goto("/auth");

  // The paused screen has one control after the form — this is the whole tab order the row can
  // break, and the order is the claim: Privacy, Terms, Support, in the order they are read.
  await page.getByRole("button", { name: "Sign in", exact: true }).focus();
  for (const { name } of DOCUMENTS) {
    await page.keyboard.press("Tab");
    const stop = await page.evaluate(() => {
      const element = document.activeElement as HTMLElement | null;
      if (!element) return { text: "", focusVisible: false, outlineWidth: 0, outlineStyle: "none" };
      const style = getComputedStyle(element);
      return {
        text: element.textContent?.trim() ?? "",
        focusVisible: element.matches(":focus-visible"),
        outlineWidth: Number.parseFloat(style.outlineWidth),
        outlineStyle: style.outlineStyle,
      };
    });
    expect(stop.text, `the tab stop after the sign-in button was "${stop.text}", not "${name}"`).toBe(name);
    expect(stop.focusVisible, `"${name}" took focus from the keyboard without Chromium marking it focus-visible`).toBe(true);
    expect(
      stop.outlineStyle === "none" ? 0 : stop.outlineWidth,
      `"${name}" is reachable but invisible: no focus ring is drawn on it`,
    ).toBeGreaterThan(0);
  }

  expect(offsiteRequests, "the keyboard gate reached outside its own loopback server").toEqual([]);
});

test("opens the document each link names, on the artifact production serves", async ({ page }) => {
  const offsiteRequests = await stayOnLoopback(page);
  await page.setViewportSize(PHONE);

  for (const { name, route } of DOCUMENTS) {
    await page.goto("/auth");
    await page.getByRole("link", { name, exact: true }).click();
    await expect(page.getByRole("heading", { level: 1 }), `clicking "${name}" did not render a document`).toBeVisible();
    await expect(page.locator(".legal-body"), `"${name}" opens a page with no body to read`).toBeVisible();
    expect(new URL(page.url()).pathname, `"${name}" opened something other than ${route}`).toBe(route);
  }

  expect(offsiteRequests, "the trust-link navigation gate reached outside its own loopback server").toEqual([]);
});
