"use server"

import { z } from "zod"

import { actionError, type ActionResult } from "@/lib/actions"
import { requireMember, type SessionMember } from "@/lib/auth"
import { loadAppContext } from "@/lib/gateway/auth"
import {
  playgroundOptions,
  runPlayground,
  type PlaygroundOptions,
  type PlaygroundRequest,
  type PlaygroundResult,
} from "@/lib/gateway/playground"
import { supabaseAdmin } from "@/lib/supabase/admin"

const appIdSchema = z.uuid().nullable()

/**
 * Members may run as their own apps only; admins as any app, or with no app
 * (unrestricted). Returns an error message, or null when allowed.
 */
async function checkAppAccess(
  me: SessionMember,
  appId: string | null
): Promise<string | null> {
  if (!appIdSchema.safeParse(appId).success) return "Unknown app"
  if (!appId) return me.isAdmin ? null : "Pick one of your apps to run as"
  if (me.isAdmin) return null
  const { data } = await supabaseAdmin()
    .from("apps")
    .select("owner_email")
    .eq("id", appId)
    .maybeSingle()
  return data?.owner_email === me.email ? null : "Unknown app"
}

/** Routes and models the chosen app (or no app, for admins) can call. */
export async function getPlaygroundOptions(
  appId: string | null
): Promise<ActionResult<PlaygroundOptions>> {
  const me = await requireMember()
  const denied = await checkAppAccess(me, appId)
  if (denied) return { ok: false, error: denied }
  try {
    const context = appId ? await loadAppContext(appId) : null
    if (appId && !context)
      return { ok: false, error: "That app no longer exists" }
    return { ok: true, data: await playgroundOptions(context) }
  } catch (error) {
    return actionError(error)
  }
}

const requestSchema = z.object({
  model: z
    .string()
    .trim()
    .min(1, "Pick a route or model")
    .max(256, "Model name is too long"),
  messages: z
    .array(
      z.object({
        role: z.enum(["system", "user", "assistant"]),
        content: z.string().max(500_000, "A message is too long"),
      })
    )
    .min(1, "Send a message first")
    .max(500, "This conversation is too long; clear it and start again"),
  temperature: z
    .number("Temperature must be a number")
    .min(0, "Temperature must be between 0 and 2")
    .max(2, "Temperature must be between 0 and 2")
    .optional(),
  maxTokens: z
    .number("Max tokens must be a number")
    .int("Max tokens must be a whole number")
    .min(1, "Max tokens must be at least 1")
    .max(1_000_000, "Max tokens is too large")
    .optional(),
  appId: appIdSchema.optional(),
})

/** Runs one chat turn through the real gateway pipeline (routing, fallback, logging). */
export async function sendPlaygroundMessage(
  input: PlaygroundRequest
): Promise<ActionResult<PlaygroundResult>> {
  const me = await requireMember()
  const parsed = requestSchema.safeParse(input)
  if (!parsed.success) {
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid request",
    }
  }
  if (!parsed.data.messages.some((message) => message.role === "user")) {
    return { ok: false, error: "Send a user message first" }
  }
  const appId = parsed.data.appId ?? null
  const denied = await checkAppAccess(me, appId)
  if (denied) return { ok: false, error: denied }

  try {
    const result = await runPlayground({
      ...parsed.data,
      appId,
      ownerEmail: me.email,
    })
    return { ok: true, data: result }
  } catch (error) {
    return actionError(error)
  }
}
