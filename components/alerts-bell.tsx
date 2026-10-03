"use client"

import Link from "next/link"
import { useCallback, useEffect, useState } from "react"
import { BellIcon } from "lucide-react"

import { AlertIcon } from "@/app/(dashboard)/alerts/alert-list"
import { markAlertsRead, recentAlerts } from "@/app/(dashboard)/alerts/actions"
import type { AlertItem } from "@/app/(dashboard)/alerts/shared"
import { Button } from "@/components/animate-ui/components/buttons/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/animate-ui/components/radix/popover"
import { Separator } from "@/components/ui/separator"
import { formatRelative } from "@/lib/format"
import { cn } from "@/lib/utils"

const POLL_MS = 60_000

/** Header bell: unread count, the latest alerts, marks them read on close. */
export function AlertsBell() {
  const [open, setOpen] = useState(false)
  const [unread, setUnread] = useState(0)
  const [items, setItems] = useState<AlertItem[]>([])

  const refresh = useCallback(async () => {
    const result = await recentAlerts().catch(() => null)
    if (result?.ok && result.data) {
      setUnread(result.data.unread)
      setItems(result.data.items)
    }
  }, [])

  useEffect(() => {
    // Initial load and polling; the bell lives in the layout across pages.
    const first = setTimeout(refresh, 0)
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void refresh()
    }, POLL_MS)
    return () => {
      clearTimeout(first)
      clearInterval(timer)
    }
  }, [refresh])

  function onOpenChange(next: boolean) {
    setOpen(next)
    if (next) {
      void refresh()
      return
    }
    const seen = items.filter((item) => !item.read).map((item) => item.id)
    if (!seen.length) return
    setItems((current) =>
      current.map((item) =>
        seen.includes(item.id) ? { ...item, read: true } : item
      )
    )
    setUnread((count) => Math.max(0, count - seen.length))
    void markAlertsRead(seen)
  }

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon-sm"
          className="relative"
          aria-label={unread ? `Alerts, ${unread} unread` : "Alerts"}
        >
          <BellIcon />
          {unread > 0 && (
            <span className="absolute -top-0.5 -right-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] leading-none font-medium text-white tabular-nums">
              {unread > 9 ? "9+" : unread}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-0">
        <div className="flex items-center justify-between px-4 py-3">
          <p className="text-sm font-medium">Alerts</p>
          {unread > 0 && (
            <p className="text-xs text-muted-foreground">{unread} unread</p>
          )}
        </div>
        <Separator />
        {items.length ? (
          <ul className="max-h-96 overflow-y-auto">
            {items.map((item) => (
              <li
                key={item.id}
                className={cn(
                  "flex gap-3 border-b px-4 py-3 last:border-b-0 [&_svg]:mt-0.5 [&_svg]:size-4 [&_svg]:shrink-0",
                  !item.read && "bg-primary/[0.04]"
                )}
              >
                <AlertIcon severity={item.severity} />
                <div className="min-w-0 space-y-0.5">
                  <p className="text-sm leading-snug font-medium">
                    {item.title}
                  </p>
                  <p className="line-clamp-2 text-xs text-muted-foreground">
                    {item.body}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatRelative(item.createdAt)}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">
            No alerts yet.
          </p>
        )}
        <Separator />
        <div className="p-2">
          <Button variant="ghost" size="sm" className="w-full" asChild>
            <Link href="/alerts" onClick={() => onOpenChange(false)}>
              All alerts and settings
            </Link>
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
