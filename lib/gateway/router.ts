import "server-only"

import { describePolicy, modelPermitted, type AccessPolicy } from "@/lib/access"
import type { AppBucket, GatewayApp, ModelKind } from "@/lib/db/types"
import { CAPABILITY_LABELS } from "@/lib/providers/catalog"

import type { GatewaySnapshot, ModelRuntime, RouteRuntime } from "./config"
import { GatewayError } from "./errors"
import { cooldownRemainingMs } from "./health"
import type { ChatRequest } from "./types"
import { estimateRequestTokens, requiredCapabilities } from "./usage"

export interface Resolution {
  requestedModel: string
  route?: RouteRuntime
  /** Set when the name is one of the app's buckets. */
  bucket?: AppBucket
  /** In the order they should be tried. */
  candidates: ModelRuntime[]
  maxAttempts: number
  timeoutMs: number
  firstTokenTimeoutMs: number
  notes: string[]
}

const DEFAULT_TIMEOUT_MS = 600_000
const DEFAULT_FIRST_TOKEN_TIMEOUT_MS = 120_000
/** A bucket's chain is tried in full, up to this many models. */
const MAX_BUCKET_ATTEMPTS = 10
const roundRobin = new Map<string, number>()

export function resolveModel(
  snapshot: GatewaySnapshot,
  requested: string | undefined,
  kind: ModelKind,
  app: GatewayApp | null,
  request?: ChatRequest,
  policy: AccessPolicy = { access: "all" }
): Resolution {
  const buckets = app?.buckets ?? []
  let name = requested?.trim() ?? ""
  if (!name || name === "default") name = app?.default_model ?? ""
  if (!name) {
    throw new GatewayError(
      400,
      "The `model` field is required.",
      "model_required"
    )
  }

  // The app's own buckets come first, then global routes, then model slugs.
  const bucket = buckets.find((b) => b.name === name)
  const route = bucket ? undefined : snapshot.routes.get(name)
  let targets: ModelRuntime[]

  if (bucket) {
    targets = bucket.model_ids
      .map((id) => snapshot.models.get(id))
      .filter((model): model is ModelRuntime => Boolean(model))
    if (!targets.length) {
      throw new GatewayError(
        503,
        `Bucket '${name}' has no models yet. Add some on the app's Models tab.`,
        "no_available_models"
      )
    }
  } else if (route) {
    if (!route.enabled) {
      throw new GatewayError(
        404,
        `Route '${name}' is disabled.`,
        "model_not_found"
      )
    }
    if (route.kind !== kind) {
      throw new GatewayError(
        400,
        `Route '${name}' serves ${route.kind} models and cannot be used for ${kind} requests.`,
        "invalid_model"
      )
    }
    targets = route.targets
      .map((id) => snapshot.models.get(id))
      .filter((model): model is ModelRuntime => Boolean(model))
  } else {
    const bySlug = snapshot.modelsBySlug.get(name)
    targets = bySlug ? [bySlug] : (snapshot.modelsByUpstreamId.get(name) ?? [])
    if (!targets.length) {
      throw new GatewayError(
        404,
        `Model '${name}' is not configured on this gateway. Use a route name or a model slug; GET /v1/models lists what this key can use.`,
        "model_not_found"
      )
    }
  }

  if (app?.only_bucket_models && !bucket) {
    const inBuckets = new Set(buckets.flatMap((b) => b.model_ids))
    targets = targets.filter((model) => inBuckets.has(model.id))
    if (!targets.length) {
      const names = buckets.map((b) => `'${b.name}'`).join(", ")
      throw new GatewayError(
        403,
        names
          ? `This API key's app only allows its buckets (${names}) and the models in them; '${name}' isn't one.`
          : `This API key's app only allows models in its buckets, and it has none yet.`,
        "model_not_allowed",
        "permission_error"
      )
    }
  }

  if (policy.access !== "all") {
    targets = targets.filter((model) =>
      modelPermitted(policy, model, route?.name)
    )
    if (!targets.length) {
      throw new GatewayError(
        403,
        `Your account can use ${describePolicy(policy)}, and '${name}' has none of those.`,
        "model_not_allowed",
        "permission_error"
      )
    }
  }

  let usable = targets.filter(
    (model) => model.enabled && model.provider.enabled && model.kind === kind
  )
  if (!usable.length) {
    throw new GatewayError(
      503,
      `No enabled ${kind} models are available for '${name}'.`,
      "no_available_models"
    )
  }

  if (route?.strategy === "round_robin" && usable.length > 1) {
    const offset = (roundRobin.get(route.id) ?? 0) % usable.length
    roundRobin.set(route.id, offset + 1)
    usable = [...usable.slice(offset), ...usable.slice(0, offset)]
  }

  const notes: string[] = []
  if (kind === "chat" && request) {
    const needed = [...requiredCapabilities(request)]
    if (needed.length) {
      const capable = usable.filter((model) =>
        needed.every((capability) => model.capabilities.includes(capability))
      )
      if (capable.length) usable = capable
      else {
        notes.push(
          `No model marked with ${needed.map((c) => CAPABILITY_LABELS[c]).join(", ")}; trying all targets.`
        )
      }
    }

    const estimate = estimateRequestTokens(request)
    const fits = usable.filter(
      (model) => !model.context_window || estimate <= model.context_window
    )
    if (fits.length) usable = fits
    else
      notes.push(
        `Request (~${estimate} tokens) may exceed every target's context window.`
      )
  }

  // Healthy models first; models cooling down are a last resort.
  const healthy = usable.filter(
    (model) => cooldownRemainingMs(snapshot, model.id) === 0
  )
  const cooling = usable
    .filter((model) => cooldownRemainingMs(snapshot, model.id) > 0)
    .sort(
      (a, b) =>
        cooldownRemainingMs(snapshot, a.id) -
        cooldownRemainingMs(snapshot, b.id)
    )

  const candidates = [...healthy, ...cooling]
  return {
    requestedModel: name,
    route,
    bucket,
    candidates,
    maxAttempts: bucket
      ? Math.min(candidates.length, MAX_BUCKET_ATTEMPTS)
      : (route?.max_attempts ?? Math.max(2, Math.min(candidates.length, 3))),
    timeoutMs: route?.timeout_ms ?? DEFAULT_TIMEOUT_MS,
    firstTokenTimeoutMs:
      route?.first_token_timeout_ms ?? DEFAULT_FIRST_TOKEN_TIMEOUT_MS,
    notes,
  }
}

