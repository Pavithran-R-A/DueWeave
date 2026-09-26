import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Stage 4 hands customers a real edit surface, so the boundary that keeps it
// honest has to be mechanically enforced rather than trusted: the Supabase
// client may only be touched from `client/src/data` (plus the documented auth
// hook), every write goes through a named repository method, and a write always
// carries the concurrency token it read a moment earlier.

const root = process.cwd();
const sourceDir = path.resolve(root, "client", "src");

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) return tsFiles(absolute);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\.ts$/.test(entry.name) ? [absolute] : [];
  });
}

const relative = (file: string) => path.relative(sourceDir, file).replace(/\\/g, "/");
const uiFiles = [...tsFiles(path.resolve(sourceDir, "pages")), ...tsFiles(path.resolve(sourceDir, "components"))];

const clientRepository = readFileSync(path.resolve(sourceDir, "data/supabase-client-repository.ts"), "utf8");
const receivableRepository = readFileSync(path.resolve(sourceDir, "data/supabase-receivable-repository.ts"), "utf8");
const dashboardRepository = readFileSync(path.resolve(sourceDir, "data/supabase-dashboard-repository.ts"), "utf8");
const homePage = readFileSync(path.resolve(sourceDir, "pages/Home.tsx"), "utf8");
const sheetsPage = readFileSync(path.resolve(sourceDir, "components/sheets.tsx"), "utf8");

function methodBody(source: string, signature: string) {
  const start = source.indexOf(signature);
  expect(start, `${signature} must be defined in the dashboard repository`).toBeGreaterThanOrEqual(0);
  const end = source.indexOf("\n  }", start);
  return source.slice(start, end === -1 ? undefined : end);
}

function argumentKeys(source: string, rpcName: string) {
  const call = source.match(new RegExp(`supabase\\.rpc\\("${rpcName}",\\s*\\{([\\s\\S]*?)\\}\\)`));
  expect(call, `${rpcName} must be called with a literal argument object`).not.toBeNull();
  return [...call![1].matchAll(/(\w+):/g)].map((match) => match[1]);
}

