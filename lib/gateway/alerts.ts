import "server-only"

import { decryptSecret } from "@/lib/crypto"
import { env } from "@/lib/env"
import { publicFetch } from "@/lib/net/public-fetch"
import { supabaseAdmin } from "@/lib/supabase/admin"

import { monthlySpend, type AuthContext } from "./auth"
import { background } from "./background"
import type { ModelRuntime } from "./config"
import type { RequestRecorder } from "./recorder"

// Alerts for budgets, failing models and slow responses. Each condition is
// raised once per period (the dedupe key), stored for the dashboard bell and
// posted to the person's webhook if they set one. Checks run after the
// response is sent and are throttled per instance, so they add no latency.

export type AlertKind = "budget" | "model_down" | "latency" | "test"
export type AlertSeverity = "info" | "warning" | "critical"

export interface AlertSettings {
  budgetPercent: number
  notifyModelDown: boolean
  latencyThresholdMs: number | null
  webhookSecret: string | null
}

export interface NewAlert {
  kind: AlertKind
  severity: AlertSeverity
  title: string
  body: string
  appId?: string | null
  modelId?: string | null
  dedupeKey: string
}

export const DEFAULT_ALERT_SETTINGS: AlertSettings = {
  budgetPercent: 80,
  notifyModelDown: true,
  latencyThresholdMs: null,
  webhookSecret: null,
}

const SETTINGS_TTL_MS = 60_000
const BUDGET_CHECK_MS = 60_000
const LATENCY_CHECK_MS = 60_000
const LATENCY_WINDOW_MS = 15 * 60_000
const MIN_LATENCY_SAMPLES = 5
const MODEL_ALERT_MS = 10 * 60_000
const FAILURES_BEFORE_ALERT = 3
const MAX_ENTRIES = 5_000

const settingsCache = new Map<string, { at: number; settings: AlertSettings }>()
const lastChecked = new Map<string, number>()
let adminCache: { at: number; emails: string[] } | null = null

/** True at most once per `everyMs` for a key, on this instance. */
function due(key: string, everyMs: number): boolean {
  const now = Date.now()
  if (now - (lastChecked.get(key) ?? 0) < everyMs) return false
  if (lastChecked.size >= MAX_ENTRIES) lastChecked.clear()
  lastChecked.set(key, now)
  return true
}

const monthKey = () => new Date().toISOString().slice(0, 7)
const hourKey = () => new Date().toISOString().slice(0, 13)

export function formatMs(ms: number): string {
  return ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.round(ms)} ms`
}

export async function alertSettings(email: string): Promise<AlertSettings> {
  const cached = settingsCache.get(email)
  if (cached && Date.now() - cached.at < SETTINGS_TTL_MS) return cached.settings
  const { data } = await supabaseAdmin()
    .from("alert_settings")
    .select(
      "budget_percent, notify_model_down, latency_threshold_ms, webhook_secret"
    )
    .eq("owner_email", email)
    .maybeSingle()
  const settings: AlertSettings = data
    ? {
        budgetPercent: data.budget_percent as number,
        notifyModelDown: data.notify_model_down as boolean,
        latencyThresholdMs:
          (data.latency_threshold_ms as number | null) ?? null,
        webhookSecret: (data.webhook_secret as string | null) ?? null,
      }
    : DEFAULT_ALERT_SETTINGS
  if (settingsCache.size >= MAX_ENTRIES) settingsCache.clear()
  settingsCache.set(email, { at: Date.now(), settings })
  return settings
}

/** Drops this instance's copy after a save (others refresh within a minute). */
export function forgetAlertSettings(email: string) {
  settingsCache.delete(email)
}

function dashboardUrl(path: string): string | null {
  const base =
    env.appUrl() ??
    (process.env.VERCEL_PROJECT_PRODUCTION_URL
      ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`
      : null)
  return base ? `${base.replace(/\/$/, "")}${path}` : null
}

const SEVERITY_ICON: Record<AlertSeverity, string> = {
  info: "ℹ️",
  warning: "⚠️",
  critical: "🚨",
}

