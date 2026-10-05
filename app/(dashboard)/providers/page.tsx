import type { Metadata } from "next"
import Link from "next/link"
import { ChevronRightIcon, KeyRoundIcon, ServerIcon } from "lucide-react"

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
import { requireMember } from "@/lib/auth"
import type { ProviderRow } from "@/lib/db/types"
import { loadCredentialHints } from "@/lib/providers/secrets"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"

import { AddProviderDialog } from "./add-provider-dialog"
import { ProviderEnabledSwitch } from "./provider-controls"
import {
  LeaveProviderButton,
  UseInMyAppsSwitch,
} from "./shared-provider-controls"
import { describeEndpoint, providerKindLabel } from "./shared"

export const metadata: Metadata = { title: "Providers" }

export default async function ProvidersPage() {
  const me = await requireMember()
  const supabase = await createClient()
  // RLS: admins read every provider, members only their own.
  const [{ data: providerData }, { data: modelData }, hints] =
    await Promise.all([
      supabase.from("providers").select("*").order("created_at"),
      supabase.from("models").select("provider_id, enabled"),
      loadCredentialHints(),
    ])
  const all = (providerData ?? []) as ProviderRow[]
  // Admins manage the shared providers; members manage their own.
  const providers = all.filter((provider) =>
    me.isAdmin
      ? provider.owner_email === null
      : provider.owner_email === me.email
  )
  // Slugs are global; prefix members' own with their name to avoid clashes.
  const slugPrefix = me.email
    .split("@")[0]!
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 20)
  const membersProviders = me.isAdmin
    ? all.filter((provider) => provider.owner_email !== null)
    : []

  // Providers you can use but don't own: shared with you by their owner,
  // and (for members) the gateway's own. Each can be switched off for you.
  const admin = supabaseAdmin()
  const [{ data: shareRows }, { data: optOutRows }] = await Promise.all([
    admin
      .from("provider_shares")
      .select("provider_id")
      .eq("member_email", me.email),
    admin
      .from("provider_opt_outs")
      .select("provider_id")
      .eq("member_email", me.email),
  ])
  const sharedIds = (shareRows ?? []).map((row) => row.provider_id as string)
  const switchedOff = new Set(
    (optOutRows ?? []).map((row) => row.provider_id as string)
  )
  const [{ data: otherRows }, { data: otherModels }] = await Promise.all([
    // Names and owners only: never another member's settings or keys.
    me.isAdmin && !sharedIds.length
      ? Promise.resolve({ data: [] })
      : admin
          .from("providers")
          .select("id, name, slug, type, owner_email, enabled")
          .or(
            [
              ...(me.isAdmin ? [] : ["owner_email.is.null"]),
              ...(sharedIds.length ? [`id.in.(${sharedIds.join(",")})`] : []),
            ].join(",")
          ),
    admin.from("models").select("provider_id, enabled").eq("enabled", true),
  ])
  type OtherProvider = {
    id: string
    name: string
    slug: string
    type: ProviderRow["type"]
    owner_email: string | null
    enabled: boolean
  }
  const others = ((otherRows ?? []) as OtherProvider[]).filter(
    (provider) => provider.enabled
  )
  const sharedWithMe = others
    .filter((provider) => provider.owner_email !== null)
    .sort((a, b) => a.name.localeCompare(b.name))
  const gatewayProviders = me.isAdmin
    ? []
    : others
        .filter((provider) => provider.owner_email === null)
        .sort((a, b) => a.name.localeCompare(b.name))
  const liveModels = new Map<string, number>()
  for (const row of (otherModels ?? []) as { provider_id: string }[])
    liveModels.set(row.provider_id, (liveModels.get(row.provider_id) ?? 0) + 1)
  const hasOthers = sharedWithMe.length > 0 || gatewayProviders.length > 0

  const counts = new Map<string, { total: number; enabled: number }>()
  for (const row of (modelData ?? []) as {
    provider_id: string
    enabled: boolean
  }[]) {
    const count = counts.get(row.provider_id) ?? { total: 0, enabled: 0 }
    count.total += 1
    if (row.enabled) count.enabled += 1
    counts.set(row.provider_id, count)
  }

  return (
    <>
      <PageTour id="providers" />
      <PageHeader
        title="Providers"
        description={
          me.isAdmin
            ? "Shared upstream APIs: every member can use their models, within the access you give them. Credentials are encrypted at rest and never leave the server."
            : "Connect your own API keys, use ones people share with you, and choose which of the gateway's providers your apps use. Credentials are encrypted at rest and never leave the server."
        }
        actions={
          providers.length > 0 && (
            <AddProviderDialog own={!me.isAdmin} slugPrefix={slugPrefix} />
          )
        }
      />

      {providers.length === 0 ? (
        <Empty
          className={hasOthers ? "flex-none border py-10" : "border"}
          data-tour="providers-empty"
        >
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ServerIcon />
            </EmptyMedia>
            <EmptyTitle>No providers yet</EmptyTitle>
            <EmptyDescription>
              {me.isAdmin
                ? "Connect OpenAI, Anthropic, Bedrock, Vertex, a local Ollama or anything OpenAI-compatible, then add its models."
                : "Bring your own OpenAI, Anthropic, Gemini, OpenRouter… key. Only your apps can use its models, and they're not limited by the free-models plan."}
            </EmptyDescription>
          </EmptyHeader>
          <EmptyContent>
            <AddProviderDialog own={!me.isAdmin} slugPrefix={slugPrefix} />
          </EmptyContent>
        </Empty>
      ) : (
        <Card className="py-0" data-tour="providers-table">
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Provider</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Endpoint</TableHead>
                  <TableHead data-tour="providers-col-credentials">
                    Credentials
                  </TableHead>
                  <TableHead
                    data-tour="providers-col-models"
                    className="text-right"
                  >
                    Models
                  </TableHead>
                  <TableHead data-tour="providers-col-enabled">
                    Enabled
                  </TableHead>
                  <TableHead className="w-12 pr-6">
                    <span className="sr-only">Open</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {providers.map((provider, index) => {
                  const { typeLabel, presetLabel } = providerKindLabel(
                    provider.type,
                    provider.config
                  )
                  const hint = hints.get(provider.id)
                  const count = counts.get(provider.id) ?? {
                    total: 0,
                    enabled: 0,
                  }
                  return (
                    <TableRow key={provider.id}>
                      <TableCell className="pl-6">
                        <Link
                          href={`/providers/${provider.id}`}
                          data-tour={index === 0 ? "providers-open" : undefined}
                          className="font-medium underline-offset-4 hover:underline"
                        >
                          {provider.name}
                        </Link>
                        <div className="font-mono text-xs text-muted-foreground">
                          {provider.slug}
                        </div>
                      </TableCell>
                      <TableCell>
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Badge variant="secondary">{typeLabel}</Badge>
                          {presetLabel && (
                            <Badge variant="outline">{presetLabel}</Badge>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>
                        <span
                          className="block max-w-64 truncate font-mono text-xs text-muted-foreground"
                          title={describeEndpoint(
                            provider.type,
                            provider.config
                          )}
                        >
                          {describeEndpoint(provider.type, provider.config)}
                        </span>
                      </TableCell>
                      <TableCell>
                        {hint ? (
                          <span className="inline-flex items-center gap-1.5 font-mono text-xs">
                            <KeyRoundIcon className="size-3.5 text-muted-foreground" />
                            {hint}
                          </span>
                        ) : (
                          <span className="text-muted-foreground">None</span>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {count.total}
                        {count.enabled !== count.total && (
                          <div className="text-xs text-muted-foreground">
                            {count.enabled} enabled
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        <ProviderEnabledSwitch
                          id={provider.id}
                          name={provider.name}
                          enabled={provider.enabled}
                        />
                      </TableCell>
                      <TableCell className="pr-6 text-right">
                        <Button variant="ghost" size="icon-sm" asChild>
                          <Link
                            href={`/providers/${provider.id}`}
                            aria-label={`Open ${provider.name}`}
                          >
                            <ChevronRightIcon />
                          </Link>
                        </Button>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {sharedWithMe.length > 0 && (
        <Card className="py-0" data-tour="providers-shared-with-me">
          <CardContent className="px-0">
            <div className="px-6 pt-5 pb-2">
              <h2 className="font-medium">Shared with you</h2>
              <p className="text-sm text-muted-foreground">
                Other people&apos;s providers you accepted an invite for. Your
                apps can use their models; their owner&apos;s key pays and they
                can take access back at any time.
              </p>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Provider</TableHead>
                  <TableHead>Shared by</TableHead>
                  <TableHead className="text-right">Models</TableHead>
                  <TableHead>Use in my apps</TableHead>
                  <TableHead className="w-24 pr-6" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sharedWithMe.map((provider) => (
                  <TableRow key={provider.id}>
                    <TableCell className="pl-6">
                      <div className="font-medium">{provider.name}</div>
                      <div className="font-mono text-xs text-muted-foreground">
                        {provider.slug}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {provider.owner_email}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {liveModels.get(provider.id) ?? 0}
                    </TableCell>
                    <TableCell>
                      <UseInMyAppsSwitch
                        providerId={provider.id}
                        name={provider.name}
                        on={!switchedOff.has(provider.id)}
                      />
                    </TableCell>
                    <TableCell className="pr-6 text-right">
                      <LeaveProviderButton
                        providerId={provider.id}
                        name={provider.name}
                        owner={provider.owner_email!}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {gatewayProviders.length > 0 && (
        <Card className="py-0" data-tour="providers-gateway">
          <CardContent className="px-0">
            <div className="px-6 pt-5 pb-2">
              <h2 className="font-medium">From the gateway</h2>
              <p className="text-sm text-muted-foreground">
                Providers the gateway&apos;s owner set up for everyone, within
                your account&apos;s model access. Switch one off and your apps
                stop using it; it stays on for everyone else.
              </p>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Provider</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Models</TableHead>
                  <TableHead className="pr-6">Use in my apps</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {gatewayProviders.map((provider) => (
                  <TableRow key={provider.id}>
                    <TableCell className="pl-6">
                      <div className="font-medium">{provider.name}</div>
                      <div className="font-mono text-xs text-muted-foreground">
                        {provider.slug}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {providerKindLabel(provider.type, {}).typeLabel}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {liveModels.get(provider.id) ?? 0}
                    </TableCell>
                    <TableCell className="pr-6">
                      <UseInMyAppsSwitch
                        providerId={provider.id}
                        name={provider.name}
                        on={!switchedOff.has(provider.id)}
                      />
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      )}

      {membersProviders.length > 0 && (
        <Card className="py-0" data-tour="providers-members-own">
          <CardContent className="px-0">
            <div className="px-6 pt-5 pb-2">
              <h2 className="font-medium">Members&apos; own providers</h2>
              <p className="text-sm text-muted-foreground">
                Connected by members with their own keys. Only the owner&apos;s
                apps can use them; you can&apos;t open or edit them here.
              </p>
            </div>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Provider</TableHead>
                  <TableHead>Owner</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="pr-6 text-right">Models</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {membersProviders.map((provider) => (
                  <TableRow key={provider.id}>
                    <TableCell className="pl-6">
                      <div className="font-medium">{provider.name}</div>
                      <div className="font-mono text-xs text-muted-foreground">
                        {provider.slug}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {provider.owner_email}
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {
                          providerKindLabel(provider.type, provider.config)
                            .typeLabel
                        }
                      </Badge>
                    </TableCell>
                    <TableCell className="pr-6 text-right tabular-nums">
                      {counts.get(provider.id)?.total ?? 0}
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
