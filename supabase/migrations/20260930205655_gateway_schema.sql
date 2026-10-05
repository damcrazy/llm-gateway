-- LLM Gateway schema
--
-- Access model:
--   * Every table has RLS enabled.
--   * Signed-in admins (public.admins) can SELECT most tables through the
--     dashboard. All writes go through server actions using the service role
--     after an explicit admin check.
--   * provider_secrets and rate_limit_counters have no policies at all, so
--     only the service role (the gateway runtime) can ever touch them.

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Admins (who may use the dashboard)
-- ---------------------------------------------------------------------------

create table public.admins (
  email text primary key check (email = lower(email) and position('@' in email) > 1),
  role text not null default 'admin' check (role in ('superadmin', 'admin')),
  added_by text,
  created_at timestamptz not null default now()
);

-- No one is seeded here: the app makes the SUPERADMIN_EMAIL account the
-- superadmin on its first sign-in (lib/auth.ts).

create or replace function public.protect_superadmin()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' or new.role <> 'superadmin' or new.email <> old.email then
    raise exception 'The superadmin cannot be removed or changed';
  end if;
  return new;
end;
$$;

create trigger admins_protect_superadmin
  before delete or update on public.admins
  for each row
  when (old.role = 'superadmin')
  execute function public.protect_superadmin();

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admins a
    where a.email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;

-- Supabase Auth "before user created" hook: only allow-listed emails can
-- ever get an account. Enable it under Authentication -> Hooks in the
-- dashboard (config.toml does it for local dev).
create or replace function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(coalesce(event -> 'user' ->> 'email', ''));
begin
  if exists (select 1 from public.admins where email = v_email) then
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

grant execute on function public.hook_before_user_created(jsonb) to supabase_auth_admin;
revoke execute on function public.hook_before_user_created(jsonb) from authenticated, anon, public;

-- ---------------------------------------------------------------------------
-- Apps and their API keys
-- ---------------------------------------------------------------------------

create table public.apps (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  description text,
  enabled boolean not null default true,
  -- Route names or model slugs this app may call. Empty = everything.
  allowed_models text[] not null default '{}',
  -- Used when a client sends no model, or "default".
  default_model text,
  monthly_budget_usd numeric(12, 4) check (monthly_budget_usd is null or monthly_budget_usd >= 0),
  rpm_limit integer check (rpm_limit is null or rpm_limit > 0),
  log_payloads boolean not null default false,
  created_by text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger apps_updated_at before update on public.apps
  for each row execute function public.set_updated_at();

create table public.api_keys (
  id uuid primary key default gen_random_uuid(),
  app_id uuid not null references public.apps (id) on delete cascade,
  name text not null,
  -- Only a SHA-256 hash is stored; the plaintext key is shown once.
  key_hash text not null unique,
  key_prefix text not null,
  last_four text not null,
  expires_at timestamptz,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_by text,
  created_at timestamptz not null default now()
);

create index api_keys_app_id_idx on public.api_keys (app_id);

-- ---------------------------------------------------------------------------
-- Providers, credentials, models
-- ---------------------------------------------------------------------------

create table public.providers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique check (slug ~ '^[a-z0-9][a-z0-9-]*$'),
  type text not null check (type in (
    'openai_compatible', 'azure_openai', 'anthropic', 'bedrock', 'vertex', 'google'
  )),
  -- Non-secret settings: base URL, region, project, location, api version, extra headers.
  config jsonb not null default '{}'::jsonb,
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger providers_updated_at before update on public.providers
  for each row execute function public.set_updated_at();

-- AES-256-GCM encrypted credentials. No RLS policies: service role only.
create table public.provider_secrets (
  provider_id uuid primary key references public.providers (id) on delete cascade,
  ciphertext text not null,
  hint text,
  updated_at timestamptz not null default now()
);

create trigger provider_secrets_updated_at before update on public.provider_secrets
  for each row execute function public.set_updated_at();

create table public.models (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers (id) on delete cascade,
  -- The id the provider expects (Azure: deployment name, Bedrock: model/inference profile id).
  model_id text not null,
  -- Public name clients can call directly: "<provider-slug>/<model_id>".
  slug text not null unique,
  display_name text,
  kind text not null default 'chat' check (kind in ('chat', 'embedding')),
  enabled boolean not null default true,
  capabilities text[] not null default '{}',
  tags text[] not null default '{}',
  context_window integer,
  max_output_tokens integer,
  input_price_per_mtok numeric(12, 6) not null default 0,
  output_price_per_mtok numeric(12, 6) not null default 0,
  cached_input_price_per_mtok numeric(12, 6),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider_id, model_id)
);

