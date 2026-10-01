import "server-only"

import { createHash, randomUUID } from "node:crypto"

import { createAmazonBedrock } from "@ai-sdk/amazon-bedrock"
import { createAnthropic } from "@ai-sdk/anthropic"
import { createGoogle } from "@ai-sdk/google"
import { createGoogleVertex } from "@ai-sdk/google-vertex"
import { createVertexAnthropic } from "@ai-sdk/google-vertex/anthropic"
import type {
  EmbeddingModelV4,
  LanguageModelV4,
  LanguageModelV4CallOptions,
  LanguageModelV4FilePart,
  LanguageModelV4FinishReason,
  LanguageModelV4FunctionTool,
  LanguageModelV4GenerateResult,
  LanguageModelV4Message,
  LanguageModelV4Prompt,
  LanguageModelV4StreamPart,
  LanguageModelV4TextPart,
  LanguageModelV4ToolResultPart,
  LanguageModelV4Usage,
  SharedV4ProviderOptions,
} from "@ai-sdk/provider"

import type { ProviderRuntime } from "../config"
import { UpstreamError, toUpstreamError } from "../errors"
import type {
  CacheControl,
  ChatChunk,
  ChatCompletion,
  ChatContentPart,
  ChatMessage,
  ChatRequest,
  ChatToolCall,
  EmbeddingsRequest,
  EmbeddingsResponse,
  Usage,
} from "../types"
import { usageToChat } from "../usage"
import type { AdapterContext, ChatResult, ProviderAdapter } from "./types"

// Adapter for providers without an OpenAI-compatible API (Anthropic, Bedrock,
// Vertex, Gemini). It uses the AI SDK provider packages at their lowest level
// (LanguageModelV4.doGenerate / doStream), so there is no hidden retry or tool
// loop, and translates between OpenAI chat format and the AI SDK spec.
// Provider API changes are absorbed by upgrading the @ai-sdk/* packages.

interface Factory {
  language(modelId: string): LanguageModelV4
  embedding?(modelId: string): EmbeddingModelV4
}

const factories = new Map<string, { fingerprint: string; factory: Factory }>()

function configError(message: string): UpstreamError {
  return new UpstreamError(message, null, { kind: "config" })
}

function factoryFor(provider: ProviderRuntime): Factory {
  if (provider.credentialError) throw configError(provider.credentialError)
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify([provider.type, provider.config, provider.credentials])
    )
    .digest("hex")
  const cached = factories.get(provider.id)
  if (cached?.fingerprint === fingerprint) return cached.factory
  // Reusing the factory matters for Vertex: it caches the OAuth access token.
  const factory = createFactory(provider)
  factories.set(provider.id, { fingerprint, factory })
  return factory
}

function createFactory(provider: ProviderRuntime): Factory {
  const { config, credentials } = provider
  switch (provider.type) {
    case "anthropic": {
      if (!credentials.apiKey)
        throw configError(`Provider '${provider.name}' has no API key`)
      const anthropic = createAnthropic({
        apiKey: credentials.apiKey,
        baseURL: config.baseUrl || undefined,
        headers: config.headers,
      })
      return { language: (id) => anthropic(id) }
    }
    case "bedrock": {
      if (!config.region)
        throw configError(`Provider '${provider.name}' has no region`)
      const hasKeys = credentials.accessKeyId && credentials.secretAccessKey
      if (!credentials.apiKey && !hasKeys) {
        throw configError(
          `Provider '${provider.name}' needs a Bedrock API key or an access key pair`
        )
      }
      const bedrock = createAmazonBedrock({
        region: config.region,
        ...(credentials.apiKey
          ? { apiKey: credentials.apiKey }
          : {
              accessKeyId: credentials.accessKeyId,
              secretAccessKey: credentials.secretAccessKey,
              sessionToken: credentials.sessionToken || undefined,
            }),
      })
      return {
        language: (id) => bedrock(id),
        embedding: (id) => bedrock.embedding(id),
      }
    }
    case "vertex": {
      if (!config.project || !config.location) {
        throw configError(
          `Provider '${provider.name}' needs a project and location`
        )
      }
      let serviceAccount: Record<string, unknown> | undefined
      if (credentials.serviceAccountJson) {
        try {
          serviceAccount = JSON.parse(credentials.serviceAccountJson)
        } catch {
          throw configError(
            `Provider '${provider.name}' has an invalid service account JSON`
          )
        }
      }
      if (!serviceAccount && !credentials.apiKey) {
        throw configError(
          `Provider '${provider.name}' has no service account credentials`
        )
      }
      const auth = serviceAccount
        ? { googleAuthOptions: { credentials: serviceAccount } }
        : {}
      const vertex = createGoogleVertex({
        project: config.project,
        location: config.location,
        ...(serviceAccount ? auth : { apiKey: credentials.apiKey }),
      })
      const vertexAnthropic = serviceAccount
        ? createVertexAnthropic({
            project: config.project,
            location: config.location,
            ...auth,
          })
        : undefined
      return {
        language: (id) => {
          if (id.startsWith("claude")) {
            if (!vertexAnthropic)
              throw configError("Claude on Vertex needs a service account")
            return vertexAnthropic(id)
          }
          return vertex(id)
        },
        embedding: (id) => vertex.textEmbeddingModel(id),
      }
    }
    case "google": {
      if (!credentials.apiKey)
        throw configError(`Provider '${provider.name}' has no API key`)
      const google = createGoogle({
        apiKey: credentials.apiKey,
        baseURL: config.baseUrl || undefined,
      })
      return {
        language: (id) => google(id),
        embedding: (id) => google.embedding(id),
      }
    }
    default:
      throw configError(
        `Provider type '${provider.type}' is not handled by the AI SDK adapter`
      )
  }
}

