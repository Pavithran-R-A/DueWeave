import { supabase } from "@/lib/supabase";
import type { FounderClaim, FounderEntitlement, FounderOffer } from "@/types/domain";
import { userFacingDataError } from "./supabase-adapters";

type Row = Record<string, unknown>;

function text(row: Row, key: string) { return typeof row[key] === "string" ? row[key] as string : ""; }
function optionalText(row: Row, key: string) { const value = text(row, key); return value || undefined; }
function amount(row: Row, key: string) { const value = Number(row[key]); return Number.isSafeInteger(value) ? value : 0; }

function toOffer(row: Row): FounderOffer {
  const status = text(row, "payment_destination_status");
  return {
    amountPaise: amount(row, "amount_paise"),
    founderCap: amount(row, "founder_cap"),
    availableSpots: amount(row, "available_spots"),
    payeeName: text(row, "payee_name"),
    upiId: optionalText(row, "upi_id"),
    paymentDestinationStatus: status === "TEST" || status === "LIVE" ? status : "PLACEHOLDER",
    supportContact: text(row, "support_contact"),
    supportContactStatus: text(row, "support_contact_status") === "CONFIGURED" ? "CONFIGURED" : "PENDING",
    refundPolicyStatus: text(row, "refund_policy_status") === "APPROVED" ? "APPROVED" : "PENDING_APPROVAL",
    refundPolicyText: optionalText(row, "refund_policy_text"),
    disclosuresStatus: text(row, "disclosures_status") === "APPROVED" ? "APPROVED" : "PENDING",
    reviewWindowCopy: text(row, "review_window_copy"),
    enabled: row.enabled === true,
  };
}

function toClaim(row: Row): FounderClaim {
  return {
    id: text(row, "id"), claimId: text(row, "claim_id"), plan: "FOUNDER", amountPaise: amount(row, "amount_paise"),
    payerName: text(row, "payer_name"), utrReference: text(row, "utr_reference"), status: text(row, "status") as FounderClaim["status"],
    submittedAt: optionalText(row, "submitted_at"), reviewedAt: optionalText(row, "reviewed_at"), createdAt: text(row, "created_at"),
  };
}

function toEntitlement(row: Row | null): FounderEntitlement {
  if (!row) return { plan: "FREE", status: "ACTIVE" };
  return {
    plan: text(row, "plan") === "FOUNDER" ? "FOUNDER" : "FREE",
    status: text(row, "status") as FounderEntitlement["status"],
    activatedAt: optionalText(row, "activated_at"),
    reviewedAt: optionalText(row, "reviewed_at"),
  };
}

export class SupabaseFounderRepository {
  async getOffer() {
    const { data, error } = await supabase.rpc("get_founder_offer");
    if (error) throw new Error(userFacingDataError(error.message));
    const row = Array.isArray(data) ? data[0] : data;
    if (!row || typeof row !== "object") throw new Error("The Founder offer is unavailable right now.");
    return toOffer(row as Row);
  }

  async getClaim() {
    const { data, error } = await supabase.from("purchase_claims")
      .select("id, claim_id, plan, amount_paise, payer_name, utr_reference, status, submitted_at, reviewed_at, created_at")
      .order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (error) throw new Error(userFacingDataError(error.message));
    return data ? toClaim(data as Row) : undefined;
  }

  async getEntitlement() {
    const { data, error } = await supabase.from("entitlements")
      .select("plan, status, activated_at, reviewed_at").maybeSingle();
    if (error) throw new Error(userFacingDataError(error.message));
    return toEntitlement(data as Row | null);
  }

  async getAccountState() {
    const [offer, claim, entitlement] = await Promise.all([this.getOffer(), this.getClaim(), this.getEntitlement()]);
    return { offer, claim, entitlement };
  }

  async recordUpgradeView() {
    const { error } = await supabase.rpc("record_founder_upgrade_view");
    if (error) throw new Error(userFacingDataError(error.message));
  }

  async createClaim() {
    const { data, error } = await supabase.rpc("create_founder_claim");
    if (error) throw new Error(userFacingDataError(error.message));
    return toClaim(data as Row);
  }

  async submitPayment(claimId: string, utrReference: string, payerName: string) {
    const { data, error } = await supabase.rpc("submit_founder_payment", { p_claim_id: claimId, p_utr_reference: utrReference, p_payer_name: payerName });
    if (error) throw new Error(userFacingDataError(error.message));
    return toClaim(data as Row);
  }

  async cancelClaim(claimId: string) {
    const { data, error } = await supabase.rpc("cancel_founder_claim", { p_claim_id: claimId });
    if (error) throw new Error(userFacingDataError(error.message));
    return toClaim(data as Row);
  }
}
