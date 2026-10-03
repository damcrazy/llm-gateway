-- Alerts: budget thresholds, failing models and slow responses. Shown in the
-- dashboard and, if the person adds one, posted to a webhook (Slack, Discord
-- or any URL that accepts JSON). Trace export: each request sent to the
-- person's Langfuse project or OpenTelemetry collector.
--
-- Settings are per person. Only the service role touches the settings tables
-- (the webhook URL and export keys are stored encrypted); people read their
-- own alerts.

create table public.alert_settings (
  owner_email text primary key,
  -- Warn when an app (or the person's own monthly budget) passes this share.
  budget_percent integer not null default 80
    check (budget_percent between 10 and 99),
  notify_model_down boolean not null default true,
  -- Warn when an app's median response time over 15 minutes is above this.
  latency_threshold_ms integer
    check (latency_threshold_ms between 100 and 600000),
  webhook_secret text,
  webhook_hint text,
  updated_at timestamptz not null default now()
);

create table public.alerts (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  owner_email text not null,
  kind text not null check (kind in ('budget', 'model_down', 'latency', 'test')),
  severity text not null default 'warning'
    check (severity in ('info', 'warning', 'critical')),
  title text not null,
  body text not null default '',
  app_id uuid references public.apps (id) on delete cascade,
  model_id uuid references public.models (id) on delete set null,
  -- One alert per condition and period, e.g. budget:app:<id>:2026-10:80.
  dedupe_key text not null,
  read_at timestamptz,
  -- null: no webhook; 'sent'; otherwise why posting it failed.
  delivery text
);

create unique index alerts_dedupe_idx on public.alerts (owner_email, dedupe_key);
create index alerts_owner_created_idx on public.alerts (owner_email, created_at desc);

create table public.trace_exports (
  owner_email text primary key,
  langfuse_enabled boolean not null default false,
  langfuse_host text,
  langfuse_public_key text,
  langfuse_secret text,
  otel_enabled boolean not null default false,
  otel_endpoint text,
  otel_headers_secret text,
  otel_headers_hint text,
  last_success_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.alert_settings enable row level security;
alter table public.alerts enable row level security;
alter table public.trace_exports enable row level security;

create policy "read own alerts" on public.alerts for select to authenticated
  using (owner_email = public.current_email());

create policy "require two-factor" on public.alerts as restrictive
  for select to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2');

-- An app's typical response time: the median of time to first token (or the
-- whole call when there is none) over recent successful, uncached calls.
create or replace function public.app_response_p50(p_app uuid, p_since timestamptz)
returns table (p50 double precision, samples integer)
language sql
stable
security definer
set search_path = ''
as $$
  select
    percentile_cont(0.5) within group (order by coalesce(ttft_ms, latency_ms))::double precision,
    count(*)::integer
  from public.request_logs
  where app_id = p_app
    and created_at >= p_since
    and status = 'success'
    and not coalesce(cache_hit, false)
$$;

revoke execute on function public.app_response_p50(uuid, timestamptz) from public, anon, authenticated;
grant execute on function public.app_response_p50(uuid, timestamptz) to service_role;

select cron.schedule(
  'gateway-prune-alerts',
  '37 3 * * *',
  $$delete from public.alerts where created_at < now() - interval '90 days'$$
);

select cron.schedule(
  'gateway-prune-quota-counters',
  '47 3 * * *',
  $$delete from public.quota_counters where period_start < now() - interval '2 days'$$
);

select cron.schedule(
  'gateway-prune-response-cache',
  '7 * * * *',
  $$delete from public.response_cache where expires_at < now()$$
);
