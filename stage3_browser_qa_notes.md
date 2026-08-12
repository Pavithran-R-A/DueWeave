# Stage 3 Browser QA Evidence

## Controlled Authenticated Lifecycle — PASS

On 12 August 2026, the controlled Chromium test was run against the real Supabase Free backend with a temporary, confirmed email/password fixture account. The account credentials were supplied only as ignored local runtime environment variables; no credential was committed to source control, test source, build output, or Git history.

The passing test covered a real authenticated session from an empty ledger through persistent client creation, receivable creation for ₹10,000, two promise submissions, a ₹2,500 partial payment, reload-based session and balance persistence at ₹7,500 outstanding, final payment to ₹0 outstanding, sign-out, re-sign-in, and retained paid-history visibility. The result was **1 passed / 0 failed** for `e2e/core-workflow.spec.ts`.

The temporary fixture's business records were removed after the passing run. Its Auth identity and Auth user were then deleted and verified absent. No real account or persistent demo data was used in the controlled lifecycle.

## Credential-Free Auth Gateway — PASS

The companion gateway suite was run without credentials. Its **3 passed / 0 failed** results confirm that signed-out visitors are redirected away from the private ledger, invalid sign-in feedback remains non-technical, and the password-recovery entry point is available without disclosing whether an account exists.

## Bounded Authentication Lifecycle — PASS

The final controlled lifecycle smoke test added **2 passed / 0 failed** checks. It verifies that an unavailable sign-up remains at the auth gateway and shows only a normalized `role="alert"` message rather than the raw provider response, and that removing the persisted browser auth token causes a safe redirect to the auth gateway on reload. This supplies browser evidence for safe session loss and sign-up failure handling without sending confirmation messages to an unowned mailbox.

## Controlled Email Delivery — LIMITED

The project retains Supabase email confirmation and uses no paid SMTP provider. A controlled inbox was not available through the current environment, so receipt of a confirmation email, receipt of a password-reset email, and completion of a reset through an emailed link were not performed. This is documented as **LIMITED**, not as a successful delivery check. No confirmation policy, Auth setting, or rate limit was weakened for testing.

## Scope Boundary

The browser lifecycle demonstrates real sign-in, authenticated persistence, reload persistence, logout, re-login, paid-history visibility, safe unavailable-signup handling, and safe session loss. It does not claim a browser-automated signup-confirmation or email-reset completion. Database rollback matrices and unit/contract coverage remain the evidence for cross-tenant isolation, free-plan bypass resistance, payment integrity, immutable promise history, and idempotent promise transitions.

## Responsive Screenshot Check

The `/auth` screen was visually checked at **360px**, **390px**, **430px**, **768px**, **1024px**, and **1440px** widths. At every checked width the Quiet Ledger auth form remains legible and naturally ordered, the primary sign-in action remains visible, labels and privacy copy are present, and no horizontal overflow was observed. At phone widths the decorative panel remains compact without obscuring the form; at tablet width the centered form retains comfortable reading width and touch-target spacing; at desktop widths the approved split-screen composition remains balanced with the form clearly separated from the supporting privacy panel.

The real authenticated Today empty state was also exercised at the same six widths by the controlled browser test. It passed at every viewport and saved browser evidence for each. Visual review at **360px** confirmed the date, Today label, empty-state explanation, first receivable action, and bottom navigation are visible without horizontal overflow. Visual review at **1440px** confirmed the responsive desktop rail, private-workspace indicator, primary add-receivable action, and centered empty state remain visible and balanced. The fixture had no business records, so this is a real authenticated first-user state rather than seeded demo content.

## Accessibility Smoke Check — PASS

The controlled Chromium accessibility smoke test passed after exercising the real auth and authenticated Today surfaces. It verifies programmatic labels for the email and password inputs, keyboard order between those controls, visible focused-input treatment, and the reduced-motion media rule that clamps transition duration. It also verifies the Add Client sheet has `role="dialog"` with `aria-modal="true"`, receives initial focus on its labeled Close control, cycles focus from first to last and last to first with Shift+Tab/Tab, closes with Escape, and returns focus to the invoking Add Client action. The shared sheet primitive was given non-visual focus trapping, Escape dismissal, and return-focus handling; its approved visual styling was not changed. The companion gateway suite additionally asserts that invalid sign-in feedback is exposed through `role="alert"` and contains no raw database, SQL, token, or stack details.
