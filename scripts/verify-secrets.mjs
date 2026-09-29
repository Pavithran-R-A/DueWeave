import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { spawnSync } from "node:child_process";

// PHASE 8: this product holds a Founder payment address, an approval history and a
// database password, and its browser bundle is public. A credential that reaches a
// commit cannot be recalled, so the release gate looks for the shapes of privileged
// values in everything the release actually ships: the tracked working tree and the
// built bundle.
//
// Two properties make this worth having as a gate rather than a habit:
//   1. `hard` rules cannot be silenced by the allowlist below. A service-role JWT is a
//      finding even if a matching exemption exists, so the file cannot be edited into
//      blindness the way a mutable ignore file can.
//   2. Every exemption names a rule and a reason, and the scanner fails if an exemption
//      stops matching anything, so the list cannot accumulate dead entries.
//
// Nothing here invents or stores a credential: the detectors are patterns, and the
// self-test that proves they fire lives outside the repository.

const projectRoot = path.resolve(import.meta.dirname, "..");

/** A JWT is only a secret when its payload says who it is for; anon keys ship in the bundle by design. */
function decodeJwtPayload(token) {
  try {
    const payload = token.split(".")[1];
    if (!payload) return null;
    return JSON.parse(Buffer.from(payload.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"));
  } catch {
    return null;
  }
}

const jwtCandidate = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;

const rules = [
  {
    id: "privileged-jwt",
    hard: true,
    describe: "a Supabase service-role (or other privileged) JWT — this authorises database writes from outside the app",
    match(line) {
      for (const token of line.match(jwtCandidate) ?? []) {
        const payload = decodeJwtPayload(token);
        if (payload && ["service_role", "supabase_admin", "postgres"].includes(payload.role)) return `${String(payload.role)} JWT, ${token.length} chars`;
      }
      return null;
    },
  },
  // Prefixes appear in prose and in the app's own detector list; a key is the value
  // that follows one, so the length is part of the rule rather than an exemption.
  { id: "supabase-secret-key", hard: true, describe: "a Supabase secret/service-role key in its current prefixed form", pattern: /\b(?:sb_secret|SB_SECRET|sb_service_role|SB_SERVICE_ROLE)_[A-Za-z0-9_-]{16,}/ },
  { id: "private-key-block", hard: true, describe: "a PEM private key block", pattern: /-----BEGIN (?:[A-Z0-9 ]+ )?PRIVATE KEY-----/ },
  { id: "cloud-access-key-id", hard: true, describe: "an AWS-style access key id", pattern: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { id: "github-token", hard: true, describe: "a GitHub token", pattern: /\b(?:gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,})/ },
  { id: "payment-provider-secret", hard: true, describe: "a live payment-provider secret key (Stripe/Razorpay) — money movement must not be reachable from source", pattern: /\b(?:sk|rk)_live_[0-9A-Za-z]{16,}\b|\brzp_live_[0-9A-Za-z]{12,}\b/ },
  { id: "google-api-key", hard: true, describe: "a Google API key", pattern: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { id: "slack-token", hard: true, describe: "a Slack token", pattern: /\bxox[baprs]-[0-9A-Za-z-]{10,}\b/ },
  { id: "database-url-with-password", hard: true, describe: "a connection string carrying a password", pattern: /\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s/@:'"]+:[^\s@'"]{6,}@/i },
  {
    id: "named-secret-assignment",
    hard: false,
    describe: "a literal assigned to a privileged-sounding name",
    pattern: /\b(?:service_role(?:_key|_secret)?|supabase_service(?:_key|_role_key)?|secret[_-]?key|access[_-]?token|client[_-]?secret|api[_-]?key|private[_-]?token)\b["']?\s*[:=]\s*["'][^\s"']{12,}["']/i,
  },
  {
    id: "literal-password",
    hard: false,
    describe: "a literal password in source",
    // A quoted run with no whitespace: prose like `errors.password = "Enter your password."`
    // is copy, not a credential, and printing it here would only train people to wave the rule off.
    pattern: /\b[A-Za-z0-9_.-]*password["']?\s*[:=]\s*["'][^\s"']{12,}["']/i,
  },
];

// Values assembled at runtime are not committed credentials, and a placeholder is a
// placeholder. Checked before the allowlist so a real literal is never excused by it.
const nonLiteral = /\$\{|process\.env|import\.meta\.env|<[A-Za-z0-9_.-]+>|\.{3}|\bxxx+\b|changeme|your[-_]|example\.(?:com|invalid)|placeholder|redacted|dummy|fake/i;

// Each entry exempts one file from one non-hard rule, and must say why. The measured
// state of this repository is that none is needed: every rule fires only on a real
// credential shape, so an added entry is a deliberate act a reviewer can see, and one
// that stops matching is itself a failure.
const allowlist = [];

function readTargetFiles(argv) {
  const dirFlag = argv.indexOf("--dir");
  if (dirFlag !== -1 && argv[dirFlag + 1]) {
    const root = path.resolve(projectRoot, argv[dirFlag + 1]);
    const walk = (dir) =>
      readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
        const full = path.join(dir, entry.name);
        return entry.isDirectory() ? walk(full) : [path.relative(projectRoot, full)];
      });
    return walk(root);
  }
  const tracked = spawnSync("git", ["ls-files", "-z"], { cwd: projectRoot, encoding: "utf8" });
  if (tracked.status !== 0) {
    console.error("Could not list tracked files with git ls-files.");
    process.exit(1);
  }
  const files = tracked.stdout.split("\0").filter(Boolean);
  // The built bundle is what actually reaches a browser, and it is not tracked.
  if (existsSync(path.join(projectRoot, "dist"))) {
    files.push(...walkDir("dist").map((file) => path.relative(projectRoot, file)));
  }
  return files;
}

function walkDir(dir) {
  const out = [];
  for (const entry of readdirSync(path.join(projectRoot, dir), { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walkDir(full));
    else out.push(full);
  }
  return out;
}

const binaryExtension = /\.(?:png|jpe?g|gif|webp|avif|ico|svgz|woff2?|ttf|otf|eot|pdf|zip|gz|br|mp4|webm|node|wasm)$/i;

function scan(file) {
  const absolute = path.join(projectRoot, file);
  if (!existsSync(absolute) || !statSync(absolute).isFile()) return [];
  if (binaryExtension.test(file)) return [];
  const buffer = readFileSync(absolute);
  if (buffer.subarray(0, 8000).includes(0)) return [];
  if (buffer.length > 4_000_000) {
    console.warn(`  skipped an oversized file: ${file} (${buffer.length} bytes)`);
    return [];
  }
  const findings = [];
  const lines = buffer.toString("utf8").split(/\r?\n/);
  lines.forEach((line, index) => {
    if (!line.trim()) return;
    for (const rule of rules) {
      if (rule.match) {
        const evidence = rule.match(line);
        if (evidence) findings.push({ file, line: index + 1, rule: rule.id, describe: rule.describe, hard: rule.hard, evidence });
        continue;
      }
      const matched = rule.pattern.exec(line);
      if (!matched) continue;
      // A value assembled at runtime, or an obvious placeholder, is not a committed
      // credential; without this the harness templates in e2e/ would drown the findings.
      if (!rule.hard && nonLiteral.test(line)) continue;
      findings.push({ file, line: index + 1, rule: rule.id, describe: rule.describe, hard: rule.hard, evidence: redact(matched[0]) });
    }
  });
  return findings;
}

// Enough to identify the match, never the value itself: a scanner that prints what it
// found leaks the credential into the log it was written to prevent.
function redact(matched) {
  const head = matched.slice(0, 10);
  return `${head}${matched.length > 10 ? "…" : ""} (${matched.length} chars)`;
}

const argv = process.argv.slice(2);
const files = readTargetFiles(argv);
const all = files.flatMap(scan);

// A committed environment file is a finding whatever its contents, because the next
// value appended to it inherits the same exposure. `.env.example` is the documented
// exception: it carries names and placeholder values on purpose.
const trackedEnvFiles = files
  .map((file) => file.replace(/\\/g, "/"))
  .filter((file) => /(^|\/)\.env(\..*)?$/.test(file) && !/\.env\.example$/.test(file));
for (const file of trackedEnvFiles) {
  all.push({ file, line: 0, rule: "committed-env-file", describe: "an environment file is tracked by git", hard: true, evidence: `${file} is in the release tree` });
}

const matchesAllowEntry = (entry, finding) => {
  if (entry.rule !== finding.rule) return false;
  if (!entry.file.includes("*")) return entry.file === finding.file;
  const asRegex = new RegExp(`^${entry.file.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*")}$`);
  return asRegex.test(finding.file);
};

const used = new Set();
const findings = all.filter((finding) => {
  const entry = finding.hard ? undefined : allowlist.findIndex((candidate) => matchesAllowEntry(candidate, finding));
  if (entry === undefined || entry === -1) return true;
  used.add(entry);
  return false;
});
const deadAllowlistEntries = allowlist.filter((_, i) => !used.has(i));

console.log(`Scanned ${files.length} files for ${rules.length} credential shapes.`);
if (findings.length) {
  console.error(`${findings.length} finding(s):`);
  for (const finding of findings) {
    console.error(`  ${finding.file}:${finding.line}: ${finding.hard ? "HARD " : ""}${finding.rule} — ${finding.describe}`);
    console.error(`    ${finding.evidence} — ${finding.describe}`);
  }
}
if (deadAllowlistEntries.length) {
  console.error(`${deadAllowlistEntries.length} allowlist entr(y/ies) no longer match anything and should be removed:`);
  for (const entry of deadAllowlistEntries) console.error(`  ${entry.file} / ${entry.rule}`);
}
if (findings.length || deadAllowlistEntries.length) process.exit(1);
console.log("No privileged credential found in the tracked tree or the built bundle.");
