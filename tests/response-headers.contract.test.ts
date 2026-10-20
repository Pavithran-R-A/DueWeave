import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

// CL-7 Stage C item 14: the browser is told what DueWeave is by the headers the host
// sends, and until this head the only answer was four of them and no Content-Security
// Policy at all — measured on `https://dueweave.pages.dev/` on 2026-10-20:
// `x-frame-options`, `x-content-type-options`, `referrer-policy`, `permissions-policy`,
// and no `content-security-policy`, no `strict-transport-security`. A static SPA on a
// shared edge is exactly the case a policy is for, so this file pins the policy to the
// app's real surface: every origin it names has to be one the app actually loads, and
// every concession it makes (inline styles, `data:` images) has to be paid for by a
// feature that needs it.

const root = path.resolve(import.meta.dirname, "..");
const headersFile = path.join(root, "client", "public", "_headers");
const source = readFileSync(headersFile, "utf8");

/** `/*` block -> header name -> value, in the file's own order. */
function blocks(text: string) {
  const out = new Map<string, Map<string, string>>();
  let current: Map<string, string> | null = null;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    if (!line.startsWith(" ") && !line.startsWith("\t")) {
      current = new Map();
      out.set(line.trim(), current);
      continue;
    }
    const match = line.trim().match(/^([^:]+):\s*(.*)$/);
    expect(match, `a header line must read "Name: value", got ${line}`).not.toBeNull();
    current!.set(match![1].trim().toLowerCase(), match![2].trim());
  }
  return out;
}

const parsed = blocks(source);
const global = parsed.get("/*");

function tsFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) return tsFiles(absolute);
    return /\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\.ts$/.test(entry.name) ? [absolute] : [];
  });
}

/** The policy a visitor's browser actually enforces, split into its directives. */
function directives() {
  const policy = global?.get("content-security-policy");
  expect(policy, "the /* block must declare Content-Security-Policy").toBeTruthy();
  return new Map(
    policy!
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const [name, ...rest] = part.split(/\s+/);
        return [name, rest] as const;
      }),
  );
}

// The host the production bundle is built against, read from the script that builds the
// flags-off artifact rather than repeated here — a policy that allows a host the app does
// not call is dead weight, and one that refuses the one it does is a broken release.
const hostedBuildUrl = readFileSync(path.join(root, "scripts", "run-paused-e2e.mjs"), "utf8").match(
  /VITE_SUPABASE_URL:\s*"https:\/\/([^"]+?)"/,
);
const hostedHost = hostedBuildUrl?.[1];

// Every origin the entry document reaches out to before the app's own script has run,
// read from `client/index.html` itself. The two kinds are different directives: the
// stylesheet link is a `<link>` the browser loads through `style-src`, while the
// crossorigin preconnect names the host the font *files* come from, which is `font-src`.
// Deriving only the stylesheet host left the font-file host unchecked, and a policy that
// quietly dropped it still passed this file while breaking every page in a browser.
function externalLinks(text: string) {
  return [...text.matchAll(/<link\b[^>]*>/gi)]
    .map((match) => {
      const tag = match[0];
      const href = tag.match(/href="([^"]+)"/)?.[1];
      return { href, rel: tag.match(/rel="([^"]+)"/)?.[1], crossorigin: /\bcrossorigin\b/.test(tag) };
    })
    .filter((link) => link.href?.startsWith("https://"))
    .map((link) => ({ ...link, host: new URL(link.href!).hostname.toLowerCase() }));
}
const links = externalLinks(readFileSync(path.join(root, "client", "index.html"), "utf8"));
const stylesheetHosts = [...new Set(links.filter((link) => link.rel === "stylesheet").map((link) => link.host))];
const fontFileHosts = [...new Set(links.filter((link) => link.rel === "preconnect" && link.crossorigin).map((link) => link.host))];

