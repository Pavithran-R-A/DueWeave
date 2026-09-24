import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { toActivity } from "@/data/supabase-adapters";

const root = process.cwd();
const source = (relativePath: string) => readFileSync(resolve(root, relativePath), "utf8");
const adapters = source("client/src/data/supabase-adapters.ts");

const pairings = [
  { adapter: "toClient", repository: "client/src/data/supabase-client-repository.ts" },
  { adapter: "toReceivable", repository: "client/src/data/supabase-receivable-repository.ts" },
  { adapter: "toPromise", repository: "client/src/data/supabase-promise-repository.ts" },
  { adapter: "toPayment", repository: "client/src/data/supabase-payment-repository.ts" },
  { adapter: "toActivity", repository: "client/src/data/supabase-activity-repository.ts" },
];

function adapterBody(adapterName: string) {
  const start = adapters.indexOf(`export function ${adapterName}(`);
  expect(start, `${adapterName} must exist in supabase-adapters.ts`).toBeGreaterThanOrEqual(0);
  const end = adapters.indexOf("\nexport ", start + 1);
  return adapters.slice(start, end === -1 ? undefined : end);
}

function columnsReadBy(adapterName: string) {
  const body = adapterBody(adapterName);
  const direct = [...body.matchAll(/\brow\.([a-z_]+)/g)].map((match) => match[1]);
  const nested = [...body.matchAll(/\bmetadata\.([a-z_]+)/g)].length > 0 ? ["metadata"] : [];
  return new Set([...direct, ...nested]);
}

function columnsSelectedBy(repositoryPath: string) {
  const projection = source(repositoryPath).match(/\.select\("([^"]+)"\)/);
  expect(projection, `${repositoryPath} must declare a column projection`).not.toBeNull();
  return new Set(projection![1].split(",").map((column) => column.trim()));
}

describe("repository projection contracts", () => {
  it.each(pairings)("$adapter only reads columns its repository selects", ({ adapter, repository }) => {
    const selected = columnsSelectedBy(repository);
    const missing = [...columnsReadBy(adapter)].filter((column) => !selected.has(column) && !selected.has("*"));
    expect(missing, `${repository} must select ${missing.join(", ")} for ${adapter} to work`).toEqual([]);
  });

  it("carries a snooze date from the activity row into the queue rule", () => {
    const snoozed = toActivity({ id: "a1", client_id: "c1", receivable_id: "r1", type: "SNOOZED", occurred_at: "2026-08-14T00:00:00Z", note: "Follow-up snoozed", metadata: { snoozed_until: "2026-08-20", surface: "today" } });
    expect(snoozed.snoozedUntil).toBe("2026-08-20");
  });

  it("keeps a non-snooze activity from inheriting a snooze date", () => {
    const payment = toActivity({ id: "a2", client_id: "c1", receivable_id: "r1", type: "PAYMENT_RECORDED", occurred_at: "2026-08-14T00:00:00Z", note: "Payment recorded", metadata: { snoozed_until: "2026-08-20" } });
    expect(payment.snoozedUntil).toBeUndefined();
  });

  it("reads a date-only occurred_at as the same business date", () => {
    expect(toActivity({ id: "a3", client_id: "c1", receivable_id: "r1", type: "NOTE_ADDED", occurred_at: "2026-08-14", note: "Called back" }).occurredAt).toBe("2026-08-14");
  });
});