create index models_model_id_idx on public.models (model_id);

create trigger models_updated_at before update on public.models
  for each row execute function public.set_updated_at();

-- Circuit-breaker state per model, shared by every gateway instance.
create table public.model_health (
  model_id uuid primary key references public.models (id) on delete cascade,
  cooldown_until timestamptz,
  consecutive_failures integer not null default 0,
  last_status integer,
  last_error text,
  last_failure_at timestamptz,
  last_success_at timestamptz,
  updated_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Routes: named aliases ("smart", "fast", "coder") with ordered fallbacks
-- ---------------------------------------------------------------------------

create table public.routes (
  id uuid primary key default gen_random_uuid(),
  -- "default" is reserved: clients send it to mean "the app's default model".
  name text not null unique check (name ~ '^[a-z0-9][a-z0-9._-]*$' and name <> 'default'),
  description text,
  kind text not null default 'chat' check (kind in ('chat', 'embedding')),
  strategy text not null default 'fallback' check (strategy in ('fallback', 'round_robin')),
  max_attempts integer not null default 3 check (max_attempts between 1 and 10),
  timeout_ms integer not null default 600000 check (timeout_ms between 1000 and 3600000),
  first_token_timeout_ms integer not null default 120000 check (first_token_timeout_ms between 1000 and 3600000),
  enabled boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger routes_updated_at before update on public.routes
  for each row execute function public.set_updated_at();

create table public.route_targets (
  id uuid primary key default gen_random_uuid(),
  route_id uuid not null references public.routes (id) on delete cascade,
  model_id uuid not null references public.models (id) on delete cascade,
  position integer not null default 0,
  unique (route_id, model_id)
);

create index route_targets_route_idx on public.route_targets (route_id, position);

-- Replaces a route's targets in one transaction so the gateway never sees an
-- empty route mid-edit.
create or replace function public.replace_route_targets(p_route uuid, p_models uuid[])
returns void
language sql
security definer
set search_path = ''
as $$
  delete from public.route_targets where route_id = p_route;
  insert into public.route_targets (route_id, model_id, position)
  select p_route, model_id, ordinality - 1
  from unnest(p_models) with ordinality as t(model_id, ordinality);
$$;

revoke execute on function public.replace_route_targets(uuid, uuid[]) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Request logs and usage rollups
-- ---------------------------------------------------------------------------

create table public.request_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  app_id uuid references public.apps (id) on delete set null,
  api_key_id uuid references public.api_keys (id) on delete set null,
  endpoint text not null,
  requested_model text,
  route_id uuid references public.routes (id) on delete set null,
  model_id uuid references public.models (id) on delete set null,
  provider_id uuid references public.providers (id) on delete set null,
  upstream_model text,
  status text not null check (status in ('success', 'error')),
  http_status integer,
  error_message text,
  stream boolean not null default false,
  attempts integer not null default 1,
  attempt_log jsonb not null default '[]'::jsonb,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cached_tokens integer not null default 0,
  reasoning_tokens integer not null default 0,
  usage_estimated boolean not null default false,
  cost_usd numeric(14, 8) not null default 0,
  latency_ms integer,
  ttft_ms integer,
  user_agent text
);

create index request_logs_created_idx on public.request_logs (created_at desc);
create index request_logs_app_created_idx on public.request_logs (app_id, created_at desc);
create index request_logs_model_created_idx on public.request_logs (model_id, created_at desc);
create index request_logs_status_created_idx on public.request_logs (status, created_at desc);

-- Full request/response bodies, only for apps with log_payloads = true.
create table public.request_payloads (
  request_id uuid primary key references public.request_logs (id) on delete cascade,
  request jsonb,
  response jsonb,
  created_at timestamptz not null default now()
);

create table public.usage_hourly (
  bucket timestamptz not null,
  app_id uuid,
  api_key_id uuid,
  model_id uuid,
  provider_id uuid,
  requests integer not null default 0,
  errors integer not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  cached_tokens bigint not null default 0,
  cost_usd numeric(16, 8) not null default 0,
  latency_ms_sum bigint not null default 0,
  constraint usage_hourly_key unique nulls not distinct (bucket, app_id, api_key_id, model_id, provider_id)
);

create index usage_hourly_bucket_idx on public.usage_hourly (bucket desc);
create index usage_hourly_app_bucket_idx on public.usage_hourly (app_id, bucket desc);

create or replace function public.rollup_request_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.usage_hourly as u (
    bucket, app_id, api_key_id, model_id, provider_id,
    requests, errors, input_tokens, output_tokens, cached_tokens, cost_usd, latency_ms_sum
  ) values (
    date_trunc('hour', new.created_at), new.app_id, new.api_key_id, new.model_id, new.provider_id,
    1, (new.status = 'error')::int, new.input_tokens, new.output_tokens, new.cached_tokens,
    new.cost_usd, coalesce(new.latency_ms, 0)
  )
  on conflict on constraint usage_hourly_key do update set
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

create trigger request_logs_rollup after insert on public.request_logs
  for each row execute function public.rollup_request_log();

-- ---------------------------------------------------------------------------
-- Gateway runtime functions (service role only)
-- ---------------------------------------------------------------------------

create table public.rate_limit_counters (
  app_id uuid not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (app_id, window_start)
);

-- Increments this minute's counter and returns true while under the limit.
create or replace function public.hit_rate_limit(p_app uuid, p_limit integer)
returns boolean
language sql
security definer
set search_path = ''
as $$
  insert into public.rate_limit_counters as c (app_id, window_start, count)
  values (p_app, date_trunc('minute', now()), 1)
  on conflict (app_id, window_start) do update set count = c.count + 1
  returning c.count <= p_limit;
$$;

create or replace function public.app_spend_since(p_app uuid, p_since timestamptz)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(cost_usd), 0) from public.usage_hourly
  where app_id = p_app and bucket >= date_trunc('hour', p_since);
