import "server-only"

import { decryptSecret, encryptSecret, secretHint } from "@/lib/crypto"
import type { ProviderCredentials } from "@/lib/db/types"
import { supabaseAdmin } from "@/lib/supabase/admin"

/** Encrypts and stores provider credentials. Empty values are dropped. */
export async function saveProviderCredentials(
  providerId: string,
  credentials: ProviderCredentials
): Promise<void> {
  const clean = Object.fromEntries(
    Object.entries(credentials).filter(
      ([, value]) => typeof value === "string" && value.trim() !== ""
    )
  ) as ProviderCredentials

  const hintSource =
    clean.apiKey ??
    clean.accessKeyId ??
    (clean.serviceAccountJson ? "service-account" : "")

  const { error } = await supabaseAdmin()
    .from("provider_secrets")
    .upsert({
      provider_id: providerId,
      ciphertext: encryptSecret(JSON.stringify(clean)),
      hint: hintSource ? credentialHint(clean, hintSource) : null,
    })
  if (error) throw new Error(`Could not save credentials: ${error.message}`)
}

function credentialHint(
  credentials: ProviderCredentials,
  source: string
): string {
  if (credentials.serviceAccountJson) {
    try {
      const parsed = JSON.parse(credentials.serviceAccountJson) as {
        client_email?: string
      }
      if (parsed.client_email) return parsed.client_email
    } catch {
      // fall through
    }
    return "service account"
  }
  return secretHint(source)
}

export async function loadProviderCredentials(
  providerId: string
): Promise<ProviderCredentials> {
  const { data, error } = await supabaseAdmin()
    .from("provider_secrets")
    .select("ciphertext")
    .eq("provider_id", providerId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!data) return {}
  return JSON.parse(decryptSecret(data.ciphertext)) as ProviderCredentials
}

/** provider_id -> hint, for showing "…ab12" in the dashboard. */
export async function loadCredentialHints(): Promise<
  Map<string, string | null>
> {
  const { data } = await supabaseAdmin()
    .from("provider_secrets")
    .select("provider_id, hint")
  return new Map(
    (data ?? []).map((row) => [
      row.provider_id as string,
      row.hint as string | null,
    ])
  )
}
