// Shared by the latency page (server) and its controls (client).

export const LATENCY_RANGES = {
  "1h": { label: "1h", long: "Last hour", ms: 60 * 60 * 1000 },
  "24h": { label: "24h", long: "Last 24 hours", ms: 24 * 60 * 60 * 1000 },
  "7d": { label: "7d", long: "Last 7 days", ms: 7 * 24 * 60 * 60 * 1000 },
} as const

export type LatencyRange = keyof typeof LATENCY_RANGES

export const DEFAULT_LATENCY_RANGE: LatencyRange = "24h"

export function parseLatencyRange(value: string | undefined): LatencyRange {
  return value && value in LATENCY_RANGES
    ? (value as LatencyRange)
    : DEFAULT_LATENCY_RANGE
}

// Provider and gateway are the two series (validated for color-blind
// separation in light and dark); failed attempts are provider time too, so
// they reuse the provider color with a hatch instead of a third hue.
export const PROVIDER_COLOR = "var(--chart-1)"
export const GATEWAY_COLOR = "var(--chart-2)"
export const FAILED_STYLE = {
  backgroundImage: `repeating-linear-gradient(45deg, ${PROVIDER_COLOR} 0 3px, transparent 3px 6px)`,
  boxShadow: `inset 0 0 0 1px ${PROVIDER_COLOR}`,
} as const

export const PHASE_LABELS = {
  auth: {
    label: "Key check",
    help: "Looking up the API key (cached for 30 s).",
  },
  limits: {
    label: "Limits",
    help: "Rate limit and budget checks. An app with a requests-per-minute limit asks the database on every call.",
  },
  cache: {
    label: "Cache lookup",
    help: "Checking the response cache, for apps that use it.",
  },
  prepare: {
    label: "Preparing",
    help: "Reading the request, picking the model and translating formats.",
  },
  retry_wait: {
    label: "Retry waits",
    help: "Pauses before trying a model again.",
  },
  failed: {
    label: "Failed attempts",
    help: "Provider time spent on models that failed before another one answered.",
  },
  post: {
    label: "Finishing",
    help: "After the provider finished, until the response was complete.",
  },
} as const

/** "3.4 ms", "245 ms", "2.46 s". */
export function formatMs(value: number | null | undefined): string {
  if (value == null) return "—"
  if (value < 10) return `${Math.round(value * 10) / 10} ms`
  if (value < 1000) return `${Math.round(value)} ms`
  return `${(value / 1000).toFixed(value < 10_000 ? 2 : 1)} s`
}
