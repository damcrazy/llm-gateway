import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import {
  ChartNoAxesColumnIcon,
  CodeIcon,
  KeyRoundIcon,
  LayersIcon,
  SettingsIcon,
  TriangleAlertIcon,
} from "lucide-react"

import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/animate-ui/components/radix/tabs"
import { PageHeader } from "@/components/page-header"
import { PageTour } from "@/components/tour/tour-provider"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card"
import { accessPolicy, canUseModel, describePolicy } from "@/lib/access"
import { getOrigin, requireMember } from "@/lib/auth"
import type {
  AppBucketRow,
  AppRow,
  ModelHealthRow,
  ModelRow,
  RouteRow,
  UsageBreakdownRow,
} from "@/lib/db/types"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"

import {
  API_KEY_COLUMNS,
  daysAgo,
  isUuid,
  startOfMonthUtc,
  type ApiKeyListRow,
} from "../_lib"
import { AppEnabledSwitch, DeleteAppButton } from "./app-controls"
import type { BucketModel, BucketsData, ModelStatus } from "./buckets-shared"
import { IntegrateSection } from "./integrate-section"
import { KeysSection } from "./keys-section"
import { ModelsSection } from "./models-section"
import { AppSettingsForm } from "./settings-form"
import { UsageSection } from "./usage-section"

const TABS = [
  { value: "keys", label: "Keys", icon: KeyRoundIcon },
  { value: "models", label: "Models", icon: LayersIcon },
  { value: "settings", label: "Settings", icon: SettingsIcon },
  { value: "usage", label: "Usage", icon: ChartNoAxesColumnIcon },
  { value: "integrate", label: "Integrate", icon: CodeIcon },
  { value: "danger", label: "Danger zone", icon: TriangleAlertIcon },
] as const

