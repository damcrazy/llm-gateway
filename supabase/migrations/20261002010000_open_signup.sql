-- Anyone can sign up, with Google or email and password. Every confirmed
-- account becomes a normal member with free models only; the superadmin
-- promotes people (admin, more models, budgets) on the Members page.
--
-- One person is one account: auth.users has a unique email, and signing in
-- with Google attaches to the existing account with the same email. An
-- emailed password reset sets the password on that same account.

-- Safer defaults for any row created without explicit values.
alter table public.members alter column role set default 'member';
alter table public.members alter column model_access set default 'free';

-- The before-user-created hook no longer limits sign-ups to listed emails.
-- It stays as a pass-through so a project that has it configured keeps working.
create or replace function public.hook_before_user_created(event jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return '{}'::jsonb;
end;
$$;

-- Enroll an account as a member once its email is confirmed. Google accounts
-- arrive confirmed; email sign-ups when they click the confirmation link.
-- People the superadmin added already have a row, which is kept as is.
create or replace function public.enroll_confirmed_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.email is not null and new.email_confirmed_at is not null then
    insert into public.members (email, role, model_access, added_by)
    values (lower(new.email), 'member', 'free', 'sign-up')
    on conflict (email) do nothing;
  end if;
  return new;
end;
$$;

revoke execute on function public.enroll_confirmed_user() from public, anon, authenticated;

create trigger enroll_confirmed_user
  after insert or update of email_confirmed_at on auth.users
  for each row execute function public.enroll_confirmed_user();

-- Confirmed accounts that exist already become members too.
insert into public.members (email, role, model_access, added_by)
select lower(u.email), 'member', 'free', 'sign-up'
from auth.users u
where u.email is not null and u.email_confirmed_at is not null
on conflict (email) do nothing;

-- Whether an account has a password its owner knows, for the Account &
-- security page. Google sign-ups have none. Accounts the superadmin creates
-- without one get a random password from Supabase, so the app flags them
-- (app_metadata.password_unset) until a password is set. Server-side only.
create or replace function public.user_has_password(p_user_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(u.encrypted_password, '') <> ''
    and coalesce((u.raw_app_meta_data ->> 'password_unset')::boolean, false) = false
  from auth.users u
  where u.id = p_user_id;
$$;

revoke execute on function public.user_has_password(uuid) from public, anon, authenticated;
grant execute on function public.user_has_password(uuid) to service_role;
