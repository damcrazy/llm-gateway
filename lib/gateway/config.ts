import "server-only"

import { decryptSecret } from "@/lib/crypto"
import type {
  ModelHealthRow,
  ModelRow,
  ProviderConfig,
  ProviderCredentials,
  ProviderRow,
  RouteRow,
  RouteTargetRow,
} from "@/lib/db/types"
import type { ProviderType } from "@/lib/providers/catalog"
import { env } from "@/lib/env"
import { supabaseAdmin } from "@/lib/supabase/admin"

// In-memory snapshot of providers, models and routes. Each gateway instance
// reloads it at most every SNAPSHOT_TTL_MS, so dashboard edits apply within
// seconds without a database round trip on every request.

const SNAPSHOT_TTL_MS = 15_000

export interface ProviderRuntime {
  id: string
  name: string
  slug: string
  type: ProviderType
  config: ProviderConfig
  enabled: boolean
  /** null = shared provider; otherwise only this member's apps may use it. */
  ownerEmail: string | null
  /**
   * Owned by someone who isn't an admin: calls may only reach public https
   * addresses (admins' providers, shared or private, may use local ones).
   */
  publicOnly: boolean
  quotaRpm: number | null
  quotaRpd: number | null
  credentials: ProviderCredentials
  /** Set when credentials could not be decrypted. */
  credentialError?: string
}

export interface ModelRuntime extends ModelRow {
  provider: ProviderRuntime
}

export interface RouteRuntime extends RouteRow {
  /** Model ids in fallback order. */
  targets: string[]
}

export interface HealthState {
  cooldownUntil: number
  failures: number
  updatedAt: number
}

/** Recent median time to the first token (or full answer) per model. */
export interface LatencyStat {
  firstMs: number
  samples: number
}

export interface GatewaySnapshot {
  providers: Map<string, ProviderRuntime>
  models: Map<string, ModelRuntime>
  modelsBySlug: Map<string, ModelRuntime>
  modelsByUpstreamId: Map<string, ModelRuntime[]>
  routes: Map<string, RouteRuntime>
  health: Map<string, HealthState>
  latency: Map<string, LatencyStat>
  /** Free-tier quota calls this minute / UTC day: "scope:id:period" -> count. */
  quotaUsage: Map<string, number>
  /** Provider ids each person can use because their owner shared them. */
  sharedWith: Map<string, Set<string>>
  /** Provider ids each person switched off for their own apps. */
  switchedOff: Map<string, Set<string>>
  loadedAt: number
}

const LATENCY_WINDOW_MS = 6 * 60 * 60 * 1000

const toNumber = (value: unknown) => (value == null ? null : Number(value))

let snapshot: GatewaySnapshot | undefined
let loading: Promise<GatewaySnapshot> | undefined

export async function getSnapshot(): Promise<GatewaySnapshot> {
  if (snapshot && Date.now() - snapshot.loadedAt < SNAPSHOT_TTL_MS)
    return snapshot
  loading ??= loadSnapshot()
    .then((next) => {
      snapshot = next
      return next
    })
    .finally(() => {
      loading = undefined
    })
  // Serve a stale snapshot rather than failing if the reload errors.
  if (snapshot) return loading.catch(() => snapshot!)
  return loading
}

/** Call after any dashboard change to providers, models or routes. */
export function invalidateGatewayConfig(): void {
  snapshot = undefined
}

/** Whether a provider row's owner is someone other than an admin. */
export function ownerIsRestricted(
  row: Pick<ProviderRow, "owner_email"> & {
    members?: { role?: string } | null
  }
): boolean {
  if (!row.owner_email) return false
  if (row.owner_email === env.superadminEmail()) return false
  const role = row.members?.role
  return role !== "admin" && role !== "superadmin"
}

