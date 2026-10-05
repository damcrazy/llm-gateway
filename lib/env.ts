import "server-only"

import { describeNames, ENV_NAMES, readEnv } from "@/lib/env-names"

function required(names: readonly string[]): string {
  const value = readEnv(names)
  if (value) return value
  throw new Error(
    `Missing environment variable ${describeNames(names)}. See .env.example for the full list.`
  )
}

export const env = {
  supabaseUrl: () => required(ENV_NAMES.supabaseUrl),
  supabasePublishableKey: () => required(ENV_NAMES.supabasePublishableKey),
  supabaseSecretKey: () => required(ENV_NAMES.supabaseSecretKey),
  encryptionKey: () => required(ENV_NAMES.encryptionKey),
  /** Signing in with this (confirmed) email makes the account superadmin. */
  superadminEmail: () =>
    process.env.SUPERADMIN_EMAIL?.trim().toLowerCase() || undefined,
  appUrl: () => process.env.APP_URL?.trim().replace(/\/+$/, "") || undefined,
}
