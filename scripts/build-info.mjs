import process from "node:process";

// CL-7 final corrections, item 10. A deployment has to be able to say what it is. Cloudflare
// Pages exports `CF_PAGES_COMMIT_SHA` into every Git-integrated build; GitHub Actions exports
// `GITHUB_SHA` into every workflow build. Either is a fact about the checkout, not a claim. A
// laptop build is neither, so it names no commit rather than reading HEAD from a working tree
// that may hold uncommitted changes — an invented SHA is worse than an absent one. An operator
// publishing a direct upload can set `DUEWEAVE_BUILD_COMMIT`, and the stamp records that the
// claim is theirs (`source: "operator"`) rather than the platform's; parity is what checks the
// bytes against that claim.
//
// The stamp is deliberately only these three keys. It is emitted under a fixed name so a
// currentness gate can ask for it, and it carries no timestamp so two builds of the same commit
// produce the same file.

const FULL_OBJECT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

function fullObject(value) {
  const candidate = typeof value === "string" ? value.trim().toLowerCase() : "";
  return FULL_OBJECT.test(candidate) ? candidate : null;
}

/** The platform's checkout wins over CI's; an explicit operator claim wins over both. */
export function resolveBuildCommit(environment = process.env) {
  for (const [source, value] of [
    ["operator", environment.DUEWEAVE_BUILD_COMMIT],
    ["cloudflare-pages", environment.CF_PAGES_COMMIT_SHA],
    ["github-actions", environment.GITHUB_SHA],
  ]) {
    const commit = fullObject(value);
    if (commit) return { commit, source };
  }
  return { commit: null, source: "none" };
}

export function buildInfoFor(environment = process.env) {
  return { schema: 1, ...resolveBuildCommit(environment) };
}

/** Emits `dist/build-info.json`; `vite.config.ts` is the only caller. */
export function buildInfoPlugin(environment = process.env) {
  return {
    name: "dueweave-build-info",
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "build-info.json",
        source: `${JSON.stringify(buildInfoFor(environment))}\n`,
      });
    },
  };
}
