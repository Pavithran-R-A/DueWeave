import { FormEvent, useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, Loader2, LockKeyhole, Mail, ShieldCheck } from "lucide-react";
import { useLocation } from "wouter";
import { BRAND } from "@/config/brand";
import { useSupabaseAuth } from "@/hooks/useSupabaseAuth";

type AuthMode = "signIn" | "signUp" | "forgot" | "update";
type FieldErrors = { name: string; email: string; password: string };

const noErrors: FieldErrors = { name: "", email: "", password: "" };
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function copyFor(mode: AuthMode) {
  if (mode === "signUp") return { eyebrow: "A calmer ledger starts here", title: "Keep the promise, not the pressure.", body: "Create your private workspace for the money you are waiting on.", submit: "Create my workspace" };
  if (mode === "forgot") return { eyebrow: "Account recovery", title: "Return to your ledger.", body: "We will send a private password-reset link to your email address.", submit: "Send reset link" };
  if (mode === "update") return { eyebrow: "Secure your account", title: "Choose a new password.", body: "Use at least eight characters to keep your receivables workspace secure.", submit: "Save new password" };
  return { eyebrow: "Welcome back", title: "Your follow-ups, in one calm place.", body: "Sign in to see the money and promises that need your attention.", submit: "Sign in" };
}

// What each mode actually needs before it is worth asking the server. Anything the
// person can still fix by typing is checked here; anything that needs the server
// (an unknown password, an email that is already taken) is reported by the server.
function validate(mode: AuthMode, input: { name: string; email: string; password: string }): FieldErrors {
  const errors: FieldErrors = { ...noErrors };
  if (mode === "signUp" && !input.name.trim()) errors.name = "Add your name so we know who to greet.";
  if (mode !== "update") {
    if (!input.email.trim()) errors.email = "Enter your email address.";
    else if (!EMAIL_SHAPE.test(input.email.trim())) errors.email = "That does not look like an email address yet.";
  }
  if (mode !== "forgot") {
    if (!input.password) errors.password = "Enter your password.";
    else if (mode !== "signIn" && input.password.length < 8) errors.password = "Choose a password with at least 8 characters.";
  }
  return errors;
}

/** A heading plus a calm, action-only body: a screen that reports an outcome rather than collecting input. */
function OutcomePanel({ eyebrow, title, body, children }: { eyebrow: string; title: string; body: string; children: ReactNode }) {
  return (
    <>
      <div className="auth-heading">
        <span className="eyebrow">{eyebrow}</span>
        <h2>{title}</h2>
        <p>{body}</p>
      </div>
      <div className="auth-outcome">{children}</div>
    </>
  );
}

