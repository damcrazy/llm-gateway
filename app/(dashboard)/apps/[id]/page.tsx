import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import {
  ChartNoAxesColumnIcon,
  CodeIcon,
  KeyRoundIcon,
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
import { accessPolicy, modelPermitted } from "@/lib/access"
import { getOrigin, requireMember } from "@/lib/auth"
import type {
  AppRow,
  ModelRow,
  RouteRow,
  UsageBreakdownRow,
} from "@/lib/db/types"
import { createClient } from "@/lib/supabase/server"

import {
  API_KEY_COLUMNS,
  daysAgo,
  isUuid,
  startOfMonthUtc,
  type ApiKeyListRow,
} from "../_lib"
import { AppEnabledSwitch, DeleteAppButton } from "./app-controls"
import { IntegrateSection } from "./integrate-section"
import { KeysSection } from "./keys-section"
import { AppSettingsForm } from "./settings-form"
import { UsageSection } from "./usage-section"

const TABS = [
  { value: "keys", label: "Keys", icon: KeyRoundIcon },
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
        "id, slug, kind, enabled, input_price_per_mtok, output_price_per_mtok"
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
    | "slug"
    | "kind"
    | "enabled"
    | "input_price_per_mtok"
    | "output_price_per_mtok"
  >[]
  const usage = (usageResult.data ?? []) as UsageBreakdownRow[]
  const month = (monthResult.data ?? []) as UsageBreakdownRow[]

  // Only offer what the app's owner is allowed to call.
  const [{ data: owner }, { data: targetRows }] = await Promise.all([
    supabase
      .from("members")
      .select("role, model_access, allowed_models")
      .eq("email", app.owner_email)
      .maybeSingle(),
    supabase.from("route_targets").select("route_id, model_id"),
  ])
  const policy = owner
    ? accessPolicy(owner as Parameters<typeof accessPolicy>[0])
    : { access: "all" as const }
  const modelById = new Map(models.map((m) => [m.id, m]))
  const targetsByRoute = new Map<string, string[]>()
  for (const row of (targetRows ?? []) as {
    route_id: string
    model_id: string
  }[]) {
    targetsByRoute.set(row.route_id, [
      ...(targetsByRoute.get(row.route_id) ?? []),
      row.model_id,
    ])
  }
  const options = {
    routes: routes
      .filter((r) => r.enabled)
      .filter((r) =>
        (targetsByRoute.get(r.id) ?? []).some((modelId) => {
          const model = modelById.get(modelId)
          return (
            model?.enabled === true && modelPermitted(policy, model, r.name)
          )
        })
      )
      .map((r) => r.name),
    models: models
      .filter((m) => m.enabled && modelPermitted(policy, m))
      .map((m) => m.slug),
  }
  const modelSlugs = new Map(models.map((m) => [m.id, m.slug]))
  const monthSpend = month.reduce((sum, row) => sum + Number(row.cost_usd), 0)

  const snippetModel = app.default_model ?? "smart"
  const extraModels = (
    app.allowed_models.length
      ? app.allowed_models
      : routes.filter((r) => r.enabled && r.kind === "chat").map((r) => r.name)
  ).filter((m) => m !== snippetModel)

  const loadError =
    keysResult.error ??
    routesResult.error ??
    modelsResult.error ??
    usageResult.error ??
    monthResult.error

  return (
    <>
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
          <TabsList>
            {TABS.map(({ value, label, icon: Icon }) => (
              <TabsTrigger key={value} value={value}>
                <Icon />
                {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>

        <TabsContent value="keys" className="min-w-0">
          <KeysSection appId={app.id} keys={keys} />
        </TabsContent>

        <TabsContent value="settings" className="min-w-0">
          <AppSettingsForm key={app.updated_at} app={app} options={options} />
        </TabsContent>

        <TabsContent value="usage" className="min-w-0">
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
          <IntegrateSection
            origin={origin}
            model={snippetModel}
            extraModels={extraModels}
          />
        </TabsContent>

        <TabsContent value="danger" className="min-w-0">
          <Card className="ring-destructive/40">
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
