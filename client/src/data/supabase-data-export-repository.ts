import { supabase } from "@/lib/supabase";
import type { ExportSnapshot } from "@/lib/data-export";
import { userFacingDataError } from "./supabase-adapters";
import { collectAllRows } from "./pagination";

type Row = Record<string, unknown>;

// An archive has to carry what the database holds, not what a screen projects: the
// exact columns, a timestamp down to the microsecond, integer paise, and the
// promise-event rows the Today view never shows. So this seam reads plain rows and
// deliberately avoids the domain adapters — `toActivity()` would flatten a moment
// into a business date, and `SupabaseDashboardRepository` belongs to a screen that
// settles overdue promises on its way out. Pressing "download" must not change a
// ledger, so nothing here calls insert, update, delete or rpc.
const COLUMNS = {
  profile: "id, display_name, business_name, plan, timezone, currency, created_at, updated_at",
  clients: "id, owner_id, name, company, phone, email, notes, archived_at, created_at, updated_at",
  receivables: "id, owner_id, client_id, label, invoice_ref, amount_due_paise, outstanding_paise, due_date, notes, status, created_at, updated_at",
  promises: "id, owner_id, receivable_id, sequence_no, promised_amount_paise, made_on, promised_date, source, note, status, created_at, resolved_at, updated_at, request_id",
  payments: "id, owner_id, receivable_id, amount_paise, paid_on, method, reference, note, created_at, request_id",
  activities: "id, owner_id, client_id, receivable_id, promise_id, type, occurred_at, note, amount_paise, created_at, metadata",
  promiseEvents: "id, owner_id, promise_id, receivable_id, from_status, to_status, reason, actor_type, occurred_at, created_at, metadata",
  entitlement: "id, user_id, plan, status, source, activated_at, reviewed_by, reviewed_at, updated_at",
  purchaseClaims: "id, owner_id, claim_id, plan, payer_name, utr_reference, amount_paise, status, submitted_at, verified_at, reviewed_at, reviewed_by, review_note, created_at, updated_at",
  analyticsEvents: "id, owner_id, event_name, entity_type, entity_id, occurred_at, metadata",
} as const;

function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

function nullableText(value: unknown) {
  const result = text(value);
  return result || null;
}

// Bigint columns can arrive as either a number or a digit string; the archive must
// hold an integer either way, never a rounded float.
function paise(value: unknown) {
  if (value === null || value === undefined) return null;
  const result = Number(value);
  return Number.isSafeInteger(result) ? result : null;
}

function integer(value: unknown) {
  return paise(value) ?? 0;
}

function json(value: unknown): Row | null {
  return value && typeof value === "object" ? (value as Row) : null;
}

// The archive is assembled from plain SELECTs, so the helpers below only have to
// be honest about a read: an error is fatal, and rows arrive as raw records.
type ReadResult = { data: unknown; error: { message: string; code?: string } | null };

async function listOf<T>(query: (from: number, to: number) => PromiseLike<ReadResult>, map: (row: Row) => T): Promise<T[]> {
  const rows = await collectAllRows<Row>(async (from, to) => {
    const { data, error } = await query(from, to);
    return { data: data as Row[] | null, error };
  });
  return rows.map(map);
}

async function single(query: PromiseLike<ReadResult>): Promise<Row | null> {
  const { data, error } = await query;
  if (error) throw new Error(userFacingDataError(error.message, error.code));
  return (data as Row | null) ?? null;
}

