import "server-only"

import { z } from "zod"

import type { SessionMember } from "@/lib/auth"
import { applyPrompt, loadPrompt, parsePromptRef } from "@/lib/gateway/prompts"
import {
  anthropicToChat,
  type AnthropicRequest,
} from "@/lib/gateway/translate/anthropic"
import {
  responsesToChat,
  type ResponsesRequest,
} from "@/lib/gateway/translate/responses"
import type { ChatMessage, ChatRequest } from "@/lib/gateway/types"
import { promptVariables, type PromptMessage } from "@/lib/prompt-template"
import { createClient } from "@/lib/supabase/server"

import type { ComparePrefill } from "./shared"

// Pre-fills the Compare page from a logged request (replay) or a prompt
// from the library. Reads go through the session client, so RLS decides
// what the viewer may see.

const REPLAYABLE = new Set([
  "chat.completions",
  "messages",
  "responses",
  "playground",
])

function textOf(content: ChatMessage["content"]): string {
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content
    .map((part) =>
      part.type === "text"
        ? part.text
        : part.type === "image_url"
          ? "[image]"
          : part.type === "file"
            ? "[file]"
            : "[audio]"
    )
    .join("\n")
}

/** Chat messages as plain system / user / assistant text. */
function flatten(messages: ChatMessage[]): PromptMessage[] {
  const out: PromptMessage[] = []
  for (const message of messages) {
    if (message.role === "system" || message.role === "developer") {
      out.push({ role: "system", content: textOf(message.content) })
    } else if (message.role === "assistant") {
      const calls = (message.tool_calls ?? []).map(
        (call) => `[called ${call.function.name}(${call.function.arguments})]`
      )
      const text = [textOf(message.content), ...calls].filter(Boolean)
      out.push({ role: "assistant", content: text.join("\n") })
    } else if (message.role === "tool" || message.role === "function") {
      out.push({
        role: "user",
        content: `[tool result] ${textOf(message.content)}`,
      })
    } else {
      out.push({ role: "user", content: textOf(message.content) })
    }
  }
  return out
}

export async function replayPrefill(
  me: SessionMember,
  requestId: string
): Promise<ComparePrefill> {
  const fail = (error: string): ComparePrefill => ({ source: "error", error })
  if (!z.uuid().safeParse(requestId).success) return fail("Unknown request")
  const supabase = await createClient()
  const [{ data: log }, { data: payload }] = await Promise.all([
    supabase
      .from("request_logs")
      .select("id, endpoint, app_id, owner_email, requested_model")
      .eq("id", requestId)
      .maybeSingle(),
    supabase
      .from("request_payloads")
      .select("request")
      .eq("request_id", requestId)
      .maybeSingle(),
  ])
  if (!log) return fail("That request isn't in the logs (or isn't yours).")
  if (!REPLAYABLE.has(log.endpoint as string))
    return fail("Only chat requests can be replayed.")
  if (!payload?.request)
    return fail(
      "That request has no stored payload. Turn on “Log full payloads” in the app's settings to replay its requests."
    )

  const body = payload.request as Record<string, unknown>
  let chat: ChatRequest
  try {
    if (log.endpoint === "messages") {
      chat = anthropicToChat(body as unknown as AnthropicRequest)
    } else if (log.endpoint === "responses") {
      chat = responsesToChat(body as unknown as ResponsesRequest, {
        allowEmpty: true,
      })
    } else {
      chat = {
        model: String(body.model ?? ""),
        messages: (body.messages ?? []) as ChatMessage[],
        temperature: body.temperature as number | undefined,
        max_tokens: (body.max_tokens ?? body.maxTokens) as number | undefined,
      }
    }
    // A request that used a library prompt: put the prompt's messages back.
    const ref = parsePromptRef(body.prompt)
    if (ref && log.owner_email) {
      const template = await loadPrompt(log.owner_email as string, ref)
      chat = applyPrompt(chat, template, ref.variables)
    }
  } catch (error) {
    return fail(
      `Couldn't read that request: ${error instanceof Error ? error.message : "unknown format"}`
    )
  }

  const messages = flatten(chat.messages ?? [])
  if (!messages.some((message) => message.role === "user"))
    return fail("That request has no user message to replay.")
  return {
    source: "replay",
    label: `Replay of a ${log.endpoint} request`,
    requestId,
    appId: (log.app_id as string | null) ?? null,
    model: (log.requested_model as string | null) ?? chat.model ?? null,
    messages,
    variables: [],
    temperature: typeof chat.temperature === "number" ? chat.temperature : null,
    maxTokens:
      typeof chat.max_tokens === "number"
        ? chat.max_tokens
        : typeof chat.max_completion_tokens === "number"
          ? (chat.max_completion_tokens as number)
          : null,
    truncated: JSON.stringify(body).includes("…[truncated]"),
  }
}

export async function promptPrefill(
  _me: SessionMember,
  promptId: string,
  version: number | null
): Promise<ComparePrefill> {
  const fail = (error: string): ComparePrefill => ({ source: "error", error })
  if (!z.uuid().safeParse(promptId).success) return fail("Unknown prompt")
  const supabase = await createClient()
  const { data: prompt } = await supabase
    .from("prompts")
    .select("id, slug, name, published_version")
    .eq("id", promptId)
    .maybeSingle()
  if (!prompt) return fail("That prompt doesn't exist (or isn't yours).")
  let query = supabase
    .from("prompt_versions")
    .select("version, messages, model, params")
    .eq("prompt_id", promptId)
  const wanted = version ?? (prompt.published_version as number | null)
  query = wanted
    ? query.eq("version", wanted)
    : query.order("version", { ascending: false }).limit(1)
  const { data: rows } = await query
  const row = (rows ?? [])[0] as
    | {
        version: number
        messages: PromptMessage[]
        model: string | null
        params: { temperature?: number; max_tokens?: number } | null
      }
    | undefined
  if (!row) return fail(`Prompt '${prompt.slug}' has no version ${wanted}.`)
  return {
    source: "prompt",
    label: `${prompt.name} · v${row.version}`,
    promptId,
    promptVersion: row.version,
    appId: null,
    model: row.model,
    messages: row.messages,
    variables: promptVariables(row.messages),
    temperature: row.params?.temperature ?? null,
    maxTokens: row.params?.max_tokens ?? null,
    truncated: false,
  }
}
