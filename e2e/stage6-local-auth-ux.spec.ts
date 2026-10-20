import { expect, test, type Page } from "@playwright/test";
import { completeWorkspaceSetup } from "./workspace-setup";

// Stage 6 Phases 12-15: what the auth screens promise, and what actually happens.
// Everything here runs against the repository's own local Supabase stack. Two
// boundaries are stated rather than tested: local email confirmation is switched
// off in supabase/config.toml (so the confirmation-required branch below is proven
// against a captured provider response, while the destination the app asks for is
// asserted on the real outbound request), and whether the hosted Auth configuration
// *accepts* that destination is only visible in a delivered message, which no
// browser run on this repository can read.
const localStackEnabled = process.env.STAGE6_LOCAL_E2E === "1";
const inboxUrl = process.env.STAGE6_INBOX_URL ?? "http://127.0.0.1:54324";

type Account = { email: string; password: string; displayName: string; businessName: string; token: string };

function newAccount(role: string): Account {
  const token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return {
    token,
    email: `stage6ux-${role}-${token}@dueweave.local`,
    password: `Stage6ux!${token}aA`,
    displayName: `Stage6 ${role} Owner`,
    businessName: `Stage6 ${role} Studio ${token.slice(-6)}`,
  };
}

async function signUp(page: Page, account: Account) {
  await page.goto("/auth");
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Your name").fill(account.displayName);
  await page.getByLabel("Email address").fill(account.email);
  await page.getByLabel("Password").fill(account.password);
  await page.getByRole("button", { name: "Create my workspace" }).click();
  await completeWorkspaceSetup(page, account);
}

async function signOut(page: Page) {
  await page.getByLabel("Primary navigation").getByRole("button", { name: "More" }).click();
  await page.getByRole("button", { name: /Sign out/ }).click();
  await expect(page).toHaveURL(/\/auth$/, { timeout: 15_000 });
}

async function storageKeys(page: Page) {
  return page.evaluate(() => Object.keys(window.localStorage));
}

type CapturedMessage = { ID: string };

/** Wait for the local mail catcher to hold a message for this address. */
async function waitForMail(recipient: string): Promise<string> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const search = await fetch(`${inboxUrl}/api/v1/search?query=${encodeURIComponent(`To:${recipient}`)}`);
    if (search.ok) {
      const { messages } = (await search.json()) as { messages: CapturedMessage[] };
      if (messages.length > 0) {
        const detail = await fetch(`${inboxUrl}/api/v1/message/${messages[0].ID}`);
        const message = (await detail.json()) as { Text: string };
        const link = message.Text.match(/https?:\/\/\S*\/auth\/v1\/verify\?\S+/)?.[0]?.replace(/[)>]+$/, "");
        if (link) return link;
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`No recovery link reached the local mail catcher for ${recipient}.`);
}

