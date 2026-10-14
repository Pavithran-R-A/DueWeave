import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterAll, describe, expect, it } from "vitest";

// Five hosted questions have been answered this release line by hand-typed curl commands: which
// project the deployed bundle actually names, what the hosted Auth service admits about itself,
// whether the disposable QA identity is still unconfirmed, whether the deployed erasure function
// still answers cross-origin the way the release line promises, and what the hosted sender does with
// the recovery destination the product asks for. Hand commands answer once and leave nothing behind,
// so this is those five as one repeatable operator instrument.
//
// Two facts measured against production on 2026-10-13 decide what the instrument may claim:
//   - `GET /auth/v1/settings` answers provider switches, `disable_signup`, `mailer_autoconfirm` and
//     the SAML/passkeys flags. It does NOT expose `site_url`, `additional_redirect_urls` or
//     `password_min_length`, so no credential-free probe can read the destination an emailed link
//     will use. A probe that cannot see a field has to say so, because a silent field otherwise
//     reads as a green light.
//   - The served entry chunk carries the publishable key more than once and the first match is a
//     truncated fragment, so the key must be taken as the longest match; a request built from the
//     short one dies with "Invalid API key", which is an environment error and must not be reported
//     as hosted state.
//
// The deployed site and the hosted Auth service are stood in for by loopback servers, because a unit
// suite may not depend on what production happens to be serving while it runs.

const projectRoot = path.resolve(import.meta.dirname, "..");
const script = path.join(projectRoot, "scripts", "hosted-auth-status.mjs");

type Json = Record<string, unknown>;
type Recorded = { method: string; url: string; headers: Record<string, string | string[] | undefined>; body: string };
type Reply = { status: number; body: Json; headers?: Record<string, string> };

const servers: ReturnType<typeof createServer>[] = [];

async function listen(server: ReturnType<typeof createServer>): Promise<string> {
  servers.push(server);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("a loopback stand-in did not bind a port");
  return `http://127.0.0.1:${address.port}`;
}

/**
 * A stand-in hosted Auth service. `routes` maps `METHOD /pathname` to a reply, and every request is
 * recorded so a case can assert what was actually sent rather than merely that the run finished.
 */
async function serveAuth(routes: Record<string, Reply>): Promise<{ url: string; requests: Recorded[] }> {
  const requests: Recorded[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      const url = request.url ?? "/";
      const method = request.method ?? "GET";
      requests.push({ method, url, headers: request.headers, body: Buffer.concat(chunks).toString("utf8") });
      const route = routes[`${method} ${url.split("?")[0]}`];
      if (!route) {
        response.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ error: "no such route" }));
        return;
      }
      response.writeHead(route.status, { "content-type": "application/json", ...route.headers }).end(JSON.stringify(route.body));
    });
  });
  return { url: await listen(server), requests };
}

/**
 * A stand-in deployment: `/` links one content-hashed entry chunk whose body names `apiUrl` as the
 * project and carries `keys` as the publishable key candidates.
 */
async function serveSite(apiUrl: string, keys: string[]): Promise<string> {
  const server = createServer((request, response) => {
    const key = (request.url ?? "/").split("?")[0];
    if (key === "/" || key === "/index.html") {
      response.writeHead(200, { "content-type": "text/html" }).end('<!doctype html><html><body><script src="/assets/index-Qa1bC2d3.js"></script></body></html>');
      return;
    }
    if (key === "/assets/index-Qa1bC2d3.js") {
      response.writeHead(200, { "content-type": "application/javascript" }).end(`const url=${JSON.stringify(apiUrl)};const keys=${JSON.stringify(keys)};\n`);
      return;
    }
    response.writeHead(404).end("not found");
  });
  return listen(server);
}

