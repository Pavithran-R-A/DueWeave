-- Stage 3 (current roadmap) — hoist the request user out of every RLS predicate.
--
-- Forward-only. No table, grant, policy role, policy command or predicate
-- *meaning* changes: each policy keeps comparing the same owner column to the
-- same auth.uid() value. Only the evaluation strategy changes — from a
-- per-row re-read of the request JWT settings to one InitPlan per statement.
--
-- Executed defect D9, reproduced first as failing pgTAP assertions
-- (supabase/tests/stage3_01_rls_structure.sql section G):
--
--   `supabase db advisors --local --type performance` returned 15 findings, all
--   auth_rls_initplan / WARN / facing EXTERNAL — one for each owner policy in
--   public (13 USING clauses + 5 WITH CHECK clauses over 15 policies), and
--   `supabase db advisors --local --type security` returned "No issues found".
--
-- Measured cost, local stack, synthetic 20,005-row clients table, index scans
-- disabled so the policy predicate is reached as a per-row filter, read as an
-- authenticated principal whose JWT subject owns none of those rows:
--
--   before  Seq Scan ... Rows Removed by Filter: 20005   Execution Time 21.1-26.3 ms
--           Filter: (owner_id = (COALESCE(NULLIF(current_setting('request.jwt.claim.sub'...
--                     ...((NULLIF(current_setting('request.jwt.claims'...))::jsonb ->> 'sub')))::uuid)
--
-- A bare auth.uid() is a SQL-language function, so the planner inlines its body
-- into the filter and the settings lookup, NULLIF, jsonb arrow and uuid cast run
-- once per candidate row. Wrapped in a scalar sub-select it becomes an InitPlan
-- evaluated once for the statement, which is the form Supabase documents.
--
-- Verified against the catalog before writing this file: ALTER POLICY with only
-- a USING clause leaves an existing WITH CHECK predicate untouched (measured:
-- clients_owner_all kept `(owner_id = auth.uid())` in polwithcheck), so every
-- statement below restates both clauses explicitly.
--
-- The predicate text is written column-first so the deparsed form stays
-- (owner_id = ( SELECT auth.uid() AS uid)), which is what section G now pins.

alter policy "profiles_select_own" on "public"."profiles"
  to "authenticated"
  using ("id" = (select "auth"."uid"()));

alter policy "profiles_update_own" on "public"."profiles"
  to "authenticated"
  using ("id" = (select "auth"."uid"()))
  with check ("id" = (select "auth"."uid"()));

alter policy "profiles_delete_own" on "public"."profiles"
  to "authenticated"
  using ("id" = (select "auth"."uid"()));

alter policy "clients_owner_all" on "public"."clients"
  to "authenticated"
  using ("owner_id" = (select "auth"."uid"()))
  with check ("owner_id" = (select "auth"."uid"()));

alter policy "receivables_select_own" on "public"."receivables"
  to "authenticated"
  using ("owner_id" = (select "auth"."uid"()));

alter policy "receivables_update_own" on "public"."receivables"
  to "authenticated"
  using ("owner_id" = (select "auth"."uid"()))
  with check ("owner_id" = (select "auth"."uid"()));

alter policy "promises_select_own" on "public"."promises"
  to "authenticated"
  using ("owner_id" = (select "auth"."uid"()));

alter policy "payments_select_own" on "public"."payments"
  to "authenticated"
  using ("owner_id" = (select "auth"."uid"()));

alter policy "activities_select_own" on "public"."activities"
  to "authenticated"
  using ("owner_id" = (select "auth"."uid"()));

alter policy "activities_insert_own" on "public"."activities"
  to "authenticated"
  with check ("owner_id" = (select "auth"."uid"()));

alter policy "promise_events_select_own" on "public"."promise_events"
  to "authenticated"
  using ("owner_id" = (select "auth"."uid"()));

alter policy "entitlements_select_own" on "public"."entitlements"
  to "authenticated"
  using ("user_id" = (select "auth"."uid"()));

alter policy "purchase_claims_select_own" on "public"."purchase_claims"
  to "authenticated"
  using ("owner_id" = (select "auth"."uid"()));

alter policy "analytics_owner_select" on "public"."analytics_events"
  to "authenticated"
  using ("owner_id" = (select "auth"."uid"()));

alter policy "analytics_owner_insert" on "public"."analytics_events"
  to "authenticated"
  with check ("owner_id" = (select "auth"."uid"()));

comment on policy "clients_owner_all" on "public"."clients" is
  'Owner-scoped by a hoisted (select auth.uid()) InitPlan so the request user is resolved once per statement rather than once per row (Stage 3 D9).';
