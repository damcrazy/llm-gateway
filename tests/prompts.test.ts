import { describe, expect, test } from "bun:test"

import {
  applyPrompt,
  parsePromptRef,
  type PromptTemplate,
} from "@/lib/gateway/prompts"
import { promptVariables, renderPrompt } from "@/lib/prompt-template"

const template: PromptTemplate = {
  promptId: "p1",
  slug: "support-reply",
  version: 3,
  messages: [
    {
      role: "system",
      content: "You help {{ company }} customers. Tone: {{tone}}.",
    },
    { role: "user", content: "Customer {{name}} asks: {{question}}" },
  ],
  model: "smart",
  params: { temperature: 0.2, max_tokens: 300 },
}

describe("prompt templates", () => {
  test("variables in order of first use", () => {
    expect(promptVariables(template.messages)).toEqual([
      "company",
      "tone",
      "name",
      "question",
    ])
  })

  test("render fills variables and reports missing ones", () => {
    expect(
      renderPrompt([{ role: "user", content: "Hi {{name}}, {{ name }}!" }], {
        name: "Ada",
      })
    ).toEqual([{ role: "user", content: "Hi Ada, Ada!" }])
    expect(() => renderPrompt(template.messages, { company: "Acme" })).toThrow(
      "Missing prompt variables: tone, name, question"
    )
  })
})

describe("parsePromptRef", () => {
  test("slug, object, Responses-style variables", () => {
    expect(parsePromptRef(undefined)).toBeNull()
    expect(parsePromptRef("support-reply")).toEqual({
      id: "support-reply",
      variables: {},
    })
    expect(
      parsePromptRef({
        id: "x",
        version: "2",
        variables: { a: "1", n: 5, t: { type: "input_text", text: "hi" } },
      })
    ).toEqual({ id: "x", version: 2, variables: { a: "1", n: "5", t: "hi" } })
  })

  test("rejects bad shapes", () => {
    expect(() => parsePromptRef(42)).toThrow(/prompt slug/)
    expect(() => parsePromptRef({ version: 1 })).toThrow(/prompt.id/)
    expect(() => parsePromptRef({ id: "x", version: 0 })).toThrow(
      /version number/
    )
    expect(() => parsePromptRef({ id: "x", variables: ["a"] })).toThrow(
      /variables/
    )
  })
})

describe("applyPrompt", () => {
  const variables = {
    company: "Acme",
    tone: "warm",
    name: "Jane",
    question: "Where is my order?",
  }

  test("template first, then the request's messages; defaults filled", () => {
    const request = applyPrompt(
      {
        model: "",
        messages: [{ role: "user", content: "Order #42" }],
        temperature: 0.9,
      },
      template,
      variables
    )
    expect(request.model).toBe("smart")
    expect(request.temperature).toBe(0.9)
    expect(request.max_tokens).toBe(300)
    expect(request.messages).toEqual([
      { role: "system", content: "You help Acme customers. Tone: warm." },
      { role: "user", content: "Customer Jane asks: Where is my order?" },
      { role: "user", content: "Order #42" },
    ])
  })

  test("the request's model wins; missing variables are a 400", () => {
    expect(
      applyPrompt({ model: "fast", messages: [] }, template, variables).model
    ).toBe("fast")
    expect(() =>
      applyPrompt({ model: "", messages: [] }, template, {})
    ).toThrow(
      /Missing prompt variables: company, tone, name, question \(prompt 'support-reply'\)/
    )
  })
})
