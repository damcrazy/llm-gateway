"use server"

import { actionError, type ActionResult } from "@/lib/actions"
import {
  assistantTurnInputSchema,
  type AssistantTurnInput,
  type AssistantTurnResult,
} from "@/lib/bucket-assistant/contract"
import { assistantErrorMessage } from "@/lib/bucket-assistant/errors"
import {
  buildAssistantOptions,
  isAllowedRunsOn,
  type AssistantOptions,
} from "@/lib/bucket-assistant/options"
import { runAssistantTurn } from "@/lib/bucket-assistant/run"
import type { SessionMember } from "@/lib/auth"
import { loadAppContext } from "@/lib/gateway/auth"
import { GatewayError } from "@/lib/gateway/errors"
import { runChatAsApp } from "@/lib/gateway/run-as-app"
import { createClient } from "@/lib/supabase/server"

import { isDenied, requireAppAccess } from "../_access"
import type { BucketsData } from "./buckets-shared"
import { loadBucketsData } from "./load-buckets-data"

const ASSISTANT_TIMEOUT_MS = 120_000

/** The app and its Models tab data, as the signed-in member sees them. */
async function loadForAssistant(appId: string, me: SessionMember) {
  const supabase = await createClient()
  const { data: app, error } = await supabase
    .from("apps")
    .select("id, name, owner_email, default_model, only_bucket_models")
    .eq("id", appId)
    .maybeSingle()
  if (error) throw new Error(error.message)
  if (!app) return null
  const loaded = await loadBucketsData(supabase, app)
  if (loaded.error)
    throw new Error(`Couldn't load this app's models: ${loaded.error.message}`)
  return { app, data: loaded.data, options: optionsFor(loaded.data, app, me) }
}

/**
 * Someone else's private providers only answer for their owner, so an admin
 * chatting on a member's app can't run the assistant on them.
 */
function optionsFor(
  data: BucketsData,
  app: { owner_email: string },
  me: SessionMember
): AssistantOptions {
  if (app.owner_email === me.email) return buildAssistantOptions(data)
  const shared = new Set(
    data.models.filter((m) => m.source === "gateway").map((m) => m.id)
  )
  return buildAssistantOptions({
    ...data,
    addable: data.addable.filter((id) => shared.has(id)),
  })
}

/** What the Runs on picker offers for this app. */
export async function getAssistantOptions(
  appId: string
): Promise<ActionResult<AssistantOptions>> {
  const me = await requireAppAccess(appId)
  if (isDenied(me)) return me
  try {
    const loaded = await loadForAssistant(appId, me)
    if (!loaded) return { ok: false, error: "Unknown app" }
    return { ok: true, data: loaded.options }
  } catch (error) {
    return actionError(error)
  }
}

/**
 * One turn of the bucket assistant. It only proposes changes; the browser
 * applies them through the board, which saves with saveAppBuckets.
 */
export async function askBucketAssistant(
  appId: string,
  input: AssistantTurnInput
): Promise<ActionResult<AssistantTurnResult>> {
  const me = await requireAppAccess(appId)
  if (isDenied(me)) return me
  const parsed = assistantTurnInputSchema.safeParse(input)
  if (!parsed.success)
    return {
      ok: false,
      error: parsed.error.issues[0]?.message ?? "Invalid input",
    }
  const turn = parsed.data

  try {
    const loaded = await loadForAssistant(appId, me)
    if (!loaded) return { ok: false, error: "Unknown app" }
    if (!isAllowedRunsOn(loaded.options, turn.runsOn))
      return { ok: false, error: "Pick a model from the list" }
    const context = await loadAppContext(appId)
    if (!context) return { ok: false, error: "Unknown app" }

    const signal = AbortSignal.timeout(ASSISTANT_TIMEOUT_MS)
    const result = await runAssistantTurn({
      data: loaded.data,
      appName: loaded.app.name,
      input: turn,
      callModel: ({ messages, tools }) =>
        runChatAsApp({
          request: {
            model: turn.runsOn,
            messages,
            tools,
            tool_choice: "auto",
            temperature: 0.2,
          },
          context,
          runnerEmail: me.email,
          endpoint: "bucket-assistant",
          signal,
        }),
    })
    return { ok: true, data: result }
  } catch (error) {
    if (!(error instanceof GatewayError))
      console.error("[bucket-assistant] turn failed:", error)
    return { ok: false, error: assistantErrorMessage(error, turn.runsOn) }
  }
}
