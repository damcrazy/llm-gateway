"use client"

import { useMemo, useState } from "react"
import { CheckIcon, GripVerticalIcon, PlusIcon, SearchIcon } from "lucide-react"

import { Button } from "@/components/animate-ui/components/buttons/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/animate-ui/components/radix/dropdown-menu"
import { ModelPrice } from "@/components/model-price"
import {
  ModelSourceFilter,
  type ModelSource,
} from "@/components/model-source-filter"
import {
  PriceTierFilter,
  type PriceTierFilterValue,
} from "@/components/price-tier-filter"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
} from "@/components/ui/input-group"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { formatCompact, formatUsd } from "@/lib/format"
import { countByTier, priceTier } from "@/lib/pricing"

import { MAX_BUCKET_MODELS, MAX_BUCKETS } from "../_lib"
import { CapabilityIcons, StatusDot } from "./buckets-board"
import { MODEL_DRAG_TYPE, type BucketModel } from "./buckets-shared"

interface BucketSummary {
  key: string
  name: string
  modelIds: string[]
}

const tierOf = (model: BucketModel) =>
  priceTier(model.inputPrice, model.outputPrice)

/**
 * Models the app's owner may use, with this app's usage this month. Drag a
 * row onto a bucket, or use "Add to".
 */
export function ModelLibrary({
  models,
  addable,
  buckets,
  onAddModel,
  onCreateBucket,
}: {
  models: BucketModel[]
  addable: string[]
  buckets: BucketSummary[]
  onAddModel: (bucketKey: string, modelId: string) => void
  onCreateBucket: (name: string, modelIds?: string[]) => void
}) {
  const [search, setSearch] = useState("")
  const [tier, setTier] = useState<PriceTierFilterValue>("all")
  const [source, setSource] = useState<ModelSource>("all")

  const library = useMemo(() => {
    const allowed = new Set(addable)
    return models
      .filter((model) => allowed.has(model.id))
      .sort(
        (a, b) =>
          // Your own providers first, then the most used.
          Number(b.own) - Number(a.own) ||
          (b.usage?.requests ?? 0) - (a.usage?.requests ?? 0) ||
          a.slug.localeCompare(b.slug)
      )
  }, [models, addable])
  const hasOwn = library.some((model) => model.own)

  const searched = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return library
    return library.filter((model) =>
      `${model.name} ${model.slug} ${model.provider}`
        .toLowerCase()
        .includes(query)
    )
  }, [library, search])

  const scoped = useMemo(
    () =>
      source === "all"
        ? searched
        : searched.filter((model) => model.own === (source === "own")),
    [searched, source]
  )
  const visible = useMemo(
    () => (tier === "all" ? scoped : scoped.filter((m) => tierOf(m) === tier)),
    [scoped, tier]
  )

  const bucketsByModel = useMemo(() => {
    const map = new Map<string, string[]>()
    for (const bucket of buckets) {
      for (const id of bucket.modelIds) {
        map.set(id, [...(map.get(id) ?? []), bucket.name])
      }
    }
    return map
  }, [buckets])

  return (
    <Card>
      <CardHeader>
        <CardTitle>Models you can use</CardTitle>
        <CardDescription>
          Drag a row onto a bucket, or use Add. Usage is this app&apos;s, for
          the current month.
        </CardDescription>
      </CardHeader>
      <CardContent className="grid gap-3 px-0">
        <div className="flex flex-col gap-2 px-6 sm:flex-row sm:flex-wrap sm:items-center">
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
            <ModelSourceFilter
              value={source}
              onChange={setSource}
              counts={{
                own: searched.filter((model) => model.own).length,
                shared: searched.filter((model) => !model.own).length,
              }}
            />
          )}
          <PriceTierFilter
            value={tier}
            onChange={setTier}
            counts={countByTier(scoped, tierOf)}
          />
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-8 pl-4" />
              <TableHead>Model</TableHead>
              <TableHead>Capabilities</TableHead>
              <TableHead className="text-right">Context</TableHead>
              <TableHead className="text-right">$/1M in / out</TableHead>
              <TableHead className="text-right">This month</TableHead>
              <TableHead>In buckets</TableHead>
              <TableHead className="pr-6 text-right">
                <span className="sr-only">Add</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {visible.map((model) => {
              const inBuckets = bucketsByModel.get(model.id) ?? []
              return (
                <TableRow
                  key={model.id}
                  draggable
                  onDragStart={(event) => {
                    event.dataTransfer.setData(MODEL_DRAG_TYPE, model.id)
                    event.dataTransfer.setData("text/plain", model.slug)
                    event.dataTransfer.effectAllowed = "copy"
                  }}
                  className="cursor-grab active:cursor-grabbing"
                >
                  <TableCell className="pl-4 text-muted-foreground">
                    <GripVerticalIcon className="size-4" aria-hidden />
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1.5">
                      <StatusDot model={model} />
                      <span className="font-medium">{model.name}</span>
                      {model.own && (
                        <Badge variant="secondary" className="font-normal">
                          Your provider
                        </Badge>
                      )}
                      {model.kind === "embedding" && (
                        <Badge variant="outline" className="font-normal">
                          embedding
                        </Badge>
                      )}
                    </div>
                    <div className="font-mono text-xs text-muted-foreground">
                      {model.slug}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    <CapabilityIcons capabilities={model.capabilities} />
                  </TableCell>
                  <TableCell className="text-right text-muted-foreground tabular-nums">
                    {model.contextWindow
                      ? formatCompact(model.contextWindow)
                      : "—"}
                  </TableCell>
                  <TableCell className="text-right">
                    <ModelPrice
                      input={model.inputPrice}
                      output={model.outputPrice}
                    />
                  </TableCell>
                  <TableCell className="text-right text-xs tabular-nums">
                    {model.usage?.requests ? (
                      <>
                        <div className="font-medium">
                          {formatUsd(model.usage.costUsd)}
                        </div>
                        <div className="text-muted-foreground">
                          {formatCompact(model.usage.requests)} req ·{" "}
                          {formatCompact(model.usage.tokens)} tok
                        </div>
                      </>
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </TableCell>
                  <TableCell>
                    <div className="flex max-w-48 flex-wrap gap-1">
                      {inBuckets.map((name) => (
                        <Badge
                          key={name}
                          variant="secondary"
                          className="font-mono font-normal"
                        >
                          {name}
                        </Badge>
                      ))}
                    </div>
                  </TableCell>
                  <TableCell className="pr-6 text-right">
                    <AddToBucket
                      model={model}
                      buckets={buckets}
                      onAdd={(key) => onAddModel(key, model.id)}
                      onCreateBucket={onCreateBucket}
                    />
                  </TableCell>
                </TableRow>
              )
            })}
            {visible.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={8}
                  className="py-8 text-center text-muted-foreground"
                >
                  {library.length === 0
                    ? "No enabled models are available to this app yet."
                    : "No models match."}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </CardContent>
    </Card>
  )
}

function AddToBucket({
  model,
  buckets,
  onAdd,
  onCreateBucket,
}: {
  model: BucketModel
  buckets: BucketSummary[]
  onAdd: (bucketKey: string) => void
  onCreateBucket: (name: string, modelIds?: string[]) => void
}) {
  // No buckets yet: one click makes a "main" bucket with this model.
  if (buckets.length === 0) {
    return (
      <Button
        variant="outline"
        size="sm"
        className="h-7 px-2 text-xs"
        onClick={() => onCreateBucket("main", [model.id])}
      >
        <PlusIcon />
        New bucket
      </Button>
    )
  }
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2 text-xs"
          aria-label={`Add ${model.name}`}
        >
          <PlusIcon />
          Add
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuLabel>Add to bucket</DropdownMenuLabel>
        <DropdownMenuSeparator />
        {buckets.map((bucket) => {
          const added = bucket.modelIds.includes(model.id)
          const full = bucket.modelIds.length >= MAX_BUCKET_MODELS
          return (
            <DropdownMenuItem
              key={bucket.key}
              disabled={added || full}
              onSelect={() => onAdd(bucket.key)}
              className="font-mono"
            >
              {added ? <CheckIcon /> : <span className="size-4" />}
              {bucket.name}
              {full && !added && (
                <span className="ml-auto font-sans text-xs text-muted-foreground">
                  full
                </span>
              )}
            </DropdownMenuItem>
          )
        })}
        {buckets.length < MAX_BUCKETS && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => {
                const taken = new Set(buckets.map((b) => b.name))
                let n = buckets.length + 1
                while (taken.has(`bucket-${n}`)) n++
                onCreateBucket(`bucket-${n}`, [model.id])
              }}
            >
              <PlusIcon />
              New bucket with this model
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
