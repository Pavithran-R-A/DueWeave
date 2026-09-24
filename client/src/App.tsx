// Quiet Ledger style reminder: the shell is light-first, locally stateful, and intentionally free of backend assumptions.

import { Toaster } from "@/components/ui/sonner";
import { Loader2 } from "lucide-react";
import { lazy, Suspense, useEffect, type ComponentType } from "react";
import { Route, Switch, useLocation } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { useSupabaseAuth } from "./hooks/useSupabaseAuth";
import NotFound from "./pages/NotFound";

const Auth = lazy(() => import("./pages/Auth"));
const Home = lazy(() => import("./pages/Home"));
const FounderPurchase = lazy(() => import("./pages/FounderPurchase"));
const FounderAdmin = lazy(() => import("./pages/FounderAdmin"));

function SessionLoading() {
  return <main className="auth-loading" aria-live="polite"><Loader2 className="spin" size={24} /><span>Opening your private ledger…</span></main>;
}

function ProtectedHome() {
  const { isAuthenticated, loading } = useSupabaseAuth();
  const [, navigate] = useLocation();

  useEffect(() => {
    if (!loading && !isAuthenticated) navigate("/auth", { replace: true });
  }, [isAuthenticated, loading, navigate]);

  if (loading) return <SessionLoading />;
  if (!isAuthenticated) return <SessionLoading />;
  return <Home />;
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
  return <ErrorBoundary><ThemeProvider defaultTheme="light"><Toaster position="top-right" /><Suspense fallback={<SessionLoading />}><Switch><Route path="/auth" component={AuthRoute} /><Route path="/auth/update-password" component={Auth} /><Route path="/founder" component={() => <ProtectedPage Page={FounderPurchase} />} /><Route path="/admin/founder-claims" component={() => <ProtectedPage Page={FounderAdmin} />} /><Route path="/" component={ProtectedHome} /><Route component={NotFound} /></Switch></Suspense></ThemeProvider></ErrorBoundary>;
}

export default App;