type Props = {
  params: Promise<{ id: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params
  if (!isUuid(id)) return { title: "App" }
  const supabase = await createClient()
  const { data } = await supabase
    .from("apps")
    .select("name")
    .eq("id", id)
    .maybeSingle()
  return { title: (data?.name as string | undefined) ?? "App" }
}

export default async function AppPage({ params, searchParams }: Props) {
  await requireMember()
  const { id } = await params
  if (!isUuid(id)) notFound()
  const { tab } = await searchParams
  const initialTab = TABS.some((t) => t.value === tab)
    ? (tab as string)
    : "keys"

  const supabase = await createClient()
  const [
    appResult,
    keysResult,
    routesResult,
    modelsResult,
    usageResult,
    monthResult,
    monthByModelResult,
    bucketsResult,
    healthResult,
    providersResult,
    origin,
  ] = await Promise.all([
    supabase.from("apps").select("*").eq("id", id).maybeSingle(),
    supabase
      .from("api_keys")
      .select(API_KEY_COLUMNS)
      .eq("app_id", id)
      .order("created_at", { ascending: false }),
    supabase.from("routes").select("id, name, kind, enabled").order("name"),
    supabase
      .from("models")
      .select(
        "id, provider_id, model_id, slug, display_name, kind, enabled, capabilities, context_window, input_price_per_mtok, output_price_per_mtok"
      )
      .order("slug"),
    supabase.rpc("usage_breakdown", {
      p_since: daysAgo(30),
      p_dimension: "model",
      p_app: id,
    }),
    supabase.rpc("usage_breakdown", {
      p_since: startOfMonthUtc(),
      p_dimension: "app",
      p_app: id,
    }),
    supabase.rpc("usage_breakdown", {
      p_since: startOfMonthUtc(),
      p_dimension: "model",
      p_app: id,
    }),
    supabase
      .from("app_buckets")
      .select("name, position, model_ids, strategy, hedge_after_ms")
      .eq("app_id", id)
      .order("position"),
    supabase
      .from("model_health")
      .select("model_id, cooldown_until, consecutive_failures"),
    // Members can't read providers; only names and on/off state are needed.
    supabaseAdmin().from("providers").select("id, name, enabled, owner_email"),
    getOrigin(),
  ])

  if (appResult.error) throw new Error(appResult.error.message)
  const app = appResult.data as AppRow | null
  if (!app) notFound()

  const keys = (keysResult.data ?? []) as unknown as ApiKeyListRow[]
  const routes = (routesResult.data ?? []) as Pick<
    RouteRow,
    "id" | "name" | "kind" | "enabled"
  >[]
  const models = (modelsResult.data ?? []) as Pick<
    ModelRow,
    | "id"
    | "provider_id"
    | "model_id"
    | "slug"
    | "display_name"
    | "kind"
    | "enabled"
    | "capabilities"
    | "context_window"
    | "input_price_per_mtok"
    | "output_price_per_mtok"
  >[]
  const usage = (usageResult.data ?? []) as UsageBreakdownRow[]
  const month = (monthResult.data ?? []) as UsageBreakdownRow[]

  // Only offer what the app's owner is allowed to call.
  const { data: owner } = await supabase
    .from("members")
    .select("role, model_access, allowed_models")
    .eq("email", app.owner_email)
    .maybeSingle()
  const policy = owner
    ? accessPolicy(owner as Parameters<typeof accessPolicy>[0])
    : { access: "all" as const }
  const modelSlugs = new Map(models.map((m) => [m.id, m.slug]))
  const monthSpend = month.reduce((sum, row) => sum + Number(row.cost_usd), 0)

  const buckets = (
    (bucketsResult.data ?? []) as Pick<
      AppBucketRow,
      "name" | "position" | "model_ids" | "strategy" | "hedge_after_ms"
    >[]
  ).map((bucket) => ({
    name: bucket.name,
    modelIds: bucket.model_ids,
    strategy: bucket.strategy ?? "ordered",
    hedgeAfterMs: bucket.hedge_after_ms ?? null,
  }))
  const bucketsData = buildBucketsData({
    models,
    providers: (providersResult.data ?? []) as {
      id: string
      name: string
      enabled: boolean
      owner_email: string | null
    }[],
    health: (healthResult.data ?? []) as Pick<
      ModelHealthRow,
      "model_id" | "cooldown_until" | "consecutive_failures"
    >[],
    usage: (monthByModelResult.data ?? []) as UsageBreakdownRow[],
    policy,
    buckets,
    app,
  })

  // Integrate snippets use the app's buckets when it has any.
  const bucketNames = buckets.map((bucket) => bucket.name)
  const snippetModel = app.default_model ?? bucketNames[0] ?? "smart"
  const extraModels = (
    bucketNames.length
      ? bucketNames
      : routes.filter((r) => r.enabled && r.kind === "chat").map((r) => r.name)
  ).filter((m) => m !== snippetModel)

  const loadError =
    keysResult.error ??
    routesResult.error ??
    modelsResult.error ??
    usageResult.error ??
    monthResult.error ??
    monthByModelResult.error ??
    bucketsResult.error

  return (
    <>
      <PageTour id="app" />
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/apps">Apps</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{app.name}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>
      <PageHeader
        className="-mt-3"
        title={app.name}
        description={
          <>
            <span className="font-mono">{app.slug}</span>
            {app.description && <> · {app.description}</>}
          </>
        }
        actions={
          <AppEnabledSwitch
            key={String(app.enabled)}
            id={app.id}
            enabled={app.enabled}
          />
        }
      />
      {loadError && (
        <Alert variant="destructive">
          <TriangleAlertIcon />
          <AlertTitle>Could not load everything</AlertTitle>
          <AlertDescription>{loadError.message}</AlertDescription>
        </Alert>
      )}
      <Tabs defaultValue={initialTab} className="min-w-0 gap-4">
        <div className="-mx-1 overflow-x-auto px-1 pb-1">
          <TabsList data-tour="app-tabs">
            {TABS.map(({ value, label, icon: Icon }) => (
              <TabsTrigger
                key={value}
                value={value}
                data-tour={`app-tab-${value}`}
              >
                <Icon />
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value="keys" className="min-w-0">
          <PageTour id="app-keys" />
          <KeysSection appId={app.id} keys={keys} />
        </TabsContent>

        <TabsContent value="models" className="min-w-0">
          <PageTour id="app-models" />
          <ModelsSection appId={app.id} data={bucketsData} />
        </TabsContent>

        <TabsContent value="settings" className="min-w-0">
          <PageTour id="app-settings" />
          <AppSettingsForm key={app.updated_at} app={app} />
        </TabsContent>

        <TabsContent value="usage" className="min-w-0">
          <PageTour id="app-usage" />
          <UsageSection
            rows={usage}
            modelSlugs={modelSlugs}
            monthSpend={monthSpend}
            monthlyBudget={
              app.monthly_budget_usd == null
                ? null
                : Number(app.monthly_budget_usd)
            }
          />
        </TabsContent>

        <TabsContent value="integrate" className="min-w-0">
          <PageTour id="app-integrate" />
          <IntegrateSection
            origin={origin}
            model={snippetModel}
            extraModels={extraModels}
          />
        </TabsContent>

        <TabsContent value="danger" className="min-w-0">
          <PageTour id="app-danger" />
          <Card className="ring-destructive/40" data-tour="app-delete">
            <CardHeader>
              <CardTitle>Delete this app</CardTitle>
              <CardDescription>
                Permanently deletes {app.name} and all {keys.length} of its API
                keys. Clients using them start getting 401 errors immediately.
                Request logs are kept without the app link.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div>
                <DeleteAppButton id={app.id} name={app.name} />
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </>
  )
}

type PageModel = Pick<
  ModelRow,
  | "id"
  | "provider_id"
  | "model_id"
  | "slug"
  | "display_name"
  | "kind"
  | "enabled"
  | "capabilities"
  | "context_window"
  | "input_price_per_mtok"
  | "output_price_per_mtok"
>

/** Everything the Models tab shows: each model's price, health and usage. */
function buildBucketsData({
  models,
  providers,
  health,
  usage,
  policy,
  buckets,
  app,
}: {
  models: PageModel[]
  providers: {
    id: string
    name: string
    enabled: boolean
    owner_email: string | null
  }[]
  health: Pick<ModelHealthRow, "model_id" | "cooldown_until">[]
  usage: UsageBreakdownRow[]
  policy: ReturnType<typeof accessPolicy>
  buckets: BucketsData["buckets"]
  app: AppRow
}): BucketsData {
  const providerById = new Map(providers.map((p) => [p.id, p]))
  const cooldownById = new Map(
    health
      .filter((h) => h.cooldown_until)
      .map((h) => [h.model_id, new Date(h.cooldown_until!).getTime()])
  )
  const usageById = new Map(
    usage.filter((u) => u.id).map((u) => [u.id as string, u])
  )
  const now = Date.now()

  const addable: string[] = []
  // Another member's private provider: those models don't exist for this app.
  const visible = models.filter((model) => {
    const owner = providerById.get(model.provider_id)?.owner_email ?? null
    return owner === null || owner === app.owner_email
  })
  const bucketModels: BucketModel[] = visible.map((model) => {
    const provider = providerById.get(model.provider_id)
    const ownerEmail = provider?.owner_email ?? null
    const permitted = canUseModel(policy, model, ownerEmail, app.owner_email)
    const cooldownUntil = cooldownById.get(model.id) ?? 0
    let status: ModelStatus = { kind: "ok" }
    if (!model.enabled) {
      status = { kind: "unavailable", label: "Turned off by an admin: skipped" }
    } else if (!provider?.enabled) {
      status = { kind: "unavailable", label: "Its provider is off: skipped" }
    } else if (!permitted) {
      status = {
        kind: "unavailable",
        label: "Not available to this app's owner: skipped",
      }
    } else if (cooldownUntil > now) {
      const minutes = Math.max(1, Math.ceil((cooldownUntil - now) / 60_000))
      status = {
        kind: "cooling",
        label: `Failing recently: tried last for about ${minutes} more min`,
      }
    }
    if (model.enabled && provider?.enabled && permitted) addable.push(model.id)

    const used = usageById.get(model.id)
    return {
      id: model.id,
      slug: model.slug,
      name: model.display_name || model.model_id,
      provider: provider?.name ?? "Unknown provider",
      own: ownerEmail !== null,
      kind: model.kind,
      capabilities: model.capabilities ?? [],
      contextWindow: model.context_window,
      inputPrice:
        model.input_price_per_mtok == null
          ? null
          : Number(model.input_price_per_mtok),
      outputPrice:
        model.output_price_per_mtok == null
          ? null
          : Number(model.output_price_per_mtok),
      status,
      usage: used
        ? {
            requests: Number(used.requests),
            errors: Number(used.errors),
            tokens: Number(used.input_tokens) + Number(used.output_tokens),
            costUsd: Number(used.cost_usd),
          }
        : null,
    }
  })

  return {
    models: bucketModels,
    addable,
    buckets,
    defaultBucket: buckets.some((b) => b.name === app.default_model)
      ? app.default_model
      : null,
    onlyBucketModels: app.only_bucket_models,
    ownerAccess: policy.access === "all" ? null : describePolicy(policy),
  }
}