describe("repository source boundary (Stage 4)", () => {
  it("carries the UI files this contract is actually looking at", () => {
    expect(uiFiles.length).toBeGreaterThanOrEqual(6);
    expect(uiFiles.map(relative)).toContain("pages/Home.tsx");
  });

  it.each(uiFiles.map((file) => [relative(file), file]))("%s never touches the Supabase client directly", (_label, file) => {
    const source = readFileSync(file, "utf8");
    for (const [pattern, why] of [
      [/@\/lib\/supabase/, "imports the shared client"],
      [/@supabase\/supabase-js/, "constructs its own client"],
      [/\bsupabase\s*\./, "calls the client"],
      [/\.from\(\s*["']/, "queries a table"],
      [/\.rpc\(\s*["']/, "calls an RPC"],
      [/createClient\s*\(/, "creates a client"],
    ] as const) {
      expect(source, `${file} ${why} — it must go through a repository method`).not.toMatch(pattern);
    }
  });

  it("keeps the shared client imported only by data repositories and the documented auth hook", () => {
    const importers = tsFiles(sourceDir)
      .filter((file) => readFileSync(file, "utf8").includes("@/lib/supabase"))
      .map(relative)
      .sort();
    expect(importers).toEqual([...importers.filter((file) => file.startsWith("data/")), "hooks/useSupabaseAuth.ts"]);
    expect(importers).toContain("hooks/useSupabaseAuth.ts");
  });

  it("sends only the safe descriptive columns when editing a client", () => {
    expect(argumentKeys(clientRepository, "update_client").sort()).toEqual([
      "p_client_id",
      "p_company",
      "p_email",
      "p_expected_updated_at",
      "p_name",
      "p_notes",
      "p_phone",
    ]);
  });

  it("sends only the safe descriptive columns when editing receivable details", () => {
    expect(argumentKeys(receivableRepository, "update_receivable_details").sort()).toEqual([
      "p_expected_updated_at",
      "p_invoice_ref",
      "p_label",
      "p_notes",
      "p_receivable_id",
    ]);
  });

  it("never offers an identity, ownership, archive, or financial column to an edit call", () => {
    for (const source of [clientRepository, receivableRepository]) {
      expect(source).not.toMatch(/p_owner_id|p_archived_at|p_status|p_amount_due_paise:.*updated_at|p_outstanding_paise/);
    }
    expect(clientRepository).not.toMatch(/supabase\.from\("clients"\)\.update/);
    expect(receivableRepository).not.toMatch(/supabase\.from\("receivables"\)\.update/);
  });

  it("reads the concurrency token it needs to send back", () => {
    expect(clientRepository).toMatch(/\.select\("[^"]*\bupdated_at\b[^"]*"\)/);
    expect(receivableRepository).toMatch(/\.select\("[^"]*\bupdated_at\b[^"]*"\)/);
  });

  it("keeps dashboard read() a pure read and names the settling write separately", () => {
    const readBody = methodBody(dashboardRepository, "async read(");
    expect(readBody).not.toMatch(/\.rpc\(|markDuePromisesBroken|settleDuePromises/);
    expect(dashboardRepository).toMatch(/async settleDuePromises\(\)[^{]*\{[^}]*markDuePromisesBroken/);
    expect(homePage).toMatch(/await dashboardRepository\.settleDuePromises\(\);\s*const next = await dashboardRepository\.read\(\);/);
  });

  it("keeps a refresh from throwing away what the customer was looking at", () => {
    const start = homePage.indexOf("const refresh = useCallback(");
    expect(start, "the screen must load through one refresh path").toBeGreaterThanOrEqual(0);
    const refreshBody = homePage.slice(start, homePage.indexOf("}, [dashboardRepository]);", start));
    expect(refreshBody).toMatch(/setSelectedReceivableId\(\(current\)[\s\S]*some\(\(item\) => item\.id === current\)/);
    expect(refreshBody).toMatch(/setSelectedClientId\(\(current\)[\s\S]*some\(\(item\) => item\.id === current\)/);
  });
});

// The screen is the last place a "safe edit" can quietly stop being safe: a sheet
// that learns to type an amount, or a handler that closes the form on failure,
// would undo the guarantee the database already provides.
describe("edit surface (Stage 4)", () => {
  const clientSheet = functionSource(sheetsPage, "export function EditClientSheet(");
  const receivableSheet = functionSource(sheetsPage, "export function EditReceivableSheet(");
  const clientEdit = functionSource(homePage, "async function saveClientDetails(");
  const receivableEdit = functionSource(homePage, "async function saveReceivableDetails(");

  it("edits a client through wording and contact fields only", () => {
    expect(clientSheet).toContain('title="Edit client"');
    expect(editedKeys(clientSheet)).toEqual(["company", "email", "name", "notes", "phone"]);
    expect(clientSheet).toMatch(/onSubmit\(form\)/);
    expect(clientSheet).toMatch(/<textarea /);
    expect(countMatches(clientSheet, /<input /g)).toBe(4);
    expect(clientSheet).not.toMatch(/type="date"|inputMode="decimal"|<select|parseINRToPaise|value=\{form\.(amount|dueDate|status|clientId)/);
  });

  it("edits a receivable through label, reference, and note only", () => {
    expect(receivableSheet).toContain('title="Edit receivable details"');
    expect(editedKeys(receivableSheet)).toEqual(["invoiceRef", "label", "notes"]);
    // The money facts are rendered for context and are never a control.
    expect(receivableSheet).toMatch(/formatINR\(receivable\.amountDuePaise\)/);
    expect(receivableSheet).toMatch(/formatDate\(receivable\.dueDate\)/);
    expect(countMatches(receivableSheet, /<input /g)).toBe(2);
    expect(countMatches(receivableSheet, /<textarea /g)).toBe(1);
    expect(receivableSheet).toMatch(/onSubmit\(form\)/);
    expect(receivableSheet).not.toMatch(/type="date"|inputMode="decimal"|<select|parseINRToPaise|value=\{form\.amount|setForm\(\{ \.\.\.form, (amount|dueDate|status|clientId)/);
    expect(receivableSheet).toMatch(/onSubmit\(form\)/);
  });

  it("refuses to offer an edit form twice while a save is in flight", () => {
    expect(clientSheet).toMatch(/disabled=\{busy\}/);
    expect(receivableSheet).toMatch(/disabled=\{busy\}/);
    expect(clientSheet).toMatch(/if \(busy\) return/);
    expect(receivableSheet).toMatch(/if \(busy\) return/);
  });

  it("sends the token of the row that is on screen and nothing financial", () => {
    expect(clientEdit).toMatch(/clientRepository\.update\(/);
    expect(clientEdit).toMatch(/id: editingClient\.id/);
    expect(clientEdit).toMatch(/expectedUpdatedAt: editingClient\.updatedAt/);
    expect(receivableEdit).toMatch(/receivableRepository\.updateDetails\(/);
    expect(receivableEdit).toMatch(/id: selectedReceivable\.id/);
    expect(receivableEdit).toMatch(/expectedUpdatedAt: selectedReceivable\.updatedAt/);
    for (const handler of [clientEdit, receivableEdit]) {
      expect(handler, "an edit must refuse while another write is on the wire").toMatch(/!\s*beginWrite\(\)\)\s*return/);
      expect(handler, "the in-flight guard must be released even when the write fails").toMatch(/finally \{ endWrite\(\); \}/);
      expect(updatePayload(handler)).not.toMatch(/amount|dueDate|outstanding|status|clientId|ownerId|archived/i);
    }
  });

  // The handlers above only refuse if the guard itself is real: one flag, set
  // before the first await and cleared in a finally, is what makes a double
  // click arrive as one write.
  it("keeps the shared in-flight guard honest rather than decorative", () => {
    expect(homePage).toMatch(/function beginWrite\(\) \{ if \(savingRef\.current\) return false; savingRef\.current = true; setSaving\(true\); return true; \}/);
    expect(homePage).toMatch(/function endWrite\(\) \{ savingRef\.current = false; setSaving\(false\); \}/);
    const moneyHandlers = ["async function addPromise(", "async function recordPayment(", "async function addReceivable(", "async function addClient(", "async function closeReceivable(", "async function withdrawPromise("];
    for (const signature of moneyHandlers) {
      const handler = functionSource(homePage, signature);
      expect(handler, `${signature} must refuse a second concurrent write`).toMatch(/!\s*beginWrite\(\)\)\s*return/);
      expect(handler).toMatch(/finally \{ endWrite\(\); \}/);
    }
  });

  it("leaves a failed edit open, typed, and understandable instead of closing it", () => {
    for (const handler of [clientEdit, receivableEdit]) {
      const failure = catchBlock(handler);
      expect(failure).toMatch(/toast\.error\(/);
      expect(failure, "a refused edit must keep the sheet open with its content").not.toContain("setSheet(null)");
      expect(failure).not.toMatch(/raw|SQLSTATE|40001|P0002|policy|permission/i);
    }
    expect(clientEdit).toMatch(/try \{[\s\S]*setSheet\(null\)/);
    expect(receivableEdit).toMatch(/try \{[\s\S]*setSheet\(null\)/);
  });

  it("names the money history as untouched in the customer's own words", () => {
    expect(clientSheet).toMatch(/payment history stay exactly as they were/);
    expect(receivableSheet).toMatch(/Money history is never rewritten here/);
    expect(homePage).toMatch(/Amount and date unchanged/);
  });
});

// `signature` must end at the opening parenthesis of the parameter list, so the
// destructured props do not read as the function body.
function functionSource(source: string, signature: string) {
  const start = source.indexOf(signature);
  expect(start, `${signature} must be defined`).toBeGreaterThanOrEqual(0);
  let parens = 1;
  let parametersEnd = -1;
  for (let index = start + signature.length; index < source.length; index += 1) {
    if (source[index] === "(") parens += 1;
    if (source[index] === ")") {
      parens -= 1;
      if (parens === 0) {
        parametersEnd = index;
        break;
      }
    }
  }
  expect(parametersEnd, `${signature} must close its parameter list`).toBeGreaterThan(start);
  let braces = 0;
  for (let index = source.indexOf("{", parametersEnd); index < source.length; index += 1) {
    if (source[index] === "{") braces += 1;
    if (source[index] === "}") {
      braces -= 1;
      if (braces === 0) return source.slice(start, index + 1);
    }
  }
  throw new Error(`${signature} never closes`);
}

function editedKeys(sheetSource: string) {
  return [...sheetSource.matchAll(/setForm\(\{ \.\.\.form, (\w+):/g)].map((match) => match[1]).sort();
}

function countMatches(source: string, pattern: RegExp) {
  return [...source.matchAll(pattern)].length;
}

function updatePayload(handler: string) {
  const call = handler.match(/Repository\.update(Details)?\(\{([\s\S]*?)\}\)/);
  expect(call, "an edit must call its repository with a literal payload").not.toBeNull();
  return call![2];
}

function catchBlock(handler: string) {
  const start = handler.indexOf("catch (error) {");
  expect(start, "a save must report its failure").toBeGreaterThanOrEqual(0);
  const end = handler.indexOf("} finally", start);
  expect(end, "a save must always hand the form back").toBeGreaterThan(start);
  return handler.slice(start, end);
}