async function loadSnapshot(): Promise<GatewaySnapshot> {
  const db = supabaseAdmin()
  const [
    providers,
    secrets,
    models,
    routes,
    targets,
    health,
    latency,
    quota,
    shares,
    optOuts,
  ] = await Promise.all([
    db.from("providers").select("*, members!providers_owner_email_fkey(role)"),
    db.from("provider_secrets").select("provider_id, ciphertext"),
    db.from("models").select("*"),
    db.from("routes").select("*"),
    db.from("route_targets").select("*").order("position"),
    db.from("model_health").select("*"),
    // Optional: "fastest" buckets fall back to their listed order without it.
    db.rpc("model_latency_stats", {
      p_since: new Date(Date.now() - LATENCY_WINDOW_MS).toISOString(),
    }),
    db.rpc("current_quota_usage"),
    db.from("provider_shares").select("provider_id, member_email"),
    db.from("provider_opt_outs").select("provider_id, member_email"),
  ])
  for (const result of [providers, secrets, models, routes, targets, health]) {
    if (result.error)
      throw new Error(`Gateway config load failed: ${result.error.message}`)
  }

  const secretByProvider = new Map(
    (secrets.data ?? []).map((row) => [
      row.provider_id as string,
      row.ciphertext as string,
    ])
  )

  const providerMap = new Map<string, ProviderRuntime>()
  for (const row of (providers.data ?? []) as ProviderRow[]) {
    let credentials: ProviderCredentials = {}
    let credentialError: string | undefined
    const ciphertext = secretByProvider.get(row.id)
    if (ciphertext) {
      try {
        credentials = JSON.parse(
          decryptSecret(ciphertext)
        ) as ProviderCredentials
      } catch (error) {
        credentialError = `Could not decrypt credentials: ${(error as Error).message}`
      }
    }
    providerMap.set(row.id, {
      id: row.id,
      name: row.name,
      slug: row.slug,
      type: row.type,
      config: row.config ?? {},
      enabled: row.enabled,
      ownerEmail: row.owner_email ?? null,
      publicOnly: ownerIsRestricted(row),
      quotaRpm: row.quota_rpm ?? null,
      quotaRpd: row.quota_rpd ?? null,
      credentials,
      credentialError,
    })
  }

  const modelMap = new Map<string, ModelRuntime>()
  const bySlug = new Map<string, ModelRuntime>()
  const byUpstream = new Map<string, ModelRuntime[]>()
  for (const row of (models.data ?? []) as ModelRow[]) {
    const provider = providerMap.get(row.provider_id)
    if (!provider) continue
    const model: ModelRuntime = {
      ...row,
      input_price_per_mtok: toNumber(row.input_price_per_mtok),
      output_price_per_mtok: toNumber(row.output_price_per_mtok),
      cached_input_price_per_mtok: toNumber(row.cached_input_price_per_mtok),
      provider,
    }
    modelMap.set(row.id, model)
    bySlug.set(row.slug, model)
    const list = byUpstream.get(row.model_id) ?? []
    list.push(model)
    byUpstream.set(row.model_id, list)
  }

  const targetsByRoute = new Map<string, string[]>()
  for (const target of (targets.data ?? []) as RouteTargetRow[]) {
    const list = targetsByRoute.get(target.route_id) ?? []
    list.push(target.model_id)
    targetsByRoute.set(target.route_id, list)
  }
  const routeMap = new Map<string, RouteRuntime>()
  for (const row of (routes.data ?? []) as RouteRow[]) {
    routeMap.set(row.name, {
      ...row,
      targets: targetsByRoute.get(row.id) ?? [],
    })
  }

  const loadedAt = Date.now()
  const healthMap = new Map<string, HealthState>()
  for (const row of (health.data ?? []) as ModelHealthRow[]) {
    healthMap.set(row.model_id, {
      cooldownUntil: row.cooldown_until
        ? new Date(row.cooldown_until).getTime()
        : 0,
      failures: row.consecutive_failures,
      updatedAt: new Date(row.updated_at).getTime(),
    })
  }

  const latencyMap = new Map<string, LatencyStat>()
  for (const row of (latency.data ?? []) as {
    model_id: string
    first_ms: number
    samples: number
  }[]) {
    latencyMap.set(row.model_id, {
      firstMs: Number(row.first_ms),
      samples: Number(row.samples),
    })
  }

  const quotaUsage = new Map<string, number>()
  for (const row of (quota.data ?? []) as {
    scope: string
    scope_id: string
    period: string
    count: number
  }[]) {
    quotaUsage.set(`${row.scope}:${row.scope_id}:${row.period}`, row.count)
  }

  // If these can't be read, sharing fails closed: only owners keep access.
  if (shares.error)
    console.error("[gateway] provider shares not loaded:", shares.error.message)
  if (optOuts.error)
    console.error(
      "[gateway] provider opt-outs not loaded:",
      optOuts.error.message
    )
  const byEmail = (rows: { provider_id: string; member_email: string }[]) => {
    const map = new Map<string, Set<string>>()
    for (const row of rows) {
      const set = map.get(row.member_email) ?? new Set<string>()
      set.add(row.provider_id)
      map.set(row.member_email, set)
    }
    return map
  }

  return {
    providers: providerMap,
    models: modelMap,
    modelsBySlug: bySlug,
    modelsByUpstreamId: byUpstream,
    routes: routeMap,
    health: healthMap,
    latency: latencyMap,
    quotaUsage,
    sharedWith: byEmail(
      (shares.data ?? []) as { provider_id: string; member_email: string }[]
    ),
    switchedOff: byEmail(
      (optOuts.data ?? []) as { provider_id: string; member_email: string }[]
    ),
    loadedAt,
  }
}
