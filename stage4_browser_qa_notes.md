# Stage 4 Founder Browser QA Notes

**Evidence date:** 13 August 2026  
**Method:** Controlled authenticated Playwright workflow with a temporary server-controlled `TEST` UPI destination. No money was sent, no payment callback was trusted, and the fixture was deleted immediately after the run.

## Responsive visual inspection

| Viewport | Screenshot | Finding |
|---:|---|---|
| 360 px | `/home/ubuntu/stage4_browser_evidence/founder-purchase-360.png` | The Founder price, QR, UPI actions, UTR fields, submit control, verification copy, and disclosure cards remain single-column, readable, and reachable without overlap. |
| 1440 px | `/home/ubuntu/stage4_browser_evidence/founder-purchase-1440.png` | The QR and payment form remain prominent, the Founder terms grid uses two balanced columns, and the footer remains visually separated from the purchase controls. |

The same passing workflow programmatically asserted the Founder heading and QR at **390 px**, **430 px**, and **768 px**. Full-page screenshots for all five required widths are preserved outside the repository under `/home/ubuntu/stage4_browser_evidence/`.

## Workflow result

The isolated test completed: sign-in → More → Founder → server-controlled offer → private claim → QR visible → cancel unsubmitted claim → start a fresh private claim → keyboard focus on the labelled UTR field and then the labelled payer-name field → UTR submission → semantic `PENDING_REVIEW` status → return to ledger → sign-out. It passed in **8.4 seconds** after the cancellation-state migration correction.

> The `TEST` payment destination existed only for the browser exercise. Cleanup verified that the live offer has been restored to the enabled `PLACEHOLDER` state with no UPI ID, and every disposable user, claim, entitlement, audit record, analytics record, and admin allowlist row is absent.
