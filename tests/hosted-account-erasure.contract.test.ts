import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// B17's open half. The erasure *boundary* has been proved on production — an unauthenticated
// `POST functions/v1/delete-account` is refused with 401, the preflight answers 204 with the site's
// own origin — but nobody has yet erased a real signed-in account and shown what the database looks
// like afterwards. "The account and its records are gone" is only evidence as two censuses and a
// delta, never as a description of the migration's DELETE statements.
//
// The rules this suite pins are the ones that decide whether the instrument can be trusted with a
// production account:
//   * an erasure is judged against the numbers it started with, so a row left behind, an account
//     still present, or an account count that moved by anything but one is a finding;
//   * collateral damage is a finding too — a table that sheds more rows than the erased account
//     owned means somebody else's data went with it;
//   * the October 5 orphans (auth rows naming no account) are counted and must not move, because the
//     standing instruction is to preserve them until separately authorised;
//   * nothing runs unless the operator passed the irreversible-action flag, and no credential value
//     — session token, refresh token, or password — may reach the report.
//
// Production is never contacted here. The census is answered by an injected fake, and the one case
// that exercises the real spawn path points the CLI at a stub printing the measured answer shape.

const projectRoot = path.resolve(import.meta.dirname, "..");
const QA_A = "5fbc55df-0cbc-4167-ae8a-aed24178b5cf";

const instrument = path.join(projectRoot, "scripts", "hosted-account-erasure.mjs");
const { buildSnapshot, erasureFindings, runErasure, buildEraseCall, parseErasureArgs, readCensusRows } = await import(`file:///${instrument.replace(/\\/g, "/").replace(/^\/+/, "")}`);

/** The measured production shape of one census, reduced to the five reads an erasure is judged by. */
function censusRows(spec: {
  users: { total: number; confirmed: number; unconfirmed: number };
  account?: { emailConfirmed: boolean };
  ledger: Record<string, number>;
  owner: Record<string, number>;
  auth?: Record<string, { total: number; orphaned: number; forOwner: number }>;
}) {
  const residue = Object.entries(spec.auth ?? {}).map(([auth_table, counts]) => ({
    auth_table,
    fk_to_users: auth_table === "flow_state" || auth_table === "refresh_tokens" ? "no foreign key" : "c",
    rows_total: counts.total,
    rows_without_user: counts.orphaned,
    rows_for_owner: counts.forOwner,
  }));
  return {
    "auth-users": [{ users_total: spec.users.total, confirmed: spec.users.confirmed, unconfirmed: spec.users.unconfirmed, sso_users: 0, identities: 3, sessions: 11, oldest_user: "2026-10-12 15:20:58 +0000 UTC", newest_user: "2026-10-14 11:02:31 +0000 UTC" }],
    "auth-residue": residue,
    "ledger-census": Object.entries(spec.ledger).map(([tbl, rows]) => ({ tbl, rows })),
    "owner-census": Object.entries(spec.owner).map(([tbl, rows]) => ({ tbl, rows })),
    "account-state": spec.account ? [{ account: "dueweave+releaseqa-20261012@gmail.com", email_confirmed: spec.account.emailConfirmed, email_confirmed_at: "2026-10-12 15:31:02 +0000 UTC", recovery_sent_at: null, last_sign_in_at: "2026-10-15 06:12:44 +0000 UTC", updated_at: "2026-10-15 06:12:44 +0000 UTC" }] : [],
  };
}

/** QA-A's ledger as measured on production 2026-10-15, plus QA-B so the deltas have a second owner. */
const REAL = {
  ledger: { activities: 5, analytics_events: 0, clients: 1, entitlements: 2, founder_admins: 0, founder_audit_events: 0, founder_offer_config: 1, payments: 1, profiles: 2, promise_events: 1, promises: 1, purchase_claims: 0, receivables: 1 },
  owner: { activities: 5, analytics_events: 0, clients: 1, entitlements: 1, founder_admins: 0, founder_audit_events: 0, payments: 1, profiles: 1, promise_events: 1, promises: 1, purchase_claims: 0, receivables: 1 },
  auth: { identities: { total: 4, orphaned: 2, forOwner: 1 }, one_time_tokens: { total: 2, orphaned: 0, forOwner: 1 }, sessions: { total: 14, orphaned: 11, forOwner: 1 }, refresh_tokens: { total: 14, orphaned: 11, forOwner: 1 } },
};

function before() {
  return buildSnapshot(censusRows({ users: { total: 2, confirmed: 1, unconfirmed: 1 }, account: { emailConfirmed: true }, ...REAL }));
}

