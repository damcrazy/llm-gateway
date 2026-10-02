"use server"

import { createClient as createSupabaseClient } from "@supabase/supabase-js"

import { actionError, type ActionResult } from "@/lib/actions"
import { getSessionState, verifiedTotpFactors } from "@/lib/auth"
import { env } from "@/lib/env"
import { supabaseAdmin } from "@/lib/supabase/admin"

// Email fallback for a lost authenticator: prove you own the account's email
// with a one-time code, then the old authenticators are removed and you set
// up a new one before reaching the dashboard (2FA stays required).

const FRESH_SIGN_IN_S = 30 * 60
const RESET_COOLDOWN_MS = 7 * 24 * 60 * 60 * 1000

/** Only right after a real sign-in (password or Google), still before 2FA. */
async function recoverableMember() {
  const state = await getSessionState()
  if (state.status !== "mfa_challenge") return null
  const now = Date.now() / 1000
  const signedInFresh = state.member.authMethods.some(
    (entry) =>
      (entry.method === "password" || entry.method === "oauth") &&
      now - entry.timestamp < FRESH_SIGN_IN_S
  )
  return signedInFresh ? state.member : null
}

/**
 * Email can't replace both the password and the authenticator: after an
 * emailed password reset, the email fallback is off for a week.
 */
async function resetRecently(userId: string): Promise<boolean> {
  const { data } = await supabaseAdmin().auth.admin.getUserById(userId)
  const resetAt = data.user?.app_metadata?.password_reset_at
  if (typeof resetAt !== "string") return false
  return Date.now() - new Date(resetAt).getTime() < RESET_COOLDOWN_MS
}

const RESET_COOLDOWN_ERROR =
  "Your password was reset by email recently, so email can't also replace your authenticator. Ask the gateway owner to reset your 2FA."

function throwawayClient() {
  return createSupabaseClient(env.supabaseUrl(), env.supabasePublishableKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  })
}

export async function sendRecoveryEmail(): Promise<ActionResult> {
  const member = await recoverableMember()
  if (!member) {
    return {
      ok: false,
      error: "Sign in again with your password or Google first.",
    }
  }
  if (await resetRecently(member.id)) {
    return { ok: false, error: RESET_COOLDOWN_ERROR }
  }
  // Supabase sends the code using the "Magic Link" email template.
  const { error } = await throwawayClient().auth.signInWithOtp({
    email: member.email,
    options: { shouldCreateUser: false },
  })
  if (error) {
    return {
      ok: false,
      error:
        error.status === 429
          ? "An email was sent recently. Wait a minute before asking for another."
          : error.message,
    }
  }
  return { ok: true, message: `Code sent to ${member.email}` }
}

export async function verifyRecoveryEmail(code: string): Promise<ActionResult> {
  const member = await recoverableMember()
  if (!member) {
    return {
      ok: false,
      error: "Sign in again with your password or Google first.",
    }
  }
  if (await resetRecently(member.id)) {
    return { ok: false, error: RESET_COOLDOWN_ERROR }
  }
  if (!/^\d{6,10}$/.test(code.trim())) {
    return { ok: false, error: "Enter the code from the email" }
  }

  // Verify on a separate client so the browser's session isn't replaced.
  const client = throwawayClient()
  const { data, error } = await client.auth.verifyOtp({
    email: member.email,
    token: code.trim(),
    type: "email",
  })
  if (error || data.user?.id !== member.id) {
    return { ok: false, error: "That code is invalid or has expired." }
  }
  await client.auth.signOut({ scope: "local" })

  try {
    const factors = await verifiedTotpFactors(member.id)
    for (const factor of factors) {
      const { error: deleteError } =
        await supabaseAdmin().auth.admin.mfa.deleteFactor({
          id: factor.id,
          userId: member.id,
        })
      if (deleteError) throw new Error(deleteError.message)
    }
  } catch (deleteError) {
    return actionError(deleteError)
  }
  return { ok: true, message: "Verified. Set up your new authenticator." }
}