// ---------------------------------------------------------------------------
// OpenAI request -> AI SDK call options
// ---------------------------------------------------------------------------

function cacheOptions(
  cache: CacheControl | undefined
): SharedV4ProviderOptions | undefined {
  if (!cache) return undefined
  return {
    anthropic: {
      cacheControl: {
        type: "ephemeral",
        ...(cache.ttl ? { ttl: cache.ttl } : {}),
      },
    },
    bedrock: { cachePoint: { type: "default" } },
  }
}

function parseDataUrl(
  url: string
): { mediaType: string; data: string } | undefined {
  const match = /^data:([^;,]+)?(?:;[^,]*)?;base64,([\s\S]*)$/.exec(url)
  return match
    ? { mediaType: match[1] || "application/octet-stream", data: match[2] }
    : undefined
}

function textOf(content: ChatMessage["content"]): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content
    .filter(
      (part): part is Extract<ChatContentPart, { type: "text" }> =>
        part.type === "text"
    )
    .map((part) => part.text)
    .join("\n")
}

function convertUserPart(
  part: ChatContentPart
): LanguageModelV4TextPart | LanguageModelV4FilePart | undefined {
  switch (part.type) {
    case "text":
      return {
        type: "text",
        text: part.text,
        providerOptions: cacheOptions(part.cache_control),
      }
    case "image_url": {
      const url = part.image_url?.url ?? ""
      const inline = parseDataUrl(url)
      if (inline) {
        return {
          type: "file",
          mediaType: inline.mediaType,
          data: { type: "data", data: inline.data },
          providerOptions: cacheOptions(part.cache_control),
        }
      }
      return {
        type: "file",
        mediaType: "image/*",
        data: { type: "url", url: new URL(url) },
        providerOptions: cacheOptions(part.cache_control),
      }
    }
    case "input_audio": {
      const format =
        part.input_audio.format === "mp3" ? "mpeg" : part.input_audio.format
      return {
        type: "file",
        mediaType: `audio/${format}`,
        data: { type: "data", data: part.input_audio.data },
      }
    }
    case "file": {
      const inline = part.file.file_data
        ? parseDataUrl(part.file.file_data)
        : undefined
      if (!inline) return undefined
      return {
        type: "file",
        mediaType: inline.mediaType,
        filename: part.file.filename,
        data: { type: "data", data: inline.data },
        providerOptions: cacheOptions(part.cache_control),
      }
    }
    default:
      return undefined
  }
}

function parseArguments(value: string | undefined): unknown {
  if (!value) return {}
  try {
    return JSON.parse(value)
  } catch {
    return {}
  }
}

