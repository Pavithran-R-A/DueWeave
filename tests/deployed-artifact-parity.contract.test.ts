import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// Step 7 of the hosted launch plan is "rebuild Cloudflare and verify exact-SHA parity", and the
// only honest way to answer it is to compare the deployed bytes against a local build of the
// same commit. Comparing by hand on 2026-10-13, then with the first version of this instrument
// against production, produced the facts this suite pins: all 13 hashed assets matched
// production byte for byte; `index.html`, `manifest.json`, `icon.svg` and `brand/mark.svg`
// differed only by carriage returns, because this Windows checkout carries `core.autocrlf=true`
// and Vite copies those files out verbatim while any Linux build serves LF; `_headers` and
// `_redirects` are never served at all, because Pages reads them as configuration; and
// `/index.html` answers HTTP 308 pointing at `/`, which serves the same bytes. An instrument that
// did not know the first fact would report a defect on every run from this machine; one that
// ignored line endings everywhere would miss a real change inside a hashed chunk; one that
// byte-compared the two config files could never read parity at all.
//
// The deployment is stood in for by a loopback server answering the same paths, because a unit
// suite may not depend on what production happens to be serving at the moment it runs.

const projectRoot = path.resolve(import.meta.dirname, "..");
const script = path.join(projectRoot, "scripts", "verify-deployed-parity.mjs");

type DistFiles = Record<string, string>;
type Site = Record<string, string | { redirectTo: string }>;

function writeDist(files: DistFiles): string {
  const dir = mkdtempSync(path.join(tmpdir(), "dw-parity-dist-"));
  for (const [relative, contents] of Object.entries(files)) {
    const target = path.join(dir, ...relative.split("/"));
    mkdirSync(path.dirname(target), { recursive: true });
    writeFileSync(target, contents);
  }
  return dir;
}

const servers: ReturnType<typeof createServer>[] = [];

/**
 * A stand-in deployment: answers exactly these paths, 404s anything it was not given, and puts
 * `headers` on every response it makes. The 404 matters — a real Cloudflare Pages site never
 * serves `_headers` or `_redirects`, because it consumes them as configuration. An entry that is
 * not a string answers with a redirect, which is how Pages canonicalises `/index.html` to `/`.
 */
async function serveSite(files: Site, headers: Record<string, string> = {}, options: { fallback?: string } = {}): Promise<string> {
  const server = createServer((request, response) => {
    const key = decodeURIComponent(request.url ?? "/").replace(/^\/+/, "");
    const entry = Object.prototype.hasOwnProperty.call(files, key) ? files[key] : undefined;
    if (entry === undefined) {
      // A Cloudflare Pages site with `/* /index.html 200` never 404s: an unknown path answers the
      // SPA entry file. `fallback` stands in for that, because the difference is what the case is
      // about — a loopback 404 makes the instrument look like it detects a missing file.
      if (options.fallback !== undefined) {
        response.writeHead(200, { "content-type": "text/html" }).end(options.fallback);
        return;
      }
      response.writeHead(404).end("not found");
      return;
    }
    if (typeof entry !== "string") {
      response.writeHead(308, { location: entry.redirectTo }).end();
      return;
    }
    response.writeHead(200, { "content-type": key.endsWith(".html") ? "text/html" : "application/javascript", ...headers });
    response.end(entry);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("the loopback stand-in did not bind a port");
  return `http://127.0.0.1:${address.port}`;
}

function run(dist: string, url: string): Promise<{ code: number | null; out: string }> {
  // `spawn`, never `spawnSync`: the stand-in deployment answers from this very process, and a
  // synchronous child blocks the event loop that serves it. The first version of this suite
  // therefore timed out on every request — and the two cases expecting a failure passed for the
  // wrong reason, because "nothing was reachable" also reads as "it failed".
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, "--dist", dist, "--url", url], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (out += chunk.toString()));
    child.on("close", (code) => resolve({ code, out }));
  });
}

afterAll(async () => {
  // `close()` alone waits for in-flight connections to end, and the fetch keep-alive pool does
  // not end one on its own, so without `closeAllConnections()` this teardown never resolves.
  await Promise.all(
    servers.map(async (server) => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }),
  );
});

