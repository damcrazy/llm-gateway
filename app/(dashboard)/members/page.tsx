import type { Metadata } from "next"
import { ShieldCheckIcon } from "lucide-react"

import { PageHeader } from "@/components/page-header"
import { Badge } from "@/components/ui/badge"
import { Card, CardContent } from "@/components/ui/card"
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table"
import { requireSuperadmin } from "@/lib/auth"
import type { MemberRow } from "@/lib/db/types"
import { formatUsd } from "@/lib/format"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"

import {
  AddMemberDialog,
  EditAccessButton,
  RemoveMemberButton,
  ResetPasswordButton,
} from "./member-controls"
import { accessSummary } from "./shared"

export const metadata: Metadata = { title: "Members" }

function monthStart(): string {
  const now = new Date()
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1)
  ).toISOString()
}

export default async function MembersPage() {
  const me = await requireSuperadmin()
  const supabase = await createClient()
  const [membersResult, appsResult, routesResult, modelsResult] =
    await Promise.all([
      supabase.from("members").select("*").order("created_at"),
      supabase.from("apps").select("owner_email"),
      supabase.from("routes").select("name").eq("enabled", true).order("name"),
      supabase.from("models").select("slug").eq("enabled", true).order("slug"),
    ])
  const members = (membersResult.data ?? []) as MemberRow[]

  const appCounts = new Map<string, number>()
  for (const app of (appsResult.data ?? []) as { owner_email: string }[]) {
    appCounts.set(app.owner_email, (appCounts.get(app.owner_email) ?? 0) + 1)
  }

  const since = monthStart()
  const spend = new Map(
    await Promise.all(
      members.map(async (member) => {
        const { data } = await supabaseAdmin().rpc("member_spend_since", {
          p_email: member.email,
          p_since: since,
        })
        return [member.email, Number(data ?? 0)] as const
      })
    )
  )

  const options = {
    routes: ((routesResult.data ?? []) as { name: string }[]).map(
      (r) => r.name
    ),
    models: ((modelsResult.data ?? []) as { slug: string }[]).map(
      (m) => m.slug
    ),
  }
  const roleOrder = { superadmin: 0, admin: 1, member: 2 }
  members.sort((a, b) => roleOrder[a.role] - roleOrder[b.role])

  return (
    <>
      <PageHeader
        title="Members"
        description="People who can sign in. Members manage their own apps and keys, limited to the models and budget you set; admins manage everything except people."
        actions={<AddMemberDialog options={options} />}
      />
      <Card className="py-0">
        <CardContent className="px-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="pl-6">Email</TableHead>
                <TableHead>Role</TableHead>
                <TableHead>Model access</TableHead>
                <TableHead className="text-right">Spend this month</TableHead>
                <TableHead className="text-right">Apps</TableHead>
                <TableHead className="w-32 pr-6" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {members.map((member) => {
                const budget =
                  member.monthly_budget_usd == null
                    ? null
                    : Number(member.monthly_budget_usd)
                const spent = spend.get(member.email) ?? 0
                const apps = appCounts.get(member.email) ?? 0
                return (
                  <TableRow key={member.email}>
                    <TableCell className="pl-6 font-medium">
                      {member.email}
                      {member.email === me.email && (
                        <span className="ml-2 text-xs text-muted-foreground">
                          (you)
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      {member.role === "superadmin" ? (
                        <Badge>
                          <ShieldCheckIcon />
                          Superadmin
                        </Badge>
                      ) : member.role === "admin" ? (
                        <Badge variant="secondary">Admin</Badge>
                      ) : (
                        <Badge variant="outline">Member</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {accessSummary(
                        member.role,
                        member.model_access,
                        member.allowed_models
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {formatUsd(spent)}
                      {member.role === "member" && (
                        <span className="text-muted-foreground">
                          {" "}
                          / {budget == null ? "no cap" : formatUsd(budget)}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="text-right tabular-nums">
                      {apps}
                    </TableCell>
                    <TableCell className="pr-6">
                      {member.role !== "superadmin" && (
                        <div className="flex justify-end gap-1">
                          <EditAccessButton
                            email={member.email}
                            options={options}
                            access={{
                              role: member.role,
                              model_access: member.model_access,
                              allowed_models: member.allowed_models ?? [],
                              monthly_budget_usd: budget,
                            }}
                          />
                          <ResetPasswordButton email={member.email} />
                          <RemoveMemberButton
                            email={member.email}
                            appCount={apps}
                          />
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
    </>
  )
}
