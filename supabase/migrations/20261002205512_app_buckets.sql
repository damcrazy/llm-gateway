-- Per-app model buckets. An app names its own buckets ("smart", "paid", …);
-- a client calls one like a model (model: "smart") and the gateway tries the
-- bucket's models in order, switching to the next one when a model fails.
-- Bucket names win over a global route with the same name, for that app.

create table public.app_buckets (
  id uuid primary key default gen_random_uuid(),
  app_id uuid not null references public.apps (id) on delete cascade,
  name text not null
    check (name ~ '^[a-z0-9][a-z0-9._-]*$' and name <> 'default' and char_length(name) <= 40),
  position integer not null default 0,
  -- Model ids in fallback order. Deleted models are skipped when read.
  model_ids uuid[] not null default '{}'
    check (cardinality(model_ids) <= 25),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (app_id, name)
);

create index app_buckets_app_idx on public.app_buckets (app_id, position);

create trigger app_buckets_updated_at before update on public.app_buckets
  for each row execute function public.set_updated_at();

alter table public.app_buckets enable row level security;

create policy "read app_buckets" on public.app_buckets for select to authenticated
  using (
    public.is_admin()
    or exists (
      select 1 from public.apps a
      where a.id = app_id and a.owner_email = public.current_email()
    )
  );

create policy "require two-factor" on public.app_buckets as restrictive
  for select to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2');

-- On: the app may only call its bucket names and the models in them.
-- Off: it may also call any model or route its owner can use.
alter table public.apps add column only_bucket_models boolean not null default false;

-- Replaces an app's buckets, default and access mode in one transaction.
-- Called by the dashboard's server action after it checks ownership.
create or replace function public.save_app_buckets(
  p_app_id uuid,
  p_buckets jsonb,
  p_default text,
  p_only_bucket_models boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  delete from public.app_buckets where app_id = p_app_id;

  insert into public.app_buckets (app_id, name, position, model_ids)
  select
    p_app_id,
    bucket ->> 'name',
    (ordinality - 1)::integer,
    coalesce(
      array(
        select value::uuid
        from jsonb_array_elements_text(bucket -> 'model_ids') with ordinality as m(value, n)
        order by n
      ),
      '{}'
    )
  from jsonb_array_elements(p_buckets) with ordinality as b(bucket, ordinality);

  update public.apps
  set default_model = p_default, only_bucket_models = p_only_bucket_models
  where id = p_app_id;
end;
$$;

revoke execute on function public.save_app_buckets(uuid, jsonb, text, boolean) from public, anon, authenticated;
grant execute on function public.save_app_buckets(uuid, jsonb, text, boolean) to service_role;

-- Apps that had an allow-list get it as a bucket named "allowed" (routes
-- expanded into their models, in order) and keep the same restriction.
insert into public.app_buckets (app_id, name, position, model_ids)
select
  a.id,
  'allowed',
  0,
  (array(
    select model_id
    from (
      select model_id, min(sort_key) as sort_key
      from (
        select m.id as model_id, e.n * 1000 as sort_key
        from unnest(a.allowed_models) with ordinality as e(value, n)
        join public.models m on m.slug = e.value
        union all
        select t.model_id, e.n * 1000 + t.position
        from unnest(a.allowed_models) with ordinality as e(value, n)
        join public.routes r on r.name = e.value
        join public.route_targets t on t.route_id = r.id
      ) entries
      group by model_id
    ) deduped
    order by sort_key
  ))[1:25]
from public.apps a
where cardinality(a.allowed_models) > 0;

update public.apps set only_bucket_models = true where cardinality(allowed_models) > 0;
