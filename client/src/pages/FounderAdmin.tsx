import { ArrowLeft, BadgeCheck, Check, Loader2, ShieldAlert, X } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useLocation } from "wouter";
import { feedback } from "@/components/ui/sonner";
import { LoadingState } from "@/components/finance-ui";
import { SupabaseFounderAdminRepository } from "@/data/supabase-founder-admin-repository";
import { formatINR } from "@/lib/finance";
import type { FounderFunnelEvent, PendingFounderClaim, RejectedFounderClaim } from "@/types/domain";

export default function FounderAdmin() {
  const [, navigate] = useLocation();
  const [repository] = useState(() => new SupabaseFounderAdminRepository());
  const [claims, setClaims] = useState<PendingFounderClaim[]>([]);
  const [rejectedClaims, setRejectedClaims] = useState<RejectedFounderClaim[]>([]);
  const [funnel, setFunnel] = useState<FounderFunnelEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [workingId, setWorkingId] = useState("");
  const [reasonByClaim, setReasonByClaim] = useState<Record<string, string>>({});
  const [bankVerifiedByClaim, setBankVerifiedByClaim] = useState<Record<string, boolean>>({});

  const refresh = useCallback(async () => {
    setLoading(true); setError("");
    try { const [nextClaims, nextRejectedClaims, nextFunnel] = await Promise.all([repository.listPending(), repository.listRejected(), repository.funnel()]); setClaims(nextClaims); setRejectedClaims(nextRejectedClaims); setFunnel(nextFunnel); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Founder review access is not available for this account."); }
    finally { setLoading(false); }
  }, [repository]);
  useEffect(() => { void refresh(); }, [refresh]);

  async function approve(claim: PendingFounderClaim) {
    setWorkingId(claim.claimId);
    try { await repository.approve(claim.claimId); feedback.success("Founder access approved", { description: "The entitlement and audit entry were written atomically." }); await refresh(); }
    catch (reason) { feedback.error("Could not approve claim", { description: reason instanceof Error ? reason.message : "Please try again." }); }
    finally { setWorkingId(""); }
  }
  async function reject(claim: PendingFounderClaim) {
    setWorkingId(claim.claimId);
    try { await repository.reject(claim.claimId, reasonByClaim[claim.claimId] ?? "Not verified in business bank history"); feedback.message("Founder claim rejected", { description: "The customer can contact support if the payment needs review." }); await refresh(); }
    catch (reason) { feedback.error("Could not reject claim", { description: reason instanceof Error ? reason.message : "Please try again." }); }
    finally { setWorkingId(""); }
  }
  async function reconsider(claim: RejectedFounderClaim) {
    if (!bankVerifiedByClaim[claim.claimId]) return;
    setWorkingId(claim.claimId);
    try { await repository.reconsider(claim.claimId, reasonByClaim[claim.claimId] ?? ""); feedback.success("Founder access approved after recheck", { description: "The original payment reference and rejection history remain in the audit trail." }); await refresh(); }
    catch (reason) { feedback.error("Could not reconsider claim", { description: reason instanceof Error ? reason.message : "Please try again." }); }
    finally { setWorkingId(""); }
  }

  if (loading) return <div className="app-shell founder-shell"><LoadingState /></div>;
  if (error) return <main className="founder-admin-page"><header className="founder-topbar"><button className="icon-button" onClick={() => navigate("/")} aria-label="Back to DueWeave"><ArrowLeft size={18} /></button><span className="wordmark">Due<span>Weave</span></span><span className="founder-topbar__label">Founder review</span></header><section className="admin-denied"><ShieldAlert size={28} /><h1>Founder review is restricted.</h1><p>{error}</p><button className="button-secondary" onClick={() => navigate("/")}>Return to ledger</button></section></main>;

  return <main className="founder-admin-page"><header className="founder-topbar"><button className="icon-button" onClick={() => navigate("/")} aria-label="Back to DueWeave"><ArrowLeft size={18} /></button><span className="wordmark">Due<span>Weave</span></span><span className="founder-topbar__label">Founder review</span></header><section className="admin-header"><div><span className="eyebrow">Manual bank-history review</span><h1>Review pending Founder claims.</h1><p>Confirm a payment against your business bank history outside DueWeave. Never ask for the customer’s PIN, OTP, password, card details, or banking credentials.</p></div><button className="button-secondary" onClick={() => { void refresh(); }}>Refresh</button></section><section className="admin-funnel" aria-label="Founder funnel summary">{["upgrade_viewed", "founder_claim_created", "founder_payment_submitted", "founder_activated", "founder_rejected"].map((event) => <div key={event}><span>{event.replaceAll("_", " ")}</span><strong>{funnel.find((item) => item.eventName === event)?.eventCount ?? 0}</strong></div>)}</section><section className="admin-claims"><div className="section-heading"><div><span className="eyebrow">Pending queue</span><h2>{claims.length ? `${claims.length} claim${claims.length === 1 ? "" : "s"} to review` : "No pending claims"}</h2></div></div>{claims.length ? claims.map((claim) => <article className="admin-claim-card" key={claim.claimId}><div className="admin-claim-card__meta"><span className="status-pill status-pill--amber">Awaiting bank check</span><span>{new Date(claim.submittedAt).toLocaleString("en-IN")}</span></div><div className="admin-claim-card__details"><div><span>Account</span><strong>{claim.ownerEmail}</strong></div><div><span>Claim</span><strong>{claim.claimId}</strong></div><div><span>Amount</span><strong>{formatINR(claim.amountPaise)}</strong></div><div><span>Payer name</span><strong>{claim.payerName}</strong></div><div><span>UTR / reference</span><strong className="admin-utr">{claim.utrReference}</strong></div></div><label className="admin-reason">Optional review note<input value={reasonByClaim[claim.claimId] ?? ""} onChange={(event) => setReasonByClaim((current) => ({ ...current, [claim.claimId]: event.target.value }))} maxLength={300} placeholder="Use only a concise operational reason" /></label><div className="admin-claim-card__actions"><button className="button-secondary" disabled={workingId === claim.claimId} onClick={() => { void reject(claim); }}><X size={16} />Reject</button><button className="button-primary" disabled={workingId === claim.claimId} onClick={() => { void approve(claim); }}>{workingId === claim.claimId ? <Loader2 className="spin" size={16} /> : <Check size={16} />}Approve after bank check</button></div></article>) : <div className="admin-empty"><BadgeCheck size={22} /><strong>Nothing needs manual review.</strong><span>New submitted payment references will appear here for configured Founder reviewers.</span></div>}</section><section className="admin-claims" aria-labelledby="reconsideration-heading"><div className="section-heading"><div><span className="eyebrow">Rejected claims</span><h2 id="reconsideration-heading">Reconsider after bank-history recheck</h2><p className="admin-reconsideration-copy">This action is for a mistaken rejection only. It preserves the original UTR and the original rejection audit record.</p></div></div>{rejectedClaims.length ? rejectedClaims.map((claim) => <article className="admin-claim-card" key={claim.claimId}><div className="admin-claim-card__meta"><span className="status-pill status-pill--red">Previously rejected</span><span>{claim.rejectedAt ? new Date(claim.rejectedAt).toLocaleString("en-IN") : "Review time unavailable"}</span></div><div className="admin-claim-card__details"><div><span>Account</span><strong>{claim.ownerEmail}</strong></div><div><span>Claim</span><strong>{claim.claimId}</strong></div><div><span>Amount</span><strong>{formatINR(claim.amountPaise)}</strong></div><div><span>Payer name</span><strong>{claim.payerName}</strong></div><div><span>Original UTR / reference</span><strong className="admin-utr">{claim.utrReference}</strong></div></div>{claim.rejectionNote ? <p className="admin-reconsideration-copy">Original review note: {claim.rejectionNote}</p> : null}<label className="admin-reason">Concise reconsideration note (optional)<input value={reasonByClaim[claim.claimId] ?? ""} onChange={(event) => setReasonByClaim((current) => ({ ...current, [claim.claimId]: event.target.value }))} maxLength={300} placeholder="Record only an operational recheck note" /></label><label className="admin-reconsider-confirm"><input type="checkbox" checked={Boolean(bankVerifiedByClaim[claim.claimId])} onChange={(event) => setBankVerifiedByClaim((current) => ({ ...current, [claim.claimId]: event.target.checked }))} />I independently verified this payment in business bank history.</label><div className="admin-claim-card__actions"><button className="button-primary" disabled={workingId === claim.claimId || !bankVerifiedByClaim[claim.claimId]} onClick={() => { void reconsider(claim); }}>{workingId === claim.claimId ? <Loader2 className="spin" size={16} /> : <Check size={16} />}Approve after recheck</button></div></article>) : <div className="admin-empty"><BadgeCheck size={22} /><strong>No rejected claims need reconsideration.</strong><span>A rejected claim appears here only for an allowlisted reviewer.</span></div>}</section></main>;
}
