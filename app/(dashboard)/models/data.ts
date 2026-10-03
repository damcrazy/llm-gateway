import "server-only"

import type { ModelHealthRow, ModelRow, ProviderRow } from "@/lib/db/types"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"

import type { ModelHealthSummary, ModelListItem } from "./shared"

type ProviderSummary = Pick<
  ProviderRow,
  "id" | "name" | "slug" | "type" | "enabled"
>

/**
 * Models (optionally for one provider) joined with provider and health,
 * read through the RLS-gated session client.
 */
export async function loadModelList(
  options: {
    providerId?: string
    /** Only shared providers (the admin Models page). */
    sharedOnly?: boolean
  } = {}
): Promise<{
  models: ModelListItem[]
  providers: ProviderSummary[]
}> {
  const supabase = await createClient()

  let modelQuery = supabase.from("models").select("*").order("slug")
  if (options.providerId)
    modelQuery = modelQuery.eq("provider_id", options.providerId)

  let providerQuery = supabase
    .from("providers")
    .select("id, name, slug, type, enabled")
    .order("name")
  if (options.providerId)
    providerQuery = providerQuery.eq("id", options.providerId)
  if (options.sharedOnly) providerQuery = providerQuery.is("owner_email", null)

  const [modelsResult, providersResult, healthResult, quotaResult] =
    await Promise.all([
      modelQuery,
      providerQuery,
      supabase.from("model_health").select("*"),
      supabaseAdmin().rpc("current_quota_usage"),
    ])
  const quotaUsage = new Map(
    (
      (quotaResult.data ?? []) as {
        scope: string
        scope_id: string
        period: string
        count: number
      }[]
    ).map((row) => [`${row.scope}:${row.scope_id}:${row.period}`, row.count])
  )

  const providers = (providersResult.data ?? []) as ProviderSummary[]
  const providerById = new Map(
    providers.map((provider) => [provider.id, provider])
  )
  const healthByModel = new Map(
    ((healthResult.data ?? []) as ModelHealthRow[]).map((row) => [
      row.model_id,
      row,
    ])
  )
  const now = Date.now()

  const models: ModelListItem[] = []
  for (const row of (modelsResult.data ?? []) as ModelRow[]) {
    const provider = providerById.get(row.provider_id)
    if (!provider) continue
    models.push({
      id: row.id,
      providerId: provider.id,
      providerName: provider.name,
      providerSlug: provider.slug,
      providerType: provider.type,
      providerEnabled: provider.enabled,
      modelId: row.model_id,
      slug: row.slug,
      displayName: row.display_name,
      kind: row.kind,
      enabled: row.enabled,
      capabilities: row.capabilities ?? [],
      tags: row.tags ?? [],
      contextWindow:
        row.context_window == null ? null : Number(row.context_window),
      maxOutputTokens:
        row.max_output_tokens == null ? null : Number(row.max_output_tokens),
      inputPrice:
        row.input_price_per_mtok == null
          ? null
          : Number(row.input_price_per_mtok),
      outputPrice:
        row.output_price_per_mtok == null
          ? null
          : Number(row.output_price_per_mtok),
      cachedInputPrice:
        row.cached_input_price_per_mtok == null
          ? null
          : Number(row.cached_input_price_per_mtok),
      quotaRpm: row.quota_rpm ?? null,
      quotaRpd: row.quota_rpd ?? null,
      quotaUsed:
        row.quota_rpm || row.quota_rpd
          ? {
              minute: quotaUsage.get(`model:${row.id}:minute`) ?? 0,
              day: quotaUsage.get(`model:${row.id}:day`) ?? 0,
            }
          : null,
      health: summarizeHealth(healthByModel.get(row.id), now),
    })
  }

  return { models, providers }
}

function summarizeHealth(
  row: ModelHealthRow | undefined,
  now: number
): ModelHealthSummary | null {
  if (!row) return null
  const until = row.cooldown_until ? new Date(row.cooldown_until).getTime() : 0
  const coolingDown = until > now
  return {
    coolingDown,
    cooldownLeft: coolingDown ? formatDuration(until - now) : null,
    consecutiveFailures: Number(row.consecutive_failures ?? 0),
    lastError: row.last_error,
    lastStatus: row.last_status,
  }
}

/** 95_000 -> "2m", 30_000 -> "30s", 7_500_000 -> "2h 5m". */
function formatDuration(ms: number): string {
  const seconds = Math.ceil(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.ceil(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours}h ${rest}m` : `${hours}h`
}
