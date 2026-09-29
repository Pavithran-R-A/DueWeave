import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

const url = process.env.VITE_SUPABASE_URL ?? "";
const anonKey = process.env.VITE_SUPABASE_ANON_KEY ?? "";

// Only ever run against the repository's own local Docker stack. CI has no
// Supabase environment configured, so the whole suite reports as skipped there.
const isLoopbackStack = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d{2,5})?$/i.test(url);
const describeLocalStack = isLoopbackStack && anonKey.length > 0 ? describe : describe.skip;

const ownerEmail = `stage2-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}@dueweave.local`;
const ownerPassword = `stage2-local-${Math.random().toString(36).slice(2, 12)}!aA`;
const ownerDisplayName = "Stage 2 Fixture Owner";
const businessName = "Stage 2 Local Verification";

function newClient(access_token?: string) {
  return createClient(url, anonKey, {
    global: access_token ? { headers: { Authorization: `Bearer ${access_token}` } } : undefined,
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

type Fixture = {
  userId: string;
  accessToken: string;
  client: SupabaseClient;
  profileId?: string;
  clientId?: string;
};

const fixture: Partial<Fixture> = {};

describeLocalStack("Stage 2 local foundation: auth, profile, and data contracts", () => {
  it("signs a fresh synthetic user up against local Auth", async () => {
    const anonymous = newClient();
    const { data, error } = await anonymous.auth.signUp({
      email: ownerEmail,
      password: ownerPassword,
      options: { data: { display_name: ownerDisplayName } },
    });
    expect(error).toBeNull();
    expect(data.user?.id).toBeTruthy();
    expect(data.session?.access_token).toBeTruthy();
    fixture.userId = data.user!.id;
    fixture.accessToken = data.session!.access_token;
    fixture.client = newClient(data.session!.access_token);
  });

  it("auto-provisions a public.profiles row owned by the Auth user", async () => {
    const { data, error } = await fixture.client!.from("profiles").select("*").eq("id", fixture.userId!).maybeSingle();
    expect(error).toBeNull();
    expect(data).not.toBeNull();
    expect(data!.id).toBe(fixture.userId!);
    fixture.profileId = data!.id;
  });

  it("carries signup display name and Stage 2 business defaults onto the profile", async () => {
    const { data } = await fixture.client!.from("profiles").select("*").eq("id", fixture.userId!).single();
    expect(data!.display_name).toBe(ownerDisplayName);
    expect(data!.business_name).toBe("");
    expect(data!.timezone).toBe("Asia/Kolkata");
    expect(data!.currency).toBe("INR");
    expect(data!.plan).toBe("FREE");
  });

  it("lets the signed-in owner update their business profile through the anon client", async () => {
    const { error } = await fixture
      .client!.from("profiles")
      .update({ business_name: businessName })
      .eq("id", fixture.userId!);
    expect(error).toBeNull();
    const { data } = await fixture.client!.from("profiles").select("business_name").eq("id", fixture.userId!).single();
    expect(data!.business_name).toBe(businessName);
  });

  it("creates an owner-scoped client through the database RPC", async () => {
    const { data, error } = await fixture.client!.rpc("create_client", {
      p_name: `Stage 2 Client ${fixture.userId!.slice(0, 8)}`,
      p_company: "",
      p_phone: "",
      p_email: "",
      p_notes: "",
    });
    expect(error).toBeNull();
    expect(data!.owner_id).toBe(fixture.userId!);
    expect(data!.id).toBeTruthy();
    fixture.clientId = data!.id;
  });

  it("rejects a non-positive receivable amount at the database boundary", async () => {
    const { data, error } = await fixture.client!.rpc("create_receivable", {
      p_client_id: fixture.clientId!,
      p_label: "Invalid amount probe",
      p_invoice_ref: "",
      p_amount_due_paise: 0,
      p_due_date: "2026-09-30",
      p_notes: "",
    });
    expect(data).toBeNull();
    expect(error).not.toBeNull();
    expect(error!.message).toMatch(/positive receivable amount/i);
  });

  it("refuses the browser role a direct receivable write at all, so no negative amount can reach the table", async () => {
    // Measured, and the wording matters. This probe was written when the browser role
    // could insert into `receivables` and the amount CHECK was what stopped it; Stage
    // 3's privilege hardening took the table away first, so the refusal this test now
    // observes is SQLSTATE 42501, not the constraint. The amount rule is still proven —
    // one test above, through the RPC the product actually uses — and claiming it twice
    // from a path that never reaches it would let the CHECK rot unnoticed.
    const { error } = await fixture.client!.from("receivables").insert({
      owner_id: fixture.userId!,
      client_id: fixture.clientId!,
      label: "Negative paise probe",
      amount_due_paise: -10_000,
      outstanding_paise: -10_000,
      due_date: "2026-09-30",
    });
    expect(error).not.toBeNull();
    // 42501 rather than a check-violation code (23514) is the whole point: it says the
    // write died at the privilege wall and the amount was never looked at. That refusal
    // carries a hint meaning an operator should GRANT the table back; the reader never
    // sees it because repositories drop `hint` — tests/stage6-error-copy.test.ts pins
    // that drop against this exact sentence, so it is asserted here only as a code.
    expect(error!.code, "the browser role must be refused by privilege, not by a value rule").toBe("42501");
    expect(error!.message).toMatch(/permission denied for table/i);
    const { count } = await fixture
      .client!.from("receivables")
      .select("*", { count: "exact", head: true })
      .eq("label", "Negative paise probe");
    expect(count).toBe(0);
  });

  it("exposes every core Stage 2 table through the local data API", async () => {
    for (const table of ["profiles", "clients", "receivables", "promises", "payments", "activities", "promise_events"]) {
      const { error } = await fixture.client!.from(table).select("*").limit(1);
      expect(error?.code, `${table} is missing from the migrated schema`).not.toBe("PGRST205");
    }
  });

  it("keeps the ledger closed to unauthenticated readers", async () => {
    const anonymous = newClient();
    const { data, error } = await anonymous.from("clients").select("id").eq("owner_id", fixture.userId!);
    // Stage 3 tightened this boundary from one layer to two: `anon` now holds no table
    // privileges at all, so the request is refused before row security is consulted. The
    // assertion got stricter rather than looser — it still requires zero rows and now also
    // names the privilege denial, so a future migration that quietly re-grants SELECT to
    // `anon` fails here instead of passing on an empty RLS-filtered result.
    expect(data ?? []).toEqual([]);
    expect(error?.code).toBe("42501");
    expect(error?.message).toMatch(/permission denied for table clients/i);
  });

  it("drops the session on sign-out", async () => {
    const { error } = await fixture.client!.auth.signOut();
    expect(error).toBeNull();
    const { data } = await fixture.client!.auth.getSession();
    expect(data.session).toBeNull();
  });

  it("signs back in and retains the same database identity and profile", async () => {
    const { data, error } = await newClient().auth.signInWithPassword({ email: ownerEmail, password: ownerPassword });
    expect(error).toBeNull();
    expect(data.session).not.toBeNull();
    expect(data.user!.id).toBe(fixture.userId!);

    const returning = newClient(data.session!.access_token);
    const { data: profile } = await returning
      .from("profiles")
      .select("id, display_name, business_name, timezone, currency, plan")
      .eq("id", data.user!.id)
      .single();
    expect(profile!.id).toBe(fixture.profileId!);
    expect(profile!.business_name).toBe(businessName);
    expect(profile!.display_name).toBe(ownerDisplayName);
    expect(profile!.timezone).toBe("Asia/Kolkata");
    expect(profile!.currency).toBe("INR");
  });
});

const inboxUrl = process.env.STAGE2_INBOX_URL ?? "http://127.0.0.1:54324";
const appUrl = process.env.STAGE2_APP_URL ?? "http://127.0.0.1:3000";
const recoveryEmail = `stage2-recovery-${Date.now().toString(36)}@dueweave.local`;

type CapturedMessage = { ID: string };

async function waitForMail(recipient: string): Promise<CapturedMessage[]> {
  // Auth hands the message to the local catcher asynchronously.
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const response = await fetch(`${inboxUrl}/api/v1/search?query=${encodeURIComponent(`To:${recipient}`)}`);
    if (response.ok) {
      const { messages } = (await response.json()) as { messages: CapturedMessage[] };
      if (messages.length > 0) return messages;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`No recovery mail reached the local catcher at ${inboxUrl} for ${recipient}.`);
}

describeLocalStack("Stage 2 local password recovery smoke", () => {
  it("accepts a local recovery request and captures the generated mail", async () => {
    const client = newClient();
    const signUpResult = await client.auth.signUp({
      email: recoveryEmail,
      password: `${recoveryEmail.slice(0, 12)}-Seed!`,
      options: { data: { display_name: "Stage 2 Recovery Fixture" } },
    });
    expect(signUpResult.error).toBeNull();

    const { error } = await client.auth.resetPasswordForEmail(recoveryEmail, {
      redirectTo: `${appUrl}/auth/update-password`,
    });
    expect(error).toBeNull();

    // Supabase's local stack captures mail with Mailpit; no external SMTP provider exists here.
    const messages = await waitForMail(recoveryEmail);

    const detail = await fetch(`${inboxUrl}/api/v1/message/${messages[0].ID}`);
    expect(detail.status).toBe(200);
    const message = (await detail.json()) as { To: { Address: string }[]; Subject: string; Text: string };
    expect(message.To.map((entry) => entry.Address)).toContain(recoveryEmail);
    expect(message.Subject).toBe("Reset your password");
    expect(message.Text).toContain("/auth/v1/verify");
    expect(message.Text).toContain("type=recovery");
    expect(message.Text).toContain(`${appUrl}/auth/update-password`);
  });
});

