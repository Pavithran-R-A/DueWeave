import { describe, expect, it } from "vitest";
import { getLastContacted } from "@/lib/finance";
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
    const promise = toPromise({ id: "pr1", receivable_id: "r1", promised_amount_paise: "25050", made_on: "2026-08-11", promised_date: "2026-08-15", source: "WHATSAPP", note: null, status: "ACTIVE", created_at: "2026-08-12T10:00:00Z" });

    expect(receivable).toMatchObject({ amountDuePaise: 125050, outstandingPaise: 25050, status: "PARTIALLY_PAID" });
    expect(payment).toMatchObject({ amountPaise: 100000, method: "Bank transfer" });
    expect(promise).toMatchObject({ promisedAmountPaise: 25050, source: "WhatsApp", status: "ACTIVE" });
  });

  // A promise now carries three dates and they answer three different questions:
  // when the customer said it (made_on), when they said it would arrive
  // (promised_date), and when DueWeave happened to store the row (created_at).
  // Only the first two decide attribution, so the adapter must not blend any of
  // them into another — the repair this replaces was exactly a blend of the
  // third into the first.
  it("keeps the day a promise was made apart from its deadline and its recording instant", () => {
    const promise = toPromise({ id: "pr1", receivable_id: "r1", sequence_no: 1, promised_amount_paise: "500000", made_on: "2026-09-20", promised_date: "2026-09-25", source: "CALL", note: null, status: "KEPT", created_at: TOKEN, resolved_at: TOKEN });

    expect(promise.madeOn).toBe("2026-09-20");
    expect(promise.promisedDate).toBe("2026-09-25");
    expect(promise.createdAt).toBe(TOKEN);
    expect(promise.madeOn).not.toBe(promise.promisedDate);
  });

  // The form must show the customer's date, not a date the client invented, so a
  // row that arrives without one reads as missing rather than as its deadline.
  it("never derives a missing origin from the promised date or the recording instant", () => {
    const row = { id: "pr2", receivable_id: "r1", sequence_no: 1, promised_amount_paise: "500000", promised_date: "2026-09-25", source: "CALL", note: null, status: "ACTIVE", created_at: TOKEN };
    expect(toPromise(row).madeOn).toBe("");
  });

  it("converts activity timestamps into the date-only format consumed by the approved timeline", () => {
    const activity = toActivity({ id: "a1", client_id: "c1", receivable_id: "r1", promise_id: null, type: "PAYMENT_RECORDED", occurred_at: "2026-08-12T10:30:00.000Z", note: "Payment recorded", amount_paise: "5000" });
    expect(activity).toMatchObject({ type: "payment", occurredAt: "2026-08-12", amountPaise: 5000 });
  });

  // Slicing the UTC string puts every evening entry one day early for a ledger
  // whose business day is defined in Kolkata.
  it("files an evening instant under the India business day it happened in", () => {
    const activity = toActivity({ id: "a2", client_id: "c1", receivable_id: "r1", promise_id: null, type: "NOTE_ADDED", occurred_at: "2026-09-24T20:15:00.000Z", note: "Left a voicemail" });
    expect(activity.occurredAt).toBe("2026-09-25");
  });

  it("keeps each recorded outcome distinguishable in the timeline", () => {
    const kindFor = (type: string) => toActivity({ id: "a3", client_id: "c1", receivable_id: "r1", promise_id: null, type, occurred_at: "2026-08-12T10:30:00.000Z", note: "x" }).type;
    expect(kindFor("PROMISE_STATUS_CHANGED")).toBe("outcome");
    expect(kindFor("PROMISE_CORRECTED")).toBe("corrected");
    expect(kindFor("PROMISE_CANCELLED")).toBe("cancelled");
    expect(kindFor("RECEIVABLE_CANCELLED")).toBe("cancelled");
    expect(kindFor("SNOOZED")).toBe("snoozed");
    expect(kindFor("FOLLOW_UP_RECORDED")).toBe("contacted");
  });

  // A snooze is a decision to wait, not a conversation: if it reads as contact
  // the queue stops nagging about a receivable nobody has actually chased.
  it("does not let a snoozed follow-up read as contact with the client", () => {
    const snoozed = toActivity({ id: "a4", client_id: "c1", receivable_id: "r1", promise_id: null, type: "SNOOZED", occurred_at: "2026-08-12T10:30:00.000Z", note: "Snoozed until Friday", metadata: { snoozed_until: "2026-08-14" } });
    expect(snoozed.snoozedUntil).toBe("2026-08-14");
    expect(getLastContacted("r1", [snoozed])).toBeUndefined();
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

  it("answers a lifecycle refusal in the ledger's own language", () => {
    const cases: Array<[string, RegExp]> = [
      ["A payment cannot be dated in the future", /cannot be dated in the future/i],
      ["Payment must be within the remaining balance", /remaining balance/i],
      ["Promised amount must be within the remaining balance", /remaining balance/i],
      ["That request id already recorded a different payment", /does not match what was already saved/i],
      ["That request id already recorded a different promise", /does not match what was already saved/i],
      ["A receivable with recorded payments cannot be cancelled", /payments have been recorded/i],
      ["Only a promise that has not reached its outcome can be withdrawn", /already has its outcome/i],
      ["This promise is already cancelled", /already been withdrawn/i],
      ["This receivable is already cancelled", /already closed/i],
      ["A cancelled receivable does not accept payments", /already closed/i],
      ["A promise cannot be added to a closed receivable", /already closed/i],
      ["This receivable is already settled", /fully paid/i],
      ["A settled receivable cannot be cancelled — cancel the promise instead, or record a correction", /fully paid/i],
      ["This promise needs a request id so a retry cannot record it twice", /could not be recorded safely/i],
      ["Choose the date the customer made this promise", /date the customer made/i],
      ["The promise date cannot be earlier than the day the promise was made", /cannot be earlier than the day the promise was made/i],
      ["A new promise cannot be dated as made before the promise it replaces", /on or after|promise it replaces/i],
      ["DueWeave keeps one business calendar for the ledger, so the working day cannot be moved", /single working calendar/i],
      ["DueWeave records money in INR only", /rupees/i],
      ["Financial fields require a protected workflow", /could not be recorded safely/i],
      ["Receivable is not available for this account", /not available in this private ledger/i],
    ];
    for (const [raw, expected] of cases) {
      const message = userFacingDataError(raw);
      expect(message, `the database said "${raw}"`).toMatch(expected);
      expect(message, `the database said "${raw}"`).not.toMatch(/SQLSTATE|permission denied|constraint|function|public\.|raise_exception/i);
    }
  });

  // Both a payment and a promise can be dated wrongly, and the advice differs:
  // one says the receipt is from tomorrow, the other that nobody can commit on
  // the customer's behalf in advance. Sharing the sentence would send the reader
  // to the wrong field of the wrong form.
  it("answers a future-dated promise origin as a promise, not as a payment", () => {
    const message = userFacingDataError("A promise cannot be dated as made in the future");
    expect(message).toMatch(/promise/i);
    expect(message).toMatch(/future/i);
    expect(message).not.toMatch(/payment|receipt/i);
    expect(userFacingDataError("A payment cannot be dated in the future")).toMatch(/payment/i);
  });

  it("keeps a server-side refusal in the calm fallback instead of quoting it", () => {
    for (const raw of ["permission denied for table clients", "new row violates row-level security policy for table \"receivables\"", "duplicate key value violates unique constraint \"clients_pkey\""]) {
      const message = userFacingDataError(raw, "42501");
      expect(message).not.toMatch(/permission denied|row-level security|duplicate key|constraint|table /i);
      expect(message.length).toBeGreaterThan(0);
    }
  });
});
