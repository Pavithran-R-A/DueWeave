import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// CL-7 Stage C item 14, found by CI at `c0fc2d8`, not by a local run: three browser
// journeys failed on `expect(body).not.toContainText(/…|policy/i)` because the sign-in
// screen now carries a link that reads "Privacy Policy". The guard was never wrong about
// its purpose — a customer must not read database internals — it was wrong about its
// vocabulary, because a bare English word is equally a word in the privacy document a
// customer is asked to trust. This file holds both halves of that line: the guard fires
// on the message it was written for, and stays quiet on the copy this product ships.

const root = path.resolve(import.meta.dirname, "..");
const e2eDir = path.join(root, "e2e");

function specFiles(): string[] {
  return readdirSync(e2eDir)
    .filter((name) => name.endsWith(".spec.ts"))
    .map((name) => path.join(e2eDir, name));
}

function patternSource(literal: string) {
  const match = literal.match(/^\/([\s\S]+)\/([a-z]*)$/);
  expect(match, `expected a regex literal, got ${literal}`).not.toBeNull();
  return { source: match![1], flags: match![2] };
}

/** Every whole-document leak guard in the battery, with the file and line that carries it. */
const bodyGuards = specFiles().flatMap((file) => {
  const text = readFileSync(file, "utf8");
  const found: { where: string; pattern: RegExp }[] = [];
  for (const match of text.matchAll(/page\.locator\("body"\)\)\.not\.toContainText\((\/[^\n]+?\/[a-z]*)\)/g)) {
    const { source, flags } = patternSource(match[1]);
    found.push({ where: `${path.basename(file)}:${text.slice(0, match.index).split("\n").length}`, pattern: new RegExp(source, flags) });
  }
  return found;
});

// The copy is read from the shipped sources, not retyped here: the labels on the sign-in
// row, the sentence under them, and the headings of the three documents.
const auth = readFileSync(path.join(root, "client", "src", "pages", "Auth.tsx"), "utf8");
const legal = readFileSync(path.join(root, "client", "src", "pages", "Legal.tsx"), "utf8");
const customerCopy = [
  ...[...auth.matchAll(/className="auth-legal-link" to="[^"]+">([^<]+)</g)].map((m) => m[1]),
  ...[...auth.matchAll(/className="auth-footnote">([^<]+)</g)].map((m) => m[1]),
  ...[...legal.matchAll(/title="([^"]+)"/g)].map((m) => m[1]),
  ...[...legal.matchAll(/label: "([^"]+)"/g)].map((m) => m[1]),
];

// Messages the engine and the API really return. The first is the one the `policy` arm was
// reaching for; the second is the constraint shape the same guards already name. A guard
// that misses these is a guard that says nothing.
const leaks = [
  'new row violates row-level security policy for table "receivables"',
  'duplicate key value violates unique constraint "clients_pkey"',
];

describe("the battery's leak vocabulary against the product's own words (CL-7 item 14)", () => {
  it("finds the whole-document guards it is meant to hold", () => {
    expect(bodyGuards.length, "no page.locator(\"body\") leak guard was read from e2e/*.spec.ts").toBeGreaterThanOrEqual(4);
    expect(customerCopy.length, "the sign-in screen or the legal documents contributed no copy").toBeGreaterThanOrEqual(7);
  });

  it("never fires on copy a customer is asked to read", () => {
    for (const guard of bodyGuards) {
      for (const copy of customerCopy) {
        expect(copy, `${guard.where} calls the product's own wording a leak`).not.toMatch(guard.pattern);
      }
    }
  });

  it("fires on the real messages behind the words", () => {
    const authorization = bodyGuards.filter((guard) => /row-level security|constraint/i.test(guard.pattern.source));
    expect(authorization.length, "no whole-document guard carries authorization vocabulary").toBeGreaterThan(0);
    for (const guard of authorization) {
      expect(leaks[0], `${guard.where} must fire on a row-level security refusal`).toMatch(guard.pattern);
      expect(leaks[1], `${guard.where} must fire on a constraint refusal`).toMatch(guard.pattern);
    }
  });

  it("refuses to let a bare word for a legal document back into the vocabulary", () => {
    for (const guard of bodyGuards) {
      const arms = guard.pattern.source.split("|");
      for (const arm of arms) {
        expect(arm.trim(), `${guard.where} bans a bare English word the product may legitimately use`).not.toMatch(/^(policy|role|grant|permission|table|schema|session)$/i);
      }
    }
  });
});
