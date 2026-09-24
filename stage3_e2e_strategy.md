# Stage 3 Browser E2E Strategy

The Playwright gateway suite runs without customer data or credentials. It checks signed-out route protection, safe failed-login handling, and password-recovery non-enumeration behavior. It deliberately uses a non-deliverable `invalid.example` address and never records a password.

The complete authenticated workflow is defined as a skipped, credential-gated Playwright test because Supabase email confirmation is enabled and the configured controlled inbox did not contain a pre-existing confirmed QA account. No service-role key, confirmation bypass, test-only Auth setting, or committed plaintext credential is used.

To execute the controlled workflow later, create one dedicated QA account through the normal signup and confirmation flow, keep the email address and password only in a local ignored environment (for example `E2E_EMAIL` and `E2E_PASSWORD`), and remove its records after the test. Validate one confirmation message and one reset message at most. This preserves the production security posture while allowing deterministic browser validation without paid services.

The Stage 3 report must therefore distinguish **gateway E2E PASS** from **full authenticated workflow LIMITED** until the controlled account is available. No broad public-launch readiness should be inferred from a skipped credential-gated scenario.
