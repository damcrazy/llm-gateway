import { describe, expect, test } from "bun:test"

import {
  embeddingInputCount,
  embeddingsProblem,
  estimateEmbeddingTokens,
  normalizeEmbeddings,
  reportedEmbeddingTokens,
} from "@/lib/gateway/embeddings-check"
import type { EmbeddingsResponse } from "@/lib/gateway/types"

const vectors = (...sizes: number[]): EmbeddingsResponse => ({
  object: "list",
  model: "m",
  data: sizes.map((size, index) => ({
    object: "embedding",
    index,
    embedding: Array.from({ length: size }, () => 0.1),
  })),
  usage: { prompt_tokens: 1, total_tokens: 1 },
})

const base64 = (size: number) =>
  Buffer.from(new Float32Array(size).buffer).toString("base64")

describe("embeddingInputCount", () => {
  test("a string is one input", () => {
    expect(embeddingInputCount("hello")).toBe(1)
  })
  test("a list of strings is one input each", () => {
    expect(embeddingInputCount(["a", "b", "c"])).toBe(3)
  })
  test("a list of token ids is one input", () => {
    expect(embeddingInputCount([1, 2, 3])).toBe(1)
  })
  test("a list of token lists is one input each", () => {
    expect(embeddingInputCount([[1, 2], [3]])).toBe(2)
  })
})

describe("embeddingsProblem", () => {
  test("accepts one vector per input at the requested size", () => {
    expect(embeddingsProblem(vectors(1536, 1536), 2, 1536)).toBeNull()
  })

  test("accepts any consistent size when none was requested", () => {
    expect(embeddingsProblem(vectors(3072, 3072), 2, undefined)).toBeNull()
  })

  test("rejects full-size vectors when a smaller size was requested", () => {
    expect(embeddingsProblem(vectors(3072, 3072), 2, 1536)).toBe(
      "Returned 3072-dimension vectors; the request asked for 1536"
    )
  })

  test("rejects a missing vector", () => {
    expect(embeddingsProblem(vectors(1536), 2, 1536)).toBe(
      "Returned 1 embedding for 2 inputs"
    )
  })

  test("rejects vectors of different sizes", () => {
    expect(embeddingsProblem(vectors(1536, 3072), 2, undefined)).toBe(
      "Returned vectors of different sizes (1536, 3072)"
    )
  })

  test("rejects a response without data", () => {
    expect(
      embeddingsProblem({ object: "list" } as EmbeddingsResponse, 1, undefined)
    ).toBe("The response has no embeddings")
  })

  test("measures base64 vectors without decoding them", () => {
    const response = vectors(1)
    response.data = [0, 1].map((index) => ({
      object: "embedding",
      index,
      embedding: base64(1536),
    }))
    expect(embeddingsProblem(response, 2, 1536)).toBeNull()
    response.data[1]!.embedding = base64(1535)
    expect(embeddingsProblem(response, 2, undefined)).toBe(
      "Returned vectors of different sizes (1536, 1535)"
    )
  })
})

describe("embedding token usage", () => {
  const withUsage = (prompt_tokens: number | undefined) =>
    ({
      ...vectors(3),
      usage:
        prompt_tokens == null
          ? undefined
          : { prompt_tokens, total_tokens: prompt_tokens },
    }) as EmbeddingsResponse

  test("trusts a real count", () => {
    expect(reportedEmbeddingTokens(withUsage(12), "hello there")).toBe(12)
  })
  test("no usage at all is unreported (Google)", () => {
    expect(
      reportedEmbeddingTokens(withUsage(undefined), "hello there")
    ).toBeNull()
  })
  test("0 tokens for text that isn't empty is unreported", () => {
    expect(
      reportedEmbeddingTokens(withUsage(0), ["a sentence", "another"])
    ).toBeNull()
  })
  test("0 tokens for empty input is believable", () => {
    expect(reportedEmbeddingTokens(withUsage(0), "")).toBe(0)
  })
  test("estimates text at about 4 characters a token, and counts token ids", () => {
    expect(estimateEmbeddingTokens("12345678")).toBe(2)
    expect(estimateEmbeddingTokens(["1234", "12345"])).toBe(3)
    expect(estimateEmbeddingTokens([5, 6, 7])).toBe(3)
    expect(estimateEmbeddingTokens([[1, 2], [3]])).toBe(3)
  })
})

describe("normalizeEmbeddings", () => {
  test("fills in a missing index from the position", () => {
    const response = vectors(2, 2)
    response.data = response.data.map((item) => ({
      ...item,
      index: null as unknown as number,
    }))
    const normalized = normalizeEmbeddings(response, 7)
    expect(normalized.data.map((item) => item.index)).toEqual([0, 1])
    expect(normalized.usage).toEqual({ prompt_tokens: 7, total_tokens: 7 })
  })
  test("keeps indexes the provider gave", () => {
    const response = vectors(2, 2)
    response.data = [response.data[1]!, response.data[0]!]
    expect(
      normalizeEmbeddings(response, 1).data.map((item) => item.index)
    ).toEqual([1, 0])
  })
})
