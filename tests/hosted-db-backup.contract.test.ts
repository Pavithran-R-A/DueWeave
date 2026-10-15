import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Gate 7 of the release record asks for a zero-cost backup path the free plan can actually run, and
// every previous answer was a sentence: `supabase db dump` was named as the way to do it, and nobody
// had run it. Naming a command is not a backup. This is that command as an instrument on the same two
// rules the census already runs by — the credential comes from the operator's off-repo file and never
// reaches a printed line, and the dump lands outside the repository, because a production schema (or
// worse, its rows) sitting inside the working tree is one `git add -A` away from being published from
// a repository this release line keeps temporarily public.
//
// Nothing here reaches production. The CLI is a recording stub, as in the census contract, and the
// credential is a fixture.

const projectRoot = path.resolve(import.meta.dirname, "..");
const script = path.join(projectRoot, "scripts", "hosted-db-backup.mjs");

const SECRET = "sesame,open?#pw";
const ENCODED_SECRET = encodeURIComponent(SECRET);

function workspace() {
  return mkdtempSync(path.join(tmpdir(), "dw-hosted-backup-"));
}

/** A stand-in Supabase CLI that records its argument vector and echoes the `--db-url` it was handed,
 *  so a weak redaction would leak the credential into the very output the instrument produces. */
function stubCli(recordFile: string, outDir: string): string {
  const file = path.join(outDir, "stub-cli.mjs");
  writeFileSync(file, [
    "import { appendFileSync } from 'node:fs';",
    `appendFileSync(${JSON.stringify(recordFile)}, JSON.stringify(process.argv.slice(2)) + '\\n');`,
    "const url = process.argv.indexOf('--db-url');",
    "console.log('STUB ' + (url >= 0 ? process.argv[url + 1] : 'no url'));",
    "const out = process.argv.indexOf('--file');",
    "console.log('STUB wrote ' + (out >= 0 ? process.argv[out + 1] : 'nowhere'));",
    "process.exit(0);",
    "",
  ].join("\n"));
  return file;
}

function passwordFile(dir: string, password = SECRET): string {
  const file = path.join(dir, "prod-db-password");
  writeFileSync(file, `${password}\n`, { mode: 0o600 });
  return file;
}

function run(args: string[], env: Record<string, string> = {}): Promise<{ code: number | null; out: string; calls: string[][] }> {
  const dir = workspace();
  const recordFile = path.join(dir, "calls.jsonl");
  writeFileSync(recordFile, "");
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...args], {
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        DWEAVE_DB_PASSWORD_FILE: passwordFile(dir),
        DWEAVE_SUPABASE_CLI: stubCli(recordFile, dir),
        DWEAVE_BACKUP_DIR: path.join(dir, "backups"),
        ...env,
      },
    });
    let out = "";
    child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (out += chunk.toString()));
    child.on("close", (code) => {
      const raw = readFileSync(recordFile, "utf8").trim();
      resolve({ code, out, calls: raw ? raw.split("\n").map((line) => JSON.parse(line) as string[]) : [] });
    });
  });
}

describe("hosted database backup instrument", () => {
  it("names the dump it would run without running it, and keeps the credential out of its own plan", async () => {
    const { code, out, calls } = await run(["--dry-run"], {});
    expect(code).toBe(0);
    expect(out).toMatch(/dump/);
    expect(out).toContain("[redacted-db-password]");
    expect(out).not.toContain(SECRET);
    expect(out).not.toContain(ENCODED_SECRET);
    expect(calls, "a dry run reached the CLI").toEqual([]);
  });

  it("writes the dump outside the repository and derives a dated file name", async () => {
    const { code, out, calls } = await run([], {});
    expect(code).toBe(0);
    expect(calls.length).toBe(1);
    const call = calls[0]!;
    expect(call.slice(0, 2)).toEqual(["db", "dump"]);
    const file = call[call.indexOf("--file") + 1];
    // Dated from the run's own UTC clock rather than a flag: a backup file that cannot say when it
    // was taken is not evidence, and a `--when` knob would exist only to make this line assertable.
    expect(file).toMatch(/\d{8}T\d{6}Z/);
    expect(path.isAbsolute(file), `the dump path must be absolute, got ${file}`).toBe(true);
    expect(path.relative(projectRoot, file).startsWith(".."), `the dump would land inside the repository: ${file}`).toBe(true);
    expect(out).toContain("STUB wrote");
  });

  it("refuses a destination inside the repository before the CLI can write there", async () => {
    const inside = path.join(projectRoot, "p3c-red-baseline", "should-never-exist.sql");
    const { code, out, calls } = await run(["--out", inside], {});
    expect(code).not.toBe(0);
    expect(out).toMatch(/outside the repository/i);
    expect(calls, "a refused path still reached the CLI").toEqual([]);
    expect(existsSync(inside)).toBe(false);
  });

  it("hands the credential to a direct spawn percent-encoded, and never prints either form", async () => {
    const { code, out, calls } = await run([], {});
    expect(code).toBe(0);
    const sentUrl = calls[0]?.[calls[0].indexOf("--db-url") + 1] ?? "";
    expect(sentUrl).toContain(ENCODED_SECRET);
    expect(sentUrl, "the credential reached the URL unencoded").not.toContain(SECRET);
    expect(sentUrl).toMatch(/^postgresql:\/\/postgres\.ugzdqcytouwfdlcjujqv:/);
    expect(out).not.toContain(SECRET);
    expect(out, `the stub echoed the connection string into the output: ${out}`).not.toContain(ENCODED_SECRET);
  });

  it("dumps the structure by default and the rows only when the operator asks for them", async () => {
    const structure = await run(["--dry-run"], {});
    expect(structure.out).not.toMatch(/--data-only/);
    const rows = await run(["--dry-run", "--data"], {});
    expect(rows.out).toMatch(/--data-only/);
    // A row dump is customer data, so the plan has to say that rather than leave it implied.
    expect(rows.out).toMatch(/row|customer/i);
    expect(rows.out).toMatch(/not in git|outside the repository|never commit/i);
  });

  it("carries no connection-string shape in its own source, where the secrets gate would find one", () => {
    // The secrets scan reads tracked files only, so a script written this session hides its own text
    // from the gate until it is staged — which is exactly when it stopped being free to fix. A printed
    // plan may describe the argument, but no line of this file may look like `postgresql://user:pw@`.
    const source = readFileSync(script, "utf8");
    expect(source).not.toMatch(/postgres(?:ql)?:\/\/[^\s/@:'"`]+:[^\s@'"`]{6,}@/i);
  });

  it("refuses to run when the operator's password file is absent and never reaches the CLI", async () => {
    const { code, out, calls } = await run([], { DWEAVE_DB_PASSWORD_FILE: path.join(workspace(), "no-such-file") });
    expect(code).not.toBe(0);
    expect(out).toMatch(/prod-db-password/);
    expect(calls).toEqual([]);
  });

  it("is an operator command that no CI job or release gate may reach", () => {
    const packageJson = JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8")) as { scripts: Record<string, string> };
    expect(packageJson.scripts["verify:hosted:backup"]).toBe("node scripts/hosted-db-backup.mjs");
    const workflows = readFileSync(path.join(projectRoot, ".github", "workflows", "ci.yml"), "utf8");
    expect(workflows).not.toContain("hosted-db-backup");
    for (const gate of ["verify:release:local", "verify:e2e:local", "test:e2e:smoke"]) {
      expect(packageJson.scripts[gate]).not.toContain("hosted-db-backup");
    }
  });
});
