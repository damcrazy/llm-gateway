import "server-only"

import type { ModelKind, ProviderRow } from "@/lib/db/types"
import {
  PROVIDER_TYPE_SPECS,
  findPreset,
  type Capability,
} from "@/lib/providers/catalog"
import { loadProviderCredentials } from "@/lib/providers/secrets"
import { supabaseAdmin } from "@/lib/supabase/admin"

import { listOpenAIModels } from "./adapters/openai"
import type { ProviderRuntime } from "./config"
import { fetchFor } from "./provider-fetch"
import { upstreamErrorFromResponse } from "./errors"
import { lookupMetadata, type ModelMetadata } from "./metadata"

export interface DiscoveredModel {
  model_id: string
  display_name: string | null
  kind: ModelKind
  capabilities: Capability[]
  context_window: number | null
  max_output_tokens: number | null
  /** null = unknown; 0 = free */
  input_price_per_mtok: number | null
  output_price_per_mtok: number | null
  cached_input_price_per_mtok: number | null
}

// Models that are not chat/embedding endpoints (speech, music, images, …).
const NOISE =
  /(whisper|tts|dall-e|gpt-image|imagen|veo|moderation|realtime|transcribe|sora|davinci|babbage|guard|rerank|-audio-|audio-preview|computer-use|orpheus|playai|lyria)/i

async function loadProvider(providerId: string): Promise<ProviderRuntime> {
  const { data, error } = await supabaseAdmin()
    .from("providers")
    .select("*")
    .eq("id", providerId)
    .single()
  if (error || !data) throw new Error("Provider not found")
  const row = data as ProviderRow
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
    type: row.type,
    config: row.config ?? {},
    enabled: row.enabled,
    ownerEmail: row.owner_email ?? null,
    credentials: await loadProviderCredentials(row.id),
  }
}

function metadataPrefix(
  provider: Pick<ProviderRuntime, "type" | "config">
): string | undefined {
  const preset = findPreset(provider.config.preset)
  return (
    preset?.metadataPrefix ?? PROVIDER_TYPE_SPECS[provider.type].metadataPrefix
  )
}

const EMPTY: ModelMetadata = {
  kind: "chat",
  capabilities: [],
  context_window: null,
  max_output_tokens: null,
  input_price_per_mtok: null,
  output_price_per_mtok: null,
  cached_input_price_per_mtok: null,
}

// Local model servers cost nothing to call.
const FREE_PRESETS = new Set(["ollama", "lmstudio"])

function num(value: unknown): number | undefined {
  const n = typeof value === "string" ? Number(value) : value
  return typeof n === "number" && Number.isFinite(n) ? n : undefined
}

/** Metadata some providers include in their /models listing (OpenRouter, Groq, Together, …). */
function reportedMetadata(
  raw: Record<string, unknown>
): Partial<ModelMetadata> {
  const out: Partial<ModelMetadata> = {}
  const context =
    num(raw.context_length) ??
    num(raw.context_window) ??
    num(raw.max_context_length)
  if (context) out.context_window = context

  const topProvider = raw.top_provider as Record<string, unknown> | undefined
  const maxOutput =
    num(topProvider?.max_completion_tokens) ?? num(raw.max_completion_tokens)
  if (maxOutput) out.max_output_tokens = maxOutput

  const pricing = raw.pricing as Record<string, unknown> | undefined
  if (pricing) {
    // OpenRouter: USD per token (strings). Together: USD per million.
    const prompt = num(pricing.prompt)
    const completion = num(pricing.completion)
    // OpenRouter reports -1 for variable pricing (e.g. auto routers): leave unset.
    if (
      prompt != null &&
      completion != null &&
      prompt >= 0 &&
      completion >= 0
    ) {
      out.input_price_per_mtok = prompt * 1_000_000
      out.output_price_per_mtok = completion * 1_000_000
      const cacheRead = num(pricing.input_cache_read)
      if (cacheRead != null)
        out.cached_input_price_per_mtok = cacheRead * 1_000_000
    } else if (num(pricing.input) != null) {
      out.input_price_per_mtok = num(pricing.input)!
      out.output_price_per_mtok = num(pricing.output) ?? null
    }
  }

  const capabilities = new Set<Capability>()
  const params = Array.isArray(raw.supported_parameters)
    ? (raw.supported_parameters as string[])
    : []
  if (params.includes("tools")) capabilities.add("tools")
  if (
    params.includes("structured_outputs") ||
    params.includes("response_format")
  )
    capabilities.add("json_schema")
  if (params.includes("reasoning") || params.includes("include_reasoning"))
    capabilities.add("reasoning")
  const architecture = raw.architecture as Record<string, unknown> | undefined
  const modalities = Array.isArray(architecture?.input_modalities)
    ? (architecture.input_modalities as string[])
    : []
  if (modalities.includes("image")) capabilities.add("vision")
  if (modalities.includes("file")) capabilities.add("pdf")
  if (modalities.includes("audio")) capabilities.add("audio")
  if (capabilities.size) out.capabilities = [...capabilities]

  if (raw.type === "embedding" || raw.type === "embeddings")
    out.kind = "embedding"
  return out
}

