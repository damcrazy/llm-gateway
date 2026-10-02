import "server-only"

import type { User } from "@supabase/supabase-js"

import { supabaseAdmin } from "@/lib/supabase/admin"
import { createClient } from "@/lib/supabase/server"

/**
 * After a sign-in link or OAuth callback: keep the session only for people
 * listed in public.members. Anyone else is signed out and, if Supabase just
 * created an account for them, that account is removed.
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
  await supabaseAdmin().auth.admin.deleteUser(user.id)
  return false
}
