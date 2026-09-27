// Quiet Ledger style reminder: one persisted profile row, read once per session, is
// the only thing this app knows about who is using it. Nothing here consults
// browser storage for identity or setup state.

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { SupabaseProfileRepository } from "@/data/supabase-profile-repository";
import { useSupabaseAuth } from "@/hooks/useSupabaseAuth";
import { isWorkspaceSetupComplete } from "@/lib/profile";
import type { Profile } from "@/types/domain";

interface WorkspaceProfileValue {
  profile: Profile | null;
  loading: boolean;
  error: string;
  setupComplete: boolean;
  reload: () => Promise<void>;
  saveWorkspace: (input: { displayName: string; businessName: string }) => Promise<Profile>;
}

const WorkspaceProfileContext = createContext<WorkspaceProfileValue | null>(null);

export function WorkspaceProfileProvider({ children }: { children: ReactNode }) {
  const { user, loading: authLoading } = useSupabaseAuth();
  const [repository] = useState(() => new SupabaseProfileRepository());
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const ownerId = user?.id ?? "";

  const reload = useCallback(async () => {
    if (!ownerId) {
      setProfile(null);
      setError("");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const stored = await repository.read(ownerId);
      // A signed-in account without a profile row would otherwise be asked to
      // fill in a form it has no row to save into, so the gate says so plainly.
      if (!stored) throw new Error("We could not open your workspace details. Please try signing in again.");
      setProfile(stored);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "We could not open your workspace. Please try again.");
    } finally {
      setLoading(false);
    }
  }, [ownerId, repository]);

  useEffect(() => {
    if (!authLoading) void reload();
  }, [authLoading, reload]);

  // The write carries the token this screen was opened with, exactly like every
  // other edit in the product: a row that moved on in the meantime is refused
  // rather than overwritten, and the value handed back is the stored row.
  const saveWorkspace = useCallback(async (input: { displayName: string; businessName: string }) => {
    if (!ownerId) throw new Error("Your session has ended. Please sign in again.");
    if (!profile) throw new Error("Your workspace details are still loading. Please try again in a moment.");
    const saved = await repository.updateWorkspace({ ownerId, displayName: input.displayName, businessName: input.businessName, expectedUpdatedAt: profile.updatedAt });
    setProfile(saved);
    return saved;
  }, [ownerId, profile, repository]);

  const value = useMemo<WorkspaceProfileValue>(() => ({ profile, loading, error, setupComplete: isWorkspaceSetupComplete(profile), reload, saveWorkspace }), [error, loading, profile, reload, saveWorkspace]);

  return <WorkspaceProfileContext.Provider value={value}>{children}</WorkspaceProfileContext.Provider>;
}

export function useWorkspaceProfile(): WorkspaceProfileValue {
  const value = useContext(WorkspaceProfileContext);
  if (!value) throw new Error("useWorkspaceProfile must be used within WorkspaceProfileProvider");
  return value;
}
