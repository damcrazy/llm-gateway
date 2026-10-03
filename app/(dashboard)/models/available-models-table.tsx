"use client"

import { Fragment, useMemo, useState } from "react"
import { LockIcon, SearchIcon, ServerIcon } from "lucide-react"

import { CopyButton } from "@/components/animate-ui/components/buttons/copy"
import { ModelPrice } from "@/components/model-price"
import {
  ModelSourceFilter,
  ownFirst,
  type ModelSource,
} from "@/components/model-source-filter"
import {
  PriceTierFilter,
  type PriceTierFilterValue,
} from "@/components/price-tier-filter"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
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
import type { Capability } from "@/lib/providers/catalog"
import { countByTier, priceTier } from "@/lib/pricing"

import { CapabilityBadges } from "./model-controls"
import { formatTokens } from "./shared"
import type { ModelKind } from "@/lib/db/types"

export interface AvailableModel {
  /** From one of the member's own providers. */
  own: boolean
  /** Provider name, for the provider filter. */
  provider: string
  slug: string
  displayName: string | null
  kind: ModelKind
  capabilities: Capability[]
  contextWindow: number | null
  inputPrice: number | null
  outputPrice: number | null
}

const ALL_PROVIDERS = "__all"
const COLUMNS = 5

const tierOf = (model: AvailableModel) =>
  priceTier(model.inputPrice, model.outputPrice)

/**
 * Searchable list of the models a member may call. Models from their own
 * providers come first; filter by source, provider and price.
 */
