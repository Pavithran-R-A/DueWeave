// Fetch all owner-visible rows. PostgREST/Supabase cap a single request (normally at 1,000
// rows). An incomplete read must never masquerade as a complete financial ledger or export.
// All callers order by a unique ID after their business sort key for stable page boundaries.
import { userFacingDataError } from "./supabase-adapters";

export const PAGE_SIZE = 500;
type PageResult<T> = { data: T[] | null; error: { message: string; code?: string } | null };

export async function collectAllRows<T>(
  fetchPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await fetchPage(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(userFacingDataError(error.message, error.code));
    if (!Array.isArray(data)) throw new Error("DueWeave could not load the complete ledger. Try again.");
    rows.push(...data);
    if (data.length < PAGE_SIZE) return rows;
  }
}
