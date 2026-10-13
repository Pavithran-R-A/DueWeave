import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// The deployed sign-in screen was measured in a real browser on 2026-10-13 and two grey tokens are
// below the level WCAG 1.4.3 requires for text this small: `--muted` renders the sub-heading and
// both paused notices at 3.45:1 on the paper canvas, and `--faint` renders the footnote at 1.80:1
// and every input placeholder at 2.03:1 on the white field. A person with low vision cannot read
// the reason the app just gave them. The product rule is that a colour which carries words clears
// 4.5:1 on every surface those words actually sit on — measured from the tokens the stylesheet
// ships, so re-lightening one later fails this gate instead of shipping quietly.
//
// Measuring the rest of the palette against that rule found the accents quieter than the greys
// this gate already rejects, and accents carry the words that matter most — the status of a
// receivable and the reason something was refused: `--amber` on `--amber-soft` 3.04:1 (the
// partially-paid pill), `--coral` on `--coral-soft` 3.32:1 (the broken pill, `.field__error`,
// `.auth-message--error`), `--teal` on `--canvas-2` 4.20:1 (a hovered text button), and
// `--coral-deep` on its own deeper tint 4.40:1 (`.confirm-phrase`, the erasure chip). Accents are
// also painted as marks (`.error-icon`, `.founder-not-ready svg`, `.promise-callout__icon`), which
// need 3:1 — the text rows below subsume that, since 4.5 is the stricter bar.
//
// `index.css` ships a second ramp for the dark theme (`.app-shell--dark`, toggled from `Home.tsx`),
// and the greys had only been fixed in `:root`: dark `--muted` on `--teal-soft` measures 4.11:1 and
// dark `--faint` on `--surface` 3.22:1, so the caption that became readable on paper stayed
// unreadable in the dark shell. The dark shell also labels its accent fills with a literal
// `#fff` (`.button-primary`, `.floating-add`, `::selection`), which measures 1.99:1 over the dark
// `--teal` — the word on the app's primary action. So both themes are gated from their own token
// block, and a label over a fill became a token (`--on-accent`) instead of a literal.
//
// Scope, stated so the gate is not mistaken for a full audit: `--ink` and `--ink-soft` are the far
// end of the same ramp and are pinned so it cannot be lightened under the name of hierarchy;
// focus rings and border tints are WCAG 1.4.11, a different criterion, and are not measured here.
const root = path.resolve(import.meta.dirname, "..");
const css = readFileSync(path.join(root, "client", "src", "index.css"), "utf8").replace(/\r\n/g, "\n");

/** AA for text under 18.66px (14pt) normal weight — the sizes every grey in this app is used at. */
const AA = { text: 4.5, graphic: 3 };

/** Where each colour is actually painted on paper, read off the rules that use it. */
const LIGHT_PAIRS = [
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
  // `.status-pill--active/--partially_paid/--partially_kept`, `.founder-claim-status`, `.founder-not-ready`
  { token: "--amber", background: "--amber-soft", kind: "text" },
  // `.ledger-note .eyebrow`, `.metric--amber strong`, `.list-promise-dot` (a promise-status word)
  { token: "--amber", background: "--surface", kind: "text" },
  // `.status-pill--broken/--cancelled`, `.field__error`, `.auth-message--error`, `.admin-denied`,
  // `.founder-claim-status--rejected`, `.error-icon`
  { token: "--coral", background: "--coral-soft", kind: "text" },
  // `.metric--coral strong`, `.queue-card__why strong`, `.reason--strong`, `.list-promise-dot--broken`.
  // `.queue-card--critical` mixes coral-soft into its gradient, but a mix of that tint with
  // `--surface` is lighter than the tint alone, so the pure `--coral-soft` row is the binding case.
  { token: "--coral", background: "--surface", kind: "text" },
  // `.promise-callout--broken .promise-callout__icon`
  { token: "--coral", background: "--surface-strong", kind: "graphic" },
  // `.wordmark span`, `.text-button:hover`, `.filter-button:hover`, `.button-ghost:hover`
  { token: "--teal", background: "--canvas", kind: "text" },
  { token: "--teal", background: "--canvas-2", kind: "text" },
  { token: "--teal", background: "--surface", kind: "text" },
  { token: "--teal", background: "--surface-strong", kind: "text" },
  // `.settings-row--danger`, `.deletion-scope__label`
  { token: "--coral-deep", background: "--canvas", kind: "text" },
  { token: "--coral-deep", background: "--surface", kind: "text" },
  // `.confirm-phrase`, `.settings-value`, `.settings-row--danger .settings-icon`
  { token: "--coral-deep", background: "--coral-deep-soft", kind: "text" },
  // `.rail-link--active`, `.context-band`, `.reliability`, `.auth-message--notice`, `.avatar`, `.rail-note`
  { token: "--teal-dark", background: "--teal-soft", kind: "text" },
  // `.rail-count`, `.tone-mark`, `.promise-callout__icon`, `.template-choice__suggested`
  { token: "--teal-dark", background: "--surface-strong", kind: "text" },
  // `.empty-anchor`, `.detail-priority__top strong`, `.today-note`, `.auth-back`, `.bottom-link--active`
  { token: "--teal-dark", background: "--surface", kind: "text" },
  { token: "--teal-dark", background: "--canvas", kind: "text" },
  { token: "--teal-dark", background: "--canvas-2", kind: "text" },
] as const;

