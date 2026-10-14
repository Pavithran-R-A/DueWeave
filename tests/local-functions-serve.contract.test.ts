import { describe, expect, it } from "vitest";
import { classify, isLoopback } from "../scripts/local-functions-serve.mjs";

// `node scripts/local-functions-serve.mjs start` decides, on every push, whether the erasure
// battery's endpoint is really there. Its verdict is the whole gate: `pnpm test:live` runs 331
// tests against that endpoint, and a readiness check that said "ready" to the wrong answer would
// turn a stack that never came up into a green release row. Until now the decision lived in a
// module that could not be imported — its top level parsed `process.argv` and exited — so the only
// thing that had ever exercised the table was a real Docker run. These tests pin the table itself,
// so a future edit cannot quietly widen what counts as served.
//
// The one answer that means served is 401-with-a-sign-in-refusal: the function is mounted, it read
// its own origin config, and it refused a caller that sent no bearer token. A 401 that refuses for
// any other reason, and any 2xx, means something else entirely — and a 2xx here would mean the
// probe *performed an account erasure*, which is why the probe sends no token and why this gate
// must never read a success as readiness.

describe("the erasure serve's readiness verdict", () => {
  it("counts only a tokenless refusal as served-and-configured", () => {
    expect(classify(401, "Sign in before deleting your account.")).toBe("served");
  });

  it("refuses to read a 401 from some other cause as served", () => {
    expect(classify(401, "invalid JWT: JWSInvalidSignature")).toBe("unexpected-401");
  });

  it("refuses to read an answer that actually ran the erasure as served", () => {
    expect(classify(200, JSON.stringify({ deleted: true }))).toBe("unexpected-200");
  });

  it("names the 501 that means ALLOWED_APP_ORIGIN never reached the runtime", () => {
    expect(classify(501, "The function doesn't have the env var ALLOWED_APP_ORIGIN")).toBe("unconfigured");
  });

  it("names a function that is not mounted at all", () => {
    expect(classify(404, "not found")).toBe("not-mounted");
  });

  it.each([502, 503])("names a gateway that is answering, but not serving (%i)", (status) => {
    expect(classify(status, "bad gateway")).toBe(`gateway-${status}`);
  });
});

// The serve exists to run *this checkout's* function code against the local stack, and `probe()`
// POSTs to the endpoint with the anon key from `.env.local`. If the API URL ever pointed at the
// hosted project, that probe would be a production write attempt from a CI step — so the target is
// refused before anything is fetched. This is the guard that keeps the release instrument away from
// real customer data, and it is the reason the loopback rule is the same one
// `local-stack-check.mjs` and `local-supabase-env.mjs` enforce.
describe("the erasure serve's target guard", () => {
  it.each(["http://127.0.0.1:54321", "http://localhost:54321", "http://127.0.0.1:54321/"])("accepts the local stack (%s)", (url) => {
    expect(isLoopback(url)).toBe(true);
  });

  it("refuses the hosted production project this release must never probe", () => {
    expect(isLoopback("https://ugzdqcytouwfdlcjujqv.supabase.co")).toBe(false);
  });

  it("refuses a target it was not given", () => {
    expect(isLoopback("")).toBe(false);
    expect(isLoopback(undefined)).toBe(false);
  });

  it("refuses an address the local stack is not ever served at, rather than guessing", () => {
    expect(isLoopback("http://[::1]:54321")).toBe(false);
  });

  // A malformed `.env.local` value must read as a refusal, not as a thrown TypeError: `stop()` calls
  // this rule from a `if: always()` teardown, and a cleanup step that crashes reds the job for the
  // wrong reason — the reason the script's own comment gives for bounding every other failure.
  it("refuses a value that is not a URL instead of throwing at the caller", () => {
    expect(isLoopback("127.0.0.1:54321")).toBe(false);
  });
});
