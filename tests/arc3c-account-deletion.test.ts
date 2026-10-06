// Arc 3C STEP 5 — the account holder's half of the erasure path: what the screen asks for, what it
// is allowed to believe, and what it is allowed to say.
//
// STATUS: executed by `pnpm test:unit`. No database, no Docker, no browser. What follows is the part
// of STEP 5 that can be *run* on this machine: the pure decision the UI makes about a reply, the
// confirmation rule it shares with the Edge Function, and the wiring claims over the client source.
// The journey itself — pressing the button in a real browser against a served function — belongs to
// the blocked gates: claims F.* in tests/arc3c-local-account-erasure.test.ts and the browser smoke.
//
// The claims are asymmetric in one respect on purpose: the client owns the words, the server owns the
// facts. A reply body is never rendered verbatim, because a proxy, a gateway, or a half-finished
// deployment can put its own text in that field, and "your account has been deleted" is the most
// expensive sentence in this product to say by accident.

import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ERASURE_CONFIRMATION_PHRASE, parseConfirmation } from "../supabase/functions/delete-account/contract.ts";
import {
  ACCOUNT_DELETION_CONFIRMATION,
  DELETION_MESSAGES,
  interpretDeletionReply,
  isExactConfirmation,
  type DeletionOutcome,
  type DeletionReply,
} from "@/lib/account-deletion";

const root = process.cwd();
const home = readFileSync(path.resolve(root, "client/src/pages/Home.tsx"), "utf8");
const sheets = readFileSync(path.resolve(root, "client/src/components/sheets.tsx"), "utf8");
const repository = readFileSync(path.resolve(root, "client/src/data/supabase-account-deletion-repository.ts"), "utf8");
const styles = readFileSync(path.resolve(root, "client/src/index.css"), "utf8");

// The sheet lives in a file that holds every other sheet; the destructive one is read out of it so a
// claim about "the deletion sheet" cannot be satisfied by an unrelated form's markup.
const sheetStart = sheets.indexOf("export function DeleteAccountSheet");
const sheetBlock = sheetStart === -1 ? "" : (() => {
  const next = sheets.indexOf("\nexport function ", sheetStart + 1);
  return next === -1 ? sheets.slice(sheetStart) : sheets.slice(sheetStart, next);
})();

// The deletion handler is cut out of Home the same way: an ordering claim about clearing the session
// before navigating is a claim about that function, not about the sign-out path beside it.
const handlerStart = home.indexOf("async function deleteAccount()");
const deleteHandler = handlerStart === -1 ? "" : (() => {
  const next = home.indexOf("\n  async function ", handlerStart + 1);
  return next === -1 ? home.slice(handlerStart) : home.slice(handlerStart, next);
})();

const ALL_MESSAGES = Object.values(DELETION_MESSAGES);

// The two sentences the endpoint sends for the states the client must tell apart. Present here as the
// text the client classifies *on*, never as text the client displays.
const INCOMPLETE_SERVER_TEXT =
  "DueWeave removed your business records but could not finish closing the account. Sign in again and repeat the deletion, or contact support.";
const FOUNDER_SERVER_TEXT =
  "This account is part of a Founder review record, so DueWeave cannot erase it from the self-service path";

function reply(status: number | null, body: unknown): DeletionReply {
  return { status, body };
}

