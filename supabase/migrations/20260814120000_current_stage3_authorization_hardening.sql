-- Stage 3 (current roadmap) — tenant isolation and authorization hardening.
--
-- Forward-only. This migration changes nothing about table shape, constraints,
-- policies' USING / WITH CHECK predicates or function bodies. It closes the
-- privilege gaps that a fresh replay of the existing history leaves behind,
-- all of which were read from the executed catalog (pg_class.relacl,
-- pg_proc.proacl, pg_policy.polroles, pg_default_acl) rather than inferred
-- from migration text.
--
-- Executed defects reproduced by supabase/tests/stage3_0{1,2}_*.sql:
--   D1  every RLS policy targeted the PUBLIC pseudo-role (polroles = {0})
--       instead of naming a role, so the policy set silently widened to any
--       role a future migration creates.
--   D2  anon held INSERT / UPDATE / DELETE / TRUNCATE / REFERENCES / TRIGGER /
--       MAINTAIN on all ten application tables; isolation then depended on
--       RLS alone.
--   D3  authenticated held write privileges on all seven owner-scoped tables
--       even though the browser writes only through RPCs.
--   D4  25 of 36 public functions were EXECUTE-granted to anon, including
--       approve_founder_claim(), revoke_founder_entitlement() and every
--       trigger guard. PostgREST exposes any executable public function as
--       /rpc/<name>, so this widened the callable attack surface even though
--       each admin RPC still fails its auth.uid() guard at runtime.
--   D5  the eleven trigger guard functions additionally carried a PUBLIC
--       EXECUTE entry.
--   D6  ALTER DEFAULT PRIVILEGES for the migration role installed
--       anon = arwdDxtm on tables and anon = EXECUTE on functions for every
--       future object in public, so D2-D5 would silently return with the next
--       migration.
--   D7  purchase_claims had no owner index: its only owner-scoped index is
--       partial (WHERE status IN ('DRAFT','PENDING_REVIEW')), so an
--       owner-filtered read plans as a sequential scan.
--
-- FORCE ROW LEVEL SECURITY is deliberately NOT enabled. The workflow RPCs are
-- SECURITY DEFINER functions owned by the table owner and must write provenance
-- rows and status transitions the browser is not permitted to write, so the
-- owner path must stay outside policy evaluation. An executed experiment in the
-- Stage 3 report shows why enabling it would buy nothing rather than something:
-- every private table is owned by `postgres`, and that role holds BYPASSRLS,
-- which Postgres honours over FORCE ROW LEVEL SECURITY. With FORCE switched on
-- for profiles/entitlements/clients/activities, an owner-role UPDATE still
-- touched every row of a table that has no UPDATE policy at all, and signup,
-- profile reads and create_client kept working — i.e. FORCE is inert here, and
-- the protection it appears to add would be a comment, not a boundary. The
-- decision is pinned by pgTAP assertions instead of left implicit.

-- ---------------------------------------------------------------------------
-- D1 — name the role each policy applies to. Predicates are untouched.
-- ---------------------------------------------------------------------------
alter policy profiles_select_own on public.profiles to authenticated;
alter policy profiles_update_own on public.profiles to authenticated;
alter policy profiles_delete_own on public.profiles to authenticated;
alter policy clients_owner_all on public.clients to authenticated;
alter policy receivables_select_own on public.receivables to authenticated;
alter policy receivables_update_own on public.receivables to authenticated;
alter policy promises_select_own on public.promises to authenticated;
alter policy payments_select_own on public.payments to authenticated;
alter policy activities_select_own on public.activities to authenticated;
alter policy activities_insert_own on public.activities to authenticated;
alter policy promise_events_select_own on public.promise_events to authenticated;
alter policy entitlements_select_own on public.entitlements to authenticated;
alter policy purchase_claims_select_own on public.purchase_claims to authenticated;
alter policy analytics_owner_select on public.analytics_events to authenticated;
alter policy analytics_owner_insert on public.analytics_events to authenticated;

-- ---------------------------------------------------------------------------
-- D2 / D3 — table privileges reduced to the surface the application uses.
-- Reads are direct; every financial write is an RPC. profiles keeps UPDATE
-- because the owner-scoped business profile edit is a supported product path
-- (RLS WITH CHECK id = auth.uid() plus the plan-immutability guard).
-- ---------------------------------------------------------------------------
revoke all on table public.profiles from anon, authenticated;
revoke all on table public.clients from anon, authenticated;
revoke all on table public.receivables from anon, authenticated;
revoke all on table public.promises from anon, authenticated;
revoke all on table public.payments from anon, authenticated;
revoke all on table public.activities from anon, authenticated;
revoke all on table public.promise_events from anon, authenticated;
revoke all on table public.entitlements from anon, authenticated;
revoke all on table public.purchase_claims from anon, authenticated;
revoke all on table public.analytics_events from anon, authenticated;
revoke all on table public.founder_offer_config from anon, authenticated;
revoke all on table public.founder_admins from anon, authenticated;
revoke all on table public.founder_audit_events from anon, authenticated;

