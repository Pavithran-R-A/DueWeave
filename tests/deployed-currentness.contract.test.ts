import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// CL-7 final corrections, item 10: the release record must not call the live site current on the
// strength of a stable bundle. `deployment-settled-check.mjs` answers "has the site stopped being
// rebuilt", and `verify-deployed-parity.mjs` answers "does the served byte equal this local build".
// Neither answers "which commit is production serving", and on 2026-10-20 the distinction stopped
// being academic: production answered the 2a4872c entry 34 minutes after the push that added the
// trust documents. This gate reads one file the deployment itself publishes — `build-info.json`,
// emitted by `scripts/build-info.mjs` from CF_PAGES_COMMIT_SHA / GITHUB_SHA — and compares it to
// the target commit exactly. It is an operator certification command, never a CI step: a
// deployment that lags its branch is normal, and CI must not turn that into a red build.
//
// The stand-in deployment is a loopback server, so no case depends on what production happens to
// be serving while the suite runs.

const projectRoot = path.resolve(import.meta.dirname, "..");
const script = path.join(projectRoot, "scripts", "verify-deployed-currentness.mjs");

const TARGET = "2eed7dd82347887af3b24e96ac016d6fb2c5cdf4";
const OLDER = "4d82978000000000000000000000000000000000";

const servers: ReturnType<typeof createServer>[] = [];

interface Site {
  body: string;
  status?: number;
  contentType?: string;
}

async function serveStamp(site: Site): Promise<{ url: string; requests: () => number }> {
  let requests = 0;
  const server = createServer((_request, response) => {
    requests += 1;
    response
      .writeHead(site.status ?? 200, { "content-type": site.contentType ?? "application/json" })
      .end(site.body);
  });
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("the loopback stand-in did not bind a port");
  return { url: `http://127.0.0.1:${address.port}`, requests: () => requests };
}

function stamp(commit: string | null, overrides: Record<string, unknown> = {}): string {
  return JSON.stringify({ schema: 1, commit, source: commit ? "cloudflare-pages" : "none", ...overrides });
}

function run(args: string[]): Promise<{ code: number | null; out: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    child.stdout.on("data", (chunk: Buffer) => (out += chunk.toString()));
    child.stderr.on("data", (chunk: Buffer) => (out += chunk.toString()));
    child.on("close", (code) => resolve({ code, out }));
  });
}

afterAll(async () => {
  await Promise.all(
    servers.map(async (server) => {
      server.closeAllConnections();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }),
  );
});

describe("production currentness is read from the deployment's own stamp", () => {
  it("calls a deployment current when its stamp names exactly the target commit", async () => {
    const site = await serveStamp({ body: stamp(TARGET) });
    const { code, out } = await run(["--url", site.url, "--sha", TARGET]);
    expect(out).toMatch(/CURRENT/);
    expect(out).toContain(TARGET);
    expect(code, out).toBe(0);
  });

  it("refuses a deployment that names an older commit, and prints both", async () => {
    const site = await serveStamp({ body: stamp(OLDER) });
    const { code, out } = await run(["--url", site.url, "--sha", TARGET]);
    expect(code, out).toBe(1);
    expect(out, out).toMatch(/NOT CURRENT/);
    expect(out, out).toContain(OLDER);
    expect(out, out).toContain(TARGET);
  });

  it("does not accept a prefix of the target as the same commit", async () => {
    const site = await serveStamp({ body: stamp(TARGET.slice(0, 12)) });
    const { code, out } = await run(["--url", site.url, "--sha", TARGET]);
    expect(code, out).toBe(1);
    expect(out, out).toMatch(/NOT CURRENT/);
  });

  it("refuses a site that answers its SPA fallback instead of a stamp", async () => {
    // This is the realistic shape of a pre-stamp deployment: `/build-info.json` does not exist,
    // and `/* /index.html 200` serves the application document with HTTP 200. Reading that as a
    // stamp would certify every older deployment as current.
    const site = await serveStamp({
      body: '<!doctype html><html><body><div id="root"></div><script src="/assets/index-BKmcZ83J.js"></script></body></html>',
      contentType: "text/html",
    });
    const { code, out } = await run(["--url", site.url, "--sha", TARGET]);
    expect(code, out).toBe(1);
    expect(out, out).toMatch(/build-info\.json/);
    expect(out, out).toMatch(/stamp|JSON/i);
  });

  it("does not call a site current from stable entry assets alone", async () => {
    // The exact claim the release record must stop making: a document naming the same entry on two
    // reads says the site has stopped moving, not that it stopped at this commit.
    const page = '<!doctype html><html><body><script src="/assets/index-BKmcZ83J.js"></script></body></html>';
    const site = await serveStamp({ body: page, contentType: "text/html" });
    const { code, out } = await run(["--url", site.url, "--sha", TARGET]);
    expect(code, out).toBe(1);
    expect(out, out).not.toMatch(/^CURRENT — .* serves commit/m);
  });

  it("refuses a stamp that names no commit, which is what a locally built direct upload carries", async () => {
    const site = await serveStamp({ body: stamp(null) });
    const { code, out } = await run(["--url", site.url, "--sha", TARGET]);
    expect(code, out).toBe(1);
    expect(out, out).toMatch(/no commit|does not name/i);
  });

  it("refuses unreadable JSON and an unknown schema rather than treating either as currency", async () => {
    const broken = await serveStamp({ body: '{"schema":1,"commit":' });
    const brokenRun = await run(["--url", broken.url, "--sha", TARGET]);
    expect(brokenRun.code, brokenRun.out).toBe(1);
    expect(brokenRun.out).toMatch(/stamp|JSON/i);

    const future = await serveStamp({ body: stamp(TARGET, { schema: 2 }) });
    const futureRun = await run(["--url", future.url, "--sha", TARGET]);
    expect(futureRun.code, futureRun.out).toBe(1);
    expect(futureRun.out).toMatch(/schema/i);
  });

  it("reports an unreachable deployment instead of a mismatch", async () => {
    const site = await serveStamp({ body: stamp(TARGET) });
    await new Promise<void>((resolve) => servers.at(-1)!.close(() => resolve()));
    const { code, out } = await run(["--url", site.url, "--sha", TARGET]);
    expect(code, out).toBe(1);
    expect(out, out).toMatch(/could not|unreachable|fetch/i);
  });

  it("refuses a target that is not a full commit id before it reads the site", async () => {
    const site = await serveStamp({ body: stamp(TARGET) });
    const { code, out } = await run(["--url", site.url, "--sha", TARGET.slice(0, 7)]);
    expect(code, out).toBe(2);
    expect(out, out).toMatch(/full|40|commit/i);
    expect(site.requests(), "a refused target still reached the deployment").toBe(0);
  });

  it("is an operator certification command that no CI job may reach", () => {
    const packageJson = JSON.parse(readFileSync(path.join(projectRoot, "package.json"), "utf8")) as {
      scripts: Record<string, string>;
    };
    expect(packageJson.scripts["verify:deployed:current"]).toBe("node scripts/verify-deployed-currentness.mjs");
    const workflows = readdirSync(path.join(projectRoot, ".github", "workflows"));
    for (const name of workflows) {
      const text = readFileSync(path.join(projectRoot, ".github", "workflows", name), "utf8");
      expect(text, `${name} turns a lagging deployment into a CI failure`).not.toContain("verify-deployed-currentness");
    }
    for (const gate of ["verify:release:local", "verify:e2e:local", "test:e2e:smoke"]) {
      expect(packageJson.scripts[gate]).not.toContain("verify-deployed-currentness");
    }
  });
});
