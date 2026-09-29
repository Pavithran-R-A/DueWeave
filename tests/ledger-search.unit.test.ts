// Quiet Ledger style reminder: these tests keep ledger search deterministic, whitespace-tolerant, and truthful about cancelled rows.

import { describe, expect, it } from "vitest";
import { countReceivablesByStatus, matchesReceivableQuery, selectClients, selectReceivables } from "@/lib/ledger-search";
import type { ReceivableStatusFilter } from "@/lib/ledger-search";
import type { Client, Receivable } from "@/types/domain";

function makeClient(id: string, overrides: Partial<Client> = {}): Client {
  return { id, name: `Client ${id}`, company: "", createdAt: "2026-09-01T09:00:00Z", updatedAt: "2026-09-01T09:00:00Z", ...overrides };
}

function makeReceivable(id: string, overrides: Partial<Receivable> = {}): Receivable {
  return { id, clientId: "client-a", title: `Invoice ${id}`, invoiceRef: "", amountDuePaise: 500000, outstandingPaise: 500000, dueDate: "2026-09-30", createdAt: "2026-09-01T09:00:00Z", updatedAt: "2026-09-01T09:00:00Z", status: "OPEN", ...overrides };
}

const clients = [makeClient("client-a", { name: "Ananya Sharma", company: "Lotus Post House", email: "ananya@lotus.in", phone: "+91 98200 12345" }), makeClient("client-b", { name: "Bridge Films" })];

const statusFilters: ReceivableStatusFilter[] = ["open", "paid", "cancelled", "all"];

function idsOf(rows: { id: string }[]) {
  return rows.map((row) => row.id);
}

function selected(receivables: Receivable[], filter: ReceivableStatusFilter, query: string) {
  return selectReceivables({ receivables, clients }, { filter, query });
}

