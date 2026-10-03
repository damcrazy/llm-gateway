"use client"

import { useMemo, useState, useTransition } from "react"
import Link from "next/link"
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CpuIcon,
  PlusIcon,
  SnowflakeIcon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/animate-ui/components/buttons/button"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/animate-ui/components/radix/popover"
import { Progress } from "@/components/animate-ui/components/radix/progress"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemGroup,
  ItemMedia,
  ItemTitle,
} from "@/components/ui/item"
import { Spinner } from "@/components/ui/spinner"
import type { RouteKind, RouteStrategy } from "@/lib/db/types"
import { formatPrice } from "@/lib/format"
import { priceTier } from "@/lib/pricing"
import {
  CAPABILITIES,
  CAPABILITY_LABELS,
  type Capability,
} from "@/lib/providers/catalog"
import { cn } from "@/lib/utils"

import { setRouteTargets } from "../actions"
import { MAX_ROUTE_TARGETS, type TargetModel } from "../shared"

function capabilityLabel(capability: string) {
  return CAPABILITY_LABELS[capability as Capability] ?? capability
}

function priceLine(model: TargetModel) {
  const tier = priceTier(model.inputPrice, model.outputPrice)
  if (tier === "free") return "Free"
  if (tier === "unknown") return "Price unknown"
  return `${formatPrice(model.inputPrice)} in / ${formatPrice(model.outputPrice)} out per 1M`
}

export function RouteTargetsEditor({
  routeId,
  routeKind,
  strategy,
  maxAttempts,
  models,
  initialTargetIds,
}: {
  routeId: string
  routeKind: RouteKind
  strategy: RouteStrategy
  maxAttempts: number
  models: TargetModel[]
  initialTargetIds: string[]
}) {
  const [targetIds, setTargetIds] = useState(initialTargetIds)
  const [savedIds, setSavedIds] = useState(initialTargetIds)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [pending, startTransition] = useTransition()

  const modelById = useMemo(
    () => new Map(models.map((model) => [model.id, model])),
    [models]
  )
  const targets = targetIds
    .map((id) => modelById.get(id))
    .filter((model): model is TargetModel => model !== undefined)
  const dirty = targetIds.join(",") !== savedIds.join(",")

  const candidateGroups = useMemo(() => {
    const groups = new Map<string, TargetModel[]>()
    for (const model of models) {
      if (
        !model.enabled ||
        model.kind !== routeKind ||
        targetIds.includes(model.id)
      )
        continue
      const list = groups.get(model.providerName) ?? []
      list.push(model)
      groups.set(model.providerName, list)
    }
    return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
  }, [models, routeKind, targetIds])

  function move(index: number, delta: -1 | 1) {
    setTargetIds((current) => {
      const next = [...current]
      const [moved] = next.splice(index, 1)
      next.splice(index + delta, 0, moved)
      return next
    })
  }

  function remove(id: string) {
    setTargetIds((current) => current.filter((targetId) => targetId !== id))
  }

  function add(id: string) {
    if (targetIds.length >= MAX_ROUTE_TARGETS) {
      toast.error(`A route can have at most ${MAX_ROUTE_TARGETS} targets`)
      return
    }
    setTargetIds((current) =>
      current.includes(id) ? current : [...current, id]
    )
    setPickerOpen(false)
  }

  function save() {
    const submitted = targetIds
    startTransition(async () => {
      const result = await setRouteTargets(routeId, submitted)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      setSavedIds(submitted)
      toast.success(result.message)
    })
  }

  const orderHint =
    strategy === "round_robin"
      ? "The starting target rotates on every request; the rest follow in this order as fallbacks."
      : "Tried top to bottom. Later targets are used when earlier ones fail, are cooling down, or lack a capability the request needs."

  return (
    <div className="grid min-w-0 gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Targets</CardTitle>
          <CardDescription>
            {orderHint} Up to {maxAttempts} attempt
            {maxAttempts === 1 ? "" : "s"} per request.
          </CardDescription>
          <CardAction>
            <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
              <PopoverTrigger asChild>
                <Button variant="outline" size="sm" disabled={pending}>
                  <PlusIcon />
                  Add model
                </Button>
              </PopoverTrigger>
              <PopoverContent
                align="end"
                className="w-80 max-w-[calc(100vw-2rem)] p-0"
              >
                <Command>
                  <CommandInput placeholder="Search models…" />
                  <CommandList>
                    <CommandEmpty>
                      {candidateGroups.length ? (
                        "No models match."
                      ) : (
                        <span className="text-muted-foreground">
                          No other enabled {routeKind} models.{" "}
                          <Link
                            href="/models"
                            className="underline underline-offset-4"
                          >
                            Add models
                          </Link>
                        </span>
                      )}
                    </CommandEmpty>
                    {candidateGroups.map(([providerName, list]) => (
                      <CommandGroup key={providerName} heading={providerName}>
                        {list.map((model) => (
                          <CommandItem
                            key={model.id}
                            value={model.slug}
                            keywords={[
                              model.displayName ?? "",
                              model.providerName,
                            ].filter(Boolean)}
                            onSelect={() => add(model.id)}
                          >
                            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                              <span className="truncate font-mono text-xs">
                                {model.slug}
                              </span>
                              <span className="truncate text-xs text-muted-foreground">
                                {priceLine(model)}
                                {model.coolingDown && " · cooling down"}
                                {!model.providerEnabled &&
                                  " · provider disabled"}
                              </span>
                            </div>
                          </CommandItem>
                        ))}
                      </CommandGroup>
                    ))}
                  </CommandList>
                </Command>
              </PopoverContent>
            </Popover>
          </CardAction>
        </CardHeader>
        <CardContent>
          {targets.length === 0 ? (
            <Empty className="border p-8">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <CpuIcon />
                </EmptyMedia>
                <EmptyTitle>No targets</EmptyTitle>
                <EmptyDescription>
                  Requests to this route fail until you add at least one model.
                  Add a few so the gateway has something to fall back to.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <ItemGroup className="gap-2">
              {targets.map((model, index) => (
                <TargetItem
                  key={model.id}
                  model={model}
                  index={index}
                  isLast={index === targets.length - 1}
                  routeKind={routeKind}
                  disabled={pending}
                  onMove={(delta) => move(index, delta)}
                  onRemove={() => remove(model.id)}
                />
              ))}
            </ItemGroup>
          )}
        </CardContent>
        {dirty && (
          <CardFooter className="flex-wrap justify-between gap-2 border-t">
            <span className="text-sm text-muted-foreground">
              Unsaved changes
            </span>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                disabled={pending}
                onClick={() => setTargetIds(savedIds)}
              >
                Discard
              </Button>
              <Button disabled={pending} onClick={save}>
                {pending && <Spinner />}
                Save targets
              </Button>
            </div>
          </CardFooter>
        )}
      </Card>

      {routeKind === "chat" && <CapabilityCoverage targets={targets} />}
    </div>
  )
}

