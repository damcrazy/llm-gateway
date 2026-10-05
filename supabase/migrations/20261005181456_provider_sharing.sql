-- Sharing your own providers, and switching providers off for yourself.
--
-- A member can share a provider they own with someone else: they create an
-- invite (a link plus a separate 6-digit code, optionally for one email
-- address), the other person opens the link and enters the code, and from
-- then on their apps can use the provider's models. The owner's key pays.
-- Only the owner can share (a person it was shared with can't pass it on),
-- and the owner can take access back at any time.
--
-- Anyone can also switch off, for their own apps, a provider they can use
-- but don't own (the gateway's providers, or ones shared with them).
--
-- All three tables are read and written by the server only (service role);
-- the invite token and code are stored as hashes.

create table public.provider_shares (
  provider_id uuid not null references public.providers (id) on delete cascade,
  member_email text not null references public.members (email)
    on update cascade on delete cascade,
  -- The invite it was accepted from, for the record.
  invite_id uuid,
  created_at timestamptz not null default now(),
  primary key (provider_id, member_email)
);

create index provider_shares_member_idx on public.provider_shares (member_email);

create table public.provider_invites (
  id uuid primary key default gen_random_uuid(),
  provider_id uuid not null references public.providers (id) on delete cascade,
  created_by text not null,
  -- sha256 of the link's token, and an HMAC of the token and code.
  token_hash text not null unique,
  code_hash text not null,
  -- Only this person may accept (null: whoever has the link and the code).
  email text,
  expires_at timestamptz not null,
  failed_attempts integer not null default 0,
  accepted_by text,
  accepted_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now()
);

create index provider_invites_provider_idx
  on public.provider_invites (provider_id, created_at desc);

create table public.provider_opt_outs (
  member_email text not null references public.members (email)
    on update cascade on delete cascade,
  provider_id uuid not null references public.providers (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (member_email, provider_id)
);

alter table public.provider_shares enable row level security;
alter table public.provider_invites enable row level security;
alter table public.provider_opt_outs enable row level security;

-- People a provider is shared with may see its models (not the provider's
-- settings or credentials: the providers table policy is unchanged).
create or replace function public.can_see_provider(p_provider_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.providers p
    where p.id = p_provider_id
      and (
        (p.owner_email is null and public.is_member())
        or p.owner_email = public.current_email()
        or public.is_admin()
        or exists (
          select 1 from public.provider_shares s
          where s.provider_id = p.id
            and s.member_email = public.current_email()
        )
      )
  );
$$;

-- Accepts an invite in one step, so it can't be used twice. Five wrong codes
-- lock it. Returns what happened: accepted, wrong_code, locked, expired,
-- used, revoked, not_found, own (the owner tried) or wrong_person.
create or replace function public.accept_provider_invite(
  p_token_hash text,
  p_code_hash text,
  p_email text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  invite public.provider_invites%rowtype;
  provider_owner text;
begin
  select * into invite from public.provider_invites
  where token_hash = p_token_hash
  for update;
  if not found then return 'not_found'; end if;
  if invite.revoked_at is not null then return 'revoked'; end if;
  if invite.accepted_at is not null then return 'used'; end if;
  if invite.expires_at <= now() then return 'expired'; end if;
  if invite.failed_attempts >= 5 then return 'locked'; end if;

  select owner_email into provider_owner from public.providers
  where id = invite.provider_id;
  if provider_owner is null then return 'not_found'; end if;
  if provider_owner = p_email then return 'own'; end if;
  if invite.email is not null and invite.email <> p_email then
    return 'wrong_person';
  end if;

  if invite.code_hash <> p_code_hash then
    update public.provider_invites
    set failed_attempts = failed_attempts + 1
    where id = invite.id;
    return case when invite.failed_attempts + 1 >= 5 then 'locked' else 'wrong_code' end;
  end if;

  update public.provider_invites
  set accepted_by = p_email, accepted_at = now()
  where id = invite.id;
  insert into public.provider_shares (provider_id, member_email, invite_id)
  values (invite.provider_id, p_email, invite.id)
  on conflict (provider_id, member_email) do nothing;
  return 'accepted';
end;
$$;

revoke execute on function public.accept_provider_invite(text, text, text) from public, anon, authenticated;
grant execute on function public.accept_provider_invite(text, text, text) to service_role;

select cron.schedule(
  'gateway-prune-provider-invites',
  '17 4 * * *',
  $$delete from public.provider_invites where expires_at < now() - interval '30 days'$$
);
