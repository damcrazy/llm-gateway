"use client"

import { createContext, useContext, useEffect } from "react"
import { useRouter } from "next/navigation"

import { TIME_ZONE_COOKIE } from "@/lib/time-zone"

const TimeZoneContext = createContext("UTC")
const REFRESHED_KEY = "gw-tz-refreshed"

/** The zone dates are shown in: the same one the server used for this page. */
export function useTimeZone(): string {
  return useContext(TimeZoneContext)
}

/**
 * Gives client components the zone the server rendered with, so their dates
 * match it. If the browser's zone differs (the first visit, or after
 * travelling), it's saved in a cookie and the page re-renders in it.
 */
export function TimeZoneProvider({
  timeZone,
  children,
}: {
  timeZone: string
  children: React.ReactNode
}) {
  const router = useRouter()

  useEffect(() => {
    const browserZone = Intl.DateTimeFormat().resolvedOptions().timeZone
    if (!browserZone || browserZone === timeZone) return
    document.cookie = `${TIME_ZONE_COOKIE}=${encodeURIComponent(browserZone)}; path=/; max-age=31536000; samesite=lax`
    // Once per zone and tab: if the cookie doesn't stick (blocked cookies) or
    // the server doesn't know the zone, don't keep reloading.
    try {
      if (sessionStorage.getItem(REFRESHED_KEY) === browserZone) return
      sessionStorage.setItem(REFRESHED_KEY, browserZone)
    } catch {
      return
    }
    router.refresh()
  }, [timeZone, router])

  return (
    <TimeZoneContext.Provider value={timeZone}>
      {children}
    </TimeZoneContext.Provider>
  )
}
