import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ERASURE_CONFIRMATION_PHRASE,
  INCOMPLETE_ERASURE_MESSAGE,
  authorizeMethod,
  bearerToken,
  erasureFailureMessage,
  parseConfirmation,
  requestOriginFor,
} from "../supabase/functions/delete-account/contract.ts";

// Arc 3C STEP 4 — the request-handling decisions of the delete-account Edge Function, tested as
// pure functions.
//
// The handler runs on Deno and cannot be imported by this project's Node test runner, so the split
// is deliberate: every rule the brief states about that endpoint (authenticated caller only, never a
// browser-named target, explicit confirmation, unsupported methods rejected, no secret in the reply)
// is expressed here where it can be executed, and `index.ts` only wires these rules to HTTP. The
// wiring is then checked structurally, at the bottom of this file, because a rule the tests cannot
// reach is a rule nothing enforces. The parts that genuinely need a running stack — GoTrue accepting
// the bearer token, the RPC refusing an anonymous caller — belong to the live suite, not this file.
//
// The rule that makes this file worth having: a rejection must never repeat what the browser sent.
// An error path that echoes a token, an id or a raw Postgres message turns a refusal into a leak.

describe("erasure confirmation", () => {
  it("accepts the exact phrase, and only it", () => {
    expect(parseConfirmation(JSON.stringify({ confirm: ERASURE_CONFIRMATION_PHRASE }))).toBeNull();
    // Surrounding whitespace is a typing accident; a different word is not a confirmation.
    expect(parseConfirmation(`{"confirm":"  ${ERASURE_CONFIRMATION_PHRASE}  "}`)).toBeNull();
  });

  it("refuses a missing, empty, near-miss, or wrong-typed confirmation", () => {
    for (const body of [
      {},
      { confirm: "" },
      { confirm: "yes" },
      { confirm: "delete" },
      { confirm: ERASURE_CONFIRMATION_PHRASE.toLowerCase() },
      { confirm: `${ERASURE_CONFIRMATION_PHRASE} now` },
      { confirm: true },
      { confirm: 1 },
      { confirm: null },
    ]) {
      const failure = parseConfirmation(JSON.stringify(body));
      expect(failure, `${JSON.stringify(body)} must not be accepted as confirmation`).not.toBeNull();
      expect(failure!.status).toBe(400);
    }
  });

  it("refuses any body that names a target, because identity comes from the token alone", () => {
    // This is the brief's STEP 4 rule as a measurement: the endpoint has no field for a target user,
    // so a request that supplies one is a mismatch to report, not a hint to follow.
    const target = "b3f0c2a4-1d5e-4a6b-9c7d-8e1f2a3b4c5d";
    for (const key of ["user_id", "userId", "target_user_id", "id", "email", "subject"]) {
      const failure = parseConfirmation(JSON.stringify({ confirm: ERASURE_CONFIRMATION_PHRASE, [key]: target }));
      expect(failure, `a body carrying ${key} must be refused`).not.toBeNull();
      expect(failure!.status).toBe(400);
      expect(failure!.message, "a refusal must not repeat the identifier it refused").not.toContain(target);
      expect(failure!.message).not.toContain(key);
    }
  });

  it("refuses malformed, non-object and unverifiable bodies", () => {
    for (const body of ["", "not json", "{", "[1,2]", '"delete"', "null", "42"]) {
      const failure = parseConfirmation(body);
      expect(failure, `${JSON.stringify(body)} must not reach the erasure path`).not.toBeNull();
      expect(failure!.status).toBe(400);
    }
  });
});

describe("caller token extraction", () => {
  it("reads a bearer token and nothing else", () => {
    expect(bearerToken("Bearer eyJhbGciOi.test-payload.sig").token).toBe("eyJhbGciOi.test-payload.sig");
    expect(bearerToken("bearer eyJhbGciOi.test-payload.sig").token).toBe("eyJhbGciOi.test-payload.sig");
  });

  it("refuses a missing, empty, or wrongly schemeed credential without repeating it", () => {
    const secret = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzZW50aW5lbCJ9.c2lnbmF0dXJlLW1hdGVyaWFs";
    for (const header of [null, undefined, "", "Bearer", "Bearer ", "Token abc", `Basic ${secret}`, `Bearer ${secret} extra`]) {
      const failure = bearerToken(header);
      expect(failure, `${JSON.stringify(header)} is not a bearer credential`).not.toBeNull();
      expect(failure!.status).toBe(401);
      if (header) expect(failure!.message, "a refusal must not carry the credential").not.toContain(secret.slice(0, 12));
    }
  });
});

