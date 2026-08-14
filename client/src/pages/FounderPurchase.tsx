import QRCode from "qrcode";
import { ArrowLeft, BadgeCheck, Check, Clipboard, ExternalLink, Loader2, ShieldCheck, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { SupabaseFounderRepository } from "@/data/supabase-founder-repository";
import { ErrorState, LoadingState } from "@/components/finance-ui";
import { formatINR } from "@/lib/finance";
import { buildFounderUpiPayload, isFounderPaymentDestinationReady } from "@/lib/founder-payment";
import type { FounderClaim, FounderEntitlement, FounderOffer } from "@/types/domain";
import "../founder-disclosures.css";

type FounderState = { offer: FounderOffer; claim?: FounderClaim; entitlement: FounderEntitlement };

export default function FounderPurchase() {
  const [, navigate] = useLocation();
  const [repository] = useState(() => new SupabaseFounderRepository());
  const [data, setData] = useState<FounderState>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [payerName, setPayerName] = useState("");
  const [utr, setUtr] = useState("");
  const [qr, setQr] = useState("");

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try { setData(await repository.getAccountState()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "We could not open the Founder offer."); }
    finally { setLoading(false); }
  }, [repository]);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => { void repository.recordUpgradeView().catch(() => undefined); }, [repository]);

  const payload = useMemo(() => data ? buildFounderUpiPayload(data.offer) : "", [data]);
  useEffect(() => {
    let cancelled = false;
    if (!payload) { setQr(""); return; }
    void QRCode.toDataURL(payload, { width: 280, margin: 1, color: { dark: "#162823", light: "#fbfaf5" } }).then((value) => { if (!cancelled) setQr(value); }).catch(() => { if (!cancelled) setQr(""); });
    return () => { cancelled = true; };
  }, [payload]);

  async function createClaim() {
    setSaving(true);
    try { const claim = await repository.createClaim(); setData((current) => current ? { ...current, claim } : current); toast.success("Payment claim started", { description: "Pay only to the verified UPI destination shown here." }); }
    catch (reason) { toast.error("Could not start payment claim", { description: reason instanceof Error ? reason.message : "Please try again." }); }
    finally { setSaving(false); }
  }

  async function submitClaim(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!data?.claim) return;
    setSaving(true);
    try { const claim = await repository.submitPayment(data.claim.claimId, utr, payerName); setData((current) => current ? { ...current, claim } : current); toast.success("Payment submitted for review", { description: data.offer.reviewWindowCopy }); }
    catch (reason) { toast.error("Could not submit payment", { description: reason instanceof Error ? reason.message : "Please try again." }); }
    finally { setSaving(false); }
  }

  async function cancelClaim() {
    if (!data?.claim) return;
    setSaving(true);
    try { const claim = await repository.cancelClaim(data.claim.claimId); setData((current) => current ? { ...current, claim } : current); toast.message("Payment claim cancelled", { description: "You can start a new claim when you are ready." }); }
    catch (reason) { toast.error("Could not cancel claim", { description: reason instanceof Error ? reason.message : "Please try again." }); }
    finally { setSaving(false); }
  }

  async function copyPaymentLink() {
    if (!payload) return;
    try { await navigator.clipboard.writeText(payload); toast.success("UPI link copied", { description: "Review the payee and amount in your UPI app before you pay." }); }
    catch { toast.error("Could not copy the UPI link", { description: "Use Open UPI instead." }); }
  }

  if (loading) return <div className="app-shell founder-shell"><LoadingState /></div>;
  if (error || !data) return <div className="app-shell founder-shell"><ErrorState onRetry={() => { void refresh(); }} /></div>;

  const { offer, claim, entitlement } = data;
  const paymentReady = isFounderPaymentDestinationReady(offer);
  const supportCopy = offer.supportContactStatus === "CONFIGURED" && offer.supportContact.trim().length > 2
    ? `For payment or refund questions, contact ${offer.supportContact} with your claim ID.`
    : "Support contact will be available before payments open.";
  const approved = entitlement.plan === "FOUNDER" && entitlement.status === "ACTIVE";

  return <main className="founder-page">
    <header className="founder-topbar"><button className="icon-button" onClick={() => navigate("/")} aria-label="Back to DueWeave"><ArrowLeft size={18} /></button><span className="wordmark">Due<span>Weave</span></span><span className="founder-topbar__label">Founder Lifetime</span></header>
    <section className="founder-hero">
      <div><span className="eyebrow"><Sparkles size={14} /> One-time Founder access</span><h1>Keep every follow-up in view.</h1><p>Unlock the higher-volume ledger after a manual, bank-history review. There is no payment gateway, saved bank credential, UPI PIN, or automatic collection.</p></div>
      <div className="founder-price"><span>Founder Lifetime</span><strong>{formatINR(offer.amountPaise)}</strong><small>One-time, manually verified</small></div>
    </section>

    {approved ? <section className="founder-approved" aria-live="polite"><BadgeCheck size={22} /><div><strong>Founder Lifetime is active</strong><span>Your higher-volume receivable access is enabled for this workspace.</span></div></section> : <>
      <section className="founder-benefits" aria-label="Founder benefits"><div><Check size={17} /><span>More than three active receivables after approval</span></div><div><Check size={17} /><span>No recurring charge or card collection</span></div><div><Check size={17} /><span>Manual UPI and bank-history verification</span></div></section>
      {!paymentReady ? <section className="founder-not-ready"><ShieldCheck size={21} /><div><strong>Payment instructions are being set up.</strong><p>Do not send money yet. A verified UPI destination, public support contact, and Founder-approved refund terms must all be configured before this offer can accept a payment. {offer.reviewWindowCopy}</p></div></section> : <section className="founder-payment-card">
        <div className="founder-payment-card__header"><div><span className="eyebrow">Verified payment instructions</span><h2>Pay with your UPI app</h2></div><span className="founder-spots">{offer.availableSpots} of {offer.founderCap} spots available</span></div>
        <div className="founder-payment-card__disclosure"><strong>Founder Lifetime · {formatINR(offer.amountPaise)} once</strong><span>Payment is manually verified. Founder access activates only after the payment is confirmed in business bank history.</span><span>DueWeave does not guarantee client payment or financial recovery. Support and refund terms: {offer.supportContact}.</span></div>
        {!claim || claim.status === "CANCELLED" ? <div className="founder-start"><p>Start a private payment claim before opening UPI. This locks the correct amount in your account, but does not approve access.</p><button className="button-primary" disabled={saving || offer.availableSpots < 1} onClick={() => { void createClaim(); }}>{saving ? <Loader2 className="spin" size={16} /> : <Sparkles size={16} />}{offer.availableSpots < 1 ? "Founder offer full" : "Start payment claim"}</button></div> : null}
        {claim?.status === "DRAFT" ? <>
          <div className="founder-qr-wrap">{qr ? <img src={qr} alt={`UPI QR code for ${formatINR(offer.amountPaise)} payable to ${offer.payeeName}`} /> : <div className="founder-qr-placeholder">Preparing QR…</div>}<div><strong>{formatINR(offer.amountPaise)}</strong><span>Payee: {offer.payeeName}</span><span>UPI: {offer.upiId}</span><span>Claim: {claim.claimId}</span></div></div>
          <div className="founder-pay-actions"><button className="button-primary" onClick={() => { window.location.href = payload; }}><ExternalLink size={16} />Open UPI</button><button className="button-secondary" onClick={() => { void copyPaymentLink(); }}><Clipboard size={16} />Copy UPI link</button></div>
          <form className="founder-claim-form" onSubmit={submitClaim}><div className="sheet-heading"><div><span className="eyebrow">After payment</span><h3>Submit your payment reference</h3></div></div><p>Enter the UTR/reference and payer name exactly as shown in your UPI or bank history. DueWeave stores this reference only for manual verification—not banking credentials.</p><label>UPI reference / UTR<input value={utr} onChange={(event) => setUtr(event.target.value.toUpperCase())} inputMode="text" minLength={6} maxLength={64} required placeholder="e.g. 429381005219" autoComplete="off" /></label><label>Payer name<input value={payerName} onChange={(event) => setPayerName(event.target.value)} minLength={2} maxLength={120} required placeholder="Name shown in payment history" autoComplete="name" /></label><div className="founder-form-actions"><button type="button" className="button-ghost" disabled={saving} onClick={() => { void cancelClaim(); }}>Cancel claim</button><button type="submit" className="button-primary" disabled={saving}>{saving ? <Loader2 className="spin" size={16} /> : <Check size={16} />}Submit for review</button></div></form>
        </> : null}
        {claim?.status === "PENDING_REVIEW" ? <ClaimStatus tone="pending" title="Payment submitted for review" detail={`Your reference is queued for manual bank-history verification. ${offer.reviewWindowCopy}`} /> : null}
        {claim?.status === "REJECTED" ? <ClaimStatus tone="rejected" title="Payment could not be verified" detail={`If you need help, contact ${offer.supportContact}. Do not submit the same UTR again.`} /> : null}
      </section>}
    </>}
    <section className="founder-trust"><ShieldCheck size={18} /><div><strong>Privacy and verification</strong><p>We do not request, store, or view your UPI PIN, OTP, banking password, card details, or bank credentials. Founder access is granted only after a human compares the submitted reference with business bank history.</p></div></section>
    <section className="founder-disclosures" aria-label="Founder terms, privacy, and support">
      <div className="founder-disclosures__intro"><span className="eyebrow">Founder terms</span><h2>Clear boundaries for a practical plan.</h2></div>
      <div className="founder-disclosures__grid">
        <article><strong>Founder Lifetime</strong><p>Founder Lifetime covers core DueWeave V1 Founder access as described here. It does not guarantee that any client will pay, and DueWeave is not a debt-collection agency or a source of legal advice.</p></article>
        <article><strong>Payment-claim privacy</strong><p>For manual verification, we store only the payer name and payment reference you provide, the configured offer amount, claim status, and review timestamps. We do not store UPI PINs, OTPs, banking logins, or card credentials.</p></article>
        <article><strong>Manual review and future services</strong><p>Payment verification is manual. Any future third-party or usage-based service may have a separate cost and is not included automatically in Founder Lifetime.</p></article>
        <article><strong>Support and policy</strong><p>{supportCopy} {offer.refundPolicyStatus === "APPROVED" && offer.refundPolicyText ? offer.refundPolicyText : "Founder Beta refund terms are drafted but require founder publication approval; payment instructions remain unavailable until they are confirmed."} Commercial payments may also create operator accounting, tax, or business obligations that require independent confirmation.</p></article>
      </div>
    </section>
    <footer className="founder-footer"><button className="button-ghost" onClick={() => navigate("/")}>Return to my ledger</button><span>Manual refunds are not promised in-app; request support with your claim ID where required by applicable law.</span></footer>
  </main>;
}

function ClaimStatus({ tone, title, detail }: { tone: "pending" | "rejected"; title: string; detail: string }) {
  return <div className={`founder-claim-status founder-claim-status--${tone}`} role="status"><BadgeCheck size={20} /><div><strong>{title}</strong><span>{detail}</span></div></div>;
}
