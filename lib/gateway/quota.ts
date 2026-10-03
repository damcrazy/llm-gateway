import "server-only"

import { supabaseAdmin } from "@/lib/supabase/admin"

import { background } from "./background"
import type { GatewaySnapshot, ModelRuntime } from "./config"

// Free-tier quotas: request caps per minute / per UTC day on a model, or
// shared by all of a provider's models. Counts come from the config snapshot
// (refreshed every few seconds) plus this instance's own calls since then,
// so a model is skipped as soon as its cap is reached rather than called and
// rejected with a 429.

type Period = "minute" | "day"
type Scope = "model" | "provider"

const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE

export function periodStart(period: Period, now = Date.now()): number {
  return period === "minute"
    ? Math.floor(now / MINUTE) * MINUTE
    : Math.floor(now / DAY) * DAY
}

/** Counted by this instance since the snapshot was loaded. */
const local = new Map<string, number>()
let localSnapshot = 0

function localKey(scope: Scope, id: string, period: Period, now: number) {
  return `${scope}:${id}:${period}:${periodStart(period, now)}`
}

function used(
  snapshot: GatewaySnapshot,
  scope: Scope,
  id: string,
  period: Period,
  now: number
): number {
  if (localSnapshot !== snapshot.loadedAt) {
    local.clear()
    localSnapshot = snapshot.loadedAt
  }
  // The snapshot's count only applies while we're still in its period.
  const fromSnapshot =
    periodStart(period, snapshot.loadedAt) === periodStart(period, now)
      ? (snapshot.quotaUsage.get(`${scope}:${id}:${period}`) ?? 0)
      : 0
  return fromSnapshot + (local.get(localKey(scope, id, period, now)) ?? 0)
}

function limitsFor(model: ModelRuntime) {
  return [
    {
      scope: "model" as const,
      id: model.id,
      label: model.slug,
      rpm: model.quota_rpm,
      rpd: model.quota_rpd,
    },
    {
      scope: "provider" as const,
      id: model.provider.id,
      label: model.provider.name,
      rpm: model.provider.quotaRpm,
      rpd: model.provider.quotaRpd,
    },
  ]
}

export interface QuotaBlock {
  reason: string
  /** Seconds until the cap resets. */
  retryAfter: number
}

/** Why this model can't be called right now, or null if it can. */
export function quotaBlock(
  snapshot: GatewaySnapshot,
  model: ModelRuntime,
  now = Date.now()
): QuotaBlock | null {
  for (const limit of limitsFor(model)) {
    if (
      limit.rpm &&
      used(snapshot, limit.scope, limit.id, "minute", now) >= limit.rpm
    ) {
      return {
        reason: `${limit.label} used its ${limit.rpm} requests/minute quota`,
        retryAfter: Math.ceil(
          (periodStart("minute", now) + MINUTE - now) / 1000
        ),
      }
    }
    if (
      limit.rpd &&
      used(snapshot, limit.scope, limit.id, "day", now) >= limit.rpd
    ) {
      return {
        reason: `${limit.label} used its ${limit.rpd} requests/day quota (resets at 00:00 UTC)`,
        retryAfter: Math.ceil((periodStart("day", now) + DAY - now) / 1000),
      }
    }
  }
  return null
}

/** Counts a provider call, for models or providers that have a quota. */
export function noteProviderCall(
  snapshot: GatewaySnapshot,
  model: ModelRuntime
) {
  const limits = limitsFor(model)
  if (!limits.some((limit) => limit.rpm || limit.rpd)) return
  const now = Date.now()
  used(snapshot, "model", model.id, "minute", now) // resets stale local counts
  for (const limit of limits) {
    for (const period of ["minute", "day"] as const) {
      const key = localKey(limit.scope, limit.id, period, now)
      local.set(key, (local.get(key) ?? 0) + 1)
    }
  }
  background(async () => {
    await supabaseAdmin().rpc("bump_quota", {
      p_model: model.id,
      p_provider: model.provider.id,
    })
  })
}
