import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Stage 8's most important claims are architectural: a hand-off to a UPI app proves
// nothing, only a named human reviewer can approve, and nothing inside the product
// turns the payment destination on. Those claims hold or fail by what the shipped code
// is even able to reference, so they are pinned here against the client source, the
// migration text, and the built bundle rather than by re-running the live suite.

const root = path.resolve(import.meta.dirname, "..");
const clientSource = path.join(root, "client", "src");
const migrationsDir = path.join(root, "supabase", "migrations");
const distDir = path.join(root, "dist");

const read = (relative: string) => readFileSync(path.join(root, relative), "utf8");

function filesIn(dir: string, extensions: string[]): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) return filesIn(full, extensions);
    return extensions.some((extension) => entry.endsWith(extension)) ? [full] : [];
  });
}

const customerScreen = read("client/src/pages/FounderPurchase.tsx");
const reviewerScreen = read("client/src/pages/FounderAdmin.tsx");
const customerRepository = read("client/src/data/supabase-founder-repository.ts");
const reviewerRepository = read("client/src/data/supabase-founder-admin-repository.ts");
const uriBuilder = read("client/src/lib/founder-payment.ts");
const readinessLib = read("client/src/lib/founder-readiness.ts");
const errorMapper = read("client/src/data/supabase-adapters.ts");

const clientText = new Map(
  filesIn(clientSource, [".ts", ".tsx"])
    .filter((file) => !file.endsWith(".test.ts") && !file.endsWith(".test.tsx"))
    // The generated schema mirror names every table and function in the database by
    // construction, so it is excluded: the pins below are about code that could choose
    // to query or call something, not about a description of what exists.
    .filter((file) => !file.endsWith("database.generated.ts"))
    .map((file) => [path.relative(root, file).replaceAll("\\", "/"), readFileSync(file, "utf8")]),
);

// Migrations carry long explanatory comments that quote refused states and the retired
// vocabulary, so every scan below runs on executable lines only.
function executable(sql: string) {
  return sql.split(/\r?\n/).filter((line) => !line.trimStart().startsWith("--")).join("\n");
}

const migrations = readdirSync(migrationsDir)
  .filter((file) => file.endsWith(".sql"))
  .map((file) => ({ file, sql: executable(readFileSync(path.join(migrationsDir, file), "utf8")) }));

const founderMigrations = migrations.filter(({ file }) => /stage4|stage8/.test(file));

/** The rows each migration writes into `analytics_events`, as event name plus metadata. */
function analyticsWrites(sql: string) {
  const lines = sql.split(/\r?\n/);
  const writes: { event: string; metadata: string }[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!lines[index].includes("insert into public.analytics_events")) continue;
    const statement = lines.slice(index, index + 3).join(" ");
    writes.push({
      event: statement.match(/values\s*\([^,]+,\s*'([a-z_]+)'/i)?.[1] ?? "unknown",
      metadata: statement.match(/jsonb_build_object\(([^)]*)\)/i)?.[1] ?? "",
    });
  }
  return writes;
}

