import process from "node:process";
import { setTimeout as delay } from "node:timers/promises";

// Waits for a deployed site to stop changing, so a browser gate can assert against a moving
// target at all. `Live production public smoke` runs on every push to `release/consumer-live`,
// and Cloudflare rebuilds that site on the same push: measured on 2026-10-13, a commit at
// 16:19:01Z did not serve a byte-identical stylesheet until 16:36Z. A spec that waits 5s for a
// heading is the right wait for a finished deployment and no information at all about an
// in-flight one, which is how run 38402697489 failed on copy nobody had changed.
//
// The property established here is deliberately narrow, and stating its limit is the point:
// two consecutive reads naming the same entry assets means the site has stopped being rebuilt,
// not that it stopped at this push's commit. Certifying an exact head is
// `scripts/verify-deployed-parity.mjs`, which compares a built artifact against the site file by
// file. Ask each instrument the question it can actually answer.
//
// Run it by hand the same way the suite does:
//   node scripts/deployment-settled-check.mjs

/** Vite emits its entry chunks under `assets/` with a content hash in the name, so the set of
 *  names a document references is a fingerprint of the build behind it. */
const ENTRY_ASSET = /\/assets\/[^"'?>\s]+\.(?:js|css)/g;

export function entryAssets(html) {
  return [...new Set(html.match(ENTRY_ASSET) ?? [])].sort();
}

async function fetchDocument(url) {
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000), headers: { "cache-control": "no-cache" } });
  if (!response.ok) throw new Error(`answered ${response.status}`);
  return { status: response.status, html: await response.text() };
}

/**
 * Reads `origin + path` until two consecutive documents name the same entry assets.
 *
 * A read that fails, or that returns a document naming no assets at all, is not a settled read:
 * an edge node answering with an error page agrees with itself perfectly well, and certifying
 * that as "stable" would hand the suite a site that is not serving the app.
 */
export async function assertDeploymentSettled({
  origin = "https://dueweave.pages.dev",
  path = "/auth",
  timeoutMs = 900_000,
  intervalMs = 15_000,
  fetchDocument: read = fetchDocument,
  sleep = delay,
  now = () => Date.now(),
  log = () => {},
} = {}) {
  const url = `${origin}${path}`;
  const startedAt = now();
  const seen = [];
  let reads = 0;
  let problem = "no read has finished yet";

  while (now() - startedAt < timeoutMs) {
    reads += 1;
    let assets = null;
    try {
      const document = await read(url);
      assets = entryAssets(document.html);
      if (assets.length === 0) problem = `answered ${document.status} without naming any entry asset`;
    } catch (error) {
      problem = error instanceof Error ? error.message : String(error);
    }

    if (assets?.length) {
      const previous = seen.at(-1);
      seen.push(assets);
      if (previous && previous.join("\n") === assets.join("\n")) {
        return { url, assets, reads, waitedMs: now() - startedAt };
      }
      // Only a read that disagrees with the one before it is evidence of a rebuild; the first read
      // has nothing to be compared against yet, and saying otherwise would report a steady site as
      // a moving one.
      log(previous ? `${url} is being rebuilt — read ${reads} names ${assets.join(", ")}` : `${url} read ${reads} names ${assets.join(", ")}; waiting for a second read to agree`);
    }
    await sleep(intervalMs);
  }

  const builds = [...new Map(seen.map((assets) => [assets.join(","), assets])).values()];
  if (builds.length === 0) {
    throw new Error(`${url} never served a document naming its entry assets within ${timeoutMs}ms (${reads} reads). Last read: ${problem}.`);
  }
  const named = builds.map((assets) => assets.map((asset) => asset.split("/").pop()).join(" + ")).join(" then ");
  throw new Error(`${url} was still being rebuilt after ${timeoutMs}ms: ${reads} reads named ${builds.length} different build${builds.length === 1 ? "" : "s"} (${named}). Not running a smoke suite against a site that is moving.`);
}

if (process.argv[1]?.replace(/\\/g, "/").endsWith("scripts/deployment-settled-check.mjs")) {
  try {
    const settled = await assertDeploymentSettled({ log: (line) => console.log(line) });
    console.log(`${settled.url} settled on ${settled.assets.join(", ")} after ${settled.reads} reads (${settled.waitedMs}ms).`);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