export class SupabaseDataExportRepository {
  async read(): Promise<ExportSnapshot> {
    const { data, error } = await supabase.auth.getSession();
    if (error || !data.session) throw new Error("Your session has ended. Please sign in again.");

    const [profile, clients, receivables, promises, payments, activities, promiseEvents, entitlement, purchaseClaims, analyticsEvents] = await Promise.all([
      single(supabase.from("profiles").select(COLUMNS.profile).maybeSingle()),
      listOf((from, to) => supabase.from("clients").select(COLUMNS.clients).order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, to), (row) => ({ id: text(row.id), owner_id: text(row.owner_id), name: text(row.name), company: text(row.company), phone: nullableText(row.phone), email: nullableText(row.email), notes: nullableText(row.notes), archived_at: nullableText(row.archived_at), created_at: text(row.created_at), updated_at: text(row.updated_at) })),
      listOf((from, to) => supabase.from("receivables").select(COLUMNS.receivables).order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, to), (row) => ({ id: text(row.id), owner_id: text(row.owner_id), client_id: text(row.client_id), label: text(row.label), invoice_ref: nullableText(row.invoice_ref), amount_due_paise: paise(row.amount_due_paise) ?? 0, outstanding_paise: paise(row.outstanding_paise) ?? 0, due_date: text(row.due_date), notes: nullableText(row.notes), status: text(row.status), created_at: text(row.created_at), updated_at: text(row.updated_at) })),
      listOf((from, to) => supabase.from("promises").select(COLUMNS.promises).order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, to), (row) => ({ id: text(row.id), owner_id: text(row.owner_id), receivable_id: text(row.receivable_id), sequence_no: integer(row.sequence_no), promised_amount_paise: paise(row.promised_amount_paise) ?? 0, made_on: text(row.made_on), promised_date: text(row.promised_date), source: text(row.source), note: nullableText(row.note), status: text(row.status), created_at: text(row.created_at), resolved_at: nullableText(row.resolved_at), updated_at: text(row.updated_at), request_id: nullableText(row.request_id) })),
      listOf((from, to) => supabase.from("payments").select(COLUMNS.payments).order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, to), (row) => ({ id: text(row.id), owner_id: text(row.owner_id), receivable_id: text(row.receivable_id), amount_paise: paise(row.amount_paise) ?? 0, paid_on: text(row.paid_on), method: text(row.method), reference: nullableText(row.reference), note: nullableText(row.note), created_at: text(row.created_at), request_id: nullableText(row.request_id) })),
      listOf((from, to) => supabase.from("activities").select(COLUMNS.activities).order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, to), (row) => ({ id: text(row.id), owner_id: text(row.owner_id), client_id: nullableText(row.client_id), receivable_id: nullableText(row.receivable_id), promise_id: nullableText(row.promise_id), type: text(row.type), occurred_at: text(row.occurred_at), note: nullableText(row.note), amount_paise: paise(row.amount_paise), created_at: text(row.created_at), metadata: json(row.metadata) })),
      listOf((from, to) => supabase.from("promise_events").select(COLUMNS.promiseEvents).order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, to), (row) => ({ id: text(row.id), owner_id: text(row.owner_id), promise_id: text(row.promise_id), receivable_id: text(row.receivable_id), from_status: nullableText(row.from_status), to_status: text(row.to_status), reason: text(row.reason), actor_type: text(row.actor_type), occurred_at: text(row.occurred_at), created_at: text(row.created_at), metadata: json(row.metadata) })),
      single(supabase.from("entitlements").select(COLUMNS.entitlement).maybeSingle()),
      listOf((from, to) => supabase.from("purchase_claims").select(COLUMNS.purchaseClaims).order("created_at", { ascending: true }).order("id", { ascending: true }).range(from, to), (row) => ({ id: text(row.id), owner_id: text(row.owner_id), claim_id: text(row.claim_id), plan: text(row.plan), payer_name: text(row.payer_name), utr_reference: text(row.utr_reference), amount_paise: paise(row.amount_paise) ?? 0, status: text(row.status), submitted_at: nullableText(row.submitted_at), verified_at: nullableText(row.verified_at), reviewed_at: nullableText(row.reviewed_at), reviewed_by: nullableText(row.reviewed_by), review_note: nullableText(row.review_note), created_at: text(row.created_at), updated_at: text(row.updated_at) })),
      listOf((from, to) => supabase.from("analytics_events").select(COLUMNS.analyticsEvents).order("occurred_at", { ascending: true }).order("id", { ascending: true }).range(from, to), (row) => ({ id: text(row.id), owner_id: nullableText(row.owner_id), event_name: text(row.event_name), entity_type: nullableText(row.entity_type), entity_id: nullableText(row.entity_id), occurred_at: text(row.occurred_at), metadata: json(row.metadata) })),
    ]);

    return {
      profile: profile ? { id: text(profile.id), display_name: text(profile.display_name), business_name: text(profile.business_name), plan: text(profile.plan), timezone: text(profile.timezone), currency: text(profile.currency), created_at: text(profile.created_at), updated_at: text(profile.updated_at) } : null,
      email: data.session.user.email ?? null,
      clients,
      receivables,
      promises,
      payments,
      activities,
      promiseEvents,
      entitlement: entitlement ? { id: text(entitlement.id), user_id: text(entitlement.user_id), plan: text(entitlement.plan), status: text(entitlement.status), source: text(entitlement.source), activated_at: nullableText(entitlement.activated_at), reviewed_by: nullableText(entitlement.reviewed_by), reviewed_at: nullableText(entitlement.reviewed_at), updated_at: text(entitlement.updated_at) } : null,
      purchaseClaims,
      analyticsEvents,
    };
  }
}
