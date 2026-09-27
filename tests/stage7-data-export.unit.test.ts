// Stage 7's second half is portability: everything an owner can see, handed back as
// a file they can actually open ten years from now. The rules below are the ones a
// spreadsheet or a future importer will judge us by, so they are written as pure
// tests over plain data rather than through a browser.

import { describe, expect, it } from "vitest";
import {
  buildExportBundle,
  csvFor,
  encodeCsv,
  exportFilename,
  EXPORT_CSV_MIME,
  EXPORT_JSON_MIME,
  serializeExportBundle,
  withByteOrderMark,
  type ExportKind,
  type ExportSnapshot,
} from "@/lib/data-export";

const owner = "11111111-1111-4111-8111-111111111111";

// A CSV file ends its last row with a line break too, which is what a spreadsheet
// wants and what makes a trailing empty string in a naive split.
const lines = (csv: string) => csv.replace(/\r\n$/, "").split("\r\n");

const snapshot = (overrides: Partial<ExportSnapshot> = {}): ExportSnapshot => ({
  profile: {
    id: owner,
    display_name: "Pavithran Studios",
    business_name: "Pavithran Studios",
    plan: "FREE",
    timezone: "Asia/Kolkata",
    currency: "INR",
    created_at: "2026-09-01T09:00:00.000000+00:00",
    updated_at: "2026-09-20T09:00:00.000000+00:00",
  },
  email: "owner-1@dueweave.local",
  clients: [
    { id: "c1", owner_id: owner, name: "Nalini Ramesh", company: "Nalini Films, Chennai", phone: "+91 98765 43210", email: "nalini@example.invalid", notes: "Prefers WhatsApp", archived_at: null, created_at: "2026-09-02T09:00:00.000000+00:00", updated_at: "2026-09-02T09:00:00.000000+00:00" },
  ],
  receivables: [
    { id: "r1", owner_id: owner, client_id: "c1", label: "Weddy teaser", invoice_ref: "INV-7", amount_due_paise: 2800000, outstanding_paise: 800000, due_date: "2026-09-10", notes: null, status: "PARTIALLY_PAID", created_at: "2026-09-03T09:00:00.000000+00:00", updated_at: "2026-09-21T09:00:00.000000+00:00" },
  ],
  promises: [
    { id: "p1", owner_id: owner, receivable_id: "r1", sequence_no: 1, promised_amount_paise: 2000000, made_on: "2026-09-04", promised_date: "2026-09-20", source: "WHATSAPP", note: "Said Friday", status: "KEPT", created_at: "2026-09-04T09:00:00.000000+00:00", resolved_at: "2026-09-19T09:00:00.000000+00:00", updated_at: "2026-09-19T09:00:00.000000+00:00", request_id: "aaaaaaaa-0000-4000-8000-000000000001" },
  ],
  payments: [
    { id: "pay1", owner_id: owner, receivable_id: "r1", amount_paise: 2000000, paid_on: "2026-09-19", method: "UPI", reference: "UPI/9F3A", created_at: "2026-09-19T09:00:00.000000+00:00", note: null, request_id: "aaaaaaaa-0000-4000-8000-000000000002" },
  ],
  activities: [
    { id: "a1", owner_id: owner, client_id: "c1", receivable_id: "r1", promise_id: null, type: "FOLLOW_UP_RECORDED", occurred_at: "2026-09-22T06:30:00.000000+00:00", note: "WhatsApp follow-up sent · Overdue reminder", amount_paise: null, created_at: "2026-09-22T06:30:00.000000+00:00", metadata: { channel: "whatsapp" } },
    { id: "a2", owner_id: owner, client_id: "c1", receivable_id: "r1", promise_id: null, type: "SNOOZED", occurred_at: "2026-09-23T06:30:00.000000+00:00", note: "Follow-up snoozed", amount_paise: null, created_at: "2026-09-23T06:30:00.000000+00:00", metadata: { snoozed_until: "2026-09-26" } },
  ],
  promiseEvents: [
    { id: "pe1", owner_id: owner, promise_id: "p1", receivable_id: "r1", from_status: null, to_status: "ACTIVE", occurred_at: "2026-09-04T09:00:00.000000+00:00", reason: "Owner recorded a promise", actor_type: "OWNER", created_at: "2026-09-04T09:00:00.000000+00:00", metadata: { made_on: "2026-09-04", correction_of: "p0", corrected_on: "2026-09-05" } },
  ],
  entitlement: { id: "e1", user_id: owner, plan: "FREE", status: "ACTIVE", source: "DEFAULT", updated_at: "2026-09-01T09:00:00.000000+00:00", activated_at: null, reviewed_by: null, reviewed_at: null },
  purchaseClaims: [
    { id: "pc1", owner_id: owner, claim_id: "cl111111-1111-4111-8111-111111111111", plan: "FOUNDER", payer_name: "Pavithran Studios", utr_reference: "UTR 4471", amount_paise: 49900, status: "SUBMITTED", submitted_at: "2026-09-21T09:00:00.000000+00:00", verified_at: null, reviewed_at: null, reviewed_by: null, review_note: null, created_at: "2026-09-21T09:00:00.000000+00:00", updated_at: "2026-09-21T09:00:00.000000+00:00" },
  ],
  analyticsEvents: [
    { id: "ae1", owner_id: owner, event_name: "receivable_created", metadata: {}, occurred_at: "2026-09-03T09:00:00.000000+00:00", entity_type: "receivable", entity_id: "r1" },
  ],
  ...overrides,
});

