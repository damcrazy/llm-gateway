import "server-only"

import {
  MissingVariablesError,
  renderPrompt,
  type PromptMessage,
  type PromptParams,
} from "@/lib/prompt-template"
import { supabaseAdmin } from "@/lib/supabase/admin"

import { GatewayError } from "./errors"
import type { ChatMessage, ChatRequest } from "./types"

// Prompts from the library, used by slug in a request:
//   "prompt": {"id": "support-reply", "version": 3, "variables": {"name": "Jane"}}
// (also just "prompt": "support-reply"). The template's messages come first,
// then the request's own; its model and parameters are defaults.

export interface PromptRef {
  id: string
  version?: number
  variables: Record<string, string>
}

export interface PromptTemplate {
  promptId: string
  slug: string
  version: number
  messages: PromptMessage[]
  model: string | null
  params: PromptParams
}

const CACHE_TTL_MS = 30_000
const MAX_CACHE_ENTRIES = 2_000
const cache = new Map<string, { at: number; value: PromptTemplate | null }>()

function invalid(message: string) {
  return new GatewayError(400, message, "invalid_prompt")
}

/** The request's `prompt` field, or null when there isn't one. */
export function parsePromptRef(value: unknown): PromptRef | null {
  if (value == null) return null
  if (typeof value === "string") {
    if (!value.trim()) throw invalid("`prompt` must name a prompt.")
    return { id: value.trim(), variables: {} }
  }
  if (typeof value !== "object" || Array.isArray(value))
    throw invalid("`prompt` must be a prompt slug or {id, version, variables}.")
  const raw = value as { id?: unknown; version?: unknown; variables?: unknown }
  if (typeof raw.id !== "string" || !raw.id.trim())
    throw invalid("`prompt.id` must be the prompt's slug.")
  let version: number | undefined
  if (raw.version != null) {
    version = Number(raw.version)
    if (!Number.isInteger(version) || version < 1)
      throw invalid("`prompt.version` must be a version number.")
  }
  const variables: Record<string, string> = {}
  if (raw.variables != null) {
    if (typeof raw.variables !== "object" || Array.isArray(raw.variables))
      throw invalid("`prompt.variables` must be an object.")
    for (const [name, item] of Object.entries(raw.variables)) {
      // Responses API style: {"type": "input_text", "text": "…"}.
      const text =
        item && typeof item === "object" && "text" in item
          ? (item as { text: unknown }).text
          : item
      variables[name] =
        typeof text === "string" ? text : JSON.stringify(text ?? "")
    }
  }
  return { id: raw.id.trim(), version, variables }
}

export async function loadPrompt(
  ownerEmail: string,
  ref: PromptRef
): Promise<PromptTemplate> {
  const key = `${ownerEmail}:${ref.id}:${ref.version ?? "published"}`
  const cached = cache.get(key)
  let template =
    cached && Date.now() - cached.at < CACHE_TTL_MS ? cached.value : undefined
  if (template === undefined) {
    template = await fetchPrompt(ownerEmail, ref)
    if (cache.size >= MAX_CACHE_ENTRIES) cache.clear()
    cache.set(key, { at: Date.now(), value: template })
  }
  if (!template) {
    throw new GatewayError(
      404,
      ref.version
        ? `Prompt '${ref.id}' has no version ${ref.version}.`
        : `Prompt '${ref.id}' doesn't exist in this app owner's prompt library.`,
      "prompt_not_found"
    )
  }
  return template
}

async function fetchPrompt(
  ownerEmail: string,
  ref: PromptRef
): Promise<PromptTemplate | null> {
  const db = supabaseAdmin()
  const { data: prompt, error } = await db
    .from("prompts")
    .select("id, slug, published_version")
    .eq("owner_email", ownerEmail)
    .eq("slug", ref.id)
    .maybeSingle()
  if (error)
    throw new GatewayError(503, "Couldn't load the prompt.", "db_unavailable")
  if (!prompt) return null
  let query = db
    .from("prompt_versions")
    .select("version, messages, model, params")
    .eq("prompt_id", prompt.id)
  const version = ref.version ?? (prompt.published_version as number | null)
  query = version
    ? query.eq("version", version)
    : query.order("version", { ascending: false }).limit(1)
  const { data: rows } = await query
  const row = (rows ?? [])[0] as
    | {
        version: number
        messages: PromptMessage[]
        model: string | null
        params: PromptParams | null
      }
    | undefined
  if (!row) return null
  return {
    promptId: prompt.id as string,
    slug: prompt.slug as string,
    version: row.version,
    messages: row.messages,
    model: row.model,
    params: row.params ?? {},
  }
}

/** The request with the template's messages first and its defaults filled in. */
export function applyPrompt(
  request: ChatRequest,
  template: PromptTemplate,
  variables: Record<string, string>
): ChatRequest {
  let rendered: PromptMessage[]
  try {
    rendered = renderPrompt(template.messages, variables)
  } catch (error) {
    if (error instanceof MissingVariablesError)
      throw invalid(`${error.message} (prompt '${template.slug}').`)
    throw error
  }
  const next: ChatRequest = {
    ...request,
    model: request.model?.trim() ? request.model : (template.model ?? ""),
    messages: [
      ...rendered.map((message): ChatMessage => ({ ...message })),
      ...(request.messages ?? []),
    ],
  }
  for (const key of ["temperature", "top_p", "max_tokens"] as const) {
    if (next[key] == null && template.params[key] != null)
      next[key] = template.params[key]
  }
  return next
}

/** Drops a prompt from this instance's cache after it changes. */
export function forgetPrompt(ownerEmail: string, slug: string) {
  for (const key of cache.keys()) {
    if (key.startsWith(`${ownerEmail}:${slug}:`)) cache.delete(key)
  }
}
