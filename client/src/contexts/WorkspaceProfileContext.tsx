// Quiet Ledger style reminder: one persisted profile row, read once per session, is
// the only thing this app knows about who is using it. Nothing here consults
// browser storage for identity or setup state.

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
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
  const [profileOwnerId, setProfileOwnerId] = useState("");
  const readVersion = useRef(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const ownerId = user?.id ?? "";

  const reload = useCallback(async () => {
    const version = ++readVersion.current;
    if (!ownerId) {
      setProfile(null);
      setProfileOwnerId("");
      setError("");
      setLoading(false);
      return;
    }
    setLoading(true);
    setError("");
    try {
      const stored = await repository.read(ownerId);
      if (!stored) throw new Error("We could not open your workspace details. Please try signing in again.");
      // A stale read for user A must never overwrite user B's private profile after sign-out
      // and sign-in, even if the old network request finishes after the new one.
      if (version !== readVersion.current) return;
      setProfile(stored);
      setProfileOwnerId(ownerId);
    } catch (caught) {
      if (version === readVersion.current) {
        setError(caught instanceof Error ? caught.message : "We could not open your workspace. Please try again.");
      }
    } finally {
      if (version === readVersion.current) setLoading(false);
    }
  }, [ownerId, repository]);

  useEffect(() => {
    if (!authLoading) void reload();
    return () => { readVersion.current += 1; };
  }, [authLoading, reload]);

  // Never expose another account's cached profile during a session transition.
  const currentProfile = profileOwnerId === ownerId ? profile : null;
  const currentLoading = loading || (!authLoading && Boolean(ownerId) && !error && profileOwnerId !== ownerId);

  // The write carries the token this screen was opened with, exactly like every
  // other edit in the product: a row that moved on in the meantime is refused
  // rather than overwritten, and the value handed back is the stored row.
  const saveWorkspace = useCallback(async (input: { displayName: string; businessName: string }) => {
    if (!ownerId) throw new Error("Your session has ended. Please sign in again.");
    if (!currentProfile) throw new Error("Your workspace details are still loading. Please try again in a moment.");
    const saved = await repository.updateWorkspace({ ownerId, displayName: input.displayName, businessName: input.businessName, expectedUpdatedAt: currentProfile.updatedAt });
    setProfile(saved);
    setProfileOwnerId(ownerId);
    return saved;
  }, [ownerId, currentProfile, repository]);

  const value = useMemo<WorkspaceProfileValue>(() => ({ profile: currentProfile, loading: currentLoading, error, setupComplete: isWorkspaceSetupComplete(currentProfile), reload, saveWorkspace }), [currentProfile, currentLoading, error, reload, saveWorkspace]);

  return <WorkspaceProfileContext.Provider value={value}>{children}</WorkspaceProfileContext.Provider>;
}

export function useWorkspaceProfile(): WorkspaceProfileValue {
  const value = useContext(WorkspaceProfileContext);
  if (!value) throw new Error("useWorkspaceProfile must be used within WorkspaceProfileProvider");
  return value;
}
