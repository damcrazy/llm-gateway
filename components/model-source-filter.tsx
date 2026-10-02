"use client"

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

export type ModelSource = "all" | "own" | "shared"

/**
 * "Your providers" / "Shared" toggles with counts. Neither pressed shows
 * everything; pressing the active one again clears it.
 */
export function ModelSourceFilter({
  value,
  onChange,
  counts,
}: {
  value: ModelSource
  onChange: (value: ModelSource) => void
  counts: { own: number; shared: number }
}) {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      value={value === "all" ? "" : value}
      onValueChange={(next) => onChange((next || "all") as ModelSource)}
      aria-label="Filter by provider type"
    >
      <ToggleGroupItem value="own" className="px-3" disabled={!counts.own}>
        Your providers{" "}
        <span className="text-muted-foreground tabular-nums">{counts.own}</span>
      </ToggleGroupItem>
      <ToggleGroupItem
        value="shared"
        className="px-3"
        disabled={!counts.shared}
      >
        Shared{" "}
        <span className="text-muted-foreground tabular-nums">
          {counts.shared}
        </span>
      </ToggleGroupItem>
    </ToggleGroup>
  )
}

/** Own models first, then by slug. */
export function ownFirst<T extends { own: boolean; slug: string }>(
  a: T,
  b: T
): number {
  return Number(b.own) - Number(a.own) || a.slug.localeCompare(b.slug)
}
