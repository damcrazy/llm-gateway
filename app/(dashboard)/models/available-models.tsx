import { CopyButton } from "@/components/animate-ui/components/buttons/copy"
import { Badge } from "@/components/ui/badge"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { accessPolicy, describePolicy, modelPermitted } from "@/lib/access"
import type { SessionMember } from "@/lib/auth"
import type { ModelRow, RouteRow } from "@/lib/db/types"
import { priceTier } from "@/lib/pricing"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"

import {
  AvailableModelsTable,
  type AvailableModel,
} from "./available-models-table"

type ModelFields = Pick<
  ModelRow,
  | "id"
  | "provider_id"
  | "slug"
  | "display_name"
  | "kind"
  | "capabilities"
  | "context_window"
  | "input_price_per_mtok"
  | "output_price_per_mtok"
>

/** What a member can call: routes first (recommended), then models. */
export async function AvailableModels({ member }: { member: SessionMember }) {
  const supabase = await createClient()
  const [modelsResult, routesResult, targetsResult, providersResult] =
    await Promise.all([
      supabase
        .from("models")
        .select(
          "id, provider_id, slug, display_name, kind, capabilities, context_window, input_price_per_mtok, output_price_per_mtok"
        )
        .eq("enabled", true)
        .order("slug"),
      supabase
        .from("routes")
        .select("id, name, description, kind")
        .eq("enabled", true)
        .order("name"),
      supabase
        .from("route_targets")
        .select("route_id, model_id, position")
        .order("position"),
      // Members can't read providers; only their on/off state is needed here.
      supabaseAdmin().from("providers").select("id, enabled"),
    ])

  const policy = accessPolicy({
    role: member.role,
    model_access: member.modelAccess,
    allowed_models: member.allowedModels,
  })
  const liveProviders = new Set(
    ((providersResult.data ?? []) as { id: string; enabled: boolean }[])
      .filter((provider) => provider.enabled)
      .map((provider) => provider.id)
  )
  const live = ((modelsResult.data ?? []) as ModelFields[]).filter((model) =>
    liveProviders.has(model.provider_id)
  )
  const byId = new Map(live.map((model) => [model.id, model]))

  const targetsByRoute = new Map<string, ModelFields[]>()
  for (const target of (targetsResult.data ?? []) as {
    route_id: string
    model_id: string
  }[]) {
    const model = byId.get(target.model_id)
    if (!model) continue
    targetsByRoute.set(target.route_id, [
      ...(targetsByRoute.get(target.route_id) ?? []),
      model,
    ])
  }

  const routes = (
    (routesResult.data ?? []) as Pick<
      RouteRow,
      "id" | "name" | "description" | "kind"
    >[]
  )
    .map((route) => {
      const usable = (targetsByRoute.get(route.id) ?? []).filter((model) =>
        modelPermitted(policy, model, route.name)
      )
      return { ...route, usable }
    })
    .filter((route) => route.usable.length > 0)

  const models: AvailableModel[] = live
    .filter((model) => modelPermitted(policy, model))
    .map((model) => ({
      slug: model.slug,
      displayName: model.display_name,
      kind: model.kind,
      capabilities: model.capabilities ?? [],
      contextWindow: model.context_window,
      inputPrice: model.input_price_per_mtok,
      outputPrice: model.output_price_per_mtok,
    }))

  return (
    <>
      <p className="text-sm text-muted-foreground">
        Your account can call {describePolicy(policy)}
        {member.monthlyBudgetUsd != null &&
          ` (budget $${member.monthlyBudgetUsd.toFixed(2)} a month across your apps)`}
        . Send a route name or model slug as <code>model</code>.
      </p>

      <Card className="pb-0">
        <CardHeader>
          <CardTitle>Routes</CardTitle>
          <CardDescription>
            Recommended: a route falls back to its next model automatically when
            one fails or is rate limited.
          </CardDescription>
        </CardHeader>
        <CardContent className="px-0">
          {routes.length === 0 ? (
            <p className="px-6 pb-6 text-sm text-muted-foreground">
              No routes are available to your account yet.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Route</TableHead>
                  <TableHead>Kind</TableHead>
                  <TableHead>Models you can reach</TableHead>
                  <TableHead className="pr-6">Pricing</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {routes.map((route) => {
                  const tiers = new Set(
                    route.usable.map((model) =>
                      priceTier(
                        model.input_price_per_mtok,
                        model.output_price_per_mtok
                      )
                    )
                  )
                  return (
                    <TableRow key={route.id}>
                      <TableCell className="pl-6">
                        <div className="flex items-center gap-1">
                          <span className="font-mono text-sm font-medium">
                            {route.name}
                          </span>
                          <CopyButton
                            content={route.name}
                            variant="ghost"
                            size="xs"
                            aria-label={`Copy ${route.name}`}
                          />
                        </div>
                        {route.description && (
                          <div className="text-xs text-muted-foreground">
                            {route.description}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-muted-foreground capitalize">
                        {route.kind}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {route.usable.map((model) => model.slug).join(" → ")}
                      </TableCell>
                      <TableCell className="pr-6">
                        {tiers.size === 1 && tiers.has("free") ? (
                          <Badge
                            variant="outline"
                            className="border-emerald-600/40 text-emerald-700 dark:border-emerald-400/40 dark:text-emerald-400"
                          >
                            Free
                          </Badge>
                        ) : tiers.has("paid") ? (
                          <Badge variant="secondary">Paid</Badge>
                        ) : (
                          <span className="text-muted-foreground">Mixed</span>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <AvailableModelsTable models={models} />
    </>
  )
}
