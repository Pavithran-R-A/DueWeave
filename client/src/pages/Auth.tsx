import { FormEvent, useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, Loader2, LockKeyhole, Mail, RefreshCw, ShieldCheck } from "lucide-react";
import { Link, useLocation } from "wouter";
import { BRAND } from "@/config/brand";
import { TurnstileGate } from "@/components/TurnstileGate";
import { useSupabaseAuth } from "@/hooks/useSupabaseAuth";
import { RESEND_REQUESTED_COPY } from "@/lib/auth-outcome";
import { linkArrivalNotice, withoutLinkArrival } from "@/lib/auth-redirect";
import { PASSWORD_MIN_LENGTH, noFieldErrors, validateAuthFields, type AuthFieldErrors, type AuthMode } from "@/lib/auth-validation";
import { releaseFlagEnabled } from "@/lib/release-flags";
import { TURNSTILE_SITE_KEY } from "@/lib/turnstile";

function copyFor(mode: AuthMode) {
  if (mode === "signUp") return { eyebrow: "A calmer ledger starts here", title: "Keep the promise, not the pressure.", body: "Create your private workspace for the money you are waiting on.", submit: "Create my workspace" };
  if (mode === "forgot") return { eyebrow: "Account recovery", title: "Return to your ledger.", body: "We will send a private password-reset link to your email address.", submit: "Send reset link" };
  if (mode === "update") return { eyebrow: "Secure your account", title: "Choose a new password.", body: "Use at least eight characters to keep your receivables workspace secure.", submit: "Save new password" };
  return { eyebrow: "Welcome back", title: "Your follow-ups, in one calm place.", body: "Sign in to see the money and promises that need your attention.", submit: "Sign in" };
}

