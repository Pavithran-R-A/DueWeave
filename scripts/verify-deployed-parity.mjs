// Compares a local build against a deployed site, file by file, so "the exact SHA is live" is a
// measurement rather than a belief. The hosted launch plan ends with a Cloudflare rebuild and an
// exact-SHA parity check; this is the command that answers it:
//
//   pnpm build                       # or `pnpm test:e2e:paused` to fill dist-paused/
//   node scripts/verify-deployed-parity.mjs --dist dist-paused --url https://dueweave.pages.dev
//
// Three deliberate rules, all learned by measuring production on 2026-10-13 rather than by
// guessing. The first live run of this instrument reported 5 of 22 files as mismatching, and
// measuring those five individually is what produced rules two and three:
//   - Files under `assets/` are compared byte for byte. Their names carry a content hash, so a
//     single changed character is a different artifact and must be reported.
//   - Everything else the build produces — `index.html`, `manifest.json`, `brand/*.svg` — is
//     copied out of the checkout verbatim, and this checkout has `core.autocrlf=true`, so those
//     files arrive with carriage returns that no Linux build (CI, Cloudflare) ever serves. They
//     are compared with carriage returns removed; without that, every run from this machine would
//     cry defect, and with it applied to `assets/` too a real change would be excused.
//   - `_headers` and `_redirects` are never compared at all. Pages consumes them as
//     configuration, so a GET returns the SPA `index.html` instead of their bytes and byte
//     parity is meaningless. What they promise is verified on live responses: the headers a
//     `_headers` pattern declares must be on the reply for the files it covers, and the status a
//     `_redirects` rule declares must answer for a path the build does not contain.
//   - Artifacts are fetched through redirects, since Pages answers `/index.html` with HTTP 308 to
//     `/`; `_redirects` probes are not followed, because the status is the promise being tested.
//
// It is a laptop and operator command, never a CI step: CI compares against whatever the site
// serves at that moment, and a deployment that legitimately lags the branch is not a test
// failure. `tests/deployed-artifact-parity.contract.test.ts` holds that line.
import { createHash } from "node:crypto";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

/** Vite's default `assetsDir`: everything below it is bundler output, and everything else is a
 *  copy of a file in the repository. */
const BUNDLED_PREFIX = "assets/";
const CONFIG_FILES = new Set(["_headers", "_redirects"]);
/** The deployment's own commit stamp. It describes where this build came from, not what the app
 *  is, and two stamps that differ are exactly what a rollout looks like mid-flight. Its question
 *  belongs to `verify-deployed-currentness.mjs`; comparing it here would report a stamp mismatch
 *  as an artifact defect and invite parity to certify currency by accident. */
const DEPLOYMENT_METADATA = new Set(["build-info.json"]);

function parseArgs(argv) {
  const options = { dist: "dist", url: "https://dueweave.pages.dev" };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token !== "--dist" && token !== "--url") {
      console.error(`Unrecognised argument "${token}". Expected --dist <dir> and --url <origin>.`);
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

/** Every file below `dir`, as POSIX paths relative to it — the same keys a site answers on. */
function listFiles(dir, prefix = "") {
  const found = [];
  for (const name of readdirSync(dir).sort()) {
    const absolute = path.join(dir, name);
    const relative = prefix ? `${prefix}/${name}` : name;
    if (statSync(absolute).isDirectory()) found.push(...listFiles(absolute, relative));
    else found.push(relative);
  }
  return found;
}

function digest(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

/** The bytes that decide a match: bundler output exactly, checkout copies without carriage returns. */
function comparable(buffer, relative) {
  const text = buffer.toString("utf8");
  return relative.startsWith(BUNDLED_PREFIX) ? text : text.replace(/\r/g, "");
}

/** A Pages `_headers` file: an unindented path pattern, then indented `Name: value` lines. */
function parseHeadersConfig(text) {
  const blocks = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    if (!line.trim() || line.startsWith("#")) continue;
    if (/^\s/.test(raw)) {
      const separator = line.indexOf(":");
      if (separator === -1 || blocks.length === 0) continue;
      blocks[blocks.length - 1].headers.push({
        name: line.slice(0, separator).trim(),
        value: line.slice(separator + 1).trim(),
      });
      continue;
    }
    blocks.push({ pattern: line.trim(), headers: [] });
  }
  return blocks;
}

/** A Pages `_redirects` line: `from to status`. */
function parseRedirectsConfig(text) {
  const rules = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const [from, to, status] = line.split(/\s+/);
    if (!from || !to || !status) continue;
    rules.push({ from, to, status: Number(status) });
  }
  return rules;
}