/**
 * The same word-bearing rules paint inside `.app-shell--dark`, so the dark census repeats the paper
 * pairs and drops what cannot render there: the auth screens are never dark, and
 * `.app-shell--dark .form-input,.app-shell--dark .filter-tab` give those two controls their own
 * `#1a2a2f` fill instead of a `--surface*` token — so a placeholder typed in the dark shell is
 * measured against the fill it actually sits on.
 */
const DARK_PAIRS = [
  // `.list-page__intro p`, `.status-pill`, `.field em`, and every sheet caption
  { token: "--muted", background: "--canvas", kind: "text" },
  { token: "--muted", background: "--canvas-2", kind: "text" },
  { token: "--muted", background: "--surface", kind: "text" },
  { token: "--muted", background: "--surface-strong", kind: "text" },
  // `.client-picker__results button:hover` paints `--teal-soft` behind a `--muted` row caption
  { token: "--muted", background: "--teal-soft", kind: "text" },
  { token: "--muted", background: "#1a2a2f", kind: "text" },
  // `.form-input::placeholder` and `.filter-tab span`, both over the dark control fill
  { token: "--faint", background: "#1a2a2f", kind: "text" },
  // `.client-row svg` over a hovered row
  { token: "--faint", background: "--canvas-2", kind: "graphic" },
  { token: "--amber", background: "--amber-soft", kind: "text" },
  { token: "--amber", background: "--surface", kind: "text" },
  { token: "--coral", background: "--coral-soft", kind: "text" },
  { token: "--coral", background: "--surface", kind: "text" },
  { token: "--coral", background: "--surface-strong", kind: "graphic" },
  { token: "--teal", background: "--canvas", kind: "text" },
  { token: "--teal", background: "--canvas-2", kind: "text" },
  { token: "--teal", background: "--surface", kind: "text" },
  { token: "--teal", background: "--surface-strong", kind: "text" },
  { token: "--coral-deep", background: "--canvas", kind: "text" },
  { token: "--coral-deep", background: "--surface", kind: "text" },
  { token: "--coral-deep", background: "--coral-deep-soft", kind: "text" },
  { token: "--teal-dark", background: "--teal-soft", kind: "text" },
  { token: "--teal-dark", background: "--surface-strong", kind: "text" },
  { token: "--teal-dark", background: "--surface", kind: "text" },
  { token: "--teal-dark", background: "--canvas", kind: "text" },
  { token: "--teal-dark", background: "--canvas-2", kind: "text" },
] as const;

/** `.button-primary`, `.floating-add` and `::selection` all fill with an accent and label it. */
const FILLS = [
  { label: "--on-accent", fill: "--teal", where: ".button-primary, .floating-add, ::selection" },
  { label: "--on-accent", fill: "--teal-dark", where: ".button-primary:hover" },
] as const;

const THEMES = [
  { name: "paper", label: ":root", block: /:root\s*\{[\s\S]*?\n\}/g, pairs: LIGHT_PAIRS },
  { name: "dark", label: ".app-shell--dark", block: /\.app-shell--dark\s*\{[^}]*\}/g, pairs: DARK_PAIRS },
] as const;

