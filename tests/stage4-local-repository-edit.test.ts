import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { supabase } from "@/lib/supabase";
import { SupabaseClientRepository } from "@/data/supabase-client-repository";
import { SupabaseReceivableRepository } from "@/data/supabase-receivable-repository";

// Stage 4's persistence claim is only worth as much as the path a customer
// actually takes. Every read and write below goes through the same repository
// classes the SPA imports, against the same signed-in client the SPA uses — no
// React state is inspected, and no service-role key is read anywhere in this
// file. A second repository instance is constructed to prove that what it reads
// came from the database rather than from anything the first one remembered.

const url = import.meta.env.VITE_SUPABASE_URL ?? "";
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";
const isLoopbackStack = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d{2,5})?$/i.test(url);
const describeLocalStack = isLoopbackStack && anonKey.length > 0 ? describe : describe.skip;

const runTag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const emailFor = (label: string) => `stage4repo-${label}-${runTag}@dueweave.local`;
const newPassword = () => `Stage4r!${Math.random().toString(36).slice(2, 12)}aA`;

const localDbContainer = process.env.STAGE4_LOCAL_DB_CONTAINER ?? "supabase_db_dueweave";

function localAdmin(sql: string) {
  return String(
    execFileSync("docker", ["exec", "-i", localDbContainer, "psql", "-U", "postgres", "-d", "postgres", "--set=ON_ERROR_STOP=1", "-A", "-t", "-f", "-"], {
      input: sql,
      stdio: ["pipe", "pipe", "pipe"],
    })
  ).trim();
}

const PROTECTED_HISTORY_TRIGGERS: Array<[table: string, trigger: string]> = [
  ["public.activities", "activities_immutable"],
  ["public.payments", "payments_immutable"],
  ["public.promise_events", "promise_events_immutable"],
  ["public.promises", "promises_guard_history"],
];

function purgeLocalFixtures(emailPattern: string) {
  const flip = (verb: string) => PROTECTED_HISTORY_TRIGGERS.map(([table, trigger]) => `  alter table ${table} ${verb} trigger ${trigger};`).join("\n");
  const tables: Array<[string, string]> = [
    ["public.activities", "owner_id"],
    ["public.promise_events", "owner_id"],
    ["public.payments", "owner_id"],
    ["public.promises", "owner_id"],
    ["public.receivables", "owner_id"],
    ["public.clients", "owner_id"],
    ["public.analytics_events", "owner_id"],
    ["public.entitlements", "user_id"],
    ["public.profiles", "id"],
  ];
  const owned = tables.map(([table, column]) => `  delete from ${table} where ${column} in (select id from auth.users where email like '${emailPattern}');`).join("\n");
  return localAdmin(`begin;
${flip("disable")}
${owned}
  delete from auth.users where email like '${emailPattern}';
${flip("enable")}
commit;
select 'residue=' || count(*) from auth.users where email like '${emailPattern}';`);
}

const passwords = new Map<string, string>();

async function signInAs(label: string) {
  await supabase.auth.signOut();
  // Switching accounts on one client is exactly what a person logging out and
  // back in does, so the owner has to be able to re-enter their own session.
  passwords.set(label, passwords.get(label) ?? newPassword());
  const password = passwords.get(label)!;
  const signed = await supabase.auth.signUp({ email: emailFor(label), password, options: { data: { display_name: `Stage 4 repository ${label}` } } });
  if (signed.error) {
    const { data, error } = await supabase.auth.signInWithPassword({ email: emailFor(label), password });
    expect(error ?? null, `local sign-in failed for ${label}`).toBeNull();
    expect(data.session, `local sign-in returned no session for ${label}`).toBeTruthy();
    return;
  }
  expect(signed.data.session, `local signup returned no session for ${label}`).toBeTruthy();
}

function rawToken(label: string, value: string) {
  // The token must survive the round trip byte-for-byte: a value that went
  // through `new Date()` loses its microseconds and would look stale forever.
  expect(value, `${label} lost its raw database timestamp`).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{1,6}\+00:00$/);
  return value;
}

