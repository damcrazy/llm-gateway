import type { ModelRuntime } from "../config"
import type {
  ChatChunk,
  ChatCompletion,
  ChatRequest,
  EmbeddingsRequest,
  EmbeddingsResponse,
} from "../types"

export interface AdapterContext {
  model: ModelRuntime
  signal: AbortSignal
}

export type ChatResult =
  | { type: "json"; completion: ChatCompletion }
  | { type: "stream"; chunks: AsyncIterable<ChatChunk> }

export interface ProviderAdapter {
  /** Must throw (not stream) errors that happen before the response starts. */
  chat(request: ChatRequest, ctx: AdapterContext): Promise<ChatResult>
  embeddings(
    request: EmbeddingsRequest,
    ctx: AdapterContext
  ): Promise<EmbeddingsResponse>
}
