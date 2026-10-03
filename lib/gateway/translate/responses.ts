import { randomUUID } from "node:crypto"

import { GatewayError } from "../errors"
import type {
  ChatChunk,
  ChatCompletion,
  ChatContentPart,
  ChatMessage,
  ChatRequest,
  ChatTool,
  Usage,
} from "../types"

// OpenAI Responses API (POST /v1/responses) translated to and from chat
// completions, the gateway's canonical format. Stateless: responses aren't
// stored, so `previous_response_id` isn't supported; clients send the whole
// conversation each time (as Codex does with store: false).

type InputPart =
  | { type: "input_text" | "output_text"; text: string }
  | {
      type: "input_image"
      image_url?: string
      file_id?: string
      detail?: string
    }
  | {
      type: "input_file"
      file_data?: string
      file_id?: string
      filename?: string
    }
  | { type: "refusal"; refusal: string }
  | { type: string; [key: string]: unknown }

type InputItem =
  | {
      type?: "message"
      role: "user" | "assistant" | "system" | "developer"
      content: string | InputPart[]
    }
  | { type: "function_call"; call_id: string; name: string; arguments: string }
  | {
      type: "function_call_output"
      call_id: string
      output: string | InputPart[]
    }
  | { type: string; [key: string]: unknown }

interface ResponsesTool {
  type: string
  name?: string
  description?: string
  parameters?: Record<string, unknown>
  strict?: boolean
}

type TextFormat =
  | { type: "text" }
  | { type: "json_object" }
  | {
      type: "json_schema"
      name: string
      schema: Record<string, unknown>
      description?: string
      strict?: boolean
    }

export interface ResponsesRequest {
  model: string
  input: string | InputItem[]
  instructions?: string | null
  stream?: boolean
  tools?: ResponsesTool[]
  tool_choice?: string | { type: "function"; name: string }
  parallel_tool_calls?: boolean
  max_output_tokens?: number | null
  temperature?: number | null
  top_p?: number | null
  text?: { format?: TextFormat }
  reasoning?: { effort?: string | null } | null
  previous_response_id?: string | null
  store?: boolean
  user?: string
  metadata?: Record<string, string>
  [key: string]: unknown
}

function invalid(message: string): GatewayError {
  return new GatewayError(400, message, "invalid_request")
}

function partsToChat(parts: InputPart[]): ChatContentPart[] {
  const out: ChatContentPart[] = []
  for (const part of parts) {
    switch (part.type) {
      case "input_text":
      case "output_text":
        out.push({
          type: "text",
          text: String((part as { text: string }).text),
        })
        break
      case "refusal":
        out.push({
          type: "text",
          text: String((part as { refusal: string }).refusal),
        })
        break
      case "input_image": {
        const image = part as { image_url?: string; detail?: string }
        if (!image.image_url)
          throw invalid(
            "input_image needs an image_url (file ids aren't supported)."
          )
        out.push({
          type: "image_url",
          image_url: {
            url: image.image_url,
            ...(image.detail ? { detail: image.detail } : {}),
          },
        })
        break
      }
      case "input_file": {
        const file = part as { file_data?: string; filename?: string }
        if (!file.file_data)
          throw invalid(
            "input_file needs file_data (file ids aren't supported)."
          )
        out.push({
          type: "file",
          file: { file_data: file.file_data, filename: file.filename },
        })
        break
      }
      default:
        throw invalid(`Content type '${part.type}' isn't supported.`)
    }
  }
  return out
}

function textOf(content: string | InputPart[]): string {
  if (typeof content === "string") return content
  return partsToChat(content)
    .map((part) => (part.type === "text" ? part.text : ""))
    .join("")
}

