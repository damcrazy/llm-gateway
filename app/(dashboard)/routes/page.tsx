import { Fragment } from "react"
import type { Metadata } from "next"
import Link from "next/link"
import { ArrowRightIcon, ChevronRightIcon, RouteIcon } from "lucide-react"

import { Button } from "@/components/animate-ui/components/buttons/button"
import { PageHeader } from "@/components/page-header"
import { PageTour } from "@/components/tour/tour-provider"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { requireAdmin } from "@/lib/auth"
import type { RouteRow, RouteTargetRow } from "@/lib/db/types"
import { createClient } from "@/lib/supabase/server"

import { NewRouteDialog, RouteEnabledSwitch } from "./route-controls"
import { KIND_LABELS, STRATEGY_LABELS } from "./shared"

export const metadata: Metadata = { title: "Routes" }

async function loadRoutes() {
  const supabase = await createClient()
  const [routesResult, targetsResult, modelsResult] = await Promise.all([
    supabase.from("routes").select("*").order("name"),
    supabase
      .from("route_targets")
      .select("route_id, model_id, position")
      .order("position"),
    supabase.from("models").select("id, slug"),
  ])

  const routes = (routesResult.data ?? []) as RouteRow[]
  const targets = (targetsResult.data ?? []) as Pick<
    RouteTargetRow,
    "route_id" | "model_id" | "position"
  >[]
  const slugById = new Map(
    ((modelsResult.data ?? []) as { id: string; slug: string }[]).map(
      (model) => [model.id, model.slug]
    )
  )

  const chains = new Map<string, string[]>()
  for (const target of targets) {
    const chain = chains.get(target.route_id) ?? []
    chain.push(slugById.get(target.model_id) ?? "unknown model")
    chains.set(target.route_id, chain)
  }

  return routes.map((route) => ({
    ...route,
    chain: chains.get(route.id) ?? [],
  }))
}

function TargetChain({ slugs }: { slugs: string[] }) {
  if (!slugs.length) return <Badge variant="destructive">No targets</Badge>
  const shown = slugs.slice(0, 2)
  const rest = slugs.length - shown.length
  return (
    <div className="flex items-center gap-1.5 font-mono text-xs text-muted-foreground">
      {shown.map((slug, index) => (
        <Fragment key={`${index}-${slug}`}>
          {index > 0 && <ArrowRightIcon className="size-3 shrink-0" />}
          <span className="max-w-56 truncate text-foreground" title={slug}>
            {slug}
          </span>
        </Fragment>
      ))}
      {rest > 0 && <span className="shrink-0">+{rest} more</span>}
    </div>
  )
}

export default async function RoutesPage() {
  await requireAdmin()
  const routes = await loadRoutes()

  return (
    <>
      <PageTour id="routes" />
      <PageHeader
        title="Routes"
        description="Named aliases apps send as model, like smart or fast. Each route tries its models in order and fails over automatically."
        actions={routes.length > 0 && <NewRouteDialog />}
      />
      {routes.length === 0 ? (
        <Empty data-tour="routes-empty" className="border">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <RouteIcon />
            </EmptyMedia>
            <EmptyTitle>No routes yet</EmptyTitle>
            <EmptyDescription>
              Create a route like <code className="font-mono">smart</code> or{" "}
              <code className="font-mono">fast</code>, add a few models as
              fallbacks, and point your apps at it instead of a specific
              provider.
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <NewRouteDialog />
          </EmptyContent>
        </Empty>
      ) : (
        <Card data-tour="routes-table" className="py-0">
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Name</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead>Strategy</TableHead>
                  <TableHead>Targets</TableHead>
                  <TableHead>Enabled</TableHead>
                  <TableHead className="w-16 pr-6" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {routes.map((route, index) => (
                  <TableRow key={route.id}>
                    <TableCell
                      data-tour={index === 0 ? "routes-name" : undefined}
                      className="pl-6"
                    >
                      <Link
                        href={`/routes/${route.id}`}
                        className="font-mono font-medium underline-offset-4 hover:underline"
                      >
                        {route.name}
                      </Link>
                    </TableCell>
                    <TableCell className="max-w-64 truncate text-muted-foreground">
                      {route.description || "—"}
                    </TableCell>
                    <TableCell>
                      <Badge variant="outline">{KIND_LABELS[route.kind]}</Badge>
                    </TableCell>
                    <TableCell
                      data-tour={index === 0 ? "routes-strategy" : undefined}
                      className="text-muted-foreground"
                    >
                      {STRATEGY_LABELS[route.strategy]}
                    </TableCell>
                    <TableCell
                      data-tour={index === 0 ? "routes-targets" : undefined}
                    >
                      <TargetChain slugs={route.chain} />
                    </TableCell>
                    <TableCell
                      data-tour={index === 0 ? "routes-enabled" : undefined}
                    >
                      <RouteEnabledSwitch
                        id={route.id}
                        name={route.name}
                        enabled={route.enabled}
                      />
                    </TableCell>
                    <TableCell className="pr-6 text-right">
                      <Button variant="ghost" size="icon-sm" asChild>
                        <Link
                          href={`/routes/${route.id}`}
                          aria-label={`Edit ${route.name}`}
                        >
                          <ChevronRightIcon />
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}
    </>
  )
}