// What each mode actually needs before it is worth asking the server lives in `@/lib/auth-validation`,
// where the eight-character floor is a rule the unit suite can execute rather than a line in this file.

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
  const { user, loading, signIn, signUp, resetPassword, updatePassword, resendConfirmation } = useSupabaseAuth();
  const initialMode = location.includes("update-password") ? "update" : "signIn";
  const [mode, setMode] = useState<AuthMode>(initialMode);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState<AuthFieldErrors>(noFieldErrors);
  const [submitting, setSubmitting] = useState(false);
  const [unconfirmedEmail, setUnconfirmedEmail] = useState("");
  const [resending, setResending] = useState(false);
  const [resendNews, setResendNews] = useState("");
  // A link that arrives reporting a problem is the one arrival this screen used to say
  // nothing about: a customer who had already confirmed, and opened the link a second
  // time, was left on a silent sign-in form with the auth server's technical failure text
  // sitting in their address bar.
  const [linkReport, setLinkReport] = useState("");
  // CL-7 P3 item 12: the verification token belongs to the attempt that collected it, so it is
  // cleared after every one. `captchaAttempt` is what re-arms the widget, because a token GoTrue
  // has already spent cannot be replayed — the visitor would have to reload the page for a new one.
  const [captchaToken, setCaptchaToken] = useState("");
  const [captchaAttempt, setCaptchaAttempt] = useState(0);
  // A build with no site key collects nothing and requires nothing. The condition stays on the
  // key alone, not on the release flags: GoTrue's CAPTCHA setting protects sign-in too, and a
  // screen that withheld the widget from a flow the server guards would fail that sign-in closed.
  const captchaRequired = TURNSTILE_SITE_KEY !== "";
  // A flow is offered only when a build states its flag as exactly "true"; an unstated flag
  // is refused by `vite build` rather than compiled in as enabled. See `@/lib/release-flags`.
  const publicSignUpEnabled = releaseFlagEnabled(import.meta.env.VITE_PUBLIC_SIGNUP_ENABLED);
  const authEmailEnabled = releaseFlagEnabled(import.meta.env.VITE_AUTH_EMAIL_ENABLED);
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

  // A link can also arrive reporting a problem, and it can arrive while this screen is
  // already open — clicking an emailed link from here changes nothing but the address
  // fragment, which never reloads the document. So the arrival is read on every fragment
  // change as well as on the first render, answered in DueWeave's own words, and removed
  // from the address so a refresh cannot re-announce a link question that is already closed.
  useEffect(() => {
    const readArrival = () => {
      const report = linkArrivalNotice(window.location.hash);
      setLinkReport(report);
      if (report) window.history.replaceState(null, "", withoutLinkArrival(window.location.href));
    };
    readArrival();
    window.addEventListener("hashchange", readArrival);
    return () => window.removeEventListener("hashchange", readArrival);
  }, []);

  function changeMode(nextMode: AuthMode) {
    setMode(nextMode);
    setNotice("");
    setError("");
    setPassword("");
    setFieldErrors(noFieldErrors);
    setUnconfirmedEmail("");
    setResendNews("");
  }

  function goToSignIn() {
    changeMode("signIn");
    navigate("/auth", { replace: true });
  }

  function clearFieldError(field: keyof AuthFieldErrors) {
    setFieldErrors((current) => ({ ...current, [field]: "" }));
  }

  // The only thing this can honestly report is that the sender accepted the request. Whether
  // the link reached an inbox is not something a browser can know, and saying otherwise is
  // how a visitor ends up refreshing a screen forever.
  // The verification handlers are stable so the widget is not torn down and re-rendered on
  // every keystroke; it reads them through a ref.
  const receiveCaptchaToken = useCallback((token: string) => setCaptchaToken(token), []);
  const refuseCaptcha = useCallback((message: string) => {
    setCaptchaToken("");
    setCaptchaAttempt((current) => current + 1);
    setError(message);
  }, []);

  // A resent link is asked for from a screen that has no password form, so it gets its own
  // widget and its own token — but the same refusal: GoTrue guards resend too, and a request
  // without the token is refused there rather than here.
  async function sendConfirmationAgain() {
    if (captchaRequired && !captchaToken) {
      setError("Complete the verification before asking for the email again.");
      return;
    }
    setResending(true);
    setError("");
    setResendNews("");
    try {
      const outcome = await resendConfirmation(unconfirmedEmail, captchaToken);
      if (outcome.status === "requested") setResendNews(RESEND_REQUESTED_COPY);
      else setError(outcome.error);
    } catch {
      setError("DueWeave could not reach the sign-in service. Check your connection and try again.");
    } finally {
      setCaptchaToken("");
      setCaptchaAttempt((current) => current + 1);
      setResending(false);
    }
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice("");
    setError("");
    const nextErrors = validateAuthFields(mode, { name, email, password });
    setFieldErrors(nextErrors);
    if (nextErrors.name || nextErrors.email || nextErrors.password) return;

    // Checked before the network rather than after: GoTrue would refuse this call anyway, and a
    // visitor who never saw the widget gets a technical refusal they cannot act on.
    if (mode !== "update" && captchaRequired && !captchaToken) {
      setError("Complete the verification before continuing.");
      return;
    }

    if (mode === "forgot" && !authEmailEnabled) {
      setError("Password recovery email is temporarily unavailable. No reset link has been sent.");
      return;
    }

    // The backstop, not the gate: no screen may open registration while the flag is off, and
    // this line means that a future screen that does would still create nobody.
    if (mode === "signUp" && !publicSignUpEnabled) {
      setError("Registration is temporarily paused. No account has been created.");
      return;
    }

    setSubmitting(true);
    try {
      if (mode === "signUp") {
        const signUpOutcome = await signUp(name, email, password, captchaToken);
        if (signUpOutcome.status === "error") setError(signUpOutcome.error);
        // A successful sign-in redirects through the authenticated session gate.
        if (signUpOutcome.status === "confirmation-required") setUnconfirmedEmail(email.trim());
        return;
      }

      if (mode === "signIn") {
        const signInOutcome = await signIn(email, password, captchaToken);
        if (signInOutcome.status === "error") setError(signInOutcome.error);
        // An address that exists but has not been confirmed is the same waiting as a fresh
        // sign-up, so it gets the same screen — and the same way to ask for the link again.
        if (signInOutcome.status === "confirmation-required") setUnconfirmedEmail(email.trim());
        return;
      }

      const result = mode === "forgot"
        ? await resetPassword(email, captchaToken)
        : await updatePassword(password);
      if (result.error) {
        setError(result.error);
        return;
      }
      if (mode === "forgot") setNotice("If that email belongs to a DueWeave account, a reset link is on its way.");
      if (mode === "update") {
        setNotice("Your password has been updated. You can return to your ledger.");
        window.setTimeout(() => navigate("/", { replace: true }), 900);
      }
    } catch {
      // Offline/network exceptions are not Supabase AuthError responses. Without this catch the
      // submit button stays permanently disabled and a retry requires reloading the whole page.
      setError("DueWeave could not reach the sign-in service. Check your connection and try again.");
    } finally {
      // Whatever the server answered, this token is spent: GoTrue will not accept it twice.
      setCaptchaToken("");
      setCaptchaAttempt((current) => current + 1);
      setSubmitting(false);
    }
  }

  // One widget, mounted wherever the screen asks the server for something: the form and the
  // waiting-for-confirmation panel are exclusive branches, so at most one of them is mounted.
  const captchaGate = captchaRequired ? (
    <TurnstileGate attempt={captchaAttempt} onToken={receiveCaptchaToken} onFailure={refuseCaptcha} />
  ) : null;

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
            {captchaGate}
            {authEmailEnabled ? <button type="button" className="button-secondary auth-resend" onClick={() => { void sendConfirmationAgain(); }} disabled={resending}>{resending ? <><Loader2 className="spin" size={16} />Please wait</> : <><RefreshCw size={16} />Send the confirmation email again</>}</button> : <p role="status" className="auth-outcome__note">Confirmation emails are temporarily unavailable.</p>}
            {resendNews && <p className="auth-message auth-message--notice" role="status"><CheckCircle2 size={16} />{resendNews}</p>}
            <button type="button" className="button-primary auth-submit" onClick={goToSignIn}>I have confirmed — sign in<ArrowRight size={16} /></button>
            {publicSignUpEnabled ? <p className="auth-actions auth-actions--single">Wrong address? <button type="button" className="text-button" onClick={() => { changeMode("signUp"); setEmail(""); }}>Start again with a different email</button></p> : <p role="status" className="auth-outcome__note">Registration is paused, so a different address cannot be started here.</p>}
          </OutcomePanel>}

          {outcome === "checking-recovery" && <OutcomePanel eyebrow="Account recovery" title="Checking your recovery link." body="DueWeave shows the password form only once this page holds a valid recovery session.">
            <p className="auth-outcome__status" role="status"><Loader2 className="spin" size={15} /> Checking…</p>
          </OutcomePanel>}

          {outcome === "no-recovery-session" && <OutcomePanel eyebrow="Account recovery" title="This recovery link is not active." body="A recovery link can be used once, and only for a limited time. It may have been used already, or it may have expired while the message sat unread — either way this page holds no recovery session, so nothing here can set a new password. Ask for a fresh link below, then open it in this browser.">
            {authEmailEnabled ? <button type="button" className="button-primary auth-submit" onClick={() => changeMode("forgot")}>Request a new reset link<ArrowRight size={16} /></button> : <p role="status" className="auth-outcome__note">Password recovery emails are temporarily unavailable. No reset request can be sent right now.</p>}
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
              {linkReport && <p className="auth-message auth-message--notice" role="status"><Mail size={16} />{linkReport}</p>}
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
                <span className="auth-input"><LockKeyhole size={15} /><input id="auth-password" className="form-input" type="password" autoComplete={mode === "signIn" ? "current-password" : "new-password"} minLength={PASSWORD_MIN_LENGTH} required value={password} aria-invalid={Boolean(fieldErrors.password)} aria-describedby={fieldErrors.password ? "auth-password-error" : undefined} onChange={(event) => { setPassword(event.target.value); clearFieldError("password"); }} placeholder={`At least ${PASSWORD_MIN_LENGTH} characters`} /></span>
                {fieldErrors.password && <p className="field__error" id="auth-password-error" role="alert">{fieldErrors.password}</p>}
              </div>}
              {captchaGate}
              {error && <p className="auth-message auth-message--error" role="alert">{error}</p>}
              {notice && <p className="auth-message auth-message--notice"><CheckCircle2 size={16} />{notice}</p>}
              <button className="button-primary auth-submit" disabled={submitting} type="submit">{submitting ? <><Loader2 className="spin" size={17} />Please wait</> : <>{content.submit}<ArrowRight size={16} /></>}</button>
            </form>

            {mode === "signIn" && <div className="auth-actions">{authEmailEnabled ? <button type="button" className="text-button" onClick={() => changeMode("forgot")}>Forgot password?</button> : <span role="status">Password recovery emails are temporarily unavailable.</span>}<p>{publicSignUpEnabled ? <>New to DueWeave? <button type="button" className="text-button" onClick={() => changeMode("signUp")}>Create an account</button></> : <span role="status">New registrations are temporarily paused while we finish secure confirmation-email delivery.</span>}</p></div>}
            {mode === "signUp" && <p className="auth-actions auth-actions--single">Already have an account? <button type="button" className="text-button" onClick={() => changeMode("signIn")}>Sign in</button></p>}
          </>}

          <p className="auth-footnote">Your browser uses a secure session to open your private ledger. We never display technical database errors here.</p>
          <nav className="auth-legal-links" aria-label="DueWeave policies and help">
            <Link className="auth-legal-link" to="/privacy">Privacy Policy</Link>
            <Link className="auth-legal-link" to="/terms">Terms of Use</Link>
            <Link className="auth-legal-link" to="/support">Support</Link>
          </nav>
        </div>
      </section>
    </main>
  );
}
