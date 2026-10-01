import { describe, expect, test } from "bun:test"

import { toCallOptions, toPrompt } from "@/lib/gateway/adapters/ai-sdk"
import { retryAfterMs } from "@/lib/gateway/errors"
import { parseSse } from "@/lib/gateway/sse"
import {
  anthropicToChat,
  chatToAnthropic,
  chunksToAnthropicEvents,
} from "@/lib/gateway/translate/anthropic"
import type { ChatChunk, ChatMessage } from "@/lib/gateway/types"

describe("Anthropic -> OpenAI request", () => {
  test("system blocks, tool use and tool results", () => {
    const chat = anthropicToChat({
      model: "smart",
      max_tokens: 1024,
      system: [
        {
          type: "text",
          text: "Be terse.",
          cache_control: { type: "ephemeral" },
        },
      ],
      stream: true,
      tools: [
        {
          name: "get_weather",
          description: "Weather",
          input_schema: { type: "object", properties: {} },
        },
        { type: "web_search_20250305", name: "web_search" },
      ],
      tool_choice: { type: "any" },
      messages: [
        { role: "user", content: "Weather in Paris?" },
        {
          role: "assistant",
          content: [
            { type: "text", text: "Checking." },
            {
              type: "tool_use",
              id: "toolu_1",
              name: "get_weather",
              input: { city: "Paris" },
            },
          ],
        },
        {
          role: "user",
          content: [
            {
              type: "tool_result",
              tool_use_id: "toolu_1",
              content: [{ type: "text", text: "18C" }],
            },
            { type: "text", text: "Thanks" },
          ],
        },
      ],
    })

    expect(chat.messages[0]).toEqual({
      role: "system",
      content: [
        {
          type: "text",
          text: "Be terse.",
          cache_control: { type: "ephemeral" },
        },
      ],
    })
    expect(chat.messages[2]).toMatchObject({
      role: "assistant",
      content: "Checking.",
      tool_calls: [
        {
          id: "toolu_1",
          type: "function",
          function: { name: "get_weather", arguments: '{"city":"Paris"}' },
        },
      ],
    })
    expect(chat.messages[3]).toEqual({
      role: "tool",
      tool_call_id: "toolu_1",
      content: "18C",
    })
    expect(chat.messages[4]).toEqual({
      role: "user",
      content: [{ type: "text", text: "Thanks" }],
    })
    // Server tools are dropped; tool_choice any -> required
    expect(chat.tools?.map((t) => t.function.name)).toEqual(["get_weather"])
    expect(chat.tool_choice).toBe("required")
    expect(chat.stream_options).toEqual({ include_usage: true })
  })

  test("images become data URLs", () => {
    const chat = anthropicToChat({
      model: "m",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: { type: "base64", media_type: "image/png", data: "AAAA" },
            },
          ],
        },
      ],
    })
    expect(chat.messages[0].content).toEqual([
      { type: "image_url", image_url: { url: "data:image/png;base64,AAAA" } },
    ])
  })
})

describe("OpenAI -> Anthropic response", () => {
  test("text and tool calls", () => {
    const message = chatToAnthropic(
      {
        id: "chatcmpl-abc",
        object: "chat.completion",
        created: 0,
        model: "x",
        choices: [
          {
            index: 0,
            finish_reason: "tool_calls",
            message: {
              role: "assistant",
              content: "Let me check",
              tool_calls: [
                {
                  id: "call_1",
                  type: "function",
                  function: { name: "f", arguments: '{"a":1}' },
                },
              ],
            },
          },
        ],
      },
      "smart",
      {
        inputTokens: 100,
        outputTokens: 20,
        cachedTokens: 40,
        reasoningTokens: 0,
        estimated: false,
      }
    )
    expect(message.stop_reason).toBe("tool_use")
    expect(message.content).toEqual([
      { type: "text", text: "Let me check" },
      { type: "tool_use", id: "call_1", name: "f", input: { a: 1 } },
    ])
    expect(message.usage).toEqual({
      input_tokens: 60,
      output_tokens: 20,
      cache_read_input_tokens: 40,
      cache_creation_input_tokens: 0,
    })
  })

  test("streaming event sequence", async () => {
    const base = {
      id: "c",
      object: "chat.completion.chunk" as const,
      created: 0,
      model: "x",
    }
    async function* chunks(): AsyncGenerator<ChatChunk> {
      yield {
        ...base,
        choices: [
          {
            index: 0,
            delta: { role: "assistant", content: "Hi" },
            finish_reason: null,
          },
        ],
      }
      yield {
        ...base,
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [
                {
                  index: 0,
                  id: "call_1",
                  type: "function",
                  function: { name: "f", arguments: "" },
                },
              ],
            },
            finish_reason: null,
          },
        ],
      }
      yield {
        ...base,
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [{ index: 0, function: { arguments: '{"a":' } }],
            },
            finish_reason: null,
          },
        ],
      }
      yield {
        ...base,
        choices: [
          {
            index: 0,
            delta: {
              tool_calls: [{ index: 0, function: { arguments: "1}" } }],
            },
            finish_reason: null,
          },
        ],
      }
      yield {
        ...base,
        choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }],
      }
    }
    const events = []
    for await (const event of chunksToAnthropicEvents(
      chunks(),
      "smart",
      () => ({
        inputTokens: 10,
        outputTokens: 5,
        cachedTokens: 0,
        reasoningTokens: 0,
        estimated: false,
      })
    )) {
      events.push(event)
    }
    expect(events.map((e) => e.event)).toEqual([
      "message_start",
      "content_block_start",
      "content_block_delta",
      "content_block_stop",
      "content_block_start",
      "content_block_delta",
      "content_block_delta",
      "content_block_stop",
      "message_delta",
      "message_stop",
    ])
    expect(events[4].data).toMatchObject({
      index: 1,
      content_block: { type: "tool_use", id: "call_1", name: "f" },
    })
    expect(events[8].data).toMatchObject({
      delta: { stop_reason: "tool_use" },
      usage: { output_tokens: 5 },
    })
  })
})

