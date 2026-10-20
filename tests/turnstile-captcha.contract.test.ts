import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  captchaOptions,
  loadTurnstile,
  resolveTurnstileSiteKey,
  TURNSTILE_SCRIPT_SRC,
  type TurnstileApi,
  type TurnstileWindow,
} from "@/lib/turnstile";

// CL-7 P3 item 12. The server half of Supabase CAPTCHA is a hosted GoTrue setting: when it is
// enabled, GoTrue verifies the Turnstile token itself and refuses every protected auth call that
// arrives without one. The browser's half is the part this repository owns — collect a token and
// forward it as `captchaToken` on each protected call — and without it the hosted setting would
// break sign-in, sign-up, recovery and resend rather than protect them. These cases pin that half
// and the CSP allowance it needs, and they pin the fact that it stays dormant until a site key is
// supplied, so the current flags-off production bundle collects nothing.

const root = path.resolve(import.meta.dirname, "..");
const clientSrc = path.join(root, "client", "src");
const authSource = readFileSync(path.join(clientSrc, "pages", "Auth.tsx"), "utf8");
const hookSource = readFileSync(path.join(clientSrc, "hooks", "useSupabaseAuth.ts"), "utf8");
const headersSource = readFileSync(path.join(root, "client", "public", "_headers"), "utf8");
const envExample = readFileSync(path.join(root, ".env.example"), "utf8");

