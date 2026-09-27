import type { Session, User } from "@supabase/supabase-js";
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

export type AuthResult = { error?: string };

// A sign-up attempt ends in one of three genuinely different places, and the two
// that involve no error are not the same news to give someone: a session means the
// ledger is open right now, while no session means an email has to be confirmed
// first and there is nothing to open yet. Collapsing those into { error? } is what
// let the screen say "your account is ready" to a person who could not get in.
export type SignUpOutcome = { status: "session" } | { status: "confirmation-required" } | { status: "error"; error: string };

export const GENERIC_AUTH_FAILURE = "We could not complete that request. Please try again.";

/** The part of a sign-up reply the screen has to decide from: a refusal, a session, a user, or nothing. */
export type SignUpResponse = {
  error?: { message: string } | null;
  data?: { session?: unknown | null; user?: unknown | null } | null;
};

function friendlyAuthError(message: string) {
  const normalized = message.toLowerCase();
  if (normalized.includes("invalid login") || normalized.includes("invalid credentials")) {
    return "That email and password combination does not match an account.";
  }
  if (normalized.includes("already registered") || normalized.includes("already been registered")) {
    return "An account already exists for this email. Try signing in instead.";
  }
  if (normalized.includes("password should") || normalized.includes("password must")) {
    return "Choose a password with at least 8 characters.";
  }
  if (normalized.includes("rate limit")) {
    return "Please wait a moment before trying again.";
  }
  if (normalized.includes("network") || normalized.includes("fetch")) {
    return "We could not reach DueWeave. Check your connection and try again.";
  }
  return GENERIC_AUTH_FAILURE;
}

// Read once, decided once: an account that exists is not the same news as a ledger
// that is open, and neither is the same as a refusal.
export function interpretSignUpResponse(response: SignUpResponse): SignUpOutcome {
  if (response.error) return { status: "error", error: friendlyAuthError(response.error.message) };
  if (response.data?.session) return { status: "session" };
  if (response.data?.user) return { status: "confirmation-required" };
  return { status: "error", error: GENERIC_AUTH_FAILURE };
}

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
