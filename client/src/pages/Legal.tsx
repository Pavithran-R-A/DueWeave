// CL-7 Stage C items 11-12: the three documents a stranger reads before handing DueWeave
// a name and a phone number. Every sentence is traceable to the running system — the
// erasure list is the `delete_my_account()` body, the font host is the stylesheet link in
// `client/index.html`, the payment posture is the readiness gate that refuses the purchase
// screen — so the pages do not have to be re-imagined when the product moves. Where the
// product genuinely has no answer yet (a support mailbox, a backup retention period, a
// named company), the document says so instead of inventing one, and the open items are
// listed as owner decisions. `tests/trust-surface.contract.test.ts` holds both halves.

import type { ReactNode } from "react";
import { Link } from "wouter";
import { BRAND } from "@/config/brand";
import { SUPPORT_EMAIL } from "@/config/support";

/** Rewritten whenever a document changes materially, so a reader can date what they saw. */
const LAST_UPDATED = "20 October 2026";

type LegalSlug = "privacy" | "terms" | "support";

const documents: { slug: LegalSlug; href: string; label: string }[] = [
  { slug: "privacy", href: "/privacy", label: "Privacy Policy" },
  { slug: "terms", href: "/terms", label: "Terms of Use" },
  { slug: "support", href: "/support", label: "Support" },
];

function Section({ id, heading, children }: { id: string; heading: string; children: ReactNode }) {
  return (
    <section className="legal-section" aria-labelledby={id}>
      <h2 id={id}>{heading}</h2>
      {children}
    </section>
  );
}

function LegalShell({ current, eyebrow, title, lede, children }: { current: LegalSlug; eyebrow: string; title: string; lede: string; children: ReactNode }) {
  const others = documents.filter((doc) => doc.slug !== current);
  return (
    <main className="legal-shell">
      <div className="legal-inner">
        <header className="legal-header">
          <Link className="legal-brand" to="/">{BRAND.name}</Link>
          <nav aria-label="Other DueWeave documents" className="legal-nav">
            {others.map((doc) => (
              <Link className="legal-nav__link" key={doc.slug} to={doc.href}>{doc.label}</Link>
            ))}
          </nav>
        </header>
        <div className="legal-heading">
          <span className="eyebrow">{eyebrow}</span>
          <h1>{title}</h1>
          <p className="legal-lede">{lede}</p>
          <p className="legal-updated">Last updated: {LAST_UPDATED}</p>
        </div>
        <div className="legal-body">{children}</div>
        <footer className="legal-footer">
          <Link className="legal-back" to="/auth">Return to sign in</Link>
          <p className="legal-footnote">These pages describe DueWeave as it is built today. They are not legal, tax or accounting advice.</p>
        </footer>
      </div>
    </main>
  );
}