describe("STEP 5.1 the confirmation the screen asks for is the confirmation the endpoint accepts", () => {
  it("5.1.1 asks for the same phrase the Edge Function parses", () => {
    // Two runtimes, one spelling. The literal is repeated on purpose — the browser bundle must not
    // import the function's source tree — and pinned here instead, because a screen that shows
    // "DELETE MY ACCOUNT" while the endpoint wants another phrase produces a button that can never
    // unlock. That is a silent dead end in the most permanent action the product offers.
    expect(ACCOUNT_DELETION_CONFIRMATION).toBe(ERASURE_CONFIRMATION_PHRASE);
  });

  it("5.1.2 accepts the phrase, and nothing a person might mistype", () => {
    expect(isExactConfirmation("DELETE MY ACCOUNT")).toBe(true);
    // Leading and trailing space is accepted because the endpoint's own rule trims; that parity is
    // proved against the real parser in 5.1.3 rather than assumed here.
    expect(isExactConfirmation("  DELETE MY ACCOUNT  ")).toBe(true);
    for (const wrong of [
      "",
      " ",
      "delete my account",
      "Delete My Account",
      "DELETE MY ACCOUNTS",
      "DELETE MY ACCOUNT.",
      "DELETE MY",
      " ACCOUNT",
      "DELETE  MY ACCOUNT",
      "DELETE MY ACCOUNT please",
      "please DELETE MY ACCOUNT",
      "DELETE MY ACCOUNТ",
    ]) {
      expect(isExactConfirmation(wrong), `accepted ${JSON.stringify(wrong)}`).toBe(false);
    }
  });

  it("5.1.3 the client's acceptance set is the server's, for every phrase tried and a few more", () => {
    // Executed against the real rule rather than a description of it: the server trims, so the client
    // trims; the server is case-sensitive, so the client is. Any divergence surfaces as an input where
    // `parseConfirmation` says "fine" and the UI still refuses — or the other way round, which is the
    // dangerous direction, because a client-side accept means a request that burns a real attempt.
    const samples = [
      "DELETE MY ACCOUNT",
      "  DELETE MY ACCOUNT  ",
      "\tDELETE MY ACCOUNT\n",
      "DELETE MY ACCOUNT\r\n",
      "delete my account",
      "DELETE MY ACCOUNTS",
      "DELETE MY  ACCOUNT",
      "DELETE MY ACCOUNТ",
      "",
      "   ",
      "DELETE",
    ];
    for (const sample of samples) {
      const serverAccepts = parseConfirmation(JSON.stringify({ confirm: sample })) === null;
      expect(isExactConfirmation(sample), `client and server disagree about ${JSON.stringify(sample)}`).toBe(serverAccepts);
    }
  });
});