describeLocalStack("Stage 4 persistence through the repository classes", () => {
  const clients = new SupabaseClientRepository();
  let ownedId = "";
  let ownedToken = "";

  beforeAll(async () => {
    await signInAs("owner");
  }, 180_000);

  afterAll(async () => {
    await supabase.auth.signOut();
    const purge = (() => {
      try {
        return purgeLocalFixtures("stage4repo-%@dueweave.local");
      } catch (error) {
        return `purge failed: ${String(error)}`;
      }
    })();
    expect(localAdmin("select count(*) filter (where tgenabled = 'O') || '/' || count(*) from pg_trigger where tgname in ('activities_immutable','payments_immutable','promise_events_immutable','promises_guard_history');")).toBe("4/4");
    if (!/residue=0/.test(purge)) console.warn(`Stage 4 repository fixtures were not fully purged: ${purge}`);
  }, 120_000);

  it("creates a client whose stored row carries a usable concurrency token", async () => {
    const created = await clients.create({ name: "Northwind Trading", company: "Northwind", phone: "919876500001", email: "ap@northwind.example", notes: "Opened by the Stage 4 repository suite." });
    ownedId = created.id;
    ownedToken = rawToken("created client", created.updatedAt);
    expect(created.name).toBe("Northwind Trading");
  });

  it("edits descriptive columns and the stored row moves forward in time", async () => {
    const saved = await clients.update({ id: ownedId, name: "Northwind Trading & Co", company: "Northwind Group", phone: "919876500002", email: "accounts@northwind.example", notes: "Edited through the repository.", expectedUpdatedAt: ownedToken });
    expect(saved.name).toBe("Northwind Trading & Co");
    expect(saved.updatedAt).not.toBe(ownedToken);
    rawToken("edited client", saved.updatedAt);
    ownedToken = saved.updatedAt;
  });

  it("re-reads the edit through a freshly constructed repository instance", async () => {
    const listed = await new SupabaseClientRepository().list();
    const stored = listed.find((row) => row.id === ownedId);
    expect(stored, "the edit is not visible to a new repository instance").toBeTruthy();
    expect(stored!.name).toBe("Northwind Trading & Co");
    expect(stored!.company).toBe("Northwind Group");
    expect(stored!.email).toBe("accounts@northwind.example");
    rawToken("listed client", stored!.updatedAt);
  });

  it("rejects a write that carries a token the row has outgrown", async () => {
    await expect(clients.update({ id: ownedId, name: "Overwritten By A Lost Session", expectedUpdatedAt: "2026-01-01T00:00:00.000000+00:00" })).rejects.toThrow(/changed|session|reopen|latest/i);
    const after = await new SupabaseClientRepository().list();
    expect(after.find((row) => row.id === ownedId)!.name).toBe("Northwind Trading & Co");
  });

  it("keeps receivable details editable and its money immutable", async () => {
    const receivables = new SupabaseReceivableRepository();
    const created = await receivables.createForClient({ clientId: ownedId, label: "Phase one work", invoiceRef: "S4R-1", amountPaise: 4500000, dueDate: "2026-10-15", notes: "Seeded by the repository suite." });
    const edited = await new SupabaseReceivableRepository().updateDetails({ id: created.id, label: "Phase one work (rev 2)", invoiceRef: "S4R-1B", notes: "Edited through the repository.", expectedUpdatedAt: rawToken("created receivable", created.updatedAt) });
    expect(edited.title).toBe("Phase one work (rev 2)");
    expect(edited.invoiceRef).toBe("S4R-1B");
    expect(edited.amountDuePaise).toBe(4500000);
    expect(edited.status).toBe(created.status);
    expect(edited.clientId).toBe(ownedId);
    const stored = (await new SupabaseReceivableRepository().list()).find((row) => row.id === created.id);
    expect(stored!.title).toBe("Phase one work (rev 2)");
    expect(stored!.amountDuePaise).toBe(4500000);
  });

  it("refuses a foreign account through the same repository surface without leaking server detail", async () => {
    await signInAs("stranger");
    const repos = new SupabaseClientRepository();
    expect((await repos.list()).some((row) => row.id === ownedId), "a foreign account read the owner's client").toBe(false);
    const message = await repos.update({ id: ownedId, name: "Stolen Ledger", expectedUpdatedAt: ownedToken }).then(() => null, (error: unknown) => String(error));
    expect(message, "a foreign account edited the owner's client").toMatch(/no longer available|not available|could not/i);
    expect(message).not.toMatch(/permission denied|row-level security|SQLSTATE|42501|P0002|PGRST|does not exist|constraint/i);
  });

  it("leaves the owner's stored client untouched after the stranger was refused", async () => {
    await signInAs("owner");
    const stored = (await new SupabaseClientRepository().list()).find((row) => row.id === ownedId);
    expect(stored!.name).toBe("Northwind Trading & Co");
  });
});