test.describe("Stage 6 sign-up and sign-in honesty", () => {
  test.skip(!localStackEnabled, "Set STAGE6_LOCAL_E2E=1 to run against the local Supabase stack.");

  test("treats a confirmation-required sign-up as a wait, never as an open ledger", async ({ page }) => {
    // Local Auth hands out a session immediately, so the hosted answer — a user with
    // no session — is supplied from a captured provider response. Nothing here fakes
    // a session: the point is that the screen must not act like one exists.
    await page.route("**/auth/v1/signup*", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          id: crypto.randomUUID(),
          aud: "authenticated",
          role: "authenticated",
          email: "first-user@dueweave.local",
          phone: "",
          confirmed_at: null,
          confirmation_sent_at: new Date().toISOString(),
          app_metadata: { provider: "email", providers: ["email"] },
          user_metadata: { display_name: "First User" },
          identities: [],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          is_anonymous: false,
        }),
      });
    });

    await page.goto("/auth");
    await page.getByRole("button", { name: "Create an account" }).click();
    await page.getByLabel("Your name").fill("First User");
    await page.getByLabel("Email address").fill("first-user@dueweave.local");
    await page.getByLabel("Password").fill("Confirmation-required!1");
    await page.getByRole("button", { name: "Create my workspace" }).click();

    await expect(page.getByRole("heading", { name: "Confirm your email to open your ledger." })).toBeVisible();
    await expect(page.getByText("first-user@dueweave.local", { exact: true })).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/account is ready|ledger is ready|all set/i);
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    await expect(page).toHaveURL(/\/auth$/);
    expect((await storageKeys(page)).filter((key) => key.startsWith("sb-"))).toEqual([]);

    // The ledger really is closed: the private route still refuses this browser.
    await page.goto("/");
    await expect(page).toHaveURL(/\/auth$/);
    await expect(page.getByRole("heading", { name: "Your follow-ups, in one calm place." })).toBeVisible();

    await page.goto("/auth");
    await page.getByRole("button", { name: "Create an account" }).click();
    await page.getByLabel("Your name").fill("First User");
    await page.getByLabel("Email address").fill("first-user@dueweave.local");
    await page.getByLabel("Password").fill("Confirmation-required!1");
    await page.getByRole("button", { name: "Create my workspace" }).click();
    await page.getByRole("button", { name: /Start again with a different email/ }).click();
    await expect(page.getByLabel("Your name")).toBeVisible();
    await expect(page.getByLabel("Email address")).toHaveValue("");
  });

  test("gives a visitor whose confirmation email never arrived a way to ask again", async ({ page }) => {
    // A lost confirmation email used to be a dead end: the screen said "check your spam",
    // and signing up again met "already registered". GoTrue's /resend is the way out, and
    // an accepted request must be reported as accepted — never as delivered, because from
    // the browser there is no way to know which mailbox it landed in.
    let resendRequests = 0;
    const resendTargets: (string | null)[] = [];
    await page.route("**/auth/v1/signup*", (route) => route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        id: crypto.randomUUID(),
        aud: "authenticated",
        role: "authenticated",
        email: "lost-email@dueweave.local",
        phone: "",
        confirmed_at: null,
        confirmation_sent_at: new Date().toISOString(),
        app_metadata: { provider: "email", providers: ["email"] },
        user_metadata: { display_name: "Lost Email" },
        identities: [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        is_anonymous: false,
      }),
    }));
    await page.route("**/auth/v1/resend*", (route) => {
      resendRequests += 1;
      resendTargets.push(new URL(route.request().url()).searchParams.get("redirect_to"));
      return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
    });

    await page.goto("/auth");
    await page.getByRole("button", { name: "Create an account" }).click();
    await page.getByLabel("Your name").fill("Lost Email");
    await page.getByLabel("Email address").fill("lost-email@dueweave.local");
    await page.getByLabel("Password").fill("Confirmation-required!1");
    await page.getByRole("button", { name: "Create my workspace" }).click();
    await expect(page.getByRole("heading", { name: "Confirm your email to open your ledger." })).toBeVisible();

    await page.getByRole("button", { name: /Send the confirmation email again/ }).click();
    await expect(page.getByText(/cannot tell/i)).toBeVisible();
    expect(resendRequests).toBe(1);
    // A resent link has to arrive no worse than the first one: it must name this site,
    // because a request that names nothing gets the hosted Site URL substituted for it.
    expect(resendTargets).toEqual([`${new URL(page.url()).origin}/auth`]);
    await expect(page.locator("body")).not.toContainText(/we have sent|email sent|successfully sent/i);
    await expect(page).toHaveURL(/\/auth$/);
    expect((await storageKeys(page)).filter((key) => key.startsWith("sb-"))).toEqual([]);
  });

  test("asks for a confirmation link that returns to the site the visitor is standing on", async ({ page }) => {
    // The customer never sees this field, and it is the whole of the difference between a
    // link that opens DueWeave and a link that opens a dead localhost port — measured in a
    // confirmation message actually delivered from the deployed site on 2026-10-12, which
    // named neither and so carried Auth's own Site URL.
    const account = newAccount("link-target");
    const signupRequest = page.waitForRequest((request) => new URL(request.url()).pathname.endsWith("/auth/v1/signup"));

    await page.goto("/auth");
    const origin = new URL(page.url()).origin;
    await page.getByRole("button", { name: "Create an account" }).click();
    await page.getByLabel("Your name").fill(account.displayName);
    await page.getByLabel("Email address").fill(account.email);
    await page.getByLabel("Password").fill(account.password);
    await page.getByRole("button", { name: "Create my workspace" }).click();

    const requested = new URL((await signupRequest).url());
    expect(requested.searchParams.get("redirect_to")).toBe(`${origin}/auth`);
  });

  test("brings a sign-in attempt against an unconfirmed address to the same screen", async ({ page }) => {
    // Measured against production Auth on 2026-10-12: the password grant answers
    // 400 `{"error_code":"email_not_confirmed","msg":"Email not confirmed"}`. The local
    // stack autoconfirms, so the hosted answer is carried in as a captured reply. The
    // screen's job is to turn that into the confirmation panel with the address filled in,
    // rather than the generic sentence that used to swallow it.
    await page.route("**/auth/v1/token?grant_type=password*", (route) => route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ code: 400, error_code: "email_not_confirmed", msg: "Email not confirmed" }),
    }));

    await page.goto("/auth");
    await page.getByLabel("Email address").fill("still-unconfirmed@dueweave.local");
    await page.getByLabel("Password").fill("Confirmation-required!1");
    await page.getByRole("button", { name: "Sign in" }).click();

    await expect(page.getByRole("heading", { name: "Confirm your email to open your ledger." })).toBeVisible();
    await expect(page.getByText("still-unconfirmed@dueweave.local", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /Send the confirmation email again/ })).toBeVisible();
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    await page.goto("/");
    await expect(page).toHaveURL(/\/auth$/);
  });

  test("answers a sign-up the provider itself rejects with one generic sentence", async ({ page }) => {
    // The journey above covers the two no-error endings — a session and a wait. This is
    // the third place a sign-up can end, and the only one where the server's own sentence
    // could reach a customer. The local stack never refuses a well-formed address, so the
    // refusal is carried in from a captured provider reply; the screen's job is to translate
    // it, keep the form usable and invent no session.
    await page.route("**/auth/v1/signup*", async (route) => {
      await route.fulfill({
        status: 422,
        contentType: "application/json",
        body: JSON.stringify({
          code: 422,
          error_code: "over_signup_limit",
          msg: "Signups not allowed for this instance",
          error_msg: "Signups not allowed for this instance",
        }),
      });
    });

    await page.goto("/auth");
    await page.getByRole("button", { name: "Create an account" }).click();
    await page.getByLabel("Your name").fill("Rejected User");
    await page.getByLabel("Email address").fill("rejected@dueweave.local");
    await page.getByLabel("Password").fill("Provider-rejected!1");
    await page.getByRole("button", { name: "Create my workspace" }).click();

    await expect(page.getByRole("alert")).toHaveText("We could not complete that request. Please try again.");
    await expect(page.locator("body")).not.toContainText(/Signups not allowed|error_code|over_signup_limit|PGRST|SQLSTATE/i);
    await expect(page).toHaveURL(/\/auth$/);
    expect((await storageKeys(page)).filter((key) => key.startsWith("sb-"))).toEqual([]);
    await expect(page.getByRole("button", { name: "Create my workspace" })).toBeEnabled();
  });

  test("refuses unusable sign-in input before bothering the server, and stays usable after", async ({ page }) => {
    const tokenRequests: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.endsWith("/auth/v1/token")) tokenRequests.push(request.url());
    });

    await page.goto("/auth");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveText(["Enter your email address.", "Enter your password."]);
    await expect(page.getByLabel("Email address")).toHaveAttribute("aria-invalid", "true");
    await expect(page.getByLabel("Password")).toHaveAttribute("aria-invalid", "true");
    expect(tokenRequests).toEqual([]);
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeEnabled();

    await page.getByLabel("Email address").fill("not-yet-an-email");
    await page.getByLabel("Password").fill("anything-at-all");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByText("That does not look like an email address yet.")).toBeVisible();
    expect(tokenRequests).toEqual([]);

    await page.getByLabel("Email address").fill("nobody@dueweave.local");
    await expect(page.getByText("That does not look like an email address yet.")).toHaveCount(0);

    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveText("That email and password combination does not match an account.");
    await expect(page.getByLabel("Email address")).toHaveValue("nobody@dueweave.local");
    await expect(page.getByLabel("Password")).toBeEnabled();
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeEnabled();
    // The signature of a Postgres authorization refusal, not the bare word "policy": the
    // sign-in screen links a Privacy Policy, and CI read that as a leak.
    await expect(page.locator("body")).not.toContainText(/PGRST|SQLSTATE|postgrest|gotrue|InvalidLogin|constraint|row-level security/i);
  });

  test("shows a pending sign-in only while the request is actually in flight", async ({ page }) => {
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route("**/auth/v1/token*", async (route) => {
      await held;
      await route.continue();
    });

    await page.goto("/auth");
    await page.getByLabel("Email address").fill("nobody@dueweave.local");
    await page.getByLabel("Password").fill("anything-at-all");
    // The control renames itself while the request is in flight, so it is located by
    // its place in the form rather than by its momentary text.
    const submit = page.locator("button.auth-submit");
    await expect(submit).toHaveText("Sign in");
    await submit.click();

    await expect(submit).toBeDisabled();
    await expect(submit).toHaveText("Please wait");
    // A wait must not cost the person what they typed or lock the fields.
    await expect(page.getByLabel("Email address")).toHaveValue("nobody@dueweave.local");
    await expect(page.getByLabel("Email address")).toBeEnabled();

    release();
    await expect(page.getByRole("alert")).toHaveText("That email and password combination does not match an account.");
    await expect(submit).toBeEnabled();
    await expect(submit).toHaveText("Sign in");
  });

  test("says the truth when DueWeave cannot be reached and keeps the typed email", async ({ page }) => {
    await page.route("**/auth/v1/token*", (route) => route.abort());
    await page.goto("/auth");
    await page.getByLabel("Email address").fill("reachable-again@dueweave.local");
    await page.getByLabel("Password").fill("anything-at-all");
    await page.getByRole("button", { name: "Sign in", exact: true }).click();

    await expect(page.getByRole("alert")).toHaveText("We could not reach DueWeave. Check your connection and try again.");
    await expect(page.getByLabel("Email address")).toHaveValue("reachable-again@dueweave.local");
    await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeEnabled();
    await page.unroute("**/auth/v1/token*");
  });
});

