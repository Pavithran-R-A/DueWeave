import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The deployed sign-in screen was measured in a real browser on 2026-10-13 and two grey tokens are
// below the level WCAG 1.4.3 requires for text this small: `--muted` renders the sub-heading and
// both paused notices at 3.45:1 on the paper canvas, and `--faint` renders the footnote at 1.80:1
// and every input placeholder at 2.03:1 on the white field. A person with low vision cannot read
// the reason the app just gave them. The product rule is that the greys which carry words clear
// 4.5:1 on every surface those words actually sit on — measured from the tokens the stylesheet
// ships, so re-lightening one later fails this gate instead of shipping quietly.
//
// Scope, stated so the gate is not mistaken for a full audit: `--ink` and `--ink-soft` are the dark
// end of the same ramp and are pinned to keep it from being lightened under the name of hierarchy;
// coral-as-text is a separate, already-decided case (`index.css` carries `--coral-deep` for the one
// label that must read correctly) and is not reopened here.
const root = path.resolve(import.meta.dirname, "..");
const css = readFileSync(path.join(root, "client", "src", "index.css"), "utf8").replace(/\r\n/g, "\n");

/** AA for text under 18.66px (14pt) normal weight — the sizes every grey in this app is used at. */
const AA = { text: 4.5, graphic: 3 };

/** Where each grey is actually painted, read off the rules that use it. */
const GREY_USES = [
  // `.auth-heading>p`, `.list-page__intro p`, `.status-pill`, `.context-band span`, `.filter-tab`, `.message-actions__privacy`, `.field em`
  { token: "--muted", background: "--canvas", kind: "text" },
  { token: "--muted", background: "--canvas-2", kind: "text" },
  { token: "--muted", background: "--surface", kind: "text" },
  { token: "--muted", background: "--surface-strong", kind: "text" },
  { token: "--muted", background: "--teal-soft", kind: "text" },
  // `.auth-footnote`, `.filter-tab span`, `.form-input::placeholder`
  { token: "--faint", background: "--canvas", kind: "text" },
  { token: "--faint", background: "--surface", kind: "text" },
  { token: "--faint", background: "--surface-strong", kind: "text" },
  // `.client-row svg` — the row chevron over a hovered (canvas-2) row. A mark, not a word.
  { token: "--faint", background: "--canvas-2", kind: "graphic" },
];

/** Every `--token: #hex` the stylesheet declares in `:root`. */
function tokens() {
  const declarations = css.match(/:root\s*\{[\s\S]*?\n\}/);
  expect(declarations, "index.css no longer has the :root block this gate reads").not.toBeNull();
  return new Map([...declarations![0].matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{3,8})/g)].map(([, name, hex]) => [name, hex]));
}

function rgb(hex: string): number[] {
  const digits = hex.slice(1);
  const full = digits.length === 3 ? digits.split("").map((c) => c + c).join("") : digits.slice(0, 6);
  return [0, 2, 4].map((i) => Number.parseInt(full.slice(i, i + 2), 16) / 255);
}

/** WCAG relative luminance, from the sRGB channels a browser would composite. */
function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function ratio(foreground: string, background: string): number {
  const [light, dark] = [luminance(foreground), luminance(background)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

/** A hex is 8-bit per channel and lowercase-formattable, so the report can quote what shipped. */
function isHex(value: string | undefined, label: string): string {
  expect(value, `${label} is not declared as a hex colour in :root — this gate would be reading nothing`).toMatch(/^#[0-9a-fA-F]{3,8}$/);
  return value!;
}

describe("secondary text is readable without assistive technology", () => {
  it.each(GREY_USES)("$token as $kind on $background", ({ token, background, kind }) => {
    const declared = tokens();
    const foreground = isHex(declared.get(token.slice(2)), token);
    const behind = isHex(declared.get(background.slice(2)), background);
    const measured = ratio(foreground, behind);
    expect(
      measured,
      `${token} (${foreground}) on ${background} (${behind}) is ${measured.toFixed(2)}:1, below the ${AA[kind]}:1 ${kind === "text" ? "a person needs to read it" : "a mark needs to be seen"}`,
    ).toBeGreaterThanOrEqual(AA[kind]);
  });

  it("the dark end of the same ramp keeps its headroom", () => {
    const declared = tokens();
    for (const token of ["--ink", "--ink-soft"]) {
      const value = isHex(declared.get(token.slice(2)), token);
      for (const background of ["--canvas", "--canvas-2", "--surface", "--surface-strong"]) {
        const behind = isHex(declared.get(background.slice(2)), background);
        const measured = ratio(value, behind);
        expect(measured, `${token} (${value}) on ${background} (${behind}) fell to ${measured.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA.text);
      }
    }
  });

  it("the greys stay a ramp, so a caption still reads as quieter than a heading", () => {
    const declared = tokens();
    const muted = isHex(declared.get("muted"), "--muted");
    const faint = isHex(declared.get("faint"), "--faint");
    const inkSoft = isHex(declared.get("ink-soft"), "--ink-soft");
    const measured = { inkSoft: luminance(inkSoft), muted: luminance(muted), faint: luminance(faint) };
    expect(
      measured.muted,
      `--muted (${muted}) is now lighter than --ink-soft (${inkSoft}): the ramp has collapsed and a caption no longer reads as quieter`,
    ).toBeGreaterThanOrEqual(measured.inkSoft);
    expect(
      measured.faint,
      `--faint (${faint}) is now lighter than --muted (${muted}): re-tinting inverted the ramp`,
    ).toBeGreaterThanOrEqual(measured.muted);
  });
});
