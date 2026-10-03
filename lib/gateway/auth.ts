import "server-only"

import { API_KEY_PREFIX, hashApiKey } from "@/lib/crypto"
import { accessPolicy, type AccessPolicy } from "@/lib/access"
import type {
  AppBucketRow,
  AppRow,
  GatewayApp,
  MemberRow,
} from "@/lib/db/types"
import { supabaseAdmin } from "@/lib/supabase/admin"

import { background } from "./background"
import { GatewayError } from "./errors"

/** The person who owns the app a key belongs to. */
export interface KeyOwner {
  email: string
  policy: AccessPolicy
  monthlyBudgetUsd: number | null
}

/** The API key a request used, with its own limits. */
export interface KeyContext {
  id: string
  name: string
  rpmLimit: number | null
  tpmLimit: number | null
  monthlyBudgetUsd: number | null
}

export interface AuthContext {
  keyId: string
  key: KeyContext
  app: GatewayApp
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
const BUCKET_COLUMNS =
  "app_buckets(name, position, model_ids, strategy, hedge_after_ms)"

type AppWithRelations = AppRow & {
  members: OwnerFields | null
  app_buckets:
    | Pick<
        AppBucketRow,
        "name" | "position" | "model_ids" | "strategy" | "hedge_after_ms"
      >[]
    | null
}

function toGatewayApp(row: AppWithRelations): GatewayApp {
  return {
    ...row,
    buckets: [...(row.app_buckets ?? [])]
      .sort((a, b) => a.position - b.position)
      .map((bucket) => ({
        name: bucket.name,
        model_ids: bucket.model_ids,
        strategy: bucket.strategy ?? "ordered",
        hedge_after_ms: bucket.hedge_after_ms ?? null,
      })),
  }
}

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
    .select(`*, ${OWNER_COLUMNS}, ${BUCKET_COLUMNS}`)
    .eq("id", appId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  const row = data as AppWithRelations | null
  if (!row?.members) return null
  return {
    keyId: "",
    key: {
      id: "",
      name: "playground",
      rpmLimit: null,
      tpmLimit: null,
      monthlyBudgetUsd: null,
    },
    app: toGatewayApp(row),
    owner: toKeyOwner(row.members),
  }
}

async function lookupKey(hash: string): Promise<CachedKey | null> {
  const cached = keyCache.get(hash)
  if (cached && Date.now() - cached.at < KEY_CACHE_TTL_MS) return cached.value

  const { data, error } = await supabaseAdmin()
    .from("api_keys")
    .select(
      `id, name, revoked_at, expires_at, rpm_limit, tpm_limit, monthly_budget_usd, apps(*, ${OWNER_COLUMNS}, ${BUCKET_COLUMNS})`
    )
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
    name: string
    revoked_at: string | null
    expires_at: string | null
    rpm_limit: number | null
    tpm_limit: number | null
    monthly_budget_usd: number | null
    apps: AppWithRelations | null
  } | null
  // An app always has an owner; without one (removed member) the key is dead.
  const owner = row?.apps?.members
  const value =
    row?.apps && owner
      ? {
          keyId: row.id,
          key: {
            id: row.id,
            name: row.name,
            rpmLimit: row.rpm_limit,
            tpmLimit: row.tpm_limit,
            monthlyBudgetUsd:
              row.monthly_budget_usd == null
                ? null
                : Number(row.monthly_budget_usd),
          },
          app: toGatewayApp(row.apps),
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
/** This month's spend; `fresh` skips (and refreshes) the minute-long cache. */
export async function monthlySpend(
  scope: { app: string } | { member: string } | { key: string },
  { fresh = false } = {}
): Promise<number> {
  const cacheKey =
    "app" in scope
      ? `app:${scope.app}`
      : "key" in scope
        ? `key:${scope.key}`
        : `member:${scope.member}`
  const cached = spendCache.get(cacheKey)
  if (!fresh && cached && Date.now() - cached.at < SPEND_CACHE_TTL_MS)
    return cached.spend
  const since = monthStartUtc()
  const { data, error } =
    "app" in scope
      ? await supabaseAdmin().rpc("app_spend_since", {
          p_app: scope.app,
          p_since: since,
        })
      : "key" in scope
        ? await supabaseAdmin().rpc("key_spend_since", {
            p_key: scope.key,
            p_since: since,
          })
        : await supabaseAdmin().rpc("member_spend_since", {
            p_email: scope.member,
            p_since: since,
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
  return { keyId: found.keyId, key: found.key, app, owner: found.owner }
}

// Requests and tokens per minute without a database wait on every call.
// Each instance counts its own usage exactly; the shared count in the
// database is bumped in the background, and once it reports a scope (an app
// or a key) over its limit this instance refuses it until the minute ends.
// Across instances that allows a little overshoot, in exchange for no added
// latency. Tokens are only known after a response, so the request that goes
// over the token limit still finishes; the next ones are refused.
const localMinuteCounts = new Map<string, { minute: number; count: number }>()
const overLimitUntil = new Map<string, number>()
const localMinuteTokens = new Map<string, { minute: number; tokens: number }>()
const overTokensUntil = new Map<string, number>()

const appSubject = (app: GatewayApp) => `app '${app.name}'`
const keySubject = (key: KeyContext) => `API key '${key.name}'`

function limitError(message: string) {
  const retryAfter = 60 - new Date().getUTCSeconds()
  return new GatewayError(
    429,
    message,
    "rate_limit_exceeded",
    "rate_limit_error",
    { "Retry-After": String(retryAfter) }
  )
}

function checkRateLimit(scopeId: string, subject: string, limit: number) {
  const error = () =>
    limitError(
      `Rate limit of ${limit} requests per minute exceeded for ${subject}.`
    )
  const now = Date.now()
  const minute = Math.floor(now / 60_000)
  if ((overLimitUntil.get(scopeId) ?? 0) > now) throw error()
  const local = localMinuteCounts.get(scopeId)
  const count = local?.minute === minute ? local.count + 1 : 1
  if (localMinuteCounts.size >= MAX_CACHE_ENTRIES) localMinuteCounts.clear()
  localMinuteCounts.set(scopeId, { minute, count })
  if (count > limit) throw error()

  background(async () => {
    // Request counters are keyed by id, so an app and a key never collide.
    const { data: allowed } = await supabaseAdmin().rpc("hit_rate_limit", {
      p_app: scopeId,
      p_limit: limit,
    })
    if (allowed === false) overLimitUntil.set(scopeId, (minute + 1) * 60_000)
  })
}

function checkTokenLimit(scopeId: string, subject: string, limit: number) {
  const now = Date.now()
  const minute = Math.floor(now / 60_000)
  const local = localMinuteTokens.get(scopeId)
  if (
    (overTokensUntil.get(scopeId) ?? 0) > now ||
    (local?.minute === minute && local.tokens >= limit)
  ) {
    throw limitError(
      `Token limit of ${limit.toLocaleString("en-US")} tokens per minute reached for ${subject}.`
    )
  }
}

/** Counts a finished request's tokens against the app's and key's limits. */
export function recordTokens(auth: AuthContext, tokens: number): void {
  if (tokens <= 0) return
  const scopes: [string, number][] = []
  if (auth.app.tpm_limit) scopes.push([auth.app.id, auth.app.tpm_limit])
  if (auth.key.tpmLimit && auth.key.id)
    scopes.push([auth.key.id, auth.key.tpmLimit])
  if (!scopes.length) return
  const minute = Math.floor(Date.now() / 60_000)
  for (const [scopeId, limit] of scopes) {
    const local = localMinuteTokens.get(scopeId)
    const total = (local?.minute === minute ? local.tokens : 0) + tokens
    if (localMinuteTokens.size >= MAX_CACHE_ENTRIES) localMinuteTokens.clear()
    localMinuteTokens.set(scopeId, { minute, tokens: total })
    background(async () => {
      const { data } = await supabaseAdmin().rpc("add_tokens", {
        p_scope: scopeId,
        p_tokens: Math.min(tokens, 2_000_000_000),
      })
      if (Number(data) >= limit)
        overTokensUntil.set(scopeId, (minute + 1) * 60_000)
    })
  }
}

function budgetError(message: string) {
  return new GatewayError(403, message, "budget_exceeded", "permission_error")
}

/**
 * Per-app and per-key requests and tokens per minute, then the app's, the
 * key's and the owner's monthly budgets.
 */

export async function enforceLimits({
  app,
  key,
  owner,
}: AuthContext): Promise<void> {
  if (app.tpm_limit) checkTokenLimit(app.id, appSubject(app), app.tpm_limit)
  if (key.id && key.tpmLimit)
    checkTokenLimit(key.id, keySubject(key), key.tpmLimit)
  if (key.id && key.rpmLimit)
    checkRateLimit(key.id, keySubject(key), key.rpmLimit)
  if (app.rpm_limit) checkRateLimit(app.id, appSubject(app), app.rpm_limit)

  const [appSpend, keySpend, ownerSpend] = await Promise.all([
    app.monthly_budget_usd != null ? monthlySpend({ app: app.id }) : null,
    key.id && key.monthlyBudgetUsd != null
      ? monthlySpend({ key: key.id })
      : null,
    owner.monthlyBudgetUsd != null
      ? monthlySpend({ member: owner.email })
      : null,
  ])

  if (appSpend !== null) {
    const budget = Number(app.monthly_budget_usd)
    if (appSpend >= budget) {
      throw budgetError(
        `App '${app.name}' reached its monthly budget of $${budget.toFixed(2)}.`
      )
    }
  }
  if (keySpend !== null && keySpend >= key.monthlyBudgetUsd!) {
    throw budgetError(
      `API key '${key.name}' reached its monthly budget of $${key.monthlyBudgetUsd!.toFixed(2)}.`
    )
  }
  if (ownerSpend !== null && ownerSpend >= owner.monthlyBudgetUsd!) {
    throw budgetError(
      `Your account reached its monthly budget of $${owner.monthlyBudgetUsd!.toFixed(2)}. Ask the gateway owner to raise it.`
    )
  }
}