function cspDirective(name: string): string[] {
  const policy = headersSource.match(/Content-Security-Policy:\s*(.+)/i)?.[1] ?? "";
  const directive = policy
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${name} `));
  return directive ? directive.split(/\s+/).slice(1) : [];
}

/** A DOM stand-in just large enough for the loader: one document, one head, one script list. */
class FakeScript {
  id = "";
  src = "";
  async = false;
  defer = false;
  readonly listeners = new Map<string, () => void>();

  constructor(private readonly attached: FakeScript[]) {}

  addEventListener(type: string, listener: () => void) {
    this.listeners.set(type, listener);
  }

  remove() {
    const index = this.attached.indexOf(this);
    if (index >= 0) this.attached.splice(index, 1);
  }
}

function fakeDocument() {
  const scripts: FakeScript[] = [];
  const document = {
    querySelector(selector: string) {
      return selector === "#dueweave-turnstile-script"
        ? scripts.find((script) => script.id === "dueweave-turnstile-script") ?? null
        : null;
    },
    createElement() {
      return new FakeScript(scripts);
    },
    head: {
      appendChild(node: FakeScript) {
        scripts.push(node);
        return node;
      },
    },
  };
  return { document: document as unknown as Document, scripts };
}

const api: TurnstileApi = {
  render: () => "widget-1",
  reset: () => undefined,
  remove: () => undefined,
};

describe("Turnstile client half (CL-7 item 12)", () => {
  it("forwards a token only when one exists, so an unconfigured bundle sends nothing", () => {
    expect(captchaOptions(undefined)).toEqual({});
    expect(captchaOptions(null)).toEqual({});
    expect(captchaOptions("   ")).toEqual({});
    expect(captchaOptions(" token-value ")).toEqual({ captchaToken: "token-value" });
  });

  it("treats a site key as configured only when it is a non-blank value", () => {
    expect(resolveTurnstileSiteKey(undefined)).toBe("");
    expect(resolveTurnstileSiteKey("  ")).toBe("");
    expect(resolveTurnstileSiteKey(" 0x4AAAAAAA-example ")).toBe("0x4AAAAAAA-example");
  });

  it("loads Cloudflare's explicit-render script once and resolves with the page API", async () => {
    const { document, scripts } = fakeDocument();
    const window = {} as TurnstileWindow;
    const first = loadTurnstile(document, window);
    const second = loadTurnstile(document, window);
    expect(scripts, "the same window must not inject the script twice").toHaveLength(1);
    expect(scripts[0].src).toBe(TURNSTILE_SCRIPT_SRC);
    expect(scripts[0].async, "a blocking third-party script would stall the auth screen").toBe(true);
    expect(scripts[0].id).toBe("dueweave-turnstile-script");
    window.turnstile = api;
    scripts[0].listeners.get("load")?.();
    await expect(first).resolves.toBe(api);
    await expect(second).resolves.toBe(api);
  });

  it("resolves immediately when the page already carries the API", async () => {
    const { document, scripts } = fakeDocument();
    const window = { turnstile: api } as TurnstileWindow;
    await expect(loadTurnstile(document, window)).resolves.toBe(api);
    expect(scripts, "an already-loaded API needs no script element").toHaveLength(0);
  });

  it("rejects and removes the failed script so a retry can start cleanly", async () => {
    const { document, scripts } = fakeDocument();
    const window = {} as TurnstileWindow;
    const failed = loadTurnstile(document, window);
    scripts[0].listeners.get("error")?.();
    await expect(failed).rejects.toThrow(/could not be loaded/i);
    expect(scripts, "a failed script left in the head makes the next attempt a no-op").toHaveLength(0);
    const retry = loadTurnstile(document, window);
    expect(scripts, "the retry must inject a fresh script").toHaveLength(1);
    window.turnstile = api;
    scripts[0].listeners.get("load")?.();
    await expect(retry).resolves.toBe(api);
  });

  it("sends the token on every auth call GoTrue's global CAPTCHA setting protects", () => {
    const forwarded = hookSource.match(/captchaOptions\(captchaToken\)/g) ?? [];
    expect(forwarded.length, "sign-in, sign-up, recovery and resend each need the token").toBeGreaterThanOrEqual(4);
    for (const call of [
      "signInWithPassword",
      "signUp",
      "resetPasswordForEmail",
      "resend",
    ]) {
      expect(hookSource, `${call} does not forward the token`).toContain(call);
    }
    expect(authSource).toMatch(/signUp\(name, email, password, captchaToken\)/);
    expect(authSource).toMatch(/signIn\(email, password, captchaToken\)/);
    expect(authSource).toMatch(/resetPassword\(email, captchaToken\)/);
    expect(authSource).toMatch(/resendConfirmation\(unconfirmedEmail, captchaToken\)/);
  });

  it("renders the widget only when a site key is configured and refuses a tokenless submit", () => {
    expect(authSource, "the gate must be conditional on the build's site key").toMatch(
      /const captchaRequired = TURNSTILE_SITE_KEY !== ""/,
    );
    expect(authSource, "the screen has no widget").toContain("<TurnstileGate");
    expect(authSource, "a tokenless submit would reach GoTrue and be refused there").toMatch(
      /captchaRequired && !captchaToken/,
    );
    expect(authSource).toMatch(/Complete the verification/i);
  });

  it("allows the CAPTCHA host in script-src and frame-src, and nowhere else", () => {
    const origin = new URL(TURNSTILE_SCRIPT_SRC).origin;
    expect(origin).toBe("https://challenges.cloudflare.com");
    const scriptSrc = cspDirective("script-src");
    expect(scriptSrc, "the loader's script would be refused").toContain(origin);
    expect(scriptSrc).toContain("'self'");
    expect(scriptSrc, "CAPTCHA is not a reason to admit inline script").not.toContain("'unsafe-inline'");
    expect(scriptSrc, "CAPTCHA is not a reason to admit eval").not.toContain("'unsafe-eval'");
    expect(cspDirective("frame-src"), "the widget runs in a frame from the same host").toEqual([origin]);
    expect(
      cspDirective("frame-ancestors"),
      "allowing a child frame must not allow DueWeave to be framed",
    ).toEqual(["'none'"]);
  });

  it("leaves the site key out of the repository and optional in the build contract", () => {
    expect(envExample).toMatch(/^VITE_TURNSTILE_SITE_KEY=$/m);
    expect(envExample).toMatch(/Turnstile|CAPTCHA/i);
    const literalKey = /0x4[A-Za-z0-9_-]{10,}/;
    const files = readdirSync(clientSrc, { recursive: true, withFileTypes: true })
      .filter((entry) => entry.isFile() && /\.(ts|tsx)$/.test(entry.name))
      .map((entry) => path.join(entry.parentPath, entry.name));
    expect(files.length, "the scan read almost none of the browser bundle").toBeGreaterThan(30);
    for (const file of files) {
      expect(readFileSync(file, "utf8"), `${path.relative(root, file)} carries a Turnstile site key`).not.toMatch(
        literalKey,
      );
    }
    expect(readFileSync(path.join(clientSrc, "lib", "turnstile.ts"), "utf8")).toContain(
      "import.meta.env.VITE_TURNSTILE_SITE_KEY",
    );
  });
});
