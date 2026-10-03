-- Response caching, bucket strategies (with hedging) and free-tier quotas.
-- Additive only: the version running before this keeps working.

-- ---------------------------------------------------------------------------
-- Response cache: an app opts in with a lifetime; identical requests are
-- answered from the stored response. Service role only (no RLS policies).
-- ---------------------------------------------------------------------------

alter table public.apps
  add column cache_ttl_seconds integer
    check (cache_ttl_seconds is null or cache_ttl_seconds between 60 and 604800);

create table public.response_cache (
  app_id uuid not null references public.apps (id) on delete cascade,
  key text not null,
  model_id uuid,
  response jsonb not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  primary key (app_id, key)
);

create index response_cache_expires_idx on public.response_cache (expires_at);

alter table public.response_cache enable row level security;

alter table public.request_logs
  add column cache_hit boolean not null default false;

-- ---------------------------------------------------------------------------
-- Bucket strategies: how a bucket orders its models for each request, and
-- optional hedging (start the next model too if the first is slow).
-- ---------------------------------------------------------------------------

alter table public.app_buckets
  add column strategy text not null default 'ordered'
    check (strategy in ('ordered', 'fastest', 'cheapest', 'spread')),
  add column hedge_after_ms integer
    check (hedge_after_ms is null or hedge_after_ms between 250 and 60000);

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

  insert into public.app_buckets (app_id, name, position, model_ids, strategy, hedge_after_ms)
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
    ),
    coalesce(bucket ->> 'strategy', 'ordered'),
    nullif(bucket ->> 'hedge_after_ms', '')::integer
  from jsonb_array_elements(p_buckets) with ordinality as b(bucket, ordinality);

  update public.apps
  set default_model = p_default, only_bucket_models = p_only_bucket_models
  where id = p_app_id;
end;
$$;

-- Median time to the first token (or the full answer) per model, for
-- "fastest" buckets. Cache hits don't count.
create or replace function public.model_latency_stats(p_since timestamptz)
returns table (model_id uuid, first_ms double precision, samples bigint)
language sql
stable
security definer
set search_path = ''
as $$
  select
    l.model_id,
    percentile_cont(0.5) within group (order by (l.timings ->> 'provider_first')::double precision),
    count(*)
  from public.request_logs l
  where l.created_at >= p_since
    and l.status = 'success'
    and l.model_id is not null
    and not l.cache_hit
    and l.timings ? 'provider_first'
  group by l.model_id;
$$;

revoke execute on function public.model_latency_stats(timestamptz) from public, anon, authenticated;
grant execute on function public.model_latency_stats(timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- Free-tier quotas: request caps per minute / per UTC day on a model, or
-- shared across a provider's models. The gateway skips a model whose cap is
-- reached instead of calling it and getting a 429.
-- ---------------------------------------------------------------------------

alter table public.models
  add column quota_rpm integer check (quota_rpm is null or quota_rpm > 0),
  add column quota_rpd integer check (quota_rpd is null or quota_rpd > 0);

alter table public.providers
  add column quota_rpm integer check (quota_rpm is null or quota_rpm > 0),
  add column quota_rpd integer check (quota_rpd is null or quota_rpd > 0);

create table public.quota_counters (
  scope text not null check (scope in ('model', 'provider')),
  scope_id uuid not null,
  period text not null check (period in ('minute', 'day')),
  period_start timestamptz not null,
  count integer not null default 0,
  primary key (scope, scope_id, period, period_start)
);

alter table public.quota_counters enable row level security;

-- Counts one provider call against the model and its provider.
create or replace function public.bump_quota(p_model uuid, p_provider uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.quota_counters as c (scope, scope_id, period, period_start, count)
  values
    ('model', p_model, 'minute', date_trunc('minute', now()), 1),
    ('model', p_model, 'day', date_trunc('day', now() at time zone 'utc') at time zone 'utc', 1),
    ('provider', p_provider, 'minute', date_trunc('minute', now()), 1),
    ('provider', p_provider, 'day', date_trunc('day', now() at time zone 'utc') at time zone 'utc', 1)
  on conflict (scope, scope_id, period, period_start)
  do update set count = c.count + 1;
$$;

-- Calls so far in the current minute and UTC day.
create or replace function public.current_quota_usage()
returns table (scope text, scope_id uuid, period text, count integer)
language sql
stable
security definer
set search_path = ''
as $$
  select c.scope, c.scope_id, c.period, c.count
  from public.quota_counters c
  where (c.period = 'minute' and c.period_start = date_trunc('minute', now()))
     or (c.period = 'day' and c.period_start = date_trunc('day', now() at time zone 'utc') at time zone 'utc');
$$;

revoke execute on function public.bump_quota(uuid, uuid) from public, anon, authenticated;
revoke execute on function public.current_quota_usage() from public, anon, authenticated;
grant execute on function public.bump_quota(uuid, uuid) to service_role;
grant execute on function public.current_quota_usage() to service_role;
