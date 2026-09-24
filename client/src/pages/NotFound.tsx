import { AlertCircle, Home } from "lucide-react";
import { useLocation } from "wouter";

export default function NotFound() {
  const [, setLocation] = useLocation();
  return <main className="auth-shell"><section className="auth-card not-found-card"><AlertCircle aria-hidden="true" size={40} className="not-found-icon" /><p className="eyebrow">404</p><h1>Page not found</h1><p>This page does not exist or may have moved.</p><button type="button" className="button-primary" onClick={() => setLocation("/")}><Home size={16} aria-hidden="true" />Return to DueWeave</button></section></main>;
}
