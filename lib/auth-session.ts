import "server-only"

import type { User } from "@supabase/supabase-js"

import { supabaseAdmin } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"

/**
 * After an email link or OAuth callback: keep the session only for members.
 * Confirmed accounts are enrolled automatically (enroll_confirmed_user
 * trigger), so this only turns away accounts that were removed.
 */
export async function keepOnlyMembers(user: User): Promise<boolean> {
  const email = user.email?.toLowerCase() ?? ""
  const { data } = await supabaseAdmin()
    .from("members")
    .select("email")
    .eq("email", email)
    .maybeSingle()
  if (data) return true

  const supabase = await createClient()
  await supabase.auth.signOut()
  return false
}
