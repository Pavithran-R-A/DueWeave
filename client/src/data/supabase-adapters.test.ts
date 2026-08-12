import { describe, expect, it } from "vitest";
import { toActivity, toPayment, toPromise, toReceivable } from "./supabase-adapters";

describe("Supabase domain adapters", () => {
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
});
