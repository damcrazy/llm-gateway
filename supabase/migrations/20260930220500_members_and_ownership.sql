-- Members: people who use the gateway without administering it.
--
--   superadmin  everything, including managing people
--   admin       everything except managing people
--   member      their own apps, keys, usage and logs; limited to the models
--               the superadmin allows (model_access) and an optional budget
--
-- Every app now has an owner. Usage rows record the owner too, so deleting an
-- app doesn't reset a member's monthly spend, and members see only their own.

-- ---------------------------------------------------------------------------
-- admins -> members
-- ---------------------------------------------------------------------------

alter table public.admins rename to members;
alter table public.members rename constraint admins_pkey to members_pkey;
alter table public.members rename constraint admins_email_check to members_email_check;
alter table public.members drop constraint admins_role_check;
alter table public.members
  add constraint members_role_check check (role in ('superadmin', 'admin', 'member'));
alter trigger admins_protect_superadmin on public.members rename to members_protect_superadmin;

alter table public.members
  add column model_access text not null default 'all'
    check (model_access in ('all', 'free', 'allowlist')),
  add column allowed_models text[] not null default '{}',
  add column monthly_budget_usd numeric(12, 4)
    check (monthly_budget_usd is null or monthly_budget_usd >= 0);

-- ---------------------------------------------------------------------------
-- Identity helpers used by RLS
-- ---------------------------------------------------------------------------

create or replace function public.current_email()
returns text
language sql
stable
set search_path = ''
as $$
  select lower(coalesce(auth.jwt() ->> 'email', ''));
$$;

create or replace function public.current_member_role()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select m.role from public.members m where m.email = public.current_email();
$$;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.current_member_role() in ('superadmin', 'admin'), false);
$$;

create or replace function public.is_member()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select public.current_member_role() is not null;
$$;

revoke execute on function public.current_member_role() from public, anon;
revoke execute on function public.is_admin() from public, anon;
revoke execute on function public.is_member() from public, anon;
grant execute on function public.current_email() to authenticated;
grant execute on function public.current_member_role() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.is_member() to authenticated;

-- The sign-up hook now reads members (the old body referenced admins).
create or replace function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(coalesce(event -> 'user' ->> 'email', ''));
begin
  if exists (select 1 from public.members where email = v_email) then
    return '{}'::jsonb;
  end if;
  return jsonb_build_object(
    'error', jsonb_build_object(
      'http_code', 403,
      'message', 'This gateway is private. Ask the owner to add your email.'
    )
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Ownership
-- ---------------------------------------------------------------------------

alter table public.apps
  add column owner_email text references public.members (email)
    on update cascade on delete cascade;
update public.apps
set owner_email = (select email from public.members where role = 'superadmin' limit 1)
where owner_email is null;
alter table public.apps alter column owner_email set not null;
create index apps_owner_idx on public.apps (owner_email);

alter table public.request_logs add column owner_email text;
update public.request_logs l set owner_email = a.owner_email
from public.apps a where a.id = l.app_id and l.owner_email is null;
create index request_logs_owner_created_idx on public.request_logs (owner_email, created_at desc);

alter table public.usage_hourly add column owner_email text;
update public.usage_hourly u set owner_email = a.owner_email
from public.apps a where a.id = u.app_id and u.owner_email is null;
create index usage_hourly_owner_bucket_idx on public.usage_hourly (owner_email, bucket desc);

create or replace function public.rollup_request_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.usage_hourly as u (
    bucket, app_id, api_key_id, model_id, provider_id, owner_email,
    requests, errors, input_tokens, output_tokens, cached_tokens, cost_usd, latency_ms_sum
  ) values (
    date_trunc('hour', new.created_at), new.app_id, new.api_key_id, new.model_id, new.provider_id,
    new.owner_email,
    1, (new.status = 'error')::int, new.input_tokens, new.output_tokens, new.cached_tokens,
    new.cost_usd, coalesce(new.latency_ms, 0)
  )
  on conflict on constraint usage_hourly_key do update set
    owner_email = coalesce(u.owner_email, excluded.owner_email),
    requests = u.requests + excluded.requests,
    errors = u.errors + excluded.errors,
    input_tokens = u.input_tokens + excluded.input_tokens,
    output_tokens = u.output_tokens + excluded.output_tokens,
    cached_tokens = u.cached_tokens + excluded.cached_tokens,
    cost_usd = u.cost_usd + excluded.cost_usd,
    latency_ms_sum = u.latency_ms_sum + excluded.latency_ms_sum;
  return new;
end;
$$;

-- A member's spend across all their apps, including deleted ones.
create or replace function public.member_spend_since(p_email text, p_since timestamptz)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(cost_usd), 0) from public.usage_hourly
  where owner_email = lower(p_email) and bucket >= date_trunc('hour', p_since);
$$;

revoke execute on function public.member_spend_since(text, timestamptz) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Row level security: admins see everything, members see their own
-- ---------------------------------------------------------------------------

drop policy "admins read admins" on public.members;
create policy "read members" on public.members for select to authenticated
  using (public.is_admin() or email = public.current_email());

drop policy "admins read apps" on public.apps;
create policy "read apps" on public.apps for select to authenticated
  using (public.is_admin() or owner_email = public.current_email());

drop policy "admins read api_keys" on public.api_keys;
create policy "read api_keys" on public.api_keys for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.apps a
      where a.id = app_id and a.owner_email = public.current_email()
    )
  );

-- Members may see the catalogue of models and routes (not providers).
drop policy "admins read models" on public.models;
create policy "read models" on public.models for select to authenticated
  using (public.is_member());
drop policy "admins read routes" on public.routes;
create policy "read routes" on public.routes for select to authenticated
  using (public.is_member());
drop policy "admins read route_targets" on public.route_targets;
create policy "read route_targets" on public.route_targets for select to authenticated
  using (public.is_member());
drop policy "admins read model_health" on public.model_health;
create policy "read model_health" on public.model_health for select to authenticated
  using (public.is_member());

drop policy "admins read request_logs" on public.request_logs;
create policy "read request_logs" on public.request_logs for select to authenticated
  using (public.is_admin() or owner_email = public.current_email());

drop policy "admins read request_payloads" on public.request_payloads;
create policy "read request_payloads" on public.request_payloads for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.request_logs l
      where l.id = request_id and l.owner_email = public.current_email()
    )
  );

drop policy "admins read usage_hourly" on public.usage_hourly;
create policy "read usage_hourly" on public.usage_hourly for select to authenticated
  using (public.is_admin() or owner_email = public.current_email());
