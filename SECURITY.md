# Security policy

The gateway holds provider API keys and sits in front of paid AI accounts, so
security reports are welcome and taken seriously.

## Reporting a vulnerability

Please **don't open a public issue**. Report it privately through
[GitHub's private vulnerability reporting](https://github.com/damcrazy/llm-gateway/security/advisories/new)
(the repository's **Security** tab → **Report a vulnerability**).

Include what you can of:

- what an attacker can do, and who they need to be (anyone, a signed-up member, an admin);
- steps or a request that reproduces it;
- the commit or version you tested.

You'll get a reply within a few days. Once a fix is out, the advisory is
published with credit to you, unless you'd rather stay anonymous.

## Scope

In scope: this repository's code, its database migrations (RLS policies,
functions) and the default configuration it ships.

Out of scope: vulnerabilities in Supabase, Vercel, Next.js or the AI
providers themselves (report those upstream), and problems that need an
already-compromised admin account or server environment.

## Running your own instance

The [Security model](README.md#security-model) section of the README explains
what the gateway protects and how. Above all:

- keep `SUPABASE_SECRET_KEY` and `GATEWAY_ENCRYPTION_KEY` out of the browser,
  logs and source control, and use different keys per environment;
- keep **Confirm email** on in Supabase Auth;
- set up custom SMTP so password resets and recovery codes are delivered.
