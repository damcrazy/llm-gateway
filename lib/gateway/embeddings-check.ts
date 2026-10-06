import type { EmbeddingsRequest, EmbeddingsResponse } from "./types"
import { estimateTokens } from "./usage"

// Checks an embeddings answer before it reaches the client, so a bucket of
// providers never hands back vectors that don't fit together: one per input,
// all the same size, and the size the client asked for (`dimensions`).
// Vectors are passed on unchanged, never truncated: only some models can be
// shortened safely, and it would hide the provider's mistake. The envelope is
// made to match OpenAI's: an index on every vector, and token usage.

/** How many vectors the request should produce. A list of numbers is one tokenized input. */
export function embeddingInputCount(input: EmbeddingsRequest["input"]): number {
  if (!Array.isArray(input)) return 1
  return typeof input[0] === "number" ? 1 : input.length
}

/** Length of one vector, as a list of numbers or base64 float32. */
function vectorSize(embedding: number[] | string): number {
  if (typeof embedding !== "string") return embedding.length
  const padding = embedding.endsWith("==") ? 2 : embedding.endsWith("=") ? 1 : 0
  return ((embedding.length * 3) / 4 - padding) / 4
}

/** Why the answer doesn't fit the request, or null when it does. */
export function embeddingsProblem(
  response: EmbeddingsResponse,
  inputs: number,
  dimensions: number | undefined
): string | null {
  const data = Array.isArray(response?.data) ? response.data : null
  if (!data) return "The response has no embeddings"
  if (data.length !== inputs)
    return `Returned ${data.length} ${data.length === 1 ? "embedding" : "embeddings"} for ${inputs} ${inputs === 1 ? "input" : "inputs"}`
  const sizes = new Set(data.map((item) => vectorSize(item.embedding)))
  if (sizes.size > 1)
    return `Returned vectors of different sizes (${[...sizes].join(", ")})`
  const [size] = sizes
  if (dimensions && size !== undefined && size !== dimensions)
    return `Returned ${size}-dimension vectors; the request asked for ${dimensions}`
  return null
}

/** Tokens in the input: counted for token ids, estimated for text. */
export function estimateEmbeddingTokens(
  input: EmbeddingsRequest["input"]
): number {
  const items =
    Array.isArray(input) && typeof input[0] !== "number" ? input : [input]
  return items.reduce<number>(
    (sum, item) =>
      sum + (Array.isArray(item) ? item.length : estimateTokens(String(item))),
    0
  )
}

/**
 * The provider's token count, or null when it gave none. A 0 for input that
 * isn't empty counts as none: some providers report 0 rather than nothing.
 */
export function reportedEmbeddingTokens(
  response: EmbeddingsResponse,
  input: EmbeddingsRequest["input"]
): number | null {
  const tokens = response.usage?.prompt_tokens
  if (typeof tokens !== "number" || !Number.isFinite(tokens) || tokens < 0)
    return null
  return tokens === 0 && estimateEmbeddingTokens(input) > 0 ? null : tokens
}

/** The answer as OpenAI shapes it: every vector indexed (some providers send null), with usage. */
export function normalizeEmbeddings(
  response: EmbeddingsResponse,
  inputTokens: number
): EmbeddingsResponse {
  return {
    ...response,
    object: "list",
    data: response.data.map((item, position) => ({
      ...item,
      object: "embedding",
      index: typeof item.index === "number" ? item.index : position,
    })),
    usage: { prompt_tokens: inputTokens, total_tokens: inputTokens },
  }
}
