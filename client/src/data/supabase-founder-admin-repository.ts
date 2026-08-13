import { supabase } from "@/lib/supabase";
import type { FounderClaim, FounderFunnelEvent, PendingFounderClaim } from "@/types/domain";
import { userFacingDataError } from "./supabase-adapters";

type Row = Record<string, unknown>;
const text = (row: Row, key: string) => typeof row[key] === "string" ? row[key] as string : "";
const amount = (row: Row, key: string) => Number.isSafeInteger(Number(row[key])) ? Number(row[key]) : 0;

function toClaim(row: Row): FounderClaim {
  return { id: text(row, "id"), claimId: text(row, "claim_id"), plan: "FOUNDER", amountPaise: amount(row, "amount_paise"), payerName: text(row, "payer_name"), utrReference: text(row, "utr_reference"), status: text(row, "status") as FounderClaim["status"], submittedAt: text(row, "submitted_at") || undefined, reviewedAt: text(row, "reviewed_at") || undefined, createdAt: text(row, "created_at") };
}

export class SupabaseFounderAdminRepository {
  async listPending() {
    const { data, error } = await supabase.rpc("list_pending_founder_claims");
    if (error) throw new Error(userFacingDataError(error.message));
    return ((data ?? []) as Row[]).map((row): PendingFounderClaim => ({ claimId: text(row, "claim_id"), ownerId: text(row, "owner_id"), ownerEmail: text(row, "owner_email"), payerName: text(row, "payer_name"), utrReference: text(row, "utr_reference"), amountPaise: amount(row, "amount_paise"), submittedAt: text(row, "submitted_at") }));
  }

  async funnel() {
    const { data, error } = await supabase.rpc("get_founder_funnel");
    if (error) throw new Error(userFacingDataError(error.message));
    return ((data ?? []) as Row[]).map((row): FounderFunnelEvent => ({ eventName: text(row, "event_name") as FounderFunnelEvent["eventName"], eventCount: amount(row, "event_count") }));
  }

  async approve(claimId: string) {
    const { data, error } = await supabase.rpc("approve_founder_claim", { p_claim_id: claimId });
    if (error) throw new Error(userFacingDataError(error.message));
    return toClaim(data as Row);
  }

  async reject(claimId: string, reason: string) {
    const { data, error } = await supabase.rpc("reject_founder_claim", { p_claim_id: claimId, p_reason: reason });
    if (error) throw new Error(userFacingDataError(error.message));
    return toClaim(data as Row);
  }

  async revoke(userId: string, reason: string) {
    const { error } = await supabase.rpc("revoke_founder_entitlement", { p_user_id: userId, p_reason: reason });
    if (error) throw new Error(userFacingDataError(error.message));
  }
}
