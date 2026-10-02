"use server"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { actionError, type ActionResult } from "@/lib/actions"
import { requireMember, verifiedTotpFactors } from "@/lib/auth"
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
