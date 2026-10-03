import { Validator, type Schema } from "@cfworker/json-schema"

import type { ChatCompletion, ChatRequest } from "./types"

// Structured-output guard: for apps that turn it on, a non-streaming answer
// to a request with response_format json_object / json_schema must be valid
// JSON (and match the schema). An answer that isn't counts as a failed
// attempt: the next model in the chain is tried, and the same model gets one
// more try if it's the last option. A fenced answer (```json … ```) is
// accepted and unwrapped.

export type StructuredFormat =
  | { kind: "json_object" }
  | { kind: "json_schema"; name: string; schema: Schema }

export function structuredFormat(
  request: ChatRequest
): StructuredFormat | null {
  const format = request.response_format as
    | {
        type?: string
        json_schema?: { name?: string; schema?: unknown }
      }
    | undefined
  if (format?.type === "json_object") return { kind: "json_object" }
  if (
    format?.type === "json_schema" &&
    format.json_schema?.schema &&
    typeof format.json_schema.schema === "object"
  ) {
    return {
      kind: "json_schema",
      name: format.json_schema.name ?? "schema",
      schema: format.json_schema.schema as Schema,
    }
  }
  return null
}

const MAX_VALIDATORS = 100
const validators = new Map<string, Validator>()

function validatorFor(schema: Schema): Validator {
  const key = JSON.stringify(schema)
  let validator = validators.get(key)
  if (!validator) {
    validator = new Validator(schema, "2020-12", false)
    if (validators.size >= MAX_VALIDATORS) {
      const oldest = validators.keys().next().value
      if (oldest !== undefined) validators.delete(oldest)
    }
    validators.set(key, validator)
  }
  return validator
}

function unfence(text: string): string {
  const match = /^\s*```(?:json)?\s*\n?([\s\S]*?)\n?\s*```\s*$/i.exec(text)
  return (match ? match[1]! : text).trim()
}

/** The completion (with fences removed) if it holds valid output, or why not. */
export function checkStructuredOutput(
  completion: ChatCompletion,
  format: StructuredFormat
): { ok: true; completion: ChatCompletion } | { ok: false; problem: string } {
  const choice = completion.choices[0]
  const message = choice?.message
  // A tool call is a valid way to answer; there's no text to check.
  if (message?.tool_calls?.length && !message.content)
    return { ok: true, completion }
  if (choice?.finish_reason === "length")
    return { ok: false, problem: "the answer was cut off at max_tokens" }
  const raw = typeof message?.content === "string" ? message.content : ""
  if (!raw.trim()) return { ok: false, problem: "the answer was empty" }

  const text = unfence(raw)
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return { ok: false, problem: "the answer isn't valid JSON" }
  }
  if (
    format.kind === "json_object" &&
    (typeof value !== "object" || !value || Array.isArray(value))
  )
    return { ok: false, problem: "the answer isn't a JSON object" }
  if (format.kind === "json_schema") {
    const result = validatorFor(format.schema).validate(value)
    if (!result.valid) {
      // The deepest error is usually the most specific one.
      const error = [...result.errors].sort(
        (a, b) => b.instanceLocation.length - a.instanceLocation.length
      )[0]
      const where = error?.instanceLocation.replace(/^#/, "") || "/"
      return {
        ok: false,
        problem: `the answer doesn't match schema '${format.name}' at ${where}: ${error?.error ?? "invalid"}`,
      }
    }
  }
  if (text === raw) return { ok: true, completion }
  return {
    ok: true,
    completion: {
      ...completion,
      choices: completion.choices.map((c, index) =>
        index === 0 && c.message
          ? { ...c, message: { ...c.message, content: text } }
          : c
      ),
    },
  }
}
