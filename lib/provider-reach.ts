import "server-only"

import { NO_REACH, type ProviderReach } from "@/lib/access"
import { supabaseAdmin } from "@/lib/supabase/admin"

/** Providers shared with this person, and the ones they switched off. */
export async function loadReach(email: string | null): Promise<ProviderReach> {
  if (!email) return NO_REACH
  const db = supabaseAdmin()
  const [shares, optOuts] = await Promise.all([
    db.from("provider_shares").select("provider_id").eq("member_email", email),
    db
      .from("provider_opt_outs")
      .select("provider_id")
      .eq("member_email", email),
  ])
  if (shares.error) throw new Error(shares.error.message)
  if (optOuts.error) throw new Error(optOuts.error.message)
  return {
    sharedWithMe: new Set(
      (shares.data ?? []).map((row) => row.provider_id as string)
    ),
    switchedOff: new Set(
      (optOuts.data ?? []).map((row) => row.provider_id as string)
    ),
  }
}
