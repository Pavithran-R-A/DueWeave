-- Supabase/PostgREST exposes public-schema functions through RPC. PostgreSQL's
-- default EXECUTE grant to PUBLIC must be removed again whenever a function is
-- replaced or recreated. Only the four user-facing transactional workflows are
-- callable by signed-in users; trigger and maintenance helpers are not exposed.

revoke all on function public.create_client_and_receivable(text, text, text, text, text, text, text, bigint, date, text) from public, anon;
revoke all on function public.create_promise(uuid, bigint, date, text, text) from public, anon;
revoke all on function public.record_payment(uuid, bigint, date, text, text, text) from public, anon;
revoke all on function public.record_contacted(uuid, text) from public, anon;
revoke all on function public.delete_my_business_data() from public, anon;
revoke all on function public.handle_new_user() from public, anon, authenticated;

grant execute on function public.create_client_and_receivable(text, text, text, text, text, text, text, bigint, date, text) to authenticated;
grant execute on function public.create_promise(uuid, bigint, date, text, text) to authenticated;
grant execute on function public.record_payment(uuid, bigint, date, text, text, text) to authenticated;
grant execute on function public.record_contacted(uuid, text) to authenticated;
