import { describe, expect, it } from "vitest";
import { toActivity, toClient, toPayment, toPromise, toReceivable, userFacingDataError } from "./supabase-adapters";

// The optimistic-concurrency token is a Postgres `timestamptz` rendered with
// microsecond precision. Anything that re-parses it through `new Date()`
// truncates to milliseconds and the next edit would then be rejected as stale,
// so the adapters must hand the raw database string straight through.
const TOKEN = "2026-09-25T21:25:25.847824+00:00";

describe("Supabase domain adapters", () => {
  it("carries the raw database timestamp as the edit concurrency token", () => {
    const client = toClient({ id: "c1", name: "Northwind", company: "", phone: null, email: null, notes: null, created_at: "2026-08-01T10:00:00Z", updated_at: TOKEN });
    const receivable = toReceivable({ id: "r1", client_id: "c1", label: "Invoice", invoice_ref: null, amount_due_paise: "125050", outstanding_paise: "25050", due_date: "2026-08-12", notes: null, status: "PARTIALLY_PAID", created_at: "2026-08-01T10:00:00Z", updated_at: TOKEN });

    expect(client.updatedAt).toBe(TOKEN);
    expect(receivable.updatedAt).toBe(TOKEN);
    expect(client.updatedAt).not.toBe(new Date(TOKEN).toISOString());
  });

  it("preserves integer paise amounts and normalizes database enum values", () => {
    const receivable = toReceivable({ id: "r1", client_id: "c1", label: "Invoice", invoice_ref: null, amount_due_paise: "125050", outstanding_paise: "25050", due_date: "2026-08-12", notes: null, status: "PARTIALLY_PAID" });
    const payment = toPayment({ id: "p1", receivable_id: "r1", amount_paise: "100000", paid_on: "2026-08-12", method: "BANK_TRANSFER", reference: null });
    const promise = toPromise({ id: "pr1", receivable_id: "r1", promised_amount_paise: "25050", promised_date: "2026-08-15", source: "WHATSAPP", note: null, status: "ACTIVE", created_at: "2026-08-12T10:00:00Z" });

    expect(receivable).toMatchObject({ amountDuePaise: 125050, outstandingPaise: 25050, status: "PARTIALLY_PAID" });
    expect(payment).toMatchObject({ amountPaise: 100000, method: "Bank transfer" });
    expect(promise).toMatchObject({ promisedAmountPaise: 25050, source: "WhatsApp", status: "ACTIVE" });
  });

  it("converts activity timestamps into the date-only format consumed by the approved timeline", () => {
    const activity = toActivity({ id: "a1", client_id: "c1", receivable_id: "r1", promise_id: null, type: "PAYMENT_RECORDED", occurred_at: "2026-08-12T10:30:00.000Z", note: "Payment recorded", amount_paise: "5000" });
    expect(activity).toMatchObject({ type: "payment", occurredAt: "2026-08-12", amountPaise: 5000 });
  });

  it("explains the database-enforced Free-plan limit without exposing raw database details", () => {
    expect(userFacingDataError("Free plan allows at most three active receivables")).toBe("Your Free plan allows up to three active receivables. Close or settle one before adding another.");
  });

  it("names a lost edit conflict as a conflict instead of a generic failure", () => {
    const message = userFacingDataError("This client changed in another session", "40001");
    expect(message).toMatch(/changed|another session/i);
    expect(message).toMatch(/reopen|reload|latest/i);
    expect(message).not.toMatch(/40001|SQLSTATE|transaction_abort/i);
  });

  it("keeps a server-side refusal in the calm fallback instead of quoting it", () => {
    for (const raw of ["permission denied for table clients", "new row violates row-level security policy for table \"receivables\"", "duplicate key value violates unique constraint \"clients_pkey\""]) {
      const message = userFacingDataError(raw, "42501");
      expect(message).not.toMatch(/permission denied|row-level security|duplicate key|constraint|table /i);
      expect(message.length).toBeGreaterThan(0);
    }
  });
});
