"use server"

import { redirect } from "next/navigation"
import { createClient as createSupabaseClient } from "@supabase/supabase-js"

import { actionError, type ActionResult } from "@/lib/actions"
import { getSessionMember, requireAdmin } from "@/lib/auth"
import { env } from "@/lib/env"
import { passwordProblem } from "@/lib/password"
import { supabaseAdmin } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"

/**
 * Called by the login form after the browser has signed in with Supabase:
 * only people listed in public.members keep their session.
 */
export async function finishSignIn(): Promise<ActionResult> {
  if (await getSessionMember()) redirect("/")
  const supabase = await createClient()
  await supabase.auth.signOut()
  return {
    ok: false,
    error: "This account is not allowed to use the gateway dashboard.",
  }
}

export async function signOut() {
  const supabase = await createClient()
  await supabase.auth.signOut()
  redirect("/login")
}

export async function changePassword(
  currentPassword: string,
  newPassword: string
): Promise<ActionResult> {
  const me = await requireAdmin()
  const problem = passwordProblem(newPassword)
  if (problem) return { ok: false, error: problem }
  if (newPassword === currentPassword) {
    return {
      ok: false,
      error: "Choose a password different from the current one",
    }
  }

  // Verify the current password on a throwaway client so the browser session is untouched.
  const verifier = createSupabaseClient(
    env.supabaseUrl(),
    env.supabasePublishableKey(),
    {
      auth: { persistSession: false, autoRefreshToken: false },
    }
  )
  const { error: verifyError } = await verifier.auth.signInWithPassword({
    email: me.email,
    password: currentPassword,
  })
  if (verifyError) return { ok: false, error: "Current password is incorrect" }
  await verifier.auth.signOut({ scope: "local" })

  const { error } = await supabaseAdmin().auth.admin.updateUserById(me.id, {
    password: newPassword,
  })
  if (error) return actionError(error)
  return { ok: true, message: "Password updated" }
}
