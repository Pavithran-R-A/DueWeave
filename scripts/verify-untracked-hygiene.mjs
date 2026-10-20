import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

// Stage A PHASE CL-7: at head `4d82978` the repository root carried eight untracked, non-ignored
// entries — the QA identity and mailbox capture under `p3c-red-baseline/` (2.5 MB), the production
// row censuses under `prod-census/` (1.4 MB), two CI job-log exports, a deployed-build Playwright
// report, a database probe, and two loose scratch drivers. One `git add -A` would have staged all
// of it, and the release's credential scanner would have said nothing, because that scanner lists
// its scope with `git ls-files` — which answers what the index already knows, never what the next
// `add` would put into it.
//
// So this gate reads the staging surface itself. The rule it enforces is narrow and deliberate:
// nothing untracked and unignored may sit at the repository root, because a root entry is the one
// thing every `git add -A`, `git add .` and IDE "commit all" reaches with no further thought. The
// legal repairs are both visible in a diff: commit the file (a reviewer sees it), or name it in
// `.gitignore` with the instrument that writes it (a reviewer sees that).
//
// The wider surface — every untracked, non-ignored file at any depth — is read by
// `scripts/verify-secrets.mjs`, which now scans it for credential shapes. This file keeps the root
// tidy; that one keeps the contents clean.

const projectRoot = path.resolve(import.meta.dirname, "..");

/** Ask git for a NUL-separated file list, and fail if git will not answer. */
function gitList(args) {
  const result = spawnSync("git", [...args, "-z"], { cwd: projectRoot, encoding: "utf8" });
  if (result.status !== 0) {
    console.error(`Could not read the working tree with git ${args.join(" ")}: ${(result.stderr ?? "").trim()}`);
    process.exit(1);
  }
  return result.stdout.split("\0").filter(Boolean);
}

// `--directory` collapses a fully untracked tree into one entry ending in a slash, which is what a
// root listing should report: the artifact is the directory, and its hundreds of files are one
// accident. So a trailing slash marks a directory *at the root*, and the root test has to strip it
// before asking — otherwise the evidence directories, which are precisely what this gate exists to
// catch, would each be silently filtered out of the list they are named in.
const entries = gitList(["ls-files", "--others", "--exclude-standard", "--directory"]);
const stagingSurface = gitList(["ls-files", "--others", "--exclude-standard"]);

const loose = entries.filter((entry) => !entry.replace(/\/$/, "").includes("/"));

console.log(`Read the working tree: ${stagingSurface.length} untracked, non-ignored file(s) in the \`git add -A\` surface.`);
if (!loose.length) {
  console.log("The repository root carries no untracked, non-ignored artifact, so nothing at it can be staged by accident.");
  process.exit(0);
}

console.error(`${loose.length} untracked, non-ignored entr(y/ies) at the repository root — each one is inside what \`git add -A\` stages:`);
for (const entry of loose) {
  console.error(`  ${entry.endsWith("/") ? entry : `${entry} (file)`}`);
}
console.error(`Repair each one deliberately: commit it, or add a root-anchored rule for it to .gitignore naming the instrument that writes it.`);
console.error(`If it is QA evidence carrying a credential, neither: move it outside the repository and record the path pattern instead.`);
process.exit(1);