describe("Stage 8 Founder monetization contracts", () => {
  it("reads a payment hand-off as navigation only, never as a result", () => {
    // PHASES 9 and 25: opening `upi://pay` leaves the browser entirely, so any listener
    // on its return would be inventing a payment. There is none in the shipped client,
    // and the reference is sent only by the form the customer fills in afterwards.
    const forbidden = /visibilitychange|pageshow|window\.addEventListener\(["']focus|addEventListener\(["']blur|setInterval\(/i;
    for (const [file, text] of clientText) expect(`${file}: ${text}`).not.toMatch(forbidden);

    expect(customerScreen).toMatch(/window\.location\.href = payload/);
    expect(customerScreen).toMatch(/function submitClaim\(event: React\.FormEvent<HTMLFormElement>\)\s*\{\s*event\.preventDefault\(\)/);
    const submitsPayment = [...clientText].filter(([, text]) => text.includes("submit_founder_payment")).map(([file]) => file);
    expect(submitsPayment).toEqual(["client/src/data/supabase-founder-repository.ts"]);
  });

  it("keeps the approval decision with the reviewer's own screen", () => {
    // PHASES 22-25: customer-side code has no route to an approval, and reviewer-side
    // code names nothing beyond the reviewer RPCs, so no customer action can reach a
    // decision the database has not already gated behind the allowlist.
    for (const decision of ["approve_founder_claim", "reject_founder_claim", "reconsider_founder_claim", "revoke_founder_entitlement"]) {
      expect(customerRepository).not.toContain(decision);
      expect(customerScreen).not.toContain(decision);
    }
    const rpcNames = (source: string) => [...source.matchAll(/supabase\.rpc\("([a-z_]+)"/g)].map((match) => match[1]).sort();
    expect(rpcNames(customerRepository)).toEqual([
      "cancel_founder_claim",
      "create_founder_claim",
      "get_founder_offer",
      "record_founder_upgrade_view",
      "submit_founder_payment",
    ]);
    expect(rpcNames(reviewerRepository)).toEqual([
      "approve_founder_claim",
      "get_founder_funnel",
      "list_pending_founder_claims",
      "list_rejected_founder_claims",
      "reconsider_founder_claim",
      "reject_founder_claim",
      "revoke_founder_entitlement",
    ]);
  });

  it("ships no destination, no VPA, and no live toggle", () => {
    // PHASES 10, 12 and 66: the delivered row is a placeholder with no VPA, and moving
    // it to LIVE is a database task that neither the migrations nor the client performs.
    for (const { file, sql } of migrations) {
      expect(`${file}: ${sql}`).not.toMatch(/set\s+payment_destination_status\s*=\s*'LIVE'/i);
      expect(`${file}: ${sql}`).not.toMatch(/set\s+upi_id\s*=/i);
    }
    expect(read("supabase/migrations/20260813030000_stage4_founder_monetization.sql")).toMatch(/payment_destination_status text not null default 'PLACEHOLDER'/);
    expect(migrations.some(({ sql }) => /insert into public\.founder_offer_config \(offer_key\)\s*values \('FOUNDER_V1'\)/i.test(sql))).toBe(true);
    for (const { file, sql } of founderMigrations) {
      for (const line of sql.split(/\r?\n/)) expect(`${file}: ${line.trim()}`).not.toMatch(/[a-z0-9._-]{2,}@[a-z][a-z0-9.-]{2,}/);
    }
    for (const [file, text] of clientText) {
      expect(`${file}: ${text}`).not.toMatch(/founder_offer_config|founder_admins|founder_audit_events/);
      expect(`${file}: ${text}`).not.toMatch(/enable live|go live|turn live|mark live|set live|live payment/i);
    }
  });

  it("opens payment only through a LIVE destination the conjunction reaches nowhere by default", () => {
    // PHASES 11 and 12: TEST stores a synthetic destination but is not a payable one,
    // the readiness conjunction is written down once for the UI, and the database
    // re-checks the same term at call time.
    expect(readinessLib).toMatch(/paymentDestinationStatus !== "LIVE"\) gaps\.push\("destination-not-live"\)/);
    expect(uriBuilder).toMatch(/if \(!isFounderPaymentReady\(offer\) \|\| !offer\.upiId\) return ""/);
    const gate = read("supabase/migrations/20260814110000_stage4_2a_live_payment_gate.sql");
    expect([...gate.matchAll(/v_offer\.payment_destination_status <> 'LIVE'/g)].length).toBeGreaterThanOrEqual(2);
    expect(customerScreen).toContain("Payment instructions are being set up.");
    expect(customerScreen).toContain("Do not send money yet.");
  });

  it("records analytics as bounded product events and labels them as nothing else", () => {
    // PHASES 55 and 56: the funnel may count that a claim was created and that access
    // was activated. Its metadata is a fixed pair of product enums — the reference, the
    // payer, the destination and the bank are not among the things it can say.
    const allowedKeys = ["source", "surface"];
    const allowedValues = ["founder", "manual_reconsideration", "manual_review"];
    const events = new Set<string>();
    for (const { file, sql } of founderMigrations) {
      for (const write of analyticsWrites(sql)) {
        expect(write.event, `${file} wrote an unrecognised analytics event`).not.toBe("unknown");
        const pairs = [...write.metadata.matchAll(/'([a-z_]+)',\s*'([a-z_]+)'/g)];
        expect(pairs.length, `${file} → ${write.event} wrote metadata that is not a key/value pair`).toBe(1);
        const [, key, value] = pairs[0];
        expect(allowedKeys, `${file} → ${write.event} metadata key`).toContain(key);
        expect(allowedValues, `${file} → ${write.event} metadata value`).toContain(value);
        events.add(write.event);
      }
    }
    expect([...events].sort()).toEqual(["founder_activated", "founder_claim_created", "founder_payment_submitted", "founder_rejected", "upgrade_viewed"]);
    const funnelList = reviewerScreen.match(/\[[^\]]*upgrade_viewed[^\]]*\]/)?.[0] ?? "";
    expect([...funnelList.matchAll(/"([a-z_]+)"/g)].map((match) => match[1]))
      .toEqual(["upgrade_viewed", "founder_claim_created", "founder_payment_submitted", "founder_activated", "founder_rejected"]);
    expect(reviewerScreen).toMatch(/event\.replaceAll\("_", " "\)/);
    for (const [file, text] of clientText) {
      if (!text.toLowerCase().includes("founder")) continue;
      // "gateway" is deliberately not pinned: the customer page names the one thing it
      // says the product does not have.
      expect(`${file}: ${text}`).not.toMatch(/revenue|\bsales?\b|converted|checkout/i);
    }
  });

  it("keeps the reference in component state, out of storage and logs, and never raw", () => {
    // PHASES 58, 59 and 77: a UTR with a payer name is bank-history evidence. It lives
    // in React state until an RPC stores it, nothing prints it, and the database's own
    // vocabulary never reaches a screen.
    for (const [file, text] of clientText) {
      if (!/founder/i.test(file)) continue;
      expect(`${file}: ${text}`).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie|console\./);
    }
    expect(customerScreen).toMatch(/const \[utr, setUtr\] = useState\(""\)/);
    expect(reviewerScreen).not.toMatch(/SQLSTATE|PGRST|error\.code/);
    for (const repository of [customerRepository, reviewerRepository]) {
      for (const line of repository.split(/\r?\n/).filter((entry) => entry.includes("throw new Error("))) {
        expect(line.trim()).toMatch(/throw new Error\((userFacingDataError\(error\.message\)|"[A-Z][^"]*")\);/);
      }
    }
    // Every branch answers in the product's own words, so an unmapped internal message
    // still cannot reach a customer. The only way to leak is to return the input.
    const body = errorMapper.slice(errorMapper.indexOf("export function userFacingDataError"));
    expect(body).not.toMatch(/return (message|normalized|raw|error|input)\b/);
    expect(body).toMatch(/return "We could not save that change\. Please try again\.";\s*\}/);
  });

  // PHASE 65: the live-activation checklist is a document, so it can rot silently
  // while the code it describes keeps moving. Its items are pinned to the gap kinds
  // the readiness evaluator actually reports, in the operator order it reports them.
  it("keeps the live-activation checklist aligned with the readiness evaluator", () => {
    const union = readinessLib.match(/export type FounderReadinessGap =([\s\S]*?);/)?.[1] ?? "";
    const gapKinds = [...union.matchAll(/"([a-z-]+)"/g)].map((match) => match[1]);
    expect(gapKinds.length, "the readiness gap union itself must not be empty or parsed loosely").toBe(12);

    const checklist = read("docs/FOUNDER_LIVE_ACTIVATION_CHECKLIST.md");
    const listed = checklist.match(/^ {2}- id: ([a-z-]+)$/gm)?.map((line) => line.replace(/^ {2}- id: /, "")) ?? [];
    expect(listed, "the checklist drifted from the gap kinds the evaluator reports").toEqual(gapKinds);

    const states = [...checklist.matchAll(/^ {4}default_state: (clear|placeholder|gap|not-applicable)$/gm)].map((match) => match[1]);
    expect(states, "every checklist item must state its delivered default").toHaveLength(gapKinds.length);
    // The delivered row reports exactly these, which the live suite measures against
    // the database in tests/stage8-local-founder-readiness.test.ts.
    expect(states.filter((state) => state === "gap")).toHaveLength(6);
    expect(checklist).toContain("NOT READY");
    // PHASE 66: the checklist is read by a person and answered with SQL. It must not
    // describe a control that performs activation.
    expect(checklist).not.toMatch(/\benable live payments\b/i);
    expect(checklist).not.toMatch(/(click|press|tap|toggle)[^\n]{0,40}(to )?(set|mark|make|switch)[^\n]{0,20}live/i);
    // Every mention of a control has to be a denial of one, never a direction to use it.
    for (const sentence of checklist.split(/(?<=[.?])\s+/).filter((entry) => /one-click|button/i.test(entry))) {
      expect(sentence, "the checklist described a control instead of denying one").toMatch(/\bno\b|not\b|never\b|without/i);
    }
  });

  const bundlePresent = existsSync(distDir) && statSync(distDir).isDirectory();
  it.skipIf(!bundlePresent)("carries no payable destination in the built bundle", () => {
    const bundle = filesIn(distDir, [".js", ".mjs", ".css", ".html"]).map((file) => readFileSync(file, "utf8")).join("\n");

    // The URI template is code and ships; a destination is data and never does. A
    // payable URI exists only once someone has configured one and started a claim.
    expect(bundle).toContain("upi://pay?");
    expect(bundle).not.toMatch(/upi:\/\/pay\?pa=/);
    expect(bundle).not.toMatch(/[a-z0-9._-]{2,}@upi\b/);
    expect(bundle).not.toContain("dueweave-test@upi");
    expect(bundle).toContain("Payment instructions are being set up.");
    expect(bundle).toContain("PLACEHOLDER");
  });
});