const exportedAt = "2026-09-27T10:00:00.000000+05:30";
const businessDay = "2026-09-27";

describe("JSON export envelope (Stage 7 Phases 26 and 39)", () => {
  it("declares the format, the stable version and the India-only frame", () => {
    const bundle = buildExportBundle(snapshot(), exportedAt);
    expect(bundle.format).toBe("dueweave-export");
    expect(bundle.version).toBe(1);
    expect(bundle.product).toBe("DueWeave");
    expect(bundle.currency).toBe("INR");
    expect(bundle.businessCalendar).toBe("Asia/Kolkata");
    expect(bundle.exportedAt).toBe(exportedAt);
  });

  it("carries the account identity the owner signed the ledger with", () => {
    const bundle = buildExportBundle(snapshot(), exportedAt);
    expect(bundle.account).toMatchObject({ displayName: "Pavithran Studios", businessName: "Pavithran Studios", email: "owner-1@dueweave.local", timezone: "Asia/Kolkata", currency: "INR" });
  });

  it("holds every owner-scoped dataset the ledger is made of", () => {
    const bundle = buildExportBundle(snapshot(), exportedAt);
    expect(bundle.entitlement).not.toBeNull();
    expect(bundle.clients).toHaveLength(1);
    expect(bundle.receivables).toHaveLength(1);
    expect(bundle.payments).toHaveLength(1);
    expect(bundle.activities).toHaveLength(2);
    expect(bundle.promiseEvents).toHaveLength(1);
    expect(bundle.purchaseClaims).toHaveLength(1);
    expect(bundle.analyticsEvents).toHaveLength(1);
  });

  it("has a closed, named schema a future reader can branch on", () => {
    const bundle = buildExportBundle(snapshot(), exportedAt);
    expect(Object.keys(bundle).sort()).toEqual([
      "account", "activities", "analyticsEvents", "businessCalendar", "clients", "currency", "entitlement", "exportedAt", "format", "payments", "product", "promiseEvents", "promises", "purchaseClaims", "receivables", "version",
    ]);
    expect(Object.keys(bundle.account).sort()).toEqual(["businessName", "currency", "displayName", "email", "timezone"]);
  });

  it("hands each row back as the database holds it, with nothing dropped or renamed", () => {
    const source = snapshot();
    const bundle = buildExportBundle(source, exportedAt);
    expect(bundle.clients).toEqual(source.clients);
    expect(bundle.receivables).toEqual(source.receivables);
    expect(bundle.promises).toEqual(source.promises);
    expect(bundle.payments).toEqual(source.payments);
    expect(bundle.activities).toEqual(source.activities);
    expect(bundle.promiseEvents).toEqual(source.promiseEvents);
    expect(bundle.entitlement).toEqual(source.entitlement);
    expect(bundle.purchaseClaims).toEqual(source.purchaseClaims);
    expect(bundle.analyticsEvents).toEqual(source.analyticsEvents);
  });

  it("keeps money as integer paise and dates as the strings the database holds", () => {
    const bundle = buildExportBundle(snapshot(), exportedAt);
    const payment = bundle.payments[0] as { amount_paise: unknown; paid_on: unknown };
    expect(Number.isInteger(payment.amount_paise)).toBe(true);
    expect(payment.amount_paise).toBe(2000000);
    expect(payment.paid_on).toBe("2026-09-19");
    const receivable = bundle.receivables[0] as { outstanding_paise: unknown; due_date: unknown };
    expect(receivable.outstanding_paise).toBe(800000);
    expect(receivable.due_date).toBe("2026-09-10");
  });

  it("exports the exact instant history happened, not the day it was flattened to", () => {
    const bundle = buildExportBundle(snapshot(), exportedAt);
    const activity = bundle.activities[0] as { occurred_at: string };
    expect(activity.occurred_at).toBe("2026-09-22T06:30:00.000000+00:00");
  });

  it("keeps uuid relationships addressable across datasets", () => {
    const bundle = buildExportBundle(snapshot(), exportedAt);
    const [client] = bundle.clients as { id: string }[];
    const [receivable] = bundle.receivables as { client_id: string }[];
    const [promise] = bundle.promises as { receivable_id: string }[];
    const [payment] = bundle.payments as { receivable_id: string }[];
    const [event] = bundle.promiseEvents as { promise_id: string; receivable_id: string }[];
    expect(receivable.client_id).toBe(client.id);
    expect(promise.receivable_id).toBe("r1");
    expect(payment.receivable_id).toBe("r1");
    expect(event.promise_id).toBe("p1");
    expect(event.receivable_id).toBe("r1");
  });

  it("preserves Stage 5 provenance instead of flattening it away", () => {
    const bundle = buildExportBundle(snapshot(), exportedAt);
    const promise = bundle.promises[0];
    expect(promise.made_on).toBe("2026-09-04");
    expect(promise.sequence_no).toBe(1);
    expect(promise.resolved_at).toBe("2026-09-19T09:00:00.000000+00:00");
    const event = bundle.promiseEvents[0];
    expect(event.actor_type).toBe("OWNER");
    expect(event.reason).toBe("Owner recorded a promise");
    expect(event.metadata).toMatchObject({ made_on: "2026-09-04", correction_of: "p0", corrected_on: "2026-09-05" });
  });

  it("serialises as valid JSON with no floating-point money anywhere", () => {
    const json = serializeExportBundle(buildExportBundle(snapshot(), exportedAt));
    expect((JSON.parse(json) as { version: number }).version).toBe(1);
    expect(json).not.toMatch(/\d+\.\d+(e|E)/);
    expect(json).not.toContain("2000000.0");
  });

  it("carries no credential, token or server-side secret in the archive", () => {
    const json = serializeExportBundle(buildExportBundle(snapshot(), exportedAt)).toLowerCase();
    for (const leak of ["access_token", "refresh_token", "service_role", "apikey", "password", "eyJ", "postgres://", "bearer "]) {
      expect(json, `The export carried ${leak}.`).not.toContain(leak);
    }
  });

  it("exports a workspace with nothing in it as a valid empty archive", () => {
    const empty = snapshot({ clients: [], receivables: [], promises: [], payments: [], activities: [], promiseEvents: [], purchaseClaims: [], analyticsEvents: [] });
    const bundle = buildExportBundle(empty, exportedAt);
    expect(bundle.clients).toEqual([]);
    expect(bundle.activities).toEqual([]);
    expect(JSON.parse(serializeExportBundle(bundle)).account).toBeTruthy();
  });

  it("still describes the account when the profile row is somehow absent", () => {
    const bundle = buildExportBundle(snapshot({ profile: null }), exportedAt);
    expect(bundle.account.displayName).toBeNull();
    expect(bundle.version).toBe(1);
  });
});

