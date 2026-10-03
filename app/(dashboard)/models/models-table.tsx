"use client"

import { useMemo, useState, useTransition } from "react"
import Link from "next/link"
import {
  PowerIcon,
  PowerOffIcon,
  SearchIcon,
  SearchXIcon,
  XIcon,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/animate-ui/components/buttons/button"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/animate-ui/components/radix/alert-dialog"
import { ModelPrice } from "@/components/model-price"
import {
  PriceTierFilter,
  type PriceTierFilterValue,
} from "@/components/price-tier-filter"
import { Card, CardContent } from "@/components/ui/card"
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { countByTier, priceTier, PRICE_TIER_LABELS } from "@/lib/pricing"
import { CAPABILITIES, CAPABILITY_LABELS } from "@/lib/providers/catalog"

import {
  CapabilityBadges,
  HealthBadge,
  ModelEnabledSwitch,
  ModelRowActions,
  TagBadges,
  TestModelButton,
} from "./model-controls"
import { setModelsEnabled } from "./actions"
import { formatTokens, type ModelListItem } from "./shared"

const ALL = "all"

interface Filters {
  tier: PriceTierFilterValue
  search: string
  provider: string
  capability: string
  tag: string
  kind: string
}

const EMPTY_FILTERS: Filters = {
  tier: ALL,
  search: "",
  provider: ALL,
  capability: ALL,
  tag: ALL,
  kind: ALL,
}

const tierOf = (model: ModelListItem) =>
  priceTier(model.inputPrice, model.outputPrice)

function matches(model: ModelListItem, filters: Filters): boolean {
  if (filters.tier !== ALL && tierOf(model) !== filters.tier) return false
  if (filters.provider !== ALL && model.providerId !== filters.provider)
    return false
  if (filters.kind !== ALL && model.kind !== filters.kind) return false
  if (
    filters.capability !== ALL &&
    !model.capabilities.includes(
      filters.capability as ModelListItem["capabilities"][number]
    )
  ) {
    return false
  }
  if (filters.tag !== ALL && !model.tags.includes(filters.tag)) return false
  const query = filters.search.trim().toLowerCase()
  if (!query) return true
  return [
    model.slug,
    model.modelId,
    model.displayName ?? "",
    model.providerName,
    ...model.tags,
  ]
    .join(" ")
    .toLowerCase()
    .includes(query)
}

/**
 * Models with client-side filters (the /models page, and one provider's
 * models when `providerScoped`), plus bulk enable/disable of what's shown.
 */
export function ModelsExplorer({
  models,
  providers,
  providerScoped = false,
}: {
  models: ModelListItem[]
  providers: { id: string; name: string }[]
  providerScoped?: boolean
}) {
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS)
  const tags = useMemo(
    () => [...new Set(models.flatMap((model) => model.tags))].sort(),
    [models]
  )
  const visible = useMemo(
    () => models.filter((model) => matches(model, filters)),
    [models, filters]
  )
  // Tier counts respect every other filter, so they match what you'd see.
  const tierCounts = useMemo(
    () =>
      countByTier(
        models.filter((model) => matches(model, { ...filters, tier: ALL })),
        tierOf
      ),
    [models, filters]
  )
  const filtered =
    filters.tier !== ALL ||
    filters.search.trim() !== "" ||
    filters.provider !== ALL ||
    filters.capability !== ALL ||
    filters.tag !== ALL ||
    filters.kind !== ALL

  function set<K extends keyof Filters>(key: K, value: Filters[K]) {
    setFilters((current) => ({ ...current, [key]: value }))
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <InputGroup className="sm:w-64">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            placeholder="Search models"
            aria-label="Search models"
            value={filters.search}
            onChange={(event) => set("search", event.target.value)}
          />
        </InputGroup>
        {!providerScoped && (
          <FilterSelect
            label="Provider"
            allLabel="All providers"
            value={filters.provider}
            onChange={(value) => set("provider", value)}
            options={providers.map((provider) => ({
              value: provider.id,
              label: provider.name,
            }))}
          />
        )}
        <FilterSelect
          label="Capability"
          allLabel="Any capability"
          value={filters.capability}
          onChange={(value) => set("capability", value)}
          options={CAPABILITIES.map((capability) => ({
            value: capability,
            label: CAPABILITY_LABELS[capability],
          }))}
        />
        <FilterSelect
          label="Tag"
          allLabel="Any tag"
          value={filters.tag}
          onChange={(value) => set("tag", value)}
          options={tags.map((tag) => ({ value: tag, label: tag }))}
        />
        <FilterSelect
          label="Kind"
          allLabel="Chat & embedding"
          value={filters.kind}
          onChange={(value) => set("kind", value)}
          options={[
            { value: "chat", label: "Chat" },
            { value: "embedding", label: "Embedding" },
          ]}
        />
        {filtered && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setFilters(EMPTY_FILTERS)}
          >
            <XIcon />
            Clear
          </Button>
        )}
        <span className="text-sm text-muted-foreground sm:ml-auto">
          {filtered
            ? `${visible.length} of ${models.length} models`
            : `${models.length} model${models.length === 1 ? "" : "s"}`}
        </span>
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center">
        <PriceTierFilter
          value={filters.tier}
          onChange={(value) => set("tier", value)}
          counts={tierCounts}
        />
        <BulkEnableButtons
          models={visible}
          scope={
            filters.tier === ALL
              ? "shown"
              : `${PRICE_TIER_LABELS[filters.tier].toLowerCase()} shown`
          }
        />
      </div>

      {visible.length === 0 ? (
        <Card>
          <CardContent>
            <Empty className="p-6">
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <SearchXIcon />
                </EmptyMedia>
                <EmptyTitle>No models match</EmptyTitle>
                <EmptyDescription>
                  Try a different search or clear the filters.
                </EmptyDescription>
              </EmptyHeader>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setFilters(EMPTY_FILTERS)}
              >
                Clear filters
              </Button>
            </Empty>
          </CardContent>
        </Card>
      ) : (
        <ModelsTable models={visible} showProvider={!providerScoped} />
      )}
    </div>
  )
}

