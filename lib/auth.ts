import "server-only"

import { cache } from "react"
import { headers } from "next/headers"
import { redirect } from "next/navigation"

import type { MemberRole, MemberRow, ModelAccess } from "@/lib/db/types"
import { env } from "@/lib/env"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"

export interface SessionMember {
  /** auth.users id */
  id: string
  email: string
  role: MemberRole
  isAdmin: boolean
  modelAccess: ModelAccess
  allowedModels: string[]
  monthlyBudgetUsd: number | null
  name: string | null
  avatarUrl: string | null
}

/**
 * The signed-in user, if and only if their email is in public.members.
 * Checked on every request, so removing someone takes effect immediately.
 */
export const getSessionMember = cache(
  async (): Promise<SessionMember | null> => {
    const supabase = await createClient()
    const { data } = await supabase.auth.getClaims()
    const claims = data?.claims
    const email =
      typeof claims?.email === "string" ? claims.email.toLowerCase() : ""
    if (!email) return null

    const { data: row } = await supabaseAdmin()
      .from("members")
      .select("*")
      .eq("email", email)
      .maybeSingle()
    if (!row) return null
    const member = row as MemberRow

    const role: MemberRole =
      email === env.superadminEmail() ? "superadmin" : member.role
    const metadata = (claims?.user_metadata ?? {}) as Record<string, unknown>
    return {
      id: String(claims?.sub ?? ""),
      email,
      role,
      isAdmin: role === "superadmin" || role === "admin",
      modelAccess: member.model_access,
      allowedModels: member.allowed_models ?? [],
      monthlyBudgetUsd:
        member.monthly_budget_usd == null
          ? null
          : Number(member.monthly_budget_usd),
      name: typeof metadata.full_name === "string" ? metadata.full_name : null,
      avatarUrl:
        typeof metadata.avatar_url === "string" ? metadata.avatar_url : null,
    }
  }
)

/** Anyone who may use the dashboard (members, admins, the superadmin). */
export async function requireMember(): Promise<SessionMember> {
  const member = await getSessionMember()
  if (!member) redirect("/login?error=forbidden")
  return member
}

/** Admin-only pages and actions; members are sent back to the overview. */
export async function requireAdmin(): Promise<SessionMember> {
  const member = await requireMember()
  if (!member.isAdmin) redirect("/?error=admin-only")
  return member
}

export async function requireSuperadmin(): Promise<SessionMember> {
  const member = await requireMember()
  if (member.role !== "superadmin") redirect("/?error=superadmin-only")
  return member
}

/** Public origin of this deployment, for redirects and code snippets. */
export async function getOrigin(): Promise<string> {
  const configured = env.appUrl()
  if (configured) return configured
  const h = await headers()
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000"
  const proto =
    h.get("x-forwarded-proto") ??
    (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https")
  return `${proto}://${host}`
}
