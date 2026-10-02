import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";

// D-S9-14: `supabase db reset` drops the database ("Recreating database") while this project's
// realtime container is still running, and a realtime node that loses its database reconnects
// and runs its own Ecto migration pass. The replay runs a second pass, from a transient
// container, against the same freshly created database. Both writers insert the same version
// into `_realtime.schema_migrations`, one of them loses on `schema_migrations_pkey`, and the
// replay dies with `error running container: exit 1` (run 34's browser job). Removing the
// second writer from the window is the repair; the reset's own "Restarting containers" phase,
// or the restore step, brings the stack back.
//
// This host carries other projects' stacks, so the command addresses one exact container whose
// name is derived from this checkout's declared project id. There is no pattern, no filter and
// no guessed default: a checkout that declares no project id is an error, because stopping
// nothing while reporting success would put the race back.

const projectRoot = { value: path.resolve(import.meta.dirname, "..") };

function parse(argv) {
  const verbs = [];
  const flags = [];
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--dry-run" || token === "--project-root") {
      flags.push(token);
      if (token === "--project-root") projectRoot.value = path.resolve(argv[++i] ?? "");
    } else {
      verbs.push(token);
    }
  }
  return { dryRun: flags.includes("--dry-run"), verb: verbs[0], unexpected: verbs.slice(1) };
}

function readProjectId(root) {
  const text = readFileSync(path.join(root, "supabase", "config.toml"), "utf8");
  return /^\s*project_id\s*=\s*"([^"]+)"\s*$/m.exec(text)?.[1];
}

const { dryRun, verb, unexpected } = parse(process.argv.slice(2));
const fail = (problem) => {
  console.error(`local-realtime-pause: ${problem}`);
  process.exit(1);
};

if (unexpected.length > 0) fail(`unexpected argument(s): ${unexpected.join(" ")}`);

const command = { stop: ["stop", "-t", "5"], start: ["start"] }[verb ?? ""];
if (!command) {
  fail(`unknown verb ${verb ?? "(none)"}; expected \`stop\` or \`start\`.`);
}

let projectId;
try {
  projectId = readProjectId(projectRoot.value);
} catch (error) {
  fail(`could not read ${projectRoot.value}/supabase/config.toml: ${error.message}`);
}
if (!projectId) fail(`no project_id declared in ${projectRoot.value}/supabase/config.toml.`);

const container = `supabase_realtime_${projectId}`;
const dockerArgs = [...command, container];
if (dryRun) {
  console.log(`docker ${dockerArgs.join(" ")}`);
  process.exit(0);
}

process.exit(spawnSync("docker", dockerArgs, { stdio: "inherit" }).status ?? 1);
