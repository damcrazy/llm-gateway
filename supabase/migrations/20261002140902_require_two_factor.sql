-- Two-factor authentication is required for everyone. A dashboard session can
-- only read data once it has verified an authenticator code (aal2), even when
-- calling the Supabase API directly. The gateway runtime and dashboard server
-- actions use the service role, which RLS doesn't apply to.
do $$
declare
  t text;
begin
  foreach t in array array[
    'members', 'apps', 'api_keys', 'providers', 'models', 'model_health',
    'routes', 'route_targets', 'request_logs', 'request_payloads', 'usage_hourly'
  ] loop
    execute format(
      'create policy "require two-factor" on public.%I as restrictive for select to authenticated using ((select auth.jwt() ->> %L) = %L)',
      t, 'aal', 'aal2'
    );
  end loop;
end
$$;
