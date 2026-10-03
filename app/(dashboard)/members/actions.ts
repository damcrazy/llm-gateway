"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { actionError, type ActionResult } from "@/lib/actions"
import { audit } from "@/lib/audit"
import { requireSuperadmin, verifiedTotpFactors } from "@/lib/auth"
import {
  ensureUser,
  findAuthUserByEmail,
  upsertPasswordUser,
} from "@/lib/auth-users"
import { env } from "@/lib/env"
import { invalidateApiKeyCache } from "@/lib/gateway/auth"
import { passwordProblem } from "@/lib/password"
import { supabaseAdmin } from "@/lib/supabase/admin"

import type { MemberAccessInput } from "./shared"

const emailSchema = z.email().transform((value) => value.trim().toLowerCase())

const accessSchema = z
  .object({
    role: z.enum(["member", "admin"]),
    model_access: z.enum(["all", "free", "allowlist"]),
    allowed_models: z.array(z.string().trim().min(1).max(200)).max(500),
    monthly_budget_usd: z
      .number()
      .min(0, "Budget can't be negative")
      .max(1_000_000)
      .nullable(),
  })
  .transform((access) =>
    // Admins are never restricted.
    access.role === "admin"
      ? {
          role: access.role,
          model_access: "all" as const,
          allowed_models: [],
          monthly_budget_usd: null,
        }
      : { ...access, allowed_models: [...new Set(access.allowed_models)] }
  )
  .refine(
    (access) =>
      access.model_access !== "allowlist" || access.allowed_models.length > 0,
    "Pick at least one route or model, or choose a different access level"
  )

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? "Invalid input"
}

function refresh() {
  invalidateApiKeyCache()
  revalidatePath("/members")
}

export async function addMember(
  email: string,
  password: string,
  access: MemberAccessInput
): Promise<ActionResult> {
  const me = await requireSuperadmin()
  const parsedEmail = emailSchema.safeParse(email)
  if (!parsedEmail.success)
    return { ok: false, error: "Enter a valid email address" }
  const parsedAccess = accessSchema.safeParse(access)
  if (!parsedAccess.success)
    return { ok: false, error: firstIssue(parsedAccess.error) }
  // Optional: people who'll sign in with Google don't need a password.
  const problem = password ? passwordProblem(password) : null
  if (problem) return { ok: false, error: problem }

  const db = supabaseAdmin()
  const { error } = await db.from("members").insert({
    email: parsedEmail.data,
    added_by: me.email,
    ...parsedAccess.data,
  })
  if (error) {
    return error.code === "23505"
      ? { ok: false, error: "That email already has access" }
      : actionError(error)
  }

  try {
    if (password) await upsertPasswordUser(parsedEmail.data, password)
    else await ensureUser(parsedEmail.data)
  } catch (accountError) {
    await db.from("members").delete().eq("email", parsedEmail.data)
    return actionError(accountError)
  }

  await audit(
    me.email,
    "member.add",
    `Added member ${parsedEmail.data} as ${parsedAccess.data.role}`,
    { type: "member", id: parsedEmail.data, name: parsedEmail.data },
    { ...parsedAccess.data, signIn: password ? "password" : "google" }
  )
  refresh()
  return {
    ok: true,
    message: password
      ? `${parsedEmail.data} can now sign in with the password you set`
      : `${parsedEmail.data} can now sign in with Google`,
  }
}

export async function updateMember(
  email: string,
  access: MemberAccessInput
): Promise<ActionResult> {
  const me = await requireSuperadmin()
  const target = email.toLowerCase()
  if (target === env.superadminEmail()) {
    return { ok: false, error: "The superadmin always has full access" }
  }
  const parsedAccess = accessSchema.safeParse(access)
  if (!parsedAccess.success)
    return { ok: false, error: firstIssue(parsedAccess.error) }

  const { data, error } = await supabaseAdmin()
    .from("members")
    .update(parsedAccess.data)
    .eq("email", target)
    .select("email")
    .maybeSingle()
  if (error) return actionError(error)
  if (!data) return { ok: false, error: "That person no longer has access" }

  await audit(
    me.email,
    "member.update",
    `Changed access of member ${target}`,
    { type: "member", id: target, name: target },
    parsedAccess.data
  )
  refresh()
  return { ok: true, message: `Access updated for ${target}` }
}