export default function Auth() {
  const [location, navigate] = useLocation();
  const { user, loading, signIn, signUp, resetPassword, updatePassword } = useSupabaseAuth();
  const initialMode = location.includes("update-password") ? "update" : "signIn";
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>(noErrors);
  const [submitting, setSubmitting] = useState(false);
  const [unconfirmedEmail, setUnconfirmedEmail] = useState("");
  const content = useMemo(() => copyFor(mode), [mode]);
  // Three of these four screens collect nothing. Which one a visitor gets is decided
  // by what the server actually returned, never by which button they last pressed.
  const outcome = unconfirmedEmail
    ? "confirm-email"
    : mode === "update" && !user
      ? loading ? "checking-recovery" : "no-recovery-session"
      : "form";

  useEffect(() => {
    if (!loading && user && mode !== "update") navigate("/", { replace: true });
  }, [loading, mode, navigate, user]);

  // A recovery link can arrive while this screen is already open, so a change of route
  // — not the first render — decides when the password form is the right thing to show.
  // Only the location is watched: once the person chooses another screen here, nothing
  // should push them back into recovery mode without them asking for it.
  useEffect(() => {
    if (location.includes("update-password")) setMode("update");
  }, [location]);

  function changeMode(nextMode: AuthMode) {
    setMode(nextMode);
    setNotice("");
    setError("");
    setPassword("");
    setFieldErrors(noErrors);
    setUnconfirmedEmail("");
  }

  function goToSignIn() {
    changeMode("signIn");
    navigate("/auth", { replace: true });
  }

  function clearFieldError(field: keyof FieldErrors) {
    setFieldErrors((current) => ({ ...current, [field]: "" }));
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice("");
    setError("");
    const nextErrors = validate(mode, { name, email, password });
    setFieldErrors(nextErrors);
    if (nextErrors.name || nextErrors.email || nextErrors.password) return;

    setSubmitting(true);

    if (mode === "signUp") {
      const signUpOutcome = await signUp(name, email, password);
      setSubmitting(false);
      if (signUpOutcome.status === "error") setError(signUpOutcome.error);
      // Nothing is claimed here when a session exists: the authenticated redirect
      // effect above takes the person straight into workspace setup.
      if (signUpOutcome.status === "confirmation-required") setUnconfirmedEmail(email.trim());
      return;
    }

    const result = mode === "forgot" ? await resetPassword(email) : mode === "update" ? await updatePassword(password) : await signIn(email, password);
    setSubmitting(false);
    if (result.error) {
      setError(result.error);
      return;
    }

    if (mode === "forgot") setNotice("If that email belongs to a DueWeave account, a reset link is on its way.");
    if (mode === "update") {
      setNotice("Your password has been updated. You can return to your ledger.");
      window.setTimeout(() => navigate("/", { replace: true }), 900);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-story" aria-label="About DueWeave">
        <div className="auth-story__texture" style={{ backgroundImage: `url(${BRAND.texture})` }} />
        <a className="auth-brand" href="/auth" onClick={(event) => { event.preventDefault(); goToSignIn(); }}>
          <img src={BRAND.mark} alt="" />
          <span><strong>{BRAND.name}</strong><small>Receivables ledger</small></span>
        </a>
        <div className="auth-story__copy">
          <span className="eyebrow">Private by design</span>
          <h1>{BRAND.shortTagline}</h1>
          <p>Every account has an isolated ledger. Your clients, receivables, promises, and payment history remain visible only to you.</p>
        </div>
        <div className="auth-story__proof">
          <ShieldCheck size={18} />
          <span><strong>Built for considered follow-through</strong><small>No client data is loaded until you sign in.</small></span>
        </div>
      </section>

      <section className="auth-panel">
        <div className="auth-panel__inner">
          {outcome === "confirm-email" && <OutcomePanel eyebrow="Almost there" title="Confirm your email to open your ledger." body="The account exists, but DueWeave has not opened your private ledger for it yet. Open the confirmation link we emailed you, then come back here to sign in.">
            <p className="auth-outcome__address"><Mail size={15} /><span>{unconfirmedEmail}</span></p>
            <p className="auth-outcome__note">If the email does not arrive within a few minutes, check your spam folder.</p>
            <button type="button" className="button-primary auth-submit" onClick={goToSignIn}>I have confirmed — sign in<ArrowRight size={16} /></button>
            <p className="auth-actions auth-actions--single">Wrong address? <button type="button" className="text-button" onClick={() => { changeMode("signUp"); setEmail(""); }}>Start again with a different email</button></p>
          </OutcomePanel>}

          {outcome === "checking-recovery" && <OutcomePanel eyebrow="Account recovery" title="Checking your recovery link." body="DueWeave shows the password form only once this page holds a valid recovery session.">
            <p className="auth-outcome__status" role="status"><Loader2 className="spin" size={15} /> Checking…</p>
          </OutcomePanel>}

          {outcome === "no-recovery-session" && <OutcomePanel eyebrow="Account recovery" title="This recovery link is not active." body="For your security, a new password can only be set from the private link DueWeave emails you, opened in this browser. This page has no recovery session, so nothing here could change your password.">
            <button type="button" className="button-primary auth-submit" onClick={() => changeMode("forgot")}>Request a new reset link<ArrowRight size={16} /></button>
            <p className="auth-actions auth-actions--single"><button type="button" className="text-button" onClick={goToSignIn}>Back to sign in</button></p>
          </OutcomePanel>}

          {outcome === "form" && <>
            <div className="auth-heading">
              {(mode === "forgot" || mode === "update") && <button type="button" className="auth-back" onClick={goToSignIn}><ArrowLeft size={15} /> Back to sign in</button>}
              <span className="eyebrow">{content.eyebrow}</span>
              <h2>{content.title}</h2>
              <p>{content.body}</p>
            </div>

            <form className="auth-form" onSubmit={onSubmit} noValidate>
              {mode === "signUp" && <div className="field">
                <label className="field__label" htmlFor="auth-name">Your name</label>
                <input id="auth-name" className="form-input" autoComplete="name" required value={name} aria-invalid={Boolean(fieldErrors.name)} aria-describedby={fieldErrors.name ? "auth-name-error" : undefined} onChange={(event) => { setName(event.target.value); clearFieldError("name"); }} placeholder="How should we greet you?" />
                {fieldErrors.name && <p className="field__error" id="auth-name-error" role="alert">{fieldErrors.name}</p>}
              </div>}
              {mode !== "update" && <div className="field">
                <label className="field__label" htmlFor="auth-email">Email address</label>
                <span className="auth-input"><Mail size={15} /><input id="auth-email" className="form-input" type="email" autoComplete="email" required value={email} aria-invalid={Boolean(fieldErrors.email)} aria-describedby={fieldErrors.email ? "auth-email-error" : undefined} onChange={(event) => { setEmail(event.target.value); clearFieldError("email"); }} placeholder="you@business.in" /></span>
                {fieldErrors.email && <p className="field__error" id="auth-email-error" role="alert">{fieldErrors.email}</p>}
              </div>}
              {mode !== "forgot" && <div className="field">
                <label className="field__label" htmlFor="auth-password">{mode === "update" ? "New password" : "Password"}</label>
                <span className="auth-input"><LockKeyhole size={15} /><input id="auth-password" className="form-input" type="password" autoComplete={mode === "signIn" ? "current-password" : "new-password"} minLength={8} required value={password} aria-invalid={Boolean(fieldErrors.password)} aria-describedby={fieldErrors.password ? "auth-password-error" : undefined} onChange={(event) => { setPassword(event.target.value); clearFieldError("password"); }} placeholder="At least 8 characters" /></span>
                {fieldErrors.password && <p className="field__error" id="auth-password-error" role="alert">{fieldErrors.password}</p>}
              </div>}
              {error && <p className="auth-message auth-message--error" role="alert">{error}</p>}
              {notice && <p className="auth-message auth-message--notice"><CheckCircle2 size={16} />{notice}</p>}
              <button className="button-primary auth-submit" disabled={submitting} type="submit">{submitting ? <><Loader2 className="spin" size={17} />Please wait</> : <>{content.submit}<ArrowRight size={16} /></>}</button>
            </form>

            {mode === "signIn" && <div className="auth-actions"><button type="button" className="text-button" onClick={() => changeMode("forgot")}>Forgot password?</button><p>New to DueWeave? <button type="button" className="text-button" onClick={() => changeMode("signUp")}>Create an account</button></p></div>}
            {mode === "signUp" && <p className="auth-actions auth-actions--single">Already have an account? <button type="button" className="text-button" onClick={() => changeMode("signIn")}>Sign in</button></p>}
          </>}

          <p className="auth-footnote">Your browser uses a secure session to open your private ledger. We never display technical database errors here.</p>
        </div>
      </section>
    </main>
  );
}
