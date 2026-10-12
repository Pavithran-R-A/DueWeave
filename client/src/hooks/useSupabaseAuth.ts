import type { Session, User } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import { friendlyAuthError, interpretResendResponse, interpretSignInResponse, interpretSignUpResponse } from "@/lib/auth-outcome";
import type { AuthFlowOutcome, AuthResult, ResendOutcome } from "@/lib/auth-outcome";
import { supabase } from "@/lib/supabase";
import { confirmationRedirectUrl } from "@/lib/auth-redirect";

export function useSupabaseAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    let authEventReceived = false;

    // An offline first visit can reject getSession(). Without a rejection path, the
    // whole application remains on "Opening your private ledger…" indefinitely.
    // A newer auth-state event always wins over a late session lookup.
    void supabase.auth.getSession()
      .then(({ data }) => {
        if (!active || authEventReceived) return;
        setSession(data.session);
        setUser(data.session?.user ?? null);
        setLoading(false);
      })
      .catch(() => {
        if (!active || authEventReceived) return;
        // Fail closed; the sign-in page can now show its network-retry message.
        setSession(null);
        setUser(null);
        setLoading(false);
      });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return;
      authEventReceived = true;
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
      setLoading(false);
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string): Promise<AuthFlowOutcome> => {
    const response = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    return interpretSignInResponse(response);
  }, []);

  const signUp = useCallback(async (displayName: string, email: string, password: string): Promise<AuthFlowOutcome> => {
    const response = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: { display_name: displayName.trim() },
        emailRedirectTo: confirmationRedirectUrl(window.location.origin),
      },
    });
    return interpretSignUpResponse(response);
  }, []);

  // A resent link is the same promise as the first one, so it has to carry the same
  // destination; leaving it out would send the second message to the hosted Site URL.
  const resendConfirmation = useCallback(async (email: string): Promise<ResendOutcome> => {
    return interpretResendResponse(await supabase.auth.resend({
      type: "signup",
      email: email.trim(),
      options: { emailRedirectTo: confirmationRedirectUrl(window.location.origin) },
    }));
  }, []);

  const signOut = useCallback(async (): Promise<AuthResult> => {
    const { error } = await supabase.auth.signOut();
    return error ? { error: friendlyAuthError(error.message) } : {};
  }, []);

  const resetPassword = useCallback(async (email: string): Promise<AuthResult> => {
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/auth/update-password`,
    });
    return error ? { error: friendlyAuthError(error.message) } : {};
  }, []);

  const updatePassword = useCallback(async (password: string): Promise<AuthResult> => {
    const { error } = await supabase.auth.updateUser({ password });
    return error ? { error: friendlyAuthError(error.message) } : {};
  }, []);

  return { user, session, loading, isAuthenticated: Boolean(user), signIn, signUp, signOut, resetPassword, updatePassword, resendConfirmation };
}
