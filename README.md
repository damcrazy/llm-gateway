# LLM Gateway

[![CI](https://github.com/damcrazy/llm-gateway/actions/workflows/ci.yml/badge.svg)](https://github.com/damcrazy/llm-gateway/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

A self-hosted LLM gateway: one base URL and one API key per app, in front of
every provider you use. The gateway handles credentials, routing, automatic
failover, rate-limit cooldowns, token counting and cost; the dashboard handles
providers, models, buckets, app keys, logs and analytics, for you and anyone
you let sign up.

It's one Next.js app on top of Supabase (Postgres + Auth). Run it on Vercel
and Supabase's free tiers, in Docker, or on your laptop.

```
your apps (LangChain, LangGraph, opencode, Claude Code, OpenAI/Anthropic SDKs, curl)
        │  Authorization: Bearer gw_live_…      model: "smart"
        ▼
Next.js (one app: dashboard + API)                           Supabase
  /v1/chat/completions   OpenAI format        ─┐              members · apps · api_keys (hashed)
  /v1/responses          OpenAI Responses      │
  /v1/messages           Anthropic format      ├─ router ──►  providers · provider_secrets (AES-GCM)
  /v1/embeddings         OpenAI format         │  failover    models · routes · model_health
  /v1/models             OpenAI / Anthropic   ─┘  logging     request_logs · usage_hourly
        │
        ▼
OpenAI-compatible (OpenAI, Groq, OpenRouter, DeepSeek, Mistral, Together, Ollama, …)
Azure OpenAI · Anthropic · AWS Bedrock · Google Vertex · Google AI Studio
```

## Features

- **One API for every provider.** OpenAI Chat Completions and Responses, Anthropic Messages, embeddings, images, speech, transcription and rerank. Clients speak either format to any model.
- **Buckets and failover.** Name a list of models (`smart`, `fast`, `free`) and call it like a model. The gateway tries them in order, fastest first, cheapest first or spread evenly, skips models that are rate-limited, failing or over a free-tier quota, and can hedge slow requests.
- **Keys, limits and budgets** per app and per key: requests and tokens per minute, monthly budgets, model allowlists.
- **Response cache, structured-output checks and PII redaction**, per app.
- **Logs, analytics, alerts and tracing**: costs per model and app, budget and failure alerts (with Slack/Discord webhooks), export to Langfuse or OpenTelemetry, and an audit log.
- **Prompt library, Playground and Compare**: versioned prompt templates, and the same conversation sent to several models side by side.
- **Multi-user.** Open sign-up, required two-factor authentication, roles, per-member model access and budgets. Members can bring their own providers and share them with others by invite.
- **Guided tours** on every page, from the compass button.

## Run it locally

You need [Bun](https://bun.sh) 1.3+, Node.js 24, Docker, and the
[Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started).

```bash
git clone https://github.com/damcrazy/llm-gateway.git
cd llm-gateway
bun install
supabase start     # local Postgres, Auth and Mailpit in Docker; applies the migrations
bun run setup      # writes .env.local, asks for your email
bun dev
```

1. Sign up at http://localhost:3000/signup with the email you gave `bun run setup`.
2. Confirm it from Mailpit at http://127.0.0.1:54324. Emails never leave your machine locally.
3. Set up two-factor authentication with an authenticator app. You're now the superadmin.
4. Add a provider on **Providers**. A local [Ollama](https://ollama.com) works as *OpenAI-compatible* with base URL `http://127.0.0.1:11434/v1`.
5. Create an app on **Apps** and point your code at `http://localhost:3000/v1` with its key.

For local Google sign-in, set `SUPABASE_AUTH_EXTERNAL_GOOGLE_CLIENT_ID` and `SUPABASE_AUTH_EXTERNAL_GOOGLE_SECRET`, then turn on `[auth.external.google]` in `supabase/config.toml`.

## Deploy your own

### 1. Supabase

1. Create a project at [supabase.com](https://supabase.com/dashboard). Note its **region**: the app should run next to it.
2. Apply the schema from your clone of this repository:

   ```bash
   supabase login
   supabase link --project-ref <your-project-ref>
   supabase db push
   ```

   This creates every table, row-level security policy and scheduled cleanup job (`pg_cron`): request logs are kept for 30 days and payloads for 7.
3. Configure **Authentication** in the Supabase dashboard:
   - **Sign In / Providers → Email:** keep **Allow new users to sign up** and **Confirm email** on, and set the minimum password length to 12. Anyone can create an account; it becomes a member with free models only once its email is confirmed. **Confirm email must stay on**: without it, anyone could sign up with your `SUPERADMIN_EMAIL` address before you do and become the superadmin.
   - **URL Configuration:** set **Site URL** to your deployment's URL, e.g. `https://gateway.example.com`, and add `https://gateway.example.com/**` under **Redirect URLs** (plus `http://localhost:3000/**` if you develop against this project). If the Site URL is left at `http://localhost:3000`, confirmation emails link to localhost.
   - **Emails → Templates:** paste the files from `supabase/templates/`:
     - **Confirm signup** → `confirmation.html`, and **Reset password** → `recovery.html`. Their links go to `/auth/confirm`, so they work when the email is opened on a different device.
     - **Magic link** → `magic_link.html`. It carries the 6-digit code used to recover a lost authenticator.
   - **Emails → SMTP Settings:** Supabase's built-in sender only delivers to your Supabase team's own addresses, a couple of emails an hour. Set up custom SMTP (Resend, Postmark, SES, …) before other people sign up.
   - **Multi-Factor:** leave **TOTP** enabled (the default).
   - **Google** (optional, **Sign In / Providers → Google**): create an OAuth client of type *Web application* in Google Cloud Console with `https://<project-ref>.supabase.co/auth/v1/callback` as an authorized redirect URI, then paste its client ID and secret. The "Continue with Google" button appears on its own once it's on.

### 2. Vercel

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2Fdamcrazy%2Fllm-gateway&env=SUPABASE_URL,SUPABASE_PUBLISHABLE_KEY,SUPABASE_SECRET_KEY,GATEWAY_ENCRYPTION_KEY,SUPERADMIN_EMAIL&envDescription=Your%20Supabase%20project%27s%20URL%20and%20keys%2C%20an%20encryption%20key%20and%20your%20email.&envLink=https%3A%2F%2Fgithub.com%2Fdamcrazy%2Fllm-gateway%23configuration&project-name=llm-gateway&repository-name=llm-gateway)

1. The button copies this repository to your GitHub account and asks for the [environment variables](#configuration):
   - `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` and `SUPABASE_SECRET_KEY`: Supabase → **Project Settings → API Keys**.
   - `GATEWAY_ENCRYPTION_KEY`: run `bun run generate:key` (or `openssl rand -base64 32`). Save a copy in your password manager.
   - `SUPERADMIN_EMAIL`: your email.

   Or import your fork on [vercel.com/new](https://vercel.com/new) and add the same variables.
2. **Pick the region next to your database.** Each dashboard page makes several database round trips, so this is the biggest latency win. `vercel.json` sets `"regions": ["sin1"]` (Singapore, for Supabase's `ap-southeast-1`); change it in your copy, e.g. `iad1` for `us-east-1`, `fra1` for `eu-central-1`, `lhr1` for `eu-west-2`, `bom1` for `ap-south-1`. See [Vercel's region list](https://vercel.com/docs/regions).
3. Open the deployment, sign up with `SUPERADMIN_EMAIL`, confirm the email and set up two-factor authentication. You're the superadmin.

Good to know on Vercel's Hobby plan:
- Streams are capped at 300 s. On Pro, raise `maxDuration` in `app/v1/*/route.ts` (up to 800 s).
- Request bodies are capped at 4.5 MB.
- `vercel.json` schedules a daily `/api/health?deep=1` ping, which keeps a free-tier Supabase project from pausing.

### Docker

The same image runs on any container host (a VPS, Azure Container Apps, AWS ECS or App Runner, Fly.io, …), against a hosted Supabase project set up as in [step 1](#1-supabase):

```bash
cp .env.example .env    # fill it in
docker compose up --build
# or: docker build -t llm-gateway . && docker run --env-file .env -p 3000:3000 llm-gateway
```

Self-hosted, there's no function time limit and no 4.5 MB body cap. The image has a healthcheck on `/api/health`. Put it behind HTTPS and set `APP_URL` to its public URL.

To develop against a local Supabase stack, use `bun dev` as in [Run it locally](#run-it-locally): the browser and the server must reach Supabase at the same URL, and `127.0.0.1` inside a container isn't your machine.

## Configuration

Everything is read at runtime (there are no `NEXT_PUBLIC_*` values), so one build or image works anywhere. See `.env.example`.

| Variable | Required | Notes |
| --- | --- | --- |
| `SUPABASE_URL` | Yes | Project URL. `NEXT_PUBLIC_SUPABASE_URL` works too. |
| `SUPABASE_PUBLISHABLE_KEY` | Yes | Publishable key, or the legacy anon key. Supabase's `NEXT_PUBLIC_*` names work too. |
| `SUPABASE_SECRET_KEY` | Yes | Secret key, or the legacy `service_role` key (`SUPABASE_SERVICE_ROLE_KEY`). Server only. |
| `GATEWAY_ENCRYPTION_KEY` | Yes | 32 random bytes, base64. Encrypts provider credentials. If it's lost or changed, saved credentials must be re-entered. Use a different key per environment. |
| `SUPERADMIN_EMAIL` | For setup | Your email. That account becomes the superadmin when it signs in with a confirmed email. Changing it later promotes the new address; the previous superadmin keeps the role. |
| `APP_URL` | No | Public URL, used in code snippets and alert links. Not needed on Vercel or behind a proxy that sets `X-Forwarded-Host`. |

The dashboard answers "Gateway is not configured" and names whatever is missing.

## Updating

In your clone, apply the new version's migrations **before** its code goes live (pushing to the branch Vercel deploys from deploys it straight away):

```bash
git pull https://github.com/damcrazy/llm-gateway.git main
supabase db push
git push
```

Migrations are written to apply safely to a database that has data in it.

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

## Using it from an app

1. **Providers:** add a provider and discover or add its models. Check capabilities and prices on the **Models** page.
   - Models are **Free** ($0 known), **Paid** or **Unknown** (no price info).
   - Filter by these in the Discover dialog to import only free models.
   - On the model tables, use **Enable/Disable N shown** to switch a whole tier on or off.
2. **Apps & keys:** register the app and create a key. The **Integrate** tab has copy-paste snippets.
3. **Buckets** (the app's **Models** tab): name a bucket, e.g. `smart`, `fast` or `free`, and fill it with models.
   - Drag rows from the model table onto a bucket, or use **Add**.
   - Drag cards to order them (keyboard works too: focus the grip, Space, arrow keys, Space). The order is the fallback chain: your code calls `model: "smart"`, and the gateway tries the models top to bottom, moving on when one fails, is rate-limited or is cooling down.
   - Each card shows price, context, capabilities, health, and this app's requests, tokens and cost for the month.
   - Star a bucket as the **default**, used when a request has no model or `model: "default"`.
   - Turn on **Only allow models in these buckets** to stop the app's keys from calling anything else.
   - Changes save automatically and reach API calls within 30 seconds.
   - A bucket wins over a global route with the same name, for that app only. Admins can still define global **Routes** shared by every app.
   - **Order** per bucket:
     - **In order**: top to bottom.
     - **Fastest first**: by each model's median time to first token over the last 6 hours; a model with fewer than 3 calls counts as average.
     - **Cheapest first**: by price.
     - **Spread evenly**: rotates the first model.
   - **Hedging** (optional, per bucket): if the first model hasn't answered after 1–10 s, the next one starts too. The first to answer wins and the other is cancelled, without counting against its health. You may pay for both.
4. **Response cache** (an app's Settings, off by default): an identical request (same model or bucket, messages, tools and settings) gets the stored answer instantly and for $0, for 5 minutes up to 7 days.
   - Streaming clients get the cached answer streamed.
   - Responses say `x-gateway-cache: HIT|MISS|BYPASS`.
   - Clients can skip the lookup with `Cache-Control: no-cache`, or skip the cache entirely with `no-store`.
   - Cached answers are kept in the `response_cache` table.
5. **Free-tier quotas**: set request caps per minute and per day on a model, or on a provider for caps that cover all of its models (e.g. OpenRouter free).
   - Once a cap is reached, buckets skip that model instead of calling it and getting a 429.
   - If every option is capped, the client gets a 429 that names the quota, with `Retry-After`.
   - Days reset at 00:00 UTC. Usage shows next to each model.

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

**OpenAI Responses API** (`POST /v1/responses`, e.g. `client.responses.create`) works with any model, including Anthropic and Gemini ones.
- It is stateless. Nothing is stored, so `previous_response_id` returns a 400; send the whole conversation in `input`, as with `store: false`.
- Supported: text, images and files (as data or URLs), function tools, `text.format` (JSON schema), `reasoning.effort` and streaming.
- Built-in tools (web search, file search, code interpreter) aren't supported.

### Prompt library and Compare

**Prompts** (the **Prompts** page) are versioned templates with `{{variables}}`.
- Apps call them by slug instead of sending the whole prompt; the template's messages come first, then the request's own:

```json
{ "prompt": { "id": "support-reply", "version": 2, "variables": { "name": "Jane" } },
  "messages": [{ "role": "user", "content": "Where is my order?" }] }
```

- Works on `/v1/chat/completions`, `/v1/responses` (OpenAI's own `prompt` field) and `/v1/messages`.
- Without `version`, the published version is used, or the latest if none is published.
- Without `model`, the version's default model is used.
- Missing variables are a 400 that lists them. Prompts belong to a person, so only their apps can use them.
- Logs record which prompt and version each request used.

**Compare** (the **Compare** page) sends the same conversation to up to four models, buckets or routes at once, through the real gateway, and shows the answers side by side with latency, tokens and cost.
- Open a logged request there with **Replay in Compare** (it needs stored payloads).
- Open a prompt there with **Try in Compare**.

### Images, audio and rerank

Models can also be of kind **Image**, **Speech**, **Transcription** or **Rerank**. Set the kind when adding a model; discovery guesses it from the id.

| Endpoint | Kind | Priced per |
| --- | --- | --- |
| `POST /v1/images/generations` | Image | image |
| `POST /v1/audio/speech` | Speech | 1K characters |
| `POST /v1/audio/transcriptions`, `/v1/audio/translations` | Transcription | minute (when the response has the duration) |
| `POST /v1/rerank` (`query` + `documents`, Cohere/Jina style) | Rerank | search |

- They work with OpenAI-compatible and Azure providers, with the same buckets, failover, limits, logs and PII protection as chat.
- Token prices are used instead when a provider reports tokens (e.g. gpt-image-1).
- Generated images and uploaded audio are never stored, even with payload logging; only counts and sizes are.

### Structured output

Turn on **Check structured output** in an app's Settings to have the gateway check answers to `response_format` json_object / json_schema requests (non-streaming).
- Invalid JSON, or JSON that doesn't match the schema, counts as a failed attempt: the next model in the bucket answers, and the same model gets one more try if it's the last.
- Answers wrapped in ```json fences are unwrapped.
- If no model gives a valid answer, the client gets a 502 `invalid_structured_output`.
- These failures don't affect a model's health.

### Limits, privacy and tags

**Limits** (app **Settings**, and **Limits** on each API key):
- Requests per minute, tokens per minute (input plus output) and a monthly budget, per app.
- Each key can have its own lower limits, e.g. for a teammate or a script.
- Token use is only known after a response, so the request that goes over the token limit still finishes; later ones get a 429 until the minute ends.
- Budget alerts also cover keys with a budget.

**Personal data in prompts** (app **Settings**) finds email addresses, phone numbers, card numbers (Luhn-checked), IBANs, US social security numbers, and API keys or secrets (OpenAI, Anthropic, AWS, GitHub, Slack, Google, Stripe, JWTs, private keys).
- **Redact:** replaces them with placeholders like `[EMAIL]` before any provider sees them, and in stored payloads and exported traces.
- **Block:** refuses the request with a 400.
- Logs show which kinds were found.

**Tags and end users**, for filtering logs and traces:
- Send `x-gateway-tags: checkout,beta` (up to 10 tags).
- Name the end user with `x-gateway-user`, or OpenAI's `user` / `safety_identifier`, or Anthropic's `metadata.user_id`.
- A `metadata` object (up to 16 values) is stored too.
- The request body still reaches the provider unchanged.

**Audit log** (the **Audit log** page): who changed what in the dashboard, plus sign-ins, password and two-factor changes.
- Admins see everything; members see their own entries.
- Kept for a year. Secrets are never recorded.

### Alerts and tracing

**Alerts** (bell at the top of the dashboard, and the **Alerts** page) are per person. Each one is raised once per period and kept for 90 days.
- **Budgets:** an app with a monthly budget (or a member's own account budget) passes 50–90%, and again when it's used up.
- **Failing models:** 3 failures in a row, or taken out of rotation (bad key, removed model). Private providers alert their owner; shared ones alert the admins.
- **Slow responses:** an app's median response time over 15 minutes (time to first token when streaming) goes above 2–30 s.
- Add a **webhook** to also get them in Slack, Discord or anything that accepts JSON. It must be https on a public address and is stored encrypted.

**Tracing** (the **Tracing** page) sends every request from your apps to Langfuse (cloud or self-hosted) and/or an OpenTelemetry collector (OTLP/HTTP JSON, GenAI semantic conventions).
- Includes the app, requested and served model, tokens, cost, gateway timings and errors.
- Prompts and answers are included only for apps that log payloads.
- Sent after the response, so it adds no latency. Keys and headers are stored encrypted.


## People and roles

Anyone who signs up becomes a **Member** with free models only. On **Members** (superadmin only), you can:
- promote someone to admin;
- widen their model access;
- set a budget;
- add people yourself with custom access before they sign up.

| Role | Can do |
| --- | --- |
| Superadmin | Everything, including adding/removing people. The `SUPERADMIN_EMAIL` account. |
| Admin | Shared providers, models, routes, every app and log. Can't manage people. |
| Member | Their own apps, API keys, usage, logs and **their own providers**. Sees only the shared routes and models they're allowed to call, plus their own. |

### Shared and private providers

- **Shared providers** are added by admins. Every member can use their models, within the model access and budget you set for them.
- **Hiding an admin's provider:** switch **Visible to members** off on **Providers**. It becomes the admin's own: only their apps use it, plus anyone they invite from its page. Switching it back on gives it to every member again and removes the invites.
- **Private providers** are added by members on **Providers**, with their own API keys. Only that member's apps can use the models: other members can't see them, call them or put them in a bucket or route, and admins only see a read-only list. Their models aren't limited by the member's model access (it's their key), and their cost doesn't count toward the monthly budget you set. App budgets still count everything.
- A member can connect up to 10 providers. Their slugs are prefixed with the member's name by default, since model names (`slug/model`) are shared across the gateway.
- Removing a member deletes their providers too.
- **Sharing a private provider:** its owner can let other people's apps use it, with the owner's key paying.
  - On the provider's page, **Invite someone** creates a link and a separate 6-digit code. It can be locked to one email address, and expires after 1, 7 or 30 days.
  - The other person opens the link, signs in (they're brought back to the invite afterwards) and enters the code.
  - Invites work once and lock after 5 wrong codes. Only hashes of the link and code are stored.
  - People it's shared with see the provider's name and models, never its key or settings, and can't share it further.
  - The owner sees each person's usage this month and can **Take back** access at any time; the other person can **Leave**. Changes reach the gateway within about 15 seconds.
- **Switching providers off for yourself:** under **Use in my apps** on **Providers**, anyone can switch off a gateway provider, or one shared with them. Their apps then stop using it (buckets skip it, and calling one of its models by name gets a 403). It stays on for everyone else.

For each member you set:
- **Model access:** free models only (the default), a picked list of routes and models, or everything.
- **Monthly budget:** optional, and covers all of their apps together.

The gateway enforces both on every API call, and `/v1/models` lists only what their key can use. Removing a member deletes their apps and keys immediately.

The **Playground** has a **Run as** picker. Running as an app behaves exactly like a call with that app's key:
- the app's allowed models, rate limit and budget apply, along with its owner's;
- usage is logged under that app.

Members can only run as their own apps. Admins can also pick **No app** for unrestricted tests.

### Sign-in and two-factor authentication

Anyone can **sign up** at `/signup` with Google or email and password, and becomes a normal member with free models only. One email is always one account:
- Signing in with Google attaches to the existing account with that email.
- Signing up again with a used email shows "This email already has an account".
- A Google user who wants a password uses **Forgot password?** or **Set a password** on Account & security. Both put the password on the same account.

**Two-factor authentication is required for everyone**, with either sign-in method: the first sign-in goes straight to setting up an authenticator app (Google Authenticator, 1Password, Authy…). Until a code is verified, the dashboard redirects to 2FA and RLS returns no rows.

- **Account & security** (account menu at the bottom of the sidebar): change password, add a backup authenticator, remove one (never the last), see whether Google is linked.
- **Forgot password?** on the sign-in page emails a reset link. Afterwards every session is signed out, and 2FA is still required.
- **Lost authenticator:** on the 2FA screen, "Email me a code" verifies the account's email, removes the old authenticators and starts setup again.
  - It only works right after a password or Google sign-in.
  - It's off for 7 days after an emailed password reset, so access to the inbox alone can't replace both factors.
- **Members page:** the superadmin sees each person's 2FA status and can **Reset 2FA**, or **Create account** for someone listed without one.

## Security model

- **Dashboard access:** Google or email and password. Sign-up is open, but an account only becomes a member once its email is confirmed, and new members start with free models only. Roles and access are checked on every dashboard request and server action, and by RLS on every table.
- **Two-factor authentication** is required for everyone, on top of either sign-in method. Pages and server actions only accept sessions that verified an authenticator code (`aal2`), and a restrictive RLS policy on every table does the same for direct API calls.
- **Brute force:** sign-in runs from the browser straight to Supabase Auth, so its per-IP rate limits apply to whoever is trying, not to the gateway server.
- **Removing someone** deletes their account and takes effect on their next request. Because sign-up is open, they could create a new account later, starting again as a member with free models only. Passwords are at least 12 characters.
- **Email links and redirects:** reset links work once, open a session that can only set a new password for 15 minutes, and still need 2FA to reach the dashboard. Post-sign-in redirects only accept same-site paths.
- **Provider credentials** are AES-256-GCM encrypted in `provider_secrets`, a table with no RLS policies, so only the service role can read it. They never reach the browser.
- **Members' own providers can't reach your network.** Anyone can sign up, so a member's provider may only call public `https://` addresses:
  - URLs are checked when saved.
  - Every connection is checked again after DNS resolution (`lib/net/public-fetch.ts`), so a hostname re-pointed at `127.0.0.1` or the cloud metadata address `169.254.169.254` later is refused.
  - Redirects are refused.
  - Admins' providers have no such limit, so a local Ollama still works.
- **Private models are invisible to others** in the router, `/v1/models`, the dashboard and RLS (`can_see_provider`). Another member's model slug answers 404, as if it didn't exist.
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

`components/ui` and `components/animate-ui` come from the shadcn / Animate UI registries (the Kanban board from Dice UI's, since Animate UI has no drag-and-drop list). A few files carry fixes that aren't upstream yet. Re-apply them if you reinstall with `--overwrite`:

- `primitives/animate/slot.tsx`: unwraps lazy children coming from Server Components. Without it, `<Button asChild><Link/></Button>` in a server page can crash with `reading 'displayName'`.
- `primitives/effects/highlight.tsx`: chains `onMouseEnter`/`onMouseLeave` passed to `HighlightItem`. Without it, the collapsed sidebar's tooltips never open.
- `primitives/radix/switch.tsx`: keeps Radix-only props (`onCheckedChange`, …) off the DOM button.
- `lib/compose-refs.ts` (from Dice UI, used by `components/ui/kanban.tsx`): its lint suppression is rewritten for ESLint (upstream uses oxlint).
- `components/ui/kanban.tsx` (Dice UI), two keyboard fixes; upstream, keyboard reordering doesn't work at all:
  - the keyboard coordinate getter uses `continue` instead of `return` inside its loop, so arrow keys move the card;
  - `isCancelled()` ignores the `preventDefault()` that dnd-kit's KeyboardSensor always applies to the key that starts a drag, so keyboard drags aren't treated as cancelled.
  - the coordinate getter skips the target it's already over and uses rects re-measured after scrolling, as dnd-kit's own `sortableKeyboardCoordinates` does, so arrow keys keep working once the page scrolls.
- Every file under `components/animate-ui` starts with `'use client'`. Some registry files ship without it. Server pages then render them on the server, and tabs hit hydration mismatches.

## Contributing

Issues and pull requests are welcome. See [CONTRIBUTING.md](CONTRIBUTING.md) for setup and conventions, and [SECURITY.md](SECURITY.md) to report a vulnerability privately.

## License

[MIT](LICENSE)
