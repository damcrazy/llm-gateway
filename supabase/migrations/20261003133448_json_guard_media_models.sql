-- Structured-output guard, and models for image generation, text to speech,
-- transcription and reranking (each called through its own endpoint).

-- Check JSON answers against the requested format and fail over if invalid.
alter table public.apps
  add column json_guard boolean not null default false;

alter table public.models drop constraint models_kind_check;
alter table public.models add constraint models_kind_check
  check (kind in ('chat', 'embedding', 'image', 'speech', 'transcription', 'rerank'));

-- Price for models that aren't billed by the token: per image, per 1,000
-- characters of speech, per minute of audio transcribed, or per search.
alter table public.models
  add column unit_price_usd numeric(12, 6)
    check (unit_price_usd is null or unit_price_usd >= 0);