async function describe(
  provider: Pick<ProviderRuntime, "type" | "config">,
  modelId: string,
  displayName: string | null,
  reported: Partial<ModelMetadata> = {}
): Promise<DiscoveredModel> {
  const catalogue = await lookupMetadata(metadataPrefix(provider), modelId)
  const base = catalogue ?? EMPTY
  const localFree = FREE_PRESETS.has(provider.config.preset ?? "") ? 0 : null
  const kind =
    reported.kind ??
    (catalogue ? base.kind : /embed/i.test(modelId) ? "embedding" : "chat")
  return {
    model_id: modelId,
    display_name: displayName,
    kind,
    capabilities: reported.capabilities
      ? [...new Set([...base.capabilities, ...reported.capabilities])]
      : base.capabilities,
    context_window: reported.context_window ?? base.context_window,
    max_output_tokens: reported.max_output_tokens ?? base.max_output_tokens,
    input_price_per_mtok:
      reported.input_price_per_mtok ?? base.input_price_per_mtok ?? localFree,
    output_price_per_mtok:
      reported.output_price_per_mtok ?? base.output_price_per_mtok ?? localFree,
    cached_input_price_per_mtok:
      reported.cached_input_price_per_mtok ?? base.cached_input_price_per_mtok,
  }
}

async function listAnthropic(provider: ProviderRuntime) {
  const base = (
    provider.config.baseUrl || "https://api.anthropic.com/v1"
  ).replace(/\/+$/, "")
  const response = await fetchFor(provider)(`${base}/models?limit=1000`, {
    headers: {
      "x-api-key": provider.credentials.apiKey ?? "",
      "anthropic-version": "2023-06-01",
    },
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw await upstreamErrorFromResponse(response)
  const body = (await response.json()) as {
    data?: { id: string; display_name?: string }[]
  }
  return (body.data ?? []).map((model) => ({
    id: model.id,
    name: model.display_name ?? null,
    raw: {},
  }))
}

async function listGoogle(provider: ProviderRuntime) {
  const base = (
    provider.config.baseUrl ||
    "https://generativelanguage.googleapis.com/v1beta"
  ).replace(/\/+$/, "")
  const response = await fetchFor(provider)(`${base}/models?pageSize=1000`, {
    headers: { "x-goog-api-key": provider.credentials.apiKey ?? "" },
    signal: AbortSignal.timeout(20_000),
  })
  if (!response.ok) throw await upstreamErrorFromResponse(response)
  const body = (await response.json()) as {
    models?: {
      name: string
      displayName?: string
      inputTokenLimit?: number
      outputTokenLimit?: number
      supportedGenerationMethods?: string[]
    }[]
  }
  return (body.models ?? [])
    .filter((model) => {
      const methods = model.supportedGenerationMethods ?? []
      return (
        methods.includes("generateContent") || methods.includes("embedContent")
      )
    })
    .map((model) => {
      const methods = model.supportedGenerationMethods ?? []
      return {
        id: model.name.replace(/^models\//, ""),
        name: model.displayName ?? null,
        raw: {
          context_window: model.inputTokenLimit,
          max_completion_tokens: model.outputTokenLimit,
          type: methods.includes("generateContent") ? "chat" : "embedding",
        } as Record<string, unknown>,
      }
    })
}

/** Lists models from the provider's API, enriched with capabilities and prices. */
export async function discoverModels(
  providerId: string
): Promise<DiscoveredModel[]> {
  const provider = await loadProvider(providerId)
  let listed: {
    id: string
    name: string | null
    raw: Record<string, unknown>
  }[]

  switch (provider.type) {
    case "openai_compatible":
      listed = (await listOpenAIModels(provider)).map((raw) => ({
        id: String(raw.id ?? ""),
        name:
          typeof raw.name === "string"
            ? raw.name
            : typeof raw.display_name === "string"
              ? raw.display_name
              : null,
        raw,
      }))
      break
    case "anthropic":
      listed = await listAnthropic(provider)
      break
    case "google":
      listed = await listGoogle(provider)
      break
    default:
      throw new Error(
        `${PROVIDER_TYPE_SPECS[provider.type].label} models must be added manually.`
      )
  }

  const models = await Promise.all(
    listed
      .filter((model) => model.id && !NOISE.test(model.id))
      .filter(
        (model) =>
          !["image", "audio", "moderation", "rerank", "transcribe"].includes(
            String(model.raw.type ?? "")
          )
      )
      .map((model) =>
        describe(provider, model.id, model.name, reportedMetadata(model.raw))
      )
  )
  return models.sort((a, b) => a.model_id.localeCompare(b.model_id))
}

/** Best-effort metadata (capabilities, prices, context) for a manually entered model id. */
export async function suggestModelMetadata(
  providerId: string,
  modelId: string
): Promise<DiscoveredModel | null> {
  const { data } = await supabaseAdmin()
    .from("providers")
    .select("type, config")
    .eq("id", providerId)
    .single()
  if (!data) return null
  const provider = data as Pick<ProviderRow, "type" | "config">
  const found = await lookupMetadata(
    metadataPrefix({ type: provider.type, config: provider.config ?? {} }),
    modelId.trim()
  )
  if (!found) return null
  return { model_id: modelId.trim(), display_name: null, ...found }
}
