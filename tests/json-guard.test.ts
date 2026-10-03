import { describe, expect, test } from "bun:test"

import {
  checkStructuredOutput,
  structuredFormat,
  type StructuredFormat,
} from "@/lib/gateway/json-guard"
import type { ChatCompletion } from "@/lib/gateway/types"

const answer = (
  content: string | null,
  finish = "stop",
  extra = {}
): ChatCompletion => ({
  id: "c",
  object: "chat.completion",
  created: 0,
  model: "m",
  choices: [
    {
      index: 0,
      message: { role: "assistant", content, ...extra },
      finish_reason: finish,
    },
  ],
})

const schema: StructuredFormat = {
  kind: "json_schema",
  name: "person",
  schema: {
    type: "object",
    properties: {
      name: { type: "string" },
      age: { type: "integer", minimum: 0 },
    },
    required: ["name", "age"],
    additionalProperties: false,
  },
}

describe("structuredFormat", () => {
  test("reads response_format", () => {
    expect(structuredFormat({ model: "m", messages: [] })).toBeNull()
    expect(
      structuredFormat({
        model: "m",
        messages: [],
        response_format: { type: "text" },
      })
    ).toBeNull()
    expect(
      structuredFormat({
        model: "m",
        messages: [],
        response_format: { type: "json_object" },
      })
    ).toEqual({ kind: "json_object" })
    expect(
      structuredFormat({
        model: "m",
        messages: [],
        response_format: {
          type: "json_schema",
          json_schema: { name: "p", schema: { type: "object" } },
        },
      })
    ).toEqual({ kind: "json_schema", name: "p", schema: { type: "object" } })
  })
})

describe("checkStructuredOutput", () => {
  test("valid JSON matching the schema passes unchanged", () => {
    const completion = answer('{"name":"Ada","age":36}')
    expect(checkStructuredOutput(completion, schema)).toEqual({
      ok: true,
      completion,
    })
  })

  test("fenced JSON is accepted and unwrapped", () => {
    const result = checkStructuredOutput(
      answer('```json\n{"name":"Ada","age":36}\n```'),
      schema
    )
    expect(result.ok && result.completion.choices[0]!.message!.content).toBe(
      '{"name":"Ada","age":36}'
    )
  })

  test("problems are explained", () => {
    const problem = (
      content: string | null,
      format: StructuredFormat = schema,
      finish = "stop"
    ) => {
      const result = checkStructuredOutput(answer(content, finish), format)
      return result.ok ? null : result.problem
    }
    expect(problem("Sure! Here you go: {name: Ada}")).toBe(
      "the answer isn't valid JSON"
    )
    expect(problem('{"name":"Ada"}')).toContain("doesn't match schema 'person'")
    expect(problem('{"name":"Ada","age":-1}')).toContain("at /age")
    expect(problem('{"name":"Ada","age":36,"x":1}')).toContain(
      "schema 'person'"
    )
    expect(problem('["a"]', { kind: "json_object" })).toBe(
      "the answer isn't a JSON object"
    )
    expect(problem("")).toBe("the answer was empty")
    expect(problem('{"name":"Ada","a', schema, "length")).toBe(
      "the answer was cut off at max_tokens"
    )
  })

  test("a tool call is a valid answer", () => {
    const completion = answer(null, "tool_calls", {
      tool_calls: [
        { id: "1", type: "function", function: { name: "f", arguments: "{}" } },
      ],
    })
    expect(checkStructuredOutput(completion, schema).ok).toBe(true)
  })
})
