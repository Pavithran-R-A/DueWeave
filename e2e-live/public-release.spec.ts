import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";

// Cloudflare Pages enforces `client/public/_headers`, so the committed file is the policy the
// repository claims. Reading it here and requiring the live document to answer with the same
// directives is what separates a shipped policy from a deployment that predates it.
const shipped = new Map(
  readFileSync(path.resolve(import.meta.dirname, "..", "client", "public", "_headers"), "utf8")
    .split(/\r?\n/)
    .map((line) => /^\s{2}([A-Za-z-]+):\s*(.+)$/.exec(line))
    .filter((match): match is RegExpExecArray => match !== null)
    .map((match) => [match[1].toLowerCase(), match[2].trim()]),
);

function directives(value: string) {
  return value.split(";").map((part) => part.trim()).filter(Boolean);
}

test("production serves the committed CSP and HSTS, and the policy refuses nothing the sign-in screen needs", async ({ page }) => {
  const csp = shipped.get("content-security-policy");
  const hsts = shipped.get("strict-transport-security");
  expect(csp, "client/public/_headers must declare a Content-Security-Policy").toBeTruthy();
  expect(hsts, "client/public/_headers must declare Strict-Transport-Security").toBeTruthy();

  const refusals: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" && /content security policy|refused to/i.test(message.text())) refusals.push(message.text());
  });
  const response = await page.goto("/auth");
  expect(response?.status()).toBe(200);
  const headers = response?.headers() ?? {};
  expect(headers["content-security-policy"], "the live origin sends no Content-Security-Policy").toBeTruthy();
  expect(directives(headers["content-security-policy"]), "the live CSP is not the committed policy").toEqual(directives(csp!));
  expect(headers["strict-transport-security"], "the live origin sends no Strict-Transport-Security").toBe(hsts);

  await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  const family = await page.evaluate(() => getComputedStyle(document.body).fontFamily.split(",")[0].replaceAll('"', ""));
  expect(
    await page.evaluate((name) => document.fonts.check(`400 16px '${name}'`), family),
    `the sign-in screen sets ${family}, which the policy never delivered`,
  ).toBe(true);
  expect(refusals, "the shipped policy refused something the sign-in screen needs").toEqual([]);
});

test("production login, PWA mark and browser errors", async ({ page, request }) => {
  const uncaught: string[] = [];
  page.on("pageerror", (error) => uncaught.push(error.message));
  const response = await page.goto("/auth");
  expect(response?.status()).toBe(200);
  await expect(page.getByRole("heading", { name: /your follow-ups, in one calm place/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
  await expect(page.locator(".auth-brand img")).toHaveAttribute("src", "/brand/mark.svg");

  const [favicon, manifest] = await Promise.all([request.get("/icon.svg"), request.get("/manifest.json")]);
  expect(favicon.status()).toBe(200);
  expect(favicon.headers()["content-type"]).toMatch(/image\/svg\+xml/);
  expect(await favicon.text()).toContain("<svg");
  expect(manifest.status()).toBe(200);
  expect((await manifest.json()).name).toContain("DueWeave");
  expect(uncaught).toEqual([]);
});

test("unqualified public signup is accurately gated without affecting existing-user sign-in", async ({ page }) => {
  await page.goto("/auth");
  await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
  await expect(page.getByText(/new registrations are temporarily paused/i)).toBeVisible();
  await expect(page.getByRole("button", { name: /create an account/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /forgot password/i })).toHaveCount(0);
  await expect(page.getByText(/password recovery emails are temporarily unavailable/i)).toBeVisible();
  // No real email is sent by this smoke test.
});

test("protected routes and unauthenticated recovery cannot reveal a ledger", async ({ page }) => {
  for (const path of ["/", "/onboarding", "/founder", "/admin/founder-claims"]) {
    await page.goto(path);
    await expect(page).toHaveURL(/\/auth$/);
    await expect(page.getByRole("heading", { name: /your follow-ups/i })).toBeVisible();
  }
  await page.goto("/auth/update-password");
  await expect(page.getByRole("heading", { name: /recovery link is not active/i })).toBeVisible();
  await expect(page.getByRole("button", { name: /request a new reset link/i })).toHaveCount(0);
});

test("mobile login stays usable without horizontal overflow", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/auth");
  await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 2);
  expect(overflow).toBe(false);
});

test("real hosted account-deletion CORS preflight accepts the production browser and rejects other origins", async ({ request }) => {
  const endpoint = "https://ugzdqcytouwfdlcjujqv.supabase.co/functions/v1/delete-account";
  const requestedHeaders = "authorization,apikey,x-client-info,content-type";
  const allowed = await request.fetch(endpoint, {
    method: "OPTIONS",
    headers: {
      Origin: "https://dueweave.pages.dev",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": requestedHeaders,
    },
  });
  expect(allowed.status(), "production browser preflight must reach the Edge Function").toBe(204);
  expect(allowed.headers()["access-control-allow-origin"]).toBe("https://dueweave.pages.dev");
  const configured = new Set((allowed.headers()["access-control-allow-headers"] ?? "").split(",").map((x) => x.trim().toLowerCase()));
  for (const header of requestedHeaders.split(",")) expect(configured.has(header)).toBe(true);

  const foreign = await request.fetch(endpoint, {
    method: "OPTIONS",
    headers: {
      Origin: "https://unauthorized.example.invalid",
      "Access-Control-Request-Method": "POST",
      "Access-Control-Request-Headers": requestedHeaders,
    },
  });
  expect(foreign.status()).toBe(403);
  expect(foreign.headers()["access-control-allow-origin"]).toBeUndefined();
});

test("common mobile, tablet and desktop widths have no auth-page horizontal overflow", async ({ page }) => {
  for (const width of [320, 360, 375, 390, 430, 768, 1024, 1280, 1366, 1536, 1920]) {
    await page.setViewportSize({ width, height: width < 500 ? 844 : 900 });
    await page.goto("/auth");
    await expect(page.getByRole("button", { name: /sign in/i })).toBeVisible();
    const metrics = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      innerWidth: window.innerWidth,
    }));
    expect(metrics.scrollWidth, `Unexpected horizontal overflow at ${width}px viewport`).toBeLessThanOrEqual(metrics.innerWidth + 2);
  }
});
