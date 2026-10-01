import "server-only"

import type { ModelKind } from "@/lib/db/types"
import type { Capability } from "@/lib/providers/catalog"

// Model metadata (context window, prices, capabilities) from LiteLLM's
// community-maintained catalogue. Used only to prefill the dashboard; every
// value stays editable.

const CATALOGUE_URL =
  "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json"
const CACHE_MS = 24 * 3600 * 1000

interface CatalogueEntry {
  mode?: string
  max_input_tokens?: number
  max_tokens?: number
  max_output_tokens?: number
  input_cost_per_token?: number
  output_cost_per_token?: number
  cache_read_input_token_cost?: number
  supports_function_calling?: boolean
  supports_vision?: boolean
  supports_response_schema?: boolean
  supports_reasoning?: boolean
  supports_pdf_input?: boolean
  supports_audio_input?: boolean
  supports_prompt_caching?: boolean
}

export interface ModelMetadata {
  kind: ModelKind
  capabilities: Capability[]
  context_window: number | null
  max_output_tokens: number | null
  /** null = the catalogue has no price */
  input_price_per_mtok: number | null
  output_price_per_mtok: number | null
  cached_input_price_per_mtok: number | null
}

let cache: { at: number; data: Record<string, CatalogueEntry> } | undefined

async function catalogue(): Promise<Record<string, CatalogueEntry>> {
  if (cache && Date.now() - cache.at < CACHE_MS) return cache.data
  try {
    const response = await fetch(CATALOGUE_URL, {
      signal: AbortSignal.timeout(10_000),
    })
    if (!response.ok) throw new Error(`HTTP ${response.status}`)
    cache = {
      at: Date.now(),
      data: (await response.json()) as Record<string, CatalogueEntry>,
    }
  } catch (error) {
    console.warn(
      "[gateway] model catalogue unavailable:",
      (error as Error).message
    )
    cache ??= { at: Date.now() - CACHE_MS + 60_000, data: {} }
  }
  return cache.data
}

function perMillion(value: number | undefined): number | null {
  if (value == null || !Number.isFinite(value)) return null
  return Math.round(value * 1_000_000 * 1_000_000) / 1_000_000
}

function toMetadata(entry: CatalogueEntry): ModelMetadata {
  const capabilities: Capability[] = []
  if (entry.supports_function_calling) capabilities.push("tools")
  if (entry.supports_vision) capabilities.push("vision")
  if (entry.supports_response_schema) capabilities.push("json_schema")
  if (entry.supports_reasoning) capabilities.push("reasoning")
  if (entry.supports_pdf_input) capabilities.push("pdf")
  if (entry.supports_audio_input) capabilities.push("audio")
  if (entry.supports_prompt_caching) capabilities.push("prompt_caching")
  return {
    kind: entry.mode === "embedding" ? "embedding" : "chat",
    capabilities,
    context_window: entry.max_input_tokens ?? entry.max_tokens ?? null,
    max_output_tokens: entry.max_output_tokens ?? null,
    input_price_per_mtok: perMillion(entry.input_cost_per_token),
    output_price_per_mtok: perMillion(entry.output_cost_per_token),
    cached_input_price_per_mtok: perMillion(entry.cache_read_input_token_cost),
  }
}

/** Looks a model up under a few likely catalogue keys. */
export async function lookupMetadata(
  prefix: string | undefined,
  modelId: string
): Promise<ModelMetadata | undefined> {
  const data = await catalogue()
  const bare = modelId.split("/").pop() ?? modelId
  // Bedrock cross-region inference profiles: "us.anthropic.claude-…" -> "anthropic.claude-…"
  const withoutRegion = modelId.replace(/^(us|eu|apac|global)\./, "")
  const keys = [
    prefix ? `${prefix}/${modelId}` : undefined,
    modelId,
    prefix ? `${prefix}/${withoutRegion}` : undefined,
    withoutRegion,
    prefix ? `${prefix}/${bare}` : undefined,
    bare,
  ].filter((key): key is string => Boolean(key))
  for (const key of keys) {
    const entry = data[key]
    if (
      entry &&
      entry.mode !== "image_generation" &&
      entry.mode !== "audio_transcription"
    ) {
      return toMetadata(entry)
    }
  }
  return undefined
}
