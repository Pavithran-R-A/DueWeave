import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Arc 2 Phase 2, Task 3F. Stage 8 repaired the whitespace-class divergence between the
// browser's `trim()` and PostgreSQL's `btrim(x)` on the Founder configuration; the ledger
// still had it. Measured on the database before this repair, with `assert_stage3_client_input`
// as the read:
//
//   btrim(E'   ')            -> ''        refused
//   btrim(E'\t\t')           -> '\t\t'     accepted
//   btrim(E'\u00a0\u00a0')   -> NBSP pair  accepted
//   btrim(E'\u3000')         -> full width accepted
//
// so a client name, a receivable label or a cancellation reason that
// `client/src/components/sheets.tsx` refuses with `!value.trim()` was content to every
// ledger verb. The reason fields are the load-bearing ones: `cancel_receivable` writes its
// reason into `activities.note` and into the promise outcome, so an invisible reason both
// authorised a cancellation and became the recorded explanation for it.
//
// The behaviour is proved live, character by character, in tests/stage9-abuse-matrix.test.ts.
// This file is what stops one boundary being edited without the other — the drift itself is
// the defect — and pins the two decisions that were made deliberately: the class is matched
// to the browser rather than widened, and it lands on the required fields only.
const root = path.resolve(import.meta.dirname, "..");
const MIGRATION = path.join("supabase", "migrations", "20261004170000_current_arc2_ledger_required_blank_class.sql");
const STAGE8_MIGRATION = path.join("supabase", "migrations", "20260928090000_current_stage8_readiness_parity.sql");

/** Read a source file with the checkout's CRLF removed, so rules are written once. */
function source(...segments: string[]) {
  return readFileSync(path.join(root, ...segments), "utf8").replace(/\r\n/g, "\n");
}

/** Migration comments quote the retired rule, so contract reads use code lines only. */
function executable(sql: string) {
  return sql.split(/\r?\n/).filter((line) => !line.trimStart().startsWith("--")).join("\n");
}

/** A character named by codepoint, so a whitespace failure says U+00A0 and not " ". */
function codeHex(character: string) {
  return character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0");
}

/** The ECMAScript WhiteSpace and LineTerminator production, by codepoint. */
const JS_TRIMS = [0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x20, 0xa0, 0x1680, 0x2000, 0x2001, 0x2002, 0x2003, 0x2004,
  0x2005, 0x2006, 0x2007, 0x2008, 0x2009, 0x200a, 0x2028, 0x2029, 0x202f, 0x205f, 0x3000, 0xfeff]
  .map((code) => String.fromCharCode(code));

/** The body of one function, from its `create or replace` to the dollar-quoted end tag. */
function functionBody(sql: string, name: string) {
  const start = sql.indexOf(`create or replace function public.${name}`);
  expect(start, `the migration no longer defines ${name}`).toBeGreaterThan(-1);
  const tag = sql.slice(start).match(/\$([a-z_]+)\$/)?.[1] ?? "";
  expect(tag, `${name}'s body is not dollar-quoted`).not.toBe("");
  const end = sql.indexOf(`$${tag}$;`, start);
  expect(end, `${name}'s body never closes`).toBeGreaterThan(start);
  return sql.slice(start, end);
}

/** Decode the spelled-out character class the way PostgreSQL's escape string would. */
function decodeClass(literal: string) {
  return [...literal.matchAll(/E'([^']*)'/g)]
    .map((match) => match[1])
    .join("")
    .replace(/\\u([0-9a-f]{4})/gi, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)))
    .replace(/\\t/g, "\t")
    .replace(/\\n/g, "\n")
    .replace(/\\f/g, "\f")
    .replace(/\\v/g, "\v")
    .replace(/\\r/g, "\r");
}

const ledger = executable(source(MIGRATION));
const classLiterals = [...ledger.matchAll(/c_ws constant text :=([\s\S]*?);/g)].map((match) => match[1]);

// The five sites the rule had to reach: one class per function that decides a required
// ledger field, because a shared helper would be a new public function and therefore a new
// RPC in the PostgREST surface. Measured, not assumed: the count is pinned so a sixth copy
// (or a deleted one) fails here rather than in the field.
const requiredFields: Array<{ name: string; function: string; parameter: string }> = [
  { name: "client name, both verbs", function: "assert_stage3_client_input", parameter: "p_name" },
  { name: "receivable label, create", function: "create_receivable", parameter: "p_label" },
  { name: "receivable label, edit", function: "update_receivable_details", parameter: "p_label" },
  { name: "cancellation reason, receivable", function: "cancel_receivable", parameter: "p_reason" },
  { name: "cancellation reason, promise", function: "cancel_promise", parameter: "p_reason" },
];