function FilterSelect({
  label,
  allLabel,
  value,
  options,
  onChange,
}: {
  label: string
  allLabel: string
  value: string
  options: { value: string; label: string }[]
  onChange: (value: string) => void
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger aria-label={label} className="w-full sm:w-44">
        <SelectValue />
      </SelectTrigger>
      <SelectContent position="popper" align="start">
        <SelectItem value={ALL}>{allLabel}</SelectItem>
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}

/** The models table. `showProvider` adds the provider and tags columns. */
export function ModelsTable({
  models,
  showProvider = false,
}: {
  models: ModelListItem[]
  showProvider?: boolean
}) {
  return (
    <Card className="py-0">
      <CardContent className="px-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-6">Model</TableHead>
              {showProvider && <TableHead>Provider</TableHead>}
              <TableHead>Kind</TableHead>
              <TableHead>Capabilities</TableHead>
              {showProvider && <TableHead>Tags</TableHead>}
              <TableHead className="text-right">Context</TableHead>
              <TableHead className="text-right">$/1M in / out</TableHead>
              <TableHead>Health</TableHead>
              <TableHead>Enabled</TableHead>
              <TableHead className="pr-6">
                <span className="sr-only">Actions</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {models.map((model) => (
              <TableRow key={model.id}>
                <TableCell className="pl-6">
                  <div className="font-mono text-sm font-medium">
                    {model.slug}
                  </div>
                  {model.displayName && (
                    <div className="text-xs text-muted-foreground">
                      {model.displayName}
                    </div>
                  )}
                  {model.quotaUsed && <QuotaLine model={model} />}
                </TableCell>
                {showProvider && (
                  <TableCell>
                    <Link
                      href={`/providers/${model.providerId}`}
                      className="underline-offset-4 hover:underline"
                    >
                      {model.providerName}
                    </Link>
                    {!model.providerEnabled && (
                      <div className="text-xs text-muted-foreground">
                        Provider disabled
                      </div>
                    )}
                  </TableCell>
                )}
                <TableCell className="text-muted-foreground capitalize">
                  {model.kind}
                </TableCell>
                <TableCell>
                  <div className="min-w-40">
                    <CapabilityBadges capabilities={model.capabilities} />
                  </div>
                </TableCell>
                {showProvider && (
                  <TableCell>
                    <div className="min-w-24">
                      <TagBadges tags={model.tags} />
                    </div>
                  </TableCell>
                )}
                <TableCell className="text-right tabular-nums">
                  {formatTokens(model.contextWindow)}
                </TableCell>
                <TableCell className="text-right">
                  <ModelPrice
                    input={model.inputPrice}
                    output={model.outputPrice}
                  />
                </TableCell>
                <TableCell>
                  <HealthBadge health={model.health} />
                </TableCell>
                <TableCell>
                  <ModelEnabledSwitch
                    id={model.id}
                    slug={model.slug}
                    enabled={model.enabled}
                  />
                </TableCell>
                <TableCell className="pr-6">
                  <div className="flex items-center justify-end gap-1">
                    {!showProvider && (
                      <TestModelButton id={model.id} slug={model.slug} />
                    )}
                    <ModelRowActions model={model} />
                  </div>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

/** "Enable 26" / "Disable 435" for the models currently shown. */
function BulkEnableButtons({
  models,
  scope,
}: {
  models: ModelListItem[]
  scope: string
}) {
  const toEnable = models.filter((model) => !model.enabled)
  const toDisable = models.filter((model) => model.enabled)

  return (
    <div className="flex flex-wrap gap-2 sm:ml-auto">
      <BulkAction
        enable
        models={toEnable}
        label={`Enable ${toEnable.length} ${scope}`}
      />
      <BulkAction
        enable={false}
        models={toDisable}
        label={`Disable ${toDisable.length} ${scope}`}
      />
    </div>
  )
}

function BulkAction({
  enable,
  models,
  label,
}: {
  enable: boolean
  models: ModelListItem[]
  label: string
}) {
  const [open, setOpen] = useState(false)
  const [pending, startTransition] = useTransition()
  const count = models.length

  function run() {
    startTransition(async () => {
      const result = await setModelsEnabled(
        models.map((model) => model.id),
        enable
      )
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(result.message)
      setOpen(false)
    })
  }

  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger asChild>
        <Button variant="outline" size="sm" disabled={count === 0 || pending}>
          {enable ? <PowerIcon /> : <PowerOffIcon />}
          {label}
        </Button>
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {enable ? "Enable" : "Disable"} {count} model
            {count === 1 ? "" : "s"}?
          </AlertDialogTitle>
          <AlertDialogDescription>
            {enable
              ? "Enabled models can serve requests through routes and direct slugs."
              : "Disabled models are skipped by every route and can't be called directly."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            disabled={pending}
            onClick={(event) => {
              event.preventDefault()
              run()
            }}
          >
            {enable ? "Enable" : "Disable"} {count}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

/** "Quota 3/15 a min · 340/1,500 today", amber once a cap is reached. */
function QuotaLine({ model }: { model: ModelListItem }) {
  const used = model.quotaUsed
  if (!used) return null
  const parts: { text: string; full: boolean }[] = []
  if (model.quotaRpm)
    parts.push({
      text: `${used.minute}/${model.quotaRpm.toLocaleString()} a min`,
      full: used.minute >= model.quotaRpm,
    })
  if (model.quotaRpd)
    parts.push({
      text: `${used.day.toLocaleString()}/${model.quotaRpd.toLocaleString()} today`,
      full: used.day >= model.quotaRpd,
    })
  const full = parts.some((part) => part.full)
  return (
    <div
      className={
        full
          ? "text-xs font-medium text-amber-700 dark:text-amber-400"
          : "text-xs text-muted-foreground"
      }
    >
      Quota {parts.map((part) => part.text).join(" · ")}
      {full && " · skipped until it resets"}
    </div>
  )
}
