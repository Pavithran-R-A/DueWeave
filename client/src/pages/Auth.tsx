import { FormEvent, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, CheckCircle2, Loader2, LockKeyhole, Mail, ShieldCheck } from "lucide-react";
import { useLocation } from "wouter";
import { BRAND } from "@/config/brand";
import { useSupabaseAuth } from "@/hooks/useSupabaseAuth";

type AuthMode = "signIn" | "signUp" | "forgot" | "update";

function copyFor(mode: AuthMode) {
  if (mode === "signUp") return { eyebrow: "A calmer ledger starts here", title: "Keep the promise, not the pressure.", body: "Create your private workspace for the money you are waiting on.", submit: "Create my workspace" };
  if (mode === "forgot") return { eyebrow: "Account recovery", title: "Return to your ledger.", body: "We will send a private password-reset link to your email address.", submit: "Send reset link" };
  if (mode === "update") return { eyebrow: "Secure your account", title: "Choose a new password.", body: "Use at least eight characters to keep your receivables workspace secure.", submit: "Save new password" };
  return { eyebrow: "Welcome back", title: "Your follow-ups, in one calm place.", body: "Sign in to see the money and promises that need your attention.", submit: "Sign in" };
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
  const [submitting, setSubmitting] = useState(false);
  const content = useMemo(() => copyFor(mode), [mode]);

  useEffect(() => {
    if (!loading && user && mode !== "update") navigate("/", { replace: true });
  }, [loading, mode, navigate, user]);

  function changeMode(nextMode: AuthMode) {
    setMode(nextMode);
    setNotice("");
    setError("");
    setPassword("");
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setNotice("");
    setError("");
    setSubmitting(true);

    let result;
    if (mode === "signUp") result = await signUp(name, email, password);
    else if (mode === "forgot") result = await resetPassword(email);
    else if (mode === "update") result = await updatePassword(password);
    else result = await signIn(email, password);

    setSubmitting(false);
    if (result.error) {
      setError(result.error);
      return;
    }

    if (mode === "signUp") setNotice("Your account is ready. Check your inbox if email confirmation is enabled, then sign in.");
    else if (mode === "forgot") setNotice("If that email belongs to a DueWeave account, a reset link is on its way.");
    else if (mode === "update") {
      setNotice("Your password has been updated. You can return to your ledger.");
      window.setTimeout(() => navigate("/", { replace: true }), 900);
    }
  }

  return (
    <main className="auth-shell">
      <section className="auth-story" aria-label="About DueWeave">
        <div className="auth-story__texture" style={{ backgroundImage: `url(${BRAND.texture})` }} />
        <a className="auth-brand" href="/auth" onClick={(event) => { event.preventDefault(); changeMode("signIn"); }}>
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
          <div className="auth-heading">
            {(mode === "forgot" || mode === "update") && <button type="button" className="auth-back" onClick={() => changeMode("signIn")}><ArrowLeft size={15} /> Back to sign in</button>}
            <span className="eyebrow">{content.eyebrow}</span>
            <h2>{content.title}</h2>
            <p>{content.body}</p>
          </div>

          <form className="auth-form" onSubmit={onSubmit}>
            {mode === "signUp" && <label className="field"><span>Your name</span><input className="form-input" autoComplete="name" required value={name} onChange={(event) => setName(event.target.value)} placeholder="How should we greet you?" /></label>}
            {mode !== "update" && <label className="field"><span>Email address</span><span className="auth-input"><Mail size={15} /><input className="form-input" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@business.in" /></span></label>}
            {mode !== "forgot" && <label className="field"><span>{mode === "update" ? "New password" : "Password"}</span><span className="auth-input"><LockKeyhole size={15} /><input className="form-input" type="password" autoComplete={mode === "signIn" ? "current-password" : "new-password"} minLength={8} required value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 8 characters" /></span></label>}
            {error && <p className="auth-message auth-message--error" role="alert">{error}</p>}
            {notice && <p className="auth-message auth-message--notice"><CheckCircle2 size={16} />{notice}</p>}
            <button className="button-primary auth-submit" disabled={submitting} type="submit">{submitting ? <Loader2 className="spin" size={17} /> : <>{content.submit}<ArrowRight size={16} /></>}</button>
          </form>

          {mode === "signIn" && <div className="auth-actions"><button type="button" className="text-button" onClick={() => changeMode("forgot")}>Forgot password?</button><p>New to DueWeave? <button type="button" className="text-button" onClick={() => changeMode("signUp")}>Create an account</button></p></div>}
          {mode === "signUp" && <p className="auth-actions auth-actions--single">Already have an account? <button type="button" className="text-button" onClick={() => changeMode("signIn")}>Sign in</button></p>}
          <p className="auth-footnote">Your browser uses a secure session to open your private ledger. We never display technical database errors here.</p>
        </div>
      </section>
    </main>
  );
}
