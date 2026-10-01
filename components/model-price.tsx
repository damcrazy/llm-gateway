import { Badge } from "@/components/ui/badge"
import { formatPrice } from "@/lib/format"
import { priceTier } from "@/lib/pricing"

/** "$1 / $5", a Free badge, or "Unknown" for a model's per-1M-token prices. */
export function ModelPrice({
  input,
  output,
}: {
  input: number | null | undefined
  output: number | null | undefined
}) {
  const tier = priceTier(input, output)
  if (tier === "free") {
    return (
      <Badge
        variant="outline"
        className="border-emerald-600/40 text-emerald-700 dark:border-emerald-400/40 dark:text-emerald-400"
      >
        Free
      </Badge>
    )
  }
  if (tier === "unknown") {
    return (
      <span
        className="text-muted-foreground"
        title="No price information. Set it with Edit."
      >
        Unknown
      </span>
    )
  }
  return (
    <span className="tabular-nums">
      {formatPrice(input)}
      <span className="text-muted-foreground"> / </span>
      {formatPrice(output)}
    </span>
  )
}