describe("Deployed artifact parity", () => {
  const html = '<!doctype html>\n<html><body><div id="root"></div></body></html>\n';
  const chunk = "const a=1;\n";
  const distFiles: DistFiles = { "index.html": html, "assets/index-Abc123.js": chunk };

  // Each case that expects a failure also requires the healthy file to read SAME first: a run in
  // which nothing is reachable fails everything, and that is a different claim from "this one
  // artifact differs".
  const comparedHtml = /SAME\s+index\.html/;

  it("passes when every built file is served byte for byte", async () => {
    const url = await serveSite(distFiles);
    const { code, out } = await run(writeDist(distFiles), url);
    expect(out, `the instrument said nothing, so it compared nothing: ${out}`).toContain("index-Abc123.js");
    expect(out, `the healthy HTML was never reached: ${out}`).toMatch(comparedHtml);
    expect(code, out).toBe(0);
  });

  it("reads a CRLF index.html and the LF one a site serves as the same artifact", async () => {
    const crlf = html.replace(/\n/g, "\r\n");
    expect(crlf, "the fixture is not actually CRLF, so this case proves nothing").not.toBe(html);
    const url = await serveSite(distFiles);
    const { code, out } = await run(writeDist({ ...distFiles, "index.html": crlf }), url);
    expect(out, `a Windows build of the same commit was read as a defect: ${out}`).toMatch(comparedHtml);
    expect(code, out).toBe(0);
  });

  it("prints the two digests it actually compared, so a SAME verdict can be audited", async () => {
    // Run against production on 2026-10-15 this line read `SAME icon.svg local=15c80b908ebf
    // deployed=0f0c1a24583a`, and the only reasonable reader response was to suspect the instrument
    // of passing what it should have failed: the verdict compares carriage returns away while the
    // digests printed were of the raw bytes. A release gate that certifies exact-SHA deployment has
    // to show the bytes its own verdict was computed from, and say out loud when the checkout and
    // the deployment differ only by line endings.
    const crlf = html.replace(/\n/g, "\r\n");
    expect(crlf, "the fixture is not actually CRLF, so this case proves nothing").not.toBe(html);
    const url = await serveSite(distFiles);
    const { code, out } = await run(writeDist({ ...distFiles, "index.html": crlf }), url);
    const line = out.split(/\r?\n/).find((entry) => /SAME\s+index\.html/.test(entry)) ?? "";
    const shown = [...line.matchAll(/(?:local|deployed)=([0-9a-f]{12})/g)].map((match) => match[1]);
    expect(shown.length, `the SAME line has to carry both digests: ${line}`).toBe(2);
    expect(shown[1], `a SAME verdict that prints two different digests cannot be audited: ${line}`).toBe(shown[0]);
    expect(line, "the line must name the normalization that made the verdict SAME").toMatch(/carriage/i);
    expect(code, out).toBe(0);
  });

  it("names the hashed chunk whose bytes differ", async () => {
    const url = await serveSite({ ...distFiles, "assets/index-Abc123.js": "const a=2;\n" });
    const { code, out } = await run(writeDist(distFiles), url);
    expect(out, `the healthy file was not reached, so nothing was compared: ${out}`).toMatch(comparedHtml);
    expect(code, out).not.toBe(0);
    expect(out, "a silent pass on a changed chunk is how a stale deploy reads as current").toMatch(/DIFF\s+assets\/index-Abc123\.js/);
  });

  it("fails when the site does not serve a file the build produced", async () => {
    const url = await serveSite({ "index.html": html });
    const { code, out } = await run(writeDist(distFiles), url);
    expect(out, `the healthy file was not reached, so nothing was compared: ${out}`).toMatch(comparedHtml);
    expect(code, out).not.toBe(0);
    expect(out, "a chunk the deployed site never served has to be named").toMatch(/MISS\s+assets\/index-Abc123\.js/);
  });

  it("names an asset the deployment only answers with its SPA fallback as absent, not as changed", async () => {
    // Measured on production on 2026-10-15: a chunk this build carries and Cloudflare does not serve
    // answered HTTP 200 with the 1222 bytes of `index.html`, because the site's `_redirects` rule is
    // `/* /index.html 200`. The instrument reported "495294 local bytes differ from 1222 served
    // bytes" for ten such files at once — an accurate byte count that pointed at a content change
    // while the real finding was that the deployment never contained those artifacts. A launch gate
    // that has to say whether the exact SHA is live cannot describe an absent file as a differing
    // one, so the fallback is recognised and named.
    const url = await serveSite({ "index.html": html }, {}, { fallback: html });
    const { code, out } = await run(writeDist(distFiles), url);
    expect(out, `the healthy file was not reached, so nothing was compared: ${out}`).toMatch(/SAME\s+index\.html/);
    expect(code, out).not.toBe(0);
    expect(out, "a file answered only by the fallback is a file the deployment does not serve").toMatch(/MISS\s+assets\/index-Abc123\.js\s+.*fallback/i);
    expect(out, "the mismatch list has to say the same thing the line says").toMatch(/not served by the deployed site/i);
  });

  it("follows the host's canonical redirect to an artifact instead of reading the redirect as a defect", async () => {
    // Measured on 2026-10-13: `https://dueweave.pages.dev/index.html` answers HTTP 308 and points
    // at `/`, which serves the same bytes. Pages canonicalises the entry file, so an artifact has
    // to be fetched the way a browser gets it. A `_redirects` probe must not follow, though — the
    // status code is precisely what that rule promises, so following it would hide a broken one.
    const url = await serveSite({ "index.html": { redirectTo: "/" }, "": html, "assets/index-Abc123.js": chunk });
    const { code, out } = await run(writeDist(distFiles), url);
    expect(out, `the canonicalised entry file was read as missing: ${out}`).toMatch(comparedHtml);
    expect(code, out).toBe(0);
  });

  it("refuses to report parity against something that is not an http(s) origin", async () => {
    const { code, out } = await run(writeDist({ "index.html": html }), "file:///tmp/not-a-deployment");
    expect(code, out).not.toBe(0);
    expect(out).toMatch(/http/);
  });

  // The first live run of this instrument on 2026-10-13 reported 5 of 22 files as mismatching,
  // and measuring those five one by one showed three different truths: `brand/mark.svg`,
  // `icon.svg` and `manifest.json` are checkout-copied statics that differ only by carriage
  // returns exactly like `index.html` does; `_headers` and `_redirects` are never served at all —
  // the GET returns the SPA `index.html` (1220 bytes) — because Pages reads them as
  // configuration. So the carriage-return rule has to cover every file the bundler does not
  // emit, and the two config files have to be verified by the effect they are supposed to have
  // on live responses instead of by bytes nobody can fetch.

  const statics: DistFiles = { "manifest.json": '{\n  "name": "DueWeave"\n}\n', "brand/mark.svg": '<svg xmlns="http://www.w3.org/2000/svg"></svg>\n' };

  it("reads a CRLF copy of a checkout-copied static and the LF one a site serves as the same artifact", async () => {
    const url = await serveSite({ ...distFiles, ...statics });
    const { code, out } = await run(
      writeDist({ ...distFiles, "manifest.json": statics["manifest.json"].replace(/\n/g, "\r\n"), "brand/mark.svg": statics["brand/mark.svg"].replace(/\n/g, "\r\n") }),
      url,
    );
    expect(out, `a Windows build was read as a defect: ${out}`).toMatch(/SAME\s+manifest\.json/);
    expect(out, `a Windows build was read as a defect: ${out}`).toMatch(/SAME\s+brand\/mark\.svg/);
    expect(code, out).toBe(0);
  });

  it("keeps the carriage-return rule out of the bundled assets", async () => {
    // A name that carries a content hash is a bundler output, and bundler output is LF on every
    // platform — so a carriage return inside `assets/` is a real artifact difference, while the
    // same pair of bytes in `manifest.json` is the checkout. Both halves are asserted together so
    // that widening the rule to everything cannot pass this suite.
    const url = await serveSite({ ...distFiles, ...statics, "assets/index-Abc123.js": chunk.replace(/\n/g, "\r\n"), "manifest.json": statics["manifest.json"].replace(/\n/g, "\r\n") });
    const { code, out } = await run(writeDist({ ...distFiles, ...statics }), url);
    expect(out, `the checkout-copied static was not read as the same artifact: ${out}`).toMatch(/SAME\s+manifest\.json/);
    expect(out, "a carriage return excused a changed chunk").not.toMatch(/SAME\s+assets\/index-Abc123\.js/);
    expect(code, out).not.toBe(0);
    expect(out).toMatch(/DIFF\s+assets\/index-Abc123\.js/);
  });

  // Written CRLF on purpose: this Windows checkout stores the config files with carriage returns
  // (`_headers` measured 5 of them), so a parser that split only on `\n` would carry a trailing
  // `\r` into every header name and value and report the live site as non-compliant.
  const headersConfig = "/*\r\n  X-Frame-Options: DENY\r\n  Referrer-Policy: strict-origin-when-cross-origin\r\n";
  const appliedHeaders = { "x-frame-options": "DENY", "referrer-policy": "strict-origin-when-cross-origin" };
  const redirectsConfig = "/* /index.html 200\r\n";

  it("verifies _headers by the live response headers it produced, not by bytes the host never serves", async () => {
    const url = await serveSite({ ...distFiles }, appliedHeaders);
    const { code, out } = await run(writeDist({ ...distFiles, "_headers": headersConfig }), url);
    expect(out, `the healthy HTML was never reached: ${out}`).toMatch(comparedHtml);
    expect(out, `_headers is configuration, and a site that consumes it has to be checked by effect: ${out}`).toMatch(/EFFECT\s+_headers/);
    expect(code, out).toBe(0);
  });

  it("names the declared header a live response is missing", async () => {
    const url = await serveSite({ ...distFiles });
    const { code, out } = await run(writeDist({ ...distFiles, "_headers": headersConfig }), url);
    expect(out, `the healthy HTML was never reached: ${out}`).toMatch(comparedHtml);
    expect(code, out).not.toBe(0);
    expect(out, "the instrument has to say which promise the deployment broke").toMatch(/X-Frame-Options/i);
  });

  it("checks a _redirects rule against a path the build does not contain", async () => {
    const url = await serveSite({ ...distFiles, "parity-probe": html });
    const { code, out } = await run(writeDist({ ...distFiles, "_redirects": redirectsConfig }), url);
    expect(out, `the healthy HTML was never reached: ${out}`).toMatch(comparedHtml);
    expect(out, `the fallback was never probed: ${out}`).toMatch(/EFFECT\s+_redirects/);
    expect(code, out).toBe(0);
  });

  it("fails when the fallback a _redirects rule promises does not answer", async () => {
    const url = await serveSite({ ...distFiles });
    const { code, out } = await run(writeDist({ ...distFiles, "_redirects": redirectsConfig }), url);
    expect(out, `the healthy HTML was never reached: ${out}`).toMatch(comparedHtml);
    expect(code, out).not.toBe(0);
    expect(out, "the probe path whose promise broke has to be named").toMatch(/parity-probe/);
  });

  it("leaves the deployment's own commit stamp to the currentness gate", async () => {
    // `build-info.json` describes where the deployment came from, not what the app is. Two
    // deployments of different commits are exactly what parity is used to compare during a
    // rollout, and a stamp mismatch here would read as an artifact defect. `verify:deployed:current`
    // owns that question; this instrument must not answer it by accident.
    const localStamp = JSON.stringify({ schema: 1, commit: "a".repeat(40), source: "github-actions" });
    const servedStamp = JSON.stringify({ schema: 1, commit: "b".repeat(40), source: "cloudflare-pages" });
    const url = await serveSite({ ...distFiles, "build-info.json": servedStamp });
    const { code, out } = await run(writeDist({ ...distFiles, "build-info.json": localStamp }), url);
    expect(out, `the healthy HTML was never reached: ${out}`).toMatch(comparedHtml);
    expect(code, out).toBe(0);
  });

  it("stays a laptop command, because a site that legitimately lags the build is not a CI defect", () => {
    for (const name of ["ci.yml", "live-public.yml", "release-full-browser.yml", "codeql-release.yml"]) {
      const body = readFileSync(path.join(projectRoot, ".github", "workflows", name), "utf8");
      expect(body, `${name} would fail on whatever the site serves today, not on this commit`).not.toContain("verify-deployed-parity");
    }
    const pkg = JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8")) as { scripts: Record<string, string> };
    for (const gate of ["verify:release:local", "verify:e2e:local", "test:e2e:smoke"]) {
      expect(pkg.scripts[gate], `${gate} must not reach the network for a deployment that may lag`).not.toContain("verify-deployed-parity");
    }
  });
});