test.describe("Stage 6 password recovery and sign-out", () => {
  test.skip(!localStackEnabled, "Set STAGE6_LOCAL_E2E=1 to run against the local Supabase stack.");

  test("will not offer a password form to a browser with no recovery session", async ({ page }) => {
    await page.goto("/auth/update-password");
    await expect(page.getByRole("heading", { name: "This recovery link is not active." })).toBeVisible();
    // D-Rec-1. A lapsed or already-used link was measured arriving on production (2026-10-19) with
    // nothing at all in its address — `/auth/v1/verify` answered 303 with an empty fragment for a
    // good link and a dead one alike — so this panel is the only place a customer can be told what
    // happened. It used to name a security rule and no reason, leaving an expired link
    // indistinguishable from a broken one and the next step undiscoverable.
    await expect(page.locator(".auth-heading p")).toHaveText(/can be used once, and only for a limited time/);
    await expect(page.locator(".auth-heading p")).toHaveText(/Ask for a fresh link below/);
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Save new password" })).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText(/PGRST|SQLSTATE|postgrest|gotrue|constraint|row-level security/i);

    await page.getByRole("button", { name: "Request a new reset link" }).click();
    await expect(page.getByRole("heading", { name: "Return to your ledger." })).toBeVisible();
    await expect(page.getByLabel("Email address")).toBeVisible();

    await page.goto("/auth/update-password");
    await page.getByRole("button", { name: "Back to sign in" }).click();
    await expect(page).toHaveURL(/\/auth$/);
    await expect(page.getByRole("heading", { name: "Your follow-ups, in one calm place." })).toBeVisible();
  });

  test("completes a real recovery from the emailed link and refuses the old password", async ({ page }) => {
    test.slow();
    const account = newAccount("recover");
    const newPassword = `Stage6ux-rotated-${account.token.slice(-6)}!`;

    await signUp(page, account);
    await signOut(page);

    await page.getByRole("button", { name: "Forgot password?" }).click();
    await page.getByLabel("Email address").fill(account.email);
    await page.getByRole("button", { name: "Send reset link" }).click();
    await expect(page.getByText("If that email belongs to a DueWeave account, a reset link is on its way.")).toBeVisible();

    const link = await waitForMail(account.email);
    await page.goto(link);

    // The same route now has a recovery session, so the password form is honest here.
    await expect(page.getByRole("heading", { name: "Choose a new password." })).toBeVisible({ timeout: 20_000 });
    await page.getByLabel("New password").fill(newPassword);
    await page.getByRole("button", { name: "Save new password" }).click();
    await expect(page.getByText("Your password has been updated. You can return to your ledger.")).toBeVisible();
    await expect(page).toHaveURL(/\/$/, { timeout: 20_000 });

    await signOut(page);
    await page.getByLabel("Email address").fill(account.email);
    await page.getByLabel("Password").fill(account.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page.getByRole("alert")).toHaveText("That email and password combination does not match an account.");

    await page.getByLabel("Password").fill(newPassword);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/$/, { timeout: 20_000 });
    await expect(page.getByLabel("Primary navigation")).toBeVisible();
  });

  test("signing out leaves no client, amount or session behind in this browser", async ({ page }) => {
    test.slow();
    const account = newAccount("exit");
    // The client picker searches by name, so the record names carry the same short
    // handle the search box is filled with.
    const needle = account.token.slice(-6);
    const clientName = `Stage6 Exit client ${needle}`;
    const receivableLabel = `Stage6 Exit invoice ${needle}`;

    await signUp(page, account);
    await page.getByRole("button", { name: /Add a client first|Add client$/ }).first().click();
    await page.getByLabel("Client name").fill(clientName);
    await page.getByRole("button", { name: "Save client" }).click();
    await expect(page.getByText("Client added", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Add receivable" }).first().click();
    await page.getByRole("button", { name: "Existing client" }).click();
    await page.getByLabel("Search existing clients").fill(needle);
    await page.getByRole("option", { name: new RegExp(needle) }).click();
    await page.getByLabel("Amount").fill("1800");
    await page.getByLabel("Due date").fill("2026-10-20");
    await page.getByLabel("What is this for?").fill(receivableLabel);
    await page.getByRole("button", { name: "Save receivable" }).click();
    await expect(page.getByText("Receivable added", { exact: true })).toBeVisible();

    // Proof that both facts were really on screen in this account's document.
    await expect(page.getByText(receivableLabel, { exact: false }).first()).toBeVisible();
    await expect(page.getByText("1,800", { exact: false }).first()).toBeVisible();

    await signOut(page);
    await expect(page.getByRole("heading", { name: "Your follow-ups, in one calm place." })).toBeVisible();
    await expect(page.getByLabel("Primary navigation")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText(clientName);
    await expect(page.locator("body")).not.toContainText(receivableLabel);
    await expect(page.locator("body")).not.toContainText("1,800");
    expect((await storageKeys(page)).filter((key) => key.startsWith("sb-"))).toEqual([]);

    // Every protected redirect in the app replaces its history entry, so Back has
    // nothing private to return to; a hard revisit of the ledger is refused too.
    await page.goBack();
    await expect(page.locator("body")).not.toContainText(clientName);
    await expect(page.locator("body")).not.toContainText(receivableLabel);
    await page.goto("/");
    await expect(page).toHaveURL(/\/auth$/);
    await expect(page.locator("body")).not.toContainText(clientName);
    await expect(page.locator("body")).not.toContainText(receivableLabel);
  });

  test("returns a browser whose stored session was removed to the gateway, not an error screen", async ({ page }) => {
    test.slow();
    const account = newAccount("lost-session");
    await signUp(page, account);
    await expect(page.getByLabel("Primary navigation")).toBeVisible();

    // This is what an expired session looks like to the client: the storage keeps its
    // shape, but the token the SDK would present is gone. e2e/auth-lifecycle-limits.spec.ts
    // has always performed exactly this attack and has always been gated on hosted
    // credentials, so no release gate ever ran it; the behaviour belongs to the local
    // stack, so it lives here now.
    await page.evaluate(() => {
      for (const key of Object.keys(window.localStorage)) {
        if (key.startsWith("sb-") && key.endsWith("-auth-token")) window.localStorage.removeItem(key);
      }
    });
    await page.reload();

    await expect(page).toHaveURL(/\/auth$/, { timeout: 20_000 });
    await expect(page.getByRole("heading", { name: "Your follow-ups, in one calm place." })).toBeVisible();
    await expect(page.locator("body")).not.toContainText(/PGRST|SQLSTATE|postgrest|gotrue|constraint|row-level security/i);

    // The account itself is untouched — only this browser lost its session.
    await page.getByLabel("Email address").fill(account.email);
    await page.getByLabel("Password").fill(account.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/$/, { timeout: 20_000 });
    await expect(page.getByLabel("Primary navigation")).toBeVisible();
  });
});

test.describe("An emailed link that arrives reporting a problem", () => {
  test("explains a link that no longer works instead of staying silent, and clears it from the address", async ({ page }) => {
    // Measured from the hosted auth server itself on 2026-10-14: a confirmation link opened
    // a second time — after the first, successful pass already consumed the one-time token —
    // answers 303 and lands here as
    // `/auth#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid
    // +or+has+expired`. The deployed screen showed a silent sign-in form and left that
    // sentence in the address bar, so a confirmed customer was told nothing at all.
    await page.goto("/auth#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired&sb=");

    await expect(page.getByText("This emailed link no longer works")).toBeVisible();
    // The way forward is the form, still working, not a dead end.
    await expect(page.getByLabel("Email address")).toBeVisible();
    await expect(page.getByLabel("Password")).toBeVisible();
    // The report is read once: a refresh cannot re-announce it, and the server wording is
    // never what the customer is made to read.
    await expect(page).toHaveURL(/\/auth$/);
    await expect(page.locator("body")).not.toContainText(/otp_expired|access_denied|Email link is invalid|SQLSTATE|PGRST|gotrue/i);
    await page.reload();
    await expect(page.getByText("This emailed link no longer works")).toHaveCount(0);
  });

  test("says nothing at all when the link worked and carried a session back", async ({ page }) => {
    // The same address shape is how a successful confirmation arrives, so an unconditional
    // complaint would blame a customer whose link actually did its job.
    await page.goto("/auth#access_token=not-a-real-token&refresh_token=not-a-real-token&token_type=bearer&expires_in=3600&type=confirmation&sb=");

    await expect(page.getByText("This emailed link no longer works")).toHaveCount(0);
    await expect(page.getByText("could not be read as a DueWeave confirmation link")).toHaveCount(0);
    await expect(page.getByLabel("Email address")).toBeVisible();
  });

  test("explains a link that arrives while this screen is already open", async ({ page }) => {
    // The likeliest duplicate open is exactly this one: the customer is already on the
    // sign-in screen — they were just told to confirm their email — and clicks the link
    // from there. That navigation changes only the address fragment, so the document is
    // never reloaded and a read made only on the first render says nothing. Measured on
    // the built bundle on 2026-10-14: `location.hash` alone moved, one `hashchange` fired,
    // the sentence stayed in the address bar.
    await page.goto("/auth");
    await page.evaluate(() => {
      window.location.hash = "error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired&sb=";
    });

    await expect(page.getByText("This emailed link no longer works")).toBeVisible();
    await expect(page.getByLabel("Email address")).toBeVisible();
    await expect(page).toHaveURL(/\/auth$/);
    await expect(page.locator("body")).not.toContainText(/otp_expired|access_denied|Email link is invalid|SQLSTATE|PGRST|gotrue/i);
  });

  test("does not keep complaining once a later arrival carries a session", async ({ page }) => {
    // An explanation is about the link that just arrived. When the next arrival is a working
    // one, holding the old complaint on screen would tell a confirmed customer they failed.
    await page.goto("/auth#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired&sb=");
    await expect(page.getByText("This emailed link no longer works")).toBeVisible();

    await page.evaluate(() => {
      window.location.hash = "access_token=not-a-real-token&refresh_token=not-a-real-token&token_type=bearer&expires_in=3600&type=confirmation&sb=";
    });

    await expect(page.getByText("This emailed link no longer works")).toHaveCount(0);
    await expect(page.getByLabel("Email address")).toBeVisible();
  });
});
