import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { supabase } from "@/lib/supabase";
import { SupabaseProfileRepository } from "@/data/supabase-profile-repository";
import { isWorkspaceSetupComplete } from "@/lib/profile";

// Stage 6's whole first-user story rests on one row: the signed-in owner's
// `profiles` record. This suite exercises the real repository class the SPA
// imports, against the real authenticated PostgREST path — no service-role key,
// no React state, and no hand-written SQL that could grant an authority the
// browser does not have. Cross-owner expectations are proven with a second
// genuine session, because RLS is the only thing standing between two ledgers.

const url = import.meta.env.VITE_SUPABASE_URL ?? "";
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY ?? "";
const isLoopbackStack = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d{2,5})?$/i.test(url);
const describeLocalStack = isLoopbackStack && anonKey.length > 0 ? describe : describe.skip;

const runTag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const emailFor = (label: string) => `stage6profile-${label}-${runTag}@dueweave.local`;
const newPassword = () => `Stage6p!${Math.random().toString(36).slice(2, 12)}aA`;

const localDbContainer = process.env.STAGE6_LOCAL_DB_CONTAINER ?? "supabase_db_dueweave";

function localAdmin(sql: string) {
  return String(
    execFileSync("docker", ["exec", "-i", localDbContainer, "psql", "-U", "postgres", "-d", "postgres", "--set=ON_ERROR_STOP=1", "-A", "-t", "-f", "-"], {
      input: sql,
      stdio: ["pipe", "pipe", "pipe"],
    })
  ).trim();
}

// Fixture cleanup only: the accounts this file signed up and their profile rows.
// `on delete cascade` from auth.users already covers profiles, so no table is
// emptied, no policy is touched, and no ledger row of any other suite is in range.
function purgeStage6Fixtures(emailPattern: string) {
  return localAdmin(`delete from auth.users where email like '${emailPattern}';
select 'residue=' || count(*) from auth.users where email like '${emailPattern}';`);
}

const passwords = new Map<string, string>();
let currentUserId = "";

async function signInAs(label: string) {
  await supabase.auth.signOut();
  passwords.set(label, passwords.get(label) ?? newPassword());
  const password = passwords.get(label)!;
  const signed = await supabase.auth.signUp({ email: emailFor(label), password, options: { data: { display_name: `Stage 6 profile ${label}` } } });
  if (signed.error) {
    const { data, error } = await supabase.auth.signInWithPassword({ email: emailFor(label), password });
    expect(error ?? null, `local sign-in failed for ${label}`).toBeNull();
    expect(data.session, `local sign-in returned no session for ${label}`).toBeTruthy();
    currentUserId = data.user!.id;
    return;
  }
  expect(signed.data.session, `local signup returned no session for ${label}`).toBeTruthy();
  currentUserId = signed.data.user!.id;
}

async function rawProfile(ownerId: string) {
  const { data, error } = await supabase.from("profiles").select("id, display_name, business_name, plan, timezone, currency, updated_at").eq("id", ownerId).single();
  expect(error ?? null, "the owner must be able to read their own profile row").toBeNull();
  return data!;
}

