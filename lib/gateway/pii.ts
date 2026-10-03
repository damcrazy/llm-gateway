import type { ChatContentPart, ChatMessage, ChatRequest } from "./types"

// Finds personal data and secrets in prompts. An app can have them replaced
// with placeholders before a provider sees them ("redact") or have such
// requests refused ("block"). Detection is deliberately conservative: card
// numbers must pass the Luhn check, IBANs the mod-97 check, and phone numbers
// need 9-15 digits in a phone-like grouping, so ordinary numbers, dates and
// ids aren't touched.

export type PiiKind = "secret" | "email" | "card" | "iban" | "ssn" | "phone"

export const PII_LABELS: Record<PiiKind, string> = {
  secret: "an API key or secret",
  email: "an email address",
  card: "a card number",
  iban: "a bank account number (IBAN)",
  ssn: "a US social security number",
  phone: "a phone number",
}

const digitsOf = (value: string) => value.replace(/\D/g, "")

function luhn(value: string): boolean {
  const digits = digitsOf(value)
  if (digits.length < 13 || digits.length > 19) return false
  let sum = 0
  for (let i = 0; i < digits.length; i++) {
    let digit = Number(digits[digits.length - 1 - i])
    if (i % 2 === 1) {
      digit *= 2
      if (digit > 9) digit -= 9
    }
    sum += digit
  }
  return sum % 10 === 0
}

function ibanValid(value: string): boolean {
  const compact = value.replace(/\s/g, "").toUpperCase()
  if (compact.length < 15 || compact.length > 34) return false
  const rearranged = compact.slice(4) + compact.slice(0, 4)
  let remainder = 0
  for (const char of rearranged) {
    const code = /[A-Z]/.test(char) ? String(char.charCodeAt(0) - 55) : char
    for (const digit of code) remainder = (remainder * 10 + Number(digit)) % 97
  }
  return remainder === 1
}

function phoneLike(value: string): boolean {
  const count = digitsOf(value).length
  return count >= 9 && count <= 15
}

interface Detector {
  kind: PiiKind
  pattern: RegExp
  valid?: (match: string) => boolean
}

// Order matters: secrets first (they can contain digits and @), then the
// rest, so one match isn't reported as two kinds.
const DETECTORS: Detector[] = [
  {
    kind: "secret",
    pattern:
      /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g,
  },
  {
    kind: "secret",
    pattern:
      /\b(?:sk-(?:proj-|ant-[a-z]+\d*-)?[A-Za-z0-9_-]{20,}|gw_live_[A-Za-z0-9_-]{20,}|AKIA[0-9A-Z]{16}|gh[pousr]_[A-Za-z0-9]{36,}|github_pat_[A-Za-z0-9_]{40,}|xox[abprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_-]{35}|(?:sk|rk|pk)_live_[A-Za-z0-9]{20,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,})/g,
  },
  {
    kind: "email",
    pattern:
      /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g,
  },
  {
    kind: "iban",
    pattern: /\b[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,4})?\b/g,
    valid: ibanValid,
  },
  { kind: "card", pattern: /\b\d(?:[ -]?\d){12,18}\b/g, valid: luhn },
  {
    kind: "ssn",
    pattern: /\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g,
  },
  {
    kind: "phone",
    // +country numbers, (area) numbers, and 555-123-4567 / 555.123.4567.
    // Space-separated digit groups alone are too ambiguous (card-like ids).
    pattern:
      /(?<![\w+])\+\d{1,3}(?:[ .-]?\(?\d{1,4}\)?)(?:[ .-]?\d{2,5}){1,4}(?!\w)|(?<![\w(])\(\d{2,5}\)[ .-]?\d{3,4}[ .-]?\d{3,4}(?!\w)|(?<![\w.-])\d{3}([.-])\d{3}\1\d{4}(?![\w.-])/g,
    valid: phoneLike,
  },
]

const PLACEHOLDER: Record<PiiKind, string> = {
  secret: "[SECRET]",
  email: "[EMAIL]",
  card: "[CARD]",
  iban: "[IBAN]",
  ssn: "[SSN]",
  phone: "[PHONE]",
}

/** Replaces what it finds with placeholders; `found` collects the kinds. */
export function scrubText(text: string, found: Set<PiiKind>): string {
  let result = text
  for (const detector of DETECTORS) {
    result = result.replace(detector.pattern, (match) => {
      if (detector.valid && !detector.valid(match)) return match
      found.add(detector.kind)
      return PLACEHOLDER[detector.kind]
    })
  }
  return result
}

function scrubParts(
  parts: ChatContentPart[],
  found: Set<PiiKind>
): ChatContentPart[] {
  return parts.map((part) =>
    part.type === "text" ? { ...part, text: scrubText(part.text, found) } : part
  )
}

function scrubMessage(message: ChatMessage, found: Set<PiiKind>): ChatMessage {
  const next: ChatMessage = { ...message }
  if (typeof message.content === "string")
    next.content = scrubText(message.content, found)
  else if (Array.isArray(message.content))
    next.content = scrubParts(message.content, found)
  if (message.tool_calls?.length) {
    next.tool_calls = message.tool_calls.map((call) => ({
      ...call,
      function: {
        ...call.function,
        arguments: scrubText(call.function.arguments ?? "", found),
      },
    }))
  }
  return next
}

/** The request with personal data replaced in every message. */
export function scrubChatRequest(request: ChatRequest): {
  request: ChatRequest
  found: PiiKind[]
} {
  const found = new Set<PiiKind>()
  const messages = (request.messages ?? []).map((message) =>
    scrubMessage(message, found)
  )
  return { request: { ...request, messages }, found: [...found] }
}

/** Every string inside a value, scrubbed (for stored payloads and traces). */
export function scrubDeep(value: unknown, depth = 0): unknown {
  if (depth > 12) return value
  if (typeof value === "string") return scrubText(value, new Set())
  if (Array.isArray(value))
    return value.map((item) => scrubDeep(item, depth + 1))
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        scrubDeep(item, depth + 1),
      ])
    )
  }
  return value
}

/** "an email address and a phone number" */
export function describePii(kinds: PiiKind[]): string {
  const labels = kinds.map((kind) => PII_LABELS[kind])
  if (labels.length <= 1) return labels[0] ?? "personal data"
  return `${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}`
}
