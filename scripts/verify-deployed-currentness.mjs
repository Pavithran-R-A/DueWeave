import { execFileSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

// CL-7 final corrections, item 10. Three instruments used to share the word "deployed", and this
// is the one that was missing:
//   - `deployment-settled-check.mjs` answers "has the site stopped being rebuilt";
//   - `verify-deployed-parity.mjs` answers "do the served bytes equal this local build";
//   - this answers "which commit does the deployment itself say it is".
// Only the last can certify an exact-head release. On 2026-10-20 production served the 2a4872c
// entry 34 minutes after the push that added the trust documents: the site agreed with itself at
// every read, so the settle check called it stable, and a local build of 2a4872c would have
// matched it byte for byte. Stability is not currency.
//
// The deployment's answer comes from `/build-info.json`, emitted by `scripts/build-info.mjs` from
// CF_PAGES_COMMIT_SHA / GITHUB_SHA / DUEWEAVE_BUILD_COMMIT. Every failure is closed:
//   - the file missing, or the SPA fallback answering for it with HTTP 200;
//   - unparsable JSON or a schema this gate does not know;
//   - a stamp that names no commit (a laptop upload) or only a prefix of one;
//   - a commit that differs from the target by a single character.
// A deployment built before this stamp existed answers the SPA document here, which is why the
// first run against production must fail until a stamp-bearing build is deployed.
//
// It is an operator certification command, never a CI step: a deployment that lags its branch is
// normal, and CI must not turn that into a red build. `tests/deployed-currentness.contract.test.ts`
// holds that line and every refusal above.

const projectRoot = path.resolve(import.meta.dirname, "..");
const FULL_OBJECT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

function parseArgs(argv) {
  const options = { url: "https://dueweave.pages.dev", sha: null };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token !== "--url" && token !== "--sha") {
      console.error(`Unrecognised argument "${token}". Expected --url <origin> and --sha <commit>.`);
      process.exit(2);
    }
    const value = argv[index + 1];
    if (!value) {
      console.error(`${token} needs a value.`);
      process.exit(2);
    }
    options[token.slice(2)] = value;
    index += 1;
  }
  return options;
}

function targetCommit(requested) {
  if (requested) return requested.trim().toLowerCase();
  try {
    return execFileSync("git", ["-C", projectRoot, "rev-parse", "HEAD"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] })
      .trim()
      .toLowerCase();
  } catch {
    console.error("No --sha was given and this checkout has no readable HEAD. Pass --sha <full commit id> explicitly.");
    process.exit(2);
  }
}

const { url, sha } = parseArgs(process.argv.slice(2));

let origin;
try {
  origin = new URL(url);
} catch {
  console.error(`--url must be a full http(s) origin, and "${url}" is not one.`);
  process.exit(2);
}
if (origin.protocol !== "http:" && origin.protocol !== "https:") {
  console.error(`--url must be served over http or https; "${url}" is ${origin.protocol}, which is not a deployment.`);
  process.exit(2);
}

// The target is checked before the network is touched: a malformed target can never match, and a
// gate that asks anyway invites a reader to treat the request as the measurement.
const target = targetCommit(sha);
if (!FULL_OBJECT.test(target)) {
  console.error(`The target must be a full commit id (40 or 64 hex characters), and "${target}" is not one. A short SHA cannot be compared exactly.`);
  process.exit(2);
}

let response;
try {
  response = await fetch(new URL("/build-info.json", origin), {
    cache: "no-store",
    redirect: "follow",
    headers: { "cache-control": "no-cache" },
    signal: AbortSignal.timeout(30_000),
  });
} catch (error) {
  console.error(`NOT CURRENT — ${origin.origin} could not be reached, so no commit was read (${error instanceof Error ? error.message : String(error)}).`);
  process.exit(1);
}

if (response.status !== 200) {
  console.error(`NOT CURRENT — ${origin.origin}/build-info.json answered HTTP ${response.status}. A deployment that publishes no commit stamp cannot be certified current.`);
  process.exit(1);
}

const body = await response.text();
let stamp;
try {
  stamp = JSON.parse(body);
} catch {
  console.error(
    `NOT CURRENT — ${origin.origin} answered /build-info.json with something that is not a build stamp ` +
      `(${response.headers.get("content-type") ?? "no content type"}, ${body.length} bytes). A deployment built before this stamp existed ` +
      `answers its SPA fallback here with HTTP 200, and a bundle that reads the same twice is stable, not current.`,
  );
  process.exit(1);
}

if (!stamp || typeof stamp !== "object" || stamp.schema !== 1) {
  console.error(`NOT CURRENT — ${origin.origin} serves a build stamp with schema ${JSON.stringify(stamp?.schema ?? null)}, which this gate does not understand.`);
  process.exit(1);
}

const served = typeof stamp.commit === "string" ? stamp.commit.trim().toLowerCase() : "";
const source = typeof stamp.source === "string" ? stamp.source : "unstated";

if (!served) {
  console.error(
    `NOT CURRENT — ${origin.origin} serves a build stamp that names no commit (source: ${source}). ` +
      `A locally built direct upload carries no commit; rebuild with CF_PAGES_COMMIT_SHA set, or state the claim with DUEWEAVE_BUILD_COMMIT.`,
  );
  process.exit(1);
}
if (!FULL_OBJECT.test(served)) {
  console.error(`NOT CURRENT — ${origin.origin} serves a partial commit id "${served}" (source: ${source}); this gate compares full object names only.`);
  process.exit(1);
}
if (served !== target) {
  console.error(`NOT CURRENT — ${origin.origin} serves ${served} (source: ${source}), and the target is ${target}. The deployment is a different commit from the one being certified.`);
  process.exit(1);
}

console.log(`CURRENT — ${origin.origin} serves commit ${served} (source: ${source}), which is the target commit.`);
