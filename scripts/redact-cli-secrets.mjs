import process from "node:process";
import readline from "node:readline";

// A CI step's stdout *is* the job log GitHub retains, and the Supabase CLI's start-up banner
// prints the stack's freshly generated privileged key (D-S9-7). This filter sits between the
// two: a privileged value becomes a label that still says a key was there, while everything
// needed to diagnose a stack that did not come up — URLs, ports, browser-safe keys — stays.
//
// The shapes mirror the HARD rules in `scripts/verify-secrets.mjs`, and the contract suite
// feeds this script's output back through that gate, so the two lists cannot drift apart
// without a test failing. Nothing is logged about what was masked beyond its length.

const privilegedRoles = new Set(["service_role", "supabase_admin", "postgres"]);
const jwtShape = /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;

function isPrivilegedToken(token) {
  try {
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString("utf8"));
    return privilegedRoles.has(payload?.role);
  } catch {
    return false;
  }
}

function mask(label, matched) {
  return `[redacted-${label}-${String(matched.length)}-chars]`;
}

const rules = [
  (line) => line.replace(/\b(?:sb_secret|SB_SECRET|sb_service_role|SB_SERVICE_ROLE)_[A-Za-z0-9_-]{16,}/g, (m) => mask("sb-secret-key", m)),
  // D-S9-11: the CLI's `📦 Storage (S3)` table prints this stack's S3 access/secret pair two rows
  // below the privileged key. They are local-stack defaults rather than anything this project
  // trusts with real data, but they arrive in the same retained log, and nothing about diagnosing
  // storage needs them — the endpoint, the region and the row labels all stay.
  (line) =>
    line.replace(
      /(\b(?:Access|Secret) Key\b)([^\S\n]*[│|]?[^\S\n]*)([0-9a-fA-F]{16,})/gi,
      (match, label, separator, value) =>
        `${label}${separator}${mask(`storage-${label.toLowerCase().split(/\s+/)[0]}-key`, value)}`,
    ),
  // The credential part only: `postgres://[redacted-db-password]@127.0.0.1:54322/postgres`
  // still tells an operator which host and port the stack took, which is the diagnosis.
  (line) =>
    line.replace(/\b(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|redis):\/\/[^\s/@:'"]+:[^\s@'"]{6,}@/gi, (m) => {
      const scheme = m.slice(0, m.indexOf("://") + 3);
      return `${scheme}[redacted-db-password]@`;
    }),
  (line) => line.replace(jwtShape, (m) => (isPrivilegedToken(m) ? mask("service-role-jwt", m) : m)),
];

function redact(line) {
  return rules.reduce((current, rule) => rule(current), line);
}

const lines = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
for await (const line of lines) process.stdout.write(`${redact(line)}\n`);
