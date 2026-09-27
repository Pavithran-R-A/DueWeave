import { describe, expect, it, vi } from "vitest";

// Stage 6 Phase 19: every mutation in the app ends in a toast or an inline message
// built from `error.message`. That is only safe if each repository turns the
// provider's words into the product's words before throwing. These cases drive the
// real repository code against a provider that answers with the raw text PostgREST
// and Postgres actually produce, and assert that none of it survives the trip.

type RawError = { message: string; code?: string };

const { state, supabaseMock } = vi.hoisted(() => {
  const state: { error: RawError } = { error: { message: "" } };
  const payload = () => ({ data: null, error: { ...state.error }, count: null });
  // A PostgREST query builder is a chain of calls that is awaited at the end, so
  // every step hands back itself and the await hands back the failure.
  const chain: unknown = new Proxy({}, {
    get(_target, property) {
      if (property === "then") return (resolve: (value: unknown) => void) => resolve(payload());
      return () => chain;
    },
  });
  return {
    state,
    supabaseMock: {
      rpc: async () => payload(),
      from: () => chain,
      auth: { getSession: async () => ({ data: { session: { user: { id: "7f0f0e3c-3f5e-4d2a-9b41-0d6d1f1a2b3c" } } }, error: null }) },
    },
  };
});

vi.mock("@/lib/supabase", () => ({ supabase: supabaseMock }));

const { SupabaseActivityRepository } = await import("@/data/supabase-activity-repository");
const { SupabaseClientRepository } = await import("@/data/supabase-client-repository");
const { SupabaseDashboardRepository } = await import("@/data/supabase-dashboard-repository");
const { SupabasePaymentRepository } = await import("@/data/supabase-payment-repository");
const { SupabaseProfileRepository } = await import("@/data/supabase-profile-repository");
const { SupabasePromiseRepository } = await import("@/data/supabase-promise-repository");
const { SupabaseReceivableRepository } = await import("@/data/supabase-receivable-repository");

const OWNER = "7f0f0e3c-3f5e-4d2a-9b41-0d6d1f1a2b3c";
const ROW = "7f0f0e3c-3f5e-4d2a-9b41-0d6d1f1a2b3d";
const TOKEN = "2026-09-24T09:00:00.000Z";

const clients = new SupabaseClientRepository();
const receivables = new SupabaseReceivableRepository();
const promises = new SupabasePromiseRepository();
const payments = new SupabasePaymentRepository();
const activities = new SupabaseActivityRepository();
const profile = new SupabaseProfileRepository();
const dashboard = new SupabaseDashboardRepository();

// Every screen-facing mutation and read, named the way a user would meet it.
const operations: Array<{ label: string; run: () => Promise<unknown> }> = [
  { label: "clients list", run: () => clients.list() },
  { label: "client create", run: () => clients.create({ name: "Meera Textiles" }) },
  { label: "client update", run: () => clients.update({ id: ROW, name: "Meera Textiles", expectedUpdatedAt: TOKEN }) },
  { label: "receivables list", run: () => receivables.list() },
  { label: "receivable with client create", run: () => receivables.createWithClient({ clientName: "Meera Textiles", company: "", receivableLabel: "Brand film", amountPaise: 180_000, dueDate: "2026-10-20", invoiceRef: "INV-9", phone: "", email: "", notes: "" }) },
  { label: "receivable for client create", run: () => receivables.createForClient({ clientId: ROW, label: "Brand film", amountPaise: 180_000, dueDate: "2026-10-20" }) },
  { label: "receivable cancel", run: () => receivables.cancel(ROW, "Client asked us to pause this.") },
  { label: "receivable details update", run: () => receivables.updateDetails({ id: ROW, label: "Brand film revised", expectedUpdatedAt: TOKEN }) },
  { label: "promises list", run: () => promises.list() },
  { label: "promise create", run: () => promises.create({ receivableId: ROW, amountPaise: 90_000, madeOn: "2026-09-20", promisedDate: "2026-09-30", source: "Call", note: "", requestId: ROW }) },
  { label: "promise withdraw", run: () => promises.cancel(ROW, "Recorded against the wrong invoice.") },
  { label: "promise settlement", run: () => promises.markDuePromisesBroken() },
  { label: "payments list", run: () => payments.list() },
  { label: "payment record", run: () => payments.record({ receivableId: ROW, amountPaise: 50_000, paidOn: "2026-09-22", method: "UPI", reference: "UTR-9", requestId: ROW }) },
  { label: "activities list", run: () => activities.list() },
  { label: "follow-up record", run: () => activities.recordContacted(ROW) },
  { label: "follow-up snooze", run: () => activities.snooze(ROW, "2026-10-05") },
  { label: "profile read", run: () => profile.read(OWNER) },
  { label: "profile update", run: () => profile.updateWorkspace({ ownerId: OWNER, displayName: "Meera", businessName: "Meera Textiles", expectedUpdatedAt: TOKEN }) },
  { label: "dashboard read", run: () => dashboard.read() },
  { label: "dashboard settlement", run: () => dashboard.settleDuePromises() },
];

