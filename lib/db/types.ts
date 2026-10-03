// Row shapes for the tables in supabase/migrations. Hand-written so the app
// builds without a linked Supabase project; keep in sync with the SQL.

import type { Capability, ProviderType } from "@/lib/providers/catalog"

export type MemberRole = "superadmin" | "admin" | "member"

/** all = any model; free = only models known to cost $0; allowlist = allowed_models */
export type ModelAccess = "all" | "free" | "allowlist"

export interface MemberRow {
  email: string
  role: MemberRole
  model_access: ModelAccess
  /** Route names or model slugs, used when model_access = allowlist. */
  allowed_models: string[]
  /** Across all of the member's apps; null = no cap. */
  monthly_budget_usd: number | null
  added_by: string | null
  created_at: string
}

export interface AppRow {
  id: string
  name: string
  slug: string
  description: string | null
  enabled: boolean
  /** Bucket name (or model slug) used when a client sends no model. */
  default_model: string | null
  /** Only bucket names and the models in them may be called. */
  only_bucket_models: boolean
  /** Response cache lifetime; null = no cache. */
  cache_ttl_seconds: number | null
  monthly_budget_usd: number | null
  rpm_limit: number | null
  /** Tokens (in + out) per minute across the app's keys. */
  tpm_limit: number | null
  /** What to do with personal data and secrets found in prompts. */
  pii_mode: PiiMode
  log_payloads: boolean
  /** The member who owns this app. */
  owner_email: string
  created_by: string | null
  created_at: string
  updated_at: string
}

export type BucketStrategy = "ordered" | "fastest" | "cheapest" | "spread"

export type PiiMode = "off" | "redact" | "block"

/** A named, ordered chain of models an app calls like a model ("smart"). */
export interface AppBucket {
  name: string
  /** Model ids in the order they're tried. */
  model_ids: string[]
  /** How the models are ordered for each request (default: as listed). */
  strategy?: BucketStrategy
  /** Start the next model too if the first hasn't answered by then. */
  hedge_after_ms?: number | null
}

export interface AppBucketRow extends AppBucket {
  id: string
  app_id: string
  position: number
  created_at: string
  updated_at: string
}

/** An app as the gateway sees it: settings plus its buckets, in order. */
export interface GatewayApp extends AppRow {
  buckets: AppBucket[]
}

export interface ApiKeyRow {
  id: string
  app_id: string
  name: string
  key_hash: string
  key_prefix: string
  last_four: string
  expires_at: string | null
  revoked_at: string | null
  last_used_at: string | null
  /** Limits for this key alone, on top of the app's. */
  rpm_limit: number | null
  tpm_limit: number | null
  monthly_budget_usd: number | null
  created_by: string | null
  created_at: string
}

export interface ProviderRow {
  id: string
  name: string
  slug: string
  type: ProviderType
  config: ProviderConfig
  enabled: boolean
  /** null = shared (admins manage it); otherwise the member who owns it. */
  owner_email: string | null
  /** Free-tier caps shared by all of this provider's models (null = none). */
  quota_rpm: number | null
  quota_rpd: number | null
  created_at: string
  updated_at: string
}

/** Non-secret provider settings, stored in providers.config. */
export interface ProviderConfig {
  preset?: string
  baseUrl?: string
  apiVersion?: string
  region?: string
  project?: string
  location?: string
  headers?: Record<string, string>
}

/** Secret provider settings, encrypted into provider_secrets.ciphertext. */
export interface ProviderCredentials {
  apiKey?: string
  accessKeyId?: string
  secretAccessKey?: string
  sessionToken?: string
  serviceAccountJson?: string
}

export interface ProviderSecretRow {
  provider_id: string
  ciphertext: string
  hint: string | null
  updated_at: string
}

export type ModelKind = "chat" | "embedding"

export interface ModelRow {
  id: string
  provider_id: string
  model_id: string
  slug: string
  display_name: string | null
  kind: ModelKind
  enabled: boolean
  capabilities: Capability[]
  tags: string[]
  context_window: number | null
  max_output_tokens: number | null
  /** Free-tier caps on calls to this model (null = none). */
  quota_rpm: number | null
  quota_rpd: number | null
  /** null = unknown; 0 = free */
  input_price_per_mtok: number | null
  output_price_per_mtok: number | null
  cached_input_price_per_mtok: number | null
  created_at: string
  updated_at: string
}

export interface ModelHealthRow {
  model_id: string
  cooldown_until: string | null
  consecutive_failures: number
  last_status: number | null
  last_error: string | null
  last_failure_at: string | null
  last_success_at: string | null
  updated_at: string
}

export type RouteStrategy = "fallback" | "round_robin"

export interface RouteRow {
  id: string
  name: string
  description: string | null
  kind: ModelKind
  strategy: RouteStrategy
  max_attempts: number
  timeout_ms: number
  first_token_timeout_ms: number
  enabled: boolean
  created_at: string
  updated_at: string
}

export interface RouteTargetRow {
  id: string
  route_id: string
  model_id: string
  position: number
}

export interface AttemptLogEntry {
  model_id: string
  model: string
  provider: string
  status: number | null
  error?: string
  latency_ms: number
  cooldown_s?: number
}

export interface RequestLogRow {
  id: string
  created_at: string
  app_id: string | null
  owner_email: string | null
  api_key_id: string | null
  endpoint: string
  requested_model: string | null
  route_id: string | null
  model_id: string | null
  provider_id: string | null
  upstream_model: string | null
  status: "success" | "error"
  http_status: number | null
  error_message: string | null
  stream: boolean
  attempts: number
  attempt_log: AttemptLogEntry[]
  input_tokens: number
  output_tokens: number
  cached_tokens: number
  reasoning_tokens: number
  usage_estimated: boolean
  cost_usd: number
  latency_ms: number | null
  ttft_ms: number | null
  user_agent: string | null
  cache_hit: boolean | null
  /** Kinds of personal data found in the prompt, when PII protection is on. */
  pii_found: string[] | null
  /** From the x-gateway-tags header. */
  tags: string[] | null
  /** The end user the client named (x-gateway-user, `user`, …). */
  end_user: string | null
  /** The request's `metadata` object (string values). */
  metadata: Record<string, string> | null
}

export interface RequestPayloadRow {
  request_id: string
  request: unknown
  response: unknown
  created_at: string
}

export interface UsageTimeseriesRow {
  bucket: string
  requests: number
  errors: number
  input_tokens: number
  output_tokens: number
  cost_usd: number
}

export interface UsageBreakdownRow {
  id: string | null
  requests: number
  errors: number
  input_tokens: number
  output_tokens: number
  cost_usd: number
  avg_latency_ms: number | null
}
