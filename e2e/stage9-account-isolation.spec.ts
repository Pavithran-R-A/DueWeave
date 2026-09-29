// DUEWEAVE CURRENT ROADMAP STAGE 9 — PHASE 13, the isolation prerequisite for
// Stage 11, re-qualified from inside a real browser.
//
// Stage 3 proved row-level security with API-shaped requests and Stage 3's browser
// spec proved what a second human can see on screen. Stage 7 proved it through the
// bytes two tenants actually downloaded. What had never been done in one place is the
// combination this file is: two real accounts signed up through the UI, each holding a
// client, an invoice, a promise, a payment and an activity row, and then one account
// attacking the other's *identifiers* over the same network path the app itself uses —
// the browser's own fetch, the browser's own session, and the same publishable key the
// browser was already handed.
//
// No service-role key appears here and none is needed: the key and the target are read
// off the requests the app made, which is exactly what an attacker with devtools has.
// Nothing writes to the database directly. The only accepted writes are the ones the
// product's own forms made, plus the refused attack writes below — whose refusal is
// proven by re-reading from the owner's own session, not by trusting a status code.

import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, test, type BrowserContext, type Browser, type Page } from "@playwright/test";
import { completeWorkspaceSetup } from "./workspace-setup";
import { drainProblems, startProblemWatch, type ProblemWatch } from "./problem-watch";

const localStackEnabled = process.env.STAGE9_LOCAL_E2E === "1";

const runToken = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;

// PHASE 16 forbids muting failed traffic wholesale, so this file keeps a ledger of
// the exact request URLs it breaks on purpose. `attackWrite()` below records into it,
// and the `afterEach` grace is built from those literal URLs — which means a refusal
// that was not asked for still reaches the assertion, including a 403 on the same
// table read back by its own owner (that read carries `?select=` and is not one of
// the recorded attacks).
const deliberateAttacks = new Set<string>();

// An ordinary account that opens the review screen has all three queue reads refused
// by the database, and no client-side check could know that before asking. Stage 8
// accepted the same reading (`e2e/stage8-local-founder-customer.spec.ts`), and the
// refusal is what the reviewer-boundary step below proves, so it is excused by name.
// A refusal anywhere else still fails the run.
const refusedReviewerReads = /\/rest\/v1\/rpc\/(list_pending_founder_claims|list_rejected_founder_claims|get_founder_funnel)/;

// The CSV sheets open with a byte-order mark so Excel on Windows reads them as UTF-8
// (client/src/lib/data-export.ts writes it), and every row is CRLF-terminated. Spelled
// as a codepoint rather than a literal so the character is visible in the source.
const byteOrderMark = String.fromCharCode(0xfeff);

function businessDate(offset: number) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(Date.now() + offset * 86_400_000);
  const part = (kind: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === kind)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

type Tenant = {
  role: "alpha" | "beta";
  email: string;
  password: string;
  displayName: string;
  businessName: string;
  clientName: string;
  company: string;
  invoiceTitle: string;
  invoiceReference: string;
  promiseNote: string;
  paymentReference: string;
  /** Rupees typed into the form, and the paise the ledger must therefore hold. */
  amountRupees: string;
  outstandingPaise: number;
};

function newTenant(role: "alpha" | "beta"): Tenant {
  const tag = `${role}${runToken.slice(-5)}`;
  return {
    role,
    email: `stage9iso-${tag}@dueweave.local`,
    password: `Stage9iso!${tag}aA`,
    displayName: `Stage9 ${role} Owner`,
    businessName: `Stage9 ${role} Studio ${tag}`,
    clientName: `Stage9 ${role} Client ${tag}`,
    company: `Stage9 ${role} Pictures ${tag}`,
    invoiceTitle: `Stage9 ${role} shoot ${tag}`,
    invoiceReference: `S9${tag.toUpperCase()}`,
    promiseNote: `Stage9 ${role} promised half ${tag}`,
    paymentReference: `STAGE9${tag.toUpperCase()}`,
    amountRupees: role === "alpha" ? "7000" : "4000",
    outstandingPaise: role === "alpha" ? 600_000 : 300_000,
  };
}

