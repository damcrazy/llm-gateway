# LLM Gateway

A personal LLM gateway: one base URL and one API key per app, in front of every
provider you use. The gateway handles credentials, routing, automatic failover,
rate-limit cooldowns, token counting and cost; the dashboard handles providers,
models, routes, app keys, logs and analytics.

```
your apps (LangChain, LangGraph, opencode, Claude Code, OpenAI/Anthropic SDKs, curl)
        │  Authorization: Bearer gw_live_…      model: "smart"
        ▼
Next.js (one app: dashboard + API)                           Supabase
  /v1/chat/completions   OpenAI format        ─┐              admins · apps · api_keys (hashed)
  /v1/messages           Anthropic format      ├─ router ──►  providers · provider_secrets (AES-GCM)
  /v1/embeddings         OpenAI format         │  failover    models · routes · model_health
  /v1/models             OpenAI / Anthropic   ─┘  logging     request_logs · usage_hourly
        │
        ▼
OpenAI-compatible (OpenAI, Groq, OpenRouter, DeepSeek, Mistral, Together, Ollama, …)
Azure OpenAI · Anthropic · AWS Bedrock · Google Vertex · Google AI Studio
```

## How requests are served

- **Routes** are named aliases (`smart`, `fast`, `coder`) with an ordered list of
  models. Apps send the route name as `model`; they can also call a model directly
  by slug (`groq/llama-3.3-70b-versatile`).
- **Failover.** The gateway tries each model on the route in order.
  - **Rate limits:** a `429` puts the model in cooldown for its `Retry-After` period.
  - **Outages:** `5xx` errors and timeouts use exponential backoff.
  - **Credential errors:** these take the model out of rotation for 5 minutes.
  - **Streams:** failover happens up until the first token.
  - Cooldowns are stored in Postgres, so every instance skips unhealthy models.
- **Capability-aware.** The gateway skips models that lack what the request needs:
  tools, vision, JSON schema, PDF or audio input, or a large enough context window.
- **Format translation.** Clients can speak OpenAI or Anthropic format.
  - OpenAI-compatible upstreams get the request passed through unchanged.
  - Anthropic, Bedrock, Vertex and Gemini go through the AI SDK provider packages.
  - When a provider changes its API, you upgrade `@ai-sdk/*` here instead of in every app.
- **Usage.** Token counts come from the provider. For streams the gateway asks for
  usage upstream and only forwards it if the client asked for it. When a provider
  reports nothing, tokens are estimated and flagged in the logs. Cost is calculated
  per model from prices you can edit.

## Setup

### 1. Supabase

1. Create a project and link it: `supabase link --project-ref <ref>`.
2. Apply the schema: `supabase db push`. This runs the migrations in `supabase/migrations/`, including the admin allowlist.
   - **Log retention:** `pg_cron` jobs delete request logs after 30 days and payloads after 7 days.
3. **Authentication → Sign In / Providers:** keep the **Email** provider on and turn **off** "Allow new users to sign up". Nobody can register themselves; the superadmin creates accounts from the Members page (service role), which that setting doesn't block.
4. **Create the superadmin account:** Authentication → Users → Add user, with the superadmin email, a strong password and "Auto confirm" ticked. After that, add other people from the dashboard.
5. *Optional, a second safety net:* **Authentication → Hooks:** add a *Before User Created* hook of type Postgres function, pointing at `public.hook_before_user_created`. It rejects any email that isn't in `public.members` before an account is created.

### 2. Sign-in, 2FA and email

People sign in with **Google** or **email and password**. Either way, **two-factor authentication is required for everyone**: the first sign-in goes straight to setting up an authenticator app (Google Authenticator, 1Password, Authy…). Until a code is verified, the dashboard redirects to 2FA and RLS returns no rows.

- **Account & security** (account menu at the bottom of the sidebar): change password, add a backup authenticator, remove one (never the last), see whether Google is linked.
- **Forgot password?** on the sign-in page emails a reset link. Afterwards every session is signed out, and 2FA is still required.
- **Lost authenticator:** on the 2FA screen, "Email me a code" verifies the account's email, removes the old authenticators and starts setup again.
  - It only works right after a password or Google sign-in.
  - It's off for 7 days after an emailed password reset, so access to the inbox alone can't replace both factors.
