import "server-only"

import { supabaseAdmin } from "@/lib/supabase/admin"

import { background } from "./background"
import type { GatewaySnapshot, HealthState, ModelRuntime } from "./config"
import type { UpstreamError } from "./errors"

// Per-model circuit breaker. State lives in public.model_health so every
// instance agrees; this module also keeps a local copy so the instance that
// saw the failure reacts immediately, before the next snapshot reload.

const local = new Map<string, HealthState>()

function effective(
  snapshot: GatewaySnapshot,
  modelId: string
): HealthState | undefined {
  const mine = local.get(modelId)
  const shared = snapshot.health.get(modelId)
  if (!mine) return shared
  // No row in a snapshot loaded well after our write means it was reset from
  // the dashboard: the database wins.
  if (!shared)
    return snapshot.loadedAt > mine.updatedAt + 5_000 ? undefined : mine
  return mine.updatedAt >= shared.updatedAt ? mine : shared
}

export function cooldownRemainingMs(
  snapshot: GatewaySnapshot,
  modelId: string
): number {
  return Math.max(
    0,
    (effective(snapshot, modelId)?.cooldownUntil ?? 0) - Date.now()
  )
}

export interface FailureDecision {
  /** Try the next candidate. */
  failover: boolean
  /** Seconds to keep this model out of rotation (0 = no cooldown). */
  cooldownSeconds: number
  /** Worth retrying the same model later in this request. */
  transient: boolean
}

const MAX_RATE_LIMIT_COOLDOWN_S = 24 * 3600

export function decideOnFailure(
  snapshot: GatewaySnapshot,
  modelId: string,
  error: UpstreamError
): FailureDecision {
  const failures = (effective(snapshot, modelId)?.failures ?? 0) + 1
  const backoff = Math.min(300, 10 * 2 ** (failures - 1))
  const status = error.status

  if (error.kind === "config")
    return { failover: true, cooldownSeconds: 300, transient: false }
  if (status == null)
    return { failover: true, cooldownSeconds: backoff, transient: true }
  if (status === 429) {
    const retryAfter = error.options.retryAfterMs
    const seconds = retryAfter ? Math.ceil(retryAfter / 1000) : 60
    return {
      failover: true,
      cooldownSeconds: Math.min(
        Math.max(seconds, 5),
        MAX_RATE_LIMIT_COOLDOWN_S
      ),
      transient: false,
    }
  }
  if (status === 401 || status === 403 || status === 404) {
    return { failover: true, cooldownSeconds: 300, transient: false }
  }
  if (status === 408 || status >= 500) {
    return { failover: true, cooldownSeconds: backoff, transient: true }
  }
  // 400/413/422 etc.: the request may still work elsewhere (context length,
  // unsupported parameter), but it says nothing about the model's health.
  return { failover: true, cooldownSeconds: 0, transient: false }
}

export function recordFailure(
  model: ModelRuntime,
  snapshot: GatewaySnapshot,
  error: UpstreamError,
  cooldownSeconds: number
): void {
  if (cooldownSeconds <= 0) return
  const previous = effective(snapshot, model.id)
  local.set(model.id, {
    cooldownUntil: Math.max(
      previous?.cooldownUntil ?? 0,
      Date.now() + cooldownSeconds * 1000
    ),
    failures: (previous?.failures ?? 0) + 1,
    updatedAt: Date.now(),
  })
  background(async () => {
    const { error: dbError } = await supabaseAdmin().rpc(
      "record_model_failure",
      {
        p_model: model.id,
        p_status: error.status ?? 0,
        p_error: error.message,
        p_cooldown_seconds: cooldownSeconds,
      }
    )
    if (dbError) throw dbError
  })
}

export function recordSuccess(
  model: ModelRuntime,
  snapshot: GatewaySnapshot
): void {
  const state = effective(snapshot, model.id)
  if (!state || (state.failures === 0 && state.cooldownUntil <= Date.now()))
    return
  local.set(model.id, { cooldownUntil: 0, failures: 0, updatedAt: Date.now() })
  background(async () => {
    const { error } = await supabaseAdmin().rpc("record_model_success", {
      p_model: model.id,
    })
    if (error) throw error
  })
}
