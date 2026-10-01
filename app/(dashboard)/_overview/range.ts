// Period definitions for the overview page. Pure functions: safe to import
// from both the server page and the client switcher.

const HOUR = 60 * 60 * 1000
const DAY = 24 * HOUR

export type BucketInterval = "hour" | "day"

export const RANGES = {
  "24h": {
    label: "24h",
    long: "Last 24 hours",
    previous: "previous 24 hours",
    interval: "hour",
    buckets: 24,
  },
  "7d": {
    label: "7d",
    long: "Last 7 days",
    previous: "previous 7 days",
    interval: "day",
    buckets: 7,
  },
  "30d": {
    label: "30d",
    long: "Last 30 days",
    previous: "previous 30 days",
    interval: "day",
    buckets: 30,
  },
  "90d": {
    label: "90d",
    long: "Last 90 days",
    previous: "previous 90 days",
    interval: "day",
    buckets: 90,
  },
} as const satisfies Record<
  string,
  {
    label: string
    long: string
    previous: string
    interval: BucketInterval
    buckets: number
  }
>

export type RangeKey = keyof typeof RANGES

export const RANGE_KEYS = Object.keys(RANGES) as RangeKey[]
export const DEFAULT_RANGE: RangeKey = "7d"

export function parseRange(value: string | string[] | undefined): RangeKey {
  const raw = Array.isArray(value) ? value[0] : value
  return raw && raw in RANGES ? (raw as RangeKey) : DEFAULT_RANGE
}

export interface RangeWindow {
  range: RangeKey
  interval: BucketInterval
  /** Start of the first bucket of the current period. */
  since: Date
  /** Start of the previous period of equal length (hour-aligned, like the SQL). */
  prevSince: Date
  /** Start of every bucket in the current period, oldest first (UTC-aligned). */
  bucketStarts: number[]
}

/**
 * The current period is the last N buckets ending with the (partial) current
 * one: 24 hourly buckets, or N UTC days including today. Buckets are aligned
 * the way Postgres' date_trunc aligns them in a UTC session, so every row
 * usage_timeseries returns lands in exactly one bucket.
 *
 * The previous period is the window of the same length immediately before
 * `since`, truncated to the hour (usage_hourly's resolution).
 */
export function getRangeWindow(
  range: RangeKey,
  now: Date = new Date()
): RangeWindow {
  const { interval, buckets } = RANGES[range]
  const step = interval === "hour" ? HOUR : DAY
  const nowMs = now.getTime()
  const since = Math.floor(nowMs / step) * step - (buckets - 1) * step
  const length = nowMs - since
  const prevSince = Math.floor((since - length) / HOUR) * HOUR

  return {
    range,
    interval,
    since: new Date(since),
    prevSince: new Date(prevSince),
    bucketStarts: Array.from({ length: buckets }, (_, i) => since + i * step),
  }
}

/** Index of the bucket a timestamp belongs to, clamped into the window. */
export function bucketIndex(window: RangeWindow, timestamp: string): number {
  const step = window.interval === "hour" ? HOUR : DAY
  const index = Math.floor(
    (new Date(timestamp).getTime() - window.since.getTime()) / step
  )
  return Math.min(Math.max(index, 0), window.bucketStarts.length - 1)
}
