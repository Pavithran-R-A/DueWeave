// Stage 7 Phases 60-62. The export is only worth trusting if the file a person
// actually receives is the file, so this journey presses the real buttons, lets
// Chromium produce the real download, and reads the bytes back off disk. Nothing
// here imports the formatter: an assertion about a string this test built itself
// would prove nothing about what the browser was handed.

import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";
import { awaitLedger, completeWorkspaceSetup } from "./workspace-setup";
import { problemsFound, startProblemWatch, type ProblemWatch } from "./problem-watch";

const localStackEnabled = process.env.STAGE7_LOCAL_E2E === "1";

const token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const suffix = token.slice(-6);

type Tenant = {
  email: string;
  password: string;
  displayName: string;
  businessName: string;
  clientName: string;
  company: string;
  invoice: string;
  title: string;
};

const ownerA: Tenant = {
  email: `stage7exporta${suffix}@dueweave.local`,
  password: `Stage7exportA!${suffix}aA`,
  displayName: `Stage7 Export Owner ${suffix}`,
  businessName: `Stage7 Export Studio ${suffix}`,
  clientName: `Kavya Travels ${suffix}`,
  company: `A-MARKER-DO-NOT-LEAK-TO-B ${suffix}`,
  invoice: `INV-A-${suffix}`,
  title: `Airport transfer ${suffix}`,
};

const ownerB: Tenant = {
  email: `stage7exportb${suffix}@dueweave.local`,
  password: `Stage7exportB!${suffix}aA`,
  displayName: `Stage7 Export Owner B ${suffix}`,
  businessName: `Stage7 Tenant B ${suffix}`,
  clientName: `DO-NOT-LEAK-B-TENANT ${suffix}`,
  company: `B Poster Studio ${suffix}`,
  invoice: `INV-B-${suffix}`,
  title: `Poster set ${suffix}`,
};

const markerA = ownerA.company.split(" ")[0];
const markerB = ownerB.clientName.split(" ")[0];
const paymentReference = `credit after the shoot ${suffix}`;

/** The archive, typed only as far as this file reads it. */
type ExportedBundle = {
  format: string;
  version: number;
  product: string;
  currency: string;
  businessCalendar: string;
  exportedAt: string;
  account: { displayName: string | null; businessName: string | null; email: string | null; timezone: string | null; currency: string | null };
  clients: { name: string; company: string; phone: string | null }[];
  receivables: { label: string; invoice_ref: string | null; amount_due_paise: number; outstanding_paise: number }[];
  promises: { made_on: string; promised_date: string; promised_amount_paise: number }[];
  payments: { amount_paise: number; paid_on: string; reference: string | null; method: string }[];
  activities: { type: string; note: string | null; occurred_at: string }[];
};

// The chip says "Activity CSV" while the file is named for the plural dataset, so
// both are held here and each is asserted against the thing it names.
const csvSheets = [
  { label: "Clients", stem: "clients" },
  { label: "Receivables", stem: "receivables" },
  { label: "Payments", stem: "payments" },
  { label: "Promises", stem: "promises" },
  { label: "Activity", stem: "activities" },
] as const;

async function clearToasts(page: Page) {
  await page.mouse.move(0, 0);
  await expect(page.getByRole("region", { name: /Notifications/ }).locator("li"), "the acknowledgement stack never left").toHaveCount(0, { timeout: 15_000 });
}

async function toastTitle(page: Page, title: string) {
  await expect(page.getByRole("region", { name: /Notifications/ }).getByText(title, { exact: true }).first()).toBeVisible({ timeout: 15_000 });
  await clearToasts(page);
}

async function signIn(page: Page, account: Tenant) {
  await page.goto("/auth");
  const form = page.getByLabel("Email address");
  const ledger = page.locator(".app-shell");
  await expect(ledger.or(form)).toBeVisible({ timeout: 15_000 });
  if (await ledger.isVisible()) {
    await page.getByRole("button", { name: "More" }).filter({ visible: true }).first().click();
    await page.getByRole("button", { name: "Sign out" }).click();
    await expect(form).toBeVisible({ timeout: 15_000 });
  }
  await form.fill(account.email);
  await page.getByLabel("Password").fill(account.password);
  await page.locator("button.auth-submit").click();
  await expect(page).toHaveURL(/\/$/, { timeout: 20_000 });
  await awaitLedger(page);
}

async function signUp(page: Page, account: Tenant) {
  await page.goto("/auth");
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.getByLabel("Your name").fill(account.displayName);
  await page.getByLabel("Email address").fill(account.email);
  await page.getByLabel("Password").fill(account.password);
  await page.getByRole("button", { name: "Create my workspace" }).click();
  await completeWorkspaceSetup(page, account);
}

