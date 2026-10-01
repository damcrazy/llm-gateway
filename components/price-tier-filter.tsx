"use client"

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { PRICE_TIERS, PRICE_TIER_LABELS, type PriceTier } from "@/lib/pricing"

export type PriceTierFilterValue = PriceTier | "all"

/** All / Free / Paid / Unknown segmented filter with counts. */
export function PriceTierFilter({
  value,
  onChange,
  counts,
}: {
  value: PriceTierFilterValue
  onChange: (value: PriceTierFilterValue) => void
  counts: Record<PriceTier, number>
}) {
  const total = counts.free + counts.paid + counts.unknown
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      value={value}
      onValueChange={(next) => next && onChange(next as PriceTierFilterValue)}
      aria-label="Filter by price"
    >
      <ToggleGroupItem value="all" className="px-3">
        All <span className="text-muted-foreground tabular-nums">{total}</span>
      </ToggleGroupItem>
      {PRICE_TIERS.map((tier) => (
        <ToggleGroupItem
          key={tier}
          value={tier}
          className="px-3"
          disabled={counts[tier] === 0}
        >
          {tier === "unknown" ? "Unknown" : PRICE_TIER_LABELS[tier]}{" "}
          <span className="text-muted-foreground tabular-nums">
            {counts[tier]}
          </span>
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
