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
  /** Needed for providers shared with the user or switched off by them. */
  provider_id?: string
  input_price_per_mtok: number | null
  output_price_per_mtok: number | null
}

/**
 * Providers a person can use beyond the gateway's own and their own:
 * other members' providers shared with them, and providers they switched
 * off for their own apps.
 */
export interface ProviderReach {
  sharedWithMe: ReadonlySet<string>
  switchedOff: ReadonlySet<string>
}

export const NO_REACH: ProviderReach = {
  sharedWithMe: new Set(),
  switchedOff: new Set(),
}

/**
 * Whether a provider's models exist at all for `user`: the gateway's own
 * providers, theirs, and ones shared with them. Another member's private
 * provider doesn't, so it can't even be named.
 */
export function providerVisible(
  providerId: string,
  providerOwner: string | null,
  user: string | null,
  reach: ProviderReach = NO_REACH
): boolean {
  return (
    providerOwner === null ||
    providerOwner === user ||
    reach.sharedWithMe.has(providerId)
  )
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
 * its owner and the people they shared it with (the access policy doesn't
 * apply: the owner's key pays); the gateway's models follow the policy.
 * A provider the user switched off is never used for them.
 */
export function canUseModel(
  policy: AccessPolicy,
  model: PricedModel,
  providerOwner: string | null,
  user: string | null,
  viaRoute?: string,
  reach: ProviderReach = NO_REACH
): boolean {
  const providerId = model.provider_id
  if (providerId && reach.switchedOff.has(providerId)) return false
  if (providerOwner !== null)
    return (
      providerOwner === user ||
      (providerId !== undefined && reach.sharedWithMe.has(providerId))
    )
  return modelPermitted(policy, model, viaRoute)
}

export function describePolicy(policy: AccessPolicy): string {
  if (policy.access === "free") return "free models only"
  if (policy.access === "allowlist") return "an allow-list of routes and models"
  return "all models"
}