describe("Safe filenames (Stage 7 Phase 27)", () => {
  it("names the archive after its content and date, never after a person", () => {
    expect(exportFilename("data", businessDay)).toBe("dueweave-data-2026-09-27.json");
    expect(exportFilename("clients", businessDay)).toBe("dueweave-clients-2026-09-27.csv");
    expect(exportFilename("receivables", businessDay)).toBe("dueweave-receivables-2026-09-27.csv");
    expect(exportFilename("payments", businessDay)).toBe("dueweave-payments-2026-09-27.csv");
    expect(exportFilename("promises", businessDay)).toBe("dueweave-promises-2026-09-27.csv");
    expect(exportFilename("activities", businessDay)).toBe("dueweave-activities-2026-09-27.csv");
  });

  it("refuses to put anything but a safe slug into a filename", () => {
    const name = exportFilename("clients", businessDay);
    expect(name).toMatch(/^[\w.-]+$/);
    expect(name).not.toMatch(/nalini|films|dueweave\.local|@/i);
  });

  it("names every file without repeating who or what is inside it", () => {
    const kinds: ExportKind[] = ["data", "clients", "receivables", "payments", "promises", "activities"];
    const names = kinds.map((kind) => exportFilename(kind, businessDay));
    expect(names).toHaveLength(6);
    for (const secret of ["nalini", "ramesh", "pavithran", "studios", "kaveri", "owner-1", "dueweave.local", "weddy", "inv-7", "upi/9f3a"]) {
      expect(names.join(" ").toLowerCase(), `A filename carried ${secret}.`).not.toContain(secret);
    }
  });

  it("declares the mime types the files are actually written as", () => {
    expect(EXPORT_JSON_MIME).toBe("application/json;charset=utf-8");
    expect(EXPORT_CSV_MIME).toBe("text/csv;charset=utf-8");
  });
});

