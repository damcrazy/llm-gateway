# Contributing

Thanks for helping. Bug reports, fixes and features are all welcome. For
anything bigger than a small fix, open an issue first so we can agree on the
approach before you spend time on it. Security problems go through
[SECURITY.md](SECURITY.md), not issues.

## Setup

You need [Bun](https://bun.sh) 1.3+, Node.js 24 and Docker. The Supabase CLI
is a dev dependency: run it with `bunx supabase`.

```bash
bun install
bunx supabase start   # local Postgres, Auth and Mailpit in Docker; applies the migrations
bun run setup         # writes .env.local from `supabase status`
bun dev
```

Sign up at http://localhost:3000/signup with the email you gave `bun run setup`;
the confirmation email is in Mailpit at http://127.0.0.1:54324.

Using an editor or agent with MCP? Copy `.mcp.example.json` to `.mcp.json`
(git ignores it) and put in your own Supabase project ref.

## Before you open a pull request

```bash
bun run format:check && bun run lint && bun run typecheck && bun run test && bun run build
```

CI runs the same checks. `bun run format` fixes formatting and leaves vendored
code alone (see below).

- Keep pull requests focused: one change, with a description of what it does
  and how you tested it. Screenshots help for UI changes.
- Add or update tests in `tests/` for gateway logic (routing, translation,
  pricing, PII detection, …).
- Update the README when behaviour that users see changes.

## Conventions

**Next.js 16.** This version differs from older Next.js in places. When in
doubt, read the guides bundled in `node_modules/next/dist/docs/` (see
`AGENTS.md`).

**UI components.** Use [Animate UI](https://animate-ui.com) components first,
then [shadcn/ui](https://ui.shadcn.com) for anything Animate UI doesn't have.
Add them with the shadcn CLI (`bunx shadcn@latest add @animate-ui/…`) rather
than writing your own buttons, dialogs or switches.

**Vendored code.** `components/ui/`, `components/animate-ui/`, `hooks/`,
`lib/compose-refs.ts` and `lib/get-strict-context.tsx` come from those
registries. Don't reformat or restyle them. The few local fixes they carry are
listed under [Local patches to vendored UI code](README.md#local-patches-to-vendored-ui-code);
if you add one, list it there too.

**Database changes.**

- Create a new migration with `bunx supabase migration new <name>`. Never edit one
  that's already been released: deployed databases won't run it again.
- Every table has row-level security enabled. Tables only the server uses
  (secrets, counters, invites) get no policies at all, so only the service
  role can reach them.
- Write changes forward-only and safe to apply to a database with data in it.
  Vercel production builds apply them automatically (`scripts/migrate.mjs`), so
  a migration that fails stops the deployment.
- Update the hand-written row types in `lib/db/types.ts`.
- `bunx supabase db reset` re-applies every migration to your local database from
  scratch, which is a good test before you push.

**Security.** Provider credentials stay encrypted (`lib/crypto.ts`) and never
reach the browser. Server actions check the caller's role themselves; don't
rely on the page having checked. Members' providers may only reach public
addresses (`lib/net/public-fetch.ts`). Never log or audit secrets.

## License

By contributing, you agree that your contributions are licensed under the
[MIT License](LICENSE).
