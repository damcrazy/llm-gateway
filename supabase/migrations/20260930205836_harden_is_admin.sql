-- is_admin() is SECURITY DEFINER and used inside RLS policies, so signed-in
-- users must be able to execute it; anonymous callers never need it.
revoke execute on function public.is_admin() from public, anon;
grant execute on function public.is_admin() to authenticated;
