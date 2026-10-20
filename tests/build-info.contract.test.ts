import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// CL-7 final corrections, item 10. Nothing in the shipped build says which commit it was compiled
// from: `live-settle` proves two reads agree with each other, and parity proves the served bytes
// equal a local build, but a site still serving an older deployment can agree with itself and can
// match a local build of the older commit. Cloudflare Pages exports `CF_PAGES_COMMIT_SHA` into the
// build environment; this module turns that — or CI's `GITHUB_SHA`, or an operator's explicit claim
// for a direct upload — into one deterministic file at the site root, so the currentness gate can
// ask the deployment itself what it is. A local build names no commit rather than guessing one from
// a working tree that may hold uncommitted changes.

const projectRoot = path.resolve(import.meta.dirname, "..");
const viteConfig = readFileSync(path.join(projectRoot, "vite.config.ts"), "utf8");

const load = () => import("../scripts/build-info.mjs");

const SHA = "c".repeat(40);
const CI_SHA = "d".repeat(40);
const OPERATOR_SHA = "e".repeat(40);

describe("the commit a build names", () => {
  it("takes the object Cloudflare Pages checked out", async () => {
    const { resolveBuildCommit } = await load();
    expect(resolveBuildCommit({ CF_PAGES_COMMIT_SHA: SHA })).toEqual({ commit: SHA, source: "cloudflare-pages" });
  });

  it("takes the commit a GitHub Actions build was started for when Pages supplied nothing", async () => {
    const { resolveBuildCommit } = await load();
    expect(resolveBuildCommit({ GITHUB_SHA: CI_SHA })).toEqual({ commit: CI_SHA, source: "github-actions" });
  });

  it("prefers the platform's own value over CI's and normalises its case", async () => {
    const { resolveBuildCommit } = await load();
    expect(resolveBuildCommit({ CF_PAGES_COMMIT_SHA: SHA.toUpperCase(), GITHUB_SHA: CI_SHA })).toEqual({
      commit: SHA,
      source: "cloudflare-pages",
    });
  });

  it("lets a direct upload carry an explicitly claimed commit", async () => {
    // The repair on 2026-10-20 was a deployment from the connected account, not a Git build. An
    // unstated local build must not borrow HEAD, but an operator who means to publish a commit can
    // say so, and the claim is labelled as theirs rather than as the platform's.
    const { resolveBuildCommit } = await load();
    expect(resolveBuildCommit({ DUEWEAVE_BUILD_COMMIT: OPERATOR_SHA, GITHUB_SHA: CI_SHA })).toEqual({
      commit: OPERATOR_SHA,
      source: "operator",
    });
  });

  it("names no commit at all when no trusted environment supplies one", async () => {
    const { resolveBuildCommit } = await load();
    expect(resolveBuildCommit({})).toEqual({ commit: null, source: "none" });
    expect(resolveBuildCommit({ CF_PAGES_COMMIT_SHA: "   ", GITHUB_SHA: "" })).toEqual({ commit: null, source: "none" });
  });

  it("refuses a value that is not a full commit id instead of publishing a partial one", async () => {
    const { resolveBuildCommit } = await load();
    for (const value of ["2eed7dd", "z".repeat(40), "2eed7dd82347887af3b24e96ac016d6fb2c5cdf"]) {
      expect(resolveBuildCommit({ CF_PAGES_COMMIT_SHA: value }), `"${value}" was accepted`).toEqual({
        commit: null,
        source: "none",
      });
    }
  });

  it("writes only what identifies the commit, so two builds of one commit produce the same file", async () => {
    const { buildInfoFor } = await load();
    const first = buildInfoFor({ CF_PAGES_COMMIT_SHA: SHA });
    expect(first).toEqual({ schema: 1, commit: SHA, source: "cloudflare-pages" });
    expect(buildInfoFor({ CF_PAGES_COMMIT_SHA: SHA })).toEqual(first);
    expect(Object.keys(first).sort()).toEqual(["commit", "schema", "source"]);
  });

  it("emits that stamp into the bundle at a stable path", async () => {
    const { buildInfoPlugin } = await load();
    const emitted: { type: string; fileName: string; source: string }[] = [];
    const plugin = buildInfoPlugin({ CF_PAGES_COMMIT_SHA: SHA });
    expect(plugin.name).toBe("dueweave-build-info");
    plugin.generateBundle.call({ emitFile: (file: never) => emitted.push(file) });
    expect(emitted).toHaveLength(1);
    expect(emitted[0].fileName).toBe("build-info.json");
    expect(JSON.parse(emitted[0].source)).toEqual({ schema: 1, commit: SHA, source: "cloudflare-pages" });
  });

  it("is wired into the build the site actually serves", () => {
    expect(viteConfig, "the plugin exists but the real build never registers it").toContain("buildInfoPlugin");
  });
});
