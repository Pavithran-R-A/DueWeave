import type { Session, User } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import { friendlyAuthError, interpretSignUpResponse } from "@/lib/auth-outcome";
import type { AuthResult, SignUpOutcome } from "@/lib/auth-outcome";
import { supabase } from "@/lib/supabase";

export function useSupabaseAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;

    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      setSession(data.session);
      setUser(data.session?.user ?? null);
      setLoading(false);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession);
      setUser(nextSession?.user ?? null);
      setLoading(false);
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, []);

  const signIn = useCallback(async (email: string, password: string): Promise<AuthResult> => {
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
    return error ? { error: friendlyAuthError(error.message) } : {};
  }, []);

  const signUp = useCallback(async (displayName: string, email: string, password: string): Promise<SignUpOutcome> => {
    const response = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: { data: { display_name: displayName.trim() } },
    });
    return interpretSignUpResponse(response);
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

  return { user, session, loading, isAuthenticated: Boolean(user), signIn, signUp, signOut, resetPassword, updatePassword };
}
