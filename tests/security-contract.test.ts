import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "..");
const baseMigration = readFileSync(resolve(root, "supabase/migrations/20260812150500_secure_foundation.sql"), "utf8");
const alignedMigration = readFileSync(resolve(root, "supabase/migrations/20260812151500_stage2_schema_alignment.sql"), "utf8");
const rpcGrantMigration = readFileSync(resolve(root, "supabase/migrations/20260812155500_revoke_public_rpc_execution.sql"), "utf8");
const unusedDeleteRpcMigration = readFileSync(resolve(root, "supabase/migrations/20260812160500_revoke_unused_delete_rpc.sql"), "utf8");
const stage3WorkflowMigration = readFileSync(resolve(root, "supabase/migrations/20260812170000_stage3_core_workflows.sql"), "utf8");
const stage4Migration = readFileSync(resolve(root, "supabase/migrations/20260813030000_stage4_founder_monetization.sql"), "utf8");
const stage4HardeningMigration = readFileSync(resolve(root, "supabase/migrations/20260813030500_stage4_harden_admin_helpers.sql"), "utf8");
const stage4DraftConstraintMigration = readFileSync(resolve(root, "supabase/migrations/20260813031500_stage4_drop_legacy_draft_reference_constraint.sql"), "utf8");
const stage4CancellationConstraintMigration = readFileSync(resolve(root, "supabase/migrations/20260813032000_stage4_allow_cancelled_empty_reference.sql"), "utf8");
const stage41ReconsiderationMigration = readFileSync(resolve(root, "supabase/migrations/20260814090000_stage4_1_founder_claim_reconsideration.sql"), "utf8");
const stage42PaymentReadinessMigration = readFileSync(resolve(root, "supabase/migrations/20260814100000_stage4_2_payment_readiness_gate.sql"), "utf8");
const stage42aLivePaymentGateMigration = readFileSync(resolve(root, "supabase/migrations/20260814110000_stage4_2a_live_payment_gate.sql"), "utf8");
const homePage = readFileSync(resolve(root, "client/src/pages/Home.tsx"), "utf8");
const appShell = readFileSync(resolve(root, "client/src/App.tsx"), "utf8");
const authPage = readFileSync(resolve(root, "client/src/pages/Auth.tsx"), "utf8");
const authHook = readFileSync(resolve(root, "client/src/hooks/useSupabaseAuth.ts"), "utf8");
const dashboardRepository = readFileSync(resolve(root, "client/src/data/supabase-dashboard-repository.ts"), "utf8");
const activityRepository = readFileSync(resolve(root, "client/src/data/supabase-activity-repository.ts"), "utf8");
const founderRepository = readFileSync(resolve(root, "client/src/data/supabase-founder-repository.ts"), "utf8");
const founderAdminRepository = readFileSync(resolve(root, "client/src/data/supabase-founder-admin-repository.ts"), "utf8");
const founderPage = readFileSync(resolve(root, "client/src/pages/FounderPurchase.tsx"), "utf8");
const founderAdminPage = readFileSync(resolve(root, "client/src/pages/FounderAdmin.tsx"), "utf8");
const founderPaymentHelper = readFileSync(resolve(root, "client/src/lib/founder-payment.ts"), "utf8");
const sheets = readFileSync(resolve(root, "client/src/components/sheets.tsx"), "utf8");
const financeUi = readFileSync(resolve(root, "client/src/components/finance-ui.tsx"), "utf8");
const schema = `${baseMigration}\n${alignedMigration}\n${rpcGrantMigration}\n${stage3WorkflowMigration}\n${stage4Migration}\n${stage4HardeningMigration}\n${stage4DraftConstraintMigration}\n${stage4CancellationConstraintMigration}\n${stage41ReconsiderationMigration}\n${stage42PaymentReadinessMigration}\n${stage42aLivePaymentGateMigration}`;

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

  it("tells the truth about sign-up, recovery and pending states on the auth screens", () => {
    // A sign-up that returned no session must never read like an open ledger.
    expect(authHook).toMatch(/status: "confirmation-required"/);
    expect(authHook).toMatch(/if \(response\.data\?\.session\) return \{ status: "session" \};/);
    expect(authPage).toMatch(/Confirm your email to open your ledger\./);
    expect(authPage).not.toMatch(/account is ready/i);

    // A recovery route with no session must not render a working-looking password form.
    expect(authPage).toMatch(/mode === "update" && !user/);
    expect(authPage).toMatch(/This recovery link is not active\./);
    expect(authPage).toMatch(/Request a new reset link/);

    // Unusable input is refused inside the form, with live semantics, before the server is asked.
    expect(authPage).toMatch(/aria-invalid=\{Boolean\(fieldErrors\.email\)\}/);
    expect(authPage).toMatch(/id="auth-email-error" role="alert"/);
    expect(authPage).toMatch(/That does not look like an email address yet\./);
    expect(authPage).toMatch(/disabled=\{submitting\}/);
  });

  it("keeps Stage 3 client, receivable, promise-refresh, and snooze workflows authenticated-only", () => {
    for (const rpc of ["create_client", "create_receivable", "create_client_and_receivable", "mark_due_promises_broken", "create_promise", "snooze_receivable"]) {
      expect(stage3WorkflowMigration).toMatch(new RegExp(`revoke all on function public\\.${rpc}`, "i"));
      expect(stage3WorkflowMigration).toMatch(new RegExp(`grant execute on function public\\.${rpc}[^;]* to authenticated`, "i"));
    }
    expect(stage3WorkflowMigration).toMatch(/auth\.uid\(\)/i);
    expect(stage3WorkflowMigration).toMatch(/p_amount_due_paise.*<= 0/s);
    expect(stage3WorkflowMigration).toMatch(/p_promised_amount_paise.*<= 0/s);
    expect(stage3WorkflowMigration).toMatch(/p_promised_amount_paise.*outstanding_paise/s);
    expect(stage3WorkflowMigration).toMatch(/status = 'RENEGOTIATED'/);
    expect(stage3WorkflowMigration).toMatch(/status = 'BROKEN'/);
    expect(stage3WorkflowMigration).toMatch(/insert into public\.promise_events/i);
    expect(stage3WorkflowMigration).toMatch(/snoozed_until/i);
  });

  it("refreshes the authenticated dashboard after standalone client and receivable writes", () => {
    expect(homePage).toMatch(/const created = await clientRepository\.create\(input\);\s*await refresh\(\);\s*setSelectedClientId\(created\.id\)/s);
    expect(homePage).toMatch(/input\.mode === "existing"\s*\? await receivableRepository\.createForClient\(/s);
    expect(homePage).toMatch(/: await receivableRepository\.createWithClient\(input\);\s*await refresh\(\);\s*setSelectedReceivableId\(created\.id\);\s*setSelectedClientId\(created\.clientId\)/s);
  });

  it("passes mapped standalone receivable failures to the actual non-technical UI feedback path", () => {
    expect(homePage).toMatch(/message\.includes\("Free plan allows up to three active receivables"\)/);
    expect(homePage).toMatch(/feedback\.error\("Could not add receivable", \{ description: message \}\)/);
    expect(homePage).toMatch(/new SupabaseReceivableRepository\(\)/);
  });

  it("reads live ledger entities after settling overdue promises as a named write", () => {
    expect(dashboardRepository).toMatch(/async settleDuePromises\(\)[\s\S]*await this\.promises\.markDuePromisesBroken\(\)/);
    expect(dashboardRepository).toMatch(/Promise\.all\(\[this\.clients\.list\(\), this\.receivables\.list\(\), this\.promises\.list\(\), this\.payments\.list\(\), this\.activities\.list\(\)\]\)/);
    expect(homePage).toMatch(/await dashboardRepository\.settleDuePromises\(\);\s*const next = await dashboardRepository\.read\(\);/);
    expect(homePage).toMatch(/Recovered this month/);
    expect(homePage).toMatch(/Expected this week/);
    expect(homePage).toMatch(/Broken promises/);
    expect(homePage).toMatch(/priority is deterministic/i);
  });

  it("persists snoozes and follow-ups while leaving WhatsApp sending under user control", () => {
    expect(activityRepository).toMatch(/supabase\.rpc\("snooze_receivable"/);
    expect(activityRepository).toMatch(/supabase\.rpc\("record_contacted"/);
    expect(homePage).toMatch(/await activityRepository\.recordContacted\(selectedReceivable\.id\); await refresh\(\); setSheet\(null\); feedback\.success\("Follow-up marked"/);
    expect(homePage).toMatch(/onMarkContacted=\{markContacted\}/);
    expect(sheets).toMatch(/https:\/\/wa\.me\//);
    expect(sheets).toMatch(/encodeURIComponent\(message\)/);
    expect(sheets).toMatch(/target="_blank" rel="noreferrer" onClick=\{onMarkContacted\}/);
    expect(sheets).toMatch(/never sent automatically/i);
    expect(financeUi).toMatch(/snoozedUntil/);
  });

  it("keeps Founder monetization tables under RLS with no browser-writable admin allowlist or payment configuration", () => {
    for (const table of ["founder_offer_config", "founder_admins", "founder_audit_events"]) {
      expect(stage4Migration).toMatch(new RegExp(`alter table public\\.${table} enable row level security`, "i"));
    }
    expect(stage4Migration).toMatch(/revoke all on table public\.founder_offer_config, public\.founder_admins, public\.founder_audit_events from anon, authenticated/i);
    expect(stage4Migration).toMatch(/revoke insert, update, delete on table public\.purchase_claims, public\.entitlements, public\.analytics_events from authenticated/i);
    expect(stage4Migration).toMatch(/Server-controlled allowlist for manual Founder claim review/i);
    expect(founderRepository).not.toMatch(/founder_admins/);
    expect(founderRepository).not.toMatch(/founder_offer_config["']\)\.update/);
  });

  it("enforces immutable Founder claim terms, one open claim, duplicate-reference prevention, and a locked 50-seat approval boundary", () => {
    expect(stage4Migration).toMatch(/purchase_claims_claim_id_format_check/);
    expect(stage4Migration).toMatch(/purchase_claims_reference_state_check/);
    expect(stage4Migration).toMatch(/purchase_claims_utr_reference_unique/);
    expect(stage4Migration).toMatch(/purchase_claims_owner_open_unique/);
    expect(stage4Migration).toMatch(/Founder claim history is immutable/);
    expect(stage4Migration).toMatch(/Founder claim identity and offer terms are immutable/);
    expect(stage4Migration).toMatch(/pg_advisory_xact_lock\(hashtext\('dueweave-founder-seat-cap'\)\)/);
    expect(stage4Migration).toMatch(/v_active_count >= v_offer\.founder_cap/);
    expect(stage4Migration).toMatch(/amount_paise bigint not null default 49900 check \(amount_paise = 49900\)/);
    expect(stage4DraftConstraintMigration).toMatch(/drop constraint if exists purchase_claims_provider_external_reference_key/i);
    expect(stage4DraftConstraintMigration).toMatch(/purchase_claims_utr_reference_unique/i);
  });

  it("permits owner cancellation and retry only through guarded workflows while retaining reviewer-only approval and rejection", () => {
    expect(stage4Migration).toMatch(/create or replace function public\.cancel_founder_claim\(p_claim_id text\)/i);
    expect(stage4Migration).toMatch(/Only an unsubmitted claim can be cancelled/);
    expect(stage4Migration).toMatch(/CLAIM_CANCELLED/);
    expect(stage4Migration).toMatch(/status in \('DRAFT', 'PENDING_REVIEW'\)/);
    expect(stage4CancellationConstraintMigration).toMatch(/status in \('DRAFT', 'CANCELLED'\) and utr_reference = '' and payer_name = ''/);
    expect(stage4CancellationConstraintMigration).toMatch(/status in \('PENDING_REVIEW', 'APPROVED', 'REJECTED'\)/);
    expect(stage4Migration).toMatch(/create or replace function public\.approve_founder_claim\(p_claim_id text\)/i);
    expect(stage4Migration).toMatch(/create or replace function public\.reject_founder_claim\(p_claim_id text, p_reason text default null\)/i);
    expect(stage4Migration).toMatch(/perform public\.assert_founder_admin\(\)/g);
    expect(stage4Migration).toMatch(/pg_advisory_xact_lock\(hashtext\('dueweave-founder-seat-cap'\)\)/);
  });

  it("allows only an allowlisted reviewer to idempotently reconsider a rejected claim after explicit bank verification", () => {
    expect(stage41ReconsiderationMigration).toMatch(/create or replace function public\.reconsider_founder_claim\(/i);
    expect(stage41ReconsiderationMigration).toMatch(/perform public\.assert_founder_admin\(\)/i);
    expect(stage41ReconsiderationMigration).toMatch(/p_bank_history_verified is distinct from true/i);
    expect(stage41ReconsiderationMigration).toMatch(/Only a rejected Founder claim can be reconsidered/);
    expect(stage41ReconsiderationMigration).toMatch(/v_context = 'RECONSIDER'/);
    expect(stage41ReconsiderationMigration).toMatch(/new\.utr_reference is distinct from old\.utr_reference/i);
    expect(stage41ReconsiderationMigration).toMatch(/CLAIM_RECONSIDERED/);
    expect(stage41ReconsiderationMigration).toMatch(/CLAIM_APPROVED_AFTER_REVIEW/);
    expect(stage41ReconsiderationMigration).toMatch(/pg_advisory_xact_lock\(hashtext\('dueweave-founder-seat-cap'\)\)/);
    expect(stage41ReconsiderationMigration).toMatch(/v_active_count >= v_offer\.founder_cap/);
    expect(stage41ReconsiderationMigration).toMatch(/revoke all on function public\.reconsider_founder_claim\(text, boolean, text\) from public/i);
    expect(stage41ReconsiderationMigration).toMatch(/grant execute on function public\.reconsider_founder_claim\(text, boolean, text\) to authenticated/i);
  });

  it("permits higher-volume receivables only for an active Founder entitlement and preserves existing records after revocation", () => {
    expect(stage4Migration).toMatch(/coalesce\(v_plan, 'FREE'\) = 'FOUNDER' and v_status = 'ACTIVE'/);
    expect(stage4Migration).toMatch(/only future transitions into active receivable states are gated/i);
    expect(stage4Migration).toMatch(/status = 'REVOKED'/);
    expect(stage4Migration).toMatch(/ENTITLEMENT_REVOKED/);
  });

  it("restricts Founder workflows to authenticated users and admin review to the server-side allowlist", () => {
    for (const rpc of ["get_founder_offer", "create_founder_claim", "submit_founder_payment", "cancel_founder_claim", "record_founder_upgrade_view", "list_pending_founder_claims", "get_founder_funnel", "approve_founder_claim", "reject_founder_claim", "revoke_founder_entitlement"]) {
      expect(stage4Migration).toMatch(new RegExp(`revoke all on function public\\.${rpc}`, "i"));
      expect(stage4Migration).toMatch(new RegExp(`grant execute on function public\\.${rpc}`, "i"));
    }
    expect(stage4Migration).toMatch(/perform public\.assert_founder_admin\(\)/g);
    expect(stage4HardeningMigration).toMatch(/revoke all on function public\.is_founder_admin\(\) from public/i);
    expect(stage4HardeningMigration).toMatch(/revoke all on function public\.assert_founder_admin\(\) from public/i);
    expect(founderAdminRepository).toMatch(/list_pending_founder_claims/);
    expect(founderAdminRepository).toMatch(/approve_founder_claim/);
    expect(founderAdminRepository).toMatch(/revoke_founder_entitlement/);
    expect(founderAdminRepository).toMatch(/list_rejected_founder_claims/);
    expect(founderAdminRepository).toMatch(/reconsider_founder_claim/);
    expect(founderAdminPage).toMatch(/I independently verified this payment in business bank history/);
    expect(founderAdminRepository).toMatch(/p_bank_history_verified: true/);
  });

  it("keeps the customer payment interface truthful and excludes payment credentials, card collection, and client-side approval", () => {
    expect(founderPaymentHelper).toMatch(/offer\.paymentDestinationStatus === "LIVE"/);
    expect(founderPage).toMatch(/Do not send money yet/);
    expect(founderPage).toMatch(/Founder-approved refund terms/);
    expect(founderPage).toMatch(/We do not request, store, or view your UPI PIN, OTP, banking password, card details, or bank credentials/);
    expect(founderPage).toMatch(/manual.*bank-history review/i);
    expect(founderPage).toMatch(/payment reference you provide, the configured offer amount, claim status, and review timestamps/i);
    expect(founderPage).toMatch(/not a debt-collection agency or a source of legal advice/i);
    expect(founderPage).toMatch(/Founder Beta refund terms are drafted but require founder publication approval/i);
    expect(founderPage).toMatch(/operator accounting, tax, or business obligations that require independent confirmation/i);
    expect(founderPage).not.toMatch(/service_role|sb_secret|stripe|razorpay|payment gateway secret/i);
    expect(founderAdminPage).toMatch(/Founder review is restricted/);
    expect(appShell).toContain('path="/founder" component={() => <ProtectedPage Page={FounderPurchase} />');
    expect(appShell).toContain('path="/admin/founder-claims" component={() => <ProtectedPage Page={FounderAdmin} />');
  });

  it("gates real Founder payment instructions on trusted support and founder-approved refund terms", () => {
    expect(stage42PaymentReadinessMigration).toMatch(/support_contact_status text not null default 'PENDING'/i);
    expect(stage42PaymentReadinessMigration).toMatch(/refund_policy_status text not null default 'PENDING_APPROVAL'/i);
    expect(stage42PaymentReadinessMigration).toMatch(/refund_policy_status = 'APPROVED'/i);
    expect(stage42aLivePaymentGateMigration).toMatch(/payment_destination_status in \('PLACEHOLDER', 'TEST', 'LIVE'\)/i);
    expect(stage42aLivePaymentGateMigration).toMatch(/v_offer\.payment_destination_status <> 'LIVE'/i);
    expect(stage42aLivePaymentGateMigration).toMatch(/v_offer\.amount_paise <> 49900/i);
    expect(stage42aLivePaymentGateMigration).toMatch(/v_offer\.disclosures_status <> 'APPROVED'/i);
    expect(stage42PaymentReadinessMigration).toMatch(/v_offer\.support_contact_status <> 'CONFIGURED'/i);
    expect(stage42PaymentReadinessMigration).toMatch(/v_offer\.refund_policy_status <> 'APPROVED'/i);
    expect(stage42PaymentReadinessMigration).toMatch(/revoke all on function public\.get_founder_offer\(\) from public/i);
    expect(founderRepository).not.toMatch(/founder_offer_config["']\)\.update/);
  });
});
