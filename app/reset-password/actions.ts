"use server"

import { redirect } from "next/navigation"

import { actionError, type ActionResult } from "@/lib/actions"
import { audit } from "@/lib/audit"
import { getSessionState } from "@/lib/auth"
import { setUserPassword } from "@/lib/auth-users"
import { passwordProblem } from "@/lib/password"
import { createClient } from "@/lib/supabase/server"

import { canResetPassword } from "./policy"

export async function completePasswordReset(
  password: string
): Promise<ActionResult> {
  const state = await getSessionState()
  if (!canResetPassword(state) || !("member" in state)) {
    return {
      ok: false,
      error: "This reset link has expired. Request a new one.",
    }
  }
  const problem = passwordProblem(password)
  if (problem) return { ok: false, error: problem }

  // Recorded so the lost-authenticator email fallback stays off for a while:
  // otherwise access to the inbox alone would replace both factors.
  try {
    await setUserPassword(state.member.id, password, {
      app_metadata: { password_reset_at: new Date().toISOString() },
    })
  } catch (error) {
    return actionError(error)
  }
  await audit(
    state.member.email,
    "account.password_reset",
    "Reset password with an emailed link",
    { type: "account", id: state.member.id, name: state.member.email }
  )

  // Sign out everywhere: sign in again with the new password (and 2FA).
  const supabase = await createClient()
  await supabase.auth.signOut({ scope: "global" })
  redirect("/login?error=password-reset")
}
