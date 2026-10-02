import "server-only"

import { requireMember, type SessionMember } from "@/lib/auth"
import type { ProviderConfig } from "@/lib/db/types"
import type { ProviderType } from "@/lib/providers/catalog"
import { supabaseAdmin } from "@/lib/supabase/admin"

// Who may manage a provider and its models: admins manage shared providers
// (no owner); a member manages only the providers they own. Anyone else gets
// "not found", so they can't tell a private provider exists.

export const MAX_OWN_PROVIDERS = 10

export interface AccessibleProvider {
  id: string
  name: string
  slug: string
  type: ProviderType
  config: ProviderConfig
  ownerEmail: string | null
}

type Denied = { ok: false; error: string }

const NOT_FOUND: Denied = { ok: false, error: "Provider not found" }

export function canManageProvider(
  me: Pick<SessionMember, "email" | "isAdmin">,
  ownerEmail: string | null
): boolean {
  return ownerEmail === null ? me.isAdmin : ownerEmail === me.email
}

export async function requireProviderAccess(
  providerId: string
): Promise<
  { ok: true; me: SessionMember; provider: AccessibleProvider } | Denied
> {
  const me = await requireMember()
  const { data, error } = await supabaseAdmin()
    .from("providers")
    .select("id, name, slug, type, config, owner_email")
    .eq("id", providerId)
    .maybeSingle()
  if (error || !data) return NOT_FOUND
  const ownerEmail = (data.owner_email as string | null) ?? null
  if (!canManageProvider(me, ownerEmail)) return NOT_FOUND
  return {
    ok: true,
    me,
    provider: {
      id: data.id as string,
      name: data.name as string,
      slug: data.slug as string,
      type: data.type as ProviderType,
      config: (data.config ?? {}) as ProviderConfig,
      ownerEmail,
    },
  }
}

export async function requireModelAccess(
  modelId: string
): Promise<
  | { ok: true; me: SessionMember; provider: AccessibleProvider }
  | { ok: false; error: string }
> {
  const { data } = await supabaseAdmin()
    .from("models")
    .select("provider_id")
    .eq("id", modelId)
    .maybeSingle()
  if (!data) {
    await requireMember()
    return { ok: false, error: "Model not found" }
  }
  const access = await requireProviderAccess(data.provider_id as string)
  return access.ok ? access : { ok: false, error: "Model not found" }
}

/** For bulk model changes: every id must belong to a provider you manage. */
export async function requireModelsAccess(
  modelIds: string[]
): Promise<{ ok: true; me: SessionMember } | Denied> {
  const me = await requireMember()
  const { data, error } = await supabaseAdmin()
    .from("models")
    .select("id, providers(owner_email)")
    .in("id", modelIds)
  if (error) return { ok: false, error: error.message }
  const rows = (data ?? []) as unknown as {
    id: string
    providers: { owner_email: string | null } | null
  }[]
  const allowed = rows.every((row) =>
    canManageProvider(me, row.providers?.owner_email ?? null)
  )
  if (!allowed || rows.length !== new Set(modelIds).size) {
    return { ok: false, error: "Some of these models aren't yours to change" }
  }
  return { ok: true, me }
}
