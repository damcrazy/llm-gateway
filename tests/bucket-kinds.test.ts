import { describe, expect, test } from "bun:test"

import {
  bucketKindMix,
  kindModelLabel,
  mixWarningText,
  offKindToast,
} from "@/lib/bucket-kinds"
import type { ModelKind } from "@/lib/db/types"

const m = (id: string, kind: ModelKind) => ({ id, name: `Model ${id}`, kind })

describe("bucketKindMix", () => {
  test("one kind or empty is not a mix", () => {
    expect(bucketKindMix([])).toBeNull()
    expect(bucketKindMix([m("a", "chat"), m("b", "chat")])).toBeNull()
  })

  test("primary is the first model's kind", () => {
    const mix = bucketKindMix([
      m("e", "embedding"),
      m("c1", "chat"),
      m("c2", "chat"),
    ])!
    expect(mix.primary).toBe("embedding")
    expect(mix.counts).toEqual({ embedding: 1, chat: 2 })
    expect(mix.offKind.map((x) => x.id)).toEqual(["c1", "c2"])
  })
})

describe("mixWarningText", () => {
  test("two kinds, plural", () => {
    const mix = bucketKindMix([
      m("c1", "chat"),
      m("c2", "chat"),
      m("c3", "chat"),
      m("e1", "embedding"),
      m("e2", "embedding"),
    ])!
    expect(mixWarningText("smart", mix)).toEqual({
      title: "This bucket mixes chat and embedding models",
      body: "Chat requests to smart only try its 3 chat models. The 2 embedding models are skipped, never used as fallbacks, so if the chat models fail the request fails. Embedding requests do the reverse. Move them into their own bucket.",
    })
  })

  test("two kinds, singular", () => {
    const mix = bucketKindMix([m("c1", "chat"), m("e1", "embedding")])!
    expect(mixWarningText("smart", mix).body).toBe(
      "Chat requests to smart only try its 1 chat model. The 1 embedding model is skipped, never used as fallbacks, so if the chat model fails the request fails. Embedding requests do the reverse. Move it into its own bucket."
    )
  })

  test("three kinds", () => {
    const mix = bucketKindMix([
      m("c1", "chat"),
      m("c2", "chat"),
      m("e1", "embedding"),
      m("e2", "embedding"),
      m("i1", "image"),
    ])!
    expect(mixWarningText("mixed", mix)).toEqual({
      title: "This bucket mixes chat, embedding and image models",
      body: "Chat requests to mixed only try its 2 chat models. The other 3 models (2 embedding, 1 image) are skipped, never used as fallbacks, so if the chat models fail the request fails. Other requests only use models of their own kind. Move them into their own buckets.",
    })
  })
})

test("offKindToast and kindModelLabel", () => {
  expect(offKindToast("Gemini Embedding 2", "embedding", "smart", "chat")).toBe(
    "Gemini Embedding 2 is an embedding model. Chat requests to smart will skip it."
  )
  expect(offKindToast("GPT Image", "image", "embed", "embedding")).toBe(
    "GPT Image is an image model. Embedding requests to embed will skip it."
  )
  expect(kindModelLabel("embedding")).toBe("Embedding model")
})
