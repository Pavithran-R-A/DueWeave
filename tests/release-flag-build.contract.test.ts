import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RELEASE_FLAG_NAMES, type ReleaseFlagName } from "@/lib/release-flags";

// `import.meta.env.VITE_*` is replaced at build time, so the flags a bundle obeys are decided
// by whoever ran the build — and until this guard existed, no workflow stated them at all.
// Every CI bundle therefore compiled with signup and password recovery switched on by silence,
// which is the same fail-open defect the pages had, just one level up and outside review.
const root = path.resolve(import.meta.dirname, "..");
const workflowsDir = path.join(root, ".github/workflows");
const RUNS_A_BUILD = /^\s*run:\s*.*\b(?:pnpm|npm|yarn)\s+(?:exec\s+|run\s+)?build\b/m;

type Step = { key: string; body: string };

function stepsIn(file: string): Step[] {
  const lines = readFileSync(path.join(workflowsDir, file), "utf8").split(/\r?\n/);
  const steps: Step[] = [];
  let current: Step | null = null;
  const flush = () => {
    if (current) steps.push(current);
    current = null;
  };
  for (const line of lines) {
    if (/^ {6}- /.test(line)) {
      flush();
      const label = line.slice(8).trim();
      const name = label.startsWith("name:") ? label.slice(5).trim() : label.replace(/^uses:\s*/, "uses ");
      current = { key: `${file} :: ${name}`, body: "" };
      continue;
    }
    // A dedent back to column zero closes a job's step list; anything indented belongs to the step.
    if (current && line.trim() !== "" && !/^\s/.test(line)) {
      flush();
      continue;
    }
    if (current) current.body += `${line}\n`;
  }
  flush();
  return steps;
}

function buildSteps(): Step[] {
  return readdirSync(workflowsDir)
    .filter((name) => name.endsWith(".yml"))
    .flatMap((name) => stepsIn(name))
    .filter((step) => RUNS_A_BUILD.test(step.body));
}

function statedValues(body: string): Record<string, string> {
  const stated: Record<string, string> = {};
  for (const flag of RELEASE_FLAG_NAMES) {
    const match = body.match(new RegExp(`^\\s+${flag}:\\s*["']?(true|false)["']?\\s*$`, "m"));
    if (match) stated[flag] = match[1];
  }
  return stated;
}

// A bundle built for the disposable local stack has to offer registration and recovery,
// because that is the path the browser journeys click. A bundle built against the hosted
// project mirrors what production deploys, and production keeps both flows closed until
// confirmation delivery is qualified — so its artifact must not silently disagree.
const EXPECTED: Record<string, Record<ReleaseFlagName, "true" | "false">> = {
  "ci.yml :: Build the production bundle": { VITE_PUBLIC_SIGNUP_ENABLED: "false", VITE_AUTH_EMAIL_ENABLED: "false" },
  "ci.yml :: Build the bundle the suite drives": { VITE_PUBLIC_SIGNUP_ENABLED: "true", VITE_AUTH_EMAIL_ENABLED: "true" },
  "release-full-browser.yml :: Build against disposable local Supabase": { VITE_PUBLIC_SIGNUP_ENABLED: "true", VITE_AUTH_EMAIL_ENABLED: "true" },
};

describe("every CI build states its release flags on purpose", () => {
  it("finds the build steps by name, so an empty scan is not a pass", () => {
    expect(buildSteps().map((step) => step.key).sort()).toEqual(Object.keys(EXPECTED).sort());
  });

  it("states both flags with the value that build is meant to compile", () => {
    const problems = buildSteps()
      .filter((step) => step.key in EXPECTED)
      .flatMap((step) => {
        const stated = statedValues(step.body);
        return RELEASE_FLAG_NAMES.filter((flag) => stated[flag] !== EXPECTED[step.key][flag]).map(
          (flag) => `${step.key}: ${flag} is ${stated[flag] ?? "unstated"}, expected "${EXPECTED[step.key][flag]}"`,
        );
      });
    expect(problems, `these builds would compile a bundle nobody chose:\n${problems.join("\n")}`).toEqual([]);
  });
});

describe("the settings a developer and a reviewer can read", () => {
  it("writes both flags into the generated local stack configuration", () => {
    const generator = readFileSync(path.join(root, "scripts/local-supabase-env.mjs"), "utf8");
    for (const flag of RELEASE_FLAG_NAMES) {
      expect(generator, `${flag} is not written by the local generator`).toContain(`${flag}=true`);
    }
  });

  it("documents both flags and the exact-value rule instead of leaving them to be discovered", () => {
    const example = readFileSync(path.join(root, ".env.example"), "utf8");
    for (const flag of RELEASE_FLAG_NAMES) {
      expect(example, `${flag} is undocumented`).toContain(flag);
    }
    expect(example).toContain('"true"');
  });

  it("keeps the whole client reading release flags through the fail-closed helper", () => {
    const offenders: string[] = [];
    for (const file of readdirSync(path.join(root, "client/src"), { recursive: true })) {
      const relative = String(file);
      if (!/\.(ts|tsx)$/.test(relative) || relative.endsWith(".test.ts")) continue;
      const source = readFileSync(path.join(root, "client/src", relative), "utf8");
      if (/import\.meta\.env\.VITE_[A-Z0-9_]+\s*[!=]==\s*["'](true|false)["']/.test(source)) offenders.push(relative);
    }
    expect(offenders, `these files decide a release flag by comparing it to a string:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("refuses a production build in the config Vite actually loads", () => {
    const config = readFileSync(path.join(root, "vite.config.ts"), "utf8");
    expect(config).toContain('import { releaseFlagBuildError } from "./client/src/lib/release-flags"');
    expect(config).toContain("loadEnv(mode, projectRoot, \"VITE_\")");
    expect(config).toContain("if (flagError) throw new Error(flagError);");
  });
});
