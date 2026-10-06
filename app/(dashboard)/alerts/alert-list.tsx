"use client"

import Link from "next/link"
import { useTransition } from "react"
import {
  BellIcon,
  CheckCheckIcon,
  CircleAlertIcon,
  InfoIcon,
  OctagonAlertIcon,
} from "lucide-react"
import { toast } from "sonner"

import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import { Spinner } from "@/components/ui/spinner"
import { useTimeZone } from "@/components/time-zone"
import { formatDateTime, formatRelative } from "@/lib/format"
import { cn } from "@/lib/utils"

import { markAlertsRead } from "./actions"
import { KIND_LABELS, type AlertItem, type AlertSeverity } from "./shared"

const SEVERITY_ICON: Record<AlertSeverity, typeof InfoIcon> = {
  info: InfoIcon,
  warning: CircleAlertIcon,
  critical: OctagonAlertIcon,
}

const SEVERITY_TONE: Record<AlertSeverity, string> = {
  info: "text-muted-foreground",
  warning: "text-amber-600 dark:text-amber-400",
  critical: "text-destructive",
}

export function AlertIcon({ severity }: { severity: AlertSeverity }) {
  const Icon = SEVERITY_ICON[severity]
  return <Icon className={SEVERITY_TONE[severity]} aria-label={severity} />
}

export function MarkAllReadButton({ disabled }: { disabled: boolean }) {
  const [pending, startTransition] = useTransition()
  return (
    <Button
      data-tour="alerts-mark-read"
      variant="outline"
      size="sm"
      disabled={disabled || pending}
      onClick={() =>
        startTransition(async () => {
          const result = await markAlertsRead()
          if (!result.ok) toast.error(result.error)
        })
      }
    >
      {pending ? <Spinner /> : <CheckCheckIcon />}
      Mark all as read
    </Button>
  )
}

export function AlertList({
  alerts,
  appNames,
}: {
  alerts: AlertItem[]
  appNames: Record<string, string>
}) {
  const timeZone = useTimeZone()
  if (!alerts.length) {
    return (
      <Empty className="border border-dashed">
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <BellIcon />
          </EmptyMedia>
          <EmptyTitle>No alerts yet</EmptyTitle>
          <EmptyDescription>
            Budget, failing-model and slow-response alerts will show up here.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    )
  }
  return (
    <ItemGroup className="gap-2">
      {alerts.map((alert) => (
        <Item
          key={alert.id}
          variant="outline"
          className={cn(!alert.read && "border-primary/40 bg-primary/[0.03]")}
        >
          <ItemMedia variant="icon">
            <AlertIcon severity={alert.severity} />
          </ItemMedia>
          <ItemContent className="min-w-0">
            <ItemTitle className="flex flex-wrap items-center gap-2">
              {alert.title}
              {!alert.read && <Badge className="font-normal">New</Badge>}
            </ItemTitle>
            <ItemDescription className="line-clamp-none">
              {alert.body}
            </ItemDescription>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              <time
                dateTime={alert.createdAt}
                title={formatDateTime(alert.createdAt, timeZone)}
              >
                {formatRelative(alert.createdAt)}
              </time>
              <span>{KIND_LABELS[alert.kind]}</span>
              {alert.appId && appNames[alert.appId] && (
                <Link
                  href={`/apps/${alert.appId}`}
                  className="underline-offset-4 hover:underline"
                >
                  {appNames[alert.appId]}
                </Link>
              )}
              {alert.delivery === "sent" && <span>Sent to webhook</span>}
              {alert.delivery && alert.delivery !== "sent" && (
                <span className="text-destructive">
                  Webhook failed: {alert.delivery}
                </span>
              )}
            </div>
          </ItemContent>
        </Item>
      ))}
    </ItemGroup>
  )
}
