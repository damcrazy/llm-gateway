// Types, limits and snippet builders shared by the prompt pages and actions
// (server and client safe).

import type {
  PromptMessage,
  PromptParams,
  PromptRole,
} from "@/lib/prompt-template"

export const MAX_MESSAGES = 50
export const MAX_MESSAGE_CHARS = 100_000
export const MAX_NAME_CHARS = 100
export const MAX_DESCRIPTION_CHARS = 500
export const MAX_NOTE_CHARS = 500
export const MAX_MODEL_CHARS = 256
export const MAX_SLUG_CHARS = 64
export const MAX_TEMPERATURE = 2
export const MAX_MAX_TOKENS = 1_000_000

export const ROLES: { value: PromptRole; label: string }[] = [
  { value: "system", label: "System" },
  { value: "user", label: "User" },
  { value: "assistant", label: "Assistant" },
]

/** What a new prompt starts with (version 1). */
export const STARTER_MESSAGES: PromptMessage[] = [
  { role: "system", content: "You are a helpful assistant for {{company}}." },
  { role: "user", content: "{{question}}" },
]

export const PROMPT_COLUMNS =
  "id, owner_email, slug, name, description, published_version, created_at, updated_at"

export const VERSION_COLUMNS =
  "id, version, messages, model, params, note, created_by, created_at"

export interface PromptInfo {
  id: string
  owner_email: string
  slug: string
  name: string
  description: string | null
  published_version: number | null
  created_at: string
  updated_at: string
}

export interface PromptVersion {
  id: string
  version: number
  messages: PromptMessage[]
  model: string | null
  params: PromptParams
  note: string | null
  created_by: string | null
  created_at: string
}

/** "Support reply (v2)!" -> "support-reply-v2" */
export function toPromptSlug(value: string): string {
  return value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^[^a-z0-9]+/, "")
    .slice(0, MAX_SLUG_CHARS)
    .replace(/-+$/, "")
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function isPromptId(value: string): boolean {
  return UUID_PATTERN.test(value)
}

export const KEY_PLACEHOLDER = "gw_live_…"

export interface PromptSnippetInput {
  origin: string
  slug: string
  /** Pinned version, or null for the published (or latest) one. */
  version: number | null
  variables: string[]
  /** Whether the version used has a default model. */
  hasModel: boolean
}

function indent(text: string, spaces: number): string {
  const pad = " ".repeat(spaces)
  return text
    .split("\n")
    .map((line, index) => (index === 0 ? line : pad + line))
    .join("\n")
}

/** The `prompt` field, with placeholder values for the variables. */
function promptField({ slug, version, variables }: PromptSnippetInput) {
  const prompt: Record<string, unknown> = { id: slug }
  if (version != null) prompt.version = version
  if (variables.length) {
    prompt.variables = Object.fromEntries(
      variables.map((name) => [name, `<${name}>`])
    )
  }
  return prompt
}

export function curlSnippet(input: PromptSnippetInput): string {
  const body: Record<string, unknown> = {}
  if (!input.hasModel) body.model = "<model>"
  body.prompt = promptField(input)
  return `curl ${input.origin}/v1/chat/completions \\
  -H "Authorization: Bearer ${KEY_PLACEHOLDER}" \\
  -H "Content-Type: application/json" \\
  -d '${indent(JSON.stringify(body, null, 2), 2)}'`
}

export function pythonSnippet(input: PromptSnippetInput): string {
  const model = input.hasModel
    ? `model="",  # empty: use the prompt's default model`
    : `model="<model>",`
  return `from openai import OpenAI

client = OpenAI(
    base_url="${input.origin}/v1",
    api_key="${KEY_PLACEHOLDER}",
)

response = client.chat.completions.create(
    ${model}
    messages=[],  # extra messages go after the prompt's own
    extra_body={
        "prompt": ${indent(JSON.stringify(promptField(input), null, 4), 8)},
    },
)
print(response.choices[0].message.content)`
}
