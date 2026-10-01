-- A null price now means "unknown", so $0 can mean "free". Lets the dashboard
-- separate free, paid and unpriced models.
alter table public.models
  alter column input_price_per_mtok drop not null,
  alter column input_price_per_mtok drop default,
  alter column output_price_per_mtok drop not null,
  alter column output_price_per_mtok drop default;

-- Unknown prices used to be stored as 0. Keep $0 only where it is known to be
-- free: OpenRouter reports real prices (its ":free" models are $0), and local
-- servers (Ollama, LM Studio) cost nothing.
update public.models m
set input_price_per_mtok = null,
    output_price_per_mtok = null
from public.providers p
where p.id = m.provider_id
  and m.input_price_per_mtok = 0
  and m.output_price_per_mtok = 0
  and coalesce(p.config ->> 'preset', '') not in ('openrouter', 'ollama', 'lmstudio')
  and m.model_id not like '%:free';