describe("ledger search over receivables", () => {
  it("matches receivable titles case-insensitively", () => {
    const receivables = [makeReceivable("r1", { title: "Moonlight Reel Grade" })];
    expect(idsOf(selected(receivables, "all", "moonlight"))).toEqual(["r1"]);
    expect(idsOf(selected(receivables, "all", "MOONLIGHT REEL GRADE"))).toEqual(["r1"]);
    expect(matchesReceivableQuery(receivables[0], clients, "CoLoR")).toBe(false);
  });

  it("collapses query whitespace and compares each searched field the same way", () => {
    const receivables = [makeReceivable("r1", { title: "Moonlight   Reel   Grade" })];
    expect(idsOf(selected(receivables, "all", "  moonlight reel  \tgrade "))).toEqual(["r1"]);
  });

  it("matches the invoice reference", () => {
    const receivables = [makeReceivable("r1", { invoiceRef: "INV-2026-041" }), makeReceivable("r2")];
    expect(idsOf(selected(receivables, "all", "inv-2026"))).toEqual(["r1"]);
  });

  it("matches the owning client name looked up by clientId, not by position", () => {
    const receivables = [makeReceivable("r1", { clientId: "client-a" }), makeReceivable("r2", { clientId: "client-b" })];
    expect(idsOf(selected(receivables, "all", "ananya sharma"))).toEqual(["r1"]);
  });

  it("matches the owning client company", () => {
    const receivables = [makeReceivable("r1", { clientId: "client-a" }), makeReceivable("r2", { clientId: "client-b" })];
    expect(idsOf(selected(receivables, "all", "lotus post house"))).toEqual(["r1"]);
  });

  it("returns the status-filtered list unchanged for an empty query", () => {
    const receivables = [makeReceivable("r1"), makeReceivable("r2", { status: "PAID", outstandingPaise: 0 })];
    expect(idsOf(selected(receivables, "all", ""))).toEqual(["r1", "r2"]);
    expect(idsOf(selected(receivables, "open", ""))).toEqual(["r1"]);
  });

  it("treats a whitespace-only query as no search at all", () => {
    const receivables = [makeReceivable("r1"), makeReceivable("r2", { status: "PAID", outstandingPaise: 0 })];
    expect(idsOf(selected(receivables, "all", "   \t "))).toEqual(["r1", "r2"]);
  });

  it("applies the status filter and the search together", () => {
    const receivables = [makeReceivable("open-moonlight", { title: "Moonlight Grade" }), makeReceivable("paid-moonlight", { title: "Moonlight Retainer", status: "PAID", outstandingPaise: 0 }), makeReceivable("open-sunlight", { title: "Sunlight Grade" })];
    expect(idsOf(selected(receivables, "paid", "moonlight"))).toEqual(["paid-moonlight"]);
    expect(idsOf(selected(receivables, "open", "moonlight"))).toEqual(["open-moonlight"]);
  });

  it("shows cancelled rows under cancelled and under all, so cancel never looks like deletion", () => {
    const receivables = [makeReceivable("r1"), makeReceivable("r2", { status: "CANCELLED", outstandingPaise: 0 })];
    expect(idsOf(selected(receivables, "cancelled", ""))).toEqual(["r2"]);
    expect(idsOf(selected(receivables, "all", ""))).toEqual(["r1", "r2"]);
  });

  it("shows only settled non-cancelled rows under paid", () => {
    const receivables = [makeReceivable("settled", { status: "PAID", outstandingPaise: 0 }), makeReceivable("partly", { status: "PARTIALLY_PAID", outstandingPaise: 100 }), makeReceivable("cancelled-zero", { status: "CANCELLED", outstandingPaise: 0 })];
    expect(idsOf(selected(receivables, "paid", ""))).toEqual(["settled"]);
  });

  it("shows rows with a positive outstanding balance under open, including partially paid ones", () => {
    const receivables = [makeReceivable("open-full"), makeReceivable("open-part", { status: "PARTIALLY_PAID", outstandingPaise: 1 }), makeReceivable("settled", { status: "PAID", outstandingPaise: 0 })];
    expect(idsOf(selected(receivables, "open", ""))).toEqual(["open-full", "open-part"]);
  });

  it("keeps cancelled rows out of open and paid even when the database balance still carries a positive amount", () => {
    const receivables = [makeReceivable("live", { outstandingPaise: 250 }), makeReceivable("cancelled-balance", { status: "CANCELLED", outstandingPaise: 250 })];
    expect(idsOf(selected(receivables, "open", ""))).toEqual(["live"]);
    expect(idsOf(selected(receivables, "paid", ""))).toEqual([]);
    expect(idsOf(selected(receivables, "cancelled", ""))).toEqual(["cancelled-balance"]);
    expect(idsOf(selected(receivables, "all", ""))).toEqual(["live", "cancelled-balance"]);
  });

  it("returns an empty array when nothing matches", () => {
    expect(selected([makeReceivable("r1")], "all", "zzz-nothing")).toEqual([]);
  });

  it("keeps receivables in the order they were loaded", () => {
    const receivables = [makeReceivable("r3"), makeReceivable("r1"), makeReceivable("r2")];
    expect(idsOf(selected(receivables, "all", "invoice"))).toEqual(["r3", "r1", "r2"]);
  });

  it("does not throw when a receivable references a missing client and never matches on absent client fields", () => {
    const receivables = [makeReceivable("orphan", { clientId: "client-gone", title: "Orphaned Session" })];
    expect(() => selected(receivables, "all", "session")).not.toThrow();
    expect(idsOf(selected(receivables, "all", "session"))).toEqual(["orphan"]);
    expect(matchesReceivableQuery(receivables[0], clients, "ananya")).toBe(false);
  });
});

describe("ledger search over clients", () => {
  it("matches client name, company, email and phone case-insensitively", () => {
    expect(idsOf(selectClients(clients, "sharma"))).toEqual(["client-a"]);
    expect(idsOf(selectClients(clients, "LOTUS POST"))).toEqual(["client-a"]);
    expect(idsOf(selectClients(clients, "ANANYA@LOTUS.IN"))).toEqual(["client-a"]);
    expect(idsOf(selectClients(clients, "98200"))).toEqual(["client-a"]);
    expect(idsOf(selectClients(clients, "bridge"))).toEqual(["client-b"]);
  });

  it("returns every client for an empty or whitespace-only query even when optional fields are missing", () => {
    expect(idsOf(selectClients(clients, ""))).toEqual(["client-a", "client-b"]);
    expect(idsOf(selectClients(clients, "  \t "))).toEqual(["client-a", "client-b"]);
  });

  it("never matches fields that have no value, such as undefined email or an empty company", () => {
    expect(selectClients(clients, "undef")).toEqual([]);
    expect(selectClients(clients, "undefined")).toEqual([]);
    expect(selectClients(clients, "email")).toEqual([]);
    expect(selectClients(clients, "phone")).toEqual([]);
  });
});

