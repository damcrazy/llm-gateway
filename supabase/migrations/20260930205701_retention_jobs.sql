-- Keep the free-tier database small. usage_hourly (the analytics source) is kept forever;
-- raw request logs for 30 days, stored payloads for 7 days.
create extension if not exists pg_cron;

select cron.schedule(
  'gateway-prune-request-logs',
  '17 3 * * *',
  $$delete from public.request_logs where created_at < now() - interval '30 days'$$
);

select cron.schedule(
  'gateway-prune-request-payloads',
  '27 3 * * *',
  $$delete from public.request_payloads where created_at < now() - interval '7 days'$$
);

select cron.schedule(
  'gateway-prune-rate-limits',
  '*/15 * * * *',
  $$delete from public.rate_limit_counters where window_start < now() - interval '10 minutes'$$
);
