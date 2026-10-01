"use client"

import { useSyncExternalStore } from "react"
import { SunMoonIcon } from "lucide-react"

import { Button } from "@/components/animate-ui/components/buttons/button"
import { ThemeTogglerButton } from "@/components/animate-ui/components/buttons/theme-toggler"

const subscribe = () => () => {}

/**
 * The theme is only known in the browser, so the toggler's icon would differ
 * between server and client HTML and break hydration. Render a same-size
 * placeholder until the component is running on the client.
 */
export function ThemeToggle() {
  const mounted = useSyncExternalStore(
    subscribe,
    () => true,
    () => false
  )

  if (!mounted) {
    return (
      <Button variant="ghost" size="icon-sm" disabled aria-label="Toggle theme">
        <SunMoonIcon />
      </Button>
    )
  }
  return (
    <ThemeTogglerButton variant="ghost" size="sm" aria-label="Toggle theme" />
  )
}
