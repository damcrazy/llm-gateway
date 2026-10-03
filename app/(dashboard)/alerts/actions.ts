"use server"

import { randomUUID } from "node:crypto"

import { revalidatePath } from "next/cache"
import { z } from "zod"

import { actionError, type ActionResult } from "@/lib/actions"
import { requireMember } from "@/lib/auth"
import { encryptSecret } from "@/lib/crypto"
import {
  forgetAlertSettings,
  postWebhook,
  raiseAlert,
} from "@/lib/gateway/alerts"
import { checkPublicUrl } from "@/lib/net/public-fetch"
import { supabaseAdmin } from "@/lib/supabase/admin"

import { ALERT_COLUMNS, toAlertItem, type AlertItem } from "./shared"

const settingsSchema = z.object({
  budgetPercent: z.number().int().min(10).max(99),
  notifyModelDown: z.boolean(),
  latencyThresholdMs: z.number().int().min(100).max(600_000).nullable(),
  /** undefined keeps the saved webhook, null removes it. */
  webhookUrl: z.string().trim().max(2000).nullable().optional(),
})

export async function saveAlertSettings(
  input: z.input<typeof settingsSchema>
): Promise<ActionResult> {
  const me = await requireMember()
  const parsed = settingsSchema.safeParse(input)
  if (!parsed.success) return { ok: false, error: "Check the alert settings" }
  const { budgetPercent, notifyModelDown, latencyThresholdMs, webhookUrl } =
    parsed.data
  const row: Record<string, unknown> = {
    owner_email: me.email,
    budget_percent: budgetPercent,
    notify_model_down: notifyModelDown,
    latency_threshold_ms: latencyThresholdMs,
    updated_at: new Date().toISOString(),
  }
  if (webhookUrl === null || webhookUrl === "") {
    row.webhook_secret = null
    row.webhook_hint = null
  } else if (webhookUrl !== undefined) {
    const problem = await checkPublicUrl(webhookUrl, "Webhooks")
    if (problem) return { ok: false, error: problem }
    row.webhook_secret = encryptSecret(webhookUrl)
    row.webhook_hint = new URL(webhookUrl).host
  }
  try {
    const { error } = await supabaseAdmin()
      .from("alert_settings")
      .upsert(row, { onConflict: "owner_email" })
    if (error) return actionError(error)
  } catch (error) {
    return actionError(error)
  }
  forgetAlertSettings(me.email)
  revalidatePath("/alerts")
  return { ok: true, message: "Alert settings saved" }
}

/** Posts a test alert to a webhook URL before it is saved. */
export async function testWebhook(url: string): Promise<ActionResult> {
  await requireMember()
  const trimmed = url.trim()
  const problem = await checkPublicUrl(trimmed, "Webhooks")
  if (problem) return { ok: false, error: problem }
  const delivery = await postWebhook(trimmed, {
    kind: "test",
    severity: "info",
    title: "Test alert from your LLM gateway",
    body: "If you can read this, alerts will arrive here.",
    dedupeKey: "test",
  })
  return delivery === "sent"
    ? { ok: true, message: "Test alert sent" }
    : { ok: false, error: delivery }
}

/** Raises a test alert through the saved settings (bell and webhook). */
export async function sendTestAlert(): Promise<ActionResult> {
  const me = await requireMember()
  const { delivery } = await raiseAlert(me.email, {
    kind: "test",
    severity: "info",
    title: "Test alert",
    body: "Alerts from your LLM gateway will show up here and at your webhook.",
    dedupeKey: `test:${randomUUID()}`,
  })
  revalidatePath("/alerts")
  if (delivery && delivery !== "sent") return { ok: false, error: delivery }
  return {
    ok: true,
    message:
      delivery === "sent"
        ? "Test alert sent to your webhook"
        : "Test alert added",
  }
}

export async function markAlertsRead(ids?: string[]): Promise<ActionResult> {
  const me = await requireMember()
  if (ids && !z.array(z.uuid()).max(500).safeParse(ids).success)
    return { ok: false, error: "Unknown alert" }
  let query = supabaseAdmin()
    .from("alerts")
    .update({ read_at: new Date().toISOString() })
    .eq("owner_email", me.email)
    .is("read_at", null)
  if (ids) query = query.in("id", ids)
  const { error } = await query
  if (error) return actionError(error)
  revalidatePath("/alerts")
  return { ok: true }
}

/** For the header bell: the unread count and the latest few alerts. */
export async function recentAlerts(): Promise<
  ActionResult<{ unread: number; items: AlertItem[] }>
> {
  const me = await requireMember()
  const db = supabaseAdmin()
  const [latest, unread] = await Promise.all([
    db
      .from("alerts")
      .select(ALERT_COLUMNS)
      .eq("owner_email", me.email)
      .order("created_at", { ascending: false })
      .limit(6),
    db
      .from("alerts")
      .select("id", { count: "exact", head: true })
      .eq("owner_email", me.email)
      .is("read_at", null),
  ])
  if (latest.error) return actionError(latest.error)
  return {
    ok: true,
    data: {
      unread: unread.count ?? 0,
      items: (latest.data ?? []).map(toAlertItem),
    },
  }
}
