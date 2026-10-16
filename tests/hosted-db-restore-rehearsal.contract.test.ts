import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Gate 7 of the release record asks for a zero-cost backup *and restore*, and the backup half had become
// an instrument while the restore half was still a sentence. This rehearses it for real, and carries the
// one thing the first executed rehearsal proved: the structure dump restores cleanly into a
// Supabase-provisioned database (13 tables, 15 policies, 51 functions, 21 triggers, 36 indexes, 93
// constraints — identical to the migration-built one) but into a plain `createdb` database it restores 13
// tables, 51 functions and 21 triggers and **0 of the 15 row-level-security policies**, because every
// policy calls `auth.uid()` and no `auth` schema exists there. psql answered exit 0 while errors went to
// stderr, so an operator following the runbook would have called that a successful recovery of a database
// enforcing no tenant isolation at all. The instrument therefore refuses such a target before feeding a
// single byte of the dump.
//
// Nothing here touches production. `docker` is a recording stub, the hosted census is replayed from a
// fixture, and the password is a fixture string that must never appear in an output line or an argv.

const projectRoot = path.resolve(import.meta.dirname, "..");
const script = path.join(projectRoot, "scripts", "hosted-db-restore-rehearsal.mjs");

const SECRET = "sesame,open?#pw";
const POOLER_HOST = "aws-0-ap-south-1.pooler.supabase.com";

function censusLine(overrides: Record<string, number> = {}): string {
  const base: Record<string, number> = {
    tables: 13,
    views: 0,
    functions: 51,
    triggers: 21,
    policies: 15,
    indexes: 36,
    sequences: 0,
    rls_tables: 13,
    constraints: 93,
  };
  return Object.entries({ ...base, ...overrides })
    .map(([key, value]) => `${key}=${value}`)
    .join(" ");
}

function workspace(options: {
  schemas?: string;
  appTables?: string;
  productionCensus?: string;
  restoredCensus?: string;
  restoreStderr?: string;
} = {}) {
  const dir = mkdtempSync(path.join(tmpdir(), "dw-rehearse-"));
  const dump = path.join(dir, "dueweave-hosted-schema-20261016T152904Z.sql");
  writeFileSync(dump, 'CREATE POLICY "clients_owner_all" ON "public"."clients" FOR ALL TO "authenticated";\n');

  const recordFile = path.join(dir, "calls.jsonl");
  writeFileSync(recordFile, "");
  const answersFile = path.join(dir, "answers.json");
  // Ordered: the stub replays the first key found in the argv it was handed. `-f -` is the restore itself,
  // so a refusal test that finds no such call proves no dump byte was fed.
  writeFileSync(
    answersFile,
    JSON.stringify({
      NONEMPTY_PROBE: `NONEMPTY_PROBE=${options.appTables ?? "0"}\n`,
      [POOLER_HOST]: `${options.productionCensus ?? censusLine()}\n`,
      "-f -": `${options.restoreStderr ? `###stderr###${options.restoreStderr}` : ""}`,
      CENSUS_PROBE: `${options.restoredCensus ?? censusLine()}\n`,
      nspname: `${options.schemas ?? "auth\nextensions\nrealtime\nstorage\nvault"}\n`,
    }),
  );

  const stub = path.join(dir, "stub-docker.mjs");
  writeFileSync(
    stub,
    [
      "import { appendFileSync, readFileSync } from 'node:fs';",
      `const record = ${JSON.stringify(recordFile)};`,
      `const answers = JSON.parse(readFileSync(${JSON.stringify(answersFile)}, 'utf8'));`,
      "const joined = process.argv.slice(2).join(' ');",
      `appendFileSync(record, JSON.stringify(process.argv.slice(2)) + '\\n');`,
      "for (const key of Object.keys(answers)) {",
      "  if (!joined.includes(key)) continue;",
      "  const value = answers[key];",
      "  const marker = '###stderr###';",
      "  if (value.includes(marker)) process.stderr.write(marker + value.split(marker)[1]);",
      "  const head = value.includes(marker) ? value.split(marker)[0] : value;",
      "  if (head) process.stdout.write(head);",
      "  process.exit(0);",
      "}",
      "process.exit(0);",
      "",
    ].join("\n"),
  );

  const password = path.join(dir, "prod-db-password");
  writeFileSync(password, `${SECRET}\n`, { mode: 0o600 });
  return { dir, dump, recordFile, stub, password };
}

function run(
  args: string[],
  options: Parameters<typeof workspace>[0] = {},
  extraEnv: Record<string, string> = {},
): Promise<{ code: number | null; out: string; calls: string[][] }> {
  const work = workspace(options);
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, "--dump", work.dump, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        DWEAVE_DB_PASSWORD_FILE: work.password,
        DWEAVE_DOCKER_BIN: work.stub,
        DWEAVE_POOLER_HOST: POOLER_HOST,
        DWEAVE_RESTORE_CONTAINER: "dueweave-restore-rehearsal",
        DWEAVE_RESTORE_DATABASE: "postgres",
        ...extraEnv,
      },
    });
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk.toString()));
    child.stderr.on("data", (chunk) => (out += chunk.toString()));
    child.on("close", (code) => {
      const calls = readFileSync(work.recordFile, "utf8")
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as string[]);
      resolve({ code, out, calls });
    });
  });
}