describe("origin policy", () => {
  const allowed = "https://dueweave.example";

  it("serves nobody until the app origin is configured", () => {
    for (const configured of [null, undefined, ""]) {
      const failure = requestOriginFor(allowed, configured);
      expect(failure, "an unconfigured function must not guess an origin").not.toBeNull();
      expect(failure!.status).toBe(501);
      expect(failure!.message).toContain("ALLOWED_APP_ORIGIN");
    }
  });

  it("echoes the configured origin, and refuses a different one", () => {
    expect(requestOriginFor(allowed, allowed)).toEqual({ origin: allowed });
    expect(requestOriginFor("https://evil.example", allowed)).toEqual({ status: 403, message: expect.any(String) });
    expect(requestOriginFor("null", allowed)!.status).toBe(403);
    // A non-browser caller (the CLI, QA scripts) sends no origin and is judged on its token instead.
    expect(requestOriginFor(null, allowed)).toEqual({ origin: null });
  });

  it("compares the origin exactly, not by prefix or by host alone", () => {
    // Each of these shares most of its characters with the allowed origin. An origin check built on
    // `startsWith`, on hostname, or on a loose includes() accepts all four, and the first two are
    // attacker-registerable. The exact-match case is asserted above.
    for (const near of ["https://dueweave.example.evil.test", "https://dueweave.example:4443", "http://dueweave.example", "https://dueweave.example/"]) {
      expect(requestOriginFor(near, allowed), `${near} is not ${allowed}`).toEqual({ status: 403, message: expect.any(String) });
    }
  });
});

describe("method policy", () => {
  it("accepts POST alone", () => {
    expect(authorizeMethod("POST")).toBeNull();
    for (const method of ["GET", "HEAD", "PUT", "PATCH", "DELETE", "OPTIONS", "post", ""]) {
      const failure = authorizeMethod(method);
      expect(failure, `${method} must not trigger an erasure`).not.toBeNull();
      expect(failure!.status).toBe(405);
    }
  });
});

describe("failure copy", () => {
  it("answers the two states the caller can act on, in the product's own words", () => {
    const founder = "This account is part of a Founder review record, so DueWeave cannot erase it from the self-service path";
    expect(erasureFailureMessage(founder)).toBe(founder);
    expect(erasureFailureMessage("Authentication is required")).toMatch(/sign in/i);
  });

  it("replaces anything else with copy that says what happened to the account", () => {
    const generic = /unchanged/i;
    for (const raw of [
      undefined,
      "",
      'permission denied for function delete_my_account',
      'duplicate key value violates unique constraint "payments_pkey"',
      '{"code":"42501","message":"invalid input syntax for type uuid"}',
      "connection to server at 10.0.1.7 failed",
    ]) {
      const message = erasureFailureMessage(raw);
      expect(message).toMatch(generic);
      if (raw) {
        for (const fragment of ["delete_my_account", "42501", "10.0.1.7", "uuid", "permission denied"]) {
          expect(message, `internal detail ${fragment} reached browser copy`).not.toContain(fragment);
        }
      }
    }
  });

  it("keeps the unfinished case separate from the unchanged case", () => {
    // The one response that must never read like a success: the records are gone, the account is not.
    expect(INCOMPLETE_ERASURE_MESSAGE).toMatch(/could not finish|did not finish/i);
    expect(INCOMPLETE_ERASURE_MESSAGE).not.toMatch(/unchanged/);
    expect(erasureFailureMessage(undefined)).not.toBe(INCOMPLETE_ERASURE_MESSAGE);
  });
});

