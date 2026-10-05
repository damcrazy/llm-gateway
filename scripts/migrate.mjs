#!/usr/bin/env node
// Applies supabase/migrations during a Vercel production build, so the
// "Deploy with Vercel" button sets up the database schema too. It uses the
// connection strings that the Supabase integration on Vercel provides
// (POSTGRES_URL_NON_POOLING, POSTGRES_URL) and the project's Supabase CLI
// (`supabase db push`, which records what it applied, like a manual push).
//
// It skips, without failing the build:
//   - preview builds: they share the production database;
//   - deployments without those variables, set up by hand. Apply migrations
//     there with `bunx supabase db push` before deploying.
//
//   node scripts/migrate.mjs             # what vercel.json's buildCommand runs
//   node scripts/migrate.mjs --dry-run   # only show which database it would use

import { execFileSync } from "node:child_process"
import { fileURLToPath } from "node:url"

// Supabase's direct database host only has an IPv6 address, which Vercel's
// build machines can't reach. Its connection pooler (Supavisor) can be.
const DIRECT_HOST = /^db\.[a-z0-9]+\.supabase\.co$/
const POOLER_HOST = /\.pooler\.supabase\.com$/
const SESSION_MODE_PORT = "5432"

const root = fileURLToPath(new URL("..", import.meta.url))
const dryRun = process.argv.includes("--dry-run")

function log(message) {
  console.log(`[migrate] ${message}`)
}

function parse(value) {
  try {
    return value ? new URL(value) : null
  } catch {
    return null
  }
}

/** A connection that keeps a real session (DDL, functions), reachable from Vercel. */
function migrationUrl(env) {
  const direct = parse(env.POSTGRES_URL_NON_POOLING)
  const pooled = parse(env.POSTGRES_URL)
  let url = direct && !DIRECT_HOST.test(direct.hostname) ? direct : null
  if (!url && pooled && POOLER_HOST.test(pooled.hostname)) {
    // The transaction pooler's host and user, in session mode.
    url = pooled
    url.port = SESSION_MODE_PORT
  }
  url ??= direct ?? pooled
  if (!url) return null
  // Connection-pool hints for app clients, not Postgres settings.
  for (const name of ["pgbouncer", "supa", "connection_limit", "pool_timeout"])
    url.searchParams.delete(name)
  if (!url.searchParams.has("sslmode"))
    url.searchParams.set("sslmode", "require")
  return url
}

const vercelEnv = process.env.VERCEL_ENV
if (vercelEnv !== "production" && !dryRun) {
  log(
    vercelEnv
      ? `Skipped on this ${vercelEnv} build: only production deploys migrate, since previews share its database.`
      : "Skipped: not a Vercel build. Locally, `supabase start` applies migrations; elsewhere use `bunx supabase db push`."
  )
  process.exit(0)
}

const url = migrationUrl(process.env)
if (!url) {
  log(
    "Skipped: no POSTGRES_URL_NON_POOLING or POSTGRES_URL (the Supabase integration sets them). Apply migrations with `bunx supabase db push`."
  )
  process.exit(0)
}

const target = `${url.hostname}:${url.port || "5432"}`
if (dryRun) {
  log(
    `Would apply migrations to ${target} as ${decodeURIComponent(url.username)}.`
  )
  process.exit(0)
}

log(`Applying migrations to ${target}…`)
try {
  execFileSync(
    fileURLToPath(new URL("../node_modules/.bin/supabase", import.meta.url)),
    ["db", "push", "--db-url", url.toString(), "--yes"],
    { cwd: root, stdio: "inherit" }
  )
} catch {
  log(
    "Failed, so this deployment stops before new code runs against an old schema. See the error above."
  )
  process.exit(1)
}