function TargetItem({
  model,
  index,
  isLast,
  routeKind,
  disabled,
  onMove,
  onRemove,
}: {
  model: TargetModel
  index: number
  isLast: boolean
  routeKind: RouteKind
  disabled: boolean
  onMove: (delta: -1 | 1) => void
  onRemove: () => void
}) {
  const unusable =
    !model.enabled || !model.providerEnabled || model.kind !== routeKind

  return (
    <Item
      variant="outline"
      size="sm"
      role="listitem"
      className={cn(unusable && "opacity-70")}
    >
      <ItemMedia>
        <span className="flex size-7 items-center justify-center rounded-md bg-muted font-mono text-xs font-medium tabular-nums">
          {index + 1}
        </span>
      </ItemMedia>
      <ItemContent className="min-w-0">
        <ItemTitle className="max-w-full font-mono">
          <span className="min-w-0 truncate" title={model.slug}>
            {model.slug}
          </span>
        </ItemTitle>
        <ItemDescription className="line-clamp-1">
          {model.providerName} · {priceLine(model)}
        </ItemDescription>
        <div className="flex flex-wrap items-center gap-1 pt-0.5">
          {model.coolingDown ? (
            <Badge variant="destructive">
              <SnowflakeIcon />
              Cooling down
              {model.cooldownLabel ? ` · ends ${model.cooldownLabel}` : ""}
            </Badge>
          ) : (
            <Badge variant="outline">
              <span
                className="size-1.5 rounded-full bg-emerald-500"
                aria-hidden
              />
              Healthy
            </Badge>
          )}
          {model.kind !== routeKind && (
            <Badge variant="destructive">Not a {routeKind} model</Badge>
          )}
          {!model.enabled && <Badge variant="secondary">Model disabled</Badge>}
          {!model.providerEnabled && (
            <Badge variant="secondary">Provider disabled</Badge>
          )}
          {model.capabilities.map((capability) => (
            <Badge key={capability} variant="secondary">
              {capabilityLabel(capability)}
            </Badge>
          ))}
        </div>
        {model.coolingDown && model.lastError && (
          <p
            className="line-clamp-1 text-xs text-destructive"
            title={model.lastError}
          >
            {model.lastError}
          </p>
        )}
      </ItemContent>
      <ItemActions className="gap-1">
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={disabled || index === 0}
          onClick={() => onMove(-1)}
          aria-label={`Move ${model.slug} up`}
        >
          <ArrowUpIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={disabled || isLast}
          onClick={() => onMove(1)}
          aria-label={`Move ${model.slug} down`}
        >
          <ArrowDownIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={disabled}
          onClick={onRemove}
          aria-label={`Remove ${model.slug}`}
        >
          <XIcon />
        </Button>
      </ItemActions>
    </Item>
  )
}

function CapabilityCoverage({ targets }: { targets: TargetModel[] }) {
  const total = targets.length

  return (
    <Card>
      <CardHeader>
        <CardTitle>Capability coverage</CardTitle>
        <CardDescription>
          Requests that need a capability (images, tools, structured output…)
          only go to targets that support it, so they have fewer fallbacks.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {total === 0 ? (
          <p className="text-sm text-muted-foreground">
            Add targets to see coverage.
          </p>
        ) : (
          <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
            {CAPABILITIES.map((capability) => {
              const count = targets.filter((target) =>
                target.capabilities.includes(capability)
              ).length
              return (
                <div key={capability} className="grid gap-1.5">
                  <div className="flex items-center justify-between gap-2 text-sm">
                    <span>{CAPABILITY_LABELS[capability]}</span>
                    <span
                      className={cn(
                        "font-mono text-xs tabular-nums",
                        count === 0
                          ? "text-destructive"
                          : count < total
                            ? "text-amber-600 dark:text-amber-400"
                            : "text-muted-foreground"
                      )}
                    >
                      {count}/{total}
                    </span>
                  </div>
                  <Progress
                    value={(count / total) * 100}
                    className="h-1.5"
                    aria-label={`${CAPABILITY_LABELS[capability]}: ${count} of ${total} targets`}
                  />
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
