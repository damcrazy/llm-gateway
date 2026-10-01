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

export interface GatewaySnapshot {
  providers: Map<string, ProviderRuntime>
  models: Map<string, ModelRuntime>
  modelsBySlug: Map<string, ModelRuntime>
  modelsByUpstreamId: Map<string, ModelRuntime[]>
  routes: Map<string, RouteRuntime>
  health: Map<string, HealthState>
  loadedAt: number
}

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

async function loadSnapshot(): Promise<GatewaySnapshot> {
  const db = supabaseAdmin()
  const [providers, secrets, models, routes, targets, health] =
    await Promise.all([
      db.from("providers").select("*"),
      db.from("provider_secrets").select("provider_id, ciphertext"),
      db.from("models").select("*"),
      db.from("routes").select("*"),
      db.from("route_targets").select("*").order("position"),
      db.from("model_health").select("*"),
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

  return {
    providers: providerMap,
    models: modelMap,
    modelsBySlug: bySlug,
    modelsByUpstreamId: byUpstream,
    routes: routeMap,
    health: healthMap,
    loadedAt,
  }
}
