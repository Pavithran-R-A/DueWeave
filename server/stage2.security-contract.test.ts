import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const baseMigration = readFileSync(resolve(root, "supabase/migrations/20260812150500_secure_foundation.sql"), "utf8");
const alignedMigration = readFileSync(resolve(root, "supabase/migrations/20260812151500_stage2_schema_alignment.sql"), "utf8");
const rpcGrantMigration = readFileSync(resolve(root, "supabase/migrations/20260812155500_revoke_public_rpc_execution.sql"), "utf8");
const unusedDeleteRpcMigration = readFileSync(resolve(root, "supabase/migrations/20260812160500_revoke_unused_delete_rpc.sql"), "utf8");
const homePage = readFileSync(resolve(root, "client/src/pages/Home.tsx"), "utf8");
const appShell = readFileSync(resolve(root, "client/src/App.tsx"), "utf8");
const authPage = readFileSync(resolve(root, "client/src/pages/Auth.tsx"), "utf8");
const authHook = readFileSync(resolve(root, "client/src/hooks/useSupabaseAuth.ts"), "utf8");
const schema = `${baseMigration}\n${alignedMigration}\n${rpcGrantMigration}`;

describe("Stage 2 Supabase security contract", () => {
  it("enables RLS across every private business table", () => {
    for (const table of ["profiles", "clients", "receivables", "promises", "payments", "activities", "promise_events", "entitlements", "purchase_claims", "analytics_events"]) {
      expect(schema).toMatch(new RegExp(`alter table public\\.${table} enable row level security`, "i"));
    }
  });

  it("uses auth.uid ownership policies rather than permissive private-table policies", () => {
    expect(schema).not.toMatch(/create policy[^;]*(profiles|clients|receivables|promises|payments|activities|promise_events|entitlements|purchase_claims)[^;]*using\s*\(\s*true\s*\)/i);
    expect(schema).toMatch(/owner_id\s*=\s*auth\.uid\(\)/i);
    expect(schema).toMatch(/user_id\s*=\s*auth\.uid\(\)/i);
  });

  it("keeps privileged workflow functions authenticated-only and documents immutable histories", () => {
    for (const rpc of ["create_client_and_receivable", "create_promise", "record_payment", "record_contacted"]) {
      expect(schema).toMatch(new RegExp(`revoke all on function public\\.${rpc}`, "i"));
      expect(schema).toMatch(new RegExp(`grant execute on function public\\.${rpc}[^;]* to authenticated`, "i"));
    }
    expect(schema).toMatch(/prevent_immutable_history_changes/i);
    expect(schema).toMatch(/receivables_free_limit/i);
    expect(schema).toMatch(/profiles_prevent_plan_change/i);
    expect(rpcGrantMigration).toMatch(/revoke all on function public\.create_client_and_receivable[^;]* from public, anon/i);
    expect(rpcGrantMigration).toMatch(/revoke all on function public\.handle_new_user\(\) from public, anon, authenticated/i);
    expect(unusedDeleteRpcMigration).toMatch(/revoke all on function public\.delete_my_business_data\(\) from authenticated/i);
  });

  it("keeps prototype fixtures out of the authenticated application page", () => {
    expect(homePage).not.toMatch(/from ["']@\/data\/demo["']/);
    expect(homePage).not.toMatch(/createDemoState/);
    expect(homePage).toMatch(/SupabaseDashboardRepository/);
  });

  it("keeps the approved live dashboard resilient for loading, failure, and first-user states", () => {
    expect(homePage).toMatch(/LoadingState/);
    expect(homePage).toMatch(/ErrorState/);
    expect(homePage).toMatch(/EmptyStateCard/);
  });

  it("protects the private ledger and redirects stale sessions outside the render phase", () => {
    expect(appShell).toMatch(/<Route path="\/auth" component=\{AuthRoute\}/);
    expect(appShell).toMatch(/<Route path="\/" component=\{ProtectedHome\}/);
    expect(appShell).toMatch(/useEffect\(\(\) => \{\s*if \(!loading && !isAuthenticated\) navigate\("\/auth"/s);
    expect(appShell).toMatch(/if \(!loading && isAuthenticated\) navigate\("\/"/);
    expect(appShell).toMatch(/SessionLoading/);
  });

  it("keeps email/password recovery actions and friendly failure copy behind the Supabase Auth hook", () => {
    expect(authHook).toMatch(/signInWithPassword/);
    expect(authHook).toMatch(/signUp\(/);
    expect(authHook).toMatch(/signOut\(/);
    expect(authHook).toMatch(/resetPasswordForEmail/);
    expect(authHook).toMatch(/updateUser\(\{ password \}\)/);
    expect(authHook).toMatch(/We could not complete that request\. Please try again\./);
    expect(authPage).toMatch(/Forgot password\?/);
    expect(authPage).toMatch(/Create an account/);
    expect(authHook).toMatch(/auth\/update-password/);
    expect(authPage).toMatch(/We never display technical database errors here\./);
  });
});
