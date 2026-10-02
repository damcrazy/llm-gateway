import "server-only"

import { env } from "@/lib/env"

interface AuthSettings {
  google: boolean
}

let cache: { at: number; value: AuthSettings } | undefined
const TTL_MS = 60_000

/**
 * Which sign-in providers are enabled in Supabase (public endpoint), so the
 * login page only shows buttons that work.
 */
export async function getAuthSettings(): Promise<AuthSettings> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.value
  try {
    const response = await fetch(`${env.supabaseUrl()}/auth/v1/settings`, {
      headers: { apikey: env.supabasePublishableKey() },
      signal: AbortSignal.timeout(3_000),
    })
    const body = (await response.json()) as {
      external?: Record<string, boolean>
    }
    cache = {
      at: Date.now(),
      value: { google: body.external?.google === true },
    }
  } catch {
    cache = { at: Date.now(), value: cache?.value ?? { google: false } }
  }
  return cache.value
}