/**
 * Every `--token: #hex` the stylesheet declares in `block`. The dark ramp is written in two blocks
 * — `.app-shell--dark` re-declares `--coral-deep` beside the erasure rules — so all matches merge
 * and a later declaration wins, the way the cascade resolves them.
 */
function tokens(block: RegExp, label: string) {
  const declarations = [...css.matchAll(block)];
  expect(declarations.length, `index.css no longer has the ${label} block this gate reads`).toBeGreaterThan(0);
  return new Map(declarations.flatMap((declaration) => [...declaration[0].matchAll(/--([a-z0-9-]+):\s*(#[0-9a-fA-F]{3,8})/g)]).map(([, name, hex]) => [name, hex]));
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

/** A token of this theme's block, or a literal hex for a fill the theme hardcodes. */
function colour(declared: Map<string, string>, name: string): string {
  if (name.startsWith("#")) return name;
  const value = declared.get(name.slice(2));
  expect(value, `${name} is not declared as a hex colour in this theme — this gate would be reading nothing`).toMatch(/^#[0-9a-fA-F]{3,8}$/);
  return value!;
}

/** The body of `selector`'s rule, so a token can be proved to be what the app actually paints. */
function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const rule = css.match(new RegExp(`(?:^|[};])\\s*${escaped}\\s*\\{([^}]*)\\}`));
  expect(rule, `index.css no longer has the ${selector} rule this gate reads`).not.toBeNull();
  return rule![1];
}

describe("secondary text is readable without assistive technology", () => {
  for (const theme of THEMES) {
    describe(`the ${theme.name} theme`, () => {
      const declared = tokens(theme.block, theme.label);

      it.each([...theme.pairs])("$token as $kind on $background", ({ token, background, kind }) => {
        const foreground = colour(declared, token);
        const behind = colour(declared, background);
        const measured = ratio(foreground, behind);
        expect(
          measured,
          `${token} (${foreground}) on ${background} (${behind}) is ${measured.toFixed(2)}:1, below the ${AA[kind]}:1 ${kind === "text" ? "a person needs to read it" : "a mark needs to be seen"}`,
        ).toBeGreaterThanOrEqual(AA[kind]);
      });

      it("a filled control labels its own accent", () => {
        for (const { label, fill, where } of FILLS) {
          const ink = colour(declared, label);
          const behind = colour(declared, fill);
          const measured = ratio(ink, behind);
          expect(measured, `${where}: ${label} (${ink}) on ${fill} (${behind}) is ${measured.toFixed(2)}:1 — the button's own word is the point`).toBeGreaterThanOrEqual(AA.text);
        }
      });

      it("the far end of the ramp keeps its headroom", () => {
        for (const token of ["--ink", "--ink-soft"]) {
          const value = colour(declared, token);
          for (const background of ["--canvas", "--canvas-2", "--surface", "--surface-strong"]) {
            const behind = colour(declared, background);
            const measured = ratio(value, behind);
            expect(measured, `${token} (${value}) on ${background} (${behind}) fell to ${measured.toFixed(2)}:1`).toBeGreaterThanOrEqual(AA.text);
          }
        }
      });

      it("the greys stay a ramp, so a caption still reads as quieter than a heading", () => {
        const inkSoft = colour(declared, "--ink-soft");
        const muted = colour(declared, "--muted");
        const faint = colour(declared, "--faint");
        const measured = { inkSoft: luminance(inkSoft), muted: luminance(muted), faint: luminance(faint) };
        // On paper a quieter word is a lighter one; in the dark shell it is a darker one. Either
        // way the three must keep stepping away from each other, or a caption stops reading as
        // secondary and a heading stops reading as primary.
        const ordered = theme.name === "paper" ? measured.inkSoft <= measured.muted && measured.muted <= measured.faint : measured.inkSoft >= measured.muted && measured.muted >= measured.faint;
        expect(ordered, `--ink-soft (${inkSoft}) / --muted (${muted}) / --faint (${faint}) no longer step apart in the ${theme.name} theme`).toBe(true);
      });
    });
  }

  it("a label over an accent fill is a token, not a literal that only suits one theme", () => {
    for (const selector of [".button-primary", ".floating-add", "::selection"]) {
      expect(ruleBody(selector), `${selector} must label its fill with var(--on-accent) so both themes get the readable ink`).toContain("color:var(--on-accent)");
    }
  });
});