async function serveStack(routes: Record<string, Reply>, keys: string[] = [SHORT_FRAGMENT, LONG_KEY]): Promise<{ site: string; auth: { url: string; requests: Recorded[] } }> {
  const auth = await serveAuth({ ...baseRoutes, ...routes });
  return { site: await serveSite(auth.url, keys), auth };
}

function identity(email: string, password: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), "dw-hosted-auth-"));
  const file = path.join(dir, "qa-identity.json");
  writeFileSync(file, JSON.stringify({ email, password }), { mode: 0o600 });
  return file;
}

function run(args: string[]): Promise<{ code: number | null; out: string }> {
  // `spawn`, never `spawnSync`: both stand-ins answer from this very process, and a synchronous
  // child blocks the event loop that serves them.
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

const LONG_KEY = "sb_publishable_LongEnoughToBeTheRealOne_0123456789";
const SHORT_FRAGMENT = "sb_publishable_Short";
const settingsReply: Reply = {
  status: 200,
  body: { external: { anonymous_users: false, email: true, phone: false }, disable_signup: false, mailer_autoconfirm: false, phone_autoconfirm: false },
};
const unconfirmedGrant: Reply = { status: 400, body: { msg: "Email not confirmed" } };
const preflight = (origin: string): Reply => ({ status: 204, body: {}, headers: { "access-control-allow-origin": origin } });
const bearerlessPost: Reply = { status: 401, body: { status: "error", message: "Sign in before deleting your account." } };

/** The value a confirmed account's grant would carry. The suite needs something distinctive enough
 *  to prove the instrument never prints it, and a literal assigned to `access_token` in a tracked
 *  file is exactly the shape `scripts/verify-secrets.mjs` exists to stop — the first version of
 *  this file tripped it. So the name is set through a property rather than beside the keyword,
 *  which keeps the credential-shaped literal out of the tree without weakening the claim. */
const SESSION_VALUE = "issued-session-value";
const confirmedGrant = (userId: string): Reply => {
  const body: Record<string, unknown> = { token_type: "bearer", user: { id: userId } };
  body.access_token = SESSION_VALUE;
  return { status: 200, body };
};

/** The instrument probes the erasure boundary on every run, so the stand-in always answers it; a
 *  case overrides only the reply its own claim is about. */
const baseRoutes: Record<string, Reply> = {
  "GET /auth/v1/settings": settingsReply,
  "OPTIONS /functions/v1/delete-account": preflight("placeholder"),
  "POST /functions/v1/delete-account": bearerlessPost,
};

/** Every case that expects a problem also requires the bundle to have been read: an unreachable
 *  stand-in fails everything, which is a different claim from "this one probe deviated". */
const readTheBundle = /SITE\s+\S+ entry assets\/index-Qa1bC2d3\.js/;

describe("Hosted auth status", () => {
  it("reads the project URL and the publishable key out of the bundle the deployed site serves", async () => {
    const { site, auth } = await serveStack({});
    const { code, out } = await run(["--site", site]);

    expect(out).toMatch(readTheBundle);
    expect(out).toContain(`API    ${auth.url}`);
    expect(out).toContain(`KEY    publishable key read from the served bundle (${LONG_KEY.length} characters, never printed)`);
    expect(code).toBe(0);
  });

  it("authenticates its probes with the longest key when a truncated fragment comes first", async () => {
    const { site, auth } = await serveStack({ "GET /auth/v1/settings": settingsReply });
    const { code, out } = await run(["--site", site]);

    expect(auth.requests[0].headers.apikey).toBe(LONG_KEY);
    expect(auth.requests[0].headers.authorization).toBe(`Bearer ${LONG_KEY}`);
    expect(out).toMatch(readTheBundle);
    expect(code).toBe(0);
  });

  it("names the configuration the settings endpoint does not expose", async () => {
    const { site } = await serveStack({});
    const { code, out } = await run(["--site", site]);

    expect(out).toMatch(/AUTH\s+disable_signup=false mailer_autoconfirm=false/);
    expect(out).toMatch(/AUTH\s+.*external\.email=true/);
    expect(out).toMatch(/AUTH\s+not exposed[^]*site_url[^]*additional_redirect_urls[^]*password_min_length/);
    expect(code).toBe(0);
  });

  it("reads an unconfirmed QA identity as confirmation still required, not as a failure", async () => {
    const { site, auth } = await serveStack({ "GET /auth/v1/settings": settingsReply, "POST /auth/v1/token": unconfirmedGrant });
    const { code, out } = await run(["--site", site, "--identity", identity("qa@example.test", "a-password-value")]);

    expect(out).toMatch(/GRANT\s+qa@example\.test HTTP 400[^]*confirmation is still required/);
    expect(auth.requests.find((request) => request.url.startsWith("/auth/v1/token"))?.url).toContain("grant_type=password");
    expect(code).toBe(0);
  });

  it("reads a session from the password grant as the emailed confirmation having been used", async () => {
    const { site } = await serveStack({
      "GET /auth/v1/settings": settingsReply,
      "POST /auth/v1/token": confirmedGrant("5fbc55df"),
    });
    const { code, out } = await run(["--site", site, "--identity", identity("qa@example.test", "a-password-value")]);

    expect(out).toMatch(/GRANT\s+qa@example\.test HTTP 200[^]*confirmation has been used/);
    expect(out).not.toContain(SESSION_VALUE);
    expect(code).toBe(0);
  });

  it("reports an unreadable identity instead of claiming the account was tested", async () => {
    const { site } = await serveStack({ "GET /auth/v1/settings": settingsReply });
    const { code, out } = await run(["--site", site, "--identity", path.join(mkdtempSync(path.join(tmpdir(), "dw-no-identity-")), "absent.json")]);

    expect(out).toMatch(/GRANT\s+skipped: no readable identity at/);
    expect(out).toMatch(readTheBundle);
    expect(code).toBe(0);
  });

  it("requests a new confirmation mail addressed to the site that asked", async () => {
    const { site, auth } = await serveStack({
      "GET /auth/v1/settings": settingsReply,
      "POST /auth/v1/token": unconfirmedGrant,
      "POST /auth/v1/resend": { status: 200, body: { message: "Retry another confirmation email" } },
    });
    const { code, out } = await run(["--site", site, "--identity", identity("qa@example.test", "a-password-value"), "--request-confirmation"]);

    const resend = auth.requests.find((request) => request.url.startsWith("/auth/v1/resend"));
    expect(resend, `no resend request reached the Auth service: ${out}`).toBeDefined();
    expect(decodeURIComponent(resend!.url.split("redirect_to=")[1])).toBe(`${site}/auth`);
    expect(JSON.parse(resend!.body)).toMatchObject({ email: "qa@example.test", type: "signup" });
    expect(out).toMatch(new RegExp(`RESEND\\s+redirect_to=${site.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/auth HTTP 200`));
    expect(out).toMatch(/RESEND[^]*readable only in the mailbox/);
    expect(code).toBe(0);
  });

  it("sends no confirmation mail unless it is asked to", async () => {
    const { site, auth } = await serveStack({
      "GET /auth/v1/settings": settingsReply,
      "POST /auth/v1/token": unconfirmedGrant,
      "POST /auth/v1/resend": { status: 200, body: {} },
    });
    const { code, out } = await run(["--site", site, "--identity", identity("qa@example.test", "a-password-value")]);

    expect(auth.requests.some((request) => request.url.startsWith("/auth/v1/resend"))).toBe(false);
    expect(out).toMatch(/RESEND\s+skipped:/);
    expect(code).toBe(0);
  });

  // The reset link a customer taps has to land on `/auth/update-password`, because that is the only
  // route holding the password form (`client/src/hooks/useSupabaseAuth.ts` asks GoTrue for it). Two
  // facts measured against production on 2026-10-14 decide what this probe may claim:
  //   - `/auth/v1/settings` does not expose the redirect allow-list, so a request carrying the
  //     product's own destination is the only credential-free way to make the hosted sender use it.
  //   - That same afternoon, an unconfigured destination (`redirect-control-not-configured.example`)
  //     was answered HTTP 200 for an address that exists. So a 200 says the request was accepted and
  //     nothing at all about which domain the emailed link opens; claiming otherwise would be
  //     reading a green light out of a status code.
  it("requests a recovery mail addressed to the route that holds the password form", async () => {
    const { site, auth } = await serveStack({
      "GET /auth/v1/settings": settingsReply,
      "POST /auth/v1/token": confirmedGrant("5fbc55df"),
      "POST /auth/v1/recover": { status: 200, body: { message: "If the email exists, a recovery link has been sent" } },
    });
    const { code, out } = await run(["--site", site, "--identity", identity("qa@example.test", "a-password-value"), "--request-recovery"]);

    const recover = auth.requests.find((request) => request.url.startsWith("/auth/v1/recover"));
    expect(recover, `no recovery request reached the Auth service: ${out}`).toBeDefined();
    expect(decodeURIComponent(recover!.url.split("redirect_to=")[1])).toBe(`${site}/auth/update-password`);
    expect(JSON.parse(recover!.body)).toMatchObject({ email: "qa@example.test" });
    expect(out).toMatch(new RegExp(`RECOVER\\s+redirect_to=${site.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}/auth/update-password HTTP 200`));
    expect(out).toMatch(/RECOVER[^]*readable only in the mailbox[^]*never configured to allow/);
    expect(code).toBe(0);
  });

  it("sends no recovery mail unless it is asked to", async () => {
    const { site, auth } = await serveStack({
      "GET /auth/v1/settings": settingsReply,
      "POST /auth/v1/token": confirmedGrant("5fbc55df"),
      "POST /auth/v1/recover": { status: 200, body: {} },
    });
    const { code, out } = await run(["--site", site, "--identity", identity("qa@example.test", "a-password-value")]);

    expect(auth.requests.some((request) => request.url.startsWith("/auth/v1/recover"))).toBe(false);
    expect(out).toMatch(/RECOVER\s+skipped:/);
    expect(code).toBe(0);
  });

  // GoTrue rate-limits recovery per address, so a second run moments after the first is the normal
  // state of this instrument rather than a broken release. A note, not a problem.
  it("reads a recovery rate limit as a request already made, not as a failure", async () => {
    const { site, auth } = await serveStack({
      "GET /auth/v1/settings": settingsReply,
      "POST /auth/v1/token": confirmedGrant("5fbc55df"),
      "POST /auth/v1/recover": { status: 429, body: { error_description: "For security purposes, you can only request this after 55 seconds." } },
    });
    const { code, out } = await run(["--site", site, "--identity", identity("qa@example.test", "a-password-value"), "--request-recovery"]);

    expect(auth.requests.some((request) => request.url.startsWith("/auth/v1/recover"))).toBe(true);
    expect(out).toMatch(/RECOVER\s+redirect_to=\S+\/auth\/update-password HTTP 429[^]*already asked/);
    expect(out).not.toMatch(/PROBLEM/);
    expect(code).toBe(0);
  });

  it("reports a recovery request the hosted Auth service refuses outright", async () => {
    const { site, auth } = await serveStack({
      "GET /auth/v1/settings": settingsReply,
      "POST /auth/v1/token": confirmedGrant("5fbc55df"),
      "POST /auth/v1/recover": { status: 401, body: { error_description: "invalid claim: missing admin token" } },
    });
    const { code, out } = await run(["--site", site, "--identity", identity("qa@example.test", "a-password-value"), "--request-recovery"]);

    expect(auth.requests.some((request) => request.url.startsWith("/auth/v1/recover"))).toBe(true);
    expect(out).toMatch(/PROBLEM\s+RECOVER[^]*HTTP 401/);
    expect(code).toBe(1);
  });

  it("checks the deployed erasure boundary from the site's own origin", async () => {
    const { site, auth } = await serveStack({
      "GET /auth/v1/settings": settingsReply,
      "OPTIONS /functions/v1/delete-account": preflight("placeholder"),
      "POST /functions/v1/delete-account": bearerlessPost,
    });
    const { code, out } = await run(["--site", site]);

    expect(out).toMatch(/EDGE\s+OPTIONS delete-account HTTP 204[^]*access-control-allow-origin/);
    expect(out).toMatch(/EDGE\s+POST delete-account without a bearer HTTP 401[^]*Sign in before deleting/);
    expect(auth.requests.find((request) => request.method === "OPTIONS")?.headers.origin).toBe(site);
    expect(code).toBe(0);
  });

  it("reports a boundary that no longer answers the way the release line promises", async () => {
    const { site } = await serveStack({
      "GET /auth/v1/settings": settingsReply,
      "OPTIONS /functions/v1/delete-account": { status: 404, body: {} },
      "POST /functions/v1/delete-account": bearerlessPost,
    });
    const { code, out } = await run(["--site", site]);

    expect(out).toMatch(readTheBundle);
    expect(out).toMatch(/PROBLEM\s+EDGE\s+OPTIONS delete-account[^]*expected HTTP 204[^]*404/);
    expect(code).toBe(1);
  });

  it("refuses to report a hosted state when the served bundle carries no publishable key", async () => {
    const { site, auth } = await serveStack({}, []);
    const { code, out } = await run(["--site", site]);

    expect(out).toMatch(/PROBLEM\s+[^]*no publishable key/);
    expect(auth.requests).toHaveLength(0);
    expect(out).not.toMatch(/AUTH\s+disable_signup/);
    expect(code).toBe(1);
  });

  it("prints no credential value anywhere in its report", async () => {
    const { site } = await serveStack({
      "GET /auth/v1/settings": settingsReply,
      "POST /auth/v1/token": confirmedGrant("u1"),
      "POST /auth/v1/resend": { status: 200, body: {} },
      "OPTIONS /functions/v1/delete-account": preflight("placeholder"),
      "POST /functions/v1/delete-account": bearerlessPost,
    });
    const { out } = await run(["--site", site, "--identity", identity("qa@example.test", "the-qa-password-value"), "--request-confirmation"]);

    // A report that printed nothing would also print no secrets, so the run has to be shown to have
    // produced its lines first.
    expect(out).toMatch(readTheBundle);
    expect(out).toMatch(/GRANT\s+qa@example\.test HTTP 200/);
    expect(out).toMatch(/RESEND\s+redirect_to=/);
    expect(out).not.toContain(LONG_KEY);
    expect(out).not.toContain(SHORT_FRAGMENT);
    expect(out).not.toContain("the-qa-password-value");
    expect(out).not.toContain(SESSION_VALUE);
  });

  it("is an operator command, not a CI or local release step", () => {
    const read = (relative: string) => readFileSync(path.join(projectRoot, ...relative.split("/")), "utf8");
    const workflows = ["ci.yml", "release-full-browser.yml", "live-public.yml", "codeql-release.yml"]
      .map((name) => `.github/workflows/${name}`)
      .map(read)
      .join("\n");
    const scripts = JSON.parse(read("package.json")).scripts as Record<string, string>;

    expect(workflows).not.toContain("hosted-auth-status");
    expect(scripts["verify:hosted:auth"]).toBe("node scripts/hosted-auth-status.mjs");
    for (const composite of ["verify:release:local", "verify:e2e:local", "test:e2e:smoke"]) {
      expect(scripts[composite] ?? "", `${composite} would put a production probe inside a local gate`).not.toContain("hosted-auth-status");
    }
  });
});
