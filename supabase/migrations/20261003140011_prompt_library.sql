-- Prompt library: versioned prompt templates with {{variables}}. Apps call
-- them by slug ("prompt": {"id": "support-reply", "variables": {...}});
-- the gateway fills in the variables and puts the template's messages first.
-- Prompts belong to a person; their apps' keys can use them.

create table public.prompts (
  id uuid primary key default gen_random_uuid(),
  owner_email text not null,
  slug text not null check (slug ~ '^[a-z0-9][a-z0-9._-]{0,63}$'),
  name text not null check (char_length(name) between 1 and 100),
  description text check (description is null or char_length(description) <= 500),
  -- The version apps get when they don't ask for one (null: the latest).
  published_version integer,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (owner_email, slug)
);

create table public.prompt_versions (
  id uuid primary key default gen_random_uuid(),
  prompt_id uuid not null references public.prompts (id) on delete cascade,
  version integer not null check (version > 0),
  -- [{"role": "system" | "user" | "assistant", "content": "..."}]
  messages jsonb not null,
  -- Used when the request names no model: a bucket, route or model slug.
  model text,
  -- Defaults the request can override: temperature, top_p, max_tokens.
  params jsonb not null default '{}'::jsonb,
  note text check (note is null or char_length(note) <= 500),
  created_by text,
  created_at timestamptz not null default now(),
  unique (prompt_id, version)
);

create trigger prompts_updated_at before update on public.prompts
  for each row execute function public.set_updated_at();

alter table public.prompts enable row level security;
alter table public.prompt_versions enable row level security;

create policy "read prompts" on public.prompts for select to authenticated
  using (public.is_admin() or owner_email = public.current_email());

create policy "require two-factor" on public.prompts as restrictive
  for select to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2');

create policy "read prompt_versions" on public.prompt_versions for select to authenticated
  using (
    exists (
      select 1 from public.prompts p
      where p.id = prompt_id
        and (public.is_admin() or p.owner_email = public.current_email())
    )
  );

create policy "require two-factor" on public.prompt_versions as restrictive
  for select to authenticated
  using ((select auth.jwt() ->> 'aal') = 'aal2');

-- Which prompt (and version) a request used.
alter table public.request_logs
  add column prompt_id uuid references public.prompts (id) on delete set null,
  add column prompt_version integer;
