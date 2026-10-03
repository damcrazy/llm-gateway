import type { RequestRecorder } from "./recorder"

// Request tags and metadata, for filtering logs and costs:
// - x-gateway-tags: comma-separated tags (up to 10; letters, numbers and
//   _ . : / @ -, up to 64 characters each);
// - the end user: x-gateway-user, or the body's `user` (OpenAI),
//   `safety_identifier` (OpenAI) or `metadata.user_id` (Anthropic);
// - `metadata` (OpenAI and Anthropic): up to 16 string values.
// The body is forwarded to providers unchanged.

const TAG_PATTERN = /^[\w.:/@-]{1,64}$/
const MAX_TAGS = 10
const MAX_METADATA_KEYS = 16

export function parseTags(header: string | null): string[] {
  if (!header) return []
  const tags = header
    .split(",")
    .map((tag) => tag.trim())
    .filter((tag) => TAG_PATTERN.test(tag))
  return [...new Set(tags)].slice(0, MAX_TAGS)
}

function text(value: unknown, max: number): string | null {
  if (typeof value === "string" && value.trim())
    return value.trim().slice(0, max)
  if (typeof value === "number" || typeof value === "boolean")
    return String(value)
  return null
}

export function requestContext(
  request: Request,
  body: unknown
): {
  tags: string[]
  endUser: string | null
  metadata: Record<string, string> | null
} {
  const fields = (body && typeof body === "object" ? body : {}) as Record<
    string,
    unknown
  >
  const raw =
    fields.metadata && typeof fields.metadata === "object"
      ? (fields.metadata as Record<string, unknown>)
      : {}
  const entries = Object.entries(raw)
    .map(([key, value]) => [key.slice(0, 64), text(value, 512)] as const)
    .filter((entry): entry is readonly [string, string] => entry[1] !== null)
    .slice(0, MAX_METADATA_KEYS)
  return {
    tags: parseTags(request.headers.get("x-gateway-tags")),
    endUser:
      text(request.headers.get("x-gateway-user"), 200) ??
      text(fields.user, 200) ??
      text(fields.safety_identifier, 200) ??
      text(raw.user_id, 200),
    metadata: entries.length ? Object.fromEntries(entries) : null,
  }
}

export function captureRequestContext(
  recorder: RequestRecorder,
  request: Request,
  body: unknown
): void {
  const context = requestContext(request, body)
  recorder.tags = context.tags
  recorder.endUser = context.endUser
  recorder.metadata = context.metadata
}
