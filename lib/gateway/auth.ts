import "server-only"

import { API_KEY_PREFIX, hashApiKey } from "@/lib/crypto"
import { accessPolicy, type AccessPolicy } from "@/lib/access"
import type { AppRow, MemberRow } from "@/lib/db/types"
import { supabaseAdmin } from "@/lib/supabase/admin"

import { background } from "./background"
import { GatewayError } from "./errors"

/** The person who owns the app a key belongs to. */
export interface KeyOwner {
  email: string
  policy: AccessPolicy
  monthlyBudgetUsd: number | null
}

export interface AuthContext {
  keyId: string
  app: AppRow
  owner: KeyOwner
}

interface CachedKey extends AuthContext {
  revokedAt: string | null
  expiresAt: string | null
}

type OwnerFields = Pick<
  MemberRow,
  "email" | "role" | "model_access" | "allowed_models" | "monthly_budget_usd"
>

const KEY_CACHE_TTL_MS = 30_000
const SPEND_CACHE_TTL_MS = 60_000
const MAX_CACHE_ENTRIES = 5_000

const keyCache = new Map<string, { at: number; value: CachedKey | null }>()
const spendCache = new Map<string, { at: number; spend: number }>()
const lastTouched = new Map<string, number>()

/** Call after creating/revoking keys or changing an app's settings. */
export function invalidateApiKeyCache(): void {
  keyCache.clear()
  spendCache.clear()
}

function unauthorized(message: string) {
  return new GatewayError(
    401,
    message,
    "invalid_api_key",
    "authentication_error"
  )
}

export function extractApiKey(request: Request): string | undefined {
  const authorization = request.headers.get("authorization")
  if (authorization?.toLowerCase().startsWith("bearer "))
    return authorization.slice(7).trim()
  return (
    request.headers.get("x-api-key")?.trim() ||
    request.headers.get("api-key")?.trim() ||
    undefined
  )
}

const OWNER_COLUMNS =
  "members(email, role, model_access, allowed_models, monthly_budget_usd)"

function toKeyOwner(owner: OwnerFields): KeyOwner {
  return {
    email: owner.email,
    policy: accessPolicy(owner),
    monthlyBudgetUsd:
      owner.role === "member" && owner.monthly_budget_usd != null
        ? Number(owner.monthly_budget_usd)
        : null,
  }
}

/**
 * An app with its owner's limits, as if called with one of its keys. Used by
 * the dashboard playground's "run as app".
 */
export async function loadAppContext(
  appId: string
): Promise<AuthContext | null> {
  const { data, error } = await supabaseAdmin()
    .from("apps")
    .select(`*, ${OWNER_COLUMNS}`)
    .eq("id", appId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  const row = data as (AppRow & { members: OwnerFields | null }) | null
  if (!row?.members) return null
  return { keyId: "", app: row, owner: toKeyOwner(row.members) }
}

async function lookupKey(hash: string): Promise<CachedKey | null> {
  const cached = keyCache.get(hash)
  if (cached && Date.now() - cached.at < KEY_CACHE_TTL_MS) return cached.value

  const { data, error } = await supabaseAdmin()
    .from("api_keys")
    .select(`id, revoked_at, expires_at, apps(*, ${OWNER_COLUMNS})`)
    .eq("key_hash", hash)
    .maybeSingle()
  if (error) {
    throw new GatewayError(
      503,
      "The gateway database is unavailable. Try again shortly.",
      "db_unavailable"
    )
  }

  const row = data as {
    id: string
    revoked_at: string | null
    expires_at: string | null
    apps: (AppRow & { members: OwnerFields | null }) | null
  } | null
  // An app always has an owner; without one (removed member) the key is dead.
  const owner = row?.apps?.members
  const value =
    row?.apps && owner
      ? {
          keyId: row.id,
          app: row.apps,
          owner: toKeyOwner(owner),
          revokedAt: row.revoked_at,
          expiresAt: row.expires_at,
        }
      : null
  if (keyCache.size >= MAX_CACHE_ENTRIES) keyCache.clear()
  keyCache.set(hash, { at: Date.now(), value })
  return value
}

function monthStartUtc(): string {
  const now = new Date()
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
  ).toISOString()
}

