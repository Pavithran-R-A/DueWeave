-- PostgreSQL does not implicitly coerce varchar columns to the declared text
-- return columns of this PL/pgSQL table function. Keep the reviewer boundary
-- unchanged while making its documented return contract exact.
create or replace function public.list_pending_founder_claims()
returns table (
  claim_id text,
  owner_id uuid,
  owner_email text,
  payer_name text,
  utr_reference text,
  amount_paise bigint,
  submitted_at timestamptz
) language plpgsql security definer stable set search_path = public, auth, pg_temp as $$
begin
  perform public.assert_founder_admin();
  return query select c.claim_id::text, c.owner_id, u.email::text, c.payer_name::text, c.utr_reference::text, c.amount_paise, c.submitted_at
    from public.purchase_claims c join auth.users u on u.id = c.owner_id
    where c.status = 'PENDING_REVIEW' order by c.submitted_at asc;
end;
$$;

revoke all on function public.list_pending_founder_claims() from public;
grant execute on function public.list_pending_founder_claims() to authenticated;
