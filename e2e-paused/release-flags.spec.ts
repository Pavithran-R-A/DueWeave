import { expect, test, type Page } from "@playwright/test";

// CL-9 follow-up: the release flags have to decide what a person can *reach*, not merely what a
// bundle contains. Everything below runs against `dist-paused` — both flags stated as `"false"`
// — so it is the only suite in the repository that measures a closed flow. The same screens'
// open flow is measured by `e2e/stage6-local-auth-ux.spec.ts`, which drives the flags-on build
// against the local stack and clicks this screen's way out of it into the registration form.
//
// Nothing here contacts the hosted project: `page.route` answers every request that leaves the
// loopback origin, so the run cannot create a user or send an email, and it records what it
// intercepted so a leak fails the test instead of merely being impolite.

const PAUSED_SIGNUP_COPY = /New registrations are temporarily paused/i;
const PAUSED_EMAIL_COPY = /Confirmation emails are temporarily unavailable/i;
const PAUSED_RECOVERY_COPY = /Password recovery emails are temporarily unavailable/i;

type Intercepted = { signupRequests: string[]; tokenRequests: string[]; offsiteRequests: string[] };

/**
 * A stand-in GoTrue that never leaves the browser. Sign-in answers with the one provider
 * response the product routes to the confirmation screen; a signup attempt is recorded before it
 * is answered, so the assertion can name the request that should never have been made.
 *
 * Everything else outside the loopback server is aborted, and only the font stylesheet the
 * shipped `index.html` links is not counted as a departure: a webfont is not a backend call, and
 * a paused-bundle run needs neither to make its point.
 */
async function interceptAuthServer(page: Page): Promise<Intercepted> {
  const signupRequests: string[] = [];
  const tokenRequests: string[] = [];
  const offsiteRequests: string[] = [];
  const fontHosts = new Set(["fonts.googleapis.com", "fonts.gstatic.com"]);
  await page.route("**/*", (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.hostname === "127.0.0.1" || url.hostname === "localhost") return route.continue();
    if (url.pathname.startsWith("/auth/v1/")) {
      if (url.pathname.endsWith("/signup")) {
        signupRequests.push(`${request.method()} ${url.pathname}`);
        return route.fulfill({
          status: 200,
          contentType: "application/json",
          body: JSON.stringify({ user: { id: "paused-gate-only", aud: "authenticated", role: "authenticated" }, session: null }),
        });
      }
      if (url.pathname.endsWith("/token")) {
        const body = request.postData() ?? "";
        tokenRequests.push(`${url.pathname} ${body.includes("captcha") ? "with" : "without"} a CAPTCHA field`);
        return route.fulfill({
          status: 400,
          contentType: "application/json",
          body: JSON.stringify({ code: 400, error_code: "email_not_confirmed", msg: "Email not confirmed" }),
        });
      }
      return route.fulfill({ status: 400, contentType: "application/json", body: "{}" });
    }
    if (fontHosts.has(url.hostname)) return route.abort();
    offsiteRequests.push(url.href);
    return route.abort();
  });
  return { signupRequests, tokenRequests, offsiteRequests };
}

/** The screen a person lands on when an address exists but has not been confirmed. */
async function driveToConfirmationPanel(page: Page) {
  await page.goto("/auth");
  await page.getByLabel("Email address").fill("paused-bundle-gate@example.invalid");
  await page.getByLabel("Password").fill("Paused-bundle-gate!1");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { name: /Confirm your email to open your ledger/ })).toBeVisible();
}

test("the paused build states every closed flow and offers no control that opens one", async ({ page }) => {
  await interceptAuthServer(page);

  await page.goto("/auth");
  await expect(page.getByText(PAUSED_SIGNUP_COPY)).toBeVisible();
  await expect(page.getByText(PAUSED_RECOVERY_COPY)).toBeVisible();
  await expect(page.getByRole("button", { name: "Create an account" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Forgot password?" })).toHaveCount(0);

  await driveToConfirmationPanel(page);
  const panel = page.locator(".auth-outcome");
  await expect(panel.getByText(PAUSED_EMAIL_COPY)).toBeVisible();
  await expect(panel.getByRole("button", { name: /Send the confirmation email again/ })).toHaveCount(0);
  // The screen's own copy says registrations are paused, so it may not advertise the way into a
  // registration either. This is the control that made the deployed bundle fail open.
  await expect(panel.getByRole("button", { name: /Start again with a different email/ })).toHaveCount(0);
});

test("no button on the paused confirmation screen opens the registration form", async ({ page }) => {
  const { signupRequests, offsiteRequests } = await interceptAuthServer(page);

  await driveToConfirmationPanel(page);
  const panel = page.locator(".auth-outcome");
  const buttonCount = await panel.locator("button").count();
  // Positive landmark before any absence assertion: a panel locator that matched nothing would
  // make every "the form never opened" check below pass without clicking once.
  expect(buttonCount, "the paused confirmation screen rendered no buttons, so this suite clicked nothing").toBeGreaterThan(0);

  for (let index = 0; index < buttonCount; index += 1) {
    await driveToConfirmationPanel(page);
    const button = panel.locator("button").nth(index);
    const label = (await button.innerText()).trim();
    await button.click();
    await expect(
      page.getByLabel("Your name"),
      `the paused build opened the registration form after "${label}" — the flag states signup is paused`,
    ).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Create my workspace" })).toHaveCount(0);
  }

  expect(signupRequests, "a paused bundle asked the auth server to create a user").toEqual([]);
  expect(offsiteRequests, "the paused-bundle gate reached outside its own loopback server").toEqual([]);
});

test("a build with no CAPTCHA site key verifies with the provider alone", async ({ page }) => {
  const { tokenRequests, offsiteRequests } = await interceptAuthServer(page);

  await driveToConfirmationPanel(page);
  // The positive landmark: the address really was offered to the stand-in GoTrue, so the checks
  // below measure a build that declined to attach a token, not a screen that never asked.
  expect(tokenRequests, "sign-in never reached the auth server, so nothing was proved about the CAPTCHA field").toEqual([
    "/auth/v1/token without a CAPTCHA field",
  ]);

  // A site key-less build mounts no widget, so it must not load the third-party CAPTCHA API at
  // all — a stray `<script>` for it would be both a departure from the origin and a visible frame.
  await expect(page.locator("script[src*='challenges.cloudflare.com'], iframe[src*='challenges.cloudflare.com']")).toHaveCount(0);
  expect(offsiteRequests, "the CAPTCHA loader reached outside the loopback server in a build with no site key").toEqual([]);
});
