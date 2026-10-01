"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { actionError, type ActionResult } from "@/lib/actions"
import { requireSuperadmin } from "@/lib/auth"
import { findAuthUserByEmail, upsertPasswordUser } from "@/lib/auth-users"
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
  const problem = passwordProblem(password)
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
    await upsertPasswordUser(parsedEmail.data, password)
  } catch (accountError) {
    await db.from("members").delete().eq("email", parsedEmail.data)
    return actionError(accountError)
  }

  refresh()
  return {
    ok: true,
    message: `${parsedEmail.data} can now sign in with the password you set`,
  }
}

export async function updateMember(
  email: string,
  access: MemberAccessInput
): Promise<ActionResult> {
  await requireSuperadmin()
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

  refresh()
  return { ok: true, message: `Access updated for ${target}` }
}

export async function resetMemberPassword(
  email: string,
  password: string
): Promise<ActionResult> {
  await requireSuperadmin()
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
  return { ok: true, message: `Password reset for ${target}` }
}

export async function removeMember(email: string): Promise<ActionResult> {
  await requireSuperadmin()
  const target = email.toLowerCase()
  if (target === env.superadminEmail()) {
    return { ok: false, error: "The superadmin cannot be removed" }
  }

  const db = supabaseAdmin()
  // Their apps and API keys are deleted with them (foreign key cascade).
  const { error } = await db.from("members").delete().eq("email", target)
  if (error) return actionError(error)

  // Delete their account too, so any live session stops refreshing.
  const user = await findAuthUserByEmail(target).catch(() => null)
  if (user) await db.auth.admin.deleteUser(user.id)

  refresh()
  return {
    ok: true,
    message: `${target} no longer has access; their apps and keys were deleted`,
  }
}
