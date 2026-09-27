// Stage 7 opens with two claims the accepted build cannot make: opening a WhatsApp
// tab is not proof that anything was sent, and a clipboard call that was never awaited
// cannot promise that anything was copied. Both are proven here through the real
// product surface, against a link the browser is never allowed to actually follow.

import { expect, test, type Page } from "@playwright/test";
import { completeWorkspaceSetup } from "./workspace-setup";
import { problemsFound, startProblemWatch, type ProblemWatch } from "./problem-watch";

const localStackEnabled = process.env.STAGE7_LOCAL_E2E === "1";
const token = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const account = {
  email: `stage7follow-${token}@dueweave.local`,
  password: `Stage7follow!${token}aA`,
  displayName: `Stage7 Follow Owner ${token.slice(-6)}`,
  businessName: `Stage7 Follow Studio ${token.slice(-6)}`,
};
const studioClient = `Nalini Films ${token.slice(-6)}`;
const invoiceTitle = `Weddy teaser ${token.slice(-6)}`;

test.describe("Stage 7 follow-up truth", () => {
  test.skip(!localStackEnabled, "Set STAGE7_LOCAL_E2E=1 to run against the local Supabase stack.");
  test.describe.configure({ mode: "serial" });
  test.describe.configure({ timeout: 120_000 });

  let watch: ProblemWatch;

  test.beforeEach(async ({ page }) => {
    watch = startProblemWatch(page);
  });

  test.afterEach(() => {
    expect(problemsFound(watch)).toEqual([]);
  });

  // wa.me is a third party and automated tests must never reach it. A capture-phase
  // listener cancels the navigation only: the click still travels to the app, so
  // whatever the app wires to that click is exercised exactly as a human would.
  async function captureWhatsAppNavigation(page: Page) {
    await page.addInitScript(() => {
      (window as unknown as { __waLinks: string[] }).__waLinks = [];
      document.addEventListener("click", (event) => {
        const anchor = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href^="https://wa.me/"]') : null;
        if (!anchor) return;
        event.preventDefault();
        (window as unknown as { __waLinks: string[] }).__waLinks.push(anchor.href);
      }, true);
    });
  }

  async function openedWhatsAppLinks(page: Page) {
    return page.evaluate(() => (window as unknown as { __waLinks?: string[] }).__waLinks ?? []);
  }

  function toastTitle(page: Page, title: string) {
    return page.getByRole("region", { name: /Notifications/ }).getByText(title, { exact: true });
  }

  function timeline(page: Page) {
    return page.locator(".timeline .timeline-item");
  }

  // A contact is whatever the timeline says was a contact. Counting only those
  // entries keeps the proof independent of how many other events the receivable
  // has collected while earlier tests were running.
  function contactEntries(page: Page) {
    return page.locator(".timeline .timeline-item strong", { hasText: /contacted|follow-up sent|WhatsApp sent/i });
  }

  // The timeline is written oldest first, so the newest fact is the last entry.
  function newestNote(page: Page) {
    return page.locator(".timeline .timeline-item strong").last();
  }

  function snoozeEntries(page: Page) {
    return page.locator(".timeline .timeline-item", { hasText: "Follow-up snoozed" });
  }

  // The contact is written by exactly one thing: an activity write reaching the
  // server. The app calls the `record_contacted` RPC today, so both the RPC and a
  // direct row insert are watched — a future path cannot slip past the proof.
  // Waiting for that write, rather than for a row count, is what makes an
  // absence provable — a count can pass simply because the refresh has not
  // landed yet. The window is the settle time the app itself needs to write and
  // re-read, measured at roughly a second on this stack.
  function isContactWrite(url: string, method: string) {
    return method === "POST" && (/\/rest\/v1\/activities/.test(url) || /\/rpc\/record_contacted/.test(url));
  }

  function contactWrites(page: Page) {
    const writes: string[] = [];
    page.on("request", (request) => {
      if (isContactWrite(request.url(), request.method())) writes.push(request.url().replace(/^.*\/(rest\/v1\/activities|rpc\/record_contacted)$/, "$1"));
    });
    return writes;
  }

  function contactWrite(page: Page) {
    return page.waitForResponse((response) => isContactWrite(response.url(), response.request().method()), { timeout: 10_000 }).catch(() => null);
  }

  /** Where focus sits: the name a reader would announce, and whether the browser is
   * painting it as focused. A ring can be an outline or a shadow — `.form-input:focus`
   * replaces the global outline with a soft teal shadow, so both count. */
  async function focusStop(page: Page) {
    return page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el) return { name: "", marked: false, inSheet: false };
      const style = getComputedStyle(el);
      // A control carries its name in an aria-label, in a wrapping label, or in its own
      // text — an input has no text of its own, so all three are read.
      const labelled = el as HTMLElement & { labels?: ArrayLike<HTMLLabelElement> | null };
      const fromLabel = labelled.labels ? Array.from(labelled.labels, (label) => label.textContent ?? "").join(" ") : "";
      const name = (el.getAttribute("aria-label") || fromLabel || el.textContent || "").replace(/\s+/g, " ").trim();
      const ring = (style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) > 0) || style.boxShadow !== "none";
      return { name, marked: el.matches(":focus-visible") && ring, inSheet: Boolean(el.closest(".sheet")) };
    });
  }

  async function openFollowUpSheet(page: Page) {
    // The queue carries one follow-up button per receivable, so the click is made
    // on the card whose details are on screen — which is what a person does.
    await page.locator(".queue-card--selected button[aria-label^='Follow up with']").click();
    const sheet = page.getByRole("dialog", { name: "Choose the next message" });
    await expect(sheet).toBeVisible();
    return sheet;
  }

  async function signIn(page: Page) {
    await page.goto("/auth");
    await page.getByLabel("Email address").fill(account.email);
    await page.getByLabel("Password").fill(account.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/$/);
  }

  test("a fresh owner with one overdue amount gets a follow-up sheet", async ({ page }) => {
    await captureWhatsAppNavigation(page);
    await page.goto("/auth");
    await page.getByRole("button", { name: "Create an account" }).click();
    await page.getByLabel("Your name").fill(account.displayName);
    await page.getByLabel("Email address").fill(account.email);
    await page.getByLabel("Password").fill(account.password);
    await page.getByRole("button", { name: "Create my workspace" }).click();
    await completeWorkspaceSetup(page, account);

    await page.getByRole("button", { name: "Add first receivable" }).click();
    const together = page.getByRole("dialog", { name: "Add receivable" });
    await together.getByLabel("Client name").fill(studioClient);
    await together.getByLabel("Company").fill(studioClient);
    await together.getByLabel("Phone").fill("+91 98765 43210");
    await together.getByLabel("Amount").fill("28000");
    await together.getByLabel("Due date").fill("2026-09-10");
    await together.getByLabel("What is this for?").fill(invoiceTitle);
    await together.getByRole("button", { name: "Save receivable" }).click();
    await expect(toastTitle(page, "Receivable added")).toBeVisible();

    const sheet = await openFollowUpSheet(page);
    await expect(sheet.getByRole("textbox")).toHaveValue(new RegExp(invoiceTitle));
    await expect(timeline(page)).toHaveCount(1);
  });

  test("D-S7-1: opening the WhatsApp link records no contact", async ({ page }) => {
    await captureWhatsAppNavigation(page);
    await signIn(page);
    const sheet = await openFollowUpSheet(page);

    const write = contactWrite(page);
    await sheet.getByRole("link", { name: /WhatsApp/ }).click();

    // The tab was opened: the link really was produced and really was clicked.
    await expect.poll(() => openedWhatsAppLinks(page)).toHaveLength(1);
    expect(await write, "Opening WhatsApp wrote an activity row, so a click on a link is being read as proof that a message was sent.").toBeNull();
    await expect(contactEntries(page)).toHaveCount(0);
    await expect(sheet).toBeVisible();
  });

  test("D-S7-1: closing the sheet after opening WhatsApp records no contact", async ({ page }) => {
    await captureWhatsAppNavigation(page);
    await signIn(page);
    const sheet = await openFollowUpSheet(page);
    const write = contactWrite(page);
    await sheet.getByRole("link", { name: /WhatsApp/ }).click();
    await expect.poll(() => openedWhatsAppLinks(page)).toHaveLength(1);
    expect(await write, "Opening WhatsApp and then closing the sheet recorded a contact nobody confirmed.").toBeNull();
    await sheet.getByRole("button", { name: "Close", exact: true }).click();
    await expect(sheet).toBeHidden();
    await expect(contactEntries(page)).toHaveCount(0);
  });

  test("D-S7-1: copying the message records no contact", async ({ page }) => {
    await signIn(page);
    const sheet = await openFollowUpSheet(page);
    const write = contactWrite(page);
    await sheet.getByRole("button", { name: /Copy message/ }).click();
    expect(await write, "Copying a message into the clipboard recorded it as a touchpoint with the client.").toBeNull();
    await expect(contactEntries(page)).toHaveCount(0);
  });

  test("D-S7-2: a refused clipboard never claims the message was copied", async ({ page }) => {
    await page.addInitScript(() => {
      Object.defineProperty(window.navigator, "clipboard", {
        configurable: true,
        value: { writeText: () => Promise.reject(new Error("Clipboard access denied by the browser")) },
      });
    });
    await signIn(page);
    const sheet = await openFollowUpSheet(page);
    const write = contactWrite(page);
    await sheet.getByRole("button", { name: /Copy message/ }).click();

    // The app always answers this click; the only question is whether the
    // answer is true. Waiting for one announcement first keeps a slow toast
    // from being mistaken for an honest refusal.
    const notices = page.getByRole("region", { name: /Notifications/ });
    await expect(notices.locator("li")).toHaveCount(1);
    await expect(notices).not.toContainText("Message copied");
    await expect(toastTitle(page, "Couldn’t copy automatically")).toBeVisible();
    expect(await write, "A copy that the browser refused was still counted as contacting the client.").toBeNull();
    await expect(contactEntries(page)).toHaveCount(0);
  });

  test("D-S7-1: the WhatsApp link is a link and nothing else", async ({ page }) => {
    await captureWhatsAppNavigation(page);
    await signIn(page);
    const sheet = await openFollowUpSheet(page);
    const link = sheet.getByRole("link", { name: /WhatsApp/ });
    // An outside tab must not reach back into DueWeave, and the message must not
    // leak the referrer of a private ledger.
    await expect(link).toHaveAttribute("rel", /noopener/);
    await expect(link).toHaveAttribute("rel", /noreferrer/);
    await expect(link).toHaveAttribute("target", "_blank");
    await expect(link).toHaveAttribute("href", /^https:\/\/wa\.me\/\d*\?text=/);
  });

  test("Phase 6: an explicit confirmation after opening WhatsApp records one contact", async ({ page }) => {
    await captureWhatsAppNavigation(page);
    await signIn(page);
    const sheet = await openFollowUpSheet(page);
    await sheet.getByRole("link", { name: /WhatsApp/ }).click();
    await expect.poll(() => openedWhatsAppLinks(page)).toHaveLength(1);
    // The app says what it can know, and only what it can know.
    await expect(sheet.getByText(/cannot tell whether you pressed Send/i)).toBeVisible();

    const write = contactWrite(page);
    await sheet.getByRole("button", { name: /I sent it/ }).click();
    expect(await write, "The person confirmed a contact that really happened, and nothing was written.").not.toBeNull();
    await expect(toastTitle(page, "Follow-up marked")).toBeVisible();
    await expect(sheet).toBeHidden();

    // Phase 7: the note is the controlled copy — the fact and the context, never
    // the draft the owner was about to send.
    await expect(newestNote(page)).toHaveText(/^WhatsApp follow-up sent · /);
    await expect(newestNote(page)).not.toContainText(invoiceTitle);

    await page.reload();
    await expect(contactEntries(page)).toHaveCount(1);
    await expect(page.locator(".timeline .timeline-item strong", { hasText: /^WhatsApp follow-up sent ·/ })).toHaveCount(1);
  });

  test("Phase 8: double-clicking the confirmation writes one activity, not two", async ({ page }) => {
    await signIn(page);
    const writes = contactWrites(page);
    const sheet = await openFollowUpSheet(page);
    const before = await contactEntries(page).count();

    await sheet.getByRole("button", { name: /I sent it/ }).dblclick();

    await expect(contactEntries(page)).toHaveCount(before + 1);
    expect(writes, `A double-click recorded ${writes.length} activities for one human confirmation.`).toHaveLength(1);
  });

  test("Phase 7: contact made outside WhatsApp keeps a generic note and no invented channel", async ({ page }) => {
    await signIn(page);
    const sheet = await openFollowUpSheet(page);
    const before = await contactEntries(page).count();
    const write = contactWrite(page);
    await sheet.getByRole("button", { name: /Contacted some other way/ }).click();
    expect(await write, "Marking an in-person or phone contact wrote nothing.").not.toBeNull();
    await expect(newestNote(page)).toHaveText("Follow-up marked as contacted.");
    await expect(newestNote(page)).not.toContainText(/whatsapp/i);
    await expect(contactEntries(page)).toHaveCount(before + 1);
  });

  test("Phase 17: the edited draft stays in component memory", async ({ page }) => {
    await captureWhatsAppNavigation(page);
    await signIn(page);
    const marker = `draft-secret-${token}`;
    const sheet = await openFollowUpSheet(page);
    const editor = sheet.getByRole("textbox");
    await editor.fill(`${marker} — please settle ₹28,000`);
    await sheet.getByRole("button", { name: /Copy message/ }).click();
    await sheet.getByRole("link", { name: /WhatsApp/ }).click();
    await expect.poll(() => openedWhatsAppLinks(page)).toHaveLength(1);

    const stored = await page.evaluate((needle) => {
      const scan = (storage: Storage) => Object.keys(storage).filter((key) => `${key}${storage.getItem(key)}`.includes(needle));
      return { local: scan(window.localStorage), session: scan(window.sessionStorage) };
    }, marker);
    expect(stored, "An un sent draft was parked in web storage.").toEqual({ local: [], session: [] });

    // `indexedDB.open()` answers with a request, not a database: awaiting it gives an
    // object with no stores to read. The one place this suite looks outside web
    // storage has to wait for the upgrade, and a store it cannot read has to fail the
    // test rather than be passed over.
    const indexedDbAudit = await page.evaluate(async (needle) => {
      const names = (await indexedDB.databases()).map((entry) => entry.name).filter((name): name is string => Boolean(name));
      const bodies: string[] = [];
      for (const name of names) {
        const database = await new Promise<IDBDatabase>((resolve, reject) => {
          const open = indexedDB.open(name);
          open.onsuccess = () => resolve(open.result);
          open.onerror = () => reject(open.error);
          open.onblocked = () => reject(new Error(`${name} is blocked`));
        });
        const storeNames = Array.from(database.objectStoreNames);
        if (storeNames.length) {
          const transaction = database.transaction(storeNames, "readonly");
          for (const storeName of storeNames) {
            const records = await new Promise<unknown[]>((resolve, reject) => {
              const request = transaction.objectStore(storeName).getAll();
              request.onsuccess = () => resolve(request.result as unknown[]);
              request.onerror = () => reject(request.error);
            });
            bodies.push(`${name}.${storeName}:${JSON.stringify(records)}`);
          }
        }
        database.close();
      }
      return { read: names.length, total: (await indexedDB.databases()).length, hits: bodies.filter((dump) => dump.includes(needle)) };
    }, marker);
    expect(indexedDbAudit.read, "a database existed that this audit could not open").toBe(indexedDbAudit.total);
    expect(indexedDbAudit.hits, "a follow-up draft was written into IndexedDB.").toEqual([]);

    // Even the confirmation records only the controlled note, never the message.
    const write = contactWrite(page);
    await sheet.getByRole("button", { name: /I sent it/ }).click();
    expect(await write, "An explicit confirmation after editing the draft wrote nothing.").not.toBeNull();
    await expect(newestNote(page)).not.toContainText(marker);
  });

  test("Phase 15-16: the five built-in templates are a real choice", async ({ page }) => {
    await signIn(page);
    const sheet = await openFollowUpSheet(page);
    const editor = sheet.getByRole("textbox");
    const choices = ["Friendly reminder", "Overdue reminder", "Broken promise", "Repeated missed promise", "Partial payment"];
    await expect(sheet.getByRole("radiogroup", { name: /message tone/i })).toBeVisible();
    for (const label of choices) {
      await expect(sheet.getByRole("radio", { name: new RegExp(`^${label}`) })).toBeAttached();
    }
    // The deterministic suggestion is offered as a suggestion, not a verdict.
    await expect(sheet.getByText("Suggested", { exact: true })).toHaveCount(1);
    const suggested = await sheet.getByRole("radio", { checked: true }).getAttribute("aria-label");
    expect(suggested).toContain("Overdue reminder");

    // Switching regenerates from the ledger facts and records nothing.
    const before = await contactEntries(page).count();
    const write = contactWrite(page);
    await sheet.getByRole("radio", { name: /^Partial payment/ }).click();
    const partial = await editor.inputValue();
    expect(partial).toContain(invoiceTitle);
    expect(partial).not.toContain("{{");
    await expect(sheet.getByRole("radio", { name: /^Repeated missed promise/ })).toBeAttached();
    expect(await write, "Choosing a template recorded a contact nobody confirmed.").toBeNull();
    await expect(contactEntries(page)).toHaveCount(before);

    // The owner's edit survives switching and can be reset on purpose.
    await editor.fill("hand written note");
    await sheet.getByRole("radio", { name: /^Friendly reminder/ }).click();
    expect(await editor.inputValue()).not.toBe("hand written note");
    await sheet.getByRole("button", { name: /Reset to suggested/ }).click();
    await expect(editor).toHaveValue(new RegExp(invoiceTitle));
  });

  test("Phase 19: a client with no phone number gets a choose-contact link", async ({ page }) => {
    await captureWhatsAppNavigation(page);
    await signIn(page);
    const quietClient = `Devan Audio ${token.slice(-6)}`;
    const quietTitle = `Poster set ${token.slice(-6)}`;

    // The add affordance is the floating button on small screens and the header
    // button on wide ones; either one opens the same sheet.
    await page.locator("button.floating-add, .page-header__actions button.button-primary").first().click();
    const dialog = page.getByRole("dialog", { name: "Add receivable" });
    await dialog.getByRole("button", { name: "New client" }).click();
    await dialog.getByLabel("Client name").fill(quietClient);
    await dialog.getByLabel("Company").fill(quietClient);
    await dialog.getByLabel("Amount").fill("15000");
    await dialog.getByLabel("Due date").fill("2026-09-12");
    await dialog.getByLabel("What is this for?").fill(quietTitle);
    await dialog.getByRole("button", { name: "Save receivable" }).click();
    await expect(toastTitle(page, "Receivable added")).toBeVisible();

    const sheet = await openFollowUpSheet(page);
    const link = sheet.getByRole("link", { name: /WhatsApp/ });
    await expect(link).toHaveText(/Choose contact in WhatsApp/);
    await expect(link).toHaveAttribute("href", /^https:\/\/wa\.me\/\?text=/);
    const write = contactWrite(page);
    await link.click();
    await expect.poll(() => openedWhatsAppLinks(page)).toHaveLength(1);
    expect(await write, "Choosing a contact in WhatsApp was read as a sent message.").toBeNull();

    const confirm = contactWrite(page);
    await sheet.getByRole("button", { name: /I sent it/ }).click();
    expect(await confirm).not.toBeNull();
    await expect(contactEntries(page)).toHaveCount(1);
  });

  // Phase 21: the follow-up sheet is a new neighbour of snooze, not a rewrite of it.
  // Each half counts its own event so a copy, an open, a confirmation and a pause
  // stay four separate truths in one history.
  test("Phase 21: an unconfirmed follow-up followed by a snooze adds only the snooze", async ({ page }) => {
    await captureWhatsAppNavigation(page);
    await signIn(page);
    const sheet = await openFollowUpSheet(page);
    const unconfirmed = contactWrite(page);
    await sheet.getByRole("button", { name: /Copy message/ }).click();
    await sheet.getByRole("link", { name: /WhatsApp/ }).click();
    await expect.poll(() => openedWhatsAppLinks(page)).toHaveLength(1);
    await sheet.getByRole("button", { name: "Close", exact: true }).click();
    expect(await unconfirmed, "Copying and opening WhatsApp, then closing, wrote a history event.").toBeNull();

    const entriesBefore = await timeline(page).count();
    const contactsBefore = await contactEntries(page).count();
    await page.locator("button[aria-label='Snooze follow-up']").first().click();
    const snoozeDialog = page.getByRole("dialog", { name: "Snooze follow-up" });
    await expect(snoozeDialog).toBeVisible();
    await snoozeDialog.getByRole("button", { name: /Save snooze/ }).click();
    await expect(toastTitle(page, "Follow-up snoozed")).toBeVisible();

    await expect(snoozeEntries(page)).toHaveCount(1);
    await expect(contactEntries(page)).toHaveCount(contactsBefore);
    await expect(timeline(page)).toHaveCount(entriesBefore + 1);
    await expect(newestNote(page)).toHaveText("Follow-up snoozed");
  });

  test("Phase 21: a confirmed contact and a later snooze stay two independent events", async ({ page }) => {
    await signIn(page);
    // The previous test's snooze may have taken this invoice out of the Today
    // queue, so the follow-up is opened from the details panel — which always
    // describes the receivable currently selected.
    const followUp = page.getByRole("button", { name: "Follow up", exact: true });
    await expect(followUp).toBeVisible();
    await followUp.click();
    const sheet = page.getByRole("dialog", { name: "Choose the next message" });
    await expect(sheet).toBeVisible();

    const entriesBefore = await timeline(page).count();
    const contactsBefore = await contactEntries(page).count();
    const snoozesBefore = await snoozeEntries(page).count();

    const confirm = contactWrite(page);
    await sheet.getByRole("button", { name: /I sent it/ }).click();
    expect(await confirm, "An explicit confirmation wrote nothing.").not.toBeNull();
    await expect(contactEntries(page)).toHaveCount(contactsBefore + 1);

    await page.locator("button[aria-label='Snooze follow-up']").first().click();
    const snoozeDialog = page.getByRole("dialog", { name: "Snooze follow-up" });
    await snoozeDialog.getByRole("button", { name: /Save snooze/ }).click();
    await expect(toastTitle(page, "Follow-up snoozed")).toBeVisible();

    // Neither event absorbed the other: the pause is last, the contact is still
    // there, and exactly two entries were added for two human decisions.
    await expect(snoozeEntries(page)).toHaveCount(snoozesBefore + 1);
    await expect(contactEntries(page)).toHaveCount(contactsBefore + 1);
    await expect(timeline(page)).toHaveCount(entriesBefore + 2);
    await expect(newestNote(page)).toHaveText("Follow-up snoozed");
  });

  // Phases 48-49 and 64. A follow-up is read on a phone in front of a client and on
  // a laptop at a desk, so the sheet is measured at both. Nothing here presses a
  // confirmation: the layout is judged with the ledger exactly as the earlier
  // journeys left it.
  async function settle(page: Page) {
    await page.evaluate(async () => {
      await Promise.all(Array.from(document.getAnimations()).map((animation) => animation.finished.catch(() => undefined)));
    });
  }

  // A bottom sheet scrolls its own body, so the page behind it is what proves the
  // layout never grew wider than the screen it was given.
  async function sidewaysOverflow(page: Page) {
    await settle(page);
    return page.evaluate(() => {
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
  }

  async function openFollowUpFromDetails(page: Page) {
    const followUp = page.getByRole("button", { name: "Follow up", exact: true });
    await expect(followUp).toBeVisible({ timeout: 20_000 });
    await followUp.click();
    const sheet = page.getByRole("dialog", { name: "Choose the next message" });
    await expect(sheet).toBeVisible();
    await settle(page);
    return sheet;
  }

  function boxOf(rect: { x: number; y: number; width: number; height: number } | null, what: string) {
    expect(rect, `${what} was never laid out`).not.toBeNull();
    return rect as { x: number; y: number; width: number; height: number };
  }

  for (const size of [
    { name: "360×800", width: 360, height: 800 },
    { name: "390×844", width: 390, height: 844 },
  ]) {
    test(`Phase 48: a follow-up is fully usable at ${size.name}`, async ({ page }) => {
      await captureWhatsAppNavigation(page);
      await page.setViewportSize({ width: size.width, height: size.height });
      await signIn(page);
      const sheet = await openFollowUpFromDetails(page);

      const sheetBox = boxOf(await sheet.boundingBox(), "the follow-up sheet");
      expect(sheetBox.width, `the sheet is wider than the screen at ${size.name}`).toBeLessThanOrEqual(size.width);
      expect(sheetBox.height, `the sheet is taller than the screen at ${size.name}`).toBeLessThanOrEqual(size.height);
      const overflow = await sidewaysOverflow(page);
      expect(overflow.offenders, `${size.name} overflowed sideways (${overflow.scrollWidth} against ${overflow.width})`).toEqual([]);

      // Every template has to be readable and tappable, and the mark that says which
      // one was suggested has to travel with it.
      const options = sheet.locator(".template-choice__option");
      await expect(options).toHaveCount(5);
      for (let index = 0; index < 5; index += 1) {
        const option = options.nth(index);
        await option.scrollIntoViewIfNeeded();
        await settle(page);
        await expect(option).toBeInViewport();
        const optionBox = boxOf(await option.boundingBox(), "a template choice");
        expect(optionBox.width).toBeLessThanOrEqual(size.width);
        // Stage 6 fixed the bar this stage measures against: 24×24 CSS pixels, with
        // the wider touch-target audit left to Stage 9.
        expect(Math.min(optionBox.width, optionBox.height), `template ${index} is a ${(Math.min(optionBox.width, optionBox.height)).toFixed(0)}px target`).toBeGreaterThanOrEqual(24);
      }
      // The mark that says which tone was suggested belongs to its own option, so it
      // is read where that option is read.
      const suggestedMark = sheet.locator(".template-choice__suggested");
      await suggestedMark.scrollIntoViewIfNeeded();
      await settle(page);
      await expect(suggestedMark).toBeInViewport();

      const editor = sheet.getByRole("textbox");
      await editor.scrollIntoViewIfNeeded();
      await settle(page);
      await expect(editor).toBeInViewport();
      const editorBox = boxOf(await editor.boundingBox(), "the message editor");
      expect(editorBox.width).toBeLessThanOrEqual(size.width);
      await editor.fill(`a draft typed at ${size.name}`);
      await expect(editor).toHaveValue(`a draft typed at ${size.name}`);

      // The two confirmations are the point of the sheet, so they must not be
      // reachable only by guesswork below the fold.
      const confirm = sheet.getByRole("button", { name: /I sent it/ });
      const other = sheet.getByRole("button", { name: /Contacted some other way/ });
      await confirm.scrollIntoViewIfNeeded();
      await settle(page);
      await expect(confirm).toBeInViewport();
      await expect(other).toBeInViewport();
      const confirmBox = boxOf(await confirm.boundingBox(), "the confirmation");
      expect(Math.min(confirmBox.width, confirmBox.height), "the confirmation is under the 24px bar Stage 6 set").toBeGreaterThanOrEqual(24);

      // Copy and the WhatsApp link live in the sticky footer: they stay on screen
      // however far the body has been scrolled.
      await expect(sheet.getByRole("button", { name: /Copy message/ })).toBeInViewport();
      await expect(sheet.getByRole("link", { name: /WhatsApp/ })).toBeInViewport();

      // Dismissal has to work from wherever the person has got to — by keyboard, and
      // by the gesture a phone actually offers.
      await page.keyboard.press("Escape");
      await expect(sheet).toBeHidden();
      await page.getByRole("button", { name: "Follow up", exact: true }).click();
      await expect(sheet).toBeVisible();
      await settle(page);
      await confirm.scrollIntoViewIfNeeded();
      await settle(page);
      await page.mouse.click(Math.round(size.width / 2), 8);
      await expect(sheet, "tapping the dimmed area above the sheet left it open").toBeHidden();
    });
  }

  for (const size of [
    { name: "1280×800", width: 1280, height: 800 },
    { name: "1440×900", width: 1440, height: 900 },
  ]) {
    test(`Phase 49: a follow-up stays a panel at ${size.name}`, async ({ page }) => {
      await captureWhatsAppNavigation(page);
      await page.setViewportSize({ width: size.width, height: size.height });
      await signIn(page);
      const sheet = await openFollowUpFromDetails(page);
      const writes = contactWrites(page);

      // A drawer, not a wall: it keeps its own measure and stays anchored right.
      const sheetBox = boxOf(await sheet.boundingBox(), "the follow-up sheet");
      expect(sheetBox.width).toBeLessThanOrEqual(560);
      expect(sheetBox.width).toBeGreaterThanOrEqual(400);
      expect(sheetBox.x + sheetBox.width).toBeGreaterThanOrEqual(size.width - 1);
      expect(sheetBox.width, "the sheet took over the desktop").toBeLessThan(size.width * 0.6);

      const editor = sheet.getByRole("textbox");
      const editorBox = boxOf(await editor.boundingBox(), "the message editor");
      expect(editorBox.height, "the message editor is too short to read a message in").toBeGreaterThanOrEqual(120);
      expect(editorBox.width).toBeLessThanOrEqual(sheetBox.width);

      await expect(sheet.getByRole("radiogroup", { name: /message tone/i })).toBeVisible();
      await expect(sheet.locator(".template-choice__option")).toHaveCount(5);
      await expect(sheet.getByText("Suggested", { exact: true })).toBeVisible();

      // The semantics that keep the history honest are on the surface, not behind a
      // hover or a second click.
      const link = sheet.getByRole("link", { name: /WhatsApp/ });
      await expect(link).toBeInViewport();
      await expect(sheet.getByRole("button", { name: /Copy message/ })).toBeInViewport();
      await link.click();
      await expect.poll(() => openedWhatsAppLinks(page)).toHaveLength(1);
      await expect(sheet.getByText(/cannot tell whether you pressed Send/i)).toBeVisible();
      await expect(sheet.getByRole("button", { name: /I sent it/ })).toBeVisible();
      await expect(sheet.getByRole("button", { name: /Contacted some other way/ })).toBeVisible();
      // ... and none of that wrote anything.
      expect(writes, "Opening WhatsApp from the desktop sheet wrote a history event.").toEqual([]);
    });
  }

  test("Phase 64: the keyboard reaches every part of a follow-up", async ({ page }) => {
    await captureWhatsAppNavigation(page);
    await signIn(page);
    const sheet = await openFollowUpFromDetails(page);
    const writes = contactWrites(page);

    // The sheet holds its own focus, so the walk is finite: it stops when a name
    // repeats, which is the trap coming back round to the start.
    const walk: { name: string; marked: boolean }[] = [];
    const seen = new Set<string>();
    for (let step = 0; step < 24; step += 1) {
      const stop = await focusStop(page);
      expect(stop.inSheet, "focus left the sheet before the walk finished").toBe(true);
      expect(stop.name, "a keyboard stop inside the sheet had no name to announce").not.toBe("");
      if (seen.has(stop.name)) break;
      seen.add(stop.name);
      walk.push({ name: stop.name, marked: stop.marked });
      await page.keyboard.press("Tab");
    }

    // The first stop is the control the sheet focused for itself when it opened, and
    // Chrome paints a ring only for focus the keyboard produced. That control is
    // judged in the arrow cycle below, where a key actually reaches it — the same
    // standard the accepted Stage 6 battery applies by measuring stops after a Tab.
    const unmarked = walk.slice(1).filter((stop) => !stop.marked).map((stop) => stop.name);
    expect(unmarked, "a control in keyboard focus carried no visible mark").toEqual([]);

    // Everything a follow-up is made of has to be reachable from the Tab key alone.
    for (const part of ["Message to send", "Reset to suggested", "Copy message", "WhatsApp", "I sent it", "Contacted some other way"]) {
      expect(walk.map((stop) => stop.name).join(" | "), `the Tab key never reached ${part}`).toContain(part);
    }

    // The tone group is one Tab stop, so its five templates are reached with the arrow
    // keys — which is how a keyboard reader chooses a tone. Five presses visit each
    // template once, whichever one the group started on.
    const tones: string[] = [];
    for (let arrow = 0; arrow < 5; arrow += 1) {
      await page.keyboard.press("ArrowDown");
      const stop = await focusStop(page);
      expect(stop.inSheet, `arrowing through the tones sent focus out of the sheet (${stop.name})`).toBe(true);
      expect(stop.marked, `"${stop.name}" was reached with an arrow key but carried no visible mark`).toBe(true);
      tones.push(stop.name);
    }
    for (const tone of ["Friendly reminder", "Overdue reminder", "Broken promise", "Repeated missed promise", "Partial payment"]) {
      expect(tones.join(" | "), `the keyboard never reached the ${tone} template`).toContain(tone);
    }

    // A radio group answers the arrow keys, which is how a keyboard reader changes
    // the tone without hunting for each control.
    const editor = sheet.getByRole("textbox");
    await sheet.getByRole("radio", { name: /^Overdue reminder/ }).focus();
    const before = await editor.inputValue();
    await page.keyboard.press("ArrowDown");
    await expect(sheet.getByRole("radio", { name: /^Broken promise/ })).toBeChecked();
    expect(await editor.inputValue(), "arrowing to another template left the old draft on screen").not.toBe(before);
    expect(writes, "A keyboard tour of the sheet wrote a history event.").toEqual([]);
  });
});
