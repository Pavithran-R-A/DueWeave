import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";

// CL-7 Stage C item 14: a Content-Security-Policy is only real once a browser has run the
// app under it. `client/public/_headers` is the file Cloudflare Pages enforces from, and
// `vite preview` ignores it, so this suite reads the shipped policy and injects it onto the
// document response itself. Every case then asks the same question of a live Chromium: did
// the page refuse something DueWeave needs? The control case proves the reading is possible
// at all — an inline script and an off-allowlist origin must be refused here, or the other
// four cases are measuring nothing.

const root = path.resolve(import.meta.dirname, "..");

function shippedDirective(header: string) {
  const line = readFileSync(path.join(root, "client", "public", "_headers"), "utf8")
    .split(/\r?\n/)
    .map((text) => text.trim())
    .find((text) => text.toLowerCase().startsWith("content-security-policy:"));
  if (!line) throw new Error("_headers declares no Content-Security-Policy");
  const value = line.slice("Content-Security-Policy:".length).trim();
  const directive = value.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${header} `));
  if (!directive) throw new Error(`the shipped policy declares no ${header}`);
  return directive;
}

const policy = readFileSync(path.join(root, "client", "public", "_headers"), "utf8")
  .split(/\r?\n/)
  .map((text) => text.trim())
  .find((text) => text.toLowerCase().startsWith("content-security-policy:"))!
  .slice("Content-Security-Policy:".length)
  .trim();

/** The API origin the policy itself allows, so a probe tests the file rather than a copy. */
const allowedOrigin = (shippedDirective("connect-src").match(/https:\/\/([a-z0-9.-]+)/i) ?? [])[0];

/** The https hosts a directive names — `'self'` and the keywords are not hosts. */
function policyHosts(directive: string) {
  return (shippedDirective(directive).match(/https:\/\/[a-z0-9.-]+/gi) ?? []).map((url) => new URL(url).hostname.toLowerCase());
}

const CSP_REPORT = /refused to|content security policy/i;

/** Chromium reports every refusal on the console; nothing else about this page is excused. */
async function watchRefusals(page: Page) {
  const refusals: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && CSP_REPORT.test(message.text())) refusals.push(message.text());
  });
  page.on("pageerror", (error) => {
    if (CSP_REPORT.test(error.message)) refusals.push(`uncaught: ${error.message}`);
  });
  return refusals;
}

async function underShippedPolicy(page: Page) {
  const refusals = await watchRefusals(page);
  await page.route("**/*", async (route) => {
    // Only the document carries the policy; replaying it onto hashed assets would make the
    // harness slower without changing what the browser enforces.
    if (route.request().resourceType() !== "document") {
      await route.continue();
      return;
    }
    const response = await route.fetch();
    const headers = response.headers();
    headers["content-security-policy"] = policy;
    await route.fulfill({ response, headers });
  });
  return refusals;
}

test.describe("the policy DueWeave ships, enforced by a browser", () => {
  test("runs the sign-in screen under it, including the webfonts the screen is designed around", async ({ page }) => {
    const refusals = await underShippedPolicy(page);
    const hosts = [...new Set([...policyHosts("style-src"), ...policyHosts("font-src")])];
    const requested: string[] = [];
    page.on("request", (request) => {
      const host = new URL(request.url()).hostname.toLowerCase();
      if (hosts.includes(host)) requested.push(host);
    });
    const failed: string[] = [];
    page.on("requestfailed", (request) => {
      const host = new URL(request.url()).hostname.toLowerCase();
      if (hosts.includes(host)) failed.push(`${host}: ${request.failure()?.errorText}`);
    });
    expect(hosts.length, "the policy names no external font host to prove").toBeGreaterThan(0);

    await page.goto("/auth");
    await expect(page.getByLabel("Email address")).toBeVisible({ timeout: 20_000 });
    await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
    await page.evaluate(() => document.fonts.ready);

    for (const host of hosts) {
      expect(requested, `the sign-in screen never reached ${host}`).toContain(host);
    }
    expect(failed, "a font request the policy allows still failed").toEqual([]);
    // A refused stylesheet or font file still renders a form — just in the fallback
    // typeface. So ask the page which family it draws with, then whether that family
    // actually arrived, instead of asserting a weight the screen may never use.
    const family = await page.evaluate(() => getComputedStyle(document.body).fontFamily.split(",")[0].replaceAll('"', ""));
    expect(
      await page.evaluate((name) => document.fonts.check(`400 16px '${name}'`), family),
      `the sign-in screen sets ${family}, which never loaded`,
    ).toBe(true);
    expect(refusals, "the shipped policy refused something the sign-in screen needs").toEqual([]);
  });

  test("serves all three trust documents under it", async ({ page }) => {
    const refusals = await underShippedPolicy(page);
    for (const route of ["/privacy", "/terms", "/support"]) {
      await page.goto(route);
      await expect(page.locator(".legal-shell")).toBeVisible({ timeout: 20_000 });
      await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    }
    expect(refusals, "the shipped policy refused something a legal page needs").toEqual([]);
  });

  test("refuses what it is supposed to refuse, so the two readings above mean something", async ({ page }) => {
    const refusals = await underShippedPolicy(page);
    await page.goto("/auth");
    await page.evaluate(() => {
      const inline = document.createElement("script");
      inline.textContent = "window.__cspInlineRan = true;";
      document.body.append(inline);
      void fetch("https://origin-not-in-the-policy.example/csp-probe").catch(() => undefined);
    });
    await expect.poll(() => page.evaluate(() => (window as unknown as { __cspInlineRan?: boolean }).__cspInlineRan), { timeout: 10_000 }).toBeUndefined();
    await expect
      .poll(() => refusals.length, { timeout: 10_000 }, "the harness never reported a refusal")
      .toBeGreaterThan(0);
    expect(refusals.join("\n"), "the inline script was not the refusal this control expects").toMatch(/inline script/i);
    expect(refusals.join("\n"), "an off-allowlist origin was not refused").toMatch(/connect|fetch|xhr/i);
  });

  test("lets the app reach the API origin the policy names and draw its own QR code", async ({ page }) => {
    expect(allowedOrigin, "connect-src names no https origin to probe").toBeTruthy();
    const refusals = await underShippedPolicy(page);
    // Served from a stub, so the case measures the browser's decision and not the network.
    await page.route(`${allowedOrigin}/**`, (route) => route.fulfill({ status: 200, contentType: "text/plain", body: "probed" }));
    await page.goto("/auth");
    const outcome = await page.evaluate(async (origin) => {
      const results: string[] = [];
      try {
        await fetch(`${origin}/auth/v1/health`);
        results.push("fetch: attempted");
      } catch {
        results.push("fetch: transport");
      }
      await new Promise<void>((resolve) => {
        const socket = new WebSocket(`wss://${new URL(origin).host}/realtime/v1/websocket`);
        socket.addEventListener("close", () => resolve());
        socket.addEventListener("error", () => resolve());
        window.setTimeout(resolve, 4_000);
      });
      await new Promise<void>((resolve) => {
        const image = new Image();
        image.addEventListener("load", () => resolve());
        image.addEventListener("error", () => resolve());
        image.src = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
      });
      return results;
    }, allowedOrigin);
    expect(outcome, "the API probe did not reach the network layer").toContain("fetch: attempted");
    expect(refusals, `the shipped policy refused its own allowlisted origin: ${refusals.join(" / ")}`).toEqual([]);
  });

  test("keeps the frame, form and base surfaces shut that the product never uses", async ({ page }) => {
    const refusals = await underShippedPolicy(page);
    await page.goto("/auth");
    await page.evaluate(() => {
      const frame = document.createElement("iframe");
      frame.src = "/auth";
      frame.setAttribute("csp-frame-probe", "true");
      document.body.append(frame);
      const base = document.createElement("base");
      base.href = "https://origin-not-in-the-policy.example/";
      document.head.append(base);
    });
    await expect.poll(() => refusals.join("\n"), { timeout: 10_000 }).toMatch(/base-uri|base href/i);
    expect(refusals.join("\n"), "an iframe on the same origin is allowed by design and proves nothing here").toMatch(/base-uri/);
  });
});