/** This month's spend for an app or a member (cached for a minute). */
async function monthlySpend(
  scope: { app: string } | { member: string }
): Promise<number> {
  const cacheKey =
    "app" in scope ? `app:${scope.app}` : `member:${scope.member}`
  const cached = spendCache.get(cacheKey)
  if (cached && Date.now() - cached.at < SPEND_CACHE_TTL_MS) return cached.spend
  const { data, error } =
    "app" in scope
      ? await supabaseAdmin().rpc("app_spend_since", {
          p_app: scope.app,
          p_since: monthStartUtc(),
        })
      : await supabaseAdmin().rpc("member_spend_since", {
          p_email: scope.member,
          p_since: monthStartUtc(),
        })
  const spend = error ? (cached?.spend ?? 0) : Number(data ?? 0)
  spendCache.set(cacheKey, { at: Date.now(), spend })
  return spend
}

function touch(keyId: string) {
  const last = lastTouched.get(keyId) ?? 0
  if (Date.now() - last < 60_000) return
  lastTouched.set(keyId, Date.now())
  background(async () => {
    await supabaseAdmin()
      .from("api_keys")
      .update({ last_used_at: new Date().toISOString() })
      .eq("id", keyId)
  })
}

/** Validates the API key and that its app is enabled. */
export async function authenticateRequest(
  request: Request
): Promise<AuthContext> {
  const key = extractApiKey(request)
  if (!key) {
    throw unauthorized(
      "Missing API key. Send it as `Authorization: Bearer <key>` or `x-api-key`."
    )
  }
  if (!key.startsWith(API_KEY_PREFIX) || key.length > 200)
    throw unauthorized("Invalid API key.")

  const found = await lookupKey(hashApiKey(key))
  if (!found) throw unauthorized("Invalid API key.")
  if (found.revokedAt) throw unauthorized("This API key has been revoked.")
  if (found.expiresAt && new Date(found.expiresAt).getTime() < Date.now()) {
    throw unauthorized("This API key has expired.")
  }

  const { app } = found
  if (!app.enabled) {
    throw new GatewayError(
      403,
      `App '${app.name}' is disabled.`,
      "app_disabled",
      "permission_error"
    )
  }

  touch(found.keyId)
  return { keyId: found.keyId, app, owner: found.owner }
}

/** Per-app rate limit and budget, then the owner's monthly budget. */
export async function enforceLimits({
  app,
  owner,
}: AuthContext): Promise<void> {
  if (app.rpm_limit) {
    const { data: allowed, error } = await supabaseAdmin().rpc(
      "hit_rate_limit",
      {
        p_app: app.id,
        p_limit: app.rpm_limit,
      }
    )
    if (!error && allowed === false) {
      const retryAfter = 60 - new Date().getUTCSeconds()
      throw new GatewayError(
        429,
        `Rate limit of ${app.rpm_limit} requests per minute exceeded for app '${app.name}'.`,
        "rate_limit_exceeded",
        "rate_limit_error",
        { "Retry-After": String(retryAfter) }
      )
    }
  }

  if (app.monthly_budget_usd != null) {
    const budget = Number(app.monthly_budget_usd)
    const spend = await monthlySpend({ app: app.id })
    if (spend >= budget) {
      throw new GatewayError(
        403,
        `App '${app.name}' reached its monthly budget of $${budget.toFixed(2)}.`,
        "budget_exceeded",
        "permission_error"
      )
    }
  }

  if (owner.monthlyBudgetUsd != null) {
    const spend = await monthlySpend({ member: owner.email })
    if (spend >= owner.monthlyBudgetUsd) {
      throw new GatewayError(
        403,
        `Your account reached its monthly budget of $${owner.monthlyBudgetUsd.toFixed(2)}. Ask the gateway owner to raise it.`,
        "budget_exceeded",
        "permission_error"
      )
    }
  }
}