function globToRegExp(pattern) {
  return new RegExp(`^${pattern.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join(".*")}$`);
}

/** A path the build does not contain, so only the fallback can answer it. */
function probePath(from) {
  const probe = from.includes("*") ? from.replace("*", "parity-probe") : from;
  return probe.startsWith("/") ? probe : `/${probe}`;
}

/**
 * An artifact is fetched the way a browser gets it, so the host's canonical redirect — Pages
 * answers `/index.html` with HTTP 308 to `/` — leads to the bytes it actually serves. A
 * `_redirects` probe must not follow: the status code is exactly what the rule promises, and
 * following it would read a broken fallback as a working one.
 */
function fetchPath(url, redirect) {
  return fetch(url, { cache: "no-store", redirect, signal: AbortSignal.timeout(30_000) });
}

const { dist, url } = parseArgs(process.argv.slice(2));

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

let files;
try {
  files = listFiles(dist);
} catch {
  console.error(`No build found at "${dist}". Run the build you mean to compare before checking parity.`);
  process.exit(2);
}
if (files.length === 0) {
  console.error(`"${dist}" holds no files, so this check would compare nothing and report parity.`);
  process.exit(2);
}

const artifacts = files.filter((relative) => !CONFIG_FILES.has(relative) && !DEPLOYMENT_METADATA.has(relative));
const configs = files.filter((relative) => CONFIG_FILES.has(relative));
const stamps = files.filter((relative) => DEPLOYMENT_METADATA.has(relative));
const mismatches = [];
const servedHeaders = new Map();

// Pages answers a path it has no file for with the SPA entry (`/* /index.html 200`), so an artifact
// the deployment never contained still reads HTTP 200 with real headers. Measured on production
// 2026-10-15: ten chunks of a stale local build each answered the 1222 bytes of `index.html`, and
// the report said "495294 local bytes differ from 1222 served bytes" — a byte count that reads as a
// content change and hides the finding that matters for an exact-SHA claim: the file is absent.
let fallbackBytes = Buffer.alloc(0);
try {
  fallbackBytes = Buffer.from(await (await fetchPath(new URL("/", origin), "follow")).arrayBuffer());
} catch {
  // Nothing reachable at the root, so nothing to recognise as a fallback. Each artifact then
  // reports its own reachability, which is the behaviour the missing-file cases already pin.
}

for (const relative of artifacts) {
  const local = readFileSync(path.join(dist, ...relative.split("/")));
  let response;
  try {
    response = await fetchPath(new URL(`/${relative.split("/").map(encodeURIComponent).join("/")}`, origin), "follow");
  } catch (error) {
    mismatches.push(`${relative}: the deployed site could not be reached (${error.message})`);
    console.log(`MISS  ${relative}  ${error.message}`);
    continue;
  }
  if (response.status !== 200) {
    mismatches.push(`${relative}: the deployed site answered HTTP ${response.status} for a file this build produces`);
    console.log(`MISS  ${relative}  HTTP ${response.status}`);
    continue;
  }
  servedHeaders.set(relative, response.headers);
  const served = Buffer.from(await response.arrayBuffer());
  if (relative !== "index.html" && fallbackBytes.length > 0 && served.equals(fallbackBytes)) {
    mismatches.push(`${relative}: not served by the deployed site, which answered HTTP 200 with its ${fallbackBytes.length}-byte SPA fallback`);
    console.log(`MISS  ${relative}  the deployment answered this path with the SPA fallback, so the file is not served by the deployed site`);
    continue;
  }
  const same = comparable(local, relative) === comparable(served, relative);
  // The digests printed are of the bytes the verdict was computed from, not of the raw files. On
  // 2026-10-15 this line read `SAME icon.svg local=15c80b908ebf deployed=0f0c1a24583a`, which made
  // the instrument itself look broken — a reader had no way to tell that the carriage-return rule
  // had already been applied. A release gate has to show the evidence its own verdict ran on.
  const normalized = same && local.toString("utf8") !== served.toString("utf8");
  console.log(`${same ? "SAME" : "DIFF"}  ${relative}  local=${digest(comparable(local, relative)).slice(0, 12)} deployed=${digest(comparable(served, relative)).slice(0, 12)}${normalized ? " [identical once the checkout's carriage returns are removed; raw files differ]" : ""}`);
  if (!same) mismatches.push(`${relative}: ${local.length} local bytes differ from ${served.length} served bytes`);
}

