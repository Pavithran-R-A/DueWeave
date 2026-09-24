-- Internal authorization helpers are invoked only by protected security-definer workflows.
-- They are not part of the browser RPC surface.
revoke all on function public.is_founder_admin() from public;
revoke all on function public.assert_founder_admin() from public;
