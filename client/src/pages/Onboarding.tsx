// Quiet Ledger style reminder: workspace setup asks for the two facts the ledger
// cannot work without, then gets out of the way. Everything else is a default the
// product already stands behind and shows read-only instead of pretending to ask.

import { FormEvent, useRef, useState } from "react";
import { useLocation } from "wouter";
import { ArrowRight, Loader2, ShieldCheck } from "lucide-react";
import { BRAND } from "@/config/brand";
import { useWorkspaceProfile } from "@/contexts/WorkspaceProfileContext";
import { BUSINESS_NAME_LIMIT, DISPLAY_NAME_LIMIT, validateBusinessName, validateDisplayName } from "@/lib/profile";

export default function Onboarding() {
  const [, navigate] = useLocation();
  const { saveWorkspace, reload } = useWorkspaceProfile();
  const [name, setName] = useState("");
  const [business, setBusiness] = useState("");
  const [nameError, setNameError] = useState("");
  const [businessError, setBusinessError] = useState("");
  const [saveError, setSaveError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const submittingRef = useRef(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submittingRef.current) return;
    const nextNameError = validateDisplayName(name);
    const nextBusinessError = validateBusinessName(business);
    setNameError(nextNameError);
    setBusinessError(nextBusinessError);
    setSaveError("");
    if (nextNameError || nextBusinessError) return;

    submittingRef.current = true;
    setSubmitting(true);
    try {
      await saveWorkspace({ displayName: name, businessName: business });
      await reload();
      navigate("/", { replace: true });
    } catch (error) {
      // The form stays open with what was typed; only the reason changes.
      setSaveError(error instanceof Error ? error.message : "We could not save your workspace details. Please try again.");
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  return (
    <main className="onboarding-shell">
      <div className="onboarding-inner">
        <div className="onboarding-brand">
          <img src={BRAND.mark} alt="" aria-hidden="true" />
          <span><strong>{BRAND.name}</strong><small>Receivables ledger</small></span>
        </div>
        <header className="onboarding-heading">
          <span className="eyebrow">One step before your ledger</span>
          <h1>Set up your private ledger.</h1>
          <p>Two names to begin with. They appear inside your own workspace, where every record stays visible to you alone.</p>
        </header>

        <form className="onboarding-form" onSubmit={onSubmit} noValidate>
          <div className="field">
            <label className="field__label" htmlFor="onboarding-name">Your name</label>
            <input id="onboarding-name" className="form-input" name="display_name" autoComplete="name" value={name} aria-invalid={Boolean(nameError)} aria-describedby={nameError ? "onboarding-name-hint onboarding-name-error" : "onboarding-name-hint"} onChange={(event) => { setName(event.target.value); setNameError(""); }} placeholder="How should DueWeave greet you?" />
            <p className="field__hint" id="onboarding-name-hint">Up to {DISPLAY_NAME_LIMIT} characters.</p>
            {nameError && <p className="field__error" id="onboarding-name-error" role="alert">{nameError}</p>}
          </div>
          <div className="field">
            <label className="field__label" htmlFor="onboarding-business">Business or workspace name</label>
            <input id="onboarding-business" className="form-input" name="business_name" autoComplete="organization" value={business} aria-invalid={Boolean(businessError)} aria-describedby={businessError ? "onboarding-business-hint onboarding-business-error" : "onboarding-business-hint"} onChange={(event) => { setBusiness(event.target.value); setBusinessError(""); }} placeholder="The name on your invoices" />
            <p className="field__hint" id="onboarding-business-hint">Up to {BUSINESS_NAME_LIMIT} characters.</p>
            {businessError && <p className="field__error" id="onboarding-business-error" role="alert">{businessError}</p>}
          </div>

          {saveError && <p className="field__error" role="alert">{saveError}</p>}

          <button className="button-primary onboarding-submit" type="submit" disabled={submitting}>
            {submitting ? <><Loader2 className="spin" size={16} />Saving…</> : <>Continue to your ledger<ArrowRight size={16} /></>}
          </button>
          <p className="onboarding-saved">Saved to your account, not this device. Signing in from a phone or another browser will ask the same question only if the answer is missing.</p>
        </form>

        <section className="onboarding-facts" aria-label="Defaults DueWeave has already chosen">
          <div><span>Currency</span><strong>Indian rupee · INR</strong></div>
          <div><span>Business calendar</span><strong>India · Asia/Kolkata</strong></div>
          <div><span>Visibility</span><strong>Only you, by row-level security</strong></div>
        </section>
        <p className="onboarding-facts__note"><ShieldCheck size={15} /> These are fixed for now, so there is nothing to decide here.</p>
      </div>
    </main>
  );
}