describe("one blank rule for the ledger's required fields, stated identically on both boundaries", () => {
  it("declares the class once per function that requires a ledger field", () => {
    expect(classLiterals, "every required-field function must spell out the class it trims with").toHaveLength(requiredFields.length);
    for (const entry of requiredFields) {
      const body = functionBody(ledger, entry.function);
      expect(body, `${entry.function} lost its c_ws declaration`).toContain("c_ws constant text :=");
      expect(body, `${entry.function} no longer blank-tests ${entry.parameter} with the class`)
        .toContain(`nullif(btrim(coalesce(${entry.parameter}, ''), c_ws), '')`);
    }
  });

  it("ships one class, not five that resemble each other", () => {
    const copies = new Set(classLiterals.map((literal) => literal.replace(/\s+/g, "")));
    expect([...copies], "the same class was spelled differently in different functions").toHaveLength(1);
    const stage8 = executable(source(STAGE8_MIGRATION));
    const stage8Literal = stage8.match(/c_ws constant text :=([\s\S]*?);/)?.[1] ?? "";
    expect(stage8Literal, "Stage 8's class could not be read, so the two boundaries cannot be compared").not.toBe("");
    const ledgerClass = new Set([...decodeClass(classLiterals[0])]);
    const founderClass = new Set([...decodeClass(stage8Literal)]);
    expect([...ledgerClass].sort()).toEqual([...founderClass].sort());
  });

  it("is the browser's class in both directions, and no wider", () => {
    const sqlClass = new Set([...decodeClass(classLiterals[0])]);
    expect(sqlClass.size, "the SQL trim class must not be empty").toBeGreaterThan(0);
    for (const character of sqlClass) {
      expect(character.trim(), `the SQL class strips U+${codeHex(character)}, which JavaScript keeps`).toBe("");
    }
    for (const character of JS_TRIMS) {
      expect(character.trim(), `U+${codeHex(character)} is not actually trimmed by this engine`).toBe("");
      expect(sqlClass.has(character), `the database does not strip U+${codeHex(character)}, which the client does`).toBe(true);
    }
    // Matched to the client rather than widened until every odd-looking character was
    // blank: a zero-width space is content to `trim()`, so it stays content here.
    const zeroWidth = String.fromCharCode(0x200b);
    expect(`${zeroWidth}x${zeroWidth}`.trim()).toBe(`${zeroWidth}x${zeroWidth}`);
    expect(sqlClass.has(zeroWidth), "the SQL class strips a character JavaScript keeps").toBe(false);
  });

  it("lands on the fields the client blank-tests and leaves the optional ones alone", () => {
    const sheets = source("client", "src", "components", "sheets.tsx");
    // Every field the browser refuses when blank is in `requiredFields` above, and each
    // guard is the same shape: an empty-after-trim test that stops the submit.
    for (const guard of [
      /if \(!form\.name\.trim\(\)\) \{ setNameError\("Add a client name before saving\."\)/,
      /if \(!form\.clientName\.trim\(\)\)/,
      /if \(!form\.name\.trim\(\)\) \{ setNameError\("Keep a client name before saving\."\)/,
      /if \(!form\.label\.trim\(\)\)/,
      /if \(!reason\.trim\(\)\) \{ setReasonError\("Add a short reason before closing this receivable\."/,
      /if \(!reason\.trim\(\)\) \{ setReasonError\("Add a short reason before withdrawing this promise\."/,
    ]) {
      expect(sheets, `the client no longer blank-tests a field the database now refuses (${guard})`).toMatch(guard);
    }
    // The other half of the decision: nothing in this migration claims to normalise the
    // ledger's optional text. Those bytes are what their owner typed and nothing reads
    // them — no total, no payment URI, no WhatsApp destination, no comparison.
    for (const entry of requiredFields) {
      const body = functionBody(ledger, entry.function);
      for (const optional of ["p_notes", "p_invoice_ref", "p_email"]) {
        if (body.includes(`coalesce(${optional}, '')`)) {
          expect(body, `${entry.function} widened the optional ${optional} past the browser's rule`)
            .toContain(`btrim(coalesce(${optional}, ''))`);
          expect(body).not.toContain(`btrim(coalesce(${optional}, ''), c_ws)`);
        }
      }
    }
  });

  it("re-grants the browser EXECUTE the Stage 3 trigger strips from a redefined verb", () => {
    // 20260814150000 and 20260814160000: `ddl_command_end` revokes PUBLIC, anon and
    // authenticated EXECUTE from any routine as soon as it is redefined. A migration that
    // replaces a browser-callable verb without re-granting it takes the RPC away from the
    // application — measured on this file's first draft, which asserted the opposite.
    const signatures: Array<[string, string]> = [
      ["create_receivable", "create_receivable(uuid, text, text, bigint, date, text)"],
      ["update_receivable_details", "update_receivable_details(uuid, text, text, text, timestamptz)"],
      ["cancel_receivable", "cancel_receivable(uuid, text)"],
      ["cancel_promise", "cancel_promise(uuid, text)"],
    ];
    for (const [, signature] of signatures) {
      expect(ledger, `${signature} was redefined without restoring its browser grant`)
        .toContain(`grant execute on function public.${signature} to authenticated;`);
      expect(ledger, `${signature} was re-granted without repeating the revoke the posture states`)
        .toContain(`revoke all on function public.${signature} from public, anon;`);
    }
    // The helper stays internal: it has never held a browser grant, because both client
    // verbs are SECURITY DEFINER and call it as the owner. A grant here would widen the
    // RPC surface, which supabase/tests/stage3_02_privileges.sql counts as a set.
    expect(ledger, "the input helper was made callable over RPC").not.toMatch(/grant execute on function public\.assert_stage3_client_input[^;]*to (authenticated|anon)/);
  });
});