const restoreCall = (calls: string[][]) => calls.find((argv) => argv.join(" ").includes("-f -"));

describe("a restore rehearsal refuses a target that cannot hold the backup", () => {
  it("stops before feeding the dump when the Supabase auth schema is absent", async () => {
    const result = await run([], { schemas: "public\nrealtime\nstorage\nextensions\nvault" });
    expect(result.code).toBe(1);
    expect(result.out).toMatch(/auth/);
    expect(restoreCall(result.calls)).toBeUndefined();
  });

  it("names row-level security as the thing a plain database silently loses", async () => {
    const result = await run([], { schemas: "public\nrealtime\nstorage\nextensions\nvault" });
    expect(result.out.toLowerCase()).toContain("row-level security");
  });

  it("refuses a target that already holds application tables, because the dump is not idempotent", async () => {
    const result = await run([], { appTables: "13" });
    expect(result.code).toBe(1);
    expect(result.out).toMatch(/not empty|already/i);
    expect(restoreCall(result.calls)).toBeUndefined();
  });

  it("accepts that non-empty target only when the operator says they mean it", async () => {
    const result = await run(["--allow-non-empty"], { appTables: "13" });
    expect(result.code).toBe(0);
    expect(restoreCall(result.calls)).toBeDefined();
  });

  it("refuses a dump file that does not exist", async () => {
    const work = workspace();
    const code = await new Promise<number | null>((resolve) => {
      const child = spawn(process.execPath, [script, "--dump", path.join(work.dir, "absent.sql")], {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, DWEAVE_DB_PASSWORD_FILE: work.password, DWEAVE_DOCKER_BIN: work.stub },
      });
      let out = "";
      child.stdout.on("data", (chunk) => (out += chunk.toString()));
      child.stderr.on("data", (chunk) => (out += chunk.toString()));
      child.on("close", () => {
        expect(out).toMatch(/dump/i);
        resolve(child.exitCode);
      });
    });
    expect(code).toBe(1);
    expect(existsSync(work.dump)).toBe(true);
  });
});

describe("the rehearsal restores, then proves what came back", () => {
  it("feeds the dump with ON_ERROR_STOP so a half restore cannot report success", async () => {
    const result = await run([]);
    const call = restoreCall(result.calls);
    expect(call).toBeDefined();
    expect(call!.join(" ")).toMatch(/ON_ERROR_STOP=1/);
  });

  it("reports the census pair it compared", async () => {
    const result = await run([]);
    expect(result.code).toBe(0);
    expect(result.out).toMatch(/PRODUCTION .*tables=13/);
    expect(result.out).toMatch(/RESTORED .*tables=13/);
    expect(result.out).toMatch(/MATCH/);
  });

  it("reads the reference census from the hosted project, not from a local database", async () => {
    const result = await run([]);
    const censusCall = result.calls.find((argv) => argv.join(" ").includes(POOLER_HOST));
    expect(censusCall).toBeDefined();
    expect(censusCall!.join(" ")).toMatch(/postgres\.ugzdqcytouwfdlcjujqv/);
  });

  it("exits 1 when a policy count comes back short", async () => {
    const result = await run([], { restoredCensus: censusLine({ policies: 0 }) });
    expect(result.code).toBe(1);
    expect(result.out).toMatch(/MISMATCH/);
    expect(result.out).toMatch(/policies=0/);
  });

  it("exits 1 and shows the database's own words when the restore errors", async () => {
    const result = await run([], { restoreStderr: 'ERROR:  type "user_role" does not exist\n' });
    expect(result.code).toBe(1);
    expect(result.out).toMatch(/does not exist/);
  });

  it("passes the hosted password through the environment and never prints it", async () => {
    const result = await run([]);
    expect(result.out).not.toContain(SECRET);
    expect(JSON.stringify(result.calls)).not.toContain(SECRET);
  });

  it("asks docker exec to forward PGPASSWORD, which it does not do unless told", async () => {
    // The first rehearsal against the real pooler stopped at `fe_sendauth: no password supplied`: a
    // `docker exec` child gets only the container's own environment, so a client-side PGPASSWORD is
    // silently absent inside. The key must be named without its value, or the secret lands in argv.
    const result = await run([]);
    const censusCall = result.calls.find((argv) => argv.join(" ").includes(POOLER_HOST));
    expect(censusCall).toContain("-e");
    expect(censusCall).toContain("PGPASSWORD");
    expect(censusCall!.join(" ")).not.toMatch(/PGPASSWORD=/);
  });

  it("sends psql a SELECT, not the bare expression list the recording stub would have accepted", async () => {
    // The same rehearsal's second attempt died at `syntax error at or near "'CENSUS_PROBE'"`: the census is
    // built by joining counts with `||`, and a stub that replays a fixture never parses it. Real psql does.
    const result = await run([]);
    const hosted = result.calls.find((call) => call.join(" ").includes(POOLER_HOST));
    const local = result.calls.find((call) => call.join(" ").includes("127.0.0.1") && call.join(" ").includes("CENSUS_PROBE"));
    for (const argv of [hosted, local]) {
      expect(argv).toBeDefined();
      expect(argv!.at(-1)!.startsWith("select ")).toBe(true);
    }
  });
});
