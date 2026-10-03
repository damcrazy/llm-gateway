import "server-only"

import { createHash } from "node:crypto"

import { supabaseAdmin } from "@/lib/supabase/admin"

import { background } from "./background"
import type { ChatChunk, ChatCompletion, ChatRequest, ChatUsage } from "./types"

// Response cache: an app can opt in to having identical requests answered
// from a stored response. Two layers: a small in-memory map per instance and
// the response_cache table (shared by every instance), both keyed by app and
// a hash of everything in the request that can change the answer.

export interface CacheOptions {
  appId: string
  ttlSeconds: number
  /** Look for a stored answer (false with Cache-Control: no-cache). */
  read: boolean
  /** Store this answer (false with Cache-Control: no-store). */
  write: boolean
}

export type CacheStatus = "HIT" | "MISS" | "BYPASS"

interface Entry {
  completion: ChatCompletion
  modelId: string | null
  expiresAt: number
}

// Fields that don't change the answer.
const IGNORED = new Set([
  "stream",
  "stream_options",
  "user",
  "metadata",
  "store",
])
const MAX_MEMORY_ENTRIES = 500
const MAX_RESPONSE_BYTES = 1_000_000
const memory = new Map<string, Entry>()

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`
  if (value && typeof value === "object") {
    const keys = Object.keys(value as Record<string, unknown>)
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .sort()
    return `{${keys
      .map(
        (key) =>
          `${JSON.stringify(key)}:${canonical((value as Record<string, unknown>)[key])}`
      )
      .join(",")}}`
  }
  return JSON.stringify(value ?? null)
}

/** Hash of the request fields that can change the answer. */
export function cacheKey(request: ChatRequest): string {
  const relevant = Object.fromEntries(
    Object.entries(request).filter(([key]) => !IGNORED.has(key))
  )
  return createHash("sha256").update(canonical(relevant)).digest("hex")
}

/** Only single-choice requests are cached. */
export function isCacheable(request: ChatRequest): boolean {
  const n = (request as { n?: unknown }).n
  return n === undefined || n === 1
}

function remember(id: string, entry: Entry) {
  memory.delete(id)
  if (memory.size >= MAX_MEMORY_ENTRIES) {
    const oldest = memory.keys().next().value
    if (oldest !== undefined) memory.delete(oldest)
  }
  memory.set(id, entry)
}

export async function readCache(
  appId: string,
  key: string
): Promise<Entry | null> {
  const id = `${appId}:${key}`
  const now = Date.now()
  const local = memory.get(id)
  if (local && local.expiresAt > now) return local
  if (local) memory.delete(id)

  const { data, error } = await supabaseAdmin()
    .from("response_cache")
    .select("response, model_id, expires_at")
    .eq("app_id", appId)
    .eq("key", key)
    .gt("expires_at", new Date(now).toISOString())
    .maybeSingle()
  if (error || !data) return null
  const entry: Entry = {
    completion: data.response as ChatCompletion,
    modelId: (data.model_id as string | null) ?? null,
    expiresAt: new Date(data.expires_at as string).getTime(),
  }
  remember(id, entry)
  return entry
}

export function writeCache(
  options: CacheOptions,
  key: string,
  modelId: string | null,
  completion: ChatCompletion
): void {
  if (!options.write) return
  const finish = completion.choices[0]?.finish_reason
  // Don't keep cut-off or failed answers.
  if (finish && finish !== "stop" && finish !== "tool_calls") return
  if (JSON.stringify(completion).length > MAX_RESPONSE_BYTES) return
  const expiresAt = Date.now() + options.ttlSeconds * 1000
  remember(`${options.appId}:${key}`, { completion, modelId, expiresAt })
  background(async () => {
    const db = supabaseAdmin()
    await db.from("response_cache").upsert({
      app_id: options.appId,
      key,
      model_id: modelId,
      response: completion,
      expires_at: new Date(expiresAt).toISOString(),
    })
    // Now and then, clear out expired entries.
    if (Math.random() < 0.02) {
      await db
        .from("response_cache")
        .delete()
        .lt("expires_at", new Date().toISOString())
    }
  })
}

/** Replays a stored answer as a stream (role and content, then finish and usage). */
export async function* completionToChunks(
  completion: ChatCompletion
): AsyncGenerator<ChatChunk> {
  const base = {
    id: completion.id,
    object: "chat.completion.chunk" as const,
    created: Math.floor(Date.now() / 1000),
    model: completion.model,
  }
  for (const choice of completion.choices) {
    const message = choice.message ?? {}
    yield {
      ...base,
      choices: [
        {
          index: choice.index,
          delta: {
            role: "assistant",
            content: typeof message.content === "string" ? message.content : "",
            ...(message.reasoning_content
              ? { reasoning_content: message.reasoning_content }
              : {}),
            ...(message.tool_calls?.length
              ? {
                  tool_calls: message.tool_calls.map((call, index) => ({
                    index,
                    id: call.id,
                    type: "function" as const,
                    function: call.function,
                  })),
                }
              : {}),
          },
          finish_reason: null,
        },
      ],
    }
    yield {
      ...base,
      choices: [
        { index: choice.index, delta: {}, finish_reason: choice.finish_reason },
      ],
    }
  }
  if (completion.usage) yield { ...base, choices: [], usage: completion.usage }
}

/**
 * Passes a live stream through while assembling it into a completion; calls
 * `onComplete` only if the stream finished normally.
 */
export async function* collectStream(
  chunks: AsyncIterable<ChatChunk>,
  onComplete: (completion: ChatCompletion) => void
): AsyncGenerator<ChatChunk> {
  let id = ""
  let model = ""
  let content = ""
  let reasoning = ""
  let finish: string | null = null
  let usage: ChatUsage | undefined
  const calls: { id?: string; name: string; arguments: string }[] = []

  for await (const chunk of chunks) {
    id ||= chunk.id
    model ||= chunk.model
    if (chunk.usage) usage = chunk.usage
    const choice = chunk.choices?.[0]
    if (choice) {
      const delta = choice.delta ?? {}
      if (typeof delta.content === "string") content += delta.content
      if (typeof delta.reasoning_content === "string")
        reasoning += delta.reasoning_content
      for (const call of delta.tool_calls ?? []) {
        const entry = (calls[call.index] ??= { name: "", arguments: "" })
        if (call.id) entry.id = call.id
        if (call.function?.name) entry.name += call.function.name
        entry.arguments += call.function?.arguments ?? ""
      }
      if (choice.finish_reason) finish = choice.finish_reason
    }
    yield chunk
  }

  onComplete({
    id: id || `chatcmpl-cache`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [
      {
        index: 0,
        message: {
          role: "assistant",
          content: content || (calls.length ? null : ""),
          ...(reasoning ? { reasoning_content: reasoning } : {}),
          ...(calls.length
            ? {
                tool_calls: calls.map((call, index) => ({
                  id: call.id ?? `call_${index}`,
                  type: "function" as const,
                  function: { name: call.name, arguments: call.arguments },
                })),
              }
            : {}),
        },
        finish_reason: finish ?? "stop",
      },
    ],
    ...(usage ? { usage } : {}),
  })
}
