"use server"

import { z } from "zod"

import { actionError, type ActionResult } from "@/lib/actions"
import { requireMember } from "@/lib/auth"
import { createClient } from "@/lib/supabase/server"

export interface RequestPayload {
  request: unknown
  response: unknown
}

/**
 * Full request/response bodies for one request, if the app had payload
 * logging on. Read-only, through the session client (RLS: admins only).
 */
export async function getRequestPayload(
  requestId: string
): Promise<ActionResult<RequestPayload | null>> {
  await requireMember()
  if (!z.uuid().safeParse(requestId).success) {
    return { ok: false, error: "Unknown request" }
  }

  const supabase = await createClient()
  const { data, error } = await supabase
    .from("request_payloads")
    .select("request, response")
    .eq("request_id", requestId)
    .maybeSingle()
  if (error) return actionError(error)

  return {
    ok: true,
    data: data ? { request: data.request, response: data.response } : null,
  }
}