// The handler cannot be imported here — it targets the Deno runtime — so its wiring is read as
// source. That is weaker than executing it, and says so: these assertions catch the specific edits
// that would break a STEP 4 rule silently (wiring a body field into the admin call, returning a raw
// database error, putting a privileged value in a response, reordering the two steps), which are the
// ways this file could rot. The behaviour they stand guard over is executed against a live stack by
// tests/arc3c-local-account-erasure.test.ts.
describe("delete-account handler wiring", () => {
  const functionDir = path.resolve(import.meta.dirname, "..", "supabase", "functions", "delete-account");
  const handler = readFileSync(path.join(functionDir, "index.ts"), "utf8");

  it("allows every browser header sent by the Supabase SDK preflight without widening the origin", () => {
    const headerList = /"access-control-allow-headers": "([^"]+)"/.exec(handler)?.[1] ?? "";
    const allowedHeaders = new Set(headerList.split(",").map((item) => item.trim()));
    for (const required of ["authorization", "apikey", "x-client-info", "content-type", "x-retry-count", "traceparent", "tracestate", "baggage"]) {
      expect(allowedHeaders.has(required), `Missing CORS preflight header: ${required}`).toBe(true);
    }
    expect(handler).toContain('Deno.env.get("ALLOWED_APP_ORIGIN") ?? "https://dueweave.pages.dev"');
    expect(handler).toContain("requestOriginFor(request.headers.get(\"origin\"), configured)");
    expect(handler).not.toContain('"access-control-allow-origin": "*"');
  });

  it("takes the target from the confirmed session and nowhere else", () => {
    expect(handler).toContain("auth.admin.deleteUser(session.user.id)");
    expect(handler.match(/deleteUser\(/g), "exactly one admin deletion call").toHaveLength(1);
    expect(handler).toContain("await caller.auth.getUser()");
    // The RPC is called with no payload, so there is no route from a request body to a target.
    expect(handler).toContain("await caller.rpc(ERASURE_RPC)");
    expect(handler).not.toMatch(/rpc\(ERASURE_RPC,\s*\{/);
  });

  it("purges the business records before the auth account goes", () => {
    // B17 in one line: the cascade from auth.users is what used to abort. It has to run last, on a
    // schema that no longer holds a guarded row.
    expect(handler.indexOf("caller.rpc(ERASURE_RPC)")).toBeGreaterThan(-1);
    expect(handler.indexOf("caller.rpc(ERASURE_RPC)")).toBeLessThan(handler.indexOf("auth.admin.deleteUser("));
  });

  it("reads current injected keys with an explicit legacy-local fallback, and never ships them", () => {
    for (const name of ["SUPABASE_URL", "SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY"]) {
      const reads = handler.match(new RegExp(`Deno\\.env\\.get\\("${name}"\\)`, "g")) ?? [];
      expect(reads, `${name} must be read exactly once, from Deno.env`).toHaveLength(1);
    }
    for (const name of ["SUPABASE_PUBLISHABLE_KEYS", "SUPABASE_SECRET_KEYS"]) {
      expect(handler, `${name} must be part of the named injected-key path`).toContain(`injectedKey("${name}")`);
    }
    expect(handler).toContain('JSON.parse(raw) as Record<string, unknown>');
    expect(handler).toContain("parsed.default");
    // No interpolation of a key or a token into anything that leaves the process.
    for (const smuggled of ["${secretKey", "${publishableKey", "${url}", "message: purgeError", "message: accountError", "message: error"]) {
      expect(handler, `${smuggled} would put a credential or a raw database error in a reply`).not.toContain(smuggled);
    }
    for (const logged of handler.match(/console\.\w+\(([^)]*)\)/g) ?? []) {
      expect(logged.toLowerCase(), `a log line carried a privileged word: ${logged}`).not.toMatch(/token|apikey|api_key|secret|service|email|origin/);
    }
  });

  it("has exactly one way to reach a value from outside the process", () => {
    // `VITE_*` is compiled into the public bundle and `process.env` is a Node accessor that does not
    // exist on the Edge Runtime; a value read either way is a bug that only shows up when the
    // endpoint is asked to do its job. Deno.env is the platform's injected-secret mechanism. The
    // handler reads origin + URL, one current-key accessor, and two legacy local fallbacks.
    expect(handler).not.toMatch(/import\.meta\.env|process\.env|VITE_/);
    expect(handler.match(/Deno\.env\.get\(/g) ?? []).toHaveLength(5);
  });

  it("answers every failure through the sanitised copy, not the received error", () => {
    expect(handler).toContain("erasureFailureMessage(purgeError.message)");
    expect(handler).toContain("message: INCOMPLETE_ERASURE_MESSAGE");
    expect(handler).toContain('status: "incomplete"');
    expect(handler).toContain('status: "deleted"');
    // An unrecognised database message must not be able to reach the browser verbatim.
    expect(handler).not.toMatch(/message:\s*\w+Error\.message/);
  });

  it("stays out of the browser bundle by living outside client/src", () => {
    // `tests/credential-boundary.contract.test.ts` scans client/src for privileged vocabulary; this
    // endpoint is the one place that vocabulary is legitimate, so the proof it cannot leak is that no
    // client file references it as anything but a function slug.
    const clientSource = path.resolve(import.meta.dirname, "..", "client", "src");
    const clientside = readFileSync(path.join(clientSource, "lib", "supabase.ts"), "utf8");
    expect(clientside).not.toMatch(/SERVICE_ROLE|service_role|Deno\./);
    expect(handler).not.toMatch(/VITE_/);
    // Deno needs the extension on a relative import; Vite would never see this file at all.
    expect(handler).toContain('from "./contract.ts"');
  });
});
