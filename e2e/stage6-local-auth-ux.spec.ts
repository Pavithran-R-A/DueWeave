import { expect, test, type Page } from "@playwright/test";
import { completeWorkspaceSetup } from "./workspace-setup";

// Stage 6 Phases 12-15: what the auth screens promise, and what actually happens.
// Everything here runs against the repository's own local Supabase stack. Two
// boundaries are stated rather than tested: local email confirmation is switched
// off in supabase/config.toml (so the confirmation-required branch below is proven
// against a captured provider response, not a hosted SMTP run), and the hosted Site
// URL / allowed redirect URLs are Stage 10 work.
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
    await page.route("**/auth/v1/signup", async (route) => {
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
    await expect(page.locator("body")).not.toContainText(/PGRST|SQLSTATE|postgrest|gotrue|InvalidLogin|constraint|policy/i);
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
    await expect(page.locator('input[type="password"]')).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Save new password" })).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText(/PGRST|SQLSTATE|postgrest|gotrue|constraint|policy/i);

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
});