export function responsesToChat(
  body: ResponsesRequest,
  /** A library prompt supplies the messages, so `input` may be empty. */
  { allowEmpty = false }: { allowEmpty?: boolean } = {}
): ChatRequest {
  if (body.previous_response_id) {
    throw invalid(
      "previous_response_id isn't supported: this gateway doesn't store responses. Send the whole conversation in `input` (store: false)."
    )
  }
  const messages: ChatMessage[] = []
  if (body.instructions)
    messages.push({ role: "system", content: body.instructions })

  const items: InputItem[] =
    typeof body.input === "string"
      ? [{ role: "user", content: body.input }]
      : Array.isArray(body.input)
        ? body.input
        : []

  for (const item of items) {
    const type = item.type ?? "message"
    if (type === "message") {
      const message = item as Extract<InputItem, { role: string }>
      const role =
        message.role === "developer"
          ? "system"
          : (message.role as ChatMessage["role"])
      if (role === "assistant") {
        messages.push({ role, content: textOf(message.content) })
      } else {
        messages.push({
          role,
          content:
            typeof message.content === "string"
              ? message.content
              : partsToChat(message.content),
        })
      }
    } else if (type === "function_call") {
      const call = item as Extract<InputItem, { type: "function_call" }>
      const last = messages.at(-1)
      const toolCall = {
        id: call.call_id,
        type: "function" as const,
        function: { name: call.name, arguments: call.arguments ?? "" },
      }
      // Consecutive calls belong to one assistant turn.
      if (last?.role === "assistant" && !last.content && last.tool_calls) {
        last.tool_calls.push(toolCall)
      } else {
        messages.push({
          role: "assistant",
          content: null,
          tool_calls: [toolCall],
        })
      }
    } else if (type === "function_call_output") {
      const result = item as Extract<
        InputItem,
        { type: "function_call_output" }
      >
      messages.push({
        role: "tool",
        tool_call_id: result.call_id,
        content:
          typeof result.output === "string"
            ? result.output
            : textOf(result.output),
      })
    } else if (type === "reasoning") {
      // Provider-specific (often encrypted) reasoning can't be replayed elsewhere.
      continue
    } else {
      throw invalid(`Input item type '${type}' isn't supported.`)
    }
  }
  if (!allowEmpty && !messages.some((message) => message.role !== "system")) {
    throw invalid("`input` must contain at least one message.")
  }

  const tools: ChatTool[] | undefined = body.tools?.length
    ? body.tools.map((tool) => {
        if (tool.type !== "function" || !tool.name) {
          throw invalid(
            `Only function tools are supported (got '${tool.type}').`
          )
        }
        return {
          type: "function",
          function: {
            name: tool.name,
            ...(tool.description ? { description: tool.description } : {}),
            parameters: tool.parameters ?? { type: "object", properties: {} },
            ...(tool.strict !== undefined ? { strict: tool.strict } : {}),
          },
        }
      })
    : undefined

  const format = body.text?.format
  const request: ChatRequest = {
    model: body.model,
    messages,
    stream: body.stream === true,
    ...(tools ? { tools } : {}),
    ...(body.tool_choice
      ? {
          tool_choice:
            typeof body.tool_choice === "string"
              ? (body.tool_choice as ChatRequest["tool_choice"])
              : { type: "function", function: { name: body.tool_choice.name } },
        }
      : {}),
    ...(body.parallel_tool_calls !== undefined
      ? { parallel_tool_calls: body.parallel_tool_calls }
      : {}),
    ...(body.max_output_tokens ? { max_tokens: body.max_output_tokens } : {}),
    ...(body.temperature != null ? { temperature: body.temperature } : {}),
    ...(body.top_p != null ? { top_p: body.top_p } : {}),
    ...(body.reasoning?.effort
      ? { reasoning_effort: body.reasoning.effort }
      : {}),
  }
  if (format?.type === "json_schema") {
    request.response_format = {
      type: "json_schema",
      json_schema: {
        name: format.name,
        schema: format.schema,
        ...(format.description ? { description: format.description } : {}),
        ...(format.strict !== undefined ? { strict: format.strict } : {}),
      },
    }
  } else if (format?.type === "json_object") {
    request.response_format = { type: "json_object" }
  }
  return request
}

const newId = (prefix: string) =>
  `${prefix}_${randomUUID().replaceAll("-", "")}`

function responsesUsage(usage: Usage | undefined) {
  return {
    input_tokens: usage?.inputTokens ?? 0,
    input_tokens_details: { cached_tokens: usage?.cachedTokens ?? 0 },
    output_tokens: usage?.outputTokens ?? 0,
    output_tokens_details: { reasoning_tokens: usage?.reasoningTokens ?? 0 },
    total_tokens: (usage?.inputTokens ?? 0) + (usage?.outputTokens ?? 0),
  }
}

/** Fields every response object echoes back from the request. */
function envelope(body: ResponsesRequest, id: string, model: string) {
  return {
    id,
    object: "response",
    created_at: Math.floor(Date.now() / 1000),
    model,
    instructions: body.instructions ?? null,
    max_output_tokens: body.max_output_tokens ?? null,
    parallel_tool_calls: body.parallel_tool_calls ?? true,
    previous_response_id: null,
    reasoning: body.reasoning ?? null,
    store: false,
    temperature: body.temperature ?? null,
    text: body.text ?? { format: { type: "text" } },
    tool_choice: body.tool_choice ?? "auto",
    tools: body.tools ?? [],
    top_p: body.top_p ?? null,
    metadata: body.metadata ?? {},
    error: null,
  }
}

export function chatToResponses(
  completion: ChatCompletion,
  body: ResponsesRequest,
  usage: Usage | undefined
) {
  const choice = completion.choices[0]
  const message = choice?.message
  const output: Record<string, unknown>[] = []
  if (message?.reasoning_content) {
    output.push({
      type: "reasoning",
      id: newId("rs"),
      summary: [{ type: "summary_text", text: message.reasoning_content }],
    })
  }
  const text = typeof message?.content === "string" ? message.content : ""
  if (text || !message?.tool_calls?.length) {
    output.push({
      type: "message",
      id: newId("msg"),
      status: "completed",
      role: "assistant",
      content: [{ type: "output_text", text, annotations: [] }],
    })
  }
  for (const call of message?.tool_calls ?? []) {
    output.push({
      type: "function_call",
      id: newId("fc"),
      call_id: call.id,
      name: call.function.name,
      arguments: call.function.arguments,
      status: "completed",
    })
  }
  const truncated = choice?.finish_reason === "length"
  return {
    ...envelope(body, newId("resp"), body.model),
    status: truncated ? "incomplete" : "completed",
    incomplete_details: truncated ? { reason: "max_output_tokens" } : null,
    output,
    usage: responsesUsage(usage),
  }
}

