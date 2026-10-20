import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// CL-7 Stage C items 11-12. A public free tier has to answer three questions before a
// stranger gives it a name and a phone number: what happens to my data, what are the
// rules, and who do I talk to when it goes wrong. None of the three existed as a page —
// `grep` found Founder-only disclosures and a "contact support" sentence pointing at a
// channel the product has never published.
//
// These cases are written against the repository's own measurements, not against prose
// anybody liked. Where a sentence is pinned, it is pinned because the running system
// does that thing: the erasure list is the `delete_my_account()` body, the third-party
// request is the `<link>` in `client/index.html`, the payment posture is the readiness
// gate that refuses to show a payment screen. If the product changes, the document has
// to change and this file fails until it does — which is the point of asserting on the
// source of a legal page rather than on a screenshot of it.

const projectRoot = process.cwd();

function read(relative: string): string {
  const absolute = path.join(projectRoot, relative);
  return existsSync(absolute) ? readFileSync(absolute, "utf8") : "";
}

const legalPage = read("client/src/pages/Legal.tsx");
const appShell = read("client/src/App.tsx");
const authPage = read("client/src/pages/Auth.tsx");
const homePage = read("client/src/pages/Home.tsx");
const deletionCopy = read("client/src/lib/account-deletion.ts");
const styles = read("client/src/index.css");
const entryHtml = read("client/index.html");
const erasureMigration = read("supabase/migrations/20261006120000_current_arc3c_account_erasure_path.sql");

/** Every non-whitespace character of the three documents, so a claim can be searched whole-document. */
const documents = legalPage.replace(/\s+/g, " ");