grant select on table public.profiles, public.clients, public.receivables,
    public.promises, public.payments, public.activities, public.promise_events,
    public.entitlements, public.purchase_claims, public.analytics_events to authenticated;
grant update on table public.profiles to authenticated;

-- ---------------------------------------------------------------------------
-- D4 / D5 — function EXECUTE. Internal helpers become owner- and service-only;
-- trigger firing does not depend on the invoker holding EXECUTE, which is the
-- pattern handle_new_user() already relies on.
-- ---------------------------------------------------------------------------
revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.assert_activity_ownership() from public, anon, authenticated;
revoke all on function public.assert_owned_client() from public, anon, authenticated;
revoke all on function public.assert_owned_receivable() from public, anon, authenticated;
revoke all on function public.assert_promise_event_ownership() from public, anon, authenticated;
revoke all on function public.enforce_free_receivable_limit() from public, anon, authenticated;
revoke all on function public.guard_promise_history() from public, anon, authenticated;
revoke all on function public.guard_receivable_financial_fields() from public, anon, authenticated;
revoke all on function public.prevent_direct_purchase_claim_change() from public, anon, authenticated;
revoke all on function public.prevent_immutable_history_changes() from public, anon, authenticated;
revoke all on function public.prevent_profile_entitlement_change() from public, anon, authenticated;
revoke all on function public.is_founder_admin() from public, anon, authenticated;
revoke all on function public.assert_founder_admin() from public, anon, authenticated;

-- Self-scoped founder purchase surface: signed-in only, never anonymous.
revoke all on function public.get_founder_offer() from public, anon;
revoke all on function public.create_founder_claim() from public, anon;
revoke all on function public.submit_founder_payment(text, text, text) from public, anon;
revoke all on function public.cancel_founder_claim(text) from public, anon;
revoke all on function public.record_founder_upgrade_view() from public, anon;

-- Founder review surface: signed-in only. Each routine still calls
-- assert_founder_admin(), so a non-admin session is refused inside the RPC.
revoke all on function public.list_pending_founder_claims() from public, anon;
revoke all on function public.list_rejected_founder_claims() from public, anon;
revoke all on function public.get_founder_funnel() from public, anon;
revoke all on function public.approve_founder_claim(text) from public, anon;
revoke all on function public.reject_founder_claim(text, text) from public, anon;
revoke all on function public.reconsider_founder_claim(text, boolean, text) from public, anon;
revoke all on function public.revoke_founder_entitlement(uuid, text) from public, anon;

grant execute on function public.get_founder_offer() to authenticated;
grant execute on function public.create_founder_claim() to authenticated;
grant execute on function public.submit_founder_payment(text, text, text) to authenticated;
grant execute on function public.cancel_founder_claim(text) to authenticated;
grant execute on function public.record_founder_upgrade_view() to authenticated;
grant execute on function public.list_pending_founder_claims() to authenticated;
grant execute on function public.list_rejected_founder_claims() to authenticated;
grant execute on function public.get_founder_funnel() to authenticated;
grant execute on function public.approve_founder_claim(text) to authenticated;
grant execute on function public.reject_founder_claim(text, text) to authenticated;
grant execute on function public.reconsider_founder_claim(text, boolean, text) to authenticated;
grant execute on function public.revoke_founder_entitlement(uuid, text) to authenticated;

-- ---------------------------------------------------------------------------
-- D7 — the one genuinely missing ownership index.
-- ---------------------------------------------------------------------------
create index if not exists purchase_claims_owner_idx on public.purchase_claims (owner_id);

-- ---------------------------------------------------------------------------
-- D6 — stop future objects inheriting the insecure default. Scoped to the
-- public schema and to the role that applies migrations, so Supabase-managed
-- schemas keep their own defaults.
-- ---------------------------------------------------------------------------
alter default privileges for role postgres in schema public revoke all on tables from public, anon, authenticated;
alter default privileges for role postgres in schema public revoke all on functions from public, anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from public, anon, authenticated;
alter default privileges for role postgres in schema public grant select on tables to authenticated;

comment on table public.profiles is 'Owner-scoped account profile. The browser may read and update its own row; plan and identity columns are guard-trigger protected.';
comment on table public.clients is 'Owner-scoped client records. Direct browser access is read-only; creation runs through create_client().';
comment on table public.receivables is 'Owner-scoped receivables. Direct browser access is read-only; writes run through guarded RPCs.';
comment on table public.founder_admins is 'Founder reviewer roster. No browser-role privilege; membership is managed administratively.';