- **Members page:** the superadmin sees each person's 2FA status and can **Reset 2FA**, or **Create account** for someone listed without one.

**Google** (Authentication → Sign In / Providers → Google):
1. In Google Cloud Console, create an OAuth client of type *Web application*. Add `https://<project-ref>.supabase.co/auth/v1/callback` as an authorized redirect URI.
2. Paste its client ID and secret into Supabase and enable the provider. The "Continue with Google" button appears on its own once it's on.
3. With sign-ups off, Google only works for people who already have an account. Signing in with Google links it to the account with the same email. People added on Members always get one; for people listed earlier, use **Create account**.

**URLs** (Authentication → URL Configuration):
- **Site URL:** your dashboard, e.g. `https://gateway.example.com`.
- **Redirect URLs:** `https://gateway.example.com/**`, and `http://localhost:3000/**` if you develop against this project.

**Email templates** (Authentication → Emails → Templates). Paste the files from `supabase/templates/`:
- **Reset password** → `recovery.html`. Its link goes to `/auth/confirm`, so it works when the email is opened on a different device.
- **Magic link** → `magic_link.html`. It shows the 6-digit code used to recover a lost authenticator.

**SMTP** (Authentication → Emails → SMTP Settings): Supabase's built-in sender only delivers to your Supabase team's own addresses, a couple of emails an hour. Set up custom SMTP (Resend, Postmark, SES…) before relying on resets or recovery codes.

**2FA** (Authentication → Multi-Factor): leave **TOTP** enabled (the default).

### 3. Environment variables

Copy `.env.example`. Everything is read at runtime (there are no `NEXT_PUBLIC_*` values), so one build or image works anywhere.

| Variable | Notes |
| --- | --- |
| `SUPABASE_URL` | Project URL |
| `SUPABASE_PUBLISHABLE_KEY` | Publishable key (or the legacy anon key) |
| `SUPABASE_SECRET_KEY` | Secret key (or the legacy service_role key). Server only. |
| `GATEWAY_ENCRYPTION_KEY` | `openssl rand -base64 32`. Encrypts provider credentials. Back it up. |
| `SUPERADMIN_EMAIL` | Defaults to `kalyanb2000@gmail.com` |
| `APP_URL` | Public URL, used in code snippets (optional behind a proxy that sets `X-Forwarded-Host`) |

### 4. Deploy

**Vercel (Hobby is fine to start):**
1. Import the repo and set the env vars.
2. Put the functions in the **same region as your Supabase project** (Project Settings → Functions). This is the biggest latency win.
3. Limits on Hobby:
   - Streams are capped at 300s. Raise `maxDuration` in `app/v1/*/route.ts` on Pro (up to 800s).
   - Request bodies are capped at 4.5 MB.
4. `vercel.json` schedules a daily `/api/health?deep=1` ping. It keeps a free-tier Supabase project from pausing.

**Docker (local, Azure Container Apps, AWS ECS/App Runner, …):**
```bash
cp .env.example .env    # fill it in
docker compose up --build
# or: docker build -t llm-gateway . && docker run --env-file .env -p 3000:3000 llm-gateway
```
Self-hosted, there's no function time limit and no 4.5 MB body cap. The image has a healthcheck on `/api/health`.

## Local development

```bash
bun install
supabase start          # local Postgres + Auth in Docker; applies migrations
cp .env.example .env.local   # use the keys printed by `supabase start`
bun dev
```

Local sign-ups are disabled as well. Create your local account with the admin API, for example from `supabase start`'s Studio (if you don't exclude it), or with `supabase.auth.admin.createUser({ email, password, email_confirm: true })` and the local secret key.

Emails (reset links, recovery codes) never leave your machine locally: open Mailpit at http://127.0.0.1:54324. For local Google sign-in, set `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` and `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET`, then turn on `[auth.external.google]` in `supabase/config.toml`.

```bash
bun run typecheck && bun run lint && bun run test
```

## Using it from an app

