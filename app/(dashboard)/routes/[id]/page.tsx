import { cache } from "react"
import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import { FlaskConicalIcon } from "lucide-react"

import { Button } from "@/components/animate-ui/components/buttons/button"
import { CopyButton } from "@/components/animate-ui/components/buttons/copy"
import { PageHeader } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { requireAdmin } from "@/lib/auth"
import type {
  AppRow,
  ModelHealthRow,
  ModelRow,
  ProviderRow,
  RouteRow,
  RouteTargetRow,
} from "@/lib/db/types"
import { formatRelative } from "@/lib/format"
import { createClient } from "@/lib/supabase/server"

import { KIND_LABELS, type TargetModel } from "../shared"
import { DeleteRouteButton } from "./delete-route-button"
import { RouteSettingsForm } from "./route-settings-form"
import { RouteTargetsEditor } from "./route-targets-editor"

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type ModelSelection = Pick<
  ModelRow,
  | "id"
  | "provider_id"
  | "slug"
  | "display_name"
  | "kind"
  | "enabled"
  | "capabilities"
  | "input_price_per_mtok"
  | "output_price_per_mtok"
>

const loadRoute = cache(async (id: string) => {
  if (!UUID_PATTERN.test(id)) return null
  const supabase = await createClient()
  const { data } = await supabase
    .from("routes")
    .select("*")
    .eq("id", id)
    .maybeSingle()
  if (!data) return null
  const route = data as RouteRow

  const [
    targetsResult,
    modelsResult,
    providersResult,
    healthResult,
    appsResult,
  ] = await Promise.all([
    supabase
      .from("route_targets")
      .select("model_id, position")
      .eq("route_id", id)
      .order("position"),
    supabase
      .from("models")
      .select(
        "id, provider_id, slug, display_name, kind, enabled, capabilities, input_price_per_mtok, output_price_per_mtok"
      )
      .order("slug"),
    // Routes are shared by every app, so only shared providers' models.
    supabase
      .from("providers")
      .select("id, name, enabled")
      .is("owner_email", null),
    supabase
      .from("model_health")
      .select("model_id, cooldown_until, last_error"),
    supabase.from("apps").select("name, default_model"),
  ])

  const providers = new Map(
    (
      (providersResult.data ?? []) as Pick<
        ProviderRow,
        "id" | "name" | "enabled"
      >[]
    ).map((provider) => [provider.id, provider])
  )
  const health = new Map(
    (
      (healthResult.data ?? []) as Pick<
        ModelHealthRow,
        "model_id" | "cooldown_until" | "last_error"
      >[]
    ).map((row) => [row.model_id, row])
  )

  const now = Date.now()
  const models: TargetModel[] = ((modelsResult.data ?? []) as ModelSelection[])
    .filter((model) => providers.has(model.provider_id))
    .map((model) => {
      const provider = providers.get(model.provider_id)
      const state = health.get(model.id)
      const coolingDown =
        !!state?.cooldown_until &&
        new Date(state.cooldown_until).getTime() > now
      return {
        id: model.id,
        slug: model.slug,
        displayName: model.display_name,
        kind: model.kind,
        enabled: model.enabled,
        providerName: provider?.name ?? "Unknown provider",
        providerEnabled: provider?.enabled ?? false,
        capabilities: model.capabilities ?? [],
        inputPrice:
          model.input_price_per_mtok == null
            ? null
            : Number(model.input_price_per_mtok),
        outputPrice:
          model.output_price_per_mtok == null
            ? null
            : Number(model.output_price_per_mtok),
        coolingDown,
        cooldownLabel: coolingDown
          ? formatRelative(state!.cooldown_until)
          : null,
        lastError: state?.last_error ?? null,
      }
    })

  const known = new Set(models.map((model) => model.id))
  const targetIds = (
    (targetsResult.data ?? []) as Pick<RouteTargetRow, "model_id">[]
  )
    .map((target) => target.model_id)
    .filter((modelId) => known.has(modelId))

  const usedBy = (
    (appsResult.data ?? []) as Pick<AppRow, "name" | "default_model">[]
  )
    .filter((app) => app.default_model === route.name)
    .map((app) => app.name)

  return { route, models, targetIds, usedBy }
})

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>
}): Promise<Metadata> {
  const { id } = await params
  const data = await loadRoute(id)
  return { title: data ? `Route ${data.route.name}` : "Route not found" }
}

export default async function RoutePage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  await requireAdmin()
  const { id } = await params
  const data = await loadRoute(id)
  if (!data) notFound()
  const { route, models, targetIds, usedBy } = data
  const snippet = `"model": "${route.name}"`

  return (
    <>
      <div className="space-y-3">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink asChild>
                <Link href="/routes">Routes</Link>
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem>
              <BreadcrumbPage className="font-mono">
                {route.name}
              </BreadcrumbPage>
            </BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>
        <PageHeader
          title={
            <span className="flex flex-wrap items-center gap-2">
              <span className="font-mono break-all">{route.name}</span>
              <Badge variant="outline">{KIND_LABELS[route.kind]}</Badge>
              {!route.enabled && <Badge variant="secondary">Disabled</Badge>}
            </span>
          }
          description={route.description || "No description."}
          actions={
            <>
              <div className="flex h-9 items-center gap-1 rounded-md border bg-muted/40 pr-1 pl-3">
                <code className="font-mono text-sm">{snippet}</code>
                <CopyButton
                  content={snippet}
                  variant="ghost"
                  size="sm"
                  aria-label="Copy model snippet"
                />
              </div>
              {route.kind === "chat" && (
                <Button variant="outline" asChild>
                  <Link
                    href={`/playground?model=${encodeURIComponent(route.name)}`}
                  >
                    <FlaskConicalIcon />
                    Test
                  </Link>
                </Button>
              )}
              <DeleteRouteButton
                id={route.id}
                name={route.name}
                usedBy={usedBy}
              />
            </>
          }
        />
      </div>
      <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <RouteTargetsEditor
          routeId={route.id}
          routeKind={route.kind}
          strategy={route.strategy}
          maxAttempts={route.max_attempts}
          models={models}
          initialTargetIds={targetIds}
        />
        <RouteSettingsForm
          routeId={route.id}
          initial={{
            description: route.description ?? "",
            strategy: route.strategy,
            maxAttempts: String(route.max_attempts),
            timeoutSeconds: String(Number(route.timeout_ms) / 1000),
            firstTokenTimeoutSeconds: String(
              Number(route.first_token_timeout_ms) / 1000
            ),
            enabled: route.enabled,
          }}
        />
      </div>
    </>
  )
}