describe("CSV encoder (Stage 7 Phase 31)", () => {
  it("quotes only what needs quoting", () => {
    expect(encodeCsv([["name", "company"], ["Nalini", "Nalini Films"]])).toBe("name,company\r\nNalini,Nalini Films\r\n");
    expect(encodeCsv([["notes"], ["a,b"]])).toBe('notes\r\n"a,b"\r\n');
    expect(encodeCsv([["notes"], ['said "yes"']])).toBe('notes\r\n"said ""yes"""\r\n');
  });

  it("protects a spreadsheet from a value that contains a line break", () => {
    expect(encodeCsv([["notes"], ["first line\nsecond line"]])).toBe('notes\r\n"first line\nsecond line"\r\n');
    expect(encodeCsv([["notes"], ["first line\r\nsecond line"]])).toBe('notes\r\n"first line\r\nsecond line"\r\n');
  });

  it("keeps a space the owner typed, including one that would hide a formula", () => {
    expect(encodeCsv([["notes"], ["  padded  "]])).toBe('notes\r\n"  padded  "\r\n');
  });

  it("writes empty and missing cells as nothing, never as the word null", () => {
    expect(encodeCsv([["phone", "email", "notes"], [null, undefined, ""]])).toBe("phone,email,notes\r\n,,\r\n");
  });

  it("preserves Tamil, Hindi and accented names character for character", () => {
    const csv = encodeCsv([["name"], ["சரவணகுமார்"], ["மோகன்"], ["Renée Ürgo"]]);
    expect(lines(csv)).toEqual(["name", "சரவணகுமார்", "மோகன்", "Renée Ürgo"]);
    expect(withByteOrderMark(csv).charCodeAt(0)).toBe(0xfeff);
  });

  it("writes the byte-order mark as the three bytes Excel actually looks for", () => {
    const bytes = Buffer.from(withByteOrderMark(encodeCsv([["name"], ["வணக்கம்"]])), "utf8");
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf]);
    expect(bytes.subarray(3).toString("utf8")).toContain("வணக்கம்");
  });

  it("keeps money cells as bare integers so Excel reads the number, not text", () => {
    expect(encodeCsv([["amount_paise"], [2000000]])).toBe("amount_paise\r\n2000000\r\n");
    expect(encodeCsv([["adjustment"], [-5000]])).toBe("adjustment\r\n-5000\r\n");
  });
});