export function AvailableModelsTable({ models }: { models: AvailableModel[] }) {
  const [search, setSearch] = useState("")
  const [source, setSource] = useState<ModelSource>("all")
  const [provider, setProvider] = useState(ALL_PROVIDERS)
  const [tier, setTier] = useState<PriceTierFilterValue>("all")

  const sorted = useMemo(() => [...models].sort(ownFirst), [models])
  const hasOwn = sorted.some((model) => model.own)

  const providers = useMemo(() => {
    const counts = new Map<string, { own: boolean; count: number }>()
    for (const model of sorted) {
      const entry = counts.get(model.provider) ?? { own: model.own, count: 0 }
      entry.count += 1
      counts.set(model.provider, entry)
    }
    const list = [...counts.entries()]
      .map(([name, entry]) => ({ name, ...entry }))
      .sort((a, b) => a.name.localeCompare(b.name))
    return {
      own: list.filter((p) => p.own),
      shared: list.filter((p) => !p.own),
    }
  }, [sorted])

  const searched = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return sorted
    return sorted.filter((model) =>
      `${model.slug} ${model.displayName ?? ""} ${model.provider}`
        .toLowerCase()
        .includes(query)
    )
  }, [sorted, search])

  // Price counts follow the source and provider filters.
  const scoped = useMemo(
    () =>
      searched.filter(
        (model) =>
          (source === "all" || model.own === (source === "own")) &&
          (provider === ALL_PROVIDERS || model.provider === provider)
      ),
    [searched, source, provider]
  )
  const visible = useMemo(
    () => (tier === "all" ? scoped : scoped.filter((m) => tierOf(m) === tier)),
    [scoped, tier]
  )
  const ownCount = visible.filter((model) => model.own).length
  const grouped = ownCount > 0 && ownCount < visible.length

  return (
    <div className="grid gap-3">
      <div
        data-tour="models-member-filters"
        className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center"
      >
        <InputGroup className="sm:w-64">
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            placeholder="Search models"
            aria-label="Search models"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </InputGroup>
        {hasOwn && (
          <div data-tour="models-source" className="w-fit">
            <ModelSourceFilter
              value={source}
              onChange={(next) => {
                setSource(next)
                setProvider(ALL_PROVIDERS)
              }}
              counts={{
                own: searched.filter((model) => model.own).length,
                shared: searched.filter((model) => !model.own).length,
              }}
            />
          </div>
        )}
        <Select value={provider} onValueChange={setProvider}>
          <SelectTrigger
            className="w-full sm:w-52"
            aria-label="Filter by provider"
          >
            <ServerIcon className="text-muted-foreground" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent position="popper" className="max-h-80">
            <SelectItem value={ALL_PROVIDERS}>All providers</SelectItem>
            {source !== "shared" && providers.own.length > 0 && (
              <>
                <SelectSeparator />
                <SelectGroup>
                  <SelectLabel>Your providers</SelectLabel>
                  {providers.own.map((p) => (
                    <SelectItem key={p.name} value={p.name}>
                      {p.name}
                      <span className="ml-auto text-muted-foreground tabular-nums">
                        {p.count}
                      </span>
                    </SelectItem>
                  ))}
                </SelectGroup>
              </>
            )}
            {source !== "own" && providers.shared.length > 0 && (
              <>
                <SelectSeparator />
                <SelectGroup>
                  <SelectLabel>Shared</SelectLabel>
                  {providers.shared.map((p) => (
                    <SelectItem key={p.name} value={p.name}>
                      {p.name}
                      <span className="ml-auto text-muted-foreground tabular-nums">
                        {p.count}
                      </span>
                    </SelectItem>
                  ))}
                </SelectGroup>
              </>
            )}
          </SelectContent>
        </Select>
        <div data-tour="models-price-tiers" className="w-fit">
          <PriceTierFilter
            value={tier}
            onChange={setTier}
            counts={countByTier(scoped, tierOf)}
          />
        </div>
      </div>
      <Card className="py-0">
        <CardContent className="px-0">
          <Table>
            <TableHeader data-tour="models-member-columns">
              <TableRow>
                <TableHead className="pl-6">Model</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Capabilities</TableHead>
                <TableHead className="text-right">Context</TableHead>
                <TableHead className="pr-6 text-right">$/1M in / out</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((model, index) => {
                const startsGroup =
                  grouped &&
                  (index === 0 || visible[index - 1]!.own !== model.own)
                return (
                  <Fragment key={model.slug}>
                    {startsGroup && (
                      <GroupRow
                        own={model.own}
                        count={model.own ? ownCount : visible.length - ownCount}
                      />
                    )}
                    <TableRow>
                      <TableCell className="pl-6">
                        <div className="flex items-center gap-1">
                          <span className="font-mono text-sm font-medium">
                            {model.slug}
                          </span>
                          <CopyButton
                            content={model.slug}
                            variant="ghost"
                            size="xs"
                            aria-label={`Copy ${model.slug}`}
                          />
                          {model.own && (
                            <Badge variant="secondary" className="font-normal">
                              Your provider
                            </Badge>
                          )}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {model.displayName
                            ? `${model.displayName} · ${model.provider}`
                            : model.provider}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted-foreground capitalize">
                        {model.kind}
                      </TableCell>
                      <TableCell>
                        <div className="min-w-40">
                          <CapabilityBadges capabilities={model.capabilities} />
                        </div>
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatTokens(model.contextWindow)}
                      </TableCell>
                      <TableCell className="pr-6 text-right">
                        <ModelPrice
                          input={model.inputPrice}
                          output={model.outputPrice}
                        />
                      </TableCell>
                    </TableRow>
                  </Fragment>
                )
              })}
              {visible.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={COLUMNS}
                    className="py-8 text-center text-muted-foreground"
                  >
                    No models match.
                  </TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </div>
  )
}

/** Section heading inside the table: "Your providers" / "Shared". */
function GroupRow({ own, count }: { own: boolean; count: number }) {
  return (
    <TableRow className="bg-muted/40 hover:bg-muted/40">
      <TableCell
        colSpan={COLUMNS}
        className="py-2 pl-6 text-xs font-medium text-muted-foreground"
      >
        <span className="inline-flex items-center gap-1.5">
          {own ? (
            <LockIcon className="size-3.5" />
          ) : (
            <ServerIcon className="size-3.5" />
          )}
          {own
            ? "Your providers: only your apps can use these"
            : "Shared by the gateway"}
          <span className="tabular-nums">· {count}</span>
        </span>
      </TableCell>
    </TableRow>
  )
}
