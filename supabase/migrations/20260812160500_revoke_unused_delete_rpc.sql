-- Data-deletion UI is not part of Stage 2. Keep this SECURITY DEFINER helper
-- unavailable from PostgREST until a reviewed deletion workflow is introduced.
revoke all on function public.delete_my_business_data() from authenticated;
