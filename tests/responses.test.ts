import { describe, expect, test } from "bun:test"

import {
  chatToResponses,
  chunksToResponsesEvents,
  responsesToChat,
  type ResponsesEvent,
  type ResponsesRequest,
} from "@/lib/gateway/translate/responses"
import type { ChatChunk } from "@/lib/gateway/types"

async function* fromArray(chunks: ChatChunk[]) {
  yield* chunks
}

const chunk = (
  delta: ChatChunk["choices"][number]["delta"],
  finish: string | null = null
): ChatChunk => ({
  id: "c1",
  object: "chat.completion.chunk",
  created: 0,
  model: "m",
  choices: [{ index: 0, delta, finish_reason: finish }],
})

describe("responsesToChat", () => {
  test("string input, instructions and options", () => {
    const chat = responsesToChat({
      model: "smart",
      input: "Hi",
      instructions: "Be brief.",
      max_output_tokens: 100,
      temperature: 0.2,
      reasoning: { effort: "low" },
      stream: true,
    })
    expect(chat.messages).toEqual([
      { role: "system", content: "Be brief." },
      { role: "user", content: "Hi" },
    ])
    expect(chat.max_tokens).toBe(100)
    expect(chat.temperature).toBe(0.2)
    expect(chat.reasoning_effort).toBe("low")
    expect(chat.stream).toBe(true)
  })

  test("items: content parts, a tool round trip, reasoning skipped", () => {
    const chat = responsesToChat({
      model: "m",
      input: [
        { role: "developer", content: "Rules" },
        {
          role: "user",
          content: [
            { type: "input_text", text: "What's in this?" },
            { type: "input_image", image_url: "https://x/y.png" },
          ],
        },
        { type: "reasoning", id: "rs_1", summary: [] },
        {
          type: "function_call",
          call_id: "call_1",
          name: "a",
          arguments: "{}",
        },
        {
          type: "function_call",
          call_id: "call_2",
          name: "b",
          arguments: "{}",
        },
        { type: "function_call_output", call_id: "call_1", output: "1" },
        { type: "function_call_output", call_id: "call_2", output: "2" },
        { role: "assistant", content: [{ type: "output_text", text: "Done" }] },
      ],
    })
    expect(chat.messages).toEqual([
      { role: "system", content: "Rules" },
      {
        role: "user",
        content: [
          { type: "text", text: "What's in this?" },
          { type: "image_url", image_url: { url: "https://x/y.png" } },
        ],
      },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "call_1",
            type: "function",
            function: { name: "a", arguments: "{}" },
          },
          {
            id: "call_2",
            type: "function",
            function: { name: "b", arguments: "{}" },
          },
        ],
      },
      { role: "tool", tool_call_id: "call_1", content: "1" },
      { role: "tool", tool_call_id: "call_2", content: "2" },
      { role: "assistant", content: "Done" },
    ])
  })

  test("function tools and json_schema output", () => {
    const chat = responsesToChat({
      model: "m",
      input: "x",
      tools: [
        {
          type: "function",
          name: "get",
          parameters: { type: "object" },
          strict: true,
        },
      ],
      tool_choice: { type: "function", name: "get" },
      text: {
        format: {
          type: "json_schema",
          name: "out",
          schema: { type: "object" },
          strict: true,
        },
      },
    })
    expect(chat.tools).toEqual([
      {
        type: "function",
        function: { name: "get", parameters: { type: "object" }, strict: true },
      },
    ])
    expect(chat.tool_choice).toEqual({
      type: "function",
      function: { name: "get" },
    })
    expect(chat.response_format).toEqual({
      type: "json_schema",
      json_schema: { name: "out", schema: { type: "object" }, strict: true },
    })
  })

  test("rejects what a stateless gateway can't do", () => {
    expect(() =>
      responsesToChat({
        model: "m",
        input: "x",
        previous_response_id: "resp_1",
      })
    ).toThrow(/previous_response_id/)
    expect(() =>
      responsesToChat({
        model: "m",
        input: "x",
        tools: [{ type: "web_search" }],
      })
    ).toThrow(/function tools/)
    expect(() => responsesToChat({ model: "m", input: [] })).toThrow(
      /at least one message/
    )
  })
})

describe("chatToResponses", () => {
  test("text, tool calls, usage and truncation", () => {
    const body: ResponsesRequest = { model: "smart", input: "x" }
    const response = chatToResponses(
      {
        id: "c",
        object: "chat.completion",
        created: 0,
        model: "real",
        choices: [
          {
            index: 0,
            message: {
              role: "assistant",
              content: "Hello",
              tool_calls: [
                {
                  id: "call_9",
                  type: "function",
                  function: { name: "f", arguments: '{"a":1}' },
                },
              ],
            },
            finish_reason: "length",
          },
        ],
      },
      body,
      {
        inputTokens: 10,
        outputTokens: 5,
        cachedTokens: 2,
        reasoningTokens: 1,
        estimated: false,
      }
    )
    expect(response.object).toBe("response")
    expect(response.model).toBe("smart")
    expect(response.status).toBe("incomplete")
    expect(response.output.map((item) => item.type)).toEqual([
      "message",
      "function_call",
    ])
    expect(response.output[1]).toMatchObject({
      call_id: "call_9",
      name: "f",
      arguments: '{"a":1}',
    })
    expect(response.usage).toEqual({
      input_tokens: 10,
      input_tokens_details: { cached_tokens: 2 },
      output_tokens: 5,
      output_tokens_details: { reasoning_tokens: 1 },
      total_tokens: 15,
    })
  })
})

describe("chunksToResponsesEvents", () => {
  test("text then a tool call, in order with sequence numbers", async () => {
    const events: ResponsesEvent[] = []
    for await (const event of chunksToResponsesEvents(
      fromArray([
        chunk({ role: "assistant", content: "Hel" }),
        chunk({ content: "lo" }),
        chunk({
          tool_calls: [
            {
              index: 0,
              id: "call_1",
              type: "function",
              function: { name: "f", arguments: '{"a"' },
            },
          ],
        }),
        chunk({ tool_calls: [{ index: 0, function: { arguments: ":1}" } }] }),
        chunk({}, "tool_calls"),
      ]),
      { model: "smart", input: "x" },
      () => ({
        inputTokens: 3,
        outputTokens: 4,
        cachedTokens: 0,
        reasoningTokens: 0,
        estimated: false,
      })
    ))
      events.push(event)

    expect(events.map((event) => event.type)).toEqual([
      "response.created",
      "response.in_progress",
      "response.output_item.added",
      "response.content_part.added",
      "response.output_text.delta",
      "response.output_text.delta",
      "response.output_text.done",
      "response.content_part.done",
      "response.output_item.done",
      "response.output_item.added",
      "response.function_call_arguments.delta",
      "response.function_call_arguments.delta",
      "response.function_call_arguments.done",
      "response.output_item.done",
      "response.completed",
    ])
    expect(events.map((event) => event.sequence_number)).toEqual(
      events.map((_, index) => index)
    )
    const done = events.at(-1)!.response as {
      output: {
        type: string
        text?: string
        arguments?: string
        content?: { text: string }[]
      }[]
      usage: { total_tokens: number }
    }
    expect(done.output[0]!.content![0]!.text).toBe("Hello")
    expect(done.output[1]).toMatchObject({
      type: "function_call",
      call_id: "call_1",
      arguments: '{"a":1}',
    })
    expect(done.usage.total_tokens).toBe(7)
  })
})
