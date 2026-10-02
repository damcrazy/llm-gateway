"use client"

import { useMemo, useState } from "react"
import { SearchIcon } from "lucide-react"

import { CopyButton } from "@/components/animate-ui/components/buttons/copy"
import { ModelPrice } from "@/components/model-price"
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

export interface AvailableModel {
  /** From one of the member's own providers. */
  own: boolean
  slug: string
  displayName: string | null
  kind: "chat" | "embedding"
  capabilities: Capability[]
  contextWindow: number | null
  inputPrice: number | null
  outputPrice: number | null
}

const tierOf = (model: AvailableModel) =>
  priceTier(model.inputPrice, model.outputPrice)

/** Read-only, searchable list of the models a member may call. */
export function AvailableModelsTable({ models }: { models: AvailableModel[] }) {
  const [search, setSearch] = useState("")
  const [tier, setTier] = useState<PriceTierFilterValue>("all")

  const searched = useMemo(() => {
    const query = search.trim().toLowerCase()
    if (!query) return models
    return models.filter((model) =>
      `${model.slug} ${model.displayName ?? ""}`.toLowerCase().includes(query)
    )
  }, [models, search])
  const visible = useMemo(
    () =>
      tier === "all" ? searched : searched.filter((m) => tierOf(m) === tier),
    [searched, tier]
  )

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
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </InputGroup>
        <PriceTierFilter
          value={tier}
          onChange={setTier}
          counts={countByTier(searched, tierOf)}
        />
      </div>
      <Card className="py-0">
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Model</TableHead>
                <TableHead>Kind</TableHead>
                <TableHead>Capabilities</TableHead>
                <TableHead className="text-right">Context</TableHead>
                <TableHead className="pr-6 text-right">$/1M in / out</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {visible.map((model) => (
                <TableRow key={model.slug}>
                  <TableCell className="pl-6">
                    <div className="flex items-center gap-1">
                      <span className="font-mono text-sm font-medium">
                        {model.slug}
                      </span>
                      {model.own && (
                        <Badge variant="secondary" className="font-normal">
                          Your provider
                        </Badge>
                      )}
                      <CopyButton
                        content={model.slug}
                        variant="ghost"
                        size="xs"
                        aria-label={`Copy ${model.slug}`}
                      />
                    </div>
                    {model.displayName && (
                      <div className="text-xs text-muted-foreground">
                        {model.displayName}
                      </div>
                    )}
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
              ))}
              {visible.length === 0 && (
                <TableRow>
                  <TableCell
                    colSpan={5}
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
