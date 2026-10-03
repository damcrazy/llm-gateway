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

/** Endpoints passed through as-is to OpenAI-compatible providers. */
export type MediaPath =
  | "images/generations"
  | "audio/speech"
  | "audio/transcriptions"
  | "audio/translations"
  | "rerank"

export interface ProviderAdapter {
  /** Must throw (not stream) errors that happen before the response starts. */
  chat(request: ChatRequest, ctx: AdapterContext): Promise<ChatResult>
  embeddings(
    request: EmbeddingsRequest,
    ctx: AdapterContext
  ): Promise<EmbeddingsResponse>
  /**
   * Images, audio and rerank. Resolves with the provider's successful
   * response (body unread); providers without these endpoints leave it out.
   */
  media?(
    path: MediaPath,
    body: string | FormData,
    ctx: AdapterContext
  ): Promise<Response>
}