/**
 * Posts an alert as JSON. `text` is what Slack (and Google Chat) show,
 * `content` what Discord shows; other services get the `alert` object.
 * Returns "sent" or why it failed.
 */
export async function postWebhook(
  url: string,
  alert: NewAlert
): Promise<string> {
  const link = dashboardUrl("/alerts")
  const text = `${SEVERITY_ICON[alert.severity]} *${alert.title}*\n${alert.body}${link ? `\n${link}` : ""}`
  try {
    const response = await publicFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        text,
        content: text.replaceAll("*", "**").slice(0, 2000),
        alert: {
          kind: alert.kind,
          severity: alert.severity,
          title: alert.title,
          body: alert.body,
          app_id: alert.appId ?? null,
          model_id: alert.modelId ?? null,
          url: link,
        },
      }),
      signal: AbortSignal.timeout(5_000),
    })
    // Read and discard the body so the connection is released.
    await response.text().catch(() => "")
    return response.ok ? "sent" : `The webhook answered HTTP ${response.status}`
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return /timeout|aborted/i.test(message)
      ? "The webhook didn't answer within 5 seconds"
      : message.slice(0, 300)
  }
}

/** Stores the alert unless already raised this period, then posts it. */
export async function raiseAlert(
  email: string,
  alert: NewAlert
): Promise<{ raised: boolean; delivery: string | null }> {
  const db = supabaseAdmin()
  const { data, error } = await db
    .from("alerts")
    .upsert(
      {
        owner_email: email,
        kind: alert.kind,
        severity: alert.severity,
        title: alert.title,
        body: alert.body,
        app_id: alert.appId ?? null,
        model_id: alert.modelId ?? null,
        dedupe_key: alert.dedupeKey,
      },
      { onConflict: "owner_email,dedupe_key", ignoreDuplicates: true }
    )
    .select("id")
  if (error) {
    console.error("[gateway] failed to store alert:", error.message)
    return { raised: false, delivery: null }
  }
  const id = (data as { id: string }[] | null)?.[0]?.id
  if (!id) return { raised: false, delivery: null }

  const settings = await alertSettings(email)
  if (!settings.webhookSecret) return { raised: true, delivery: null }
  let delivery: string
  try {
    delivery = await postWebhook(decryptSecret(settings.webhookSecret), alert)
  } catch {
    delivery = "The saved webhook couldn't be read; save it again"
  }
  await db.from("alerts").update({ delivery }).eq("id", id)
  return { raised: true, delivery }
}

// ---------------------------------------------------------------------------
// Checks
// ---------------------------------------------------------------------------

/** Budget and latency checks after a request (runs in after()). */
export async function checkAfterRequest(
  recorder: RequestRecorder,
  auth: AuthContext
): Promise<void> {
  try {
    await Promise.all([
      checkBudgets(recorder, auth),
      checkLatency(recorder, auth),
    ])
  } catch (error) {
    console.error("[gateway] alert check failed:", error)
  }
}