/** What a clean erasure leaves: this account's rows gone, every other count exactly where it was. */
function afterClean() {
  const auth = Object.fromEntries(Object.entries(REAL.auth).map(([table, counts]) => [table, { total: counts.total - counts.forOwner, orphaned: counts.orphaned, forOwner: 0 }]));
  const ledger = Object.fromEntries(Object.entries(REAL.ledger).map(([table, rows]) => [table, rows - (REAL.owner[table] ?? 0)]));
  return buildSnapshot(censusRows({ users: { total: 1, confirmed: 0, unconfirmed: 1 }, ledger, owner: Object.fromEntries(Object.keys(REAL.owner).map((table) => [table, 0])), auth }));
}

const DELETED = { status: 200, body: { status: "deleted" } };
const REFUSED = { status: 400, body: { message: "Invalid login credentials" } };

/** A stand-in credential. Its only job is to be a value the instrument must never print, so it is
 *  spelled with the secret scanner's own placeholder vocabulary rather than a real shape. */
const FAKE_PASSWORD = "erasure-placeholder-pw";

const join = (lines: string[]) => lines.join("\n");

describe("hosted account erasure instrument", () => {
  it("accepts a clean erasure where every count lands exactly where the before census predicts", () => {
    expect(erasureFindings({ before: before(), after: afterClean(), functionOutcome: DELETED, credentialAfter: REFUSED })).toEqual([]);
  });

  it("reads the census rows into the numbers an erasure is judged by", () => {
    const snapshot = before();
    expect(snapshot.usersTotal).toBe(2);
    expect(snapshot.confirmed).toBe(1);
    expect(snapshot.unconfirmed).toBe(1);
    expect(snapshot.account.exists).toBe(true);
    expect(snapshot.account.emailConfirmed).toBe(true);
    expect(snapshot.ownerRows.activities).toBe(5);
    expect(snapshot.ledger.activities).toBe(5);
    expect(snapshot.auth.identities).toEqual({ total: 4, orphaned: 2, forOwner: 1 });
  });

  it("reports an erasure that left the auth account row in place", () => {
    const after = buildSnapshot(censusRows({ users: { total: 2, confirmed: 1, unconfirmed: 1 }, account: { emailConfirmed: true }, ledger: afterClean().ledger, owner: {}, auth: {} }));
    const findings = erasureFindings({ before: before(), after, functionOutcome: DELETED, credentialAfter: REFUSED });
    expect(join(findings)).toMatch(/account row .* still present/i);
  });

  it("reports business rows still owned by the erased account", () => {
    const after = afterClean();
    after.ownerRows.receivables = 1;
    after.ownerRows.payments = 2;
    const findings = erasureFindings({ before: before(), after, functionOutcome: DELETED, credentialAfter: REFUSED });
    expect(join(findings)).toMatch(/receivables/i);
    expect(join(findings)).toMatch(/payments/i);
  });

  it("reports auth-schema rows still naming the erased account", () => {
    const after = afterClean();
    after.auth.sessions = { total: 14, orphaned: 11, forOwner: 3 };
    const findings = erasureFindings({ before: before(), after, functionOutcome: DELETED, credentialAfter: REFUSED });
    const text = join(findings);
    expect(text).toMatch(/auth\.sessions/i);
    expect(text).toMatch(/naming the erased account/i);
  });

  it("refuses to call an erasure clean when the number of accounts moved by anything but one", () => {
    const after = afterClean();
    after.usersTotal = 2;
    expect(join(erasureFindings({ before: before(), after, functionOutcome: DELETED, credentialAfter: REFUSED }))).toMatch(/by 1/i);
  });

  // The dangerous direction: a purge whose condition is wider than the account. This is why the after
  // census is compared against whole-table counts and not only the erased account's own rows.
  it("names collateral loss when a table sheds more rows than the erased account owned", () => {
    const after = afterClean();
    after.ledger.profiles = 0;
    const text = join(erasureFindings({ before: before(), after, functionOutcome: DELETED, credentialAfter: REFUSED }));
    expect(text).toMatch(/profiles lost 2 rows, 1 of them owned/i);
    expect(text).toMatch(/another account/i);
  });

  // The other direction: the account's own after-census reads empty while the table only shed part of
  // the rows it held for that account. Nothing else in the instrument can see that — a row that moved
  // to another owner, or a census taken mid-transaction, both read as clean per-account counts.
  it("names a short ledger drop when the table lost fewer rows than the account owned", () => {
    const after = afterClean();
    after.ledger.activities = 1;
    const text = join(erasureFindings({ before: before(), after, functionOutcome: DELETED, credentialAfter: REFUSED }));
    expect(text).toMatch(/activities lost 4 rows while the erased account owned 5/i);
    expect(text).toMatch(/1 of its rows are still in the table/i);
  });

  it("holds the October 5 orphans to an exact count so their destruction cannot pass silently", () => {
    const after = afterClean();
    after.auth.identities = { total: 3, orphaned: 1, forOwner: 0 };
    after.auth.refresh_tokens = { total: 3, orphaned: 0, forOwner: 0 };
    const text = join(erasureFindings({ before: before(), after, functionOutcome: DELETED, credentialAfter: REFUSED }));
    expect(text).toMatch(/identities/i);
    expect(text).toMatch(/refresh_tokens/i);
    expect(text).toMatch(/orphan/i);
    expect(text).toMatch(/preserve/i);
  });

  it("treats an incomplete erasure as the failure it is, never as a success", () => {
    const outcome = { status: 500, body: { status: "incomplete", message: "DueWeave removed your business records but could not finish closing the account." } };
    const text = join(erasureFindings({ before: before(), after: afterClean(), functionOutcome: outcome, credentialAfter: { status: 200 } }));
    expect(text).toMatch(/incomplete/i);
    expect(text).toMatch(/records are gone/i);
  });

  it("reports an erased credential that still signs in", () => {
    const text = join(erasureFindings({ before: before(), after: afterClean(), functionOutcome: DELETED, credentialAfter: { status: 200 } }));
    expect(text).toMatch(/still signs in/i);
  });

  it("checks the confirmed and unconfirmed counts against the account that was removed", () => {
    const after = afterClean();
    after.unconfirmed = 2;
    expect(join(erasureFindings({ before: before(), after, functionOutcome: DELETED, credentialAfter: REFUSED }))).toMatch(/unconfirmed/i);
  });

  it("sends the confirmation phrase the function itself demands, with the caller's bearer and the site as origin", () => {
    const call = buildEraseCall({ token: "SESSION-TOKEN", site: "https://dueweave.pages.dev", api: "https://api.example.test" });
    expect(call.url).toBe("https://api.example.test/functions/v1/delete-account");
    expect(call.init.method).toBe("POST");
    expect(JSON.parse(String(call.init.body))).toEqual({ confirm: "DELETE MY ACCOUNT" });
    expect(call.init.headers).toMatchObject({ authorization: "Bearer SESSION-TOKEN", origin: "https://dueweave.pages.dev", "content-type": "application/json" });
  });

  it("refuses to erase anything until the operator passes the irreversible-action flag", async () => {
    const calls: string[] = [];
    const lines: string[] = [];
    const outcome = await runErasure({
      identity: { email: "qa@example.test", password: FAKE_PASSWORD },
      api: "https://api.example.test",
      confirmErasing: false,
      signIn: async () => { calls.push("signIn"); return { status: 200, token: "T", userId: QA_A }; },
      snapshot: async () => { calls.push("snapshot"); return censusRows({ users: { total: 0, confirmed: 0, unconfirmed: 0 }, ledger: {}, owner: {} }); },
      erase: async () => { calls.push("erase"); return DELETED; },
      log: (line: string) => lines.push(line),
    });
    expect(calls).toEqual([]);
    expect(outcome.refused).toBe(true);
    expect(outcome.findings).toEqual([]);
    expect(join(lines)).toMatch(/--confirm-erase/);
    expect(join(lines)).not.toContain(FAKE_PASSWORD);
  });

  it("stops before the erasure when the account cannot sign in, so nothing is left half-erased", async () => {
    const calls: string[] = [];
    const lines: string[] = [];
    const outcome = await runErasure({
      identity: { email: "qa@example.test", password: FAKE_PASSWORD },
      api: "https://api.example.test",
      confirmErasing: true,
      signIn: async () => { calls.push("signIn"); return { status: 400, token: "", userId: "" }; },
      snapshot: async () => { calls.push("snapshot"); return censusRows({ users: { total: 0, confirmed: 0, unconfirmed: 0 }, ledger: {}, owner: {} }); },
      erase: async () => { calls.push("erase"); return DELETED; },
      log: (line: string) => lines.push(line),
    });
    expect(calls).toEqual(["signIn"]);
    expect(outcome.refused).toBe(true);
    expect(join(lines)).toMatch(/could not sign in|was refused/i);
    expect(join(lines), "the refusal line carried the credential").not.toContain(FAKE_PASSWORD);
  });

  it("reads the before census, erases, reads the after census, then re-tries the credential", async () => {
    const calls: string[] = [];
    const lines: string[] = [];
    let snapshots = 0;
    const outcome = await runErasure({
      identity: { email: "qa@example.test", password: FAKE_PASSWORD },
      api: "https://api.example.test",
      confirmErasing: true,
      signIn: async () => {
        calls.push("signIn");
        return calls.length === 1 ? { status: 200, token: "SESSION-TOKEN-SECRET", userId: QA_A } : { status: 400, token: "", userId: "" };
      },
      snapshot: async (owner: string) => {
        calls.push(`snapshot:${owner}`);
        snapshots += 1;
        return snapshots === 1 ? censusRows({ users: { total: 2, confirmed: 1, unconfirmed: 1 }, account: { emailConfirmed: true }, ...REAL }) : censusRows({
          users: { total: 1, confirmed: 0, unconfirmed: 1 },
          ledger: Object.fromEntries(Object.entries(REAL.ledger).map(([table, rows]) => [table, rows - (REAL.owner[table] ?? 0)])),
          owner: Object.fromEntries(Object.keys(REAL.owner).map((table) => [table, 0])),
          auth: Object.fromEntries(Object.entries(REAL.auth).map(([table, counts]) => [table, { total: counts.total - counts.forOwner, orphaned: counts.orphaned, forOwner: 0 }])),
        });
      },
      erase: async () => { calls.push("erase"); return DELETED; },
      log: (line: string) => lines.push(line),
    });
    expect(calls).toEqual(["signIn", `snapshot:${QA_A}`, "erase", `snapshot:${QA_A}`, "signIn"]);
    expect(outcome.refused).toBe(false);
    expect(outcome.findings).toEqual([]);
    expect(join(lines)).toMatch(/FUNCTION delete-account HTTP 200 status=deleted/);
    const printed = join(lines);
    for (const secret of ["SESSION-TOKEN-SECRET", FAKE_PASSWORD]) {
      expect(printed, `the report carried a credential: ${secret}`).not.toContain(secret);
    }
  });

  it("refuses an unknown argument and defaults the irreversible action to off", () => {
    expect(() => parseErasureArgs(["--nonsense"])).toThrow(/usage/i);
    expect(parseErasureArgs([]).confirmErasing).toBe(false);
    expect(parseErasureArgs(["--identity", "x.json", "--confirm-erase", "--dry-run"]).confirmErasing).toBe(true);
  });

  // The census is only trustworthy if the JSON the CLI answers with is read, not eyeballed. This case
  // drives the real spawn against a stub printing the measured answer shape for each statement.
  it("turns the census statements into numbers through the CLI's json output", async () => {
    const snapshot = buildSnapshot(await readCensusRows({
      cli: path.join(projectRoot, "tests", "fixtures", "stub-census-cli.mjs"),
      url: "postgresql://postgres.example.test:5432/postgres",
      owner: QA_A,
      secrets: ["stub-password"],
    }));
    expect(snapshot.usersTotal).toBe(2);
    expect(snapshot.ownerRows.activities).toBe(5);
    expect(snapshot.ledger.profiles).toBe(2);
    expect(snapshot.auth.identities).toEqual({ total: 4, orphaned: 2, forOwner: 1 });
    expect(snapshot.account.exists).toBe(true);
  }, 60_000);

  it("is an operator command that no CI job or release gate may reach", () => {
    const packageJson = JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8")) as { scripts: Record<string, string> };
    expect(packageJson.scripts["verify:hosted:erasure"]).toBe("node scripts/hosted-account-erasure.mjs");
    for (const name of ["ci.yml", "live-public.yml", "release-full-browser.yml", "codeql-release.yml"]) {
      const body = readFileSync(path.join(projectRoot, ".github", "workflows", name), "utf8");
      expect(body, `${name} would erase a production account on every push`).not.toContain("hosted-account-erasure");
    }
    for (const gate of ["verify:release:local", "verify:e2e:local", "test:e2e:smoke"]) {
      expect(packageJson.scripts[gate], `${gate} reached the erasure instrument`).not.toContain("hosted-account-erasure");
    }
  });

  it("asks the census instrument for its numbers rather than re-authoring SQL", () => {
    expect(readFileSync(path.join(projectRoot, "scripts", "hosted-db-census.mjs"), "utf8")).toMatch(/export function census\b/);
    const source = readFileSync(instrument, "utf8");
    expect(source).toMatch(/from "\.\/hosted-db-census\.mjs"/);
    expect(source.match(/sql:/g)?.length).toBeUndefined();
  });
});