// `_headers` is not served, so its promise is read off the responses of the files it covers.
for (const relative of configs) {
  const text = readFileSync(path.join(dist, ...relative.split("/")), "utf8");
  if (relative === "_headers") {
    const blocks = parseHeadersConfig(text);
    const problems = [];
    if (blocks.length === 0) problems.push(`_headers holds no pattern block, so this check would verify nothing`);
    let honoured = 0;
    for (const block of blocks) {
      const covered = artifacts.filter((artifact) => globToRegExp(block.pattern).test(`/${artifact}`));
      if (covered.length === 0) {
        problems.push(`_headers: no file in this build matches the pattern ${block.pattern}, so its ${block.headers.length} declaration(s) were never verified`);
        continue;
      }
      for (const artifact of covered) {
        const headers = servedHeaders.get(artifact);
        if (!headers) continue;
        for (const { name, value } of block.headers) {
          const actual = headers.get(name);
          if (actual === value) {
            honoured += 1;
            continue;
          }
          problems.push(`_headers: ${block.pattern} declares "${name}: ${value}" but ${origin.origin}/${artifact} answered ${actual === null ? "nothing" : `"${actual}"`}`);
        }
      }
    }
    const first = problems[0];
    console.log(`${problems.length === 0 ? "EFFECT" : "DIFF  "} ${relative}  ${honoured} live header declaration(s) honoured${first ? `, first problem: ${first}` : ""}`);
    mismatches.push(...problems);
    continue;
  }

  // `_redirects` is not served either; what it promises is that a path with no file behind it
  // still answers with the declared status.
  const rules = parseRedirectsConfig(text);
  const problems = [];
  if (rules.length === 0) problems.push(`_redirects holds no rule, so this check would verify nothing`);
  for (const rule of rules) {
    const probe = probePath(rule.from);
    if (!Number.isInteger(rule.status)) {
      problems.push(`_redirects: "${rule.from} ${rule.to} ${rule.status}" does not declare an integer status`);
      continue;
    }
    let response;
    try {
      response = await fetchPath(new URL(probe, origin), "manual");
    } catch (error) {
      problems.push(`_redirects: ${rule.from} could not be probed at ${probe} (${error.message})`);
      continue;
    }
    if (response.status === rule.status) {
      console.log(`EFFECT  ${relative}  ${probe} answers HTTP ${response.status} as "${rule.from} ${rule.to} ${rule.status}" promises`);
      continue;
    }
    problems.push(`_redirects: "${rule.from} ${rule.to} ${rule.status}" promises HTTP ${rule.status} for ${probe} and the deployed site answered HTTP ${response.status}`);
  }
  if (problems.length > 0) {
    console.log(`DIFF   ${relative}  ${problems[0]}`);
    mismatches.push(...problems);
  }
}

console.log(`Compared ${artifacts.length} built file(s) and verified ${configs.length} host configuration file(s) from "${dist}" against ${origin.origin}.`);
if (stamps.length > 0) {
  console.log(`Left ${stamps.join(", ")} to verify:deployed:current: which commit the deployment says it is is not a byte comparison.`);
}
if (mismatches.length > 0) {
  console.error(`PARITY MISMATCH — ${mismatches.length} of ${files.length} file(s) do not match:`);
  for (const line of mismatches) console.error(`  ${line}`);
  process.exit(1);
}
console.log(`Parity holds: every file this build produces is served, and every served copy matches.`);
