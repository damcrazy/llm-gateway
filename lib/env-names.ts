// Accepted environment variable names for each setting, in priority order.
// Supabase's guides and its Vercel integration use NEXT_PUBLIC_* names, so
// those work too. Read at runtime on the server (and in proxy.ts, which runs
// on Node.js), so one build or Docker image works in any environment.

export const ENV_NAMES = {
  supabaseUrl: ["SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"],
  supabasePublishableKey: [
    "SUPABASE_PUBLISHABLE_KEY",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
    "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_DEFAULT_KEY",
    "SUPABASE_ANON_KEY",
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
  ],
  supabaseSecretKey: ["SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY"],
  encryptionKey: ["GATEWAY_ENCRYPTION_KEY"],
} as const

export function readEnv(names: readonly string[]): string | undefined {
  for (const name of names) {
    const value = process.env[name]?.trim()
    if (value) return value
  }
  return undefined
}

/** "SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL)" for error messages. */
export function describeNames(names: readonly string[]): string {
  const [first, ...rest] = names
  return rest.length ? `${first} (or ${rest.join(", ")})` : first
}
