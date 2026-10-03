import type { ModelRow } from "@/lib/db/types"
import type { Capability } from "@/lib/providers/catalog"

import type { ChatContentPart, ChatRequest, ChatUsage, Usage } from "./types"

/** Rough token estimate (≈4 characters per token) for when a provider reports no usage. */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

const IMAGE_TOKEN_ESTIMATE = 1000

export function estimateRequestTokens(request: ChatRequest): number {
  let chars = 0
  let images = 0
  for (const message of request.messages ?? []) {
    chars += 4 // role / framing overhead
    if (typeof message.content === "string") chars += message.content.length
    else if (Array.isArray(message.content)) {
      for (const part of message.content) {
        if (part.type === "text") chars += part.text.length
        else images++
      }
    }
    if (message.reasoning_content) chars += message.reasoning_content.length
    for (const call of message.tool_calls ?? []) {
      chars +=
        call.function.name.length + (call.function.arguments?.length ?? 0)
    }
  }
  if (request.tools) chars += JSON.stringify(request.tools).length
  return Math.ceil(chars / 4) + images * IMAGE_TOKEN_ESTIMATE
}

export function usageFromChat(
  usage: ChatUsage | null | undefined
): Usage | undefined {
  if (!usage) return undefined
  const raw = usage as Record<string, unknown>
  const cached =
    usage.prompt_tokens_details?.cached_tokens ??
    (typeof raw.prompt_cache_hit_tokens === "number"
      ? raw.prompt_cache_hit_tokens
      : undefined) ??
    (typeof raw.cache_read_input_tokens === "number"
      ? raw.cache_read_input_tokens
      : 0)
  const input = usage.prompt_tokens ?? 0
  const output = usage.completion_tokens ?? 0
  // Some OpenAI-compatible APIs (Gemini's) leave "thinking" tokens out of
  // completion_tokens but count them in total_tokens. They're billed as
  // output, so the difference is counted as output (and reasoning).
  const hidden =
    typeof usage.total_tokens === "number"
      ? Math.max(0, usage.total_tokens - input - output)
      : 0
  return {
    inputTokens: input,
    outputTokens: output + hidden,
    cachedTokens: cached ?? 0,
    reasoningTokens:
      (usage.completion_tokens_details?.reasoning_tokens ?? 0) + hidden,
    estimated: false,
  }
}

export function usageToChat(usage: Usage): ChatUsage {
  return {
    prompt_tokens: usage.inputTokens,
    completion_tokens: usage.outputTokens,
    total_tokens: usage.inputTokens + usage.outputTokens,
    prompt_tokens_details: { cached_tokens: usage.cachedTokens },
    completion_tokens_details: { reasoning_tokens: usage.reasoningTokens },
  }
}

type Priced = Pick<
  ModelRow,
  | "input_price_per_mtok"
  | "output_price_per_mtok"
  | "cached_input_price_per_mtok"
>

export function costUsd(model: Priced, usage: Usage): number {
  const input = Number(model.input_price_per_mtok) || 0
  const output = Number(model.output_price_per_mtok) || 0
  const cachedPrice =
    model.cached_input_price_per_mtok == null
      ? input
      : Number(model.cached_input_price_per_mtok)
  const cached = Math.min(usage.cachedTokens, usage.inputTokens)
  const uncached = usage.inputTokens - cached
  return (
    (uncached * input + cached * cachedPrice + usage.outputTokens * output) /
    1_000_000
  )
}

/** Capabilities a model must have to serve this request. */
export function requiredCapabilities(request: ChatRequest): Set<Capability> {
  const needed = new Set<Capability>()
  if (request.tools?.length && request.tool_choice !== "none")
    needed.add("tools")
  if (request.response_format?.type === "json_schema") needed.add("json_schema")
  for (const message of request.messages ?? []) {
    if (message.role === "assistant" && message.tool_calls?.length)
      needed.add("tools")
    if (message.role === "tool") needed.add("tools")
    if (!Array.isArray(message.content)) continue
    for (const part of message.content as ChatContentPart[]) {
      if (part.type === "image_url") needed.add("vision")
      else if (part.type === "input_audio") needed.add("audio")
      else if (part.type === "file") needed.add("pdf")
    }
  }
  return needed
}