1. **Providers:** add a provider and discover or add its models. Check capabilities and prices on the **Models** page.
   - Models are **Free** ($0 known), **Paid** or **Unknown** (no price info).
   - Filter by these in the Discover dialog to import only free models.
   - On the model tables, use **Enable/Disable N shown** to switch a whole tier on or off.
2. **Routes:** create a route, e.g. `smart`, and order its fallback models.
3. **Apps & keys:** register the app and create a key. The **Integrate** tab has copy-paste snippets.

```python
from langchain_openai import ChatOpenAI
llm = ChatOpenAI(base_url="https://<gateway>/v1", api_key="gw_live_…", model="smart")
```

```bash
# Claude Code / Anthropic SDK
export ANTHROPIC_BASE_URL=https://<gateway>
export ANTHROPIC_AUTH_TOKEN=gw_live_…
```

Response headers `x-gateway-model`, `x-gateway-provider`, `x-gateway-attempts` and `x-gateway-request-id` show which model served each request.

## People and roles

Manage people on **Members** (superadmin only).

| Role | Can do |
| --- | --- |
| Superadmin | Everything, including adding/removing people. Set by `SUPERADMIN_EMAIL`. |
| Admin | Providers, models, routes, every app and log. Can't manage people. |
| Member | Their own apps, API keys, usage and logs. Sees only the routes and models they're allowed to call. |

For each member you set:
- **Model access:** free models only (the default), a picked list of routes and models, or everything.
- **Monthly budget:** optional, and covers all of their apps together.

The gateway enforces both on every API call, and `/v1/models` lists only what their key can use. Removing a member deletes their apps and keys immediately.

The **Playground** has a **Run as** picker. Running as an app behaves exactly like a call with that app's key:
- the app's allowed models, rate limit and budget apply, along with its owner's;
- usage is logged under that app.

Members can only run as their own apps. Admins can also pick **No app** for unrestricted tests.

## Security model

- **Dashboard access:** Google or email and password, with public sign-ups disabled, plus the `public.members` allowlist. It's enforced in three places:
  1. a check on every dashboard request and server action;
  2. RLS on every table;
  3. optionally, the auth hook before an account is created.
- **Two-factor authentication** is required for everyone, on top of either sign-in method. Pages and server actions only accept sessions that verified an authenticator code (`aal2`), and a restrictive RLS policy on every table does the same for direct API calls.
- **Brute force:** sign-in runs from the browser straight to Supabase Auth, so its per-IP rate limits apply to whoever is trying, not to the gateway server.
- **Removing someone** deletes their account and takes effect on their next request. Passwords are at least 12 characters.
- **Email links and redirects:** reset links work once, open a session that can only set a new password for 15 minutes, and still need 2FA to reach the dashboard. Post-sign-in redirects only accept same-site paths.
- **Provider credentials** are AES-256-GCM encrypted in `provider_secrets`, a table with no RLS policies, so only the service role can read it. They never reach the browser.
- **App API keys** are stored as SHA-256 hashes and shown once. Each app can have a model allowlist, a requests-per-minute limit, a monthly budget and payload logging (off by default).

## Project layout

```
app/v1/**                 gateway API route handlers
app/(dashboard)/**        dashboard pages + server actions
lib/gateway/              router, failover engine, adapters, translation, logging
lib/providers/catalog.ts  provider types, presets, capabilities
supabase/migrations/      schema, RLS, hooks, rollups, retention jobs
```

### Local patches to vendored UI code

`components/ui` and `components/animate-ui` come from the shadcn / Animate UI registries. Two Animate UI files carry fixes that aren't upstream yet. Re-apply them if you reinstall with `--overwrite`:

- `primitives/animate/slot.tsx`: unwraps lazy children coming from Server Components. Without it, `<Button asChild><Link/></Button>` in a server page can crash with `reading 'displayName'`.
- `primitives/effects/highlight.tsx`: chains `onMouseEnter`/`onMouseLeave` passed to `HighlightItem`. Without it, the collapsed sidebar's tooltips never open.
- `primitives/radix/switch.tsx`: keeps Radix-only props (`onCheckedChange`, …) off the DOM button.
- Every file under `components/animate-ui` starts with `'use client'`. Some registry files ship without it. Server pages then render them on the server, and tabs hit hydration mismatches.
