import Link from "next/link"
import {
  BoxesIcon,
  CircleCheckIcon,
  CpuIcon,
  RouteIcon,
  ServerIcon,
  SnowflakeIcon,
  TimerIcon,
} from "lucide-react"

import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Item,
  ItemContent,
  ItemDescription,
  ItemFooter,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import { formatNumber } from "@/lib/format"
import { cn } from "@/lib/utils"

import type { CoolingModel, Inventory } from "./data"

const INVENTORY = [
  {
    key: "providers",
    label: "Providers",
    href: "/providers",
    icon: ServerIcon,
  },
  { key: "models", label: "Models", href: "/models", icon: CpuIcon },
  { key: "routes", label: "Routes", href: "/routes", icon: RouteIcon },
  { key: "apps", label: "Apps", href: "/apps", icon: BoxesIcon },
] as const

function formatRemaining(seconds: number): string {
  if (seconds < 60) return "under a minute"
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min`
  const hours = Math.floor(minutes / 60)
  const rest = minutes % 60
  return rest ? `${hours} h ${rest} min` : `${hours} h`
}

export function HealthPanel({
  cooling,
  inventory,
  className,
}: {
  cooling: CoolingModel[]
  inventory: Inventory
  className?: string
}) {
  return (
    <Card className={cn("min-w-0", className)}>
      <CardHeader>
        <CardTitle>Health</CardTitle>
        <CardDescription>
          What&apos;s enabled, and models the circuit breaker has paused.
        </CardDescription>
      </CardHeader>
      <CardContent className="gap-6">
        <div className="grid grid-cols-2 gap-2">
          {INVENTORY.map(({ key, label, href, icon: Icon }) => {
            const { enabled, total } = inventory[key]
            const disabled = total - enabled
            return (
              <Item key={key} asChild variant="outline" size="sm">
                <Link href={href}>
                  <ItemMedia variant="icon" className="text-muted-foreground">
                    <Icon />
                  </ItemMedia>
                  <ItemContent className="min-w-0 gap-0">
                    <ItemTitle className="text-lg font-semibold">
                      {formatNumber(enabled)}
                    </ItemTitle>
                    <ItemDescription className="truncate text-xs">
                      {label}
                      {disabled > 0 && ` · ${disabled} off`}
                    </ItemDescription>
                  </ItemContent>
                </Link>
              </Item>
            )
          })}
        </div>

        <section
          className="flex flex-col gap-3"
          aria-labelledby="cooling-heading"
        >
          <h3
            id="cooling-heading"
            className="flex items-center gap-2 text-sm font-medium"
          >
            <SnowflakeIcon className="size-4 text-muted-foreground" />
            Cooling down
            {cooling.length > 0 && (
              <Badge variant="secondary">{cooling.length}</Badge>
            )}
          </h3>
          {cooling.length === 0 ? (
            <p className="flex items-center gap-2 text-sm text-muted-foreground">
              <CircleCheckIcon className="size-4 text-primary" />
              Every model is accepting traffic.
            </p>
          ) : (
            <ItemGroup className="gap-2">
              {cooling.map((model) => (
                <Item key={model.modelId} variant="muted" size="sm">
                  <ItemContent className="min-w-0">
                    <ItemTitle className="max-w-full">
                      <span className="truncate">{model.name}</span>
                      {model.lastStatus != null && (
                        <Badge variant="destructive">{model.lastStatus}</Badge>
                      )}
                    </ItemTitle>
                    {model.slug && (
                      <p className="truncate font-mono text-xs text-muted-foreground">
                        {model.slug}
                      </p>
                    )}
                    {model.lastError && (
                      <ItemDescription
                        className="break-all"
                        title={model.lastError}
                      >
                        {model.lastError}
                      </ItemDescription>
                    )}
                  </ItemContent>
                  <ItemFooter className="justify-start gap-3 text-xs text-muted-foreground">
                    <span className="inline-flex items-center gap-1">
                      <TimerIcon className="size-3.5" />
                      Back in {formatRemaining(model.remainingSeconds)}
                    </span>
                    <span>
                      {formatNumber(model.consecutiveFailures)} failure
                      {model.consecutiveFailures === 1 ? "" : "s"} in a row
                    </span>
                  </ItemFooter>
                </Item>
              ))}
            </ItemGroup>
          )}
        </section>
      </CardContent>
    </Card>
  )
}
