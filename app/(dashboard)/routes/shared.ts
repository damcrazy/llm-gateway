// Constants and types shared by the routes pages, their client components and
// server actions. Kept out of actions.ts because "use server" files may only
// export async functions.

import type { ModelKind, RouteKind, RouteStrategy } from "@/lib/db/types"
import type { Capability } from "@/lib/providers/catalog"

/** Mirrors the check constraint on routes.name. */
export const ROUTE_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]*$/

/** "default" already means "the app's default model" to the gateway. */
export const RESERVED_ROUTE_NAMES = ["default"]

export const ROUTE_NAME_MAX_LENGTH = 64

export const MAX_ROUTE_TARGETS = 50

/** Returns a human-readable problem with a route name, or null if it's valid. */
export function routeNameError(name: string): string | null {
  if (!name) return "Enter a name"
  if (name.length > ROUTE_NAME_MAX_LENGTH) {
    return `Keep it under ${ROUTE_NAME_MAX_LENGTH} characters`
  }
  if (name.includes("/")) {
    return "No slashes: names with a slash are reserved for model slugs"
  }
  if (!ROUTE_NAME_PATTERN.test(name)) {
    return "Use lowercase letters, numbers, dots, dashes and underscores, starting with a letter or number"
  }
  if (RESERVED_ROUTE_NAMES.includes(name)) {
    return `"${name}" is reserved for each app's default model`
  }
  return null
}

export const STRATEGY_OPTIONS: {
  value: RouteStrategy
  label: string
  description: string
}[] = [
  {
    value: "fallback",
    label: "Fallback",
    description:
      "Always start with the first target; later targets are only used when earlier ones fail or are cooling down.",
  },
  {
    value: "round_robin",
    label: "Round robin",
    description:
      "Rotate the starting target on every request to spread load; the others still act as fallbacks.",
  },
]

export const STRATEGY_LABELS: Record<RouteStrategy, string> = {
  fallback: "Fallback",
  round_robin: "Round robin",
}

export const KIND_LABELS: Record<RouteKind, string> = {
  chat: "Chat",
  embedding: "Embedding",
}

/** Payload of updateRouteSettings. Timeouts are in seconds; stored as ms. */
export interface RouteSettingsInput {
  description: string
  strategy: RouteStrategy
  maxAttempts: number
  timeoutSeconds: number
  firstTokenTimeoutSeconds: number
  enabled: boolean
}

/** A model as the route targets editor needs it (plain data, safe to pass to the client). */
export interface TargetModel {
  id: string
  slug: string
  displayName: string | null
  kind: ModelKind
  enabled: boolean
  providerName: string
  providerEnabled: boolean
  capabilities: Capability[]
  /** null = unknown; 0 = free */
  inputPrice: number | null
  outputPrice: number | null
  coolingDown: boolean
  /** e.g. "in 4 minutes", only while cooling down. */
  cooldownLabel: string | null
  lastError: string | null
}
