import { randomUUID } from "node:crypto"

import type {
  CacheControl,
  ChatChunk,
  ChatCompletion,
  ChatContentPart,
  ChatMessage,
  ChatRequest,
  ChatTool,
  ChatToolCall,
  Usage,
} from "../types"

// Anthropic Messages API <-> OpenAI chat format, so Anthropic-native clients
// (Claude Code, the Anthropic SDKs) can use any model behind the gateway.

type AnthropicBlock = {
  type: string
  text?: string
  cache_control?: CacheControl
  source?: { type: string; media_type?: string; data?: string; url?: string }
  id?: string
  name?: string
  input?: unknown
  tool_use_id?: string
  content?: string | AnthropicBlock[]
  is_error?: boolean
  thinking?: string
  title?: string
}

interface AnthropicMessage {
  role: "user" | "assistant"
  content: string | AnthropicBlock[]
}

interface AnthropicTool {
  type?: string
  name: string
  description?: string
  input_schema?: Record<string, unknown>
  cache_control?: CacheControl
}

export interface AnthropicRequest {
  model: string
  messages: AnthropicMessage[]
  system?: string | AnthropicBlock[]
  max_tokens?: number
  temperature?: number
  top_p?: number
  top_k?: number
  stop_sequences?: string[]
  stream?: boolean
  tools?: AnthropicTool[]
  tool_choice?: {
    type: "auto" | "any" | "tool" | "none"
    name?: string
    disable_parallel_tool_use?: boolean
  }
  thinking?: { type: string; budget_tokens?: number }
  metadata?: { user_id?: string }
  [key: string]: unknown
}

function blockText(content: string | AnthropicBlock[] | undefined): string {
  if (typeof content === "string") return content
  return (content ?? [])
    .filter((block) => block.type === "text" && block.text)
    .map((block) => block.text)
    .join("\n")
}

function toUserPart(block: AnthropicBlock): ChatContentPart | undefined {
  switch (block.type) {
    case "text":
      return {
        type: "text",
        text: block.text ?? "",
        ...(block.cache_control ? { cache_control: block.cache_control } : {}),
      }
    case "image": {
      const source = block.source
      const url =
        source?.type === "base64"
          ? `data:${source.media_type};base64,${source.data}`
          : source?.type === "url"
            ? source.url
            : undefined
      return url
        ? {
            type: "image_url",
            image_url: { url },
            ...(block.cache_control
              ? { cache_control: block.cache_control }
              : {}),
          }
        : undefined
    }
    case "document": {
      const source = block.source
      if (source?.type === "base64") {
        return {
          type: "file",
          file: {
            file_data: `data:${source.media_type};base64,${source.data}`,
            filename: block.title,
          },
          ...(block.cache_control
            ? { cache_control: block.cache_control }
            : {}),
        }
      }
      if (source?.type === "text" && source.data)
        return { type: "text", text: source.data }
      return undefined
    }
    default:
      return undefined
  }
}

function reasoningEffort(
  thinking: AnthropicRequest["thinking"]
): string | undefined {
  if (!thinking || thinking.type === "disabled") return undefined
  const budget = thinking.budget_tokens ?? 8000
  return budget <= 2048 ? "low" : budget <= 12_000 ? "medium" : "high"
}

export function anthropicToChat(body: AnthropicRequest): ChatRequest {
  const messages: ChatMessage[] = []

  if (typeof body.system === "string" && body.system) {
    messages.push({ role: "system", content: body.system })
  } else if (Array.isArray(body.system) && body.system.length) {
    messages.push({
      role: "system",
      content: body.system
        .filter((block) => block.type === "text")
        .map((block) => ({
          type: "text" as const,
          text: block.text ?? "",
          ...(block.cache_control
            ? { cache_control: block.cache_control }
            : {}),
        })),
    })
  }

  for (const message of body.messages ?? []) {
    if (typeof message.content === "string") {
      messages.push({ role: message.role, content: message.content })
      continue
    }

    if (message.role === "user") {
      for (const block of message.content.filter(
        (b) => b.type === "tool_result"
      )) {
        const text = blockText(block.content)
        messages.push({
          role: "tool",
          tool_call_id: block.tool_use_id ?? "",
          content: block.is_error ? `Error: ${text}` : text,
        })
      }
      const parts = message.content
        .filter((block) => block.type !== "tool_result")
        .map(toUserPart)
        .filter((part): part is ChatContentPart => Boolean(part))
      if (parts.length) messages.push({ role: "user", content: parts })
      continue
    }

    let text = ""
    let reasoning = ""
    const toolCalls: ChatToolCall[] = []
    for (const block of message.content) {
      if (block.type === "text") text += block.text ?? ""
      else if (block.type === "thinking") reasoning += block.thinking ?? ""
      else if (block.type === "tool_use") {
        toolCalls.push({
          id: block.id ?? `toolu_${randomUUID()}`,
          type: "function",
          function: {
            name: block.name ?? "tool",
            arguments: JSON.stringify(block.input ?? {}),
          },
        })
      }
    }
    messages.push({
      role: "assistant",
      content: text || null,
      ...(reasoning ? { reasoning_content: reasoning } : {}),
      ...(toolCalls.length ? { tool_calls: toolCalls } : {}),
    })
  }

  // Server tools (web search, code execution, …) are Anthropic-only; skip them.
  const tools: ChatTool[] | undefined = body.tools
    ?.filter((tool) => !tool.type || tool.type === "custom")
    .map((tool) => ({
      type: "function",
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.input_schema ?? { type: "object", properties: {} },
      },
      ...(tool.cache_control ? { cache_control: tool.cache_control } : {}),
    }))

  const choice = body.tool_choice
  const request: ChatRequest = {
    model: body.model,
    messages,
    stream: Boolean(body.stream),
    max_tokens: body.max_tokens,
    temperature: body.temperature,
    top_p: body.top_p,
    stop: body.stop_sequences?.length ? body.stop_sequences : undefined,
    reasoning_effort: reasoningEffort(body.thinking),
    user: body.metadata?.user_id,
  }
  if (tools?.length) {
    request.tools = tools
    if (choice) {
      request.tool_choice =
        choice.type === "any"
          ? "required"
          : choice.type === "tool" && choice.name
            ? { type: "function", function: { name: choice.name } }
            : choice.type === "none"
              ? "none"
              : "auto"
      if (choice.disable_parallel_tool_use) request.parallel_tool_calls = false
    }
  }
  if (request.stream) request.stream_options = { include_usage: true }
  for (const key of Object.keys(request) as (keyof ChatRequest)[]) {
    if (request[key] === undefined) delete request[key]
  }
  return request
}

