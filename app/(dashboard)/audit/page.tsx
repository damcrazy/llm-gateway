import type { Metadata } from "next"
import Link from "next/link"
import { ScrollTextIcon } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card, CardContent } from "@/components/ui/card"
import {
  Empty,
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
import { formatDateTime, formatRelative } from "@/lib/format"
import { createClient } from "@/lib/supabase/server"

import { AuditDetails, AuditFilters } from "./audit-controls"
import { AREAS, PAGE_SIZE, type AuditArea } from "./shared"

export const metadata: Metadata = { title: "Audit log" }

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>
}

const first = (value: string | string[] | undefined) =>
  (Array.isArray(value) ? value[0] : value)?.trim() ?? ""

interface AuditRow {
  id: string
  created_at: string
  actor_email: string
  action: string
  target_type: string | null
  target_id: string | null
  target_name: string | null
  summary: string
  details: Record<string, unknown> | null
}

function targetHref(row: AuditRow): string | null {
  if (!row.target_id) return null
  switch (row.target_type) {
    case "app":
      return `/apps/${row.target_id}`
    case "provider":
      return `/providers/${row.target_id}`
    default:
      return null
  }
}

export default async function AuditPage({ searchParams }: Props) {
  const me = await requireMember()
  const params = await searchParams
  const areaParam = first(params.area)
  const area = AREAS.some((a) => a.value === areaParam)
    ? (areaParam as AuditArea)
    : null
  const actor = me.isAdmin ? first(params.actor).slice(0, 200) : ""
  const before = first(params.before)
  const beforeDate = before && !Number.isNaN(Date.parse(before)) ? before : ""

  // RLS: admins read every entry, members only their own.
  const supabase = await createClient()
  let query = supabase
    .from("audit_log")
    .select(
      "id, created_at, actor_email, action, target_type, target_id, target_name, summary, details"
    )
    .order("created_at", { ascending: false })
    .limit(PAGE_SIZE + 1)
  if (area) query = query.eq("target_type", area)
  if (actor) query = query.eq("actor_email", actor)
  if (beforeDate) query = query.lt("created_at", beforeDate)
  const { data, error } = await query
  if (error) throw new Error(error.message)
  const rows = ((data ?? []) as AuditRow[]).slice(0, PAGE_SIZE)
  const hasMore = (data?.length ?? 0) > PAGE_SIZE

  let actors: string[] = []
  if (me.isAdmin) {
    const { data: recent } = await supabase
      .from("audit_log")
      .select("actor_email")
      .order("created_at", { ascending: false })
      .limit(500)
    actors = [
      ...new Set(
        ((recent ?? []) as { actor_email: string }[]).map((r) => r.actor_email)
      ),
    ].sort()
  }

  const olderHref = (() => {
    const next = new URLSearchParams()
    if (area) next.set("area", area)
    if (actor) next.set("actor", actor)
    next.set("before", rows.at(-1)?.created_at ?? "")
    return `/audit?${next}`
  })()

  return (
    <>
      <PageHeader
        title="Audit log"
        description={
          me.isAdmin
            ? "Every change made in the dashboard, and sign-in and security events. Kept for a year."
            : "Changes you made in the dashboard, and your sign-in and security events. Kept for a year."
        }
      />
      <AuditFilters
        area={area}
        actor={actor}
        actors={actors}
        showActor={me.isAdmin}
      />
      <Card className="py-0">
        <CardContent className="px-0">
          {rows.length === 0 ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ScrollTextIcon />
                </EmptyMedia>
                <EmptyTitle>Nothing here yet</EmptyTitle>
                <EmptyDescription>
                  Changes to apps, keys, providers, models, routes, people and
                  settings show up here.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="pl-6">When</TableHead>
                  {me.isAdmin && <TableHead>Who</TableHead>}
                  <TableHead>What</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead className="w-24 pr-6" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((row) => {
                  const href = targetHref(row)
                  return (
                    <TableRow key={row.id}>
                      <TableCell
                        className="pl-6 whitespace-nowrap text-muted-foreground"
                        title={formatDateTime(row.created_at)}
                      >
                        {formatRelative(row.created_at)}
                      </TableCell>
                      {me.isAdmin && (
                        <TableCell className="max-w-56 truncate">
                          {row.actor_email}
                        </TableCell>
                      )}
                      <TableCell className="min-w-64">
                        {href ? (
                          <Link
                            href={href}
                            className="underline-offset-4 hover:underline"
                          >
                            {row.summary}
                          </Link>
                        ) : (
                          row.summary
                        )}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className="font-mono font-normal"
                        >
                          {row.action}
                        </Badge>
                      </TableCell>
                      <TableCell className="pr-6 text-right">
                        {row.details && Object.keys(row.details).length > 0 && (
                          <AuditDetails details={row.details} />
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
      {hasMore && (
        <div className="flex justify-center">
          <Button variant="outline" asChild>
            <Link href={olderHref}>Older entries</Link>
          </Button>
        </div>
      )}
    </>
  )
}
