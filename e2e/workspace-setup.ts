import { expect, type Page } from "@playwright/test";

// Stage 6 made workspace setup a real screen with a real row behind it, so a
// browser journey that creates or reopens an account answers it the way a first
// user does: through the form. Nothing here writes to the database, nothing here
// disables the gate, and an account that setup has already saved is never shown
// the screen again.

export const setupHeading = "Set up your private ledger.";

export type WorkspaceSetup = { displayName: string; businessName: string };

export async function completeWorkspaceSetup(page: Page, input: WorkspaceSetup) {
  await expect(page.getByRole("heading", { name: setupHeading })).toBeVisible({ timeout: 20_000 });
  await page.getByLabel("Your name").fill(input.displayName);
  await page.getByLabel("Business or workspace name").fill(input.businessName);
  await page.getByRole("button", { name: "Continue to your ledger" }).click();
  await expect(page).toHaveURL(/\/$/, { timeout: 20_000 });
  // Arriving at the address is not arriving at the ledger: the first read of this
  // account's own data has to finish before anything a later step asserts can exist.
  await expect(page.getByRole("heading", { name: "Preparing your follow-up brief" })).toBeHidden({ timeout: 20_000 });
}

// A signed-in address is not yet a ledger. The workspace screen is a lazily loaded
// chunk and its first read is skeleton-filled, so anything that measures the page —
// a box, a style, a scroll width — has to wait for the real chrome or it measures a
// loader and reports a confident answer about nothing. This one waits at every width,
// which the desktop rail cannot.
export async function awaitLedger(page: Page) {
  await expect(page.locator(".app-shell")).toBeVisible({ timeout: 20_000 });
  await expect(page.getByRole("heading", { name: "Preparing your follow-up brief" })).toBeHidden({ timeout: 20_000 });
  await expect(page.locator(".page-header__actions button.button-primary")).toBeVisible({ timeout: 20_000 });
}

export async function reachLedgerAfterSignIn(page: Page, input: WorkspaceSetup) {
  await expect(page).toHaveURL(/\/$|\/onboarding$/, { timeout: 20_000 });
  if (page.url().endsWith("/onboarding")) {
    await completeWorkspaceSetup(page, input);
  } else {
    await expect(page.getByRole("heading", { name: "Preparing your follow-up brief" })).toBeHidden({ timeout: 20_000 });
  }
  await expect(page.getByLabel("Primary navigation")).toBeVisible();
}

// The controlled QA accounts are supplied through an ignored local environment
// rather than created here, so one may already have its setup row and another may
// predate Stage 6. These names are only ever typed if the gate actually appears,
// which is why they stay fixed and readable instead of carrying a run suffix.
export function qaWorkspace(role: string): WorkspaceSetup {
  return { displayName: "QA Tester", businessName: `DueWeave QA ${role}` };
}
