-- Token-per-minute limits and per-key limits, PII protection, request tags,
-- and an audit log of dashboard changes.

-- ---------------------------------------------------------------------------
-- Limits
-- ---------------------------------------------------------------------------

alter table public.apps
  add column tpm_limit integer check (tpm_limit is null or tpm_limit > 0);

-- A key can be held to less than its app: its own requests and tokens per
-- minute and its own monthly budget.
alter table public.api_keys
  add column rpm_limit integer check (rpm_limit is null or rpm_limit > 0),
  add column tpm_limit integer check (tpm_limit is null or tpm_limit > 0),
  add column monthly_budget_usd numeric(12, 4)
    check (monthly_budget_usd is null or monthly_budget_usd >= 0);

-- Tokens used per minute by an app or a key. (Request counts for both live
-- in rate_limit_counters, keyed by the app or key id.)
create table public.token_counters (
  scope_id uuid not null,
  window_start timestamptz not null,
  tokens bigint not null default 0,
  primary key (scope_id, window_start)
);

alter table public.token_counters enable row level security;

-- Adds a request's tokens to this minute's total and returns the total.
create or replace function public.add_tokens(p_scope uuid, p_tokens integer)
returns bigint
language sql
security definer
set search_path = ''
as $$
  insert into public.token_counters as c (scope_id, window_start, tokens)
  values (p_scope, date_trunc('minute', now()), greatest(p_tokens, 0))
  on conflict (scope_id, window_start)
    do update set tokens = c.tokens + excluded.tokens
  returning c.tokens;
$$;

revoke execute on function public.add_tokens(uuid, integer) from public, anon, authenticated;
grant execute on function public.add_tokens(uuid, integer) to service_role;

create index request_logs_key_created_idx
  on public.request_logs (api_key_id, created_at desc);

create or replace function public.key_spend_since(p_key uuid, p_since timestamptz)
returns numeric
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(cost_usd), 0) from public.request_logs
  where api_key_id = p_key and created_at >= p_since;
$$;

revoke execute on function public.key_spend_since(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.key_spend_since(uuid, timestamptz) to service_role;

-- ---------------------------------------------------------------------------
-- PII protection and request tags
-- ---------------------------------------------------------------------------

-- off: send as is; redact: replace personal data and secrets in prompts with
-- placeholders before they reach a provider; block: refuse such requests.
alter table public.apps
  add column pii_mode text not null default 'off'
    check (pii_mode in ('off', 'redact', 'block'));

alter table public.request_logs
  add column pii_found text[],
  add column tags text[],
  add column end_user text,
  add column metadata jsonb;

create index request_logs_tags_idx on public.request_logs using gin (tags);

-- ---------------------------------------------------------------------------
-- Audit log
-- ---------------------------------------------------------------------------

-- Who changed what in the dashboard. Written by the server with the service
-- role; never updated. Admins read everything, members their own actions.
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  actor_email text not null,
  action text not null,
  target_type text,
  target_id text,
  target_name text,
  summary text not null,
  details jsonb
);

create index audit_log_created_idx on public.audit_log (created_at desc);
create index audit_log_actor_idx on public.audit_log (actor_email, created_at desc);

alter table public.audit_log enable row level security;

create policy "read audit_log" on public.audit_log for select to authenticated
  using (public.is_admin() or actor_email = public.current_email());

create policy "require two-factor" on public.audit_log as restrictive
  for select to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2');

select cron.schedule(
  'gateway-prune-token-counters',
  '*/15 * * * *',
  $$delete from public.token_counters where window_start < now() - interval '10 minutes'$$
);

select cron.schedule(
  'gateway-prune-audit-log',
  '57 3 * * *',
  $$delete from public.audit_log where created_at < now() - interval '1 year'$$
);
