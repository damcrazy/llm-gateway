// Free / paid / unknown pricing tiers. A null price means "unknown", so a
// model only counts as free when both prices are known to be $0.

export type PriceTier = "free" | "paid" | "unknown"

export const PRICE_TIERS: PriceTier[] = ["free", "paid", "unknown"]

export const PRICE_TIER_LABELS: Record<PriceTier, string> = {
  free: "Free",
  paid: "Paid",
  unknown: "Unknown price",
}

export function priceTier(
  input: number | null | undefined,
  output: number | null | undefined
): PriceTier {
  const known = (value: number | null | undefined): value is number =>
    value != null && Number.isFinite(Number(value)) && Number(value) >= 0
  if (
    (known(input) && Number(input) > 0) ||
    (known(output) && Number(output) > 0)
  ) {
    return "paid"
  }
  if (known(input) && known(output)) return "free"
  return "unknown"
}

export function countByTier<T>(
  items: T[],
  tierOf: (item: T) => PriceTier
): Record<PriceTier, number> {
  const counts: Record<PriceTier, number> = { free: 0, paid: 0, unknown: 0 }
  for (const item of items) counts[tierOf(item)]++
  return counts
}