export interface ResponsesEvent {
  type: string
  [key: string]: unknown
}

/** Chat chunks -> Responses streaming events. */
export async function* chunksToResponsesEvents(
  chunks: AsyncIterable<ChatChunk>,
  body: ResponsesRequest,
  getUsage: () => Usage | undefined
): AsyncGenerator<ResponsesEvent> {
  const id = newId("resp")
  const base = envelope(body, id, body.model)
  let sequence = 0
  const event = (
    type: string,
    data: Record<string, unknown>
  ): ResponsesEvent => ({
    type,
    sequence_number: sequence++,
    ...data,
  })
  yield event("response.created", {
    response: {
      ...base,
      status: "in_progress",
      output: [],
      usage: null,
      incomplete_details: null,
    },
  })
  yield event("response.in_progress", {
    response: {
      ...base,
      status: "in_progress",
      output: [],
      usage: null,
      incomplete_details: null,
    },
  })

  const output: Record<string, unknown>[] = []
  let message: { id: string; index: number; text: string } | null = null
  const calls = new Map<
    number,
    {
      id: string
      index: number
      call_id: string
      name: string
      arguments: string
    }
  >()
  let finish: string | null = null

  function* closeMessage() {
    if (!message) return
    const part = { type: "output_text", text: message.text, annotations: [] }
    yield event("response.output_text.done", {
      item_id: message.id,
      output_index: message.index,
      content_index: 0,
      text: message.text,
    })
    yield event("response.content_part.done", {
      item_id: message.id,
      output_index: message.index,
      content_index: 0,
      part,
    })
    const item = {
      type: "message",
      id: message.id,
      status: "completed",
      role: "assistant",
      content: [part],
    }
    output[message.index] = item
    yield event("response.output_item.done", {
      output_index: message.index,
      item,
    })
    message = null
  }

  for await (const chunk of chunks) {
    const choice = chunk.choices?.[0]
    if (!choice) continue
    const delta = choice.delta ?? {}
    if (choice.finish_reason) finish = choice.finish_reason

    if (typeof delta.content === "string" && delta.content) {
      if (!message) {
        message = { id: newId("msg"), index: output.length, text: "" }
        output.push({})
        yield event("response.output_item.added", {
          output_index: message.index,
          item: {
            type: "message",
            id: message.id,
            status: "in_progress",
            role: "assistant",
            content: [],
          },
        })
        yield event("response.content_part.added", {
          item_id: message.id,
          output_index: message.index,
          content_index: 0,
          part: { type: "output_text", text: "", annotations: [] },
        })
      }
      message.text += delta.content
      yield event("response.output_text.delta", {
        item_id: message.id,
        output_index: message.index,
        content_index: 0,
        delta: delta.content,
      })
    }

    for (const call of delta.tool_calls ?? []) {
      let entry = calls.get(call.index)
      if (!entry) {
        yield* closeMessage()
        entry = {
          id: newId("fc"),
          index: output.length,
          call_id: call.id ?? newId("call"),
          name: call.function?.name ?? "",
          arguments: "",
        }
        calls.set(call.index, entry)
        output.push({})
        yield event("response.output_item.added", {
          output_index: entry.index,
          item: {
            type: "function_call",
            id: entry.id,
            call_id: entry.call_id,
            name: entry.name,
            arguments: "",
            status: "in_progress",
          },
        })
      } else if (call.function?.name) {
        entry.name += call.function.name
      }
      const args = call.function?.arguments ?? ""
      if (args) {
        entry.arguments += args
        yield event("response.function_call_arguments.delta", {
          item_id: entry.id,
          output_index: entry.index,
          delta: args,
        })
      }
    }
  }

  yield* closeMessage()
  for (const entry of calls.values()) {
    yield event("response.function_call_arguments.done", {
      item_id: entry.id,
      output_index: entry.index,
      arguments: entry.arguments,
    })
    const item = {
      type: "function_call",
      id: entry.id,
      call_id: entry.call_id,
      name: entry.name,
      arguments: entry.arguments,
      status: "completed",
    }
    output[entry.index] = item
    yield event("response.output_item.done", {
      output_index: entry.index,
      item,
    })
  }

  const truncated = finish === "length"
  yield event(truncated ? "response.incomplete" : "response.completed", {
    response: {
      ...base,
      status: truncated ? "incomplete" : "completed",
      incomplete_details: truncated ? { reason: "max_output_tokens" } : null,
      output: output.filter((item) => Object.keys(item).length > 0),
      usage: responsesUsage(getUsage()),
    },
  })
}
