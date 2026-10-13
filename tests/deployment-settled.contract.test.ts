import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { assertDeploymentSettled } from "../scripts/deployment-settled-check.mjs";

// `Live production public smoke` runs on every push to `release/consumer-live`, and it runs
// against the site Cloudflare is building at that moment. Measured on 2026-10-13: a push at
// 16:19:01Z did not serve a byte-identical stylesheet until 16:36Z, so the suite's first
// `page.goto("/auth")` can land mid-rebuild — on the old bundle, on a half-updated one, or on
// an edge node that is answering while its neighbour has already swapped. The specs wait 5s for
// a heading, which is the right wait for a site that has finished changing and the wrong tool
// for a site that has not: run 38402697489 failed on `your follow-ups, in one calm place` while
// the deployment underneath it was still moving.
//
// The repair is to stop asking the assertion to absorb the rebuild. Before any spec runs, the
// deployed document is read repeatedly until two consecutive reads name the same entry assets,
// and only then is it rendered once with a generous wait. Nothing in a spec is loosened: a
// heading that never appears is still a failure, it just is not a race.
//
// "Two consecutive reads agree" is the whole claim, and its limit is stated here so nobody reads
// more into it: it proves the site stopped changing, not that it stopped at *this* push's
// commit. Certifying an exact head is `scripts/verify-deployed-parity.mjs`, which compares the
// built artifact file by file; this gate's own comment says the same thing.
describe("the live public gate waits for the deployment to stop moving", () => {
  /** A document in the shape Vite emits, with one fingerprint per build. */
  const document = (fingerprint: string) => `<!doctype html><html><head>
    <script type="module" crossorigin src="/assets/index-${fingerprint}.js"></script>
    <link rel="stylesheet" crossorigin href="/assets/index-${fingerprint}.css">
  </head><body><div id="root"></div></body></html>`;

  /** A clock the test advances, so a deadline is proved without waiting eight minutes for it. */
  function fakeClock(start = 0) {
    const clock = { value: start };
    return {
      now: () => clock.value,
      sleep: async (ms: number) => {
        clock.value += ms;
      },
    };
  }

  /** Reads `pages` in order and then repeats the last one, failing loudly if it is asked for more. */
  function reader(...pages: (string | Error)[]) {
    const calls: string[] = [];
    const fetchDocument = async (url: string) => {
      const page = pages[calls.length] ?? pages.at(-1);
      calls.push(url);
      if (page instanceof Error) throw page;
      return { status: 200, html: page };
    };
    return { fetchDocument, calls };
  }

  it("settles as soon as two reads name the same entry assets", async () => {
    const { fetchDocument, calls } = reader(document("aaa"), document("aaa"));
    const settled = await assertDeploymentSettled({ fetchDocument, ...fakeClock() });

    expect(settled.assets).toEqual(["/assets/index-aaa.css", "/assets/index-aaa.js"]);
    expect(calls).toEqual(["https://dueweave.pages.dev/auth", "https://dueweave.pages.dev/auth"]);
  });

  it("keeps waiting while a rebuild changes what the document names", async () => {
    const clock = fakeClock();
    const { fetchDocument, calls } = reader(document("aaa"), document("bbb"), document("bbb"));
    const settled = await assertDeploymentSettled({ intervalMs: 1_000, fetchDocument, ...clock });

    expect(calls).toHaveLength(3);
    expect(settled.assets).toEqual(["/assets/index-bbb.css", "/assets/index-bbb.js"]);
    // The wait is real waiting, not a busy loop: two intervals elapsed between three reads.
    expect(clock.now()).toBe(2_000);
  });

  it("does not count a read that never produced a document as settled", async () => {
    const clock = fakeClock();
    const { fetchDocument, calls } = reader(new Error("socket hang up"), document("aaa"), document("aaa"));
    const settled = await assertDeploymentSettled({ intervalMs: 1_000, fetchDocument, ...clock });

    expect(calls).toHaveLength(3);
    expect(settled.reads).toBe(3);
  });

  it("refuses to certify a document that names no entry assets at all", async () => {
    // A Cloudflare error page, or an `index.html` whose script tag a build dropped, would agree
    // with itself perfectly well and certify an empty site as stable.
    const clock = fakeClock();
    const { fetchDocument } = reader("<html><body>error</body></html>");
    await expect(assertDeploymentSettled({ timeoutMs: 5_000, intervalMs: 1_000, fetchDocument, ...clock })).rejects.toThrow(
      /never served a document naming its entry assets/,
    );
  });

  it("fails rather than passing on a site that is still being rebuilt at its deadline", async () => {
    const clock = fakeClock();
    let flip = 0;
    const fetchDocument = async () => {
      flip += 1;
      return { status: 200, html: document(flip % 2 ? "aaa" : "bbb") };
    };

    await expect(assertDeploymentSettled({ timeoutMs: 5_000, intervalMs: 1_000, fetchDocument, ...clock })).rejects.toThrow(
      // The message has to carry both fingerprints, or the operator cannot tell a stuck rebuild
      // from a site that is cycling between two deployments.
      /still being rebuilt after 5000ms.*index-aaa\.js.*index-bbb\.js/s,
    );
  });

  it("reports the origin it settled on so a run can be attributed to a site", async () => {
    const clock = fakeClock();
    const { fetchDocument, calls } = reader(document("aaa"), document("aaa"));
    const settled = await assertDeploymentSettled({ origin: "https://example.pages.dev", fetchDocument, ...clock });

    expect(calls[0]).toBe("https://example.pages.dev/auth");
    expect(settled.url).toBe("https://example.pages.dev/auth");
  });
});

describe("the wiring that makes the suite use it", () => {
  const root = path.resolve(import.meta.dirname, "..");
  const config = readFileSync(path.join(root, "playwright.live-public.config.ts"), "utf8").replace(/\r\n/g, "\n");
  const setup = readFileSync(path.join(root, "e2e-live", "settled-deployment-setup.mjs"), "utf8").replace(/\r\n/g, "\n");

  it("runs the wait before the specs", () => {
    expect(config).toMatch(/globalSetup:\s*"\.\/e2e-live\/settled-deployment-setup\.mjs"/);
    expect(setup).toContain("assertDeploymentSettled");
  });

  it("leaves every spec assertion at the wait it already had", () => {
    // The point of the gate is that the cause is fixed rather than the assertions being widened to
    // tolerate a moving site: no retries, and no `expect` timeout anywhere in the config.
    expect(config).toMatch(/retries:\s*0/);
    expect(config).not.toMatch(/expect\s*:\s*\{[^}]*timeout/);
  });

  it("renders the settled document once, with a wait a spec never gets", () => {
    const generous = [...setup.matchAll(/timeout:\s*(\d[\d_]*)/g)].map((match) => Number(match[1].replace(/_/g, "")));
    expect(
      generous.some((ms) => ms >= 30_000),
      "the setup renders with the same short wait a spec uses, which is the race this file exists to remove",
    ).toBe(true);
  });

  it("warms the same site the specs will open", () => {
    // The origin is stated twice — the suite navigates by `baseURL`, the wait cannot be handed a
    // argument from a config — and if those two ever disagree, the specs are back to racing a
    // cold edge while a green setup line claims they are not.
    const configured = /baseURL:\s*"([^"]+)"/.exec(config)?.[1];
    const waited = /const origin = "([^"]+)"/.exec(setup)?.[1];
    expect(configured, "the live config no longer states its baseURL as a literal, so this guard cannot compare it").toBeDefined();
    expect(waited, "the setup no longer names its origin in one place, so this guard cannot compare it").toBe(configured);
  });
});
