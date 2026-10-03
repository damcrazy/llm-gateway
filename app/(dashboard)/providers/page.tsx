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
import { createClient } from "@/lib/supabase/server"

import { AddProviderDialog } from "./add-provider-dialog"
import { ProviderEnabledSwitch } from "./provider-controls"
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
        title={me.isAdmin ? "Providers" : "Your providers"}
        description={
          me.isAdmin
            ? "Shared upstream APIs: every member can use their models, within the access you give them. Credentials are encrypted at rest and never leave the server."
            : "Connect your own API keys. Their models can only be used by your apps, and you pay the provider directly. Credentials are encrypted at rest and never leave the server."
        }
        actions={
          providers.length > 0 && (
            <AddProviderDialog own={!me.isAdmin} slugPrefix={slugPrefix} />
          )
        }
      />

      {providers.length === 0 ? (
        <Empty className="border" data-tour="providers-empty">
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