export function PrivacyPage() {
  return (
    <LegalShell
      current="privacy"
      eyebrow="Privacy Policy"
      title="What your ledger holds, and where it sits."
      lede="DueWeave is a private record of money people already owe you. This page says what is stored, which services hold it, what your browser sends on its own, and what happens when you delete the account."
    >
      <Section id="privacy-people" heading="Whose information this covers">
        <p>Two groups appear in DueWeave: you, the account holder, and the clients you write down. Client names, phone numbers, emails and notes are records you create about businesses you are already dealing with. You decide whether you may hold them. DueWeave never adds a contact by itself and never contacts them.</p>
      </Section>

      <Section id="privacy-stored" heading="What is stored">
        <p><strong>Your account:</strong> your email address, the password hash held by the sign-in service, and the display name and workspace name you type during setup.</p>
        <p><strong>Your ledger:</strong> clients, receivables (title, amount, due date, status), payment promises and their corrections, recorded payments, and a timeline of activities. Every row carries your account as its owner, which is what keeps one workspace apart from another.</p>
        <p><strong>Follow-up drafts:</strong> a WhatsApp follow-up is written in your browser and opened as a wa.me link in your own WhatsApp. The message text is not uploaded. The ledger keeps only a short line saying a follow-up was opened or the client was marked contacted.</p>
        <p><strong>Upgrade events:</strong> when you use the Founder upgrade flow, the database records a small set of events — the offer was viewed, a claim was created, a payment reference was submitted, a review happened. A claim shows the payment reference you provide, the configured amount, and review timestamps, because that is what a reviewer has to compare against a bank statement.</p>
      </Section>

      <Section id="privacy-hosts" heading="Where it is held">
        <p>The database and the sign-in service are Supabase; that project runs in their ap-south-1 region in India. The website itself is served by Cloudflare Pages. Those are the only places DueWeave data lives — there is no analytics account, advertising network, or email-marketing service holding a copy.</p>
      </Section>

      <Section id="privacy-browser" heading="What your browser sends by itself">
        <p>Every DueWeave page loads its typefaces from Google Fonts, so opening a page sends a request to fonts.googleapis.com and fonts.gstatic.com, and those requests carry your IP address to Google. That is the only third-party request the site makes: no tracking pixels, no advertising scripts, no analytics beacons.</p>
        <p>Your sign-in session is kept in your own browser's local storage on this device, not in a third-party cookie, and the light or dark theme is remembered the same way. Signing out clears the session. DueWeave sets no tracking cookies.</p>
      </Section>

      <Section id="privacy-email" heading="The email DueWeave sends">
        <p>Two messages only, both sent by the sign-in service: a confirmation for a new address, and a reset link when you ask for one. There is no marketing mail and no newsletter. When either flow is paused for a delivery or security reason, the screens say so in plain words instead of pretending to send.</p>
      </Section>

      <Section id="privacy-never" heading="What DueWeave never asks for">
        <p>Never a UPI PIN, an OTP, a banking password, a card number, or any bank credential — not on a screen, not in an email, not in a message. DueWeave moves no money: it records payments you already received.</p>
      </Section>

      <Section id="privacy-who" heading="Who can see your records">
        <p>Only your own signed-in session. Access is enforced in the database by row-level ownership checks, not by the interface hiding things, and another account cannot read your ledger even by asking the API directly.</p>
        <p>Two honest limits. Running on a hosted platform means whoever holds the project's administrative credential could reach the database; that is an operator duty, not a product feature, and there is no reading of your records for the purpose of the app. And if you file a Founder claim, the reviewer sees that claim's details, because reviewing is what the record exists for.</p>
        <p>Your data is not sold, and it is not shared with advertisers.</p>
      </Section>

      <Section id="privacy-deletion" heading="Deleting your account">
        <p>More → Your data → delete your account is self-service and asks you to type a confirmation phrase first. It erases every row you own — clients, receivables, promises and promise events, payments, activities, upgrade events, entitlements, any Founder claim you filed, and your profile row — and then closes the sign-in account. Nothing is left behind in the app.</p>
        <p>One exception, stated rather than hidden: an account entangled in a Founder review record is refused. The erasure stops instead of destroying the provenance of a money review that involves another person, and the Support page explains what that means for you.</p>
      </Section>

      <Section id="privacy-backups" heading="Backups">
        <p>Supabase's Free plan includes no automatic backups and no point-in-time recovery. Nothing at the hosting layer copies this database on a schedule, so a lost or damaged ledger cannot be recovered from a platform-side daily copy.</p>
        <p>A manual logical snapshot can be taken by the operator and kept outside the hosting account. That is an operator procedure, not a product feature: it runs on no schedule, no retention period has been published, and it protects nothing written after the last snapshot. The app does not offer a restore button, and nothing here is a disaster-recovery guarantee.</p>
        <p>The copy the app does give you is your own export: More → Your data produces a full JSON archive and CSV files you keep yourself. Take it regularly, because it is the only copy whose retention you control.</p>
        <p>Deleting your account erases the live ledger. It cannot reach a snapshot the operator already took, so a copy of your rows may survive in an operator-held file until that file is rotated or destroyed; no deadline for that is promised.</p>
      </Section>

      <Section id="privacy-changes" heading="Changes to this page">
        <p>If the product starts storing something new, this page changes and the date above changes with it. There is no second, longer version of these promises elsewhere.</p>
      </Section>
    </LegalShell>
  );
}

export function TermsPage() {
  return (
    <LegalShell
      current="terms"
      eyebrow="Terms of Use"
      title="The rules for using DueWeave."
      lede="Short on purpose: what the free tier gives you, what you are responsible for, and what DueWeave does not do."
    >
      <Section id="terms-what" heading="What the service is, and is not">
        <p>DueWeave is a bookkeeping aid for money that is already owed to you. It is not a debt-collection agency. It does not contact your clients, does not send a message on your behalf, and gives no legal, tax or accounting advice. Whether to chase a debt, how, and when are your decisions.</p>
      </Section>

      <Section id="terms-account" heading="Your account">
        <p>Keep your sign-in to yourself; activity in the ledger is yours to explain. One workspace per account. Do not use another person's credentials, and do not try to reach someone else's records. The app is a private ledger: don't use it to store information you have no right to hold.</p>
      </Section>

      <Section id="terms-yours" heading="Your data stays yours">
        <p>You keep your rights to everything you enter. DueWeave needs no licence to your data beyond the ones required to store and show it to you. You can leave with your records at any time: More → Your data offers a full JSON archive of every row plus CSV files a spreadsheet can open. Reading an exported file back into DueWeave is not part of this build, so an export is a copy for your own records, not a round trip.</p>
      </Section>

      <Section id="terms-price" heading="The free tier, and the paid upgrade">
        <p>The ledger is free to use and nothing is charged to use it: no card is stored, there is no subscription, and no payment renews on its own. The paid Founder upgrade is not currently available — the app refuses to show payment instructions until the offer, its support contact and its refund terms have been published and approved by the founder. If it becomes available, the price and the terms will be shown in the product before anything is asked of you.</p>
      </Section>

      <Section id="terms-use" heading="Acceptable use">
        <p>Do not use DueWeave for anything unlawful, do not abuse sign-up or recovery to flood the service or to harass other people, and do not scrape or automate the ledger in ways that harm it for others. Accounts that do these things can be refused service.</p>
      </Section>

      <Section id="terms-rely" heading="Reliability, stated plainly">
        <p>The free tier is provided as it is. We do not guarantee that it will always be available, that it will be error-free, or that a hosted platform will not have an outage. Because of that, do not treat DueWeave as the only record of money owed to you: take an export regularly, and keep your invoices where your accountant can reach them.</p>
      </Section>

      <Section id="terms-ending" heading="Ending your use">
        <p>You can delete your account at any time from More → Your data; the Privacy Policy lists what that erases and the one case that blocks it. DueWeave can pause or close the free tier — for a security incident, a platform limit, or a decision to stop offering it. The expectation on both sides is the same: the site comes back up or tells you it is stopping, and your records stay yours to export.</p>
      </Section>

      <Section id="terms-liability" heading="Responsibility">
        <p>To the extent the law allows, DueWeave is not responsible for losses that come from relying on the ledger — a missed follow-up, a wrong figure, or a decision you made from a note in the app. The point of the tool is to reduce those mistakes, not to take them on for you.</p>
      </Section>

      <Section id="terms-entity" heading="Who is behind DueWeave, stated honestly">
        <p>DueWeave is run by an individual founder during public beta. No registered company has been named for it, so these terms do not claim one. Choosing a legal entity, a governing law, and published refund terms are decisions the owner has not made yet; they are listed as open decisions on the Support page rather than guessed here.</p>
      </Section>

      <Section id="terms-changes" heading="Changes">
        <p>Material changes to these terms are made by updating this page and its date. Using the ledger after that means using it under the new text, so take an export first if you do not agree.</p>
      </Section>
    </LegalShell>
  );
}

