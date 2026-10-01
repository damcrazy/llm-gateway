import "server-only"

import { createClient, type SupabaseClient } from "@supabase/supabase-js"

import { env } from "@/lib/env"

let client: SupabaseClient | undefined

/**
 * Service-role client. Bypasses RLS, so only use it from the gateway runtime
 * or from server actions after requireAdmin().
 */
export function supabaseAdmin(): SupabaseClient {
  client ??= createClient(env.supabaseUrl(), env.supabaseSecretKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  return client
}