export function toPrompt(messages: ChatMessage[]): LanguageModelV4Prompt {
  const prompt: LanguageModelV4Prompt = []
  const toolNames = new Map<string, string>()

  for (const message of messages) {
    switch (message.role) {
      case "system":
      case "developer": {
        const cache = Array.isArray(message.content)
          ? message.content.find(
              (part) => "cache_control" in part && part.cache_control
            )
          : undefined
        prompt.push({
          role: "system",
          content: textOf(message.content),
          providerOptions: cacheOptions(
            cache && "cache_control" in cache ? cache.cache_control : undefined
          ),
        })
        break
      }
      case "user": {
        const parts =
          typeof message.content === "string"
            ? [{ type: "text" as const, text: message.content }]
            : (message.content ?? [])
                .map(convertUserPart)
                .filter(
                  (
                    part
                  ): part is
                    LanguageModelV4TextPart | LanguageModelV4FilePart =>
                    Boolean(part)
                )
        if (parts.length) prompt.push({ role: "user", content: parts })
        break
      }
      case "assistant": {
        const content: Extract<
          LanguageModelV4Message,
          { role: "assistant" }
        >["content"] = []
        if (message.reasoning_content)
          content.push({ type: "reasoning", text: message.reasoning_content })
        const text = textOf(message.content)
        if (text) content.push({ type: "text", text })
        for (const call of message.tool_calls ?? []) {
          toolNames.set(call.id, call.function.name)
          content.push({
            type: "tool-call",
            toolCallId: call.id,
            toolName: call.function.name,
            input: parseArguments(call.function.arguments),
          })
        }
        if (content.length) prompt.push({ role: "assistant", content })
        break
      }
      case "tool":
      case "function": {
        const toolCallId = message.tool_call_id ?? message.name ?? randomUUID()
        const result: LanguageModelV4ToolResultPart = {
          type: "tool-result",
          toolCallId,
          toolName: toolNames.get(toolCallId) ?? message.name ?? "tool",
          output: { type: "text", value: textOf(message.content) },
        }
        const last = prompt.at(-1)
        if (last?.role === "tool") last.content.push(result)
        else prompt.push({ role: "tool", content: [result] })
        break
      }
    }
  }
  return prompt
}

const REASONING_LEVELS = new Set([
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
])

export function toCallOptions(
  request: ChatRequest,
  signal: AbortSignal
): LanguageModelV4CallOptions {
  const tools: LanguageModelV4FunctionTool[] | undefined = request.tools?.map(
    (tool) => ({
      type: "function",
      name: tool.function.name,
      description: tool.function.description,
      inputSchema: (tool.function.parameters ?? {
        type: "object",
        properties: {},
      }) as LanguageModelV4FunctionTool["inputSchema"],
      strict: tool.function.strict,
      providerOptions: cacheOptions(tool.cache_control),
    })
  )

  const choice = request.tool_choice
  const toolChoice: LanguageModelV4CallOptions["toolChoice"] =
    choice === undefined
      ? undefined
      : typeof choice === "string"
        ? { type: choice }
        : { type: "tool", toolName: choice.function.name }

  const format = request.response_format
  const responseFormat: LanguageModelV4CallOptions["responseFormat"] =
    format?.type === "json_schema"
      ? {
          type: "json",
          schema: format.json_schema.schema as never,
          name: format.json_schema.name,
          description: format.json_schema.description,
        }
      : format?.type === "json_object"
        ? { type: "json" }
        : undefined

  const stop = request.stop
  return {
    prompt: toPrompt(request.messages),
    maxOutputTokens:
      request.max_completion_tokens ?? request.max_tokens ?? undefined,
    temperature: request.temperature ?? undefined,
    topP: request.top_p ?? undefined,
    topK: typeof request.top_k === "number" ? request.top_k : undefined,
    presencePenalty: request.presence_penalty ?? undefined,
    frequencyPenalty: request.frequency_penalty ?? undefined,
    seed: request.seed ?? undefined,
    stopSequences:
      stop == null ? undefined : Array.isArray(stop) ? stop : [stop],
    tools: tools?.length ? tools : undefined,
    toolChoice: tools?.length ? toolChoice : undefined,
    responseFormat,
    reasoning:
      request.reasoning_effort && REASONING_LEVELS.has(request.reasoning_effort)
        ? (request.reasoning_effort as LanguageModelV4CallOptions["reasoning"])
        : undefined,
    abortSignal: signal,
  }
}

// ---------------------------------------------------------------------------
// AI SDK results -> OpenAI response
// ---------------------------------------------------------------------------

function finishReason(reason: LanguageModelV4FinishReason): string {
  switch (reason.unified) {
    case "length":
      return "length"
    case "tool-calls":
      return "tool_calls"
    case "content-filter":
      return "content_filter"
    default:
      return "stop"
  }
}

export function usageFromSdk(
  usage: LanguageModelV4Usage | undefined
): Usage | undefined {
  if (!usage || usage.inputTokens.total == null) return undefined
  return {
    inputTokens: usage.inputTokens.total ?? 0,
    outputTokens: usage.outputTokens.total ?? 0,
    cachedTokens: usage.inputTokens.cacheRead ?? 0,
    reasoningTokens: usage.outputTokens.reasoning ?? 0,
    estimated: false,
  }
}

function completionId() {
  return `chatcmpl-${randomUUID().replaceAll("-", "")}`
}