export function SupportPage() {
  const openDecisions = [
    ...(SUPPORT_EMAIL ? [] : ["a scheduled, monitored support channel and where it is published"]),
    "a retention period for production backups",
    "a named legal entity with published refund terms",
  ];
  return (
    <LegalShell
      current="support"
      eyebrow="Support and Contact"
      title="When something goes wrong, here is where to look."
      lede={SUPPORT_EMAIL
        ? "One address to write to, what to include, and what the product can explain by itself when a screen refuses you."
        : "DueWeave has not published a support email, phone number or chat channel. Rather than imply one, this page lists what you can do inside the product, and what is still undecided."}
    >
      <Section id="support-channel" heading={SUPPORT_EMAIL ? "Where to write" : "There is no published channel yet"}>
        {SUPPORT_EMAIL ? (
          <>
            <p>Write to <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>. That is the only address DueWeave has published for support; a message from any other address claiming to be DueWeave is not from DueWeave. The product never asks for a PIN, an OTP, a password or a bank credential, and neither should a reply to you.</p>
            <p>Include what you were doing, the screen you were on and what you expected to happen. Never send your password, a recovery link or a screenshot showing one.</p>
          </>
        ) : (
          <p>DueWeave has not published a support email address or any other direct contact line, and the Founder offer's own support field is still the placeholder saved in its configuration. So: anyone who contacts you claiming to be DueWeave support by email, phone or message is not. The product never asks for a PIN, an OTP, a password or a bank credential in reply to anything.</p>
        )}
        <p>The app also explains itself where it refuses you. Every refusal is shown on the screen where it happened, in ordinary words, and the reason stays on the page rather than disappearing.</p>
      </Section>

      <Section id="support-locked" heading="If you cannot get in">
        <p>Use “Forgot password?” on the sign-in screen, then open the link in the same browser. A reset link can be used once and only for a limited time. If a link reports that it is not active, it was either used already or it expired while the message sat unread, and the screen lets you ask for a fresh one. When recovery mail is paused, the sign-in screen says that plainly instead of claiming a message is on its way.</p>
      </Section>

      <Section id="support-refused" heading="If a save or a deletion is refused">
        <p>A refusal leaves your records untouched — nothing is half-written. If a screen says the record changed underneath you, reload it and read it again before trying once more. If account deletion says the account is part of a Founder review record, nothing was erased: that refusal exists so a money review involving a second person cannot be deleted out from under itself, and it stands until the reviewer settles the claim.</p>
      </Section>

      <Section id="support-data" heading="If you want your records, or want them gone">
        <p>Both live in More → Your data: the full archive, the per-list spreadsheet files, and the delete-your-account control. Take the export before you press delete. Once the account is closed, the file you downloaded is the only copy DueWeave can still hand you, and the deletion cannot be undone.</p>
      </Section>

      <Section id="support-wrong" heading="If a number looks wrong">
        <p>Amounts are stored as rupees and paise and are never rounded behind your back. If a total disagrees with what you expected, export the ledger and read the rows in a spreadsheet — the archive contains every row, not a summary. If you report it later, include the date, the receivable, the screen you were on and what you pressed; that is what makes a bug findable.</p>
      </Section>

      <Section id="support-open" heading="Still undecided by the owner">
        <p>Each of these is an owner decision rather than a technical limit: {openDecisions.join("; ")}. Until they are decided, the honest position is the one above — self-service inside the product, and no invented help.</p>
      </Section>
    </LegalShell>
  );
}