// Real provider strings, including the codes the brief names, in the shapes
// PostgREST and Postgres actually send.
const rawFailures: Array<{ label: string; error: RawError }> = [
  { label: "unique violation", error: { code: "23505", message: 'duplicate key value violates unique constraint "payments_request_id_key"', details: 'Key (request_id)=(7f0f0e3c-3f5e-4d2a-9b41-0d6d1f1a2b3d) already exists.' } },
  { label: "check constraint", error: { code: "23514", message: 'new row for relation "receivables" violates check constraint "receivables_amount_due_paise_check"' } },
  { label: "row security", error: { code: "42501", message: 'new row violates row-level security policy for table "clients"' } },
  { label: "missing function", error: { code: "PGRST202", message: 'Could not find the function public.create_client(p_name) in the schema cache' } },
  { label: "raise exception", error: { code: "P0002", message: 'raise_exception: the client name cannot be blank' } },
  { label: "serialization", error: { code: "40001", message: "could not serialize access due to concurrent update" } },
  { label: "expired token", error: { code: "PGRST301", message: "JWSError JWSInvalidSignature" } },
  { label: "network", error: { message: "Failed to fetch" } },
  { label: "internal", error: { code: "XX000", message: 'internal error: null value in column "owner_id" of relation "clients" violates not-null constraint' } },
  { label: "unexpected", error: {} },
];

const technicalLanguage = /PGRST|SQLSTATE|JWSError|JWT|row-level|not-null|check constraint|unique constraint|violates|relation "|public\.|raise_exception|schema cache|new row|duplicate key|\b2350[45]\b|\b23514\b|\b42501\b|\b40001\b|\bP0002\b|owner_id|request_id/i;

describe("Stage 6 user-facing error copy", () => {
  for (const failure of rawFailures) {
    it(`keeps a ${failure.label} failure in the product's own words on every ledger operation`, async () => {
      state.error = failure.error;
      for (const operation of operations) {
        const message = await operation.run().then(
          () => "",
          (error: unknown) => (error instanceof Error ? error.message : String(error))
        );
        expect(message, `${operation.label} saw "${failure.error.message}"`).not.toBe("");
        expect(message, `${operation.label} saw "${failure.error.message}"`).not.toMatch(technicalLanguage);
        if (failure.error.message) expect(message, operation.label).not.toContain(failure.error.message);
      }
    });
  }

  it("sends the known categories to a message the reader can act on", async () => {
    const cases: Array<[RawError, RegExp]> = [
      [{ message: "fetch failed" }, /could not reach dueweave/i],
      [{ code: "40001", message: "could not serialize access due to concurrent update" }, /changed while you were editing/i],
      [{ message: "JWT expired" }, /expired|sign in again/i],
      [{ message: "Free plan allows at most three active receivables" }, /free plan allows up to three/i],
      [{ code: "23505", message: 'duplicate key value violates unique constraint "clients_pkey"' }, /could not save that change/i],
    ];
    for (const [error, expected] of cases) {
      state.error = error;
      await expect(clients.create({ name: "Meera Textiles" })).rejects.toThrow(expected);
    }
  });
});
