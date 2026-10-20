#!/usr/bin/env node
// Gate 7 of the release record asks for a zero-cost backup path the free plan can run, and until now
// the answer was a sentence naming `supabase db dump`. This makes it an executable step, and carries
// over the two rules the census already runs by: the credential comes from the operator's off-repo
// password file and is scrubbed from every printed byte, and the target address is the session pooler
// measured to be the only one this network can route to.
//
// The third rule is the one a hand-run dump gets wrong. This repository is temporarily public, so a
// dump written anywhere inside the working tree is one broad `git add` away from publishing the
// production schema — and with `--data`, every customer row in it. The default destination is
// therefore outside the repository, and `--out` cannot point inside it.
//
// Two modes, because the CLI offers two: the structure (its own migration-equivalent DDL) and, with
// `--data`, the rows. Run both and the pair is the backup; a restore rehearses against the structure.
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import process from "node:process";

const DEFAULT_REF = "ugzdqcytouwfdlcjujqv";
const DEFAULT_POOLER_HOST = "aws-0-ap-south-1.pooler.supabase.com";
const DEFAULT_POOLER_PORT = "5432";
const REDACTION = "[redacted-db-password]";
const projectRoot = path.resolve(import.meta.dirname, "..");

const passwordPath = () => process.env.DWEAVE_DB_PASSWORD_FILE ?? path.join(homedir(), ".config/dueweave/prod-db-password");
const cliPath = () => process.env.DWEAVE_SUPABASE_CLI ?? path.resolve("node_modules/supabase/dist/supabase.js");
const backupDir = () => process.env.DWEAVE_BACKUP_DIR ?? path.join(homedir(), ".local", "share", "dueweave", "backups");
const scrub = (text, secrets) => secrets.reduce((acc, secret) => (secret ? acc.split(secret).join(REDACTION) : acc), text);

/** `2026-10-15T06:45:00.123Z` becomes `20261015T064500Z`: the stamp a backup file has to carry so that
 *  a restored database can be pointed at the moment it came from. */
function stamp(now = new Date()) {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/** True for a path the repository would track: inside it, or equal to it. */
function isInsideRepository(target) {
  const relative = path.relative(projectRoot, target);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function parseArgs(argv) {
  const options = { ref: DEFAULT_REF, host: DEFAULT_POOLER_HOST, port: DEFAULT_POOLER_PORT, data: false, dryRun: false, out: "" };
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--data") options.data = true;
    else if (flag === "--dry-run") options.dryRun = true;
    else if (flag === "--out") options.out = path.resolve(String(argv[++index] ?? ""));
    else if (flag === "--project-ref") options.ref = String(argv[++index] ?? "");
    else if (flag === "--pooler-host") options.host = String(argv[++index] ?? "");
    else if (flag === "--pooler-port") options.port = String(argv[++index] ?? "");
    else {
      console.error(`unknown argument: ${flag}`);
      console.error("usage: node scripts/hosted-db-backup.mjs [--data] [--out <file>] [--dry-run] [--project-ref <ref>] [--pooler-host <host>] [--pooler-port <port>]");
      process.exit(2);
    }
  }
  return options;
}

function connectionUrl(ref, host, port, password) {
  const url = new URL(`postgresql://${encodeURIComponent(`postgres.${ref}`)}@${host}:${port}/postgres`);
  url.password = encodeURIComponent(password);
  return url.toString();
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  const target = options.out || path.join(backupDir(), `dueweave-hosted-${options.data ? "rows" : "schema"}-${stamp()}.sql`);
  if (isInsideRepository(target)) {
    console.error(`refused: the dump must land outside the repository, because this tree is published. Got ${target}`);
    return 1;
  }
  const args = ["db", "dump", "--file", target];
  // The structure half is application-only, so the row half must be too. An unrestricted data dump also
  // emits auth.users inserts, and GoTrue owns that schema: its columns differ between versions, so those
  // rows fail halfway through a restore into a project-shaped target, and identities need GoTrue's own
  // recovery path rather than raw SQL. The rehearsal measured exactly that on 2026-10-20.
  if (options.data) args.push("--data-only", "--schema", "public");

  console.log(`TARGET ref=${options.ref} user=postgres.${options.ref} host=${options.host} port=${options.port} database=postgres password=${REDACTION}`);
  console.log(`DUMP would dump ${options.data ? "the rows" : "the structure"} of the hosted project to ${target}`);
  // The plan names the argument without spelling its shape: a `scheme://user:pass@host` literal in
  // this file is a credential pattern to the secrets gate even when the password field holds a marker,
  // and the line above already prints every field the connection string is assembled from.
  console.log(`ARGS ${[...args, "--db-url", `<pooler connection string for postgres.${options.ref}, password ${REDACTION}>`].join(" ")}`);
  if (options.data) {
    console.log("NOTE this file holds production rows — client names, receivables, promises, payments. It stays outside the repository and is never committed.");
    console.log("SCOPE public schema only; auth identities belong to GoTrue and are not in this dump, so account recovery is not claimed from this file.");
  }
  if (options.dryRun) {
    console.log("DRY-RUN nothing was read and no file was written");
    return 0;
  }

  const file = passwordPath();
  if (!existsSync(file)) {
    console.error(`refused: no hosted database password at ${file} — it lives off-repo at ~/.config/dueweave/prod-db-password, mode 600`);
    return 1;
  }
  const password = readFileSync(file, "utf8").trim();
  const secrets = [password, encodeURIComponent(password)];
  const url = connectionUrl(options.ref, options.host, options.port, password);
  mkdirSync(path.dirname(target), { recursive: true });
  console.log(`RUN ${options.data ? "row" : "structure"} dump`);
  return new Promise((resolve) => {
    // The URL carries the credential, so it goes to a directly spawned child as one argument and never
    // through a shell, which would put it in a command line other tooling can read back.
    const child = spawn(process.execPath, [cliPath(), ...args, "--db-url", url], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (chunk) => (out += chunk));
    child.stderr.on("data", (chunk) => (out += chunk));
    child.on("error", (error) => resolve({ code: 1, text: `could not start the Supabase CLI: ${error.message}\n` }));
    child.on("close", (code) => resolve({ code: code ?? 1, text: out }));
  }).then((result) => {
    process.stdout.write(scrub(result.text, secrets));
    if (result.code === 0) console.log(`DONE ${target}`);
    else console.log(`FAILED dump exited ${result.code}; no backup should be claimed from this run`);
    return result.code;
  });
}

Promise.resolve(main()).then((code) => process.exit(code), (error) => {
  console.error(`backup failed: ${error?.message ?? error}`);
  process.exit(1);
});