describe("OpenAI -> AI SDK prompt", () => {
  test("tool calls, tool results and images", () => {
    const messages: ChatMessage[] = [
      { role: "system", content: "sys" },
      {
        role: "user",
        content: [
          { type: "text", text: "look", cache_control: { type: "ephemeral" } },
          {
            type: "image_url",
            image_url: { url: "data:image/jpeg;base64,QUJD" },
          },
        ],
      },
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "c1",
            type: "function",
            function: { name: "lookup", arguments: '{"q":"x"}' },
          },
        ],
      },
      { role: "tool", tool_call_id: "c1", content: "result" },
    ]
    const prompt = toPrompt(messages)
    expect(prompt[0]).toMatchObject({ role: "system", content: "sys" })
    expect(prompt[1]).toMatchObject({
      role: "user",
      content: [
        {
          type: "text",
          text: "look",
          providerOptions: {
            anthropic: { cacheControl: { type: "ephemeral" } },
          },
        },
        {
          type: "file",
          mediaType: "image/jpeg",
          data: { type: "data", data: "QUJD" },
        },
      ],
    })
    expect(prompt[2]).toMatchObject({
      role: "assistant",
      content: [
        {
          type: "tool-call",
          toolCallId: "c1",
          toolName: "lookup",
          input: { q: "x" },
        },
      ],
    })
    expect(prompt[3]).toMatchObject({
      role: "tool",
      content: [
        {
          type: "tool-result",
          toolCallId: "c1",
          toolName: "lookup",
          output: { type: "text", value: "result" },
        },
      ],
    })
  })

  test("call options", () => {
    const options = toCallOptions(
      {
        model: "m",
        messages: [{ role: "user", content: "hi" }],
        max_completion_tokens: 50,
        stop: "END",
        tools: [
          {
            type: "function",
            function: { name: "f", parameters: { type: "object" } },
          },
        ],
        tool_choice: { type: "function", function: { name: "f" } },
        response_format: {
          type: "json_schema",
          json_schema: { name: "s", schema: { type: "object" } },
        },
        reasoning_effort: "high",
      },
      new AbortController().signal
    )
    expect(options.maxOutputTokens).toBe(50)
    expect(options.stopSequences).toEqual(["END"])
    expect(options.toolChoice).toEqual({ type: "tool", toolName: "f" })
    expect(options.responseFormat).toMatchObject({ type: "json", name: "s" })
    expect(options.reasoning).toBe("high")
  })
})

describe("helpers", () => {
  test("retry-after parsing", () => {
    expect(retryAfterMs(new Headers({ "retry-after": "7" }))).toBe(7000)
    expect(retryAfterMs(new Headers({ "retry-after-ms": "250" }))).toBe(250)
    expect(
      retryAfterMs(new Headers({ "x-ratelimit-reset-requests": "1m30s" }))
    ).toBe(90_000)
    expect(retryAfterMs(new Headers())).toBeUndefined()
  })

  test("SSE parsing across chunk boundaries", async () => {
    const encoder = new TextEncoder()
    const parts = [
      'data: {"a":',
      "1}\n\nevent: ping\ndata: x\n",
      "\n: comment\n\ndata: [DONE]\n\n",
    ]
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const part of parts) controller.enqueue(encoder.encode(part))
        controller.close()
      },
    })
    const events = []
    for await (const event of parseSse(stream)) events.push(event)
    expect(events).toEqual([
      { data: '{"a":1}', event: undefined },
      { event: "ping", data: "x" },
      { data: "[DONE]", event: undefined },
    ])
  })
})
