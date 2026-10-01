import "server-only"

import { describePolicy, modelPermitted, type AccessPolicy } from "@/lib/access"
import type { AppRow, ModelKind } from "@/lib/db/types"
import { CAPABILITY_LABELS } from "@/lib/providers/catalog"

import type { GatewaySnapshot, ModelRuntime, RouteRuntime } from "./config"
import { GatewayError } from "./errors"
import { cooldownRemainingMs } from "./health"
import type { ChatRequest } from "./types"
import { estimateRequestTokens, requiredCapabilities } from "./usage"

export interface Resolution {
  requestedModel: string
  route?: RouteRuntime
  /** In the order they should be tried. */
  candidates: ModelRuntime[]
  maxAttempts: number
  timeoutMs: number
  firstTokenTimeoutMs: number
  notes: string[]
}

const DEFAULT_TIMEOUT_MS = 600_000
const DEFAULT_FIRST_TOKEN_TIMEOUT_MS = 120_000
const roundRobin = new Map<string, number>()

export function resolveModel(
  snapshot: GatewaySnapshot,
  requested: string | undefined,
  kind: ModelKind,
  app: AppRow | null,
  request?: ChatRequest,
  policy: AccessPolicy = { access: "all" }
): Resolution {
  let name = requested?.trim() ?? ""
  if (!name || name === "default") name = app?.default_model ?? ""
  if (!name) {
    throw new GatewayError(
      400,
      "The `model` field is required.",
      "model_required"
    )
  }

  const route = snapshot.routes.get(name)
  let targets: ModelRuntime[]

  if (route) {
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

  if (app?.allowed_models.length) {
    const allowed = new Set(app.allowed_models)
    targets = allowed.has(name)
      ? targets
      : targets.filter((model) => allowed.has(model.slug))
    if (!targets.length) {
      throw new GatewayError(
        403,
        `This API key's app is not allowed to use '${name}'.`,
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
    candidates,
    maxAttempts:
      route?.max_attempts ?? Math.max(2, Math.min(candidates.length, 3)),
    timeoutMs: route?.timeout_ms ?? DEFAULT_TIMEOUT_MS,
    firstTokenTimeoutMs:
      route?.first_token_timeout_ms ?? DEFAULT_FIRST_TOKEN_TIMEOUT_MS,
    notes,
  }
}

/** Route names and model slugs an app may call, for GET /v1/models. */
export function listAvailableModels(
  snapshot: GatewaySnapshot,
  app: AppRow | null,
  policy: AccessPolicy = { access: "all" }
): Array<{
  id: string
  kind: ModelKind
  ownedBy: string
  created: string
  displayName: string
}> {
  const allowed = app?.allowed_models.length
    ? new Set(app.allowed_models)
    : null
  const entries: Array<{
    id: string
    kind: ModelKind
    ownedBy: string
    created: string
    displayName: string
  }> = []
  for (const route of snapshot.routes.values()) {
    if (!route.enabled || (allowed && !allowed.has(route.name))) continue
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
    if (allowed && !allowed.has(model.slug)) continue
    if (!modelPermitted(policy, model)) continue
    entries.push({
      id: model.slug,
      kind: model.kind,
      ownedBy: model.provider.slug,
      created: model.created_at,
      displayName: model.display_name || model.model_id,
    })
  }
  return entries.sort((a, b) => a.id.localeCompare(b.id))
}