describe("customer trust surface (CL-7 items 11-12)", () => {
  it("publishes the source this contract is reading", () => {
    // Without this, every case below passes vacuously on a tree where the file was never made.
    expect(legalPage.length, "client/src/pages/Legal.tsx does not exist").toBeGreaterThan(500);
    expect(entryHtml, "the entry document is not readable").toContain("<div id=\"root\">");
    expect(erasureMigration, "the erasure migration is not readable").toContain("delete_my_account");
  });

  it("serves each document at a public address that needs no session", () => {
    for (const [route, page] of [
      ["/privacy", "PrivacyPage"],
      ["/terms", "TermsPage"],
      ["/support", "SupportPage"],
    ] as const) {
      const declaration = `path="${route}" component={${page}}`;
      expect(appShell, `${route} is not routed to ${page}`).toContain(declaration);
      // A legal document a locked-out customer cannot read is not a legal document. These three
      // must not sit behind the session gate the ledger screens use.
      expect(appShell, `${route} is behind the sign-in gate`).not.toContain(`path="${route}" component={() => <ProtectedPage`);
    }
    expect(legalPage).toMatch(/export function PrivacyPage/);
    expect(legalPage).toMatch(/export function TermsPage/);
    expect(legalPage).toMatch(/export function SupportPage/);
  });

  it("links all three from the sign-in screen a visitor sees before they have an account", () => {
    // Item 11 says "public auth screens": the only moment a stranger can read these before
    // deciding whether to hand over an email address is the auth screen itself.
    for (const route of ["/privacy", "/terms", "/support"]) {
      expect(authPage, `the auth screen does not link ${route}`).toContain(`to="${route}"`);
    }
    expect(authPage).toContain('className="auth-legal-links"');
  });

  it("links all three from the signed-in screen that already holds the data controls", () => {
    // MoreView is where export and account deletion live, so it is where "what happens to my
    // data" has to be answerable without signing out.
    const start = homePage.indexOf("function MoreView");
    expect(start, "Home no longer has the More screen these links belong on").toBeGreaterThanOrEqual(0);
    const moreView = homePage.slice(start, homePage.indexOf("\n}", start));
    for (const route of ["/privacy", "/terms", "/support"]) {
      expect(moreView, `the More screen does not link ${route}`).toContain(`to="${route}"`);
    }
  });

  it("gives both trust rows a target a thumb can hit", () => {
    // The sign-in row is measured live by `e2e-paused/auth-trust-links.spec.ts`, which reads the
    // rendered box off the artifact production serves. The More row needs a session to reach, so
    // what can be checked here is the declaration it ships: 11px type gives a ~23px text box and
    // 24px is the floor `e2e/stage6-local-responsive.spec.ts` applies to every other target.
    for (const selector of [".auth-legal-link", ".more-legal-link"]) {
      const rule = styles.match(new RegExp(`\\${selector}\\s*\\{([^}]*)\\}`));
      expect(rule, `${selector} is no longer a rule in index.css, so nothing sets this row's size`).toBeTruthy();
      const minHeight = Number.parseFloat(rule![1].match(/min-height:\s*([\d.]+)px/)?.[1] ?? "0");
      expect(minHeight, `${selector} sets a ${minHeight}px-tall target on an 11px link`).toBeGreaterThanOrEqual(24);
    }
  });

  it("names the hosts the ledger actually sits on, and the third party the browser really contacts", () => {
    // Measured, not assumed: the database and auth are Supabase's (`ugzdqcytouwfdlcjujqv`,
    // ap-south-1), the site is served by Cloudflare Pages, and the only other request the entry
    // document makes on a visitor's behalf is the web-font stylesheet below. A privacy page that
    // omits a transfer the code performs is worse than no page at all.
    const fonts = [...entryHtml.matchAll(/https:\/\/([a-z.]*fonts[a-z.]*)/g)].map((match) => match[1]);
    expect(fonts.length, "this case assumes the entry document loads a Google font").toBeGreaterThan(0);
    expect(documents).toMatch(/Supabase/);
    expect(documents).toMatch(/Cloudflare/);
    expect(documents, "the font request index.html actually makes is not disclosed")
      .toMatch(/fonts\.googleapis\.com|Google Fonts/i);
    // The handoff the follow-up feature performs: DueWeave opens a WhatsApp link, it never sends.
    expect(documents).toMatch(/wa\.me|WhatsApp/);
  });

  it("describes account deletion as the migration implements it, including the one thing it leaves behind", () => {
    // `delete_my_account()` erases every owned table, `analytics_events` included, and refuses an
    // account entangled in a Founder review rather than destroying review provenance. Both halves
    // belong in the document; promising a clean sweep the code refuses would be the invention
    // item 12 forbids.
    const erased = [...erasureMigration.matchAll(/delete from public\.([a-z_]+) where (?:owner_id|user_id) = v_owner/g)].map((match) => match[1]);
    expect(erased.length, "the erasure migration no longer reads as a table-by-table delete").toBeGreaterThan(6);
    expect(erased).toContain("analytics_events");
    expect(documents, "the document does not say history and analytics go too").toMatch(/analytics/i);
    expect(documents).toMatch(/founder review/i);
    expect(documents, "deletion must be described as the self-service action it is").toMatch(/More[\s\S]{0,120}Your data|delete your account/i);
  });

  it("states the backup limit instead of inventing a retention promise", () => {
    // No retention schedule has been measured for production backups, so the honest sentence is
    // the one that says so. Item 12: "no unsupported retention promises; flag any owner decisions".
    expect(documents).toMatch(/backup/i);
    expect(documents, "the page must say plainly that the retention period is not published")
      .toMatch(/not (?:been )?published|we have not published|hasn't been published/i);
    expect(documents).not.toMatch(/\b(?:30|60|90|180|365)[- ]day\b|\b(?:seven|thirty|ninety) days\b/i);
  });

  it("keeps paid Founder access described as the disabled feature it currently is", () => {
    // Production is fail-closed: `isFounderPaymentReady` refuses the payment screen until the
    // offer is LIVE, so the Terms cannot advertise a purchase that cannot happen.
    expect(documents).toMatch(/not currently available|is not available|turned off|disabled/i);
    expect(documents).not.toMatch(/buy now|subscribe now|auto-renews?|subscription fee/i);
  });

  it("does not claim a support channel, an identity or a warranty the product has not published", () => {
    // The defect found while writing this: three sentences in the app point a customer at
    // "DueWeave support", which does not exist. A trust page must not repeat that, and must not
    // invent a company, an address or a promise to paper over it.
    expect(documents).not.toMatch(/mailto:|[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/i);
    expect(documents).not.toMatch(/\b(Pvt|LLC|Inc\.|GmbH|LLP|Private Limited)\b/);
    // The word is allowed in the direction that limits DueWeave ("no guarantee that it is always
    // there"); it is forbidden in the direction that promises the customer something.
    expect(documents).not.toMatch(/guarantee[sd]? to (?:you )?(?:be|work|stay|never)|we guarantee|100% secure|never be shared/i);
    expect(documents, "no mailbox is published, so the support page has to say that instead of implying one")
      .toMatch(/has not published a support email/i);
    expect(deletionCopy, "the deletion refusal sends the customer to a channel that does not exist")
      .not.toMatch(/Settle that review with DueWeave support first\.|or contact support\./);
    expect(deletionCopy).toMatch(/Support page/);
    // Still true after the rewrite: the sentence has to name the thing that blocked them.
    expect(deletionCopy).toMatch(/founder: "[^"]*Founder[^"]*",/);
  });

  it("builds each document as a landmarked page with a date and a way back", () => {
    // Item 11 says accessible as well as present. These are the structural facts assistive
    // technology reports: one `main`, one `h1` per document, a labelled switch between the three,
    // and a heading order that never skips. Chromium assertions in
    // `e2e/stage6-local-trust-surface.spec.ts` read the same page after it renders.
    expect(legalPage).toMatch(/<main className="legal-shell"/);
    expect(legalPage.match(/<h1/g)?.length ?? 0).toBeLessThanOrEqual(1);
    expect(legalPage).toMatch(/<nav aria-label="Other DueWeave documents"/);
    expect(legalPage).toMatch(/Last updated/);
    expect(legalPage).toMatch(/<h2/);
    expect(legalPage).toMatch(/Return to sign in/);
    expect(legalPage).toMatch(/aria-labelledby/);
    expect(styles, "the documents have no stylesheet entry of their own").toMatch(/\.legal-shell/);
    expect(styles).toMatch(/\.legal-body\s*\{[^}]*max-width/);
  });
});