function stopReason(finish: string | null | undefined): string {
  switch (finish) {
    case "tool_calls":
    case "function_call":
      return "tool_use"
    case "length":
      return "max_tokens"
    case "content_filter":
      return "refusal"
    default:
      return "end_turn"
  }
}

function anthropicUsage(usage: Usage | undefined) {
  const input = usage?.inputTokens ?? 0
  const cached = Math.min(usage?.cachedTokens ?? 0, input)
  return {
    input_tokens: input - cached,
    output_tokens: usage?.outputTokens ?? 0,
    cache_read_input_tokens: cached,
    cache_creation_input_tokens: 0,
  }
}

function messageId(id: string | undefined) {
  return `msg_${(id ?? randomUUID()).replace(/^(chatcmpl-|msg_)/, "").replaceAll("-", "")}`
}

export function chatToAnthropic(
  completion: ChatCompletion,
  model: string,
  usage: Usage | undefined
) {
  const choice = completion.choices[0]
  const message = choice?.message
  const content: Record<string, unknown>[] = []
  const text = typeof message?.content === "string" ? message.content : ""
  if (text) content.push({ type: "text", text })
  for (const call of message?.tool_calls ?? []) {
    let input: unknown = {}
    try {
      input = JSON.parse(call.function.arguments || "{}")
    } catch {
      input = {}
    }
    content.push({
      type: "tool_use",
      id: call.id,
      name: call.function.name,
      input,
    })
  }
  return {
    id: messageId(completion.id),
    type: "message",
    role: "assistant",
    model,
    content,
    stop_reason: stopReason(choice?.finish_reason),
    stop_sequence: null,
    usage: anthropicUsage(usage),
  }
}

export interface AnthropicEvent {
  event: string
  data: Record<string, unknown>
}

/**
 * Converts OpenAI chunks to Anthropic stream events. `getUsage` is read at
 * the end so the caller's usage accounting (including estimates) is used.
 */
export async function* chunksToAnthropicEvents(
  chunks: AsyncIterable<ChatChunk>,
  model: string,
  getUsage: () => Usage | undefined
): AsyncGenerator<AnthropicEvent> {
  const id = messageId(undefined)
  yield {
    event: "message_start",
    data: {
      type: "message_start",
      message: {
        id,
        type: "message",
        role: "assistant",
        model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: { input_tokens: 0, output_tokens: 0 },
      },
    },
  }

  let blockIndex = -1
  let open: "text" | "tool" | null = null
  const toolBlocks = new Map<number, number>()
  let finish: string | null = null

  function* close() {
    if (open)
      yield {
        event: "content_block_stop",
        data: { type: "content_block_stop", index: blockIndex },
      }
    open = null
  }

  for await (const chunk of chunks) {
    const choice = chunk.choices?.[0]
    if (!choice) continue
    const delta = choice.delta ?? {}

    if (typeof delta.content === "string" && delta.content) {
      if (open !== "text") {
        yield* close()
        blockIndex++
        open = "text"
        yield {
          event: "content_block_start",
          data: {
            type: "content_block_start",
            index: blockIndex,
            content_block: { type: "text", text: "" },
          },
        }
      }
      yield {
        event: "content_block_delta",
        data: {
          type: "content_block_delta",
          index: blockIndex,
          delta: { type: "text_delta", text: delta.content },
        },
      }
    }

    for (const call of delta.tool_calls ?? []) {
      if (!toolBlocks.has(call.index)) {
        yield* close()
        blockIndex++
        open = "tool"
        toolBlocks.set(call.index, blockIndex)
        yield {
          event: "content_block_start",
          data: {
            type: "content_block_start",
            index: blockIndex,
            content_block: {
              type: "tool_use",
              id: call.id ?? `toolu_${randomUUID().replaceAll("-", "")}`,
              name: call.function?.name ?? "tool",
              input: {},
            },
          },
        }
      }
      const args = call.function?.arguments
      if (args) {
        yield {
          event: "content_block_delta",
          data: {
            type: "content_block_delta",
            index: toolBlocks.get(call.index),
            delta: { type: "input_json_delta", partial_json: args },
          },
        }
      }
    }

    if (choice.finish_reason) finish = choice.finish_reason
  }

  yield* close()
  yield {
    event: "message_delta",
    data: {
      type: "message_delta",
      delta: { stop_reason: stopReason(finish), stop_sequence: null },
      usage: anthropicUsage(getUsage()),
    },
  }
  yield { event: "message_stop", data: { type: "message_stop" } }
}
