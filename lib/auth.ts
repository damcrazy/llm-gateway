import "server-only"

import { cache } from "react"
import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { audit } from "@/lib/audit"
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
  /** How this session was signed in (password, oauth, otp, totp, …). */
  authMethods: { method: string; timestamp: number }[]
}

/**
 * Where the signed-in person is in the sign-in flow. Two-factor
 * authentication is required for everyone: a session only counts once it
 * reaches aal2 (an authenticator code was verified).
 */
export type SessionState =
  | { status: "signed_out" }
  | { status: "not_member" }
  | { status: "mfa_setup"; member: SessionMember }
  | { status: "mfa_challenge"; member: SessionMember }
  | { status: "ok"; member: SessionMember }

function parseAmr(value: unknown): { method: string; timestamp: number }[] {
  if (!Array.isArray(value)) return []
  return value.map((entry) =>
    typeof entry === "string"
      ? { method: entry, timestamp: 0 }
      : {
          method: String((entry as { method?: unknown }).method ?? ""),
          timestamp: Number((entry as { timestamp?: unknown }).timestamp ?? 0),
        }
  )
}

/** Verified authenticator-app factors for a user. */
export async function verifiedTotpFactors(userId: string) {
  const { data, error } = await supabaseAdmin().auth.admin.mfa.listFactors({
    userId,
  })
  if (error) throw new Error(error.message)
  return (data?.factors ?? []).filter(
    (factor) => factor.factor_type === "totp" && factor.status === "verified"
  )
}

/** Whether the account has a password (Google-only accounts don't). */
export async function userHasPassword(userId: string): Promise<boolean> {
  const { data, error } = await supabaseAdmin().rpc("user_has_password", {
    p_user_id: userId,
  })
  if (error) throw new Error(error.message)
  return data === true
}

/**
 * SUPERADMIN_EMAIL's first sign-in on a new install: store the superadmin
 * role in the database, where row-level security reads it. Only for a
 * confirmed address. This relies on "Confirm email" being on in Supabase
 * Auth: with it off, every address counts as confirmed at sign-up, so
 * whoever signed up with this email first would get the role.
 */
async function promoteSuperadmin(
  userId: string,
  email: string
): Promise<MemberRow | null> {
  const db = supabaseAdmin()
  const { data: user } = await db.auth.admin.getUserById(userId)
  if (!user.user?.email_confirmed_at) return null

  const { data, error } = await db
    .from("members")
    .upsert(
      {
        email,
        role: "superadmin",
        model_access: "all",
        monthly_budget_usd: null,
        added_by: "SUPERADMIN_EMAIL",
      },
      { onConflict: "email" }
    )
    .select("*")
    .single()
  if (error) {
    console.error("[auth] could not make the superadmin:", error.message)
    return null
  }
  await audit(email, "member.superadmin", `${email} became the superadmin`, {
    type: "member",
    id: email,
    name: email,
  })
  return data as MemberRow
}

/**
 * The signed-in person and how far they are through sign-in. Membership is
 * checked on every request, so removing someone takes effect immediately.
 */
export const getSessionState = cache(async (): Promise<SessionState> => {
  const supabase = await createClient()
  const { data } = await supabase.auth.getClaims()
  const claims = data?.claims
  const email =
    typeof claims?.email === "string" ? claims.email.toLowerCase() : ""
  if (!claims || !email) return { status: "signed_out" }

  const { data: row } = await supabaseAdmin()
    .from("members")
    .select("*")
    .eq("email", email)
    .maybeSingle()
  let memberRow = row as MemberRow | null
  if (email === env.superadminEmail() && memberRow?.role !== "superadmin")
    memberRow =
      (await promoteSuperadmin(String(claims.sub ?? ""), email)) ?? memberRow
  if (!memberRow) return { status: "not_member" }

  const role: MemberRole = memberRow.role
  const metadata = (claims.user_metadata ?? {}) as Record<string, unknown>
  const member: SessionMember = {
    id: String(claims.sub ?? ""),
    email,
    role,
    isAdmin: role === "superadmin" || role === "admin",
    modelAccess: memberRow.model_access,
    allowedModels: memberRow.allowed_models ?? [],
    monthlyBudgetUsd:
      memberRow.monthly_budget_usd == null
        ? null
        : Number(memberRow.monthly_budget_usd),
    name:
      typeof metadata.full_name === "string"
        ? metadata.full_name
        : typeof metadata.name === "string"
          ? metadata.name
          : null,
    avatarUrl:
      typeof metadata.avatar_url === "string" ? metadata.avatar_url : null,
    authMethods: parseAmr(claims.amr),
  }

  if (claims.aal === "aal2") return { status: "ok", member }
  const factors = await verifiedTotpFactors(member.id)
  return factors.length > 0
    ? { status: "mfa_challenge", member }
    : { status: "mfa_setup", member }
})

/** The member, only once they're fully signed in (including 2FA). */
export async function getSessionMember(): Promise<SessionMember | null> {
  const state = await getSessionState()
  return state.status === "ok" ? state.member : null
}

/** Where to send someone who isn't fully signed in yet. */
export function pathForState(state: SessionState): string {
  switch (state.status) {
    case "ok":
      // Back to a remembered deep link, if any (else the overview).
      return "/auth/continue"
    case "mfa_setup":
      return "/mfa/setup"
    case "mfa_challenge":
      return "/mfa"
    case "not_member":
      return "/login?error=forbidden"
    default:
      return "/login"
  }
}

/** Anyone who may use the dashboard (members, admins, the superadmin). */
export async function requireMember(): Promise<SessionMember> {
  const state = await getSessionState()
  if (state.status !== "ok") redirect(pathForState(state))
  return state.member
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