describe("CSV formula-injection defence (Stage 7 Phase 32)", () => {
  const dangerous = ["=1+1", "+SUM(A1:A2)", "-1+2", "@SUM(1,2)", "  =1+1"];

  it.each(dangerous)("neutralises %s before a spreadsheet can run it", (value) => {
    const cell = lines(encodeCsv([["notes"], [value]]))[1];
    expect(cell.startsWith("\"'")).toBe(true);
    expect(cell.slice(2, -1)).toBe(value);
  });

  it("neutralises a hyperlink formula that also carries quotes", () => {
    expect(encodeCsv([["notes"], ['=HYPERLINK("https://example.invalid","x")']])).toBe('notes\r\n"\'=HYPERLINK(""https://example.invalid"",""x"")"\r\n');
  });

  it("neutralises a marker hidden behind whitespace a spreadsheet would skip", () => {
    for (const value of ["  =1+1", "\t=cmd|'/C calc'!A0", "\n@SUM(1,2)"]) {
      const cell = lines(encodeCsv([["notes"], [value]]))[1];
      expect(cell.startsWith("\"'"), `${JSON.stringify(value)} -> ${cell}`).toBe(true);
    }
  });

  it("leaves text that merely contains a marker exactly as it was", () => {
    expect(encodeCsv([["reference"], ["INV-7=final"]])).toBe("reference\r\nINV-7=final\r\n");
    expect(encodeCsv([["notes"], ["Partial - see chat"]])).toBe("notes\r\nPartial - see chat\r\n");
  });
});

describe("CSV convenience sheets (Stage 7 Phases 28, 29, 30 and 41)", () => {
  it("gives each sheet the stable columns the ledger really has", () => {
    expect(lines(csvFor("clients", snapshot()))[0]).toBe("client_id,name,company,phone,email,notes,archived_at,created_at,updated_at");
    expect(lines(csvFor("receivables", snapshot()))[0]).toBe("receivable_id,client_id,client_name,company,label,invoice_ref,amount_due_paise,outstanding_paise,due_date,status,notes,created_at,updated_at");
    expect(lines(csvFor("payments", snapshot()))[0]).toBe("payment_id,receivable_id,client_name,receivable_label,amount_paise,paid_on,method,reference,note,created_at");
    expect(lines(csvFor("promises", snapshot()))[0]).toBe("promise_id,receivable_id,client_name,receivable_label,sequence_no,promised_amount_paise,made_on,promised_date,source,status,created_at,resolved_at,note");
    expect(lines(csvFor("activities", snapshot()))[0]).toBe("activity_id,client_id,receivable_id,promise_id,type,occurred_at,amount_paise,snoozed_until,note");
  });

  it("adds the human join columns a spreadsheet reader needs", () => {
    const row = lines(csvFor("receivables", snapshot()))[1];
    expect(row).toContain("Nalini Ramesh");
    expect(row).toContain('"Nalini Films, Chennai"');
    expect(row).toContain("800000");
  });

  it("shows when a follow-up was snoozed until, from the event that said so", () => {
    const rows = lines(csvFor("activities", snapshot()));
    expect(rows[1]).toContain("2026-09-22T06:30:00.000000+00:00");
    expect(rows[1]).toContain("WhatsApp follow-up sent · Overdue reminder");
    expect(rows[2]).toContain("2026-09-26");
  });

  it("exports a row for every record the owner can see", () => {
    expect(lines(csvFor("clients", snapshot()))).toHaveLength(2);
    const twoClients = snapshot({ clients: [...snapshot().clients, { ...snapshot().clients[0], id: "c2", name: "Devan" }] });
    expect(lines(csvFor("clients", twoClients))).toHaveLength(3);
  });

  it("hands back headers and no rows for a ledger nobody has used yet", () => {
    const empty = snapshot({ clients: [], receivables: [], promises: [], payments: [], activities: [] });
    expect(lines(csvFor("payments", empty))).toEqual(["payment_id,receivable_id,client_name,receivable_label,amount_paise,paid_on,method,reference,note,created_at"]);
    expect(lines(csvFor("activities", empty))).toHaveLength(1);
  });
});
