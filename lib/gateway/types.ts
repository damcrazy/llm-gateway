// OpenAI Chat Completions is the gateway's canonical format: every surface
// (/v1/chat/completions, /v1/messages) converts to it, and every provider
// adapter accepts it. Unknown fields are preserved via index signatures so
// OpenAI-compatible providers receive exactly what the client sent.

export type JsonObject = Record<string, unknown>

export interface CacheControl {
  type: "ephemeral"
  ttl?: string
}

export interface ChatTextPart {
  type: "text"
  text: string
  cache_control?: CacheControl
}

export interface ChatImagePart {
  type: "image_url"
  image_url: { url: string; detail?: string }
  cache_control?: CacheControl
}

export interface ChatAudioPart {
  type: "input_audio"
  input_audio: { data: string; format: string }
}

export interface ChatFilePart {
  type: "file"
  file: { file_data?: string; file_id?: string; filename?: string }
  cache_control?: CacheControl
}

export type ChatContentPart =
  ChatTextPart | ChatImagePart | ChatAudioPart | ChatFilePart

export interface ChatToolCall {
  id: string
  type: "function"
  function: { name: string; arguments: string }
}

export interface ChatMessage {
  role: "system" | "developer" | "user" | "assistant" | "tool" | "function"
  content?: string | ChatContentPart[] | null
  name?: string
  tool_calls?: ChatToolCall[]
  tool_call_id?: string
  /** DeepSeek-style reasoning text, used by many OpenAI-compatible providers. */
  reasoning_content?: string
  [key: string]: unknown
}

export interface ChatTool {
  type: "function"
  function: {
    name: string
    description?: string
    parameters?: JsonObject
    strict?: boolean
  }
  cache_control?: CacheControl
}

export type ChatToolChoice =
  | "auto"
  | "none"
  | "required"
  | { type: "function"; function: { name: string } }

export type ChatResponseFormat =
  | { type: "text" }
  | { type: "json_object" }
  | {
      type: "json_schema"
      json_schema: {
        name?: string
        description?: string
        schema?: JsonObject
        strict?: boolean
      }
    }

export interface ChatRequest {
  model: string
  messages: ChatMessage[]
  stream?: boolean
  stream_options?: { include_usage?: boolean; [key: string]: unknown }
  tools?: ChatTool[]
  tool_choice?: ChatToolChoice
  parallel_tool_calls?: boolean
  response_format?: ChatResponseFormat
  max_tokens?: number
  max_completion_tokens?: number
  temperature?: number
  top_p?: number
  stop?: string | string[]
  presence_penalty?: number
  frequency_penalty?: number
  seed?: number
  reasoning_effort?: string
  user?: string
  [key: string]: unknown
}

export interface ChatUsage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  prompt_tokens_details?: { cached_tokens?: number; [key: string]: unknown }
  completion_tokens_details?: {
    reasoning_tokens?: number
    [key: string]: unknown
  }
  [key: string]: unknown
}

export interface ChatChoice {
  index: number
  message: ChatMessage
  finish_reason: string | null
  logprobs?: unknown
}

export interface ChatCompletion {
  id: string
  object: "chat.completion"
  created: number
  model: string
  choices: ChatChoice[]
  usage?: ChatUsage
  [key: string]: unknown
}

export interface ChatToolCallDelta {
  index: number
  id?: string
  type?: "function"
  function?: { name?: string; arguments?: string }
}

export interface ChatDelta {
  role?: "assistant"
  content?: string | null
  reasoning_content?: string
  tool_calls?: ChatToolCallDelta[]
  [key: string]: unknown
}

export interface ChatChunkChoice {
  index: number
  delta: ChatDelta
  finish_reason: string | null
  [key: string]: unknown
}

export interface ChatChunk {
  id: string
  object: "chat.completion.chunk"
  created: number
  model: string
  choices: ChatChunkChoice[]
  usage?: ChatUsage | null
  [key: string]: unknown
}

export interface EmbeddingsRequest {
  model: string
  input: string | string[] | number[] | number[][]
  encoding_format?: "float" | "base64"
  dimensions?: number
  user?: string
  [key: string]: unknown
}

export interface EmbeddingsResponse {
  object: "list"
  data: Array<{
    object: "embedding"
    index: number
    embedding: number[] | string
  }>
  model: string
  usage: { prompt_tokens: number; total_tokens: number }
  [key: string]: unknown
}

/** Normalised token usage used for logging and cost. */
export interface Usage {
  inputTokens: number
  outputTokens: number
  cachedTokens: number
  reasoningTokens: number
  estimated: boolean
}
