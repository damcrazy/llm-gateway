import { describe, expect, test } from "bun:test"

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
