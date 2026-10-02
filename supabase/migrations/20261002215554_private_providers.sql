-- Members can connect their own providers. A provider with an owner is
-- private: only that member sees it, and only their apps can use its models.
-- Providers without an owner are shared and managed by admins, as before.

alter table public.providers
  add column owner_email text references public.members (email)
    on update cascade on delete cascade;

create index providers_owner_idx on public.providers (owner_email);

-- Admins see every provider (to keep the gateway in order); members see only
-- their own. Credentials stay in provider_secrets, readable by nobody.
-- (Policies are altered in place: no moment without one.)
alter policy "admins read providers" on public.providers rename to "read providers";
alter policy "read providers" on public.providers
  using (public.is_admin() or owner_email = public.current_email());

-- Whether the signed-in person may see a provider's models: shared ones are
-- the catalogue every member may browse; a private one is visible to its
-- owner (and admins). Security definer because members can't read the
-- providers table itself, and a policy subquery would be filtered by it.
create or replace function public.can_see_provider(p_provider_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.providers p
    where p.id = p_provider_id
      and (
        (p.owner_email is null and public.is_member())
        or p.owner_email = public.current_email()
        or public.is_admin()
      )
  );
$$;

create or replace function public.can_see_model(p_model_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (select public.can_see_provider(m.provider_id) from public.models m where m.id = p_model_id),
    false
  );
$$;

revoke execute on function public.can_see_provider(uuid) from public, anon;
revoke execute on function public.can_see_model(uuid) from public, anon;
grant execute on function public.can_see_provider(uuid) to authenticated;
grant execute on function public.can_see_model(uuid) to authenticated;

alter policy "read models" on public.models
  using (public.can_see_provider(provider_id));

-- Health (including the last upstream error) follows the same rule.
alter policy "read model_health" on public.model_health
  using (public.can_see_model(model_id));

-- The monthly budget the superadmin sets for a member covers shared
-- providers only: a member pays their own providers directly.
create or replace function public.member_spend_since(p_email text, p_since timestamptz)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(u.cost_usd), 0)
  from public.usage_hourly u
  where u.owner_email = lower(p_email)
    and u.bucket >= date_trunc('hour', p_since)
    and not exists (
      select 1 from public.providers p
      where p.id = u.provider_id and p.owner_email is not null
    );
$$;

revoke execute on function public.member_spend_since(text, timestamptz) from public, anon, authenticated;
