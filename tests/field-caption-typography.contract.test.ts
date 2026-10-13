import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// Hosted acceptance measured the deployed sign-in screen typing its email and password at 11px/700
// — the size and weight of the words above the box — because the stylesheet painted *every* direct
// `span` child of a `.field` as that field's caption, and `Auth.tsx` puts its inputs inside
// `<span className="auth-input">`. `e2e-paused/auth-field-typography.spec.ts` proves the behaviour
// on the built artifact. This file pins the half that browser run cannot reach: a field has two
// spellings, a caption is a bare `span` only in the `label.field` one, and the two places that spell
// it that way still do — so the scoped rule is styling something, not nothing.
const root = path.resolve(import.meta.dirname, "..");

/** Read a source file with the checkout's CRLF removed, so rules are written once. */
function source(...segments: string[]) {
  return readFileSync(path.join(root, ...segments), "utf8").replace(/\r\n/g, "\n");
}

const CAPTION_RULE = "label.field>span { display:flex; justify-content:space-between; gap:10px; color:var(--ink-soft); font-size:11px; font-weight:700; }";

describe("a field's caption type belongs to its label, not to whatever span holds its control", () => {
  it("the caption rule is scoped to the label form of a field and keeps the caption numbers", () => {
    const css = source("client", "src", "index.css");
    expect(css, "the caption is styled on `label.field>span` so a control wrapper cannot inherit it").toContain(CAPTION_RULE);
    expect(
      css.match(/(?<![.\w])\.field>span/),
      "the unscoped selector is what rendered a person's keystrokes as caption text",
    ).toBeNull();
  });

  it.each([
    { name: "the sheet field wrapper", segments: ["client", "src", "components", "finance-ui.tsx"] },
    { name: "the message editor", segments: ["client", "src", "components", "sheets.tsx"] },
  ])("$name still carries its caption in a bare span inside `label.field`", ({ segments }) => {
    expect(
      source(...segments),
      "scoping the rule away from `div.field` is only safe while the caption sites still use the label form",
    ).toContain('<label className="field"><span>');
  });
});