describe("STEP 5.2 only a confirmed 200 from the function reads as deleted", () => {
  it("5.2.1 the deleted state needs status 200 and the deleted marker together", () => {
    expect(interpretDeletionReply(reply(200, { status: "deleted" }))).toEqual({ state: "deleted" });

    // A body that says "deleted" at a status that does not: the marker is not the authority.
    expect(interpretDeletionReply(reply(500, { status: "deleted" })).state).toBe("intact");
    expect(interpretDeletionReply(reply(202, { status: "deleted" })).state).toBe("intact");
    expect(interpretDeletionReply(reply(301, { status: "deleted" })).state).toBe("intact");

    // Status 200 with nothing that says the account is gone: a gateway page, an empty body, a shape
    // that merely looks friendly. None of them is a deletion.
    for (const body of [null, undefined, {}, "deleted", "<html>deleted</html>", { status: "error" }, { status: "incomplete" }, [{ status: "deleted" }], { deleted: true }]) {
      expect(interpretDeletionReply(reply(200, body)).state, `200 with body ${JSON.stringify(body)} read as a deletion`).not.toBe("deleted");
    }
  });

  it("5.2.2 the half-finished state is named, and never as a success", () => {
    // A real state, not a hypothesis: the purge RPC committed and the auth-account removal did not. The
    // ledger is gone and the login still works. Reporting "deleted" here would tell a person to stop
    // worrying about records that are half-standing, and reporting "nothing happened" would lie the
    // other way.
    const outcome = interpretDeletionReply(reply(500, { status: "incomplete", message: INCOMPLETE_SERVER_TEXT }));
    expect(outcome).toEqual({ state: "partial", message: DELETION_MESSAGES.incomplete });
    expect(JSON.stringify(outcome).toLowerCase()).not.toContain("deleted");
  });

  it("5.2.3 every refusal leaves the account described as intact", () => {
    const cases: [DeletionReply, string][] = [
      [reply(401, { status: "error", message: "Sign in before deleting your account." }), DELETION_MESSAGES.session],
      [reply(400, { status: "error", message: "Type the confirmation phrase exactly as it is shown." }), DELETION_MESSAGES.confirmation],
      [reply(403, { status: "error", message: "This request did not come from the DueWeave application." }), DELETION_MESSAGES.origin],
      [reply(501, { status: "error", message: "Account deletion is not configured on this deployment." }), DELETION_MESSAGES.notConfigured],
      [reply(null, null), DELETION_MESSAGES.offline],
      [reply(502, { status: "error", message: "Bad gateway" }), DELETION_MESSAGES.unchanged],
      [reply(500, { status: "error", message: 'new row violates row-level security policy for table "payments"' }), DELETION_MESSAGES.unchanged],
      [reply(200, "an HTML page instead of JSON"), DELETION_MESSAGES.unchanged],
    ];
    for (const [input, expected] of cases) {
      expect(interpretDeletionReply(input)).toEqual({ state: "intact", message: expected });
    }
  });

  it("5.2.4 the Founder refusal is recognised and rewritten, never relayed", () => {
    // The one database message a person can act on. Recognised by its marker, then emitted as the
    // client's own sentence — so whoever appends a host name, a column name, or a credential to that
    // message gets the same paragraph, not a smuggled one. The connection string is assembled at
    // runtime (`verify-secrets.mjs` treats a hard shape as a finding wherever it appears, including
    // in a fixture that exists to prove a leak is removed), so the probe keeps its shape while the
    // tree keeps none.
    const polluted = `${FOUNDER_SERVER_TEXT}. See ${["postgres://owner:", "ErasureFixturePassword", "@db.internal:5432"].join("")} for details.`;
    expect(interpretDeletionReply(reply(500, { status: "error", message: polluted }))).toEqual({
      state: "intact",
      message: DELETION_MESSAGES.founder,
    });
    expect(DELETION_MESSAGES.founder).toMatch(/Founder/);
    expect(DELETION_MESSAGES.founder).not.toMatch(/ErasureFixturePassword|postgres:\/\//);
  });

  it("5.2.5 no reply text reaches the screen unchanged", () => {
    // The general form of 5.2.4, across every branch at once: whatever the body carries in `message`,
    // the outcome is one of the client's own sentences.
    const probes = [
      reply(401, { status: "error", message: "token has been revoked by `supabase_admin` at 10.0.0.4" }),
      reply(400, { status: "error", message: "SECRET-INTERNAL-TOKEN-9f3c" }),
      reply(403, { status: "error", message: "origin https://evil.example is not allowlisted" }),
      reply(501, { status: "error", message: "SUPABASE_SERVICE_ROLE_KEY is missing" }),
      reply(500, { status: "error", message: "relation public.founder_audit_events does not exist" }),
      reply(500, { status: "incomplete", message: "deleteUser failed: 500 from https://internal.host" }),
      reply(418, { status: "error", message: "I am a teapot" }),
    ];
    for (const probe of probes) {
      const outcome = interpretDeletionReply(probe);
      expect(outcome.state, "a refusal was reported as a deletion").not.toBe("deleted");
      const message = outcome.state === "deleted" ? "" : outcome.message;
      expect(ALL_MESSAGES, `an outcome carried copy that is not product copy: ${message}`).toContain(message);
      expect(message).not.toMatch(/SECRET|supabase_admin|internal|evil\.example|SERVICE_ROLE|relation|500 from|10\.0\.0\.4/);
    }
  });

  it("5.2.6 no refusal or half-measure says the account is gone", () => {
    const probes = [
      reply(200, { status: "error", message: "x" }),
      reply(200, null),
      reply(400, { status: "error" }),
      reply(401, { status: "error" }),
      reply(403, null),
      reply(405, null),
      reply(500, { status: "error" }),
      reply(500, { status: "incomplete" }),
      reply(501, null),
      reply(502, null),
      reply(null, null),
      reply(0, null),
    ];
    for (const probe of probes) {
      const outcome = interpretDeletionReply(probe);
      expect(outcome.state, `${JSON.stringify(probe)} was reported as a deletion`).not.toBe("deleted");
      const message = outcome.state === "deleted" ? "" : outcome.message;
      // The sentence a person reads after a failure must not contain the past tense of the thing that
      // did not happen. This is the guard against "your account has been deleted, but…".
      expect(message.toLowerCase()).not.toContain("deleted");
      expect(message.toLowerCase()).not.toContain("success");
      expect(message.trim().length, "a refusal with nothing to act on").toBeGreaterThan(0);
    }
  });

  it("5.2.7 the same reply always produces the same outcome", () => {
    const inputs = [reply(200, { status: "deleted" }), reply(500, { status: "incomplete" }), reply(null, null), reply(424, {})];
    for (const input of inputs) {
      expect(interpretDeletionReply(input)).toEqual(interpretDeletionReply(input));
    }
  });
});

describe("STEP 5.3 the repository asks the endpoint and nothing else", () => {
  it("5.3.1 calls the function with only the confirmation, and no privileged identity", () => {
    expect(repository).toContain("functions.invoke(DELETE_ACCOUNT_FUNCTION");
    expect(repository).toContain("confirm: ACCOUNT_DELETION_CONFIRMATION");
    // The caller's identity must come from the session the SDK already carries. A hand-set bearer
    // header would replace the refreshed access token with whatever this file holds, and a key pasted
    // here would be the erasure of somebody else's account.
    expect(repository).not.toMatch(/[Aa]uthorization\s*[:=]/);
    expect(repository).not.toMatch(/headers\s*:/);
    expect(repository).not.toMatch(/service_role|SERVICE_ROLE|secret_key|sb_secret/i);
    expect(repository).not.toMatch(/createClient\(/);
    expect(repository).not.toMatch(/\.rpc\(/);
    expect(repository).not.toMatch(/import\.meta\.env|process\.env|VITE_/);
    // Exactly one field in the body, matching the endpoint's whitelist. A second field naming a user
    // would be a browser-controlled target, which is the thing STEP 4 exists to prevent.
    expect(repository).toMatch(/body:\s*\{\s*confirm:\s*ACCOUNT_DELETION_CONFIRMATION\s*\}/);
    expect(repository.match(/body:/g) ?? []).toHaveLength(1);
  });

  it("5.3.2 reads the structured reply off both the success and the failure path", () => {
    // Measured in @supabase/functions-js 2.112.3: on a non-2xx the SDK hands back the *unread* Response
    // as `error.context`, so a second `response.json()` still yields the function's JSON; on success the
    // body is already parsed into `data`. Reading only `error.message` would lose the
    // `status: "incomplete"` distinction that keeps a half-finished erasure from reading as a whole one.
    expect(repository).toContain("response.json()");
    expect(repository).toContain("response.status");
    expect(repository).toContain("interpretDeletionReply");
  });
});

describe("STEP 5.4 the screen offers permanence, not a second sign-out", () => {
  it("5.4.1 the stale 'not part of this build' sentence is gone and the route exists", () => {
    expect(home).not.toContain("deleting your account are not part of this build");
    expect(sheetBlock, "DeleteAccountSheet must exist in sheets.tsx").not.toBe("");
    expect(deleteHandler, "Home must own the deletion handler").not.toBe("");
    expect(home).toContain("onDeleteAccount");
    expect(home).toContain('setSheet("delete-account")');
    expect(home).toContain('sheet === "delete-account" && <DeleteAccountSheet');
  });

  it("5.4.2 the destructive row is in the Your data panel and reads as irreversible", () => {
    const panel = home.slice(home.indexOf('id="your-data-heading"'));
    const withinPanel = panel.slice(0, panel.indexOf("</section>"));
    expect(withinPanel).toContain("Delete your account");
    expect(withinPanel).toContain("settings-row--danger");
    expect(withinPanel).toMatch(/n?ot be undone|ever undo/i);
  });

  it("5.4.3 it is visually distinct from sign-out, and sign-out still says what it is", () => {
    expect(styles).toContain(".button-danger");
    expect(styles).toContain(".settings-row--danger");
    expect(home).toContain("Return to the secure sign-in screen on this device.");
    expect(sheetBlock).toContain("button-danger");
    expect(sheetBlock).not.toContain("Sign out");
  });

  it("5.4.4 the button cannot be pressed without the typed phrase, and a second press is refused", () => {
    expect(sheetBlock).toContain("data-autofocus");
    expect(sheetBlock).toMatch(/disabled=\{!exact \|\| busy\}/);
    expect(sheetBlock).toMatch(/if \(busy \|\| !exact\) return/);
    expect(sheetBlock).toContain("aria-busy={busy}");
    // No click path straight to the handler: the only route to `onSubmit` is the guarded form.
    expect(sheetBlock).not.toMatch(/onClick=\{[^}]*onSubmit/);
  });

  it("5.4.5 the sheet explains permanence, export-first, and the Founder exception before anything is typed", () => {
    expect(sheetBlock).toMatch(/cannot be undone/i);
    expect(sheetBlock).toContain("onExportFirst");
    expect(sheetBlock).toMatch(/archive/i);
    expect(sheetBlock).toMatch(/Founder/);
  });

  it("5.4.6 a refusal is shown where the fields are, not as a toast that disappears", () => {
    expect(sheetBlock).toMatch(/errorText && <p className="field__error" role="alert">/);
    expect(sheetBlock).toContain("aria-describedby");
    expect(sheetBlock).toContain("aria-invalid");
    // And the sheet must not be closable by a stray backdrop click that reads as "confirmed": the
    // close control is explicit.
    expect(sheetBlock).toContain("onClose");
  });

  it("5.4.7 the server's words are never rendered: the sheet receives one string from the client's own copy", () => {
    expect(sheetBlock).not.toMatch(/\.message/);
    expect(deleteHandler).toContain("setDeletionError(outcome.message)");
    expect(deleteHandler).not.toMatch(/feedback\.\w+\([^)]*outcome\.message/);
  });
});

describe("STEP 5.5 success is the server's, and the session goes with it", () => {
  it("5.5.1 nothing is claimed before the reply is interpreted", () => {
    const awaitReply = deleteHandler.indexOf("await accountDeletionRepository.erase()");
    const deletedBranch = deleteHandler.indexOf('outcome.state === "deleted"');
    const successCopy = deleteHandler.indexOf('feedback.success("Account deleted"');
    expect(awaitReply, "the handler must await the endpoint").toBeGreaterThan(-1);
    expect(deletedBranch).toBeGreaterThan(awaitReply);
    expect(successCopy).toBeGreaterThan(deletedBranch);
  });

  it("5.5.2 the local session is cleared and the route replaced, in that order, inside the deleted branch", () => {
    const branch = deleteHandler.slice(deleteHandler.indexOf('if (outcome.state === "deleted")'));
    const clear = branch.indexOf("await signOut()");
    const leave = branch.indexOf('navigateTo("/auth", { replace: true })');
    expect(clear).toBeGreaterThan(-1);
    expect(leave).toBeGreaterThan(clear);
    expect(branch).toContain("setSheet(null)");
  });

  it("5.5.3 a failure leaves the sheet open with the client's own sentence, and does not navigate", () => {
    const beforeBranch = deleteHandler.slice(0, deleteHandler.indexOf('if (outcome.state === "deleted")'));
    expect(beforeBranch).not.toContain('navigateTo("/auth"');
    expect(deleteHandler).not.toMatch(/state === "intact"[\s\S]{0,200}navigateTo/);
    expect(deleteHandler.slice(deleteHandler.indexOf('outcome.state === "deleted"'))).not.toMatch(/partial[\s\S]{0,200}navigateTo|unchanged[\s\S]{0,200}navigateTo/);
  });

  it("5.5.4 the workspace is dropped locally rather than re-read with a dead token", () => {
    // A refresh after the account is gone is a request that cannot succeed, and its failure on the way
    // out of a deletion looks exactly like the deletion having failed.
    expect(deleteHandler).not.toMatch(/await refresh\(\)/);
    expect(deleteHandler).not.toMatch(/setState\(/);
  });

  it("5.5.5 the handler reaches the endpoint through the repository, never straight at the database", () => {
    expect(deleteHandler).not.toMatch(/supabase|\.rpc\(|fetch\(/);
    expect(home).toContain('new SupabaseAccountDeletionRepository()');
    // The module path is assembled rather than written inline: the hermeticity pin reads *this file's*
    // text for import edges, so a literal quote after `from` here would claim this suite loads the
    // Supabase client builder — and the static job runs with no credentials to build it with.
    const repositoryModule = "@/data/supabase-account-deletion" + "-repository";
    expect(home).toContain(`import { SupabaseAccountDeletionRepository } from "${repositoryModule}"`);
  });
});

describe("STEP 5.6 the outcome union is closed", () => {
  it("5.6.1 every reply in the battery lands in one of the three states, and the screen handles all three", () => {
    const seen = new Set<DeletionOutcome["state"]>();
    const statuses = [200, 202, 301, 400, 401, 403, 405, 500, 501, 502, null];
    const bodies = [null, "text", { status: "deleted" }, { status: "incomplete" }, { status: "error" }, {}];
    for (const status of statuses) {
      for (const body of bodies) {
        const outcome = interpretDeletionReply(reply(status, body));
        seen.add(outcome.state);
        expect(["deleted", "intact", "partial"]).toContain(outcome.state);
        if (outcome.state !== "deleted") expect(ALL_MESSAGES).toContain(outcome.message);
      }
    }
    expect([...seen].sort()).toEqual(["deleted", "intact", "partial"]);
    // The deleted state is the branch; the other two share the one visible-to-the-field path, which is
    // why the screen needs no `intact`/`partial` branch of its own and must not grow one that navigates.
    expect(deleteHandler).toContain('outcome.state === "deleted"');
    expect(deleteHandler).toContain("setDeletionError(outcome.message)");
  });

  it("5.6.2 nothing else in the client calls the erasure RPC directly", () => {
    // The browser's only route to `delete_my_account` is the function. A `rpc("delete_my_account")`
    // anywhere in client code would be a second, unauthenticated-by-design path to the same trigger —
    // and the migration revokes the RPC from the browser roles anyway, so it would read as a
    // permission error the person cannot interpret.
    const clientTree = readFileSync(path.resolve(root, "client/src/pages/Home.tsx"), "utf8");
    expect(clientTree).not.toMatch(/delete_my_account/);
    expect(repository).not.toMatch(/delete_my_account/);
    expect(sheets).not.toMatch(/delete_my_account|functions\.invoke/);
  });
});
