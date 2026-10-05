"use client"

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"

export type ModelSource = "all" | "own" | "shared"

/**
 * "Personal" (your providers and ones shared with you) / "Gateway" (the
 * gateway's providers) toggles with counts. Neither pressed shows
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
        Personal{" "}
        <span className="text-muted-foreground tabular-nums">{counts.own}</span>
      </ToggleGroupItem>
      <ToggleGroupItem
        value="shared"
        className="px-3"
        disabled={!counts.shared}
      >
        Gateway{" "}
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
