import {
  createClient,
  type PostgrestError,
  type SupabaseClient,
} from "@supabase/supabase-js";
import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, it } from "vitest";

const url = process.env.VITE_SUPABASE_URL ?? "";
const anonKey = process.env.VITE_SUPABASE_ANON_KEY ?? "";

// Browser-safe credentials only. This suite never receives, reads or imports a
// service-role key: every claim below is made through the same roles the
// production SPA uses — anon plus two independently signed-in users.
const isLoopbackStack =
  /^https?:\/\/(127\.0\.0\.1|localhost)(:\d{2,5})?$/i.test(url);
const describeLocalStack =
  isLoopbackStack && anonKey.length > 0 ? describe : describe.skip;

const runTag = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
const emailFor = (label: string) => `stage3-${label}-${runTag}@dueweave.local`;
const newPassword = () => `Stage3!${Math.random().toString(36).slice(2, 12)}aA`;

function newClient(accessToken?: string): SupabaseClient {
  return createClient(url, anonKey, {
    global: accessToken
      ? { headers: { Authorization: `Bearer ${accessToken}` } }
      : undefined,
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Local Postgres administration, used only for synthetic-fixture setup and
// teardown. It is never used to make or to bypass an authorization assertion:
// every denial below comes from an anon or authenticated browser-role request.
const localDbContainer =
  process.env.STAGE3_LOCAL_DB_CONTAINER ?? "supabase_db_dueweave";

function localAdmin(sql: string) {
  execFileSync(
    "docker",
    [
      "exec",
      "-i",
      localDbContainer,
      "psql",
      "-U",
      "postgres",
      "-d",
      "postgres",
      "-f",
      "-",
    ],
    {
      input: sql,
      stdio: ["pipe", "pipe", "pipe"],
    }
  );
}

const OWNER_TABLES = [
  "profiles",
  "clients",
  "receivables",
  "promises",
  "payments",
  "activities",
  "promise_events",
  "entitlements",
  "purchase_claims",
  "analytics_events",
] as const;
const ADMIN_TABLES = [
  "founder_offer_config",
  "founder_admins",
  "founder_audit_events",
] as const;

// Three of the thirteen tables are not keyed by `id`; probes that filter or
// count by primary key have to use each table's real key.
const KEY_COLUMN: Record<string, string> = {
  entitlements: "user_id",
  founder_admins: "user_id",
  founder_offer_config: "offer_key",
};
const keyOf = (table: string) => KEY_COLUMN[table] ?? "id";

type Category =
  | "anonymous"
  | "cross-read"
  | "cross-update"
  | "cross-delete"
  | "owner-spoof"
  | "cross-parent-fk"
  | "cross-tenant-rpc"
  | "admin-escalation"
  | "immutability"
  | "session-boundary"
  | "launch-gate"
  | "legitimate-owner";

// Every probe is booked into the ledger with the outcome it actually produced,
// so the report can quote refusals, accepted owner operations, and stored-state
// proofs as three separate numbers instead of blending them into "passed".
type Outcome = "refused" | "accepted" | "unchanged" | "changed";
type LedgerEntry = {
  category: Category;
  label: string;
  outcome: Outcome;
  detail: string;
};
const ledger: LedgerEntry[] = [];

type Row = Record<string, unknown>;
type Probe = { error: PostgrestError | null; data?: unknown };

function assert(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

function rowsOf(value: unknown): Row[] {
  if (Array.isArray(value)) return value as Row[];
  if (value && typeof value === "object") return [value as Row];
  return [];
}

// A probe only counts as a denial when the server refused it for an
// authorization reason. A typo, a missing column or a wrong argument shape must
// never be reported as a security win, so those codes fail the run instead.
const MALFORMED_CODES = new Set([
  "42P01",
  "42703",
  "42883",
  "42P10",
  "22P02",
  "23503",
  "23514",
  "PGRST204",
  "PGRST205",
  "PGRST102",
]);

type Denial = { blocked: boolean; detail: string };

function denial(who: string, probe: Probe, expectedMessage?: string): Denial {
  if (!probe.error)
    return { blocked: false, detail: `${who} request was accepted` };
  const code = probe.error.code ?? "P0000";
  if (MALFORMED_CODES.has(code)) {
    return {
      blocked: false,
      detail: `${who} probe was malformed (${code}: ${probe.error.message})`,
    };
  }
  if (expectedMessage && !probe.error.message.includes(expectedMessage)) {
    // Refused, but not by the authorization check under test — an unrelated
    // refusal must never be booked as proof of isolation.
    return {
      blocked: false,
      detail: `${who} refused for an unexpected reason (${code}: ${probe.error.message})`,
    };
  }
  return {
    blocked: true,
    detail: `${who} refused with ${code}: ${probe.error.message}`,
  };
}

// Over /rpc a routine is unreachable when PostgREST refuses to resolve it or
// the role cannot execute it. Both are denials; only acceptance is a defect.
function notCallable(who: string, probe: Probe) {
  if (!probe.error)
    return { blocked: false, detail: `${who} call was accepted` };
  const code = probe.error.code ?? "P0000";
  const detail = `${who} refused with ${code}: ${probe.error.message}`;
  return { blocked: code === "42501" || code === "PGRST202", detail };
}

// A cross-user UPDATE/DELETE is refused when the server rejects the statement
// outright, or when it reports that it touched zero rows — row-level security
// answers a write whose USING predicate matches nothing with an empty
// representation rather than an error. Anything else means a foreign row was
// modified. Every caller pairs this with a stored-state re-read, so the empty
// answer is never taken on trust.
function writeRefused(who: string, probe: Probe, touched: number): Denial {
  if (probe.error) return denial(who, probe);
  if (touched > 0)
    return {
      blocked: false,
      detail: `${who} modified ${touched} row(s) it does not own`,
    };
  return {
    blocked: true,
    detail: `${who} matched no writable rows (0 returned, privilege or RLS filtered)`,
  };
}

function blocked(category: Category, label: string, result: Denial) {
  ledger.push({
    category,
    label,
    outcome: result.blocked ? "refused" : "accepted",
    detail: result.detail,
  });
  assert(result.blocked, `[${category}] ${label} — ${result.detail}`);
}

function allowed(category: Category, label: string, probe: Probe) {
  const detail = probe.error
    ? `${probe.error.code ?? "P0000"} ${probe.error.message}`
    : "accepted";
  ledger.push({
    category,
    label,
    outcome: probe.error ? "refused" : "accepted",
    detail,
  });
  assert(
    probe.error === null,
    `[${category}] ${label} — legitimate owner operation failed: ${detail}`
  );
}

function unchanged<T>(
  label: string,
  category: Category,
  actual: T,
  expected: T
) {
  const same = JSON.stringify(actual) === JSON.stringify(expected);
  ledger.push({
    category,
    label,
    outcome: same ? "unchanged" : "changed",
    detail: same
      ? "stored state unchanged"
      : `expected ${JSON.stringify(expected)}, found ${JSON.stringify(actual)}`,
  });
  assert(
    same,
    `[${category}] ${label} — stored state changed: ${JSON.stringify(actual)} !== ${JSON.stringify(expected)}`
  );
}

type Account = {
  userId: string;
  accessToken: string;
  client: SupabaseClient;
  profile: Row;
  clientId: string;
  receivableId: string;
  promiseId: string;
  owned: Record<string, Row[]>;
};

const state: { a?: Account; b?: Account; anon?: SupabaseClient } = {};

async function bootstrap(label: string): Promise<Account> {
  const { data, error } = await newClient().auth.signUp({
    email: emailFor(label),
    password: newPassword(),
    options: { data: { display_name: `Stage 3 ${label}` } },
  });
  assert(
    !error && !!data.session && !!data.user,
    `local signup failed for ${label}: ${error?.message ?? "no session"}`
  );
  const client = newClient(data.session!.access_token);
  const { data: profile, error: profileError } = await client
    .from("profiles")
    .select("*")
    .eq("id", data.user!.id)
    .single();
  assert(
    !profileError && !!profile,
    `profile row missing for ${label}: ${profileError?.message ?? "missing"}`
  );
  return {
    userId: data.user!.id,
    accessToken: data.session!.access_token,
    client,
    profile: profile as Row,
    clientId: "",
    receivableId: "",
    promiseId: "",
    owned: {},
  };
}

async function seedOwnedBusiness(account: Account, tag: string) {
  const client = account.client;
  const { data: createdClient, error: clientError } = await client.rpc(
    "create_client",
    {
      p_name: `${tag} Ledger Co`,
      p_company: `${tag} Pty`,
      p_phone: "9876543210",
      p_email: `${tag.toLowerCase()}@stage3.invalid`,
      p_notes: "",
    }
  );
  assert(
    !clientError,
    `create_client failed for ${tag}: ${clientError?.message}`
  );
  account.clientId = (createdClient as Row).id as string;

  const { data: receivable, error: receivableError } = await client.rpc(
    "create_receivable",
    {
      p_client_id: account.clientId,
      p_label: `${tag} Invoice 1001`,
      p_invoice_ref: `INV-${tag}`,
      p_amount_due_paise: 500000,
      p_due_date: "2026-09-30",
      p_notes: "",
    }
  );
  assert(
    !receivableError,
    `create_receivable failed for ${tag}: ${receivableError?.message}`
  );
  account.receivableId = (receivable as Row).id as string;

  const { data: promise, error: promiseError } = await client.rpc(
    "create_promise",
    {
      p_receivable_id: account.receivableId,
      p_promised_amount_paise: 300000,
      p_promised_date: "2026-10-05",
      p_source: "WHATSAPP",
      p_note: `${tag} promised part payment`,
      p_request_id: crypto.randomUUID(),
    }
  );
  assert(
    !promiseError,
    `create_promise failed for ${tag}: ${promiseError?.message}`
  );
  account.promiseId = (promise as Row).id as string;

  allowed(
    "legitimate-owner",
    `${tag} records a partial payment`,
    await client.rpc("record_payment", {
      p_receivable_id: account.receivableId,
      p_amount_paise: 100000,
      p_paid_on: "2026-09-20",
      p_method: "UPI",
      p_reference: `PAY-${tag}`,
      p_request_id: crypto.randomUUID(),
    })
  );
  allowed(
    "legitimate-owner",
    `${tag} records a follow-up`,
    await client.rpc("record_contacted", {
      p_receivable_id: account.receivableId,
      p_note: `${tag} follow-up`,
    })
  );

  const owned: Record<string, Row[]> = {};
  for (const table of OWNER_TABLES) {
    const { data, error } = await client.from(table).select("*");
    assert(
      !error,
      `owner read of ${table} failed for ${tag}: ${error?.message}`
    );
    owned[table] = rowsOf(data);
  }
  owned.founder_offer_config = [];
  owned.founder_admins = [];
  owned.founder_audit_events = [];
  account.owned = owned;
}

// The Founder claim workflow is closed to every browser role until the offer's
// payment destination reaches LIVE, and Stage 3 must not activate payments.
// The claim rows the cross-tenant and admin probes below attack are therefore
// placed by the local admin fixture, which sets exactly the transaction-scoped
// context marker the protected workflow itself sets — the trigger rejects any
// other write, including the table owner's (proved in Phase 15). No payment
// gate is opened and no browser-role write is bypassed to make a denial pass.
function seedFounderClaimFixture(
  emails: { submitted: string; draft: string },
  tag: string
) {
  const utr = (label: string) =>
    `STAGE3${label}${tag.slice(0, 4).toUpperCase()}`;
  localAdmin(`begin;
      set local app.dueweave_claim_context = 'CREATE';
      insert into public.purchase_claims (owner_id, claim_id, plan, amount_paise, utr_reference, payer_name, status)
      select id, 'DW-F-' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,12)), 'FOUNDER', 49900, '', '', 'DRAFT'
        from auth.users where email in ('${emails.submitted}', '${emails.draft}');
      set local app.dueweave_claim_context = 'SUBMIT';
      update public.purchase_claims
         set status = 'PENDING_REVIEW', utr_reference = '${utr("SUB")}', payer_name = 'Stage3 Submitted Payer', submitted_at = now()
       where owner_id = (select id from auth.users where email = '${emails.submitted}');
      commit;`);
}

describeLocalStack(
  "Stage 3 local authorization: two real accounts against one shared database",
  () => {
    beforeAll(async () => {
      state.anon = newClient();
      const a = await bootstrap("alpha");
      const b = await bootstrap("beta");
      await seedOwnedBusiness(a, "Alpha");
      await seedOwnedBusiness(b, "Beta");
      for (const [label, account] of [
        ["A", a],
        ["B", b],
      ] as const) {
        allowed(
          "legitimate-owner",
          `${label} views the upgrade offer`,
          await account.client.rpc("record_founder_upgrade_view")
        );
      }
      // The launch gate is part of the executed authorization posture: an
      // ordinary account cannot open or submit a claim while the destination is
      // PLACEHOLDER, and this run never changes that state.
      blocked(
        "launch-gate",
        "create_founder_claim stays gated pre-launch",
        denial(
          "A",
          await a.client.rpc("create_founder_claim"),
          "Founder payment instructions are not ready yet"
        )
      );
      blocked(
        "launch-gate",
        "submit_founder_payment stays gated pre-launch",
        denial(
          "A",
          await a.client.rpc("submit_founder_payment", {
            p_claim_id: "DW-F-PLACEHOLD1",
            p_utr_reference: `STAGE3X${runTag.slice(0, 4).toUpperCase()}`,
            p_payer_name: "Gated Probe Payer",
          }),
          "Payment instructions are not ready for submission"
        )
      );
      seedFounderClaimFixture(
        { submitted: emailFor("alpha"), draft: emailFor("beta") },
        runTag
      );
      for (const account of [a, b]) {
        for (const table of [
          "purchase_claims",
          "analytics_events",
          "entitlements",
        ]) {
          const { data, error } = await account.client.from(table).select("*");
          assert(!error, `owner read of ${table} failed: ${error?.message}`);
          account.owned[table] = rowsOf(data);
        }
      }
      state.a = a;
      state.b = b;
    }, 180_000);

    afterAll(async () => {
      mkdirSync(path.resolve("test-results"), { recursive: true });
      type Tally = {
        probes: number;
        refused: number;
        accepted: number;
        unchanged: number;
        changed: number;
      };
      const summary = ledger.reduce<Record<string, Tally>>((acc, entry) => {
        const bucket = (acc[entry.category] ??= {
          probes: 0,
          refused: 0,
          accepted: 0,
          unchanged: 0,
          changed: 0,
        });
        bucket.probes += 1;
        bucket[entry.outcome] += 1;
        return acc;
      }, {});
      const totals = Object.values(summary).reduce<Tally>(
        (acc, bucket) => {
          acc.probes += bucket.probes;
          acc.refused += bucket.refused;
          acc.accepted += bucket.accepted;
          acc.unchanged += bucket.unchanged;
          acc.changed += bucket.changed;
          return acc;
        },
        { probes: 0, refused: 0, accepted: 0, unchanged: 0, changed: 0 }
      );
      writeFileSync(
        path.resolve("test-results", "stage3-ledger.json"),
        JSON.stringify(
          {
            runTag,
            generatedAt: new Date().toISOString(),
            totals,
            summary,
            entries: ledger,
          },
          null,
          2
        )
      );
      // Teardown: remove the synthetic accounts. The founder offer row is never
      // touched by this suite, so nothing needs restoring there. The history
      // guards refuse DELETE even to the table owner — which this run proves
      // elsewhere — so the purge skips them for one transaction with
      // `set local session_replication_role = replica`, which reverts at commit
      // and takes no lock on the guarded tables. The previous form of this teardown
      // issued `alter table … disable trigger` instead, and that is what made the
      // suite poison the runs after it: the ALTER asks for ACCESS EXCLUSIVE while
      // ledger RPCs hold row locks on the same tables (a money write waiting
      // behind the purge, and the purge waiting for the next table, is a cycle
      // Postgres breaks by killing the money write), and every ALTER also fires
      // the ddl_command_end notify that reloads PostgREST's schema cache, so a
      // browser request landing in that window fails with no Postgres-side error
      // at all. This setting is superuser-only, transaction-scoped and does not
      // touch RLS — the local superuser already bypasses it, so the purge gains
      // no authority this suite is not meant to have.
      localAdmin(`begin;
      set local session_replication_role = replica;
      delete from public.founder_audit_events where target_user_id in (select id from auth.users where email like 'stage3-%@dueweave.local');
      delete from public.founder_audit_events where actor_user_id in (select id from auth.users where email like 'stage3-%@dueweave.local');
      delete from public.founder_admins where user_id in (select id from auth.users where email like 'stage3-%@dueweave.local');
      delete from public.purchase_claims where owner_id in (select id from auth.users where email like 'stage3-%@dueweave.local');
      delete from public.analytics_events where owner_id in (select id from auth.users where email like 'stage3-%@dueweave.local');
      delete from public.activities where owner_id in (select id from auth.users where email like 'stage3-%@dueweave.local');
      delete from public.promise_events where owner_id in (select id from auth.users where email like 'stage3-%@dueweave.local');
      delete from public.payments where owner_id in (select id from auth.users where email like 'stage3-%@dueweave.local');
      delete from public.promises where owner_id in (select id from auth.users where email like 'stage3-%@dueweave.local');
      delete from public.receivables where owner_id in (select id from auth.users where email like 'stage3-%@dueweave.local');
      delete from public.clients where owner_id in (select id from auth.users where email like 'stage3-%@dueweave.local');
      delete from public.entitlements where user_id in (select id from auth.users where email like 'stage3-%@dueweave.local');
      delete from public.profiles where id in (select id from auth.users where email like 'stage3-%@dueweave.local');
      delete from auth.users where email like 'stage3-%@dueweave.local';
      commit;`);
    });

    it("carries a non-vacuous fixture: both accounts really own rows", () => {
      const a = state.a!;
      const b = state.b!;
      assert(a.userId !== b.userId, "the two accounts must be different users");
      for (const table of OWNER_TABLES) {
        assert(
          a.owned[table].length > 0,
          `${table} holds no Alpha fixture row`
        );
        assert(b.owned[table].length > 0, `${table} holds no Beta fixture row`);
      }
    });

    // PHASE 8 — read isolation ------------------------------------------------
    for (const table of OWNER_TABLES) {
      it(`user B cannot read ${table} rows owned by user A`, async () => {
        const a = state.a!;
        const b = state.b!;
        const { data, error } = await b.client.from(table).select("*");
        assert(
          !error,
          `B's read of ${table} errored unexpectedly: ${error?.message}`
        );
        const aIds = new Set(
          a.owned[table].map(row => String(row.id ?? row.user_id))
        );
        const victimRows = rowsOf(data).filter(row =>
          aIds.has(String(row.id ?? row.user_id))
        );
        blocked("cross-read", `B select ${table}`, {
          blocked: victimRows.length === 0,
          detail: victimRows.length
            ? `B read ${victimRows.length} of ${aIds.size} A-owned ${table} rows`
            : `B saw 0 of A's ${aIds.size} ${table} rows`,
        });
        // Positive control so an empty result cannot be a vacuous pass.
        const own = await a.client.from(table).select("*");
        assert(
          !own.error && rowsOf(own.data).length === a.owned[table].length,
          `A can no longer read its own ${table} rows`
        );
      });
    }

    for (const table of ADMIN_TABLES) {
      it(`the founder admin table ${table} is unreachable from a browser role`, async () => {
        const b = state.b!;
        blocked(
          "cross-read",
          `B select ${table}`,
          denial("B", await b.client.from(table).select("*"))
        );
        blocked(
          "anonymous",
          `anon select ${table}`,
          denial("anon", await state.anon!.from(table).select("*"))
        );
      });
    }

    it("get_founder_offer() returns only its own projection, never tenant rows", async () => {
      const a = state.a!;
      const probe = await a.client.rpc("get_founder_offer");
      allowed("legitimate-owner", "get_founder_offer projection", probe);
      const projection = rowsOf(probe.data)[0] ?? {};
      const expected = [
        "amount_paise",
        "available_spots",
        "disclosures_status",
        "enabled",
        "founder_cap",
        "payee_name",
        "payment_destination_status",
        "refund_policy_status",
        "refund_policy_text",
        "review_window_copy",
        "support_contact",
        "support_contact_status",
        "upi_id",
      ].sort();
      unchanged(
        "projection columns",
        "legitimate-owner",
        Object.keys(projection).sort(),
        expected
      );
      const serialised = JSON.stringify(projection);
      assert(
        !serialised.includes(a.userId),
        "the offer projection leaked a user id"
      );
      assert(
        !/"owner_id"|"user_id"|"email"/.test(serialised),
        "the offer projection leaked an identity column"
      );
    });

    // PHASE 9 — update isolation ---------------------------------------------
    const updateProbes: {
      table: string;
      key: string;
      column: string;
      value: unknown;
    }[] = [
      {
        table: "profiles",
        key: "id",
        column: "display_name",
        value: "hijacked by B",
      },
      { table: "clients", key: "id", column: "name", value: "hijacked by B" },
      {
        table: "receivables",
        key: "id",
        column: "label",
        value: "hijacked by B",
      },
      { table: "promises", key: "id", column: "note", value: "hijacked by B" },
      { table: "payments", key: "id", column: "reference", value: "HIJACKED" },
      {
        table: "activities",
        key: "id",
        column: "note",
        value: "hijacked by B",
      },
      {
        table: "promise_events",
        key: "id",
        column: "reason",
        value: "hijacked by B",
      },
      {
        table: "entitlements",
        key: "user_id",
        column: "plan",
        value: "FOUNDER",
      },
      {
        table: "purchase_claims",
        key: "id",
        column: "status",
        value: "APPROVED",
      },
      {
        table: "analytics_events",
        key: "id",
        column: "event_name",
        value: "hijacked",
      },
    ];

    for (const probe of updateProbes) {
      it(`user B cannot update A's ${probe.table} row and the stored row survives`, async () => {
        const a = state.a!;
        const b = state.b!;
        const target = a.owned[probe.table].find(
          row => row[probe.key] !== undefined
        )!;
        const idValue = target[probe.key];
        const attempt = await b.client
          .from(probe.table)
          .update({ [probe.column]: probe.value })
          .eq(probe.key, idValue)
          .select();
        blocked(
          "cross-update",
          `B update A ${probe.table}`,
          writeRefused("B", attempt, rowsOf(attempt.data).length)
        );
        const { data, error } = await a.client
          .from(probe.table)
          .select(probe.column)
          .eq(probe.key, idValue)
          .single();
        assert(
          !error,
          `owner re-read of ${probe.table} failed: ${error?.message}`
        );
        unchanged(
          `A's ${probe.table}.${probe.column} survives`,
          "cross-update",
          (data as Row)[probe.column],
          target[probe.column]
        );
      });
    }

    it("a cross-user write that reports no error still changes no stored row", async () => {
      const a = state.a!;
      const b = state.b!;
      const target = a.owned.clients[0];
      const attempt = await b.client
        .from("clients")
        .update({ name: "silently hijacked" })
        .eq("id", target.id)
        .select();
      const { data } = await a.client
        .from("clients")
        .select("name")
        .eq("id", target.id)
        .single();
      const storedName = (data as Row).name;
      blocked("cross-update", "B update clients (stored-state proof)", {
        blocked: storedName === target.name,
        detail: attempt.error
          ? `refused with ${attempt.error.code}`
          : `accepted with no error; stored name is now ${JSON.stringify(storedName)}`,
      });
    });

    // PHASE 10 — delete isolation --------------------------------------------
    for (const probe of updateProbes) {
      it(`user B cannot delete A's ${probe.table} row`, async () => {
        const a = state.a!;
        const b = state.b!;
        const target = a.owned[probe.table].find(
          row => row[probe.key] !== undefined
        )!;
        const idValue = target[probe.key];
        const attempt = await b.client
          .from(probe.table)
          .delete()
          .eq(probe.key, idValue)
          .select();
        blocked(
          "cross-delete",
          `B delete A ${probe.table}`,
          writeRefused("B", attempt, rowsOf(attempt.data).length)
        );
        const { data, error } = await a.client
          .from(probe.table)
          .select(probe.key)
          .eq(probe.key, idValue)
          .maybeSingle();
        assert(
          !error,
          `owner re-read of ${probe.table} failed: ${error?.message}`
        );
        unchanged(
          `A's ${probe.table} row survives`,
          "cross-delete",
          data ? (data as Row)[probe.key] : null,
          idValue
        );
      });
    }

    // PHASE 11 — owner-id spoofing -------------------------------------------
    const spoofInserts: {
      table: string;
      build: (ids: Record<string, string>) => Row;
    }[] = [
      {
        table: "clients",
        build: ids => ({ owner_id: ids.victim, name: "spoofed client" }),
      },
      {
        table: "receivables",
        build: ids => ({
          owner_id: ids.victim,
          client_id: ids.victimClient,
          label: "spoofed receivable",
          amount_due_paise: 100,
          outstanding_paise: 100,
          due_date: "2026-09-30",
        }),
      },
      {
        table: "profiles",
        build: ids => ({ id: ids.victim, display_name: "spoofed profile" }),
      },
      {
        table: "entitlements",
        build: ids => ({
          user_id: ids.victim,
          plan: "FOUNDER",
          status: "ACTIVE",
          source: "PURCHASE",
        }),
      },
      {
        table: "activities",
        build: ids => ({
          owner_id: ids.victim,
          type: "PAYMENT_RECORDED",
          note: "spoofed activity",
        }),
      },
      {
        table: "analytics_events",
        build: ids => ({ owner_id: ids.victim, event_name: "spoofed_event" }),
      },
      {
        table: "purchase_claims",
        build: ids => ({
          owner_id: ids.victim,
          claim_id: `DW-F-SPOOF${ids.spoofTag}`,
          plan: "FOUNDER",
          amount_paise: 49900,
          status: "PENDING_REVIEW",
          utr_reference: `SPOOF${ids.spoofTag}`,
          payer_name: "spoof payer",
        }),
      },
      {
        table: "payments",
        build: ids => ({
          owner_id: ids.victim,
          receivable_id: ids.victimReceivable,
          amount_paise: 100,
          paid_on: "2026-09-20",
          method: "UPI",
        }),
      },
      {
        table: "promises",
        build: ids => ({
          owner_id: ids.victim,
          receivable_id: ids.victimReceivable,
          sequence_no: 9,
          promised_amount_paise: 100,
          promised_date: "2026-09-30",
          source: "CALL",
        }),
      },
      {
        table: "promise_events",
        build: ids => ({
          owner_id: ids.victim,
          promise_id: ids.victimPromise,
          receivable_id: ids.victimReceivable,
          to_status: "KEPT",
        }),
      },
    ];

    for (const probe of spoofInserts) {
      it(`user A cannot insert a ${probe.table} row attributed to user B`, async () => {
        const a = state.a!;
        const b = state.b!;
        const ids = {
          attacker: a.userId,
          victim: b.userId,
          victimClient: b.clientId,
          victimReceivable: b.receivableId,
          victimPromise: b.promiseId,
          spoofTag: runTag.slice(0, 10).toUpperCase(),
        };
        blocked(
          "owner-spoof",
          `A insert ${probe.table} attributed to B`,
          denial("A", await a.client.from(probe.table).insert(probe.build(ids)))
        );
        const { data } = await b.client.from(probe.table).select("*");
        unchanged(
          `B's ${probe.table} row count unchanged`,
          "owner-spoof",
          rowsOf(data).length,
          b.owned[probe.table].length
        );
        const { data: mine } = await a.client.from(probe.table).select("*");
        unchanged(
          `A's ${probe.table} row count unchanged`,
          "owner-spoof",
          rowsOf(mine).length,
          a.owned[probe.table].length
        );
      });
    }

    it("user B cannot backdate a receivable into user A's client either", async () => {
      const a = state.a!;
      const b = state.b!;
      blocked(
        "owner-spoof",
        "B insert clients attributed to A",
        denial(
          "B",
          await b.client
            .from("clients")
            .insert({ owner_id: a.userId, name: "reverse spoof" })
        )
      );
      const { data } = await a.client.from("clients").select("id");
      unchanged(
        `A's client count unchanged`,
        "owner-spoof",
        rowsOf(data).length,
        a.owned.clients.length
      );
    });

    // PHASE 12 — cross-parent foreign keys -----------------------------------
    it("create_receivable() refuses a client owned by another account", async () => {
      const a = state.a!;
      const b = state.b!;
      blocked(
        "cross-parent-fk",
        "create_receivable against B's client",
        denial(
          "A",
          await a.client.rpc("create_receivable", {
            p_client_id: b.clientId,
            p_label: "cross-parent probe",
            p_invoice_ref: "",
            p_amount_due_paise: 100000,
            p_due_date: "2026-09-30",
            p_notes: "",
          }),
          "Client is not available for this account"
        )
      );
      const { data } = await b.client.from("receivables").select("id");
      unchanged(
        "B's receivable count unchanged",
        "cross-parent-fk",
        rowsOf(data).length,
        b.owned.receivables.length
      );
      const { data: orphan } = await a.client
        .from("receivables")
        .select("label")
        .eq("label", "cross-parent probe");
      unchanged(
        "no receivable created for A",
        "cross-parent-fk",
        rowsOf(orphan).length,
        0
      );
    });

    it("a receivable cannot be pointed at another owner's client through the table", async () => {
      const a = state.a!;
      const b = state.b!;
      blocked(
        "cross-parent-fk",
        "direct receivables insert under B's client",
        denial(
          "A",
          await a.client.from("receivables").insert({
            owner_id: a.userId,
            client_id: b.clientId,
            label: "orphan probe",
            amount_due_paise: 100,
            outstanding_paise: 100,
            due_date: "2026-09-30",
          })
        )
      );
    });

    it("child rows cannot reference another owner's parent", async () => {
      const a = state.a!;
      const b = state.b!;
      blocked(
        "cross-parent-fk",
        "promise owned by A under B's receivable",
        denial(
          "A",
          await a.client.from("promises").insert({
            owner_id: a.userId,
            receivable_id: b.receivableId,
            sequence_no: 1,
            promised_amount_paise: 100,
            promised_date: "2026-09-30",
            source: "CALL",
          })
        )
      );
      blocked(
        "cross-parent-fk",
        "activity owned by A under B's receivable",
        denial(
          "A",
          await a.client.from("activities").insert({
            owner_id: a.userId,
            receivable_id: b.receivableId,
            type: "FOLLOW_UP_RECORDED",
            note: "cross parent",
          })
        )
      );
      blocked(
        "cross-parent-fk",
        "payment owned by A under B's receivable",
        denial(
          "A",
          await a.client.from("payments").insert({
            owner_id: a.userId,
            receivable_id: b.receivableId,
            amount_paise: 100,
            paid_on: "2026-09-20",
            method: "UPI",
          })
        )
      );
      const { data } = await b.client.from("promises").select("id");
      unchanged(
        "B's promise count unchanged",
        "cross-parent-fk",
        rowsOf(data).length,
        b.owned.promises.length
      );
      const { data: paid } = await b.client.from("payments").select("id");
      unchanged(
        "B's payment count unchanged",
        "cross-parent-fk",
        rowsOf(paid).length,
        b.owned.payments.length
      );
    });

    // PHASE 13 — workflow RPC boundaries -------------------------------------
    it("workflow RPCs refuse a receivable owned by another account", async () => {
      const a = state.a!;
      const b = state.b!;
      const target = b.owned.receivables[0];
      const notYours = "Receivable is not available for this account";
      blocked(
        "cross-tenant-rpc",
        "record_payment against B's receivable",
        denial(
          "A",
          await a.client.rpc("record_payment", {
            p_receivable_id: b.receivableId,
            p_amount_paise: 100,
            p_paid_on: "2026-09-20",
            p_method: "UPI",
            p_reference: "ATTACK",
            p_request_id: crypto.randomUUID(),
          }),
          notYours
        )
      );
      blocked(
        "cross-tenant-rpc",
        "create_promise against B's receivable",
        denial(
          "A",
          await a.client.rpc("create_promise", {
            p_receivable_id: b.receivableId,
            p_promised_amount_paise: 100,
            p_promised_date: "2026-09-28",
            p_source: "CALL",
            p_note: "attack",
            p_request_id: crypto.randomUUID(),
          }),
          notYours
        )
      );
      blocked(
        "cross-tenant-rpc",
        "record_contacted against B's receivable",
        denial(
          "A",
          await a.client.rpc("record_contacted", {
            p_receivable_id: b.receivableId,
            p_note: "attack",
          }),
          notYours
        )
      );
      blocked(
        "cross-tenant-rpc",
        "snooze_receivable against B's receivable",
        denial(
          "A",
          await a.client.rpc("snooze_receivable", {
            p_receivable_id: b.receivableId,
            p_until: "2026-12-31",
          }),
          "Receivable is not available to snooze"
        )
      );

      const { data, error } = await b.client
        .from("receivables")
        .select("outstanding_paise, status, label")
        .eq("id", b.receivableId)
        .single();
      assert(!error, `re-read of B's receivable failed: ${error?.message}`);
      unchanged(
        "B's outstanding balance unchanged",
        "cross-tenant-rpc",
        (data as Row).outstanding_paise,
        target.outstanding_paise
      );
      unchanged(
        "B's receivable status unchanged",
        "cross-tenant-rpc",
        (data as Row).status,
        target.status
      );
      unchanged(
        "B's receivable label unchanged",
        "cross-tenant-rpc",
        (data as Row).label,
        target.label
      );
      const { data: payments } = await b.client
        .from("payments")
        .select("reference");
      unchanged(
        "no attacker payment recorded for B",
        "cross-tenant-rpc",
        rowsOf(payments).some(row => row.reference === "ATTACK"),
        false
      );
      const { data: activities } = await b.client
        .from("activities")
        .select("note");
      unchanged(
        "no attacker activity recorded for B",
        "cross-tenant-rpc",
        rowsOf(activities).some(row => row.note === "attack"),
        false
      );
    });

    it("founder claim RPCs refuse another account's claim", async () => {
      const a = state.a!;
      const b = state.b!;
      const bClaim = b.owned.purchase_claims.find(
        row => row.status === "DRAFT"
      )!;
      assert(!!bClaim, "Beta fixture is missing a draft claim");
      blocked(
        "cross-tenant-rpc",
        "cancel_founder_claim against B's claim",
        denial(
          "A",
          await a.client.rpc("cancel_founder_claim", {
            p_claim_id: bClaim.claim_id,
          }),
          "This payment claim is not available for this account"
        )
      );
      // submit_founder_payment checks the launch gate before it looks the claim
      // up, so pre-launch the executed refusal is the gate rather than the owner
      // check. cancel_founder_claim has no gate and is the executed proof of the
      // owner-scoped claim lookup.
      blocked(
        "cross-tenant-rpc",
        "submit_founder_payment against B's claim (gate precedes the owner check)",
        denial(
          "A",
          await a.client.rpc("submit_founder_payment", {
            p_claim_id: bClaim.claim_id,
            p_utr_reference: "ATTACKREF1",
            p_payer_name: "Attacker",
          }),
          "Payment instructions are not ready for submission"
        )
      );
      const { data, error } = await b.client
        .from("purchase_claims")
        .select("status, utr_reference, payer_name")
        .eq("claim_id", bClaim.claim_id)
        .single();
      assert(!error, `re-read of B's claim failed: ${error?.message}`);
      unchanged(
        "B's claim status unchanged",
        "cross-tenant-rpc",
        (data as Row).status,
        bClaim.status
      );
      unchanged(
        "B's claim reference unchanged",
        "cross-tenant-rpc",
        (data as Row).utr_reference,
        bClaim.utr_reference
      );
      unchanged(
        "B's claim payer unchanged",
        "cross-tenant-rpc",
        (data as Row).payer_name,
        bClaim.payer_name
      );
    });

    it("the owner's own workflow still completes end to end", async () => {
      const a = state.a!;
      const b = state.b!;
      const created = await a.client.rpc("create_receivable", {
        p_client_id: a.clientId,
        p_label: "Alpha Invoice 1002",
        p_invoice_ref: "INV-1002",
        p_amount_due_paise: 250000,
        p_due_date: "2026-10-15",
        p_notes: "",
      });
      allowed("legitimate-owner", "A creates a second receivable", created);
      const receivableId = (created.data as Row).id as string;
      allowed(
        "legitimate-owner",
        "A promises against its own receivable",
        await a.client.rpc("create_promise", {
          p_receivable_id: receivableId,
          p_promised_amount_paise: 250000,
          p_promised_date: "2026-10-10",
          p_source: "CALL",
          p_note: "",
          p_request_id: crypto.randomUUID(),
        })
      );
      allowed(
        "legitimate-owner",
        "A pays its own receivable in full",
        await a.client.rpc("record_payment", {
          p_receivable_id: receivableId,
          p_amount_paise: 250000,
          p_paid_on: "2026-09-22",
          p_method: "BANK_TRANSFER",
          p_reference: "OWN-1",
          p_request_id: crypto.randomUUID(),
        })
      );
      const { data, error } = await a.client
        .from("receivables")
        .select("status, outstanding_paise")
        .eq("id", receivableId)
        .single();
      assert(!error, `re-read of A's receivable failed: ${error?.message}`);
      unchanged("A's receivable reached PAID", "legitimate-owner", data, {
        status: "PAID",
        outstanding_paise: 0,
      });
      allowed(
        "legitimate-owner",
        "A snoozes its own first receivable",
        await a.client.rpc("snooze_receivable", {
          p_receivable_id: a.receivableId,
          p_until: "2026-10-01",
        })
      );
      allowed(
        "legitimate-owner",
        "A edits its own business profile",
        await a.client
          .from("profiles")
          .update({ business_name: "Alpha Qualification" })
          .eq("id", a.userId)
      );
      const { data: profile } = await a.client
        .from("profiles")
        .select("business_name")
        .eq("id", a.userId)
        .single();
      unchanged(
        "profile edit persisted",
        "legitimate-owner",
        (profile as Row).business_name,
        "Alpha Qualification"
      );
      // The same workflow through the second account must remain independent.
      allowed(
        "legitimate-owner",
        "B records its own follow-up",
        await b.client.rpc("record_contacted", {
          p_receivable_id: b.receivableId,
          p_note: "Beta follow-up two",
        })
      );
      const { data: bActivities } = await b.client
        .from("activities")
        .select("note");
      unchanged(
        "B keeps its own activity stream",
        "legitimate-owner",
        rowsOf(bActivities).some(row => row.note === "Beta follow-up two"),
        true
      );
    });

    // PHASE 14 — admin / founder privilege escalation -------------------------
    // Each of these RPCs is executable by the authenticated role on purpose (the
    // review UI is the same SPA), so the denial must come from the in-function
    // admin check. Requiring that exact message proves the check ran.
    const adminMessage =
      "Founder review access is not available for this account";
    const adminProbes: { fn: string; label: string; args: Row }[] = [
      {
        fn: "approve_founder_claim",
        label: "approve a claim",
        args: { p_claim_id: "DW-F-NOTEXIST0" },
      },
      {
        fn: "reject_founder_claim",
        label: "reject a claim",
        args: { p_claim_id: "DW-F-NOTEXIST0", p_reason: "probe" },
      },
      {
        fn: "reconsider_founder_claim",
        label: "reconsider a claim",
        args: {
          p_claim_id: "DW-F-NOTEXIST0",
          p_bank_history_verified: true,
          p_note: "probe",
        },
      },
      {
        fn: "revoke_founder_entitlement",
        label: "revoke an entitlement",
        args: {
          p_user_id: "00000000-0000-0000-0000-000000000000",
          p_reason: "probe",
        },
      },
      {
        fn: "list_pending_founder_claims",
        label: "list the review queue",
        args: {},
      },
      {
        fn: "list_rejected_founder_claims",
        label: "list rejected claims",
        args: {},
      },
      { fn: "get_founder_funnel", label: "read the funnel", args: {} },
    ];

    for (const probe of adminProbes) {
      it(`a signed-in non-admin cannot reach the review RPC ${probe.fn}`, async () => {
        const a = state.a!;
        const b = state.b!;
        blocked(
          "admin-escalation",
          `A rpc ${probe.fn}`,
          denial(
            "A",
            await a.client.rpc(probe.fn, probe.args as Record<string, unknown>),
            adminMessage
          )
        );
        blocked(
          "admin-escalation",
          `B rpc ${probe.fn}`,
          denial(
            "B",
            await b.client.rpc(probe.fn, probe.args as Record<string, unknown>),
            adminMessage
          )
        );
        blocked(
          "anonymous",
          `anon rpc ${probe.fn}`,
          notCallable(
            "anon",
            await state.anon!.rpc(
              probe.fn,
              probe.args as Record<string, unknown>
            )
          )
        );
      });
    }

    it("an account cannot enroll itself as a founder reviewer", async () => {
      const a = state.a!;
      blocked(
        "admin-escalation",
        "A insert founder_admins",
        denial(
          "A",
          await a.client
            .from("founder_admins")
            .insert({ user_id: a.userId, note: "self" })
        )
      );
      blocked(
        "admin-escalation",
        "A read founder_admins",
        denial("A", await a.client.from("founder_admins").select("*"))
      );
      blocked(
        "admin-escalation",
        "A update founder_offer_config",
        denial(
          "A",
          await a.client
            .from("founder_offer_config")
            .update({ amount_paise: 1 })
            .eq("offer_key", "FOUNDER_V1")
        )
      );
      const { data, error } = await a.client.rpc("get_founder_offer");
      assert(!error, `offer read failed: ${error?.message}`);
      unchanged(
        "offer price untouched",
        "admin-escalation",
        (rowsOf(data)[0] ?? {}).amount_paise,
        49900
      );
    });

    it("an account cannot escalate its own plan or entitlement", async () => {
      const a = state.a!;
      blocked(
        "admin-escalation",
        "A update profiles.plan",
        denial(
          "A",
          await a.client
            .from("profiles")
            .update({ plan: "FOUNDER" })
            .eq("id", a.userId)
        )
      );
      blocked(
        "admin-escalation",
        "A update entitlements",
        denial(
          "A",
          await a.client
            .from("entitlements")
            .update({ plan: "FOUNDER", status: "ACTIVE" })
            .eq("user_id", a.userId)
        )
      );
      const { data } = await a.client
        .from("profiles")
        .select("plan")
        .eq("id", a.userId)
        .single();
      unchanged(
        "A's profile plan stays FREE",
        "admin-escalation",
        (data as Row).plan,
        "FREE"
      );
      const { data: entitlement } = await a.client
        .from("entitlements")
        .select("plan, status")
        .eq("user_id", a.userId)
        .single();
      unchanged(
        "A's entitlement stays FREE/ACTIVE",
        "admin-escalation",
        entitlement,
        { plan: "FREE", status: "ACTIVE" }
      );
    });

    it("an account cannot approve its own founder claim", async () => {
      const a = state.a!;
      const claim = a.owned.purchase_claims[0];
      assert(!!claim, "Alpha fixture is missing a founder claim");
      unchanged(
        "the fixture claim is pending review",
        "admin-escalation",
        claim.status,
        "PENDING_REVIEW"
      );
      blocked(
        "admin-escalation",
        "A approves its own claim",
        denial(
          "A",
          await a.client.rpc("approve_founder_claim", {
            p_claim_id: claim.claim_id,
          }),
          "Founder review access is not available for this account"
        )
      );
      const { data } = await a.client
        .from("purchase_claims")
        .select("status")
        .eq("claim_id", claim.claim_id)
        .single();
      unchanged(
        "the claim stays PENDING_REVIEW",
        "admin-escalation",
        (data as Row).status,
        "PENDING_REVIEW"
      );
      const { data: entitlement } = await a.client
        .from("entitlements")
        .select("plan, status")
        .eq("user_id", a.userId)
        .single();
      unchanged("the applicant stays FREE", "admin-escalation", entitlement, {
        plan: "FREE",
        status: "ACTIVE",
      });
      const offer = await a.client.rpc("get_founder_offer");
      unchanged(
        "no founder seat was consumed",
        "admin-escalation",
        (rowsOf(offer.data)[0] ?? {}).available_spots,
        50
      );
    });

    // The denials above prove the review surface is closed. This is the
    // matching positive control through a controlled local reviewer fixture:
    // an enrolled account really can run the queue RPCs, so a closed surface
    // is the admin check working rather than the whole path being broken. The
    // reviewer's own tenant reads stay empty, which proves the definer
    // elevation does not widen what the browser role can select.
    it("an enrolled reviewer can run the review RPCs and still sees no foreign rows", async () => {
      const reviewerEmail = emailFor("reviewer");
      const r = await bootstrap("reviewer");
      localAdmin(`begin;
        insert into public.founder_admins (user_id, note)
        select id, 'stage3 reviewer fixture' from auth.users where email = '${reviewerEmail}';
        set local app.dueweave_claim_context = 'CREATE';
        insert into public.purchase_claims (owner_id, claim_id, plan, amount_paise, utr_reference, payer_name, status)
        select id, 'DW-F-REJ' || upper(substr(replace(gen_random_uuid()::text,'-',''),1,10)), 'FOUNDER', 49900, '', '', 'DRAFT'
          from auth.users where email = '${reviewerEmail}';
        set local app.dueweave_claim_context = 'SUBMIT';
        update public.purchase_claims
           set status = 'PENDING_REVIEW', utr_reference = 'REJECTEDREF1', payer_name = 'Reviewer Fixture Payer', submitted_at = now()
         where owner_id = (select id from auth.users where email = '${reviewerEmail}');
        set local app.dueweave_claim_context = 'ADMIN';
        update public.purchase_claims
           set status = 'REJECTED', reviewed_at = now(), reviewed_by = (select id from auth.users where email = '${reviewerEmail}'), review_note = 'stage3 reviewer fixture'
         where owner_id = (select id from auth.users where email = '${reviewerEmail}');
        commit;`);

      const rejected = await r.client.rpc("list_rejected_founder_claims");
      allowed("legitimate-owner", "a reviewer lists the rejected queue", rejected);
      const rows = rowsOf(rejected.data);
      assert(
        rows.length >= 1 && rows.every(row => typeof row.claim_id === "string"),
        `the reviewer fixture claim did not survive the rejected queue projection (${rows.length} rows)`
      );
      unchanged(
        "the rejected queue keeps its declared columns",
        "legitimate-owner",
        Object.keys(rows[0]).sort(),
        [
          "amount_paise",
          "claim_id",
          "owner_email",
          "owner_id",
          "payer_name",
          "rejected_at",
          "rejection_note",
          "utr_reference",
        ]
      );
      allowed(
        "legitimate-owner",
        "a reviewer lists the pending queue",
        await r.client.rpc("list_pending_founder_claims")
      );
      allowed(
        "legitimate-owner",
        "a reviewer reads the funnel",
        await r.client.rpc("get_founder_funnel")
      );
      // Reaching a missing claim proves assert_founder_admin() let the caller
      // past the gate; a non-admin is stopped before that lookup.
      blocked(
        "admin-escalation",
        "a reviewer passes the admin gate and is stopped only by the missing claim",
        denial(
          "R",
          await r.client.rpc("approve_founder_claim", {
            p_claim_id: "DW-F-NOTEXIST0",
          }),
          "This Founder claim is not available"
        )
      );

      const a = state.a!;
      const { data: mine, error } = await r.client.from("clients").select("*");
      assert(!error, `the reviewer's own read failed: ${error?.message}`);
      unchanged("a reviewer holds no client rows of its own", "cross-read", rowsOf(mine).length, 0);
      const aIds = new Set(a.owned.clients.map(row => String(row.id)));
      const leaked = rowsOf(mine).filter(row => aIds.has(String(row.id)));
      blocked("cross-read", "reviewer select A clients", {
        blocked: leaked.length === 0,
        detail: leaked.length
          ? `reviewer read ${leaked.length} of A's client rows`
          : "review access did not widen the reviewer's own row set",
      });
      blocked(
        "admin-escalation",
        "a reviewer still cannot read the audit table directly",
        denial("R", await r.client.from("founder_audit_events").select("*"))
      );
      const { data: selfProfile } = await r.client
        .from("profiles")
        .select("plan")
        .eq("id", r.userId)
        .single();
      unchanged("the reviewer's own plan stays FREE", "admin-escalation", (selfProfile as Row).plan, "FREE");
    });

    // PHASE 15 — immutability ------------------------------------------------
    const immutableProbes: { table: string; column: string }[] = [
      { table: "payments", column: "reference" },
      { table: "activities", column: "note" },
      { table: "promise_events", column: "reason" },
      { table: "promises", column: "note" },
      { table: "receivables", column: "label" },
      { table: "clients", column: "name" },
    ];

    for (const probe of immutableProbes) {
      it(`the owner cannot rewrite or destroy its own ${probe.table} row`, async () => {
        const a = state.a!;
        const target = a.owned[probe.table][0];
        assert(!!target, `fixture is missing a ${probe.table} row`);
        blocked(
          "immutability",
          `A update own ${probe.table}`,
          denial(
            "A",
            await a.client
              .from(probe.table)
              .update({ [probe.column]: "rewritten" })
              .eq("id", target.id)
          )
        );
        blocked(
          "immutability",
          `A delete own ${probe.table}`,
          denial(
            "A",
            await a.client.from(probe.table).delete().eq("id", target.id)
          )
        );
        const { data, error } = await a.client
          .from(probe.table)
          .select(probe.column)
          .eq("id", target.id)
          .single();
        assert(!error, `re-read of ${probe.table} failed: ${error?.message}`);
        unchanged(
          `${probe.table} history survives`,
          "immutability",
          (data as Row)[probe.column],
          target[probe.column]
        );
      });
    }

    it("purchase claim terms stay inside the protected workflow", async () => {
      const a = state.a!;
      const claim = a.owned.purchase_claims[0];
      blocked(
        "immutability",
        "A updates its own claim amount",
        denial(
          "A",
          await a.client
            .from("purchase_claims")
            .update({ amount_paise: 1 })
            .eq("id", claim.id)
        )
      );
      blocked(
        "immutability",
        "A deletes its own claim",
        denial(
          "A",
          await a.client.from("purchase_claims").delete().eq("id", claim.id)
        )
      );
      const { data } = await a.client
        .from("purchase_claims")
        .select("amount_paise")
        .eq("id", claim.id)
        .single();
      unchanged(
        "claim amount unchanged",
        "immutability",
        (data as Row).amount_paise,
        claim.amount_paise
      );
    });

    // PHASE 16 — anonymous surface -------------------------------------------
    for (const table of [...OWNER_TABLES, ...ADMIN_TABLES]) {
      it(`the anonymous role gets nothing from ${table}`, async () => {
        const key = keyOf(table);
        blocked(
          "anonymous",
          `anon select ${table}`,
          denial("anon", await state.anon!.from(table).select("*"))
        );
        blocked(
          "anonymous",
          `anon filtered read ${table}`,
          denial(
            "anon",
            await state
              .anon!.from(table)
              .select(key)
              .eq(key, "00000000-0000-0000-0000-000000000000")
          )
        );
        const count = await state
          .anon!.from(table)
          .select(key, { count: "exact", head: true });
        const leaked = !count.error && (count.count ?? 0) > 0;
        const headOutcome: Outcome = count.error
          ? "refused"
          : leaked
            ? "changed"
            : "unchanged";
        ledger.push({
          category: "anonymous",
          label: `anon head-count ${table}`,
          outcome: headOutcome,
          detail: count.error
            ? `refused with ${count.error.code}`
            : `count=${count.count}`,
        });
        assert(
          !leaked,
          `anon learned ${count.count} row identifiers from ${table}`
        );
      });
    }

    const rpcProbes: { fn: string; args: Record<string, unknown> }[] = [
      { fn: "create_client", args: { p_name: "anon probe" } },
      {
        fn: "create_receivable",
        args: {
          p_client_id: "00000000-0000-0000-0000-000000000000",
          p_label: "x",
          p_invoice_ref: "",
          p_amount_due_paise: 100,
          p_due_date: "2026-09-30",
        },
      },
      {
        fn: "create_client_and_receivable",
        args: {
          p_client_name: "x",
          p_company: "",
          p_phone: "",
          p_email: "",
          p_client_notes: "",
          p_label: "x",
          p_invoice_ref: "",
          p_amount_due_paise: 100,
          p_due_date: "2026-09-30",
          p_notes: "",
        },
      },
      {
        fn: "create_promise",
        args: {
          p_receivable_id: "00000000-0000-0000-0000-000000000000",
          p_promised_amount_paise: 100,
          p_promised_date: "2026-09-30",
          p_source: "CALL",
          p_note: "",
          p_request_id: "00000000-0000-0000-0000-000000000001",
        },
      },
      {
        fn: "record_payment",
        args: {
          p_receivable_id: "00000000-0000-0000-0000-000000000000",
          p_amount_paise: 100,
          p_paid_on: "2026-09-20",
          p_method: "UPI",
          p_reference: "x",
          p_request_id: "00000000-0000-0000-0000-000000000002",
        },
      },
      {
        fn: "record_contacted",
        args: {
          p_receivable_id: "00000000-0000-0000-0000-000000000000",
          p_note: "x",
        },
      },
      {
        fn: "snooze_receivable",
        args: {
          p_receivable_id: "00000000-0000-0000-0000-000000000000",
          p_until: "2026-09-30",
        },
      },
      { fn: "mark_due_promises_broken", args: {} },
      { fn: "get_founder_offer", args: {} },
      { fn: "create_founder_claim", args: {} },
      {
        fn: "submit_founder_payment",
        args: {
          p_claim_id: "DW-F-PROBE000",
          p_utr_reference: "PROBE000001",
          p_payer_name: "Probe Payer",
        },
      },
      { fn: "cancel_founder_claim", args: { p_claim_id: "DW-F-PROBE000" } },
      { fn: "record_founder_upgrade_view", args: {} },
    ];

    for (const probe of rpcProbes) {
      it(`the anonymous role cannot call ${probe.fn}`, async () => {
        blocked(
          "anonymous",
          `anon rpc ${probe.fn}`,
          notCallable("anon", await state.anon!.rpc(probe.fn, probe.args))
        );
      });
    }

    const internalRpcs = [
      "is_founder_admin",
      "assert_founder_admin",
      "delete_my_business_data",
      "handle_new_user",
      "set_updated_at",
      "assert_stage3_client_input",
      "assert_owned_client",
      "guard_promise_history",
      "prevent_immutable_history_changes",
    ];
    for (const name of internalRpcs) {
      it(`the internal helper ${name}() is not a callable RPC`, async () => {
        const a = state.a!;
        blocked(
          "admin-escalation",
          `A rpc ${name}`,
          notCallable("A", await a.client.rpc(name))
        );
        blocked(
          "anonymous",
          `anon rpc ${name}`,
          notCallable("anon", await state.anon!.rpc(name))
        );
      });
    }

    // PHASE 17 — session and token boundary ----------------------------------
    it("isolation follows the access token, not the client instance", async () => {
      const a = state.a!;
      const b = state.b!;
      const asB = newClient(b.accessToken);
      const { data, error } = await asB.from("clients").select("id, owner_id");
      assert(!error, `B's own read failed: ${error?.message}`);
      const seen = rowsOf(data);
      unchanged(
        "A's client invisible through B's token",
        "session-boundary",
        seen.some(row => row.id === a.clientId),
        false
      );
      assert(
        seen.some(row => row.owner_id === b.userId),
        "B cannot even read its own clients"
      );

      const asA = await fetch(`${url}/rest/v1/receivables?select=id,owner_id`, {
        headers: { apikey: anonKey, Authorization: `Bearer ${a.accessToken}` },
      });
      assert(asA.ok, `raw REST read for A failed with ${asA.status}`);
      const body = (await asA.json()) as Row[];
      const leaked = body.filter(row => row.owner_id === b.userId);
      ledger.push({
        category: "session-boundary",
        label: "raw REST as A",
        outcome: leaked.length === 0 ? "refused" : "changed",
        detail: `${leaked.length} of B's receivables returned`,
      });
      assert(
        leaked.length === 0,
        "raw REST returned another account's receivables"
      );

      const anonymousRest = await fetch(`${url}/rest/v1/clients?select=id`, {
        headers: { apikey: anonKey },
      });
      ledger.push({
        category: "session-boundary",
        label: "raw REST without a user token",
        outcome: anonymousRest.status >= 400 ? "refused" : "accepted",
        detail: `HTTP ${anonymousRest.status}`,
      });
      assert(
        anonymousRest.status >= 400,
        `anonymous REST read returned HTTP ${anonymousRest.status}`
      );

      const { data: whoami } = await newClient().auth.getUser();
      ledger.push({
        category: "session-boundary",
        label: "anon key carries no identity",
        outcome: whoami.user ? "changed" : "unchanged",
        detail: whoami.user ? "anonymous key resolved a user" : "no user",
      });
      assert(!whoami.user, "the anon key resolved a signed-in user");
    });

    it("mark_due_promises_broken() only sweeps the caller's own promises", async () => {
      const a = state.a!;
      const b = state.b!;
      allowed(
        "legitimate-owner",
        "A runs its own overdue sweep",
        await a.client.rpc("mark_due_promises_broken")
      );
      const { data } = await b.client.from("promise_events").select("id");
      unchanged(
        "B's promise history untouched by A's sweep",
        "cross-tenant-rpc",
        rowsOf(data).length,
        b.owned.promise_events.length
      );
      const { data: bPromises } = await b.client
        .from("promises")
        .select("status");
      unchanged(
        "B's promise statuses untouched",
        "cross-tenant-rpc",
        rowsOf(bPromises)
          .map(row => row.status)
          .sort(),
        b.owned.promises.map(row => row.status).sort()
      );
    });

    // PHASE 18 — destructive RPC stays closed --------------------------------
    it("the destructive self-delete RPC stays closed and removes nothing", async () => {
      const a = state.a!;
      blocked(
        "immutability",
        "A rpc delete_my_business_data",
        notCallable("A", await a.client.rpc("delete_my_business_data"))
      );
      const { data } = await a.client.from("clients").select("id");
      unchanged(
        "A's business data survives the attempt",
        "immutability",
        rowsOf(data).length,
        a.owned.clients.length
      );
      const { data: receivables } = await a.client
        .from("receivables")
        .select("id");
      assert(rowsOf(receivables).length >= 2, "A's receivables disappeared");
    });

    // Self-check on the evidence itself: a probe that records no outcome would
    // otherwise disappear silently from the reported counts.
    it("every probe produced a classifiable outcome for the ledger", () => {
      const unclassified = ledger.filter(
        entry =>
          !["refused", "accepted", "unchanged", "changed"].includes(
            entry.outcome
          )
      );
      assert(
        unclassified.length === 0,
        `${unclassified.length} ledger entries have no outcome: ${unclassified.map(e => e.label).join(", ")}`
      );
      const attacked = ledger.filter(
        entry => entry.category !== "legitimate-owner"
      );
      assert(
        attacked.every(entry => entry.outcome !== "accepted"),
        "an attack probe was accepted"
      );
      assert(
        attacked.length >= 240,
        `expected a full attack matrix, recorded only ${attacked.length} probes`
      );
    });
  }
);
