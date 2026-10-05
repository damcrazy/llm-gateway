#!/usr/bin/env node
// Writes .env.local for `bun dev` against the local Supabase stack: its URL
// and keys (from `supabase status`), an encryption key, and the superadmin
// email. Run `bunx supabase start` first.
//
//   bun run setup                            # asks for the superadmin email
//   bun run setup --email you@example.com
//   bun run setup --force                    # rewrite an existing .env.local
//
// Rewriting keeps the existing GATEWAY_ENCRYPTION_KEY, so provider
// credentials already saved in the local database stay readable.

import { execFileSync } from "node:child_process"
import { randomBytes } from "node:crypto"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { createInterface } from "node:readline/promises"
import { fileURLToPath } from "node:url"

const TARGET = ".env.local"
const args = process.argv.slice(2)
const force = args.includes("--force")
const emailFlag = args.indexOf("--email")
const emailArg = emailFlag >= 0 ? args[emailFlag + 1] : undefined

function fail(message) {
  console.error(`\n${message}\n`)
  process.exit(1)
}

function parseEnv(text) {
  const values = {}
  for (const line of text.split("\n")) {
    const match = line.match(/^([A-Z][A-Z0-9_]*)=(.*)$/)
    if (match) values[match[1]] = match[2].trim().replace(/^"(.*)"$/, "$1")
  }
  return values
}

const existing = existsSync(TARGET)
  ? parseEnv(readFileSync(TARGET, "utf8"))
  : null
if (existing && !force)
  fail(
    `${TARGET} already exists. Run with --force to rewrite it (its encryption key is kept).`
  )

// The project's own Supabase CLI (a dev dependency), else one on the PATH.
const localCli = fileURLToPath(
  new URL("../node_modules/.bin/supabase", import.meta.url)
)
const cli = existsSync(localCli) ? localCli : "supabase"

let status
try {
  status = execFileSync(cli, ["status", "-o", "env"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  })
} catch (error) {
  fail(
    error.code === "ENOENT"
      ? "The Supabase CLI isn't installed. Run `bun install` first."
      : "Couldn't read the local Supabase stack. Start it with `bunx supabase start` (Docker must be running)."
  )
}
const local = parseEnv(status)
const url = local.API_URL
const publishableKey = local.PUBLISHABLE_KEY || local.ANON_KEY
const secretKey = local.SECRET_KEY || local.SERVICE_ROLE_KEY
if (!url || !publishableKey || !secretKey)
  fail(
    "`supabase status` didn't list the API URL and keys. Is the stack fully started?"
  )

let email =
  emailArg && !emailArg.startsWith("--") ? emailArg : existing?.SUPERADMIN_EMAIL
if (!email) {
  if (!process.stdin.isTTY)
    fail("Pass the superadmin email: bun run setup --email you@example.com")
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  email = await rl.question("Superadmin email (you'll sign up with it): ")
  rl.close()
}
email = email.trim().toLowerCase()
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
  fail(`"${email}" isn't an email address.`)

const encryptionKey =
  existing?.GATEWAY_ENCRYPTION_KEY || randomBytes(32).toString("base64")

writeFileSync(
  TARGET,
  `# Written by \`bun run setup\` for the local Supabase stack. See .env.example.
SUPABASE_URL=${url}
SUPABASE_PUBLISHABLE_KEY=${publishableKey}
SUPABASE_SECRET_KEY=${secretKey}

# Encrypts provider credentials. Only for this machine's database.
GATEWAY_ENCRYPTION_KEY=${encryptionKey}

SUPERADMIN_EMAIL=${email}
APP_URL=http://localhost:3000
`,
  { mode: 0o600 }
)

const mailpit =
  local.MAILPIT_URL || local.INBUCKET_URL || "http://127.0.0.1:54324"
console.log(`
Wrote ${TARGET}.

Next:
  1. bun dev
  2. Sign up at http://localhost:3000/signup with ${email}
  3. Open the confirmation email in Mailpit (${mailpit}) and click the link
  4. Set up two-factor authentication. You're the superadmin.
`)
