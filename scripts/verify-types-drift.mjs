import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

// PHASE 20: the generated database types are the client's view of the schema, and they
// are committed so a reviewer can read the diff a migration caused. Committed artifacts
// rot. This regenerates them from the running local schema and compares, without
// touching the working tree, so the gate says "regenerate and commit" instead of
// leaving a stale file that typechecks against a schema nobody has.

const projectRoot = path.resolve(import.meta.dirname, "..");
const target = path.join(projectRoot, "client", "src", "types", "database.generated.ts");
const cliEntry = path.join(projectRoot, "node_modules", "supabase", "dist", "supabase.js");

if (!existsSync(cliEntry)) {
  console.error("Supabase CLI is not installed. Run `pnpm install --frozen-lockfile` first.");
  process.exit(1);
}
if (!existsSync(target)) {
  console.error(`${path.relative(projectRoot, target)} is missing. Run \`pnpm db:types\`.`);
  process.exit(1);
}

const result = spawnSync(process.execPath, [cliEntry, "gen", "types", "typescript", "--local", "--schema", "public"], {
  cwd: projectRoot,
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
});
if (result.status !== 0) {
  console.error("Could not generate types from the local schema. Is `pnpm supabase:start` running?");
  console.error(result.stderr.trim());
  process.exit(1);
}

const normalise = (text) => text.replace(/\r\n/g, "\n").replace(/[ \t]+$/gm, "").trimEnd();
const generated = normalise(result.stdout);
const committed = normalise(readFileSync(target, "utf8"));

if (generated === committed) {
  console.log(`${path.relative(projectRoot, target)} matches the local schema (${committed.length} bytes).`);
  process.exit(0);
}

const generatedLines = generated.split("\n");
const committedLines = committed.split("\n");
let first = 0;
while (first < generatedLines.length && first < committedLines.length && generatedLines[first] === committedLines[first]) first += 1;
console.error(`${path.relative(projectRoot, target)} is stale: the local schema generates ${generatedLines.length} lines, the committed file has ${committedLines.length}.`);
console.error(`First difference at line ${first + 1}:`);
console.error(`  committed: ${committedLines[first] ?? "<absent>"}`);
console.error(`  generated: ${generatedLines[first] ?? "<absent>"}`);
console.error("Run `pnpm db:types` and commit the result.");
process.exit(1);
