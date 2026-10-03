-- Where each request's time went: the provider's share vs the gateway's own
-- (key lookup, limits, routing, retries, streaming). Filled by the gateway's
-- recorder; older rows stay null.
alter table public.request_logs
  add column provider_ms integer,
  add column overhead_ms integer,
  add column timings jsonb;