export async function resetMemberPassword(
  email: string,
  password: string
): Promise<ActionResult> {
  const me = await requireSuperadmin()
  const target = email.toLowerCase()
  const problem = passwordProblem(password)
  if (problem) return { ok: false, error: problem }

  const { data: member } = await supabaseAdmin()
    .from("members")
    .select("email")
    .eq("email", target)
    .maybeSingle()
  if (!member) return { ok: false, error: "That person doesn't have access" }

  try {
    await upsertPasswordUser(target, password)
  } catch (error) {
    return actionError(error)
  }
  await audit(
    me.email,
    "member.reset_password",
    `Reset password of member ${target}`,
    { type: "member", id: target, name: target }
  )
  return { ok: true, message: `Password reset for ${target}` }
}

export async function removeMember(email: string): Promise<ActionResult> {
  const me = await requireSuperadmin()
  const target = email.toLowerCase()
  if (target === env.superadminEmail()) {
    return { ok: false, error: "The superadmin cannot be removed" }
  }

  const db = supabaseAdmin()
  // Their apps and API keys are deleted with them (foreign key cascade).
  const { data, error } = await db
    .from("members")
    .delete()
    .eq("email", target)
    .select("email")
  if (error) return actionError(error)

  // Delete their account too, so any live session stops refreshing.
  const user = await findAuthUserByEmail(target).catch(() => null)
  if (user) await db.auth.admin.deleteUser(user.id)

  if (data?.length || user) {
    await audit(me.email, "member.remove", `Removed member ${target}`, {
      type: "member",
      id: target,
      name: target,
    })
  }
  refresh()
  return {
    ok: true,
    message: `${target} no longer has access; their apps and keys were deleted`,
  }
}

/**
 * Removes someone's authenticators (e.g. they lost their phone and can't use
 * the email fallback). They must set up a new one at their next sign-in.
 */
export async function resetMemberTwoFactor(
  email: string
): Promise<ActionResult> {
  const me = await requireSuperadmin()
  const target = email.toLowerCase()
  if (target === me.email) {
    return {
      ok: false,
      error: "Manage your own authenticators on the Account & security page",
    }
  }
  const user = await findAuthUserByEmail(target).catch(() => null)
  if (!user) return { ok: false, error: "That person hasn't signed in yet" }
  let removed = 0
  try {
    const factors = await verifiedTotpFactors(user.id)
    for (const factor of factors) {
      const { error } = await supabaseAdmin().auth.admin.mfa.deleteFactor({
        id: factor.id,
        userId: user.id,
      })
      if (error) throw new Error(error.message)
      removed++
    }
  } catch (error) {
    return actionError(error)
  }
  if (removed > 0) {
    await audit(
      me.email,
      "member.reset_2fa",
      `Reset two-factor authentication of member ${target}`,
      { type: "member", id: target, name: target },
      { authenticatorsRemoved: removed }
    )
  }
  revalidatePath("/members")
  return {
    ok: true,
    message: `2FA reset for ${target}; they'll set it up again at next sign-in`,
  }
}

/**
 * Creates a sign-in account (no password) for someone who's listed but has
 * none, e.g. added before Google sign-in existed. Public sign-ups are off, so
 * Google sign-in only works once the account exists.
 */
export async function createMemberAccount(
  email: string
): Promise<ActionResult> {
  const me = await requireSuperadmin()
  const target = email.toLowerCase()
  const { data: member } = await supabaseAdmin()
    .from("members")
    .select("email")
    .eq("email", target)
    .maybeSingle()
  if (!member) return { ok: false, error: "Not a member" }
  try {
    await ensureUser(target)
  } catch (error) {
    return actionError(error)
  }
  await audit(
    me.email,
    "member.create_account",
    `Created a sign-in account for member ${target}`,
    { type: "member", id: target, name: target }
  )
  revalidatePath("/members")
  return {
    ok: true,
    message: `${target} can now sign in with Google, or set a password with “Forgot password?”`,
  }
}
