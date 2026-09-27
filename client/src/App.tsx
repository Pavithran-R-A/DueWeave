// Quiet Ledger style reminder: the shell is light-first, locally stateful, and intentionally free of backend assumptions.

import { Toaster } from "@/components/ui/sonner";
import { Loader2 } from "lucide-react";
import { lazy, Suspense, useEffect, type ComponentType } from "react";
import { Route, Switch, useLocation } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ErrorState } from "./components/finance-ui";
import { WorkspaceProfileProvider, useWorkspaceProfile } from "./contexts/WorkspaceProfileContext";
import { useSupabaseAuth } from "./hooks/useSupabaseAuth";
import NotFound from "./pages/NotFound";

const Auth = lazy(() => import("./pages/Auth"));
const Home = lazy(() => import("./pages/Home"));
const Onboarding = lazy(() => import("./pages/Onboarding"));
const FounderPurchase = lazy(() => import("./pages/FounderPurchase"));
const FounderAdmin = lazy(() => import("./pages/FounderAdmin"));

function SessionLoading() {
  return <main className="auth-loading" aria-live="polite"><Loader2 className="spin" size={24} /><span>Opening your private ledger…</span></main>;
}

// Two waits, in order, before any ledger markup exists: the session, then the
// profile row that decides whether this account has named its workspace yet.
// Nothing here consults browser storage — a new browser lands on the same gate
// because the answer lives in the database.
function useWorkspaceAccess() {
  const { isAuthenticated, loading: authLoading } = useSupabaseAuth();
  const { loading: profileLoading, error, setupComplete, reload } = useWorkspaceProfile();
  const settled = !authLoading && isAuthenticated && !profileLoading && !error;
  return { authLoading, error, isAuthenticated, profileLoading, reload, settled, setupComplete };
}

function ProtectedHome() {
  const { authLoading, error, isAuthenticated, profileLoading, reload, settled, setupComplete } = useWorkspaceAccess();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (!authLoading && !isAuthenticated) navigate("/auth", { replace: true });
  }, [authLoading, isAuthenticated, navigate]);

  useEffect(() => {
    if (settled && !setupComplete) navigate("/onboarding", { replace: true });
  }, [navigate, settled, setupComplete]);

  if (authLoading || !isAuthenticated) return <SessionLoading />;
  if (profileLoading) return <SessionLoading />;
  if (error) return <GateError onRetry={() => { void reload(); }} />;
  if (!setupComplete) return <SessionLoading />;
  return <Home />;
}

function OnboardingRoute() {
  const { authLoading, error, isAuthenticated, profileLoading, reload, settled, setupComplete } = useWorkspaceAccess();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (!authLoading && !isAuthenticated) navigate("/auth", { replace: true });
  }, [authLoading, isAuthenticated, navigate]);

  useEffect(() => {
    if (settled && setupComplete) navigate("/", { replace: true });
  }, [navigate, settled, setupComplete]);

  if (authLoading || !isAuthenticated) return <SessionLoading />;
  if (profileLoading) return <SessionLoading />;
  if (error) return <GateError onRetry={() => { void reload(); }} />;
  if (setupComplete) return <SessionLoading />;
  return <Onboarding />;
}

function GateError({ onRetry }: { onRetry: () => void }) {
  return <main className="gate-state"><ErrorState onRetry={onRetry} /></main>;
}

function ProtectedPage({ Page }: { Page: ComponentType }) {
  const { isAuthenticated, loading } = useSupabaseAuth();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (!loading && !isAuthenticated) navigate("/auth", { replace: true });
  }, [isAuthenticated, loading, navigate]);

  if (loading || !isAuthenticated) return <SessionLoading />;
  return <Page />;
}

function AuthRoute() {
  const { isAuthenticated, loading } = useSupabaseAuth();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (!loading && isAuthenticated) navigate("/", { replace: true });
  }, [isAuthenticated, loading, navigate]);

  if (loading) return <SessionLoading />;
  if (isAuthenticated) return <SessionLoading />;
  return <Auth />;
}

function App() {
  return <ErrorBoundary><WorkspaceProfileProvider><Toaster /><Suspense fallback={<SessionLoading />}><Switch><Route path="/auth" component={AuthRoute} /><Route path="/auth/update-password" component={Auth} /><Route path="/onboarding" component={OnboardingRoute} /><Route path="/founder" component={() => <ProtectedPage Page={FounderPurchase} />} /><Route path="/admin/founder-claims" component={() => <ProtectedPage Page={FounderAdmin} />} /><Route path="/" component={ProtectedHome} /><Route component={NotFound} /></Switch></Suspense></WorkspaceProfileProvider></ErrorBoundary>;
}

export default App;