/** The exports live in a named group, so nothing below measures the whole page. */
async function openYourData(page: Page) {
  await page.getByRole("button", { name: "More" }).filter({ visible: true }).first().click();
  const panel = page.getByRole("region", { name: "Take the ledger with you." });
  await expect(panel).toBeVisible();
  return panel;
}

/**
 * Presses a real control and takes the file Chromium says it saved. `path()` is the
 * browser's own copy, so what is read back is exactly the bytes the download
 * mechanism was handed — including a byte-order mark no in-app string check could
 * have proved.
 */
async function download(page: Page, panel: Page | ReturnType<Page["getByRole"]>, control: RegExp) {
  const announced = page.waitForEvent("download", { timeout: 30_000 });
  await panel.getByRole("button", { name: control }).first().click();
  const file = await announced;
  const localPath = await file.path();
  expect(localPath, `${file.suggestedFilename()} produced no readable file`).not.toBeNull();
  await toastTitle(page, "Download started");
  return { filename: file.suggestedFilename(), text: readFileSync(localPath as string, "utf8") };
}

// The mark belongs to the file, not to a row, and the encoder ends every row.
function csvRows(text: string) {
  return text.replace(/^\uFEFF/, "").trimEnd().split("\r\n");
}

test.describe("Stage 7 export journey", () => {
  test.skip(!localStackEnabled, "Set STAGE7_LOCAL_E2E=1 to run against the local Supabase stack.");
  test.describe.configure({ mode: "serial", timeout: 180_000 });

  let watch: ProblemWatch;

  test.beforeEach(async ({ page }) => {
    watch = startProblemWatch(page);
  });

  test.afterEach(() => {
    expect(problemsFound(watch)).toEqual([]);
  });

  test("an owner builds a real ledger through the product", async ({ page }) => {
    await signUp(page, ownerA);
    await page.getByRole("button", { name: "Add first receivable" }).click();
    const add = page.getByRole("dialog", { name: "Add receivable" });
    await add.getByLabel("Client name").fill(ownerA.clientName);
    await add.getByLabel("Company").fill(ownerA.company);
    await add.getByLabel("Phone").fill("+91 98765 43210");
    await add.getByLabel("Amount").fill("28000");
    await add.getByLabel("Due date").fill("2026-09-10");
    await add.getByLabel("What is this for?").fill(ownerA.title);
    await add.getByLabel("Invoice or reference").fill(ownerA.invoice);
    await add.getByRole("button", { name: "Save receivable" }).click();
    await toastTitle(page, "Receivable added");

    await page.getByRole("button", { name: /Record new promise/ }).click();
    const promiseSheet = page.getByRole("dialog", { name: "Record a new promise" });
    await promiseSheet.getByLabel("Promised amount").fill("15000");
    // Stage 5's chronology rule is part of the product: a promise cannot be made
    // after the day it was promised for, so the pair is entered the way a person
    // would enter an old commitment.
    await promiseSheet.getByLabel("Promise made on").fill("2026-09-12");
    await promiseSheet.getByLabel("Promised date").fill("2026-09-20");
    await promiseSheet.getByRole("button", { name: "Keep this promise" }).click();
    await toastTitle(page, "Promise added");

    await page.getByRole("button", { name: "Record payment", exact: true }).click();
    const paymentSheet = page.getByRole("dialog", { name: "Record payment" });
    await paymentSheet.getByLabel("Amount").fill("5000");
    await paymentSheet.getByLabel("Reference").fill(paymentReference);
    await paymentSheet.getByRole("button", { name: /^Record payment/ }).click();
    await toastTitle(page, "Payment recorded");

    // A confirmed contact, so the activity sheet carries a row with a controlled note.
    await page.getByRole("button", { name: /^Follow up/ }).filter({ visible: true }).first().click();
    const sheet = page.getByRole("dialog", { name: "Choose the next message" });
    await expect(sheet).toBeVisible();
    await sheet.getByRole("button", { name: /I sent it/ }).click();
    await toastTitle(page, "Follow-up marked");
  });

  test("a second tenant puts a marker in their own ledger", async ({ page }) => {
    await signUp(page, ownerB);
    await page.getByRole("button", { name: "Add first receivable" }).click();
    const add = page.getByRole("dialog", { name: "Add receivable" });
    await add.getByLabel("Client name").fill(ownerB.clientName);
    await add.getByLabel("Company").fill(ownerB.company);
    await add.getByLabel("Amount").fill("9000");
    await add.getByLabel("Due date").fill("2026-09-14");
    await add.getByLabel("What is this for?").fill(ownerB.title);
    await add.getByLabel("Invoice or reference").fill(ownerB.invoice);
    await add.getByRole("button", { name: "Save receivable" }).click();
    await toastTitle(page, "Receivable added");
  });

  test("the full archive is the ledger, versioned, and carries no credential", async ({ page }) => {
    await signIn(page, ownerA);
    const panel = await openYourData(page);
    // Phase 36: what this particular file exposes is said before the press.
    await expect(panel.getByText(/Anyone with the file can read it/i)).toBeVisible();
    const file = await download(page, panel, /Full data archive/);
    expect(file.filename).toMatch(/^dueweave-data-\d{4}-\d{2}-\d{2}\.json$/);

    const bundle = JSON.parse(file.text) as ExportedBundle;
    expect(bundle.format).toBe("dueweave-export");
    expect(bundle.version).toBe(1);
    expect(bundle.product).toBe("DueWeave");
    expect(bundle.currency).toBe("INR");
    expect(bundle.businessCalendar).toBe("Asia/Kolkata");
    expect(bundle.exportedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    expect(bundle.account.displayName).toBe(ownerA.displayName);
    expect(bundle.account.businessName).toBe(ownerA.businessName);
    expect(bundle.account.email).toBe(ownerA.email);
    expect(bundle.account.timezone).toBe("Asia/Kolkata");
    expect(bundle.account.currency).toBe("INR");

    expect(bundle.clients.map((row) => row.name)).toContain(ownerA.clientName);
    expect(bundle.clients[0].phone).toContain("9876543210");
    expect(bundle.receivables.map((row) => row.label)).toContain(ownerA.title);
    expect(bundle.receivables[0].invoice_ref).toBe(ownerA.invoice);
    expect(bundle.receivables[0].amount_due_paise).toBe(2800000);
    expect(bundle.promises).toHaveLength(1);
    // Stage 5's promise origin has to survive the trip into the file.
    expect(bundle.promises[0].made_on).toBe("2026-09-12");
    expect(bundle.promises[0].promised_amount_paise).toBe(1500000);
    expect(bundle.payments).toHaveLength(1);
    expect(bundle.payments[0].amount_paise).toBe(500000);
    expect(bundle.payments[0].reference).toBe(paymentReference);
    // The confirmed contact travels as the activity kind the database actually allows.
    expect(bundle.activities.some((row) => row.type === "FOLLOW_UP_RECORDED")).toBe(true);

    // Money leaves as integer paise, never as a symbol-formatted string.
    expect(file.text).not.toContain("₹");
    for (const secret of ["service_role", "eyJ", ownerA.password, "apikey", "Bearer "]) {
      expect(file.text, `the archive carried ${secret}`).not.toContain(secret);
    }
    // Phases 43-44: no import or deletion affordance was invented beside the files.
    await expect(panel.getByRole("button", { name: /Import|Restore|Delete my account/i })).toHaveCount(0);
    await expect(panel.getByText(/not part of this build/i)).toBeVisible();
  });

  test("every spreadsheet sheet is the same ledger in another shape", async ({ page }) => {
    await signIn(page, ownerA);
    const panel = await openYourData(page);
    for (const { label, stem } of csvSheets) {
      const sheet = await download(page, panel, new RegExp(`^${label} CSV$`));
      expect(sheet.filename).toMatch(new RegExp(`^dueweave-${stem}-\\d{4}-\\d{2}-\\d{2}\\.csv$`));
      // Excel on Windows reads an unmarked UTF-8 CSV in the local codepage.
      expect(sheet.text.charCodeAt(0)).toBe(0xfeff);
      const [header, ...rows] = csvRows(sheet.text);
      expect(rows.length, `${label} exported no rows`).toBeGreaterThan(0);
      expect(header).toMatch(/_id/);
    }
    const clients = await download(page, panel, /^Clients CSV$/);
    expect(csvRows(clients.text)[0]).toBe("client_id,name,company,phone,email,notes,archived_at,created_at,updated_at");
    expect(clients.text).toContain(ownerA.clientName);
    expect(clients.text).toContain(markerA);
    const payments = await download(page, panel, /^Payments CSV$/);
    expect(payments.text).toContain(paymentReference);
    expect(payments.text).toContain(",500000,");
    const activities = await download(page, panel, /^Activity CSV$/);
    expect(activities.text).toContain("WhatsApp follow-up sent");
  });

  // Phase 37/61. RLS proved from the browser's side: a real second tenant, a real
  // signed-in session, and the files the first tenant actually received.
  test("one tenant's files never contain the other tenant's marker", async ({ page }) => {
    await signIn(page, ownerA);
    const panel = await openYourData(page);
    const archive = await download(page, panel, /Full data archive/);
    expect(archive.text).toContain(markerA);
    expect(archive.text).not.toContain(markerB);
    expect(archive.text).not.toContain(ownerB.invoice);
    for (const { label, stem } of csvSheets) {
      const sheet = await download(page, panel, new RegExp(`^${label} CSV$`));
      expect(sheet.text, `${stem}.csv carried the other tenant`).not.toContain(markerB);
      expect(sheet.text).not.toContain(ownerB.invoice);
      expect(sheet.text).not.toContain(ownerB.clientName);
    }

    await signIn(page, ownerB);
    const theirs = await openYourData(page);
    const theirArchive = await download(page, theirs, /Full data archive/);
    expect(theirArchive.text).toContain(markerB);
    expect(theirArchive.text).not.toContain(markerA);
    expect(theirArchive.text).not.toContain(ownerA.invoice);
    const theirClients = await download(page, theirs, /^Clients CSV$/);
    expect(theirClients.text).not.toContain(ownerA.clientName);
  });

  // Phase 35. A download the browser refused to start must not be reported as one
  // that happened, and the ledger must not be parked somewhere to be tried later.
  test("a refused download says it failed and stores nothing", async ({ page }) => {
    await page.addInitScript(() => {
      URL.createObjectURL = () => {
        throw new Error("the browser refused to create the file");
      };
    });
    await signIn(page, ownerA);
    const panel = await openYourData(page);
    const before = await page.evaluate(() => Object.keys(window.localStorage).sort());
    await panel.getByRole("button", { name: /Full data archive/ }).click();
    await toastTitle(page, "Could not prepare the file");
    await expect(page.getByRole("region", { name: /Notifications/ })).not.toContainText("Download started");
    await expect(panel.getByRole("button", { name: /Full data archive/ })).toBeEnabled();
    const after = await page.evaluate(() => {
      const keys = Object.keys(window.localStorage).sort();
      return { keys, text: keys.map((key) => `${key}=${window.localStorage.getItem(key)}`).join("|") };
    });
    expect(after.keys).toEqual(before);
    expect(after.text).not.toContain(ownerA.clientName);
    expect(after.text).not.toContain("client_id");
  });

  // Phase 62. Everything a person typed, read and downloaded, audited afterwards.
  test("the ledger never lands in web storage", async ({ page }) => {
    await signIn(page, ownerA);
    const panel = await openYourData(page);
    await download(page, panel, /Full data archive/);
    await download(page, panel, /^Receivables CSV$/);
    const audit = await page.evaluate(async () => {
      const dump = (storage: Storage) => Object.keys(storage).map((key) => `${key}=${storage.getItem(key)}`);
      const bodies: string[] = [];
      const listed = async () => (await indexedDB.databases()).map((entry) => entry.name ?? "");
      for (const name of await listed()) {
        if (!name) continue;
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
          const open = indexedDB.open(name);
          open.onsuccess = () => resolve(open.result);
          open.onerror = () => reject(open.error);
        });
        const storeNames = Array.from(database.objectStoreNames);
        if (storeNames.length) {
          const transaction = database.transaction(storeNames, "readonly");
          for (const storeName of storeNames) {
            const records = await new Promise<unknown[]>((resolve) => {
              const request = transaction.objectStore(storeName).getAll();
              request.onsuccess = () => resolve(request.result as unknown[]);
              request.onerror = () => resolve([]);
            });
            bodies.push(`${name}.${storeName}:${JSON.stringify(records)}`);
          }
        }
        database.close();
      }
      const text = [...dump(window.localStorage), ...dump(window.sessionStorage), ...bodies].join("|");
      return { localKeys: Object.keys(window.localStorage).sort(), sessionKeys: Object.keys(window.sessionStorage).sort(), databases: await listed(), text };
    });
    // Only the theme this device picked may sit beside whatever the auth library
    // keeps for the session itself.
    for (const key of audit.localKeys) {
      expect(key === "dueweave-theme" || key.startsWith("sb-"), `an unexpected key was stored: ${key}`).toBe(true);
    }
    expect(audit.localKeys).toContain("dueweave-theme");
    expect(audit.sessionKeys).toEqual([]);
    for (const needle of [ownerA.clientName, ownerA.invoice, ownerA.title, "dueweave-export", "client_id", markerA]) {
      expect(audit.text, `web storage carried ${needle}`).not.toContain(needle);
    }
    for (const database of audit.databases) {
      expect(database, `a database named ${database} appeared`).not.toContain("dueweave");
    }
  });

  // Phase 46: the exports are ordinary, named, keyboard-reachable controls.
  test("every export control is named, reachable and visibly focused", async ({ page }) => {
    await signIn(page, ownerA);
    const panel = await openYourData(page);
    for (const name of ["Full data archive", ...csvSheets.map((item) => `${item.label} CSV`)]) {
      await expect(panel.getByRole("button", { name: new RegExp(name) })).toBeVisible();
    }
    let reached = "";
    let marked = false;
    for (let step = 0; step < 60 && !reached.includes("Activity CSV"); step += 1) {
      await page.keyboard.press("Tab");
      const stop = await page.evaluate(() => {
        const el = document.activeElement as HTMLElement | null;
        if (!el) return { name: "", inPanel: false, ring: false, focusVisible: false };
        const style = getComputedStyle(el);
        // An icon-only control carries its name in aria-label, so text alone would
        // call an honest control anonymous.
        const labelled = el.getAttribute("aria-label") || el.textContent || "";
        return {
          name: labelled.replace(/\s+/g, " ").trim(),
          inPanel: Boolean(el.closest('[aria-labelledby="your-data-heading"]')),
          ring: (style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) > 0) || style.boxShadow !== "none",
          focusVisible: el.matches(":focus-visible"),
        };
      });
      expect(stop.name, `a keyboard stop at step ${step} arrived with no name to announce`).not.toBe("");
      if (stop.inPanel) {
        reached = stop.name;
        marked = marked || (stop.focusVisible && stop.ring);
      }
    }
    expect(reached, "Tab never reached an export control").toContain("Activity CSV");
    expect(marked, "an export control in keyboard focus carried no visible mark").toBe(true);
    // Sensitivity is written where the press happens, not behind a hover.
    await expect(panel.getByText(/One file per list/i)).toBeVisible();
    await expect(panel.getByText(/Anyone with the file can read it/i)).toBeVisible();
  });

  // Phase 47: measured at the widths the brief names.
  for (const viewport of [
    { name: "360×800", width: 360, height: 800 },
    { name: "390×844", width: 390, height: 844 },
    { name: "768×1024", width: 768, height: 1024 },
    { name: "1280×800", width: 1280, height: 800 },
    { name: "1440×900", width: 1440, height: 900 },
  ]) {
    test(`Your data fits ${viewport.name} with nothing cut off`, async ({ page }) => {
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await signIn(page, ownerA);
      const panel = await openYourData(page);
      // A person reaches these controls by scrolling, so each one is brought on
      // screen the way they would be and then measured where it lands.
      for (const name of ["Full data archive", ...csvSheets.map((item) => `${item.label} CSV`)]) {
        const control = panel.getByRole("button", { name: new RegExp(name) });
        await control.scrollIntoViewIfNeeded();
        await expect(control).toBeInViewport();
        const box = (await control.boundingBox()) as { x: number; width: number };
        expect(box.x, `“${name}” started off the left edge at ${viewport.name}`).toBeGreaterThanOrEqual(0);
        expect(box.x + box.width, `“${name}” ran past the right edge at ${viewport.name}`).toBeLessThanOrEqual(viewport.width + 1);
      }
      const overflow = await page.evaluate(() => {
        const width = document.documentElement.clientWidth;
        const scrollWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
        const offenders = scrollWidth > width + 1
          ? Array.from(document.querySelectorAll<HTMLElement>("body *"))
            .filter((el) => {
              const box = el.getBoundingClientRect();
              return box.width > 0 && box.right > width + 1 && getComputedStyle(el).position !== "fixed";
            })
            .slice(0, 4)
            .map((el) => `${el.tagName.toLowerCase()}.${String(el.className).split(" ")[0] || "-"}→${Math.round(el.getBoundingClientRect().right)}`)
          : [];
        return { width, scrollWidth, offenders };
      });
      expect(overflow.offenders, `${viewport.name} overflowed horizontally (${overflow.scrollWidth} against ${overflow.width})`).toEqual([]);
      // Long descriptions wrap instead of pushing the layout sideways.
      const noteBox = await panel.getByText(/Anyone with the file can read it/i).boundingBox();
      expect(noteBox, "the sensitivity note was never laid out").not.toBeNull();
      expect(noteBox!.width).toBeLessThanOrEqual(viewport.width);
    });
  }
});