async function checkBudgets(
  recorder: RequestRecorder,
  { app, key, owner }: AuthContext
) {
  if (recorder.costUsd <= 0) return
  const checks: {
    key: string
    scope: { app: string } | { member: string } | { key: string }
    budget: number
    email: string
    label: string
    appId: string | null
  }[] = []
  if (app.monthly_budget_usd != null) {
    checks.push({
      key: `app:${app.id}`,
      scope: { app: app.id },
      budget: Number(app.monthly_budget_usd),
      email: app.owner_email,
      label: `App '${app.name}'`,
      appId: app.id,
    })
  }
  if (key.id && key.monthlyBudgetUsd != null) {
    checks.push({
      key: `key:${key.id}`,
      scope: { key: key.id },
      budget: key.monthlyBudgetUsd,
      email: app.owner_email,
      label: `API key '${key.name}' of app '${app.name}'`,
      appId: app.id,
    })
  }
  if (owner.monthlyBudgetUsd != null) {
    checks.push({
      key: `member:${owner.email}`,
      scope: { member: owner.email },
      budget: owner.monthlyBudgetUsd,
      email: owner.email,
      label: "Your account",
      appId: null,
    })
  }

  for (const check of checks) {
    if (check.budget <= 0 || !due(`budget:${check.key}`, BUDGET_CHECK_MS))
      continue
    const [settings, spend] = await Promise.all([
      alertSettings(check.email),
      monthlySpend(check.scope, { fresh: true }),
    ])
    const used = (spend / check.budget) * 100
    const percent =
      used >= 100
        ? 100
        : used >= settings.budgetPercent
          ? settings.budgetPercent
          : null
    if (percent === null) continue
    const amounts = `$${spend.toFixed(2)} of $${check.budget.toFixed(2)} this month.`
    await raiseAlert(check.email, {
      kind: "budget",
      severity: percent === 100 ? "critical" : "warning",
      title:
        percent === 100
          ? `${check.label} reached its monthly budget`
          : `${check.label} used ${percent}% of its monthly budget`,
      body:
        percent === 100
          ? `${amounts} Requests are refused until next month or until the budget is raised.`
          : amounts,
      appId: check.appId,
      dedupeKey: `budget:${check.key}:${monthKey()}:${percent}`,
    })
  }
}

async function checkLatency(recorder: RequestRecorder, { app }: AuthContext) {
  if (recorder.status !== "success" || recorder.cacheStatus === "HIT") return
  const settings = await alertSettings(app.owner_email)
  const threshold = settings.latencyThresholdMs
  if (!threshold || !due(`latency:${app.id}`, LATENCY_CHECK_MS)) return
  const { data } = await supabaseAdmin().rpc("app_response_p50", {
    p_app: app.id,
    p_since: new Date(Date.now() - LATENCY_WINDOW_MS).toISOString(),
  })
  const row = (data as { p50: number | null; samples: number }[] | null)?.[0]
  if (!row?.p50 || row.samples < MIN_LATENCY_SAMPLES || row.p50 <= threshold)
    return
  await raiseAlert(app.owner_email, {
    kind: "latency",
    severity: "warning",
    title: `App '${app.name}' is responding slowly`,
    body: `Median response time over the last 15 minutes is ${formatMs(row.p50)} across ${row.samples} calls, above your ${formatMs(threshold)} alert.`,
    appId: app.id,
    dedupeKey: `latency:${app.id}:${hourKey()}`,
  })
}

async function adminEmails(): Promise<string[]> {
  if (adminCache && Date.now() - adminCache.at < 5 * 60_000)
    return adminCache.emails
  const { data } = await supabaseAdmin()
    .from("members")
    .select("email")
    .in("role", ["superadmin", "admin"])
  const emails = ((data ?? []) as { email: string }[]).map((row) => row.email)
  adminCache = { at: Date.now(), emails }
  return emails
}

/**
 * Called when a model fails. Alerts once it has failed several times in a
 * row or was taken out of rotation for a long time (bad key, removed model).
 * Shared providers alert the admins; a private provider alerts its owner.
 */
export function noteModelFailure(
  model: ModelRuntime,
  failures: number,
  cooldownSeconds: number,
  message: string
): void {
  if (failures < FAILURES_BEFORE_ALERT && cooldownSeconds < 300) return
  if (!due(`model:${model.id}`, MODEL_ALERT_MS)) return
  background(async () => {
    const recipients = model.provider.ownerEmail
      ? [model.provider.ownerEmail]
      : await adminEmails()
    for (const email of recipients) {
      const settings = await alertSettings(email)
      if (!settings.notifyModelDown) continue
      await raiseAlert(email, {
        kind: "model_down",
        severity: "critical",
        title: `${model.slug} is failing`,
        body: `${failures} failed call${failures === 1 ? "" : "s"} in a row; skipped for ${Math.round(cooldownSeconds / 60) || 1} min. Last error: ${message.slice(0, 300)}`,
        modelId: model.id,
        dedupeKey: `model_down:${model.id}:${hourKey()}`,
      })
    }
  })
}
