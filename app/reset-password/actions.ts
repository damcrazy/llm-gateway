"use server"

import { redirect } from "next/navigation"

import { actionError, type ActionResult } from "@/lib/actions"
import { getSessionState } from "@/lib/auth"
import { passwordProblem } from "@/lib/password"
import { supabaseAdmin } from "@/lib/supabase/admin"
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
  const { error } = await supabaseAdmin().auth.admin.updateUserById(
    state.member.id,
    {
      password,
      app_metadata: { password_reset_at: new Date().toISOString() },
    }
  )
  if (error) return actionError(error)

  // Sign out everywhere: sign in again with the new password (and 2FA).
  const supabase = await createClient()
  await supabase.auth.signOut({ scope: "global" })
  redirect("/login?error=password-reset")
}
