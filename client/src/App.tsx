// Quiet Ledger style reminder: the shell is light-first, locally stateful, and intentionally free of backend assumptions.

import { Toaster } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Loader2 } from "lucide-react";
import { useEffect } from "react";
import { Route, Switch, useLocation } from "wouter";
import ErrorBoundary from "./components/ErrorBoundary";
import { ThemeProvider } from "./contexts/ThemeContext";
import { useSupabaseAuth } from "./hooks/useSupabaseAuth";
import Auth from "./pages/Auth";
import Home from "./pages/Home";
import NotFound from "./pages/NotFound";

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
  return <ErrorBoundary><ThemeProvider defaultTheme="light"><TooltipProvider><Toaster position="top-right" /><Switch><Route path="/auth" component={AuthRoute} /><Route path="/auth/update-password" component={Auth} /><Route path="/" component={ProtectedHome} /><Route component={NotFound} /></Switch></TooltipProvider></ThemeProvider></ErrorBoundary>;
}

export default App;
