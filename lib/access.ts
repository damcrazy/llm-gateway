// Which models a person may call. Shared by the gateway (enforcement) and the
// dashboard (what to show), so both always agree.

import type { MemberRole, ModelAccess } from "@/lib/db/types"
import { priceTier } from "@/lib/pricing"

export type AccessPolicy =
  | { access: "all" }
  | { access: "free" }
  | { access: "allowlist"; allowed: Set<string> }

export function accessPolicy(member: {
  role: MemberRole
  model_access: ModelAccess
  allowed_models: string[] | null
}): AccessPolicy {
  if (member.role !== "member" || member.model_access === "all") {
    return { access: "all" }
  }
  if (member.model_access === "free") return { access: "free" }
  return { access: "allowlist", allowed: new Set(member.allowed_models ?? []) }
}

interface PricedModel {
  slug: string
  input_price_per_mtok: number | null
  output_price_per_mtok: number | null
}

/** Whether the policy lets a request reach this model (optionally via a route). */
export function modelPermitted(
  policy: AccessPolicy,
  model: PricedModel,
  viaRoute?: string
): boolean {
  switch (policy.access) {
    case "all":
      return true
    case "free":
      return (
        priceTier(model.input_price_per_mtok, model.output_price_per_mtok) ===
        "free"
      )
    case "allowlist":
      return (
        policy.allowed.has(model.slug) ||
        (viaRoute !== undefined && policy.allowed.has(viaRoute))
      )
  }
}

/**
 * Whether `user` may call a model. A private provider's models belong to
 * its owner alone (their access policy doesn't apply: they bring their own
 * keys); shared models follow the policy.
 */
export function canUseModel(
  policy: AccessPolicy,
  model: PricedModel,
  providerOwner: string | null,
  user: string | null,
  viaRoute?: string
): boolean {
  if (providerOwner !== null) return providerOwner === user
  return modelPermitted(policy, model, viaRoute)
}

export function describePolicy(policy: AccessPolicy): string {
  if (policy.access === "free") return "free models only"
  if (policy.access === "allowlist") return "an allow-list of routes and models"
  return "all models"
}
