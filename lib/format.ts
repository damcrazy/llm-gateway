const compact = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
})
const integer = new Intl.NumberFormat("en-US")

export function formatNumber(value: number | null | undefined): string {
  return integer.format(value ?? 0)
}

export function formatCompact(value: number | null | undefined): string {
  return compact.format(value ?? 0)
}

export function formatUsd(value: number | null | undefined): string {
  const amount = Number(value ?? 0)
  const digits = amount !== 0 && Math.abs(amount) < 1 ? 4 : 2
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(amount)
}

/** Price per million tokens, e.g. "$0.15". */
export function formatPrice(value: number | null | undefined): string {
  if (value == null) return "—"
  return `$${Number(value).toLocaleString("en-US", { maximumFractionDigits: 4 })}`
}

export function formatMs(value: number | null | undefined): string {
  if (value == null) return "—"
  return value >= 1000
    ? `${(value / 1000).toFixed(1)}s`
    : `${Math.round(value)}ms`
}

export function formatPercent(value: number): string {
  return `${(value * 100).toFixed(value > 0 && value < 0.01 ? 2 : 1)}%`
}

/** "Oct 6, 11:42 AM" in the viewer's zone (see lib/time-zone.ts). */
export function formatDateTime(
  value: string | Date | null | undefined,
  timeZone: string
): string {
  if (!value) return "—"
  return new Date(value).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    timeZone,
  })
}

const relative = new Intl.RelativeTimeFormat("en", { numeric: "auto" })

export function formatRelative(
  value: string | Date | null | undefined
): string {
  if (!value) return "never"
  const seconds = (new Date(value).getTime() - Date.now()) / 1000
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31536000],
    ["month", 2592000],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ]
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size)
      return relative.format(Math.round(seconds / size), unit)
  }
  return "just now"
}
