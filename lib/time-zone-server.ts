import "server-only"

import { cache } from "react"
import { cookies } from "next/headers"

import { TIME_ZONE_COOKIE, validTimeZone } from "@/lib/time-zone"

/** The viewer's time zone from their browser, or UTC until it has reported it. */
export const getTimeZone = cache(async (): Promise<string> => {
  const value = (await cookies()).get(TIME_ZONE_COOKIE)?.value
  return validTimeZone(value ? decodeURIComponent(value) : null) ?? "UTC"
})