$$;

create or replace function public.record_model_failure(
  p_model uuid, p_status integer, p_error text, p_cooldown_seconds integer
)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.model_health as h (
    model_id, cooldown_until, consecutive_failures, last_status, last_error, last_failure_at, updated_at
  ) values (
    p_model,
    case when p_cooldown_seconds > 0 then now() + make_interval(secs => p_cooldown_seconds) end,
    1, p_status, left(p_error, 2000), now(), now()
  )
  on conflict (model_id) do update set
    cooldown_until = case
      when p_cooldown_seconds > 0
        then greatest(coalesce(h.cooldown_until, now()), now() + make_interval(secs => p_cooldown_seconds))
      else h.cooldown_until
    end,
    consecutive_failures = h.consecutive_failures + 1,
    last_status = excluded.last_status,
    last_error = excluded.last_error,
    last_failure_at = excluded.last_failure_at,
    updated_at = now();
$$;

create or replace function public.record_model_success(p_model uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.model_health as h (model_id, consecutive_failures, last_success_at, updated_at)
  values (p_model, 0, now(), now())
  on conflict (model_id) do update set
    consecutive_failures = 0,
    cooldown_until = null,
    last_success_at = now(),
    updated_at = now();
$$;

revoke execute on function public.hit_rate_limit(uuid, integer) from public, anon, authenticated;
revoke execute on function public.app_spend_since(uuid, timestamptz) from public, anon, authenticated;
revoke execute on function public.record_model_failure(uuid, integer, text, integer) from public, anon, authenticated;
revoke execute on function public.record_model_success(uuid) from public, anon, authenticated;
revoke execute on function public.rollup_request_log() from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- Dashboard analytics (security invoker: RLS on usage_hourly applies)
-- ---------------------------------------------------------------------------

create or replace function public.usage_timeseries(
  p_since timestamptz, p_interval text default 'hour', p_app uuid default null
)
returns table (
  bucket timestamptz, requests bigint, errors bigint,
  input_tokens bigint, output_tokens bigint, cost_usd numeric
)
language sql
stable
set search_path = ''
as $$
  select
    date_trunc(case when p_interval = 'day' then 'day' else 'hour' end, u.bucket) as bucket,
    sum(u.requests)::bigint, sum(u.errors)::bigint,
    sum(u.input_tokens)::bigint, sum(u.output_tokens)::bigint, sum(u.cost_usd)
  from public.usage_hourly u
  where u.bucket >= date_trunc('hour', p_since)
    and (p_app is null or u.app_id = p_app)
  group by 1
  order by 1;
$$;

create or replace function public.usage_breakdown(
  p_since timestamptz, p_dimension text, p_app uuid default null
)
returns table (
  id uuid, requests bigint, errors bigint, input_tokens bigint,
  output_tokens bigint, cost_usd numeric, avg_latency_ms numeric
)
language sql
stable
set search_path = ''
as $$
  select
    case p_dimension
      when 'app' then u.app_id
      when 'provider' then u.provider_id
      when 'api_key' then u.api_key_id
      else u.model_id
    end as id,
    sum(u.requests)::bigint, sum(u.errors)::bigint,
    sum(u.input_tokens)::bigint, sum(u.output_tokens)::bigint, sum(u.cost_usd),
    round(sum(u.latency_ms_sum)::numeric / nullif(sum(u.requests), 0), 0)
  from public.usage_hourly u
  where u.bucket >= date_trunc('hour', p_since)
    and (p_app is null or u.app_id = p_app)
  group by 1
  order by 6 desc, 2 desc;
$$;

-- ---------------------------------------------------------------------------
-- Row level security
-- ---------------------------------------------------------------------------

alter table public.admins enable row level security;
alter table public.apps enable row level security;
alter table public.api_keys enable row level security;
alter table public.providers enable row level security;
alter table public.provider_secrets enable row level security;
alter table public.models enable row level security;
alter table public.model_health enable row level security;
alter table public.routes enable row level security;
alter table public.route_targets enable row level security;
alter table public.request_logs enable row level security;
alter table public.request_payloads enable row level security;
alter table public.usage_hourly enable row level security;
alter table public.rate_limit_counters enable row level security;

create policy "admins read admins" on public.admins for select to authenticated using (public.is_admin());
create policy "admins read apps" on public.apps for select to authenticated using (public.is_admin());
create policy "admins read api_keys" on public.api_keys for select to authenticated using (public.is_admin());
create policy "admins read providers" on public.providers for select to authenticated using (public.is_admin());
create policy "admins read models" on public.models for select to authenticated using (public.is_admin());
create policy "admins read model_health" on public.model_health for select to authenticated using (public.is_admin());
create policy "admins read routes" on public.routes for select to authenticated using (public.is_admin());
create policy "admins read route_targets" on public.route_targets for select to authenticated using (public.is_admin());
create policy "admins read request_logs" on public.request_logs for select to authenticated using (public.is_admin());
create policy "admins read request_payloads" on public.request_payloads for select to authenticated using (public.is_admin());
create policy "admins read usage_hourly" on public.usage_hourly for select to authenticated using (public.is_admin());

-- Nothing is readable anonymously, and secrets are never readable by a session.
revoke all on public.provider_secrets from anon, authenticated;
revoke all on public.rate_limit_counters from anon, authenticated;
