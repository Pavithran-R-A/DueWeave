import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import path from "node:path";
import process from "node:process";

// PHASE 21: the committed migrations and the database a release candidate was
// qualified against have to be the same set. `supabase db reset` replays whatever is on
// disk, so a file that silently fails to apply, or a version applied by hand into a
// long-lived stack and never committed, both leave the shipped schema and the replayed
// schema disagreeing. This compares the two and names the difference.

const projectRoot = path.resolve(import.meta.dirname, "..");
const migrationsDir = path.join(projectRoot, "supabase", "migrations");

function committedVersions() {
  return readdirSync(migrationsDir)
    .filter((file) => file.endsWith(".sql"))
    .map((file) => file.split("_")[0])
    .sort();
}

function appliedVersions() {
  const cliEntry = path.join(projectRoot, "node_modules", "supabase", "dist", "supabase.js");
  const result = spawnSync(process.execPath, [cliEntry, "db", "query", "--local", "--output", "json", "select version from supabase_migrations.schema_migrations order by version"], {
    cwd: projectRoot,
    encoding: "utf8",
  });
  if (result.status !== 0) {
    throw new Error(`Could not read the applied migration list from the local database:\n${result.stderr || result.stdout}`);
  }
  const stdout = result.stdout;
  const payload = JSON.parse(stdout.slice(stdout.indexOf("[")));
  return payload.map((row) => row.version).sort();
}

const committed = committedVersions();
const applied = appliedVersions();

const missing = committed.filter((version) => !applied.includes(version));
const extra = applied.filter((version) => !committed.includes(version));

console.log(`Migrations on disk: ${committed.length}. Applied in the local database: ${applied.length}.`);
if (missing.length) console.error(`Not applied (a replay would produce a different schema): ${missing.join(", ")}`);
if (extra.length) console.error(`Applied but not committed (this database is not reproducible from the repository): ${extra.join(", ")}`);
if (missing.length || extra.length) process.exit(1);
console.log("The replayed schema and the qualified schema are the same migration set.");
