// Types, validation and formatting shared by the models and providers pages.
// No server-only imports: this file is used by client components too.

import { z } from "zod"

import type { ModelKind } from "@/lib/db/types"
import {
  CAPABILITIES,
  type Capability,
  type ProviderType,
} from "@/lib/providers/catalog"

export interface ModelHealthSummary {
  coolingDown: boolean
  /** Time left in the cooldown, e.g. "2m". */
  cooldownLeft: string | null
  consecutiveFailures: number
  lastError: string | null
  lastStatus: number | null
}

/** A model row joined with its provider and health, ready for the tables. */
export interface ModelListItem {
  id: string
  providerId: string
  providerName: string
  providerSlug: string
  providerType: ProviderType
  providerEnabled: boolean
  modelId: string
  slug: string
  displayName: string | null
  kind: ModelKind
  enabled: boolean
  capabilities: Capability[]
  tags: string[]
  contextWindow: number | null
  maxOutputTokens: number | null
  /** null = unknown; 0 = free */
  inputPrice: number | null
  outputPrice: number | null
  cachedInputPrice: number | null
  quotaRpm: number | null
  quotaRpd: number | null
  /** Calls this minute / today, when a quota is set. */
  quotaUsed: { minute: number; day: number } | null
  health: ModelHealthSummary | null
}

// ---------------------------------------------------------------------------
// Validation (used by the server actions; types are used by the forms)
// ---------------------------------------------------------------------------

const price = z
  .number({ error: "Prices must be numbers" })
  .min(0, "Prices can't be negative")
  .max(999_999, "That price is too large")

const tokenCount = z
  .number({ error: "Token counts must be numbers" })
  .int("Token counts must be whole numbers")
  .positive("Token counts must be positive")
  .max(2_147_483_647, "That token count is too large")
  .nullable()

export function normalizeTag(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/g, "")
    .slice(0, 40)
}

/** Free-tier cap: a positive whole number of requests, or none. */
export const quotaCount = z
  .number({ error: "Limits must be numbers" })
  .int("Limits must be whole numbers")
  .positive("Limits must be greater than zero")
  .max(10_000_000, "That limit is too large")
  .nullable()
  .default(null)

export const modelFieldsSchema = z.object({
  display_name: z
    .string()
    .trim()
    .max(200, "Display name is too long")
    .nullable()
    .transform((value) => value || null),
  kind: z.enum(["chat", "embedding"]),
  capabilities: z
    .array(z.enum(CAPABILITIES))
    .transform((values) => [...new Set(values)]),
  tags: z
    .array(z.string())
    .max(30, "Too many tags")
    .transform((values) => [
      ...new Set(values.map(normalizeTag).filter(Boolean)),
    ]),
  context_window: tokenCount,
  max_output_tokens: tokenCount,
  input_price_per_mtok: price.nullable(),
  output_price_per_mtok: price.nullable(),
  cached_input_price_per_mtok: price.nullable(),
  quota_rpm: quotaCount,
  quota_rpd: quotaCount,
})

export const newModelSchema = modelFieldsSchema.extend({
  model_id: z
    .string()
    .trim()
    .min(1, "Enter the model id")
    .max(200, "Model id is too long")
    .regex(/^\S+$/, "Model ids can't contain spaces"),
})

export type ModelFieldsInput = z.input<typeof modelFieldsSchema>
export type NewModelInput = z.input<typeof newModelSchema>

export function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Invalid input"
}

export const UNIQUE_VIOLATION = "23505"
export const DUPLICATE_MODEL_MESSAGE =
  "A model with this id already exists for this provider"

// ---------------------------------------------------------------------------
// Formatting
// ---------------------------------------------------------------------------

/** 128000 -> "128K", 1048576 -> "1M". */
export function formatTokens(value: number | null | undefined): string {
  if (value == null) return "—"
  if (value >= 1_000_000)
    return `${+(value / 1_000_000).toFixed(value % 1_000_000 ? 2 : 0)}M`
  if (value >= 1_000)
    return `${+(value / 1_000).toFixed(value % 1_000 ? 1 : 0)}K`
  return String(value)
}
