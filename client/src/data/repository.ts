// Quiet Ledger style reminder: keep the prototype calm and local while giving future persistence a clean seam.

import type { DemoState } from "@/types/domain";

export interface DueWeaveRepository {
  read(): DemoState;
  write(next: DemoState): void;
}

/**
 * Local in-memory repository used by Stage 1.
 * A future Supabase adapter can implement the same read/write seam without
 * scattering database calls through the React view layer.
 */
export function createLocalRepository(initialState: DemoState): DueWeaveRepository {
  let snapshot = structuredClone(initialState);

  return {
    read: () => structuredClone(snapshot),
    write: (next) => {
      snapshot = structuredClone(next);
    },
  };
}
