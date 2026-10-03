import { cache } from "react"
import type { Metadata } from "next"
import Link from "next/link"
import { notFound } from "next/navigation"
import {
  CpuIcon,
  ExternalLinkIcon,
  KeyRoundIcon,
  LockIcon,
  PlusIcon,
} from "lucide-react"

import { Button } from "@/components/animate-ui/components/buttons/button"
import { PageHeader } from "@/components/page-header"
import { PageTour } from "@/components/tour/tour-provider"
import { Badge } from "@/components/ui/badge"
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
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty"
import { requireMember } from "@/lib/auth"
import type { ProviderRow } from "@/lib/db/types"
import { canManageProvider } from "@/lib/provider-access"
import { PROVIDER_TYPE_SPECS } from "@/lib/providers/catalog"
import { loadCredentialHints } from "@/lib/providers/secrets"
import { createClient } from "@/lib/supabase/server"

import { loadModelList } from "../../models/data"
import { ModelFormDialog } from "../../models/model-form-dialog"
import { ModelsExplorer } from "../../models/models-table"
import { ProviderEnabledSwitch } from "../provider-controls"
import { presetOf, providerKindLabel, UUID_PATTERN } from "../shared"
import { DiscoverModelsButton } from "./discover-models-dialog"
import {
  DeleteProviderButton,
  ProviderSettingsForm,
  ReplaceCredentialsDialog,
} from "./provider-settings"

type Props = { params: Promise<{ id: string }> }

const getProvider = cache(async (id: string): Promise<ProviderRow | null> => {
  if (!UUID_PATTERN.test(id)) return null
  const supabase = await createClient()
  const { data } = await supabase
    .from("providers")
    .select("*")
    .eq("id", id)
    .maybeSingle()
  return (data as ProviderRow | null) ?? null
})

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const provider = await getProvider((await params).id)
  return { title: provider?.name ?? "Provider" }
}

export default async function ProviderPage({ params }: Props) {
  const me = await requireMember()
  const { id } = await params
  const provider = await getProvider(id)
  // Shared providers are managed by admins; private ones by their owner.
  if (!provider || !canManageProvider(me, provider.owner_email ?? null))
    notFound()
  const own = provider.owner_email !== null

  const [{ models }, hints] = await Promise.all([
    loadModelList({ providerId: provider.id }),
    loadCredentialHints(),
  ])
  const spec = PROVIDER_TYPE_SPECS[provider.type]
  const preset = presetOf(provider.config)
  const { typeLabel, presetLabel } = providerKindLabel(
    provider.type,
    provider.config
  )
  const hasSecrets = hints.has(provider.id)
  const hint = hints.get(provider.id) ?? null
  const config = provider.config ?? {}

  const addModelButton = (
    <ModelFormDialog
      providerId={provider.id}
      providerSlug={provider.slug}
      providerType={provider.type}
      trigger={
        <Button
          variant={spec.canDiscoverModels ? "outline" : "default"}
          data-tour="provider-add-model"
        >
          <PlusIcon />
          Add model manually
        </Button>
      }
    />
  )

  return (
    <>
      <PageTour id="provider" />
      <Breadcrumb>
        <BreadcrumbList>
          <BreadcrumbItem>
            <BreadcrumbLink asChild>
              <Link href="/providers">Providers</Link>
            </BreadcrumbLink>
          </BreadcrumbItem>
          <BreadcrumbSeparator />
          <BreadcrumbItem>
            <BreadcrumbPage>{provider.name}</BreadcrumbPage>
          </BreadcrumbItem>
        </BreadcrumbList>
      </Breadcrumb>

      <PageHeader
        className="-mt-3"
        title={provider.name}
        description={
          <span className="flex flex-wrap items-center gap-1.5">
            {own && (
              <Badge className="gap-1">
                <LockIcon className="size-3" />
                Private · only your apps
              </Badge>
            )}
            <Badge variant="secondary">{typeLabel}</Badge>
            {presetLabel && <Badge variant="outline">{presetLabel}</Badge>}
            <span className="font-mono text-xs">{provider.slug}</span>
          </span>
        }
        actions={
          <>
            <ProviderEnabledSwitch
              id={provider.id}
              name={provider.name}
              enabled={provider.enabled}
              showLabel
            />
            <DeleteProviderButton
              id={provider.id}
              name={provider.name}
              modelCount={models.length}
            />
          </>
        }
      />

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2" data-tour="provider-settings">
          <CardHeader>
            <CardTitle>Settings</CardTitle>
            <CardDescription>
              Changes apply to the gateway within a few seconds.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <ProviderSettingsForm
              id={provider.id}
              name={provider.name}
              slug={provider.slug}
              type={provider.type}
              config={config}
              quota={{ rpm: provider.quota_rpm, rpd: provider.quota_rpd }}
            />
          </CardContent>
        </Card>

        <Card className="self-start" data-tour="provider-credentials">
          <CardHeader>
            <CardTitle>Credentials</CardTitle>
            <CardDescription>
              Encrypted at rest. They are never shown again, only replaced.
            </CardDescription>
          </CardHeader>
          <CardContent className="gap-4">
            <div className="flex items-center gap-2 rounded-md border px-3 py-2">
              <KeyRoundIcon className="size-4 shrink-0 text-muted-foreground" />
              {hint ? (
                <code className="min-w-0 truncate font-mono text-sm">
                  {hint}
                </code>
              ) : (
                <span className="text-sm text-muted-foreground">
                  {hasSecrets
                    ? "None (no authentication)"
                    : "No credentials saved"}
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <ReplaceCredentialsDialog
                id={provider.id}
                type={provider.type}
                hint={hint}
              />
              {preset?.keysUrl && (
                <Button variant="link" size="sm" asChild>
                  <a href={preset.keysUrl} target="_blank" rel="noreferrer">
                    Get an API key
                    <ExternalLinkIcon />
                  </a>
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      <section className="grid gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="space-y-1">
            <h2 className="text-lg font-semibold tracking-tight">Models</h2>
            <p className="text-sm text-muted-foreground">
              {spec.canDiscoverModels
                ? "Discover models from the provider's API, or add one by id."
                : `${spec.label} can't list its models, so add each one by id.`}{" "}
              Clients call them as{" "}
              <code className="font-mono">
                {provider.slug}/&lt;model-id&gt;
              </code>
              .
            </p>
          </div>
          {models.length > 0 && (
            <div className="flex flex-wrap items-center gap-2">
              {addModelButton}
              {spec.canDiscoverModels && (
                <DiscoverModelsButton
                  providerId={provider.id}
                  providerName={provider.name}
                />
              )}
            </div>
          )}
        </div>

        {models.length === 0 ? (
          <Card>
            <CardContent>
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <CpuIcon />
                  </EmptyMedia>
                  <EmptyTitle>No models yet</EmptyTitle>
                  <EmptyDescription>
                    {spec.canDiscoverModels
                      ? "Discover the models this provider offers, or add one manually."
                      : "Add the models you want to use from this provider."}
                  </EmptyDescription>
                </EmptyHeader>
                <EmptyContent className="flex-row flex-wrap justify-center">
                  {spec.canDiscoverModels && (
                    <DiscoverModelsButton
                      providerId={provider.id}
                      providerName={provider.name}
                    />
                  )}
                  {addModelButton}
                </EmptyContent>
              </Empty>
            </CardContent>
          </Card>
        ) : (
          <ModelsExplorer models={models} providers={[]} providerScoped />
        )}
      </section>
    </>
  )
}
