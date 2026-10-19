import "server-only"

import { z } from "zod"

import { requireMember, type SessionMember } from "@/lib/auth"
import { supabaseAdmin } from "@/lib/supabase/admin"

const idSchema = z.uuid()

/**
 * Members may only touch their own apps; admins may touch any. Returns the
 * caller, or an error result when the app isn't theirs (or doesn't exist).
 */
export async function requireAppAccess(
  appId: string
): Promise<SessionMember | { ok: false; error: string }> {
  const me = await requireMember()
  if (!idSchema.safeParse(appId).success)
    return { ok: false, error: "Unknown app" }
  if (me.isAdmin) return me
  const { data } = await supabaseAdmin()
    .from("apps")
    .select("owner_email")
    .eq("id", appId)
    .maybeSingle()
  if (!data || data.owner_email !== me.email) {
    return { ok: false, error: "Unknown app" }
  }
  return me
}

export function isDenied(
  value: SessionMember | { ok: false; error: string }
): value is { ok: false; error: string } {
  return "ok" in value
}