function fromGenerateResult(
  result: LanguageModelV4GenerateResult,
  modelId: string
): ChatCompletion {
  let text = ""
  let reasoning = ""
  const toolCalls: ChatToolCall[] = []
  for (const part of result.content) {
    if (part.type === "text") text += part.text
    else if (part.type === "reasoning") reasoning += part.text
    else if (part.type === "tool-call" && !part.providerExecuted) {
      toolCalls.push({
        id: part.toolCallId,
        type: "function",
        function: { name: part.toolName, arguments: part.input || "{}" },
      })
    }
  }
  const usage = usageFromSdk(result.usage)
  return {
    id: completionId(),
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: modelId,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: text || (toolCalls.length ? null : ""),
          ...(reasoning ? { reasoning_content: reasoning } : {}),
          ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: finishReason(result.finishReason),
      },
    ],
    ...(usage ? { usage: usageToChat(usage) } : {}),
  }
}

async function* toChunks(
  stream: ReadableStream<LanguageModelV4StreamPart>,
  modelId: string
): AsyncGenerator<ChatChunk> {
  const id = completionId()
  const created = Math.floor(Date.now() / 1000)
  let roleSent = false
  const toolIndex = new Map<string, number>()

  const chunk = (
    delta: ChatChunk["choices"][number]["delta"],
    finish: string | null = null
  ): ChatChunk => {
    if (!roleSent) {
      delta = { role: "assistant", ...delta }
      roleSent = true
    }
    return {
      id,
      object: "chat.completion.chunk",
      created,
      model: modelId,
      choices: [{ index: 0, delta, finish_reason: finish }],
    }
  }

  const reader = stream.getReader()
  try {
    while (true) {
      const { value: part, done } = await reader.read()
      if (done) return
      switch (part.type) {
        case "text-delta":
          if (part.delta) yield chunk({ content: part.delta })
          break
        case "reasoning-delta":
          if (part.delta) yield chunk({ reasoning_content: part.delta })
          break
        case "tool-input-start": {
          if (part.providerExecuted) break
          const index = toolIndex.size
          toolIndex.set(part.id, index)
          yield chunk({
            tool_calls: [
              {
                index,
                id: part.id,
                type: "function",
                function: { name: part.toolName, arguments: "" },
              },
            ],
          })
          break
        }
        case "tool-input-delta": {
          const index = toolIndex.get(part.id)
          if (index !== undefined && part.delta) {
            yield chunk({
              tool_calls: [{ index, function: { arguments: part.delta } }],
            })
          }
          break
        }
        case "tool-call": {
          if (part.providerExecuted || toolIndex.has(part.toolCallId)) break
          const index = toolIndex.size
          toolIndex.set(part.toolCallId, index)
          yield chunk({
            tool_calls: [
              {
                index,
                id: part.toolCallId,
                type: "function",
                function: {
                  name: part.toolName,
                  arguments: part.input || "{}",
                },
              },
            ],
          })
          break
        }
        case "finish": {
          yield chunk({}, finishReason(part.finishReason))
          const usage = usageFromSdk(part.usage)
          if (usage) {
            yield {
              id,
              object: "chat.completion.chunk",
              created,
              model: modelId,
              choices: [],
              usage: usageToChat(usage),
            }
          }
          break
        }
        case "error":
          throw toUpstreamError(part.error)
      }
    }
  } finally {
    reader.cancel().catch(() => {})
  }
}

export const aiSdkAdapter: ProviderAdapter = {
  async chat(request, ctx: AdapterContext): Promise<ChatResult> {
    const model = factoryFor(ctx.model.provider).language(ctx.model.model_id)
    const options = toCallOptions(request, ctx.signal)
    try {
      if (!request.stream) {
        return {
          type: "json",
          completion: fromGenerateResult(
            await model.doGenerate(options),
            ctx.model.model_id
          ),
        }
      }
      const { stream } = await model.doStream(options)
      return { type: "stream", chunks: toChunks(stream, ctx.model.model_id) }
    } catch (error) {
      throw toUpstreamError(error)
    }
  },

  async embeddings(
    request: EmbeddingsRequest,
    ctx
  ): Promise<EmbeddingsResponse> {
    const factory = factoryFor(ctx.model.provider)
    if (!factory.embedding) {
      throw new UpstreamError(
        `${ctx.model.provider.name} does not support embeddings`,
        400
      )
    }
    const input = request.input
    const values = (Array.isArray(input) ? input : [input]).map((value) =>
      typeof value === "string" ? value : JSON.stringify(value)
    )
    try {
      const result = await factory
        .embedding(ctx.model.model_id)
        .doEmbed({ values, abortSignal: ctx.signal })
      const tokens = result.usage?.tokens ?? 0
      return {
        object: "list",
        model: ctx.model.model_id,
        data: result.embeddings.map((embedding, index) => ({
          object: "embedding",
          index,
          embedding,
        })),
        usage: { prompt_tokens: tokens, total_tokens: tokens },
      }
    } catch (error) {
      throw toUpstreamError(error)
    }
  },
}