export interface AvailableEntry {
  id: string
  kind: ModelKind
  ownedBy: string
  created: string
  displayName: string
  /** Set for the app's own buckets. */
  bucket?: AppBucket
}

/** Bucket names, route names and model slugs an app may call, for GET /v1/models. */
export function listAvailableModels(
  snapshot: GatewaySnapshot,
  app: GatewayApp | null,
  policy: AccessPolicy = { access: "all" }
): AvailableEntry[] {
  const buckets = app?.buckets ?? []
  const onlyBuckets = app?.only_bucket_models === true
  const inBuckets = new Set(buckets.flatMap((b) => b.model_ids))
  const usable = (model: ModelRuntime | undefined): model is ModelRuntime =>
    Boolean(
      model?.enabled && model.provider.enabled && modelPermitted(policy, model)
    )

  const bucketEntries: AvailableEntry[] = []
  for (const bucket of buckets) {
    const chain = bucket.model_ids
      .map((id) => snapshot.models.get(id))
      .filter(usable)
    const first = chain[0]
    if (!first || !app) continue
    bucketEntries.push({
      id: bucket.name,
      kind: first.kind,
      ownedBy: "app",
      created: app.created_at,
      displayName: `${bucket.name}: ${chain.map((m) => m.display_name || m.model_id).join(" → ")}`,
      bucket,
    })
  }

  const entries: AvailableEntry[] = []
  const bucketNames = new Set(buckets.map((b) => b.name))
  for (const route of snapshot.routes.values()) {
    // Buckets hide global routes of the same name; "only buckets" hides all.
    if (!route.enabled || onlyBuckets || bucketNames.has(route.name)) continue
    const reachable = route.targets.some((id) => {
      const model = snapshot.models.get(id)
      return (
        model?.enabled &&
        model.provider.enabled &&
        modelPermitted(policy, model, route.name)
      )
    })
    if (!reachable) continue
    entries.push({
      id: route.name,
      kind: route.kind,
      ownedBy: "gateway",
      created: route.created_at,
      displayName: route.description || route.name,
    })
  }
  for (const model of snapshot.models.values()) {
    if (!model.enabled || !model.provider.enabled) continue
    if (onlyBuckets && !inBuckets.has(model.id)) continue
    if (!modelPermitted(policy, model)) continue
    entries.push({
      id: model.slug,
      kind: model.kind,
      ownedBy: model.provider.slug,
      created: model.created_at,
      displayName: model.display_name || model.model_id,
    })
  }
  return [...bucketEntries, ...entries.sort((a, b) => a.id.localeCompare(b.id))]
}