describe("host response headers (CL-7 item 14)", () => {
  it("applies one block to every path, so a deep link is not an unpoliced page", () => {
    expect([...parsed.keys()], "the file must carry the /* block only: Pages has no other origin to distinguish").toEqual(["/*"]);
    expect(global, "the /* block must exist").toBeDefined();
  });

  it("enforces the policy instead of only reporting violations", () => {
    expect(directives().size, "an empty policy is a policy that refuses nothing").toBeGreaterThan(5);
    for (const name of global!.keys()) {
      expect(name, "Report-Only leaves the site unguarded").not.toMatch(/report-only/);
    }
  });

  it("runs scripts from the origin alone, which is what the built index.html needs", () => {
    const html = readFileSync(path.join(root, "client", "index.html"), "utf8");
    expect(/<script[^>]*\ssrc=/.test(html), "the proof below only holds if the entry is an external script");
    expect(html, "an inline script would need a concession this policy refuses").not.toMatch(/<script[^>]*>[^<]/);
    const scriptSrc = directives().get("script-src");
    expect(scriptSrc, "script-src must be explicit rather than inherited").toEqual(["'self'"]);
    expect(scriptSrc).not.toContain("'unsafe-eval'");
  });

  it("carries exactly the origins the app loads, derived from its own sources", () => {
    const d = directives();
    const styleSrc = d.get("style-src") ?? [];
    // The concession is paid for by a feature: the app really does write style attributes.
    const inlineStyleWriters = tsFiles(path.join(root, "client", "src")).filter((file) => readFileSync(file, "utf8").includes("style={{"));
    expect(inlineStyleWriters.length, "style-src 'unsafe-inline' needs an inline style attribute to justify it").toBeGreaterThan(0);
    expect(styleSrc, `${inlineStyleWriters.length} source files set style={{…}}`).toContain("'unsafe-inline'");
    const fontSrc = d.get("font-src") ?? [];
    const connect = d.get("connect-src") ?? [];
    expect(stylesheetHosts.length, "the entry document loads no external stylesheet").toBeGreaterThan(0);
    for (const host of stylesheetHosts) {
      expect(styleSrc, `the page loads https://${host}/… but style-src refuses it`).toContain(`https://${host}`);
    }
    expect(fontFileHosts.length, "the entry document preconnects to no external font file host").toBeGreaterThan(0);
    for (const host of fontFileHosts) {
      expect(fontSrc, `the page loads font files from https://${host} but font-src refuses it`).toContain(`https://${host}`);
    }
    // A link to an origin neither directive allows would be a page that renders broken in
    // production while this file still passed.
    for (const link of links) {
      expect([...styleSrc, ...fontSrc, ...connect], `${link.href} names an origin the policy allows nowhere`).toContain(`https://${link.host}`);
    }
    expect(hostedHost, "the hosted origin must be readable from the production build script").toBeTruthy();
    expect(connect.join(" "), "the app cannot reach its own API").toContain(`https://${hostedHost}`);
    expect(connect.join(" "), "supabase-js keeps its realtime socket on the same host").toContain(`wss://${hostedHost}`);
    expect(connect.join(" "), "same-origin requests are the majority of the app's traffic").toContain("'self'");
  });

  it("allows the data: images the product itself renders", () => {
    const founder = readFileSync(path.join(root, "client", "src", "pages", "FounderPurchase.tsx"), "utf8");
    expect(founder, "the claim below is only worth making if the QR is a data URL").toMatch(/QRCode\.toDataURL/);
    expect(directives().get("img-src"), "a QR code drawn as a data URL would be refused").toContain("data:");
  });

  it("refuses wildcards, scheme sources and the plugin/object surfaces", () => {
    for (const [name, sources] of directives()) {
      for (const source of sources) {
        expect(source, `${name} carries a bare wildcard`).not.toEqual("*");
        expect(source, `${name} allows a whole scheme`).not.toMatch(/^https?:$/);
      }
    }
    const d = directives();
    for (const [name, expected] of [
      ["default-src", ["'self'"]],
      ["object-src", ["'none'"]],
      ["base-uri", ["'self'"]],
      ["form-action", ["'self'"]],
      ["frame-ancestors", ["'none'"]],
    ] as const) {
      expect(d.get(name), `${name} must be stated`).toEqual([...expected]);
    }
    expect([...d.keys()], "upgrade-insecure-requests carries no sources").toContain("upgrade-insecure-requests");
    expect(d.get("upgrade-insecure-requests")).toEqual([]);
  });

  it("requires HTTPS for every visitor, without claiming a preload listing", () => {
    const hsts = global?.get("strict-transport-security");
    expect(hsts, "the measured production response had no Strict-Transport-Security").toBeTruthy();
    const maxAge = Number(hsts!.match(/max-age=(\d+)/)?.[1]);
    expect(maxAge, "a policy under six months is a policy that expires mid-incident").toBeGreaterThanOrEqual(15_552_000);
    expect(hsts).toMatch(/includeSubDomains/);
    expect(hsts.toLowerCase(), "preload requires a submitted listing nobody made for this host").not.toContain("preload");
  });

  it("leaves script-src 'self' nothing to refuse anywhere in the bundle", () => {
    // The browser cases in `e2e/response-headers.spec.ts` can only reach the sign-in screen
    // and the three trust documents — a signed-in run needs the stack and a real account, so
    // the ledger, the export and the Founder screens are never loaded under the policy. That
    // gap is closed here rather than reasoned away: these are the constructs a `script-src
    // 'self'` policy with no `unsafe-eval`, no `unsafe-inline` and no `worker-src` or
    // `frame-src` concession refuses, read out of every source file in the bundle.
    const refused = [
      [/[^.\w]eval\s*\(/, "eval() requires script-src 'unsafe-eval'"],
      [/new\s+Function\s*\(/, "generated functions require script-src 'unsafe-eval'"],
      [/new\s+(Shared)?Worker\s*\(/, "a worker requires worker-src, which this policy does not open"],
      [/navigator\.serviceWorker/, "a service worker is fetched through script-src"],
      [/document\.write\s*\(/, "written markup is parsed as if it were inline"],
      [/<iframe|createElement\("iframe"|createElement\('iframe'/, "an embedded frame requires frame-src"],
      [/<script/, "a script written at runtime is an inline script"],
    ] as const;
    for (const file of tsFiles(path.join(root, "client", "src"))) {
      const text = readFileSync(file, "utf8");
      for (const [pattern, why] of refused) {
        expect(text, `${path.relative(root, file)} uses something the policy refuses: ${why}`).not.toMatch(pattern);
      }
    }
  });

  it("keeps every cross-origin data call inside connect-src, on every screen", () => {
    // `wa.me` is an `<a href target="_blank">`: a navigation the browser makes in its own
    // tab, which no fetch directive governs. A `fetch` to the same host would be governed,
    // so the two are separated by the call site, not by the host.
    const d = directives();
    const connect = new Set((d.get("connect-src") ?? []).map((source) => source.replace(/^wss:/, "https:").replace(/^https?:\/\//, "")));
    const callSite = /(?:\bfetch|\bnew\s+WebSocket|XMLHttpRequest|sendBeacon)\s*[.(]/;
    const files = tsFiles(path.join(root, "client", "src"));
    const called: string[] = [];
    for (const file of files) {
      for (const line of readFileSync(file, "utf8").split(/\r?\n/)) {
        if (!callSite.test(line)) continue;
        for (const literal of line.matchAll(/https:\/\/([a-z0-9.-]+)/gi)) {
          called.push(literal[1].toLowerCase());
          expect([...connect], `${path.relative(root, file)} fetches ${literal[1]}, which connect-src refuses`).toContain(literal[1].toLowerCase());
        }
      }
    }
    // A reading that found nothing is only worth having if it could have found something, and
    // if it really walked the bundle rather than one directory.
    const probe = 'await fetch("https://a-host-outside-the-policy.example/x");';
    expect(callSite.test(probe), "the call-site matcher reads no fetch() at all").toBe(true);
    expect([...probe.matchAll(/https:\/\/([a-z0-9.-]+)/gi)].map((match) => match[1].toLowerCase()), "the host extractor reads no origin out of a fetch").toEqual(["a-host-outside-the-policy.example"]);
    expect([...connect], "the control origin must not be allowed, or the control proves nothing").not.toContain("a-host-outside-the-policy.example");
    expect(files.length, "the scan read almost none of the bundle").toBeGreaterThan(30);
    expect([...connect], "connect-src must still carry the API host").toContain(hostedHost);
  });

  it("keeps the four headers this release line already ships", () => {
    expect(global?.get("x-frame-options"), "framing is refused twice or not at all").toBe("DENY");
    expect(global?.get("x-content-type-options")).toBe("nosniff");
    expect(global?.get("referrer-policy")).toBe("strict-origin-when-cross-origin");
    expect(global?.get("permissions-policy")).toMatch(/camera=\(\).*microphone=\(\).*geolocation=\(\)/);
  });
});
