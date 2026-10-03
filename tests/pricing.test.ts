import { describe, expect, test } from "bun:test"

import { usageFromChat } from "@/lib/gateway/usage"
import { countByTier, priceTier } from "@/lib/pricing"

describe("priceTier", () => {
  test("free only when both prices are known to be zero", () => {
    expect(priceTier(0, 0)).toBe("free")
    expect(priceTier(null, null)).toBe("unknown")
    expect(priceTier(0, null)).toBe("unknown")
    expect(priceTier(undefined, 0)).toBe("unknown")
  })

  test("any positive price is paid", () => {
    expect(priceTier(0.15, 0.6)).toBe("paid")
    expect(priceTier(0, 1)).toBe("paid")
    expect(priceTier(null, 2)).toBe("paid")
  })

  test("counts", () => {
    const rows: [number | null, number | null][] = [
      [0, 0],
      [1, 2],
      [null, null],
      [0, 0],
    ]
    expect(countByTier(rows, ([i, o]) => priceTier(i, o))).toEqual({
      free: 2,
      paid: 1,
      unknown: 1,
    })
  })
})

describe("usageFromChat", () => {
  test("counts thinking tokens hidden in total_tokens as output", () => {
    // Gemini (OpenAI-compatible): 18 in, 26 out, 208 total -> 164 thinking.
    const usage = usageFromChat({
      prompt_tokens: 18,
      completion_tokens: 26,
      total_tokens: 208,
    })
    expect(usage?.outputTokens).toBe(190)
    expect(usage?.reasoningTokens).toBe(164)
  })

  test("leaves OpenAI-style usage alone (reasoning already in output)", () => {
    const usage = usageFromChat({
      prompt_tokens: 10,
      completion_tokens: 50,
      total_tokens: 60,
      completion_tokens_details: { reasoning_tokens: 30 },
    })
    expect(usage?.outputTokens).toBe(50)
    expect(usage?.reasoningTokens).toBe(30)
  })

  test("ignores a total smaller than its parts", () => {
    const usage = usageFromChat({
      prompt_tokens: 10,
      completion_tokens: 5,
      total_tokens: 12,
    })
    expect(usage?.outputTokens).toBe(5)
  })
})