// Stage 9 PHASE 11: the search box is a public input, and the only honest answer it can
// give is a literal one. These are the shapes that make a filter lie — a wildcard that
// quietly matches the whole ledger, a quote that closes an expression, markup a renderer
// might act on, a query written in the filter language of the API behind the app, a path
// traversal, an escape sequence typed as text, an invisible bidi control, and a query
// long enough to make the page unusable.
const ABUSE_NEEDLES = ["%", "_", "*?", "%_%", "' OR 1=1--", '"; DROP TABLE receivables;--', "<script>alert(1)</script>", "<img src=x onerror=alert(1)>", "or(id.gt.0)", "id=eq.1", "select(*)", "..\\..\\..\\etc\\passwd", "${client.name}", "\\u0000", "‮moonlight", "x".repeat(10_000)];

function describeNeedle(needle: string) {
  return needle.length > 28 ? `${needle.slice(0, 28)}… (${needle.length} characters)` : needle;
}

describe("search abuse strings stay literal filters", () => {
  const receivables = [makeReceivable("r1", { title: "Moonlight Reel Grade", invoiceRef: "INV-2026-041" }), makeReceivable("r2", { title: "Colour Grading", clientId: "client-a" })];

  it("finds nothing for any of them, rather than matching the whole ledger", () => {
    for (const needle of ABUSE_NEEDLES) {
      expect(idsOf(selected(receivables, "all", needle)), `a receivable query of ${describeNeedle(needle)} matched rows`).toEqual([]);
      expect(idsOf(selectClients(clients, needle)), `a client query of ${describeNeedle(needle)} matched clients`).toEqual([]);
    }
  });

  it("never throws, whatever is typed", () => {
    for (const needle of ABUSE_NEEDLES) {
      expect(() => selected(receivables, "all", needle), describeNeedle(needle)).not.toThrow();
      expect(() => selectClients(clients, needle), describeNeedle(needle)).not.toThrow();
    }
  });

  // The control that keeps the two assertions above from being vacuous: a ledger row
  // whose title really does contain `%`, `^`, `*` or `'` has to be found by that query.
  // Without it, "every abuse string returns nothing" would be equally satisfied by a
  // filter that had silently stopped working.
  it("still finds a value that genuinely contains those characters", () => {
    const odd = [makeReceivable("pct", { title: "100% reel ^grade" }), makeReceivable("quote", { title: "O'Brien *shoot*" })];
    const oddClients = [makeClient("c-pct", { name: "50% Deposit" }), makeClient("c-script", { name: "<b>Studio</b>" })];
    expect(idsOf(selected(odd, "all", "%"))).toEqual(["pct"]);
    expect(idsOf(selected(odd, "all", "^"))).toEqual(["pct"]);
    expect(idsOf(selected(odd, "all", "*"))).toEqual(["quote"]);
    expect(idsOf(selected(odd, "all", "'"))).toEqual(["quote"]);
    expect(idsOf(selectClients(oddClients, "%"))).toEqual(["c-pct"]);
    expect(idsOf(selectClients(oddClients, "<b>"))).toEqual(["c-script"]);
  });
});

describe("tab counts agree with the filters", () => {
  const receivables = [makeReceivable("open-1"), makeReceivable("open-2", { status: "PARTIALLY_PAID", outstandingPaise: 100 }), makeReceivable("paid-1", { status: "PAID", outstandingPaise: 0 }), makeReceivable("paid-2", { status: "OPEN", outstandingPaise: 0 }), makeReceivable("cancelled-zero", { status: "CANCELLED", outstandingPaise: 0 }), makeReceivable("cancelled-balance", { status: "CANCELLED", outstandingPaise: 250 })];

  it("counts each bucket exactly as the matching filter selects and sums open, paid and cancelled to all", () => {
    const counts = countReceivablesByStatus(receivables);
    expect(counts).toEqual({ open: 2, paid: 2, cancelled: 2, all: 6 });
    for (const filter of statusFilters) {
      expect(counts[filter], filter).toBe(selected(receivables, filter, "").length);
    }
    expect(counts.open + counts.paid + counts.cancelled).toBe(counts.all);
  });

  it("places every receivable in exactly one of open, paid and cancelled", () => {
    for (const receivable of receivables) {
      const buckets = statusFilters.filter((filter) => filter !== "all" && selected([receivable], filter, "").length === 1);
      expect(buckets, receivable.id).toHaveLength(1);
    }
  });
});
