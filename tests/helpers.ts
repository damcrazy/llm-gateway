import type {
  GatewaySnapshot,
  ModelRuntime,
  ProviderRuntime,
  RouteRuntime,
} from "@/lib/gateway/config"
import type { GatewayApp } from "@/lib/db/types"

let counter = 0
const id = (prefix: string) => `${prefix}-${++counter}`

export function provider(
  overrides: Partial<ProviderRuntime> = {}
): ProviderRuntime {
  const slug = overrides.slug ?? id("prov")
  return {
    id: overrides.id ?? `${slug}-id`,
    name: overrides.name ?? slug,
    slug,
    type: "openai_compatible",
    config: { baseUrl: "http://upstream.test/v1" },
    enabled: true,
    ownerEmail: null,
    credentials: { apiKey: "sk-test" },
    ...overrides,
  }
}

export function model(
  p: ProviderRuntime,
  modelId: string,
  overrides: Partial<ModelRuntime> = {}
): ModelRuntime {
  return {
    id: overrides.id ?? id("model"),
    provider_id: p.id,
    model_id: modelId,
    slug: `${p.slug}/${modelId}`,
    display_name: null,
    kind: "chat",
    enabled: true,
    capabilities: ["tools"],
    tags: [],
    context_window: 128_000,
    max_output_tokens: null,
    input_price_per_mtok: 1,
    output_price_per_mtok: 2,
    cached_input_price_per_mtok: null,
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
    provider: p,
    ...overrides,
  }
}

export function route(
  name: string,
  targets: ModelRuntime[],
  overrides: Partial<RouteRuntime> = {}
): RouteRuntime {
  return {
    id: id("route"),
    name,
    description: null,
    kind: "chat",
    strategy: "fallback",
    max_attempts: 3,
    timeout_ms: 60_000,
    first_token_timeout_ms: 10_000,
    enabled: true,
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
    targets: targets.map((t) => t.id),
    ...overrides,
  }
}

export function snapshot(
  models: ModelRuntime[],
  routes: RouteRuntime[] = []
): GatewaySnapshot {
  const byUpstream = new Map<string, ModelRuntime[]>()
  for (const m of models)
    byUpstream.set(m.model_id, [...(byUpstream.get(m.model_id) ?? []), m])
  return {
    providers: new Map(models.map((m) => [m.provider.id, m.provider])),
    models: new Map(models.map((m) => [m.id, m])),
    modelsBySlug: new Map(models.map((m) => [m.slug, m])),
    modelsByUpstreamId: byUpstream,
    routes: new Map(routes.map((r) => [r.name, r])),
    health: new Map(),
    loadedAt: Date.now(),
  }
}

export function app(overrides: Partial<GatewayApp> = {}): GatewayApp {
  return {
    id: id("app"),
    name: "Test app",
    slug: "test-app",
    description: null,
    enabled: true,
    default_model: null,
    only_bucket_models: false,
    buckets: [],
    monthly_budget_usd: null,
    rpm_limit: null,
    log_payloads: false,
    owner_email: "owner@example.com",
    created_by: null,
    created_at: new Date(0).toISOString(),
    updated_at: new Date(0).toISOString(),
    ...overrides,
  }
}
