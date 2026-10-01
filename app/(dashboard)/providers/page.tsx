import type { Metadata } from "next"
import Link from "next/link"
import { ChevronRightIcon, KeyRoundIcon, ServerIcon } from "lucide-react"

import { Button } from "@/components/animate-ui/components/buttons/button"
import { PageHeader } from "@/components/page-header"
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
import type { ProviderRow } from "@/lib/db/types"
import { loadCredentialHints } from "@/lib/providers/secrets"
import { createClient } from "@/lib/supabase/server"

import { AddProviderDialog } from "./add-provider-dialog"
import { ProviderEnabledSwitch } from "./provider-controls"
import { describeEndpoint, providerKindLabel } from "./shared"

export const metadata: Metadata = { title: "Providers" }

export default async function ProvidersPage() {
  await requireAdmin()
  const supabase = await createClient()
  const [{ data: providerData }, { data: modelData }, hints] =
    await Promise.all([
      supabase.from("providers").select("*").order("created_at"),
      supabase.from("models").select("provider_id, enabled"),
      loadCredentialHints(),
    ])
  const providers = (providerData ?? []) as ProviderRow[]

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
      <PageHeader
        title="Providers"
        description="Upstream APIs the gateway calls. Credentials are encrypted at rest and never leave the server."
        actions={providers.length > 0 && <AddProviderDialog />}
      />

      {providers.length === 0 ? (
        <Card>
          <CardContent>
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ServerIcon />
                </EmptyMedia>
                <EmptyTitle>No providers yet</EmptyTitle>
                <EmptyDescription>
                  Connect OpenAI, Anthropic, Bedrock, Vertex, a local Ollama or
                  anything OpenAI-compatible, then add its models.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <AddProviderDialog />
              </EmptyContent>
            </Empty>
          </CardContent>
        </Card>
      ) : (
        <Card className="py-0">
          <CardContent className="px-0">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Provider</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Endpoint</TableHead>
                  <TableHead>Credentials</TableHead>
                  <TableHead className="text-right">Models</TableHead>
                  <TableHead>Enabled</TableHead>
                  <TableHead className="w-12 pr-6">
                    <span className="sr-only">Open</span>
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {providers.map((provider) => {
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
    </>
  )
}
