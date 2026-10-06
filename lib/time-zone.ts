// The viewer's time zone. Pages render on the server, which runs in UTC, so
// the browser reports its zone in a cookie (components/time-zone.tsx) and
// dates are formatted in that zone on the server and in the browser alike.

export const TIME_ZONE_COOKIE = "gw-tz"

/** An IANA zone such as "Asia/Kolkata", or null if it isn't one. */
export function validTimeZone(value: string | null | undefined): string | null {
  if (!value || value.length > 64) return null
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value })
    return value
  } catch {
    return null
  }
}
