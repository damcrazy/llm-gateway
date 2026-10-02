"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { actionError, type ActionResult } from "@/lib/actions"
import { requireMember, userHasPassword, verifiedTotpFactors } from "@/lib/auth"
import { setUserPassword } from "@/lib/auth-users"
import { passwordProblem } from "@/lib/password"
import { supabaseAdmin } from "@/lib/supabase/admin"

/** Removes one of your authenticators; 2FA is required, so never the last. */
export async function removeAuthenticator(
  factorId: string
): Promise<ActionResult> {
  const me = await requireMember()
  if (!z.uuid().safeParse(factorId).success) {
    return { ok: false, error: "Unknown authenticator" }
  }
  try {
    const factors = await verifiedTotpFactors(me.id)
    if (!factors.some((factor) => factor.id === factorId)) {
      return { ok: false, error: "Unknown authenticator" }
    }
    if (factors.length <= 1) {
      return {
        ok: false,
        error:
          "Add another authenticator first: two-factor authentication is required.",
      }
    }
    const { error } = await supabaseAdmin().auth.admin.mfa.deleteFactor({
      id: factorId,
      userId: me.id,
    })
    if (error) return actionError(error)
  } catch (error) {
    return actionError(error)
  }
  revalidatePath("/account")
  return { ok: true, message: "Authenticator removed" }
}

/**
 * Adds a password to an account that only signs in with Google, so the same
 * account can also sign in with email and password. Changing an existing
 * password goes through changePassword, which asks for the current one.
 */
export async function setPassword(password: string): Promise<ActionResult> {
  const me = await requireMember()
  const problem = passwordProblem(password)
  if (problem) return { ok: false, error: problem }
  try {
    if (await userHasPassword(me.id)) {
      return {
        ok: false,
        error: "You already have a password. Use Change password instead.",
      }
    }
    await setUserPassword(me.id, password)
  } catch (error) {
    return actionError(error)
  }
  revalidatePath("/account")
  return {
    ok: true,
    message: "Password set. You can now sign in with your email too.",
  }
}
