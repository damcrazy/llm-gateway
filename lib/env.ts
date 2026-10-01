import "server-only"

// All configuration is read at runtime (never NEXT_PUBLIC_*), so one Docker
// image or Vercel build works in any environment.

function required(name: string, ...fallbacks: string[]): string {
  for (const key of [name, ...fallbacks]) {
    const value = process.env[key]
    if (value) return value
  }
  throw new Error(
    `Missing environment variable ${name}. See .env.example for the full list.`
  )
}

export const env = {
  supabaseUrl: () => required("SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_URL"),
  supabasePublishableKey: () =>
    required(
      "SUPABASE_PUBLISHABLE_KEY",
      "SUPABASE_ANON_KEY",
      "NEXT_PUBLIC_SUPABASE_ANON_KEY"
    ),
  supabaseSecretKey: () =>
    required("SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY"),
  encryptionKey: () => required("GATEWAY_ENCRYPTION_KEY"),
  superadminEmail: () =>
    (process.env.SUPERADMIN_EMAIL ?? "kalyanb2000@gmail.com").toLowerCase(),
  appUrl: () => process.env.APP_URL?.replace(/\/+$/, "") || undefined,
}
