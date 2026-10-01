"use client"

import { createContext, useContext, useOptimistic, useTransition } from "react"
import { useRouter } from "next/navigation"

import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { cn } from "@/lib/utils"

import { DEFAULT_RANGE, RANGE_KEYS, RANGES, type RangeKey } from "./range"

interface RangeContextValue {
  range: RangeKey
  pending: boolean
  setRange: (range: RangeKey) => void
}

const RangeContext = createContext<RangeContextValue | null>(null)

function useRange() {
  const context = useContext(RangeContext)
  if (!context) throw new Error("useRange must be used within <RangeProvider>")
  return context
}

/** Owns the ?range= navigation so the switcher and the body share one transition. */
export function RangeProvider({
  range,
  children,
}: {
  range: RangeKey
  children: React.ReactNode
}) {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  const [optimisticRange, setOptimisticRange] = useOptimistic(range)

  function setRange(next: RangeKey) {
    startTransition(() => {
      setOptimisticRange(next)
      router.replace(next === DEFAULT_RANGE ? "/" : `/?range=${next}`, {
        scroll: false,
      })
    })
  }

  return (
    <RangeContext.Provider
      value={{ range: optimisticRange, pending, setRange }}
    >
      {children}
    </RangeContext.Provider>
  )
}

export function RangeSwitcher() {
  const { range, setRange } = useRange()

  return (
    <ToggleGroup
      type="single"
      variant="outline"
      size="sm"
      spacing={0}
      value={range}
      onValueChange={(value) => {
        if (value && value !== range) setRange(value as RangeKey)
      }}
      aria-label="Time range"
    >
      {RANGE_KEYS.map((key) => (
        <ToggleGroupItem
          key={key}
          value={key}
          aria-label={RANGES[key].long}
          className="px-3"
        >
          {RANGES[key].label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}

/** Keeps the previous render on screen, dimmed, while the new range loads. */
export function RangeBody({ children }: { children: React.ReactNode }) {
  const { pending } = useRange()

  return (
    <div
      aria-busy={pending}
      className={cn(
        "flex min-w-0 flex-col gap-6 transition-opacity duration-200",
        pending && "pointer-events-none opacity-60"
      )}
    >
      {children}
    </div>
  )
}