describeLocalStack("Stage 6 profile repository against the live local database", () => {
  const repository = new SupabaseProfileRepository();

  beforeAll(async () => {
    await signInAs("owner");
  }, 180_000);

  afterAll(async () => {
    await supabase.auth.signOut();
    try {
      const purge = purgeStage6Fixtures("stage6profile-%@dueweave.local");
      if (!/residue=0/.test(purge)) console.warn(`Stage 6 profile fixtures were not fully purged: ${purge}`);
    } catch (error) {
      console.warn(`Stage 6 profile fixture purge failed: ${String(error)}`);
    }
  });

  it("reads the signed-in owner's own RLS-protected row", async () => {
    const profile = await repository.read(currentUserId);
    expect(profile).not.toBeNull();
    expect(profile!.id).toBe(currentUserId);
    // The signup trigger seeds display_name from Auth metadata and leaves the
    // workspace unnamed, which is precisely the state onboarding exists to end.
    expect(profile!.displayName).toBe(`Stage 6 profile owner`);
    expect(profile!.businessName).toBe("");
    expect(profile!.timezone).toBe("Asia/Kolkata");
    expect(profile!.currency).toBe("INR");
    expect(profile!.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{1,6}\+00:00$/);
  });

  it("reports a freshly signed-up workspace as needing setup, from the database alone", async () => {
    const profile = await repository.read(currentUserId);
    expect(isWorkspaceSetupComplete(profile)).toBe(false);
  });

  it("saves only the two editable names and proves they came back from the database", async () => {
    const before = await repository.read(currentUserId);
    const saved = await repository.updateWorkspace({ ownerId: currentUserId, displayName: "Asha Menon", businessName: "Northwind Studio", expectedUpdatedAt: before!.updatedAt });

    expect(saved.displayName).toBe("Asha Menon");
    expect(saved.businessName).toBe("Northwind Studio");

    // A second repository instance must see the same thing: the proof is the row
    // on the server, not anything this process remembered.
    const reader = new SupabaseProfileRepository();
    const reread = await reader.read(currentUserId);
    expect(reread!.displayName).toBe("Asha Menon");
    expect(reread!.businessName).toBe("Northwind Studio");
    expect(isWorkspaceSetupComplete(reread)).toBe(true);
  });

  it("leaves plan, timezone and currency exactly as the database holds them", async () => {
    const row = await rawProfile(currentUserId);
    expect(row.plan).toBe("FREE");
    expect(row.timezone).toBe("Asia/Kolkata");
    expect(row.currency).toBe("INR");
  });

  it("bumps the concurrency token so the same save cannot be replayed blindly", async () => {
    const first = await repository.read(currentUserId);
    const second = await repository.updateWorkspace({ ownerId: currentUserId, displayName: "Asha Menon", businessName: "Northwind Studio II", expectedUpdatedAt: first!.updatedAt });
    expect(second.businessName).toBe("Northwind Studio II");
    expect(second.updatedAt).not.toBe(first!.updatedAt);
  });

  it("refuses a stale token with a calm message instead of overwriting the newer save", async () => {
    const staleToken = (await rawProfile(currentUserId)).updated_at as string;
    await repository.updateWorkspace({ ownerId: currentUserId, displayName: "Asha Menon", businessName: "Northwind Studio III", expectedUpdatedAt: staleToken });
    // The row has moved on since that token, so a second write carrying it must lose.
    await expect(repository.updateWorkspace({ ownerId: currentUserId, displayName: "Someone Else", businessName: "Overwritten Studio", expectedUpdatedAt: staleToken })).rejects.toThrow(/changed while you were editing/i);

    const row = await rawProfile(currentUserId);
    expect(row.business_name).toBe("Northwind Studio III");
  });

  it("refuses to save a blank name before the write reaches the database", async () => {
    const current = await repository.read(currentUserId);
    await expect(repository.updateWorkspace({ ownerId: currentUserId, displayName: "   ", businessName: "Blank Probe", expectedUpdatedAt: current!.updatedAt })).rejects.toThrow(/your name/i);
    await expect(repository.updateWorkspace({ ownerId: currentUserId, displayName: "Asha Menon", businessName: "  ", expectedUpdatedAt: current!.updatedAt })).rejects.toThrow(/business or workspace name/i);
    const row = await rawProfile(currentUserId);
    expect(row.business_name).toBe("Northwind Studio III");
  });

  it("refuses a business name longer than the real database CHECK allows", async () => {
    const current = await repository.read(currentUserId);
    await expect(repository.updateWorkspace({ ownerId: currentUserId, displayName: "Asha Menon", businessName: "x".repeat(161), expectedUpdatedAt: current!.updatedAt })).rejects.toThrow(/160 characters/i);
    const row = await rawProfile(currentUserId);
    expect(row.business_name).toBe("Northwind Studio III");
  });

  it("trims what it stores so the ledger never holds a name padded with spaces", async () => {
    const current = await repository.read(currentUserId);
    const saved = await repository.updateWorkspace({ ownerId: currentUserId, displayName: "  Asha Menon  ", businessName: "  Northwind Studio  ", expectedUpdatedAt: current!.updatedAt });
    expect(saved.displayName).toBe("Asha Menon");
    expect(saved.businessName).toBe("Northwind Studio");
  });

  it("sends only the two editable columns in its update payload", async () => {
    // The narrow shape has to be provable, not promised: the payload literal is
    // read off the source the SPA actually ships, so a future column added here
    // fails this instead of quietly widening what a browser may write.
    const source = readFileSync(path.resolve(process.cwd(), "client/src/data/supabase-profile-repository.ts"), "utf8");
    const call = source.match(/\.update\(\{([\s\S]*?)\}\)/);
    expect(call, "the profile repository must update with a literal payload").not.toBeNull();
    expect([...call![1].matchAll(/(\w+):/g)].map((match) => match[1]).sort()).toEqual(["business_name", "display_name"]);

    const current = await repository.read(currentUserId);
    await expect(repository.updateWorkspace({ ownerId: currentUserId, displayName: "Asha Menon", businessName: "Northwind Studio IV", expectedUpdatedAt: current!.updatedAt })).resolves.toMatchObject({ businessName: "Northwind Studio IV" });
  });

  it("refuses a session that aims at the columns the ledger is built on", async () => {
    // Settings offers two editable names, and the repository sends only those. That
    // is the polite half of the guarantee. The half that matters is what the
    // database answers when a hand-made request aims at the columns a first user
    // must never move, so each write below is sent from this real session and the
    // row is re-read afterwards.
    const plan = await supabase.from("profiles").update({ plan: "FOUNDER" }).eq("id", currentUserId);
    const calendar = await supabase.from("profiles").update({ timezone: "UTC" }).eq("id", currentUserId);
    const money = await supabase.from("profiles").update({ currency: "USD" }).eq("id", currentUserId);
    const identity = await supabase.from("profiles").update({ id: "00000000-0000-0000-0000-000000000000" }).eq("id", currentUserId);

    for (const [column, result] of [["plan", plan], ["timezone", calendar], ["currency", money], ["id", identity]] as const) {
      expect(result.error, `a signed-in owner must not be able to write ${column}`).not.toBeNull();
    }

    const row = await rawProfile(currentUserId);
    expect({ id: row.id, plan: row.plan, timezone: row.timezone, currency: row.currency }).toEqual({ id: currentUserId, plan: "FREE", timezone: "Asia/Kolkata", currency: "INR" });
  });

  it("hides one owner's profile from another owner's session", async () => {
    const ownerRow = await rawProfile(currentUserId);
    const ownerId = currentUserId;
    await signInAs("intruder");
    const intruderView = await repository.read(ownerId);
    expect(intruderView).toBeNull();

    await expect(repository.updateWorkspace({ ownerId, displayName: "Intruder", businessName: "Stolen Studio", expectedUpdatedAt: ownerRow.updated_at as string })).rejects.toThrow();

    // Not merely the repository being careful: a write aimed straight at the other
    // owner's id from this session touches no row at all.
    const aimed = await supabase.from("profiles").update({ display_name: "Intruder", business_name: "Stolen Studio" }).eq("id", ownerId).select("id");
    expect(aimed.error ?? null, "the other owner's row is invisible, not merely unwritable").toBeNull();
    expect(aimed.data ?? []).toEqual([]);

    await signInAs("owner");
    const after = await rawProfile(ownerId);
    expect(after.business_name).toBe("Northwind Studio IV");
    expect(after.display_name).toBe("Asha Menon");
  });

  it("returns a user-facing message rather than a database code when the session is gone", async () => {
    await supabase.auth.signOut();
    await expect(repository.read(currentUserId)).rejects.toThrow(/sign in again/i);
  });
});