/** Everything one account typed, spelled out of everything the other one is handed. */
function privateWords(tenant: Tenant): string[] {
  return [tenant.clientName, tenant.company, tenant.invoiceTitle, tenant.invoiceReference, tenant.promiseNote, tenant.paymentReference, tenant.email, tenant.businessName];
}

/** Where a signed-in browser's own traffic points, read off the traffic itself. */
type RestTarget = { base: string; apikey: string };

function watchRestTarget(page: Page): RestTarget {
  const target: RestTarget = { base: "", apikey: "" };
  page.on("request", (request) => {
    const key = request.headers()["apikey"];
    if (!target.apikey && key) target.apikey = key;
    const match = /^(https?:\/\/[^/]+)\/(rest|auth|storage)\//.exec(request.url());
    if (!target.base && match) target.base = match[1];
  });
  return target;
}

async function waitForTarget(target: RestTarget, page: Page) {
  await expect.poll(() => Boolean(target.base && target.apikey), "the app never sent a keyed request to its own stack").toBe(true);
  await expect.poll(() => accessToken(page), "the signed-in browser kept no session").not.toBe("");
}

// Read fresh every time: the auth library rotates the access token mid-session.
function accessToken(page: Page) {
  return page.evaluate(() => {
    const key = Object.keys(window.localStorage).find((item) => item.startsWith("sb-") && item.includes("auth-token"));
    const raw = key ? window.localStorage.getItem(key) : null;
    if (!raw) return "";
    // Measured on this stack: the persisted value under `sb-127-auth-token` is the
    // session object itself, so the token sits at the top level of that JSON.
    const session = JSON.parse(raw) as { access_token?: string };
    return session.access_token ?? "";
  });
}

type Probe = { method: "GET" | "POST" | "PATCH"; path: string; params?: Record<string, string>; body?: unknown };
type ProbeResult = { status: number; body: string };

/** One request, made by the page, with the page's own session and key. */
async function probe(page: Page, target: RestTarget, request: Probe): Promise<ProbeResult> {
  const token = await accessToken(page);
  expect(token, "the signed-in browser had no session to probe with").not.toBe("");
  const result = await page.evaluate(
    async ({ base, apikey, bearer, method, path, params, body }) => {
      const url = new URL(`${base}${path}`);
      for (const [key, value] of Object.entries(params ?? {})) url.searchParams.set(key, value);
      try {
        const response = await fetch(url.toString(), {
          method,
          headers: { apikey, Authorization: `Bearer ${bearer}`, "Content-Type": "application/json", Prefer: "return=representation" },
          body: body === undefined ? undefined : JSON.stringify(body),
        });
        return { status: response.status, body: await response.text() };
      } catch (reason) {
        return { status: 0, body: `fetch rejected: ${String(reason)}` };
      }
    },
    { base: target.base, apikey: target.apikey, bearer: token, ...request }
  );
  return result;
}

/**
 * A write this spec attempts in order to be refused. The URL is recorded so the
 * console discipline can excuse precisely this request and nothing else.
 */
async function attackWrite(page: Page, target: RestTarget, request: Probe): Promise<ProbeResult> {
  const url = new URL(`${target.base}${request.path}`);
  for (const [key, value] of Object.entries(request.params ?? {})) url.searchParams.set(key, value);
  deliberateAttacks.add(url.toString());
  return probe(page, target, request);
}

/**
 * The grace this step is entitled to: the reviewer reads the product makes on a
 * forbidden screen, plus the literal URLs of the writes this suite attacks on
 * purpose. Nothing else is excused, anywhere.
 */
