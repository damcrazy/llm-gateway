import type { Metadata } from "next"
import Link from "next/link"
import { BoxesIcon } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert"
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
import type { AppRow, UsageBreakdownRow } from "@/lib/db/types"
import { formatDateTime, formatNumber, formatUsd } from "@/lib/format"
import { createClient } from "@/lib/supabase/server"

import { daysAgo, keyStatus, type ApiKeyListRow } from "./_lib"
import { NewAppDialog } from "./new-app-dialog"

export const metadata: Metadata = { title: "Apps & keys" }

export default async function AppsPage() {
  const me = await requireMember()
  const supabase = await createClient()

  const [appsResult, keysResult, usageResult] = await Promise.all([
    supabase.from("apps").select("*").order("created_at", { ascending: false }),
    supabase.from("api_keys").select("app_id, revoked_at, expires_at"),
    supabase.rpc("usage_breakdown", {
      p_since: daysAgo(30),
      p_dimension: "app",
    }),
  ])

  const apps = (appsResult.data ?? []) as AppRow[]
  const keys = (keysResult.data ?? []) as Pick<
    ApiKeyListRow,
    "app_id" | "revoked_at" | "expires_at"
  >[]
  const usage = (usageResult.data ?? []) as UsageBreakdownRow[]

  const activeKeys = new Map<string, number>()
  for (const key of keys) {
    if (keyStatus(key) !== "active") continue
    activeKeys.set(key.app_id, (activeKeys.get(key.app_id) ?? 0) + 1)
  }
  const usageByApp = new Map(
    usage.filter((row) => row.id).map((row) => [row.id as string, row])
  )

  const error = appsResult.error ?? keysResult.error ?? usageResult.error

  return (
    <>
      <PageHeader
        title="Apps & keys"
        description="Each project that calls the gateway is an app with its own API keys, limits and usage."
        actions={<NewAppDialog />}
      />
      {error && (
        <Alert variant="destructive">
          <AlertTitle>Could not load everything</AlertTitle>
          <AlertDescription>{error.message}</AlertDescription>
        </Alert>
      )}
      <Card className="py-0">
        <CardContent className="px-0">
          {apps.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <BoxesIcon />
                </EmptyMedia>
                <EmptyTitle>No apps yet</EmptyTitle>
                <EmptyDescription>
                  Create an app for each project, then give it an API key to
                  call the gateway.
                </EmptyDescription>
              </EmptyHeader>
              <EmptyContent>
                <NewAppDialog label="Create your first app" />
              </EmptyContent>
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">Name</TableHead>
                  <TableHead>Slug</TableHead>
                  {me.isAdmin && <TableHead>Owner</TableHead>}
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Active keys</TableHead>
                  <TableHead className="text-right">Requests (30d)</TableHead>
                  <TableHead className="text-right">Spend (30d)</TableHead>
                  <TableHead className="pr-6">Created</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {apps.map((app) => {
                  const stats = usageByApp.get(app.id)
                  return (
                    <TableRow key={app.id}>
                      <TableCell className="max-w-72 pl-6 font-medium">
                        <Link
                          href={`/apps/${app.id}`}
                          className="block truncate hover:underline"
                        >
                          {app.name}
                        </Link>
                        {app.description && (
                          <p className="truncate text-xs font-normal text-muted-foreground">
                            {app.description}
                          </p>
                        )}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted-foreground">
                        {app.slug}
                      </TableCell>
                      {me.isAdmin && (
                        <TableCell className="text-muted-foreground">
                          {app.owner_email === me.email
                            ? "You"
                            : app.owner_email}
                        </TableCell>
                      )}
                      <TableCell>
                        {app.enabled ? (
                          <Badge variant="secondary">Enabled</Badge>
                        ) : (
                          <Badge variant="outline">Disabled</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {activeKeys.get(app.id) ?? 0}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatNumber(Number(stats?.requests ?? 0))}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatUsd(Number(stats?.cost_usd ?? 0))}
                      </TableCell>
                      <TableCell className="pr-6 text-muted-foreground">
                        {formatDateTime(app.created_at)}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </>
  )
}
