"use client"

import { useMemo, useState, useTransition } from "react"
import { CheckCheckIcon, RadarIcon, SearchIcon } from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/animate-ui/components/buttons/button"
import { Checkbox } from "@/components/animate-ui/components/radix/checkbox"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/animate-ui/components/radix/dialog"
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
import { Spinner } from "@/components/ui/spinner"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { ModelPrice } from "@/components/model-price"
import {
  PriceTierFilter,
  type PriceTierFilterValue,
} from "@/components/price-tier-filter"
import type { DiscoveredModel } from "@/lib/gateway/discovery"
import { countByTier, priceTier, PRICE_TIER_LABELS } from "@/lib/pricing"

import { CapabilityBadges } from "../../models/model-controls"
import { formatTokens } from "../../models/shared"
import { discoverProviderModels, importModels } from "../actions"

const tierOf = (model: DiscoveredModel) =>
  priceTier(model.input_price_per_mtok, model.output_price_per_mtok)

export function DiscoverModelsButton({
  providerId,
  providerName,
}: {
  providerId: string
  providerName: string
}) {
  const [open, setOpen] = useState(false)
  const [results, setResults] = useState<{
    models: DiscoveredModel[]
    total: number
  } | null>(null)
  const [loading, startLoading] = useTransition()

  function discover() {
    startLoading(async () => {
      const result = await discoverProviderModels(providerId)
      if (!result.ok) {
        toast.error("Couldn't list models", { description: result.error })
        return
      }
      setResults(result.data ?? { models: [], total: 0 })
      setOpen(true)
    })
  }

  return (
    <>
      <Button variant="outline" onClick={discover} disabled={loading}>
        {loading ? <Spinner /> : <RadarIcon />}
        Discover models
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[90vh] flex-col sm:max-w-4xl">
          {results && (
            <DiscoverResults
              providerId={providerId}
              providerName={providerName}
              models={results.models}
              total={results.total}
              onDone={() => setOpen(false)}
            />
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}

function DiscoverResults({
  providerId,
  providerName,
  models,
  total,
  onDone,
}: {
  providerId: string
  providerName: string
  models: DiscoveredModel[]
  total: number
  onDone: () => void
}) {
  const [search, setSearch] = useState("")
  const [tier, setTier] = useState<PriceTierFilterValue>("all")
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [importing, startImport] = useTransition()

  const searched = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return models
    return models.filter((model) =>
      `${model.model_id} ${model.display_name ?? ""}`
        .toLowerCase()
        .includes(query)
    )
  }, [models, search])
  const tierCounts = useMemo(() => countByTier(searched, tierOf), [searched])
  const visible = useMemo(
    () =>
      tier === "all"
        ? searched
        : searched.filter((model) => tierOf(model) === tier),
    [searched, tier]
  )
  const selectedCounts = useMemo(
    () =>
      countByTier(
        models.filter((model) => selected.has(model.model_id)),
        tierOf
      ),
    [models, selected]
  )
  const filtered = tier !== "all" || search.trim() !== ""

  const visibleSelected = visible.filter((model) =>
    selected.has(model.model_id)
  ).length
  const headerState =
    visible.length > 0 && visibleSelected === visible.length
      ? true
      : visibleSelected > 0
        ? "indeterminate"
        : false

  function toggle(modelId: string, checked: boolean) {
    setSelected((current) => {
      const next = new Set(current)
      if (checked) next.add(modelId)
      else next.delete(modelId)
      return next
    })
  }

  function selectVisible(checked: boolean) {
    setSelected((current) => {
      const next = new Set(current)
      for (const model of visible) {
        if (checked) next.add(model.model_id)
        else next.delete(model.model_id)
      }
      return next
    })
  }

  function submit() {
    const chosen = models
      .filter((model) => selected.has(model.model_id))
      .map((model) => ({
        model_id: model.model_id,
        display_name: model.display_name,
        kind: model.kind,
        capabilities: model.capabilities,
        tags: [],
        context_window: model.context_window,
        max_output_tokens: model.max_output_tokens,
        input_price_per_mtok:
          model.input_price_per_mtok == null
            ? null
            : Number(model.input_price_per_mtok),
        output_price_per_mtok:
          model.output_price_per_mtok == null
            ? null
            : Number(model.output_price_per_mtok),
        cached_input_price_per_mtok:
          model.cached_input_price_per_mtok == null
            ? null
            : Number(model.cached_input_price_per_mtok),
      }))
    startImport(async () => {
      const result = await importModels(providerId, chosen)
      if (!result.ok) {
        toast.error(result.error)
        return
      }
      toast.success(result.message)
      onDone()
    })
  }

  return (
    <>
      <DialogHeader>
        <DialogTitle>Discover models</DialogTitle>
        <DialogDescription>
          {models.length === 0
            ? `${providerName} lists ${total} model${total === 1 ? "" : "s"}, and all of them are already added.`
            : `${models.length} of the ${total} models ${providerName} lists aren't added yet. Capabilities and prices come from the model catalogue; review them after importing.`}
        </DialogDescription>
      </DialogHeader>

      {models.length === 0 ? (
        <Empty className="p-6">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <CheckCheckIcon />
            </EmptyMedia>
            <EmptyTitle>Nothing new</EmptyTitle>
            <EmptyDescription>
              Every model this provider lists is already here.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <>
          <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
            <InputGroup className="sm:max-w-xs">
              <InputGroupAddon>
                <SearchIcon />
              </InputGroupAddon>
              <InputGroupInput
                placeholder="Search models"
                aria-label="Search discovered models"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </InputGroup>
            <div className="flex gap-2 sm:ml-auto">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => selectVisible(true)}
                disabled={!visible.length}
              >
                Select all
                {filtered
                  ? tier === "all"
                    ? " shown"
                    : ` ${PRICE_TIER_LABELS[tier].toLowerCase()} shown`
                  : ""}
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelected(new Set())}
                disabled={!selected.size}
              >
                Select none
              </Button>
            </div>
          </div>

          <PriceTierFilter
            value={tier}
            onChange={setTier}
            counts={tierCounts}
          />

          <div className="min-h-0 flex-1 overflow-y-auto rounded-md border">
            {visible.length === 0 ? (
              <p className="p-6 text-center text-sm text-muted-foreground">
                No models match these filters.
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10 pl-3">
                      <Checkbox
                        size="sm"
                        aria-label="Select all shown models"
                        checked={headerState}
                        onCheckedChange={(checked) =>
                          selectVisible(checked === true)
                        }
                      />
                    </TableHead>
                    <TableHead>Model</TableHead>
                    <TableHead>Kind</TableHead>
                    <TableHead>Capabilities</TableHead>
                    <TableHead className="text-right">Context</TableHead>
                    <TableHead className="pr-3 text-right">
                      $/1M in / out
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map((model) => {
                    const checked = selected.has(model.model_id)
                    return (
                      <TableRow
                        key={model.model_id}
                        data-state={checked ? "selected" : undefined}
                        className="cursor-pointer"
                        onClick={() => toggle(model.model_id, !checked)}
                      >
                        <TableCell
                          className="pl-3"
                          onClick={(event) => event.stopPropagation()}
                        >
                          <Checkbox
                            size="sm"
                            aria-label={`Select ${model.model_id}`}
                            checked={checked}
                            onCheckedChange={(value) =>
                              toggle(model.model_id, value === true)
                            }
                          />
                        </TableCell>
                        <TableCell>
                          <div className="font-mono text-sm">
                            {model.model_id}
                          </div>
                          {model.display_name &&
                            model.display_name !== model.model_id && (
                              <div className="text-xs text-muted-foreground">
                                {model.display_name}
                              </div>
                            )}
                        </TableCell>
                        <TableCell className="text-muted-foreground capitalize">
                          {model.kind}
                        </TableCell>
                        <TableCell>
                          <div className="min-w-40">
                            <CapabilityBadges
                              capabilities={model.capabilities}
                            />
                          </div>
                        </TableCell>
                        <TableCell className="text-right tabular-nums">
                          {formatTokens(model.context_window)}
                        </TableCell>
                        <TableCell className="pr-3 text-right">
                          <ModelPrice
                            input={model.input_price_per_mtok}
                            output={model.output_price_per_mtok}
                          />
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </div>
        </>
      )}

      <DialogFooter className="items-center">
        {models.length > 0 && (
          <span className="text-sm text-muted-foreground sm:mr-auto">
            {selected.size} selected
            {selected.size > 0 &&
              ` (${selectedCounts.free} free, ${selectedCounts.paid} paid${selectedCounts.unknown ? `, ${selectedCounts.unknown} unknown` : ""})`}
          </span>
        )}
        <DialogClose asChild>
          <Button variant="outline">
            {models.length ? "Cancel" : "Close"}
          </Button>
        </DialogClose>
        {models.length > 0 && (
          <Button onClick={submit} disabled={importing || selected.size === 0}>
            {importing && <Spinner />}
            Import {selected.size || ""} model{selected.size === 1 ? "" : "s"}
          </Button>
        )}
      </DialogFooter>
    </>
  )
}