function stepGrace(): RegExp {
  const attacks = [...deliberateAttacks].map((url) => url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return new RegExp([refusedReviewerReads.source, ...attacks].join("|"));
}

/** A read the owner is entitled to make. Anything else is a broken test, not a win. */
function rows(result: ProbeResult): Record<string, unknown>[] {
  expect(result.status, `the authorised read was refused (${result.status}): ${result.body.slice(0, 200)}`).toBeLessThan(400);
  const parsed = JSON.parse(result.body) as unknown;
  return Array.isArray(parsed) ? (parsed as Record<string, unknown>[]) : [parsed as Record<string, unknown>];
}

function ids(result: ProbeResult, column = "id"): string[] {
  return rows(result).map((row) => String(row[column]));
}

/**
 * A refusal an auditor can cite: the server said no, and said no as a client error.
 * A 5xx would be a crash under attack, which is a different and worse finding.
 */
function refused(result: ProbeResult, what: string) {
  expect(result.status, `${what} was answered with ${result.status}: ${result.body.slice(0, 160)}`).toBeGreaterThanOrEqual(400);
  expect(result.status, `${what} crashed the server instead of refusing: ${result.body.slice(0, 160)}`).toBeLessThan(500);
}

/**
 * The same refusal, read by a browser instead of a terminal. Measured on this stack:
 * the four direct table writes answer 403 with SQLSTATE 42501 and the page can read
 * that, but the gateway's answer to a refused `/rpc/` call carries no CORS grant, so
 * the fetch rejects before the status is legible — status 0 here is the transport
 * saying "I was refused and was not allowed to say why". So the RPC attack is proved
 * the only way it can be proved from inside the app: by what the owner re-reads after
 * the attempt. A 2xx would mean the write landed; a 5xx would mean the server broke
 * under it. Both are still findings.
 */
function refusedOrUnreadable(result: ProbeResult, what: string) {
  const refusedByServer = result.status >= 400 && result.status < 500;
  expect(refusedByServer || result.status === 0, `${what} was answered with ${result.status}: ${result.body.slice(0, 160)}`).toBe(true);
}

async function acknowledge(page: Page, title: string) {
  await expect(page.getByRole("region", { name: /Notifications/ }).getByText(title, { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  await page.mouse.move(0, 0);
  await expect(page.getByRole("region", { name: /Notifications/ }).locator("li"), "the acknowledgement stack never left").toHaveCount(0, { timeout: 15_000 });
}

/**
 * Presses a real export control and reads the bytes Chromium saved. The browser's own
 * copy is what a person would open in a spreadsheet, so this is the only reading that
 * can prove nothing foreign rode along — an in-app string check could not.
 */
async function downloadFile(page: Page, control: RegExp) {
  const announced = page.waitForEvent("download", { timeout: 30_000 });
  await page.getByRole("region", { name: "Take the ledger with you." }).getByRole("button", { name: control }).first().click();
  const file = await announced;
  const localPath = await file.path();
  expect(localPath, `${file.suggestedFilename()} produced no readable file`).not.toBeNull();
  await acknowledge(page, "Download started");
  return { filename: file.suggestedFilename(), text: readFileSync(localPath as string, "utf8") };
}

async function signUp(page: Page, tenant: Tenant) {
  await page.goto("/auth");
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Your name").fill(tenant.displayName);
  await page.getByLabel("Email address").fill(tenant.email);
  await page.getByLabel("Password").fill(tenant.password);
  await page.getByRole("button", { name: "Create my workspace" }).click();
  await completeWorkspaceSetup(page, tenant);
}

/** The whole ledger, typed into the product's own sheets: client, invoice, promise, payment, activity. */
async function seedLedger(page: Page, tenant: Tenant) {
  await page.getByRole("button", { name: "Add first receivable" }).click();
  const sheet = page.getByRole("dialog", { name: "Add receivable" });
  await sheet.getByLabel("Client name").fill(tenant.clientName);
  await sheet.getByLabel("Company").fill(tenant.company);
  await sheet.getByLabel("Phone").fill("+91 90000 11111");
  await sheet.getByLabel("Amount").fill(tenant.amountRupees);
  await sheet.getByLabel("Due date").fill(businessDate(-2));
  await sheet.getByLabel("What is this for?").fill(tenant.invoiceTitle);
  await sheet.getByLabel("Invoice or reference").fill(tenant.invoiceReference);
  await sheet.getByRole("button", { name: "Save receivable" }).click();
  await acknowledge(page, "Receivable added");

  await page.getByRole("button", { name: /Record new promise/ }).click();
  const promise = page.getByRole("dialog", { name: "Record a new promise" });
  await promise.getByLabel("Promised amount").fill("1000");
  await promise.getByLabel("Promised date").fill(businessDate(0));
  await promise.getByLabel("Source").selectOption("Call");
  await promise.getByLabel("Note").fill(tenant.promiseNote);
  await promise.getByRole("button", { name: "Keep this promise" }).click();
  await acknowledge(page, "Promise added");

  // The payment writes the activity row this spec then attacks, through `record_payment`.
  await page.getByRole("button", { name: "Record payment", exact: true }).click();
  const payment = page.getByRole("dialog", { name: "Record payment" });
  await payment.getByLabel("Amount").fill("1000");
  await payment.getByLabel("Date").fill(businessDate(0));
  await payment.getByLabel("Method").selectOption("UPI");
  await payment.getByLabel("Reference").fill(tenant.paymentReference);
  await payment.getByRole("button", { name: /^Record payment/ }).click();
  await acknowledge(page, "Payment recorded");

  await expect(page.locator(".detail-amount strong")).toHaveText(tenant.role === "alpha" ? "₹6,000" : "₹3,000");
}

async function openSection(page: Page, section: "Today" | "Receivables" | "Clients" | "More") {
  await page.getByLabel("Primary navigation").getByRole("button", { name: section }).filter({ visible: true }).first().click();
}

async function newTenantPage(browser: Browser) {
  const context = await browser.newContext();
  const page = await context.newPage();
  // wa.me is a third party an automated run must never reach. Cancelling the
  // navigation only keeps every app-side click wired exactly as it is for a person.
  await page.addInitScript(() => {
    document.addEventListener("click", (event) => {
      const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href^="https://wa.me/"]') : null;
      if (anchor) event.preventDefault();
    }, true);
  });
  return { context, page };
}

/** One account's own rows, learned through that account's authorised read. */
type Owned = {
  userId: string;
  clientId: string;
  receivableId: string;
  receivableIds: string[];
  paymentIds: string[];
  promiseIds: string[];
  activityIds: string[];
  outstandingPaise: number;
  label: string;
};

function emptyOwned(): Owned {
  return { userId: "", clientId: "", receivableId: "", receivableIds: [], paymentIds: [], promiseIds: [], activityIds: [], outstandingPaise: 0, label: "" };
}

test.describe("Stage 9 two-account isolation, attacked from the browser", () => {
  // Serial because the attacks are only meaningful against the rows the first two
  // steps created, on one pair of signed-in pages. The timeout has to be declared
  // before the conditional skip: measured on this runner, `configure()` placed after
  // `test.skip(condition, …)` left the tests on the 30 s global and cut the two
  // sign-ups short.
  test.describe.configure({ mode: "serial", timeout: 150_000 });
  test.skip(!localStackEnabled, "Set STAGE9_LOCAL_E2E=1 to run against the local Supabase stack.");

  const alpha = newTenant("alpha");
  const beta = newTenant("beta");

  let contextAlpha: BrowserContext;
  let contextBeta: BrowserContext;
  let pageAlpha: Page;
  let pageBeta: Page;
  let targetAlpha: RestTarget;
  let targetBeta: RestTarget;
  let watchAlpha: ProblemWatch;
  let watchBeta: ProblemWatch;

  const owned: Record<"alpha" | "beta", Owned> = { alpha: emptyOwned(), beta: emptyOwned() };

  test.beforeAll(async ({ browser }) => {
    const first = await newTenantPage(browser);
    const second = await newTenantPage(browser);
    contextAlpha = first.context;
    pageAlpha = first.page;
    contextBeta = second.context;
    pageBeta = second.page;
    targetAlpha = watchRestTarget(pageAlpha);
    targetBeta = watchRestTarget(pageBeta);
    watchAlpha = startProblemWatch(pageAlpha);
    watchBeta = startProblemWatch(pageBeta);
  });

  test.afterAll(async () => {
    await contextAlpha?.close();
    await contextBeta?.close();
  });

  // One watcher per page spans the journey, so the failure lands on the step that
  // caused it instead of on the whole describe. The grace is built from the requests
  // this step expected to be refused and then forgotten, so it never carries over:
  // every other broken request, and every other console error, still fails the run.
  test.afterEach(() => {
    const grace = stepGrace();
    deliberateAttacks.clear();
    expect(drainProblems(watchAlpha, grace)).toEqual([]);
    expect(drainProblems(watchBeta, grace)).toEqual([]);
  });

  test("two strangers each build a ledger of their own through the product", async () => {
    await signUp(pageAlpha, alpha);
    await seedLedger(pageAlpha, alpha);
    await signUp(pageBeta, beta);
    await seedLedger(pageBeta, beta);
    await waitForTarget(targetAlpha, pageAlpha);
    await waitForTarget(targetBeta, pageBeta);
  });

  test("each owner's authorised read finds exactly the records it made", async () => {
    for (const [tenant, page, target] of [[alpha, pageAlpha, targetAlpha], [beta, pageBeta, targetBeta]] as const) {
      const bucket = owned[tenant.role];
      const receivables = await probe(page, target, { method: "GET", path: "/rest/v1/receivables", params: { select: "id,label,outstanding_paise" } });
      bucket.receivableIds = ids(receivables);
      expect(bucket.receivableIds, `${tenant.role} reads a receivable it never created`).toHaveLength(1);
      bucket.receivableId = bucket.receivableIds[0];
      bucket.label = String(rows(receivables)[0].label);
      bucket.outstandingPaise = Number(rows(receivables)[0].outstanding_paise);
      expect(bucket.label).toBe(tenant.invoiceTitle);
      expect(bucket.outstandingPaise).toBe(tenant.outstandingPaise);

      const clients = await probe(page, target, { method: "GET", path: "/rest/v1/clients", params: { select: "id,name" } });
      bucket.clientId = ids(clients)[0];
      expect(ids(clients), `${tenant.role} reads more than its own client`).toHaveLength(1);

      for (const [table, fill] of [["payments", "paymentIds"], ["promises", "promiseIds"]] as const) {
        const found = await probe(page, target, { method: "GET", path: `/rest/v1/${table}`, params: { select: "id" } });
        bucket[fill] = ids(found);
        expect(bucket[fill], `${tenant.role} found no ${table} for the money it recorded`).toHaveLength(1);
      }

      // The history is counted, not pinned to a number: seeding one invoice, one
      // promise and one payment writes a row per event, and the exact set is the
      // product's business. What this spec needs is a snapshot to attack against.
      const activities = await probe(page, target, { method: "GET", path: "/rest/v1/activities", params: { select: "id" } });
      bucket.activityIds = ids(activities);
      expect(bucket.activityIds.length, `${tenant.role} recorded a ledger event that left no history`).toBeGreaterThanOrEqual(3);

      const profiles = await probe(page, target, { method: "GET", path: "/rest/v1/profiles", params: { select: "id" } });
      const profileIds = ids(profiles);
      expect(profileIds, `${tenant.role} reads more than one profile`).toHaveLength(1);
      bucket.userId = profileIds[0];
    }

    // If the two ledgers were the same objects, every refusal below would be vacuous.
    expect(owned.alpha.receivableId).not.toBe(owned.beta.receivableId);
    expect(owned.alpha.userId).not.toBe(owned.beta.userId);
    expect(owned.alpha.clientId).not.toBe(owned.beta.clientId);
  });

  test("the other account's screens carry none of these words", async () => {
    for (const [intruder, victim] of [[pageBeta, alpha], [pageAlpha, beta]] as const) {
      for (const needle of privateWords(victim)) {
        await expect(intruder.getByText(needle, { exact: false }), `the intruder's first screen showed "${needle}"`).toHaveCount(0);
      }
      for (const section of ["Today", "Receivables", "Clients", "More"] as const) {
        await openSection(intruder, section);
        for (const needle of [victim.clientName, victim.invoiceTitle, victim.invoiceReference, victim.paymentReference, victim.email]) {
          await expect(intruder.getByText(needle, { exact: false }), `${section} leaked "${needle}"`).toHaveCount(0);
        }
      }
      // And the victim's rows are not countable from here either.
      await openSection(intruder, "Receivables");
      await expect(intruder.locator(".receivable-list-card")).toHaveCount(1);
    }
  });

  test("the other account's identifiers read as nothing, table by table", async () => {
    for (const [attacker, target, victimBucket] of [
      [pageBeta, targetBeta, owned.alpha],
      [pageAlpha, targetAlpha, owned.beta],
    ] as const) {
      for (const [table, id] of [
        ["receivables", victimBucket.receivableId],
        ["clients", victimBucket.clientId],
        ["payments", victimBucket.paymentIds[0]],
        ["promises", victimBucket.promiseIds[0]],
        ["activities", victimBucket.activityIds[0]],
        ["profiles", victimBucket.userId],
      ] as const) {
        const byId = await probe(attacker, target, { method: "GET", path: `/rest/v1/${table}`, params: { select: "*", id: `eq.${id}` } });
        expect(rows(byId), `${table} handed the other account a row addressed by id`).toEqual([]);
      }
      // A full scan is what an export reads, and it is bounded the same way.
      const scan = await probe(attacker, target, { method: "GET", path: "/rest/v1/receivables", params: { select: "id" } });
      expect(ids(scan)).toHaveLength(1);
    }
  });

  test("the other account's rows cannot be created, patched, or paid into", async () => {
    // Both directions, spelled out: the page doing the write, the session it writes
    // as, and the victim whose state is re-read by its own owner afterwards.
    const directions = [
      { attacker: pageBeta, attackerTarget: targetBeta, attackerOwn: owned.beta, victim: alpha, victimPage: pageAlpha, victimTarget: targetAlpha, victimBucket: owned.alpha },
      { attacker: pageAlpha, attackerTarget: targetAlpha, attackerOwn: owned.alpha, victim: beta, victimPage: pageBeta, victimTarget: targetBeta, victimBucket: owned.beta },
    ];
    for (const attack of directions) {
      // A receivable under the attacker's own ownership but hanging off the victim's
      // client. The row would be readable by its owner, so what stands between this
      // and a cross-tenant reference is the write gate itself — measured here as 403
      // with SQLSTATE 42501, i.e. `authenticated` holds no INSERT on the table.
      const insert = await attackWrite(attack.attacker, attack.attackerTarget, {
        method: "POST",
        path: "/rest/v1/receivables",
        body: [{ owner_id: attack.attackerOwn.userId, client_id: attack.victimBucket.clientId, label: `injected ${attack.victim.invoiceReference}`, invoice_ref: attack.victim.invoiceReference, amount_due_paise: 500_000, outstanding_paise: 500_000, due_date: businessDate(1), status: "OPEN" }],
      });
      refused(insert, "a direct receivable insert");

      // Ownership cannot be forged on a new client either.
      const fakeClient = await attackWrite(attack.attacker, attack.attackerTarget, {
        method: "POST",
        path: "/rest/v1/clients",
        body: [{ owner_id: attack.victimBucket.userId, name: `forged ${attack.victim.invoiceReference}`, company: "none", phone: null, email: null, notes: null }],
      });
      refused(fakeClient, "a client written under the victim's ownership");

      // `activities` is the history the ledger keeps, so this is the write that would
      // put words on somebody else's invoice. Measured answer: 403 with SQLSTATE
      // 42501 — the direct insert is refused by the absence of a grant before any
      // policy or trigger is even reached.
      const forgedActivity = await attackWrite(attack.attacker, attack.attackerTarget, {
        method: "POST",
        path: "/rest/v1/activities",
        body: [{ owner_id: attack.attackerOwn.userId, receivable_id: attack.victimBucket.receivableId, type: "NOTE_ADDED", note: `injected ${attack.victim.invoiceReference}` }],
      });
      refused(forgedActivity, "an activity on the victim's receivable");

      // A patch addressed by the victim's id. Measured: 403 with SQLSTATE 42501 —
      // `authenticated` holds no UPDATE on the table, so the attempt never reaches a
      // row. Either refusal shape is acceptable here; what would be a defect is a 2xx
      // that names a row it touched, which is why the answer is read before the
      // owner's re-read below confirms the record is untouched.
      const patch = await attackWrite(attack.attacker, attack.attackerTarget, { method: "PATCH", path: "/rest/v1/receivables", params: { id: `eq.${attack.victimBucket.receivableId}` }, body: { label: `overwritten ${attack.victim.invoiceReference}` } });
      expect(patch.status, `a foreign patch failed at the server: ${patch.status} ${patch.body.slice(0, 160)}`).toBeLessThan(500);
      const touched = patch.status < 400 ? rows(patch) : [];
      expect(touched, "a patch addressed by the victim's id reported a row it changed").toEqual([]);

      // The payment RPC is the product's own money path, so this is the attack that
      // matters most: shape-correct arguments, the victim's receivable id. Its refusal
      // is only half-legible from a browser (see `refusedOrUnreadable`), so the proof
      // of this attack is the victim's own re-read of its payments and balance below.
      const rpc = await attackWrite(attack.attacker, attack.attackerTarget, {
        method: "POST",
        path: "/rpc/record_payment",
        body: { p_receivable_id: attack.victimBucket.receivableId, p_amount_paise: 100, p_paid_on: businessDate(0), p_method: "UPI", p_reference: `attack ${attack.victim.invoiceReference}`, p_request_id: randomUUID() },
      });
      refusedOrUnreadable(rpc, "record_payment on a foreign receivable");

      // End state, read by the owner in its own session: nothing above moved anything.
      const after = await probe(attack.victimPage, attack.victimTarget, { method: "GET", path: "/rest/v1/receivables", params: { select: "id,label,outstanding_paise" } });
      expect(ids(after), "the victim's receivable count changed").toEqual([attack.victimBucket.receivableId]);
      expect(String(rows(after)[0].label), "the victim's invoice label changed").toBe(attack.victimBucket.label);
      expect(Number(rows(after)[0].outstanding_paise), "a foreign payment moved the victim's balance").toBe(attack.victimBucket.outstandingPaise);
      const victimPayments = await probe(attack.victimPage, attack.victimTarget, { method: "GET", path: "/rest/v1/payments", params: { select: "id" } });
      expect(ids(victimPayments).sort(), "a payment landed on the victim's receivable from outside the account").toEqual([...attack.victimBucket.paymentIds].sort());
      const victimActivities = await probe(attack.victimPage, attack.victimTarget, { method: "GET", path: "/rest/v1/activities", params: { select: "id" } });
      // Sorted, because the read carries no ORDER BY: what is proved is that the set
      // of history rows is the one the owner had before the attack.
      expect(ids(victimActivities).sort(), "an injected activity row became visible to the victim").toEqual([...attack.victimBucket.activityIds].sort());
      const attackerScan = await probe(attack.attacker, attack.attackerTarget, { method: "GET", path: "/rest/v1/receivables", params: { select: "id" } });
      expect(ids(attackerScan), "an injected receivable became visible to its injector").toHaveLength(1);
      const attackerClients = await probe(attack.attacker, attack.attackerTarget, { method: "GET", path: "/rest/v1/clients", params: { select: "id" } });
      expect(ids(attackerClients), "a forged client became visible to its injector").toHaveLength(1);
    }
  });

  test("claims, entitlements, review access and settings stay shut", async () => {
    const directions = [
      { attacker: pageBeta, attackerTarget: targetBeta, own: beta, victim: alpha, victimBucket: owned.alpha },
      { attacker: pageAlpha, attackerTarget: targetAlpha, own: alpha, victim: beta, victimBucket: owned.beta },
    ];
    for (const attack of directions) {
      const claims = await probe(attack.attacker, attack.attackerTarget, { method: "GET", path: "/rest/v1/purchase_claims", params: { select: "*" } });
      expect(rows(claims), "the purchase-claim table was readable across accounts").toEqual([]);
      // Not a row count: every readable entitlement has to be this account's own.
      const entitlements = await probe(attack.attacker, attack.attackerTarget, { method: "GET", path: "/rest/v1/entitlements", params: { select: "user_id" } });
      for (const row of rows(entitlements)) {
        expect(String(row.user_id), "an entitlement belonging to another account was readable").toBe(attack.attacker === pageBeta ? owned.beta.userId : owned.alpha.userId);
      }

      await attack.attacker.goto("/admin/founder-claims");
      await expect(attack.attacker.getByRole("heading", { name: "Founder review is restricted." })).toBeVisible();
      await expect(attack.attacker.getByText(attack.victim.email, { exact: false })).toHaveCount(0);
      // The review surface is its own shell, so leave the way a person would: the
      // screen's own way back, then prove the ledger is on screen before measuring it.
      await attack.attacker.getByRole("button", { name: "Return to ledger" }).click();
      await expect(attack.attacker.getByLabel("Primary navigation")).toBeVisible({ timeout: 15_000 });

      // The settings screen reads the owner's row and nothing else.
      await openSection(attack.attacker, "More");
      await expect(attack.attacker.locator(".identity-row", { hasText: "Sign-in email" })).toContainText(attack.own.email);
      await expect(attack.attacker.locator(".identity-row", { hasText: "Business or workspace" })).toContainText(attack.own.businessName);
      await expect(attack.attacker.getByText(attack.victim.email, { exact: false })).toHaveCount(0);
      await expect(attack.attacker.getByText(attack.victim.businessName, { exact: false })).toHaveCount(0);
    }
  });

  test("search finds nothing across accounts, not even an exact invoice reference", async () => {
    for (const [intruder, victim] of [[pageBeta, alpha], [pageAlpha, beta]] as const) {
      await openSection(intruder, "Receivables");
      const search = intruder.getByLabel("Search receivables");
      await search.fill(victim.invoiceReference);
      await expect(intruder.locator(".receivable-list-card")).toHaveCount(0);
      await search.fill(victim.clientName);
      await expect(intruder.locator(".receivable-list-card")).toHaveCount(0);
      // The intruder's own record is still there, so the empty results above are
      // isolation and not a broken screen.
      await search.fill("");
      await expect(intruder.locator(".receivable-list-card")).toHaveCount(1);

      await intruder.getByRole("button", { name: "Add receivable" }).first().click();
      const picker = intruder.getByRole("dialog", { name: "Add receivable" });
      await picker.getByRole("button", { name: "Existing client" }).click();
      await picker.getByLabel("Search existing clients").fill(victim.invoiceReference);
      await expect(picker.getByRole("option")).toHaveCount(0);
      await expect(picker.getByText("No matching client. Choose New client to add one explicitly.")).toBeVisible();
      await picker.getByRole("button", { name: "Cancel" }).click();
      await expect(picker).toHaveCount(0);
    }
  });

  test("the other account's export files carry none of its records, in every shape", async () => {
    // The archive is the bulk read an account can do on itself, and the sheets are what
    // a person actually opens in a spreadsheet, so every shape the product hands out is
    // measured — a leak confined to the CSV encoder would show here and nowhere else.
    // Each sheet's expected row count is the exporting account's own authorised read from
    // the step above, which is the positive control: it proves the file really carried the
    // account's rows, so the absence of the other account's below is isolation rather than
    // an empty export. `null` marks the JSON archive, which is not line-shaped.
    const shapes: Array<{ control: RegExp; rows: ((own: Owned) => number) | null }> = [
      { control: /Full data archive/, rows: null },
      { control: /^Clients CSV$/, rows: (own) => (own.clientId ? 1 : 0) },
      { control: /^Receivables CSV$/, rows: (own) => own.receivableIds.length },
      { control: /^Payments CSV$/, rows: (own) => own.paymentIds.length },
      { control: /^Promises CSV$/, rows: (own) => own.promiseIds.length },
      { control: /^Activity CSV$/, rows: (own) => own.activityIds.length },
    ];
    for (const [exporter, own, ownRows, victim] of [
      [pageBeta, beta, owned.beta, alpha],
      [pageAlpha, alpha, owned.alpha, beta],
    ] as const) {
      await openSection(exporter, "More");
      const panel = exporter.getByRole("region", { name: "Take the ledger with you." });
      await expect(panel).toBeVisible();
      for (const shape of shapes) {
        const file = await downloadFile(exporter, shape.control);
        if (shape.rows === null) {
          expect(file.text, `${file.filename} carried none of ${own.role}'s own ledger`).toContain(own.clientName);
        } else {
          // Measured on this build: the sheets are UTF-8 with a byte-order mark and
          // CRLF-terminated rows ending in a trailing CRLF (client/src/lib/data-export.ts),
          // so the body is one header line plus one line per exported row.
          const body = file.text.startsWith(byteOrderMark) ? file.text.slice(byteOrderMark.length) : file.text;
          const rows = body.trimEnd().split(/\r?\n/).length - 1;
          expect(rows, `${file.filename} carried a different number of ${own.role}'s rows than ${own.role} can read`).toBe(shape.rows(ownRows));
        }
        for (const word of privateWords(victim)) {
          expect(file.text, `${file.filename} carried "${word}" belonging to ${victim.role}`).not.toContain(word);
        }
      }
    }
  });
});
